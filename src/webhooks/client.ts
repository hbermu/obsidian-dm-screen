import { requestUrl } from "obsidian";
import { debug, debugError } from "../debug";
import { buildMultipart, dataUrlToBytes } from "./multipart";
import type { WebhookConfig } from "./types";

export async function sendWebhookImage(
  webhook: WebhookConfig,
  dataUrl: string,
  caption: string,
): Promise<void> {
  const file = dataUrlToBytes(dataUrl);
  const filename = `image.${file.ext}`;

  const textFields: { name: string; value: string }[] = [];
  for (const f of webhook.extraFields) {
    if (f.key.length > 0) textFields.push({ name: f.key, value: f.value });
  }
  if (webhook.captionField.length > 0) {
    textFields.push({ name: webhook.captionField, value: caption });
  }

  const { contentType, body } = buildMultipart(textFields, {
    name: webhook.imageField,
    filename,
    mime: file.mime,
    bytes: file.bytes,
  });

  debug(
    "Webhook send:",
    webhook.name,
    "->",
    webhook.url,
    "bytes=",
    file.bytes.byteLength,
    "caption.length=",
    caption.length,
  );

  const res = await requestUrl({
    url: webhook.url,
    method: "POST",
    headers: { "Content-Type": contentType },
    body,
    throw: false,
  });

  if (res.status < 200 || res.status >= 300) {
    const detail = res.text?.slice(0, 200) ?? "";
    debugError("Webhook HTTP error:", res.status, webhook.name, detail);
    throw new Error(
      `Webhook ${webhook.name} returned ${res.status}: ${detail}`,
    );
  }
}
