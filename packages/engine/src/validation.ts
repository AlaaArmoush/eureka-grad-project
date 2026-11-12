import type {
  Command,
  Material,
  SceneDefinition,
  Vector2
} from "@eureka/contracts";

import {
  failure,
  type EngineFailure,
  type EngineResult
} from "./diagnostics.js";

// Contact geometry owns cross-body circle/static-box overlap checks.
import { findInitialSurfaceOverlap } from "./contacts.js";

function checkId(value: string, path: string): EngineFailure | undefined {
  if (value.trim().length === 0) {
    return failure("EMPTY_ID", path, "ID must not be empty.");
  }

  return undefined;
}

function checkFinite(value: number, path: string): EngineFailure | undefined {
  if (!Number.isFinite(value)) {
    return failure("NONFINITE_NUMBER", path, "Value must be finite.");
  }

  return undefined;
}

function checkPositive(value: number, path: string): EngineFailure | undefined {
  return checkFinite(value, path) ??
    (value <= 0
      ? failure("OUT_OF_RANGE", path, "Value must be greater than zero.")
      : undefined);
}

function checkNonnegative(
  value: number,
  path: string
): EngineFailure | undefined {
  return checkFinite(value, path) ??
    (value < 0
      ? failure("OUT_OF_RANGE", path, "Value must be nonnegative.")
      : undefined);
}

function checkSafeInteger(
  value: number,
  path: string,
  minimum?: number
): EngineFailure | undefined {
  if (
    !Number.isSafeInteger(value) ||
    (minimum !== undefined && value < minimum)
  ) {
    const requirement = minimum === undefined
      ? "Value must be a safe integer."
      : `Value must be a safe integer greater than or equal to ${minimum}.`;

    return failure(
      "INVALID_INTEGER",
      path,
      requirement
    );
  }

  return undefined;
}

function validateVector(value: Vector2, path: string): EngineFailure | undefined {
  return checkFinite(value.x, `${path}.x`) ??
    checkFinite(value.y, `${path}.y`);
}

function validateMaterial(
  material: Material,
  path: string
): EngineFailure | undefined {
  const restitutionPath = `${path}.restitution`;

  return checkFinite(material.restitution, restitutionPath) ??
    (material.restitution < 0 || material.restitution > 1
      ? failure(
        "OUT_OF_RANGE",
        restitutionPath,
        "Restitution must be between zero and one."
      )
      : undefined);
}

export function validateScene(
  scene: SceneDefinition
): EngineResult<SceneDefinition> {
  const sceneFailure =
    checkId(scene.id, "id") ??
    checkSafeInteger(scene.revision, "revision", 0) ??
    checkSafeInteger(scene.seed, "seed") ??
    checkPositive(
      scene.numericalProfile.fixedTimeStepSeconds,
      "numericalProfile.fixedTimeStepSeconds"
    ) ??
    checkSafeInteger(scene.numericalProfile.substeps, "numericalProfile.substeps", 1) ??
    checkPositive(
      scene.numericalProfile.scales.lengthMeters,
      "numericalProfile.scales.lengthMeters"
    ) ??
    checkPositive(
      scene.numericalProfile.scales.massKilograms,
      "numericalProfile.scales.massKilograms"
    ) ??
    checkPositive(
      scene.numericalProfile.scales.timeSeconds,
      "numericalProfile.scales.timeSeconds"
    ) ??
    validateVector(
      scene.environment.gravityMetersPerSecondSquared,
      "environment.gravityMetersPerSecondSquared"
    ) ??
    checkNonnegative(
      scene.environment.linearDragKilogramsPerSecond,
      "environment.linearDragKilogramsPerSecond"
    );

  if (sceneFailure !== undefined) {
    return sceneFailure;
  }

  const entityIds = new Set<string>();

  for (const [bodyIndex, body] of scene.bodies.entries()) {
    const bodyPath = `bodies[${bodyIndex}]`;
    const bodyFailure =
      checkId(body.id, `${bodyPath}.id`) ??
      validateMaterial(body.material, `${bodyPath}.material`) ??
      validateVector(body.pose.positionMeters, `${bodyPath}.pose.positionMeters`) ??
      checkFinite(body.pose.angleRadians, `${bodyPath}.pose.angleRadians`);

    if (bodyFailure !== undefined) {
      return bodyFailure;
    }

    if (entityIds.has(body.id)) {
      return failure(
        "DUPLICATE_ENTITY_ID",
        `${bodyPath}.id`,
        `Entity ID "${body.id}" is duplicated.`,
        body.id
      );
    }

    entityIds.add(body.id);

    const kindFailure = body.kind === "dynamic"
      ? checkPositive(body.shape.radiusMeters, `${bodyPath}.shape.radiusMeters`) ??
      checkPositive(body.massKilograms, `${bodyPath}.massKilograms`) ??
      validateVector(
        body.velocity.linearMetersPerSecond,
        `${bodyPath}.velocity.linearMetersPerSecond`
      ) ??
      checkFinite(
        body.velocity.angularRadiansPerSecond,
        `${bodyPath}.velocity.angularRadiansPerSecond`
      )
      : checkPositive(body.shape.widthMeters, `${bodyPath}.shape.widthMeters`) ??
      checkPositive(body.shape.heightMeters, `${bodyPath}.shape.heightMeters`);

    if (kindFailure !== undefined) {
      return kindFailure;
    }
  }

  for (const [triggerIndex, trigger] of scene.triggers.entries()) {
    const triggerPath = `triggers[${triggerIndex}]`;
    const triggerFailure =
      checkId(trigger.id, `${triggerPath}.id`) ??
      checkPositive(trigger.shape.radiusMeters, `${triggerPath}.shape.radiusMeters`) ??
      validateVector(
        trigger.pose.positionMeters,
        `${triggerPath}.pose.positionMeters`
      ) ??
      checkFinite(trigger.pose.angleRadians, `${triggerPath}.pose.angleRadians`);

    if (triggerFailure !== undefined) {
      return triggerFailure;
    }

    if (entityIds.has(trigger.id)) {
      return failure(
        "DUPLICATE_ENTITY_ID",
        `${triggerPath}.id`,
        `Entity ID "${trigger.id}" is duplicated.`,
        trigger.id
      );
    }

    entityIds.add(trigger.id);
  }

  // Reject strict penetration before any engine state is created.
  const initialOverlap = findInitialSurfaceOverlap(scene.bodies);

  if (initialOverlap !== undefined) {
    return failure(
      "INVALID_INITIAL_OVERLAP",
      `bodies[${initialOverlap.bodyIndex}].pose.positionMeters`,
      (
        `Body "${initialOverlap.bodyId}" initially overlaps ` +
        `static surface "${initialOverlap.surfaceBodyId}".`
      ),
      initialOverlap.bodyId
    );
  }

  return { ok: true, value: scene };
}

export function validateCommand(command: Command): EngineFailure | undefined {
  const commandFailure =
    checkId(command.id, "id") ??
    checkSafeInteger(command.targetTick, "targetTick", 0);

  if (commandFailure !== undefined) {
    return commandFailure;
  }

  const payload = command.payload;

  switch (payload.kind) {
    case "editBody": {
      const changes = payload.changes;

      if (changes.massKilograms !== undefined) {
        const massFailure = checkPositive(
          changes.massKilograms,
          "payload.changes.massKilograms"
        );

        if (massFailure !== undefined) {
          return massFailure;
        }
      }

      if (changes.material !== undefined) {
        const materialFailure = validateMaterial(
          changes.material,
          "payload.changes.material"
        );

        if (materialFailure !== undefined) {
          return materialFailure;
        }
      }

      if (changes.pose !== undefined) {
        const poseFailure = validateVector(
          changes.pose.positionMeters,
          "payload.changes.pose.positionMeters"
        ) ?? checkFinite(
          changes.pose.angleRadians,
          "payload.changes.pose.angleRadians"
        );

        if (poseFailure !== undefined) {
          return poseFailure;
        }
      }

      if (changes.velocity !== undefined) {
        const velocityFailure = validateVector(
          changes.velocity.linearMetersPerSecond,
          "payload.changes.velocity.linearMetersPerSecond"
        ) ?? checkFinite(
          changes.velocity.angularRadiansPerSecond,
          "payload.changes.velocity.angularRadiansPerSecond"
        );

        if (velocityFailure !== undefined) {
          return velocityFailure;
        }
      }

      return undefined;
    }

    case "launchBody":
      return validateVector(payload.positionMeters, "payload.positionMeters") ??
        validateVector(
          payload.velocity.linearMetersPerSecond,
          "payload.velocity.linearMetersPerSecond"
        ) ??
        checkFinite(
          payload.velocity.angularRadiansPerSecond,
          "payload.velocity.angularRadiansPerSecond"
        );

    case "setForceInteraction":
      return checkId(payload.interactionId, "payload.interactionId") ??
        validateVector(payload.localAnchorMeters, "payload.localAnchorMeters") ??
        validateVector(
          payload.targetPositionMeters,
          "payload.targetPositionMeters"
        ) ??
        checkNonnegative(
          payload.stiffnessNewtonsPerMeter,
          "payload.stiffnessNewtonsPerMeter"
        ) ??
        checkNonnegative(
          payload.dampingKilogramsPerSecond,
          "payload.dampingKilogramsPerSecond"
        );

    case "endForceInteraction":
      return checkId(payload.interactionId, "payload.interactionId");
  }
}
