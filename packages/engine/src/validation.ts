import type { Body, BoxShape, CircleShape, Command, Material, SceneDefinition, TargetTrigger, Vector2 } from "@eureka/contracts";
import { failure, type EngineFailure, type EngineResult } from "./diagnostics.js";

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

function checkNonnegative(value: number, path: string): EngineFailure | undefined {
  return checkFinite(value, path) ??
    (value < 0
      ? failure("OUT_OF_RANGE", path, "Value must be nonnegative.")
      : undefined);
}

function checkSafeInteger(value: number, path: string, minimum?: number): EngineFailure | undefined {
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

function validateMaterial(material: Material, path: string): EngineFailure | undefined {
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

function validateShape(shape: CircleShape | BoxShape, path: string): EngineFailure | undefined {
  return shape.kind === "circle"
    ? checkPositive(shape.radiusMeters, `${path}.radiusMeters`)
    : checkPositive(shape.widthMeters, `${path}.widthMeters`) ?? checkPositive(shape.heightMeters, `${path}.heightMeters`);
}

// Checks every body needs before its ID is compared with the others.
function validateBodyCommon(body: Body, path: string): EngineFailure | undefined {
  return checkId(body.id, `${path}.id`) ??
    validateMaterial(body.material, `${path}.material`) ??
    validateVector(body.pose.positionMeters, `${path}.pose.positionMeters`) ??
    checkFinite(body.pose.angleRadians, `${path}.pose.angleRadians`);
}

function validateBodyKind(body: Body, path: string): EngineFailure | undefined {
  if (body.kind === "static") {
    return validateShape(body.shape, `${path}.shape`);
  }

  return validateShape(body.shape, `${path}.shape`) ??
    checkPositive(body.massKilograms, `${path}.massKilograms`) ??
    validateVector(body.velocity.linearMetersPerSecond, `${path}.velocity.linearMetersPerSecond`) ??
    checkFinite(body.velocity.angularRadiansPerSecond, `${path}.velocity.angularRadiansPerSecond`);
}

function validateTarget(target: TargetTrigger, path: string): EngineFailure | undefined {
  return checkId(target.id, `${path}.id`) ??
    checkPositive(target.shape.radiusMeters, `${path}.shape.radiusMeters`) ??
    validateVector(target.pose.positionMeters, `${path}.pose.positionMeters`) ??
    checkFinite(target.pose.angleRadians, `${path}.pose.angleRadians`);
}

function validateEnvironment(environment: SceneDefinition["environment"], path: string): EngineFailure | undefined {
  return validateVector(environment.gravityMetersPerSecondSquared, `${path}.gravityMetersPerSecondSquared`) ??
    checkNonnegative(environment.linearDragKilogramsPerSecond, `${path}.linearDragKilogramsPerSecond`);
}

// Reject a proposed placement that starts a projectile inside a static body.
export function validateBodyPlacements(bodies: readonly Body[], changedIds?: ReadonlySet<string>): EngineFailure | undefined {
  const initialOverlap = findInitialSurfaceOverlap(bodies, changedIds);

  if (initialOverlap === undefined) {
    return undefined;
  }

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

export function validateScene(scene: SceneDefinition): EngineResult<SceneDefinition> {
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
    validateEnvironment(scene.environment, "environment");

  if (sceneFailure !== undefined) {
    return sceneFailure;
  }

  const entityIds = new Set<string>();

  for (const [bodyIndex, body] of scene.bodies.entries()) {
    const bodyPath = `bodies[${bodyIndex}]`;
    const bodyFailure = validateBodyCommon(body, bodyPath);

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

    const kindFailure = validateBodyKind(body, bodyPath);

    if (kindFailure !== undefined) {
      return kindFailure;
    }
  }

  for (const [triggerIndex, trigger] of scene.triggers.entries()) {
    const triggerPath = `triggers[${triggerIndex}]`;
    const triggerFailure = validateTarget(trigger, triggerPath);

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

  // Reject initial overlaps before accepting the scene.
  return validateBodyPlacements(scene.bodies) ?? { ok: true, value: scene };
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

      if (changes.shape !== undefined) {
        return validateShape(changes.shape, "payload.changes.shape");
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

    case "setForceInteraction": {
      const interactionFailure = checkId(payload.interactionId, "payload.interactionId") ??
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

      if (interactionFailure !== undefined) {
        return interactionFailure;
      }

      if (payload.maximumForceNewtons !== undefined) {
        return checkPositive(payload.maximumForceNewtons, "payload.maximumForceNewtons");
      }

      return undefined;
    }

    case "endForceInteraction":
      return checkId(payload.interactionId, "payload.interactionId");

    case "addEntity":
      return payload.entity.kind === "target"
        ? validateTarget(payload.entity, "payload.entity")
        : validateBodyCommon(payload.entity, "payload.entity") ?? validateBodyKind(payload.entity, "payload.entity");

    case "removeEntity":
      return checkId(payload.entityId, "payload.entityId");

    case "editTarget":
      return checkId(payload.targetId, "payload.targetId") ??
        (payload.changes.pose === undefined
          ? undefined
          : validateVector(payload.changes.pose.positionMeters, "payload.changes.pose.positionMeters") ??
            checkFinite(payload.changes.pose.angleRadians, "payload.changes.pose.angleRadians")) ??
        (payload.changes.shape === undefined ? undefined : validateShape(payload.changes.shape, "payload.changes.shape"));

    case "setEnvironment":
      return validateEnvironment(payload.environment, "payload.environment");
  }
}
