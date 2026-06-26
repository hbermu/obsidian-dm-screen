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
    exhaustionRow.createEl("label", {
      text: "Exhaustion",
      attr: { for: "dm-cond-exhaustion" },
    });
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
    const applyBtn = buttons.createEl("button", {
      text: "Apply",
      cls: "mod-cta",
    }) as HTMLButtonElement;
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
