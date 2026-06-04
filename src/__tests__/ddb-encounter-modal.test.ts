import { beforeAll, describe, expect, it, vi } from "vitest";
import { DnDBeyondEncounterModal } from "../views/DnDBeyondEncounterModal";

beforeAll(() => {
  // Polyfills used by the modal's render path (createDiv / createEl / createSpan / setText / empty).
  if (!HTMLElement.prototype.empty) {
    (HTMLElement.prototype as any).empty = function () {
      while (this.firstChild) this.removeChild(this.firstChild);
    };
  }
  if (!HTMLElement.prototype.addClass) {
    HTMLElement.prototype.addClass = function (cls: string) {
      this.classList.add(cls);
    };
  }
  if (!HTMLElement.prototype.createDiv) {
    (HTMLElement.prototype as any).createDiv = function (
      arg?: string | { cls?: string; text?: string }
    ) {
      const div = document.createElement("div");
      if (typeof arg === "string") div.className = arg;
      else if (arg) {
        if (arg.cls) div.className = arg.cls;
        if (arg.text) div.textContent = arg.text;
      }
      this.appendChild(div);
      return div;
    };
  }
  if (!HTMLElement.prototype.createEl) {
    (HTMLElement.prototype as any).createEl = function (
      tag: string,
      opts?: { type?: string; text?: string; cls?: string; attr?: Record<string, string> }
    ) {
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
    (HTMLElement.prototype as any).setText = function (text: string) {
      this.textContent = text;
    };
  }
});

function makeClient(getEncounters: () => Promise<any[]>) {
  return { getEncounters } as any;
}

describe("DnDBeyondEncounterModal", () => {
  it("renders rows from fetched encounters", async () => {
    const client = makeClient(async () => [
      { id: "e1", name: "Goblin Ambush", inProgress: false },
      { id: "e2", name: "Dragon Lair", inProgress: true },
    ]);
    const onSelect = vi.fn();
    const modal = new DnDBeyondEncounterModal({} as any, {} as any, client, onSelect);
    await modal.onOpen();
    const rows = modal.contentEl.querySelectorAll(".dm-ddb-encounter-row");
    expect(rows.length).toBe(2);
    expect((rows[0] as HTMLElement).textContent).toContain("Goblin Ambush");
    expect((rows[1] as HTMLElement).textContent).toContain("Dragon Lair");
    expect((rows[1] as HTMLElement).querySelector(".dm-ddb-badge")).not.toBeNull();
  });

  it("clicking a row invokes onSelect and closes the modal", async () => {
    const client = makeClient(async () => [{ id: "enc-7", name: "Boss Fight", inProgress: false }]);
    const onSelect = vi.fn();
    const modal = new DnDBeyondEncounterModal({} as any, {} as any, client, onSelect);
    const closeSpy = vi.fn();
    (modal as any).closeSpy = closeSpy;
    await modal.onOpen();
    const row = modal.contentEl.querySelector(".dm-ddb-encounter-row") as HTMLElement;
    row.click();
    expect(onSelect).toHaveBeenCalledWith("enc-7");
    expect(closeSpy).toHaveBeenCalledOnce();
  });

  it("filters rows by the search input (case-insensitive substring)", async () => {
    const client = makeClient(async () => [
      { id: "e1", name: "Goblin Ambush", inProgress: false },
      { id: "e2", name: "Dragon Lair", inProgress: false },
      { id: "e3", name: "Gnome Adventure", inProgress: false },
    ]);
    const modal = new DnDBeyondEncounterModal({} as any, {} as any, client, vi.fn());
    await modal.onOpen();
    const input = modal.contentEl.querySelector(".dm-ddb-modal-search") as HTMLInputElement;
    input.value = "GOBLIN";
    input.dispatchEvent(new Event("input"));
    const rows = modal.contentEl.querySelectorAll(".dm-ddb-encounter-row");
    expect(rows.length).toBe(1);
    expect((rows[0] as HTMLElement).textContent).toContain("Goblin Ambush");
  });

  it("drops stale fetch results when re-opened before previous resolve", async () => {
    let resolveFirst: ((v: any[]) => void) | null = null;
    let resolveSecond: ((v: any[]) => void) | null = null;
    let callCount = 0;
    const client = {
      getEncounters: () => {
        callCount++;
        return new Promise<any[]>((resolve) => {
          if (callCount === 1) resolveFirst = resolve;
          else resolveSecond = resolve;
        });
      },
    } as any;
    const modal = new DnDBeyondEncounterModal({} as any, {} as any, client, vi.fn());

    const first = modal.onOpen();
    const second = modal.onOpen();

    resolveSecond!([{ id: "e-new", name: "New Encounter", inProgress: false }]);
    await second;
    resolveFirst!([
      { id: "e-old-1", name: "Old A", inProgress: false },
      { id: "e-old-2", name: "Old B", inProgress: false },
    ]);
    await first;

    const rows = modal.contentEl.querySelectorAll(".dm-ddb-encounter-row");
    expect(rows.length).toBe(1);
    expect((rows[0] as HTMLElement).textContent).toContain("New Encounter");
  });
});
