import { describe, expect, it } from "vitest";
import type { SceneDefinition } from "@eureka/contracts";
import { createEngine, validateScene } from "../../src/index.js";
import { expectNear, unwrap } from "../test-support.js";

describe("frictionless glancing circle impacts", () => {
  // Catch a head-on response or a wrong sideways impulse in an off-centre hit
  it("transfers sideways momentum without making either circle spin", () => {
    const strikerMassKilograms = 2;
    const receiverMassKilograms = 1;
    const radiusMeters = 0.5;
    const rootThree = Math.sqrt(3);
    const material = {
      restitution: 1,
      staticFrictionCoefficient: 0,
      kineticFrictionCoefficient: 0,
    };

    const scene: SceneDefinition = {
      schemaVersion: 1,
      id: "glancing-elastic-circles",
      revision: 1,
      seed: 17,
      numericalProfile: {
        fixedTimeStepSeconds: 1 / 60,
        substeps: 1,
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
          shape: { kind: "circle", radiusMeters },
          massKilograms: strikerMassKilograms,
          // A uniform disk has inertia equal to half its mass times its radius squared.
          momentOfInertiaKilogramMetersSquared:
            0.5 * strikerMassKilograms * radiusMeters ** 2,
          material,
          pose: { positionMeters: { x: 0, y: 0 }, angleRadians: 0 },
          velocity: {
            linearMetersPerSecond: { x: 4, y: 0 },
            angularRadiansPerSecond: 0,
          },
        },
        {
          id: "receiver",
          kind: "dynamic",
          shape: { kind: "circle", radiusMeters },
          massKilograms: receiverMassKilograms,
          momentOfInertiaKilogramMetersSquared:
            0.5 * receiverMassKilograms * radiusMeters ** 2,
          material,
          pose: {
            positionMeters: { x: 2.04 + rootThree / 2, y: 0.5 },
            angleRadians: 0,
          },
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
      const receiver = snapshot.bodies.find((body) => body.id === "receiver");

      if (striker === undefined || receiver === undefined) {
        throw new Error("Glancing impact requires both original circles.");
      }

      const strikerVelocity = striker.velocity.linearMetersPerSecond;
      const receiverVelocity = receiver.velocity.linearMetersPerSecond;
      const momentumX =
        strikerMassKilograms * strikerVelocity.x +
        receiverMassKilograms * receiverVelocity.x;
      const momentumY =
        strikerMassKilograms * strikerVelocity.y +
        receiverMassKilograms * receiverVelocity.y;

      expectNear(momentumX, 8, 1e-12 + 1e-10 * 8);
      expectNear(momentumY, 0, 1e-12 + 1e-10);
      expectNear(striker.velocity.angularRadiansPerSecond, 0, 1e-8);
      expectNear(receiver.velocity.angularRadiansPerSecond, 0, 1e-8);

      // Both velocity components contribute to each circle's kinetic energy.
      const strikerSpeed = Math.hypot(strikerVelocity.x, strikerVelocity.y);
      const receiverSpeed = Math.hypot(receiverVelocity.x, receiverVelocity.y);
      const actualKineticEnergyJoules =
        0.5 * strikerMassKilograms * strikerSpeed ** 2 +
        0.5 * receiverMassKilograms * receiverSpeed ** 2;

      expectNear(actualKineticEnergyJoules, 16, 1e-10 + 1e-8 * 16);
      // Compare both components of each velocity with the independent result.
      const expectedStrikerY = (-2 * rootThree) / 3;
      const expectedReceiverY = (4 * rootThree) / 3;
      const strikerError = Math.hypot(
        strikerVelocity.x - 2,
        strikerVelocity.y - expectedStrikerY,
      );
      const receiverError = Math.hypot(
        receiverVelocity.x - 4,
        receiverVelocity.y - expectedReceiverY,
      );

      expectNear(
        strikerError,
        0,
        1e-10 + 1e-8 * Math.hypot(2, expectedStrikerY),
      );
      expectNear(
        receiverError,
        0,
        1e-10 + 1e-8 * Math.hypot(4, expectedReceiverY),
      );

      // Read the impact reported for this tick.
      const contact = snapshot.contacts?.find(
        (entry) => entry.bodyAId === "receiver" && entry.bodyBId === "striker",
      );
      if (contact === undefined) {
        throw new Error("Expected a glancing circle contact at tick 31.");
      }

      const expectedNormalImpulse = (8 * rootThree) / 3;
      const impulseBound = 1e-12 + 1e-10 * expectedNormalImpulse;

      expect(contact.tick).toBe(31);
      expectNear(contact.timeSeconds, 0.51, 2.5e-8);
      expectNear(contact.normal.x, -rootThree / 2, 1e-8);
      expectNear(contact.normal.y, -0.5, 1e-8);
      expectNear(
        contact.normalImpulseNewtonSeconds,
        expectedNormalImpulse,
        impulseBound,
      );
      expectNear(contact.tangentImpulseNewtonSeconds, 0, 1.01e-10);
    } finally {
      expect(engine.dispose().ok).toBe(true);
    }
  });
});
