import { describe, expect, it } from "vitest";
import { createEngine } from "../../src/index.js";
import { expectNear, unwrap } from "../test-support.js";
import { GRAVITY, TIME_STEP, makeScene } from "./scene-fixtures.js";
import {
  measureLanding,
  observeReferenceFlight,
  ordinaryTolerance
} from "./test-support.js";

// Independently predict an origin launch at 20 m/s and 30 degrees.
function expectedLaunchState(
  mass: number,
  drag: number,
  time: number
): { x: number; y: number; vx: number; vy: number } {
  const initialVx = 10 * Math.sqrt(3);
  const initialVy = 10;
  const rate = drag / mass;

  // Zero drag uses the ideal equations without dividing by zero.
  if (rate === 0) {
    return {
      x: initialVx * time,
      y: initialVy * time - 0.5 * GRAVITY * time * time,
      vx: initialVx,
      vy: initialVy - GRAVITY * time
    };
  }

  // Evaluate the closed-form exponential solution, not numerical stepping.
  const decay = Math.exp(-rate * time);
  const effectiveTime = -Math.expm1(-rate * time) / rate;
  const gravityPositionFactor = (time - effectiveTime) / rate;

  return {
    x: initialVx * effectiveTime,
    y: initialVy * effectiveTime - GRAVITY * gravityPositionFactor,
    vx: initialVx * decay,
    vy: initialVy * decay - GRAVITY * effectiveTime
  };
}

// Nine combinations expose incorrect handling of the drag rate b/m.
const dragCases = [
  { mass: 0.1, drag: 0 }, { mass: 0.1, drag: 0.1 }, { mass: 0.1, drag: 0.5 },
  { mass: 1, drag: 0 }, { mass: 1, drag: 0.1 }, { mass: 1, drag: 0.5 },
  { mass: 10, drag: 0 }, { mass: 10, drag: 0.1 }, { mass: 10, drag: 0.5 },
];

describe("projectile motion with linear drag", () => {
  // Protect the exact trajectory for each mass/coefficient combination.
  it.each(dragCases)(
    "matches position and velocity for mass $mass kg and drag $drag kg/s",
    ({ mass, drag }) => {
      const scene = makeScene(20, 30, 0, false, {
        massKilograms: mass,
        linearDragKilogramsPerSecond: drag
      });

      const engine = unwrap(createEngine(scene));

      try {
        let previousTick = 0;

        // Check initialization and two later times during uninterrupted flight.
        for (const tick of [0, 30, 60]) {
          unwrap(engine.advance(tick - previousTick));
          previousTick = tick;

          const snapshot = unwrap(engine.getSnapshot());
          const projectile = snapshot.bodies.find(
            (body) => body.id === "projectile"
          );

          if (projectile === undefined) {
            throw new Error("Snapshot omitted the projectile.");
          }

          const time = tick * TIME_STEP;
          const expected = expectedLaunchState(mass, drag, time);
          const position = projectile.pose.positionMeters;
          const velocity = projectile.velocity.linearMetersPerSecond;

          expect(snapshot.tick).toBe(tick);
          expectNear(snapshot.simulationTimeSeconds, time, 1e-12);

          // Math.hypot combines the x/y position errors into one distance in metres.
          const positionError = Math.hypot(
            position.x - expected.x,
            position.y - expected.y
          );
          const expectedPositionMagnitude = Math.hypot(
            expected.x,
            expected.y
          );

          expectNear(
            positionError,
            0,
            ordinaryTolerance(expectedPositionMagnitude)
          );

          // Math.hypot combines the x/y velocity errors into one error magnitude in m/s.
          const velocityError = Math.hypot(
            velocity.x - expected.vx,
            velocity.y - expected.vy
          );
          const expectedVelocityMagnitude = Math.hypot(
            expected.vx,
            expected.vy
          );

          expectNear(
            velocityError,
            0,
            ordinaryTolerance(expectedVelocityMagnitude)
          );
        }
      } finally {
        // Each case owns and releases its engine.
        expect(engine.dispose().ok).toBe(true);
      }
    }
  );

  // Compare landing events with a root solved from the closed-form trajectory.
  it.each([
    { drag: 0.1, time: 1.973843787642511, range: 31.02535217020725 },
    { drag: 0.5, time: 1.778544435473214, range: 20.40512672902836 }
  ])("matches landing with drag $drag kg/s", ({ drag, time, range }) => {
    let lower = 1;
    let upper = 3;

    // These signs prove the positive-height root lies inside the search interval.
    expect(expectedLaunchState(1, drag, lower).y).toBeGreaterThan(0);
    expect(expectedLaunchState(1, drag, upper).y).toBeLessThan(0);

    // Bisection solves landing time using only the independent analytic equation.
    while (upper - lower > 1e-10) {
      const middle = (lower + upper) / 2;

      if (expectedLaunchState(1, drag, middle).y > 0) {
        lower = middle;
      } else {
        upper = middle;
      }
    }

    const expectedTime = (lower + upper) / 2;
    const expectedRange = expectedLaunchState(1, drag, expectedTime).x;

    // Frozen values catch mistakes in the independent root calculation itself.
    expectNear(expectedTime, time, 1e-9);
    expectNear(expectedRange, range, 1e-8);

    const actual = measureLanding(
      makeScene(20, 30, 0, true, {
        linearDragKilogramsPerSecond: drag
      }),
      expectedTime
    );

    expectNear(actual.time, expectedTime, ordinaryTolerance(expectedTime));
    expectNear(actual.range, expectedRange, ordinaryTolerance(expectedRange));
  });

  // Positive drag must approach the ideal solution as its coefficient shrinks.
  it("approaches ideal motion with very weak positive drag", () => {
    const expected = expectedLaunchState(1, 0, 1);
    const actual = observeReferenceFlight(1, 1e-7).final;

    expectNear(
      Math.hypot(actual.x - expected.x, actual.y - expected.y),
      0,
      1e-5
    );
    expectNear(
      Math.hypot(actual.vx - expected.vx, actual.vy - expected.vy),
      0,
      1e-5
    );
  });

  // Mechanical-energy change must match the work removed by drag over every tick.
  it.each(dragCases)(
    "balances energy for mass $mass kg and drag $drag kg/s",
    ({ mass, drag }) => {
      const timeStep = 1 / 240;
      const trace = observeReferenceFlight(mass, drag, timeStep);
      const initialEnergy = 200 * mass;
      const energyScale = Math.max(initialEnergy, 1);
      const tolerance = 0.005 * energyScale + 1e-8;

      // E = m(|v|^2/2 + gy), with potential zero at launch height.
      function energy(state: { y: number; vx: number; vy: number }): number {
        return mass * (
          0.5 * (state.vx ** 2 + state.vy ** 2) + GRAVITY * state.y
        );
      }

      expectNear(energy(trace.initial), initialEnergy, 1e-10 * energyScale);

      let previousPower = drag * (
        trace.initial.vx ** 2 + trace.initial.vy ** 2
      );
      let integratedDragLoss = 0;
      let maximumBalanceError = 0;

      // Trapezoidal power integration checks E(t) + integral(b|v|^2 dt) = E(0).
      for (const state of trace.samples.slice(1)) {
        const power = drag * (state.vx ** 2 + state.vy ** 2);
        integratedDragLoss += 0.5 * (previousPower + power) * timeStep;
        previousPower = power;

        maximumBalanceError = Math.max(
          maximumBalanceError,
          Math.abs(energy(state) + integratedDragLoss - initialEnergy)
        );

        expect(initialEnergy - energy(state)).toBeGreaterThanOrEqual(
          -1e-12 * energyScale
        );
      }

      const expectedFinalEnergy = energy(expectedLaunchState(mass, drag, 1));
      const expectedDragLoss = initialEnergy - expectedFinalEnergy;

      expectNear(energy(trace.final), expectedFinalEnergy, tolerance);
      expectNear(integratedDragLoss, expectedDragLoss, tolerance);
      expectNear(maximumBalanceError, 0, tolerance);
      expect(integratedDragLoss).toBeGreaterThanOrEqual(0);
    }
  );

  // Halving the fixed step should reduce second-order position error by about four.
  it.each([0.1, 0.5])(
    "shows second-order position convergence with drag %s kg/s",
    (drag) => {
      const expected = expectedLaunchState(1, drag, 1);

      // Each resolution is checked against the formula before comparing errors.
      function positionError(timeStep: number): number {
        const actual = observeReferenceFlight(1, drag, timeStep).final;
        const error = Math.hypot(actual.x - expected.x, actual.y - expected.y);
        const expectedPositionMagnitude = Math.hypot(expected.x, expected.y);

        expectNear(error, 0, ordinaryTolerance(expectedPositionMagnitude));
        return error;
      }

      const coarse = positionError(TIME_STEP);
      const medium = positionError(TIME_STEP / 2);
      const fine = positionError(TIME_STEP / 4);

      expect(fine).toBeGreaterThan(1e-10);

      for (const ratio of [coarse / medium, medium / fine]) {
        expect(ratio).toBeGreaterThanOrEqual(3);
        expect(ratio).toBeLessThanOrEqual(5);
      }
    }
  );
});

