import { describe, expect, it } from "vitest";

/**
 * Mirrors the getEffectiveResolution logic from DmControlPanel.
 * Tests the resolution selection algorithm independently.
 */
function getEffectiveResolution(params: {
  selectedResolution: { width: number; height: number } | null;
  connectedClients: Array<{ width: number; height: number }>;
  fallbackWidth: number;
  fallbackHeight: number;
}): { width: number; height: number } {
  const { connectedClients, fallbackWidth, fallbackHeight } = params;
  let { selectedResolution } = params;

  if (selectedResolution) {
    const hasMatch = connectedClients.some(
      c => c.width === selectedResolution!.width && c.height === selectedResolution!.height
    );
    if (hasMatch) return selectedResolution;
    selectedResolution = null;
  }
  if (connectedClients.length > 0) {
    return { width: connectedClients[0].width, height: connectedClients[0].height };
  }
  return { width: fallbackWidth, height: fallbackHeight };
}

/**
 * Mirrors the resolution deduplication logic from DmControlPanel.
 */
function deduplicateResolutions(
  clients: Array<{ width: number; height: number }>
): Array<{ width: number; height: number; count: number; key: string }> {
  const resMap = new Map<string, { width: number; height: number; count: number }>();
  for (const c of clients) {
    const key = `${c.width}×${c.height}`;
    const existing = resMap.get(key);
    if (existing) existing.count++;
    else resMap.set(key, { width: c.width, height: c.height, count: 1 });
  }
  return [...resMap.entries()].map(([key, info]) => ({ ...info, key }));
}

describe("getEffectiveResolution", () => {
  const fallback = { fallbackWidth: 1920, fallbackHeight: 1080 };

  it("returns fallback when no clients and no selection", () => {
    const res = getEffectiveResolution({
      selectedResolution: null,
      connectedClients: [],
      ...fallback,
    });
    expect(res).toEqual({ width: 1920, height: 1080 });
  });

  it("returns first client resolution when no selection", () => {
    const res = getEffectiveResolution({
      selectedResolution: null,
      connectedClients: [
        { width: 2560, height: 1440 },
        { width: 1920, height: 1080 },
      ],
      ...fallback,
    });
    expect(res).toEqual({ width: 2560, height: 1440 });
  });

  it("returns selected resolution when it matches a client", () => {
    const res = getEffectiveResolution({
      selectedResolution: { width: 1920, height: 1080 },
      connectedClients: [
        { width: 2560, height: 1440 },
        { width: 1920, height: 1080 },
      ],
      ...fallback,
    });
    expect(res).toEqual({ width: 1920, height: 1080 });
  });

  it("falls back to first client when selection no longer matches", () => {
    const res = getEffectiveResolution({
      selectedResolution: { width: 3840, height: 2160 },
      connectedClients: [
        { width: 2560, height: 1440 },
        { width: 1920, height: 1080 },
      ],
      ...fallback,
    });
    expect(res).toEqual({ width: 2560, height: 1440 });
  });

  it("falls back to defaults when selection doesn't match and no clients", () => {
    const res = getEffectiveResolution({
      selectedResolution: { width: 3840, height: 2160 },
      connectedClients: [],
      ...fallback,
    });
    expect(res).toEqual({ width: 1920, height: 1080 });
  });
});

describe("deduplicateResolutions", () => {
  it("returns empty for no clients", () => {
    expect(deduplicateResolutions([])).toEqual([]);
  });

  it("returns single entry for one client", () => {
    const result = deduplicateResolutions([{ width: 1920, height: 1080 }]);
    expect(result).toEqual([{ width: 1920, height: 1080, count: 1, key: "1920×1080" }]);
  });

  it("deduplicates same resolution with counter", () => {
    const result = deduplicateResolutions([
      { width: 1920, height: 1080 },
      { width: 1920, height: 1080 },
      { width: 1920, height: 1080 },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ width: 1920, height: 1080, count: 3, key: "1920×1080" });
  });

  it("separates different resolutions", () => {
    const result = deduplicateResolutions([
      { width: 1920, height: 1080 },
      { width: 2560, height: 1440 },
      { width: 1920, height: 1080 },
    ]);
    expect(result).toHaveLength(2);
    expect(result.find(r => r.key === "1920×1080")).toEqual({ width: 1920, height: 1080, count: 2, key: "1920×1080" });
    expect(result.find(r => r.key === "2560×1440")).toEqual({ width: 2560, height: 1440, count: 1, key: "2560×1440" });
  });
});
