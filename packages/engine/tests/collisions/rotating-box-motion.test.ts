import { expect, it } from "vitest";
import type { SceneDefinition } from "@eureka/contracts";
import { createEngine, type EngineDiagnostic } from "../../src/index.js";
import { expectNear, unwrap } from "../test-support.js";

const radiansPerDegree = Math.PI / 180;
const slowSpinDegreesPerSecond = 6;
const boxId = "rotating-box";

function makeRotationScene(
  id: string,
  spinDegreesPerSecond: number,
): SceneDefinition {
  return {
    schemaVersion: 1,
    id,
    revision: 1,
    seed: 17,
    numericalProfile: {
      fixedTimeStepSeconds: 1 / 60,
      substeps: 8,
      restitutionSpeedThresholdMetersPerSecond: 0,
      scales: { lengthMeters: 1, massKilograms: 1, timeSeconds: 1 },
    },
    environment: {
      gravityMetersPerSecondSquared: { x: 0, y: 0 },
      linearDragKilogramsPerSecond: 0,
    },
    bodies: [
      {
        id: boxId,
        kind: "dynamic",
        shape: { kind: "box", widthMeters: 2, heightMeters: 0.02 },
        massKilograms: 1,
        material: { restitution: 0 },
        pose: { positionMeters: { x: 0, y: 0 }, angleRadians: 0 },
        velocity: {
          linearMetersPerSecond: { x: 0, y: 0 },
          angularRadiansPerSecond: spinDegreesPerSecond * radiansPerDegree,
        },
      },
      {
        id: "thin-barrier",
        kind: "static",
        shape: { kind: "box", widthMeters: 4, heightMeters: 0.02 },
        material: { restitution: 0 },
        pose: { positionMeters: { x: 0, y: 0.26 }, angleRadians: 0 },
      },
    ],
    triggers: [],
  };
}
// Catch a solver that rejects safe motion, loses spin, or invents a contact.
it("advances a slowly rotating thin box without touching the barrier", () => {
  const scene = makeRotationScene(
    "slow-box-near-barrier",
    slowSpinDegreesPerSecond,
  );
  const engine = unwrap(createEngine(scene));

  try {
    unwrap(engine.advance(1));
    const snapshot = unwrap(engine.getSnapshot());
    expect(snapshot.tick).toBe(1);

    const box = snapshot.bodies.find((body) => body.id === boxId);
    if (box === undefined) {
      throw new Error("Expected the rotating box in the tick-1 snapshot.");
    }

    const position = box.pose.positionMeters;
    const velocity = box.velocity.linearMetersPerSecond;

    expectNear(box.pose.angleRadians, 0.1 * radiansPerDegree, 1.01e-8);
    expectNear(
      box.velocity.angularRadiansPerSecond,
      6 * radiansPerDegree,
      1.01e-8,
    );
    expectNear(Math.hypot(position.x, position.y), 0, 1.01e-8);
    expectNear(Math.hypot(velocity.x, velocity.y), 0, 1.01e-8);
    expect(snapshot.contacts).toEqual([]);
  } finally {
    expect(engine.dispose().ok).toBe(true);
  }
}); // Recognize a typed rejection that identifies the unsupported body.
function expectUnsupportedRotation(
  diagnostics: readonly EngineDiagnostic[],
): void {
  expect(diagnostics).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        code: "UNSUPPORTED_SCENE_FEATURE",
        entityId: boxId,
      }),
    ]),
  );
}

// Catch a solver that commits a tick even though rotation can cross the barrier.
it("rejects a thin box that rotates too far per substep", () => {
  // Require ordinary moving-box admission before checking the fast-motion rejection.
  const slowScene = makeRotationScene(
    "slow-box-admission-control",
    slowSpinDegreesPerSecond,
  );
  const slowEngine = unwrap(createEngine(slowScene));
  expect(slowEngine.dispose().ok).toBe(true);

  const fastScene = makeRotationScene("fast-box-near-barrier", 86_400);
  const creation = createEngine(fastScene);

  if (!creation.ok) {
    expectUnsupportedRotation(creation.diagnostics);
    return;
  }

  const engine = creation.value;
  try {
    const initial = unwrap(engine.copySnapshot());
    expect(initial.tick).toBe(0);

    const advance = engine.advance(1);
    if (advance.ok) {
      throw new Error(
        "Expected the fast rotation to be rejected before committing tick 1.",
      );
    }

    expectUnsupportedRotation(advance.diagnostics);
    expect(unwrap(engine.copySnapshot())).toEqual(initial);
  } finally {
    expect(engine.dispose().ok).toBe(true);
  }
});
