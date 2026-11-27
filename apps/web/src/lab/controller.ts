// Supplies commands and portable renderer snapshots.
import type {
  BoxShape,
  CircleShape,
  CommandPayload,
  Material,
  Pose,
  SceneDefinition,
  Snapshot,
  SnapshotEvent,
  Vector2,
} from "@eureka/contracts";
// Supplies the headless engine boundary and typed results.
import {
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

// What the editor shows of the world. Never sent per frame: only after an accepted edit, an applied boundary or Reset.
export interface LabSceneView {
  // Authoritative world: the start at tick 0, the run's world after that.
  readonly scene: SceneDefinition;
  // What Reset restores.
  readonly start: SceneDefinition;
  // The world once this pause's queued edits apply, or null when nothing is queued.
  readonly preview: SceneDefinition | null;
  readonly queuedForTick: number | null;
  readonly startEdited: boolean;
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
  // An explicit change of the start, such as a challenge value: ends the current run first.
  setStartingScene(scene: SceneDefinition): EngineResult<SceneDefinition>;
  updateEnvironment(environment: SceneDefinition["environment"]): EngineResult<SceneDefinition>;

  placeEntity(request: PlacementRequest): EngineResult<SceneDraftChange>;
  updateProjectileProperties(
    projectileId: string,
    properties: ProjectilePlacementProperties,
    // Mid-run only: also relaunch the ball from where it is with the new launch velocity.
    options?: { readonly relaunch?: boolean },
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
  // Receives the scene view before the snapshot that matches it.
  readonly consumeScene?: ((view: LabSceneView, snapshot: Snapshot) => void) | undefined;
  // Receives this run's events whenever the list changes.
  readonly consumeRunEvents?: ((events: readonly SnapshotEvent[]) => void) | undefined;
  readonly releaseView: () => void;
  readonly nowMilliseconds?: (() => number) | undefined;
  readonly playbackBrowser?: PlaybackBrowser | undefined;
  readonly onPlaybackChange?: ((state: PlaybackState) => void) | undefined;
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

// Turn one authoring edit into engine run commands. A ball's velocity changes only through an explicit relaunch.
function runCommandsFor(before: SceneDefinition, after: SceneDefinition, relaunchBodyId: string | undefined): CommandPayload[] {
  const payloads: CommandPayload[] = [];
  const previousEntities = new Map([...before.bodies, ...before.triggers].map((entity) => [entity.id, entity]));
  const nextEntities = [...after.bodies, ...after.triggers];
  const nextIds = new Set(nextEntities.map((entity) => entity.id));

  if (!same(before.environment, after.environment)) {
    payloads.push({ kind: "setEnvironment", environment: structuredClone(after.environment) });
  }

  for (const id of previousEntities.keys()) {
    if (!nextIds.has(id)) {
      payloads.push({ kind: "removeEntity", entityId: id });
    }
  }

  for (const entity of nextEntities) {
    const previous = previousEntities.get(entity.id);

    if (previous === undefined) {
      payloads.push({ kind: "addEntity", entity: structuredClone(entity) });
      continue;
    }

    if (entity.kind === "target" && previous.kind === "target") {
      const changes: { pose?: Pose; shape?: CircleShape } = {};

      if (!same(previous.pose, entity.pose)) {
        changes.pose = structuredClone(entity.pose);
      }

      if (!same(previous.shape, entity.shape)) {
        changes.shape = { ...entity.shape };
      }

      if (Object.keys(changes).length > 0) {
        payloads.push({ kind: "editTarget", targetId: entity.id, changes });
      }

      continue;
    }

    if (entity.kind === "target" || previous.kind === "target") {
      continue;
    }

    const changes: { massKilograms?: number; material?: Material; pose?: Pose; shape?: CircleShape | BoxShape } = {};

    if (entity.kind === "dynamic" && previous.kind === "dynamic" && entity.massKilograms !== previous.massKilograms) {
      changes.massKilograms = entity.massKilograms;
    }

    if (!same(previous.material, entity.material)) {
      changes.material = { ...entity.material };
    }

    if (!same(previous.pose, entity.pose)) {
      changes.pose = structuredClone(entity.pose);
    }

    if (!same(previous.shape, entity.shape)) {
      changes.shape = { ...entity.shape };
    }

    if (Object.keys(changes).length > 0) {
      payloads.push({ kind: "editBody", bodyId: entity.id, changes });
    }

    if (entity.kind === "dynamic" && entity.id === relaunchBodyId) {
      payloads.push({ kind: "launchBody", bodyId: entity.id, positionMeters: { ...entity.pose.positionMeters }, velocity: structuredClone(entity.velocity) });
    }
  }

  return payloads;
}

export function createLabController(options: LabControllerOptions): EngineResult<LabController> {
  const {
    engine, initialScene, consumeSnapshot, consumeReadout, consumeTick, consumeScene, consumeRunEvents, releaseView,
    nowMilliseconds = () => performance.now(),
    playbackBrowser, onPlaybackChange,
  } = options;
  const currentEngine = engine;
  let start = structuredClone(initialScene);
  let world = structuredClone(initialScene);
  let preview: SceneDefinition | null = null;
  let queuedForTick: number | null = null;
  let startEdited = false;
  let scenePublishDue = false;
  // Every ID this engine has held, so a new object never takes a removed object's ID.
  const usedIds = new Set<string>();
  rememberIds(initialScene);

  function rememberIds(scene: SceneDefinition): void {
    for (const entity of [...scene.bodies, ...scene.triggers]) {
      usedIds.add(entity.id);
    }
  }

  function sceneView(): LabSceneView {
    return structuredClone({ scene: world, start, preview, queuedForTick, startEdited });
  }

  const initialSnapshot = currentEngine.getSnapshot();
  if (!initialSnapshot.ok) {
    return initialSnapshot;
  }

  consumeScene?.(sceneView(), initialSnapshot.value);
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

    // Queued edits were applied at their boundary, so the authoritative world changed.
    if (queuedForTick !== null && snapshotResult.value.tick > queuedForTick) {
      const sceneResult = currentEngine.copyScene();

      if (sceneResult.ok) {
        world = sceneResult.value;
      }

      preview = null;
      queuedForTick = null;
      scenePublishDue = true;
    }

    if (scenePublishDue) {
      scenePublishDue = false;
      consumeScene?.(sceneView(), snapshotResult.value);
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

    // The engine's reset also removed the pull, the run's edits and its queued commands.
    activePull = null;
    world = structuredClone(start);
    preview = null;
    queuedForTick = null;
    scenePublishDue = true;
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

    const ball = world.bodies.find((body) => body.id === bodyId);

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

  function missingEntity(path: string, entityId: string): EngineResult<never> {
    return { ok: false, diagnostics: [{ code: "UNKNOWN_ENTITY_ID", path, message: `"${entityId}" does not exist.`, entityId }] };
  }

  function wrongKind(path: string, entityId: string, message: string): EngineResult<never> {
    return { ok: false, diagnostics: [{ code: "INVALID_BODY_KIND", path, message, entityId }] };
  }

  // At tick 0 an edit replaces the start in the same engine; while paused mid-run it is queued for the next boundary.
  function applySceneEdit<T extends { readonly scene: SceneDefinition }>(
    build: (base: SceneDefinition) => EngineResult<T>,
    relaunchBodyId?: string,
  ): EngineResult<T> {
    const status = pausedAuthoringStatus();

    if (!status.ok) {
      return status;
    }

    const snapshotResult = currentEngine.getSnapshot();

    if (!snapshotResult.ok) {
      return snapshotResult;
    }

    const tick = snapshotResult.value.tick;
    let base = world;

    // Mid-run edits start from the paused state itself, or from the edits already queued at this pause.
    if (tick > 0) {
      const sceneResult = preview === null ? currentEngine.copyScene() : { ok: true as const, value: preview };

      if (!sceneResult.ok) {
        return sceneResult;
      }

      base = sceneResult.value;
    }

    const built = build(base);

    if (!built.ok) {
      return built;
    }

    const nextScene = built.value.scene;

    if (tick === 0) {
      const result = currentEngine.setInitialScene(nextScene);

      if (!result.ok) {
        return result;
      }

      start = structuredClone(nextScene);
      world = structuredClone(nextScene);
      startEdited = true;
      rememberIds(nextScene);
      scenePublishDue = true;
      const publishStatus = publishCurrentSnapshot();

      if (!publishStatus.ok) {
        return publishStatus;
      }

      publishReadout(true);
      return { ok: true, value: structuredClone(built.value) };
    }

    const payloads = runCommandsFor(base, nextScene, relaunchBodyId);

    for (const payload of payloads) {
      const result = queueRunEdit(payload);

      if (!result.ok) {
        return result;
      }

      // Even a partly queued edit changes the world at the boundary, so refresh it then.
      queuedForTick = tick;
    }

    if (payloads.length > 0) {
      preview = structuredClone(nextScene);
      rememberIds(nextScene);
      consumeScene?.(sceneView(), snapshotResult.value);
    }

    return { ok: true, value: structuredClone(built.value) };
  }

  function setStartingScene(scene: SceneDefinition): EngineResult<SceneDefinition> {
    const status = pausedAuthoringStatus();

    if (!status.ok) {
      return status;
    }

    const snapshotResult = currentEngine.getSnapshot();

    if (snapshotResult.ok && snapshotResult.value.tick > 0) {
      const resetStatus = reset();

      if (!resetStatus.ok) {
        return resetStatus;
      }
    }

    const result = applySceneEdit(() => ({ ok: true, value: { scene } }));
    return result.ok ? { ok: true, value: result.value.scene } : result;
  }

  function updateEnvironment(environment: SceneDefinition["environment"]): EngineResult<SceneDefinition> {
    const result = applySceneEdit((base) => ({ ok: true, value: { scene: updateEnvironmentInScene(base, environment) } }));
    return result.ok ? { ok: true, value: result.value.scene } : result;
  }

  function placeEntity(request: PlacementRequest): EngineResult<SceneDraftChange> {
    return applySceneEdit((base) => ({ ok: true, value: placeEntityInScene(base, request, usedIds) }));
  }

  function updateProjectileProperties(
    projectileId: string,
    properties: ProjectilePlacementProperties,
    options: { readonly relaunch?: boolean } = {},
  ): EngineResult<SceneDraftChange> {
    if (!Number.isFinite(properties.launchSpeedMetersPerSecond) || properties.launchSpeedMetersPerSecond < 0) {
      return {
        ok: false,
        diagnostics: [{ code: "OUT_OF_RANGE", path: "properties.launchSpeedMetersPerSecond", message: "Launch speed must be a number of 0 or more.", entityId: projectileId }],
      };
    }

    return applySceneEdit<SceneDraftChange>((base) => {
      const selectedBody = base.bodies.find((body) => body.id === projectileId);

      if (selectedBody === undefined) {
        return missingEntity("projectileId", projectileId);
      }

      if (selectedBody.kind !== "dynamic") {
        return wrongKind("projectileId", projectileId, "These settings only apply to a ball.");
      }

      return { ok: true, value: updateProjectileInScene(base, projectileId, properties) };
    }, options.relaunch === true ? projectileId : undefined);
  }

  function updateStaticBodyProperties(bodyId: string, properties: RampPlacementProperties): EngineResult<SceneDraftChange> {
    return applySceneEdit<SceneDraftChange>((base) => {
      const selectedBody = base.bodies.find((body) => body.id === bodyId);

      if (selectedBody === undefined) {
        return missingEntity("bodyId", bodyId);
      }

      if (selectedBody.kind !== "static") {
        return wrongKind("bodyId", bodyId, "These settings only apply to a platform, ramp or ground.");
      }

      return { ok: true, value: updateStaticBodyInScene(base, bodyId, properties) };
    });
  }

  function updateTargetProperties(targetId: string, properties: TargetPlacementProperties): EngineResult<SceneDraftChange> {
    return applySceneEdit<SceneDraftChange>((base) => base.triggers.some((trigger) => trigger.id === targetId)
      ? { ok: true, value: updateTargetInScene(base, targetId, properties) }
      : missingEntity("targetId", targetId));
  }

  function hasEntity(scene: SceneDefinition, entityId: string): boolean {
    return scene.bodies.some((body) => body.id === entityId) || scene.triggers.some((trigger) => trigger.id === entityId);
  }

  function moveEntityWhilePaused(entityId: string, positionMeters: Vector2): EngineResult<SceneDraftChange> {
    return applySceneEdit<SceneDraftChange>((base) => hasEntity(base, entityId)
      ? { ok: true, value: moveEntityInScene(base, entityId, positionMeters) }
      : missingEntity("entityId", entityId));
  }

  function deleteEntity(entityId: string): EngineResult<SceneDraftChange> {
    const result = applySceneEdit<SceneDraftChange>((base) => hasEntity(base, entityId)
      ? { ok: true, value: deleteEntityFromScene(base, entityId) }
      : missingEntity("entityId", entityId));

    // The engine ends a removed ball's pull; forget it here too.
    if (result.ok && activePull?.bodyId === entityId) {
      activePull = null;
    }

    return result;
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
      copyScene: () => structuredClone(world),
      setStartingScene,
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
