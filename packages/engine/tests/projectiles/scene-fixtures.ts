import type { Body, SceneDefinition } from "@eureka/contracts";

export const GRAVITY = 9.81;
export const TIME_STEP = 1 / 60;

export function makeScene(
  speed: number,
  angleDegrees: number,
  height = 0,
  withGround = false,
  options: {
    readonly massKilograms?: number;
    readonly linearDragKilogramsPerSecond?: number;
    readonly fixedTimeStepSeconds?: number;
  } = {}
): SceneDefinition {
  // JavaScript's trigonometric functions require radians.
  const angleRadians = angleDegrees * Math.PI / 180;

  const bodies: Body[] = [
    {
      id: "projectile",
      kind: "dynamic",
      shape: { kind: "circle", radiusMeters: 0.1 },
      massKilograms: options.massKilograms ?? 1,
      material: { restitution: 0 },
      pose: {
        positionMeters: { x: 0, y: height },
        angleRadians: 0
      },
      velocity: {
        linearMetersPerSecond: {
          x: speed * Math.cos(angleRadians),
          y: speed * Math.sin(angleRadians)
        },
        angularRadiansPerSecond: 0
      }
    }
  ];

  // Add a ground body only for tests that need a landing surface.
  // Its top is -0.1 m, so the ball touches it at centre height zero.
  if (withGround) {
    bodies.push({
      id: "ground",
      kind: "static",
      shape: {
        kind: "box",
        widthMeters: 400,
        heightMeters: 0.5
      },
      material: { restitution: 0 },
      pose: {
        positionMeters: { x: 0, y: -0.35 },
        angleRadians: 0
      }
    });
  }

  return {
    schemaVersion: 1,
    id: "ideal-projectile",
    revision: 1,
    seed: 17,
    numericalProfile: {
      fixedTimeStepSeconds: options.fixedTimeStepSeconds ?? TIME_STEP,
      substeps: 1,
      scales: {
        lengthMeters: 1,
        massKilograms: 1,
        timeSeconds: 1
      }
    },
    environment: {
      gravityMetersPerSecondSquared: { x: 0, y: -GRAVITY },
      linearDragKilogramsPerSecond: options.linearDragKilogramsPerSecond ?? 0
    },
    bodies,
    triggers: []
  };
}
