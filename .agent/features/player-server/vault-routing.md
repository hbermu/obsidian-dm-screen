# Vault Routing (`/vault/`)

> The server exposes vault files over HTTP so that the player screen can stream large assets (videos, large images) without paying the cost of base64 inlining. The path is decoded from the URL and the file is read through the vault adapter, with a path-traversal guard.

## Security boundary

The `/vault/` endpoint is gated by a **display allowlist** derived from the broadcast stream: the only paths it will read are those currently surfaced to the player screen by `show-background-media` or `image-layers-sync`. Any other path returns 404 before any disk read. The allowlist — not the bind address or the LAN — is the access-control boundary for this endpoint, so a future change that exposes the server beyond LAN does not re-open the file-read hole.

## Source files

- `src/server.ts` — `handleHttpRequest` dispatches `/vault/` requests to `serveVaultFile`; `readVaultBytes` exported helper falls back to `vault.adapter` for dotfolders; `vaultPathFromUrl` exported helper decodes a `/vault/` URL into a vault path or returns `null`; `VaultServeAllowlist` exported class tracks the current background path and layer-path set from broadcasts and answers `isAllowed(decodedPath)`; the `PlayerScreenServer` holds one instance, calls `observe(message)` inside `broadcast`, and consults `isAllowed` inside `serveVaultFile`
- `src/views/DmControlPanel.ts` — `setImageAsBackground` builds `/vault/<encoded-path>` URLs
- `src/views/HydrusExplorerModal.ts` — `handleSetBackground` builds `/vault/<encoded-path>` URLs for cached Hydrus files

## Settings used

- `cacheBaseFolder` — vault path under which plugin caches live (Hydrus downloads at `<cacheBaseFolder>/hydrus/`, D&D Beyond avatars at `<cacheBaseFolder>/beyond/`); vault routing serves them just like any other vault asset

## Requirements

1. The server shall accept `GET /vault/<urlencoded-relative-path>`.
2. When the request arrives, the server shall URL-decode the path and reject the request with HTTP 400 if the decoded path contains `..` or starts with `/`.
3. When `broadcast(message)` is called, the server shall update an in-memory display allowlist from `message`: a `show-background-media` whose `payload.url` is a `/vault/<path>` URL shall set the current background path to that decoded path; a `show-background-media` whose `payload.url` is any other value (e.g. a `data:` URL, an absolute HTTP URL, missing, non-string) shall clear the current background path; a `hide-background-media` shall clear the current background path; an `image-layers-sync` shall set the allowed layer paths to exactly the decoded `/vault/<path>` values found in each layer's `dataUrl` and `fogDataUrl` (non-`/vault/` URLs are ignored); a `clear` shall empty both the background path and the layer-path set.
4. The display allowlist shall be the union of the current background path and the layer-path set, so revoking one channel shall not revoke the other.
5. If the decoded path is not on the display allowlist, then the server shall respond with HTTP 404 `Not found` and shall not call `readVaultBytes` for that path. The `..`/leading-`/` guard from requirement 2 shall run before this check.
6. When the path is on the allowlist, the server shall read the bytes via `readVaultBytes(app, decodedPath)`.
7. The `readVaultBytes` helper shall first try `vault.getAbstractFileByPath` and `vault.readBinary` for files inside the indexed vault.
8. If `getAbstractFileByPath` returns nothing, then `readVaultBytes` shall fall back to `vault.adapter.exists` + `vault.adapter.readBinary`, so dotfolders (e.g. `.dm-screen/hydrus/...`) are reachable.
9. If the file does not exist by either path, the server shall respond with HTTP 404 `Not found`.
10. When the file is read, the server shall set `Content-Type` from a small extension map: `webm` → `video/webm`, `mp4` → `video/mp4`, `png` → `image/png`, `jpg` / `jpeg` → `image/jpeg`, `webp` → `image/webp`, `gif` → `image/gif`. Unknown extensions shall fall back to `application/octet-stream`.
11. The server shall set `Content-Length` to the byte length and `Cache-Control: public, max-age=3600` on every 200 response.
12. When the read throws, the server shall respond with HTTP 500 `Server error`.

## Tests covering this

- `src/__tests__/server-vault-path.test.ts` — `..` rejection, leading-slash rejection, MIME type assignment, dotfolder fallback
- `src/__tests__/server-vault-allowlist.test.ts` — `vaultPathFromUrl` decoding and rejection of non-`/vault/` / non-string / malformed inputs; `VaultServeAllowlist` deny-by-default, background allow/replace/hide, layer collection ignoring `data:` URLs, union of background and layers, `clear` semantics
- `src/__tests__/server-vault-allowlist.integration.test.ts` — end-to-end HTTP: undisplayed paths return 404 without touching disk; broadcasting a `/vault/` background admits its path; `hide-background-media` and `clear` revoke; layer paths admitted; traversal still 400; background/layer union honoured
- `src/__tests__/server-bootstrap.integration.test.ts` — end-to-end `/vault/` hit with a real vault adapter mock

## Non-goals

- Range requests. The server returns the full body each time; for video this is acceptable on a LAN.
- Conditional GET (`If-Modified-Since`, `ETag`). `Cache-Control: max-age=3600` is the only freshness signal.
- Streaming very large files. `readBinary` reads into memory; players should not push assets larger than a few hundred MB.
