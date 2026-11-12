// Reuse the portable vector shape without depending on engine lifecycle state.
import type { Vector2 } from "@eureka/contracts";

interface SmoothMotionStepInput {
  readonly positionMeters: Vector2;
  readonly velocityMetersPerSecond: Vector2;
  readonly massKilograms: number;
  readonly gravityMetersPerSecondSquared: Vector2;
  readonly linearDragKilogramsPerSecond: number;
  readonly timeStepSeconds: number;
}

interface SmoothMotionStepResult {
  readonly positionMeters: Vector2;
  readonly velocityMetersPerSecond: Vector2;
}

// Update position and velocity for one physics step
export function integrateSmoothMotion(
  input: SmoothMotionStepInput
): SmoothMotionStepResult {
  const halfTimeStepSeconds = 0.5 * input.timeStepSeconds;
  const hasLinearDrag = input.linearDragKilogramsPerSecond > 0;

  // Start with unchanged velocity for the clean zero-drag path.
  let dragMultiplierForHalfStep = 1;
  let velocityAfterFirstDragX = input.velocityMetersPerSecond.x;
  let velocityAfterFirstDragY = input.velocityMetersPerSecond.y;

  if (hasLinearDrag) {
    const dragRatePerSecond = input.linearDragKilogramsPerSecond / input.massKilograms;

    dragMultiplierForHalfStep = Math.exp(-dragRatePerSecond * halfTimeStepSeconds);

    // Apply the first exact drag flow over half the substep.
    velocityAfterFirstDragX *= dragMultiplierForHalfStep;
    velocityAfterFirstDragY *= dragMultiplierForHalfStep;
  }

  // Advance velocity through the first gravity half-kick.
  const midpointVelocityX = velocityAfterFirstDragX + input.gravityMetersPerSecondSquared.x * halfTimeStepSeconds;
  const midpointVelocityY = velocityAfterFirstDragY + input.gravityMetersPerSecondSquared.y * halfTimeStepSeconds;

  // Drift position through the complete substep.
  const nextPositionX = input.positionMeters.x + midpointVelocityX * input.timeStepSeconds;
  const nextPositionY = input.positionMeters.y + midpointVelocityY * input.timeStepSeconds;

  // Complete the gravity update with the second half-kick.
  const velocityAfterGravityX = midpointVelocityX + input.gravityMetersPerSecondSquared.x * halfTimeStepSeconds;
  const velocityAfterGravityY = midpointVelocityY + input.gravityMetersPerSecondSquared.y * halfTimeStepSeconds;

  // Start with the gravity result for the clean zero-drag path.
  let nextVelocityX = velocityAfterGravityX;
  let nextVelocityY = velocityAfterGravityY;

  if (hasLinearDrag) {
    // Finish with the matching exact drag flow over the second half step.
    nextVelocityX *= dragMultiplierForHalfStep;
    nextVelocityY *= dragMultiplierForHalfStep;
  }

  return {
    positionMeters: {
      x: nextPositionX,
      y: nextPositionY
    },
    velocityMetersPerSecond: {
      x: nextVelocityX,
      y: nextVelocityY
    }
  };
}
