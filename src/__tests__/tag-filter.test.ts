import { describe, expect, it } from "vitest";
import { filterTags } from "../hydrus/tagFilter";

describe("filterTags", () => {
  it("returns all tags when ignore list is empty", () => {
    const tags = ["castle", "night", "rain"];
    expect(filterTags(tags, [])).toEqual(["castle", "night", "rain"]);
  });

  it("filters exact-match patterns", () => {
    const tags = ["castle", "wd eva02-large v3 tagger ai generated tags", "rain"];
    expect(filterTags(tags, ["wd eva02-large v3 tagger ai generated tags"])).toEqual([
      "castle",
      "rain",
    ]);
  });

  it("filters regex patterns with anchoring", () => {
    const tags = ["rating:general", "rating:safe", "forest", "night"];
    expect(filterTags(tags, ["rating:.*"])).toEqual(["forest", "night"]);
  });

  it("does not filter partial matches (patterns are anchored)", () => {
    const tags = ["my rating:stuff extra", "rating:safe"];
    expect(filterTags(tags, ["rating:.*"])).toEqual(["my rating:stuff extra"]);
  });

  it("handles multiple patterns", () => {
    const tags = [
      "castle",
      "wd eva02-large v3 tagger ai generated tags",
      "rating:general",
      "forest",
    ];
    const patterns = ["wd eva02-large v3 tagger ai generated tags", "rating:.*"];
    expect(filterTags(tags, patterns)).toEqual(["castle", "forest"]);
  });

  it("skips invalid regex patterns gracefully", () => {
    const tags = ["castle", "night"];
    expect(filterTags(tags, ["[invalid("])).toEqual(["castle", "night"]);
  });

  it("returns empty array when all tags are filtered", () => {
    const tags = ["rating:safe", "rating:general"];
    expect(filterTags(tags, ["rating:.*"])).toEqual([]);
  });

  it("returns empty array for empty input", () => {
    expect(filterTags([], ["rating:.*"])).toEqual([]);
  });

  it("pattern with escaped characters works", () => {
    const tags = ["wd v1.4 vit v2 tagger ai generated tags", "forest"];
    expect(filterTags(tags, ["wd v1\\.4 vit v2 tagger ai generated tags"])).toEqual(["forest"]);
  });

  it("unescaped dot matches any character", () => {
    const tags = ["wd v1.4 vit v2 tagger ai generated tags", "wd v1X4 vit v2 tagger ai generated tags"];
    // Without escaping, dot matches any char — both should be filtered
    expect(filterTags(tags, ["wd v1.4 vit v2 tagger ai generated tags"])).toEqual([]);
  });
});
