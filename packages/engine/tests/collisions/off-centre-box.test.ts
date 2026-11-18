// Register the test and check the completed tick.
import { describe, expect, it } from "vitest";
// Check the fixture against the public scene contract.
import type { SceneDefinition } from "@eureka/contracts";
// Validate the fixture and start a fresh engine.
import { createEngine, validateScene } from "../../src/index.js";
// Read successful results and compare numbers within fixed bounds.
import { expectNear, unwrap } from "../test-support.js";

describe("off-centre box impacts", () => {
  // Catch a solver that ignores the box's lever arm or turns it the wrong way.
  it("makes a freely moving box spin clockwise after a hit above its centre", () => {
    const strikerMassKilograms = 2;
    const boxMassKilograms = 3;
    const strikerInertia = 1 / 4;
    const boxInertia = 2;
    const material = {
      restitution: 1,
      staticFrictionCoefficient: 0,
      kineticFrictionCoefficient: 0,
    };

    const scene: SceneDefinition = {
      schemaVersion: 1,
      id: "circle-hits-box-above-centre",
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
          id: "striker",
          kind: "dynamic",
          shape: { kind: "circle", radiusMeters: 0.5 },
          massKilograms: strikerMassKilograms,
          momentOfInertiaKilogramMetersSquared: strikerInertia,
          material,
          pose: { positionMeters: { x: 0, y: 0.5 }, angleRadians: 0 },
          velocity: {
            linearMetersPerSecond: { x: 4, y: 0 },
            angularRadiansPerSecond: 0,
          },
        },
        {
          id: "box",
          kind: "dynamic",
          shape: { kind: "box", widthMeters: 2, heightMeters: 2 },
          massKilograms: boxMassKilograms,
          momentOfInertiaKilogramMetersSquared: boxInertia,
          material,
          pose: { positionMeters: { x: 3.54, y: 0 }, angleRadians: 0 },
          velocity: {
            linearMetersPerSecond: { x: 0, y: 0 },
            angularRadiansPerSecond: 0,
          },
        },
      ],
      triggers: [],
    };
    const engine = unwrap(createEngine(unwrap(validateScene(scene))));

    try {
      unwrap(engine.advance(31));
      const snapshot = unwrap(engine.getSnapshot());
      expect(snapshot.tick).toBe(31);

      const striker = snapshot.bodies.find((body) => body.id === "striker");
      const box = snapshot.bodies.find((body) => body.id === "box");

      if (striker === undefined || box === undefined) {
        throw new Error("Off-centre impact requires both original bodies.");
      }

      const strikerVelocity = striker.velocity.linearMetersPerSecond;
      const boxVelocity = box.velocity.linearMetersPerSecond;
      const strikerSpin = striker.velocity.angularRadiansPerSecond;
      const boxSpin = box.velocity.angularRadiansPerSecond;

      // Compare the measured motion with the independent impulse calculation.
      const expectedStrikerVelocityX = -4 / 23;
      const expectedBoxVelocityX = 64 / 23;
      const expectedBoxSpin = -48 / 23;
      const strikerError = Math.hypot(
        strikerVelocity.x - expectedStrikerVelocityX,
        strikerVelocity.y,
      );
      const boxError = Math.hypot(
        boxVelocity.x - expectedBoxVelocityX,
        boxVelocity.y,
      );

      expectNear(strikerError, 0, 1e-10 + 1e-8);
      expectNear(boxError, 0, 1e-10 + 1e-8 * Math.abs(expectedBoxVelocityX));
      expectNear(strikerSpin, 0, 1e-10 + 1e-8);
      expectNear(
        boxSpin,
        expectedBoxSpin,
        1e-10 + 1e-8 * Math.abs(expectedBoxSpin),
      );
      const strikerMomentumX = strikerMassKilograms * strikerVelocity.x;
      const strikerMomentumY = strikerMassKilograms * strikerVelocity.y;
      const boxMomentumX = boxMassKilograms * boxVelocity.x;
      const boxMomentumY = boxMassKilograms * boxVelocity.y;

      expectNear(strikerMomentumX + boxMomentumX, 8, 1e-12 + 1e-10 * 8);
      expectNear(strikerMomentumY + boxMomentumY, 0, 1e-12 + 1e-10);

      // Add motion about the world origin and spin about each body's centre.
      const strikerPosition = striker.pose.positionMeters;
      const boxPosition = box.pose.positionMeters;
      const angularMomentum =
        strikerPosition.x * strikerMomentumY -
        strikerPosition.y * strikerMomentumX +
        boxPosition.x * boxMomentumY -
        boxPosition.y * boxMomentumX +
        strikerInertia * strikerSpin +
        boxInertia * boxSpin;

      expectNear(angularMomentum, -4, 1e-10 + 1e-8 * 4);

      const kineticEnergyJoules =
        0.5 *
          strikerMassKilograms *
          (strikerVelocity.x ** 2 + strikerVelocity.y ** 2) +
        0.5 * boxMassKilograms * (boxVelocity.x ** 2 + boxVelocity.y ** 2) +
        0.5 * strikerInertia * strikerSpin ** 2 +
        0.5 * boxInertia * boxSpin ** 2;

      expectNear(kineticEnergyJoules, 16, 1e-10 + 1e-8 * 16);
    } finally {
      expect(engine.dispose().ok).toBe(true);
    }
  });
});
