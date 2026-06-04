import { describe, expect, it } from "vitest";
import { safePlayerUrl } from "../player/safeUrl";

describe("safePlayerUrl", () => {
  describe("accepted forms", () => {
    it("accepts a relative /vault/ path", () => {
      expect(safePlayerUrl("/vault/foo.png", "image")).toBe("/vault/foo.png");
      expect(safePlayerUrl("/vault/sub/dir/bar.mp4", "video")).toBe("/vault/sub/dir/bar.mp4");
    });

    it("accepts data:image/* of allowlisted MIME types for kind=image", () => {
      for (const mime of ["png", "jpeg", "jpg", "webp", "gif", "bmp"]) {
        const url = `data:image/${mime};base64,iVBORw0KGgo`;
        expect(safePlayerUrl(url, "image")).toBe(url);
      }
    });

    it("accepts data:video/* of allowlisted MIME types for kind=video", () => {
      for (const mime of ["mp4", "webm", "ogg", "quicktime"]) {
        const url = `data:video/${mime};base64,AAAA`;
        expect(safePlayerUrl(url, "video")).toBe(url);
      }
    });

    it("accepts case-insensitive scheme + mime", () => {
      const url = "DATA:IMAGE/PNG;base64,XX";
      expect(safePlayerUrl(url, "image")).toBe(url);
    });
  });

  describe("rejected forms", () => {
    it("rejects javascript: URLs", () => {
      expect(safePlayerUrl("javascript:alert(1)", "image")).toBeNull();
      expect(safePlayerUrl("JAVASCRIPT:alert(1)", "video")).toBeNull();
    });

    it("rejects data:text/html URLs", () => {
      expect(safePlayerUrl("data:text/html,<script>alert(1)</script>", "image")).toBeNull();
      expect(safePlayerUrl("data:text/html,<h1>x</h1>", "video")).toBeNull();
    });

    it("rejects data:image/svg+xml (can carry <script>)", () => {
      expect(safePlayerUrl("data:image/svg+xml;base64,PHN2Zy8+", "image")).toBeNull();
      expect(safePlayerUrl("data:image/svg+xml;utf8,<svg/>", "image")).toBeNull();
    });

    it("rejects absolute http(s) URLs", () => {
      expect(safePlayerUrl("http://attacker.example/x.png", "image")).toBeNull();
      expect(safePlayerUrl("https://attacker.example/x.mp4", "video")).toBeNull();
    });

    it("rejects file: and other exotic schemes", () => {
      expect(safePlayerUrl("file:///etc/passwd", "image")).toBeNull();
      expect(safePlayerUrl("vbscript:msgbox(1)", "image")).toBeNull();
      expect(safePlayerUrl("blob:https://x/y", "video")).toBeNull();
    });

    it("rejects empty, null, undefined, non-string", () => {
      expect(safePlayerUrl("", "image")).toBeNull();
      expect(safePlayerUrl(null, "image")).toBeNull();
      expect(safePlayerUrl(undefined, "image")).toBeNull();
      expect(safePlayerUrl(42, "image")).toBeNull();
      expect(safePlayerUrl({}, "image")).toBeNull();
    });

    it("rejects relative paths that are not /vault/", () => {
      expect(safePlayerUrl("/vault", "image")).toBeNull();
      expect(safePlayerUrl("/etc/passwd", "image")).toBeNull();
      expect(safePlayerUrl("./vault/foo", "image")).toBeNull();
      expect(safePlayerUrl("vault/foo.png", "image")).toBeNull();
    });

    it("rejects video data URLs when kind=image (and vice versa)", () => {
      expect(safePlayerUrl("data:video/mp4;base64,AAAA", "image")).toBeNull();
      expect(safePlayerUrl("data:image/png;base64,AA", "video")).toBeNull();
    });

    it("rejects data:image/* with no parameters (no ; separator)", () => {
      // Our prefix list requires the ; so unparameterised data URLs are out.
      expect(safePlayerUrl("data:image/png,abcd", "image")).toBeNull();
    });
  });
});
