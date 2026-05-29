// Types for Initiative Tracker plugin integration and Fantasy Statblocks

// Mirrors Javalent Initiative Tracker's CreatureState
export interface CreatureState {
  name: string;
  display?: string;
  hp?: number;
  ac?: number;
  modifier?: number;
  status?: string[];
  enabled?: boolean;
  active?: boolean;
  currentHP?: number;
  currentMaxHP?: number;
  tempHP?: number;
  currentAC?: number;
  initiative?: number;
  hidden?: boolean;
  friendly?: boolean;
  player?: boolean;
  hit_dice?: string;
  note?: string;
  path?: string;
  id?: string;
  source?: string | string[];
  "statblock-link"?: string;
}

// Mirrors Javalent Initiative Tracker's InitiativeViewState
export interface InitiativeViewState {
  creatures: CreatureState[];
  state: boolean; // is combat active
  name: string;
  round: number;
  logFile?: string;
  roll?: boolean;
  rollHP?: boolean;
}

// Simplified representation of a Fantasy Statblocks creature
export interface StatblockCreature {
  name: string;
  size?: string;
  type?: string;
  subtype?: string;
  alignment?: string;
  ac?: number | string;
  hp?: number | string;
  hit_dice?: string;
  speed?: string;
  stats?: number[]; // [STR, DEX, CON, INT, WIS, CHA]
  saves?: { [key: string]: number } | { [key: string]: number }[];
  skillsaves?: { [key: string]: number } | { [key: string]: number }[];
  damage_vulnerabilities?: string;
  damage_resistances?: string;
  damage_immunities?: string;
  condition_immunities?: string;
  senses?: string;
  languages?: string;
  cr?: string | number;
  traits?: StatblockAction[];
  actions?: StatblockAction[];
  reactions?: StatblockAction[];
  legendary_actions?: StatblockAction[];
  bonus_actions?: StatblockAction[];
  spells?: unknown[];
}

export interface StatblockAction {
  name: string;
  desc: string;
}

// Unified combatant used in DmControlPanel
export interface TrackerCombatant {
  name: string;
  displayName: string;
  initiative: number;
  hp: number;
  maxHp: number;
  tempHp: number;
  ac: number;
  active: boolean;
  hidden: boolean;
  friendly: boolean;
  isPlayer: boolean;
  statuses: string[];
  statblock: StatblockCreature | null;
  source: "manual" | "tracker-plugin";
}

// Image layer for multi-image player screen display
export interface ImageLayer {
  id: string;
  label: string;
  dataUrl: string;
  x: number;       // percentage 0-100
  y: number;       // percentage 0-100
  width: number;   // percentage 0-100
  height: number;  // percentage 0-100
  zIndex: number;
  rotation: number; // degrees
  visible: boolean;
  fogEnabled: boolean;
  fogDataUrl: string; // data URL of the fog canvas (black = fogged, transparent = revealed)
  bordered: boolean;
}

// Window API augmentations
declare global {
  interface Window {
    InitiativeTracker?: {
      addCreatures: (creatures: unknown[], rollHP?: boolean) => void;
      newEncounter: (state?: unknown) => void;
    };
    FantasyStatblocks?: {
      getBestiaryCreatures: () => StatblockCreature[];
      getCreatureFromBestiary: (name: string) => StatblockCreature | undefined;
      isResolved: () => boolean;
    };
  }
}
