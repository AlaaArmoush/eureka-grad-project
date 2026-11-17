// Type the independently authored scene and observation examples.
import type {
  ContactObservation,
  SceneDefinition,
  Snapshot,
} from "@eureka/contracts";

// Select only the snapshot fields demonstrated by these reference records.
type CollisionSnapshotFields = Pick<
  Snapshot,
  | "contacts"
  | "weldClusters"
  | "welds"
  | "collisionEnergyLosses"
  | "sinusoidalForceWorkJoules"
>;

// Return fresh input data for the required sliding-box accuracy fixture.
export function makeSlidingBoxScene(withForce = true): SceneDefinition {
  return {
    schemaVersion: 1,
    id: "sliding-box",
    revision: 1,
    seed: 17,
    numericalProfile: {
      fixedTimeStepSeconds: 1 / 60,
      substeps: 1,
      restitutionSpeedThresholdMetersPerSecond: 0.01,
      scales: {
        lengthMeters: 1,
        massKilograms: 1,
        timeSeconds: 1,
      },
    },
    environment: {
      gravityMetersPerSecondSquared: { x: 0, y: -9.81 },
      linearDragKilogramsPerSecond: 0,
    },
    bodies: [
      {
        id: "sliding-block",
        kind: "dynamic",
        shape: {
          kind: "box",
          widthMeters: 1,
          heightMeters: 1,
        },
        massKilograms: 1,
        momentOfInertiaKilogramMetersSquared: 1 / 6,
        material: {
          restitution: 0,
          staticFrictionCoefficient: 0.3,
          kineticFrictionCoefficient: 0.2,
        },
        pose: {
          positionMeters: { x: 0, y: 0.5 },
          angleRadians: 0,
        },
        velocity: {
          linearMetersPerSecond: { x: 4, y: 0 },
          angularRadiansPerSecond: 0,
        },
      },
      {
        id: "floor",
        kind: "static",
        shape: {
          kind: "box",
          widthMeters: 20,
          heightMeters: 1,
        },
        material: {
          restitution: 0,
          staticFrictionCoefficient: 0.3,
          kineticFrictionCoefficient: 0.2,
        },
        pose: {
          positionMeters: { x: 0, y: -0.5 },
          angleRadians: 0,
        },
      },
    ],
    sinusoidalForces: withForce
      ? [
          {
            forceVersion: 1,
            id: "sliding-drive",
            bodyId: "sliding-block",
            amplitudeNewtons: { x: 1, y: 0 },
            angularFrequencyRadiansPerSecond: 2,
            startTimeSeconds: 0,
            endTimeSeconds: 1,
          },
        ]
      : [],
    triggers: [],
  };
}
// Independent elastic reference for the existing two-circle head-on scene.
export const elasticContactReference: ContactObservation = {
  id: "elastic-head-on-contact",
  tick: 30,
  timeSeconds: 0.5,
  bodyAId: "receiver",
  bodyBId: "striker",
  pointMeters: { x: 2.5, y: 0 },
  normal: { x: -1, y: 0 },
  normalImpulseNewtonSeconds: 16 / 3,
  tangentImpulseNewtonSeconds: 0,
  bodyAVelocityBefore: {
    linearMetersPerSecond: { x: 0, y: 0 },
    angularRadiansPerSecond: 0,
  },
  bodyBVelocityBefore: {
    linearMetersPerSecond: { x: 4, y: 0 },
    angularRadiansPerSecond: 0,
  },
  bodyAVelocityAfter: {
    linearMetersPerSecond: { x: 16 / 3, y: 0 },
    angularRadiansPerSecond: 0,
  },
  bodyBVelocityAfter: {
    linearMetersPerSecond: { x: 4 / 3, y: 0 },
    angularRadiansPerSecond: 0,
  },
};
// Independent sticky reference; both bodies leave with one common velocity.
export const stickyContactReference: ContactObservation = {
  id: "sticky-head-on-contact",
  tick: 30,
  timeSeconds: 0.5,
  bodyAId: "receiver",
  bodyBId: "striker",
  pointMeters: { x: 2.5, y: 0 },
  normal: { x: -1, y: 0 },
  normalImpulseNewtonSeconds: 8 / 3,
  tangentImpulseNewtonSeconds: 0,
  bodyAVelocityBefore: {
    linearMetersPerSecond: { x: 0, y: 0 },
    angularRadiansPerSecond: 0,
  },
  bodyBVelocityBefore: {
    linearMetersPerSecond: { x: 4, y: 0 },
    angularRadiansPerSecond: 0,
  },
  bodyAVelocityAfter: {
    linearMetersPerSecond: { x: 8 / 3, y: 0 },
    angularRadiansPerSecond: 0,
  },
  bodyBVelocityAfter: {
    linearMetersPerSecond: { x: 8 / 3, y: 0 },
    angularRadiansPerSecond: 0,
  },
};
// Elastic contact has no joining event and no physical collision loss.
export const elasticSnapshotFields: CollisionSnapshotFields = {
  contacts: [elasticContactReference],
  weldClusters: [],
  welds: [],
  collisionEnergyLosses: {
    restitutionLossJoules: 0,
    frictionLossJoules: 0,
    weldLossJoules: 0,
  },
  sinusoidalForceWorkJoules: 0,
};

// One sticky event creates persistent membership and contributes weld loss once.
export const stickySnapshotFields: CollisionSnapshotFields = {
  contacts: [stickyContactReference],
  weldClusters: [
    {
      id: "head-on-cluster",
      bodyIds: ["receiver", "striker"],
    },
  ],
  welds: [
    {
      id: "head-on-weld",
      tick: 30,
      timeSeconds: 0.5,
      bodyAId: "receiver",
      bodyBId: "striker",
      clusterId: "head-on-cluster",
      energyLossJoules: 16 / 3,
    },
  ],
  collisionEnergyLosses: {
    restitutionLossJoules: 0,
    frictionLossJoules: 0,
    weldLossJoules: 16 / 3,
  },
  sinusoidalForceWorkJoules: 0,
};
