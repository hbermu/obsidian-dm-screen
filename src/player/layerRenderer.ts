// Player-side image-layer DOM reconciler. Keyed by layer id: nodes are
// reused across syncs, img.src is only reassigned when the dataUrl actually
// changed (reassigning forces a full re-decode and flickers), and the
// lightweight image-layers-geometry patches touch styles only. This is what
// keeps drag/scale movement fluid on the player screen.

import { safePlayerUrl } from "./safeUrl";

export interface RendererLayer {
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

export interface RendererGeometry {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  rotation: number;
  visible: boolean;
  bordered: boolean;
}

interface LayerNode {
  wrapper: HTMLDivElement;
  frame: HTMLDivElement;
  img: HTMLImageElement;
  fogImg: HTMLImageElement | null;
  dataUrl: string;
  fogDataUrl: string;
}

export class LayerRenderer {
  private nodes = new Map<string, LayerNode>();
  private lastLayers: RendererLayer[] = [];

  constructor(private container: HTMLElement) {}

  get layerCount(): number {
    return this.nodes.size;
  }

  hasLayers(): boolean {
    return this.lastLayers.length > 0;
  }

  private inner(): HTMLDivElement {
    let inner = document.getElementById("image-layers-inner") as HTMLDivElement | null;
    if (!inner) {
      inner = document.createElement("div");
      inner.id = "image-layers-inner";
      this.container.appendChild(inner);
    }
    return inner;
  }

  sync(layers: RendererLayer[]) {
    this.lastLayers = layers;
    const inner = this.inner();

    inner.style.width = `${window.innerWidth}px`;
    inner.style.height = `${window.innerHeight}px`;
    inner.style.left = "0";
    inner.style.top = "0";

    const visible = [...layers].filter((l) => l.visible !== false).sort((a, b) => a.zIndex - b.zIndex);
    const seen = new Set<string>();

    for (const layer of visible) {
      const safeSrc = safePlayerUrl(layer.dataUrl, "image");
      if (!safeSrc) {
        console.warn("[Player Screen] Rejected layer dataUrl, skipping layer");
        continue;
      }
      seen.add(layer.id);

      let node = this.nodes.get(layer.id);
      if (!node) {
        node = this.createNode(layer.id);
        inner.appendChild(node.wrapper);
      }

      this.applyWrapperStyles(node, layer);

      if (node.dataUrl !== layer.dataUrl) {
        node.dataUrl = layer.dataUrl;
        node.img.src = safeSrc;
      }

      const wantFog = layer.fogEnabled && !!layer.fogDataUrl;
      if (wantFog) {
        const safeFog = safePlayerUrl(layer.fogDataUrl, "image");
        if (safeFog) {
          if (!node.fogImg) {
            node.fogImg = this.createFogImg();
            node.frame.appendChild(node.fogImg);
          }
          if (node.fogDataUrl !== layer.fogDataUrl) {
            node.fogDataUrl = layer.fogDataUrl;
            node.fogImg.src = safeFog;
          }
        } else {
          console.warn("[Player Screen] Rejected fog dataUrl, skipping fog overlay");
          this.removeFog(node);
        }
      } else {
        this.removeFog(node);
      }

      requestAnimationFrame(() => this.sizeFrame(node!));
    }

    for (const [id, node] of this.nodes) {
      if (!seen.has(id)) {
        node.wrapper.remove();
        this.nodes.delete(id);
      }
    }
  }

  resync() {
    this.sync(this.lastLayers);
  }

  applyGeometry(entries: RendererGeometry[]) {
    for (const entry of entries) {
      const layer = this.lastLayers.find((l) => l.id === entry.id);
      if (layer) {
        Object.assign(layer, entry);
      }
      const node = this.nodes.get(entry.id);
      if (!node) continue;
      if (entry.visible === false) {
        node.wrapper.remove();
        this.nodes.delete(entry.id);
        continue;
      }
      this.applyWrapperStyles(node, entry);
      requestAnimationFrame(() => this.sizeFrame(node));
    }
  }

  clear() {
    this.lastLayers = [];
    this.nodes.clear();
    this.container.innerHTML = "";
  }

  private applyWrapperStyles(node: LayerNode, layer: RendererGeometry | RendererLayer) {
    const { wrapper, frame } = node;
    wrapper.style.left = `${layer.x}%`;
    wrapper.style.top = `${layer.y}%`;
    wrapper.style.width = `${layer.width}%`;
    wrapper.style.height = `${layer.height}%`;
    wrapper.style.zIndex = String(layer.zIndex);
    wrapper.style.transform = layer.rotation ? `rotate(${layer.rotation}deg)` : "";
    frame.classList.toggle("no-border", layer.bordered === false);
  }

  private createNode(id: string): LayerNode {
    const wrapper = document.createElement("div");
    wrapper.dataset.layerId = id;
    wrapper.style.position = "absolute";
    wrapper.style.display = "flex";
    wrapper.style.alignItems = "center";
    wrapper.style.justifyContent = "center";

    const frame = document.createElement("div");
    frame.className = "image-layer-frame";
    frame.style.position = "relative";
    frame.style.width = "100%";
    frame.style.height = "100%";
    frame.style.flexShrink = "0";

    const img = document.createElement("img");
    img.style.display = "block";
    img.style.width = "100%";
    img.style.height = "100%";

    const node: LayerNode = { wrapper, frame, img, fogImg: null, dataUrl: "", fogDataUrl: "" };
    img.onload = () => requestAnimationFrame(() => this.sizeFrame(node));

    frame.appendChild(img);
    wrapper.appendChild(frame);
    this.nodes.set(id, node);
    return node;
  }

  private createFogImg(): HTMLImageElement {
    const fogImg = document.createElement("img");
    fogImg.style.position = "absolute";
    fogImg.style.top = "0";
    fogImg.style.left = "0";
    fogImg.style.width = "100%";
    fogImg.style.height = "100%";
    fogImg.style.pointerEvents = "none";
    return fogImg;
  }

  private removeFog(node: LayerNode) {
    if (node.fogImg) {
      node.fogImg.remove();
      node.fogImg = null;
      node.fogDataUrl = "";
    }
  }

  // Sizes the frame to the rectangle the image actually occupies inside the
  // wrapper (preserving natural aspect) so the gold border hugs the visible
  // content and the fog overlay aligns with the image.
  private sizeFrame(node: LayerNode) {
    const { wrapper, frame, img } = node;
    const ww = wrapper.clientWidth;
    const wh = wrapper.clientHeight;
    if (!ww || !wh || !img.naturalWidth || !img.naturalHeight) return;
    const imgAspect = img.naturalWidth / img.naturalHeight;
    const wrapperAspect = ww / wh;
    if (imgAspect >= wrapperAspect) {
      frame.style.width = "100%";
      frame.style.height = `${(wrapperAspect / imgAspect) * 100}%`;
    } else {
      frame.style.height = "100%";
      frame.style.width = `${(imgAspect / wrapperAspect) * 100}%`;
    }
  }
}
