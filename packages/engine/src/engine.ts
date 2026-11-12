import type {
  Body,
  Command,
  Material,
  SceneDefinition,
  Snapshot
} from "@eureka/contracts";

import {
  failure,
  type EngineFailure,
  type EngineResult,
  type EngineStatus
} from "./diagnostics.js";
import { integrateSmoothMotion } from "./mechanics.js";
import { validateCommand, validateScene } from "./validation.js";

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

interface MutableBodyBase {
  readonly id: string;
  material: Material;
  pose: {
    positionMeters: {
      x: number;
      y: number;
    };
    angleRadians: number;
  };
  velocity: {
    linearMetersPerSecond: {
      x: number;
      y: number;
    };
    angularRadiansPerSecond: number;
  };
}

interface MutableDynamicBody extends MutableBodyBase {
  readonly kind: "dynamic";
  readonly shape: {
    readonly kind: "circle";
    readonly radiusMeters: number;
  };
  massKilograms: number;
}

interface MutableStaticBody extends MutableBodyBase {
  readonly kind: "static";
  readonly shape: {
    readonly kind: "box";
    readonly widthMeters: number;
    readonly heightMeters: number;
  };
}

type MutableBodyState = MutableDynamicBody | MutableStaticBody;

interface QueuedCommand {
  readonly command: Command;
  readonly sequence: number;
}

function createMutableBody(body: Body): MutableBodyState {
  const sharedState = {
    id: body.id,
    material: { ...body.material },
    pose: {
      positionMeters: { ...body.pose.positionMeters },
      angleRadians: body.pose.angleRadians
    }
  };

  if (body.kind === "dynamic") {
    return {
      ...sharedState,
      kind: "dynamic",
      shape: { ...body.shape },
      massKilograms: body.massKilograms,
      velocity: {
        linearMetersPerSecond: {
          ...body.velocity.linearMetersPerSecond
        },
        angularRadiansPerSecond: body.velocity.angularRadiansPerSecond
      }
    };
  }

  return {
    ...sharedState,
    kind: "static",
    shape: { ...body.shape },
    velocity: {
      linearMetersPerSecond: { x: 0, y: 0 },
      angularRadiansPerSecond: 0
    }
  };
}

// Copy each body so a tick can change it freely and throw it away if something fails.
function cloneBodies(bodies: readonly MutableBodyState[]): MutableBodyState[] {
  return bodies.map((body) => {
    const sharedState = {
      id: body.id,
      material: { ...body.material },
      pose: {
        positionMeters: { ...body.pose.positionMeters },
        angleRadians: body.pose.angleRadians
      },
      velocity: {
        linearMetersPerSecond: {
          ...body.velocity.linearMetersPerSecond
        },
        angularRadiansPerSecond: body.velocity.angularRadiansPerSecond
      }
    };

    if (body.kind === "dynamic") {
      return {
        ...sharedState,
        kind: "dynamic",
        shape: { ...body.shape },
        massKilograms: body.massKilograms
      };
    }

    return {
      ...sharedState,
      kind: "static",
      shape: { ...body.shape }
    };
  });
}

function makeSnapshot(
  bodies: readonly MutableBodyState[],
  tick: number,
  fixedTimeStepSeconds: number
): Snapshot {
  return {
    contractVersion: 1,
    engineVersion: "0.0.0",
    engineBuild: "linear-drag-v1",
    tick,
    simulationTimeSeconds: tick * fixedTimeStepSeconds,
    bodies: bodies.map((body) => ({
      id: body.id,
      pose: {
        positionMeters: { ...body.pose.positionMeters },
        angleRadians: body.pose.angleRadians
      },
      velocity: {
        linearMetersPerSecond: {
          ...body.velocity.linearMetersPerSecond
        },
        angularRadiansPerSecond: body.velocity.angularRadiansPerSecond
      }
    })),
    projectileReadouts: [],
    events: [],
    diagnostics: []
  };
}

function referencedBodyId(command: Command): string | undefined {
  switch (command.payload.kind) {
    case "editBody":
    case "launchBody":
    case "setForceInteraction":
      return command.payload.bodyId;
    case "endForceInteraction":
      return undefined;
  }
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

export function createEngine(scene: SceneDefinition): EngineResult<Engine> {
  const validation = validateScene(scene);

  if (!validation.ok) {
    return validation;
  }

  const initialBodies = scene.bodies.map(createMutableBody);

  const fixedTimeStepSeconds = scene.numericalProfile.fixedTimeStepSeconds;
  const substepCount = scene.numericalProfile.substeps;
  const internalTimeStepSeconds = fixedTimeStepSeconds / substepCount;

  const gravityAcceleration = { ...scene.environment.gravityMetersPerSecondSquared };

  const linearDragKilogramsPerSecond = scene.environment.linearDragKilogramsPerSecond;

  let bodies = cloneBodies(initialBodies);
  let tick = 0;
  let nextSequence = 0;
  let disposed = false;
  let pendingCommands: QueuedCommand[] = [];
  let acceptedCommandIds = new Set<string>();
  let borrowedSnapshot: Snapshot | undefined;

  function rejectIfDisposed(): EngineFailure | undefined {
    return disposed
      ? failure("DISPOSED_ENGINE", "", "The engine has been disposed.")
      : undefined;
  }

  function enqueue(command: Command): EngineResult<CommandAcceptance> {
    const disposedFailure = rejectIfDisposed();

    if (disposedFailure !== undefined) {
      return disposedFailure;
    }

    const commandFailure = validateCommand(command);

    if (commandFailure !== undefined) {
      return commandFailure;
    }

    if (
      command.payload.kind === "setForceInteraction" ||
      command.payload.kind === "endForceInteraction"
    ) {
      return failure(
        "UNSUPPORTED_COMMAND",
        "payload.kind",
        "Force interactions are frozen in the contract but implemented at Topic 1."
      );
    }

    if (acceptedCommandIds.has(command.id)) {
      return failure(
        "DUPLICATE_COMMAND_ID",
        "id",
        "Command ID has already been accepted."
      );
    }

    if (command.targetTick < tick) {
      return failure(
        "PAST_TARGET_TICK",
        "targetTick",
        "Command target tick is earlier than the current tick."
      );
    }

    const bodyId = referencedBodyId(command);
    const targetBody = bodyId === undefined
      ? undefined
      : bodies.find((body) => body.id === bodyId);

    if (bodyId !== undefined && targetBody === undefined) {
      return failure(
        "UNKNOWN_ENTITY_ID",
        "payload.bodyId",
        `Body "${bodyId}" does not exist.`,
        bodyId
      );
    }

    if (
      targetBody?.kind === "static" &&
      (command.payload.kind === "launchBody" ||
        (command.payload.kind === "editBody" &&
          (command.payload.changes.massKilograms !== undefined ||
            command.payload.changes.velocity !== undefined)))
    ) {
      return failure(
        "INVALID_BODY_KIND",
        "payload.bodyId",
        "This command requires a dynamic body.",
        targetBody.id
      );
    }

    const queued = {
      command: structuredClone(command),
      sequence: nextSequence
    };
    pendingCommands.push(queued);
    pendingCommands.sort(
      (left, right) =>
        left.command.targetTick - right.command.targetTick ||
        left.sequence - right.sequence
    );
    acceptedCommandIds.add(command.id);
    nextSequence += 1;

    return { ok: true, value: { sequence: queued.sequence } };
  }

  function advance(tickCount: number): EngineResult<AdvanceReceipt> {
    const disposedFailure = rejectIfDisposed();

    if (disposedFailure !== undefined) {
      return disposedFailure;
    }

    // Require a whole nonnegative number of ticks
    if (!Number.isSafeInteger(tickCount) || tickCount < 0) {
      return failure(
        "INVALID_ADVANCE_COUNT",
        "tickCount",
        "Tick count must be a nonnegative safe integer."
      );
    }

    // Each tick is all-or-nothing: build and check a copy before accepting it.
    for (let stepIndex = 0; stepIndex < tickCount; stepIndex += 1) {
      const nextBodies = cloneBodies(bodies);

      // Apply commands scheduled for the current tick.
      for (const queued of pendingCommands) {
        if (queued.command.targetTick === tick) {
          applyCommand(queued.command, nextBodies);
        }
      }

      // Complete every fixed internal substep before committing the outer tick.
      for (let substepIndex = 0; substepIndex < substepCount; substepIndex += 1) {
        for (const body of nextBodies) {
          // Static bodies participate in commands but are not integrated.
          if (body.kind === "static") {
            continue;
          }

          const velocity = body.velocity.linearMetersPerSecond;
          const position = body.pose.positionMeters;

          const nextMotion = integrateSmoothMotion({
            positionMeters: position,
            velocityMetersPerSecond: velocity,
            massKilograms: body.massKilograms,
            gravityMetersPerSecondSquared: gravityAcceleration,
            linearDragKilogramsPerSecond,
            timeStepSeconds: internalTimeStepSeconds
          });

          const nextTimeSeconds = (tick + 1) * fixedTimeStepSeconds;

          // Reject the disposable tick copy if integration becomes nonfinite.
          if (
            !Number.isFinite(nextMotion.positionMeters.x) ||
            !Number.isFinite(nextMotion.positionMeters.y) ||
            !Number.isFinite(nextMotion.velocityMetersPerSecond.x) ||
            !Number.isFinite(nextMotion.velocityMetersPerSecond.y) ||
            !Number.isFinite(nextTimeSeconds)
          ) {
            return failure(
              "NONFINITE_STATE",
              "",
              `Advancing tick ${tick + 1} produced a nonfinite value.`
            );
          }

          position.x = nextMotion.positionMeters.x;
          position.y = nextMotion.positionMeters.y;
          velocity.x = nextMotion.velocityMetersPerSecond.x;
          velocity.y = nextMotion.velocityMetersPerSecond.y;
        }
      }

      // Accept the checked state and move to the next tick.
      bodies = nextBodies;

      // Remove commands that were consumed during this tick.
      pendingCommands = pendingCommands.filter(
        (queued) => queued.command.targetTick !== tick
      );
      tick += 1;

      // Clear the cached snapshot because the engine state has changed.
      borrowedSnapshot = undefined;
    }

    return { ok: true, value: { lastValidTick: tick } };
  }

  function getSnapshot(): EngineResult<Snapshot> {
    const disposedFailure = rejectIfDisposed();

    if (disposedFailure !== undefined) {
      return disposedFailure;
    }

    // Create a snapshot only when the cache is empty.
    if (borrowedSnapshot === undefined) {
      borrowedSnapshot = makeSnapshot(
        bodies,
        tick,
        fixedTimeStepSeconds
      );
    }

    return { ok: true, value: borrowedSnapshot };
  }

  // getSnapshot is used for immediate rendering, this copy is used for history and saving.
  function copySnapshot(): EngineResult<Snapshot> {
    const snapshotResult = getSnapshot();

    if (!snapshotResult.ok) {
      return snapshotResult;
    }

    return { ok: true, value: structuredClone(snapshotResult.value) };
  }

  function reset(): EngineStatus {
    const disposedFailure = rejectIfDisposed();

    if (disposedFailure !== undefined) {
      return disposedFailure;
    }

    bodies = cloneBodies(initialBodies);
    tick = 0;
    nextSequence = 0;
    pendingCommands = [];
    acceptedCommandIds = new Set<string>();
    borrowedSnapshot = undefined;
    return { ok: true };
  }

  // Use when leaving the lab or replacing the simulation so the old engine cannot keep running.
  function dispose(): EngineStatus {
    if (disposed) {
      return { ok: true };
    }

    disposed = true;
    pendingCommands = [];
    acceptedCommandIds.clear();
    borrowedSnapshot = undefined;
    return { ok: true };
  }

  return {
    ok: true,
    value: {
      enqueue,
      advance,
      getSnapshot,
      copySnapshot,
      reset,
      dispose
    }
  };
}
