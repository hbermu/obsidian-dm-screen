# Vault Routing (`/vault/`)

> The server exposes vault files over HTTP so that the player screen can stream large assets (videos, large images) without paying the cost of base64 inlining. The path is decoded from the URL and the file is read through the vault adapter, with a path-traversal guard.

## Source files

- `src/server.ts` — `handleHttpRequest` dispatches `/vault/` requests to `serveVaultFile`; `readVaultBytes` exported helper that falls back to `vault.adapter` for dotfolders
- `src/views/DmControlPanel.ts` — `setImageAsBackground` builds `/vault/<encoded-path>` URLs
- `src/views/HydrusExplorerModal.ts` — `handleSetBackground` builds `/vault/<encoded-path>` URLs for cached Hydrus files

## Settings used

- `hydrusCacheFolder` — vault path under which Hydrus-cached files are stored; vault routing serves them just like any other vault asset

## Requirements

1. The server shall accept `GET /vault/<urlencoded-relative-path>`.
2. When the request arrives, the server shall URL-decode the path and reject the request with HTTP 400 if the decoded path contains `..` or starts with `/`.
3. When the path is accepted, the server shall read the bytes via `readVaultBytes(app, decodedPath)`.
4. The `readVaultBytes` helper shall first try `vault.getAbstractFileByPath` and `vault.readBinary` for files inside the indexed vault.
5. If `getAbstractFileByPath` returns nothing, then `readVaultBytes` shall fall back to `vault.adapter.exists` + `vault.adapter.readBinary`, so dotfolders (e.g. `.dm-screen/bg/...`) are reachable.
6. If the file does not exist by either path, the server shall respond with HTTP 404 `Not found`.
7. When the file is read, the server shall set `Content-Type` from a small extension map: `webm` → `video/webm`, `mp4` → `video/mp4`, `png` → `image/png`, `jpg` / `jpeg` → `image/jpeg`, `webp` → `image/webp`, `gif` → `image/gif`. Unknown extensions shall fall back to `application/octet-stream`.
8. The server shall set `Content-Length` to the byte length and `Cache-Control: public, max-age=3600` on every 200 response.
9. When the read throws, the server shall respond with HTTP 500 `Server error`.

## Tests covering this

- `src/__tests__/server-vault-path.test.ts` — `..` rejection, leading-slash rejection, MIME type assignment, dotfolder fallback
- `src/__tests__/server-bootstrap.integration.test.ts` — end-to-end `/vault/` hit with a real vault adapter mock

## Non-goals

- Range requests. The server returns the full body each time; for video this is acceptable on a LAN.
- Conditional GET (`If-Modified-Since`, `ETag`). `Cache-Control: max-age=3600` is the only freshness signal.
- Serving files outside the vault root. The path-traversal guard is the only line of defence; no further sandboxing is performed because the server is LAN-only and the vault adapter already scopes reads to the vault directory.
- Streaming very large files. `readBinary` reads into memory; players should not push assets larger than a few hundred MB.
