import { describe, expect, it } from "vitest";
import { createEngine } from "../src/index.js";

const TIME_TOLERANCE_SECONDS = 1e-12;
const POSITION_TOLERANCE_METERS = 1e-12;
const VELOCITY_TOLERANCE_METERS_PER_SECOND = 1e-12;

interface FailedResult {
  readonly ok: false;
  readonly diagnostics: readonly {
    readonly code: string;
    readonly message: string;
    readonly path: string;
  }[];
}

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

function expectWithinAbsoluteTolerance(
  actual: number,
  expected: number,
  tolerance: number
): void {
  expect(Number.isFinite(actual)).toBe(true);
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance);
}

describe("S00-ENGINE-01 constant-acceleration starter", () => {
  it("advances one particle through fixed ticks using the public engine API", () => {
    const particleId = "s00-particle";
    const fixedTimeStepSeconds = 0.25;
    const tickCount = 4;

    const engine = requireValue(
      createEngine({
        schemaVersion: 1,
        id: "s00-constant-acceleration",
        revision: 1,
        seed: 0,
        numericalProfile: {
          fixedTimeStepSeconds,
          substeps: 1,
          scales: {
            lengthMeters: 1,
            massKilograms: 1,
            timeSeconds: 1
          }
        },
        environment: {
          gravityMetersPerSecondSquared: {
            x: -0.5,
            y: -2
          },
          linearDragKilogramsPerSecond: 0
        },
        bodies: [
          {
            id: particleId,
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
              positionMeters: {
                x: 1.25,
                y: -0.5
              },
              angleRadians: 0
            },
            velocity: {
              linearMetersPerSecond: {
                x: 2,
                y: 3
              },
              angularRadiansPerSecond: 0
            }
          }
        ],
        triggers: []
      })
    );

    const advanceResult = requireValue(engine.advance(tickCount));

    expect(advanceResult.lastValidTick).toBe(4);

    const snapshot = requireValue(engine.getSnapshot());
    const particle = snapshot.bodies.find(
      (body: (typeof snapshot.bodies)[number]) =>
        body.id === particleId
    );

    expect(particle).toBeDefined();

    if (particle === undefined) {
      throw new Error(`Snapshot omitted particle "${particleId}".`);
    }

    expect(snapshot.tick).toBe(4);

    expectWithinAbsoluteTolerance(
      snapshot.simulationTimeSeconds,
      1,
      TIME_TOLERANCE_SECONDS
    );
    expectWithinAbsoluteTolerance(
      particle.pose.positionMeters.x,
      3,
      POSITION_TOLERANCE_METERS
    );
    expectWithinAbsoluteTolerance(
      particle.pose.positionMeters.y,
      1.5,
      POSITION_TOLERANCE_METERS
    );
    expectWithinAbsoluteTolerance(
      particle.velocity.linearMetersPerSecond.x,
      1.5,
      VELOCITY_TOLERANCE_METERS_PER_SECOND
    );
    expectWithinAbsoluteTolerance(
      particle.velocity.linearMetersPerSecond.y,
      1,
      VELOCITY_TOLERANCE_METERS_PER_SECOND
    );
  });
});
