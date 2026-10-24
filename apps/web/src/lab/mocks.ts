// Supplies portable scene, snapshot and diagnostic records.
import type {
  Diagnostic,
  SceneDefinition,
  Snapshot
} from "@eureka/contracts";

export interface LabMock {
  readonly scene: SceneDefinition;
  readonly snapshot: Snapshot;
  readonly invalidInputDiagnostic: Diagnostic;
}

const FIXED_TIME_STEP_SECONDS = 1 / 60;
const EVENT_TICK = 60;
const EVENT_TIME_SECONDS =
  EVENT_TICK * FIXED_TIME_STEP_SECONDS;

const INITIAL_VELOCITY_METERS_PER_SECOND = {
  x: 10,
  y: 5
} as const;

const GRAVITY_METERS_PER_SECOND_SQUARED = {
  x: 0,
  y: -10
} as const;

const EVENT_POSITION_METERS = {
  x:
    INITIAL_VELOCITY_METERS_PER_SECOND.x *
    EVENT_TIME_SECONDS,
  y:
    INITIAL_VELOCITY_METERS_PER_SECOND.y *
    EVENT_TIME_SECONDS +
    0.5 *
    GRAVITY_METERS_PER_SECOND_SQUARED.y *
    EVENT_TIME_SECONDS *
    EVENT_TIME_SECONDS
} as const;

const EVENT_VELOCITY_METERS_PER_SECOND = {
  x: INITIAL_VELOCITY_METERS_PER_SECOND.x,
  y:
    INITIAL_VELOCITY_METERS_PER_SECOND.y +
    GRAVITY_METERS_PER_SECOND_SQUARED.y *
    EVENT_TIME_SECONDS
} as const;

const scene = {
  schemaVersion: 1,
  id: "s02-handwritten-projectile",
  revision: 1,
  seed: 0,
  numericalProfile: {
    fixedTimeStepSeconds: FIXED_TIME_STEP_SECONDS,
    substeps: 1,
    scales: {
      lengthMeters: 1,
      massKilograms: 1,
      timeSeconds: 1
    }
  },
  environment: {
    gravityMetersPerSecondSquared:
      GRAVITY_METERS_PER_SECOND_SQUARED,
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
        positionMeters: {
          x: 0,
          y: 0
        },
        angleRadians: 0
      },
      velocity: {
        linearMetersPerSecond:
          INITIAL_VELOCITY_METERS_PER_SECOND,
        angularRadiansPerSecond: 0
      }
    },
    {
      id: "landing-platform",
      kind: "static",
      shape: {
        kind: "box",
        widthMeters: 2,
        heightMeters: 0.5
      },
      material: {
        restitution: 0
      },
      pose: {
        positionMeters: {
          x: 10,
          y: -0.35
        },
        angleRadians: 0
      }
    }
  ],
  triggers: [
    {
      id: "target",
      kind: "target",
      shape: {
        kind: "circle",
        radiusMeters: 0.25
      },
      pose: {
        positionMeters: {
          x: 10,
          y: 0
        },
        angleRadians: 0
      }
    }
  ]
} as const satisfies SceneDefinition;

const snapshot = {
  contractVersion: 1,
  engineVersion: "mock",
  engineBuild: "handwritten-s02",
  tick: EVENT_TICK,
  simulationTimeSeconds: EVENT_TIME_SECONDS,
  bodies: [
    {
      id: "projectile",
      pose: {
        positionMeters: EVENT_POSITION_METERS,
        angleRadians: 0
      },
      velocity: {
        linearMetersPerSecond:
          EVENT_VELOCITY_METERS_PER_SECOND,
        angularRadiansPerSecond: 0
      }
    },
    {
      id: "landing-platform",
      pose: {
        positionMeters: {
          x: 10,
          y: -0.35
        },
        angleRadians: 0
      },
      velocity: {
        linearMetersPerSecond: {
          x: 0,
          y: 0
        },
        angularRadiansPerSecond: 0
      }
    }
  ],
  projectileReadouts: [
    {
      bodyId: "projectile",
      flightTimeSeconds: EVENT_TIME_SECONDS,
      horizontalDisplacementMeters:
        EVENT_POSITION_METERS.x,
      heightMeters: EVENT_POSITION_METERS.y
    }
  ],
  events: [
    {
      id: "target-entry-60",
      kind: "targetEntered",
      tick: EVENT_TICK,
      timeSeconds: EVENT_TIME_SECONDS,
      bodyId: "projectile",
      targetId: "target"
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
        y: -0.1
      },
      normal: {
        x: 0,
        y: 1
      }
    }
  ],
  diagnostics: []
} as const satisfies Snapshot;

const invalidInputDiagnostic = {
  code: "NONFINITE_NUMBER",
  path: "bodies[0].massKilograms",
  message: "Mass must be finite.",
  entityId: "projectile"
} as const satisfies Diagnostic;

export const S02_LAB_MOCK = {
  scene,
  snapshot,
  invalidInputDiagnostic
} as const satisfies LabMock;
