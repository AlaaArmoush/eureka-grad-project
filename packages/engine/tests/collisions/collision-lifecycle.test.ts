import { expect, it } from "vitest";
import type {
  Command,
  DynamicBody,
  DynamicBoxBody,
  DynamicCircleBody,
  SceneDefinition,
  Snapshot,
} from "@eureka/contracts";
import { createEngine, type EngineDiagnosticCode } from "../../src/index.js";
import { expectNear, unwrap } from "../test-support.js";
import { makeSlidingBoxScene } from "./scene-fixtures.js";

type InvalidBodyCase = {
  name: string;
  change: (box: DynamicBoxBody) => DynamicBody;
  field: string;
  code?: EngineDiagnosticCode;
};

const invalidBodyCases: InvalidBodyCase[] = [
  // A collider must have positive dimensions.
  {
    name: "rejects a circle with zero radius",
    change: (box) => ({ ...box, shape: { kind: "circle", radiusMeters: 0 } }),
    field: "shape.radiusMeters",
  },
  {
    name: "rejects a box with negative width",
    change: (box) => ({ ...box, shape: { ...box.shape, widthMeters: -1 } }),
    field: "shape.widthMeters",
  },
  {
    name: "rejects a box with zero height",
    change: (box) => ({ ...box, shape: { ...box.shape, heightMeters: 0 } }),
    field: "shape.heightMeters",
  },
  // Angular dynamics require positive inertia and finite spin.
  {
    name: "rejects zero rotational inertia",
    change: (box) => ({ ...box, momentOfInertiaKilogramMetersSquared: 0 }),
    field: "momentOfInertiaKilogramMetersSquared",
  },
  {
    name: "rejects infinite angular speed",
    change: (box) => ({
      ...box,
      velocity: { ...box.velocity, angularRadiansPerSecond: Infinity },
    }),
    field: "velocity.angularRadiansPerSecond",
    code: "NONFINITE_NUMBER",
  },
  // Reject material values outside the project's collision rules.
  {
    name: "rejects restitution above one",
    change: (box) => ({
      ...box,
      material: { ...box.material, restitution: 1.2 },
    }),
    field: "material.restitution",
  },
  {
    name: "rejects kinetic friction above static friction",
    change: (box) => ({
      ...box,
      material: {
        restitution: 0,
        staticFrictionCoefficient: 0.1,
        kineticFrictionCoefficient: 0.2,
      },
    }),
    field: "material.kineticFrictionCoefficient",
  },
];

it.each(invalidBodyCases)("$name", (row) => {
  const validScene = makeSlidingBoxScene(false);
  const [body, ...others] = validScene.bodies;

  if (body?.kind !== "dynamic" || body.shape.kind !== "box") {
    throw new Error("Expected a moving box as the first fixture body.");
  }

  const box: DynamicBoxBody = { ...body, shape: body.shape };
  const invalidBody = row.change(box);
  const result = createEngine({
    ...validScene,
    bodies: [invalidBody, ...others],
  });

  if (result.ok) {
    expect(result.value.dispose().ok).toBe(true);
    throw new Error(`Expected the engine to reject ${row.field}.`);
  }

  expect(result.diagnostics[0]).toMatchObject({
    code: row.code ?? "OUT_OF_RANGE",
    path: `bodies[0].${row.field}`,
  });
});
const receiverStartXMeters = 1.05;

// Build a pair that welds during the second tick.
function makeStickyHistoryScene(): SceneDefinition {
  const circles = [
    { id: "striker", x: 0, velocityX: 2 },
    { id: "receiver", x: receiverStartXMeters, velocityX: 0 },
  ];

  return {
    schemaVersion: 1,
    id: "sticky-pair-history",
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
    bodies: circles.map<DynamicCircleBody>(({ id, x, velocityX }) => ({
      id,
      kind: "dynamic",
      shape: { kind: "circle", radiusMeters: 0.5 },
      massKilograms: 1,
      material: { restitution: 0 },
      pose: { positionMeters: { x, y: 0 }, angleRadians: 0 },
      velocity: {
        linearMetersPerSecond: { x: velocityX, y: 0 },
        angularRadiansPerSecond: 0,
      },
    })),
    weldOnImpactPairs: [{ bodyAId: "receiver", bodyBId: "striker" }],
    triggers: [],
  };
}

// Catch an invalid material edit that still moves the body or claims the command ID.
it("rejects an invalid material edit without applying its pose change", () => {
  const engine = unwrap(createEngine(makeStickyHistoryScene()));

  try {
    const before = unwrap(engine.copySnapshot());
    const invalidEdit: Command = {
      commandVersion: 1,
      id: "edit-receiver-material",
      targetTick: 0,
      payload: {
        kind: "editBody",
        bodyId: "receiver",
        changes: {
          pose: { positionMeters: { x: 10, y: 0 }, angleRadians: 0 },
          material: {
            restitution: 0,
            staticFrictionCoefficient: 0.1,
            kineticFrictionCoefficient: 0.2,
          },
        },
      },
    };

    const rejected = engine.enqueue(invalidEdit);
    if (rejected.ok) {
      throw new Error("Expected the invalid material edit to be rejected.");
    }

    expect(rejected.diagnostics[0]).toMatchObject({
      code: "OUT_OF_RANGE",
      path: "payload.changes.material.kineticFrictionCoefficient",
    });
    expect(unwrap(engine.copySnapshot())).toEqual(before);

    const accepted = unwrap(
      engine.enqueue({
        ...invalidEdit,
        payload: {
          kind: "editBody",
          bodyId: "receiver",
          changes: { material: { restitution: 0 } },
        },
      }),
    );
    expect(accepted.sequence).toBe(0);

    // Stepping exposes a rejected pose change that leaked into the pending queue.
    unwrap(engine.advance(1));
    const snapshot = unwrap(engine.getSnapshot());
    const receiver = snapshot.bodies.find((body) => body.id === "receiver");
    expect(receiver?.pose.positionMeters).toEqual({
      x: receiverStartXMeters,
      y: 0,
    });
  } finally {
    expect(engine.dispose().ok).toBe(true);
  }
}); // Catch a reset that keeps live weld history or changes a copy held by a caller.
it("clears live weld history on reset and preserves a copied impact", () => {
  const engine = unwrap(createEngine(makeStickyHistoryScene()));

  try {
    const initial = unwrap(engine.copySnapshot());
    unwrap(engine.advance(2));

    const impact = unwrap(engine.copySnapshot());
    const weld = impact.welds?.[0];
    const contact = impact.contacts?.find(
      (entry) => entry.bodyAId === "receiver" && entry.bodyBId === "striker",
    );

    if (weld === undefined || contact === undefined) {
      throw new Error("Expected a contact and weld at tick 2.");
    }

    expect(impact.tick).toBe(2);
    expectNear(weld.timeSeconds, 0.025, 5e-8);
    expectNear(contact.normalImpulseNewtonSeconds, 1, 1.01e-8);
    expectNear(weld.energyLossJoules, 1, 1.01e-8);
    expect(impact.weldClusters?.[0]?.bodyIds.slice().sort()).toEqual([
      "receiver",
      "striker",
    ]);

    // Take a separate comparison copy before the engine advances again.
    const savedImpact = structuredClone(impact);
    unwrap(engine.advance(1));
    expect(unwrap(engine.getSnapshot()).welds).toEqual([]);
    expect(impact).toEqual(savedImpact);

    expect(engine.reset().ok).toBe(true);
    const resetSnapshot = unwrap(engine.copySnapshot());

    expect(resetSnapshot).toEqual(initial);
    expect(resetSnapshot.contacts).toEqual([]);
    expect(resetSnapshot.welds).toEqual([]);
    expect(resetSnapshot.weldClusters).toEqual([]);
    expect(resetSnapshot.collisionEnergyLosses).toEqual({
      restitutionLossJoules: 0,
      frictionLossJoules: 0,
      weldLossJoules: 0,
    });
    expect(impact).toEqual(savedImpact);
  } finally {
    expect(engine.dispose().ok).toBe(true);
  }
});
// Read the vertical impulse delivered by the floor during one tick.
function readFloorImpulseY(snapshot: Snapshot): number {
  const contacts = snapshot.contacts;
  if (contacts === undefined) {
    throw new Error(
      `Expected floor contact observations at tick ${snapshot.tick}.`,
    );
  }

  let impulseY = 0;
  for (const contact of contacts) {
    if (contact.bodyAId === "floor" && contact.bodyBId === "sliding-block") {
      impulseY +=
        contact.normalImpulseNewtonSeconds * contact.normal.y +
        contact.tangentImpulseNewtonSeconds * contact.normal.x;
    }
  }

  return impulseY;
}

// Catch stale contact history or edited mass affecting the first tick after reset.
it("restores the original support response after resetting a heavier block", () => {
  const engine = unwrap(createEngine(makeSlidingBoxScene(false)));

  try {
    unwrap(engine.advance(1));
    const firstTick = unwrap(engine.copySnapshot());
    expectNear(readFloorImpulseY(firstTick), 0.1635, 3e-5);

    unwrap(
      engine.enqueue({
        commandVersion: 1,
        id: "double-block-mass",
        targetTick: 1,
        payload: {
          kind: "editBody",
          bodyId: "sliding-block",
          changes: { massKilograms: 2 },
        },
      }),
    );

    unwrap(engine.advance(1));
    const heavierTick = unwrap(engine.getSnapshot());
    expect(heavierTick.tick).toBe(2);
    expectNear(readFloorImpulseY(heavierTick), 0.327, 6e-5);

    expect(engine.reset().ok).toBe(true);
    unwrap(engine.advance(1));
    expect(unwrap(engine.copySnapshot())).toEqual(firstTick);
  } finally {
    expect(engine.dispose().ok).toBe(true);
  }
});
