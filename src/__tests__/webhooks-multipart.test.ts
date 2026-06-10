import { describe, expect, it } from "vitest";
import {
  buildMultipart,
  dataUrlToBytes,
  generateBoundary,
} from "../webhooks/multipart";

describe("dataUrlToBytes", () => {
  it("parses an image/jpeg data URL and decodes the base64 payload", () => {
    const r = dataUrlToBytes("data:image/jpeg;base64," + btoa("HELLO"));
    expect(r.mime).toBe("image/jpeg");
    expect(r.ext).toBe("jpg");
    expect(new TextDecoder().decode(r.bytes)).toBe("HELLO");
  });

  it("infers png ext from image/png", () => {
    expect(dataUrlToBytes("data:image/png;base64," + btoa("X")).ext).toBe("png");
  });

  it("falls back to bin for an unknown image subtype", () => {
    expect(dataUrlToBytes("data:image/tiff;base64," + btoa("X")).ext).toBe("bin");
  });

  it("rejects non-image data URLs", () => {
    expect(() => dataUrlToBytes("data:text/plain;base64," + btoa("X"))).toThrow(
      /Unsupported/,
    );
    expect(() =>
      dataUrlToBytes("data:application/json;base64," + btoa("X")),
    ).toThrow(/Unsupported/);
    expect(() => dataUrlToBytes("https://example.com/img.png")).toThrow(
      /Unsupported/,
    );
  });
});

describe("buildMultipart", () => {
  const FIXED_BOUNDARY = "----TESTBOUNDARY";

  it("emits text fields first, then the file part, then the closing boundary", () => {
    const bytes = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
    const result = buildMultipart(
      [
        { name: "chat_id", value: "-100123" },
        { name: "caption", value: "Mapa de la cripta" },
      ],
      { name: "photo", filename: "image.jpg", mime: "image/jpeg", bytes },
      FIXED_BOUNDARY,
    );
    expect(result.contentType).toBe(
      "multipart/form-data; boundary=----TESTBOUNDARY",
    );
    const text = new TextDecoder("latin1").decode(new Uint8Array(result.body));

    const chatIdIdx = text.indexOf('name="chat_id"');
    const captionIdx = text.indexOf('name="caption"');
    const photoIdx = text.indexOf('name="photo"');
    expect(chatIdIdx).toBeGreaterThan(-1);
    expect(captionIdx).toBeGreaterThan(chatIdIdx);
    expect(photoIdx).toBeGreaterThan(captionIdx);

    expect(text).toMatch(
      /Content-Disposition: form-data; name="photo"; filename="image\.jpg"\r\nContent-Type: image\/jpeg/,
    );
    expect(text.endsWith("\r\n------TESTBOUNDARY--\r\n")).toBe(true);

    expect(text).toContain("\xde\xad\xbe\xef");
  });

  it("handles a single text field without an extras list", () => {
    const r = buildMultipart(
      [{ name: "content", value: "hi" }],
      {
        name: "files[0]",
        filename: "a.png",
        mime: "image/png",
        bytes: new Uint8Array([1, 2, 3]),
      },
      FIXED_BOUNDARY,
    );
    const text = new TextDecoder("latin1").decode(new Uint8Array(r.body));
    expect(text).toContain('name="content"');
    expect(text).toContain('name="files[0]"; filename="a.png"');
  });

  it("uses a generated boundary when none is given", () => {
    const r = buildMultipart(
      [{ name: "x", value: "y" }],
      {
        name: "f",
        filename: "a.png",
        mime: "image/png",
        bytes: new Uint8Array([0]),
      },
    );
    expect(r.contentType).toMatch(
      /^multipart\/form-data; boundary=----DmScreenBoundary[0-9a-f]+$/,
    );
  });

  it("generateBoundary returns the expected shape", () => {
    expect(generateBoundary()).toMatch(/^----DmScreenBoundary[0-9a-f]+$/);
  });
});
