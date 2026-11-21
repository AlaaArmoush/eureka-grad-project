import { expect, it } from "vitest";
import type { DynamicBody, SceneDefinition } from "@eureka/contracts";
import { createEngine, validateScene } from "../../src/index.js";
import { expectNear, unwrap } from "../test-support.js";

const massKilograms = 1;
const radiusMeters = 0.5;
const inertiaKilogramMetersSquared = 1 / 8;
const initialCircles = [
  { id: "right-circle", x: 1.04, velocityX: -2 },
  { id: "middle-circle", x: 0, velocityX: 0 },
  { id: "left-circle", x: -1.04, velocityX: 2 },
];

const scene: SceneDefinition = {
  schemaVersion: 1,
  id: "three-circles-meet-together",
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
  bodies: initialCircles.map<DynamicBody>(({ id, x, velocityX }) => ({
    id,
    kind: "dynamic",
    shape: { kind: "circle", radiusMeters },
    massKilograms,
    momentOfInertiaKilogramMetersSquared: inertiaKilogramMetersSquared,
    material: {
      restitution: 0,
      staticFrictionCoefficient: 0,
      kineticFrictionCoefficient: 0,
    },
    pose: { positionMeters: { x, y: 0 }, angleRadians: 0 },
    velocity: {
      linearMetersPerSecond: { x: velocityX, y: 0 },
      angularRadiansPerSecond: 0,
    },
  })),
  triggers: [],
}; // Catch a solver that misses one simultaneous hit or treats the two hits as independent.
it("resolves both sides of a simultaneous three-circle impact", () => {
  const engine = unwrap(createEngine(unwrap(validateScene(scene))));

  try {
    unwrap(engine.advance(2));
    const snapshot = unwrap(engine.getSnapshot());
    expect(snapshot.tick).toBe(2);

    const contacts = snapshot.contacts;
    if (contacts === undefined) {
      throw new Error("Expected simultaneous contact observations at tick 2.");
    }

    // Add delivered impulses by pair and preserve the order each pair first appeared.
    const impulseByPair = new Map<string, number>();
    for (const contact of contacts) {
      const pair = `${contact.bodyAId}/${contact.bodyBId}`;
      const previousImpulse = impulseByPair.get(pair);

      if (previousImpulse === undefined) {
        expectNear(contact.timeSeconds, 0.02, 5e-8);
      }

      expect(contact.tick).toBe(2);
      expectNear(contact.normal.x, 1, 1.01e-8);
      expectNear(contact.normal.y, 0, 1.01e-8);
      expectNear(contact.tangentImpulseNewtonSeconds, 0, 1e-10);
      expect(contact.normalImpulseNewtonSeconds).toBeGreaterThanOrEqual(0);
      impulseByPair.set(
        pair,
        (previousImpulse ?? 0) + contact.normalImpulseNewtonSeconds,
      );
    }

    expect([...impulseByPair.keys()]).toEqual([
      "left-circle/middle-circle",
      "middle-circle/right-circle",
    ]);
    for (const impulse of impulseByPair.values()) {
      expectNear(impulse, 2, 2.01e-8);
    }

    expect(snapshot.bodies.map((body) => body.id)).toEqual([
      "left-circle",
      "middle-circle",
      "right-circle",
    ]);

    let momentumX = 0;
    let momentumY = 0;
    let angularMomentum = 0;
    let kineticEnergyJoules = 0;

    // Check each circle and then add up the totals for the isolated three-circle system.
    for (const body of snapshot.bodies) {
      const { x, y } = body.pose.positionMeters;
      const velocity = body.velocity.linearMetersPerSecond;
      const spin = body.velocity.angularRadiansPerSecond;
      const px = massKilograms * velocity.x;
      const py = massKilograms * velocity.y;

      expectNear(Math.hypot(velocity.x, velocity.y), 0, 1.01e-8);
      expectNear(spin, 0, 1.01e-8);

      momentumX += px;
      momentumY += py;
      angularMomentum += x * py - y * px + inertiaKilogramMetersSquared * spin;
      kineticEnergyJoules +=
        0.5 * massKilograms * (velocity.x ** 2 + velocity.y ** 2) +
        0.5 * inertiaKilogramMetersSquared * spin ** 2;
    }

    expectNear(momentumX, 0, 1.01e-8);
    expectNear(momentumY, 0, 1.01e-8);
    expectNear(angularMomentum, 0, 1.01e-8);

    const losses = snapshot.collisionEnergyLosses;
    if (losses === undefined) {
      throw new Error("Expected the collision energy loss record.");
    }

    // Only restitution accounts for physical loss in this scene.
    expectNear(losses.frictionLossJoules, 0, 1e-12);
    expectNear(losses.weldLossJoules, 0, 1e-12);
    expectNear(
      kineticEnergyJoules + losses.restitutionLossJoules,
      4,
      0.005 * 4 + 1e-8,
    );
  } finally {
    expect(engine.dispose().ok).toBe(true);
  }
});
