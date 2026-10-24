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
