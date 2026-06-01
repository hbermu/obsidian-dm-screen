import { createServer, IncomingMessage, ServerResponse, Server } from "http";
import { TFile } from "obsidian";
import type DmScreenPlugin from "./main";
import { debug, debugWarn, debugError } from "./debug";

// Player screen HTML/CSS/JS are inlined at build time
declare const PLAYER_HTML: string;
declare const PLAYER_CSS: string;
import playerJs from "player-screen-bundle";

interface WebSocketLike {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  readyState: number;
  on(event: string, handler: (...args: unknown[]) => void): void;
}

export interface PlayerMessage {
  type: string;
  payload: Record<string, unknown>;
}

export interface ClientInfo {
  width: number;
  height: number;
  devicePixelRatio: number;
}

export class PlayerScreenServer {
  private plugin: DmScreenPlugin;
  private httpServer: Server | null = null;
  private clients: Set<WebSocketLike> = new Set();
  private clientInfoMap: Map<WebSocketLike, ClientInfo> = new Map();
  maxClients = 10;
  onClientInfo: ((info: ClientInfo) => void) | null = null;
  onClientCountChanged: (() => void) | null = null;
  // Cache last broadcast per message type for late-joining clients
  private lastState = new Map<string, string>();

  constructor(plugin: DmScreenPlugin) {
    this.plugin = plugin;
  }

  get clientCount(): number {
    return this.clients.size;
  }

  getConnectedClients(): ClientInfo[] {
    return [...this.clientInfoMap.values()];
  }

  start(port: number) {
    this.httpServer = createServer((req: IncomingMessage, res: ServerResponse) => {
      this.handleHttpRequest(req, res);
    });

    // Use the ws module for WebSocket support
    // Since we're in Electron, we can require it
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { WebSocketServer } = require("ws") as typeof import("ws");
      const wss = new WebSocketServer({ server: this.httpServer });

      wss.on("connection", (ws: WebSocketLike) => {
        if (this.clients.size >= this.maxClients) {
          ws.close(1013, "Max clients reached");
          return;
        }
        this.clients.add(ws);
        debug("WS client connected. Total:", this.clients.size);
        if (this.onClientCountChanged) this.onClientCountChanged();

        // Replay last state to late-joining client
        for (const data of this.lastState.values()) {
          if (ws.readyState === 1) ws.send(data);
        }

        ws.on("close", () => {
          this.clients.delete(ws);
          this.clientInfoMap.delete(ws);
          debug("WS client disconnected. Total:", this.clients.size);
          if (this.onClientCountChanged) this.onClientCountChanged();
        });

        ws.on("message", (data: unknown) => {
          try {
            const msg = JSON.parse(String(data));
            if (msg.type === "client-info") {
              debug("WS client-info received:", msg.payload);
              this.clientInfoMap.set(ws, msg.payload);
              if (this.onClientInfo) this.onClientInfo(msg.payload);
            } else {
              debug("WS message from player:", msg.type);
            }
          } catch (e) {
            debugWarn("WS unparseable message from player:", data);
          }
        });
      });
    } catch (e) {
      debugError("Failed to create WebSocket server:", e);
    }

    this.httpServer.listen(port, "0.0.0.0", () => {
      debug("Player Screen server listening on port", port);
    });
  }

  stop() {
    if (this.httpServer) {
      debug("Server stopping. Disconnecting", this.clients.size, "client(s)");
      for (const client of this.clients) {
        client.close();
      }
      this.clients.clear();
      this.httpServer.close();
      this.httpServer = null;
    }
  }

  broadcast(message: PlayerMessage) {
    const data = JSON.stringify(message);
    debug("broadcast:", message.type, "→", this.clients.size, "client(s)", `(${data.length} bytes)`);

    if (message.type === "clear") {
      this.lastState.clear();
    } else {
      this.lastState.set(message.type, data);
    }

    for (const client of this.clients) {
      if (client.readyState === 1) {
        client.send(data);
      }
    }
  }

  private handleHttpRequest(req: IncomingMessage, res: ServerResponse) {
    const url = req.url || "/";

    if (url === "/" || url === "/index.html") {
      // Serve the player screen HTML with inlined CSS and JS
      const html = this.buildPlayerHtml();
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
    } else if (url === "/player.js") {
      res.writeHead(200, { "Content-Type": "application/javascript; charset=utf-8" });
      res.end(playerJs);
    } else if (url === "/player.css") {
      res.writeHead(200, { "Content-Type": "text/css; charset=utf-8" });
      res.end(PLAYER_CSS);
    } else if (url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", clients: this.clients.size }));
    } else if (url.startsWith("/vault/")) {
      // Serve vault files directly (for large assets like videos)
      this.serveVaultFile(url.slice(7), res);
    } else {
      res.writeHead(404);
      res.end("Not found");
    }
  }

  private async serveVaultFile(vaultPath: string, res: ServerResponse) {
    try {
      const decodedPath = decodeURIComponent(vaultPath);
      if (decodedPath.includes("..") || decodedPath.startsWith("/")) {
        debugWarn("serveVaultFile: rejected path traversal attempt:", decodedPath);
        res.writeHead(400);
        res.end("Bad path");
        return;
      }

      const data = await readVaultBytes(this.plugin.app, decodedPath);
      if (!data) {
        debug("serveVaultFile: 404 for", decodedPath);
        res.writeHead(404);
        res.end("Not found");
        return;
      }
      const ext = decodedPath.split(".").pop()?.toLowerCase() || "";
      const mimeMap: Record<string, string> = {
        webm: "video/webm",
        mp4: "video/mp4",
        png: "image/png",
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        webp: "image/webp",
        gif: "image/gif",
      };
      const mime = mimeMap[ext] || "application/octet-stream";
      debug("serveVaultFile:", decodedPath, `(${mime}, ${data.byteLength} bytes)`);
      res.writeHead(200, {
        "Content-Type": mime,
        "Content-Length": data.byteLength,
        "Cache-Control": "public, max-age=3600",
      });
      res.end(Buffer.from(data));
    } catch (e) {
      debugError("serveVaultFile failed:", vaultPath, e);
      res.writeHead(500);
      res.end("Server error");
    }
  }

  private buildPlayerHtml(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>DM Screen - Player View</title>
  <link rel="stylesheet" href="/player.css">
</head>
<body>
  <div id="app">
    <div id="waiting-screen">
      <h1>Player Screen</h1>
      <p>Waiting for DM to push content...</p>
      <div class="pulse-dot"></div>
    </div>
    <video id="video-background" muted loop playsinline></video>
    <img id="image-background" alt="" />
    <div id="image-layers-container"></div>
    <div id="initiative-tracker" style="display:none;">
      <h2>Initiative</h2>
      <ul id="initiative-list"></ul>
    </div>
    <button id="fullscreen-btn" aria-label="Toggle fullscreen">⛶</button>
  </div>
  <script src="/player.js"></script>
</body>
</html>`;
  }
}

interface AppLike {
  vault: {
    getAbstractFileByPath(path: string): unknown;
    readBinary(file: never): Promise<ArrayBuffer>;
    adapter: {
      exists?: (path: string) => Promise<boolean>;
      readBinary?: (path: string) => Promise<ArrayBuffer>;
    };
  };
}

/**
 * Reads bytes from the vault, falling back to the raw DataAdapter for paths
 * that the vault index doesn't surface — dotfolders like `.dm-screen/` are
 * the canonical case, since Obsidian skips them on indexing but they are real
 * files on disk.
 */
export async function readVaultBytes(
  app: AppLike,
  decodedPath: string
): Promise<ArrayBuffer | null> {
  const file = app.vault.getAbstractFileByPath(decodedPath);
  if (file instanceof TFile) {
    return await app.vault.readBinary(file as never);
  }
  const adapter = app.vault.adapter;
  if (typeof adapter.readBinary === "function" && typeof adapter.exists === "function") {
    if (await adapter.exists(decodedPath)) {
      return await adapter.readBinary(decodedPath);
    }
  }
  return null;
}
