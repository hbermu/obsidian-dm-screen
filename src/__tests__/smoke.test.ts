import { describe, expect, it } from "vitest";

describe("smoke", () => {
  it("vitest pipeline runs", () => {
    expect(1 + 1).toBe(2);
  });

  it("happy-dom provides a DOM", () => {
    const el = document.createElement("div");
    el.textContent = "hello";
    expect(el.textContent).toBe("hello");
  });
});
