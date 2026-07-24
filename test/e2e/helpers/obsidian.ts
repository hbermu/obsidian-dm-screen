import { browser } from "@wdio/globals";

export const PLUGIN_ID = "dm-screen";
export const DEFAULT_PORT = 3000;

export async function openPanel(): Promise<void> {
  await browser.executeObsidianCommand(`${PLUGIN_ID}:open-dm-control-panel`);
  await browser.$(".dm-control-panel").waitForExist();
}

// Open Home.md in a main-area leaf so workspace.getActiveFile() resolves it
// when panel buttons are clicked, and wait for the metadataCache embed index —
// the pickers read embeds from the cache, which lags file open.
export async function openFixtureNote(): Promise<void> {
  await browser.executeObsidian(async ({ app }) => {
    const file = app.vault.getAbstractFileByPath("Home.md");
    await app.workspace.getLeaf(false).openFile(file as never);
  });
  await browser.waitUntil(() =>
    browser.executeObsidian(({ app }) => {
      const f = app.vault.getAbstractFileByPath("Home.md");
      const embeds = f ? app.metadataCache.getFileCache(f as never)?.embeds : undefined;
      return app.workspace.getActiveFile()?.path === "Home.md" && (embeds?.length ?? 0) > 0;
    }),
  );
}

export async function waitForHealth(port: number): Promise<{ status: string; clients: number }> {
  const deadline = Date.now() + 10_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      if (res.ok) return (await res.json()) as { status: string; clients: number };
    } catch (e) {
      lastError = e;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`server never became healthy on :${port} (${lastError})`);
}

// The executeObsidian bridge serializes args as JSON, so undefined arrives as
// null — pass null explicitly and gate on typeof to avoid clobbering the port.
export async function startServer(port?: number): Promise<number> {
  const actual = await browser.executeObsidian(async ({ app }, wanted: number | null) => {
    const plugin = (app as any).plugins.plugins["dm-screen"];
    if (typeof wanted === "number") {
      plugin.settings.serverPort = wanted;
      await plugin.saveSettings();
    }
    await plugin.startServer();
    return plugin.settings.serverPort as number;
  }, port ?? null);
  await waitForHealth(actual);
  return actual;
}

export function panelButton(text: string) {
  return browser.$(".dm-control-panel").$(`button=${text}`);
}

export async function addMap(): Promise<void> {
  await (await panelButton("Add Map")).click();
  await panelButton("Stop Map").waitForExist();
}
