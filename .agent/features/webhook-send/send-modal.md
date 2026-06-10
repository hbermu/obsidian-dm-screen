# Send Modal

> The Obsidian `Modal` opened from the right-click "Send to image webhook…" item. Hosts the target dropdown, image preview, caption editor, and Send/Cancel buttons.

## Source files

- `src/views/SendToWebhookModal.ts` — `SendToWebhookModal` class
- `src/webhooks/client.ts` — `sendWebhookImage` called on Send
- `styles.css` — `.dm-send-modal*` classes

## Settings used

- `webhooks` — read to populate the dropdown; not mutated by the modal

## Requirements

1. The modal's constructor shall accept `(app, plugin, layer, preselectedWebhookId?)`. If `preselectedWebhookId` matches an existing webhook `id`, it is the initial selection; otherwise the initial selection is the first webhook's `id` (or empty when there are no webhooks).
2. The modal's caption buffer shall be initialised to `layer.label`.
3. While `settings.webhooks` is empty, the modal shall render only a `.dm-send-modal-empty` paragraph with the text "Configure a webhook in DM Screen settings first." and no input controls.
4. While `settings.webhooks` is non-empty, the modal shall render a target `<select>` whose options' text is each webhook's `name` (or `"(unnamed)"` if empty) and whose value is the webhook's `id`.
5. The modal shall render an image preview `<img>` whose `src` attribute is the layer's `dataUrl` and whose `alt` is the layer's `label`.
6. The modal shall render a caption `<textarea>` with `rows=3` initialised to the caption buffer.
7. When the user changes the target `<select>`, the modal shall update the selected webhook id used by Send.
8. When the user types in the caption `<textarea>`, the modal shall update the caption buffer on every `input` event.
9. When the user clicks Cancel, the modal shall close without sending.
10. When the user clicks Send, the modal shall disable the Send button, set its text to "Sending…", and call `sendWebhookImage(webhook, layer.dataUrl, caption)`.
11. If `sendWebhookImage` resolves, the modal shall show a `Sent to <name>` Notice for 4 seconds and close.
12. If `sendWebhookImage` throws, the modal shall show a `Send failed: <message>` Notice for 8 seconds, re-enable the Send button, and restore its text to "Send".
13. If the selected webhook `id` no longer exists in `settings.webhooks` when Send is clicked, the modal shall show a `No webhook selected` Notice and not POST.

## Tests covering this

- `src/__tests__/send-to-webhook-modal.test.ts` — dropdown / preview / caption rendering; Send routes to `sendWebhookImage` with the currently selected webhook and caption value; empty-state message

## Non-goals

- No retry button after a failed send. User clicks Send again.
- No per-send override of the webhook's `imageField`, `captionField`, or `extraFields`.
- No multi-target broadcast. One Send ⇒ one webhook.
- No drag-and-drop of additional files into the preview. The layer's existing `dataUrl` is the only payload.
