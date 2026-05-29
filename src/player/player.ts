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

interface ShowBattlemapPayload {
  name: string;
  image: string;
  gridSize: number;
  gridType: string;
  creatures: Array<{ name: string; count: number; hp: number; ac: number }>;
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
}

interface PlayerMessage {
  type: string;
  payload: Record<string, unknown>;
}

class PlayerScreen {
  private ws: WebSocket | null = null;
  private mode: "waiting" | "combat" = "waiting";
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private lastImageLayers: ImageLayer[] = [];

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
      this.reconnectTimer = setTimeout(() => this.connect(), 3000);
    });

    this.ws.addEventListener("error", (e) => {
      console.error("[Player Screen] WebSocket error:", e);
    });
  }

  private handleMessage(msg: PlayerMessage) {
    switch (msg.type) {
      case "show-battlemap":
        this.showBattlemap(msg.payload as unknown as ShowBattlemapPayload);
        break;
      case "initiative-update":
        this.updateInitiative(msg.payload as unknown as InitiativePayload);
        break;
      case "set-mode":
        this.setMode((msg.payload as { mode: string }).mode);
        break;
      case "image-layers-sync":
        this.syncImageLayers((msg.payload as { layers: ImageLayer[] }).layers);
        break;
      case "show-video-bg": {
        const { url } = msg.payload as { url: string };
        this.showBackgroundMedia({ url, mediaType: "video", loop: true, muted: true });
        break;
      }
      case "hide-video-bg":
        this.hideBackgroundMedia();
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

  private hideAll() {
    document.getElementById("waiting-screen")!.style.display = "none";
    document.getElementById("battlemap-container")!.style.display = "none";
    document.getElementById("initiative-tracker")!.style.display = "none";
  }

  private showWaiting() {
    this.mode = "waiting";
    this.hideAll();
    document.getElementById("waiting-screen")!.style.display = "flex";
  }

  private setMode(mode: string) {
    if (mode === "combat") {
      this.mode = "combat";
    }
  }

  private showBattlemap(payload: ShowBattlemapPayload) {
    this.hideAll();
    this.mode = "combat";

    const container = document.getElementById("battlemap-container")!;
    container.style.display = "flex";

    const img = document.getElementById("battlemap-image") as HTMLImageElement;
    const canvas = document.getElementById("grid-overlay") as HTMLCanvasElement;

    // Show initiative tracker in combat mode
    document.getElementById("initiative-tracker")!.style.display = "block";

    if (payload.image) {
      img.src = payload.image;
      img.onload = () => {
        // Scale image to fill the screen while maintaining aspect ratio
        const screenW = window.innerWidth;
        const screenH = window.innerHeight;
        const imgW = img.naturalWidth;
        const imgH = img.naturalHeight;

        const scale = Math.max(screenW / imgW, screenH / imgH);
        const displayW = imgW * scale;
        const displayH = imgH * scale;

        img.style.width = `${displayW}px`;
        img.style.height = `${displayH}px`;
        img.style.position = "absolute";
        img.style.left = `${(screenW - displayW) / 2}px`;
        img.style.top = `${(screenH - displayH) / 2}px`;

        // Draw grid overlay
        canvas.width = screenW;
        canvas.height = screenH;
        canvas.style.position = "absolute";
        canvas.style.left = "0";
        canvas.style.top = "0";
        canvas.style.pointerEvents = "none";

        this.drawGrid(canvas, displayW, displayH, imgW, imgH, payload.gridType);
      };
    }
  }

  private drawGrid(
    canvas: HTMLCanvasElement,
    displayW: number,
    displayH: number,
    imgW: number,
    imgH: number,
    gridType: string
  ) {
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Assume a standard battlemap grid (typically maps are designed with a specific grid)
    // Default: try to detect ~1 inch squares scaled to the display
    // For now, use a configurable approach: 50px per square on the original image
    const pixelsPerSquare = 70; // Common battlemap grid size
    const scaleX = displayW / imgW;
    const scaleY = displayH / imgH;
    const squareW = pixelsPerSquare * scaleX;
    const squareH = pixelsPerSquare * scaleY;

    const offsetX = (canvas.width - displayW) / 2;
    const offsetY = (canvas.height - displayH) / 2;

    ctx.strokeStyle = "rgba(255, 255, 255, 0.2)";
    ctx.lineWidth = 1;

    if (gridType === "hex") {
      // Hex grid
      const hexW = squareW;
      const hexH = squareH * 0.866;
      for (let row = 0; row * hexH < displayH; row++) {
        for (let col = 0; col * hexW < displayW; col++) {
          const x = offsetX + col * hexW * 0.75;
          const y = offsetY + row * hexH + (col % 2 === 1 ? hexH / 2 : 0);
          this.drawHex(ctx, x + hexW / 2, y + hexH / 2, hexW / 2);
        }
      }
    } else {
      // Square grid
      for (let x = offsetX; x <= offsetX + displayW; x += squareW) {
        ctx.beginPath();
        ctx.moveTo(x, offsetY);
        ctx.lineTo(x, offsetY + displayH);
        ctx.stroke();
      }
      for (let y = offsetY; y <= offsetY + displayH; y += squareH) {
        ctx.beginPath();
        ctx.moveTo(offsetX, y);
        ctx.lineTo(offsetX + displayW, y);
        ctx.stroke();
      }
    }
  }

  private drawHex(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI / 3) * i - Math.PI / 6;
      const x = cx + r * Math.cos(angle);
      const y = cy + r * Math.sin(angle);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();
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
      img.style.maxWidth = "100%";
      img.style.maxHeight = "100%";
      img.style.objectFit = "contain";
      img.style.display = "block";
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
