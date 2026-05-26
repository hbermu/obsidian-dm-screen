import { App, Modal, Notice } from "obsidian";
import type DmScreenPlugin from "../main";
import { HydrusClient, type HydrusFile, extFromMime } from "../hydrus/client";
import type { CachedEntry, HydrusCache } from "../hydrus/cache";

interface RemoteTile {
  kind: "remote";
  hash: string;
  mime: string;
  ext: string;
  size: number;
  knownTags: string[];
  width?: number;
  height?: number;
}

interface LocalTile {
  kind: "local";
  hash: string;
  mime: string;
  ext: string;
  size: number;
  knownTags: string[];
  vaultPath: string;
  thumbVaultPath: string;
  lastUsedAt: number;
}

type Tile = RemoteTile | LocalTile;

const PAGE_LIMIT = 60;

export class HydrusExplorerModal extends Modal {
  private plugin: DmScreenPlugin;
  private cache: HydrusCache;
  private client: HydrusClient | null;
  private mode: "online" | "offline" = "offline";
  private tiles: Tile[] = [];
  private query = "";
  private busy = false;
  private gridEl: HTMLElement | null = null;
  private statusEl: HTMLElement | null = null;
  private bannerEl: HTMLElement | null = null;
  private localOnly = false;

  constructor(app: App, plugin: DmScreenPlugin) {
    super(app);
    this.plugin = plugin;
    if (!plugin.hydrusCache) {
      throw new Error("Hydrus cache not initialised; check settings");
    }
    this.cache = plugin.hydrusCache;
    this.client = plugin.buildHydrusClient();
  }

  async onOpen() {
    this.modalEl.addClass("dm-hydrus-modal");
    this.titleEl.setText("Hydrus Source");

    const { contentEl } = this;
    contentEl.empty();

    this.bannerEl = contentEl.createDiv({ cls: "dm-hydrus-banner" });
    this.bannerEl.style.display = "none";

    const controls = contentEl.createDiv({ cls: "dm-hydrus-controls" });
    const input = controls.createEl("input", {
      type: "search",
      placeholder: 'tags separated by space, e.g. "tavern night rain"',
    });
    input.style.flex = "1";
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") void this.runSearch(input.value);
    });
    const searchBtn = controls.createEl("button", { text: "Search" });
    searchBtn.addEventListener("click", () => void this.runSearch(input.value));

    const sourceWrap = controls.createDiv({ cls: "dm-hydrus-source-toggle" });
    const sourceLabel = sourceWrap.createEl("label", { text: "Source:" });
    sourceLabel.style.marginRight = "0.4em";
    const sourceSel = sourceWrap.createEl("select");
    sourceSel.createEl("option", { text: "Remote + Local", value: "merged" });
    sourceSel.createEl("option", { text: "Local only", value: "local" });
    sourceSel.addEventListener("change", () => {
      this.localOnly = sourceSel.value === "local";
      void this.runSearch(input.value);
    });

    this.statusEl = contentEl.createDiv({ cls: "dm-hydrus-status" });
    this.gridEl = contentEl.createDiv({ cls: "dm-hydrus-grid" });

    await this.resolveMode();
    if (this.mode === "offline") {
      sourceSel.value = "local";
      sourceSel.disabled = true;
      this.localOnly = true;
    }
    await this.runSearch("");
    input.focus();
  }

  onClose() {
    this.contentEl.empty();
  }

  private async resolveMode() {
    if (!this.client) {
      this.setBanner("Hydrus is not configured. Open Settings → DM Screen to set the URL and key.");
      this.mode = "offline";
      return;
    }
    try {
      await this.client.verifyAccess();
      this.mode = "online";
      this.clearBanner();
    } catch (err) {
      this.mode = "offline";
      this.setBanner(`Hydrus offline — showing local cache only. (${(err as Error).message})`);
    }
  }

  private setBanner(text: string) {
    if (!this.bannerEl) return;
    this.bannerEl.setText("⚠ " + text);
    this.bannerEl.style.display = "block";
  }

  private clearBanner() {
    if (this.bannerEl) this.bannerEl.style.display = "none";
  }

  private setStatus(text: string) {
    if (this.statusEl) this.statusEl.setText(text);
  }

  private async runSearch(rawQuery: string) {
    if (this.busy) return;
    this.busy = true;
    this.query = rawQuery.trim();
    if (!this.gridEl) {
      this.busy = false;
      return;
    }
    this.gridEl.empty();
    this.setStatus("Searching…");

    const tags = this.query
      .split(/\s+/)
      .map((t) => t.trim())
      .filter(Boolean);

    try {
      if (this.localOnly || this.mode === "offline" || !this.client) {
        this.tiles = await this.searchLocal(tags);
      } else {
        this.tiles = await this.searchMerged(this.client, tags);
      }
      this.renderGrid();
      this.setStatus(
        `${this.tiles.length} result${this.tiles.length === 1 ? "" : "s"}` +
          (this.localOnly || this.mode === "offline" ? " (local cache)" : "")
      );
    } catch (err) {
      this.setStatus(`Error: ${(err as Error).message}`);
      this.tiles = [];
      this.renderGrid();
    } finally {
      this.busy = false;
    }
  }

  private async searchLocal(tags: string[]): Promise<Tile[]> {
    const cached = await this.cache.listCached();
    const filtered = tags.length === 0
      ? cached
      : cached.filter((entry) => tags.every((t) => entryMatchesTag(entry, t)));
    return filtered
      .sort((a, b) => b.lastUsedAt - a.lastUsedAt)
      .map((entry) => ({
        kind: "local" as const,
        hash: entry.hash,
        mime: entry.mime,
        ext: entry.ext,
        size: entry.sizeBytes,
        knownTags: entry.knownTags,
        vaultPath: entry.vaultPath,
        thumbVaultPath: entry.thumbVaultPath,
        lastUsedAt: entry.lastUsedAt,
      }));
  }

  private async searchMerged(client: HydrusClient, tags: string[]): Promise<Tile[]> {
    const search = await client.searchFiles(tags, PAGE_LIMIT);
    if (search.hashes.length === 0) return [];
    const meta = await client.getFileMetadata(search.hashes, this.plugin.settings.hydrusTagService);
    const cached = new Map((await this.cache.listCached()).map((e) => [e.hash, e]));
    return meta.map<Tile>((file) => {
      const local = cached.get(file.hash);
      if (local) {
        return {
          kind: "local",
          hash: local.hash,
          mime: local.mime,
          ext: local.ext,
          size: local.sizeBytes,
          knownTags: local.knownTags.length ? local.knownTags : file.knownTags,
          vaultPath: local.vaultPath,
          thumbVaultPath: local.thumbVaultPath,
          lastUsedAt: local.lastUsedAt,
        };
      }
      return {
        kind: "remote",
        hash: file.hash,
        mime: file.mime,
        ext: file.ext || extFromMime(file.mime),
        size: file.size,
        knownTags: file.knownTags,
        width: file.width,
        height: file.height,
      };
    });
  }

  private renderGrid() {
    if (!this.gridEl) return;
    this.gridEl.empty();
    if (this.tiles.length === 0) {
      this.gridEl.createDiv({ cls: "dm-hydrus-empty", text: "No results." });
      return;
    }
    for (const tile of this.tiles) {
      const card = this.gridEl.createDiv({ cls: "dm-hydrus-tile" });
      card.dataset.hash = tile.hash;
      card.title = `${tile.knownTags.slice(0, 8).join(", ") || "(no tags)"}\nclick → background · shift+click → image layer`;

      const badge = card.createDiv({ cls: "dm-hydrus-badge" });
      badge.setText(tile.kind === "local" ? "L" : "R");

      const thumb = card.createEl("img", { cls: "dm-hydrus-thumb" });
      thumb.alt = "";
      this.loadThumb(tile, thumb);

      if (mediaTypeOf(tile.mime) === "video") {
        card.createDiv({ cls: "dm-hydrus-mediakind", text: "▶" });
      }

      card.addEventListener("click", (evt) => {
        evt.preventDefault();
        if (evt.shiftKey) {
          void this.handleAddAsLayer(tile);
        } else {
          void this.handleSetBackground(tile);
        }
      });

      const more = card.createEl("button", { cls: "dm-hydrus-more", text: "⋮" });
      more.addEventListener("click", (evt) => {
        evt.stopPropagation();
        void this.openTileMenu(tile);
      });
    }
  }

  private async loadThumb(tile: Tile, img: HTMLImageElement) {
    try {
      if (tile.kind === "local" && tile.thumbVaultPath) {
        const url = `http://localhost:${this.plugin.settings.serverPort}/vault/${encodeForVaultUrl(tile.thumbVaultPath)}`;
        img.src = url;
        return;
      }
      if (tile.kind === "remote" && this.client) {
        const buf = await this.client.getThumbnailBytes(tile.hash);
        img.src = arrayBufferToDataUrl(buf, "image/jpeg");
      }
    } catch (err) {
      console.warn("[Hydrus] thumbnail load failed for", tile.hash, err);
    }
  }

  private async handleSetBackground(tile: Tile) {
    if (!this.plugin.server) {
      new Notice("Player Screen server is not running. Start it first.");
      return;
    }
    try {
      const entry = await this.ensureCached(tile);
      const port = this.plugin.settings.serverPort;
      const url = `http://localhost:${port}/vault/${encodeForVaultUrl(entry.vaultPath)}`;
      const mediaType = mediaTypeOf(entry.mime);
      this.plugin.server.broadcast({
        type: "show-background-media",
        payload: {
          url,
          mediaType,
          loop: this.plugin.settings.hydrusDefaultLoop,
          muted: this.plugin.settings.hydrusDefaultMuted,
        },
      });
      await this.cache.markUsed(entry.hash);
      this.close();
    } catch (err) {
      new Notice(`Hydrus: ${(err as Error).message}`, 6000);
    }
  }

  private async handleAddAsLayer(tile: Tile) {
    try {
      if (mediaTypeOf(tile.mime) !== "image") {
        new Notice("Image layers only support still images. Use background for videos.", 5000);
        return;
      }
      const entry = await this.ensureCached(tile);
      const dataUrl = await this.plugin.imageToDataUrl(entry.vaultPath);
      const panel = await this.plugin.findOpenDmControlPanel();
      if (!panel) {
        new Notice("Open the DM Control Panel before adding layers.", 5000);
        return;
      }
      panel.addImageLayer(`Hydrus ${entry.hash.slice(0, 8)}`, dataUrl, "hydrus", true);
      await this.cache.markUsed(entry.hash);
      new Notice("Added as image layer.");
    } catch (err) {
      new Notice(`Hydrus: ${(err as Error).message}`, 6000);
    }
  }

  private async ensureCached(tile: Tile): Promise<CachedEntry> {
    if (tile.kind === "local") {
      const entry = await this.cache.get(tile.hash);
      if (entry) return entry;
    }
    if (!this.client) {
      throw new Error("Hydrus is offline; cannot download new files.");
    }
    const file: HydrusFile = {
      hash: tile.hash,
      mime: tile.mime,
      ext: tile.ext || extFromMime(tile.mime),
      size: tile.size,
      knownTags: tile.knownTags,
      width: tile.kind === "remote" ? tile.width : undefined,
      height: tile.kind === "remote" ? tile.height : undefined,
    };
    const { entry } = await this.cache.fetchAndCache(this.client, file);
    return entry;
  }

  private async openTileMenu(tile: Tile) {
    const { Menu } = await import("obsidian");
    const menu = new Menu();
    menu.addItem((item: any) =>
      item.setTitle(`Tags: ${tile.knownTags.join(", ") || "(none)"}`).setDisabled(true)
    );
    if (tile.kind === "local") {
      menu.addItem((item: any) =>
        item
          .setTitle("Copy vault path")
          .setIcon("clipboard-copy")
          .onClick(() => {
            void navigator.clipboard.writeText(tile.vaultPath);
            new Notice("Vault path copied.");
          })
      );
      menu.addItem((item: any) =>
        item
          .setTitle("Remove from cache")
          .setIcon("trash")
          .onClick(async () => {
            await this.cache.evict(tile.hash);
            await this.runSearch(this.query);
          })
      );
    }
    const anchor = this.gridEl?.querySelector(`[data-hash="${tile.hash}"] .dm-hydrus-more`) as HTMLElement | null;
    if (anchor) {
      const rect = anchor.getBoundingClientRect();
      menu.showAtPosition({ x: rect.left, y: rect.bottom });
    }
  }
}

function mediaTypeOf(mime: string): "image" | "video" {
  return mime.toLowerCase().startsWith("video/") ? "video" : "image";
}

function entryMatchesTag(entry: CachedEntry, needle: string): boolean {
  const n = needle.toLowerCase();
  return entry.knownTags.some((tag) => tag.toLowerCase().includes(n));
}

function arrayBufferToDataUrl(buf: ArrayBuffer, mime: string): string {
  let binary = "";
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return `data:${mime};base64,${btoa(binary)}`;
}

function encodeForVaultUrl(vaultPath: string): string {
  return vaultPath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}
