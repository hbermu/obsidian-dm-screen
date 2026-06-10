import type { Menu } from "obsidian";
import type { ImageLayer } from "../types";
import type { WebhookConfig } from "../webhooks/types";

export interface LayerContextMenuCallbacks {
  openSendModal: (layer: ImageLayer) => void;
  openWebhookSettings: () => void;
}

export function buildLayerContextMenu(
  menu: Menu,
  layer: ImageLayer,
  webhooks: WebhookConfig[],
  cb: LayerContextMenuCallbacks,
): Menu {
  if (webhooks.length > 0) {
    menu.addItem((item) =>
      item
        .setTitle("Send to image webhook…")
        .setIcon("send")
        .onClick(() => cb.openSendModal(layer)),
    );
  } else {
    menu.addItem((item) =>
      item
        .setTitle("Configure a webhook first…")
        .setIcon("settings")
        .onClick(() => cb.openWebhookSettings()),
    );
  }
  menu.addSeparator();
  menu.addItem((item) =>
    item
      .setTitle("Configure webhooks…")
      .setIcon("settings")
      .onClick(() => cb.openWebhookSettings()),
  );
  return menu;
}
