# Hydrus Connection and Tag Services

> Configuration of the Hydrus server URL and API key, plus discovery and multi-selection of the tag services to search against.

## Source files

- `src/hydrus/client.ts` — `verifyAccess`, `getServices`, request helpers (`get`, `post`) with the `Hydrus-Client-API-Access-Key` header
- `src/settings.ts` — connection UI section (API URL, API key with Test connection button, Fetch services button, service checkboxes)

## Settings used

- `hydrusApiUrl`, `hydrusApiKey`, `hydrusAvailableTagServices`, `hydrusTagServices`, `hydrusTagService` (deprecated, migrated on Fetch)

## Requirements

1. The API URL input shall strip trailing slashes before saving.
2. The API key input shall trim leading and trailing whitespace before saving.
3. The Test connection button shall instantiate a `HydrusClient` with current settings and call `verifyAccess`; on success it shall show a `Hydrus OK: <human_description>` Notice; on failure it shall show `Hydrus failed: <message>`.
4. The Fetch services button shall call `getServices` and store the returned list (filtered to `type` 0 = local tags or 5 = all known tags) into `hydrusAvailableTagServices` as `{ name, key }` pairs (the `key` field carries the Hydrus `service_key` value).
5. If `hydrusTagService` (single-service legacy) is set and `hydrusTagServices` is empty after Fetch, the panel shall migrate by finding the matching name in the fetched list and pushing its key into `hydrusTagServices`, then clearing `hydrusTagService`.
6. The settings UI shall render one checkbox per service in `hydrusAvailableTagServices`. Toggling a checkbox shall add or remove the service key from `hydrusTagServices`.
7. `getServices` shall prefer the `services_v2` array form from the Hydrus response; if absent, it shall fall back to the legacy `services` dict.

## Tests covering this

- `src/__tests__/hydrus-client.test.ts`, `hydrus-client-extra.test.ts` — `verifyAccess` happy path and error, `getServices` v2 vs legacy parsing
- `src/__tests__/settings.test.ts` — tag-service migration logic

## Non-goals

- Discovering services on plugin load. Fetch is manual.
- Validating the API key format (length, hex). Hydrus returns 401/403 on bad keys; that is signal enough.
- Per-service write permissions. The integration is read-only.
