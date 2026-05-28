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
}

export interface DdbMonster {
  id: number;
  name: string;
  initiative: number;
  currentHitPoints: number;
  maximumHitPoints: number;
  uniqueId: string;
}

export interface DdbPlayer {
  id: number;
  name: string;
  initiative: number;
}

export interface DdbCharacterSummary {
  id: number;
  name: string;
  currentHitPoints: number;
  maxHitPoints: number;
  temporaryHitPoints: number;
}
