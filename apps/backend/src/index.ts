import "dotenv/config";

import express from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { API_VERSION, SOCKET_NAMESPACE } from "@wpt/shared";
import { supabase } from "./lib/supabase.js";

const app = express();
app.use(express.json());

// Convenience only — lets a bare `localhost:4000` visit in a browser
// show something meaningful instead of Express's default 404. The real
// health-check clients (monitoring, Render, etc.) should use is the
// versioned route below, not this one.
app.get("/", (_req, res) => {
  res.json({ status: "ok", service: "@wpt/backend" });
});

app.get(`/api/${API_VERSION}/health`, (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/v1/db-health", async (_req, res) => {
  const { error } = await supabase
    .from("users")
    .select("id")
    .limit(1);

  if (error) {
    console.error("Supabase connection failed:", error);

    return res.status(500).json({
      ok: false,
      database: "disconnected",
    });
  }

  return res.json({
    ok: true,
    database: "connected",
  });
});
const httpServer = createServer(app);

// Primary transport: WebSocket. socket.io falls back to long-polling on
// its own if the upgrade fails — see packages/api-client/src/socket.ts
// for the client-side transport order.
const io = new Server(httpServer, {
  path: SOCKET_NAMESPACE,
});

io.on("connection", (socket) => {
  socket.on("disconnect", () => {
    // TODO: session/presence cleanup
  });
});

const PORT = process.env.PORT ?? 4000;
httpServer.listen(PORT, () => {
  console.log(`@wpt/backend listening on :${PORT}`);
});