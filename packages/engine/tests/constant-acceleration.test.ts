import { describe, expect, it } from "vitest";
import { createEngine } from "../src/index.js";

const TIME_TOLERANCE_SECONDS = 1e-12;
const POSITION_TOLERANCE_METERS = 1e-12;
const VELOCITY_TOLERANCE_METERS_PER_SECOND = 1e-12;

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

    const engine = createEngine(
      {
        id: "s00-constant-acceleration",
        constantAccelerationMetersPerSecondSquared: {
          x: -0.5,
          y: -2
        },
        bodies: [
          {
            id: particleId,
            positionMeters: {
              x: 1.25,
              y: -0.5
            },
            velocityMetersPerSecond: {
              x: 2,
              y: 3
            }
          }
        ]
      },
      {
        fixedTimeStepSeconds
      },
      0
    );

    const advanceResult = engine.advance(tickCount);

    expect(advanceResult.ok).toBe(true);

    const snapshot = engine.getSnapshot();
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
      snapshot.timeSeconds,
      1,
      TIME_TOLERANCE_SECONDS
    );
    expectWithinAbsoluteTolerance(
      particle.positionMeters.x,
      3,
      POSITION_TOLERANCE_METERS
    );
    expectWithinAbsoluteTolerance(
      particle.positionMeters.y,
      1.5,
      POSITION_TOLERANCE_METERS
    );
    expectWithinAbsoluteTolerance(
      particle.velocityMetersPerSecond.x,
      1.5,
      VELOCITY_TOLERANCE_METERS_PER_SECOND
    );
    expectWithinAbsoluteTolerance(
      particle.velocityMetersPerSecond.y,
      1,
      VELOCITY_TOLERANCE_METERS_PER_SECOND
    );
  });
});
