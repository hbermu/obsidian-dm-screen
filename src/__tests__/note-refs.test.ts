import { describe, expect, it } from "vitest";
import { parseHydrusRefs } from "../hydrus/noteRefs";

const H1 = "a".repeat(64);
const H2 = "b".repeat(64);

describe("parseHydrusRefs", () => {
  it("extracts a single labelled reference", () => {
    expect(parseHydrusRefs(`intro [Goblin warrior](hydrus://${H1}) outro`)).toEqual([
      { label: "Goblin warrior", hash: H1 },
    ]);
  });

  it("returns multiple refs in order", () => {
    const body = `[One](hydrus://${H1})\n[Two](hydrus://${H2})`;
    expect(parseHydrusRefs(body)).toEqual([
      { label: "One", hash: H1 },
      { label: "Two", hash: H2 },
    ]);
  });

  it("dedupes by hash, keeping the first label", () => {
    const body = `[First](hydrus://${H1}) ... [Second](hydrus://${H1.toUpperCase()})`;
    expect(parseHydrusRefs(body)).toEqual([{ label: "First", hash: H1 }]);
  });

  it("ignores malformed and non-hydrus links", () => {
    const body = [
      `[short](hydrus://${"a".repeat(40)})`,
      `[plain](https://example.com/x.png)`,
      `[[wikilink]]`,
      `hydrus://${H2}`,
    ].join("\n");
    expect(parseHydrusRefs(body)).toEqual([]);
  });

  it("accepts an empty label", () => {
    expect(parseHydrusRefs(`[](hydrus://${H1})`)).toEqual([{ label: "", hash: H1 }]);
  });
});
