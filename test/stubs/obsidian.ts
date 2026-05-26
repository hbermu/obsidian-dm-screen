// Minimal Obsidian API stub so vitest can import modules that reference `obsidian`.
// Extend on demand when a test imports a new symbol from `obsidian`.
export class Plugin {}
export class ItemView {}
export class WorkspaceLeaf {}
export class Modal {}
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
