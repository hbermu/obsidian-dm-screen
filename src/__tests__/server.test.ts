import { describe, expect, it, vi } from "vitest";
import { TFile } from "obsidian";
import { readVaultBytes } from "../server";

function makeApp(overrides: {
  byPath?: (p: string) => unknown;
  readBinary?: (file: never) => Promise<ArrayBuffer>;
  adapterExists?: (p: string) => Promise<boolean>;
  adapterReadBinary?: (p: string) => Promise<ArrayBuffer>;
}) {
  return {
    vault: {
      getAbstractFileByPath: overrides.byPath ?? (() => null),
      readBinary: overrides.readBinary ?? (async () => new ArrayBuffer(0)),
      adapter: {
        exists: overrides.adapterExists,
        readBinary: overrides.adapterReadBinary,
      },
    },
  };
}

describe("readVaultBytes", () => {
  it("uses vault.readBinary when the path is indexed as a TFile", async () => {
    const tfile = new TFile();
    const buf = new TextEncoder().encode("INDEXED").buffer;
    const readBinary = vi.fn(async () => buf);
    const adapterReadBinary = vi.fn(async () => new TextEncoder().encode("ADAPTER").buffer);
    const app = makeApp({
      byPath: () => tfile,
      readBinary,
      adapterExists: async () => true,
      adapterReadBinary,
    });
    const out = await readVaultBytes(app, "Notes/foo.png");
    expect(new TextDecoder().decode(out!)).toBe("INDEXED");
    expect(readBinary).toHaveBeenCalledTimes(1);
    expect(adapterReadBinary).not.toHaveBeenCalled();
  });

  it("falls back to vault.adapter.readBinary when the path is not in the index (dotfolder case)", async () => {
    const buf = new TextEncoder().encode("FROM-DISK").buffer;
    const adapterReadBinary = vi.fn(async () => buf);
    const adapterExists = vi.fn(async () => true);
    const app = makeApp({
      byPath: () => null,
      adapterExists,
      adapterReadBinary,
    });
    const out = await readVaultBytes(app, ".hydrus-cache/abc.png");
    expect(new TextDecoder().decode(out!)).toBe("FROM-DISK");
    expect(adapterExists).toHaveBeenCalledWith(".hydrus-cache/abc.png");
    expect(adapterReadBinary).toHaveBeenCalledWith(".hydrus-cache/abc.png");
  });

  it("returns null when neither the index nor the adapter can find the path", async () => {
    const app = makeApp({
      byPath: () => null,
      adapterExists: async () => false,
      adapterReadBinary: async () => new ArrayBuffer(0),
    });
    expect(await readVaultBytes(app, "missing.png")).toBeNull();
  });

  it("returns null when the index hit is not a TFile (e.g. TFolder)", async () => {
    const app = makeApp({
      byPath: () => ({ /* TFolder-like, not a TFile */ }),
      adapterExists: async () => false,
      adapterReadBinary: async () => new ArrayBuffer(0),
    });
    expect(await readVaultBytes(app, "some/folder")).toBeNull();
  });
});
