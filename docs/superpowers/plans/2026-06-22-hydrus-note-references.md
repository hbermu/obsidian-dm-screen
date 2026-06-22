# Hydrus Note References Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the DM copy a `hydrus://<hash>` reference from the Hydrus Explorer into a note, then pull that file in as an image layer (Add Image) or background image/video (Add BG) straight from the note.

**Architecture:** A new pure-ish module `src/hydrus/noteRefs.ts` parses `[label](hydrus://hash)` links from note text and resolves each hash to its media type via the existing `HydrusCache` (offline-capable) or a single `HydrusClient.getFileMetadata` batch call. `DmControlPanel`'s existing `showImagePicker` / `showBackgroundPicker` merge those resolved refs into their menus and download via the existing cache path on selection. No new broadcast message types.

**Tech Stack:** TypeScript (strict), Vitest + happy-dom, esbuild bundle. All commands run via `make` inside Docker.

**User Verification:** YES — the user asked to "saca una versión beta para que lo pueda probar". A beta prerelease (`0.21.0-beta.1`) is published from the feature branch so the user can install it via BRAT and confirm the flow works before the PR is merged.

---

## File Structure

- `src/hydrus/noteRefs.ts` (new) — `parseHydrusRefs`, `resolveHydrusRefs`, `ensureLocalCopy`, and the `HydrusRef` / `ResolvedHydrusRef` types. One responsibility: turn note text into resolved, downloadable Hydrus references.
- `src/hydrus/client.ts` (modify) — export `mediaTypeOf(mime)` (moved here from `HydrusExplorerModal.ts`; it operates on MIME and is now shared by the resolver).
- `src/views/HydrusExplorerModal.ts` (modify) — import `mediaTypeOf` from `client.ts`; add the "Copy image/video reference" tile-menu action; export `encodeForVaultUrl` for reuse.
- `src/views/DmControlPanel.ts` (modify) — merge resolved Hydrus refs into `showImagePicker` and `showBackgroundPicker`.
- `src/__tests__/note-refs.test.ts` (new) — unit tests for the new module.
- Specs: `.agent/features/hydrus-integration/note-references.md` (new), `.../explorer.md`, `.../overview.md`, `.agent/features/image-layers/overview.md`, `.agent/features/background-media/overview.md`.

---

### Task 1: Parse `hydrus://` references from note text

**Goal:** A pure `parseHydrusRefs(noteBody)` that extracts `{ label, hash }[]` from Markdown links, deduped by hash.

**Files:**
- Create: `src/hydrus/noteRefs.ts`
- Test: `src/__tests__/note-refs.test.ts`

**Acceptance Criteria:**
- [ ] Extracts label + 64-hex hash from `[label](hydrus://<hash>)`.
- [ ] Multiple refs returned in order of appearance.
- [ ] Deduplicates by lowercased hash; first occurrence keeps its label.
- [ ] Hex matching is case-insensitive; non-64-length or non-hex targets are ignored.
- [ ] Plain links and bare text are ignored.

**Verify:** `make test -- note-refs` → all tests pass.

**Steps:**

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/note-refs.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseHydrusRefs } from "../hydrus/noteRefs";

const H1 = "a".repeat(64);
const H2 = "b".repeat(64);

describe("parseHydrusRefs", () => {
  it("extracts a single labelled reference", () => {
    expect(parseHydrusRefs(`intro [Goblin warrior](hydrus://${H1}) outro`)).toEqual([
      { label: "Goblin warrior", hash: H1 },
    ]);
  });

  it("returns multiple refs in order", () => {
    const body = `[One](hydrus://${H1})\n[Two](hydrus://${H2})`;
    expect(parseHydrusRefs(body)).toEqual([
      { label: "One", hash: H1 },
      { label: "Two", hash: H2 },
    ]);
  });

  it("dedupes by hash, keeping the first label", () => {
    const body = `[First](hydrus://${H1}) ... [Second](hydrus://${H1.toUpperCase()})`;
    expect(parseHydrusRefs(body)).toEqual([{ label: "First", hash: H1 }]);
  });

  it("ignores malformed and non-hydrus links", () => {
    const body = [
      `[short](hydrus://${"a".repeat(40)})`,
      `[plain](https://example.com/x.png)`,
      `[[wikilink]]`,
      `hydrus://${H2}`,
    ].join("\n");
    expect(parseHydrusRefs(body)).toEqual([]);
  });

  it("accepts an empty label", () => {
    expect(parseHydrusRefs(`[](hydrus://${H1})`)).toEqual([{ label: "", hash: H1 }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `make test -- note-refs`
Expected: FAIL — `parseHydrusRefs` is not defined / module not found.

- [ ] **Step 3: Write minimal implementation**

Create `src/hydrus/noteRefs.ts`:

```ts
export interface HydrusRef {
  label: string;
  hash: string;
}

const REF_RE = /\[([^\]]*)\]\(hydrus:\/\/([0-9a-fA-F]{64})\)/g;

export function parseHydrusRefs(noteBody: string): HydrusRef[] {
  const seen = new Set<string>();
  const refs: HydrusRef[] = [];
  for (const m of noteBody.matchAll(REF_RE)) {
    const hash = m[2].toLowerCase();
    if (seen.has(hash)) continue;
    seen.add(hash);
    refs.push({ label: m[1], hash });
  }
  return refs;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `make test -- note-refs`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/hydrus/noteRefs.ts src/__tests__/note-refs.test.ts
git commit -m "feat(hydrus): parse hydrus:// references from note text"
```

```json:metadata
{"files": ["src/hydrus/noteRefs.ts", "src/__tests__/note-refs.test.ts"], "verifyCommand": "make test -- note-refs", "acceptanceCriteria": ["extracts label+hash", "ordered multiples", "dedupe by hash", "case-insensitive hex, ignores malformed", "ignores plain/wiki/bare links"], "requiresUserVerification": false}
```

---

### Task 2: Resolve references and download to cache

**Goal:** `resolveHydrusRefs` (cache-first, single remote batch for the rest) and `ensureLocalCopy` (download-on-demand). Relocate `mediaTypeOf` to `client.ts` so the resolver can share it.

**Files:**
- Modify: `src/hydrus/client.ts` (add `export function mediaTypeOf`)
- Modify: `src/views/HydrusExplorerModal.ts` (delete local `mediaTypeOf`, import from `client.ts`)
- Modify: `src/hydrus/noteRefs.ts` (add resolver + downloader)
- Test: `src/__tests__/note-refs.test.ts`

**Acceptance Criteria:**
- [ ] Cached hash resolves from `cache.get` with no network call (works when `client` is null).
- [ ] Uncached hashes are resolved in a single `client.getFileMetadata(hashes)` call.
- [ ] A ref that is uncached with a null client is returned `available: false`, `mediaType: null`.
- [ ] A network error during resolution marks the affected refs `available: false` rather than throwing.
- [ ] `mediaType` is `"image"` / `"video"` from `mediaTypeOf(mime)`.
- [ ] `ensureLocalCopy` returns the cached entry on hit; on miss calls `fetchAndCache`; on miss with null client throws.
- [ ] `mediaTypeOf` is exported from `client.ts` and `HydrusExplorerModal.ts` imports it (no behavioural change to the explorer).

**Verify:** `make test -- note-refs` → all pass; `make typecheck` → clean.

**Steps:**

- [ ] **Step 1: Move `mediaTypeOf` to `client.ts`**

In `src/hydrus/client.ts`, add (near the MIME map / `extFromMime`):

```ts
export function mediaTypeOf(mime: string): "image" | "video" {
  return mime.toLowerCase().startsWith("video/") ? "video" : "image";
}
```

In `src/views/HydrusExplorerModal.ts`, delete the local `function mediaTypeOf(...)` (around line 615) and add it to the existing `client` import, e.g.:

```ts
import { mediaTypeOf } from "../hydrus/client";
```

(Verify the existing import line for `../hydrus/client` and extend it rather than adding a second import.)

- [ ] **Step 2: Write the failing resolver tests**

Append to `src/__tests__/note-refs.test.ts`:

```ts
import { resolveHydrusRefs, ensureLocalCopy } from "../hydrus/noteRefs";
import type { HydrusCache, CachedEntry } from "../hydrus/cache";
import type { HydrusClient } from "../hydrus/client";
import { vi } from "vitest";

function cachedEntry(hash: string, mime: string): CachedEntry {
  return {
    hash, ext: mime.split("/")[1], mime, sizeBytes: 1,
    downloadedAt: 0, lastUsedAt: 0, knownTags: [],
    vaultPath: `.dm-screen/hydrus/${hash}.${mime.split("/")[1]}`, thumbVaultPath: "",
  };
}

function fakeCache(entries: Record<string, CachedEntry>): HydrusCache {
  return {
    get: vi.fn(async (h: string) => entries[h]),
    fetchAndCache: vi.fn(async (_c, f) => ({ entry: cachedEntry(f.hash, f.mime), isFresh: true })),
  } as unknown as HydrusCache;
}

describe("resolveHydrusRefs", () => {
  const H1 = "a".repeat(64), H2 = "b".repeat(64);

  it("resolves a cached ref offline (null client)", async () => {
    const cache = fakeCache({ [H1]: cachedEntry(H1, "image/png") });
    const out = await resolveHydrusRefs([{ label: "L", hash: H1 }], cache, null);
    expect(out).toEqual([{ label: "L", hash: H1, mediaType: "image", cached: true, available: true }]);
  });

  it("batch-resolves uncached refs via one getFileMetadata call", async () => {
    const cache = fakeCache({});
    const client = {
      getFileMetadata: vi.fn(async (hashes: string[]) =>
        hashes.map((h) => ({ hash: h, mime: h === H2 ? "video/mp4" : "image/png", ext: "x", size: 0, knownTags: [] }))),
    } as unknown as HydrusClient;
    const out = await resolveHydrusRefs([{ label: "A", hash: H1 }, { label: "B", hash: H2 }], cache, client);
    expect(client.getFileMetadata).toHaveBeenCalledTimes(1);
    expect(out.map((r) => r.mediaType)).toEqual(["image", "video"]);
    expect(out.every((r) => r.available && !r.cached)).toBe(true);
  });

  it("marks uncached refs unavailable when client is null", async () => {
    const out = await resolveHydrusRefs([{ label: "A", hash: H1 }], fakeCache({}), null);
    expect(out).toEqual([{ label: "A", hash: H1, mediaType: null, cached: false, available: false }]);
  });

  it("marks refs unavailable on network error", async () => {
    const client = { getFileMetadata: vi.fn(async () => { throw new Error("net"); }) } as unknown as HydrusClient;
    const out = await resolveHydrusRefs([{ label: "A", hash: H1 }], fakeCache({}), client);
    expect(out[0].available).toBe(false);
    expect(out[0].mediaType).toBeNull();
  });
});

describe("ensureLocalCopy", () => {
  const H1 = "a".repeat(64);

  it("returns the cached entry without downloading", async () => {
    const entry = cachedEntry(H1, "image/png");
    const cache = fakeCache({ [H1]: entry });
    const out = await ensureLocalCopy({ label: "L", hash: H1, mediaType: "image", cached: true, available: true }, cache, null);
    expect(out).toBe(entry);
    expect(cache.fetchAndCache).not.toHaveBeenCalled();
  });

  it("downloads on miss when a client is present", async () => {
    const cache = fakeCache({});
    const client = {
      getFileMetadata: vi.fn(async (hashes: string[]) => hashes.map((h) => ({ hash: h, mime: "image/png", ext: "png", size: 0, knownTags: [] }))),
    } as unknown as HydrusClient;
    const ref = { label: "L", hash: H1, mediaType: "image" as const, cached: false, available: true };
    const out = await ensureLocalCopy(ref, cache, client);
    expect(cache.fetchAndCache).toHaveBeenCalledTimes(1);
    expect(out.hash).toBe(H1);
  });

  it("throws on miss with null client", async () => {
    await expect(
      ensureLocalCopy({ label: "L", hash: H1, mediaType: null, cached: false, available: false }, fakeCache({}), null)
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `make test -- note-refs`
Expected: FAIL — `resolveHydrusRefs` / `ensureLocalCopy` not exported.

- [ ] **Step 4: Implement the resolver and downloader**

Append to `src/hydrus/noteRefs.ts`:

```ts
import type { HydrusCache, CachedEntry } from "./cache";
import type { HydrusClient, HydrusFile } from "./client";
import { mediaTypeOf } from "./client";
import { debug, debugWarn } from "../debug";

export interface ResolvedHydrusRef extends HydrusRef {
  mediaType: "image" | "video" | null;
  cached: boolean;
  available: boolean;
}

export async function resolveHydrusRefs(
  refs: HydrusRef[],
  cache: HydrusCache,
  client: HydrusClient | null
): Promise<ResolvedHydrusRef[]> {
  const entries = await Promise.all(refs.map((r) => cache.get(r.hash)));
  const missing = refs.filter((_, i) => !entries[i]).map((r) => r.hash);

  let remote: Record<string, HydrusFile> = {};
  if (missing.length > 0 && client) {
    try {
      const files = await client.getFileMetadata(missing);
      for (const f of files) remote[f.hash] = f;
    } catch (err) {
      debugWarn("resolveHydrusRefs: metadata fetch failed", (err as Error).message);
    }
  }

  return refs.map((ref, i) => {
    const entry = entries[i];
    if (entry) {
      return { ...ref, mediaType: mediaTypeOf(entry.mime), cached: true, available: true };
    }
    const file = remote[ref.hash];
    if (file) {
      return { ...ref, mediaType: mediaTypeOf(file.mime), cached: false, available: true };
    }
    debug("resolveHydrusRefs: unresolved", ref.hash.slice(0, 12));
    return { ...ref, mediaType: null, cached: false, available: false };
  });
}

export async function ensureLocalCopy(
  ref: ResolvedHydrusRef,
  cache: HydrusCache,
  client: HydrusClient | null
): Promise<CachedEntry> {
  const existing = await cache.get(ref.hash);
  if (existing) return existing;
  if (!client) throw new Error("Hydrus is offline; this reference is not cached.");
  const files = await client.getFileMetadata([ref.hash]);
  const file = files[0];
  if (!file) throw new Error("Hydrus could not find this reference.");
  const { entry } = await cache.fetchAndCache(client, file);
  return entry;
}
```

- [ ] **Step 5: Run tests + typecheck**

Run: `make test -- note-refs && make typecheck`
Expected: PASS; typecheck clean (explorer still compiles with the imported `mediaTypeOf`).

- [ ] **Step 6: Commit**

```bash
git add src/hydrus/noteRefs.ts src/hydrus/client.ts src/views/HydrusExplorerModal.ts src/__tests__/note-refs.test.ts
git commit -m "feat(hydrus): resolve and download note references"
```

```json:metadata
{"files": ["src/hydrus/noteRefs.ts", "src/hydrus/client.ts", "src/views/HydrusExplorerModal.ts", "src/__tests__/note-refs.test.ts"], "verifyCommand": "make test -- note-refs && make typecheck", "acceptanceCriteria": ["cache-first offline resolve", "single batch remote resolve", "unavailable when uncached+null client", "network error => unavailable", "ensureLocalCopy hit/miss/throw", "mediaTypeOf shared from client.ts"], "requiresUserVerification": false}
```

---

### Task 3: "Copy image/video reference" in the Explorer tile menu

**Goal:** Add a tile `⋮` menu action that copies `[<label>](hydrus://<hash>)`, titled per media type.

**Files:**
- Modify: `src/views/HydrusExplorerModal.ts` (`openTileMenu`, after "Copy tags")
- Modify: `.agent/features/hydrus-integration/explorer.md`

**Acceptance Criteria:**
- [ ] Menu shows "Copy image reference" for image tiles, "Copy video reference" for video tiles.
- [ ] Click writes `[<layerLabelFromTags(tags, hash)>](hydrus://<hash>)` to the clipboard and shows the Notice `Reference copied.`
- [ ] `explorer.md` requirement list documents the action.

**Verify:** `make build` → bundle succeeds; manual: open Explorer, ⋮ menu shows the action with the right label.

**Steps:**

- [ ] **Step 1: Add the menu item**

In `src/views/HydrusExplorerModal.ts` `openTileMenu`, after the "Copy tags" block and before `menu.addSeparator()`:

```ts
menu.addItem((item: any) =>
  item
    .setTitle(mediaTypeOf(tile.mime) === "video" ? "Copy video reference" : "Copy image reference")
    .setIcon("link")
    .onClick(() => {
      const label = layerLabelFromTags(tile.knownTags, tile.hash);
      void navigator.clipboard.writeText(`[${label}](hydrus://${tile.hash})`);
      new Notice("Reference copied.");
    })
);
```

(`layerLabelFromTags` is already defined in this file; `mediaTypeOf` was imported in Task 2.)

- [ ] **Step 2: Verify bundle builds**

Run: `make build`
Expected: bundle written, no errors.

- [ ] **Step 3: Update the spec**

In `.agent/features/hydrus-integration/explorer.md`, extend requirement 9 (the tile `⋮` menu) to list the new action. Add after the "Copy tags" clause:

> a `Copy image reference` action (titled `Copy video reference` when the tile MIME is `video/*`) that writes the Markdown string `[<label>](hydrus://<hash>)` to the clipboard — where `<label>` is `layerLabelFromTags(tile.knownTags, tile.hash)` — and shows the Notice `Reference copied.`,

- [ ] **Step 4: Commit**

```bash
git add src/views/HydrusExplorerModal.ts .agent/features/hydrus-integration/explorer.md
git commit -m "feat(hydrus): add Copy image/video reference to tile menu"
```

```json:metadata
{"files": ["src/views/HydrusExplorerModal.ts", ".agent/features/hydrus-integration/explorer.md"], "verifyCommand": "make build", "acceptanceCriteria": ["title varies by media type", "copies markdown link + Notice", "explorer.md updated"], "requiresUserVerification": false}
```

---

### Task 4: Merge note references into Add Image and Add BG

**Goal:** Both pickers list the active note's resolved Hydrus refs alongside local note images; selecting one downloads via the cache and adds it as a layer (images) or background (images + videos). Add the new spec and update the affected specs.

**Files:**
- Modify: `src/views/DmControlPanel.ts` (`showImagePicker`, `showBackgroundPicker`; add a private `collectHydrusRefEntries` helper; export-import `encodeForVaultUrl`)
- Modify: `src/views/HydrusExplorerModal.ts` (export `encodeForVaultUrl`)
- Create: `.agent/features/hydrus-integration/note-references.md`
- Modify: `.agent/features/hydrus-integration/overview.md`, `.agent/features/image-layers/overview.md`, `.agent/features/background-media/overview.md`
- Test: `src/__tests__/note-refs.test.ts` (helper already covered; no DM-render test — the picker is menu/DOM glue verified by build + manual)

**Acceptance Criteria:**
- [ ] Add Image lists local note images + resolved Hydrus image refs; video refs are hidden; unavailable refs are disabled with a `(offline, not cached)` suffix.
- [ ] Add BG lists local note images + resolved Hydrus image/video refs; unavailable refs disabled.
- [ ] Hydrus entries are titled `Hydrus: <label>` with a `link` icon; local entries keep their `image:`/`portrait:`/`embed:` labels.
- [ ] Direct-apply only when exactly one actionable entry AND zero disabled entries; otherwise the menu opens.
- [ ] Selecting a Hydrus image layer: `addImageLayer(uniqueLayerLabel(panel.imageLayers, ref.label), dataUrl, "hydrus", false)`.
- [ ] Selecting a Hydrus background: broadcast `show-background-media` with `/vault/<encoded vaultPath>`, `mediaType` from the ref, `loop`/`muted` from settings; set `activeBackgroundUrl` and (for video) `activeVideoPath`; then `cache.markUsed`.
- [ ] When Hydrus is disabled (`buildHydrusClient()` null) and `hydrusCache` exists, cached refs still resolve; uncached refs are disabled.
- [ ] New `note-references.md` spec exists; `overview.md` files reference it.

**Verify:** `make typecheck && make test && make build` → all pass; manual smoke (covered by the beta in Task 6).

**Steps:**

- [ ] **Step 1: Export `encodeForVaultUrl`**

In `src/views/HydrusExplorerModal.ts`, change `function encodeForVaultUrl` to `export function encodeForVaultUrl`.

- [ ] **Step 2: Add the shared collector to `DmControlPanel`**

Add imports at the top of `src/views/DmControlPanel.ts`:

```ts
import { parseHydrusRefs, resolveHydrusRefs, ensureLocalCopy, type ResolvedHydrusRef } from "../hydrus/noteRefs";
import { encodeForVaultUrl, uniqueLayerLabel } from "./HydrusExplorerModal";
import { mediaTypeOf } from "../hydrus/client";
```

Add a private method (near `getImagesFromNote`):

```ts
private async collectHydrusRefEntries(file: TFile): Promise<ResolvedHydrusRef[]> {
  if (!this.plugin.hydrusCache) return [];
  const body = await this.plugin.app.vault.cachedRead(file);
  const refs = parseHydrusRefs(body);
  if (refs.length === 0) return [];
  const client = this.plugin.buildHydrusClient();
  return resolveHydrusRefs(refs, this.plugin.hydrusCache, client);
}
```

Add a private selection handler shared by both pickers:

```ts
private async applyHydrusRef(ref: ResolvedHydrusRef, asBackground: boolean): Promise<void> {
  try {
    const entry = await ensureLocalCopy(ref, this.plugin.hydrusCache!, this.plugin.buildHydrusClient());
    if (asBackground) {
      const url = `/vault/${encodeForVaultUrl(entry.vaultPath)}`;
      this.activeBackgroundUrl = url;
      this.activeVideoPath = ref.mediaType === "video" ? entry.vaultPath : null;
      this.plugin.server?.broadcast({
        type: "show-background-media",
        payload: {
          url,
          mediaType: ref.mediaType ?? "image",
          loop: this.plugin.settings.hydrusDefaultLoop,
          muted: this.plugin.settings.hydrusDefaultMuted,
        },
      });
      this.render();
    } else {
      const dataUrl = await this.plugin.imageToDataUrl(entry.vaultPath);
      if (dataUrl) this.addImageLayer(uniqueLayerLabel(this.imageLayers, ref.label), dataUrl, "hydrus", false);
    }
    await this.plugin.hydrusCache!.markUsed(ref.hash);
  } catch (err) {
    new Notice(`Hydrus: ${(err as Error).message}`, 6000);
  }
}
```

- [ ] **Step 3: Wire `showBackgroundPicker` (make it async, merge refs)**

Replace the body of `showBackgroundPicker` so it: reads local images (existing `getImagesFromNote`), collects Hydrus refs, builds a combined entry list, applies the direct-apply rule, and otherwise opens the menu. Concrete replacement:

```ts
private async showBackgroundPicker(evt: MouseEvent): Promise<void> {
  const activeFile = this.plugin.app.workspace.getActiveFile();
  if (!activeFile) { new Notice("No active note"); return; }

  const local = this.getImagesFromNote(activeFile);
  const refs = await this.collectHydrusRefEntries(activeFile);
  const hydrus = refs.filter((r) => !r.available || r.mediaType === "image" || r.mediaType === "video");

  const actionable = local.length + hydrus.filter((r) => r.available).length;
  const disabled = hydrus.filter((r) => !r.available).length;

  if (actionable === 0 && disabled === 0) { new Notice("No images found in note"); return; }
  if (actionable === 1 && disabled === 0) {
    if (local.length === 1) { this.setImageAsBackground(local[0]); return; }
    void this.applyHydrusRef(hydrus.find((r) => r.available)!, true); return;
  }

  const { Menu } = require("obsidian");
  const menu = new Menu();
  for (const img of local) {
    menu.addItem((item: any) => { item.setTitle(img.label); item.onClick(() => this.setImageAsBackground(img)); });
  }
  for (const ref of hydrus) {
    menu.addItem((item: any) => {
      item.setTitle(`Hydrus: ${ref.label}${ref.available ? "" : " (offline, not cached)"}`).setIcon("link");
      if (!ref.available) { item.setDisabled(true); return; }
      item.onClick(() => void this.applyHydrusRef(ref, true));
    });
  }
  menu.showAtMouseEvent(evt);
}
```

- [ ] **Step 4: Wire `showImagePicker` (image-only Hydrus refs)**

In `showImagePicker`, after the existing local-image collection (the `images` array is built around line 1830–1863) and before the single/multi menu logic, insert the Hydrus merge. Keep the existing local single-image fast path only when there are no Hydrus entries. Concrete approach — after `const noteType = fm?.["type"] ...`:

```ts
const refs = await this.collectHydrusRefEntries(activeFile);
const hydrus = refs.filter((r) => !r.available || r.mediaType === "image");

const localActionable = images.length;
const hydrusActionable = hydrus.filter((r) => r.available).length;
const disabled = hydrus.filter((r) => !r.available).length;

if (localActionable === 0 && hydrusActionable === 0 && disabled === 0) {
  new Notice("No images found in this note"); return;
}
if (localActionable + hydrusActionable === 1 && disabled === 0) {
  if (images.length === 1) {
    const img = images[0];
    const dataUrl = await this.plugin.imageToDataUrl(img.path);
    if (dataUrl) { this.addImageLayer(`${activeFile.basename} (${img.source})`, dataUrl, noteType, false); new Notice(`Added: ${img.label} (hidden)`); }
    return;
  }
  void this.applyHydrusRef(hydrus.find((r) => r.available)!, false); return;
}
```

Then in the menu-building loop, after the existing local `images` items (and before the "Add all" block), add the Hydrus items:

```ts
for (const ref of hydrus) {
  menu.addItem((item: any) => {
    item.setTitle(`Hydrus: ${ref.label}${ref.available ? "" : " (offline, not cached)"}`).setIcon("link");
    if (!ref.available) { item.setDisabled(true); return; }
    item.onClick(() => void this.applyHydrusRef(ref, false));
  });
}
```

Make `showImagePicker` `async` and update its call site (`addLayerBtn` click handler at line ~447) to `(evt) => void this.showImagePicker(evt)`. Update the `showBackgroundPicker` call site (line ~463) to `void this.showBackgroundPicker(evt)`.

Remove the now-redundant early `if (images.length === 0)` Notice that sat before the Hydrus merge (the combined empty-check above replaces it) so an image-less note with Hydrus refs still opens the menu.

- [ ] **Step 5: Typecheck, test, build**

Run: `make typecheck && make test && make build`
Expected: all green. (`note-refs` tests still pass; bundle smoke test passes.)

- [ ] **Step 6: Write the new spec**

Create `.agent/features/hydrus-integration/note-references.md` following `_template.md`. EARS requirements must cover: reference format; `parseHydrusRefs` dedupe/case rules; `resolveHydrusRefs` cache-first + single batch + unavailable/network-error behaviour; `ensureLocalCopy` hit/miss/throw; the Add Image merge (image-only, disabled unavailable); the Add BG merge (image+video, disabled unavailable); the direct-apply rule; layer label via `uniqueLayerLabel`; background broadcast fields and `markUsed`. List source files (`src/hydrus/noteRefs.ts`, `src/views/DmControlPanel.ts`, `src/views/HydrusExplorerModal.ts`, `src/hydrus/client.ts`), settings used (`hydrusDefaultLoop`, `hydrusDefaultMuted`), the reused broadcasts, and tests (`src/__tests__/note-refs.test.ts`).

- [ ] **Step 7: Update the cross-referenced specs**

- `.agent/features/hydrus-integration/overview.md`: add `src/hydrus/noteRefs.ts` to Source files and add a bullet under requirement 7's sub-functionality split pointing to `note-references.md`.
- `.agent/features/image-layers/overview.md`: amend requirement 1's intro sentence (and/or add a requirement) noting Add Image also lists the active note's Hydrus image references; cross-link `../hydrus-integration/note-references.md`.
- `.agent/features/background-media/overview.md`: amend requirement 1 (Add BG) to note it also lists the active note's Hydrus image/video references; cross-link `../hydrus-integration/note-references.md`.

- [ ] **Step 8: Re-read specs against the diff, then commit**

Re-read each modified spec end-to-end; verify named identifiers (`collectHydrusRefEntries`, `applyHydrusRef`, `ResolvedHydrusRef`, `encodeForVaultUrl`, `mediaTypeOf`) exist in code.

```bash
git add src/views/DmControlPanel.ts src/views/HydrusExplorerModal.ts .agent/features/
git commit -m "feat(hydrus): pull note references into Add Image and Add BG"
```

```json:metadata
{"files": ["src/views/DmControlPanel.ts", "src/views/HydrusExplorerModal.ts", ".agent/features/hydrus-integration/note-references.md", ".agent/features/hydrus-integration/overview.md", ".agent/features/hydrus-integration/explorer.md", ".agent/features/image-layers/overview.md", ".agent/features/background-media/overview.md"], "verifyCommand": "make typecheck && make test && make build", "acceptanceCriteria": ["Add Image merges image refs, hides videos, disables unavailable", "Add BG merges image+video refs", "Hydrus: <label> titles", "direct-apply rule", "layer via uniqueLayerLabel", "bg broadcast + markUsed", "offline cached still works", "specs created/updated"], "requiresUserVerification": false}
```

---

### Task 5: Final verification pass

**Goal:** Confirm the whole suite, typecheck, and bundle are green before cutting the beta.

**Files:** none (verification only)

**Acceptance Criteria:**
- [ ] `make typecheck` clean.
- [ ] `make test` all pass (existing + new `note-refs`).
- [ ] `make build` produces `main.js`.

**Verify:** `make typecheck && make test && make build`

**Steps:**

- [ ] **Step 1: Run the full gate**

Run: `make typecheck && make test && make build`
Expected: all green. Fix any failure before proceeding (return to the relevant task).

```json:metadata
{"files": [], "verifyCommand": "make typecheck && make test && make build", "acceptanceCriteria": ["typecheck clean", "all tests pass", "bundle builds"], "requiresUserVerification": false}
```

---

### Task 6: Cut the beta and open the PR (user verification)

**Goal:** Publish `0.21.0-beta.1` from the branch so the user can install it via BRAT and test, then open the PR with `release:minor`.

**Files:**
- Modify: `manifest.json`, `package.json`, `package-lock.json` (top-level `version` AND `packages[""].version`)

**Acceptance Criteria:**
- [ ] Three version files set to `0.21.0-beta.1`.
- [ ] Branch pushed; release workflow publishes prerelease `v0.21.0-beta.1` with `main.js`, `manifest.json`, `styles.css`.
- [ ] PR opened against `main`, title `feat(hydrus): add note references for layers and backgrounds`, label `release:minor`.
- [ ] User confirms the flow works on the beta.

**User Verification Required:**
Before marking this task complete, you MUST call AskUserQuestion:
```yaml
AskUserQuestion:
  question: "La beta v0.21.0-beta.1 está publicada. Instálala con BRAT y prueba: Copy image/video reference desde el explorador → pegar en una nota → Add Image / Add BG la detecta y la usa. ¿Funciona el flujo?"
  header: "Verification"
  options:
    - label: "Funciona"
      description: "El flujo completo va bien; seguimos hacia el merge."
    - label: "Hay problemas"
      description: "Algo falla; describe qué y lo arreglo antes del merge."
```
**If the user selects "Hay problemas":** the task is NOT complete. Fix, bump to `0.21.0-beta.2`, re-publish, and re-verify with AskUserQuestion.

**Steps:**

- [ ] **Step 1: Bump the three version files to `0.21.0-beta.1`**

Edit `manifest.json` `version`, `package.json` `version`, and `package-lock.json` (both top-level `version` and `packages[""].version`) to `0.21.0-beta.1`.

- [ ] **Step 2: Commit and push**

```bash
git add manifest.json package.json package-lock.json
git commit -m "chore(release): v0.21.0-beta.1"
git push -u origin feature/hydrus-note-references
```

(Push uses the repo's `ssh.github.com:443` override if port 22 is blocked.)

- [ ] **Step 3: Open the PR**

```bash
gh pr create --base main --title "feat(hydrus): add note references for layers and backgrounds" \
  --label "release:minor" --body "<summary + test plan>"
```

- [ ] **Step 4: Confirm the prerelease published**

Run: `gh release view v0.21.0-beta.1`
Expected: prerelease exists with the three assets.

- [ ] **Step 5: User verification** (AskUserQuestion above).

```json:metadata
{"files": ["manifest.json", "package.json", "package-lock.json"], "verifyCommand": "gh release view v0.21.0-beta.1", "acceptanceCriteria": ["version files at 0.21.0-beta.1", "prerelease published with assets", "PR opened with release:minor", "user confirms flow works"], "requiresUserVerification": true, "userVerificationPrompt": "La beta v0.21.0-beta.1 está publicada. ¿Funciona el flujo Copy reference → nota → Add Image/Add BG?"}
```

---

## Self-Review

**Spec coverage:** reference format (Task 1 + spec Task 4); Copy image/video reference (Task 3); parser (Task 1); resolver + downloader + offline/error (Task 2); Add Image/Add BG merge + direct-apply + labels + broadcast (Task 4); specs (Tasks 3, 4); beta for user testing (Task 6). All design sections map to a task.

**Placeholder scan:** PR `--body "<summary + test plan>"` and the `note-references.md` EARS prose are the only author-at-execution items; both are bounded instructions, not TBDs. No `TODO`/`implement later`.

**Type consistency:** `ResolvedHydrusRef`, `HydrusRef`, `parseHydrusRefs`, `resolveHydrusRefs`, `ensureLocalCopy`, `collectHydrusRefEntries`, `applyHydrusRef`, `mediaTypeOf`, `encodeForVaultUrl`, `uniqueLayerLabel` are used consistently across tasks. `CachedEntry` shape matches `src/hydrus/cache.ts`.

**Verification requirement scan:** YES — user wants a testable beta. Task 6 carries `requiresUserVerification: true` with the standard block.
