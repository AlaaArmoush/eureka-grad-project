// This file contains mock data used to test the lab display.
// It supplies a sample scene and simulation results so we can check
// how they appear on screen without running the physics engine.

import type { Diagnostic, SceneDefinition, Snapshot } from "@eureka/contracts";

export interface LabMock {
  readonly scene: SceneDefinition;
  readonly snapshot: Snapshot;
  readonly trailSnapshots?: readonly Snapshot[];
  readonly invalidInputDiagnostic: Diagnostic;
}
const FIXED_TIME_STEP_SECONDS = 1 / 60;
const OBSERVATION_TICK = 60;

const INITIAL_SPEED_METERS_PER_SECOND = 20;
const LAUNCH_ANGLE_RADIANS = Math.PI / 6;
const INITIAL_HEIGHT_METERS = 1.75;

const INITIAL_VELOCITY_METERS_PER_SECOND = {
  x: INITIAL_SPEED_METERS_PER_SECOND * Math.cos(LAUNCH_ANGLE_RADIANS),
  y: INITIAL_SPEED_METERS_PER_SECOND * Math.sin(LAUNCH_ANGLE_RADIANS),
} as const;

const GRAVITY_METERS_PER_SECOND_SQUARED = {
  x: 0,
  y: -9.81,
} as const;

const scene = {
  schemaVersion: 1,
  id: "handwritten-projectile",
  revision: 1,
  seed: 0,
  numericalProfile: {
    fixedTimeStepSeconds: FIXED_TIME_STEP_SECONDS,
    substeps: 1,
    scales: {
      lengthMeters: 1,
      massKilograms: 1,
      timeSeconds: 1,
    },
  },
  environment: {
    gravityMetersPerSecondSquared: GRAVITY_METERS_PER_SECOND_SQUARED,
    linearDragKilogramsPerSecond: 0,
  },
  bodies: [
    {
      id: "projectile",
      kind: "dynamic",
      shape: {
        kind: "circle",
        radiusMeters: 0.5,
      },
      massKilograms: 1,
      // Bouncy, so the starting run can show ramp → platform → target. Each bounce uses the smaller of the two restitutions.
      material: {
        restitution: 0.9,
      },
      pose: {
        positionMeters: {
          x: 0,
          y: INITIAL_HEIGHT_METERS,
        },
        angleRadians: 0,
      },
      velocity: {
        linearMetersPerSecond: INITIAL_VELOCITY_METERS_PER_SECOND,
        angularRadiansPerSecond: 0,
      },
    },
    {
      id: "landing-platform",
      kind: "static",
      shape: {
        kind: "box",
        widthMeters: 4,
        heightMeters: 1,
      },
      material: {
        restitution: 0.9,
      },
      // Catches the ball coming back from the ramp (ideal landing x ≈ 15.2 m at t ≈ 4.29 s).
      pose: {
        positionMeters: {
          x: 15,
          y: 3,
        },
        angleRadians: 0,
      },
    },
    {
      // As wide as the Curriculum questions' ground, so the lab treats it as the ground plane and every landing stays on it.
      id: "default-ground",
      kind: "static",
      shape: {
        kind: "box",
        widthMeters: 1200,
        heightMeters: 0.5,
      },
      // A bouncy floor: a ball bounces as much as its own restitution allows (the engine uses the smaller of the two).
      material: {
        restitution: 0.8,
      },
      pose: {
        positionMeters: {
          x: 0,
          y: -0.25,
        },
        angleRadians: 0,
      },
    },
    {
      id: "ramp",
      kind: "static",
      shape: {
        kind: "box",
        widthMeters: 6,
        heightMeters: 0.5,
      },
      material: {
        restitution: 0.7,
      },
      // A steep 50° face across the launch's path: the ball hits it near (25.1, 5.94) at t ≈ 1.45 s and bounces back up-left.
      pose: {
        positionMeters: {
          x: 25.6,
          y: 5.365,
        },
        angleRadians: (50 * Math.PI) / 180,
      },
    },
  ],
  triggers: [
    {
      id: "target",
      kind: "target",
      shape: {
        kind: "circle",
        radiusMeters: 0.75,
      },
      // On the rise after the platform bounce; the ball enters it at t ≈ 4.75 s and never passes it earlier.
      pose: {
        positionMeters: {
          x: 13.1,
          y: 10.1,
        },
        angleRadians: 0,
      },
    },
  ],
} as const satisfies SceneDefinition;
function createFlightSnapshot(tick: number): Snapshot {
  const simulationTimeSeconds = tick * FIXED_TIME_STEP_SECONDS;

  const projectilePositionMeters = {
    x: INITIAL_VELOCITY_METERS_PER_SECOND.x * simulationTimeSeconds,
    y:
      INITIAL_HEIGHT_METERS +
      INITIAL_VELOCITY_METERS_PER_SECOND.y * simulationTimeSeconds +
      0.5 *
        GRAVITY_METERS_PER_SECOND_SQUARED.y *
        simulationTimeSeconds *
        simulationTimeSeconds,
  };

  const projectileVelocityMetersPerSecond = {
    x: INITIAL_VELOCITY_METERS_PER_SECOND.x,
    y:
      INITIAL_VELOCITY_METERS_PER_SECOND.y +
      GRAVITY_METERS_PER_SECOND_SQUARED.y * simulationTimeSeconds,
  };

  return {
    contractVersion: 1,
    engineVersion: "mock",
    engineBuild: "independent-projectile-flight",
    tick,
    simulationTimeSeconds,
    bodies: scene.bodies.map((body) => ({
      id: body.id,
      pose:
        body.id === "projectile"
          ? {
              positionMeters: projectilePositionMeters,
              angleRadians: 0,
            }
          : {
              positionMeters: { ...body.pose.positionMeters },
              angleRadians: body.pose.angleRadians,
            },
      velocity:
        body.id === "projectile"
          ? {
              linearMetersPerSecond: projectileVelocityMetersPerSecond,
              angularRadiansPerSecond: 0,
            }
          : {
              linearMetersPerSecond: { x: 0, y: 0 },
              angularRadiansPerSecond: 0,
            },
    })),
    projectileReadouts: [
      {
        bodyId: "projectile",
        flightTimeSeconds: simulationTimeSeconds,
        horizontalDisplacementMeters: projectilePositionMeters.x,
        heightMeters: projectilePositionMeters.y,
      },
    ],
    events: [],
    diagnostics: [],
  };
}
// time from 0 - 0.1 - 0.2 ---> 1
const projectileTrailSnapshots = [0, 6, 12, 18, 24, 30, 36, 42, 48, 54, 60].map(
  createFlightSnapshot,
);

const snapshot = createFlightSnapshot(OBSERVATION_TICK);

const invalidInputDiagnostic = {
  code: "NONFINITE_NUMBER",
  path: "bodies[0].massKilograms",
  message: "Mass must be finite.",
  entityId: "projectile",
} as const satisfies Diagnostic;

export const PROJECTILE_LAB_MOCK = {
  scene,
  snapshot,
  trailSnapshots: projectileTrailSnapshots,
  invalidInputDiagnostic,
} as const satisfies LabMock;
