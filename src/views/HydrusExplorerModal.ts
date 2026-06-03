import { App, Menu, Modal, Notice } from "obsidian";
import type DmScreenPlugin from "../main";
import { HydrusClient, type HydrusFile, extFromMime } from "../hydrus/client";
import type { CachedEntry, HydrusCache } from "../hydrus/cache";
import { paginate } from "../hydrus/pagination";
import { filterTags } from "../hydrus/tagFilter";
import { parseTagQuery } from "../hydrus/tagInput";
import { TagSuggester } from "./HydrusTagSuggester";
import { debug, debugWarn } from "../debug";

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

// Hydrus has no offset/cursor on /get_files/search_files, so we ask for the
// largest reasonable batch and paginate client-side. Catalogues bigger than
// this should be filtered with extra tags rather than navigated blindly.
const HARD_CAP = 1000;
const PAGE_SIZE = 100;

export class HydrusExplorerModal extends Modal {
  private plugin: DmScreenPlugin;
  private cache: HydrusCache;
  private client: HydrusClient | null;
  private mode: "online" | "offline" = "offline";
  private tiles: Tile[] = [];
  private query = "";
  private busy = false;
  private pageIndex = 0;
  private gridEl: HTMLElement | null = null;
  private paginationEl: HTMLElement | null = null;
  private statusEl: HTMLElement | null = null;
  private bannerEl: HTMLElement | null = null;
  private localOnly = false;
  private filterImages = true;
  private filterVideos = true;
  private tagSuggester: TagSuggester | null = null;

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
    this.titleEl.setText("Image from Hydrus");

    const { contentEl } = this;
    contentEl.empty();

    this.bannerEl = contentEl.createDiv({ cls: "dm-hydrus-banner" });
    this.bannerEl.style.display = "none";

    const controls = contentEl.createDiv({ cls: "dm-hydrus-controls" });
    const input = controls.createEl("input", {
      type: "search",
      placeholder: 'tags separated by commas, e.g. "tavern night, castle exterior, rain"',
    });
    input.style.flex = "1";
    input.value = this.plugin.settings.hydrusDefaultSearchTags;
    this.tagSuggester = new TagSuggester({
      inputEl: input,
      fetchSuggestions: (prefix) => this.suggestTags(prefix),
      onSubmit: (raw) => void this.runSearch(raw),
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

    const filterWrap = controls.createDiv({ cls: "dm-hydrus-filter-toggle" });
    const imgCheck = filterWrap.createEl("input", { type: "checkbox" }) as HTMLInputElement;
    imgCheck.checked = this.filterImages;
    imgCheck.id = "dm-hydrus-filter-images";
    filterWrap.createEl("label", { text: "Images", attr: { for: "dm-hydrus-filter-images" } });
    const vidCheck = filterWrap.createEl("input", { type: "checkbox" }) as HTMLInputElement;
    vidCheck.checked = this.filterVideos;
    vidCheck.id = "dm-hydrus-filter-videos";
    filterWrap.createEl("label", { text: "Videos", attr: { for: "dm-hydrus-filter-videos" } });
    imgCheck.addEventListener("change", () => {
      this.filterImages = imgCheck.checked;
      void this.runSearch(input.value);
    });
    vidCheck.addEventListener("change", () => {
      this.filterVideos = vidCheck.checked;
      void this.runSearch(input.value);
    });

    this.statusEl = contentEl.createDiv({ cls: "dm-hydrus-status" });
    this.gridEl = contentEl.createDiv({ cls: "dm-hydrus-grid" });
    this.paginationEl = contentEl.createDiv({ cls: "dm-hydrus-pagination" });

    await this.resolveMode();
    if (this.mode === "offline") {
      sourceSel.value = "local";
      sourceSel.disabled = true;
      this.localOnly = true;
    }
    await this.runSearch(input.value);
    input.focus();
  }

  onClose() {
    this.tagSuggester?.destroy();
    this.tagSuggester = null;
    this.contentEl.empty();
  }

  private async suggestTags(prefix: string): Promise<string[]> {
    let results: string[];
    if (!prefix) {
      // Hydrus API doesn't support empty/wildcard search — use local cache
      results = await this.suggestFromCache(prefix);
    } else if (this.client && !this.localOnly && this.mode === "online") {
      try {
        const serviceKeys = this.plugin.settings.hydrusTagServices;
        if (serviceKeys.length > 0) {
          const all: string[] = [];
          for (const key of serviceKeys) {
            const remote = await this.client.searchTags(prefix, { tagServiceKey: key });
            all.push(...remote.map((s) => s.value));
          }
          results = [...new Set(all)];
        } else {
          const remote = await this.client.searchTags(prefix, {});
          results = remote.map((s) => s.value);
        }
      } catch {
        results = await this.suggestFromCache(prefix);
      }
    } else {
      results = await this.suggestFromCache(prefix);
    }
    return filterTags(results, this.plugin.settings.hydrusIgnoredTagPatterns);
  }

  private async suggestFromCache(prefix: string): Promise<string[]> {
    const entries = await this.cache.listCached();
    const counts = new Map<string, number>();
    for (const e of entries) {
      for (const tag of e.knownTags) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    }
    const needle = prefix.trim().toLowerCase();
    const filtered = needle
      ? [...counts.entries()].filter(([tag]) => tag.toLowerCase().includes(needle))
      : [...counts.entries()];
    filtered.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    return filtered.slice(0, 50).map(([tag]) => tag);
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
    this.paginationEl?.empty();
    this.pageIndex = 0;
    this.setStatus("Searching…");

    const tags = parseTagQuery(this.query);

    if (this.filterImages && !this.filterVideos) {
      tags.push("system:filetype is image");
    } else if (this.filterVideos && !this.filterImages) {
      tags.push("system:filetype is video");
    } else if (!this.filterImages && !this.filterVideos) {
      this.tiles = [];
      this.renderPage();
      this.busy = false;
      return;
    }

    try {
      if (this.localOnly || this.mode === "offline" || !this.client) {
        this.tiles = await this.searchLocal(tags);
      } else {
        this.tiles = await this.searchMerged(this.client, tags);
      }
      this.renderPage();
    } catch (err) {
      this.setStatus(`Error: ${(err as Error).message}`);
      this.tiles = [];
      this.renderPage();
    } finally {
      this.busy = false;
    }
  }

  private renderPage() {
    if (!this.gridEl) return;
    const page = paginate(this.tiles, this.pageIndex, PAGE_SIZE);
    this.pageIndex = page.pageIndex;
    this.renderGrid(page.items);
    this.renderPagination(page.totalPages);
    this.updateStatus(page.totalItems, page.totalPages);
  }

  private updateStatus(totalItems: number, totalPages: number) {
    const isLocalScope = this.localOnly || this.mode === "offline";
    const scope = isLocalScope ? " (local cache)" : "";
    if (totalItems === 0) {
      this.setStatus(`0 results${scope}`);
      return;
    }
    const cap =
      this.mode === "online" && !this.localOnly && totalItems >= HARD_CAP
        ? ` · capped at ${HARD_CAP}, refine your tags to see more`
        : "";
    this.setStatus(
      `${totalItems} result${totalItems === 1 ? "" : "s"}${scope} · page ${
        this.pageIndex + 1
      }/${totalPages}${cap}`
    );
  }

  private renderPagination(totalPages: number) {
    if (!this.paginationEl) return;
    this.paginationEl.empty();
    if (totalPages <= 1) return;

    const prev = this.paginationEl.createEl("button", { text: "« Prev" });
    prev.disabled = this.pageIndex === 0;
    prev.addEventListener("click", () => {
      if (this.pageIndex > 0) {
        this.pageIndex -= 1;
        this.renderPage();
      }
    });

    this.paginationEl.createEl("span", {
      cls: "dm-hydrus-pageinfo",
      text: `Page ${this.pageIndex + 1} / ${totalPages}`,
    });

    const next = this.paginationEl.createEl("button", { text: "Next »" });
    next.disabled = this.pageIndex >= totalPages - 1;
    next.addEventListener("click", () => {
      if (this.pageIndex < totalPages - 1) {
        this.pageIndex += 1;
        this.renderPage();
      }
    });
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
    const search = await client.searchFiles(tags, HARD_CAP);
    if (search.hashes.length === 0) return [];
    const meta = await client.getFileMetadata(search.hashes);
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

  private renderGrid(tiles: Tile[]) {
    if (!this.gridEl) return;
    this.gridEl.empty();
    if (tiles.length === 0) {
      this.gridEl.createDiv({ cls: "dm-hydrus-empty", text: "No results." });
      return;
    }
    for (const tile of tiles) {
      const card = this.gridEl.createDiv({ cls: "dm-hydrus-tile" });
      card.dataset.hash = tile.hash;
      card.title = `${tile.knownTags.slice(0, 8).join(", ") || "(no tags)"}\nclick → background · shift+click → image layer`;

      const thumb = card.createEl("img", { cls: "dm-hydrus-thumb" });
      thumb.alt = "";
      this.loadThumb(tile, thumb);

      if (tile.kind === "local") {
        const badge = card.createDiv({ cls: "dm-hydrus-badge-local", text: "Local" });
        badge.title = "Already downloaded to vault cache";
      }

      if (mediaTypeOf(tile.mime) === "video") {
        const ext = (tile.ext || "").toUpperCase() || "VIDEO";
        const pill = card.createDiv({ cls: "dm-hydrus-mediakind-pill", text: `▶ ${ext}` });
        pill.title = `Video — ${tile.mime}`;
      }

      card.addEventListener("click", (evt) => {
        evt.preventDefault();
        if (evt.shiftKey) {
          void this.handleSetBackground(tile);
        } else {
          void this.handleAddAsLayer(tile);
        }
      });

      const more = card.createEl("button", { cls: "dm-hydrus-more", text: "⋮" });
      more.addEventListener("click", (evt) => {
        evt.stopPropagation();
        void this.openTileMenu(tile, evt);
      });
    }
  }

  private async loadThumb(tile: Tile, img: HTMLImageElement) {
    try {
      if (tile.kind === "local" && tile.thumbVaultPath) {
        const resourcePath = this.plugin.app.vault.adapter.getResourcePath(tile.thumbVaultPath);
        img.src = resourcePath;
        return;
      }
      if (tile.kind === "remote" && this.client) {
        const buf = await this.client.getThumbnailBytes(tile.hash);
        img.src = arrayBufferToDataUrl(buf, "image/jpeg");
      }
    } catch (err) {
      debugWarn("Hydrus Explorer: thumbnail load failed for", tile.hash, err);
    }
  }

  private async handleSetBackground(tile: Tile) {
    if (!this.plugin.server) {
      new Notice("Player Screen server is not running. Start it first.");
      return;
    }
    try {
      const entry = await this.ensureCached(tile);
      // Relative URL — the player browser resolves it against the plugin
      // server's own origin (whatever LAN IP/host it bound to). Hardcoding
      // localhost breaks any client that isn't on the DM machine.
      const url = `/vault/${encodeForVaultUrl(entry.vaultPath)}`;
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
      const panel = await this.plugin.findOpenDmControlPanel();
      if (panel) {
        panel.activeBackgroundUrl = url;
        panel.render();
      }
      await this.cache.markUsed(entry.hash);
      this.close();
    } catch (err) {
      new Notice(`Hydrus: ${(err as Error).message}`, 6000);
    }
  }

  private async handleAddAsLayer(tile: Tile) {
    try {
      if (mediaTypeOf(tile.mime) !== "image") {
        new Notice("Videos can only be set as background. Shift-click the tile or use the ⋮ menu.", 5000);
        return;
      }
      const entry = await this.ensureCached(tile);
      const dataUrl = await this.plugin.imageToDataUrl(entry.vaultPath);
      const panel = await this.plugin.findOpenDmControlPanel();
      if (!panel) {
        new Notice("Open the DM Control Panel before adding layers.", 5000);
        return;
      }
      const base = layerLabelFromTags(tile.knownTags, entry.hash);
      const label = uniqueLayerLabel(panel.imageLayers, base);
      panel.addImageLayer(label, dataUrl, "hydrus", false);
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

  private openTileMenu(tile: Tile, evt: MouseEvent) {
    const menu = new Menu();
    (menu as any).dom?.classList.add("dm-hydrus-tile-menu");
    const filtered = filterTags(tile.knownTags, this.plugin.settings.hydrusIgnoredTagPatterns);
    const tags = filtered.join(", ");
    menu.addItem((item: any) => item.setTitle(`Tags: ${tags || "(no tags)"}`).setDisabled(true));
    if (tags) {
      menu.addItem((item: any) =>
        item
          .setTitle("Copy tags")
          .setIcon("tag")
          .onClick(() => {
            void navigator.clipboard.writeText(tags);
            new Notice("Tags copied.");
          })
      );
    }
    menu.addSeparator();

    menu.addItem((item: any) =>
      item
        .setTitle("Set as background")
        .setIcon("monitor")
        .onClick(() => {
          void this.handleSetBackground(tile);
        })
    );

    if (tile.kind === "remote") {
      menu.addItem((item: any) =>
        item
          .setTitle("Download to cache")
          .setIcon("download")
          .onClick(async () => {
            try {
              await this.ensureCached(tile);
              new Notice("Downloaded to cache.");
              await this.runSearch(this.query);
            } catch (err) {
              new Notice(`Hydrus: ${(err as Error).message}`, 6000);
            }
          })
      );
    } else {
      menu.addItem((item: any) =>
        item
          .setTitle("Re-download (overwrite)")
          .setIcon("refresh-cw")
          .onClick(async () => {
            if (!this.client) {
              new Notice("Hydrus is offline; cannot re-download.", 6000);
              return;
            }
            try {
              await this.cache.evict(tile.hash);
              const file: HydrusFile = {
                hash: tile.hash,
                mime: tile.mime,
                ext: tile.ext || extFromMime(tile.mime),
                size: tile.size,
                knownTags: tile.knownTags,
              };
              await this.cache.fetchAndCache(this.client, file);
              new Notice("Re-downloaded.");
              await this.runSearch(this.query);
            } catch (err) {
              new Notice(`Hydrus: ${(err as Error).message}`, 6000);
            }
          })
      );
      menu.addItem((item: any) =>
        item
          .setTitle("Delete local copy")
          .setIcon("trash")
          .onClick(async () => {
            await this.cache.evict(tile.hash);
            new Notice("Local copy deleted.");
            await this.runSearch(this.query);
          })
      );
    }
    menu.showAtMouseEvent(evt);
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

export function layerLabelFromTags(tags: string[], hash: string): string {
  for (const tag of tags) {
    if (tag.toLowerCase().startsWith("name:")) {
      const value = tag.slice(5).trim();
      if (value) return value;
    }
  }
  return `Hydrus ${hash.slice(0, 8)}`;
}

export function uniqueLayerLabel(
  layers: { label: string }[],
  base: string
): string {
  const taken = new Set(layers.map((l) => l.label.toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base} ${n}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}
