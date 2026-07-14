# Map Screen Fog of War Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add fog of war to the battlemap screen (`/map`): a single PNG mask painted from a dedicated DM modal, rendered inside the map stage transform on the TV, persisted per map as a vault sidecar PNG.

**Architecture:** One offscreen canvas (1024-wide, map aspect) is the source of truth; black = hidden, transparent = revealed. A new `MapFogModal` paints it (reveal/cover × circle-brush/rect/grid-cell). `MapScreenPanel` owns lifecycle: loads the sidecar on map apply, writes it on every edit, broadcasts `map-fog {dataUrl, opacity}` on the `map` channel. The map client renders the mask as an `<img id="map-fog">` inside `#map-stage`, inheriting pan/zoom/rotation/scale. TV opacity is a global setting.

**Tech Stack:** TypeScript strict, Obsidian plugin API (Modal), canvas 2D, vitest (Docker via `make`), Playwright visual tests. No Node on host — all commands via `make`.

**User Verification:** NO — no user verification required by the spec (standard CI + tests + release flow).

**Design spec:** `docs/superpowers/specs/2026-07-14-map-fog-of-war-design.md` (approved).

---

## Repo ground rules that bind every task

- All commands via `make` (`make typecheck`, `make test`) — NEVER `npm`/`npx`/`node` on the host.
- TypeScript strict; static imports only; no "what this does" comments; no once-used helpers.
- `.agent/features/` spec updates ship in the same PR (Task 7); the squash-merge makes them the same `main` commit.
- Branch: `feature/map-fog-of-war` (already created, design doc committed on it).
- The `PreToolUse` hook blocks `git commit` while native tasks are pending — the coordinator manages task status; implementer subagents must NOT create native tasks.

## File structure

| File | Action | Responsibility |
|---|---|---|
| `src/map/fog.ts` | Create | Pure fog helpers: canvas sizing, sidecar path derivation, grid-cell rect math, sidecar load/save via an adapter interface |
| `src/__tests__/map-fog.test.ts` | Create | Unit tests for `fog.ts` |
| `src/settings.ts` | Modify | `mapFogTvOpacity` setting + slider in the Map Screen settings section |
| `src/views/MapScreenPanel.ts` | Modify | Fog state (`fogDataUrl`), lifecycle (load/persist/broadcast/republish/restore/stop), Fog button |
| `src/__tests__/map-screen-panel-aoe.test.ts` | Modify | Extend `makePanel` plugin stub with the new setting/adapter fields if compilation requires |
| `src/__tests__/map-fog-panel.test.ts` | Create | Panel-level fog lifecycle tests (mocked adapter + broadcast capture) |
| `src/views/MapFogModal.ts` | Create | The fog editing modal (toolbar + stage + drawing) |
| `styles.css` | Modify | Modal + toolbar styles (`dm-fog-*` classes) |
| `src/map/map.ts` | Modify | `map-fog` handler; clear fog on `map-clear` |
| `src/server.ts` | Modify | `<img id="map-fog">` in the inline map HTML |
| `src/map/map.css` | Modify | `#map-fog` overlay styles |
| `src/__tests__/server-map-channel.test.ts` | Modify | `map-fog` replay/purge coverage |
| `test/visual/map-fog.spec.ts` | Create | Playwright visual regression for map fog |
| `.agent/features/map-screen/fog-of-war.md` | Create | EARS spec |
| `.agent/features/map-screen/overview.md` | Modify | Drop fog non-goal, add requirement, add Fog button to req 9 |
| `.agent/features/player-server/websocket-protocol.md` | Modify | `map-fog` row + URL-sink rule |

---

### Task 1: Pure fog helpers (`src/map/fog.ts`) with tests

**Goal:** Testable, dependency-free core: fog canvas sizing, sidecar path derivation, grid-cell snapping, and sidecar IO against a narrow adapter interface.

**Files:**
- Create: `src/map/fog.ts`
- Create: `src/__tests__/map-fog.test.ts`

**Acceptance Criteria:**
- [ ] `fogCanvasSize` returns 1024-wide, aspect-correct, ≥1px height
- [ ] `fogSidecarPath` is deterministic, filename-safe, collision-resistant (readable tail + FNV-1a hash), always under `.dm-screen/fog/`
- [ ] `gridCellRectAt` snaps any map point to its grid cell honoring `pxPerSquare` and offsets (negative coords included)
- [ ] `loadFogSidecar` returns a `data:image/png;base64,` URL when the file exists, `null` otherwise
- [ ] `saveFogSidecar` creates `.dm-screen` and `.dm-screen/fog` when missing and writes decoded PNG bytes

**Verify:** `make test` → `map-fog.test.ts` green

**Steps:**

- [ ] **Step 1: Write the failing tests**

```typescript
// src/__tests__/map-fog.test.ts
import { describe, expect, it } from "vitest";
import {
  fogCanvasSize,
  fogSidecarPath,
  gridCellRectAt,
  loadFogSidecar,
  saveFogSidecar,
  type FogAdapter,
} from "../map/fog";

// 1×1 transparent PNG
const TINY_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

function makeAdapter(files: Record<string, Uint8Array> = {}) {
  const dirs = new Set<string>();
  const adapter: FogAdapter = {
    exists: (p) => Promise.resolve(p in files || dirs.has(p)),
    readBinary: (p) => {
      const bytes = files[p];
      const buf = new ArrayBuffer(bytes.length);
      new Uint8Array(buf).set(bytes);
      return Promise.resolve(buf);
    },
    writeBinary: (p, data) => {
      files[p] = new Uint8Array(data);
      return Promise.resolve();
    },
    mkdir: (p) => {
      dirs.add(p);
      return Promise.resolve();
    },
  };
  return { adapter, files, dirs };
}

describe("fogCanvasSize", () => {
  it("is 1024 wide with aspect-matched height", () => {
    expect(fogCanvasSize(2048, 1024)).toEqual({ width: 1024, height: 512 });
    expect(fogCanvasSize(1000, 1500)).toEqual({ width: 1024, height: 1536 });
  });

  it("never returns a zero height", () => {
    expect(fogCanvasSize(100000, 1).height).toBeGreaterThanOrEqual(1);
  });
});

describe("fogSidecarPath", () => {
  it("is deterministic and lives under .dm-screen/fog/", () => {
    const a = fogSidecarPath("/vault/maps/dungeon%20level%201.jpg");
    expect(a).toBe(fogSidecarPath("/vault/maps/dungeon%20level%201.jpg"));
    expect(a).toMatch(/^\.dm-screen\/fog\/[A-Za-z0-9._-]+\.png$/);
  });

  it("distinguishes URLs that sanitize to the same readable tail", () => {
    expect(fogSidecarPath("/vault/a/b.png")).not.toBe(fogSidecarPath("/vault/a_b.png"));
  });

  it("keeps a readable tail from the vault path", () => {
    expect(fogSidecarPath("/vault/.dm-screen/hydrus/abc123.jpg")).toContain("abc123");
  });
});

describe("gridCellRectAt", () => {
  const cfg = { pxPerSquare: 140, gridOffsetX: 0, gridOffsetY: 0 };

  it("snaps a point to its containing cell", () => {
    expect(gridCellRectAt(150, 10, cfg)).toEqual({ x: 140, y: 0, w: 140, h: 140 });
  });

  it("honors grid offsets", () => {
    const off = { pxPerSquare: 100, gridOffsetX: 30, gridOffsetY: -20 };
    expect(gridCellRectAt(135, 85, off)).toEqual({ x: 130, y: 80, w: 100, h: 100 });
  });

  it("handles points left of the offset (negative cell index)", () => {
    const off = { pxPerSquare: 100, gridOffsetX: 50, gridOffsetY: 0 };
    expect(gridCellRectAt(20, 10, off)).toEqual({ x: -50, y: 0, w: 100, h: 100 });
  });
});

describe("fog sidecar IO", () => {
  it("loadFogSidecar returns null when no sidecar exists", async () => {
    const { adapter } = makeAdapter();
    expect(await loadFogSidecar(adapter, "/vault/maps/x.jpg")).toBeNull();
  });

  it("save then load round-trips the PNG as a data URL", async () => {
    const { adapter, files } = makeAdapter();
    const dataUrl = `data:image/png;base64,${TINY_PNG_B64}`;
    await saveFogSidecar(adapter, "/vault/maps/x.jpg", dataUrl);
    const path = fogSidecarPath("/vault/maps/x.jpg");
    expect(files[path]).toBeDefined();
    expect(await loadFogSidecar(adapter, "/vault/maps/x.jpg")).toBe(dataUrl);
  });

  it("saveFogSidecar creates the fog folders when missing", async () => {
    const { adapter, dirs } = makeAdapter();
    await saveFogSidecar(adapter, "/vault/m.png", `data:image/png;base64,${TINY_PNG_B64}`);
    expect(dirs.has(".dm-screen")).toBe(true);
    expect(dirs.has(".dm-screen/fog")).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `make test`
Expected: FAIL — `Cannot find module '../map/fog'`

- [ ] **Step 3: Implement `src/map/fog.ts`**

```typescript
// src/map/fog.ts
import type { MapGridConfig } from "./types";
import { dataUrlToBytes } from "../webhooks/multipart";

export const FOG_RESOLUTION = 1024;

export interface FogAdapter {
  exists(path: string): Promise<boolean>;
  readBinary(path: string): Promise<ArrayBuffer>;
  writeBinary(path: string, data: ArrayBuffer): Promise<void>;
  mkdir(path: string): Promise<void>;
}

export interface CellRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function fogCanvasSize(naturalWidth: number, naturalHeight: number): { width: number; height: number } {
  return {
    width: FOG_RESOLUTION,
    height: Math.max(1, Math.round(FOG_RESOLUTION * (naturalHeight / naturalWidth))),
  };
}

function fnv1a(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

// Readable tail + content hash: the tail aids manual cleanup in the vault,
// the hash guarantees distinct maps never share a sidecar.
export function fogSidecarPath(mapUrl: string): string {
  const raw = mapUrl.startsWith("/vault/") ? decodeURIComponent(mapUrl.slice("/vault/".length)) : mapUrl;
  const tail = raw.replace(/[^A-Za-z0-9._-]+/g, "_").slice(-60).replace(/^[._]+/, "");
  return `.dm-screen/fog/${tail}-${fnv1a(mapUrl)}.png`;
}

export function gridCellRectAt(
  mapX: number,
  mapY: number,
  cfg: Pick<MapGridConfig, "pxPerSquare" | "gridOffsetX" | "gridOffsetY">
): CellRect {
  const s = cfg.pxPerSquare;
  const ix = Math.floor((mapX - cfg.gridOffsetX) / s);
  const iy = Math.floor((mapY - cfg.gridOffsetY) / s);
  return { x: cfg.gridOffsetX + ix * s, y: cfg.gridOffsetY + iy * s, w: s, h: s };
}

export async function loadFogSidecar(adapter: FogAdapter, mapUrl: string): Promise<string | null> {
  const path = fogSidecarPath(mapUrl);
  if (!(await adapter.exists(path))) return null;
  const buf = await adapter.readBinary(path);
  const bytes = new Uint8Array(buf);
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return `data:image/png;base64,${btoa(bin)}`;
}

export async function saveFogSidecar(adapter: FogAdapter, mapUrl: string, dataUrl: string): Promise<void> {
  for (const dir of [".dm-screen", ".dm-screen/fog"]) {
    if (!(await adapter.exists(dir))) await adapter.mkdir(dir);
  }
  const { bytes } = dataUrlToBytes(dataUrl);
  const buf = new ArrayBuffer(bytes.length);
  new Uint8Array(buf).set(bytes);
  await adapter.writeBinary(fogSidecarPath(mapUrl), buf);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `make typecheck && make test`
Expected: PASS (all suites; new file green)

- [ ] **Step 5: Commit**

```bash
git add src/map/fog.ts src/__tests__/map-fog.test.ts
SPEC_NOT_NEEDED=1 git commit -m "feat(map-screen): add pure fog helpers (sizing, sidecar path/IO, cell snap)"
```
(Spec for the whole feature lands in Task 7 within this PR; the local hook needs the override for intermediate commits that stage `src/` without spec files. If the hook accepts the commit without the prefix, drop it.)

---

### Task 2: `mapFogTvOpacity` setting

**Goal:** Global TV-side fog opacity, adjustable in Settings → Map Screen, live-rebroadcast when changed.

**Files:**
- Modify: `src/settings.ts` (interface ~line 81, defaults ~line 123, UI after the `mapDefaultPxPerSquare` setting ~line 220)

**Acceptance Criteria:**
- [ ] `mapFogTvOpacity: number` on `DmScreenSettings`, default `1`
- [ ] Slider 0.3–1 step 0.05 in the Map Screen settings section
- [ ] Changing it saves and re-broadcasts fog through the open DM panel (if any)

**Verify:** `make typecheck && make test` → green (settings-migration tests keep passing since the default merges in)

**Steps:**

- [ ] **Step 1: Add the field to the interface** (next to the other map fields):

```typescript
  mapFogTvOpacity: number; // fog opacity rendered on the map screen (1 = players see nothing beneath)
```

- [ ] **Step 2: Add the default** in `DEFAULT_SETTINGS`:

```typescript
  mapFogTvOpacity: 1,
```

- [ ] **Step 3: Add the slider** in the settings UI, right after the `mapDefaultPxPerSquare` Setting block (~line 220):

```typescript
    new Setting(containerEl)
      .setName("Fog opacity on the map screen")
      .setDesc("How dark fog of war renders on the table TV. 1 = fully opaque; lower lets players faintly see the map beneath.")
      .addSlider((slider) =>
        slider
          .setLimits(0.3, 1, 0.05)
          .setValue(this.plugin.settings.mapFogTvOpacity)
          .setDynamicTooltip()
          .onChange(async (v) => {
            this.plugin.settings.mapFogTvOpacity = v;
            await this.plugin.saveSettings();
            const panel = await this.plugin.findOpenDmControlPanel();
            panel?.mapPanel.broadcastFog();
          })
      );
```

Note: `broadcastFog` doesn't exist until Task 3. To keep every commit green, **implement Tasks 2 and 3 on the same branch and commit them together, or commit Task 2 after Task 3's panel API exists**. Recommended: do Task 2's steps, don't commit, proceed to Task 3, commit both. `mapPanel` must be a public field on `DmControlPanel` — check its declaration; if it's `private`, remove the modifier.

- [ ] **Step 4: Commit** — deferred into Task 3's commit.

---

### Task 3: MapScreenPanel fog lifecycle

**Goal:** The panel owns fog state: sidecar load on map apply, cache restore, republish for late joiners, reset on Stop Map, persist+broadcast on edits, and a Fog button that opens the modal.

**Files:**
- Modify: `src/views/MapScreenPanel.ts`
- Create: `src/__tests__/map-fog-panel.test.ts`
- Modify (if compilation demands the new setting in stubs): `src/__tests__/map-screen-panel-aoe.test.ts`

**Acceptance Criteria:**
- [ ] `fogDataUrl: string | null` field; `broadcastFog()` sends `{ type: "map-fog", payload: { dataUrl, opacity } }`
- [ ] `setVaultMap` loads the sidecar (or null) before broadcasting; broadcast order includes `map-fog`
- [ ] `commitFog(dataUrl)` persists the sidecar and broadcasts
- [ ] `stopMap` clears `fogDataUrl` (the `map-clear` purge handles the client/cache)
- [ ] `restoreFromCache` recovers `fogDataUrl` from the `map-fog` cache slot
- [ ] `republish` re-broadcasts fog when a map is active
- [ ] Fog button renders only while a map is active

**Verify:** `make test` → `map-fog-panel.test.ts` green

**Steps:**

- [ ] **Step 1: Write the failing tests**

```typescript
// src/__tests__/map-fog-panel.test.ts
import { describe, expect, it, vi } from "vitest";
import { MapScreenPanel } from "../views/MapScreenPanel";
import { fogSidecarPath } from "../map/fog";

interface Broadcast {
  type: string;
  payload: Record<string, unknown>;
}

const PNG_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

function makePanel(files: Record<string, Uint8Array> = {}) {
  const broadcasts: Broadcast[] = [];
  const adapter = {
    exists: (p: string) => Promise.resolve(p in files),
    readBinary: (p: string) => {
      const b = files[p];
      const buf = new ArrayBuffer(b.length);
      new Uint8Array(buf).set(b);
      return Promise.resolve(buf);
    },
    writeBinary: (p: string, data: ArrayBuffer) => {
      files[p] = new Uint8Array(data);
      return Promise.resolve();
    },
    mkdir: () => Promise.resolve(),
    getResourcePath: () => null,
  };
  const plugin = {
    settings: {
      mapConfigs: {} as Record<string, unknown>,
      mapDefaultPxPerSquare: 140,
      mapScreenProfiles: {},
      tvWidth: 1920,
      tvHeight: 1080,
      hydrusDefaultLoop: true,
      hydrusDefaultMuted: true,
      mapFogTvOpacity: 0.9,
    },
    server: { broadcast: (msg: Broadcast) => broadcasts.push(msg) },
    saveSettings: () => Promise.resolve(),
    broadcastMapCalibration: () => {},
    app: { vault: { adapter } },
  };
  const host = { render: vi.fn() };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const panel = new MapScreenPanel(plugin as any, host as any);
  return { panel, broadcasts, files };
}

describe("map fog lifecycle", () => {
  it("broadcastFog sends dataUrl and the configured opacity", () => {
    const { panel, broadcasts } = makePanel();
    panel.fogDataUrl = PNG_URL;
    panel.broadcastFog();
    const msg = broadcasts.find((b) => b.type === "map-fog");
    expect(msg?.payload).toEqual({ dataUrl: PNG_URL, opacity: 0.9 });
  });

  it("commitFog writes the sidecar and broadcasts", async () => {
    const { panel, broadcasts, files } = makePanel();
    panel.activeMap = { url: "/vault/maps/a.jpg", mediaType: "image", naturalWidth: 100, naturalHeight: 100 };
    await panel.commitFog(PNG_URL);
    expect(files[fogSidecarPath("/vault/maps/a.jpg")]).toBeDefined();
    expect(broadcasts.some((b) => b.type === "map-fog")).toBe(true);
  });

  it("stopMap clears fog state", () => {
    const { panel } = makePanel();
    panel.activeMap = { url: "/vault/x.png", mediaType: "image", naturalWidth: 10, naturalHeight: 10 };
    panel.fogDataUrl = PNG_URL;
    panel.stopMap();
    expect(panel.fogDataUrl).toBeNull();
  });

  it("restoreFromCache recovers fog from the map-fog slot", () => {
    const { panel } = makePanel();
    const cache = {
      "map-show": JSON.stringify({
        type: "map-show",
        payload: { url: "/vault/m.jpg", mediaType: "image", naturalWidth: 50, naturalHeight: 50 },
      }),
      "map-fog": JSON.stringify({ type: "map-fog", payload: { dataUrl: PNG_URL, opacity: 1 } }),
    };
    panel.restoreFromCache(cache);
    expect(panel.fogDataUrl).toBe(PNG_URL);
  });

  it("republish re-broadcasts fog while a map is active", () => {
    const { panel, broadcasts } = makePanel();
    panel.activeMap = { url: "/vault/m.jpg", mediaType: "image", naturalWidth: 50, naturalHeight: 50 };
    panel.fogDataUrl = PNG_URL;
    panel.republish();
    expect(broadcasts.filter((b) => b.type === "map-fog").length).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `make test`
Expected: FAIL — `fogDataUrl`/`broadcastFog`/`commitFog` don't exist

- [ ] **Step 3: Implement in `MapScreenPanel.ts`**

Imports:
```typescript
import { loadFogSidecar, saveFogSidecar, type FogAdapter } from "../map/fog";
import { MapFogModal } from "./MapFogModal"; // Task 4 — stub first if implementing out of order
```

Field (next to `aoes`):
```typescript
  fogDataUrl: string | null = null;
```

Adapter accessor (private, near `persistState`):
```typescript
  private fogAdapter(): FogAdapter {
    return this.plugin.app.vault.adapter as unknown as FogAdapter;
  }
```

Public API:
```typescript
  broadcastFog() {
    this.plugin.server?.broadcast({
      type: "map-fog",
      payload: { dataUrl: this.fogDataUrl, opacity: this.plugin.settings.mapFogTvOpacity },
    });
  }

  async commitFog(dataUrl: string) {
    this.fogDataUrl = dataUrl;
    if (this.activeMap) await saveFogSidecar(this.fogAdapter(), this.activeMap.url, dataUrl);
    this.broadcastFog();
  }
```

In `setVaultMap`, after `this.activeMap = { url, ... }` and before the broadcast block:
```typescript
    this.fogDataUrl = await loadFogSidecar(this.fogAdapter(), url);
```
and after `this.broadcastAoes(true);` add:
```typescript
    this.broadcastFog();
```

In `stopMap`, after `this.aoes = []`:
```typescript
    this.fogDataUrl = null;
```

In `restoreFromCache`, after the AoE block:
```typescript
    const fogCache = cache["map-fog"];
    if (fogCache) {
      try {
        this.fogDataUrl = ((JSON.parse(fogCache).payload as { dataUrl?: string | null })?.dataUrl ?? null);
      } catch { /* ignore */ }
    }
```

In `republish()`, after the AoE line:
```typescript
    this.broadcastFog();
```

Fog button in `renderSection`, after the `rotateBtn` block (map is active there):
```typescript
    const fogBtn = btnRow.createEl("button", { text: this.fogDataUrl ? "Fog ●" : "Fog" });
    fogBtn.title = "Edit fog of war";
    fogBtn.addEventListener("click", () => {
      new MapFogModal(this.plugin.app, this.plugin, this, map).open();
    });
```

Also apply Task 2's settings edits now (field, default, slider) and verify `mapPanel` on `DmControlPanel` is public (it's declared in `DmControlPanel.ts`; remove `private` if present).

- [ ] **Step 4: Verify**

Run: `make typecheck && make test`
Expected: PASS. If `MapFogModal` doesn't exist yet, create a minimal placeholder class (constructor + empty `onOpen`) that Task 4 fills in — or implement Task 4 before compiling.

- [ ] **Step 5: Commit (includes Task 2)**

```bash
git add src/views/MapScreenPanel.ts src/settings.ts src/__tests__/map-fog-panel.test.ts src/views/MapFogModal.ts src/views/DmControlPanel.ts
SPEC_NOT_NEEDED=1 git commit -m "feat(map-screen): fog lifecycle in MapScreenPanel + TV opacity setting"
```

---

### Task 4: `MapFogModal` (drawing UI) + styles

**Goal:** A large modal where the DM paints the mask: Reveal/Cover × Brush/Rectangle/Grid-cell, brush size slider, Reveal All / Cover All; each completed stroke commits (sidecar + broadcast).

**Files:**
- Create: `src/views/MapFogModal.ts`
- Modify: `styles.css` (append `dm-fog-*` rules)

**Acceptance Criteria:**
- [ ] Modal opens sized ~90vw with the map media and a semi-transparent fog overlay
- [ ] Brush stamps circles along the drag path (reveal = erase alpha, cover = paint black)
- [ ] Rectangle drags a marquee, commits on mouseup
- [ ] Grid-cell paints whole cells using the map's grid config (falls back to `mapDefaultPxPerSquare` semantics via `state.pxPerSquare`, which already defaults from it)
- [ ] Reveal All / Cover All clear/fill the whole mask and commit
- [ ] Every completed stroke calls `panel.commitFog(canvas.toDataURL("image/png"))`

**Verify:** `make typecheck && make test` green (canvas paths aren't unit-testable in JSDOM — the pure math is covered by Task 1; rendering by Task 6's visual test). Manual check via `make up` if desired.

**Steps:**

- [ ] **Step 1: Implement the modal**

```typescript
// src/views/MapFogModal.ts
import { App, Modal } from "obsidian";
import type DmScreenPlugin from "../main";
import type { MapScreenPanel, ActiveMap } from "./MapScreenPanel";
import { fogCanvasSize, gridCellRectAt } from "../map/fog";
import { vaultPathFromUrl } from "../server";
import { debug } from "../debug";

type FogTool = "brush" | "rect" | "cell";
type FogMode = "reveal" | "cover";

export class MapFogModal extends Modal {
  private tool: FogTool = "brush";
  private mode: FogMode = "reveal";
  private brushPct = 5;
  private fogCanvas: HTMLCanvasElement;
  private redrawOverlay: (() => void) | null = null;

  constructor(
    app: App,
    private plugin: DmScreenPlugin,
    private panel: MapScreenPanel,
    private map: ActiveMap
  ) {
    super(app);
    this.fogCanvas = this.buildFogCanvas();
  }

  private buildFogCanvas(): HTMLCanvasElement {
    const { width, height } = fogCanvasSize(this.map.naturalWidth, this.map.naturalHeight);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const existing = this.panel.fogDataUrl;
    if (existing) {
      const img = new Image();
      img.onload = () => {
        canvas.getContext("2d")!.drawImage(img, 0, 0, width, height);
        this.redrawOverlay?.();
      };
      img.src = existing;
    }
    return canvas;
  }

  private commit() {
    void this.panel.commitFog(this.fogCanvas.toDataURL("image/png"));
  }

  onOpen() {
    this.modalEl.addClass("dm-fog-modal");
    const { contentEl } = this;
    contentEl.createEl("h3", { text: "Fog of War" });

    const bar = contentEl.createDiv("dm-fog-toolbar");
    const modeBtns: Record<FogMode, HTMLButtonElement> = {} as never;
    const toolBtns: Record<FogTool, HTMLButtonElement> = {} as never;
    const syncActive = () => {
      for (const [m, b] of Object.entries(modeBtns)) b.classList.toggle("dm-fog-active", this.mode === m);
      for (const [t, b] of Object.entries(toolBtns)) b.classList.toggle("dm-fog-active", this.tool === t);
    };
    for (const m of ["reveal", "cover"] as FogMode[]) {
      modeBtns[m] = bar.createEl("button", { text: m === "reveal" ? "Reveal" : "Cover" });
      modeBtns[m].addEventListener("click", () => { this.mode = m; syncActive(); });
    }
    bar.createSpan({ text: "·", cls: "dm-status-detail" });
    const toolLabels: Record<FogTool, string> = { brush: "Brush", rect: "Rectangle", cell: "Grid cell" };
    for (const t of ["brush", "rect", "cell"] as FogTool[]) {
      toolBtns[t] = bar.createEl("button", { text: toolLabels[t] });
      toolBtns[t].addEventListener("click", () => { this.tool = t; syncActive(); });
    }
    syncActive();

    bar.createSpan({ text: "Brush", cls: "dm-status-detail" });
    const sizeSlider = bar.createEl("input", { type: "range" });
    sizeSlider.min = "2";
    sizeSlider.max = "15";
    sizeSlider.step = "1";
    sizeSlider.value = String(this.brushPct);
    sizeSlider.title = "Brush size (% of map width)";
    sizeSlider.addEventListener("input", () => { this.brushPct = parseInt(sizeSlider.value, 10); });

    const revealAll = bar.createEl("button", { text: "Reveal All" });
    revealAll.addEventListener("click", () => {
      this.ctx().clearRect(0, 0, this.fogCanvas.width, this.fogCanvas.height);
      this.redrawOverlay?.();
      this.commit();
    });
    const coverAll = bar.createEl("button", { text: "Cover All", cls: "mod-warning" });
    coverAll.addEventListener("click", () => {
      const ctx = this.ctx();
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = "black";
      ctx.fillRect(0, 0, this.fogCanvas.width, this.fogCanvas.height);
      this.redrawOverlay?.();
      this.commit();
    });

    const stage = contentEl.createDiv("dm-fog-stage");
    stage.style.aspectRatio = `${this.map.naturalWidth} / ${this.map.naturalHeight}`;

    const vaultPath = vaultPathFromUrl(this.map.url);
    const adapter = this.plugin.app.vault.adapter as { getResourcePath?: (p: string) => string };
    const resourceUrl = vaultPath ? adapter.getResourcePath?.(vaultPath) : null;
    if (resourceUrl) {
      if (this.map.mediaType === "video") {
        const v = stage.createEl("video");
        v.src = resourceUrl;
        v.muted = true;
        v.loop = true;
        v.autoplay = true;
        v.playsInline = true;
        v.play().catch(() => {});
      } else {
        const img = stage.createEl("img");
        img.src = resourceUrl;
        img.alt = "";
      }
    } else {
      debug("MapFogModal: no resource path for", this.map.url);
    }

    const overlay = stage.createEl("canvas", { cls: "dm-fog-overlay" });
    overlay.width = this.fogCanvas.width;
    overlay.height = this.fogCanvas.height;
    const octx = overlay.getContext("2d")!;
    const redraw = () => {
      octx.clearRect(0, 0, overlay.width, overlay.height);
      octx.globalAlpha = 0.55;
      octx.drawImage(this.fogCanvas, 0, 0);
      octx.globalAlpha = 1;
    };
    this.redrawOverlay = redraw;
    redraw();
    this.setupDrawing(overlay, redraw);
  }

  private ctx(): CanvasRenderingContext2D {
    return this.fogCanvas.getContext("2d")!;
  }

  private toFog(overlay: HTMLCanvasElement, clientX: number, clientY: number): { x: number; y: number } {
    const b = overlay.getBoundingClientRect();
    return {
      x: ((clientX - b.left) / b.width) * this.fogCanvas.width,
      y: ((clientY - b.top) / b.height) * this.fogCanvas.height,
    };
  }

  private applyMode(ctx: CanvasRenderingContext2D) {
    if (this.mode === "reveal") {
      ctx.globalCompositeOperation = "destination-out";
      ctx.fillStyle = "rgba(0,0,0,1)";
    } else {
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = "black";
    }
  }

  private setupDrawing(overlay: HTMLCanvasElement, redraw: () => void) {
    const fogScale = this.fogCanvas.width / this.map.naturalWidth;

    const stampBrush = (fx: number, fy: number) => {
      const ctx = this.ctx();
      this.applyMode(ctx);
      ctx.beginPath();
      ctx.arc(fx, fy, (this.fogCanvas.width * this.brushPct) / 100, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = "source-over";
    };

    const paintCell = (fx: number, fy: number) => {
      const cell = gridCellRectAt(fx / fogScale, fy / fogScale, {
        pxPerSquare: this.panel.state.pxPerSquare,
        gridOffsetX: this.panel.state.gridOffsetX,
        gridOffsetY: this.panel.state.gridOffsetY,
      });
      const ctx = this.ctx();
      this.applyMode(ctx);
      ctx.fillRect(cell.x * fogScale, cell.y * fogScale, cell.w * fogScale, cell.h * fogScale);
      ctx.globalCompositeOperation = "source-over";
    };

    overlay.addEventListener("mousedown", (e: MouseEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const start = this.toFog(overlay, e.clientX, e.clientY);

      if (this.tool === "rect") {
        const octx = overlay.getContext("2d")!;
        const onMove = (me: MouseEvent) => {
          const cur = this.toFog(overlay, me.clientX, me.clientY);
          redraw();
          octx.strokeStyle = this.mode === "reveal" ? "#7bd88f" : "#f97583";
          octx.setLineDash([6, 4]);
          octx.lineWidth = 2;
          octx.strokeRect(start.x, start.y, cur.x - start.x, cur.y - start.y);
          octx.setLineDash([]);
        };
        const onUp = (me: MouseEvent) => {
          document.removeEventListener("mousemove", onMove);
          document.removeEventListener("mouseup", onUp);
          const end = this.toFog(overlay, me.clientX, me.clientY);
          const ctx = this.ctx();
          this.applyMode(ctx);
          ctx.fillRect(
            Math.min(start.x, end.x),
            Math.min(start.y, end.y),
            Math.abs(end.x - start.x),
            Math.abs(end.y - start.y)
          );
          ctx.globalCompositeOperation = "source-over";
          redraw();
          this.commit();
        };
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
        return;
      }

      const paint = this.tool === "brush" ? stampBrush : paintCell;
      paint(start.x, start.y);
      redraw();
      const onMove = (me: MouseEvent) => {
        const p = this.toFog(overlay, me.clientX, me.clientY);
        paint(p.x, p.y);
        redraw();
      };
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        this.commit();
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });
  }

  onClose() {
    this.redrawOverlay = null;
    this.contentEl.empty();
  }
}
```

- [ ] **Step 2: Append styles to `styles.css`**

```css
/* ─── Map fog modal ─────────────────────────────────────────────── */
.dm-fog-modal {
  width: 90vw;
  max-width: 1400px;
}
.dm-fog-toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  margin-bottom: 8px;
}
.dm-fog-toolbar button.dm-fog-active {
  background: var(--interactive-accent);
  color: var(--text-on-accent);
}
.dm-fog-stage {
  position: relative;
  width: 100%;
  overflow: hidden;
  background: var(--background-secondary);
}
.dm-fog-stage img,
.dm-fog-stage video {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: fill;
}
.dm-fog-overlay {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  cursor: crosshair;
}
```

- [ ] **Step 3: Verify**

Run: `make typecheck && make test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/views/MapFogModal.ts styles.css
SPEC_NOT_NEEDED=1 git commit -m "feat(map-screen): fog editing modal with brush, rectangle, and grid-cell tools"
```

---

### Task 5: Map client rendering + server HTML + channel test

**Goal:** The `/map` page renders the fog mask over the media inside the stage transform, honoring the broadcast opacity; `map-clear` removes it; `map-fog` replays to late joiners.

**Files:**
- Modify: `src/server.ts` (map HTML template, ~line 357)
- Modify: `src/map/map.ts` (message handler ~line 138, `clearMap` ~line 214)
- Modify: `src/map/map.css`
- Modify: `src/__tests__/server-map-channel.test.ts`

**Acceptance Criteria:**
- [ ] `<img id="map-fog">` sits inside `#map-stage` after `#map-image`
- [ ] `map-fog` with a data URL validates via `safePlayerUrl(url, "image")`, shows the img with the payload opacity
- [ ] `map-fog` with `dataUrl: null` hides and empties the img
- [ ] `map-clear` hides fog
- [ ] Late-joining map clients replay `map-fog`; `map-clear` purges it (extend the existing channel test)

**Steps:**

- [ ] **Step 1: server.ts** — inside the map HTML template's `#map-stage`:

```html
    <div id="map-stage">
      <video id="map-video" muted loop playsinline></video>
      <img id="map-image" alt="" />
      <img id="map-fog" alt="" />
    </div>
```

- [ ] **Step 2: map.css** — check `#map-stage` is `position: relative` (or `absolute`); add:

```css
#map-fog {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  display: none;
  pointer-events: none;
}
```

If `#map-image` is not the stage's layout anchor (stage sized independently), match whatever positioning `#map-image` uses so both cover the same box.

- [ ] **Step 3: map.ts** — add the case in `handleMessage`:

```typescript
      case "map-fog":
        this.showFog(msg.payload as { dataUrl?: string | null; opacity?: number });
        break;
```

New method next to `showMap`:

```typescript
  private showFog(payload: { dataUrl?: string | null; opacity?: number }) {
    const fog = document.getElementById("map-fog") as HTMLImageElement;
    if (!payload.dataUrl) {
      fog.src = "";
      fog.style.display = "none";
      return;
    }
    const safeSrc = safePlayerUrl(payload.dataUrl, "image");
    if (!safeSrc) {
      console.warn("[Map Screen] Rejected fog data URL");
      return;
    }
    fog.src = safeSrc;
    fog.style.opacity = String(payload.opacity ?? 1);
    fog.style.display = "block";
  }
```

In `clearMap()`, after clearing the image:

```typescript
    const fog = document.getElementById("map-fog") as HTMLImageElement;
    fog.src = "";
    fog.style.display = "none";
```

- [ ] **Step 4: Extend `server-map-channel.test.ts`** — find the existing tests that (a) replay cached `map-*` state to a late joiner and (b) purge the map cache on `map-clear`; add `map-fog` to the broadcast set they exercise, e.g. broadcast `{ type: "map-fog", payload: { dataUrl: "data:image/png;base64,AAAA", opacity: 1 } }` alongside the existing `map-show` fixture and assert the late joiner receives it and that after `map-clear` it is gone. Follow the file's existing helper functions and assertion style exactly.

- [ ] **Step 5: Verify**

Run: `make typecheck && make test`
Expected: PASS, including the extended channel test

- [ ] **Step 6: Commit**

```bash
git add src/server.ts src/map/map.ts src/map/map.css src/__tests__/server-map-channel.test.ts
SPEC_NOT_NEEDED=1 git commit -m "feat(map-screen): render fog mask on the map client with configurable opacity"
```

---

### Task 6: Playwright visual regression

**Goal:** Pixel-level proof the fog renders correctly on the real map bundle under both scale modes.

**Files:**
- Create: `test/visual/map-fog.spec.ts`

**Acceptance Criteria:**
- [ ] Covers: full fog, a revealed circular hole, `dataUrl: null` (no fog) — in fit mode; plus one physical-mode snapshot
- [ ] Masks are generated deterministically in the harness (no DM-side drawing), same technique as `test/visual/layers-fog.spec.ts`
- [ ] Baselines generated **inside the container** via `make test-visual-update`

**Steps:**

- [ ] **Step 1:** Read `test/visual/layers-fog.spec.ts` and whichever existing map visual spec exists (check `test/visual/` for a map spec; if none, model the page-driving on how `layers-fog.spec.ts` boots the player page, but load `/map` and send `map-show`/`map-view`/`map-config`/`map-fog` over the test WebSocket). Generate masks with a tiny helper that builds a canvas PNG data URL in the browser context (full black; black with a transparent circle punched via `destination-out`).

- [ ] **Step 2:** Write the spec with four snapshots: `map-fog-full.png`, `map-fog-hole.png`, `map-fog-none.png`, `map-fog-physical.png`.

- [ ] **Step 3:** Run `make test-visual` (expect new-snapshot failures), then `make test-visual-update` to write baselines, then `make test-visual` again → PASS.

- [ ] **Step 4: Commit**

```bash
git add test/visual/map-fog.spec.ts test/visual/__snapshots__/
SPEC_NOT_NEEDED=1 git commit -m "test(map-screen): visual regression for map fog rendering"
```

(The `visual` CI job is informational, but keep it green.)

---

### Task 7: Feature specs (same PR — canonical contract)

**Goal:** `.agent/features/` reflects the new behaviour exactly; the PR passes `spec-update-check` naturally.

**Files:**
- Create: `.agent/features/map-screen/fog-of-war.md`
- Modify: `.agent/features/map-screen/overview.md`
- Modify: `.agent/features/player-server/websocket-protocol.md`

**Steps:**

- [ ] **Step 1: Create `fog-of-war.md`** (use `.agent/features/_template.md` shape):

```markdown
# Map Screen Fog of War

> A single PNG mask painted by the DM over the active battlemap: black hides, transparent reveals. Edited in a dedicated modal (brush / rectangle / grid-cell, reveal or cover), rendered on the map screen inside the stage transform, and persisted per map as a vault sidecar PNG keyed by the map's `/vault/` URL — note images and Hydrus-cached files alike.

## Source files

- `src/map/fog.ts` — `FOG_RESOLUTION`, `fogCanvasSize`, `fogSidecarPath`, `gridCellRectAt`, `loadFogSidecar`, `saveFogSidecar`, `FogAdapter`
- `src/views/MapFogModal.ts` — the editing modal (toolbar, stage, drawing handlers)
- `src/views/MapScreenPanel.ts` — `fogDataUrl`, `broadcastFog`, `commitFog`, sidecar load in `setVaultMap`, restore in `restoreFromCache`, re-emit in `republish`, reset in `stopMap`, the Fog button
- `src/map/map.ts` — `showFog`, fog clearing in `clearMap`
- `src/server.ts` — `#map-fog` element in the map page HTML
- `src/settings.ts` — `mapFogTvOpacity`

## Settings used

- `mapFogTvOpacity` — fog opacity on the map screen (default 1); changing it re-broadcasts through the open DM panel

## Requirements

1. While a map is active, the Map Screen section shall render a Fog button that opens `MapFogModal`; the label carries a `●` marker when the map has fog.
2. The fog mask shall be an offscreen canvas of width 1024 and height `round(1024 × naturalH/naturalW)` (min 1); black = hidden, transparent = revealed. A map with no stored fog starts fully transparent.
3. The modal shall offer Reveal/Cover modes × Brush (stamped circles sized by a 2–15% slider), Rectangle (dashed marquee, committed on mouseup), and Grid-cell (whole cells snapped via `gridCellRectAt` from the map's `pxPerSquare`/`gridOffsetX`/`gridOffsetY`) tools, plus Reveal All and Cover All. Reveal composites with `destination-out`; Cover paints opaque black. Fog renders at 0.55 alpha inside the modal so the DM sees the map beneath.
4. When a stroke completes (mouseup) or Reveal All / Cover All is clicked, the DM panel shall re-encode the mask as a PNG data URL, write it to the sidecar, and broadcast `map-fog { dataUrl, opacity: mapFogTvOpacity }`.
5. The sidecar shall live at `.dm-screen/fog/<tail>-<fnv1a(mapUrl)>.png`, where `<tail>` is the sanitized last 60 chars of the decoded vault path — deterministic per map URL, identical for note-image and Hydrus-cached maps.
6. When a map is applied, `setVaultMap` shall load the sidecar (dotfolder-safe `adapter.exists` + `readBinary`) into `fogDataUrl` (or null) and broadcast `map-fog` alongside the other map messages.
7. When the map client receives `map-fog` with a data URL, it shall validate it with `safePlayerUrl(url, "image")` and display `#map-fog` (an `<img>` inside `#map-stage`, covering the media) at the payload opacity; `dataUrl: null` hides it. Rejected URLs are logged and skipped.
8. `map-clear` shall hide the fog on the client; `stopMap` resets `fogDataUrl` — the sidecar is never deleted, so re-adding the map restores its fog.
9. `restoreFromCache` shall recover `fogDataUrl` from the `map-fog` cache slot; `republish()` shall re-broadcast `map-fog` while a map is active.
10. When `mapFogTvOpacity` changes in settings, the plugin shall re-broadcast fog through the open DM Control Panel so connected screens update live.

## Broadcast / IPC

| Message type | Direction | Payload | When |
|--------------|-----------|---------|------|
| `map-fog` | DM → map | `{ dataUrl: string \| null, opacity: number }` | Map apply; every completed edit; opacity setting change; `republishToServer()` |

## Tests covering this

- `src/__tests__/map-fog.test.ts` — canvas sizing, sidecar path derivation/IO, grid-cell snapping
- `src/__tests__/map-fog-panel.test.ts` — panel lifecycle: broadcast shape, commit persistence, stop/restore/republish
- `src/__tests__/server-map-channel.test.ts` — `map-fog` replay to late joiners and purge on `map-clear`
- `test/visual/map-fog.spec.ts` — Playwright rendering: full fog, revealed hole, no fog, physical mode

## Non-goals

- Character vision shapes (feet-sized, feathered-edge, live-movable) — a planned future feature layered on this mask.
- Fog on the player screen at `/` (it has its own per-layer fog, `../fog-of-war/overview.md`).
- Deleting sidecars from the UI. Stale fog files are cleaned up manually in `.dm-screen/fog/`.
- Undo history inside the modal. Strokes are destructive; Reveal All / Cover All are the recovery tools.
- Per-map opacity. `mapFogTvOpacity` is global.
```

- [ ] **Step 2: `map-screen/overview.md` edits:**
  - Non-goals, first bullet: change `Tokens, fog of war, or initiative on the map screen.` → `Tokens or initiative on the map screen.`
  - Requirement 9 control list: after `a Rotate button (90° steps),` insert `a Fog button (see fog-of-war.md),`
  - Add requirement 15: `15. While a map is active, the DM section shall expose fog of war editing and the map client shall render the fog mask; the full contract lives in fog-of-war.md.`
  - Source files: add `- src/map/fog.ts, src/views/MapFogModal.ts — fog of war (see fog-of-war.md)`
  - Settings used: add `- mapFogTvOpacity — TV-side fog opacity (see fog-of-war.md)`

- [ ] **Step 3: `player-server/websocket-protocol.md` edits:**
  - Table: after the `map-aoe-sync` row add:
    `| map-fog | DM → map | { dataUrl: string \| null, opacity: number } | Map apply; fog edit committed; opacity setting change; republishToServer() | yes |`
  - Requirement 9 URL-sink list: add `map-fog.payload.dataUrl` to the enumerated payload URL fields.

- [ ] **Step 4: Re-read all three specs end-to-end against the diff** (AGENTS.md protocol step 5) — verify every named identifier (`fogCanvasSize`, `commitFog`, `#map-fog`, `dm-fog-*` classes, `mapFogTvOpacity`) exists in the code.

- [ ] **Step 5: Commit**

```bash
git add .agent/features/
git commit -m "docs(map-screen): spec fog of war (mask, modal tools, sidecar persistence, map-fog message)"
```

---

### Task 8: Full verify, PR, release

**Goal:** Green CI, squash-merge, minor release shipped.

**Acceptance Criteria:**
- [ ] `make typecheck && make test` green locally; `make test-visual` green
- [ ] PR `feat(map-screen): add fog of war to battlemaps` with label `release:minor` (new user-facing capability + new spec dir file)
- [ ] All six required checks pass; squash-merge; release publishes

**Steps:**

- [ ] **Step 1:** `grep '"version"' manifest.json` — currently `0.27.0`, no `-beta.N`, no bump needed (the branch was created after the 0.27.x stables; a non-beta manifest never triggers a prerelease publish).
- [ ] **Step 2:** `make typecheck && make test` → all green. Paste output as evidence.
- [ ] **Step 3:** Push with the SSH-443 rewrite:
```bash
git -c url."ssh://git@ssh.github.com:443/".insteadOf="git@github.com:" push -u origin feature/map-fog-of-war
```
- [ ] **Step 4:** `gh pr create` against `main`, title `feat(map-screen): add fog of war to battlemaps`, label `release:minor`, body summarizing: mask architecture, modal tools, sidecar persistence (note + Hydrus), TV opacity setting, `map-fog` message, spec files, test coverage.
- [ ] **Step 5:** `gh pr checks <N> --watch` → all pass → `gh pr merge <N> --squash` → verify the minor release (0.28.0) publishes via `gh release list`.

---

## Execution notes for the coordinator

- Tasks 2+3 commit together (Task 2's slider references Task 3's `broadcastFog`). Task 4 can be implemented before 3 compiles or stubbed — simplest order: 1 → (3+2+4 in one working session, three logical commits or one) → 5 → 6 → 7 → 8.
- Task 6 (visual) depends on Task 5 (client rendering). Task 7 needs the final identifiers from 1–5.
- Implementer subagents MUST NOT create native tasks (the commit hook blocks commits while tasks are open — the coordinator owns task state).
- If the local `bash-precheck.sh` hook rejects a `SPEC_NOT_NEEDED=1` intermediate commit for another reason, read the hook message and fix the underlying violation — never bypass.
