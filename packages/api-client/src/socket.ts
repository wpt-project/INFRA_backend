import { io, type Socket } from "socket.io-client";
import {
  SOCKET_NAMESPACE,
  SOCKET_TRANSPORT_PRIMARY,
  SOCKET_TRANSPORT_FALLBACK,
} from "@wpt/shared";

export interface RealtimeClientConfig {
  baseUrl: string;
  getAuthToken?: () => string | null | Promise<string | null>;
}

/**
 * Primary transport: WebSocket. Falls back to long-polling automatically
 * if the websocket upgrade fails (relevant on free-tier hosts that don't
 * reliably support persistent connections under load) — this is
 * socket.io's built-in behavior, we just declare the transport order.
 */
export async function createRealtimeClient(
  config: RealtimeClientConfig,
): Promise<Socket> {
  const token = await config.getAuthToken?.();

  return io(`${config.baseUrl}${SOCKET_NAMESPACE}`, {
    transports: [SOCKET_TRANSPORT_PRIMARY, SOCKET_TRANSPORT_FALLBACK],
    auth: token ? { token } : undefined,
  });
}
