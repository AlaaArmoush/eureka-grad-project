// Reuse the portable vector shape without depending on engine lifecycle state.
import type { SetForceInteractionCommand, Vector2 } from "@eureka/contracts";

// The engine resolves the optional public limit before a force reaches the solver.
export interface ForceInteraction extends SetForceInteractionCommand {
  readonly maximumForceNewtons: number;
}

interface SmoothMotionStepInput {
  readonly positionMeters: Vector2;
  readonly velocityMetersPerSecond: Vector2;
  readonly massKilograms: number;
  readonly gravityMetersPerSecondSquared: Vector2;
  readonly linearDragKilogramsPerSecond: number;
  readonly timeStepSeconds: number;
  readonly angleRadians: number;
  readonly interactions: readonly ForceInteraction[];
}

interface SmoothMotionStepResult {
  readonly positionMeters: Vector2;
  readonly velocityMetersPerSecond: Vector2;
  readonly interactionForceNewtons: Vector2;
}

// Topic 1 treats the circle as a translating projectile. Rotate its grab offset
// into world coordinates; torque and angular dynamics belong to Topic 3.
function interactionForce(input: SmoothMotionStepInput, position: Vector2, velocity: Vector2): Vector2 {
  let totalX = 0;
  let totalY = 0;
  const cosine = Math.cos(input.angleRadians);
  const sine = Math.sin(input.angleRadians);

  for (const interaction of input.interactions) {
    const anchor = interaction.localAnchorMeters;
    const anchorX = position.x + cosine * anchor.x - sine * anchor.y;
    const anchorY = position.y + sine * anchor.x + cosine * anchor.y;
    let forceX = interaction.stiffnessNewtonsPerMeter * (interaction.targetPositionMeters.x - anchorX) -
      interaction.dampingKilogramsPerSecond * velocity.x;
    let forceY = interaction.stiffnessNewtonsPerMeter * (interaction.targetPositionMeters.y - anchorY) -
      interaction.dampingKilogramsPerSecond * velocity.y;

    // Overflow is a failed physical step, never a reason to hide a bad raw force.
    if (!Number.isFinite(forceX) || !Number.isFinite(forceY)) {
      return { x: Number.NaN, y: Number.NaN };
    }

    // Normalize before measuring length so large finite components cannot overflow.
    const largestComponent = Math.max(Math.abs(forceX), Math.abs(forceY));

    if (largestComponent > 0) {
      const scaledX = forceX / largestComponent;
      const scaledY = forceY / largestComponent;
      const scaledLength = Math.hypot(scaledX, scaledY);

      if (largestComponent > interaction.maximumForceNewtons / scaledLength) {
        forceX = scaledX / scaledLength * interaction.maximumForceNewtons;
        forceY = scaledY / scaledLength * interaction.maximumForceNewtons;
      }
    }

    totalX += forceX;
    totalY += forceY;
  }

  return { x: totalX, y: totalY };
}

// Update position and velocity for one physics step
export function integrateSmoothMotion(input: SmoothMotionStepInput): SmoothMotionStepResult {
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

  const firstForce = interactionForce(input, input.positionMeters, {
    x: velocityAfterFirstDragX, y: velocityAfterFirstDragY
  });
  const accelerationX = input.gravityMetersPerSecondSquared.x + firstForce.x / input.massKilograms;
  const accelerationY = input.gravityMetersPerSecondSquared.y + firstForce.y / input.massKilograms;

  // Advance velocity through the first gravity/interaction half-kick.
  const midpointVelocityX = velocityAfterFirstDragX + accelerationX * halfTimeStepSeconds;
  const midpointVelocityY = velocityAfterFirstDragY + accelerationY * halfTimeStepSeconds;

  // Drift position through the complete substep.
  const nextPositionX = input.positionMeters.x + midpointVelocityX * input.timeStepSeconds;
  const nextPositionY = input.positionMeters.y + midpointVelocityY * input.timeStepSeconds;

  // Predict endpoint velocity for the interaction's damping term. Together with
  // the two half-kicks this is second order, including velocity-dependent forces.
  const lastForce = interactionForce(input, { x: nextPositionX, y: nextPositionY }, {
    x: velocityAfterFirstDragX + accelerationX * input.timeStepSeconds,
    y: velocityAfterFirstDragY + accelerationY * input.timeStepSeconds
  });
  const finalAccelerationX = input.gravityMetersPerSecondSquared.x + lastForce.x / input.massKilograms;
  const finalAccelerationY = input.gravityMetersPerSecondSquared.y + lastForce.y / input.massKilograms;
  const velocityAfterGravityX = midpointVelocityX + finalAccelerationX * halfTimeStepSeconds;
  const velocityAfterGravityY = midpointVelocityY + finalAccelerationY * halfTimeStepSeconds;

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
    },
    interactionForceNewtons: {
      x: 0.5 * firstForce.x + 0.5 * lastForce.x,
      y: 0.5 * firstForce.y + 0.5 * lastForce.y
    }
  };
}
