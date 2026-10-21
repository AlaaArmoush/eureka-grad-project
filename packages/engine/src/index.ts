export interface Vector2 {
  readonly x: number;
  readonly y: number;
}

export interface ParticleDefinition {
  readonly id: string;
  readonly positionMeters: Vector2;
  readonly velocityMetersPerSecond: Vector2;
}

export interface ConstantAccelerationScene {
  readonly id: string;
  readonly constantAccelerationMetersPerSecondSquared: Vector2;
  readonly bodies: readonly ParticleDefinition[];
}

export interface NumericalProfile {
  readonly fixedTimeStepSeconds: number;
}

export interface ParticleSnapshot {
  readonly id: string;
  readonly positionMeters: Vector2;
  readonly velocityMetersPerSecond: Vector2;
}

export interface EngineSnapshot {
  readonly tick: number;
  readonly timeSeconds: number;
  readonly bodies: readonly ParticleSnapshot[];
}

export type AdvanceResult =
  | {
    readonly ok: true;
    readonly lastValidTick: number;
  }
  | {
    readonly ok: false;
    readonly lastValidTick: number;
    readonly error: string;
  };

export interface Engine {
  advance(tickCount: number): AdvanceResult;
  getSnapshot(): EngineSnapshot;
}

interface MutableParticleState {
  readonly id: string;
  positionX: number;
  positionY: number;
  velocityX: number;
  velocityY: number;
}

function requireFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${name} must be finite.`);
  }
}

function requireNonEmptyId(value: string, name: string): void {
  if (value.length === 0) {
    throw new TypeError(`${name} must not be empty.`);
  }
}

export function createEngine(
  scene: ConstantAccelerationScene,
  numericalProfile: NumericalProfile,
  seed: number
): Engine {
  requireNonEmptyId(scene.id, "scene.id");

  if (!Number.isSafeInteger(seed)) {
    throw new RangeError("seed must be a safe integer.");
  }

  const fixedTimeStepSeconds = numericalProfile.fixedTimeStepSeconds;
  requireFinite(fixedTimeStepSeconds, "fixedTimeStepSeconds");

  if (fixedTimeStepSeconds <= 0) {
    throw new RangeError("fixedTimeStepSeconds must be greater than zero.");
  }

  if (scene.bodies.length !== 1) {
    throw new RangeError("The S00 engine requires exactly one particle.");
  }

  const particleDefinition = scene.bodies[0];

  if (particleDefinition === undefined) {
    throw new RangeError("The S00 engine requires exactly one particle.");
  }

  requireNonEmptyId(particleDefinition.id, "body.id");
  requireFinite(
    scene.constantAccelerationMetersPerSecondSquared.x,
    "constantAccelerationMetersPerSecondSquared.x"
  );
  requireFinite(
    scene.constantAccelerationMetersPerSecondSquared.y,
    "constantAccelerationMetersPerSecondSquared.y"
  );
  requireFinite(
    particleDefinition.positionMeters.x,
    "body.positionMeters.x"
  );
  requireFinite(
    particleDefinition.positionMeters.y,
    "body.positionMeters.y"
  );
  requireFinite(
    particleDefinition.velocityMetersPerSecond.x,
    "body.velocityMetersPerSecond.x"
  );
  requireFinite(
    particleDefinition.velocityMetersPerSecond.y,
    "body.velocityMetersPerSecond.y"
  );

  const halfTimeStepSquared =
    0.5 * fixedTimeStepSeconds * fixedTimeStepSeconds;

  requireFinite(halfTimeStepSquared, "derived half timestep squared");

  const accelerationX =
    scene.constantAccelerationMetersPerSecondSquared.x;
  const accelerationY =
    scene.constantAccelerationMetersPerSecondSquared.y;

  const particle: MutableParticleState = {
    id: particleDefinition.id,
    positionX: particleDefinition.positionMeters.x,
    positionY: particleDefinition.positionMeters.y,
    velocityX: particleDefinition.velocityMetersPerSecond.x,
    velocityY: particleDefinition.velocityMetersPerSecond.y
  };

  let tick = 0;

  function advance(tickCount: number): AdvanceResult {
    if (!Number.isSafeInteger(tickCount) || tickCount < 0) {
      return {
        ok: false,
        lastValidTick: tick,
        error: "tickCount must be a nonnegative safe integer."
      };
    }

    for (let index = 0; index < tickCount; index += 1) {
      const nextPositionX =
        particle.positionX +
        particle.velocityX * fixedTimeStepSeconds +
        accelerationX * halfTimeStepSquared;
      const nextPositionY =
        particle.positionY +
        particle.velocityY * fixedTimeStepSeconds +
        accelerationY * halfTimeStepSquared;
      const nextVelocityX =
        particle.velocityX + accelerationX * fixedTimeStepSeconds;
      const nextVelocityY =
        particle.velocityY + accelerationY * fixedTimeStepSeconds;
      const nextTimeSeconds = (tick + 1) * fixedTimeStepSeconds;

      if (
        !Number.isFinite(nextPositionX) ||
        !Number.isFinite(nextPositionY) ||
        !Number.isFinite(nextVelocityX) ||
        !Number.isFinite(nextVelocityY) ||
        !Number.isFinite(nextTimeSeconds)
      ) {
        return {
          ok: false,
          lastValidTick: tick,
          error: `Advancing tick ${tick + 1} produced a nonfinite value.`
        };
      }

      particle.positionX = nextPositionX;
      particle.positionY = nextPositionY;
      particle.velocityX = nextVelocityX;
      particle.velocityY = nextVelocityY;
      tick += 1;
    }

    return {
      ok: true,
      lastValidTick: tick
    };
  }

  function getSnapshot(): EngineSnapshot {
    return {
      tick,
      timeSeconds: tick * fixedTimeStepSeconds,
      bodies: [
        {
          id: particle.id,
          positionMeters: {
            x: particle.positionX,
            y: particle.positionY
          },
          velocityMetersPerSecond: {
            x: particle.velocityX,
            y: particle.velocityY
          }
        }
      ]
    };
  }

  return {
    advance,
    getSnapshot
  };
}
