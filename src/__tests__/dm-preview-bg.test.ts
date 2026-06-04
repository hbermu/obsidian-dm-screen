import { describe, expect, it, vi } from "vitest";
import {
  isVideoBackgroundUrl,
  resolveBackgroundPreviewUrl,
} from "../views/DmControlPanel";

describe("resolveBackgroundPreviewUrl", () => {
  it("returns null when activeUrl is null", () => {
    expect(resolveBackgroundPreviewUrl(null, { getResourcePath: () => "x" })).toBeNull();
  });

  it("returns the URL unchanged when it does not start with /vault/", () => {
    const adapter = { getResourcePath: vi.fn(() => "x") };
    expect(resolveBackgroundPreviewUrl("https://cdn.example/foo.png", adapter)).toBe(
      "https://cdn.example/foo.png"
    );
    expect(adapter.getResourcePath).not.toHaveBeenCalled();
  });

  it("decodes the /vault/ prefix and delegates to adapter.getResourcePath", () => {
    const adapter = { getResourcePath: vi.fn((p: string) => `app://resource/${p}`) };
    const out = resolveBackgroundPreviewUrl("/vault/foo%20bar.png", adapter);
    expect(adapter.getResourcePath).toHaveBeenCalledWith("foo bar.png");
    expect(out).toBe("app://resource/foo bar.png");
  });

  it("handles dotfolder Hydrus cache paths", () => {
    const adapter = { getResourcePath: vi.fn((p: string) => `app://res/${p}`) };
    const out = resolveBackgroundPreviewUrl("/vault/.dm-screen/hydrus/abc.webm", adapter);
    expect(adapter.getResourcePath).toHaveBeenCalledWith(".dm-screen/hydrus/abc.webm");
    expect(out).toBe("app://res/.dm-screen/hydrus/abc.webm");
  });

  it("returns null when adapter has no getResourcePath implementation", () => {
    expect(resolveBackgroundPreviewUrl("/vault/foo.png", {})).toBeNull();
  });
});

describe("isVideoBackgroundUrl", () => {
  it("recognises common video extensions", () => {
    expect(isVideoBackgroundUrl("foo.mp4")).toBe(true);
    expect(isVideoBackgroundUrl("foo.webm")).toBe(true);
    expect(isVideoBackgroundUrl("foo.mov")).toBe(true);
    expect(isVideoBackgroundUrl("foo.ogv")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isVideoBackgroundUrl("FOO.MP4")).toBe(true);
    expect(isVideoBackgroundUrl("foo.WebM")).toBe(true);
  });

  it("tolerates a trailing query string", () => {
    expect(isVideoBackgroundUrl("app://res/foo.mp4?t=123")).toBe(true);
  });

  it("returns false for image extensions and unrelated suffixes", () => {
    expect(isVideoBackgroundUrl("foo.png")).toBe(false);
    expect(isVideoBackgroundUrl("foo.jpg")).toBe(false);
    expect(isVideoBackgroundUrl("foo.webp")).toBe(false);
    expect(isVideoBackgroundUrl("foo.gif")).toBe(false);
    expect(isVideoBackgroundUrl("foo.mp4.txt")).toBe(false);
  });
});
