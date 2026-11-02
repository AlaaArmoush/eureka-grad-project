// Supplies the portable x/y coordinate shape.
import type { Vector2 } from "@eureka/contracts";

export interface ViewportTransform {
  readonly widthPixels: number;
  readonly heightPixels: number;
  readonly pixelsPerMeter: number;
  readonly centerWorldMeters: Vector2;
}

export function worldToScreen(
  worldPoint: Vector2,
  viewport: ViewportTransform
): Vector2 {
  return {
    // Measure from the camera center, convert metres to pixels,
    // then position relative to the canvas center.
    // Subtract the y offset because world y increases up, but screen y increases down.
    x:
      viewport.widthPixels / 2 +
      (worldPoint.x - viewport.centerWorldMeters.x) *
      viewport.pixelsPerMeter,
    y:
      viewport.heightPixels / 2 -
      (worldPoint.y - viewport.centerWorldMeters.y) *
      viewport.pixelsPerMeter
  };
}

export function screenToWorld(
  screenPoint: Vector2,
  viewport: ViewportTransform
): Vector2 {
  // reverse previous function to recover the world position in metres.
  return {
    x:
      viewport.centerWorldMeters.x +
      (screenPoint.x - viewport.widthPixels / 2) /
      viewport.pixelsPerMeter,
    y:
      viewport.centerWorldMeters.y -
      (screenPoint.y - viewport.heightPixels / 2) /
      viewport.pixelsPerMeter
  };
}
