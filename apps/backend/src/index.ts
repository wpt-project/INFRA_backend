import express from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { API_VERSION, SOCKET_NAMESPACE } from "@wpt/shared";

const app = express();
app.use(express.json());

app.get(`/api/${API_VERSION}/health`, (_req, res) => {
  res.json({ ok: true });
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
