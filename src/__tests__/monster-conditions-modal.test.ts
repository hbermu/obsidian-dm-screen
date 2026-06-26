import { beforeAll, describe, expect, it, vi } from "vitest";
import { MonsterConditionsModal } from "../views/MonsterConditionsModal";

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
