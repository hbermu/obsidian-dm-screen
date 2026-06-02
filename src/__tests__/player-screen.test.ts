import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Listener = (event?: any) => void;

class MockWebSocket {
  static instances: MockWebSocket[] = [];

  readyState = 0;
  sent: string[] = [];
  listeners: Record<string, Listener[]> = {};

  constructor(public url: string) {
    MockWebSocket.instances.push(this);
  }

  addEventListener(type: string, listener: Listener) {
    this.listeners[type] ??= [];
    this.listeners[type].push(listener);
  }

  dispatch(type: string, event: any = {}) {
    for (const listener of this.listeners[type] ?? []) {
      listener(event);
    }
  }

  send(data: string) {
    this.sent.push(data);
  }
}

const originalWebSocket = globalThis.WebSocket;
const originalScrollIntoView = Element.prototype.scrollIntoView;

function setBaseDom() {
  document.body.innerHTML = `
    <button id="fullscreen-btn"></button>
    <div id="waiting-screen" style="display:none"></div>
    <div id="initiative-tracker" style="display:none">
      <h2>Initiative</h2>
      <ul id="initiative-list"></ul>
    </div>
    <div id="image-layers-container"></div>
    <video id="video-background"></video>
    <img id="image-background" />
  `;
}


async function loadPlayerScreenScript() {
  // @ts-expect-error player script has side effects and no exports
  await import("../player/player");
}
describe("player screen runtime", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    setBaseDom();
    MockWebSocket.instances = [];
    (globalThis as any).WebSocket = MockWebSocket as any;
    Element.prototype.scrollIntoView = vi.fn();
    Object.defineProperty(window, "innerWidth", { value: 1280, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 720, configurable: true });
    Object.defineProperty(window, "devicePixelRatio", { value: 2, configurable: true });

    const video = document.getElementById("video-background") as HTMLVideoElement;
    video.play = vi.fn(() => Promise.resolve());
    video.pause = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    (globalThis as any).WebSocket = originalWebSocket;
    Element.prototype.scrollIntoView = originalScrollIntoView;
  });

  it("connects and sends client info on websocket open", async () => {
    await loadPlayerScreenScript();

    const ws = MockWebSocket.instances[0];
    expect(ws.url).toBe("ws://localhost:3000");

    ws.readyState = 1;
    ws.dispatch("open");

    expect(ws.sent).toHaveLength(1);
    expect(JSON.parse(ws.sent[0])).toEqual({
      type: "client-info",
      payload: {
        width: 1280,
        height: 720,
        devicePixelRatio: 2,
      },
    });
  });

  it("renders initiative rows with statuses, hp rules, and active scroll", async () => {
    await loadPlayerScreenScript();
    const ws = MockWebSocket.instances[0];

    ws.dispatch("message", {
      data: JSON.stringify({
        type: "initiative-update",
        payload: {
          round: 2,
          combatants: [
            { name: "Rogue", hp: 14, maxHp: 14, initiative: 18, active: true, isPlayer: true, statuses: ["Blessed"] },
            { name: "Goblin", hp: 3, maxHp: 10, initiative: 12, active: false, hideHp: true },
            { name: "Orc", hp: 0, maxHp: 20, initiative: 10, active: false },
          ],
        },
      }),
    });

    const tracker = document.getElementById("initiative-tracker") as HTMLDivElement;
    const list = document.getElementById("initiative-list") as HTMLUListElement;

    expect(tracker.style.display).toBe("block");
    expect(tracker.querySelector("h2")?.textContent).toBe("Initiative — Round 2");
    expect(list.children).toHaveLength(3);

    const first = list.children[0] as HTMLLIElement;
    const second = list.children[1] as HTMLLIElement;
    const third = list.children[2] as HTMLLIElement;

    expect(first.className).toContain("init-active");
    expect(first.innerHTML).toContain("init-pc-tag");
    expect(first.innerHTML).toContain("14/14");
    expect(first.innerHTML).toContain("Well");
    expect(first.innerHTML).toContain("Blessed");

    expect(second.innerHTML).not.toContain("3/10");
    expect(second.innerHTML).toContain("Bloodied");

    expect(third.innerHTML).toContain("Down");
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it("syncs image layers with ordering, visibility filter, fog, and no-border", async () => {
    await loadPlayerScreenScript();
    const ws = MockWebSocket.instances[0];

    ws.dispatch("message", {
      data: JSON.stringify({
        type: "image-layers-sync",
        payload: {
          layers: [
            {
              id: "hidden",
              label: "Hidden",
              dataUrl: "data:image/png;base64,H",
              x: 0,
              y: 0,
              width: 10,
              height: 10,
              zIndex: 99,
              rotation: 0,
              visible: false,
              fogEnabled: false,
              fogDataUrl: "",
            },
            {
              id: "top",
              label: "Top",
              dataUrl: "data:image/png;base64,T",
              x: 20,
              y: 25,
              width: 30,
              height: 35,
              zIndex: 2,
              rotation: 15,
              visible: true,
              fogEnabled: true,
              fogDataUrl: "data:image/png;base64,F",
            },
            {
              id: "base",
              label: "Base",
              dataUrl: "data:image/png;base64,B",
              x: 5,
              y: 10,
              width: 15,
              height: 20,
              zIndex: 1,
              rotation: 0,
              visible: true,
              fogEnabled: false,
              fogDataUrl: "",
              bordered: false,
            },
          ],
        },
      }),
    });

    const inner = document.getElementById("image-layers-inner") as HTMLDivElement;
    expect(inner).toBeTruthy();
    expect(inner.style.width).toBe("1280px");
    expect(inner.style.height).toBe("720px");
    expect(inner.children).toHaveLength(2);

    const baseWrapper = inner.children[0] as HTMLDivElement;
    const topWrapper = inner.children[1] as HTMLDivElement;

    expect(baseWrapper.style.zIndex).toBe("1");
    expect((baseWrapper.querySelector("img") as HTMLImageElement).classList.contains("no-border")).toBe(true);

    expect(topWrapper.style.zIndex).toBe("2");
    expect(topWrapper.style.transform).toBe("rotate(15deg)");
    expect(topWrapper.querySelectorAll("img")).toHaveLength(2);
  });

  it("applies viewport transforms and clear message resets relevant UI", async () => {
    await loadPlayerScreenScript();
    const ws = MockWebSocket.instances[0];

    ws.dispatch("message", {
      data: JSON.stringify({
        type: "image-layers-sync",
        payload: {
          layers: [
            {
              id: "one",
              label: "one",
              dataUrl: "data:image/png;base64,1",
              x: 0,
              y: 0,
              width: 10,
              height: 10,
              zIndex: 1,
              rotation: 0,
              visible: true,
              fogEnabled: false,
              fogDataUrl: "",
            },
          ],
        },
      }),
    });

    ws.dispatch("message", {
      data: JSON.stringify({
        type: "viewport-update",
        payload: { panX: 10, panY: -5, zoom: 1.25 },
      }),
    });

    const inner = document.getElementById("image-layers-inner") as HTMLDivElement;
    expect(inner.style.transform).toBe("translate(10px, -5px) scale(1.25)");

    ws.dispatch("message", {
      data: JSON.stringify({
        type: "show-background-media",
        payload: { url: "https://example/video.mp4", mediaType: "video", loop: false, muted: false },
      }),
    });

    const video = document.getElementById("video-background") as HTMLVideoElement;
    const image = document.getElementById("image-background") as HTMLImageElement;

    expect(video.style.display).toBe("block");
    expect(video.src).toContain("https://example/video.mp4");
    expect(video.loop).toBe(false);
    expect(video.muted).toBe(false);
    expect(image.style.display).toBe("none");

    ws.dispatch("message", {
      data: JSON.stringify({
        type: "clear",
        payload: {},
      }),
    });

    expect((document.getElementById("waiting-screen") as HTMLDivElement).style.display).toBe("flex");
    expect((document.getElementById("initiative-tracker") as HTMLDivElement).style.display).toBe("none");
    expect((document.getElementById("image-layers-container") as HTMLDivElement).innerHTML).toBe("");
    expect(video.style.display).toBe("none");
    expect(image.style.display).toBe("none");
  });

  it("reconnects after close event timeout", async () => {
    await loadPlayerScreenScript();
    const first = MockWebSocket.instances[0];

    first.dispatch("close");
    expect(MockWebSocket.instances).toHaveLength(1);

    vi.advanceTimersByTime(3000);
    expect(MockWebSocket.instances).toHaveLength(2);
  });
});
