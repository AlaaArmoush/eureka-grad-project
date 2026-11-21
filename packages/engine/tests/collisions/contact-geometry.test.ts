import { expect, it } from "vitest";
import type {
  Body,
  DynamicBoxBody,
  SceneDefinition,
  StaticBody,
} from "@eureka/contracts";
import { createEngine, validateScene } from "../../src/index.js";
import { expectNear, unwrap } from "../test-support.js";

const floor: StaticBody = {
  id: "floor",
  kind: "static",
  shape: { kind: "box", widthMeters: 10, heightMeters: 1 },
  material: { restitution: 1 },
  pose: { positionMeters: { x: 0, y: -0.5 }, angleRadians: 0 },
};

// Return a fresh 1 kg square with no starting motion.
function makeRestingBox(id: string, centerYMeters: number): DynamicBoxBody {
  return {
    id,
    kind: "dynamic",
    shape: { kind: "box", widthMeters: 1, heightMeters: 1 },
    massKilograms: 1,
    material: { restitution: 0 },
    pose: { positionMeters: { x: 0, y: centerYMeters }, angleRadians: 0 },
    velocity: {
      linearMetersPerSecond: { x: 0, y: 0 },
      angularRadiansPerSecond: 0,
    },
  };
}

// Give each test the same scales and seed while letting it choose bodies and gravity.
function makeContactScene(
  id: string,
  bodies: readonly Body[],
  gravityY = 0,
  substeps = 1,
): SceneDefinition {
  return {
    schemaVersion: 1,
    id,
    revision: 1,
    seed: 17,
    numericalProfile: {
      fixedTimeStepSeconds: 1 / 60,
      substeps,
      restitutionSpeedThresholdMetersPerSecond: 0,
      scales: { lengthMeters: 1, massKilograms: 1, timeSeconds: 1 },
    },
    environment: {
      gravityMetersPerSecondSquared: { x: 0, y: gravityY },
      linearDragKilogramsPerSecond: 0,
    },
    bodies,
    triggers: [],
  };
} // Catch a stack that sinks, drifts, or fails to carry the weight of the upper box.
it("keeps two stacked boxes supported under gravity", () => {
  const gravity = 9.81;
  const scene = makeContactScene(
    "two-box-stack",
    [makeRestingBox("lower-box", 0.5), makeRestingBox("upper-box", 1.5), floor],
    -gravity,
    8,
  );
  const engine = unwrap(createEngine(unwrap(validateScene(scene))));

  let floorImpulseY = 0;
  let upperSupportImpulseY = 0;

  try {
    for (let tick = 1; tick <= 60; tick += 1) {
      unwrap(engine.advance(1));
      const snapshot = unwrap(engine.getSnapshot());
      expect(snapshot.tick).toBe(tick);

      const lower = snapshot.bodies.find((body) => body.id === "lower-box");
      const upper = snapshot.bodies.find((body) => body.id === "upper-box");
      if (
        lower === undefined ||
        upper === undefined ||
        snapshot.contacts === undefined
      ) {
        throw new Error(
          `Expected both boxes and their contact observations at tick ${tick}.`,
        );
      }

      // Check the box edges using each measured angle.
      const lowerAngle = lower.pose.angleRadians;
      const upperAngle = upper.pose.angleRadians;
      const lowerHalfY =
        0.5 * (Math.abs(Math.cos(lowerAngle)) + Math.abs(Math.sin(lowerAngle)));
      const upperHalfY =
        0.5 * (Math.abs(Math.cos(upperAngle)) + Math.abs(Math.sin(upperAngle)));
      const lowerY = lower.pose.positionMeters.y;
      const upperY = upper.pose.positionMeters.y;

      expectNear(lowerY - lowerHalfY, 0, 1e-4);
      expectNear(upperY - upperHalfY - (lowerY + lowerHalfY), 0, 1e-4);

      for (const box of [lower, upper]) {
        const { x, y } = box.velocity.linearMetersPerSecond;
        expectNear(box.pose.positionMeters.x, 0, 1e-4);
        expectNear(box.pose.angleRadians, 0, 1e-5);
        expectNear(Math.hypot(x, y), 0, 1e-5);
        expectNear(box.velocity.angularRadiansPerSecond, 0, 1e-5);
      }

      // Sum the upward impulses delivered to the lower and upper boxes.
      for (const contact of snapshot.contacts) {
        expectNear(contact.tangentImpulseNewtonSeconds, 0, 1e-10);
        const impulseY = contact.normalImpulseNewtonSeconds * contact.normal.y;

        if (contact.bodyAId === "floor" && contact.bodyBId === "lower-box") {
          floorImpulseY += impulseY;
        }
        if (
          contact.bodyAId === "lower-box" &&
          contact.bodyBId === "upper-box"
        ) {
          upperSupportImpulseY += impulseY;
        }
      }
    }

    expectNear(floorImpulseY, 19.62, 3e-5);
    expectNear(upperSupportImpulseY, 9.81, 3e-5);
  } finally {
    expect(engine.dispose().ok).toBe(true);
  }
});
// Catch a corner impact that misses one face or uses the wrong normal.
it("rebounds from both faces of a right-angle corner", () => {
  const wall: StaticBody = {
    id: "corner-wall",
    kind: "static",
    shape: { kind: "box", widthMeters: 1, heightMeters: 5 },
    material: { restitution: 1 },
    pose: { positionMeters: { x: -0.5, y: 2.5 }, angleRadians: 0 },
  };
  const scene = makeContactScene("circle-hits-floor-and-wall", [
    floor,
    wall,
    {
      id: "puck",
      kind: "dynamic",
      shape: { kind: "circle", radiusMeters: 0.5 },
      massKilograms: 1,
      material: { restitution: 1 },
      pose: { positionMeters: { x: 0.54, y: 0.54 }, angleRadians: 0 },
      velocity: {
        linearMetersPerSecond: { x: -2, y: -2 },
        angularRadiansPerSecond: 0,
      },
    },
  ]);
  const engine = unwrap(createEngine(unwrap(validateScene(scene))));

  try {
    unwrap(engine.advance(2));
    const snapshot = unwrap(engine.getSnapshot());
    expect(snapshot.tick).toBe(2);

    const puck = snapshot.bodies.find((body) => body.id === "puck");
    const contacts = snapshot.contacts;
    if (puck === undefined || contacts === undefined) {
      throw new Error("Expected the puck and its corner contacts at tick 2.");
    }

    const faces = [
      { id: "floor", normalX: 0, normalY: 1, pointX: 0.5, pointY: 0 },
      { id: "corner-wall", normalX: 1, normalY: 0, pointX: 0, pointY: 0.5 },
    ];

    for (const face of faces) {
      const hits = contacts.filter(
        (contact) => contact.bodyAId === face.id && contact.bodyBId === "puck",
      );
      const firstHit = hits[0];
      if (firstHit === undefined) {
        throw new Error(`Expected the puck to hit the ${face.id}.`);
      }

      expectNear(firstHit.timeSeconds, 0.02, 5e-8);
      expectNear(
        Math.hypot(
          firstHit.pointMeters.x - face.pointX,
          firstHit.pointMeters.y - face.pointY,
        ),
        0,
        1e-7,
      );
      expectNear(
        Math.hypot(
          firstHit.normal.x - face.normalX,
          firstHit.normal.y - face.normalY,
        ),
        0,
        1.01e-8,
      );

      let normalImpulse = 0;
      for (const hit of hits) {
        normalImpulse += hit.normalImpulseNewtonSeconds;
        expectNear(hit.tangentImpulseNewtonSeconds, 0, 1e-10);
      }
      expectNear(normalImpulse, 4, 4.01e-8);
    }

    const { x, y } = puck.velocity.linearMetersPerSecond;
    expectNear(Math.hypot(x - 2, y - 2), 0, 3e-8);
    expectNear(puck.velocity.angularRadiansPerSecond, 0, 1.01e-8);
    expectNear(0.5 * (x ** 2 + y ** 2), 4, 4.01e-8);
  } finally {
    expect(engine.dispose().ok).toBe(true);
  }
});
// Catch a moving box that is admitted even though it starts inside the floor.
it("rejects a box that starts penetrating the floor", () => {
  const scene = makeContactScene("box-inside-floor", [
    makeRestingBox("buried-box", 0.49),
    floor,
  ]);
  const result = createEngine(scene);

  if (result.ok) {
    expect(result.value.dispose().ok).toBe(true);
    throw new Error(
      "Expected the penetrating box to be rejected before stepping.",
    );
  }

  expect(result.diagnostics[0]).toMatchObject({
    code: "INVALID_INITIAL_OVERLAP",
    path: "bodies[0].pose.positionMeters",
    entityId: "buried-box",
  });
});
