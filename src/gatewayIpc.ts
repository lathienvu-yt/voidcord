import { invoke } from "@tauri-apps/api/core";
import { listen as tauriListen } from "@tauri-apps/api/event";
import type { UnlistenFn } from "@tauri-apps/api/event";

type GatewayFrame = { event: string; payload: unknown };
type GatewayHandler = (event: { payload: any }) => void;
type IpcConfig = { url: string; token: string };

const handlers = new Map<string, Set<GatewayHandler>>();
let socket: WebSocket | null = null;
let connecting: Promise<void> | null = null;
let retryTimer: number | undefined;
let retryDelay = 500;
let stopped = false;

function dispatch(frame: GatewayFrame) {
  if (typeof frame?.event !== "string") return;
  for (const handler of handlers.get(frame.event) ?? []) {
    try { handler({ payload: frame.payload }); }
    catch (error) { console.error("Gateway IPC listener failed", error); }
  }
}

async function connect() {
  if (socket?.readyState === WebSocket.OPEN) return;
  if (connecting) return connecting;
  stopped = false;
  connecting = (async () => {
    const config = await invoke<IpcConfig>("get_gateway_ipc_config");
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(config.url);
      socket = ws;
      let authenticated = false;
      const authTimeout = window.setTimeout(() => {
        if (!authenticated) ws.close(4001, "IPC authentication timeout");
      }, 5000);
      ws.onopen = () => ws.send(JSON.stringify({ type: "auth", token: config.token }));
      ws.onmessage = event => {
        let frame: any;
        try { frame = JSON.parse(String(event.data)); } catch { return; }
        if (!authenticated && frame?.type === "ready") {
          authenticated = true;
          retryDelay = 500;
          window.clearTimeout(authTimeout);
          resolve();
          return;
        }
        if (authenticated) dispatch(frame as GatewayFrame);
      };
      ws.onerror = () => {
        if (!authenticated) reject(new Error("Gateway IPC connection failed"));
      };
      ws.onclose = () => {
        window.clearTimeout(authTimeout);
        if (!authenticated) reject(new Error("Gateway IPC closed before authentication"));
        if (socket === ws) socket = null;
        scheduleReconnect();
      };
    });
  })().finally(() => { connecting = null; });
  return connecting;
}

function scheduleReconnect() {
  if (stopped || retryTimer !== undefined || handlers.size === 0) return;
  retryTimer = window.setTimeout(() => {
    retryTimer = undefined;
    void connect().catch(error => {
      console.warn("Gateway IPC reconnect failed", error);
      retryDelay = Math.min(retryDelay * 2, 10000);
      scheduleReconnect();
    });
  }, retryDelay);
}

export async function listenGatewayAware<T>(
  event: string,
  handler: (event: { payload: T }) => void,
): Promise<UnlistenFn> {
  if (!event.startsWith("discord:")) {
    return tauriListen<T>(event, handler);
  }
  const wrapped = handler as GatewayHandler;
  let bucket = handlers.get(event);
  if (!bucket) handlers.set(event, bucket = new Set());
  bucket.add(wrapped);
  void connect().catch(error => {
    console.warn("Gateway IPC initial connection failed; retrying", error);
    scheduleReconnect();
  });
  return () => {
    const current = handlers.get(event);
    current?.delete(wrapped);
    if (current?.size === 0) handlers.delete(event);
    if (handlers.size === 0) {
      stopped = true;
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
      retryTimer = undefined;
      socket?.close();
      socket = null;
    }
  };
}
