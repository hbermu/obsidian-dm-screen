import type { DmScreenSettings } from "./settings";

let settingsRef: DmScreenSettings | null = null;

export function initDebug(settings: DmScreenSettings) {
  settingsRef = settings;
}

export function debug(...args: unknown[]) {
  if (settingsRef?.debugMode) {
    console.log("[DM Screen]", ...args);
  }
}

export function debugWarn(...args: unknown[]) {
  if (settingsRef?.debugMode) {
    console.warn("[DM Screen]", ...args);
  }
}

export function debugError(...args: unknown[]) {
  if (settingsRef?.debugMode) {
    console.error("[DM Screen]", ...args);
  }
}
