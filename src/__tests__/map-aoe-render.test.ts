import { describe, expect, it, vi } from "vitest";
import { renderAoe } from "../map/aoe";
import type { MapAoe } from "../map/types";

function makeCtx() {
  const fillAlphas: number[] = [];
  const ctx = {
    globalAlpha: 1,
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 0,
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    beginPath: vi.fn(),
    closePath: vi.fn(),
    arc: vi.fn(),
    rect: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    fill: vi.fn(() => fillAlphas.push(ctx.globalAlpha)),
    stroke: vi.fn(),
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, raw: ctx, fillAlphas };
}

const BASE: MapAoe = {
  id: "aoe-1",
  shape: "circle",
  sizeFt: 20,
  widthFt: 5,
  color: "#ff4400",
  opacity: 0.3,
  rotation: 0,
  x: 1000,
  y: 500,
};

describe("renderAoe", () => {
  it("places the shape at T + s·R(θ)·p like the stage transform", () => {
    const { ctx, raw } = makeCtx();
    renderAoe(ctx, BASE, 0.5, 10, 20, 140, 0);
    expect(raw.translate).toHaveBeenCalledWith(10 + 1000 * 0.5, 20 + 500 * 0.5);

    const rotated = makeCtx();
    renderAoe(rotated.ctx, BASE, 0.5, 10, 20, 140, 90);
    // rotatePoint(1000, 500, 90) = (-500, 1000)
    expect(rotated.raw.translate).toHaveBeenCalledWith(10 + -500 * 0.5, 20 + 1000 * 0.5);
  });

  it("composes the shape rotation with the map rotation", () => {
    const { ctx, raw } = makeCtx();
    renderAoe(ctx, { ...BASE, rotation: 45 }, 1, 0, 0, 140, 90);
    expect(raw.rotate).toHaveBeenCalledWith(((45 + 90) * Math.PI) / 180);
  });

  it("draws a circle with sizeFt as radius in scaled map pixels", () => {
    const { ctx, raw } = makeCtx();
    // 140 px/square → 28 px/ft; radius = 20 ft × 28 × 0.5 = 280
    renderAoe(ctx, BASE, 0.5, 0, 0, 140, 0);
    expect(raw.arc).toHaveBeenCalledWith(0, 0, 280, 0, Math.PI * 2);
  });

  it("draws a square centered on the anchor with sizeFt as side", () => {
    const { ctx, raw } = makeCtx();
    renderAoe(ctx, { ...BASE, shape: "square", sizeFt: 10 }, 1, 0, 0, 140, 0);
    // side = 10 ft × 28 = 280, half = 140
    expect(raw.rect).toHaveBeenCalledWith(-140, -140, 280, 280);
  });

  it("draws a cone from the vertex spanning 53 degrees", () => {
    const { ctx, raw } = makeCtx();
    renderAoe(ctx, { ...BASE, shape: "cone", sizeFt: 15 }, 1, 0, 0, 140, 0);
    const halfAngle = ((53 * Math.PI) / 180) / 2;
    expect(raw.moveTo).toHaveBeenCalledWith(0, 0);
    expect(raw.arc).toHaveBeenCalledWith(0, 0, 15 * 28, -halfAngle, halfAngle);
  });

  it("draws a line as a rect from the anchor, sizeFt long and widthFt wide", () => {
    const { ctx, raw } = makeCtx();
    renderAoe(ctx, { ...BASE, shape: "line", sizeFt: 30, widthFt: 5 }, 1, 0, 0, 140, 0);
    // length = 30 × 28 = 840; halfW = 5 × 28 / 2 = 70
    expect(raw.rect).toHaveBeenCalledWith(0, -70, 840, 140);
  });

  it("fills at the AoE opacity and strokes at full alpha in the AoE color", () => {
    const { ctx, raw, fillAlphas } = makeCtx();
    renderAoe(ctx, BASE, 1, 0, 0, 140, 0);
    expect(fillAlphas).toEqual([0.3]);
    expect(raw.fillStyle).toBe("#ff4400");
    expect(raw.strokeStyle).toBe("#ff4400");
    expect(raw.lineWidth).toBe(2);
    expect(raw.globalAlpha).toBe(1);
    expect(raw.restore).toHaveBeenCalled();
  });
});
