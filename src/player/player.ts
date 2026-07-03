// Player Screen - WebSocket client and rendering logic
// This runs in the browser on the player's TV/screen

import { safePlayerUrl } from "./safeUrl";
import { decodeStatus } from "../conditions";
import { LayerRenderer, type RendererGeometry, type RendererLayer } from "./layerRenderer";

interface Combatant {
  name: string;
  hp: number;
  maxHp: number;
  initiative: number;
  active: boolean;
  friendly?: boolean;
  isPlayer?: boolean;
  hidden?: boolean;
  hideHp?: boolean;
  statuses?: string[];
  inspired?: boolean;
}

interface InitiativePayload {
  combatants: Combatant[];
  round?: number;
}

interface PlayerMessage {
  type: string;
  payload: Record<string, unknown>;
}

function classifyHp(hp: number, maxHp: number): { text: string; cssClass: string } {
  if (hp <= 0) return { text: "Down", cssClass: "init-condition-down" };
  const pct = maxHp > 0 ? (hp / maxHp) * 100 : 100;
  if (pct <= 50) return { text: "Bloodied", cssClass: "init-condition-bloodied" };
  if (pct < 100) return { text: "Hurt", cssClass: "init-condition-hurt" };
  return { text: "Well", cssClass: "init-condition-well" };
}

function buildInitiativeRow(c: Combatant): HTMLLIElement {
  const li = document.createElement("li");
  const classes = ["init-entry"];
  if (c.active) classes.push("init-active");
  if (c.friendly || c.isPlayer) classes.push("init-friendly");
  if (c.inspired) classes.push("init-inspired");
  li.className = classes.join(" ");

  const nameSpan = document.createElement("span");
  nameSpan.className = "init-name";
  nameSpan.textContent = c.name;
  if (c.isPlayer) {
    const pc = document.createElement("span");
    pc.className = "init-pc-tag";
    pc.textContent = "PC";
    nameSpan.appendChild(pc);
  }
  li.appendChild(nameSpan);

  if (c.statuses && c.statuses.length > 0) {
    const wrap = document.createElement("div");
    wrap.className = "init-statuses";
    for (const status of c.statuses) {
      const d = decodeStatus(status);
      if (d.kind === "condition") {
        const icon = document.createElement("span");
        icon.className = "init-status-icon";
        icon.title = d.def.name;
        icon.innerHTML = d.def.iconSvg;
        wrap.appendChild(icon);
      } else if (d.kind === "exhaustion") {
        const icon = document.createElement("span");
        icon.className = "init-status-icon init-status-exhaustion";
        icon.title = `Exhaustion (Level ${d.level})`;
        icon.innerHTML = d.iconSvg;
        const level = document.createElement("span");
        level.className = "init-status-level";
        level.textContent = String(d.level);
        icon.appendChild(level);
        wrap.appendChild(icon);
      } else {
        const badge = document.createElement("span");
        badge.className = "init-status-badge";
        badge.textContent = d.text;
        wrap.appendChild(badge);
      }
    }
    li.appendChild(wrap);
  }

  const cond = classifyHp(c.hp, c.maxHp);
  const isAlly = c.friendly || c.isPlayer;
  if (isAlly && !c.hideHp) {
    const hpText = document.createElement("span");
    hpText.className = "init-hp-text";
    hpText.textContent = `${c.hp}/${c.maxHp}`;
    li.appendChild(hpText);
  }
  const condSpan = document.createElement("span");
  condSpan.className = `init-condition ${cond.cssClass}`;
  condSpan.textContent = cond.text;
  li.appendChild(condSpan);

  return li;
}

class PlayerScreen {
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private layers = new LayerRenderer(document.getElementById("image-layers-container")!);
  private hasConnectedOnce = false;

  constructor() {
    this.connect();
    window.addEventListener("resize", () => {
      this.sendClientInfo();
      if (this.layers.hasLayers()) {
        this.layers.resync();
      }
    });
    this.initFullscreenButton();
  }

  private initFullscreenButton() {
    const btn = document.getElementById("fullscreen-btn");
    if (!btn) return;
    btn.addEventListener("click", () => {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => {});
      } else {
        document.exitFullscreen().catch(() => {});
      }
    });
    document.addEventListener("fullscreenchange", () => {
      btn.textContent = document.fullscreenElement ? "✕" : "⛶";
    });
  }

  private sendClientInfo() {
    if (this.ws && this.ws.readyState === 1) {
      this.ws.send(JSON.stringify({
        type: "client-info",
        payload: {
          width: window.innerWidth,
          height: window.innerHeight,
          devicePixelRatio: window.devicePixelRatio || 1,
        },
      }));
    }
  }

  private connect() {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}`;

    this.ws = new WebSocket(wsUrl);

    this.ws.addEventListener("open", () => {
      console.log("[Player Screen] Connected to DM");
      (window as unknown as { __wsConnected: boolean }).__wsConnected = true;
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }
      if (this.hasConnectedOnce) {
        window.location.reload();
        return;
      }
      this.hasConnectedOnce = true;
      this.hideDisconnectedOverlay();
      this.sendClientInfo();
    });

    this.ws.addEventListener("message", (event) => {
      try {
        const msg: PlayerMessage = JSON.parse(event.data);
        this.handleMessage(msg);
      } catch (e) {
        console.error("[Player Screen] Failed to parse message:", e);
      }
    });

    this.ws.addEventListener("close", () => {
      console.log("[Player Screen] Disconnected, reconnecting in 3s...");
      (window as unknown as { __wsConnected: boolean }).__wsConnected = false;
      if (this.hasConnectedOnce) this.showDisconnectedOverlay();
      this.reconnectTimer = setTimeout(() => this.connect(), 3000);
    });

    this.ws.addEventListener("error", (e) => {
      console.error("[Player Screen] WebSocket error:", e);
    });
  }

  private showDisconnectedOverlay() {
    let el = document.getElementById("disconnected-overlay");
    if (!el) {
      el = document.createElement("div");
      el.id = "disconnected-overlay";
      el.innerHTML = `
        <div class="disconnected-msg">
          <h2>Disconnected</h2>
          <p>Lost connection to the DM. Reconnecting…</p>
          <div class="pulse-dot"></div>
        </div>`;
      document.body.appendChild(el);
    }
    el.style.display = "flex";
  }

  private hideDisconnectedOverlay() {
    const el = document.getElementById("disconnected-overlay");
    if (el) el.style.display = "none";
  }

  private handleMessage(msg: PlayerMessage) {
    switch (msg.type) {
      case "initiative-update":
        this.updateInitiative(msg.payload as unknown as InitiativePayload);
        break;
      case "combat-scale":
        this.applyCombatScale((msg.payload as { scale: number }).scale);
        break;
      case "image-layers-sync":
        this.layers.sync((msg.payload as { layers: RendererLayer[] }).layers);
        break;
      case "image-layers-geometry":
        this.layers.applyGeometry((msg.payload as { layers: RendererGeometry[] }).layers);
        break;
      case "show-background-media":
        this.showBackgroundMedia(
          msg.payload as { url: string; mediaType: "image" | "video"; loop?: boolean; muted?: boolean }
        );
        break;
      case "hide-background-media":
        this.hideBackgroundMedia();
        break;
      case "viewport-update":
        this.updateViewport(msg.payload as { panX: number; panY: number; zoom: number });
        break;
      case "waiting-screen":
        this.applyWaitingScreen(msg.payload as { title: string; subtitle: string });
        break;
      case "inspiration-style":
        this.applyInspirationStyle(msg.payload as { pulse: boolean });
        break;
      case "clear":
        this.showWaiting();
        this.layers.clear();
        this.hideBackgroundMedia();
        break;
      default:
        console.log("[Player Screen] Unknown message type:", msg.type);
    }
  }

  private showWaiting() {
    document.getElementById("initiative-tracker")!.style.display = "none";
    document.getElementById("waiting-screen")!.style.display = "flex";
  }

  private applyWaitingScreen(payload: { title: string; subtitle: string }) {
    const screen = document.getElementById("waiting-screen");
    if (!screen) return;
    const pulseDot = screen.querySelector(".pulse-dot");
    upsertWaitingChild(screen, "h1", payload.title, pulseDot);
    upsertWaitingChild(screen, "p", payload.subtitle, pulseDot);
  }

  private applyInspirationStyle(payload: { pulse: boolean }) {
    document.body.classList.toggle("dm-inspired-pulse", !!payload.pulse);
  }

  private applyCombatScale(scale: number) {
    const tracker = document.getElementById("initiative-tracker");
    if (!tracker) return;
    tracker.style.transform = `scale(${scale})`;
    tracker.style.transformOrigin = "top right";
    tracker.style.setProperty("--combat-scale", String(scale));
  }

  private updateInitiative(payload: InitiativePayload) {
    const tracker = document.getElementById("initiative-tracker")!;
    const list = document.getElementById("initiative-list")!;
    const heading = tracker.querySelector("h2")!;

    if (payload.combatants.length === 0) {
      tracker.style.display = "none";
      return;
    }

    tracker.style.display = "block";
    list.replaceChildren();
    heading.textContent = payload.round
      ? `Initiative — Round ${payload.round}`
      : "Initiative";

    for (const c of payload.combatants) {
      list.appendChild(buildInitiativeRow(c));
    }

    const activeLi = list.querySelector<HTMLLIElement>("li.init-active");
    if (activeLi) {
      activeLi.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }

  private updateViewport(payload: { panX: number; panY: number; zoom: number }) {
    const inner = document.getElementById("image-layers-inner");
    if (inner) {
      inner.style.transform = `translate(${payload.panX}px, ${payload.panY}px) scale(${payload.zoom})`;
    }
  }

  private showBackgroundMedia(payload: {
    url: string;
    mediaType: "image" | "video";
    loop?: boolean;
    muted?: boolean;
  }) {
    const video = document.getElementById("video-background") as HTMLVideoElement;
    const image = document.getElementById("image-background") as HTMLImageElement;
    if (payload.mediaType === "video") {
      const safeVideoSrc = safePlayerUrl(payload.url, "video");
      if (!safeVideoSrc) {
        console.warn("[Player Screen] Rejected background video URL");
        return;
      }
      image.style.display = "none";
      image.src = "";
      video.loop = payload.loop ?? true;
      video.muted = payload.muted ?? true;
      video.src = safeVideoSrc;
      video.style.display = "block";
      video.play().catch((e) => console.error("[Player Screen] Video autoplay failed:", e));
    } else {
      const safeImageSrc = safePlayerUrl(payload.url, "image");
      if (!safeImageSrc) {
        console.warn("[Player Screen] Rejected background image URL");
        return;
      }
      video.pause();
      video.src = "";
      video.style.display = "none";
      image.src = safeImageSrc;
      image.style.display = "block";
    }
  }

  private hideBackgroundMedia() {
    const video = document.getElementById("video-background") as HTMLVideoElement;
    const image = document.getElementById("image-background") as HTMLImageElement;
    video.pause();
    video.src = "";
    video.style.display = "none";
    image.src = "";
    image.style.display = "none";
  }

}

function upsertWaitingChild(parent: HTMLElement, tag: "h1" | "p", text: string, before: Element | null) {
  const existing = parent.querySelector(tag);
  if (!text) {
    if (existing) existing.remove();
    return;
  }
  if (existing) {
    existing.textContent = text;
    return;
  }
  const el = document.createElement(tag);
  el.textContent = text;
  parent.insertBefore(el, before);
}

// Initialize
new PlayerScreen();
