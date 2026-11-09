import { expect } from "vitest";
import type { SceneDefinition } from "@eureka/contracts";
import { createEngine } from "../../src/index.js";
import { unwrap, expectNear } from "../test-support.js";
import { TIME_STEP, makeScene } from "./scene-fixtures.js";

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
  const tickLimit = Math.ceil(
    expectedFlightTime / scene.numericalProfile.fixedTimeStepSeconds
  ) + 2;

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

// Copy a one-second public trajectory so several checks can share the same run shape.
export function observeReferenceFlight(
  massKilograms: number,
  dragKilogramsPerSecond: number,
  timeStepSeconds = TIME_STEP
): {
  initial: { x: number; y: number; vx: number; vy: number };
  final: { x: number; y: number; vx: number; vy: number };
  samples: { x: number; y: number; vx: number; vy: number }[];
} {
  const engine = unwrap(createEngine(makeScene(20, 30, 0, false, {
    massKilograms,
    linearDragKilogramsPerSecond: dragKilogramsPerSecond,
    fixedTimeStepSeconds: timeStepSeconds
  })));

  try {
    // Return plain values rather than retaining mutable snapshot objects.
    function readState(): { x: number; y: number; vx: number; vy: number } {
      const body = unwrap(engine.getSnapshot()).bodies.find(
        (candidate) => candidate.id === "projectile"
      );

      if (body === undefined) {
        throw new Error("Snapshot omitted the projectile.");
      }

      const state = {
        x: body.pose.positionMeters.x,
        y: body.pose.positionMeters.y,
        vx: body.velocity.linearMetersPerSecond.x,
        vy: body.velocity.linearMetersPerSecond.y
      };

      expect(Object.values(state).every(Number.isFinite)).toBe(true);
      return state;
    }

    const initial = readState();
    const samples = [initial];
    let final = initial;

    // One second is exactly divisible by each timestep used in these tests.
    for (let tick = 0; tick < Math.round(1 / timeStepSeconds); tick += 1) {
      unwrap(engine.advance(1));
      final = readState();
      samples.push(final);
    }

    expectNear(
      unwrap(engine.getSnapshot()).simulationTimeSeconds,
      1,
      1e-12
    );

    return { initial, final, samples };
  } finally {
    // This helper owns the engine and releases it even when a check fails.
    expect(engine.dispose().ok).toBe(true);
  }
}
