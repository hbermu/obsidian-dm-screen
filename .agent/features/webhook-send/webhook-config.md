# Webhook Configuration (Settings tab)

> The "Webhooks" section of the DM Screen settings tab, which manages the `settings.webhooks` array.

## Source files

- `src/settings.ts` — `renderWebhooksSection`, `renderWebhookBlock`, `WEBHOOK_TEMPLATES`, `newWebhookId` helpers
- `src/webhooks/types.ts` — `WebhookConfig`, `WebhookExtraField`

## Settings used

- `webhooks` — array mutated in place when the user edits, adds, or deletes records

## Requirements

1. The settings tab shall render a "Webhooks" section as an `<h3>` between the "D&D Beyond" and "Advanced" sections.
2. The section shall begin with a one-paragraph description explaining the section's purpose and a pointer to right-click on a layer.
3. For each record in `settings.webhooks`, the section shall render a `.dm-webhook-block` card with the record's name as `<h4>` and the following Setting rows: Name (text), URL (plain text, full-width), Image field name (text), Caption field name (text), an Extra form fields editor, and a "Delete webhook" warning button.
4. The URL input shall render in plain text (not masked) so the value can be visually inspected, copied, and pasted into an external editor.
5. The Extra form fields editor shall render one `.dm-webhook-extra-field` row per entry containing a key text input, a value text input, and a `✕` delete button.
6. When the user changes a key or value input and the input fires `change`, the settings tab shall write back to the entry and persist via `saveSettings()` without re-rendering the section.
7. When the user clicks the `✕` button on an extra field, the settings tab shall remove the entry at that index, persist, and re-render the section.
8. When the user clicks "+ Add field", the settings tab shall append a new entry with empty `key` and `value`, persist, and re-render the section.
9. When the user clicks "Delete webhook", the settings tab shall remove the record from `settings.webhooks` by `id`, persist, and re-render the section.
10. When the user clicks "+ Add webhook", the settings tab shall append a new `WebhookConfig` with `id` from `newWebhookId()`, default name "New webhook", empty URL, `imageField: "file"`, `captionField: "caption"`, empty `extraFields`, persist, and re-render.
11. When the user clicks "Load template ▾", the settings tab shall open a `Menu` at the click position listing each entry in `WEBHOOK_TEMPLATES`; selecting an entry shall append a new `WebhookConfig` with a fresh `id` and the template's preset values, persist, and re-render.
12. `WEBHOOK_TEMPLATES` shall include at least three presets: `Telegram bot` (URL `https://api.telegram.org/bot<TOKEN>/sendPhoto`, image field `photo`, caption field `caption`, extra `chat_id: <CHAT_ID>`), `Discord webhook` (URL `https://discord.com/api/webhooks/<ID>/<TOKEN>`, image field `files[0]`, caption field `content`, no extras), and `Generic multipart` (empty URL, image field `file`, caption field `caption`, no extras).
13. `newWebhookId` shall return `crypto.randomUUID()` when available, otherwise a string of the form `wh-<base36 timestamp>-<random>`.

## Tests covering this

- (Settings tab UI is not unit-tested; behaviour is verified manually via `make up`.) Programmatic webhook config behaviour is exercised indirectly through `webhooks-client.test.ts` and `send-to-webhook-modal.test.ts`.
- `src/__tests__/settings.test.ts` — `WEBHOOK_TEMPLATES` preset labels and built configs (reqs 12), `newWebhookId` uniqueness and `wh-` fallback when `crypto.randomUUID` is unavailable (req 13).

## Non-goals

- No collapse/expand of webhook blocks.
- No drag-to-reorder of webhooks in the list.
- No drag-to-reorder of extra form fields inside a webhook.
- No URL syntax validation. Anything the user types is accepted.
- No round-trip Test button. Successful send is the test.
