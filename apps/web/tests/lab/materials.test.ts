import type { Graphics } from "pixi.js";
import { expect, it, vi } from "vitest";
import { paintEntity } from "../../src/lab/materials.js";
import type { Body } from "@eureka/contracts";

// Record drawing commands without creating a browser, canvas or renderer.
vi.mock("pixi.js", () => ({ Graphics: vi.fn(), Texture: {} }));

function drawingRecorder() {
  const drawing = {
    clear: vi.fn(), rect: vi.fn(), circle: vi.fn(), fill: vi.fn(), poly: vi.fn(),
    moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(),
  };
  for (const method of Object.values(drawing)) method.mockReturnValue(drawing);
  return drawing;
}

// Offscreen ground length must not multiply hatch work, even at maximum zoom.
it.each([48, 192, 1536])("bounds ground drawing work at %s pixels per metre", (scale) => {
  const counts: number[] = [];
  for (const widthMeters of [30, 1200]) {
    const ground: Body = {
      id: "default-ground", kind: "static",
      shape: { kind: "box", widthMeters, heightMeters: 0.5 },
      material: { restitution: 0 },
      pose: { positionMeters: { x: 0, y: -0.35 }, angleRadians: 0 },
    };
    const drawing = drawingRecorder();
    paintEntity(drawing as unknown as Graphics, ground, scale, false, {
      left: -160, right: 160, top: -120, bottom: 120,
    });
    counts.push(drawing.lineTo.mock.calls.length);
    expect(drawing.lineTo.mock.calls.length).toBeLessThan(100);
    // Limit decoration without shortening the actual physical surface drawing.
    expect(drawing.rect).toHaveBeenCalledWith(-widthMeters * scale / 2, -0.5 * scale / 2, widthMeters * scale, 0.5 * scale);
  }
  expect(Math.abs((counts[1] ?? 0) - (counts[0] ?? 0))).toBeLessThanOrEqual(1);
});

// A tiny ball keeps its real outline instead of being overwhelmed by fixed-pixel texture.
it("draws a small projectile at its physical screen radius without pencil hatching", () => {
  const projectile: Body = {
    id: "projectile", kind: "dynamic", massKilograms: 1,
    shape: { kind: "circle", radiusMeters: 0.1 }, material: { restitution: 0 },
    pose: { positionMeters: { x: 0, y: 0 }, angleRadians: 0 },
    velocity: { linearMetersPerSecond: { x: 0, y: 0 }, angularRadiansPerSecond: 0 },
  };
  const drawing = drawingRecorder();
  paintEntity(drawing as unknown as Graphics, projectile, 12, false);
  expect(drawing.circle.mock.calls[0]?.slice(0, 2)).toEqual([0, 0]);
  expect(drawing.circle.mock.calls[0]?.[2]).toBeCloseTo(1.2, 12);
  expect(drawing.lineTo).not.toHaveBeenCalled();
});
