# Webhook Send

> Share an image layer to a configured `multipart/form-data` endpoint (Telegram bot `sendPhoto`, Discord webhook, n8n, anything that accepts a file upload). The DM right-clicks a layer in the DM Control Panel, picks a target in a modal, optionally edits a caption, and the plugin POSTs the layer's existing in-memory bytes to the user-configured URL.

## Source files

- `src/webhooks/types.ts` — `WebhookConfig`, `WebhookExtraField` interfaces
- `src/webhooks/multipart.ts` — pure `multipart/form-data` builder + `dataUrlToBytes` decoder
- `src/webhooks/client.ts` — `sendWebhookImage` orchestrates decode → build → POST via `requestUrl`, raises on non-2xx
- `src/views/layerContextMenu.ts` — `buildLayerContextMenu` populates the right-click menu items
- `src/views/SendToWebhookModal.ts` — Modal with target dropdown, image preview, caption textarea
- `src/views/DmControlPanel.ts` — `contextmenu` listener on `.dm-layer-row` + `openLayerContextMenu`, `openPluginSettings` helpers
- `src/settings.ts` — `webhooks` array + UI section + preset loader (Telegram, Discord, Generic)
- `styles.css` — `.dm-webhook-block`, `.dm-webhook-extras`, `.dm-webhook-extra-field`, `.dm-send-modal*`

## Settings used

- `webhooks` — array of `WebhookConfig` records (`id`, `name`, `url`, `imageField`, `captionField`, `extraFields: { key, value }[]`)

## Requirements

1. When the user right-clicks a `.dm-layer-row`, the DM panel shall prevent the default browser context menu and open an Obsidian `Menu` populated by `buildLayerContextMenu`.
2. If `settings.webhooks` is non-empty, then `buildLayerContextMenu` shall add a "Send to image webhook…" item that opens `SendToWebhookModal` for the right-clicked layer.
3. If `settings.webhooks` is empty, then `buildLayerContextMenu` shall add a "Configure a webhook first…" item that opens Obsidian settings on the DM Screen tab.
4. The DM panel shall always add a separator followed by a "Configure webhooks…" item that opens Obsidian settings on the DM Screen tab.
5. When `SendToWebhookModal.onOpen` runs and `settings.webhooks` is non-empty, the modal shall render: a `<select>` of webhook names (values are `WebhookConfig.id`), a `<img>` preview whose `src` is the layer's `dataUrl`, a `<textarea>` initialised to `layer.label`, a Cancel button, and a Send button.
6. When the user changes the target `<select>`, the modal shall store the selected `WebhookConfig.id` for the next send.
7. When the user types in the caption `<textarea>`, the modal shall buffer the value in memory; the layer record is never mutated.
8. When the user clicks Send, the modal shall disable the Send button, call `sendWebhookImage(webhook, layer.dataUrl, caption)`, then on success show a `Sent to <name>` Notice and close, or on failure show a `Send failed: <message>` Notice and re-enable the Send button.
9. `sendWebhookImage` shall decode the data URL via `dataUrlToBytes` (throws if the URL is not `data:image/*;base64,…`), build a multipart body with every `extraFields` entry whose `key` is non-empty followed by the caption field (when `captionField` is non-empty) followed by the image part, and POST it to `webhook.url` with `Content-Type: multipart/form-data; boundary=<boundary>` via Obsidian's `requestUrl`.
10. The image part filename shall be `image.<ext>` where `<ext>` is derived from the data URL's MIME (jpg, png, gif, webp, avif, bmp; fallback `bin`).
11. `sendWebhookImage` shall throw with a message of the form `Webhook <name> returned <status>: <detail>` when `requestUrl` returns a status outside 200–299; the first 200 characters of the response text are appended as `<detail>`.
12. The plugin shall never composite `fogDataUrl` onto the sent image; only the layer's base `dataUrl` is decoded and uploaded.
13. The right-click "Configure a webhook first…" and "Configure webhooks…" items shall call `(app as any).setting.open()` + `openTabById("dm-screen")`. If `app.setting` is unavailable, the DM panel shall show an `Open Obsidian Settings → DM Screen → Webhooks` Notice instead.

## Tests covering this

- `src/__tests__/webhooks-multipart.test.ts` — `dataUrlToBytes` MIME parsing and rejection; `buildMultipart` boundary, field order, file part headers, closing boundary, binary preservation
- `src/__tests__/webhooks-client.test.ts` — `sendWebhookImage` POSTs the correct URL/method/headers/body, propagates non-2xx with webhook name, skips empty extras, omits caption when `captionField` is empty
- `src/__tests__/send-to-webhook-modal.test.ts` — modal renders dropdown / preview / caption defaulting to `layer.label`; Send button calls `sendWebhookImage` with the currently selected webhook and caption value; empty-webhooks state shows the configure-first message
- `src/__tests__/layer-context-menu.test.ts` — menu items are emitted in the right order with and without webhooks; click handlers route to the right callbacks

## Non-goals

- No outbound payload format other than `multipart/form-data`. JSON body templates with base64 placeholders are not supported.
- No sanitisation or allowlisting of the configured webhook URL. The URL is user input, trusted as-is.
- No persisted send history, retry queue, or delivery confirmation beyond the `Notice` shown on completion.
- No deferred or scheduled sending.
- No compositing of `fogDataUrl` onto the uploaded image.
- No multi-layer batch send. One right-click ⇒ one layer ⇒ one webhook ⇒ one POST.
- No reuse for non-image content (statblock, initiative state, etc.).
