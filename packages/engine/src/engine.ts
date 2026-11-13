import type { Command, ProjectileReadout, SceneDefinition, Snapshot, SnapshotBody, SnapshotEvent, TargetTrigger } from "@eureka/contracts";

import { cloneBodies, createMutableBody, type MutableBodyState } from "./body-state.js";
import { failure, type EngineFailure, type EngineResult, type EngineStatus } from "./diagnostics.js";
import { collectInsideTargetPairs, simulateTick, type StepSettings } from "./stepping.js";
import type { ForceInteraction } from "./mechanics.js";
import { validateBodyPlacements, validateCommand, validateScene } from "./validation.js";

export interface CommandAcceptance {
  readonly sequence: number;
}

export interface AdvanceReceipt {
  readonly lastValidTick: number;
}

export interface Engine {
  enqueue(command: Command): EngineResult<CommandAcceptance>;
  advance(tickCount: number): EngineResult<AdvanceReceipt>;
  getSnapshot(): EngineResult<Snapshot>;
  copySnapshot(): EngineResult<Snapshot>;
  reset(): EngineStatus;
  dispose(): EngineStatus;
}

interface QueuedCommand {
  readonly command: Command;
  readonly sequence: number;
}

// Build a finite public snapshot without exposing internal body or flight records.
function makeSnapshot(
  bodies: readonly MutableBodyState[], events: readonly SnapshotEvent[],
  tick: number, fixedTimeStepSeconds: number, userInteractionWorkJoules: number
): EngineResult<Snapshot> {
  const simulationTimeSeconds = tick * fixedTimeStepSeconds;
  const snapshotBodies: SnapshotBody[] = [];
  const projectileReadouts: ProjectileReadout[] = [];

  // Reject an unrepresentable public time before accepting the proposed tick.
  if (!Number.isFinite(simulationTimeSeconds)) {
    return failure(
      "NONFINITE_STATE", "simulationTimeSeconds",
      `Tick ${tick} would expose a nonfinite simulation time.`
    );
  }

  if (!Number.isFinite(userInteractionWorkJoules)) {
    return failure("NONFINITE_STATE", "userInteractionWorkJoules", `Tick ${tick} would expose nonfinite interaction work.`);
  }

  for (const body of bodies) {
    const position = body.pose.positionMeters;
    const velocity = body.velocity.linearMetersPerSecond;

    // Contact response and all other updates must leave public body values finite.
    if (
      !Number.isFinite(position.x) || !Number.isFinite(position.y) ||
      !Number.isFinite(body.pose.angleRadians) ||
      !Number.isFinite(velocity.x) || !Number.isFinite(velocity.y) ||
      !Number.isFinite(body.velocity.angularRadiansPerSecond)
    ) {
      return failure(
        "NONFINITE_STATE", "bodies",
        `Tick ${tick} would expose nonfinite state for body "${body.id}".`, body.id
      );
    }

    snapshotBodies.push({
      id: body.id,
      pose: {
        positionMeters: { ...position },
        angleRadians: body.pose.angleRadians
      },
      velocity: {
        linearMetersPerSecond: { ...velocity },
        angularRadiansPerSecond: body.velocity.angularRadiansPerSecond
      }
    });

    if (body.kind === "static") {
      continue;
    }

    // Hold the flight timer at first contact while position readouts remain current.
    let flightEndTimeSeconds = simulationTimeSeconds;

    if (body.flight.firstContactTimeSeconds !== undefined) {
      flightEndTimeSeconds = body.flight.firstContactTimeSeconds;
    }

    const flightTimeSeconds = flightEndTimeSeconds - body.flight.launchTick * fixedTimeStepSeconds;
    const horizontalDisplacementMeters = position.x - body.flight.launchPositionXMeters;

    // Finite positions can still produce an overflowing displacement.
    if (!Number.isFinite(flightTimeSeconds) || !Number.isFinite(horizontalDisplacementMeters)) {
      return failure(
        "NONFINITE_STATE", "projectileReadouts",
        `Tick ${tick} would expose a nonfinite readout for body "${body.id}".`, body.id
      );
    }

    projectileReadouts.push({
      bodyId: body.id,
      flightTimeSeconds,
      horizontalDisplacementMeters,
      heightMeters: position.y
    });
  }

  // Publish entity collections in stable ID order.
  snapshotBodies.sort((left, right) => left.id.localeCompare(right.id));
  projectileReadouts.sort((left, right) => left.bodyId.localeCompare(right.bodyId));

  return {
    ok: true,
    value: {
      contractVersion: 1,
      engineVersion: "0.0.0",
      engineBuild: "projectile-interactions-v1",
      tick,
      simulationTimeSeconds,
      bodies: snapshotBodies,
      projectileReadouts,
      userInteractionWorkJoules,
      events: structuredClone(events),
      diagnostics: []
    }
  };
}

function applyCommand(command: Command, bodies: MutableBodyState[]): void {
  const payload = command.payload;

  if (payload.kind !== "editBody" && payload.kind !== "launchBody") {
    return;
  }

  const body = bodies.find((candidate) => candidate.id === payload.bodyId);

  if (body === undefined) {
    return;
  }

  if (payload.kind === "launchBody") {
    body.pose.positionMeters = { ...payload.positionMeters };
    body.velocity = {
      linearMetersPerSecond: { ...payload.velocity.linearMetersPerSecond },
      angularRadiansPerSecond: payload.velocity.angularRadiansPerSecond
    };
    // An explicit launch starts a new measurement interval.
    if (body.kind === "dynamic") {
      body.flight = {
        launchTick: command.targetTick,
        launchPositionXMeters: payload.positionMeters.x,
        firstContactTimeSeconds: undefined
      };
    }
    return;
  }

  if (payload.changes.massKilograms !== undefined && body.kind === "dynamic") {
    body.massKilograms = payload.changes.massKilograms;
  }

  if (payload.changes.material !== undefined) {
    body.material = { ...payload.changes.material };
  }

  if (payload.changes.pose !== undefined) {
    body.pose = {
      positionMeters: { ...payload.changes.pose.positionMeters },
      angleRadians: payload.changes.pose.angleRadians
    };
  }

  if (payload.changes.velocity !== undefined) {
    body.velocity = {
      linearMetersPerSecond: { ...payload.changes.velocity.linearMetersPerSecond },
      angularRadiansPerSecond: payload.changes.velocity.angularRadiansPerSecond
    };
  }
}

// Keep each run's state private, with public operations as sibling methods.
class EngineInstance implements Engine {
  readonly #initialBodies: MutableBodyState[];
  readonly #settings: StepSettings;
  readonly #defaultMaximumForceNewtons: number;
  #interactions = new Map<string, ForceInteraction>();
  #userInteractionWorkJoules = 0;
  #bodies: MutableBodyState[];
  #insideTargetPairs: Set<string>;
  #currentEvents: SnapshotEvent[] = [];
  #tick = 0;
  #nextSequence = 0;
  #disposed = false;
  #pendingCommands: QueuedCommand[] = [];
  #acceptedCommandIds = new Set<string>();
  #borrowedSnapshot: Snapshot | undefined;

  constructor(scene: SceneDefinition) {
    this.#initialBodies = scene.bodies.map(createMutableBody);
    const scales = scene.numericalProfile.scales;
    let defaultMaximumForce = 100 * scales.massKilograms * scales.lengthMeters / scales.timeSeconds ** 2;

    // Recover a representable default when only an intermediate product overflowed.
    if (!Number.isFinite(defaultMaximumForce) || defaultMaximumForce <= 0) {
      defaultMaximumForce = Math.exp(
        Math.log(100) + Math.log(scales.massKilograms) + Math.log(scales.lengthMeters) -
        2 * Math.log(scales.timeSeconds)
      );
    }

    this.#defaultMaximumForceNewtons = defaultMaximumForce;

    const targets: TargetTrigger[] = [];

    for (const target of scene.triggers) {
      targets.push({
        id: target.id,
        kind: target.kind,
        shape: { ...target.shape },
        pose: {
          positionMeters: { ...target.pose.positionMeters },
          angleRadians: target.pose.angleRadians
        }
      });
    }

    targets.sort((left, right) => left.id.localeCompare(right.id));

    this.#settings = {
      fixedTimeStepSeconds: scene.numericalProfile.fixedTimeStepSeconds,
      substepCount: scene.numericalProfile.substeps,
      gravityMetersPerSecondSquared: { ...scene.environment.gravityMetersPerSecondSquared },
      linearDragKilogramsPerSecond: scene.environment.linearDragKilogramsPerSecond,
      targets
    };
    this.#bodies = cloneBodies(this.#initialBodies);
    this.#insideTargetPairs = collectInsideTargetPairs(this.#bodies, targets);

    // Preserve detached calls and callbacks supported by the original public functions.
    this.enqueue = this.enqueue.bind(this);
    this.advance = this.advance.bind(this);
    this.getSnapshot = this.getSnapshot.bind(this);
    this.copySnapshot = this.copySnapshot.bind(this);
    this.reset = this.reset.bind(this);
    this.dispose = this.dispose.bind(this);
  }

  // Schedule a copied command without changing authoritative physical state.
  enqueue(command: Command): EngineResult<CommandAcceptance> {
    const disposedFailure = this.#rejectIfDisposed();

    if (disposedFailure !== undefined) {
      return disposedFailure;
    }

    const commandFailure = validateCommand(command);

    if (commandFailure !== undefined) {
      return commandFailure;
    }

    if (this.#acceptedCommandIds.has(command.id)) {
      return failure("DUPLICATE_COMMAND_ID", "id", "Command ID has already been accepted.");
    }

    if (command.targetTick < this.#tick) {
      return failure("PAST_TARGET_TICK", "targetTick", "Command target tick is earlier than the current tick.");
    }

    if (command.payload.kind !== "endForceInteraction") {
      const bodyId = command.payload.bodyId;
      const targetBody = this.#bodies.find((body) => body.id === bodyId);

      if (targetBody === undefined) {
        return failure("UNKNOWN_ENTITY_ID", "payload.bodyId", `Body "${bodyId}" does not exist.`, bodyId);
      }

      if (
        targetBody.kind === "static" &&
        (command.payload.kind === "launchBody" || command.payload.kind === "setForceInteraction" ||
          (command.payload.kind === "editBody" &&
            (command.payload.changes.massKilograms !== undefined || command.payload.changes.velocity !== undefined)))
      ) {
        return failure("INVALID_BODY_KIND", "payload.bodyId", "This command requires a dynamic body.", targetBody.id);
      }

      if (
        command.payload.kind === "setForceInteraction" && command.payload.maximumForceNewtons === undefined &&
        (!Number.isFinite(this.#defaultMaximumForceNewtons) || this.#defaultMaximumForceNewtons <= 0)
      ) {
        return failure("OUT_OF_RANGE", "payload.maximumForceNewtons", "The scene-scale default is not positive and finite; supply an explicit force limit.", bodyId);
      }
    }

    const queued = {
      command: structuredClone(command),
      sequence: this.#nextSequence
    };
    this.#pendingCommands.push(queued);
    this.#pendingCommands.sort((left, right) => left.command.targetTick - right.command.targetTick || left.sequence - right.sequence);
    this.#acceptedCommandIds.add(command.id);
    this.#nextSequence += 1;

    return { ok: true, value: { sequence: queued.sequence } };
  }

  // Prepare, simulate, and commit one complete draft at a time.
  advance(tickCount: number): EngineResult<AdvanceReceipt> {
    const disposedFailure = this.#rejectIfDisposed();

    if (disposedFailure !== undefined) {
      return disposedFailure;
    }

    if (!Number.isSafeInteger(tickCount) || tickCount < 0) {
      return failure("INVALID_ADVANCE_COUNT", "tickCount", "Tick count must be a nonnegative safe integer.");
    }

    for (let stepIndex = 0; stepIndex < tickCount; stepIndex += 1) {
      const nextBodies = cloneBodies(this.#bodies);
      const nextInteractions = new Map(this.#interactions);
      const commandFailure = this.#applyScheduledCommands(nextBodies, nextInteractions);

      if (commandFailure !== undefined) {
        return commandFailure;
      }

      const step = simulateTick(nextBodies, this.#insideTargetPairs, this.#tick, this.#settings, nextInteractions, this.#userInteractionWorkJoules);

      if (!step.ok) {
        return step;
      }

      // Validate the observations before committing the proposed physical state.
      const nextSnapshot = makeSnapshot(
        nextBodies, step.value.events, this.#tick + 1, this.#settings.fixedTimeStepSeconds,
        step.value.userInteractionWorkJoules
      );

      if (!nextSnapshot.ok) {
        return nextSnapshot;
      }

      // Only a successful tick replaces the authoritative state and its observations.
      this.#bodies = nextBodies;
      this.#insideTargetPairs = step.value.insideTargetPairs;
      this.#currentEvents = step.value.events;
      this.#interactions = nextInteractions;
      this.#userInteractionWorkJoules = step.value.userInteractionWorkJoules;

      const remainingCommands: QueuedCommand[] = [];

      for (const queued of this.#pendingCommands) {
        if (queued.command.targetTick !== this.#tick) {
          remainingCommands.push(queued);
        }
      }

      this.#pendingCommands = remainingCommands;
      this.#tick += 1;
      this.#borrowedSnapshot = nextSnapshot.value;
    }

    return { ok: true, value: { lastValidTick: this.#tick } };
  }

  // Return the cached view until the next committed tick, reset, or disposal.
  getSnapshot(): EngineResult<Snapshot> {
    const disposedFailure = this.#rejectIfDisposed();

    if (disposedFailure !== undefined) {
      return disposedFailure;
    }

    if (this.#borrowedSnapshot === undefined) {
      const snapshot = makeSnapshot(
        this.#bodies, this.#currentEvents, this.#tick, this.#settings.fixedTimeStepSeconds,
        this.#userInteractionWorkJoules
      );

      if (!snapshot.ok) {
        return snapshot;
      }

      this.#borrowedSnapshot = snapshot.value;
    }

    return { ok: true, value: this.#borrowedSnapshot };
  }

  // Give history consumers a copy that outlives the cached view.
  copySnapshot(): EngineResult<Snapshot> {
    const snapshotResult = this.getSnapshot();

    if (!snapshotResult.ok) {
      return snapshotResult;
    }

    return { ok: true, value: structuredClone(snapshotResult.value) };
  }

  // Restore starting bodies and clear all command and physical history.
  reset(): EngineStatus {
    const disposedFailure = this.#rejectIfDisposed();

    if (disposedFailure !== undefined) {
      return disposedFailure;
    }

    this.#bodies = cloneBodies(this.#initialBodies);
    this.#insideTargetPairs = collectInsideTargetPairs(this.#bodies, this.#settings.targets);
    this.#currentEvents = [];
    this.#tick = 0;
    this.#nextSequence = 0;
    this.#pendingCommands = [];
    this.#interactions.clear();
    this.#userInteractionWorkJoules = 0;
    this.#acceptedCommandIds = new Set<string>();
    this.#borrowedSnapshot = undefined;

    return { ok: true };
  }

  // Release the run once and reject later operations through the public result type.
  dispose(): EngineStatus {
    if (this.#disposed) {
      return { ok: true };
    }

    this.#disposed = true;
    this.#pendingCommands = [];
    this.#interactions.clear();
    this.#acceptedCommandIds.clear();
    this.#insideTargetPairs.clear();
    this.#currentEvents = [];
    this.#borrowedSnapshot = undefined;

    return { ok: true };
  }

  // Apply due commands only to the draft, then check the resulting placement.
  #applyScheduledCommands(nextBodies: MutableBodyState[], nextInteractions: Map<string, ForceInteraction>): EngineFailure | undefined {
    let hasPlacementCommand = false;

    for (const queued of this.#pendingCommands) {
      if (queued.command.targetTick !== this.#tick) {
        continue;
      }

      const payload = queued.command.payload;

      if (payload.kind === "setForceInteraction") {
        nextInteractions.set(payload.interactionId, {
          ...payload,
          maximumForceNewtons: payload.maximumForceNewtons ?? this.#defaultMaximumForceNewtons
        });
        continue;
      }

      if (payload.kind === "endForceInteraction") {
        nextInteractions.delete(payload.interactionId);
        continue;
      }

      applyCommand(queued.command, nextBodies);

      if (payload.kind === "launchBody" || (payload.kind === "editBody" && payload.changes.pose !== undefined)) {
        hasPlacementCommand = true;
      }
    }

    if (hasPlacementCommand) {
      return validateBodyPlacements(nextBodies);
    }

    return undefined;
  }

  // Keep disposed checks consistent across every public operation.
  #rejectIfDisposed(): EngineFailure | undefined {
    if (!this.#disposed) {
      return undefined;
    }

    return failure("DISPOSED_ENGINE", "", "The engine has been disposed.");
  }
}

// Validate before construction so callers receive the existing typed creation result.
export function createEngine(scene: SceneDefinition): EngineResult<Engine> {
  const validation = validateScene(scene);

  if (!validation.ok) {
    return validation;
  }

  return { ok: true, value: new EngineInstance(scene) };
}
