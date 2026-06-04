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
export class PluginSettingTab {}
export class Setting {
  constructor(_containerEl: HTMLElement) {}
}
export class TFile {}
export class TFolder {}
export class App {}
export const Platform = { isDesktop: true, isMobile: false };
export type MarkdownPostProcessorContext = unknown;

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
