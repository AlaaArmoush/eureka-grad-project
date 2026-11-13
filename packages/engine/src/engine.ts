import type { Command, SceneDefinition, Snapshot, SnapshotEvent, TargetTrigger } from "@eureka/contracts";

import { cloneBodies, createMutableBody, type MutableBodyState } from "./body-state.js";
import { failure, type EngineFailure, type EngineResult, type EngineStatus } from "./diagnostics.js";
import { collectInsideTargetPairs, simulateTick, type StepSettings } from "./stepping.js";
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

function makeSnapshot(bodies: readonly MutableBodyState[], events: readonly SnapshotEvent[], tick: number, fixedTimeStepSeconds: number): Snapshot {
  return {
    contractVersion: 1,
    engineVersion: "0.0.0",
    engineBuild: "projectile-contact-v1",
    tick,
    simulationTimeSeconds: tick * fixedTimeStepSeconds,
    bodies: bodies.map((body) => ({
      id: body.id,
      pose: {
        positionMeters: { ...body.pose.positionMeters },
        angleRadians: body.pose.angleRadians
      },
      velocity: {
        linearMetersPerSecond: { ...body.velocity.linearMetersPerSecond },
        angularRadiansPerSecond: body.velocity.angularRadiansPerSecond
      }
    })),
    projectileReadouts: [],
    events: structuredClone(events),
    diagnostics: []
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

    if (command.payload.kind === "setForceInteraction" || command.payload.kind === "endForceInteraction") {
      return failure("UNSUPPORTED_COMMAND", "payload.kind", "Force interactions are not supported by this engine yet.");
    }

    if (this.#acceptedCommandIds.has(command.id)) {
      return failure("DUPLICATE_COMMAND_ID", "id", "Command ID has already been accepted.");
    }

    if (command.targetTick < this.#tick) {
      return failure("PAST_TARGET_TICK", "targetTick", "Command target tick is earlier than the current tick.");
    }

    const bodyId = command.payload.bodyId;
    const targetBody = this.#bodies.find((body) => body.id === bodyId);

    if (targetBody === undefined) {
      return failure("UNKNOWN_ENTITY_ID", "payload.bodyId", `Body "${bodyId}" does not exist.`, bodyId);
    }

    if (
      targetBody.kind === "static" &&
      (command.payload.kind === "launchBody" ||
        (command.payload.kind === "editBody" &&
          (command.payload.changes.massKilograms !== undefined ||
            command.payload.changes.velocity !== undefined)))
    ) {
      return failure("INVALID_BODY_KIND", "payload.bodyId", "This command requires a dynamic body.", targetBody.id);
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
      const commandFailure = this.#applyScheduledCommands(nextBodies);

      if (commandFailure !== undefined) {
        return commandFailure;
      }

      const step = simulateTick(nextBodies, this.#insideTargetPairs, this.#tick, this.#settings);

      if (!step.ok) {
        return step;
      }

      // Only a successful tick replaces the authoritative state and its observations.
      this.#bodies = nextBodies;
      this.#insideTargetPairs = step.value.insideTargetPairs;
      this.#currentEvents = step.value.events;

      const remainingCommands: QueuedCommand[] = [];

      for (const queued of this.#pendingCommands) {
        if (queued.command.targetTick !== this.#tick) {
          remainingCommands.push(queued);
        }
      }

      this.#pendingCommands = remainingCommands;
      this.#tick += 1;
      this.#borrowedSnapshot = undefined;
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
      this.#borrowedSnapshot = makeSnapshot(this.#bodies, this.#currentEvents, this.#tick, this.#settings.fixedTimeStepSeconds);
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
    this.#acceptedCommandIds.clear();
    this.#insideTargetPairs.clear();
    this.#currentEvents = [];
    this.#borrowedSnapshot = undefined;

    return { ok: true };
  }

  // Apply due commands only to the draft, then check the resulting placement.
  #applyScheduledCommands(nextBodies: MutableBodyState[]): EngineFailure | undefined {
    let hasPlacementCommand = false;

    for (const queued of this.#pendingCommands) {
      if (queued.command.targetTick !== this.#tick) {
        continue;
      }

      applyCommand(queued.command, nextBodies);

      const payload = queued.command.payload;

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
