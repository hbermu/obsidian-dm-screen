import { App, Modal, Notice } from "obsidian";
import type DmScreenPlugin from "../main";
import type { ImageLayer } from "../types";
import { debug } from "../debug";
import { sendWebhookImage } from "../webhooks/client";

export class SendToWebhookModal extends Modal {
  private plugin: DmScreenPlugin;
  private layer: ImageLayer;
  private selectedWebhookId: string;
  private caption: string;
  private sendBtn: HTMLButtonElement | null = null;

  constructor(
    app: App,
    plugin: DmScreenPlugin,
    layer: ImageLayer,
    preselectedWebhookId?: string,
  ) {
    super(app);
    this.plugin = plugin;
    this.layer = layer;
    const webhooks = plugin.settings.webhooks;
    this.selectedWebhookId =
      preselectedWebhookId && webhooks.some((w) => w.id === preselectedWebhookId)
        ? preselectedWebhookId
        : webhooks[0]?.id ?? "";
    this.caption = layer.label;
  }

  onOpen(): void {
    this.modalEl.addClass("dm-send-modal");
    this.titleEl.setText("Send image");

    const { contentEl } = this;
    contentEl.empty();

    const webhooks = this.plugin.settings.webhooks;
    if (webhooks.length === 0) {
      contentEl.createEl("p", {
        cls: "dm-send-modal-empty",
        text: "Configure a webhook in DM Screen settings first.",
      });
      return;
    }

    const targetRow = contentEl.createDiv({ cls: "dm-send-modal-row" });
    targetRow.createEl("label", {
      text: "Target",
      attr: { for: "dm-send-target" },
    });
    const select = targetRow.createEl("select", {
      attr: { id: "dm-send-target" },
    }) as HTMLSelectElement;
    for (const wh of webhooks) {
      const opt = select.createEl("option", {
        text: wh.name || "(unnamed)",
        attr: { value: wh.id },
      }) as HTMLOptionElement;
      if (wh.id === this.selectedWebhookId) opt.selected = true;
    }
    select.addEventListener("change", () => {
      this.selectedWebhookId = select.value;
    });

    const previewWrap = contentEl.createDiv({ cls: "dm-send-modal-preview" });
    const img = previewWrap.createEl("img") as HTMLImageElement;
    img.src = this.layer.dataUrl;
    img.alt = this.layer.label;

    const captionRow = contentEl.createDiv({ cls: "dm-send-modal-row" });
    captionRow.createEl("label", {
      text: "Caption",
      attr: { for: "dm-send-caption" },
    });
    const textarea = captionRow.createEl("textarea", {
      attr: { id: "dm-send-caption", rows: "3" },
    }) as HTMLTextAreaElement;
    textarea.value = this.caption;
    textarea.addEventListener("input", () => {
      this.caption = textarea.value;
    });

    const buttons = contentEl.createDiv({ cls: "dm-send-modal-buttons" });
    const cancelBtn = buttons.createEl("button", {
      text: "Cancel",
    }) as HTMLButtonElement;
    cancelBtn.addEventListener("click", () => this.close());
    const sendBtn = buttons.createEl("button", {
      text: "Send",
      cls: "mod-cta",
    }) as HTMLButtonElement;
    sendBtn.addEventListener("click", () => {
      void this.send();
    });
    this.sendBtn = sendBtn;
  }

  private async send(): Promise<void> {
    const webhook = this.plugin.settings.webhooks.find(
      (w) => w.id === this.selectedWebhookId,
    );
    if (!webhook) {
      new Notice("No webhook selected", 4000);
      return;
    }
    if (this.sendBtn) {
      this.sendBtn.disabled = true;
      this.sendBtn.textContent = "Sending…";
    }
    try {
      debug(
        "SendToWebhookModal: sending",
        webhook.name,
        "layer=",
        this.layer.id,
      );
      await sendWebhookImage(webhook, this.layer.dataUrl, this.caption);
      new Notice(`Sent to ${webhook.name}`, 4000);
      this.close();
    } catch (err) {
      new Notice(`Send failed: ${(err as Error).message}`, 8000);
      if (this.sendBtn) {
        this.sendBtn.disabled = false;
        this.sendBtn.textContent = "Send";
      }
    }
  }
}
