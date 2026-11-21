import { expect, it } from "vitest";
import type {
  DynamicCircleBody,
  SceneDefinition,
  StaticBody,
  Vector2,
} from "@eureka/contracts";
import { createEngine, validateScene } from "../../src/index.js";
import { expectNear, unwrap } from "../test-support.js";

const speedMetersPerSecond = 240;
const massKilograms = 1;
const fixedTimeStepSeconds = 1 / 60;

// Create either the incoming puck or its equal-mass receiver.
function makeCircle(
  id: string,
  positionMeters: Vector2,
  velocityX: number,
): DynamicCircleBody {
  return {
    id,
    kind: "dynamic",
    shape: { kind: "circle", radiusMeters: 0.5 },
    massKilograms,
    material: { restitution: 1 },
    pose: { positionMeters, angleRadians: 0 },
    velocity: {
      linearMetersPerSecond: { x: velocityX, y: 0 },
      angularRadiansPerSecond: 0,
    },
  };
}

// Keep the front face at x = 0 and change only the wall's height on screen.
function makeThinWall(centerYMeters: number): StaticBody {
  return {
    id: "barrier",
    kind: "static",
    shape: { kind: "box", widthMeters: 0.1, heightMeters: 2 },
    material: { restitution: 1 },
    pose: { positionMeters: { x: 0.05, y: centerYMeters }, angleRadians: 0 },
  };
}
const straightImpactBounds = {
  normal: 1.01e-8,
  positionMeters: 2.5e-7,
  velocityMetersPerSecond: 2.41e-6,
};

const sweptImpactCases = [
  // Catch a puck passing through a dynamic circle between tick boundaries.
  {
    name: " transfers speed to a circle crossed within one tick".trim(),
    sceneId: "fast-puck-hits-receiver",
    start: { x: -2, y: 0 },
    obstacle: makeCircle("receiver", { x: 0, y: 0 }, 0),
    pair: ["puck", "receiver"],
    point: { x: -0.5, y: 0 },
    normal: { x: 1, y: 0 },
    normalClosingSpeed: 240,
    normalImpulse: 240,
    impulseBound: 2.41e-6,
    bounds: straightImpactBounds,
    motion: [
      { id: "puck", position: { x: -1, y: 0 }, velocity: { x: 0, y: 0 } },
      { id: "receiver", position: { x: 3, y: 0 }, velocity: { x: 240, y: 0 } },
    ],
  },
  // Catch a puck tunneling through a thin wall when both tick boundaries are clear.
  {
    name: "rebounds from a thin wall crossed within one tick",
    sceneId: "fast-puck-hits-wall",
    start: { x: -1.5, y: 0 },
    obstacle: makeThinWall(0),
    pair: ["barrier", "puck"],
    point: { x: 0, y: 0 },
    normal: { x: -1, y: 0 },
    normalClosingSpeed: 240,
    normalImpulse: 480,
    impulseBound: 4.81e-6,
    bounds: straightImpactBounds,
    motion: [
      { id: "puck", position: { x: -3.5, y: 0 }, velocity: { x: -240, y: 0 } },
    ],
  },
  // Catch a missed endpoint or a reflection that uses the flat wall normal.
  {
    name: "deflects upward from the endpoint of a thin wall",
    sceneId: "fast-puck-hits-wall-endpoint",
    start: { x: -1.3, y: 0.4 },
    obstacle: makeThinWall(-1),
    pair: ["barrier", "puck"],
    point: { x: 0, y: 0 },
    normal: { x: -0.6, y: 0.8 },
    normalClosingSpeed: 144,
    normalImpulse: 288,
    impulseBound: 2e-4,
    bounds: {
      normal: 4e-7,
      positionMeters: 5e-6,
      velocityMetersPerSecond: 3.2e-4,
    },
    motion: [
      {
        id: "puck",
        position: { x: 0.54, y: 3.28 },
        velocity: { x: 67.2, y: 230.4 },
      },
    ],
  },
]; // Every row needs a real impact and the hand-calculated end-of-tick motion.
it.each(sweptImpactCases)("$name", (row) => {
  const scene: SceneDefinition = {
    schemaVersion: 1,
    id: row.sceneId,
    revision: 1,
    seed: 17,
    numericalProfile: {
      fixedTimeStepSeconds,
      substeps: 1,
      restitutionSpeedThresholdMetersPerSecond: 0,
      scales: { lengthMeters: 1, massKilograms: 1, timeSeconds: 1 },
    },
    environment: {
      gravityMetersPerSecondSquared: { x: 0, y: 0 },
      linearDragKilogramsPerSecond: 0,
    },
    bodies: [makeCircle("puck", row.start, speedMetersPerSecond), row.obstacle],
    triggers: [],
  };
  const engine = unwrap(createEngine(unwrap(validateScene(scene))));

  try {
    unwrap(engine.advance(1));
    const snapshot = unwrap(engine.getSnapshot());
    expect(snapshot.tick).toBe(1);

    const contacts = snapshot.contacts;
    const firstContact = contacts?.[0];
    if (contacts === undefined || firstContact === undefined) {
      throw new Error(`Expected a swept impact at tick 1 in ${row.sceneId}.`);
    }

    expectNear(
      firstContact.timeSeconds,
      1 / 240,
      1e-7 / row.normalClosingSpeed,
    );
    const pointError = Math.hypot(
      firstContact.pointMeters.x - row.point.x,
      firstContact.pointMeters.y - row.point.y,
    );
    expectNear(pointError, 0, 1e-7);

    let normalImpulse = 0;
    let impulseX = 0;
    let impulseY = 0;

    // Add the impulse delivered by all observations of this pair.
    for (const contact of contacts) {
      expect(contact.tick).toBe(1);
      expect([contact.bodyAId, contact.bodyBId]).toEqual(row.pair);

      const { x, y } = contact.normal;
      expectNear(
        Math.hypot(x - row.normal.x, y - row.normal.y),
        0,
        row.bounds.normal,
      );

      const normal = contact.normalImpulseNewtonSeconds;
      const tangent = contact.tangentImpulseNewtonSeconds;
      expect(normal).toBeGreaterThanOrEqual(0);
      expectNear(tangent, 0, 1e-10);
      normalImpulse += normal;
      impulseX += normal * x - tangent * y;
      impulseY += normal * y + tangent * x;
    }
    expectNear(normalImpulse, row.normalImpulse, row.impulseBound);

    let momentumX = 0;
    let momentumY = 0;
    let kineticEnergyJoules = 0;

    // Compare each moving body with its own expected position and velocity.
    for (const expected of row.motion) {
      const body = snapshot.bodies.find(
        (candidate) => candidate.id === expected.id,
      );
      if (body === undefined) {
        throw new Error(`Expected to find ${expected.id} after impact.`);
      }

      const position = body.pose.positionMeters;
      const velocity = body.velocity.linearMetersPerSecond;
      const positionError = Math.hypot(
        position.x - expected.position.x,
        position.y - expected.position.y,
      );
      const velocityError = Math.hypot(
        velocity.x - expected.velocity.x,
        velocity.y - expected.velocity.y,
      );
      const velocityBound =
        Math.hypot(expected.velocity.x, expected.velocity.y) === 0
          ? 1.01e-8
          : row.bounds.velocityMetersPerSecond;

      expectNear(positionError, 0, row.bounds.positionMeters);
      expectNear(velocityError, 0, velocityBound);
      expectNear(body.velocity.angularRadiansPerSecond, 0, 1.01e-8);

      momentumX += massKilograms * velocity.x;
      momentumY += massKilograms * velocity.y;
      kineticEnergyJoules +=
        0.5 * massKilograms * (velocity.x ** 2 + velocity.y ** 2);
    }

    if (row.obstacle.kind === "dynamic") {
      expectNear(momentumX, 240, 1e-12 + 1e-10 * 240);
      expectNear(momentumY, 0, 1.01e-10);
    } else {
      expectNear(momentumX - 240, impulseX, row.impulseBound);
      expectNear(momentumY, impulseY, row.impulseBound);
    }

    expectNear(kineticEnergyJoules, 28_800, 1e-10 + 1e-8 * 28_800);
  } finally {
    expect(engine.dispose().ok).toBe(true);
  }
});
