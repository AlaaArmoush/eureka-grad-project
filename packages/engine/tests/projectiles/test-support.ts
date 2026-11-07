import { expect } from "vitest";
import type { SceneDefinition } from "@eureka/contracts";
import { createEngine } from "../../src/index.js";
import { unwrap } from "../test-support.js";
import { TIME_STEP } from "./scene-fixtures.js";

export function ordinaryTolerance(expected: number): number {
  return 1e-6 + 0.005 * Math.max(Math.abs(expected), 1);
}

// Advance fixed ticks until the projectile's first ground contact.
// The expected time only bounds the search; measurements come from events.
export function measureLanding(
  scene: SceneDefinition,
  expectedFlightTime: number
): { time: number; range: number } {
  const engine = unwrap(createEngine(scene));
  const tickLimit = Math.ceil(expectedFlightTime / TIME_STEP) + 2;

  try {
    for (let tick = 0; tick < tickLimit; tick += 1) {
      unwrap(engine.advance(1));
      const snapshot = unwrap(engine.getSnapshot());

      // Every observed body's physical state must remain finite.
      for (const body of snapshot.bodies) {
        const values = [
          body.pose.positionMeters.x,
          body.pose.positionMeters.y,
          body.pose.angleRadians,
          body.velocity.linearMetersPerSecond.x,
          body.velocity.linearMetersPerSecond.y,
          body.velocity.angularRadiansPerSecond
        ];

        expect(values.every(Number.isFinite)).toBe(true);
      }

      // Ignore contacts involving other bodies or surfaces.
      const landing = snapshot.events.find(
        (event) =>
          event.kind === "groundContact" &&
          event.bodyId === "projectile" &&
          event.surfaceBodyId === "ground"
      );

      // The explicit kind check lets TypeScript safely read pointMeters.
      if (landing !== undefined && landing.kind === "groundContact") {
        return {
          time: landing.timeSeconds,
          range: landing.pointMeters.x
        };
      }
    }

    throw new Error(
      `No projectile landing event within ${tickLimit} ticks.`
    );
  } finally {
    // Release this test's engine even when an assertion fails.
    expect(engine.dispose().ok).toBe(true);
  }
}
