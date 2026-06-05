export interface DdbCobaltTokenResponse {
  token: string;
  ttl: number;
}

export interface DdbEncounterSummary {
  id: string;
  name: string;
  inProgress: boolean;
}

export interface DdbEncounter {
  id: string;
  name: string;
  inProgress: boolean;
  roundNum: number;
  turnNum: number;
  monsters: DdbMonster[];
  players: DdbPlayer[];
  manualEntries: DdbManualEntry[];
}

export interface DdbMonster {
  id: number;
  name: string;
  initiative: number;
  currentHitPoints: number;
  maximumHitPoints: number;
  uniqueId: string;
  avatarUrl: string;
}

export interface DdbPlayer {
  id: number;
  name: string;
  initiative: number;
}

export interface DdbManualEntry {
  id: string;
  name: string;
  initiative: number;
  currentHitPoints: number;
  maximumHitPoints: number;
}

export interface DdbCharacterSummary {
  id: number;
  name: string;
  currentHitPoints: number;
  maxHitPoints: number;
  temporaryHitPoints: number;
  // Encoded D&D 5e conditions sourced from the character sheet
  // (`data.conditions[]`). Format defined in `src/conditions.ts`:
  // condition ids (e.g. "charmed") plus "exhaustion:1".."exhaustion:6".
  statuses: string[];
  // Mirrors `data.inspiration` (top-level boolean) from the character
  // sheet. Surfaces heroic inspiration on the player-screen tracker so
  // players can remind each other; never written back.
  inspired: boolean;
}
