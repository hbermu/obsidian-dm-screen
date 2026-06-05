// D&D 5e condition catalogue.
//
// Source of truth for both the player bundle (`src/player/player.ts`) and
// the DM-side views. Each entry pairs the canonical id we use in the
// `statuses: string[]` channel with the D&D Beyond numeric id (so the DDB
// parser can map them) and a small original SVG glyph.
//
// Status string encoding:
//   condition: `"charmed"`, `"frightened"`, …
//   exhaustion: `"exhaustion:1"` … `"exhaustion:6"` (level)
//   anything else: rendered as a plain text badge (backwards-compat)

export type ConditionId =
  | "blinded"
  | "charmed"
  | "deafened"
  | "frightened"
  | "grappled"
  | "incapacitated"
  | "invisible"
  | "paralyzed"
  | "petrified"
  | "poisoned"
  | "prone"
  | "restrained"
  | "stunned"
  | "unconscious";

export interface ConditionDef {
  id: ConditionId;
  name: string;
  ddbId: number; // 1..15 excluding 4 (which is Exhaustion)
  iconSvg: string;
}

const OPEN = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="100%" height="100%" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">';
const CLOSE = "</svg>";
const wrap = (body: string): string => `${OPEN}${body}${CLOSE}`;

export const CONDITIONS: Record<ConditionId, ConditionDef> = {
  blinded: {
    id: "blinded",
    name: "Blinded",
    ddbId: 1,
    iconSvg: wrap('<ellipse cx="12" cy="12" rx="10" ry="6"/><circle cx="12" cy="12" r="2.5"/><line x1="4" y1="4" x2="20" y2="20"/>'),
  },
  charmed: {
    id: "charmed",
    name: "Charmed",
    ddbId: 2,
    iconSvg: wrap('<path d="M12 21s-8-5.5-8-12a4 4 0 0 1 8-2 4 4 0 0 1 8 2c0 6.5-8 12-8 12z"/>'),
  },
  deafened: {
    id: "deafened",
    name: "Deafened",
    ddbId: 3,
    iconSvg: wrap('<path d="M8 19a4 4 0 0 1-4-4V10a8 8 0 0 1 16 0v3"/><line x1="4" y1="4" x2="20" y2="20"/>'),
  },
  frightened: {
    id: "frightened",
    name: "Frightened",
    ddbId: 5,
    iconSvg: wrap('<circle cx="12" cy="12" r="9"/><circle cx="9" cy="10" r="1.2" fill="currentColor"/><circle cx="15" cy="10" r="1.2" fill="currentColor"/><ellipse cx="12" cy="16" rx="2" ry="2.5"/>'),
  },
  grappled: {
    id: "grappled",
    name: "Grappled",
    ddbId: 6,
    iconSvg: wrap('<circle cx="8" cy="12" r="5"/><circle cx="16" cy="12" r="5"/>'),
  },
  incapacitated: {
    id: "incapacitated",
    name: "Incapacitated",
    ddbId: 7,
    iconSvg: wrap('<circle cx="12" cy="12" r="9"/><line x1="8" y1="8" x2="16" y2="16"/><line x1="16" y1="8" x2="8" y2="16"/>'),
  },
  invisible: {
    id: "invisible",
    name: "Invisible",
    ddbId: 8,
    iconSvg: wrap('<circle cx="12" cy="12" r="9" stroke-dasharray="3 3"/>'),
  },
  paralyzed: {
    id: "paralyzed",
    name: "Paralyzed",
    ddbId: 9,
    iconSvg: wrap('<polygon points="13 2 4 14 11 14 9 22 20 10 13 10 15 2" fill="currentColor" stroke="none"/>'),
  },
  petrified: {
    id: "petrified",
    name: "Petrified",
    ddbId: 10,
    iconSvg: wrap('<polygon points="12 3 20 7 20 17 12 21 4 17 4 7"/>'),
  },
  poisoned: {
    id: "poisoned",
    name: "Poisoned",
    ddbId: 11,
    iconSvg: wrap('<path d="M12 3c0 0 -7 8 -7 13a7 7 0 0 0 14 0c0 -5 -7 -13 -7 -13z"/>'),
  },
  prone: {
    id: "prone",
    name: "Prone",
    ddbId: 12,
    iconSvg: wrap('<rect x="3" y="13" width="18" height="5" rx="2"/><circle cx="6" cy="10" r="2"/>'),
  },
  restrained: {
    id: "restrained",
    name: "Restrained",
    ddbId: 13,
    iconSvg: wrap('<rect x="3" y="9" width="9" height="6" rx="3"/><rect x="12" y="9" width="9" height="6" rx="3"/>'),
  },
  stunned: {
    id: "stunned",
    name: "Stunned",
    ddbId: 14,
    iconSvg: wrap('<polygon points="12 3 13.5 9 19.5 9 14.5 13 16.5 19 12 15.5 7.5 19 9.5 13 4.5 9 10.5 9" fill="currentColor" stroke="none"/>'),
  },
  unconscious: {
    id: "unconscious",
    name: "Unconscious",
    ddbId: 15,
    iconSvg: wrap('<text x="4" y="11" font-size="8" font-family="sans-serif" font-weight="bold" fill="currentColor" stroke="none">Z</text><text x="9" y="17" font-size="10" font-family="sans-serif" font-weight="bold" fill="currentColor" stroke="none">Z</text><text x="14" y="22" font-size="12" font-family="sans-serif" font-weight="bold" fill="currentColor" stroke="none">Z</text>'),
  },
};

export const CONDITIONS_BY_DDB_ID = new Map<number, ConditionId>(
  Object.values(CONDITIONS).map((c) => [c.ddbId, c.id])
);

export const EXHAUSTION_DDB_ID = 4;

const EXHAUSTION_ICON = wrap(
  '<polyline points="6 6 12 10 18 6"/><polyline points="6 12 12 16 18 12"/><polyline points="6 18 12 22 18 18"/>'
);

export function exhaustionIcon(): string {
  return EXHAUSTION_ICON;
}

export function encodeExhaustion(level: number): string {
  if (!Number.isFinite(level) || level <= 0) return "";
  const clamped = Math.max(1, Math.min(6, Math.round(level)));
  return `exhaustion:${clamped}`;
}

export type DecodedStatus =
  | { kind: "condition"; def: ConditionDef }
  | { kind: "exhaustion"; level: number; iconSvg: string }
  | { kind: "unknown"; text: string };

export function decodeStatus(s: unknown): DecodedStatus {
  if (typeof s !== "string" || s.length === 0) {
    return { kind: "unknown", text: typeof s === "string" ? s : "" };
  }
  if (s.startsWith("exhaustion:")) {
    const n = parseInt(s.slice("exhaustion:".length), 10);
    if (Number.isFinite(n) && n >= 1 && n <= 6) {
      return { kind: "exhaustion", level: n, iconSvg: EXHAUSTION_ICON };
    }
    return { kind: "unknown", text: s };
  }
  if (Object.prototype.hasOwnProperty.call(CONDITIONS, s)) {
    return { kind: "condition", def: CONDITIONS[s as ConditionId] };
  }
  return { kind: "unknown", text: s };
}

export function ddbConditionsToStatuses(
  ddbConditions: ReadonlyArray<{ id: number; level: number | null }>
): string[] {
  const out: string[] = [];
  // Stable sort by DDB id so output is deterministic across polls.
  const sorted = [...ddbConditions].sort((a, b) => a.id - b.id);
  for (const c of sorted) {
    if (c.id === EXHAUSTION_DDB_ID) {
      const enc = encodeExhaustion(c.level ?? 0);
      if (enc) out.push(enc);
      continue;
    }
    const condId = CONDITIONS_BY_DDB_ID.get(c.id);
    if (condId) out.push(condId);
  }
  return out;
}
