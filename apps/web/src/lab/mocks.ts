// This file contains mock data used to test the lab display.
// It supplies a sample scene and simulation results so we can check
// how they appear on screen without running the physics engine.

import type { Diagnostic, SceneDefinition, Snapshot } from "@eureka/contracts";

export interface LabMock {
  readonly scene: SceneDefinition;
  readonly snapshot: Snapshot;
  readonly invalidInputDiagnostic: Diagnostic;
}

const FIXED_TIME_STEP_SECONDS = 1 / 60;
const EVENT_TICK = 60;
const EVENT_TIME_SECONDS = EVENT_TICK * FIXED_TIME_STEP_SECONDS;

const INITIAL_VELOCITY_METERS_PER_SECOND = {
  x: 10,
  y: 5,
} as const;

const GRAVITY_METERS_PER_SECOND_SQUARED = {
  x: 0,
  y: -10,
} as const;

const EVENT_POSITION_METERS = {
  x: INITIAL_VELOCITY_METERS_PER_SECOND.x * EVENT_TIME_SECONDS,
  y:
    INITIAL_VELOCITY_METERS_PER_SECOND.y * EVENT_TIME_SECONDS +
    0.5 *
      GRAVITY_METERS_PER_SECOND_SQUARED.y *
      EVENT_TIME_SECONDS *
      EVENT_TIME_SECONDS,
} as const;

const EVENT_VELOCITY_METERS_PER_SECOND = {
  x: INITIAL_VELOCITY_METERS_PER_SECOND.x,
  y:
    INITIAL_VELOCITY_METERS_PER_SECOND.y +
    GRAVITY_METERS_PER_SECOND_SQUARED.y * EVENT_TIME_SECONDS,
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
          y: 0,
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
          y: -0.35,
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
          y: -2,
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
          y: -0.75,
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
          y: 0,
        },
        angleRadians: 0,
      },
    },
  ],
} as const satisfies SceneDefinition;

const snapshot = {
  contractVersion: 1,
  engineVersion: "mock",
  engineBuild: "handwritten-projectile-sample",
  tick: EVENT_TICK,
  simulationTimeSeconds: EVENT_TIME_SECONDS,
  bodies: [
    {
      id: "projectile",
      pose: {
        positionMeters: EVENT_POSITION_METERS,
        angleRadians: 0,
      },
      velocity: {
        linearMetersPerSecond: EVENT_VELOCITY_METERS_PER_SECOND,
        angularRadiansPerSecond: 0,
      },
    },
    {
      id: "landing-platform",
      pose: {
        positionMeters: {
          x: 10,
          y: -0.35,
        },
        angleRadians: 0,
      },
      velocity: {
        linearMetersPerSecond: {
          x: 0,
          y: 0,
        },
        angularRadiansPerSecond: 0,
      },
    },
    {
      id: "default-ground",
      pose: {
        positionMeters: {
          x: 5,
          y: -2,
        },
        angleRadians: 0,
      },
      velocity: {
        linearMetersPerSecond: {
          x: 0,
          y: 0,
        },
        angularRadiansPerSecond: 0,
      },
    },
    {
      id: "ramp",
      pose: {
        positionMeters: {
          x: 3,
          y: -0.75,
        },
        angleRadians: Math.PI / 6,
      },
      velocity: {
        linearMetersPerSecond: {
          x: 0,
          y: 0,
        },
        angularRadiansPerSecond: 0,
      },
    },
  ],
  projectileReadouts: [
    {
      bodyId: "projectile",
      flightTimeSeconds: EVENT_TIME_SECONDS,
      horizontalDisplacementMeters: EVENT_POSITION_METERS.x,
      heightMeters: EVENT_POSITION_METERS.y,
    },
  ],
  events: [
    {
      id: "target-entry-60",
      kind: "targetEntered",
      tick: EVENT_TICK,
      timeSeconds: EVENT_TIME_SECONDS,
      bodyId: "projectile",
      targetId: "target",
    },
    {
      id: "ground-contact-60",
      kind: "groundContact",
      tick: EVENT_TICK,
      timeSeconds: EVENT_TIME_SECONDS,
      bodyId: "projectile",
      surfaceBodyId: "landing-platform",
      pointMeters: {
        x: 10,
        y: -0.1,
      },
      normal: {
        x: 0,
        y: 1,
      },
    },
  ],
  diagnostics: [],
} as const satisfies Snapshot;

const invalidInputDiagnostic = {
  code: "NONFINITE_NUMBER",
  path: "bodies[0].massKilograms",
  message: "Mass must be finite.",
  entityId: "projectile",
} as const satisfies Diagnostic;

export const PROJECTILE_LAB_MOCK = {
  scene,
  snapshot,
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