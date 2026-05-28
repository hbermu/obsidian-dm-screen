import type { App } from "obsidian";
import type { HydrusClient, HydrusFile } from "./client";

export interface CachedEntry {
  hash: string;
  ext: string;
  mime: string;
  sizeBytes: number;
  width?: number;
  height?: number;
  downloadedAt: number;
  lastUsedAt: number;
  knownTags: string[];
  vaultPath: string;
  thumbVaultPath: string;
}

interface IndexFile {
  version: 1;
  entries: Record<string, CachedEntry>;
}

const INDEX_VERSION = 1;
const INDEX_NAME = "index.json";

// Abstraction so tests can swap in a Map without spinning up Obsidian.
export interface VaultAdapterLike {
  exists(path: string): Promise<boolean>;
  read(path: string): Promise<string>;
  write(path: string, data: string): Promise<void>;
  writeBinary(path: string, data: ArrayBuffer): Promise<void>;
  remove(path: string): Promise<void>;
  mkdir(path: string): Promise<void>;
}

export interface HydrusCacheOptions {
  folder: string;
  ttlDays: number;
  adapter?: VaultAdapterLike;
}

export class HydrusCache {
  private folder: string;
  private ttlMs: number;
  private adapter: VaultAdapterLike;
  private indexPromise: Promise<IndexFile> | null = null;
  // Serialise writes; the plugin is single-process but multiple async paths may
  // race (eg. fetchAndCache + markUsed firing nearly simultaneously).
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(app: App | null, opts: HydrusCacheOptions) {
    this.folder = opts.folder.replace(/^\/+|\/+$/g, "") || ".dm-screen/bg";
    this.ttlMs = Math.max(1, opts.ttlDays) * 24 * 60 * 60 * 1000;
    if (opts.adapter) {
      this.adapter = opts.adapter;
    } else if (app) {
      this.adapter = app.vault.adapter as unknown as VaultAdapterLike;
    } else {
      throw new Error("HydrusCache needs either an App or an explicit adapter");
    }
  }

  paths(hash: string, ext: string) {
    return {
      vaultPath: `${this.folder}/${hash}.${ext}`,
      thumbVaultPath: `${this.folder}/${hash}.thumb.jpg`,
    };
  }

  async listCached(): Promise<CachedEntry[]> {
    const index = await this.loadIndex();
    return Object.values(index.entries);
  }

  async get(hash: string): Promise<CachedEntry | undefined> {
    const index = await this.loadIndex();
    return index.entries[hash];
  }

  async fetchAndCache(
    client: HydrusClient,
    file: HydrusFile
  ): Promise<{ entry: CachedEntry; isFresh: boolean }> {
    const existing = await this.get(file.hash);
    if (existing && (await this.adapter.exists(existing.vaultPath))) {
      return { entry: existing, isFresh: false };
    }

    await this.ensureFolder();
    const { vaultPath, thumbVaultPath } = this.paths(file.hash, file.ext);

    const [bin, thumb] = await Promise.all([
      client.getFileBytes(file.hash),
      client.getThumbnailBytes(file.hash).catch(() => null),
    ]);
    await this.adapter.writeBinary(vaultPath, bin);
    if (thumb) {
      await this.adapter.writeBinary(thumbVaultPath, thumb);
    }

    const now = Date.now();
    const entry: CachedEntry = {
      hash: file.hash,
      ext: file.ext,
      mime: file.mime,
      sizeBytes: bin.byteLength,
      width: file.width,
      height: file.height,
      downloadedAt: now,
      lastUsedAt: 0,
      knownTags: file.knownTags,
      vaultPath,
      thumbVaultPath: thumb ? thumbVaultPath : "",
    };
    await this.mutateIndex((index) => {
      index.entries[file.hash] = entry;
    });
    return { entry, isFresh: true };
  }

  async markUsed(hash: string): Promise<void> {
    const now = Date.now();
    await this.mutateIndex((index) => {
      const entry = index.entries[hash];
      if (entry) entry.lastUsedAt = now;
    });
  }

  async evict(hash: string): Promise<void> {
    const index = await this.loadIndex();
    const entry = index.entries[hash];
    if (!entry) return;
    await this.removeIfPresent(entry.vaultPath);
    if (entry.thumbVaultPath) await this.removeIfPresent(entry.thumbVaultPath);
    await this.mutateIndex((idx) => {
      delete idx.entries[hash];
    });
  }

  async sweep(): Promise<number> {
    const index = await this.loadIndex();
    const cutoff = Date.now() - this.ttlMs;
    const stale = Object.values(index.entries).filter(
      (entry) => entry.lastUsedAt > 0 && entry.lastUsedAt < cutoff
    );
    for (const entry of stale) {
      await this.removeIfPresent(entry.vaultPath);
      if (entry.thumbVaultPath) await this.removeIfPresent(entry.thumbVaultPath);
    }
    if (stale.length === 0) return 0;
    await this.mutateIndex((idx) => {
      for (const entry of stale) delete idx.entries[entry.hash];
    });
    return stale.length;
  }

  async clear(): Promise<number> {
    const index = await this.loadIndex();
    const entries = Object.values(index.entries);
    for (const entry of entries) {
      await this.removeIfPresent(entry.vaultPath);
      if (entry.thumbVaultPath) await this.removeIfPresent(entry.thumbVaultPath);
    }
    await this.mutateIndex((idx) => {
      idx.entries = {};
    });
    return entries.length;
  }

  // ---- internals ----

  private indexPath(): string {
    return `${this.folder}/${INDEX_NAME}`;
  }

  private async loadIndex(): Promise<IndexFile> {
    if (!this.indexPromise) {
      this.indexPromise = this.readIndexFromDisk();
    }
    return this.indexPromise;
  }

  private async readIndexFromDisk(): Promise<IndexFile> {
    const path = this.indexPath();
    if (!(await this.adapter.exists(path))) {
      return { version: INDEX_VERSION, entries: {} };
    }
    try {
      const raw = await this.adapter.read(path);
      const parsed = JSON.parse(raw) as IndexFile;
      if (parsed.version !== INDEX_VERSION) {
        return { version: INDEX_VERSION, entries: {} };
      }
      return parsed;
    } catch {
      return { version: INDEX_VERSION, entries: {} };
    }
  }

  private async mutateIndex(mutator: (index: IndexFile) => void): Promise<void> {
    const run = async () => {
      const index = await this.loadIndex();
      mutator(index);
      await this.ensureFolder();
      await this.adapter.write(this.indexPath(), JSON.stringify(index, null, 2));
      // Refresh the cached promise so subsequent readers see the updated state.
      this.indexPromise = Promise.resolve(index);
    };
    this.writeQueue = this.writeQueue.then(run, run);
    return this.writeQueue;
  }

  private async ensureFolder(): Promise<void> {
    if (!(await this.adapter.exists(this.folder))) {
      await this.adapter.mkdir(this.folder);
    }
  }

  private async removeIfPresent(path: string): Promise<void> {
    if (await this.adapter.exists(path)) {
      await this.adapter.remove(path);
    }
  }
}
