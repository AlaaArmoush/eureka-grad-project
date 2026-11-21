// Supplies commands and portable renderer snapshots.
import type {
  CommandPayload,
  SceneDefinition,
  Snapshot,
  Vector2,
} from "@eureka/contracts";
// Supplies the headless engine boundary and typed results.
import {
  validateScene,
  type AdvanceReceipt,
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
  moveEntityInScene,
  deleteEntityFromScene,
  updateEnvironmentInScene
} from "./authoring.js";

export const PLAYBACK_SPEEDS = [0.25, 0.5, 1, 2, 4] as const;
export type PlaybackSpeed = (typeof PLAYBACK_SPEEDS)[number];

// Expose playback information without exposing the mutable clock accumulator.
export interface PlaybackState {
  readonly playing: boolean;
  readonly speed: PlaybackSpeed;
  readonly unableToMaintainRealTimeSpeed: boolean;
  readonly droppedWallTimeSeconds: number;
}

// Describe browser scheduling and visibility without requiring a real browser in tests.
export interface PlaybackBrowser {
  requestFrame(callback: () => void): number;
  cancelFrame(handle: number): void;
  isHidden(): boolean;
  subscribeVisibilityChange(listener: () => void): () => void;
  onFrameResult(result: EngineStatus): void;
}

export interface LabController {
  queueRunEdit(payload: CommandPayload): EngineResult<{ readonly appliesAtTick: number }>;
  play(): EngineStatus;
  pause(): void;
  setSpeed(speed: PlaybackSpeed): EngineStatus;
  advanceFrame(): EngineStatus;
  getPlaybackState(): PlaybackState;

  stepOnce(): EngineResult<AdvanceReceipt>;
  copySnapshot(): EngineResult<Snapshot>;

  reset(): EngineStatus;
  // Preserve the view only when the host is replacing the authored scene.
  dispose(options?: { readonly preserveView?: boolean }): EngineStatus;

  copyScene(): SceneDefinition;
  updateEnvironment(environment: SceneDefinition["environment"]): EngineResult<SceneDefinition>;

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
  moveEntityWhilePaused(
    entityId: string,
    positionMeters: Vector2,
  ): EngineResult<SceneDraftChange>;
  deleteEntity(entityId: string): EngineResult<SceneDraftChange>;
}

export type SnapshotConsumer = (snapshot: Snapshot) => void;

// Group the run's owners and optional timing dependencies for one controller.
export interface LabControllerOptions {
  readonly engine: Engine;
  readonly initialScene: SceneDefinition;
  readonly consumeSnapshot: SnapshotConsumer;
  // Receive owned snapshots for retained HTML measurements.
  readonly consumeReadout?: SnapshotConsumer | undefined;
  readonly consumeTick?: SnapshotConsumer | undefined;
  readonly releaseView: () => void;
  readonly nowMilliseconds?: (() => number) | undefined;
  readonly playbackBrowser?: PlaybackBrowser | undefined;
  readonly onPlaybackChange?: ((state: PlaybackState) => void) | undefined;
}

export function createLabController(options: LabControllerOptions): EngineResult<LabController> {
  const {
    engine, initialScene, consumeSnapshot, consumeReadout, consumeTick, releaseView,
    nowMilliseconds = () => performance.now(),
    playbackBrowser, onPlaybackChange,
  } = options;
  const currentEngine = engine;
  let currentScene = structuredClone(initialScene);
  const initialSnapshot = currentEngine.getSnapshot();
  if (!initialSnapshot.ok) {
    return initialSnapshot;
  }

  consumeSnapshot(initialSnapshot.value);

  const fixedTimeStepSeconds = initialScene.numericalProfile.fixedTimeStepSeconds;
  const maximumFrameElapsedSeconds = 0.25;
  const maximumOuterTicksPerFrame = 16;

  let disposed = false;
  let playing = false;
  let speed: PlaybackSpeed = 1;
  let accumulatedSimulationSeconds = 0;
  let lastFrameTimeMilliseconds = 0;
  let unableToMaintainRealTimeSpeed = false;
  let droppedWallTimeSeconds = 0;
  let pendingFrameHandle: number | null = null;
  let lastReportedPlaybackState: PlaybackState | undefined;
  // Track the last retained readout's browser timestamp.
  let lastReadoutTimeMilliseconds = Number.NEGATIVE_INFINITY;

  function activeStatus(): EngineStatus {
    if (disposed) {
      return {
        ok: false,
        diagnostics: [{
          code: "DISPOSED_ENGINE",
          path: "controller",
          message: "The lab was closed. Open it again to continue.",
        }],
      };
    }

    return { ok: true };
  }

  // Protect the starting scene from physical edits during an active run.
  function pausedAuthoringStatus(): EngineStatus {
    const status = activeStatus();

    if (!status.ok || !playing) {
      return status;
    }

    return {
      ok: false,
      diagnostics: [{
        code: "OUT_OF_RANGE",
        path: "playback.playing",
        message: "Pause the run before changing the scene.",
      }],
    };
  }

  function getPlaybackState(): PlaybackState {
    return {
      playing,
      speed,
      unableToMaintainRealTimeSpeed,
      droppedWallTimeSeconds,
    };
  }

  // Report a fresh state only when one of the public playback values changes.
  function reportPlaybackChange(): void {
    if (onPlaybackChange === undefined) {
      return;
    }

    const next = getPlaybackState();
    const previous = lastReportedPlaybackState;
    const unchanged = previous !== undefined &&
      previous.playing === next.playing &&
      previous.speed === next.speed &&
      previous.unableToMaintainRealTimeSpeed === next.unableToMaintainRealTimeSpeed &&
      previous.droppedWallTimeSeconds === next.droppedWallTimeSeconds;

    if (unchanged) {
      return;
    }

    lastReportedPlaybackState = next;
    onPlaybackChange(next);
  }

  function requestNextFrame(): void {
    if (playbackBrowser === undefined || !playing || disposed || pendingFrameHandle !== null) {
      return;
    }

    pendingFrameHandle = playbackBrowser.requestFrame(runScheduledFrame);
  }

  function runScheduledFrame(): void {
    pendingFrameHandle = null;

    if (!playing || disposed) {
      return;
    }

    const result = advanceFrame();
    playbackBrowser?.onFrameResult(result);
    requestNextFrame();
  }

  function handleVisibilityChange(): void {
    if (playbackBrowser?.isHidden() === true) {
      pause();
    }
  }

  function pause(): void {
    playing = false;
    accumulatedSimulationSeconds = 0;
    lastFrameTimeMilliseconds = 0;

    if (pendingFrameHandle !== null && playbackBrowser !== undefined) {
      playbackBrowser.cancelFrame(pendingFrameHandle);
      pendingFrameHandle = null;
    }

    // Show the exact paused state even if the normal readout interval has not elapsed.
    publishReadout(true);
    reportPlaybackChange();
  }

  function play(): EngineStatus {
    const status = activeStatus();

    if (!status.ok || playing) {
      return status;
    }

    if (playbackBrowser?.isHidden() === true) {
      return {
        ok: false,
        diagnostics: [{
          code: "OUT_OF_RANGE",
          path: "playback.visibility",
          message: "Come back to this tab to start the run.",
        }],
      };
    }

    accumulatedSimulationSeconds = 0;
    lastFrameTimeMilliseconds = nowMilliseconds();
    unableToMaintainRealTimeSpeed = false;
    playing = true;
    reportPlaybackChange();
    requestNextFrame();

    return { ok: true };
  }

  function setSpeed(nextSpeed: PlaybackSpeed): EngineStatus {
    const status = activeStatus();

    if (!status.ok) {
      return status;
    }

    if (!PLAYBACK_SPEEDS.includes(nextSpeed)) {
      return {
        ok: false,
        diagnostics: [{
          code: "OUT_OF_RANGE",
          path: "playback.speed",
          message: "Choose a speed of 0.25×, 0.5×, 1×, 2× or 4×.",
        }],
      };
    }

    if (nextSpeed === speed) {
      return { ok: true };
    }

    speed = nextSpeed;
    accumulatedSimulationSeconds = 0;
    lastFrameTimeMilliseconds = playing ? nowMilliseconds() : 0;
    unableToMaintainRealTimeSpeed = false;
    reportPlaybackChange();

    return { ok: true };
  }

  function publishCurrentSnapshot(): EngineStatus {
    const snapshotResult = currentEngine.getSnapshot();

    if (!snapshotResult.ok) {
      pause();
      return snapshotResult;
    }

    consumeSnapshot(snapshotResult.value);
    consumeTick?.(snapshotResult.value);
    return { ok: true };
  }

  // Send the latest accepted state to retained HTML consumers at a bounded rate.
  function publishReadout(force = false): void {
    if (consumeReadout === undefined || disposed) {
      return;
    }

    const now = nowMilliseconds();

    if (!force && now - lastReadoutTimeMilliseconds < 100) {
      return;
    }

    const result = currentEngine.getSnapshot();

    if (!result.ok) {
      return;
    }

    lastReadoutTimeMilliseconds = now;
    consumeReadout(structuredClone(result.value));
  }

  function advanceOneTick(): EngineResult<AdvanceReceipt> {
    const advanceResult = currentEngine.advance(1);

    if (!advanceResult.ok) {
      pause();
      return advanceResult;
    }

    const snapshotStatus = publishCurrentSnapshot();

    if (!snapshotStatus.ok) {
      return snapshotStatus;
    }

    return advanceResult;
  }

  // Allow manual stepping only while playback is paused.
  function stepOnce(): EngineResult<AdvanceReceipt> {
    const status = activeStatus();

    if (!status.ok) {
      return status;
    }

    if (playing) {
      return {
        ok: false,
        diagnostics: [{
          code: "OUT_OF_RANGE",
          path: "playback.playing",
          message: "Pause the run before stepping.",
        }],
      };
    }

    // A paused step must update HTML immediately, regardless of the running cadence.
    const result = advanceOneTick();

    if (result.ok) {
      publishReadout(true);
    }

    return result;
  }

  // Convert elapsed browser time into a bounded number of whole engine ticks.
  function advanceFrame(): EngineStatus {
    const status = activeStatus();

    if (!status.ok || !playing) {
      return status;
    }

    if (playbackBrowser?.isHidden() === true) {
      pause();
      return { ok: true };
    }

    const currentTimeMilliseconds = nowMilliseconds();
    const elapsedWallSeconds = Math.max(
      0,
      (currentTimeMilliseconds - lastFrameTimeMilliseconds) / 1000,
    );
    lastFrameTimeMilliseconds = currentTimeMilliseconds;

    const acceptedWallSeconds = Math.min(elapsedWallSeconds, maximumFrameElapsedSeconds);
    accumulatedSimulationSeconds += acceptedWallSeconds * speed;

    const wholeTicksDue = Math.floor(accumulatedSimulationSeconds / fixedTimeStepSeconds);
    const ticksToRun = Math.min(wholeTicksDue, maximumOuterTicksPerFrame);

    // Retain the fractional tick and remove all whole-tick time from the accumulator.
    accumulatedSimulationSeconds -= wholeTicksDue * fixedTimeStepSeconds;

    // Record discarded browser time, including whole ticks beyond this frame's budget.
    const droppedSimulationSeconds = (wholeTicksDue - ticksToRun) * fixedTimeStepSeconds;
    const droppedThisFrameSeconds =
      elapsedWallSeconds - acceptedWallSeconds + droppedSimulationSeconds / speed;

    droppedWallTimeSeconds += droppedThisFrameSeconds;
    unableToMaintainRealTimeSpeed = droppedThisFrameSeconds > 0;

    // Publish each accepted tick and stop before another tick if playback is paused.
    for (let ticksRun = 0; playing && ticksRun < ticksToRun; ticksRun += 1) {
      const advanceResult = advanceOneTick();

      if (!advanceResult.ok) {
        return advanceResult;
      }
    }

    // Publish the callback's latest tick rather than an intermediate catch-up tick.
    publishReadout();
    reportPlaybackChange();
    return { ok: true };
  }

  function reset(): EngineStatus {
    const status = activeStatus();

    if (!status.ok) {
      return status;
    }

    pause();

    const resetResult = currentEngine.reset();

    if (!resetResult.ok) {
      return resetResult;
    }

    droppedWallTimeSeconds = 0;
    unableToMaintainRealTimeSpeed = false;
    reportPlaybackChange();

    // Draw and retain the restored tick-zero state immediately.
    const snapshotStatus = publishCurrentSnapshot();

    if (snapshotStatus.ok) {
      publishReadout(true);
    }

    return snapshotStatus;
  }

  // Release the engine and normally release its view as well.
  function dispose(options: { readonly preserveView?: boolean } = {}): EngineStatus {
    if (disposed) {
      return { ok: true };
    }

    // Suppress retained readouts before cleanup pauses the controller.
    disposed = true;
    pause();
    removeVisibilityListener?.();

    if (options.preserveView !== true) {
      releaseView();
    }

    return currentEngine.dispose();
  }

  // Command IDs must be unique per engine run; a counter never repeats even after Reset.
  let nextRunEditNumber = 1;
  function queueRunEdit(payload: CommandPayload): EngineResult<{ readonly appliesAtTick: number }> {
    // A run can only change while paused, like every other edit.
    const status = pausedAuthoringStatus();

    if (!status.ok) {
      return status;
    }

    const snapshotResult = currentEngine.getSnapshot();

    if (!snapshotResult.ok) {
      return snapshotResult;
    }

    const tick = snapshotResult.value.tick;

    // At tick zero an edit belongs to the starting scene, which Reset must keep.
    if (tick === 0) {
      return {
        ok: false,
        diagnostics: [{ code: "OUT_OF_RANGE", path: "playback.tick", message: "Press Step or Run first: before the run starts, edits change the starting scene." }],
      };
    }

    // The engine validates the command and checks that the body exists before accepting it.
    const result = currentEngine.enqueue({ commandVersion: 1, id: `run-edit-${nextRunEditNumber}`, targetTick: tick, payload });

    if (!result.ok) {
      return result;
    }

    nextRunEditNumber += 1;
    return { ok: true, value: { appliesAtTick: tick } };
  }

  // Accept environment starting conditions without changing the active engine.
  function updateEnvironment(environment: SceneDefinition["environment"]): EngineResult<SceneDefinition> {
    const status = pausedAuthoringStatus();

    if (!status.ok) {
      return status;
    }

    const nextScene = updateEnvironmentInScene(currentScene, environment);
    const validationResult = validateScene(nextScene);

    if (!validationResult.ok) {
      return validationResult;
    }

    currentScene = structuredClone(nextScene);

    return {
      ok: true,
      value: structuredClone(currentScene),
    };
  }

  function placeRamp(
    positionMeters: Vector2,
    properties?: RampPlacementProperties,
  ): EngineResult<SceneDraftChange> {
    // Accept starting-scene changes only while this controller is active and paused.
    const status = pausedAuthoringStatus();

    if (!status.ok) {
      return status;
    }

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
    // Accept starting-scene changes only while this controller is active and paused.
    const status = pausedAuthoringStatus();

    if (!status.ok) {
      return status;
    }

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
    // Accept starting-scene changes only while this controller is active and paused.
    const status = pausedAuthoringStatus();

    if (!status.ok) {
      return status;
    }

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
    // Accept starting-scene changes only while this controller is active and paused.
    const status = pausedAuthoringStatus();

    if (!status.ok) {
      return status;
    }

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
    // Accept starting-scene changes only while this controller is active and paused.
    const status = pausedAuthoringStatus();

    if (!status.ok) {
      return status;
    }

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
            message: "These settings only apply to a ball.",
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
            message: "Launch speed must be a number of 0 or more.",
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
    // Accept starting-scene changes only while this controller is active and paused.
    const status = pausedAuthoringStatus();

    if (!status.ok) {
      return status;
    }

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
            message: "These settings only apply to a platform, ramp or ground.",
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
    // Accept starting-scene changes only while this controller is active and paused.
    const status = pausedAuthoringStatus();

    if (!status.ok) {
      return status;
    }

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
  function moveEntityWhilePaused(
    entityId: string,
    positionMeters: Vector2,
  ): EngineResult<SceneDraftChange> {
    // Accept starting-scene changes only while this controller is active and paused.
    const status = pausedAuthoringStatus();

    if (!status.ok) {
      return status;
    }

    const entityExists =
      currentScene.bodies.some((body) => body.id === entityId) ||
      currentScene.triggers.some((trigger) => trigger.id === entityId);

    if (!entityExists) {
      return {
        ok: false,
        diagnostics: [
          {
            code: "UNKNOWN_ENTITY_ID",
            path: "entityId",
            message: `Entity "${entityId}" does not exist.`,
            entityId,
          },
        ],
      };
    }

    const sceneChange = moveEntityInScene(
      currentScene,
      entityId,
      positionMeters,
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
  function deleteEntity(entityId: string): EngineResult<SceneDraftChange> {
    // Accept starting-scene changes only while this controller is active and paused.
    const status = pausedAuthoringStatus();

    if (!status.ok) {
      return status;
    }

    const entityExists =
      currentScene.bodies.some((body) => body.id === entityId) ||
      currentScene.triggers.some((trigger) => trigger.id === entityId);

    if (!entityExists) {
      return {
        ok: false,
        diagnostics: [
          {
            code: "UNKNOWN_ENTITY_ID",
            path: "entityId",
            message: `Entity "${entityId}" does not exist.`,
            entityId,
          },
        ],
      };
    }

    const sceneChange = deleteEntityFromScene(currentScene, entityId);
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

  const removeVisibilityListener = playbackBrowser?.subscribeVisibilityChange(handleVisibilityChange);
  // Prime retained measurements before making the controller available to the toolbar.
  publishReadout(true);
  reportPlaybackChange();

  return {
    ok: true,
    value: {
      queueRunEdit,
      play,
      pause,
      setSpeed,
      advanceFrame,
      getPlaybackState,
      stepOnce,
      copySnapshot: () => engine.copySnapshot(),
      reset,
      dispose,
      copyScene: () => structuredClone(currentScene),
      updateEnvironment,
      placeRamp,
      placeProjectile,
      placePlatform,
      placeTarget,
      updateProjectileProperties,
      updateStaticBodyProperties,
      updateTargetProperties,
      moveEntityWhilePaused,
      deleteEntity,
    },
  };
}
