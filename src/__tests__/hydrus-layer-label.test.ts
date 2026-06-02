import { describe, expect, it } from "vitest";
import { layerLabelFromTags, uniqueLayerLabel } from "../views/HydrusExplorerModal";

describe("layerLabelFromTags", () => {
  it("strips the `name:` prefix and trims surrounding whitespace", () => {
    expect(
      layerLabelFromTags(["species:dragon", "name:  Adult Red Dragon  "], "abcdef1234567890")
    ).toBe("Adult Red Dragon");
  });

  it("uses the first `name:` tag when several are present", () => {
    expect(
      layerLabelFromTags(["name:Goblin", "name:Boss", "tribe:warband"], "abcdef1234567890")
    ).toBe("Goblin");
  });

  it("matches the prefix case-insensitively", () => {
    expect(layerLabelFromTags(["NAME:Knight", "rank:elite"], "abcdef1234567890")).toBe(
      "Knight"
    );
  });

  it("falls back to `Hydrus <hash8>` when no `name:` tag exists", () => {
    expect(layerLabelFromTags(["species:dragon", "rating:safe"], "abcdef1234567890")).toBe(
      "Hydrus abcdef12"
    );
  });

  it("falls back when the only `name:` tag has an empty value", () => {
    expect(layerLabelFromTags(["name:   "], "abcdef1234567890")).toBe("Hydrus abcdef12");
  });
});

describe("uniqueLayerLabel", () => {
  it("returns the base label when no collision exists", () => {
    expect(uniqueLayerLabel([{ label: "Dragon" }], "Goblin")).toBe("Goblin");
  });

  it("appends ` 2` on the first case-insensitive collision", () => {
    expect(uniqueLayerLabel([{ label: "goblin" }], "Goblin")).toBe("Goblin 2");
  });

  it("walks up to the next free integer suffix", () => {
    expect(
      uniqueLayerLabel(
        [{ label: "Goblin" }, { label: "Goblin 2" }, { label: "Goblin 3" }],
        "Goblin"
      )
    ).toBe("Goblin 4");
  });

  it("does not assume the suffixed labels are contiguous", () => {
    expect(
      uniqueLayerLabel([{ label: "Goblin" }, { label: "Goblin 5" }], "Goblin")
    ).toBe("Goblin 2");
  });
});
