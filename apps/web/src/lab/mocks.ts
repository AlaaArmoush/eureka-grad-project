// This file contains mock data used to test the lab display.
// It supplies a sample scene and simulation results so we can check
// how they appear on screen without running the physics engine.

import type { Diagnostic, SceneDefinition, Snapshot } from "@eureka/contracts";
// Describe the public operations implemented by the fixture playback adapter.
import type { Engine, EngineResult, EngineStatus } from "@eureka/engine";

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
        radiusMeters: 0.1,
      },
      massKilograms: 1,
      material: {
        restitution: 0,
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
        widthMeters: 2,
        heightMeters: 0.5,
      },
      material: {
        restitution: 0,
      },
      pose: {
        positionMeters: {
          x: 10,
          y: 1.4,
        },
        angleRadians: 0,
      },
    },
    {
      id: "default-ground",
      kind: "static",
      shape: {
        kind: "box",
        widthMeters: 30,
        heightMeters: 0.5,
      },
      material: {
        restitution: 0,
      },
      pose: {
        positionMeters: {
          x: 5,
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
        widthMeters: 3,
        heightMeters: 0.25,
      },
      material: {
        restitution: 0,
      },
      pose: {
        positionMeters: {
          x: 3,
          y: 1,
        },
        angleRadians: Math.PI / 6,
      },
    },
  ],
  triggers: [
    {
      id: "target",
      kind: "target",
      shape: {
        kind: "circle",
        radiusMeters: 0.25,
      },
      pose: {
        positionMeters: {
          x: 10,
          y: INITIAL_HEIGHT_METERS,
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
// Supply every whole tick for the reviewed one-second playback sample.
export const PROJECTILE_PLAYBACK_SNAPSHOTS: readonly Snapshot[] = Array.from(
  { length: OBSERVATION_TICK + 1 },
  (_, tick) => createFlightSnapshot(tick),
);
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
// before passing

const passThroughScene = {
  schemaVersion: 1,
  id: "target-pass-through",
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
    gravityMetersPerSecondSquared: { x: 0, y: 0 },
    linearDragKilogramsPerSecond: 0,
  },
  bodies: [
    {
      id: "projectile",
      kind: "dynamic",
      shape: {
        kind: "circle",
        radiusMeters: 0.1,
      },
      massKilograms: 1,
      material: {
        restitution: 0,
      },
      pose: {
        positionMeters: {
          x: 0,
          y: 0,
        },
        angleRadians: 0,
      },
      velocity: {
        linearMetersPerSecond: { x: 6, y: 0 },
        angularRadiansPerSecond: 0,
      },
    },
  ],
  triggers: [
    {
      id: "target",
      kind: "target",
      shape: {
        kind: "circle",
        radiusMeters: 0.85,
      },
      pose: {
        positionMeters: {
          x: 6,
          y: 0,
        },
        angleRadians: 0,
      },
    },
  ],
} as const satisfies SceneDefinition;
const passThroughBeforeSnapshot: Snapshot = {
  contractVersion: 1,
  engineVersion: "mock",
  engineBuild: "handwritten-target-pass-through",
  tick: 40,
  simulationTimeSeconds: 40 / 60,
  bodies: [
    {
      id: "projectile",
      pose: {
        positionMeters: { x: 4, y: 0 },
        angleRadians: 0,
      },
      velocity: {
        linearMetersPerSecond: { x: 6, y: 0 },
        angularRadiansPerSecond: 0,
      },
    },
  ],
  projectileReadouts: [
    {
      bodyId: "projectile",
      flightTimeSeconds: 40 / 60,
      horizontalDisplacementMeters: 4,
      heightMeters: 0,
    },
  ],
  events: [],
  diagnostics: [],
};

const passThroughEnteredSnapshot: Snapshot = {
  contractVersion: 1,
  engineVersion: "mock",
  engineBuild: "handwritten-target-pass-through",
  tick: 51,
  simulationTimeSeconds: 51 / 60,
  bodies: [
    {
      id: "projectile",
      pose: {
        positionMeters: { x: 5.1, y: 0 },
        angleRadians: 0,
      },
      velocity: {
        linearMetersPerSecond: { x: 6, y: 0 },
        angularRadiansPerSecond: 0,
      },
    },
  ],
  projectileReadouts: [
    {
      bodyId: "projectile",
      flightTimeSeconds: 51 / 60,
      horizontalDisplacementMeters: 5.1,
      heightMeters: 0,
    },
  ],
  events: [
    {
      id: "target-pass-through-entry",
      kind: "targetEntered",
      tick: 51,
      timeSeconds: 5.05 / 6,
      bodyId: "projectile",
      targetId: "target",
    },
  ],
  diagnostics: [],
};

const passThroughAfterSnapshot: Snapshot = {
  contractVersion: 1,
  engineVersion: "mock",
  engineBuild: "handwritten-target-pass-through",
  tick: 80,
  simulationTimeSeconds: 80 / 60,
  bodies: [
    {
      id: "projectile",
      pose: {
        positionMeters: { x: 8, y: 0 },
        angleRadians: 0,
      },
      velocity: {
        linearMetersPerSecond: { x: 6, y: 0 },
        angularRadiansPerSecond: 0,
      },
    },
  ],
  projectileReadouts: [
    {
      bodyId: "projectile",
      flightTimeSeconds: 80 / 60,
      horizontalDisplacementMeters: 8,
      heightMeters: 0,
    },
  ],
  events: [],
  diagnostics: [],
};
export const TARGET_PASS_THROUGH_MOCKS = {
  before: {
    scene: passThroughScene,
    snapshot: passThroughBeforeSnapshot,
    invalidInputDiagnostic,
  },
  entered: {
    scene: passThroughScene,
    snapshot: passThroughEnteredSnapshot,
    invalidInputDiagnostic,
  },
  after: {
    scene: passThroughScene,
    snapshot: passThroughAfterSnapshot,
    invalidInputDiagnostic,
  },
} as const satisfies Record<"before" | "entered" | "after", LabMock>;

// Present consecutive reviewed snapshots through the controller's existing engine boundary.
export function createSnapshotPlaybackEngine(snapshots: readonly Snapshot[]): EngineResult<Engine> {
  const frames = structuredClone([...snapshots]);
  const candidate = frames[0];

  if (candidate === undefined || frames.some((frame, index) => frame.tick !== index)) {
    return {
      ok: false,
      diagnostics: [{
        code: "OUT_OF_RANGE",
        path: "snapshots",
        message: "Playback frames must begin at tick zero and contain every whole tick.",
      }],
    };
  }

  const initialFrame: Snapshot = candidate;
  let currentFrame: Snapshot = initialFrame;
  let disposed = false;

  // Reject operations after this source releases its prepared frames.
  function activeStatus(): EngineStatus {
    return disposed
      ? {
          ok: false,
          diagnostics: [{
            code: "DISPOSED_ENGINE",
            path: "playback",
            message: "This snapshot playback source has been disposed.",
          }],
        }
      : { ok: true };
  }

  // Return the current borrowed frame without changing the playback cursor.
  function getSnapshot(): EngineResult<Snapshot> {
    const status = activeStatus();

    if (!status.ok) {
      return status;
    }

    return { ok: true, value: currentFrame };
  }

  const engine: Engine = {
    // Prepared frames cannot execute physical commands.
    enqueue() {
      const status = activeStatus();

      if (!status.ok) {
        return status;
      }

      return {
        ok: false,
        diagnostics: [{
          code: "UNSUPPORTED_COMMAND",
          path: "command",
          message: "Reviewed snapshot playback does not execute physical commands.",
        }],
      };
    },

    // Move only by a nonnegative integer number of prepared ticks.
    advance(tickCount) {
      const status = activeStatus();

      if (!status.ok) {
        return status;
      }

      if (!Number.isSafeInteger(tickCount) || tickCount < 0) {
        return {
          ok: false,
          diagnostics: [{
            code: "INVALID_ADVANCE_COUNT",
            path: "tickCount",
            message: "Playback requires a nonnegative whole-tick count.",
          }],
        };
      }

      const nextFrame = frames[currentFrame.tick + tickCount];

      if (nextFrame === undefined) {
        return {
          ok: false,
          diagnostics: [{
            code: "OUT_OF_RANGE",
            path: "tickCount",
            message: "The requested tick is outside this reviewed sample.",
          }],
        };
      }

      currentFrame = nextFrame;
      return { ok: true, value: { lastValidTick: currentFrame.tick } };
    },

    getSnapshot,

    // Give retained consumers a copy independent of the borrowed frame.
    copySnapshot() {
      const result = getSnapshot();
      return result.ok ? { ok: true, value: structuredClone(result.value) } : result;
    },

    // Restore the sample's original frame without replacing its controller or view.
    reset() {
      const status = activeStatus();

      if (!status.ok) {
        return status;
      }

      currentFrame = initialFrame;
      return { ok: true };
    },

    // Release the frame list and allow repeated cleanup.
    dispose() {
      disposed = true;
      frames.length = 0;
      return { ok: true };
    },
  };

  return { ok: true, value: engine };
}
