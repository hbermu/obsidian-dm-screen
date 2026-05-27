import { describe, expect, it } from "vitest";
import { paginate } from "../hydrus/pagination";

const range = (n: number) => Array.from({ length: n }, (_, i) => i);

describe("paginate", () => {
  it("returns the requested page slice", () => {
    const result = paginate(range(250), 1, 100);
    expect(result.items).toEqual(range(200).slice(100));
    expect(result.pageIndex).toBe(1);
    expect(result.totalPages).toBe(3);
    expect(result.totalItems).toBe(250);
  });

  it("returns an empty page with totalPages=1 when the list is empty", () => {
    const result = paginate<number>([], 0, 100);
    expect(result.items).toEqual([]);
    expect(result.pageIndex).toBe(0);
    expect(result.totalPages).toBe(1);
    expect(result.totalItems).toBe(0);
  });

  it("clamps pageIndex to the last page when the request is out of range", () => {
    const result = paginate(range(150), 99, 100);
    expect(result.pageIndex).toBe(1);
    expect(result.items).toHaveLength(50);
    expect(result.items[0]).toBe(100);
  });

  it("clamps negative pageIndex to 0", () => {
    const result = paginate(range(50), -5, 100);
    expect(result.pageIndex).toBe(0);
    expect(result.items).toHaveLength(50);
  });

  it("rejects non-positive pageSize", () => {
    expect(() => paginate([1, 2, 3], 0, 0)).toThrow(/pageSize/);
    expect(() => paginate([1, 2, 3], 0, -10)).toThrow(/pageSize/);
  });
});
