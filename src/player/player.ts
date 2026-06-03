// Player Screen - WebSocket client and rendering logic
// This runs in the browser on the player's TV/screen

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
}

interface InitiativePayload {
  combatants: Combatant[];
  round?: number;
}

interface ImageLayer {
  id: string;
  label: string;
  dataUrl: string;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  rotation: number;
  visible: boolean;
  fogEnabled: boolean;
  fogDataUrl: string;
  bordered?: boolean;
}

interface PlayerMessage {
  type: string;
  payload: Record<string, unknown>;
}

class PlayerScreen {
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private lastImageLayers: ImageLayer[] = [];
  private hasConnectedOnce = false;

  constructor() {
    this.connect();
    window.addEventListener("resize", () => {
      this.sendClientInfo();
      if (this.lastImageLayers.length > 0) {
        this.syncImageLayers(this.lastImageLayers);
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
        this.syncImageLayers((msg.payload as { layers: ImageLayer[] }).layers);
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
      case "clear":
        this.showWaiting();
        this.clearImageLayers();
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
    list.innerHTML = "";

    // Update heading with round number
    heading.textContent = payload.round
      ? `Initiative — Round ${payload.round}`
      : "Initiative";

    payload.combatants.forEach((c) => {
      const li = document.createElement("li");

      const classes = ["init-entry"];
      if (c.active) classes.push("init-active");
      if (c.friendly || c.isPlayer) classes.push("init-friendly");
      li.className = classes.join(" ");

      // Build status badges HTML
      let statusHtml = "";
      if (c.statuses && c.statuses.length > 0) {
        statusHtml = `<div class="init-statuses">${c.statuses.map(s => `<span class="init-status-badge">${s}</span>`).join("")}</div>`;
      }

      // HP condition: "Well", "Hurt" (< 100%), "Bloodied" (<= 50%)
      const hpPercent = c.maxHp > 0 ? (c.hp / c.maxHp) * 100 : 100;
      let conditionText: string;
      let conditionClass: string;
      if (c.hp <= 0) {
        conditionText = "Down";
        conditionClass = "init-condition-down";
      } else if (hpPercent <= 50) {
        conditionText = "Bloodied";
        conditionClass = "init-condition-bloodied";
      } else if (hpPercent < 100) {
        conditionText = "Hurt";
        conditionClass = "init-condition-hurt";
      } else {
        conditionText = "Well";
        conditionClass = "init-condition-well";
      }

      const isAlly = c.friendly || c.isPlayer;
      let hpDisplay: string;
      if (isAlly && !c.hideHp) {
        hpDisplay = `<span class="init-hp-text">${c.hp}/${c.maxHp}</span><span class="init-condition ${conditionClass}">${conditionText}</span>`;
      } else {
        hpDisplay = `<span class="init-condition ${conditionClass}">${conditionText}</span>`;
      }

      li.innerHTML = `
        <span class="init-name">${c.name}${c.isPlayer ? '<span class="init-pc-tag">PC</span>' : ""}</span>
        ${statusHtml}
        ${hpDisplay}
      `;

      list.appendChild(li);
    });

    const activeLi = list.querySelector<HTMLLIElement>("li.init-active");
    if (activeLi) {
      activeLi.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }

  private syncImageLayers(layers: ImageLayer[]) {
    this.lastImageLayers = layers;
    const container = document.getElementById("image-layers-container")!;

    // Create or reuse inner div for pan/zoom
    let inner = document.getElementById("image-layers-inner");
    if (!inner) {
      inner = document.createElement("div");
      inner.id = "image-layers-inner";
      container.appendChild(inner);
    }
    inner.innerHTML = "";

    // Size inner to viewport, maintaining a reference frame where 100% = viewport
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    inner.style.width = `${vw}px`;
    inner.style.height = `${vh}px`;
    inner.style.left = "0";
    inner.style.top = "0";

    const sorted = [...layers].filter(l => l.visible !== false).sort((a, b) => a.zIndex - b.zIndex);
    for (const layer of sorted) {
      // Wrap image + fog in a container div
      const wrapper = document.createElement("div");
      wrapper.style.position = "absolute";
      wrapper.style.left = `${layer.x}%`;
      wrapper.style.top = `${layer.y}%`;
      wrapper.style.width = `${layer.width}%`;
      wrapper.style.height = `${layer.height}%`;
      wrapper.style.zIndex = String(layer.zIndex);
      wrapper.style.display = "flex";
      wrapper.style.alignItems = "center";
      wrapper.style.justifyContent = "center";
      if (layer.rotation) {
        wrapper.style.transform = `rotate(${layer.rotation}deg)`;
      }

      const img = document.createElement("img");
      img.src = layer.dataUrl;
      img.style.width = "100%";
      img.style.height = "100%";
      img.style.objectFit = "contain";
      img.style.display = "block";
      if (layer.bordered === false) {
        img.classList.add("no-border");
      }
      wrapper.appendChild(img);

      // Fog overlay
      if (layer.fogEnabled && layer.fogDataUrl) {
        const fogImg = document.createElement("img");
        fogImg.src = layer.fogDataUrl;
        fogImg.style.position = "absolute";
        fogImg.style.top = "0";
        fogImg.style.left = "0";
        fogImg.style.width = "100%";
        fogImg.style.height = "100%";
        fogImg.style.pointerEvents = "none";
        wrapper.appendChild(fogImg);
      }

      inner.appendChild(wrapper);
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
      image.style.display = "none";
      image.src = "";
      video.loop = payload.loop ?? true;
      video.muted = payload.muted ?? true;
      video.src = payload.url;
      video.style.display = "block";
      video.play().catch((e) => console.error("[Player Screen] Video autoplay failed:", e));
    } else {
      video.pause();
      video.src = "";
      video.style.display = "none";
      image.src = payload.url;
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

  private clearImageLayers() {
    this.lastImageLayers = [];
    const container = document.getElementById("image-layers-container");
    if (container) container.innerHTML = "";
  }

}

// Initialize
new PlayerScreen();
