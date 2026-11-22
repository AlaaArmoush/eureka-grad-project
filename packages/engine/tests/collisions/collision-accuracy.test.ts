import { expect, it } from "vitest";
import type { SceneDefinition } from "@eureka/contracts";
import { createEngine } from "../../src/index.js";
import { expectNear, unwrap } from "../test-support.js";
import { makeSlidingBoxScene } from "./scene-fixtures.js";

const gravity = 9.81;
const frictionNewtons = 0.2 * gravity;
const sineOfTwo = Math.sin(2);
const cosineOfTwo = Math.cos(2);

const expectedSlidingX = 4 + 0.25 * (1 - cosineOfTwo) - 0.5 * frictionNewtons;
const expectedSlidingVX = 4 + 0.5 * sineOfTwo - frictionNewtons;
const expectedFrictionLoss = frictionNewtons * expectedSlidingX;

// Integrate cos(2t) times the independently calculated velocity from 0 to 1 s
const expectedDriveWork = 2 * sineOfTwo + sineOfTwo ** 2 / 8
  - frictionNewtons * (0.5 * sineOfTwo + 0.25 * (cosineOfTwo - 1));

const initialEnergyJoules = 8;
const energyBoundJoules = 0.005 * initialEnergyJoules + 1e-8;

// Run one resolution and compare its final state with the one-second reference
function measureSlidingErrors(ticksPerSecond: number) {
  const baseScene = makeSlidingBoxScene();
  const scene: SceneDefinition = {
    ...baseScene,
    numericalProfile: {
      ...baseScene.numericalProfile,
      fixedTimeStepSeconds: 1 / ticksPerSecond,
    },
  };
  const engine = unwrap(createEngine(scene));

  try {
    unwrap(engine.advance(ticksPerSecond));
    const snapshot = unwrap(engine.getSnapshot());
    const block = snapshot.bodies.find((body) => body.id === "sliding-block");
    const losses = snapshot.collisionEnergyLosses;
    const driveWork = snapshot.sinusoidalForceWorkJoules;

    if (block === undefined || losses === undefined || driveWork === undefined) {
      throw new Error("Expected the sliding block, drive work, and collision loss record.");
    }

    expect(snapshot.tick).toBe(ticksPerSecond);
    expectNear(snapshot.simulationTimeSeconds, 1, 1e-12);

    const position = block.pose.positionMeters;
    const velocity = block.velocity.linearMetersPerSecond;
    const spin = block.velocity.angularRadiansPerSecond;
    const positionError = Math.abs(position.x - expectedSlidingX);
    const velocityError = Math.abs(velocity.x - expectedSlidingVX);

    expectNear(positionError, 0, 1e-6 + 0.005 * expectedSlidingX);
    expectNear(velocityError, 0, 1e-6 + 0.005 * expectedSlidingVX);
    expectNear(position.y, 0.5, 1e-4);
    expectNear(velocity.y, 0, 1e-5);
    expectNear(block.pose.angleRadians, 0, 1e-5);
    expectNear(spin, 0, 1e-5);

    // Include any measured vertical movement and spin in the energy balance.
    const finalEnergy = 0.5 * (velocity.x ** 2 + velocity.y ** 2)
      + spin ** 2 / 12
      + gravity * (position.y - 0.5);
    const ledgerError = Math.abs(finalEnergy + losses.frictionLossJoules - initialEnergyJoules - driveWork);

    expectNear(losses.restitutionLossJoules, 0, 1e-12);
    expectNear(losses.weldLossJoules, 0, 1e-12);
    expect(losses.frictionLossJoules).toBeGreaterThanOrEqual(-1e-12);
    expectNear(ledgerError, 0, energyBoundJoules);

    return {
      ticksPerSecond,
      positionError,
      velocityError,
      driveWorkError: Math.abs(driveWork - expectedDriveWork),
      frictionLossError: Math.abs(losses.frictionLossJoules - expectedFrictionLoss),
      ledgerError,
    };
  } finally {
    expect(engine.dispose().ok).toBe(true);
  }
}// Catch sliding motion that misses the independent answer or fails to improve.
it("refines the driven sliding-box motion at one second", () => {
  const coarse = measureSlidingErrors(60);
  const medium = measureSlidingErrors(120);
  const fine = measureSlidingErrors(240);
  console.table([coarse, medium, fine]);

  // Check the separate energy channels on the finest run.
  expectNear(fine.driveWorkError, 0, energyBoundJoules);
  expectNear(fine.frictionLossError, 0, energyBoundJoules);

  const positionRatios: number[] = [];

  for (const [largerStep, smallerStep] of [[coarse, medium], [medium, fine]] as const) {
    expect(smallerStep.velocityError).toBeLessThanOrEqual(largerStep.velocityError + 1e-10);

    if (smallerStep.positionError > 1e-10) {
      positionRatios.push(largerStep.positionError / smallerStep.positionError);
    }
  }

  console.info("Sliding position error ratios", positionRatios);
  const firstOrder = positionRatios.every((ratio) => ratio >= 1.5 && ratio <= 2.5);
  const fasterOrder = positionRatios.every((ratio) => ratio > 2.5);
  expect(firstOrder || fasterOrder).toBe(true);
});

// Check both sides of the mixed static limit and the slowdown from mixed kinetic friction.
it.each([
  {
    name: "holds a stationary block below the mixed static friction limit",
    driveNewtons: 3.4335,
    initialVelocityX: 0,
    motion: "sticking",
  },
  {
    name: "starts a stationary block sliding above the mixed static friction limit",
    driveNewtons: 4.4145,
    initialVelocityX: 0,
    motion: "breaking away",
  },
  {
    name: "slows a moving block by the mixed kinetic friction force",
    driveNewtons: 0,
    initialVelocityX: 4,
    motion: "slowing",
  },
] as const)("$name", (row) => {
  const baseScene = makeSlidingBoxScene(false);
  const stepSeconds = 1 / 240;
  const observationTicks = 60;
  const observationSeconds = 0.25;
  const scene: SceneDefinition = {
    ...baseScene,
    id: "mixed-friction-block",
    numericalProfile: {
      ...baseScene.numericalProfile,
      fixedTimeStepSeconds: stepSeconds,
    },
    bodies: baseScene.bodies.map((body) => {
      if (body.kind === "static") {
        return {
          ...body,
          material: {
            ...body.material,
            staticFrictionCoefficient: 0.8,
            kineticFrictionCoefficient: 0.4,
          },
        };
      }

      return {
        ...body,
        material: {
          ...body.material,
          staticFrictionCoefficient: 0.2,
          kineticFrictionCoefficient: 0.1,
        },
        velocity: {
          ...body.velocity,
          linearMetersPerSecond: { x: row.initialVelocityX, y: 0 },
        },
      };
    }),
    // Zero angular frequency makes the cosine force a constant push.
    sinusoidalForces:
      row.driveNewtons === 0
        ? []
        : [
            {
              forceVersion: 1,
              id: "friction-threshold-push",
              bodyId: "sliding-block",
              amplitudeNewtons: { x: row.driveNewtons, y: 0 },
              angularFrequencyRadiansPerSecond: 0,
              startTimeSeconds: 0,
              endTimeSeconds: observationSeconds,
            },
          ],
  };
  const engine = unwrap(createEngine(scene));

  try {
    unwrap(engine.advance(observationTicks));
    const snapshot = unwrap(engine.getSnapshot());
    const block = snapshot.bodies.find((body) => body.id === "sliding-block");
    if (block === undefined) {
      throw new Error("Expected the mixed-friction block in the snapshot.");
    }

    expect(snapshot.tick).toBe(observationTicks);
    expectNear(snapshot.simulationTimeSeconds, observationSeconds, 1e-12);
    expectNear(block.pose.positionMeters.y, 0.5, 1e-4);

    const positionX = block.pose.positionMeters.x;
    const velocityX = block.velocity.linearMetersPerSecond.x;
    const slipSpeedBound = 1e-5;
    const slipDistanceBound = slipSpeedBound * observationSeconds;

    // sqrt(0.2 * 0.8) = 0.4, so the 1 kg block can resist up to 3.924 N.
    if (row.motion === "sticking") {
      expectNear(velocityX, 0, slipSpeedBound);
      expectNear(positionX, 0, slipDistanceBound);
      return;
    }

    if (row.motion === "breaking away") {
      expect(Number.isFinite(velocityX)).toBe(true);
      expect(Number.isFinite(positionX)).toBe(true);
      expect(velocityX).toBeGreaterThan(slipSpeedBound);
      expect(positionX).toBeGreaterThan(slipDistanceBound);
      return;
    }

    // sqrt(0.1 * 0.4) = 0.2. With no push, a = -0.2g and x = v0t + at²/2.
    const expectedAccelerationX = -0.2 * gravity;
    const expectedPositionX =
      row.initialVelocityX * observationSeconds +
      0.5 * expectedAccelerationX * observationSeconds ** 2;
    const accelerationX =
      (velocityX - row.initialVelocityX) / observationSeconds;

    expectNear(
      accelerationX,
      expectedAccelerationX,
      0.005 * Math.abs(expectedAccelerationX),
    );
    expectNear(
      positionX,
      expectedPositionX,
      1e-6 + 0.005 * Math.max(Math.abs(expectedPositionX), 1),
    );
  } finally {
    expect(engine.dispose().ok).toBe(true);
  }
});

// Measure contact timing, impulse, and final velocity at one resolution.
function measureWallImpactErrors(ticksPerSecond: number) {
  const scene: SceneDefinition = {
    schemaVersion: 1,
    id: "oblique-wall-impact-refinement",
    revision: 1,
    seed: 17,
    numericalProfile: {
      fixedTimeStepSeconds: 1 / ticksPerSecond,
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
        id: "barrier",
        kind: "static",
        shape: { kind: "box", widthMeters: 0.1, heightMeters: 4 },
        material: { restitution: 1 },
        pose: { positionMeters: { x: 0.66, y: 0 }, angleRadians: 0 },
      },
      {
        id: "puck",
        kind: "dynamic",
        shape: { kind: "circle", radiusMeters: 0.5 },
        massKilograms: 1,
        material: { restitution: 1 },
        pose: { positionMeters: { x: 0, y: 0 }, angleRadians: 0 },
        velocity: {
          linearMetersPerSecond: { x: 4, y: 1 },
          angularRadiansPerSecond: 0,
        },
      },
    ],
    triggers: [],
  };

  const expectedImpactTime = 0.0275;
  const impactTick = Math.floor(expectedImpactTime * ticksPerSecond) + 1;
  const finalTick = ticksPerSecond / 10;
  const engine = unwrap(createEngine(scene));

  try {
    unwrap(engine.advance(impactTick));
    const impact = unwrap(engine.getSnapshot());
    expect(impact.tick).toBe(impactTick);

    const contact = impact.contacts?.find(
      (entry) => entry.bodyAId === "barrier" && entry.bodyBId === "puck",
    );
    if (contact === undefined) {
      throw new Error(`Expected wall contact at tick ${impactTick} for ${ticksPerSecond} Hz.`);
    }

    const timeErrorSeconds = Math.abs(contact.timeSeconds - expectedImpactTime);
    const impulseErrorNewtonSeconds = Math.abs(contact.normalImpulseNewtonSeconds - 8);

    expect(contact.tick).toBe(impactTick);
    expectNear(timeErrorSeconds, 0, 1e-7 / 4);
    expectNear(impulseErrorNewtonSeconds, 0, 8.01e-10);
    expectNear(contact.tangentImpulseNewtonSeconds, 0, 1e-10);

    unwrap(engine.advance(finalTick - impactTick));
    const final = unwrap(engine.getSnapshot());
    const puck = final.bodies.find((body) => body.id === "puck");
    if (puck === undefined) {
      throw new Error("Expected the puck in the final snapshot.");
    }

    const velocity = puck.velocity.linearMetersPerSecond;
    const velocityErrorMetersPerSecond = Math.hypot(velocity.x + 4, velocity.y - 1);

    expect(final.tick).toBe(finalTick);
    expectNear(final.simulationTimeSeconds, 0.1, 1e-12);
    expectNear(velocityErrorMetersPerSecond, 0, 1e-10 + 1e-8 * Math.hypot(4, 1));

    return { ticksPerSecond, timeErrorSeconds, impulseErrorNewtonSeconds, velocityErrorMetersPerSecond };
  } finally {
    expect(engine.dispose().ok).toBe(true);
  }
}

// Catch a hit rounded to a tick boundary or an impulse that depends on the timestep.
it("localizes the same wall impact at three timesteps", () => {
  console.table([60, 120, 240].map(measureWallImpactErrors));
});
