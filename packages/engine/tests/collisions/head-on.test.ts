import { describe, expect, it } from "vitest";
import type { SceneDefinition } from "@eureka/contracts";
import { createEngine, validateScene } from "../../src/index.js";
import { expectNear, unwrap } from "../test-support.js";
const strikerMassKilograms = 2;
const receiverMassKilograms = 1;
// Create fresh scene data for each test run
function makeHeadOnScene(
  restitution: number,
  options: {
    receiverXMeters?: number;
    strikerMassKilograms?: number;
    receiverMassKilograms?: number;
    strikerVelocityXMetersPerSecond?: number;
  } = {},
): SceneDefinition {
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
        massKilograms: options.strikerMassKilograms ?? strikerMassKilograms,
        material: {
          restitution: restitution,
          staticFrictionCoefficient: 0,
          kineticFrictionCoefficient: 0,
        },
        pose: { positionMeters: { x: 0, y: 0 }, angleRadians: 0 },
        velocity: {
          linearMetersPerSecond: {
            x: options.strikerVelocityXMetersPerSecond ?? 4,
            y: 0,
          },
          angularRadiansPerSecond: 0,
        },
      },
      {
        id: "receiver",
        kind: "dynamic",
        shape: { kind: "circle", radiusMeters: 0.5 },
        massKilograms: options.receiverMassKilograms ?? receiverMassKilograms,
        material: {
          restitution: restitution,
          staticFrictionCoefficient: 0,
          kineticFrictionCoefficient: 0,
        },
        pose: {
          positionMeters: { x: options.receiverXMeters ?? 3, y: 0 },
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
  return scene;
}
describe("elastic head-on collisions", () => {
  // Catch incorrect momentum
  it("slows a 2 kg striker and accelerates a stationary 1 kg receiver", () => {
    // Set up

    const scene = makeHeadOnScene(1);
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
    const scene = makeHeadOnScene(0.5);

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
describe("head-on collision impulse", () => {
  // Check the reported impulse and the momentum change of each circle
  it.each([
    {
      restitution: 1,
      expectedNormalImpulse: 16 / 3,
      expectedStrikerVelocityX: 4 / 3,
      expectedReceiverVelocityX: 16 / 3,
    },
    {
      restitution: 0.5,
      expectedNormalImpulse: 4,
      expectedStrikerVelocityX: 2,
      expectedReceiverVelocityX: 4,
    },
  ])("reports the delivered impulse at restitution $restitution", (row) => {
    const scene = makeHeadOnScene(row.restitution, { receiverXMeters: 3.04 });
    const engine = unwrap(createEngine(unwrap(validateScene(scene))));

    try {
      unwrap(engine.advance(31));
      const snapshot = unwrap(engine.getSnapshot());

      const contact = snapshot.contacts?.find(
        (entry) => entry.bodyAId === "receiver" && entry.bodyBId === "striker",
      );
      if (contact === undefined) {
        throw new Error("Expected the receiver–striker contact at tick 31.");
      }

      // Check the contact tick and time. Use 0.51 s with a 2.5e-8 s bound.
      expect(contact.tick).toBe(31);
      expectNear(contact.timeSeconds, 0.51, 2.5e-8);

      const impulseTolerance = 1e-12 + 1e-10 * row.expectedNormalImpulse;
      expectNear(
        contact.normalImpulseNewtonSeconds,
        row.expectedNormalImpulse,
        impulseTolerance,
      );

      // The normal points left from the receiver to the striker
      expectNear(contact.normal.x, -1, 1e-10);
      expectNear(contact.normal.y, 0, 1e-10);
      expectNear(contact.tangentImpulseNewtonSeconds, 0, 1.01e-10);

      // Read the actual x velocities immediately before and after contact
      const receiverBeforeX =
        contact.bodyAVelocityBefore.linearMetersPerSecond.x;
      const receiverAfterX = contact.bodyAVelocityAfter.linearMetersPerSecond.x;
      const strikerBeforeX =
        contact.bodyBVelocityBefore.linearMetersPerSecond.x;
      const strikerAfterX = contact.bodyBVelocityAfter.linearMetersPerSecond.x;

      expectNear(receiverBeforeX, 0, 1.01e-8);
      expectNear(strikerBeforeX, 4, 4.01e-8);
      expectNear(
        receiverAfterX,
        row.expectedReceiverVelocityX,
        1e-10 + 1e-8 * row.expectedReceiverVelocityX,
      );
      expectNear(
        strikerAfterX,
        row.expectedStrikerVelocityX,
        1e-10 + 1e-8 * row.expectedStrikerVelocityX,
      );

      // The receiver gains the momentum that the striker loses
      const receiverMomentumChangeX =
        receiverMassKilograms * (receiverAfterX - receiverBeforeX);
      const strikerMomentumChangeX =
        strikerMassKilograms * (strikerAfterX - strikerBeforeX);

      expectNear(
        receiverMomentumChangeX,
        row.expectedNormalImpulse,
        impulseTolerance,
      );
      expectNear(
        strikerMomentumChangeX,
        -row.expectedNormalImpulse,
        impulseTolerance,
      );
    } finally {
      expect(engine.dispose().ok).toBe(true);
    }
  });
});
describe("head-on collisions across masses, speeds, and restitution", () => {
  const massRatios = [
    { ratio: "1:1", strikerMassKilograms: 1, receiverMassKilograms: 1 },
    { ratio: "2:1", strikerMassKilograms: 2, receiverMassKilograms: 1 },
    { ratio: "1:2", strikerMassKilograms: 1, receiverMassKilograms: 2 },
    { ratio: "100:1", strikerMassKilograms: 100, receiverMassKilograms: 1 },
    { ratio: "1:100", strikerMassKilograms: 1, receiverMassKilograms: 100 },
  ];
  const speedsMetersPerSecond = [0.1, 1, 4, 20];
  const restitutionValues = [0, 0.25, 0.5, 1];

  // Give each ordered mass pair a rightward and a leftward case.
  const directionCases = massRatios.flatMap((massRatio) => [
    { ...massRatio, direction: "right", directionSign: 1 },
    { ...massRatio, direction: "left", directionSign: -1 },
  ]);

  // Run every speed and restitution combination for each mass pair and direction.
  const sweepCases = directionCases.flatMap((directionCase) =>
    speedsMetersPerSecond.flatMap((speedMetersPerSecond) =>
      restitutionValues.map((restitution) => ({
        ...directionCase,
        speedMetersPerSecond,
        restitution,
      })),
    ),
  );

  // Check each circle's outgoing velocity as well as the pair's total momentum.
  it.each(sweepCases)(
    "transfers momentum at $ratio moving $direction at $speedMetersPerSecond m/s with restitution $restitution",
    (row) => {
      const incomingVelocityX = row.speedMetersPerSecond * row.directionSign;
      const totalMassKilograms =
        row.strikerMassKilograms + row.receiverMassKilograms;

      // Solve momentum conservation and restitution for a stationary receiver.
      const expectedStrikerVelocityX =
        ((row.strikerMassKilograms -
          row.restitution * row.receiverMassKilograms) *
          incomingVelocityX) /
        totalMassKilograms;
      const expectedReceiverVelocityX =
        ((1 + row.restitution) * row.strikerMassKilograms * incomingVelocityX) /
        totalMassKilograms;

      const scene = makeHeadOnScene(row.restitution, {
        strikerMassKilograms: row.strikerMassKilograms,
        receiverMassKilograms: row.receiverMassKilograms,
        receiverXMeters: 3 * row.directionSign,
        strikerVelocityXMetersPerSecond: incomingVelocityX,
      });
      const engine = unwrap(createEngine(unwrap(validateScene(scene))));

      try {
        // Advance beyond the time needed to close the initial 2 m gap.
        const impactTimeSeconds = 2 / row.speedMetersPerSecond;
        const stepSeconds = scene.numericalProfile.fixedTimeStepSeconds;
        const observationTick = Math.max(
          60,
          Math.ceil(impactTimeSeconds / stepSeconds) + 1,
        );

        unwrap(engine.advance(observationTick));
        const snapshot = unwrap(engine.getSnapshot());
        expect(snapshot.tick).toBe(observationTick);

        const striker = snapshot.bodies.find((body) => body.id === "striker");
        const receiver = snapshot.bodies.find((body) => body.id === "receiver");

        if (striker === undefined || receiver === undefined) {
          throw new Error(
            "Collision snapshot must contain both striker and receiver.",
          );
        }

        const strikerVelocity = striker.velocity.linearMetersPerSecond;
        const receiverVelocity = receiver.velocity.linearMetersPerSecond;

        // The striker carries all the incoming momentum.
        const expectedMomentumX = row.strikerMassKilograms * incomingVelocityX;
        const momentumX =
          row.strikerMassKilograms * strikerVelocity.x +
          row.receiverMassKilograms * receiverVelocity.x;
        const momentumY =
          row.strikerMassKilograms * strikerVelocity.y +
          row.receiverMassKilograms * receiverVelocity.y;
        const momentumXBound =
          1e-12 + 1e-10 * Math.max(Math.abs(expectedMomentumX), 1);

        expectNear(momentumX, expectedMomentumX, momentumXBound);
        expectNear(momentumY, 0, 1e-12 + 1e-10);

        // Include any unexpected sideways motion in each velocity error.
        const strikerError = Math.hypot(
          strikerVelocity.x - expectedStrikerVelocityX,
          strikerVelocity.y,
        );
        const receiverError = Math.hypot(
          receiverVelocity.x - expectedReceiverVelocityX,
          receiverVelocity.y,
        );
        const strikerBound =
          1e-10 + 1e-8 * Math.max(Math.abs(expectedStrikerVelocityX), 1);
        const receiverBound =
          1e-10 + 1e-8 * Math.max(Math.abs(expectedReceiverVelocityX), 1);

        expectNear(strikerError, 0, strikerBound);
        expectNear(receiverError, 0, receiverBound);
      } finally {
        expect(engine.dispose().ok).toBe(true);
      }
    },
  );
});
