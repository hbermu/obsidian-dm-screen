import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import { SendToWebhookModal } from "../views/SendToWebhookModal";
import { sendWebhookImage } from "../webhooks/client";
import type { ImageLayer } from "../types";
import type { WebhookConfig } from "../webhooks/types";

vi.mock("../webhooks/client", () => ({
  sendWebhookImage: vi.fn(async () => undefined),
}));

beforeAll(() => {
  if (!HTMLElement.prototype.addClass) {
    HTMLElement.prototype.addClass = function (cls: string) {
      this.classList.add(cls);
    };
  }
  if (!HTMLElement.prototype.empty) {
    (HTMLElement.prototype as any).empty = function () {
      while (this.firstChild) this.removeChild(this.firstChild);
    };
  }
  if (!HTMLElement.prototype.setText) {
    (HTMLElement.prototype as any).setText = function (t: string) {
      this.textContent = t;
    };
  }
  if (!HTMLElement.prototype.createDiv) {
    (HTMLElement.prototype as any).createDiv = function (
      arg?: string | { cls?: string; text?: string; attr?: Record<string, string> },
    ) {
      const div = document.createElement("div");
      if (typeof arg === "string") {
        div.className = arg;
      } else if (arg) {
        if (arg.cls) div.className = arg.cls;
        if (arg.text) div.textContent = arg.text;
        if (arg.attr) {
          for (const [k, v] of Object.entries(arg.attr)) {
            div.setAttribute(k, String(v));
          }
        }
      }
      this.appendChild(div);
      return div;
    };
  }
  if (!HTMLElement.prototype.createEl) {
    (HTMLElement.prototype as any).createEl = function (
      tag: string,
      opts?: {
        text?: string;
        cls?: string;
        type?: string;
        attr?: Record<string, string>;
      },
    ) {
      const el = document.createElement(tag);
      if (opts?.cls) el.className = opts.cls;
      if (opts?.text) el.textContent = opts.text;
      if (opts?.type) el.setAttribute("type", opts.type);
      if (opts?.attr) {
        for (const [k, v] of Object.entries(opts.attr)) {
          el.setAttribute(k, String(v));
        }
      }
      this.appendChild(el);
      return el;
    };
  }
});

function makeLayer(overrides: Partial<ImageLayer> = {}): ImageLayer {
  return {
    id: "L1",
    label: "Tavern map",
    dataUrl: "data:image/jpeg;base64," + btoa("FAKEBYTES"),
    x: 0,
    y: 0,
    width: 50,
    height: 50,
    zIndex: 1,
    rotation: 0,
    visible: true,
    fogEnabled: false,
    fogDataUrl: "",
    bordered: false,
    ...overrides,
  };
}

function makePlugin(webhooks: WebhookConfig[]): unknown {
  return { settings: { webhooks } };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("SendToWebhookModal", () => {
  it("renders dropdown of webhooks, image preview, and caption defaulting to layer.label", () => {
    const wh: WebhookConfig = {
      id: "wh1",
      name: "Telegram",
      url: "https://api.telegram.test",
      imageField: "photo",
      captionField: "caption",
      extraFields: [],
    };
    const modal = new SendToWebhookModal(
      {} as App,
      makePlugin([wh]) as never,
      makeLayer(),
    );
    modal.onOpen();
    const select = modal.contentEl.querySelector("select") as HTMLSelectElement;
    expect(select).toBeTruthy();
    expect(select.options.length).toBe(1);
    expect(select.options[0].textContent).toBe("Telegram");
    expect(select.options[0].value).toBe("wh1");

    const img = modal.contentEl.querySelector("img") as HTMLImageElement;
    expect(img).toBeTruthy();
    expect(img.getAttribute("src") ?? img.src).toContain("base64");

    const ta = modal.contentEl.querySelector("textarea") as HTMLTextAreaElement;
    expect(ta).toBeTruthy();
    expect(ta.value).toBe("Tavern map");
  });

  it("calls sendWebhookImage with the selected webhook, layer dataUrl, and current caption", async () => {
    const wh1: WebhookConfig = {
      id: "wh1",
      name: "Telegram",
      url: "https://t.test",
      imageField: "photo",
      captionField: "caption",
      extraFields: [],
    };
    const wh2: WebhookConfig = {
      id: "wh2",
      name: "Discord",
      url: "https://d.test",
      imageField: "files[0]",
      captionField: "content",
      extraFields: [],
    };
    const modal = new SendToWebhookModal(
      {} as App,
      makePlugin([wh1, wh2]) as never,
      makeLayer(),
    );
    modal.onOpen();

    const select = modal.contentEl.querySelector("select") as HTMLSelectElement;
    select.value = "wh2";
    select.dispatchEvent(new Event("change"));

    const ta = modal.contentEl.querySelector("textarea") as HTMLTextAreaElement;
    ta.value = "Custom caption";
    ta.dispatchEvent(new Event("input"));

    const sendBtn = Array.from(
      modal.contentEl.querySelectorAll("button"),
    ).find((b) => b.textContent === "Send") as HTMLButtonElement;
    sendBtn.click();

    await new Promise((r) => setTimeout(r, 0));

    expect(sendWebhookImage).toHaveBeenCalledTimes(1);
    expect(sendWebhookImage).toHaveBeenCalledWith(
      wh2,
      expect.stringContaining("base64"),
      "Custom caption",
    );
  });

  it("shows a configure-first message when no webhooks are configured", () => {
    const modal = new SendToWebhookModal(
      {} as App,
      makePlugin([]) as never,
      makeLayer(),
    );
    modal.onOpen();
    expect(modal.contentEl.textContent).toContain("Configure a webhook");
    expect(modal.contentEl.querySelector("select")).toBeNull();
  });
});
