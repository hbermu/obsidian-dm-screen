import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import * as vm from "vm";
import { describe, expect, it } from "vitest";

const bundlePath = resolve(__dirname, "../../main.js");

const describeIfBundleExists = existsSync(bundlePath) ? describe : describe.skip;

describeIfBundleExists("main.js bundle smoke test", () => {
  it("loads under a CJS shim and exposes a Plugin-shaped default export", () => {
    const code = readFileSync(bundlePath, "utf8");

    const obsidianStub = {
      Plugin: class { addCommand() {} addRibbonIcon() {} registerView() {} addSettingTab() {} loadData() { return Promise.resolve({}); } saveData() { return Promise.resolve(); } registerEvent() {} register() {} },
      ItemView: class {},
      WorkspaceLeaf: class {},
      Modal: class {},
      Notice: class { constructor(_m: string, _t?: number) {} },
      PluginSettingTab: class {},
      Setting: class { constructor(_el: HTMLElement) {} },
      TFile: class {},
      TFolder: class {},
      App: class {},
      Platform: { isDesktop: true, isMobile: false },
      requestUrl: async () => ({ status: 200, json: {}, text: "", arrayBuffer: new ArrayBuffer(0), headers: {} }),
      addIcon: () => undefined,
      MarkdownRenderer: { renderMarkdown: async () => undefined, render: async () => undefined },
      debounce: <T extends (...a: any[]) => any>(fn: T) => fn,
      moment: () => ({ format: () => "" }),
    };

    const shimRequire = (id: string) => {
      if (id === "obsidian") return obsidianStub;
      // Native modules used by the server (http, ws). Return minimal stubs;
      // we don't invoke onload, just require the module body to evaluate.
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
      return require(id);
    };

    const moduleObj: { exports: Record<string, unknown> } = { exports: {} };
    const sandbox = {
      module: moduleObj,
      exports: moduleObj.exports,
      require: shimRequire,
      console,
      process,
      Buffer,
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
      URL,
    };

    vm.runInNewContext(code, sandbox, { filename: bundlePath });

    const exported = moduleObj.exports as { default?: unknown };
    const PluginClass = exported.default ?? (moduleObj.exports as any);

    expect(typeof PluginClass).toBe("function");

    const proto = (PluginClass as { prototype: Record<string, unknown> }).prototype;
    expect(typeof proto.onload).toBe("function");
    expect(typeof proto.onunload).toBe("function");
  });
});
