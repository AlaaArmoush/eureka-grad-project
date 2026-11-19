import { describe, expect, it } from "vitest";
import type { SceneDefinition } from "@eureka/contracts";
import { createEngine, validateScene } from "../../src/index.js";
import { expectNear, unwrap } from "../test-support.js";

const strikerMassKilograms = 2;
const receiverMassKilograms = 1;
const radiusMeters = 0.5;
const rootThree = Math.sqrt(3);
const strikerInertia = 0.5 * strikerMassKilograms * radiusMeters ** 2;
const receiverInertia = 0.5 * receiverMassKilograms * radiusMeters ** 2;

// Give each test a fresh copy of the same glancing geometry.
function makeGlancingScene(restitution: number): SceneDefinition {
  const material = {
    restitution,
    staticFrictionCoefficient: 0,
    kineticFrictionCoefficient: 0,
  };

  return {
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
}

describe("frictionless glancing circle impacts", () => {
  // Catch a head-on response or a wrong sideways impulse in an off-centre hit.
  it("transfers sideways momentum without making either circle spin", () => {
    const scene = makeGlancingScene(1);
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
describe("off-centre sticky collisions", () => {
  // Catch a weld that discards rotation, changes body IDs, or counts the loss twice.
  it("rotates a welded pair around its moving centre of mass", () => {
    const scene: SceneDefinition = {
      ...makeGlancingScene(0),
      id: "glancing-sticky-circles",
      weldOnImpactPairs: [{ bodyAId: "receiver", bodyBId: "striker" }],
    };

    const expectedSpin = 32 / 25;
    const expectedInertia = 25 / 24;
    const expectedLossJoules = 112 / 25;
    const motionBound = 1e-10 + 1e-8 * expectedSpin;
    const lossBound = 1e-10 + 1e-8 * expectedLossJoules;
    const engine = unwrap(createEngine(unwrap(validateScene(scene))));

    try {
      unwrap(engine.advance(31));
      const impactSnapshot = unwrap(engine.getSnapshot());
      const weld = impactSnapshot.welds?.[0];

      if (weld === undefined) {
        throw new Error("Expected an off-centre weld at tick 31.");
      }

      expect(impactSnapshot.welds).toHaveLength(1);
      expect(weld.tick).toBe(31);
      expectNear(weld.timeSeconds, 0.51, 2.5e-8);
      expectNear(weld.energyLossJoules, expectedLossJoules, lossBound);
      const clusterId = weld.clusterId;

      unwrap(engine.advance(29));
      const snapshot = unwrap(engine.getSnapshot());
      expect(snapshot.tick).toBe(60);
      expect(snapshot.welds).toEqual([]);
      expect(snapshot.weldClusters).toHaveLength(1);
      const cluster = snapshot.weldClusters?.find((entry) => entry.id === clusterId);
      expect(cluster?.bodyIds.slice().sort()).toEqual(["receiver", "striker"]);      const striker = snapshot.bodies.find((body) => body.id === "striker");
      const receiver = snapshot.bodies.find((body) => body.id === "receiver");
      const losses = snapshot.collisionEnergyLosses;

      if (striker === undefined || receiver === undefined || losses === undefined) {
        throw new Error("Expected both original circles and the collision loss record.");
      }

      const strikerPosition = striker.pose.positionMeters;
      const receiverPosition = receiver.pose.positionMeters;
      const strikerVelocity = striker.velocity.linearMetersPerSecond;
      const receiverVelocity = receiver.velocity.linearMetersPerSecond;

      // The centre of mass travels straight while the bodies rotate around it.
      const elapsedSeconds = 1 - 0.51;
      const centerX = (2 * strikerPosition.x + receiverPosition.x) / 3;
      const centerY = (2 * strikerPosition.y + receiverPosition.y) / 3;
      const expectedCenterX = 2.04 + rootThree / 6 + (8 / 3) * elapsedSeconds;

      expectNear(centerX, expectedCenterX, 1e-7);
      expectNear(centerY, 1 / 6, 1e-7);

      // Rotate the original separation vector through the calculated angle.
      const expectedAngle = expectedSpin * elapsedSeconds;
      const cosine = Math.cos(expectedAngle);
      const sine = Math.sin(expectedAngle);
      const expectedSeparationX = (rootThree / 2) * cosine - 0.5 * sine;
      const expectedSeparationY = (rootThree / 2) * sine + 0.5 * cosine;

      expectNear(receiverPosition.x - strikerPosition.x, expectedSeparationX, 1e-7);
      expectNear(receiverPosition.y - strikerPosition.y, expectedSeparationY, 1e-7);
      expectNear(striker.pose.angleRadians, expectedAngle, 1e-7);
      expectNear(receiver.pose.angleRadians, expectedAngle, 1e-7);
      expectNear(striker.velocity.angularRadiansPerSecond, expectedSpin, motionBound);
      expectNear(receiver.velocity.angularRadiansPerSecond, expectedSpin, motionBound);

      // The relative velocity of a rigid pair is perpendicular to its separation.
      const relativeVelocityError = Math.hypot(
        receiverVelocity.x - strikerVelocity.x + expectedSpin * expectedSeparationY,
        receiverVelocity.y - strikerVelocity.y - expectedSpin * expectedSeparationX,
      );
      expectNear(relativeVelocityError, 0, motionBound);      let momentumX = 0;
      let momentumY = 0;
      let angularMomentumAboutOrigin = 0;
      let kineticEnergyJoules = 0;

      const joinedBodies = [
        { body: striker, mass: strikerMassKilograms, inertia: strikerInertia },
        { body: receiver, mass: receiverMassKilograms, inertia: receiverInertia },
      ];

      for (const { body, mass, inertia } of joinedBodies) {
        const { x, y } = body.pose.positionMeters;
        const velocity = body.velocity.linearMetersPerSecond;
        const spin = body.velocity.angularRadiansPerSecond;
        const px = mass * velocity.x;
        const py = mass * velocity.y;

        momentumX += px;
        momentumY += py;
        angularMomentumAboutOrigin += x * py - y * px + inertia * spin;
        kineticEnergyJoules +=
          0.5 * mass * (velocity.x ** 2 + velocity.y ** 2) + 0.5 * inertia * spin ** 2;
      }

      expectNear(momentumX, 8, 1e-12 + 1e-10 * 8);
      expectNear(momentumY, 0, 1e-12 + 1e-10);
      expectNear(angularMomentumAboutOrigin, 0, 1e-10 + 1e-8);

      const angularMomentumAboutCenter =
        angularMomentumAboutOrigin - (centerX * momentumY - centerY * momentumX);
      const measuredInertia =
        angularMomentumAboutCenter / striker.velocity.angularRadiansPerSecond;
      expectNear(measuredInertia, expectedInertia, 1e-10 + 1e-8 * expectedInertia);

      expectNear(kineticEnergyJoules, 288 / 25, 1e-10 + 1e-8 * (288 / 25));
      expectNear(losses.weldLossJoules, expectedLossJoules, lossBound);
      expectNear(losses.restitutionLossJoules, 0, 1e-12);
      expectNear(losses.frictionLossJoules, 0, 1e-12);
    } finally {
      expect(engine.dispose().ok).toBe(true);
    }
  });
});
describe("zero-restitution glancing collisions without sticky mode", () => {
  // Catch an engine that silently joins bodies when restitution is zero.
  it("lets the circles slide past each other without forming a weld", () => {
    const scene: SceneDefinition = {
      ...makeGlancingScene(0),
      id: "glancing-circles-without-weld",
      weldOnImpactPairs: [],
    };
    const engine = unwrap(createEngine(unwrap(validateScene(scene))));

    try {
      unwrap(engine.advance(31));
      const impactSnapshot = unwrap(engine.getSnapshot());
      const contact = impactSnapshot.contacts?.find(
        (entry) => entry.bodyAId === "receiver" && entry.bodyBId === "striker",
      );

      if (contact === undefined) {
        throw new Error("Expected a zero-restitution glancing contact at tick 31.");
      }

      // Confirm a real collision happened while the weld records stayed empty.
      expect(contact.tick).toBe(31);
      expectNear(contact.timeSeconds, 0.51, 2.5e-8);
      expect(impactSnapshot.welds).toEqual([]);
      expect(impactSnapshot.weldClusters).toEqual([]);

      unwrap(engine.advance(29));
      const snapshot = unwrap(engine.getSnapshot());
      expect(snapshot.tick).toBe(60);
      expect(snapshot.welds).toEqual([]);
      expect(snapshot.weldClusters).toEqual([]);
      expect(snapshot.bodies).toHaveLength(2);

      const striker = snapshot.bodies.find((body) => body.id === "striker");
      const receiver = snapshot.bodies.find((body) => body.id === "receiver");
      const losses = snapshot.collisionEnergyLosses;

      if (striker === undefined || receiver === undefined || losses === undefined) {
        throw new Error("Expected both original circles and the collision loss record.");
      }

      // Compare each measured velocity with its own hand-calculated answer.
      const strikerVelocity = striker.velocity.linearMetersPerSecond;
      const receiverVelocity = receiver.velocity.linearMetersPerSecond;
      const expectedStrikerY = -rootThree / 3;
      const expectedReceiverY = 2 * rootThree / 3;
      const strikerError = Math.hypot(strikerVelocity.x - 3, strikerVelocity.y - expectedStrikerY);
      const receiverError = Math.hypot(receiverVelocity.x - 2, receiverVelocity.y - expectedReceiverY);

      expectNear(strikerError, 0, 1e-10 + 1e-8 * Math.hypot(3, expectedStrikerY));
      expectNear(receiverError, 0, 1e-10 + 1e-8 * Math.hypot(2, expectedReceiverY));
      expectNear(striker.velocity.angularRadiansPerSecond, 0, 1e-8);
      expectNear(receiver.velocity.angularRadiansPerSecond, 0, 1e-8);

      // Sideways motion increases the distance between the centres after impact.
      const strikerPosition = striker.pose.positionMeters;
      const receiverPosition = receiver.pose.positionMeters;
      const distanceBetweenCenters = Math.hypot(
        receiverPosition.x - strikerPosition.x,
        receiverPosition.y - strikerPosition.y,
      );
      const expectedDistance = Math.hypot(1, 2 * (1 - 0.51));

      expectNear(distanceBetweenCenters, expectedDistance, 1e-7);

      const momentumX =
        strikerMassKilograms * strikerVelocity.x + receiverMassKilograms * receiverVelocity.x;
      const momentumY =
        strikerMassKilograms * strikerVelocity.y + receiverMassKilograms * receiverVelocity.y;

      expectNear(momentumX, 8, 1e-12 + 1e-10 * 8);
      expectNear(momentumY, 0, 1e-12 + 1e-10);

      // The collision loses energy through restitution. The weld loss stays zero.
      expectNear(losses.restitutionLossJoules, 4, 1e-10 + 1e-8 * 4);
      expectNear(losses.weldLossJoules, 0, 1e-12);
      expectNear(losses.frictionLossJoules, 0, 1e-12);
    } finally {
      expect(engine.dispose().ok).toBe(true);
    }
  });
});