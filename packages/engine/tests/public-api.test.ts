// Verifies the engine’s public contract for validation, commands, state safety, reset, snapshots, and disposal.

import { describe, expect, it } from "vitest";

import type {
  Command,
  SceneDefinition
} from "@eureka/contracts";

import {
  createEngine,
  validateScene
} from "../src/index.js";

interface Diagnostic {
  readonly code: string;
  readonly message: string;
  readonly path: string;
  readonly entityId?: string;
}

interface FailedResult {
  readonly ok: false;
  readonly diagnostics: readonly Diagnostic[];
}

type OperationResult =
  | {
    readonly ok: true;
  }
  | FailedResult;

function requireValue<T>(
  result:
    | {
      readonly ok: true;
      readonly value: T;
    }
    | FailedResult
): T {
  expect(result.ok).toBe(true);

  if (!result.ok) {
    throw new Error(result.diagnostics[0]?.message ?? "Operation failed.");
  }

  return result.value;
}

function expectRejectedWith(
  result: OperationResult,
  code: string,
  path: string,
  entityId?: string
): void {
  expect(result.ok).toBe(false);

  if (result.ok) {
    throw new Error(`Expected diagnostic "${code}" at "${path}".`);
  }

  expect(result.diagnostics).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        code,
        path,
        ...(entityId === undefined ? {} : { entityId })
      })
    ])
  );
}

function makeValidScene(): SceneDefinition {
  return {
    schemaVersion: 1,
    id: "public-api-scene",
    revision: 1,
    seed: 17,
    numericalProfile: {
      fixedTimeStepSeconds: 0.25,
      substeps: 1,
      scales: {
        lengthMeters: 1,
        massKilograms: 1,
        timeSeconds: 1
      }
    },
    environment: {
      gravityMetersPerSecondSquared: { x: 0, y: 0 },
      linearDragKilogramsPerSecond: 0
    },
    bodies: [
      {
        id: "projectile",
        kind: "dynamic",
        shape: {
          kind: "circle",
          radiusMeters: 0.1
        },
        massKilograms: 1,
        material: {
          restitution: 0
        },
        pose: {
          positionMeters: { x: 0, y: 1 },
          angleRadians: 0
        },
        velocity: {
          linearMetersPerSecond: { x: 0, y: 0 },
          angularRadiansPerSecond: 0
        }
      }
    ],
    triggers: []
  };
}

function makeLaunchCommand(
  id: string,
  targetTick: number,
  positionX: number,
  bodyId = "projectile"
): Command {
  return {
    commandVersion: 1,
    id,
    targetTick,
    payload: {
      kind: "launchBody",
      bodyId,
      positionMeters: { x: positionX, y: 1 },
      velocity: {
        linearMetersPerSecond: { x: 0, y: 0 },
        angularRadiansPerSecond: 0
      }
    }
  };
}

describe("public engine API", () => {
  it("validates and rejects invalid creation without mutating input", () => {
    const scene = makeValidScene();
    const invalidScene = {
      ...scene,
      environment: {
        ...scene.environment,
        gravityMetersPerSecondSquared: {
          x: 0,
          y: Number.NaN
        }
      }
    };

    expectRejectedWith(
      validateScene(invalidScene),
      "NONFINITE_NUMBER",
      "environment.gravityMetersPerSecondSquared.y"
    );
    expectRejectedWith(
      createEngine(invalidScene),
      "NONFINITE_NUMBER",
      "environment.gravityMetersPerSecondSquared.y"
    );
    expect(
      Number.isNaN(
        invalidScene.environment.gravityMetersPerSecondSquared.y
      )
    ).toBe(true);
  });

  // A future command stays invisible until its target boundary, then applies
  // before the target tick advances.
  it("applies a tick-k command only before advancing k to k+1", () => {
    const engine = requireValue(createEngine(makeValidScene()));
    const accepted = requireValue(
      engine.enqueue(makeLaunchCommand("launch-at-two", 2, 5))
    );

    expect(accepted.sequence).toBe(0);

    requireValue(engine.advance(2));
    const beforeTargetBoundary = requireValue(engine.getSnapshot());

    expect(beforeTargetBoundary.tick).toBe(2);
    expect(
      beforeTargetBoundary.bodies[0]?.pose.positionMeters.x
    ).toBe(0);

    requireValue(engine.advance(1));
    const afterTargetBoundary = requireValue(engine.getSnapshot());

    expect(afterTargetBoundary.tick).toBe(3);
    expect(
      afterTargetBoundary.bodies[0]?.pose.positionMeters.x
    ).toBe(5);
  });

  // Commands sharing a target tick apply in acceptance-sequence order.
  it("applies same-tick commands in stable acceptance order", () => {
    const engine = requireValue(createEngine(makeValidScene()));

    const first = requireValue(
      engine.enqueue(makeLaunchCommand("z-first", 0, 4))
    );
    const second = requireValue(
      engine.enqueue(makeLaunchCommand("a-second", 0, 7))
    );

    expect([first.sequence, second.sequence]).toEqual([0, 1]);

    requireValue(engine.advance(1));
    const snapshot = requireValue(engine.getSnapshot());

    expect(snapshot.tick).toBe(1);
    expect(snapshot.bodies[0]?.pose.positionMeters.x).toBe(7);
  });

  it("rejects unknown, duplicate and past commands without mutation", () => {
    const engine = requireValue(createEngine(makeValidScene()));
    const initial = requireValue(engine.copySnapshot());

    expectRejectedWith(
      engine.enqueue(
        makeLaunchCommand("missing-body", 0, 1, "absent")
      ),
      "UNKNOWN_ENTITY_ID",
      "payload.bodyId",
      "absent"
    );
    expect(requireValue(engine.copySnapshot())).toEqual(initial);

    requireValue(
      engine.enqueue(makeLaunchCommand("scheduled", 2, 4))
    );
    expectRejectedWith(
      engine.enqueue(makeLaunchCommand("scheduled", 2, 4)),
      "DUPLICATE_COMMAND_ID",
      "id"
    );

    requireValue(engine.advance(1));
    const beforePastCommand = requireValue(engine.copySnapshot());

    expectRejectedWith(
      engine.enqueue(makeLaunchCommand("too-late", 0, 8)),
      "PAST_TARGET_TICK",
      "targetTick"
    );
    expectRejectedWith(
      engine.advance(-1),
      "INVALID_ADVANCE_COUNT",
      "tickCount"
    );
    expect(requireValue(engine.copySnapshot())).toEqual(
      beforePastCommand
    );
  });

  // Reject Infinity at the command boundary without changing accepted state.
  it("rejects nonfinite command input without mutation", () => {
    const engine = requireValue(createEngine(makeValidScene()));
    const beforeCommand = requireValue(engine.copySnapshot());

    expectRejectedWith(
      engine.enqueue(
        makeLaunchCommand(
          "infinite-launch",
          0,
          Number.POSITIVE_INFINITY
        )
      ),
      "NONFINITE_NUMBER",
      "payload.positionMeters.x"
    );

    expect(requireValue(engine.copySnapshot())).toEqual(beforeCommand);
  });

  // Preserve the last valid tick when the next calculation would overflow.
  it("rolls back a tick that would produce nonfinite state", () => {
    const baseScene = makeValidScene();
    const overflowScene: SceneDefinition = {
      ...baseScene,
      numericalProfile: {
        ...baseScene.numericalProfile,
        fixedTimeStepSeconds: 1
      },
      environment: {
        ...baseScene.environment,
        gravityMetersPerSecondSquared: {
          x: 1e308,
          y: 0
        }
      }
    };

    const engine = requireValue(createEngine(overflowScene));

    // The first tick remains finite and therefore becomes authoritative.
    requireValue(engine.advance(1));
    const lastValid = requireValue(engine.copySnapshot());
    const projectile = lastValid.bodies.find(
      (body) => body.id === "projectile"
    );

    if (projectile === undefined) {
      throw new Error("Snapshot omitted the projectile.");
    }

    expect(lastValid.tick).toBe(1);
    expect([
      lastValid.simulationTimeSeconds,
      projectile.pose.positionMeters.x,
      projectile.pose.positionMeters.y,
      projectile.pose.angleRadians,
      projectile.velocity.linearMetersPerSecond.x,
      projectile.velocity.linearMetersPerSecond.y,
      projectile.velocity.angularRadiansPerSecond
    ].every(Number.isFinite)).toBe(true);

    // The second tick overflows, so it must fail atomically.
    const failedAdvance = engine.advance(1);

    expect(failedAdvance.ok).toBe(false);
    expect(requireValue(engine.copySnapshot())).toEqual(lastValid);

    if (failedAdvance.ok) {
      throw new Error("Expected the overflowing tick to fail.");
    }

    expect(
      failedAdvance.diagnostics.some(
        (diagnostic) => diagnostic.message.includes("tick 2")
      )
    ).toBe(true);
    expect(failedAdvance.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "NONFINITE_STATE",
          entityId: "projectile"
        })
      ])
    );
  });

  it("reset clears pending commands, IDs and acceptance sequence", () => {
    const engine = requireValue(createEngine(makeValidScene()));

    requireValue(
      engine.enqueue(makeLaunchCommand("reusable", 2, 9))
    );
    expect(engine.reset().ok).toBe(true);

    const accepted = requireValue(
      engine.enqueue(makeLaunchCommand("reusable", 0, 3))
    );
    expect(accepted.sequence).toBe(0);

    requireValue(engine.advance(3));
    const snapshot = requireValue(engine.getSnapshot());

    expect(snapshot.tick).toBe(3);
    expect(snapshot.bodies[0]?.pose.positionMeters.x).toBe(3);
  });

  it("retains owned snapshots and disposes idempotently", () => {
    const engine = requireValue(createEngine(makeValidScene()));
    const borrowed = requireValue(engine.getSnapshot());
    const owned = requireValue(engine.copySnapshot());

    expect(owned).not.toBe(borrowed);
    expect(owned.bodies).not.toBe(borrowed.bodies);

    requireValue(engine.advance(1));

    expect(owned.tick).toBe(0);
    expect(owned.simulationTimeSeconds).toBe(0);
    expect(owned.bodies[0]?.pose.positionMeters).toEqual({
      x: 0,
      y: 1
    });

    expect(engine.dispose().ok).toBe(true);
    expect(engine.dispose().ok).toBe(true);
    expectRejectedWith(
      engine.getSnapshot(),
      "DISPOSED_ENGINE",
      ""
    );
  });
});
