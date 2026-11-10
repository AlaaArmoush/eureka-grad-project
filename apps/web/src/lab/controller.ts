// Supplies commands and portable renderer snapshots.
import type {
  Command,
  SceneDefinition,
  Snapshot,
  Vector2,
} from "@eureka/contracts";
// Supplies the headless engine boundary and typed results.
import {
  validateScene,
  type AdvanceReceipt,
  type CommandAcceptance,
  type Engine,
  type EngineResult,
  type EngineStatus,
} from "@eureka/engine";

// Supplies the pure scene changes
import {
  addPlatformToScene,
  addProjectileToScene,
  addRampToScene,
  addTargetToScene,
  type SceneDraftChange,
  type ProjectilePlacementProperties,
  type PlatformPlacementProperties,
  type RampPlacementProperties,
  type TargetPlacementProperties,
  updateProjectileInScene,
  updateStaticBodyInScene,
  updateTargetInScene,
} from "./authoring.js";

export interface LabController {
  enqueue(command: Command): EngineResult<CommandAcceptance>;

  stepOnce(): EngineResult<AdvanceReceipt>;

  copySnapshot(): EngineResult<Snapshot>;

  reset(): EngineStatus;

  dispose(): EngineStatus;

  copyScene(): SceneDefinition;

  placeRamp(
    positionMeters: Vector2,
    properties?: RampPlacementProperties,
  ): EngineResult<SceneDraftChange>;
  placeProjectile(
    positionMeters: Vector2,
    properties?: ProjectilePlacementProperties,
  ): EngineResult<SceneDraftChange>;
  placePlatform(
    positionMeters: Vector2,
    properties?: PlatformPlacementProperties,
  ): EngineResult<SceneDraftChange>;
  placeTarget(
    positionMeters: Vector2,
    properties?: TargetPlacementProperties,
  ): EngineResult<SceneDraftChange>;
  updateProjectileProperties(
    projectileId: string,
    properties: ProjectilePlacementProperties,
  ): EngineResult<SceneDraftChange>;
  updateStaticBodyProperties(
    bodyId: string,
    properties: RampPlacementProperties,
  ): EngineResult<SceneDraftChange>;

  updateTargetProperties(
    targetId: string,
    properties: TargetPlacementProperties,
  ): EngineResult<SceneDraftChange>;
}

export type SnapshotConsumer = (snapshot: Snapshot) => void;

export function createLabController(
  engine: Engine,
  initialScene: SceneDefinition,
  consumeSnapshot: SnapshotConsumer,
  releaseView: () => void,
): EngineResult<LabController> {
  const currentEngine = engine;
  let currentScene = structuredClone(initialScene);
  const initialSnapshot = currentEngine.getSnapshot();
  if (!initialSnapshot.ok) {
    return initialSnapshot;
  }

  consumeSnapshot(initialSnapshot.value);

  let disposed = false;

  function stepOnce(): EngineResult<AdvanceReceipt> {
    const advanceResult = currentEngine.advance(1);

    if (!advanceResult.ok) {
      return advanceResult;
    }

    const snapshotResult = currentEngine.getSnapshot();

    if (!snapshotResult.ok) {
      return snapshotResult;
    }

    consumeSnapshot(snapshotResult.value);
    return advanceResult;
  }

  function reset(): EngineStatus {
    const resetResult = currentEngine.reset();

    if (!resetResult.ok) {
      return resetResult;
    }

    const snapshotResult = currentEngine.getSnapshot();

    if (!snapshotResult.ok) {
      return snapshotResult;
    }

    consumeSnapshot(snapshotResult.value);
    return { ok: true };
  }

  function dispose(): EngineStatus {
    if (disposed) {
      return { ok: true };
    }

    disposed = true;
    releaseView();
    return currentEngine.dispose();
  }
  function placeRamp(
    positionMeters: Vector2,
    properties?: RampPlacementProperties,
  ): EngineResult<SceneDraftChange> {
    const sceneChange = addRampToScene(
      currentScene,
      positionMeters,
      properties,
    );

    const validationResult = validateScene(sceneChange.scene);

    if (!validationResult.ok) {
      return validationResult;
    }

    currentScene = structuredClone(sceneChange.scene);

    return {
      ok: true,
      value: structuredClone(sceneChange),
    };
  }
  function placeProjectile(
    positionMeters: Vector2,
    properties?: ProjectilePlacementProperties,
  ): EngineResult<SceneDraftChange> {
    const sceneChange = addProjectileToScene(
      currentScene,
      positionMeters,
      properties,
    );
    const validationResult = validateScene(sceneChange.scene);

    if (!validationResult.ok) {
      return validationResult;
    }

    currentScene = structuredClone(sceneChange.scene);

    return {
      ok: true,
      value: structuredClone(sceneChange),
    };
  }
  function placePlatform(
    positionMeters: Vector2,
    properties?: PlatformPlacementProperties,
  ): EngineResult<SceneDraftChange> {
    const sceneChange = addPlatformToScene(
      currentScene,
      positionMeters,
      properties,
    );

    const validationResult = validateScene(sceneChange.scene);

    if (!validationResult.ok) {
      return validationResult;
    }

    currentScene = structuredClone(sceneChange.scene);

    return {
      ok: true,
      value: structuredClone(sceneChange),
    };
  }
  function placeTarget(
    positionMeters: Vector2,
    properties?: TargetPlacementProperties,
  ): EngineResult<SceneDraftChange> {
    const sceneChange = addTargetToScene(
      currentScene,
      positionMeters,
      properties,
    );

    const validationResult = validateScene(sceneChange.scene);

    if (!validationResult.ok) {
      return validationResult;
    }

    currentScene = structuredClone(sceneChange.scene);

    return {
      ok: true,
      value: structuredClone(sceneChange),
    };
  }
  function updateProjectileProperties(
    projectileId: string,
    properties: ProjectilePlacementProperties,
  ): EngineResult<SceneDraftChange> {
    const selectedBody = currentScene.bodies.find(
      (body) => body.id === projectileId,
    );

    if (selectedBody === undefined) {
      return {
        ok: false,
        diagnostics: [
          {
            code: "UNKNOWN_ENTITY_ID",
            path: "projectileId",
            message: `Body "${projectileId}" does not exist.`,
            entityId: projectileId,
          },
        ],
      };
    }

    if (selectedBody.kind !== "dynamic") {
      return {
        ok: false,
        diagnostics: [
          {
            code: "INVALID_BODY_KIND",
            path: "projectileId",
            message: "Only a dynamic projectile can use these properties.",
            entityId: projectileId,
          },
        ],
      };
    }

    if (
      !Number.isFinite(properties.launchSpeedMetersPerSecond) ||
      properties.launchSpeedMetersPerSecond < 0
    ) {
      return {
        ok: false,
        diagnostics: [
          {
            code: "OUT_OF_RANGE",
            path: "properties.launchSpeedMetersPerSecond",
            message: "Launch speed must be finite and nonnegative.",
            entityId: projectileId,
          },
        ],
      };
    }

    const sceneChange = updateProjectileInScene(
      currentScene,
      projectileId,
      properties,
    );

    const validationResult = validateScene(sceneChange.scene);

    if (!validationResult.ok) {
      return validationResult;
    }

    currentScene = structuredClone(sceneChange.scene);

    return {
      ok: true,
      value: structuredClone(sceneChange),
    };
  }
  function updateStaticBodyProperties(
    bodyId: string,
    properties: RampPlacementProperties,
  ): EngineResult<SceneDraftChange> {
    const selectedBody = currentScene.bodies.find((body) => body.id === bodyId);

    if (selectedBody === undefined) {
      return {
        ok: false,
        diagnostics: [
          {
            code: "UNKNOWN_ENTITY_ID",
            path: "bodyId",
            message: `Body "${bodyId}" does not exist.`,
            entityId: bodyId,
          },
        ],
      };
    }

    if (selectedBody.kind !== "static") {
      return {
        ok: false,
        diagnostics: [
          {
            code: "INVALID_BODY_KIND",
            path: "bodyId",
            message: "Only a static body can use these properties.",
            entityId: bodyId,
          },
        ],
      };
    }

    const sceneChange = updateStaticBodyInScene(
      currentScene,
      bodyId,
      properties,
    );

    const validationResult = validateScene(sceneChange.scene);

    if (!validationResult.ok) {
      return validationResult;
    }

    currentScene = structuredClone(sceneChange.scene);

    return {
      ok: true,
      value: structuredClone(sceneChange),
    };
  }
  function updateTargetProperties(
    targetId: string,
    properties: TargetPlacementProperties,
  ): EngineResult<SceneDraftChange> {
    const selectedTarget = currentScene.triggers.find(
      (trigger) => trigger.id === targetId,
    );

    if (selectedTarget === undefined) {
      return {
        ok: false,
        diagnostics: [
          {
            code: "UNKNOWN_ENTITY_ID",
            path: "targetId",
            message: `Target "${targetId}" does not exist.`,
            entityId: targetId,
          },
        ],
      };
    }

    const sceneChange = updateTargetInScene(currentScene, targetId, properties);

    const validationResult = validateScene(sceneChange.scene);

    if (!validationResult.ok) {
      return validationResult;
    }

    currentScene = structuredClone(sceneChange.scene);

    return {
      ok: true,
      value: structuredClone(sceneChange),
    };
  }
  return {
    ok: true,
    value: {
      enqueue: (command) => engine.enqueue(command),
      stepOnce,
      copySnapshot: () => engine.copySnapshot(),
      reset,
      dispose,
      copyScene: () => structuredClone(currentScene),
      placeRamp,
      placeProjectile,
      placePlatform,
      placeTarget,
      updateProjectileProperties,
      updateStaticBodyProperties,
      updateTargetProperties,
    },
  };
}
