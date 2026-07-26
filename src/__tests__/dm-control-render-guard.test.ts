import { beforeAll, describe, expect, it, vi } from "vitest";
import { DmControlPanel } from "../views/DmControlPanel";

beforeAll(() => {
  if (!HTMLElement.prototype.addClass) {
    HTMLElement.prototype.addClass = function (cls: string) {
      this.classList.add(cls);
    };
  }
});

function makePanel(): { panel: DmControlPanel; render: ReturnType<typeof vi.fn>; input: HTMLInputElement } {
  const plugin = {
    settings: { combatTrackerScale: 1 },
    server: null,
    app: { workspace: { getLeavesOfType: () => [] } },
  } as any;
  const panel = new DmControlPanel({} as any, plugin);

  const contentEl = document.createElement("div");
  document.body.appendChild(contentEl);
  const input = document.createElement("input");
  input.placeholder = "Name";
  contentEl.appendChild(input);
  (panel as any).contentEl = contentEl;

  const render = vi.fn();
  (panel as any).render = render;
  contentEl.addEventListener("focusout", (panel as any).flushPendingRender);
  return { panel, render, input };
}

describe("DmControlPanel background render guard", () => {
  it("renders immediately when no panel field is focused", () => {
    const { panel, render } = makePanel();
    (panel as any).renderFromBackground();
    expect(render).toHaveBeenCalledTimes(1);
  });

  it("defers a background render while a panel input is focused", () => {
    const { panel, render, input } = makePanel();
    input.focus();
    expect(document.activeElement).toBe(input);

    (panel as any).renderFromBackground();
    expect(render).not.toHaveBeenCalled();
    expect((panel as any).pendingBackgroundRender).toBe(true);
  });

  it("flushes the deferred render once the field loses focus", async () => {
    const { panel, render, input } = makePanel();
    input.focus();
    (panel as any).renderFromBackground();
    expect(render).not.toHaveBeenCalled();

    input.blur();
    await new Promise((r) => setTimeout(r, 5));
    expect(render).toHaveBeenCalledTimes(1);
    expect((panel as any).pendingBackgroundRender).toBe(false);
  });

  it("does not flush when focus moves to another panel field", async () => {
    const { panel, render, input } = makePanel();
    const second = document.createElement("input");
    input.parentElement!.appendChild(second);

    input.focus();
    (panel as any).renderFromBackground();
    second.focus();
    await new Promise((r) => setTimeout(r, 5));
    expect(render).not.toHaveBeenCalled();
    expect((panel as any).pendingBackgroundRender).toBe(true);
  });
});
