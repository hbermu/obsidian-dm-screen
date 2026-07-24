import * as http from "node:http";
import { browser, expect } from "@wdio/globals";
import { openPanel, openFixtureNote, startServer, panelButton } from "../helpers/obsidian";

interface CapturedRequest {
  headers: http.IncomingHttpHeaders;
  body: Buffer;
}

describe("send layer to a webhook", function () {
  let receiver: http.Server;
  let captured: Promise<CapturedRequest>;
  const RECEIVER_PORT = 3999;

  before(async function () {
    captured = new Promise((resolve) => {
      receiver = http.createServer((req, res) => {
        const chunks: Buffer[] = [];
        req.on("data", (c: Buffer) => chunks.push(c));
        req.on("end", () => {
          res.writeHead(200, { "content-type": "application/json" });
          res.end("{}");
          resolve({ headers: req.headers, body: Buffer.concat(chunks) });
        });
      });
    });
    await new Promise<void>((r) => receiver.listen(RECEIVER_PORT, "127.0.0.1", r));

    await openPanel();
    await openFixtureNote();
    await startServer();

    await browser.executeObsidian(async ({ app }, url: string) => {
      const plugin = (app as any).plugins.plugins["dm-screen"];
      plugin.settings.webhooks = [
        {
          id: "e2e-target",
          name: "E2E receiver",
          url,
          imageField: "file",
          captionField: "caption",
          extraFields: [{ key: "token", value: "e2e-secret" }],
        },
      ];
      await plugin.saveSettings();
    }, `http://127.0.0.1:${RECEIVER_PORT}/hook`);

    await (await panelButton("Add Image")).click();
    await browser.$(".dm-control-panel .dm-layer-row").waitForExist();
  });

  after(function () {
    receiver.close();
  });

  it("the layer context menu sends real multipart to the configured target", async function () {
    await browser.$(".dm-control-panel .dm-layer-row").click({ button: "right" });
    await browser.$(".menu").waitForExist();
    await browser.$(".menu-item-title=Send to image webhook…").click();

    const modal = browser.$(".dm-send-modal");
    await expect(modal).toExist();
    await modal.$("#dm-send-caption").setValue("e2e caption");
    await modal.$("button=Send").click();

    const req = await captured;
    expect(req.headers["content-type"]).toContain("multipart/form-data");
    const body = req.body.toString("latin1");
    expect(body).toContain('name="file"');
    expect(body).toContain("\x89PNG");
    expect(body).toContain('name="caption"');
    expect(body).toContain("e2e caption");
    expect(body).toContain('name="token"');
    expect(body).toContain("e2e-secret");

    await browser.waitUntil(async () => !(await browser.$(".dm-send-modal").isExisting()));
  });
});
