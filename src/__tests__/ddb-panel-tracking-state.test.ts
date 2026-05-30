import { beforeAll, describe, expect, it, vi } from "vitest";
import { DnDBeyondPanel } from "../views/DnDBeyondPanel";

// Polyfill Obsidian's HTMLElement extensions used in DnDBeyondPanel.render()
beforeAll(() => {
  if (!HTMLElement.prototype.empty) {
    (HTMLElement.prototype as any).empty = function () {
      while (this.firstChild) this.removeChild(this.firstChild);
    };
  }
  if (!HTMLElement.prototype.addClass) {
    HTMLElement.prototype.addClass = function (cls: string) {
      this.classList.add(cls);
    };
  }
  if (!HTMLElement.prototype.createDiv) {
    (HTMLElement.prototype as any).createDiv = function (
      arg?: string | { cls?: string; text?: string }
    ) {
      const div = document.createElement("div");
      if (typeof arg === "string") {
        div.className = arg;
      } else if (arg) {
        if (arg.cls) div.className = arg.cls;
        if (arg.text) div.textContent = arg.text;
      }
      this.appendChild(div);
      return div;
    };
  }
  if (!HTMLElement.prototype.createEl) {
    (HTMLElement.prototype as any).createEl = function (
      tag: string,
      opts?: { text?: string; cls?: string; attr?: Record<string, string> }
    ) {
      const el = document.createElement(tag);
      if (opts?.cls) el.className = opts.cls;
      if (opts?.text) el.textContent = opts.text;
      if (opts?.attr) for (const [k, v] of Object.entries(opts.attr)) el.setAttribute(k, v);
      this.appendChild(el);
      return el;
    };
  }
  if (!HTMLElement.prototype.createSpan) {
    (HTMLElement.prototype as any).createSpan = function (
      opts?: { text?: string; cls?: string }
    ) {
      const el = document.createElement("span");
      if (opts?.cls) el.className = opts.cls;
      if (opts?.text) el.textContent = opts.text;
      this.appendChild(el);
      return el;
    };
  }
  if (!HTMLElement.prototype.setText) {
    (HTMLElement.prototype as any).setText = function (text: string) {
      this.textContent = text;
    };
  }
});

function makePlugin() {
  return {
    settings: { ddbCobaltSession: "" },
    sendInitiativeUpdate: vi.fn(),
  } as any;
}

describe("DnDBeyondPanel tracking state", () => {
  it("isTracking() returns false by default", () => {
    const container = document.createElement("div");
    const panel = new DnDBeyondPanel(makePlugin(), container);
    expect(panel.isTracking()).toBe(false);
  });

  it("isTracking() returns true after a poller and encounter id are set", () => {
    const container = document.createElement("div");
    const panel = new DnDBeyondPanel(makePlugin(), container);
    (panel as any).poller = { stop: vi.fn() };
    (panel as any).selectedEncounterId = "enc-1";
    expect(panel.isTracking()).toBe(true);
  });

  it("isTracking() returns false when only one of poller/encounter is set", () => {
    const container = document.createElement("div");
    const panel = new DnDBeyondPanel(makePlugin(), container);
    (panel as any).poller = { stop: vi.fn() };
    (panel as any).selectedEncounterId = null;
    expect(panel.isTracking()).toBe(false);

    (panel as any).poller = null;
    (panel as any).selectedEncounterId = "enc-1";
    expect(panel.isTracking()).toBe(false);
  });

  it("stopTracking() is callable from outside (public API) and clears tracking state", () => {
    const container = document.createElement("div");
    const plugin = makePlugin();
    const panel = new DnDBeyondPanel(plugin, container);
    const stopSpy = vi.fn();
    (panel as any).poller = { stop: stopSpy };
    (panel as any).selectedEncounterId = "enc-1";
    (panel as any).polledState = { encounter: { name: "x", roundNum: 1 }, characters: new Map() };

    panel.stopTracking();

    expect(stopSpy).toHaveBeenCalledOnce();
    expect((panel as any).poller).toBeNull();
    expect((panel as any).selectedEncounterId).toBeNull();
    expect((panel as any).polledState).toBeNull();
    expect(plugin.sendInitiativeUpdate).toHaveBeenCalledWith([], 0);
    expect(panel.isTracking()).toBe(false);
  });
});
