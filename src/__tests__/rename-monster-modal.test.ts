import { beforeAll, describe, expect, it, vi } from "vitest";
import { RenameMonsterModal } from "../views/RenameMonsterModal";

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
