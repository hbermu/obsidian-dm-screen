import { describe, expect, it, vi } from "vitest";
import { Menu } from "obsidian";
import { buildLayerContextMenu } from "../views/layerContextMenu";
import type { ImageLayer } from "../types";
import type { WebhookConfig } from "../webhooks/types";

interface StubMenuItem {
  title: string;
  triggerClick(): void;
}
function items(menu: Menu): StubMenuItem[] {
  return (menu as unknown as { items: StubMenuItem[] }).items;
}

function makeLayer(): ImageLayer {
  return {
    id: "L1",
    label: "Tavern",
    dataUrl: "data:image/png;base64,X",
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    zIndex: 1,
    rotation: 0,
    visible: true,
    fogEnabled: false,
    fogDataUrl: "",
    bordered: false,
  };
}

const wh: WebhookConfig = {
  id: "wh1",
  name: "Telegram",
  url: "https://t",
  imageField: "photo",
  captionField: "caption",
  extraFields: [],
};

describe("buildLayerContextMenu", () => {
  it("with at least one webhook: shows Send to → Configure webhooks", () => {
    const menu = new Menu();
    const openSend = vi.fn();
    const openSettings = vi.fn();
    const layer = makeLayer();
    buildLayerContextMenu(menu, layer, [wh], {
      openSendModal: openSend,
      openWebhookSettings: openSettings,
    });
    expect(items(menu).map((i) => i.title)).toEqual([
      "Send to image webhook…",
      "Configure webhooks…",
    ]);
    items(menu)[0].triggerClick();
    expect(openSend).toHaveBeenCalledWith(layer);
    items(menu)[1].triggerClick();
    expect(openSettings).toHaveBeenCalledTimes(1);
  });

  it("without any webhook: shows hint that opens settings, then Configure webhooks", () => {
    const menu = new Menu();
    const openSend = vi.fn();
    const openSettings = vi.fn();
    buildLayerContextMenu(menu, makeLayer(), [], {
      openSendModal: openSend,
      openWebhookSettings: openSettings,
    });
    expect(items(menu).map((i) => i.title)).toEqual([
      "Configure a webhook first…",
      "Configure webhooks…",
    ]);
    items(menu)[0].triggerClick();
    expect(openSettings).toHaveBeenCalledTimes(1);
    expect(openSend).not.toHaveBeenCalled();
    items(menu)[1].triggerClick();
    expect(openSettings).toHaveBeenCalledTimes(2);
  });
});
