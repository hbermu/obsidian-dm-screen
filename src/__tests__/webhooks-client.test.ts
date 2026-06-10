import { afterEach, describe, expect, it, vi } from "vitest";
import * as obsidian from "obsidian";
import { sendWebhookImage } from "../webhooks/client";
import type { WebhookConfig } from "../webhooks/types";

interface CapturedCall {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string | ArrayBuffer;
}

function mockRequestUrl(
  handler: (call: CapturedCall) => { status?: number; text?: string },
) {
  return vi
    .spyOn(obsidian, "requestUrl")
    .mockImplementation(((param: unknown) => {
      const p =
        typeof param === "string" ? { url: param } : (param as CapturedCall);
      const out = handler({
        url: p.url,
        method: p.method,
        headers: p.headers,
        body: p.body,
      });
      return Promise.resolve({
        status: out.status ?? 200,
        json: {},
        text: out.text ?? "",
        arrayBuffer: new ArrayBuffer(0),
        headers: {},
      });
    }) as unknown as typeof obsidian.requestUrl);
}

const tinyJpeg = "data:image/jpeg;base64," + btoa("FAKEBYTES");

const baseWebhook: WebhookConfig = {
  id: "wh1",
  name: "Telegram",
  url: "https://api.telegram.test/botX/sendPhoto",
  imageField: "photo",
  captionField: "caption",
  extraFields: [{ key: "chat_id", value: "-100" }],
};

afterEach(() => vi.restoreAllMocks());

describe("sendWebhookImage", () => {
  it("POSTs multipart/form-data with extras, caption, and the image binary", async () => {
    let captured: CapturedCall | undefined;
    mockRequestUrl((call) => {
      captured = call;
      return { status: 200 };
    });
    await sendWebhookImage(baseWebhook, tinyJpeg, "Hello map");
    expect(captured?.url).toBe(baseWebhook.url);
    expect(captured?.method).toBe("POST");
    expect(captured?.headers?.["Content-Type"]).toMatch(
      /^multipart\/form-data; boundary=----DmScreenBoundary/,
    );
    const body = captured?.body as ArrayBuffer;
    expect(body).toBeInstanceOf(ArrayBuffer);
    const text = new TextDecoder("latin1").decode(new Uint8Array(body));
    expect(text).toContain('name="chat_id"');
    expect(text).toContain("-100");
    expect(text).toContain('name="caption"');
    expect(text).toContain("Hello map");
    expect(text).toMatch(
      /name="photo"; filename="image\.jpg"\r\nContent-Type: image\/jpeg/,
    );
  });

  it("throws on non-2xx with the webhook name and detail", async () => {
    mockRequestUrl(() => ({ status: 400, text: "Bad request" }));
    await expect(
      sendWebhookImage(baseWebhook, tinyJpeg, "x"),
    ).rejects.toThrow(/Telegram.*400.*Bad request/);
  });

  it("skips extras with empty key", async () => {
    let captured: CapturedCall | undefined;
    mockRequestUrl((call) => {
      captured = call;
      return { status: 200 };
    });
    await sendWebhookImage(
      {
        ...baseWebhook,
        extraFields: [
          { key: "", value: "ignored" },
          { key: "kept", value: "v" },
        ],
      },
      tinyJpeg,
      "c",
    );
    const text = new TextDecoder("latin1").decode(
      new Uint8Array(captured!.body as ArrayBuffer),
    );
    expect(text).not.toContain("ignored");
    expect(text).toContain('name="kept"');
  });

  it("omits the caption field when captionField is empty", async () => {
    let captured: CapturedCall | undefined;
    mockRequestUrl((call) => {
      captured = call;
      return { status: 200 };
    });
    await sendWebhookImage(
      { ...baseWebhook, captionField: "" },
      tinyJpeg,
      "x",
    );
    const text = new TextDecoder("latin1").decode(
      new Uint8Array(captured!.body as ArrayBuffer),
    );
    expect(text).not.toContain('name="caption"');
  });
});
