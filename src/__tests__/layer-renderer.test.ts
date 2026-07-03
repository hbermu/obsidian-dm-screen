import { beforeEach, describe, expect, it } from "vitest";
import { LayerRenderer, type RendererLayer } from "../player/layerRenderer";

function makeLayer(over: Partial<RendererLayer> = {}): RendererLayer {
  return {
    id: "l1",
    label: "Goblin",
    dataUrl: "data:image/png;base64,AAAA",
    x: 10,
    y: 20,
    width: 30,
    height: 40,
    zIndex: 1,
    rotation: 0,
    visible: true,
    fogEnabled: false,
    fogDataUrl: "",
    bordered: true,
    ...over,
  };
}

function spySrcSets(img: HTMLImageElement): () => number {
  let count = 0;
  let value = img.getAttribute("src") ?? "";
  Object.defineProperty(img, "src", {
    configurable: true,
    get: () => value,
    set: (v: string) => {
      count++;
      value = v;
    },
  });
  return () => count;
}

describe("LayerRenderer", () => {
  let container: HTMLElement;
  let renderer: LayerRenderer;

  beforeEach(() => {
    document.body.innerHTML = '<div id="image-layers-container"></div>';
    container = document.getElementById("image-layers-container")!;
    renderer = new LayerRenderer(container);
  });

  const wrapperOf = (id: string) => container.querySelector(`[data-layer-id="${id}"]`) as HTMLElement | null;

  it("reuses DOM nodes across syncs and never reassigns src for an unchanged dataUrl", () => {
    renderer.sync([makeLayer()]);
    const wrapper = wrapperOf("l1")!;
    const img = wrapper.querySelector("img")!;
    const sets = spySrcSets(img);

    renderer.sync([makeLayer({ x: 55 })]);

    expect(wrapperOf("l1")).toBe(wrapper);
    expect(wrapper.querySelector("img")).toBe(img);
    expect(wrapper.style.left).toBe("55%");
    expect(sets()).toBe(0);
  });

  it("reassigns src when the dataUrl changes", () => {
    renderer.sync([makeLayer()]);
    const img = wrapperOf("l1")!.querySelector("img")!;
    const sets = spySrcSets(img);

    renderer.sync([makeLayer({ dataUrl: "data:image/png;base64,BBBB" })]);

    expect(sets()).toBe(1);
  });

  it("applyGeometry updates styles only and survives a resync", () => {
    renderer.sync([makeLayer()]);
    const wrapper = wrapperOf("l1")!;
    const img = wrapper.querySelector("img")!;
    const sets = spySrcSets(img);

    renderer.applyGeometry([
      { id: "l1", x: 5, y: 6, width: 70, height: 80, zIndex: 9, rotation: 45, visible: true, bordered: false },
    ]);

    expect(wrapper.style.left).toBe("5%");
    expect(wrapper.style.width).toBe("70%");
    expect(wrapper.style.zIndex).toBe("9");
    expect(wrapper.style.transform).toBe("rotate(45deg)");
    expect(wrapper.querySelector(".image-layer-frame")!.classList.contains("no-border")).toBe(true);
    expect(sets()).toBe(0);

    renderer.resync();
    expect(wrapperOf("l1")!.style.left).toBe("5%");
  });

  it("applyGeometry ignores unknown ids and removes layers turned invisible", () => {
    renderer.sync([makeLayer()]);

    expect(() =>
      renderer.applyGeometry([
        { id: "ghost", x: 0, y: 0, width: 1, height: 1, zIndex: 1, rotation: 0, visible: true, bordered: true },
      ])
    ).not.toThrow();

    renderer.applyGeometry([
      { id: "l1", x: 10, y: 20, width: 30, height: 40, zIndex: 1, rotation: 0, visible: false, bordered: true },
    ]);
    expect(wrapperOf("l1")).toBeNull();
  });

  it("removes departed and hidden layers on sync", () => {
    renderer.sync([makeLayer(), makeLayer({ id: "l2" })]);
    expect(renderer.layerCount).toBe(2);

    renderer.sync([makeLayer({ visible: false })]);
    expect(wrapperOf("l1")).toBeNull();
    expect(wrapperOf("l2")).toBeNull();
    expect(renderer.layerCount).toBe(0);
  });

  it("adds, updates, and removes the fog overlay with the fog state", () => {
    renderer.sync([makeLayer({ fogEnabled: true, fogDataUrl: "data:image/png;base64,F0G1" })]);
    const frame = wrapperOf("l1")!.querySelector(".image-layer-frame")!;
    expect(frame.querySelectorAll("img")).toHaveLength(2);
    const fogImg = frame.querySelectorAll("img")[1] as HTMLImageElement;
    const sets = spySrcSets(fogImg);

    renderer.sync([makeLayer({ fogEnabled: true, fogDataUrl: "data:image/png;base64,F0G1", x: 3 })]);
    expect(sets()).toBe(0);

    renderer.sync([makeLayer({ fogEnabled: true, fogDataUrl: "data:image/png;base64,F0G2" })]);
    expect(sets()).toBe(1);

    renderer.sync([makeLayer()]);
    expect(frame.querySelectorAll("img")).toHaveLength(1);
  });

  it("skips layers whose dataUrl fails validation", () => {
    renderer.sync([makeLayer({ dataUrl: "https://evil.example/x.png" })]);
    expect(renderer.layerCount).toBe(0);
  });

  it("clear empties the container and the node map", () => {
    renderer.sync([makeLayer()]);
    renderer.clear();
    expect(container.innerHTML).toBe("");
    expect(renderer.layerCount).toBe(0);
    expect(renderer.hasLayers()).toBe(false);
  });
});
