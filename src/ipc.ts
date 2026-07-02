import * as net from "net";

// Newline-delimited JSON over a loopback TCP socket. VSCode owns the server;
// pi sessions connect as clients. JSON.stringify escapes newlines inside
// strings, so every message serializes to exactly one line — safe to frame on
// "\n" even when payloads contain code.

// VSCode -> pi
export interface ContextMessage {
  type: "context";
  data: unknown;
}
export interface InjectMessage {
  type: "inject";
  text: string;
}
// pi -> VSCode
export interface OpenMessage {
  type: "open";
  path: string;
  line?: number;
  endLine?: number;
  column?: number;
}

export type OutgoingMessage = ContextMessage | InjectMessage;
export type IncomingMessage = OpenMessage;

export interface IpcServerHandlers {
  // Called once per new client so it can be seeded with current state.
  onConnect?: (send: (msg: OutgoingMessage) => void) => void;
  onMessage?: (msg: IncomingMessage) => void;
  onListening?: (port: number) => void;
  onError?: (err: Error) => void;
}

export class IpcServer {
  private server?: net.Server;
  private sockets = new Set<net.Socket>();
  private disposed = false;
  private restartTimer?: NodeJS.Timeout;

  constructor(private handlers: IpcServerHandlers) {}

  // `preferred` lets us reuse the previous port across reloads so already-
  // running pi clients reconnect without a restart. Falls back to an
  // OS-assigned ephemeral port if that one is taken.
  listen(preferred?: number): void {
    if (this.disposed) return;
    const server = net.createServer((socket) => this.accept(socket));
    this.server = server;
    let bound = false;

    server.on("error", (err: NodeJS.ErrnoException) => {
      try { server.close(); } catch { /* ignore */ }
      if (this.server === server) this.server = undefined;

      // Preferred port was taken before we bound — retry immediately on a
      // fresh random port instead of waiting for the restart timer.
      if (!bound && preferred && err.code === "EADDRINUSE") {
        this.listen();
        return;
      }
      this.handlers.onError?.(err);
      // Server died after binding: rebind on a fresh port. The new port is
      // re-stamped into the env via onListening.
      this.scheduleRestart();
    });

    // Loopback only. `preferred || 0` — 0 lets the OS pick a guaranteed-free
    // port atomically (no pick-then-bind race).
    server.listen(preferred ?? 0, "127.0.0.1", () => {
      bound = true;
      const addr = server.address();
      if (addr && typeof addr === "object") {
        this.handlers.onListening?.(addr.port);
      }
    });
  }

  private scheduleRestart(): void {
    if (this.disposed || this.restartTimer) return;
    this.restartTimer = setTimeout(() => {
      this.restartTimer = undefined;
      this.listen();
    }, 1000);
  }

  private accept(socket: net.Socket): void {
    this.sockets.add(socket);
    let buffer = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      let idx: number;
      while ((idx = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        if (!line.trim()) continue;
        try {
          this.handlers.onMessage?.(JSON.parse(line) as IncomingMessage);
        } catch {
          // ignore malformed line
        }
      }
    });
    const drop = () => this.sockets.delete(socket);
    socket.on("close", drop);
    socket.on("error", drop);

    this.handlers.onConnect?.((msg) => this.writeTo(socket, msg));
  }

  private writeTo(socket: net.Socket, msg: OutgoingMessage): void {
    if (socket.writable) socket.write(JSON.stringify(msg) + "\n");
  }

  get listening(): boolean {
    return !!this.server?.listening;
  }

  broadcast(msg: OutgoingMessage): void {
    const line = JSON.stringify(msg) + "\n";
    for (const socket of this.sockets) {
      if (socket.writable) socket.write(line);
    }
  }

  get clientCount(): number {
    return this.sockets.size;
  }

  dispose(): void {
    this.disposed = true;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    for (const socket of this.sockets) socket.destroy();
    this.sockets.clear();
    this.server?.close();
    this.server = undefined;
  }
}
