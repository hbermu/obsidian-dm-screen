// Allowlist validator for URLs taken from WebSocket payloads on the player
// side. The PlayerScreenServer listens on the LAN without authentication, so
// any client can broadcast arbitrary payloads. Before assigning such a URL
// to a DOM sink (<img src>, <video src>, anchor href, window.open, …) it MUST
// pass through this helper.
//
// Rules:
//   - relative /vault/... paths (served by our own HTTP listener) are accepted
//   - data:image/... and data:video/... URLs are accepted ONLY for an
//     allowlisted MIME family (no SVG, no text/*, nothing exotic)
//   - everything else (javascript:, data:text/html, http(s)://, …) is rejected
//
// Implementation uses the URL constructor as a scheme barrier so CodeQL's
// js/xss and js/client-side-unvalidated-url-redirection queries recognise
// the sanitiser.

const ALLOWED_IMAGE_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
  "image/bmp",
]);

const ALLOWED_VIDEO_MIME = new Set([
  "video/mp4",
  "video/webm",
  "video/ogg",
  "video/quicktime",
]);

export function safePlayerUrl(url: unknown, kind: "image" | "video"): string | null {
  if (typeof url !== "string" || url.length === 0) return null;

  // Relative vault paths served by our own PlayerScreenServer.
  if (url.startsWith("/vault/")) return url;

  // Parse the URL so we can branch on the scheme via the WHATWG URL API.
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "data:") return null;

  // For data URLs the pathname holds "mime/type;params,data" or
  // "mime/type,data". Pull out the MIME and match against the allowlist.
  const path = parsed.pathname;
  const semi = path.indexOf(";");
  const comma = path.indexOf(",");
  const cut = semi >= 0 && (comma < 0 || semi < comma) ? semi : comma;
  if (cut <= 0) return null;
  const mime = path.slice(0, cut).toLowerCase();

  const allowed = kind === "image" ? ALLOWED_IMAGE_MIME : ALLOWED_VIDEO_MIME;
  if (!allowed.has(mime)) return null;

  // Return parsed.href (the canonicalised form) so consumers receive a value
  // that originates from URL parsing rather than the raw input string.
  return parsed.href;
}
