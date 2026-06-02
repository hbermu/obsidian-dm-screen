import { requestUrl } from "obsidian";
import type { VaultAdapterLike } from "../hydrus/cache";
import { debug, debugError } from "../debug";

export interface ImageIndexEntry {
  monsterId: number;
  name: string;
  vaultPath: string;
  downloadedAt: number;
  lastUsedAt: number;
}

interface ImageIndex {
  version: 1;
  entries: Record<string, ImageIndexEntry>;
}

export class DdbImageCache {
  private folder: string;
  private adapter: VaultAdapterLike;
  private ttlMs: number;
  private index: ImageIndex | null = null;

  constructor(folder: string, adapter: VaultAdapterLike, ttlDays: number) {
    this.folder = folder.replace(/^\/+|\/+$/g, "") || ".dm-screen/beyond";
    this.adapter = adapter;
    this.ttlMs = Math.max(1, ttlDays) * 24 * 60 * 60 * 1000;
  }

  async getOrDownload(monsterId: number, imageUrl: string, name: string): Promise<string> {
    const index = await this.loadIndex();
    const key = String(monsterId);
    const existing = index.entries[key];
    if (existing && (await this.adapter.exists(existing.vaultPath))) {
      debug("DDB ImageCache: hit for", name, "(id:", monsterId, ")");
      existing.lastUsedAt = Date.now();
      await this.saveIndex(index);
      return existing.vaultPath;
    }

    debug("DDB ImageCache: downloading", name, "(id:", monsterId, ") from", imageUrl.slice(0, 80));
    const ext = this.extFromUrl(imageUrl);
    const vaultPath = `${this.folder}/${monsterId}.${ext}`;
    await this.ensureFolder();
    const res = await requestUrl({ url: imageUrl, method: "GET", throw: false });
    if (res.status < 200 || res.status >= 300) {
      debugError("DDB ImageCache: download failed (", res.status, ") for", name);
      throw new Error(`Failed to download monster image (${res.status})`);
    }
    await this.adapter.writeBinary(vaultPath, res.arrayBuffer);
    debug("DDB ImageCache: saved", vaultPath, res.arrayBuffer.byteLength, "bytes");

    const now = Date.now();
    index.entries[key] = { monsterId, name, vaultPath, downloadedAt: now, lastUsedAt: now };
    await this.saveIndex(index);
    return vaultPath;
  }

  async sweep(): Promise<number> {
    const index = await this.loadIndex();
    const cutoff = Date.now() - this.ttlMs;
    const stale = Object.values(index.entries).filter((e) => e.lastUsedAt < cutoff);
    for (const entry of stale) {
      if (await this.adapter.exists(entry.vaultPath)) {
        await this.adapter.remove(entry.vaultPath);
      }
      delete index.entries[String(entry.monsterId)];
    }
    if (stale.length > 0) await this.saveIndex(index);
    return stale.length;
  }

  async listCached(): Promise<ImageIndexEntry[]> {
    const index = await this.loadIndex();
    return Object.values(index.entries);
  }

  private extFromUrl(url: string): string {
    const match = url.match(/\.(\w+)(?:\?|$)/);
    return match?.[1]?.toLowerCase() || "jpeg";
  }

  private async loadIndex(): Promise<ImageIndex> {
    if (this.index) return this.index;
    const path = `${this.folder}/index.json`;
    if (await this.adapter.exists(path)) {
      try {
        const raw = await this.adapter.read(path);
        this.index = JSON.parse(raw);
        return this.index!;
      } catch {
        /* fall through */
      }
    }
    this.index = { version: 1, entries: {} };
    return this.index;
  }

  private async saveIndex(index: ImageIndex): Promise<void> {
    await this.ensureFolder();
    await this.adapter.write(`${this.folder}/index.json`, JSON.stringify(index, null, 2));
    this.index = index;
  }

  private async ensureFolder(): Promise<void> {
    if (await this.adapter.exists(this.folder)) return;
    // Create parent directories if needed
    const parts = this.folder.split("/");
    let current = "";
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      if (!(await this.adapter.exists(current))) {
        await this.adapter.mkdir(current);
      }
    }
  }
}
