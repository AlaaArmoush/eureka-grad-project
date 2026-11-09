import { describe, expect, it } from "vitest";
import { createEngine } from "../../src/index.js";
import { GRAVITY, makeScene } from "./scene-fixtures.js";
import { expectNear, unwrap } from "../test-support.js";
import {
  measureLanding,
  ordinaryTolerance
} from "./projectile-test-support.js";

// Independently calculated samples for the 20 m/s, 30-degree launch.
const referenceSamples = [
  { tick: 0, x: 0, y: 0, vy: 10 },
  { tick: 30, x: 5 * Math.sqrt(3), y: 3.77375, vy: 5.095 },
  { tick: 60, x: 10 * Math.sqrt(3), y: 5.095, vy: 0.19 },
  { tick: 90, x: 15 * Math.sqrt(3), y: 3.96375, vy: -4.715 },
  { tick: 120, x: 20 * Math.sqrt(3), y: 0.38, vy: -9.62 }
];

describe("ideal projectile motion", () => {
  // Each row becomes a separate test with a fresh engine.
  it.each(referenceSamples)(
    "matches the 20 m/s, 30-degree trajectory at tick $tick",
    ({ tick, x, y, vy }) => {
      const engine = unwrap(createEngine(makeScene(20, 30)));

      try {
        unwrap(engine.advance(tick));
        const snapshot = unwrap(engine.getSnapshot());

        const projectile = snapshot.bodies.find(
          (body) => body.id === "projectile"
        );

        if (projectile === undefined) {
          throw new Error("Snapshot omitted the projectile.");
        }

        const position = projectile.pose.positionMeters;
        const velocity = projectile.velocity.linearMetersPerSecond;

        expect(snapshot.tick).toBe(tick);
        expectNear(snapshot.simulationTimeSeconds, tick / 60, 1e-12);

        expectNear(
          Math.hypot(position.x - x, position.y - y),
          0,
          1e-9
        );

        expectNear(
          Math.hypot(velocity.x - 10 * Math.sqrt(3), velocity.y - vy),
          0,
          1e-9
        );
      } finally {
        expect(engine.dispose().ok).toBe(true);
      }
    }
  );
});

describe("ideal projectile landing", () => {
  // Protect both landing observables for the main reference launch.
  it("lands the 20 m/s, 30-degree launch at the analytic time and range", () => {
    // Equal-height time = 2 * 10 / g.
    const expectedTime = 20 / GRAVITY;

    // Range = 20² * sin(60°) / g.
    const expectedRange = 200 * Math.sqrt(3) / GRAVITY;

    const landing = measureLanding(
      makeScene(20, 30, 0, true),
      expectedTime
    );

    expectNear(landing.time, expectedTime, ordinaryTolerance(expectedTime));
    expectNear(landing.range, expectedRange, ordinaryTolerance(expectedRange));

    // Preserve the explicit requirement of strictly less than 1% error.
    expect(
      Math.abs(landing.range - expectedRange) / expectedRange
    ).toBeLessThan(0.01);
  });

  // Each horizontal speed has the same independently calculated fall time.
  it.each([5, 10, 20])(
    "matches the 20 m cliff fall at horizontal speed %s m/s",
    (speed) => {
      // Fall time = sqrt(2 * H / g).
      const expectedTime = Math.sqrt(40 / GRAVITY);

      // Horizontal range = horizontal speed * fall time.
      const expectedRange = speed * expectedTime;

      const landing = measureLanding(
        makeScene(speed, 0, 20, true),
        expectedTime
      );

      expectNear(landing.time, expectedTime, ordinaryTolerance(expectedTime));
      expectNear(landing.range, expectedRange, ordinaryTolerance(expectedRange));
    }
  );
});

// Independent trigonometric references:
// verticalFraction = sin(angle), rangeFactor = sin(2 * angle).
const angleCases = [
  { angle: 0, verticalFraction: 0, rangeFactor: 0 },
  {
    angle: 15,
    verticalFraction: (Math.sqrt(6) - Math.sqrt(2)) / 4,
    rangeFactor: 0.5
  },
  {
    angle: 30,
    verticalFraction: 0.5,
    rangeFactor: Math.sqrt(3) / 2
  },
  {
    angle: 45,
    verticalFraction: Math.sqrt(2) / 2,
    rangeFactor: 1
  },
  {
    angle: 60,
    verticalFraction: Math.sqrt(3) / 2,
    rangeFactor: Math.sqrt(3) / 2
  },
  {
    angle: 75,
    verticalFraction: (Math.sqrt(6) + Math.sqrt(2)) / 4,
    rangeFactor: 0.5
  },
  { angle: 90, verticalFraction: 1, rangeFactor: 0 }
];

describe("ideal launch angles", () => {
  // Check every sweep result against its formula before comparing maxima.
  it("matches the angle sweep and has its maximum range at 45 degrees", () => {
    const results = angleCases.map((sample) => {
      // Time = 2 * speed * sin(angle) / g.
      const expectedTime = 40 * sample.verticalFraction / GRAVITY;

      // Range = speed² * sin(2 * angle) / g.
      const expectedRange = 400 * sample.rangeFactor / GRAVITY;

      const landing = measureLanding(
        makeScene(20, sample.angle, 0, true),
        expectedTime
      );

      expectNear(landing.time, expectedTime, ordinaryTolerance(expectedTime));
      expectNear(landing.range, expectedRange, ordinaryTolerance(expectedRange));

      // A horizontal launch already touching ground has no airborne flight.
      if (sample.angle === 0) {
        expectNear(landing.time, 0, 1e-9);
        expectNear(landing.range, 0, 1e-7);
      }

      return { angle: sample.angle, range: landing.range };
    });

    // Select the largest measured range.
    const maximum = results.reduce(
      (best, current) => current.range > best.range ? current : best
    );

    expect(maximum.angle).toBe(45);
  });

  // Generate both complementary pairs at each required speed.
  const complementaryCases = [10, 20, 30].flatMap((speed) => [
    { speed, lowAngle: 15, highAngle: 75 },
    { speed, lowAngle: 30, highAngle: 60 }
  ]);

  // Protect each individual answer as well as the relationship between them.
  it.each(complementaryCases)(
    "matches equal ranges and unequal times for $lowAngle/$highAngle degrees at $speed m/s",
    ({ speed, lowAngle, highAngle }) => {
      const low = angleCases.find((sample) => sample.angle === lowAngle);
      const high = angleCases.find((sample) => sample.angle === highAngle);

      if (low === undefined || high === undefined) {
        throw new Error("Missing complementary-angle reference.");
      }

      const expectedLowTime = 2 * speed * low.verticalFraction / GRAVITY;
      const expectedHighTime = 2 * speed * high.verticalFraction / GRAVITY;
      const expectedRange = speed * speed * low.rangeFactor / GRAVITY;

      const first = measureLanding(
        makeScene(speed, lowAngle, 0, true),
        expectedLowTime
      );
      const second = measureLanding(
        makeScene(speed, highAngle, 0, true),
        expectedHighTime
      );

      // Both launches must independently match their analytic answers.
      expectNear(first.range, expectedRange, ordinaryTolerance(expectedRange));
      expectNear(second.range, expectedRange, ordinaryTolerance(expectedRange));
      expectNear(first.time, expectedLowTime, ordinaryTolerance(expectedLowTime));
      expectNear(second.time, expectedHighTime, ordinaryTolerance(expectedHighTime));

      // Equal expected ranges permit the sum of their individual bounds.
      expectNear(
        first.range - second.range,
        0,
        2 * ordinaryTolerance(expectedRange)
      );

      // The higher-angle launch must stay airborne measurably longer.
      expect(second.time - first.time).toBeGreaterThan(
        ordinaryTolerance(expectedLowTime) +
        ordinaryTolerance(expectedHighTime)
      );
    }
  );
});
