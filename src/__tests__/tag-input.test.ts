import { describe, expect, it } from "vitest";
import { activeSegment, applySuggestion } from "../hydrus/tagInput";

describe("activeSegment", () => {
  it("returns the empty segment for an empty input", () => {
    expect(activeSegment("", 0)).toEqual({ start: 0, end: 0, text: "" });
  });

  it("captures the only segment when there are no commas", () => {
    expect(activeSegment("tav", 3)).toEqual({ start: 0, end: 3, text: "tav" });
  });

  it("strips leading whitespace after the last comma", () => {
    expect(activeSegment("a, b, ca", 8)).toEqual({ start: 6, end: 8, text: "ca" });
  });

  it("returns an empty segment immediately after a trailing comma+space", () => {
    expect(activeSegment("foo, ", 5)).toEqual({ start: 5, end: 5, text: "" });
  });

  it("respects an out-of-range caret by clamping", () => {
    expect(activeSegment("abc", 999)).toEqual({ start: 0, end: 3, text: "abc" });
  });
});

describe("applySuggestion", () => {
  it("inserts the suggestion when the input is empty", () => {
    expect(applySuggestion("", 0, "tavern")).toEqual({
      value: "tavern, ",
      caret: 8,
    });
  });

  it("appends a tag after existing tags", () => {
    expect(applySuggestion("a, b, ca", 8, "castle")).toEqual({
      value: "a, b, castle, ",
      caret: 14,
    });
  });

  it("only rewrites the active segment, leaving the rest intact", () => {
    // caret is between "ca" and ", b" — only "ca" should be replaced.
    expect(applySuggestion("a, ca, b", 5, "castle")).toEqual({
      value: "a, castle, , b",
      caret: 11,
    });
  });

  it("inserts a single completed tag mid-typing without duplicating commas", () => {
    expect(applySuggestion("tav", 3, "tavern")).toEqual({
      value: "tavern, ",
      caret: 8,
    });
  });
});
