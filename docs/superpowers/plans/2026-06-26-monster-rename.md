# Ephemeral Monster Rename Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the DM right-click a D&D Beyond monster row to give it an ephemeral display name (shown clean on the player screen, prefixed with `*` on the DM side) and to edit its conditions through a multi-select modal.

**Architecture:** Add a twin of the existing `monsterStatuses` map — `monsterNames: Map<instanceKey, string>` on `DnDBeyondPanel` — resolved into the display name inside `buildParticipants`. The player payload forwards only the resolved name; the DM preview prepends `*`. Right-click opens a top-level Obsidian `Menu` (`Rename…`, `Reset name`, `Conditions…`); `Rename…` and `Conditions…` open dedicated `Modal` subclasses. Conditions move from the old per-click `Menu` toggles into an atomic checkbox modal with an Exhaustion `<select>`.

**Tech Stack:** TypeScript (strict), Obsidian 1.12.3 API (`Modal`, `Menu`), Vitest, esbuild — all via Docker `make` targets.

**User Verification:** YES — the user explicitly asked to "genera una beta para probarlo". A final task cuts the beta prerelease and asks the user to confirm it behaves correctly in their vault (player screen shows the new name, DM side shows `*`, conditions modal works).

---

## File Structure

| File | Responsibility | Action |
|------|----------------|--------|
| `src/views/DnDBeyondPanel.ts` | ephemeral `monsterNames` map, name resolution in `buildParticipants`, `*` in `buildPreviewRow`, right-click menu, apply/reset entry points | Modify |
| `src/views/RenameMonsterModal.ts` | capture a new display name, return trimmed value via callback | Create |
| `src/views/MonsterConditionsModal.ts` | edit the full condition set atomically (checkboxes + Exhaustion select), return new `Set` via callback | Create |
| `src/__tests__/ddb-panel-rename.test.ts` | name resolution, broadcast cleanliness, DM `*`, reset, clearing | Create |
| `src/__tests__/rename-monster-modal.test.ts` | modal submit/trim/cancel behaviour | Create |
| `src/__tests__/monster-conditions-modal.test.ts` | modal initial state, Apply union, Clear all, Cancel | Create |
| `.agent/features/dndbeyond-integration/encounters-and-tracking.md` | spec: statuses via modal + name-override channel | Modify |
| `.agent/features/combat-tracker/overview.md` | spec: right-click menu + conditions modal + name override | Modify |

---

## Task 1: Ephemeral `monsterNames` state, resolution, and apply/reset entry points

**Goal:** `DnDBeyondPanel` holds an ephemeral name override per monster instance, resolves it into the broadcast name, exposes `applyMonsterName`/`resetMonsterName`, and clears the map on encounter switch / stop.

**Files:**
- Modify: `src/views/DnDBeyondPanel.ts` (`PreviewCombatant` type, `monsterStatuses` neighbour field, `buildParticipants` monster branch, `selectEncounter`, `stopTracking`, new methods)
- Create: `src/__tests__/ddb-panel-rename.test.ts`

**Acceptance Criteria:**
- [ ] `monsterNames: Map<string, string>` exists alongside `monsterStatuses` and is cleared in `selectEncounter` and `stopTracking`.
- [ ] When an override exists for a monster's instance key, the broadcast combatant's `name` is the override; otherwise the original DDB name.
- [ ] The broadcast payload contains **no** `renamed` or `originalName` fields (player gets a clean name).
- [ ] `PreviewCombatant` carries `originalName: string` and `renamed: boolean`.
- [ ] `applyMonsterName(key, name)` sets the override; passing an empty/whitespace name is a no-op; passing a name equal to the participant's original name deletes the override. `resetMonsterName(key)` deletes the override. Both re-broadcast and re-render.

**Verify:** `make test` → `ddb-panel-rename.test.ts` passes; `make typecheck` clean.

**Steps:**

- [ ] **Step 1: Write the failing test** — create `src/__tests__/ddb-panel-rename.test.ts`. Reuse the polyfill `beforeAll` and `makeState`/`makePlugin` helpers from `ddb-panel-tracking-state.test.ts` (copy them — the existing file does not export them).

```ts
import { beforeAll, describe, expect, it, vi } from "vitest";
import { DnDBeyondPanel } from "../views/DnDBeyondPanel";

beforeAll(() => {
  if (!HTMLElement.prototype.empty) {
    (HTMLElement.prototype as any).empty = function () {
      while (this.firstChild) this.removeChild(this.firstChild);
    };
  }
  if (!HTMLElement.prototype.addClass) {
    HTMLElement.prototype.addClass = function (cls: string) { this.classList.add(cls); };
  }
  if (!HTMLElement.prototype.createDiv) {
    (HTMLElement.prototype as any).createDiv = function (arg?: string | { cls?: string; text?: string }) {
      const div = document.createElement("div");
      if (typeof arg === "string") div.className = arg;
      else if (arg) { if (arg.cls) div.className = arg.cls; if (arg.text) div.textContent = arg.text; }
      this.appendChild(div);
      return div;
    };
  }
  if (!HTMLElement.prototype.createEl) {
    (HTMLElement.prototype as any).createEl = function (tag: string, opts?: { type?: string; text?: string; cls?: string; attr?: Record<string, string> }) {
      const el = document.createElement(tag);
      if (opts?.type) (el as HTMLInputElement).type = opts.type;
      if (opts?.cls) el.className = opts.cls;
      if (opts?.text) el.textContent = opts.text;
      if (opts?.attr) for (const [k, v] of Object.entries(opts.attr)) el.setAttribute(k, v);
      this.appendChild(el);
      return el;
    };
  }
  if (!HTMLElement.prototype.createSpan) {
    (HTMLElement.prototype as any).createSpan = function (opts?: { text?: string; cls?: string }) {
      const el = document.createElement("span");
      if (opts?.cls) el.className = opts.cls;
      if (opts?.text) el.textContent = opts.text;
      this.appendChild(el);
      return el;
    };
  }
  if (!HTMLElement.prototype.setText) {
    (HTMLElement.prototype as any).setText = function (text: string) { this.textContent = text; };
  }
});

function makePlugin() {
  return { settings: { ddbCobaltSession: "" }, sendInitiativeUpdate: vi.fn() } as any;
}

function makeState(participants: Array<{ name: string; initiative: number }>) {
  const monsters = participants.map((p, i) => ({
    id: 100 + i, name: p.name, initiative: p.initiative,
    currentHitPoints: 10, maximumHitPoints: 10, uniqueId: `monster-uid-${i}`,
  }));
  return {
    encounter: {
      id: "e1", name: "Test Encounter", roundNum: 1, turnNum: 1, inProgress: true,
      players: [], monsters, manualEntries: [],
    },
    characters: new Map(),
  } as any;
}

describe("DnDBeyondPanel monsterNames", () => {
  it("broadcasts the override name, clean (no renamed/originalName fields)", () => {
    const plugin = makePlugin();
    const panel = new DnDBeyondPanel(plugin, document.createElement("div"));
    (panel as any).showFullTurnOrder = true;
    const state = makeState([{ name: "Goblin", initiative: 12 }]);
    (panel as any).monsterNames.set("monster-uid-0", "Sneaky Pete");
    (panel as any).broadcastToPlayerScreen(state);
    const sent = plugin.sendInitiativeUpdate.mock.calls[0][0];
    expect(sent[0].name).toBe("Sneaky Pete");
    expect(sent[0]).not.toHaveProperty("renamed");
    expect(sent[0]).not.toHaveProperty("originalName");
  });

  it("keeps overrides per-instance for duplicate template ids", () => {
    const plugin = makePlugin();
    const panel = new DnDBeyondPanel(plugin, document.createElement("div"));
    (panel as any).showFullTurnOrder = true;
    const state = makeState([
      { name: "Goblin (A)", initiative: 12 },
      { name: "Goblin (B)", initiative: 11 },
    ]);
    (panel as any).monsterNames.set("monster-uid-0", "Boss");
    (panel as any).broadcastToPlayerScreen(state);
    const sent = plugin.sendInitiativeUpdate.mock.calls[0][0];
    expect(sent[0].name).toBe("Boss");
    expect(sent[1].name).toBe("Goblin (B)");
  });

  it("buildParticipants marks renamed and keeps originalName", () => {
    const panel = new DnDBeyondPanel(makePlugin(), document.createElement("div"));
    (panel as any).showFullTurnOrder = true;
    const state = makeState([{ name: "Goblin", initiative: 12 }]);
    (panel as any).monsterNames.set("monster-uid-0", "Pete");
    const { participants } = (panel as any).buildParticipants(state);
    expect(participants[0].name).toBe("Pete");
    expect(participants[0].originalName).toBe("Goblin");
    expect(participants[0].renamed).toBe(true);
  });

  it("applyMonsterName: empty is a no-op, equal-to-original resets, else sets", () => {
    const plugin = makePlugin();
    const panel = new DnDBeyondPanel(plugin, document.createElement("div"));
    (panel as any).showFullTurnOrder = true;
    (panel as any).polledState = makeState([{ name: "Goblin", initiative: 12 }]);

    (panel as any).applyMonsterName("monster-uid-0", "   ");
    expect((panel as any).monsterNames.has("monster-uid-0")).toBe(false);

    (panel as any).applyMonsterName("monster-uid-0", "Pete");
    expect((panel as any).monsterNames.get("monster-uid-0")).toBe("Pete");

    (panel as any).applyMonsterName("monster-uid-0", "Goblin");
    expect((panel as any).monsterNames.has("monster-uid-0")).toBe(false);
  });

  it("resetMonsterName deletes the override and re-broadcasts", () => {
    const plugin = makePlugin();
    const panel = new DnDBeyondPanel(plugin, document.createElement("div"));
    (panel as any).showFullTurnOrder = true;
    (panel as any).polledState = makeState([{ name: "Goblin", initiative: 12 }]);
    (panel as any).monsterNames.set("monster-uid-0", "Pete");
    (panel as any).resetMonsterName("monster-uid-0");
    expect((panel as any).monsterNames.has("monster-uid-0")).toBe(false);
    expect(plugin.sendInitiativeUpdate).toHaveBeenCalled();
  });

  it("stopTracking clears monsterNames", () => {
    const panel = new DnDBeyondPanel(makePlugin(), document.createElement("div"));
    (panel as any).poller = { stop: vi.fn() };
    (panel as any).selectedEncounterId = "enc-1";
    (panel as any).monsterNames.set("monster-uid-0", "Pete");
    panel.stopTracking();
    expect((panel as any).monsterNames.size).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `make test` (or scope: the new file).
Expected: FAIL — `monsterNames` undefined / `applyMonsterName` not a function.

- [ ] **Step 3: Add the `monsterNames` field** in `DnDBeyondPanel.ts`, immediately after the `monsterStatuses` declaration (around line 46):

```ts
  // Ephemeral DM-assigned display name overrides for DDB monsters, keyed by the
  // same per-instance key as monsterStatuses. The override is broadcast to the
  // player screen as the monster's name; the DM preview marks it with a "*".
  // Cleared on encounter switch and on stopTracking. Never persisted.
  private monsterNames = new Map<string, string>();
```

- [ ] **Step 4: Extend `PreviewCombatant`** (around lines 10-27) with two DM-only fields:

```ts
  // DM-side only: the unmodified DDB name and whether an override is active.
  // Never forwarded to the player payload.
  originalName: string;
  renamed: boolean;
```

- [ ] **Step 5: Resolve the override in `buildParticipants`** — replace the monster branch `participants.push({ … })` (around lines 270-283) with:

```ts
      } else if (p.kind === "monster") {
        const key = monsterInstanceKey(p);
        const monsterStatuses = this.monsterStatuses.get(key);
        const override = this.monsterNames.get(key);
        participants.push({
          name: override ?? p.name,
          originalName: p.name,
          renamed: override != null,
          hp: (p as { currentHitPoints: number }).currentHitPoints,
          maxHp: (p as { maximumHitPoints: number }).maximumHitPoints,
          initiative: p.initiative,
          active: isActive,
          friendly: false,
          isPlayer: false,
          hidden,
          hideHp: false,
          statuses: monsterStatuses ? [...monsterStatuses] : [],
          inspired: false,
          monsterKey: key,
        });
```

- [ ] **Step 6: Add `originalName`/`renamed` to the player and manual branches** so the type is satisfied (these are not monsters, so `originalName` mirrors `name` and `renamed` is `false`). In the player branch add `originalName: char?.name ?? p.name, renamed: false,` and in the manual branch add `originalName: p.name, renamed: false,`.

- [ ] **Step 7: Clear `monsterNames` in `selectEncounter` and `stopTracking`** — add `this.monsterNames.clear();` next to each existing `this.monsterStatuses.clear();` (lines ~165 and ~194).

- [ ] **Step 8: Add the apply/reset entry points** near `applyMonsterStatusChange` (around line 437):

```ts
  applyMonsterName(monsterKey: string, rawName: string): void {
    const name = rawName.trim();
    const original = this.originalNameFor(monsterKey);
    if (name.length === 0) {
      // empty = no-op; do not create or clear an override
    } else if (original != null && name === original) {
      this.monsterNames.delete(monsterKey);
    } else {
      this.monsterNames.set(monsterKey, name);
    }
    this.applyMonsterStatusChange();
  }

  resetMonsterName(monsterKey: string): void {
    this.monsterNames.delete(monsterKey);
    this.applyMonsterStatusChange();
  }

  private originalNameFor(monsterKey: string): string | null {
    if (!this.polledState) return null;
    for (const m of this.polledState.encounter.monsters ?? []) {
      if (monsterInstanceKey(m) === monsterKey) return m.name;
    }
    return null;
  }
```

Note: `applyMonsterStatusChange` already guards on `this.polledState` and does broadcast + re-render, so it is the right shared commit path.

- [ ] **Step 9: Run test to verify it passes**

Run: `make test`
Expected: PASS for `ddb-panel-rename.test.ts`; existing `ddb-panel-tracking-state.test.ts` still green (broadcast shape unchanged — `renamed`/`originalName` are NOT in the `broadcastToPlayerScreen` mapper). Run `make typecheck` — clean.

- [ ] **Step 10: Commit**

```bash
git add src/views/DnDBeyondPanel.ts src/__tests__/ddb-panel-rename.test.ts
git commit -m "feat(dndbeyond): add ephemeral monster name override state"
```

```json:metadata
{"files": ["src/views/DnDBeyondPanel.ts", "src/__tests__/ddb-panel-rename.test.ts"], "verifyCommand": "make test", "acceptanceCriteria": ["monsterNames map cleared on select/stop", "broadcast uses override name with no renamed/originalName fields", "PreviewCombatant has originalName+renamed", "applyMonsterName empty=noop equal=reset else=set"], "requiresUserVerification": false}
```

---

## Task 2: DM-side `*` marker in the preview

**Goal:** The DM preview row prepends `* ` to a renamed monster's name; the player screen is unaffected (no code change there).

**Files:**
- Modify: `src/views/DnDBeyondPanel.ts` (`buildPreviewRow`, around lines 522-531)
- Modify: `src/__tests__/ddb-panel-rename.test.ts` (add preview assertions)

**Acceptance Criteria:**
- [ ] When `c.renamed === true`, the `.init-name` text starts with `* `.
- [ ] When `c.renamed === false`, the name has no `*` prefix.
- [ ] The `*` is part of the DM preview DOM only (`buildPreviewRow`), never the broadcast.

**Verify:** `make test` → new preview assertions pass.

**Steps:**

- [ ] **Step 1: Write the failing test** — append to `ddb-panel-rename.test.ts`:

```ts
import { DnDBeyondPanel as Panel } from "../views/DnDBeyondPanel";

describe("DM preview rename marker", () => {
  function renderRow(panel: any, key: string, name: string, renamed: boolean): HTMLElement {
    panel.previewEl = document.createElement("div");
    panel.previewEl.createEl("ul", { cls: "dm-ddb-preview-list" });
    panel.polledState = makeState([{ name, initiative: 12 }]);
    if (renamed) panel.monsterNames.set(key, name);
    panel.showFullTurnOrder = true;
    panel.renderPreview();
    return panel.previewEl.querySelector(".init-name") as HTMLElement;
  }

  it("prefixes a renamed monster with '* '", () => {
    const panel = new Panel(makePlugin(), document.createElement("div")) as any;
    const nameEl = renderRow(panel, "monster-uid-0", "Sneaky Pete", true);
    expect(nameEl.textContent?.startsWith("* ")).toBe(true);
    expect(nameEl.textContent).toContain("Sneaky Pete");
  });

  it("does not prefix a non-renamed monster", () => {
    const panel = new Panel(makePlugin(), document.createElement("div")) as any;
    const nameEl = renderRow(panel, "monster-uid-0", "Goblin", false);
    expect(nameEl.textContent?.startsWith("*")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `make test`
Expected: FAIL — name has no `*` prefix yet.

- [ ] **Step 3: Implement the marker** in `buildPreviewRow` — replace `nameEl.textContent = c.name;` (line ~524) with:

```ts
  nameEl.textContent = c.renamed ? `* ${c.name}` : c.name;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `make test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/views/DnDBeyondPanel.ts src/__tests__/ddb-panel-rename.test.ts
git commit -m "feat(dndbeyond): mark renamed monsters with a leading asterisk in the DM preview"
```

```json:metadata
{"files": ["src/views/DnDBeyondPanel.ts", "src/__tests__/ddb-panel-rename.test.ts"], "verifyCommand": "make test", "acceptanceCriteria": ["renamed row name starts with '* '", "non-renamed row has no '*'", "marker only in DM preview"], "requiresUserVerification": false}
```

---

## Task 3: `RenameMonsterModal`

**Goal:** A modal with a pre-filled text input that returns the trimmed entered name to a callback on Save (or Enter), and is a no-op on Cancel.

**Files:**
- Create: `src/views/RenameMonsterModal.ts`
- Create: `src/__tests__/rename-monster-modal.test.ts`

**Acceptance Criteria:**
- [ ] Input is pre-filled with the supplied current name.
- [ ] Save (and Enter) calls `onSubmit(trimmedValue)` then closes.
- [ ] Cancel closes without calling `onSubmit`.

**Verify:** `make test` → `rename-monster-modal.test.ts` passes.

**Steps:**

- [ ] **Step 1: Write the failing test** — create `src/__tests__/rename-monster-modal.test.ts` (reuse the same polyfill `beforeAll` block as Task 1; abbreviated here as `/* polyfills */` — copy the full block verbatim from Task 1 Step 1):

```ts
import { beforeAll, describe, expect, it, vi } from "vitest";
import { RenameMonsterModal } from "../views/RenameMonsterModal";

beforeAll(() => { /* paste the full polyfill block from Task 1 Step 1 here */ });

describe("RenameMonsterModal", () => {
  it("pre-fills the input with the current name", () => {
    const modal = new RenameMonsterModal({} as any, "Goblin (A)", vi.fn());
    modal.onOpen();
    const input = modal.contentEl.querySelector("input") as HTMLInputElement;
    expect(input.value).toBe("Goblin (A)");
  });

  it("Save submits the trimmed value and closes", () => {
    const onSubmit = vi.fn();
    const modal = new RenameMonsterModal({} as any, "Goblin", onSubmit);
    const closeSpy = vi.spyOn(modal, "close");
    modal.onOpen();
    const input = modal.contentEl.querySelector("input") as HTMLInputElement;
    input.value = "  Sneaky Pete  ";
    const save = modal.contentEl.querySelector(".mod-cta") as HTMLButtonElement;
    save.click();
    expect(onSubmit).toHaveBeenCalledWith("Sneaky Pete");
    expect(closeSpy).toHaveBeenCalledOnce();
  });

  it("Enter in the input submits", () => {
    const onSubmit = vi.fn();
    const modal = new RenameMonsterModal({} as any, "Goblin", onSubmit);
    modal.onOpen();
    const input = modal.contentEl.querySelector("input") as HTMLInputElement;
    input.value = "Pete";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(onSubmit).toHaveBeenCalledWith("Pete");
  });

  it("Cancel closes without submitting", () => {
    const onSubmit = vi.fn();
    const modal = new RenameMonsterModal({} as any, "Goblin", onSubmit);
    const closeSpy = vi.spyOn(modal, "close");
    modal.onOpen();
    const cancel = modal.contentEl.querySelectorAll("button")[0] as HTMLButtonElement;
    cancel.click();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(closeSpy).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `make test`
Expected: FAIL — module `RenameMonsterModal` not found.

- [ ] **Step 3: Implement the modal** — create `src/views/RenameMonsterModal.ts`:

```ts
import { App, Modal } from "obsidian";

export class RenameMonsterModal extends Modal {
  private currentName: string;
  private onSubmit: (name: string) => void;

  constructor(app: App, currentName: string, onSubmit: (name: string) => void) {
    super(app);
    this.currentName = currentName;
    this.onSubmit = onSubmit;
  }

  onOpen(): void {
    this.modalEl.addClass("dm-rename-modal");
    this.titleEl.setText("Rename monster");
    const { contentEl } = this;
    contentEl.empty();

    const row = contentEl.createDiv({ cls: "dm-rename-modal-row" });
    const input = row.createEl("input", {
      type: "text",
      cls: "dm-rename-modal-input",
      attr: { placeholder: "Display name" },
    }) as HTMLInputElement;
    input.value = this.currentName;
    input.addEventListener("keydown", (evt) => {
      if (evt.key === "Enter") {
        evt.preventDefault();
        this.submit(input.value);
      }
    });

    const buttons = contentEl.createDiv({ cls: "dm-rename-modal-buttons" });
    const cancelBtn = buttons.createEl("button", { text: "Cancel" }) as HTMLButtonElement;
    cancelBtn.addEventListener("click", () => this.close());
    const saveBtn = buttons.createEl("button", { text: "Save", cls: "mod-cta" }) as HTMLButtonElement;
    saveBtn.addEventListener("click", () => this.submit(input.value));

    input.focus();
    input.select();
  }

  private submit(value: string): void {
    this.onSubmit(value.trim());
    this.close();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `make test`
Expected: PASS. Run `make typecheck` — clean.

- [ ] **Step 5: Commit**

```bash
git add src/views/RenameMonsterModal.ts src/__tests__/rename-monster-modal.test.ts
git commit -m "feat(dndbeyond): add RenameMonsterModal for ephemeral monster names"
```

```json:metadata
{"files": ["src/views/RenameMonsterModal.ts", "src/__tests__/rename-monster-modal.test.ts"], "verifyCommand": "make test", "acceptanceCriteria": ["input pre-filled", "Save+Enter submit trimmed value and close", "Cancel closes without submit"], "requiresUserVerification": false}
```

---

## Task 4: `MonsterConditionsModal`

**Goal:** A modal listing the 14 conditions (icon + name + checkbox) plus an Exhaustion `<select>` (None / 1..6) and a `Clear all` button, returning the new `Set<string>` atomically on Apply.

**Files:**
- Create: `src/views/MonsterConditionsModal.ts`
- Create: `src/__tests__/monster-conditions-modal.test.ts`

**Acceptance Criteria:**
- [ ] Checkboxes reflect the initial `Set` (checked for present condition ids); Exhaustion select reflects the initial level (None when absent).
- [ ] `Apply` calls `onApply(newSet)` (union of checked conditions + encoded exhaustion) then closes.
- [ ] `Clear all` unchecks every condition and sets Exhaustion to None (does not itself apply).
- [ ] `Cancel` closes without calling `onApply`.

**Verify:** `make test` → `monster-conditions-modal.test.ts` passes.

**Steps:**

- [ ] **Step 1: Write the failing test** — create `src/__tests__/monster-conditions-modal.test.ts` (reuse the full polyfill `beforeAll` block from Task 1 Step 1):

```ts
import { beforeAll, describe, expect, it, vi } from "vitest";
import { MonsterConditionsModal } from "../views/MonsterConditionsModal";

beforeAll(() => { /* paste the full polyfill block from Task 1 Step 1 here */ });

describe("MonsterConditionsModal", () => {
  it("checks conditions present in the initial set and sets exhaustion level", () => {
    const modal = new MonsterConditionsModal({} as any, new Set(["poisoned", "exhaustion:3"]), vi.fn());
    modal.onOpen();
    const poisoned = modal.contentEl.querySelector('input[data-cond="poisoned"]') as HTMLInputElement;
    const blinded = modal.contentEl.querySelector('input[data-cond="blinded"]') as HTMLInputElement;
    const exhaustion = modal.contentEl.querySelector("select") as HTMLSelectElement;
    expect(poisoned.checked).toBe(true);
    expect(blinded.checked).toBe(false);
    expect(exhaustion.value).toBe("3");
  });

  it("Apply returns the union of checked conditions and exhaustion", () => {
    const onApply = vi.fn();
    const modal = new MonsterConditionsModal({} as any, new Set<string>(), onApply);
    const closeSpy = vi.spyOn(modal, "close");
    modal.onOpen();
    (modal.contentEl.querySelector('input[data-cond="charmed"]') as HTMLInputElement).checked = true;
    (modal.contentEl.querySelector('input[data-cond="prone"]') as HTMLInputElement).checked = true;
    (modal.contentEl.querySelector("select") as HTMLSelectElement).value = "2";
    (modal.contentEl.querySelector(".mod-cta") as HTMLButtonElement).click();
    const result = onApply.mock.calls[0][0] as Set<string>;
    expect([...result].sort()).toEqual(["charmed", "exhaustion:2", "prone"]);
    expect(closeSpy).toHaveBeenCalledOnce();
  });

  it("Clear all unchecks everything and resets exhaustion to None", () => {
    const modal = new MonsterConditionsModal({} as any, new Set(["poisoned", "exhaustion:4"]), vi.fn());
    modal.onOpen();
    const clearBtn = [...modal.contentEl.querySelectorAll("button")].find(
      (b) => b.textContent === "Clear all"
    ) as HTMLButtonElement;
    clearBtn.click();
    const poisoned = modal.contentEl.querySelector('input[data-cond="poisoned"]') as HTMLInputElement;
    const exhaustion = modal.contentEl.querySelector("select") as HTMLSelectElement;
    expect(poisoned.checked).toBe(false);
    expect(exhaustion.value).toBe("0");
  });

  it("Cancel closes without applying", () => {
    const onApply = vi.fn();
    const modal = new MonsterConditionsModal({} as any, new Set<string>(), onApply);
    const closeSpy = vi.spyOn(modal, "close");
    modal.onOpen();
    const cancel = [...modal.contentEl.querySelectorAll("button")].find(
      (b) => b.textContent === "Cancel"
    ) as HTMLButtonElement;
    cancel.click();
    expect(onApply).not.toHaveBeenCalled();
    expect(closeSpy).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `make test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the modal** — create `src/views/MonsterConditionsModal.ts`:

```ts
import { App, Modal } from "obsidian";
import { CONDITIONS, decodeStatus, encodeExhaustion } from "../conditions";

export class MonsterConditionsModal extends Modal {
  private initial: Set<string>;
  private onApply: (statuses: Set<string>) => void;
  private checks = new Map<string, HTMLInputElement>();
  private exhaustionSelect: HTMLSelectElement | null = null;

  constructor(app: App, initial: Set<string>, onApply: (statuses: Set<string>) => void) {
    super(app);
    this.initial = new Set(initial);
    this.onApply = onApply;
  }

  onOpen(): void {
    this.modalEl.addClass("dm-conditions-modal");
    this.titleEl.setText("Conditions");
    const { contentEl } = this;
    contentEl.empty();

    const list = contentEl.createDiv({ cls: "dm-conditions-list" });
    for (const cond of Object.values(CONDITIONS)) {
      const row = list.createDiv({ cls: "dm-conditions-row" });
      const check = row.createEl("input", { type: "checkbox" }) as HTMLInputElement;
      check.checked = this.initial.has(cond.id);
      check.setAttribute("data-cond", cond.id);
      check.id = `dm-cond-${cond.id}`;
      const icon = row.createEl("span", { cls: "dm-status-icon" });
      icon.innerHTML = cond.iconSvg;
      icon.setAttribute("title", cond.name);
      row.createEl("label", { text: cond.name, attr: { for: `dm-cond-${cond.id}` } });
      this.checks.set(cond.id, check);
    }

    const exhaustionRow = contentEl.createDiv({ cls: "dm-conditions-exhaustion" });
    exhaustionRow.createEl("label", { text: "Exhaustion", attr: { for: "dm-cond-exhaustion" } });
    const select = exhaustionRow.createEl("select", {
      attr: { id: "dm-cond-exhaustion" },
    }) as HTMLSelectElement;
    select.createEl("option", { text: "None", attr: { value: "0" } });
    for (let n = 1; n <= 6; n++) {
      select.createEl("option", { text: `Level ${n}`, attr: { value: String(n) } });
    }
    select.value = String(this.initialExhaustion());
    this.exhaustionSelect = select;

    const buttons = contentEl.createDiv({ cls: "dm-conditions-buttons" });
    const clearBtn = buttons.createEl("button", { text: "Clear all" }) as HTMLButtonElement;
    clearBtn.addEventListener("click", () => this.clearAll());
    const cancelBtn = buttons.createEl("button", { text: "Cancel" }) as HTMLButtonElement;
    cancelBtn.addEventListener("click", () => this.close());
    const applyBtn = buttons.createEl("button", { text: "Apply", cls: "mod-cta" }) as HTMLButtonElement;
    applyBtn.addEventListener("click", () => this.apply());
  }

  private initialExhaustion(): number {
    for (const s of this.initial) {
      const d = decodeStatus(s);
      if (d.kind === "exhaustion") return d.level;
    }
    return 0;
  }

  private clearAll(): void {
    for (const check of this.checks.values()) check.checked = false;
    if (this.exhaustionSelect) this.exhaustionSelect.value = "0";
  }

  private apply(): void {
    const next = new Set<string>();
    for (const [id, check] of this.checks) if (check.checked) next.add(id);
    const level = this.exhaustionSelect ? parseInt(this.exhaustionSelect.value, 10) : 0;
    const enc = encodeExhaustion(level);
    if (enc) next.add(enc);
    this.onApply(next);
    this.close();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `make test`
Expected: PASS. Run `make typecheck` — clean.

- [ ] **Step 5: Commit**

```bash
git add src/views/MonsterConditionsModal.ts src/__tests__/monster-conditions-modal.test.ts
git commit -m "feat(dndbeyond): add MonsterConditionsModal for atomic multi-condition edits"
```

```json:metadata
{"files": ["src/views/MonsterConditionsModal.ts", "src/__tests__/monster-conditions-modal.test.ts"], "verifyCommand": "make test", "acceptanceCriteria": ["initial checkboxes+exhaustion reflect set", "Apply returns union and closes", "Clear all empties", "Cancel no-op"], "requiresUserVerification": false}
```

---

## Task 5: Right-click menu wiring + replace the old condition menu + spec updates

**Goal:** Right-click on a monster row opens a top-level `Menu` (`Rename…`, `Reset name`, separator, `Conditions…`) that drives the two modals; the old left-click `openMonsterConditionMenu` toggle-list is removed; the canonical specs are updated in the same commit.

**Files:**
- Modify: `src/views/DnDBeyondPanel.ts` (imports, `renderPreview` listener, replace `openMonsterConditionMenu` with `openMonsterMenu`, add `applyMonsterStatuses`, delete `setMonsterExhaustion`)
- Modify: `.agent/features/dndbeyond-integration/encounters-and-tracking.md`
- Modify: `.agent/features/combat-tracker/overview.md`

**Acceptance Criteria:**
- [ ] Monster rows listen on `contextmenu` (with `preventDefault`), not `click`.
- [ ] The top-level menu has `Rename…`, `Reset name` (disabled when no override), a separator, and `Conditions…`.
- [ ] `Rename…` opens `RenameMonsterModal` wired to `applyMonsterName`; `Reset name` calls `resetMonsterName`; `Conditions…` opens `MonsterConditionsModal` wired to `applyMonsterStatuses`.
- [ ] `applyMonsterStatuses(key, set)` sets the map entry (or deletes it when empty), re-broadcasts, re-renders.
- [ ] The old `openMonsterConditionMenu` and `setMonsterExhaustion` are deleted; `make typecheck` finds no dangling references.
- [ ] Both spec files reflect the new behaviour; `make test` and `make build` pass.

**Verify:** `make typecheck && make test && make build` all clean.

**Steps:**

- [ ] **Step 1: Update imports** in `DnDBeyondPanel.ts`. The `Menu` import stays. Add the two modals and drop `encodeExhaustion` if now unused there (it moves to the modal). Replace the conditions import line (line 8) and add modal imports:

```ts
import { CONDITIONS, decodeStatus } from "../conditions";
import { RenameMonsterModal } from "./RenameMonsterModal";
import { MonsterConditionsModal } from "./MonsterConditionsModal";
```

Note: verify whether `CONDITIONS` / `decodeStatus` are still used elsewhere in the file after deleting the old menu — `decodeStatus` is used by `buildPreviewRow`, keep it. `CONDITIONS` was only used by the old menu; if `make typecheck` flags it as unused after Step 4, remove it from the import.

- [ ] **Step 2: Switch the row listener to `contextmenu`** in `renderPreview` (lines 364-371). Replace the `if (p.monsterKey != null) { … }` block with:

```ts
      if (p.monsterKey != null) {
        const key = p.monsterKey;
        row.classList.add("dm-ddb-preview-row-clickable");
        row.addEventListener("contextmenu", (evt) => {
          evt.preventDefault();
          this.openMonsterMenu(key, evt);
        });
      }
```

- [ ] **Step 3: Replace `openMonsterConditionMenu` with `openMonsterMenu`** — delete the entire `openMonsterConditionMenu` method (lines 376-426) and `setMonsterExhaustion` (lines 428-435), and add:

```ts
  private openMonsterMenu(monsterKey: string, evt: MouseEvent): void {
    const hasOverride = this.monsterNames.has(monsterKey);
    debug("DDB Panel: open monster menu for key", monsterKey, "override?", hasOverride);

    const menu = new Menu();
    menu.addItem((item) => {
      item.setTitle("Rename…").onClick(() => this.openRenameModal(monsterKey));
    });
    menu.addItem((item) => {
      item.setTitle("Reset name").setDisabled(!hasOverride).onClick(() => {
        if (hasOverride) this.resetMonsterName(monsterKey);
      });
    });
    menu.addSeparator();
    menu.addItem((item) => {
      item.setTitle("Conditions…").onClick(() => this.openConditionsModal(monsterKey));
    });
    menu.showAtMouseEvent(evt);
  }

  private openRenameModal(monsterKey: string): void {
    const current = this.monsterNames.get(monsterKey) ?? this.originalNameFor(monsterKey) ?? "";
    new RenameMonsterModal(this.plugin.app, current, (name) =>
      this.applyMonsterName(monsterKey, name)
    ).open();
  }

  private openConditionsModal(monsterKey: string): void {
    const current = this.monsterStatuses.get(monsterKey) ?? new Set<string>();
    new MonsterConditionsModal(this.plugin.app, current, (statuses) =>
      this.applyMonsterStatuses(monsterKey, statuses)
    ).open();
  }

  private applyMonsterStatuses(monsterKey: string, statuses: Set<string>): void {
    if (statuses.size === 0) this.monsterStatuses.delete(monsterKey);
    else this.monsterStatuses.set(monsterKey, statuses);
    this.applyMonsterStatusChange();
  }
```

- [ ] **Step 4: Run typecheck and tests**

Run: `make typecheck && make test`
Expected: clean. If `CONDITIONS` import is now unused, remove it from the import in Step 1 and re-run. (Tests do not exercise the Obsidian `Menu` directly — the stub only collects items — so behaviour is validated through the apply/reset methods covered in Tasks 1 & 4. This matches the existing codebase, which has no `Menu`-rendering test.)

- [ ] **Step 5: Update `.agent/features/dndbeyond-integration/encounters-and-tracking.md`** — amend Req 21 and add a new requirement. Replace the Req 21 sentence about the click-to-edit Menu, and append after Req 22:

Change Req 21's tail from "…mutated by the DM via the click-to-edit Menu and cleared on `selectEncounter` and `stopTracking`." to:

```
…mutated by the DM via the `MonsterConditionsModal` (opened from the row's right-click menu → `Conditions…`, applied atomically on the modal's `Apply` button) and cleared on `selectEncounter` and `stopTracking`.
```

Add new requirements at the end of the `### Broadcast` block:

```
22a. Each monster row carries an ephemeral display-name override held in `DnDBeyondPanel.monsterNames` — a `Map<instanceKey, string>` keyed identically to `monsterStatuses`. When an override exists, `buildParticipants` resolves the monster's broadcast `name` to the override (otherwise the upstream DDB name); the broadcast payload carries only the resolved `name` (no marker, no original name). The map is mutated via the row's right-click menu (`Rename…` / `Reset name`) and cleared on `selectEncounter` and `stopTracking`. It is never persisted.
22b. The DM-side preview (`buildPreviewRow`) shall prefix a renamed monster's `.init-name` with `* ` so the DM can tell at a glance which monsters were renamed. The `*` is DM-only and never reaches the player screen.
```

Update the `### DM-side preview` mention if needed and the Non-goals are unchanged (renaming PCs/manual entries remains out of scope — already implied; no edit needed unless contradictory).

- [ ] **Step 6: Update `.agent/features/combat-tracker/overview.md`** — amend Req 21 (the DDB monster condition-edit affordance). Replace its first sentence:

From: "The DM may add or remove conditions on D&D Beyond monster rows (click anywhere on the row) …"

To:

```
The DM may right-click a D&D Beyond monster row to open a menu with `Rename…`, `Reset name` (disabled when the monster has no override), and `Conditions…`. `Conditions…` opens the `MonsterConditionsModal` (14 condition checkboxes + an Exhaustion None/1..6 select + Clear all), applied atomically on `Apply`. On local manual combatants the DM still adds or removes conditions by clicking the combatant's name span, opening an Obsidian `Menu` with 14 toggle items plus an Exhaustion section (Remove, Level 1..6). Toggling/applying triggers an immediate broadcast and a re-render.
```

Amend Req 22 to add the name-override channel alongside the existing condition-ephemerality sentence:

```
… Local manual conditions live on `ManualCombatant.statuses` and persist with the manual combatant for the lifetime of the panel, but they are not written to disk. DDB monster display-name overrides live in `DnDBeyondPanel.monsterNames` (a `Map<instanceKey, string>`), are broadcast as the monster's name (clean) and marked `* ` in the DM preview, and are cleared by `selectEncounter` and `stopTracking`.
```

- [ ] **Step 7: Full local CI**

Run: `make typecheck && make test && make build`
Expected: all clean (the bundle smoke test rebuilds `main.js`).

- [ ] **Step 8: Commit**

```bash
git add src/views/DnDBeyondPanel.ts .agent/features/dndbeyond-integration/encounters-and-tracking.md .agent/features/combat-tracker/overview.md
git commit -m "feat(dndbeyond): right-click monster menu with rename and conditions modal"
```

```json:metadata
{"files": ["src/views/DnDBeyondPanel.ts", ".agent/features/dndbeyond-integration/encounters-and-tracking.md", ".agent/features/combat-tracker/overview.md"], "verifyCommand": "make typecheck && make test && make build", "acceptanceCriteria": ["contextmenu listener replaces click", "top-level menu Rename/Reset/Conditions", "modals wired to apply methods", "old menu+setMonsterExhaustion deleted", "specs updated"], "requiresUserVerification": false}
```

---

## Task 6: Cut the beta and verify with the user

**Goal:** Open the PR, cut a `-beta.N` prerelease for BRAT, and get the user's confirmation that the feature works in their vault.

**Files:**
- Modify: `manifest.json`, `package.json`, `package-lock.json` (version bump to the next `-beta.N`)

**Acceptance Criteria:**
- [ ] Pre-push manifest check run; the three version files are set to a fresh `X.Y.Z-beta.1` above the latest stable.
- [ ] Branch pushed; `release.yml` publishes the prerelease; CI (`typecheck`, `test`, `build`) green.
- [ ] A PR is open against `main` with a Conventional Commits title and the `release:minor` label (new user-facing capability).
- [ ] User confirms the beta behaves correctly.

**User Verification Required:**
Before marking this task complete, you MUST call AskUserQuestion:
```yaml
AskUserQuestion:
  question: "La beta está publicada. ¿Funciona el rename en tu vault — el monstruo aparece con el nombre nuevo en la pantalla de jugadores y con '* ' delante en Obsidian, y el modal de condiciones añade/quita varias a la vez?"
  header: "Verification"
  options:
    - label: "Funciona"
      description: "Rename, marcador '*' y modal de condiciones se comportan como se diseñó"
    - label: "Hay un problema"
      description: "Algo no va — describe el fallo y se corrige antes de cerrar"
```

**If the user selects "Hay un problema":** the task is NOT complete. Rework, re-cut the beta (bump `-beta.N`), and re-verify.

**Verify:** `git ls-remote --tags origin 'v*-beta*'` shows the new beta tag; user confirms via AskUserQuestion.

**Steps:**

- [ ] **Step 1: Pre-push manifest check**

Run: `grep '"version"' manifest.json`
Determine the latest stable: `git ls-remote --tags origin 'v[0-9]*' | grep -v -- '-beta' | sort -V | tail -1`. The manifest currently reads `0.19.0` (a stable value), so the next beta is `0.20.0-beta.1` (minor, new capability).

- [ ] **Step 2: Bump the three version files** to `0.20.0-beta.1` — `manifest.json` `version`, `package.json` `version`, and `package-lock.json` top-level `version` AND nested `packages[""].version`. Commit:

```bash
git add manifest.json package.json package-lock.json
git commit -m "chore(release): cut v0.20.0-beta.1"
```

- [ ] **Step 3: Push the branch** (GitHub SSH over 443 not needed here — `gh`/origin already configured; push the branch normally). The release workflow reads `manifest.json`, tags `v0.20.0-beta.1`, publishes the prerelease.

```bash
git push -u origin feature/monster-rename
```

- [ ] **Step 4: Open the PR** with the minor label:

```bash
gh pr create --base main --title "feat(dndbeyond): ephemeral monster rename + conditions modal" --label "release:minor" --body "$(cat <<'EOF'
Right-click a D&D Beyond monster row to rename it (ephemeral, clean on the player screen, prefixed `*` in the DM preview) and to edit its conditions through a multi-select modal (14 checkboxes + Exhaustion select + Clear all, applied atomically).

## Test plan
- make typecheck && make test && make build
- BRAT-install v0.20.0-beta.1 and verify in a live encounter
EOF
)"
```

- [ ] **Step 5: Wait for CI + prerelease**, confirm the six required checks pass and the prerelease exists:

Run: `gh run list --branch feature/monster-rename --limit 3` and `git ls-remote --tags origin 'v0.20.0-beta*'`
Expected: checks green, tag present.

- [ ] **Step 6: Verify with the user** — call the AskUserQuestion above. If "Funciona", mark complete. If "Hay un problema", rework and re-cut.

```json:metadata
{"files": ["manifest.json", "package.json", "package-lock.json"], "verifyCommand": "git ls-remote --tags origin 'v0.20.0-beta*'", "acceptanceCriteria": ["version files bumped to 0.20.0-beta.1", "prerelease published", "PR open with release:minor", "user confirms"], "requiresUserVerification": true, "userVerificationPrompt": "La beta está publicada. ¿Funciona el rename y el modal de condiciones en tu vault?"}
```

---

## Self-Review notes

- **Spec coverage:** scope (DDB monsters only) → Tasks 1-5; player clean name → Task 1; DM `*` → Task 2; right-click → Task 5; Rename modal → Task 3; conditions modal w/ checkboxes + exhaustion select + clear all + Apply → Task 4; Reset → Tasks 1+5; clearing → Task 1; specs → Task 5; beta → Task 6.
- **Verification requirement:** the prompt says "genera una beta para probarlo" → user verification required → Task 6 carries `requiresUserVerification: true` with the standard block.
- **Type consistency:** `applyMonsterName`, `resetMonsterName`, `applyMonsterStatuses`, `originalNameFor`, `monsterNames`, `PreviewCombatant.{originalName,renamed}` are used consistently across tasks. `applyMonsterStatusChange` (existing) is the shared broadcast+render path.
- **No placeholders:** every code step shows full code; the only "paste from Task 1" references are the verbatim polyfill block, intentionally not duplicated three times.
