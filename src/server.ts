import { createServer, IncomingMessage, ServerResponse, Server } from "http";
import { TFile } from "obsidian";
import type DmScreenPlugin from "./main";
import { debug, debugWarn, debugError } from "./debug";

// Player/map screen HTML/CSS/JS are inlined at build time
declare const PLAYER_HTML: string;
declare const PLAYER_CSS: string;
declare const MAP_CSS: string;
import playerJs from "player-screen-bundle";
import mapJs from "map-screen-bundle";

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

export type ClientChannel = "player" | "map";

export interface ClientInfo {
  width: number;
  height: number;
  devicePixelRatio: number;
  channel?: ClientChannel;
}

export function messageChannel(type: string): ClientChannel {
  return type.startsWith("map-") ? "map" : "player";
}

export function vaultPathFromUrl(url: unknown): string | null {
  if (typeof url !== "string" || !url.startsWith("/vault/")) return null;
  try {
    return decodeURIComponent(url.slice(7));
  } catch {
    return null;
  }
}

export class VaultServeAllowlist {
  private background: string | null = null;
  private map: string | null = null;
  private layers: Set<string> = new Set();

  observe(message: PlayerMessage): void {
    switch (message.type) {
      case "show-background-media":
        this.background = vaultPathFromUrl((message.payload as { url?: unknown }).url);
        return;
      case "hide-background-media":
        this.background = null;
        return;
      case "map-show":
        this.map = vaultPathFromUrl((message.payload as { url?: unknown }).url);
        return;
      case "map-clear":
        this.map = null;
        return;
      case "image-layers-sync": {
        const raw = (message.payload as { layers?: unknown }).layers;
        const next = new Set<string>();
        if (Array.isArray(raw)) {
          for (const layer of raw) {
            const l = layer as { dataUrl?: unknown; fogDataUrl?: unknown };
            const data = vaultPathFromUrl(l.dataUrl);
            if (data !== null) next.add(data);
            const fog = vaultPathFromUrl(l.fogDataUrl);
            if (fog !== null) next.add(fog);
          }
        }
        this.layers = next;
        return;
      }
      case "clear":
        this.background = null;
        this.layers.clear();
        return;
    }
  }

  isAllowed(decodedPath: string): boolean {
    return decodedPath === this.background || decodedPath === this.map || this.layers.has(decodedPath);
  }

  snapshot(): { background: string | null; map: string | null; layers: string[] } {
    return { background: this.background, map: this.map, layers: [...this.layers] };
  }
}

export class PlayerScreenServer {
  private plugin: DmScreenPlugin;
  private httpServer: Server | null = null;
  private clients: Set<WebSocketLike> = new Set();
  private clientChannels: Map<WebSocketLike, ClientChannel> = new Map();
  private clientInfoMap: Map<WebSocketLike, ClientInfo> = new Map();
  maxClients = 10;
  onClientInfo: ((info: ClientInfo) => void) | null = null;
  onClientCountChanged: (() => void) | null = null;
  // Cache last broadcast per message type for late-joining clients
  private lastState = new Map<string, string>();
  private allowlist = new VaultServeAllowlist();

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

      wss.on("connection", (ws: WebSocketLike, req?: { url?: string }) => {
        if (this.clients.size >= this.maxClients) {
          ws.close(1013, "Max clients reached");
          return;
        }
        const channel: ClientChannel = req?.url?.startsWith("/map") ? "map" : "player";
        this.clients.add(ws);
        this.clientChannels.set(ws, channel);
        debug("WS client connected on channel", channel, "- Total:", this.clients.size);
        if (this.onClientCountChanged) this.onClientCountChanged();

        this.replayCachedState(ws, channel);

        ws.on("close", () => {
          this.clients.delete(ws);
          this.clientChannels.delete(ws);
          this.clientInfoMap.delete(ws);
          debug("WS client disconnected. Total:", this.clients.size);
          if (this.onClientCountChanged) this.onClientCountChanged();
        });

        ws.on("message", (data: unknown) => {
          try {
            const msg = JSON.parse(String(data));
            if (msg.type === "client-info") {
              debug("WS client-info received:", msg.payload, "channel:", channel);
              this.clientInfoMap.set(ws, { ...msg.payload, channel });
              if (this.onClientInfo) this.onClientInfo(this.clientInfoMap.get(ws)!);
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
      this.clientChannels.clear();
      this.httpServer.close();
      this.httpServer = null;
    }
  }

  // Replay cached broadcasts of the client's own channel to a late joiner.
  private replayCachedState(ws: WebSocketLike, channel: ClientChannel) {
    for (const [type, data] of this.lastState.entries()) {
      if (messageChannel(type) !== channel) continue;
      if (ws.readyState === 1) ws.send(data);
    }
  }

  broadcast(message: PlayerMessage) {
    this.allowlist.observe(message);
    const channel = messageChannel(message.type);
    const data = JSON.stringify(message);
    debug("broadcast:", message.type, "→ channel", channel, `(${data.length} bytes)`);

    if (message.type === "clear" || message.type === "map-clear") {
      for (const type of [...this.lastState.keys()]) {
        if (messageChannel(type) === channel) this.lastState.delete(type);
      }
    } else {
      this.lastState.set(message.type, data);
    }

    for (const client of this.clients) {
      if ((this.clientChannels.get(client) ?? "player") !== channel) continue;
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
    } else if (url === "/map") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(buildMapHtml());
    } else if (url === "/map.js") {
      res.writeHead(200, { "Content-Type": "application/javascript; charset=utf-8" });
      res.end(mapJs);
    } else if (url === "/map.css") {
      res.writeHead(200, { "Content-Type": "text/css; charset=utf-8" });
      res.end(MAP_CSS);
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

      if (!this.allowlist.isAllowed(decodedPath)) {
        debug("serveVaultFile: not on display allowlist:", decodedPath);
        res.writeHead(404);
        res.end("Not found");
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
    const waitingTitle = this.plugin.settings.waitingTitle;
    const waitingSubtitle = this.plugin.settings.waitingSubtitle;
    const titleHtml = waitingTitle ? `<h1>${escapeHtml(waitingTitle)}</h1>` : "";
    const subtitleHtml = waitingSubtitle ? `<p>${escapeHtml(waitingSubtitle)}</p>` : "";
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
      ${titleHtml}
      ${subtitleHtml}
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

function buildMapHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>DM Screen - Map View</title>
  <link rel="stylesheet" href="/map.css">
</head>
<body>
  <div id="app">
    <div id="waiting-screen">
      <h1>Map Screen</h1>
      <p>Waiting for DM to push a map...</p>
      <div class="pulse-dot"></div>
    </div>
    <div id="map-stage">
      <video id="map-video" muted loop playsinline></video>
      <img id="map-image" alt="" />
      <canvas id="map-fog"></canvas>
    </div>
    <canvas id="grid-overlay"></canvas>
    <div id="calibration-overlay"></div>
    <div id="scale-hint"></div>
    <button id="fullscreen-btn" aria-label="Toggle fullscreen">⛶</button>
  </div>
  <script src="/map.js"></script>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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
