import { describe, expect, it } from "vitest";
import { TFile } from "obsidian";
import { readVaultBytes } from "../server";

function makeApp(opts: {
  byPath?: (p: string) => unknown;
  adapterExists?: (p: string) => Promise<boolean>;
  adapterReadBinary?: (p: string) => Promise<ArrayBuffer>;
} = {}) {
  return {
    vault: {
      getAbstractFileByPath: opts.byPath ?? (() => null),
      readBinary: async () => new ArrayBuffer(0),
      adapter: {
        exists: opts.adapterExists ?? (async () => false),
        readBinary: opts.adapterReadBinary ?? (async () => new ArrayBuffer(0)),
      },
    },
  };
}

describe("readVaultBytes - path handling", () => {
  it("reads a normal vault-relative path", async () => {
    const buf = new TextEncoder().encode("content").buffer;
    const app = makeApp({
      byPath: () => new TFile(),
    });
    app.vault.readBinary = async () => buf;
    const result = await readVaultBytes(app, "assets/image.png");
    expect(result).not.toBeNull();
    expect(new TextDecoder().decode(result!)).toBe("content");
  });

  it("returns null when adapter.exists returns false", async () => {
    const app = makeApp({ adapterExists: async () => false });
    expect(await readVaultBytes(app, ".dm-screen/hydrus/missing.png")).toBeNull();
  });

  it("handles paths with spaces", async () => {
    const buf = new TextEncoder().encode("spaced").buffer;
    const app = makeApp({
      adapterExists: async (p) => p === "My Folder/my file.png",
      adapterReadBinary: async () => buf,
    });
    const result = await readVaultBytes(app, "My Folder/my file.png");
    expect(new TextDecoder().decode(result!)).toBe("spaced");
  });

  it("handles deep nested paths", async () => {
    const buf = new TextEncoder().encode("deep").buffer;
    const app = makeApp({
      adapterExists: async () => true,
      adapterReadBinary: async () => buf,
    });
    const result = await readVaultBytes(app, ".dm-screen/hydrus/ab/cd/ef.png");
    expect(new TextDecoder().decode(result!)).toBe("deep");
  });

  it("returns null when adapter methods are missing", async () => {
    const app = {
      vault: {
        getAbstractFileByPath: () => null,
        readBinary: async () => new ArrayBuffer(0),
        adapter: {},
      },
    };
    expect(await readVaultBytes(app, "test.png")).toBeNull();
  });
});
