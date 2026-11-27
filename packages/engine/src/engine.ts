import type { Command, CommandPayload, NumericalProfile, ProjectileReadout, SceneDefinition, Snapshot, SnapshotBody, SnapshotEvent, TargetTrigger } from "@eureka/contracts";

import { cloneBodies, createMutableBody, describeBody, type MutableBodyState } from "./body-state.js";
import { failure, type EngineFailure, type EngineResult, type EngineStatus } from "./diagnostics.js";
import { collectInsideTargetPairs, refreshTargetMembership, simulateTick, type StepSettings } from "./stepping.js";
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
  copyScene(): EngineResult<SceneDefinition>;
  setInitialScene(scene: SceneDefinition): EngineStatus;
  reset(): EngineStatus;
  dispose(): EngineStatus;
}

interface QueuedCommand {
  readonly command: Command;
  readonly sequence: number;
}

type Environment = SceneDefinition["environment"];

// Everything a command can change. A tick works on a copy and commits it only on success.
interface WorldState {
  bodies: MutableBodyState[];
  targets: TargetTrigger[];
  environment: Environment;
  interactions: Map<string, ForceInteraction>;
  insideTargetPairs: Set<string>;
}

interface AppliedChanges {
  readonly placed: Set<string>;
  readonly membership: Set<string>;
  readonly removed: Set<string>;
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

function copyTarget(target: TargetTrigger): TargetTrigger {
  return {
    id: target.id,
    kind: target.kind,
    shape: { ...target.shape },
    pose: { positionMeters: { ...target.pose.positionMeters }, angleRadians: target.pose.angleRadians }
  };
}

function copyEnvironment(environment: Environment): Environment {
  return {
    gravityMetersPerSecondSquared: { ...environment.gravityMetersPerSecondSquared },
    linearDragKilogramsPerSecond: environment.linearDragKilogramsPerSecond
  };
}

function createWorld(scene: SceneDefinition): WorldState {
  const bodies = scene.bodies.map((body) => createMutableBody(body));
  const targets = scene.triggers.map(copyTarget);

  return {
    bodies,
    targets,
    environment: copyEnvironment(scene.environment),
    interactions: new Map(),
    insideTargetPairs: collectInsideTargetPairs(bodies, targets)
  };
}

function sameProfile(left: NumericalProfile, right: NumericalProfile): boolean {
  return left.fixedTimeStepSeconds === right.fixedTimeStepSeconds &&
    left.substeps === right.substeps &&
    left.scales.lengthMeters === right.scales.lengthMeters &&
    left.scales.massKilograms === right.scales.massKilograms &&
    left.scales.timeSeconds === right.scales.timeSeconds;
}

// The existing entity a command acts on, if any.
function referencedEntityId(payload: CommandPayload): string | undefined {
  switch (payload.kind) {
    case "editBody":
    case "launchBody":
    case "setForceInteraction":
      return payload.bodyId;
    case "editTarget":
      return payload.targetId;
    case "removeEntity":
      return payload.entityId;
    default:
      return undefined;
  }
}

function hasEntity(world: WorldState, id: string): boolean {
  return world.bodies.some((body) => body.id === id) || world.targets.some((target) => target.id === id);
}

// Check a command's references against a world without changing it.
function findReferenceFailure(payload: CommandPayload, world: WorldState, defaultForceUsable: boolean): EngineFailure | undefined {
  switch (payload.kind) {
    case "endForceInteraction":
    case "setEnvironment":
      return undefined;

    case "addEntity":
      return hasEntity(world, payload.entity.id)
        ? failure("DUPLICATE_ENTITY_ID", "payload.entity.id", `Entity ID "${payload.entity.id}" already exists.`, payload.entity.id)
        : undefined;

    case "removeEntity":
      return hasEntity(world, payload.entityId)
        ? undefined
        : failure("UNKNOWN_ENTITY_ID", "payload.entityId", `Entity "${payload.entityId}" does not exist.`, payload.entityId);

    case "editTarget":
      return world.targets.some((target) => target.id === payload.targetId)
        ? undefined
        : failure("UNKNOWN_ENTITY_ID", "payload.targetId", `Target "${payload.targetId}" does not exist.`, payload.targetId);

    default:
      break;
  }

  const bodyId = payload.bodyId;
  const targetBody = world.bodies.find((body) => body.id === bodyId);

  if (targetBody === undefined) {
    return failure("UNKNOWN_ENTITY_ID", "payload.bodyId", `Body "${bodyId}" does not exist.`, bodyId);
  }

  if (
    targetBody.kind === "static" &&
    (payload.kind === "launchBody" || payload.kind === "setForceInteraction" ||
      (payload.kind === "editBody" && (payload.changes.massKilograms !== undefined || payload.changes.velocity !== undefined)))
  ) {
    return failure("INVALID_BODY_KIND", "payload.bodyId", "This command requires a dynamic body.", targetBody.id);
  }

  if (payload.kind === "editBody" && payload.changes.shape !== undefined && payload.changes.shape.kind !== targetBody.shape.kind) {
    return failure("INVALID_BODY_KIND", "payload.changes.shape", "The shape must match the body's kind.", targetBody.id);
  }

  if (payload.kind === "setForceInteraction" && payload.maximumForceNewtons === undefined && !defaultForceUsable) {
    return failure("OUT_OF_RANGE", "payload.maximumForceNewtons", "The scene-scale default is not positive and finite; supply an explicit force limit.", bodyId);
  }

  return undefined;
}

function applyBodyCommand(command: Command, world: WorldState, changes: AppliedChanges): void {
  const payload = command.payload;

  if (payload.kind !== "editBody" && payload.kind !== "launchBody") {
    return;
  }

  const body = world.bodies.find((candidate) => candidate.id === payload.bodyId);

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
    changes.placed.add(body.id);
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
    changes.placed.add(body.id);
  }

  if (payload.changes.velocity !== undefined) {
    body.velocity = {
      linearMetersPerSecond: { ...payload.changes.velocity.linearMetersPerSecond },
      angularRadiansPerSecond: payload.changes.velocity.angularRadiansPerSecond
    };
  }

  const shape = payload.changes.shape;

  if (shape !== undefined) {
    if (body.kind === "dynamic" && shape.kind === "circle") {
      body.shape = { ...shape };
    } else if (body.kind === "static" && shape.kind === "box") {
      body.shape = { ...shape };
    }

    changes.placed.add(body.id);
    changes.membership.add(body.id);
  }
}

// Keep each run's state private, with public operations as sibling methods.
class EngineInstance implements Engine {
  // The committed start: Reset rebuilds the world from it.
  #scene: SceneDefinition;
  readonly #defaultMaximumForceNewtons: number;
  #world: WorldState;
  #userInteractionWorkJoules = 0;
  #currentEvents: SnapshotEvent[] = [];
  #tick = 0;
  #nextSequence = 0;
  #disposed = false;
  #pendingCommands: QueuedCommand[] = [];
  #acceptedCommandIds = new Set<string>();
  #borrowedSnapshot: Snapshot | undefined;

  constructor(scene: SceneDefinition) {
    this.#scene = structuredClone(scene);
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
    this.#world = createWorld(this.#scene);

    // Preserve detached calls and callbacks supported by the original public functions.
    this.enqueue = this.enqueue.bind(this);
    this.advance = this.advance.bind(this);
    this.getSnapshot = this.getSnapshot.bind(this);
    this.copySnapshot = this.copySnapshot.bind(this);
    this.copyScene = this.copyScene.bind(this);
    this.setInitialScene = this.setInitialScene.bind(this);
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

    // A command for the current boundary is tried on a copy with the commands already due there.
    if (command.targetTick === this.#tick) {
      const projection = this.#applyCommands(this.#copyWorld(), [...this.#dueCommands(), command]);

      if (!projection.ok) {
        return projection;
      }
    } else {
      const referenceFailure = findReferenceFailure(command.payload, this.#world, this.#defaultForceUsable());

      if (referenceFailure !== undefined) {
        return referenceFailure;
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
      const draft = this.#copyWorld();
      const applied = this.#applyCommands(draft, this.#dueCommands());

      if (!applied.ok) {
        return applied;
      }

      const step = simulateTick(draft.bodies, draft.insideTargetPairs, this.#tick, this.#stepSettings(draft), draft.interactions, this.#userInteractionWorkJoules);

      if (!step.ok) {
        return step;
      }

      // Validate the observations before committing the proposed physical state.
      const nextSnapshot = makeSnapshot(
        draft.bodies, step.value.events, this.#tick + 1, this.#scene.numericalProfile.fixedTimeStepSeconds,
        step.value.userInteractionWorkJoules
      );

      if (!nextSnapshot.ok) {
        return nextSnapshot;
      }

      // Only a successful tick replaces the authoritative state and its observations.
      draft.insideTargetPairs = step.value.insideTargetPairs;
      this.#world = draft;
      this.#currentEvents = step.value.events;
      this.#userInteractionWorkJoules = step.value.userInteractionWorkJoules;

      const removedIds = applied.value;

      // Later commands for a removed entity have nothing left to act on.
      this.#pendingCommands = this.#pendingCommands.filter((queued) => {
        const referencedId = referencedEntityId(queued.command.payload);
        return queued.command.targetTick !== this.#tick && (referencedId === undefined || !removedIds.has(referencedId));
      });
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
        this.#world.bodies, this.#currentEvents, this.#tick, this.#scene.numericalProfile.fixedTimeStepSeconds,
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

  copyScene(): EngineResult<SceneDefinition> {
    const disposedFailure = this.#rejectIfDisposed();

    if (disposedFailure !== undefined) {
      return disposedFailure;
    }

    return {
      ok: true,
      value: {
        schemaVersion: 1,
        id: this.#scene.id,
        revision: this.#scene.revision,
        seed: this.#scene.seed,
        numericalProfile: structuredClone(this.#scene.numericalProfile),
        environment: copyEnvironment(this.#world.environment),
        bodies: this.#world.bodies.map(describeBody),
        triggers: this.#world.targets.map(copyTarget)
      }
    };
  }

  setInitialScene(scene: SceneDefinition): EngineStatus {
    const disposedFailure = this.#rejectIfDisposed();

    if (disposedFailure !== undefined) {
      return disposedFailure;
    }

    if (this.#tick !== 0 || this.#pendingCommands.length > 0) {
      return failure("RUN_IN_PROGRESS", "tick", "The starting scene can change only at tick 0 with no queued commands; reset first.");
    }

    const validation = validateScene(scene);

    if (!validation.ok) {
      return validation;
    }

    if (scene.id !== this.#scene.id) {
      return failure("SOURCE_CHANGED", "id", "A different scene needs a new engine.");
    }

    if (scene.seed !== this.#scene.seed) {
      return failure("SOURCE_CHANGED", "seed", "A different seed needs a new engine.");
    }

    if (!sameProfile(scene.numericalProfile, this.#scene.numericalProfile)) {
      return failure("SOURCE_CHANGED", "numericalProfile", "A different numerical profile needs a new engine.");
    }

    this.#scene = structuredClone(scene);
    this.#restart();
    return { ok: true };
  }

  // Restore the start and clear all command and physical history.
  reset(): EngineStatus {
    const disposedFailure = this.#rejectIfDisposed();

    if (disposedFailure !== undefined) {
      return disposedFailure;
    }

    this.#restart();
    return { ok: true };
  }

  // Release the run once and reject later operations through the public result type.
  dispose(): EngineStatus {
    if (this.#disposed) {
      return { ok: true };
    }

    this.#disposed = true;
    this.#pendingCommands = [];
    this.#world.interactions.clear();
    this.#world.insideTargetPairs.clear();
    this.#acceptedCommandIds.clear();
    this.#currentEvents = [];
    this.#borrowedSnapshot = undefined;

    return { ok: true };
  }

  #restart(): void {
    this.#world = createWorld(this.#scene);
    this.#currentEvents = [];
    this.#tick = 0;
    this.#nextSequence = 0;
    this.#pendingCommands = [];
    this.#userInteractionWorkJoules = 0;
    this.#acceptedCommandIds = new Set<string>();
    this.#borrowedSnapshot = undefined;
  }

  #copyWorld(): WorldState {
    return {
      bodies: cloneBodies(this.#world.bodies),
      // Targets and the environment are replaced, never changed in place, so sharing them is safe.
      targets: [...this.#world.targets],
      environment: this.#world.environment,
      interactions: new Map(this.#world.interactions),
      insideTargetPairs: new Set(this.#world.insideTargetPairs)
    };
  }

  #dueCommands(): Command[] {
    return this.#pendingCommands.filter((queued) => queued.command.targetTick === this.#tick).map((queued) => queued.command);
  }

  #defaultForceUsable(): boolean {
    return Number.isFinite(this.#defaultMaximumForceNewtons) && this.#defaultMaximumForceNewtons > 0;
  }

  #stepSettings(world: WorldState): StepSettings {
    return {
      fixedTimeStepSeconds: this.#scene.numericalProfile.fixedTimeStepSeconds,
      substepCount: this.#scene.numericalProfile.substeps,
      gravityMetersPerSecondSquared: world.environment.gravityMetersPerSecondSquared,
      linearDragKilogramsPerSecond: world.environment.linearDragKilogramsPerSecond,
      targets: [...world.targets].sort((left, right) => left.id.localeCompare(right.id))
    };
  }

  // Apply commands in order to a draft world; returns the removed IDs, or the first failure.
  #applyCommands(world: WorldState, commands: readonly Command[]): EngineResult<ReadonlySet<string>> {
    const changes: AppliedChanges = { placed: new Set(), membership: new Set(), removed: new Set() };

    for (const command of commands) {
      const referenceFailure = findReferenceFailure(command.payload, world, this.#defaultForceUsable());

      if (referenceFailure !== undefined) {
        return referenceFailure;
      }

      this.#applyCommand(command, world, changes);
    }

    if (changes.placed.size > 0) {
      const placementFailure = validateBodyPlacements(world.bodies, changes.placed);

      if (placementFailure !== undefined) {
        return placementFailure;
      }
    }

    if (changes.membership.size > 0) {
      refreshTargetMembership(world.insideTargetPairs, world.bodies, world.targets, changes.membership);
    }

    return { ok: true, value: changes.removed };
  }

  #applyCommand(command: Command, world: WorldState, changes: AppliedChanges): void {
    const payload = command.payload;

    switch (payload.kind) {
      case "setForceInteraction":
        world.interactions.set(payload.interactionId, {
          ...payload,
          maximumForceNewtons: payload.maximumForceNewtons ?? this.#defaultMaximumForceNewtons
        });
        return;

      case "endForceInteraction":
        world.interactions.delete(payload.interactionId);
        return;

      case "setEnvironment":
        world.environment = copyEnvironment(payload.environment);
        return;

      case "addEntity": {
        const entity = payload.entity;

        if (entity.kind === "target") {
          world.targets.push(copyTarget(entity));
        } else {
          world.bodies.push(createMutableBody(entity, command.targetTick));
          changes.placed.add(entity.id);
        }

        changes.membership.add(entity.id);
        return;
      }

      case "removeEntity": {
        const id = payload.entityId;
        world.bodies = world.bodies.filter((body) => body.id !== id);
        world.targets = world.targets.filter((target) => target.id !== id);

        for (const [interactionId, interaction] of world.interactions) {
          if (interaction.bodyId === id) {
            world.interactions.delete(interactionId);
          }
        }

        changes.membership.add(id);
        changes.removed.add(id);
        return;
      }

      case "editTarget": {
        const index = world.targets.findIndex((target) => target.id === payload.targetId);
        const current = world.targets[index];

        if (current === undefined) {
          return;
        }

        world.targets[index] = copyTarget({
          ...current,
          pose: payload.changes.pose ?? current.pose,
          shape: payload.changes.shape ?? current.shape
        });
        changes.membership.add(current.id);
        return;
      }

      default:
        applyBodyCommand(command, world, changes);
    }
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
