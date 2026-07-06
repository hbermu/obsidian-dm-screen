// Minimal Obsidian API stub so vitest can import modules that reference `obsidian`.
// Extend on demand when a test imports a new symbol from `obsidian`.
export class Plugin {}
export class ItemView {}
export class WorkspaceLeaf {}
export class Modal {
  app: unknown;
  modalEl: HTMLElement;
  titleEl: HTMLElement;
  contentEl: HTMLElement;
  closeSpy?: () => void;
  constructor(app: unknown) {
    this.app = app;
    this.modalEl = document.createElement("div");
    this.titleEl = document.createElement("div");
    this.contentEl = document.createElement("div");
    this.modalEl.appendChild(this.titleEl);
    this.modalEl.appendChild(this.contentEl);
  }
  open(): void {}
  close(): void {
    if (this.closeSpy) this.closeSpy();
  }
  onOpen(): void {}
  onClose(): void {}
}
export class Notice {
  constructor(_message: string, _timeout?: number) {}
}
export class FuzzySuggestModal<T> {
  app: unknown;
  constructor(app: unknown) {
    this.app = app;
  }
  setPlaceholder(_placeholder: string): void {}
  open(): void {}
  close(): void {}
  getItems(): T[] {
    return [];
  }
  getItemText(_item: T): string {
    return "";
  }
  onChooseItem(_item: T, _evt?: unknown): void {}
}
export class MenuItem {
  private _title = "";
  private _checked = false;
  private _disabled = false;
  private _onClick: (() => void) | null = null;
  setTitle(t: string): this { this._title = t; return this; }
  setIcon(_i: string): this { return this; }
  setChecked(c: boolean): this { this._checked = c; return this; }
  setDisabled(d: boolean): this { this._disabled = d; return this; }
  onClick(fn: () => void): this { this._onClick = fn; return this; }
  get title(): string { return this._title; }
  get checked(): boolean { return this._checked; }
  get disabled(): boolean { return this._disabled; }
  triggerClick(): void { this._onClick?.(); }
}
export class Menu {
  items: MenuItem[] = [];
  addItem(cb: (item: MenuItem) => void): this {
    const item = new MenuItem();
    cb(item);
    this.items.push(item);
    return this;
  }
  addSeparator(): this { return this; }
  showAtMouseEvent(_e: MouseEvent): void {}
  showAtPosition(_p: { x: number; y: number }): void {}
}
export class PluginSettingTab {}
export class Setting {
  constructor(_containerEl: HTMLElement) {}
}
export class TFile {}
export class TFolder {}
export class App {}
export const Platform = { isDesktop: true, isMobile: false };
export type MarkdownPostProcessorContext = unknown;

// Standalone helper: real Obsidian injects a lucide SVG into the element.
// The stub just records the icon name so tests can assert on it.
export function setIcon(el: { setAttribute?: (k: string, v: string) => void }, iconName: string): void {
  el.setAttribute?.("data-icon", iconName);
}

// `requestUrl` shape mirrors Obsidian's real signature so tests can stub it.
export interface RequestUrlParam {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string | ArrayBuffer;
  contentType?: string;
  throw?: boolean;
}
export interface RequestUrlResponse {
  status: number;
  json: unknown;
  text: string;
  arrayBuffer: ArrayBuffer;
  headers: Record<string, string>;
}

// Default implementation throws. Tests override via vi.spyOn or by reassigning
// the module export through vi.mock("obsidian", …).
export const requestUrl = async (
  _param: RequestUrlParam | string
): Promise<RequestUrlResponse> => {
  throw new Error("requestUrl stub: override in your test");
};
