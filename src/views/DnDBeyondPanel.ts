import { Menu, Notice } from "obsidian";
import type DmScreenPlugin from "../main";
import { DdbClient } from "../dndbeyond/client";
import { DdbEncounterPoller, type DdbPolledState } from "../dndbeyond/poller";
import { debug, debugWarn } from "../debug";
import type { DdbEncounter } from "../dndbeyond/types";
import { DnDBeyondEncounterModal } from "./DnDBeyondEncounterModal";
import { CONDITIONS, decodeStatus, encodeExhaustion } from "../conditions";

type PreviewCombatant = {
  name: string;
  hp: number;
  maxHp: number;
  initiative: number;
  active: boolean;
  friendly: boolean;
  isPlayer: boolean;
  hidden: boolean;
  hideHp: boolean;
  statuses: string[];
  inspired: boolean;
  // Non-null on DDB monster rows — used by the DM preview to wire a
  // click handler that opens the condition menu. This is the per-instance
  // key (uniqueId from DDB, or `${id}:${name}` when uniqueId is empty),
  // NOT the template `id` which is shared across A/B/C duplicates.
  monsterKey?: string;
  // DM-side only: the unmodified DDB name and whether an override is active.
  // Never forwarded to the player payload.
  originalName: string;
  renamed: boolean;
};

export class DnDBeyondPanel {
  private client: DdbClient | null = null;
  private poller: DdbEncounterPoller | null = null;
  private selectedEncounterId: string | null = null;
  private showPcHp = true;
  private showFullTurnOrder = false;
  private showFullTurnOrderUserSet = false;
  private polledState: DdbPolledState | null = null;
  private container: HTMLElement;
  private previewEl: HTMLElement | null = null;
  private previewHeaderEl: HTMLElement | null = null;
  // Ephemeral DM-assigned conditions for DDB monsters, keyed by the
  // per-instance unique id from DDB (or a synthetic id:name fallback when
  // DDB doesn't return one). DDB shares the template `id` across multiple
  // instances of the same monster — "Goblin (A)" and "Goblin (B)" have the
  // same numeric id and would otherwise share statuses. Cleared on encounter
  // switch and on stopTracking.
  private monsterStatuses = new Map<string, Set<string>>();
  // Ephemeral DM-assigned display name overrides for DDB monsters, keyed by the
  // same per-instance key as monsterStatuses. The override is broadcast to the
  // player screen as the monster's name; the DM preview marks it with a "*".
  // Cleared on encounter switch and on stopTracking. Never persisted.
  private monsterNames = new Map<string, string>();
  onTrackingChange: (() => void) | null = null;

  constructor(private plugin: DmScreenPlugin, container: HTMLElement) {
    this.container = container;
  }

  getActiveEncounterStatus(): { id: string; name: string; roundNum: number } | null {
    if (!this.poller || !this.polledState || !this.selectedEncounterId) return null;
    return {
      id: this.selectedEncounterId,
      name: this.polledState.encounter.name,
      roundNum: this.polledState.encounter.roundNum,
    };
  }

  setContainer(el: HTMLElement): void {
    this.container = el;
    this.render();
  }

  async initialize(): Promise<void> {
    const session = this.plugin.settings.ddbCobaltSession;
    if (!session) {
      this.render();
      return;
    }
    try {
      this.client = new DdbClient(session);
      const valid = await this.client.validateSession();
      if (!valid) {
        this.client = null;
        new Notice("D&D Beyond session expired. Update cookie in settings.", 6000);
      }
    } catch {
      this.client = null;
    }
    this.render();
  }

  destroy(): void {
    this.stopTracking();
  }

  isTracking(): boolean {
    return this.poller !== null && this.selectedEncounterId !== null;
  }

  render(): void {
    this.container.empty();
    this.previewEl = null;
    this.previewHeaderEl = null;

    if (!this.client) {
      const msg = this.container.createDiv({ cls: "dm-ddb-message" });
      msg.setText("Configure CobaltSession in settings to connect to D&D Beyond.");
      return;
    }

    const controlsRow = this.container.createDiv({ cls: "dm-ddb-controls" });

    const chooseBtn = controlsRow.createEl("button", {
      cls: "mod-cta dm-ddb-choose-btn",
      text: "Choose Encounter",
    });
    chooseBtn.addEventListener("click", () => this.openEncounterModal());

    const hpToggle = controlsRow.createDiv({ cls: "dm-ddb-hp-toggle" });
    const hpCheck = hpToggle.createEl("input", { type: "checkbox" }) as HTMLInputElement;
    hpCheck.checked = this.showPcHp;
    hpCheck.id = "dm-ddb-show-pc-hp";
    hpCheck.addEventListener("change", () => {
      this.showPcHp = hpCheck.checked;
      if (this.polledState) this.broadcastToPlayerScreen(this.polledState);
      this.renderPreview();
    });
    hpToggle.createEl("label", { text: "Show PC HP", attr: { for: "dm-ddb-show-pc-hp" } });

    const revealToggle = controlsRow.createDiv({ cls: "dm-ddb-reveal-toggle" });
    const revealCheck = revealToggle.createEl("input", { type: "checkbox" }) as HTMLInputElement;
    revealCheck.checked = this.showFullTurnOrder;
    revealCheck.id = "dm-ddb-show-full-turn-order";
    revealCheck.addEventListener("change", () => {
      this.showFullTurnOrder = revealCheck.checked;
      this.showFullTurnOrderUserSet = true;
      debug("DDB Panel: showFullTurnOrder toggled to", this.showFullTurnOrder, "(user)");
      if (this.polledState) this.broadcastToPlayerScreen(this.polledState);
      this.renderPreview();
    });
    revealToggle.createEl("label", {
      text: "Show full turn order",
      attr: { for: "dm-ddb-show-full-turn-order" },
    });

    this.previewEl = this.container.createDiv({ cls: "dm-ddb-preview" });
    this.previewHeaderEl = this.previewEl.createDiv({ cls: "dm-ddb-preview-header" });
    this.previewEl.createEl("ul", { cls: "dm-ddb-preview-list" });
    this.updatePreviewHeader();
    this.renderPreview();
  }

  private openEncounterModal(): void {
    if (!this.client) return;
    debug("DDB Panel: open encounter modal");
    new DnDBeyondEncounterModal(this.plugin.app, this.plugin, this.client, (id) =>
      this.selectEncounter(id)
    ).open();
  }

  private selectEncounter(id: string): void {
    debug("DDB Panel: selectEncounter", id);
    if (this.poller) {
      this.poller.stop();
      this.poller = null;
    }
    this.selectedEncounterId = id;
    this.polledState = null;
    this.showFullTurnOrderUserSet = false;
    this.showFullTurnOrder = false;
    this.monsterStatuses.clear();
    this.monsterNames.clear();
    this.startTracking(id);
    this.render();
    this.onTrackingChange?.();

    if (this.client) {
      this.client.getEncounter(id).then((enc) => this.loadMonsterImages(enc)).catch(() => {});
    }
  }

  private startTracking(encounterId: string): void {
    if (!this.client) return;
    this.poller = new DdbEncounterPoller(
      this.client,
      encounterId,
      (state) => this.onPollUpdate(state),
      (err) => this.onPollError(err)
    );
    this.poller.start();
  }

  stopTracking(): void {
    debug("DDB Panel: stopTracking");
    if (this.poller) {
      this.poller.stop();
      this.poller = null;
    }
    this.selectedEncounterId = null;
    this.polledState = null;
    this.monsterStatuses.clear();
    this.monsterNames.clear();
    this.plugin.sendInitiativeUpdate([], 0);
    this.render();
    this.onTrackingChange?.();
  }

  private onPollUpdate(state: DdbPolledState): void {
    const firstPoll = this.polledState === null;
    this.polledState = state;
    if (firstPoll && !this.showFullTurnOrderUserSet && state.encounter.roundNum >= 2) {
      this.showFullTurnOrder = true;
      debug(
        "DDB Panel: auto-set showFullTurnOrder=true (roundNum=",
        state.encounter.roundNum,
        ")"
      );
      this.syncRevealCheckbox();
    }
    this.broadcastToPlayerScreen(state);
    this.updatePreviewHeader();
    this.renderPreview();
    this.onTrackingChange?.();
  }

  private syncRevealCheckbox(): void {
    const check = this.container.querySelector(
      "#dm-ddb-show-full-turn-order"
    ) as HTMLInputElement | null;
    if (check) check.checked = this.showFullTurnOrder;
  }

  private onPollError(err: Error): void {
    debugWarn("DDB Poller error:", err.message);
  }

  private buildParticipants(state: DdbPolledState): {
    participants: PreviewCombatant[];
    currentTurnIdx: number;
  } {
    const { encounter, characters } = state;
    const players = encounter.players ?? [];
    const monsters = encounter.monsters ?? [];
    const manualEntries = encounter.manualEntries ?? [];

    const allParticipants = [
      ...players.map((p) => ({ ...p, kind: "player" as const })),
      ...monsters.map((m) => ({ ...m, kind: "monster" as const })),
      ...manualEntries.map((e) => ({ ...e, kind: "manual" as const })),
    ].sort((a, b) => b.initiative - a.initiative);

    const currentTurnIdx = encounter.inProgress ? encounter.turnNum - 1 : -1;
    const participants: PreviewCombatant[] = [];

    for (let i = 0; i < allParticipants.length; i++) {
      const p = allParticipants[i];
      const isActive = i === currentTurnIdx;
      const hidden = !this.showFullTurnOrder && i > currentTurnIdx;

      if (p.kind === "player") {
        const char = characters.get(p.id);
        participants.push({
          name: char?.name ?? p.name,
          hp: char?.currentHitPoints ?? 0,
          maxHp: char?.maxHitPoints ?? 0,
          initiative: p.initiative,
          active: isActive,
          friendly: true,
          isPlayer: true,
          hidden,
          hideHp: !this.showPcHp,
          statuses: char?.statuses ?? [],
          inspired: char?.inspired ?? false,
          originalName: char?.name ?? p.name,
          renamed: false,
        });
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
      } else {
        participants.push({
          name: p.name,
          hp: (p as { currentHitPoints: number }).currentHitPoints,
          maxHp: (p as { maximumHitPoints: number }).maximumHitPoints,
          initiative: p.initiative,
          active: isActive,
          friendly: false,
          isPlayer: false,
          hidden,
          hideHp: false,
          statuses: [],
          inspired: false,
          originalName: p.name,
          renamed: false,
        });
      }
    }

    return { participants, currentTurnIdx };
  }

  private broadcastToPlayerScreen(state: DdbPolledState): void {
    const { participants } = this.buildParticipants(state);
    const combatants = participants.map((p) => ({
      name: p.name,
      hp: p.hp,
      maxHp: p.maxHp,
      initiative: p.initiative,
      active: p.active,
      friendly: p.friendly,
      isPlayer: p.isPlayer,
      hidden: p.hidden,
      hideHp: p.hideHp,
      statuses: p.statuses,
      inspired: p.inspired,
    }));
    this.plugin.sendInitiativeUpdate(combatants, state.encounter.roundNum);
  }

  private updatePreviewHeader(): void {
    if (!this.previewHeaderEl) return;
    if (!this.polledState) {
      this.previewHeaderEl.setText("Player preview");
      return;
    }
    const { encounter } = this.polledState;
    if (!encounter.inProgress) {
      this.previewHeaderEl.setText("Player preview — Encounter idle");
      return;
    }
    this.previewHeaderEl.setText(`Player preview — Round ${encounter.roundNum}`);
  }

  private renderPreview(): void {
    if (!this.previewEl) return;
    const list = this.previewEl.querySelector(".dm-ddb-preview-list") as HTMLElement | null;
    if (!list) return;
    list.empty();

    const existingEmpty = this.previewEl.querySelector(".dm-ddb-preview-empty");
    if (existingEmpty) existingEmpty.remove();

    if (!this.polledState) {
      this.previewEl.createDiv({
        cls: "dm-ddb-preview-empty",
        text: "No encounter selected. Click Choose Encounter to begin.",
      });
      return;
    }

    const { participants } = this.buildParticipants(this.polledState);
    if (participants.length === 0) {
      this.previewEl.createDiv({
        cls: "dm-ddb-preview-empty",
        text: "Encounter has no combatants.",
      });
      return;
    }

    for (const p of participants) {
      const row = buildPreviewRow(p);
      if (p.monsterKey != null) {
        const key = p.monsterKey;
        const monsterName = p.name;
        row.classList.add("dm-ddb-preview-row-clickable");
        row.addEventListener("click", (evt) =>
          this.openMonsterConditionMenu(key, monsterName, evt)
        );
      }
      list.appendChild(row);
    }
  }

  private openMonsterConditionMenu(monsterKey: string, monsterName: string, evt: MouseEvent): void {
    if (!this.polledState) return;
    const current = this.monsterStatuses.get(monsterKey) ?? new Set<string>();
    debug("DDB Panel: open monster condition menu for", monsterName, "(key", monsterKey, ")");

    const menu = new Menu();

    const hasAny = current.size > 0;
    menu.addItem((item) => {
      item.setTitle("Remove all conditions").setDisabled(!hasAny).onClick(() => {
        if (!hasAny) return;
        this.monsterStatuses.delete(monsterKey);
        this.applyMonsterStatusChange();
      });
    });
    menu.addSeparator();

    for (const cond of Object.values(CONDITIONS)) {
      const active = current.has(cond.id);
      menu.addItem((item) => {
        item.setTitle(cond.name).setChecked(active).onClick(() => {
          const set = new Set(this.monsterStatuses.get(monsterKey) ?? new Set<string>());
          if (active) set.delete(cond.id);
          else set.add(cond.id);
          this.monsterStatuses.set(monsterKey, set);
          this.applyMonsterStatusChange();
        });
      });
    }

    menu.addSeparator();

    const currentExhaustion = readExhaustionLevel(current);
    menu.addItem((item) => {
      item.setTitle(currentExhaustion === 0 ? "Exhaustion — None" : `Exhaustion — Level ${currentExhaustion}`).setDisabled(true);
    });
    menu.addItem((item) => {
      item.setTitle("  Remove exhaustion").setChecked(currentExhaustion === 0).onClick(() => {
        this.setMonsterExhaustion(monsterKey, 0);
      });
    });
    for (let n = 1; n <= 6; n++) {
      menu.addItem((item) => {
        item.setTitle(`  Exhaustion ${n}`).setChecked(currentExhaustion === n).onClick(() => {
          this.setMonsterExhaustion(monsterKey, n);
        });
      });
    }

    menu.showAtMouseEvent(evt);
  }

  private setMonsterExhaustion(monsterKey: string, level: number): void {
    const set = new Set(this.monsterStatuses.get(monsterKey) ?? new Set<string>());
    for (const s of [...set]) if (s.startsWith("exhaustion:")) set.delete(s);
    const enc = encodeExhaustion(level);
    if (enc) set.add(enc);
    this.monsterStatuses.set(monsterKey, set);
    this.applyMonsterStatusChange();
  }

  private applyMonsterStatusChange(): void {
    if (!this.polledState) return;
    this.broadcastToPlayerScreen(this.polledState);
    this.renderPreview();
  }

  applyMonsterName(monsterKey: string, rawName: string): void {
    const name = rawName.trim();
    if (name.length === 0) {
      return;
    }
    const original = this.originalNameFor(monsterKey);
    if (original != null && name === original) {
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

  private async loadMonsterImages(encounter: DdbEncounter): Promise<void> {
    if (!this.client) return;

    const uniqueIds = [...new Set(encounter.monsters.map((m) => m.id))];
    if (uniqueIds.length === 0) return;

    const cache = this.plugin.ddbImageCache;
    if (!cache) {
      debugWarn("loadMonsterImages: DDB image cache not initialised");
      return;
    }

    debug("loadMonsterImages: encounter", encounter.name, "uniqueIds", uniqueIds);

    try {
      const avatarMap = await this.client.getMonsterImages(uniqueIds);
      debug("loadMonsterImages: avatarMap entries", avatarMap.size, [...avatarMap.entries()]);

      const dmPanel = await this.plugin.findOpenDmControlPanel();
      if (!dmPanel) {
        debug("loadMonsterImages: no DM panel open, aborting");
        return;
      }

      await Promise.allSettled(
        [...avatarMap].map(async ([monsterId, imageUrl]) => {
          const monster = encounter.monsters.find((m) => m.id === monsterId);
          const name = monster?.name ?? `Monster ${monsterId}`;
          debug("loadMonsterImages: downloading", name, "id", monsterId, "url", imageUrl);
          const vaultPath = await cache.getOrDownload(monsterId, imageUrl, name);
          const dataUrl = await this.plugin.imageToDataUrl(vaultPath);
          if (dataUrl) {
            dmPanel.addImageLayer(name, dataUrl, "monster", false);
            debug("loadMonsterImages: added layer", name);
          }
        })
      );
    } catch (e) {
      debugWarn("DDB: failed to load monster images:", (e as Error).message);
    }
  }
}

function classifyHp(hp: number, maxHp: number): { cls: string; label: string } {
  if (hp <= 0) return { cls: "init-condition-down", label: "Down" };
  if (maxHp <= 0) return { cls: "init-condition-well", label: "Well" };
  const pct = (hp / maxHp) * 100;
  if (pct < 50) return { cls: "init-condition-bloodied", label: "Bloodied" };
  if (pct < 100) return { cls: "init-condition-hurt", label: "Hurt" };
  return { cls: "init-condition-well", label: "Well" };
}

function monsterInstanceKey(m: { uniqueId?: string; id: number; name: string }): string {
  const uid = (m.uniqueId ?? "").trim();
  if (uid.length > 0) return uid;
  // Fallback when DDB didn't return uniqueId (e.g. old encounters or tests):
  // use a composite of template id + display name so A/B/C suffixes still
  // disambiguate.
  return `${m.id}:${m.name}`;
}

function readExhaustionLevel(statuses: Iterable<string>): number {
  for (const s of statuses) {
    if (s.startsWith("exhaustion:")) {
      const n = parseInt(s.slice("exhaustion:".length), 10);
      if (Number.isFinite(n) && n >= 1 && n <= 6) return n;
    }
  }
  return 0;
}

function buildPreviewRow(c: PreviewCombatant): HTMLLIElement {
  const li = document.createElement("li");
  li.className = "init-entry";
  if (c.active) li.classList.add("init-active");
  if (c.friendly || c.isPlayer) li.classList.add("init-friendly");
  if (c.hidden) li.classList.add("init-hidden");
  if (c.inspired) li.classList.add("init-inspired");

  const nameEl = document.createElement("span");
  nameEl.className = "init-name";
  nameEl.textContent = c.renamed ? `* ${c.name}` : c.name;
  if (c.isPlayer) {
    const tag = document.createElement("span");
    tag.className = "init-pc-tag";
    tag.textContent = "PC";
    nameEl.appendChild(tag);
  }
  li.appendChild(nameEl);

  if (c.statuses && c.statuses.length > 0) {
    const wrap = document.createElement("span");
    wrap.className = "init-statuses";
    for (const status of c.statuses) {
      const d = decodeStatus(status);
      if (d.kind === "condition") {
        const icon = document.createElement("span");
        icon.className = "dm-status-icon";
        icon.title = d.def.name;
        icon.innerHTML = d.def.iconSvg;
        wrap.appendChild(icon);
      } else if (d.kind === "exhaustion") {
        const icon = document.createElement("span");
        icon.className = "dm-status-icon dm-status-exhaustion";
        icon.title = `Exhaustion (Level ${d.level})`;
        icon.innerHTML = d.iconSvg;
        const level = document.createElement("span");
        level.className = "dm-status-level";
        level.textContent = String(d.level);
        icon.appendChild(level);
        wrap.appendChild(icon);
      } else {
        const badge = document.createElement("span");
        badge.className = "dm-status-badge";
        badge.textContent = d.text;
        wrap.appendChild(badge);
      }
    }
    li.appendChild(wrap);
  }

  const showHp = (c.friendly || c.isPlayer) && !c.hideHp;
  if (showHp) {
    const hpEl = document.createElement("span");
    hpEl.className = "init-hp-text";
    hpEl.textContent = `${c.hp}/${c.maxHp}`;
    li.appendChild(hpEl);
  }

  const cond = classifyHp(c.hp, c.maxHp);
  const condEl = document.createElement("span");
  condEl.className = `init-condition ${cond.cls}`;
  condEl.textContent = cond.label;
  li.appendChild(condEl);

  return li;
}
