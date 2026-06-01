# D&D Beyond Authentication

> The plugin authenticates by exchanging the user's `CobaltSession` browser cookie for a short-lived Bearer token via the auth service, then attaches that token to every subsequent request. Tokens are refreshed when they near expiry.

## Source files

- `src/dndbeyond/client.ts` — `DdbClient` constructor, `validateSession`, `refreshToken`, `authedGet`, `authedPost`

## Settings used

- `ddbCobaltSession`

## Requirements

1. `DdbClient` shall throw on construction if no cookie is supplied.
2. `refreshToken` shall POST to the auth service's `cobalt-token` endpoint with the cookie value and store `token` and `tokenExpiry` (`Date.now() + ttl * 1000`).
3. `validateSession` shall call `refreshToken` and return `true` on success or `false` on failure (no throw to the caller).
4. Every authed request shall ensure the token is non-empty and unexpired; if expired or absent, the client shall refresh first.
5. Authed requests shall send the token as `Authorization: Bearer <token>`.
6. The client shall use `requestUrl` from Obsidian for every HTTP call (so it bypasses CORS in the desktop runtime).
7. Errors from the auth service shall surface to the caller with the upstream message.

## Tests covering this

- `src/__tests__/ddb-client.test.ts` — token refresh, expiry checks, validateSession truthiness

## Non-goals

- Persisting the Bearer token across plugin reloads. The cookie is persisted; the token is in-memory only and refreshed on demand.
- Alternative auth flows (OAuth, magic links). Only the CobaltSession cookie path is supported.
- Encrypting the cookie at rest. It is stored in plain plugin settings, password-type input only obscures it in the UI.
