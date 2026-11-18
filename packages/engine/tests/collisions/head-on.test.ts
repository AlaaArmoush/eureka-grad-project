import { describe, expect, it } from "vitest";
import type { SceneDefinition } from "@eureka/contracts";
import { createEngine, validateScene } from "../../src/index.js";
import { expectNear, unwrap } from "../test-support.js";

describe("elastic head-on collisions", () => {
  // Catch incorrect momentum
  it("slows a 2 kg striker and accelerates a stationary 1 kg receiver", () => {
    // Set up
    const strikerMassKilograms = 2;
    const receiverMassKilograms = 1;
    const scene: SceneDefinition = {
      schemaVersion: 1,
      id: "elastic-head-on-pair",
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
          shape: { kind: "circle", radiusMeters: 0.5 },
          massKilograms: strikerMassKilograms,
          material: {
            restitution: 1,
            staticFrictionCoefficient: 0,
            kineticFrictionCoefficient: 0,
          },
          pose: { positionMeters: { x: 0, y: 0 }, angleRadians: 0 },
          velocity: {
            linearMetersPerSecond: { x: 4, y: 0 },
            angularRadiansPerSecond: 0,
          },
        },
        {
          id: "receiver",
          kind: "dynamic",
          shape: { kind: "circle", radiusMeters: 0.5 },
          massKilograms: receiverMassKilograms,
          material: {
            restitution: 1,
            staticFrictionCoefficient: 0,
            kineticFrictionCoefficient: 0,
          },
          pose: { positionMeters: { x: 3, y: 0 }, angleRadians: 0 },
          velocity: {
            linearMetersPerSecond: { x: 0, y: 0 },
            angularRadiansPerSecond: 0,
          },
        },
      ],
      triggers: [],
    };

    // Expectations
    // Momentum: 2 * 4 + 1 * 0 = 2 * vA + vB = 8 kg*m/s.
    // Restitution e=1: vB - vA = 4, so vB = vA + 4.
    // Substitution gives 3 * vA = 4, SO vA = 4/3 and vB = 16/3 m/s.
    const expectedStrikerVelocityX = 4 / 3;
    const expectedReceiverVelocityX = 16 / 3;
    const expectedMomentumX = 8;

    // 	Decide acceptable numerical error
    const strikerVelocityTolerance =
      1e-10 + 1e-8 * Math.max(Math.abs(expectedStrikerVelocityX), 1);
    const receiverVelocityTolerance =
      1e-10 + 1e-8 * Math.max(Math.abs(expectedReceiverVelocityX), 1);
    const momentumXTolerance =
      1e-12 + 1e-10 * Math.max(Math.abs(expectedMomentumX), 1);
    const momentumYTolerance = 1e-12 + 1e-10 * 1;

    // The initial scene gives the pair 16 J of kinetic energy k = 0.5 (m)*(v^2)
    const expectedKineticEnergyJoules = 16;
    const kineticEnergyTolerance = 1e-10 + 1e-8 * expectedKineticEnergyJoules;

    // Validate through the public boundary, then create this test's engine.
    const validatedScene = unwrap(validateScene(scene));
    const engine = unwrap(createEngine(validatedScene));

    try {
      // Advance 60 fixed ticks to 1 s
      const receipt = unwrap(engine.advance(60));
      const snapshot = unwrap(engine.getSnapshot());

      expect(receipt.lastValidTick).toBe(60);
      expect(snapshot.tick).toBe(60);
      expectNear(snapshot.simulationTimeSeconds, 1, 1e-12);

      const striker = snapshot.bodies.find((body) => body.id === "striker");
      const receiver = snapshot.bodies.find((body) => body.id === "receiver");

      if (striker === undefined || receiver === undefined) {
        throw new Error(
          "Collision snapshot must contain both striker and receiver.",
        );
      }

      const strikerVelocity = striker.velocity.linearMetersPerSecond;
      const receiverVelocity = receiver.velocity.linearMetersPerSecond;

      // P = mv
      const momentumX =
        strikerMassKilograms * strikerVelocity.x +
        receiverMassKilograms * receiverVelocity.x;
      const momentumY =
        strikerMassKilograms * strikerVelocity.y +
        receiverMassKilograms * receiverVelocity.y;
      expectNear(momentumX, expectedMomentumX, momentumXTolerance);
      expectNear(momentumY, 0, momentumYTolerance);
      // Check that neither circle starts spinning after the impact
      const spinToleranceRadiansPerSecond = 1e-8;
      expectNear(
        striker.velocity.angularRadiansPerSecond,
        0,
        spinToleranceRadiansPerSecond,
      );
      expectNear(
        receiver.velocity.angularRadiansPerSecond,
        0,
        spinToleranceRadiansPerSecond,
      );
      // the after velocity squared for both balls
      const strikerSpeedSquared =
        strikerVelocity.x ** 2 + strikerVelocity.y ** 2;
      const receiverSpeedSquared =
        receiverVelocity.x ** 2 + receiverVelocity.y ** 2;

      // The kinetic energy
      const strikerKineticEnergyJoules =
        0.5 * strikerMassKilograms * strikerSpeedSquared;
      const receiverKineticEnergyJoules =
        0.5 * receiverMassKilograms * receiverSpeedSquared;

      const actualKineticEnergyJoules =
        strikerKineticEnergyJoules + receiverKineticEnergyJoules;

      expectNear(
        actualKineticEnergyJoules,
        expectedKineticEnergyJoules,
        kineticEnergyTolerance,
      );
      const strikerVelocityError = Math.hypot(
        strikerVelocity.x - expectedStrikerVelocityX,
        strikerVelocity.y,
      );
      const receiverVelocityError = Math.hypot(
        receiverVelocity.x - expectedReceiverVelocityX,
        receiverVelocity.y,
      );

      expectNear(strikerVelocityError, 0, strikerVelocityTolerance);
      expectNear(receiverVelocityError, 0, receiverVelocityTolerance);
    } finally {
      expect(engine.dispose().ok).toBe(true);
    }
  });
});
describe("inelastic head-on collisions", () => {
  it("slows a 2 kg striker and accelerates a stationary 1 kg receiver", () => {
    // Set up
    const strikerMassKilograms = 2;
    const receiverMassKilograms = 1;
    const scene: SceneDefinition = {
      schemaVersion: 1,
      id: "elastic-head-on-pair",
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
          shape: { kind: "circle", radiusMeters: 0.5 },
          massKilograms: strikerMassKilograms,
          // inelastic collision (non zero loss in kinetic energy)
          material: {
            restitution: 0.5,
            staticFrictionCoefficient: 0,
            kineticFrictionCoefficient: 0,
          },
          pose: { positionMeters: { x: 0, y: 0 }, angleRadians: 0 },
          velocity: {
            linearMetersPerSecond: { x: 4, y: 0 },
            angularRadiansPerSecond: 0,
          },
        },
        {
          id: "receiver",
          kind: "dynamic",
          shape: { kind: "circle", radiusMeters: 0.5 },
          massKilograms: receiverMassKilograms,
          material: {
            restitution: 0.5,
            staticFrictionCoefficient: 0,
            kineticFrictionCoefficient: 0,
          },
          pose: { positionMeters: { x: 3, y: 0 }, angleRadians: 0 },
          velocity: {
            linearMetersPerSecond: { x: 0, y: 0 },
            angularRadiansPerSecond: 0,
          },
        },
      ],
      triggers: [],
    };

    // Expectations
    // At restitution 0.5, the circles separate at half their 4 m/s closing speed
    // So vB - vA = 2 m/s, which gives vB = vA + 2.
    // Put vA + 2 into 2 * vA + vB = 8 to get 3 * vA = 6.
    // The striker leaves at 2 m/s and the receiver leaves at 4 m/s
    const expectedStrikerVelocityX = 2;
    const expectedReceiverVelocityX = 4;
    const expectedMomentumX = 8;

    // 	Decide acceptable numerical error
    const strikerVelocityTolerance =
      1e-10 + 1e-8 * Math.max(Math.abs(expectedStrikerVelocityX), 1);
    const receiverVelocityTolerance =
      1e-10 + 1e-8 * Math.max(Math.abs(expectedReceiverVelocityX), 1);
    const momentumXTolerance =
      1e-12 + 1e-10 * Math.max(Math.abs(expectedMomentumX), 1);
    const momentumYTolerance = 1e-12 + 1e-10 * 1;

    // Validate through the public boundary, then create this test's engine.
    const validatedScene = unwrap(validateScene(scene));
    const engine = unwrap(createEngine(validatedScene));

    try {
      // Advance 60 fixed ticks to 1 s
      const receipt = unwrap(engine.advance(60));
      const snapshot = unwrap(engine.getSnapshot());

      expect(receipt.lastValidTick).toBe(60);
      expect(snapshot.tick).toBe(60);
      expectNear(snapshot.simulationTimeSeconds, 1, 1e-12);

      const striker = snapshot.bodies.find((body) => body.id === "striker");
      const receiver = snapshot.bodies.find((body) => body.id === "receiver");

      if (striker === undefined || receiver === undefined) {
        throw new Error(
          "Collision snapshot must contain both striker and receiver.",
        );
      }

      const strikerVelocity = striker.velocity.linearMetersPerSecond;
      const receiverVelocity = receiver.velocity.linearMetersPerSecond;

      // P = mv
      const momentumX =
        strikerMassKilograms * strikerVelocity.x +
        receiverMassKilograms * receiverVelocity.x;
      const momentumY =
        strikerMassKilograms * strikerVelocity.y +
        receiverMassKilograms * receiverVelocity.y;
      expectNear(momentumX, expectedMomentumX, momentumXTolerance);
      expectNear(momentumY, 0, momentumYTolerance);

      const strikerVelocityError = Math.hypot(
        strikerVelocity.x - expectedStrikerVelocityX,
        strikerVelocity.y,
      );
      const receiverVelocityError = Math.hypot(
        receiverVelocity.x - expectedReceiverVelocityX,
        receiverVelocity.y,
      );
      expectNear(strikerVelocityError, 0, strikerVelocityTolerance);
      expectNear(receiverVelocityError, 0, receiverVelocityTolerance);
    } finally {
      expect(engine.dispose().ok).toBe(true);
    }
  });
});
