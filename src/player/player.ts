// Player Screen - WebSocket client and rendering logic
// This runs in the browser on the player's TV/screen

import {
  createVoronoiFactionLayer,
  createFactionLegend,
  type FactionZone,
} from "./VoronoiFactionLayer";

declare const L: typeof import("leaflet");

interface MapMarker {
  name: string;
  location: number[];
  type: string;
  link: string;
}

interface Combatant {
  name: string;
  hp: number;
  maxHp: number;
  initiative: number;
  active: boolean;
  friendly?: boolean;
  isPlayer?: boolean;
  hidden?: boolean;
  statuses?: string[];
}

interface FogRegion {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface ShowMapPayload {
  name: string;
  image: string;
  bounds: number[];
  markers: MapMarker[];
  factionZones?: FactionZone[];
  factionZoneOpacity?: number;
  showFactionZones?: boolean;
  fogOfWar?: boolean;
  fogRevealed?: FogRegion[];
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
  private map: L.Map | null = null;
  private mode: "waiting" | "exploration" | "combat" = "waiting";
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private factionLayer: L.LayerGroup | null = null;
  private factionLegend: L.Control | null = null;
  private fogLayer: L.SVGOverlay | null = null;
  private fogActive = false;
  private fogBounds: number[] = [];
  private fogRevealed: FogRegion[] = [];

  constructor() {
    this.connect();
    window.addEventListener("resize", () => this.sendClientInfo());
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
      case "show-map":
        this.showMap(msg.payload as unknown as ShowMapPayload);
        break;
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
        // Deprecated alias — keep handling old senders.
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
      case "fog-update":
        this.updateFog((msg.payload as { revealed: FogRegion[] }).revealed);
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
    document.getElementById("map-container")!.style.display = "none";
    document.getElementById("battlemap-container")!.style.display = "none";
    document.getElementById("initiative-tracker")!.style.display = "none";
  }

  private showWaiting() {
    this.mode = "waiting";
    this.hideAll();
    document.getElementById("waiting-screen")!.style.display = "flex";
    if (this.map) {
      this.map.remove();
      this.map = null;
    }
  }

  private setMode(mode: string) {
    if (mode === "exploration" || mode === "combat") {
      // Don't change display, just track mode for future pushes
      this.mode = mode as "exploration" | "combat";
    }
  }

  private showMap(payload: ShowMapPayload) {
    this.hideAll();
    this.mode = "exploration";

    const container = document.getElementById("map-container")!;
    container.style.display = "block";
    container.innerHTML = "";

    // Create map div
    const mapDiv = document.createElement("div");
    mapDiv.id = "leaflet-map";
    mapDiv.style.width = "100vw";
    mapDiv.style.height = "100vh";
    container.appendChild(mapDiv);

    // Title overlay
    const titleEl = document.createElement("div");
    titleEl.className = "map-title";
    titleEl.textContent = payload.name;
    container.appendChild(titleEl);

    // Initialize Leaflet
    if (this.map) {
      this.map.remove();
    }

    const bounds: L.LatLngBoundsExpression = [
      [payload.bounds[0], payload.bounds[1]],
      [payload.bounds[2], payload.bounds[3]],
    ];

    this.map = L.map(mapDiv, {
      crs: L.CRS.Simple,
      minZoom: -5,
      maxZoom: 3,
      zoomControl: false,
      attributionControl: false,
    });

    if (payload.image) {
      L.imageOverlay(payload.image, bounds).addTo(this.map);
    }

    this.map.fitBounds(bounds);

    // Add faction zones (rendered below markers)
    this.factionLayer = null;
    this.factionLegend = null;

    if (payload.factionZones && payload.factionZones.length > 0) {
      const opacity = payload.factionZoneOpacity ?? 0.2;
      this.factionLayer = createVoronoiFactionLayer(
        payload.factionZones,
        payload.bounds,
        opacity
      );

      if (this.factionLayer) {
        const showByDefault = payload.showFactionZones !== false;
        if (showByDefault) {
          this.factionLayer.addTo(this.map);
        }

        // Layer control toggle
        L.control.layers(
          {},
          { "Faction Zones": this.factionLayer },
          { position: "topright", collapsed: false }
        ).addTo(this.map);

        // Legend
        this.factionLegend = createFactionLegend(payload.factionZones);
        this.factionLegend.addTo(this.map);
      }
    }

    // Fog of war overlay (above factions, below markers)
    this.fogActive = payload.fogOfWar ?? false;
    this.fogBounds = payload.bounds;
    this.fogRevealed = payload.fogRevealed ?? [];
    this.fogLayer = null;
    if (this.fogActive) {
      this.renderFog();
    }

    // Add markers (on top of faction zones)
    payload.markers.forEach((marker) => {
      if (!marker.location || marker.location.length < 2) return;

      const icon = L.divIcon({
        className: `poi-marker poi-marker-${marker.type}`,
        html: `<div class="poi-marker-inner">${this.getMarkerEmoji(marker.type)}</div><div class="poi-marker-label">${marker.name}</div>`,
        iconSize: [40, 40],
        iconAnchor: [20, 40],
      });

      L.marker([marker.location[0], marker.location[1]], { icon })
        .addTo(this.map!)
        .bindPopup(`<strong>${marker.name}</strong><br><em>${marker.type}</em>`);
    });
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

  private renderFog() {
    if (!this.map || !this.fogActive) return;

    // Remove existing fog layer
    if (this.fogLayer) {
      this.map.removeLayer(this.fogLayer);
      this.fogLayer = null;
    }

    const [y0, x0, y1, x1] = this.fogBounds;
    const w = x1 - x0;
    const h = y1 - y0;

    // Create SVG element with fog
    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("xmlns", svgNS);
    svg.setAttribute("viewBox", `${x0} ${y0} ${w} ${h}`);

    // Define clip path — fog is everywhere except revealed regions
    const defs = document.createElementNS(svgNS, "defs");
    const mask = document.createElementNS(svgNS, "mask");
    mask.setAttribute("id", "fog-mask");

    // White = visible fog, black = revealed (inverted for mask)
    const maskBg = document.createElementNS(svgNS, "rect");
    maskBg.setAttribute("x", String(x0));
    maskBg.setAttribute("y", String(y0));
    maskBg.setAttribute("width", String(w));
    maskBg.setAttribute("height", String(h));
    maskBg.setAttribute("fill", "white");
    mask.appendChild(maskBg);

    // Cut out revealed regions (black in mask = transparent)
    for (const region of this.fogRevealed) {
      const rect = document.createElementNS(svgNS, "rect");
      rect.setAttribute("x", String(region.x));
      rect.setAttribute("y", String(region.y));
      rect.setAttribute("width", String(region.w));
      rect.setAttribute("height", String(region.h));
      rect.setAttribute("fill", "black");
      rect.setAttribute("rx", "2");
      mask.appendChild(rect);
    }

    defs.appendChild(mask);
    svg.appendChild(defs);

    // Fog rectangle with mask applied
    const fogRect = document.createElementNS(svgNS, "rect");
    fogRect.setAttribute("x", String(x0));
    fogRect.setAttribute("y", String(y0));
    fogRect.setAttribute("width", String(w));
    fogRect.setAttribute("height", String(h));
    fogRect.setAttribute("fill", "black");
    fogRect.setAttribute("mask", "url(#fog-mask)");
    svg.appendChild(fogRect);

    const svgBounds: L.LatLngBoundsExpression = [[y0, x0], [y1, x1]];
    this.fogLayer = L.svgOverlay(svg, svgBounds, { interactive: false, pane: "overlayPane" });
    this.fogLayer.addTo(this.map);

    // Ensure fog is on top of other overlays
    const el = this.fogLayer.getElement();
    if (el) el.style.zIndex = "1000";
  }

  private updateFog(revealed: FogRegion[]) {
    this.fogRevealed = revealed;
    if (this.fogActive) {
      this.renderFog();
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

      // Players/friendly show exact HP, enemies show condition word
      const isAlly = c.friendly || c.isPlayer;
      const hpDisplay = isAlly
        ? `<span class="init-hp-text">${c.hp}/${c.maxHp}</span>`
        : `<span class="init-condition ${conditionClass}">${conditionText}</span>`;

      li.innerHTML = `
        <span class="init-name">${c.name}${c.isPlayer ? '<span class="init-pc-tag">PC</span>' : ""}</span>
        ${statusHtml}
        ${hpDisplay}
      `;

      list.appendChild(li);
    });
  }

  private syncImageLayers(layers: ImageLayer[]) {
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
      if (layer.rotation) {
        wrapper.style.transform = `rotate(${layer.rotation}deg)`;
      }

      const img = document.createElement("img");
      img.src = layer.dataUrl;
      img.style.width = "100%";
      img.style.height = "100%";
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
    const container = document.getElementById("image-layers-container");
    if (container) container.innerHTML = "";
  }

  private getMarkerEmoji(type: string): string {
    const map: Record<string, string> = {
      city: "\u{1F3F0}",
      town: "\u{1F3D8}",
      village: "\u{1F3E0}",
      building: "\u{1F3DB}",
      dungeon: "\u{1F573}",
      npc: "\u{1F9D9}",
      quest: "\u{2757}",
      poi: "\u{1F4CD}",
    };
    return map[type] || "\u{1F4CD}";
  }
}

// Initialize
new PlayerScreen();
