import { describe, expect, it } from "vitest";
import {
  CONDITIONS,
  CONDITIONS_BY_DDB_ID,
  EXHAUSTION_DDB_ID,
  ddbConditionsToStatuses,
  decodeStatus,
  encodeExhaustion,
} from "../conditions";

describe("CONDITIONS catalogue", () => {
  it("exposes 14 conditions", () => {
    expect(Object.keys(CONDITIONS).length).toBe(14);
  });

  it("every condition carries a name, ddbId, and non-empty svg", () => {
    for (const [id, def] of Object.entries(CONDITIONS)) {
      expect(def.id).toBe(id);
      expect(def.name).toBeTruthy();
      expect(def.ddbId).toBeGreaterThan(0);
      expect(def.iconSvg.startsWith("<svg")).toBe(true);
      expect(def.iconSvg.endsWith("</svg>")).toBe(true);
    }
  });

  it("ddbIds are unique, in [1,15], and skip 4 (exhaustion)", () => {
    const ids = Object.values(CONDITIONS).map((c) => c.ddbId).sort((a, b) => a - b);
    expect(ids).toEqual([1, 2, 3, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
    expect(EXHAUSTION_DDB_ID).toBe(4);
  });

  it("CONDITIONS_BY_DDB_ID round-trips", () => {
    for (const def of Object.values(CONDITIONS)) {
      expect(CONDITIONS_BY_DDB_ID.get(def.ddbId)).toBe(def.id);
    }
  });
});

describe("encodeExhaustion", () => {
  it("encodes level 1..6", () => {
    expect(encodeExhaustion(1)).toBe("exhaustion:1");
    expect(encodeExhaustion(3)).toBe("exhaustion:3");
    expect(encodeExhaustion(6)).toBe("exhaustion:6");
  });

  it("clamps to [1, 6]", () => {
    expect(encodeExhaustion(7)).toBe("exhaustion:6");
    expect(encodeExhaustion(100)).toBe("exhaustion:6");
  });

  it("rounds floats", () => {
    expect(encodeExhaustion(2.4)).toBe("exhaustion:2");
    expect(encodeExhaustion(2.6)).toBe("exhaustion:3");
  });

  it("returns empty string for 0 or negative or non-finite", () => {
    expect(encodeExhaustion(0)).toBe("");
    expect(encodeExhaustion(-2)).toBe("");
    expect(encodeExhaustion(NaN)).toBe("");
    expect(encodeExhaustion(Infinity)).toBe("");
  });
});

describe("decodeStatus", () => {
  it("decodes a known condition id", () => {
    const r = decodeStatus("charmed");
    expect(r.kind).toBe("condition");
    if (r.kind === "condition") expect(r.def.name).toBe("Charmed");
  });

  it("decodes exhaustion:N for N in [1,6]", () => {
    for (let n = 1; n <= 6; n++) {
      const r = decodeStatus(`exhaustion:${n}`);
      expect(r.kind).toBe("exhaustion");
      if (r.kind === "exhaustion") {
        expect(r.level).toBe(n);
        expect(r.iconSvg.startsWith("<svg")).toBe(true);
      }
    }
  });

  it("treats exhaustion:0, exhaustion:7, exhaustion:abc as unknown", () => {
    for (const bad of ["exhaustion:0", "exhaustion:7", "exhaustion:abc", "exhaustion:"]) {
      const r = decodeStatus(bad);
      expect(r.kind).toBe("unknown");
      if (r.kind === "unknown") expect(r.text).toBe(bad);
    }
  });

  it("treats unrecognised strings as unknown (backwards-compat)", () => {
    const r = decodeStatus("javascript:alert(1)");
    expect(r.kind).toBe("unknown");
    if (r.kind === "unknown") expect(r.text).toBe("javascript:alert(1)");
  });

  it("handles non-string input gracefully", () => {
    expect(decodeStatus(undefined as unknown as string).kind).toBe("unknown");
    expect(decodeStatus(null as unknown as string).kind).toBe("unknown");
    expect(decodeStatus(42 as unknown as string).kind).toBe("unknown");
    expect(decodeStatus("").kind).toBe("unknown");
  });
});

describe("ddbConditionsToStatuses", () => {
  it("maps DDB conditions to status strings, sorted by DDB id", () => {
    // Morrigan's actual conditions from the encounter.
    const input = [
      { id: 2, level: null }, // Charmed
      { id: 4, level: 3 },    // Exhaustion 3
      { id: 6, level: null }, // Grappled
    ];
    expect(ddbConditionsToStatuses(input)).toEqual([
      "charmed",
      "exhaustion:3",
      "grappled",
    ]);
  });

  it("ignores unknown DDB ids", () => {
    const input = [
      { id: 99, level: null },
      { id: 5, level: null }, // Frightened
    ];
    expect(ddbConditionsToStatuses(input)).toEqual(["frightened"]);
  });

  it("ignores exhaustion with level <= 0 or missing", () => {
    expect(ddbConditionsToStatuses([{ id: 4, level: 0 }])).toEqual([]);
    expect(ddbConditionsToStatuses([{ id: 4, level: null }])).toEqual([]);
  });

  it("returns empty array for empty input", () => {
    expect(ddbConditionsToStatuses([])).toEqual([]);
  });
});
