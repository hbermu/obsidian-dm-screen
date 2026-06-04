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

const ALLOWED_IMAGE_PREFIXES = [
  "data:image/png;",
  "data:image/jpeg;",
  "data:image/jpg;",
  "data:image/webp;",
  "data:image/gif;",
  "data:image/bmp;",
];

const ALLOWED_VIDEO_PREFIXES = [
  "data:video/mp4;",
  "data:video/webm;",
  "data:video/ogg;",
  "data:video/quicktime;",
];

export function safePlayerUrl(url: unknown, kind: "image" | "video"): string | null {
  if (typeof url !== "string" || url.length === 0) return null;
  if (url.startsWith("/vault/")) return url;

  const lower = url.toLowerCase();
  const allowed = kind === "image" ? ALLOWED_IMAGE_PREFIXES : ALLOWED_VIDEO_PREFIXES;
  if (allowed.some((prefix) => lower.startsWith(prefix))) return url;
  return null;
}
