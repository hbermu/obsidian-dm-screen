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
