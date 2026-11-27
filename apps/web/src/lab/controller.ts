// Supplies commands and portable renderer snapshots.
import type {
  CommandPayload,
  SceneDefinition,
  Snapshot,
  SnapshotEvent,
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
  placeEntityInScene,
  type PlacementRequest,
  type SceneDraftChange,
  type ProjectilePlacementProperties,
  type RampPlacementProperties,
  type TargetPlacementProperties,
  updateProjectileInScene,
  updateStaticBodyInScene,
  updateTargetInScene,
  moveEntityInScene,
  deleteEntityFromScene,
  updateEnvironmentInScene
} from "./authoring.js";
import { PULL_NEEDS_RUN } from "./lab-messages.js";

export const PLAYBACK_SPEEDS = [0.25, 0.5, 1, 2, 4] as const;
export type PlaybackSpeed = (typeof PLAYBACK_SPEEDS)[number];

// Upper bound on listed events per run, so a long run with many bounces cannot grow the list forever.
export const RUN_EVENT_LIMIT = 100;

// Contact reports for the same ball and surface less than this far apart count as one contact.
const CONTINUING_CONTACT_GAP_SECONDS = 0.1;

// The pull is a spring scaled by mass (k = m·ω², c = 2·m·ω), so every ball settles in about half a second.
const PULL_ANGULAR_FREQUENCY_RADIANS_PER_SECOND = 10;
// Largest pull per kilogram, about ten times g.
const PULL_MAXIMUM_ACCELERATION_METERS_PER_SECOND_SQUARED = 100;
const POINTER_PULL_INTERACTION_ID = "pointer-pull";

// Fixed when a pull starts; moving the pointer only changes the target.
interface PullSettings {
  readonly bodyId: string;
  readonly localAnchorMeters: Vector2;
  readonly stiffnessNewtonsPerMeter: number;
  readonly dampingKilogramsPerSecond: number;
  readonly maximumForceNewtons: number;
}

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
  // Pull a ball toward the pointer with a spring while the run plays.
  startPull(bodyId: string, localAnchorMeters: Vector2, targetPositionMeters: Vector2): EngineStatus;
  movePull(targetPositionMeters: Vector2): EngineStatus;
  endPull(): EngineStatus;
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

  placeEntity(request: PlacementRequest): EngineResult<SceneDraftChange>;
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
  // Receives this run's events whenever the list changes.
  readonly consumeRunEvents?: ((events: readonly SnapshotEvent[]) => void) | undefined;
  readonly releaseView: () => void;
  readonly nowMilliseconds?: (() => number) | undefined;
  readonly playbackBrowser?: PlaybackBrowser | undefined;
  readonly onPlaybackChange?: ((state: PlaybackState) => void) | undefined;
}

export function createLabController(options: LabControllerOptions): EngineResult<LabController> {
  const {
    engine, initialScene, consumeSnapshot, consumeReadout, consumeTick, consumeRunEvents, releaseView,
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
  // The engine reports an event only on its own tick, so the run's events are kept here until Reset.
  let runEvents: SnapshotEvent[] = [];
  let activePull: PullSettings | null = null;
  // Last reported contact time for each ball–surface pair.
  let lastContactTimes = new Map<string, number>();

  function publishRunEvents(): void {
    consumeRunEvents?.(runEvents.slice());
  }

  // A ball resting or sliding on a surface keeps being reported; list only the first report of each contact.
  function recordRunEvents(snapshot: Snapshot): void {
    const newEvents: SnapshotEvent[] = [];

    for (const event of snapshot.events) {
      if (event.kind === "groundContact") {
        const pair = `${event.bodyId}:${event.surfaceBodyId}`;
        const previousTime = lastContactTimes.get(pair);
        lastContactTimes.set(pair, event.timeSeconds);

        // Reports this close together are the same contact continuing, not a new hit.
        if (previousTime !== undefined && event.timeSeconds - previousTime <= CONTINUING_CONTACT_GAP_SECONDS) {
          continue;
        }
      }

      newEvents.push(event);
    }

    const room = RUN_EVENT_LIMIT - runEvents.length;

    if (newEvents.length === 0 || room <= 0) {
      return;
    }

    runEvents.push(...structuredClone(newEvents.slice(0, room)));
    publishRunEvents();
  }

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

    recordRunEvents(snapshotResult.value);
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

    // The engine's reset also removed the pull.
    activePull = null;
    runEvents = [];
    lastContactTimes = new Map();
    publishRunEvents();

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
  let nextCommandNumber = 1;

  // Queue a command for the current tick; the engine applies it before the next step.
  function enqueueAtCurrentTick(payload: CommandPayload): EngineResult<{ readonly appliesAtTick: number }> {
    const snapshotResult = currentEngine.getSnapshot();

    if (!snapshotResult.ok) {
      return snapshotResult;
    }

    const tick = snapshotResult.value.tick;
    const result = currentEngine.enqueue({ commandVersion: 1, id: `lab-command-${nextCommandNumber}`, targetTick: tick, payload });

    if (!result.ok) {
      return result;
    }

    nextCommandNumber += 1;
    return { ok: true, value: { appliesAtTick: tick } };
  }

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

    // At tick zero an edit belongs to the starting scene, which Reset must keep.
    if (snapshotResult.value.tick === 0) {
      return {
        ok: false,
        diagnostics: [{ code: "OUT_OF_RANGE", path: "playback.tick", message: "Press Step or Run first: before the run starts, edits change the starting scene." }],
      };
    }

    return enqueueAtCurrentTick(payload);
  }

  // Only a playing run can be pulled, so the starting scene is never changed.
  function startPull(bodyId: string, localAnchorMeters: Vector2, targetPositionMeters: Vector2): EngineStatus {
    const status = activeStatus();

    if (!status.ok) {
      return status;
    }

    if (!playing) {
      return { ok: false, diagnostics: [{ code: "OUT_OF_RANGE", path: "pull", message: PULL_NEEDS_RUN }] };
    }

    const ball = currentScene.bodies.find((body) => body.id === bodyId);

    if (ball === undefined) {
      return { ok: false, diagnostics: [{ code: "UNKNOWN_ENTITY_ID", path: "pull.bodyId", message: `Body "${bodyId}" does not exist.`, entityId: bodyId }] };
    }

    if (ball.kind !== "dynamic") {
      return { ok: false, diagnostics: [{ code: "INVALID_BODY_KIND", path: "pull.bodyId", message: "Only a ball can be pulled.", entityId: bodyId }] };
    }

    const omega = PULL_ANGULAR_FREQUENCY_RADIANS_PER_SECOND;
    const pull: PullSettings = {
      bodyId,
      localAnchorMeters: { ...localAnchorMeters },
      stiffnessNewtonsPerMeter: ball.massKilograms * omega * omega,
      dampingKilogramsPerSecond: 2 * ball.massKilograms * omega,
      maximumForceNewtons: ball.massKilograms * PULL_MAXIMUM_ACCELERATION_METERS_PER_SECOND_SQUARED,
    };
    const result = enqueueAtCurrentTick({ kind: "setForceInteraction", interactionId: POINTER_PULL_INTERACTION_ID, ...pull, targetPositionMeters: { ...targetPositionMeters } });

    if (!result.ok) {
      return result;
    }

    activePull = pull;
    return { ok: true };
  }

  // Sending the same interaction ID again replaces the old target.
  function movePull(targetPositionMeters: Vector2): EngineStatus {
    const status = activeStatus();

    if (!status.ok || activePull === null) {
      return status;
    }

    const result = enqueueAtCurrentTick({ kind: "setForceInteraction", interactionId: POINTER_PULL_INTERACTION_ID, ...activePull, targetPositionMeters: { ...targetPositionMeters } });
    return result.ok ? { ok: true } : result;
  }

  // Letting go removes the force; the ball keeps its velocity.
  function endPull(): EngineStatus {
    const status = activeStatus();

    if (!status.ok || activePull === null) {
      return status;
    }

    activePull = null;
    const result = enqueueAtCurrentTick({ kind: "endForceInteraction", interactionId: POINTER_PULL_INTERACTION_ID });
    return result.ok ? { ok: true } : result;
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

  // Validate, then keep one copy and return another.
  function acceptSceneChange(sceneChange: SceneDraftChange): EngineResult<SceneDraftChange> {
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

  function placeEntity(request: PlacementRequest): EngineResult<SceneDraftChange> {
    const status = pausedAuthoringStatus();

    if (!status.ok) {
      return status;
    }

    return acceptSceneChange(placeEntityInScene(currentScene, request));
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

    return acceptSceneChange(sceneChange);
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

    return acceptSceneChange(sceneChange);
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

    return acceptSceneChange(sceneChange);
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

    return acceptSceneChange(sceneChange);
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
    return acceptSceneChange(sceneChange);
  }

  const removeVisibilityListener = playbackBrowser?.subscribeVisibilityChange(handleVisibilityChange);
  // Prime retained measurements before making the controller available to the toolbar.
  publishReadout(true);
  publishRunEvents();
  reportPlaybackChange();

  return {
    ok: true,
    value: {
      queueRunEdit,
      startPull,
      movePull,
      endPull,
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
      placeEntity,
      updateProjectileProperties,
      updateStaticBodyProperties,
      updateTargetProperties,
      moveEntityWhilePaused,
      deleteEntity,
    },
  };
}
