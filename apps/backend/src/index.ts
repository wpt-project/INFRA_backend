import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { API_VERSION, SOCKET_NAMESPACE } from "@wpt/shared";
import onboardingRoutes from "./routes/onboarding.js";
import profileRoutes from "./routes/profile.js";
import prekeyRoutes from "./routes/prekey.js";
import debugRoutes from "./routes/debug.js";
import adminRoutes from "./routes/admin.js";
import {
  initSocketRegistry,
  registerSocket,
  unregisterSocket,
} from "./ws/socket-registry.js";
import { verifyAccessToken, AppAudienceError } from "./auth/jwt.js";
import { requireAudience } from "./middleware/auth.middleware.js";

const app = express();

// ── Reverse proxy / real client IP ──
// When deployed behind a reverse proxy (e.g. Nginx, CloudFlare, a PaaS), the
// real client IP is in the `X-Forwarded-For` header. Express only trusts it
// when `trust proxy` is set; otherwise req.ip is the proxy/loopback address.
// For safety this is OFF by default (direct connections). Set TRUST_PROXY=1
// only when the app truly sits behind a trusted proxy. See Express docs on
// the trust proxy setting (set to 1 = trust the immediate upstream hop).
if (process.env.TRUST_PROXY === "1") {
  app.set("trust proxy", 1);
}

// ── Security headers ──
app.use(helmet());

// ── CORS: never wildcard in production ──
const allowedOrigins = (process.env.CORS_ORIGIN ?? "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: allowedOrigins.length > 0 ? allowedOrigins : false,
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);

// ── Body parsing with size limit (100 KB max) ──
app.use(express.json({ limit: "100kb" }));

app.get(`/api/${API_VERSION}/health`, (_req, res) => {
  res.json({ ok: true });
});

app.use(`/api/${API_VERSION}/onboarding`, onboardingRoutes);
// App endpoints: enforce aud "app" centrally (LOGIN-3.11).
app.use(`/api/${API_VERSION}/profile`, requireAudience("app"), profileRoutes);
app.use(`/api/${API_VERSION}/prekey-bundle`, requireAudience("app"), prekeyRoutes);
app.use(`/api/${API_VERSION}/debug`, debugRoutes);
// Dashboard endpoints: auth enforced centrally inside admin router (login/refresh
// are public and share the mount, so the gate sits after them in admin.ts).
app.use(`/api/${API_VERSION}/admin`, adminRoutes);

const httpServer = createServer(app);

const io = new Server(httpServer, {
  path: SOCKET_NAMESPACE,
});

initSocketRegistry(io);

io.use(async (socket, next) => {
  const token = socket.handshake.auth?.token as string | undefined;
  const userId = socket.handshake.auth?.userId as string | undefined;
  const deviceId = socket.handshake.auth?.deviceId as string | undefined;

  if (!token || !userId || !deviceId) {
    next(new Error("Authentication required"));
    return;
  }

  try {
    const payload = await verifyAccessToken(token);
    if (payload.sub !== userId) {
      next(new Error("Token userId mismatch"));
      return;
    }
    if (payload.deviceId !== deviceId) {
      next(new Error("Token deviceId mismatch"));
      return;
    }
    next();
  } catch (err) {
    // LOGIN-3.11 — the realtime channel is an app endpoint: reject audience
    // mismatches (e.g. aud: "dashboard" tokens) explicitly.
    if (err instanceof AppAudienceError) {
      next(new Error(`Invalid token audience: expected app, received ${err.receivedAudience}`));
      return;
    }
    next(new Error("Invalid token"));
  }
});

io.on("connection", (socket) => {
  const userId = socket.handshake.auth?.userId as string;
  const deviceId = socket.handshake.auth?.deviceId as string;

  registerSocket(socket, userId, deviceId);

  socket.on("disconnect", () => {
    unregisterSocket(socket, userId);
  });
});

const PORT = process.env.PORT ?? 4000;
httpServer.listen(PORT, () => {
  console.log(`@wpt/backend listening on :${PORT}`);
});
