import { browser, expect } from "@wdio/globals";
import { openPanel, startServer, panelButton, DEFAULT_PORT } from "../helpers/obsidian";
import { WsRecorder } from "../helpers/ws";

interface LayerSnap {
  id: string;
  label: string;
  zIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  visible: boolean;
  bordered: boolean;
}

// Row order on the DM panel is zIndex descending, so snapshot()[0] is the row
// at index 0 — the topmost layer. Every assertion targets a layer by id so it
// survives the re-sort a z-order swap triggers.
async function snapshot(): Promise<LayerSnap[]> {
  return browser.executeObsidian(({ app }) => {
    const panel = (app as any).workspace.getLeavesOfType("dm-control-panel")[0].view;
    return [...panel.imageLayers]
      .sort((a: any, b: any) => b.zIndex - a.zIndex)
      .map((l: any) => ({
        id: l.id,
        label: l.label,
        zIndex: l.zIndex,
        x: l.x,
        y: l.y,
        width: l.width,
        height: l.height,
        rotation: l.rotation,
        visible: l.visible,
        bordered: l.bordered,
      }));
  });
}

describe("image-layer controls on the DM panel", function () {
  let rec: WsRecorder;

  // Seed via the real addImageLayer (the method the picker calls): it loads the
  // image off-screen, sizes it, pushes, and broadcasts — so the seeded state is
  // exactly what a genuine Add Image produces, just with labels we control.
  async function seedLayers(labels: string[]): Promise<void> {
    const before = rec.count("image-layers-sync");
    await browser.executeObsidian(async ({ app }, ls: string[]) => {
      const plugin = (app as any).plugins.plugins["dm-screen"];
      const panel = (app as any).workspace.getLeavesOfType("dm-control-panel")[0].view;
      panel.imageLayers = [];
      panel.nextZIndex = 1;
      const dataUrl = await plugin.imageToDataUrl("attachments/map.png");
      for (const label of ls) panel.addImageLayer(label, dataUrl, undefined, true);
    }, labels);
    await rec.waitFor("image-layers-sync", {
      skip: before,
      where: (m) => (m.payload.layers as unknown[]).length === labels.length,
    });
    await browser.waitUntil(
      async () => (await browser.$(".dm-control-panel").$$(".dm-layer-row").length) === labels.length,
    );
  }

  // Click a button inside the layer row at `index`. A leading "." selects by
  // class (the icon buttons carry no text); anything else matches button text
  // (the rotate / z-order glyphs). Programmatic .click() mirrors fog-tools —
  // WDIO's pointer misfires onto the panel chrome for these small controls.
  async function clickInRow(index: number, sel: string): Promise<void> {
    await browser.executeObsidian((_app, a: { index: number; sel: string }) => {
      const rows = Array.from(document.querySelectorAll(".dm-control-panel .dm-layer-row"));
      const row = rows[a.index];
      const btn = a.sel.startsWith(".")
        ? (row.querySelector(a.sel) as HTMLElement)
        : (Array.from(row.querySelectorAll("button")).find((b) => b.textContent === a.sel) as HTMLElement);
      btn.click();
    }, { index, sel });
  }

  async function setScale(index: number, value: number): Promise<void> {
    await browser.executeObsidian((_app, a: { index: number; value: number }) => {
      const rows = Array.from(document.querySelectorAll(".dm-control-panel .dm-layer-row"));
      const slider = rows[a.index].querySelector(".dm-layer-scale-slider") as HTMLInputElement;
      slider.value = String(a.value);
      slider.dispatchEvent(new Event("input"));
      slider.dispatchEvent(new Event("change"));
    }, { index, value });
  }

  before(async function () {
    await openPanel();
    await startServer();
    rec = await WsRecorder.connect(DEFAULT_PORT, "player");
  });

  after(function () {
    rec.close();
  });

  beforeEach(async function () {
    await seedLayers(["Alpha", "Beta"]);
  });

  it("the visibility button hides the layer and broadcasts", async function () {
    const [top] = await snapshot();
    const before = rec.count("image-layers-sync");
    await clickInRow(0, ".dm-layer-vis-toggle");
    const sync = await rec.waitFor("image-layers-sync", {
      skip: before,
      where: (m) => (m.payload.layers as any[]).some((l) => l.id === top.id && l.visible === false),
    });
    expect((sync.payload.layers as any[]).find((l) => l.id === top.id).visible).toBe(false);
    await expect(browser.$(".dm-control-panel").$(".dm-layer-row.dm-layer-hidden")).toExist();
  });

  it("the border button removes the gold border and broadcasts", async function () {
    const [top] = await snapshot();
    const before = rec.count("image-layers-sync");
    await clickInRow(0, ".dm-border-toggle");
    const sync = await rec.waitFor("image-layers-sync", {
      skip: before,
      where: (m) => (m.payload.layers as any[]).some((l) => l.id === top.id && l.bordered === false),
    });
    expect((sync.payload.layers as any[]).find((l) => l.id === top.id).bordered).toBe(false);
  });

  it("the rotate-right button advances rotation by 15° and broadcasts", async function () {
    const [top] = await snapshot();
    const before = rec.count("image-layers-sync");
    await clickInRow(0, "↻");
    const sync = await rec.waitFor("image-layers-sync", {
      skip: before,
      where: (m) => (m.payload.layers as any[]).some((l) => l.id === top.id && l.rotation === 15),
    });
    expect((sync.payload.layers as any[]).find((l) => l.id === top.id).rotation).toBe(15);
  });

  it("the down button swaps z-order with the layer below", async function () {
    const [top, below] = await snapshot();
    expect(top.zIndex).toBeGreaterThan(below.zIndex);
    const before = rec.count("image-layers-sync");
    await clickInRow(0, "▼");
    await rec.waitFor("image-layers-sync", {
      skip: before,
      where: (m) => {
        const t = (m.payload.layers as any[]).find((l) => l.id === top.id);
        const b = (m.payload.layers as any[]).find((l) => l.id === below.id);
        return !!t && !!b && t.zIndex < b.zIndex;
      },
    });
    const after = await snapshot();
    expect(after[0].id).toBe(below.id);
  });

  it("the scale slider streams geometry then commits a resized layer", async function () {
    const [top] = await snapshot();
    const geoBefore = rec.count("image-layers-geometry");
    const syncBefore = rec.count("image-layers-sync");
    await setScale(0, 40);
    await rec.waitFor("image-layers-geometry", {
      skip: geoBefore,
      where: (m) => (m.payload.layers as any[]).some((l) => l.id === top.id && Math.round(l.width) === 40),
    });
    const sync = await rec.waitFor("image-layers-sync", {
      skip: syncBefore,
      where: (m) => (m.payload.layers as any[]).some((l) => l.id === top.id && Math.round(l.width) === 40),
    });
    const l = (sync.payload.layers as any[]).find((x) => x.id === top.id);
    expect(Math.round(l.width)).toBe(40);
    const aspect = top.height / top.width;
    expect(Math.abs(l.height - 40 * aspect)).toBeLessThan(0.5);
    expect(Math.abs(l.x + l.width / 2 - (top.x + top.width / 2))).toBeLessThan(0.5);
    expect(Math.abs(l.y + l.height / 2 - (top.y + top.height / 2))).toBeLessThan(0.5);
  });

  it("the remove button deletes the layer and broadcasts", async function () {
    const [top] = await snapshot();
    const before = rec.count("image-layers-sync");
    await clickInRow(0, ".dm-layer-remove");
    await rec.waitFor("image-layers-sync", {
      skip: before,
      where: (m) => {
        const ls = m.payload.layers as any[];
        return ls.length === 1 && !ls.some((l) => l.id === top.id);
      },
    });
    await browser.waitUntil(
      async () => (await browser.$(".dm-control-panel").$$(".dm-layer-row").length) === 1,
    );
  });
});

describe("multi-image note picker", function () {
  let rec: WsRecorder;

  // A note with two images from two sources — a frontmatter `image:` and a body
  // embed — so the picker collects two entries with distinct labels and opens
  // the Obsidian Menu (a single actionable entry would apply directly). Built in
  // the per-session sandbox vault; the committed fixtures stay untouched.
  before(async function () {
    await openPanel();
    await startServer();
    rec = await WsRecorder.connect(DEFAULT_PORT, "player");

    await browser.executeObsidian(async ({ app }) => {
      const adapter = (app as any).vault.adapter;
      const bytes = await adapter.readBinary("attachments/map.png");
      if (!(await adapter.exists("attachments/map2.png"))) await adapter.writeBinary("attachments/map2.png", bytes);
      if (!app.vault.getAbstractFileByPath("Multi.md")) {
        await app.vault.create("Multi.md", "---\nimage: map.png\n---\n# Multi\n\n![[map2.png]]\n");
      }
    });
    await browser.waitUntil(() =>
      browser.executeObsidian(({ app }) => {
        const f = app.vault.getAbstractFileByPath("Multi.md");
        if (!f) return false;
        const c = app.metadataCache.getFileCache(f as never);
        return (c?.embeds?.length ?? 0) >= 1 && !!(c?.frontmatter as any)?.image;
      }),
    );
    await browser.executeObsidian(async ({ app }) => {
      const f = app.vault.getAbstractFileByPath("Multi.md");
      await app.workspace.getLeaf(false).openFile(f as never);
    });
    await browser.waitUntil(() =>
      browser.executeObsidian(({ app }) => app.workspace.getActiveFile()?.path === "Multi.md"),
    );
  });

  after(function () {
    rec.close();
  });

  it("Add Image opens a menu and Add all commits every image", async function () {
    await browser.executeObsidian(({ app }) => {
      const panel = (app as any).workspace.getLeavesOfType("dm-control-panel")[0].view;
      panel.imageLayers = [];
      panel.nextZIndex = 1;
    });
    const before = rec.count("image-layers-sync");

    await (await panelButton("Add Image")).click();
    await browser.$(".menu").waitForExist();
    const items = await browser.$$(".menu .menu-item");
    expect(items.length).toBeGreaterThanOrEqual(2);

    await browser.executeObsidian(() => {
      const item = Array.from(document.querySelectorAll(".menu .menu-item")).find(
        (el) => (el.textContent ?? "").includes("Add all"),
      ) as HTMLElement;
      item.click();
    });

    const sync = await rec.waitFor("image-layers-sync", {
      skip: before,
      where: (m) => (m.payload.layers as unknown[]).length === 2,
    });
    const labels = (sync.payload.layers as any[]).map((l) => l.label).sort();
    expect(labels).toEqual(["Multi (embed)", "Multi (image)"]);
  });
});

describe("image-layer persistence across a panel reopen", function () {
  let rec: WsRecorder;

  before(async function () {
    await openPanel();
    await startServer();
    rec = await WsRecorder.connect(DEFAULT_PORT, "player");
  });

  after(function () {
    rec.close();
  });

  it("reopening the panel restores the layers and republishes a fresh sync", async function () {
    const before0 = rec.count("image-layers-sync");
    await browser.executeObsidian(async ({ app }) => {
      const plugin = (app as any).plugins.plugins["dm-screen"];
      const panel = (app as any).workspace.getLeavesOfType("dm-control-panel")[0].view;
      panel.imageLayers = [];
      panel.nextZIndex = 1;
      const dataUrl = await plugin.imageToDataUrl("attachments/map.png");
      panel.addImageLayer("Keep A", dataUrl, undefined, true);
      panel.addImageLayer("Keep B", dataUrl, undefined, true);
    });
    await rec.waitFor("image-layers-sync", {
      skip: before0,
      where: (m) => (m.payload.layers as unknown[]).length === 2,
    });
    const ids = (await snapshot()).map((l) => l.id).sort();

    // Detaching the leaf runs onClose -> saveState; reopening runs onOpen ->
    // restoreState (+ republishToServer). No Electron reboot needed: the seam
    // under test is the panel lifecycle, and settings persist in memory.
    await browser.executeObsidian(({ app }) => {
      (app as any).workspace.getLeavesOfType("dm-control-panel").forEach((l: any) => l.detach());
    });
    await browser.$(".dm-control-panel").waitForExist({ reverse: true });

    const before = rec.count("image-layers-sync");
    await openPanel();
    await browser.waitUntil(
      async () => (await browser.$(".dm-control-panel").$$(".dm-layer-row").length) === 2,
    );
    const sync = await rec.waitFor("image-layers-sync", {
      skip: before,
      where: (m) => (m.payload.layers as unknown[]).length === 2,
    });
    const restoredIds = (sync.payload.layers as any[]).map((l) => l.id).sort();
    expect(restoredIds).toEqual(ids);
  });
});
