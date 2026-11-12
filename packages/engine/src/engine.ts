import type {
  Body,
  Command,
  Material,
  SceneDefinition,
  Snapshot,
  SnapshotEvent,
  TargetTrigger
} from "@eureka/contracts";

import {
  findStaticContactCandidate,
  findTargetEntryCandidate,
  isCircleInsideTarget,
  resolveStaticContactVelocity,
  surfaceContactGeometry,
  type StaticContactCandidate,
  type MovingCircleState
} from "./contacts.js";

import {
  failure,
  type EngineFailure,
  type EngineResult,
  type EngineStatus
} from "./diagnostics.js";
import { integrateSmoothMotion } from "./mechanics.js";
import { validateCommand, validateScene } from "./validation.js";

const MAXIMUM_EVENT_ADVANCES_PER_SUBSTEP = 8;
const EVENT_TIME_TOLERANCE_SECONDS = 1e-12;

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

// Give contact geometry only the projectile fields it needs.
function movingCircleState(body: MutableDynamicBody): MovingCircleState {
  return {
    id: body.id,
    radiusMeters: body.shape.radiusMeters,
    positionMeters: body.pose.positionMeters
  };
}

// Preserve an unambiguous identity for each projectile-target pair.
function targetPairKey(bodyId: string, targetId: string): string {
  return JSON.stringify([bodyId, targetId]);
}

function makeSnapshot(
  bodies: readonly MutableBodyState[],
  events: readonly SnapshotEvent[],
  tick: number,
  fixedTimeStepSeconds: number
): Snapshot {
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
        linearMetersPerSecond: {
          ...body.velocity.linearMetersPerSecond
        },
        angularRadiansPerSecond: body.velocity.angularRadiansPerSecond
      }
    })),
    projectileReadouts: [],
    events: structuredClone(events),
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

  // Keep engine-owned target copies in stable ID order.
  const targets: TargetTrigger[] = scene.triggers
    .map((target) => ({
      id: target.id,
      kind: target.kind,
      shape: { ...target.shape },
      pose: {
        positionMeters: { ...target.pose.positionMeters },
        angleRadians: target.pose.angleRadians
      }
    }))
    .sort((left, right) => left.id.localeCompare(right.id));

  const fixedTimeStepSeconds = scene.numericalProfile.fixedTimeStepSeconds;
  const substepCount = scene.numericalProfile.substeps;
  const internalTimeStepSeconds = fixedTimeStepSeconds / substepCount;

  const gravityAcceleration = { ...scene.environment.gravityMetersPerSecondSquared };

  const linearDragKilogramsPerSecond = scene.environment.linearDragKilogramsPerSecond;

  function collectInsideTargetPairs(
    currentBodies: readonly MutableBodyState[]
  ): Set<string> {
    const pairs = new Set<string>();

    for (const body of currentBodies) {
      if (body.kind !== "dynamic") {
        continue;
      }

      const circle = movingCircleState(body);

      for (const target of targets) {
        if (isCircleInsideTarget(circle, target)) {
          pairs.add(targetPairKey(body.id, target.id));
        }
      }
    }

    return pairs;
  }

  // Evaluate the existing smooth solver from a body's current state.
  function smoothMotion(
    body: MutableDynamicBody,
    timeStepSeconds: number
  ) {
    return integrateSmoothMotion({
      positionMeters: body.pose.positionMeters,
      velocityMetersPerSecond: body.velocity.linearMetersPerSecond,
      massKilograms: body.massKilograms,
      gravityMetersPerSecondSquared: gravityAcceleration,
      linearDragKilogramsPerSecond,
      timeStepSeconds
    });
  }

  let bodies = cloneBodies(initialBodies);
  let insideTargetPairs = collectInsideTargetPairs(bodies);
  let currentEvents: SnapshotEvent[] = [];
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
      const nextInsideTargetPairs = new Set(insideTargetPairs);
      const tickEvents: SnapshotEvent[] = [];

      // Apply commands scheduled for the current tick.
      for (const queued of pendingCommands) {
        if (queued.command.targetTick === tick) {
          applyCommand(queued.command, nextBodies);
        }
      }

      const staticSurfaces = nextBodies
        .filter((body): body is MutableStaticBody => body.kind === "static")
        .sort((left, right) => left.id.localeCompare(right.id));

      // Complete every fixed internal substep before committing the outer tick.
      for (let substepIndex = 0; substepIndex < substepCount; substepIndex += 1) {
        for (const body of nextBodies) {
          // Static bodies participate in commands but are not integrated.
          if (body.kind === "static") {
            continue;
          }

          let remainingTimeSeconds = internalTimeStepSeconds;
          let substepElapsedSeconds = 0;
          let eventAdvanceCount = 0;
          const handledSurfaceIds = new Set<string>();

          while (remainingTimeSeconds > EVENT_TIME_TOLERANCE_SECONDS) {
            const circle = movingCircleState(body);
            const velocity = body.velocity.linearMetersPerSecond;
            const maximumSpeedMetersPerSecond =
              Math.hypot(velocity.x, velocity.y) +
              Math.hypot(gravityAcceleration.x, gravityAcceleration.y) *
                remainingTimeSeconds;
            const positionAtTime = (timeSeconds: number) =>
              smoothMotion(body, timeSeconds).positionMeters;

            let earliestContact:
              | {
                readonly candidate: StaticContactCandidate;
                readonly surface: MutableStaticBody;
              }
              | undefined;

            // Select the first unhandled physical contact on this path segment.
            for (const surface of staticSurfaces) {
              if (handledSurfaceIds.has(surface.id)) {
                continue;
              }

              const candidate = findStaticContactCandidate(
                circle,
                surface,
                remainingTimeSeconds,
                positionAtTime,
                maximumSpeedMetersPerSecond
              );

              if (
                candidate !== undefined &&
                candidate.timeOffsetSeconds <= EVENT_TIME_TOLERANCE_SECONDS &&
                (
                  velocity.x * candidate.normal.x +
                  velocity.y * candidate.normal.y
                ) > 0
              ) {
                continue;
              }

              if (
                candidate !== undefined &&
                (
                  earliestContact === undefined ||
                  candidate.timeOffsetSeconds <
                    earliestContact.candidate.timeOffsetSeconds ||
                  (
                    Math.abs(
                      candidate.timeOffsetSeconds -
                        earliestContact.candidate.timeOffsetSeconds
                    ) <= EVENT_TIME_TOLERANCE_SECONDS &&
                    candidate.surfaceBodyId <
                      earliestContact.candidate.surfaceBodyId
                  )
                )
              ) {
                earliestContact = { candidate, surface };
              }
            }

            if (
              earliestContact !== undefined &&
              eventAdvanceCount >= MAXIMUM_EVENT_ADVANCES_PER_SUBSTEP
            ) {
              return failure(
                "UNRESOLVED_EVENT_LIMIT",
                "",
                (
                  `Advancing tick ${tick + 1} exceeded ` +
                  `${MAXIMUM_EVENT_ADVANCES_PER_SUBSTEP} event advances ` +
                  `for body "${body.id}".`
                ),
                body.id
              );
            }

            const segmentDurationSeconds =
              earliestContact?.candidate.timeOffsetSeconds ??
              remainingTimeSeconds;
            const segmentStartTimeSeconds =
              tick * fixedTimeStepSeconds +
              substepIndex * internalTimeStepSeconds +
              substepElapsedSeconds;

            // Sensors on this path emit events without partitioning the motion.
            for (const target of targets) {
              const pairKey = targetPairKey(body.id, target.id);

              if (
                nextInsideTargetPairs.has(pairKey) &&
                !isCircleInsideTarget(circle, target)
              ) {
                nextInsideTargetPairs.delete(pairKey);
              }

              if (nextInsideTargetPairs.has(pairKey)) {
                continue;
              }

              const candidate = findTargetEntryCandidate(
                circle,
                target,
                segmentDurationSeconds,
                positionAtTime,
                maximumSpeedMetersPerSecond
              );

              if (candidate === undefined) {
                continue;
              }

              const timeOffsetSeconds =
                earliestContact !== undefined &&
                Math.abs(
                  candidate.timeOffsetSeconds -
                    earliestContact.candidate.timeOffsetSeconds
                ) <= EVENT_TIME_TOLERANCE_SECONDS
                  ? earliestContact.candidate.timeOffsetSeconds
                  : candidate.timeOffsetSeconds;

              tickEvents.push({
                id:
                  `targetEntered:${tick + 1}:${tickEvents.length}:` +
                  `${candidate.bodyId}:${candidate.targetId}`,
                kind: "targetEntered",
                tick: tick + 1,
                timeSeconds: segmentStartTimeSeconds + timeOffsetSeconds,
                bodyId: candidate.bodyId,
                targetId: candidate.targetId
              });
              nextInsideTargetPairs.add(pairKey);
            }

            const nextMotion = smoothMotion(body, segmentDurationSeconds);
            const nextTimeSeconds = (tick + 1) * fixedTimeStepSeconds;

            // Any failure discards this outer tick and all proposed events.
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

            body.pose.positionMeters.x = nextMotion.positionMeters.x;
            body.pose.positionMeters.y = nextMotion.positionMeters.y;
            body.velocity.linearMetersPerSecond.x =
              nextMotion.velocityMetersPerSecond.x;
            body.velocity.linearMetersPerSecond.y =
              nextMotion.velocityMetersPerSecond.y;

            if (earliestContact !== undefined) {
              const { candidate, surface } = earliestContact;

              // Snap roundoff-sized localization error to exact tangency.
              body.pose.positionMeters.x =
                candidate.pointMeters.x +
                candidate.normal.x * body.shape.radiusMeters;
              body.pose.positionMeters.y =
                candidate.pointMeters.y +
                candidate.normal.y * body.shape.radiusMeters;

              tickEvents.push({
                id:
                  `groundContact:${tick + 1}:${tickEvents.length}:` +
                  `${candidate.bodyId}:${candidate.surfaceBodyId}`,
                kind: "groundContact",
                tick: tick + 1,
                timeSeconds:
                  segmentStartTimeSeconds + candidate.timeOffsetSeconds,
                bodyId: candidate.bodyId,
                surfaceBodyId: candidate.surfaceBodyId,
                pointMeters: { ...candidate.pointMeters },
                normal: { ...candidate.normal }
              });

              const resolvedVelocity = resolveStaticContactVelocity(
                body.velocity.linearMetersPerSecond,
                candidate.normal,
                body.material.restitution,
                surface.material.restitution
              );
              body.velocity.linearMetersPerSecond.x = resolvedVelocity.x;
              body.velocity.linearMetersPerSecond.y = resolvedVelocity.y;
              handledSurfaceIds.add(surface.id);
              eventAdvanceCount += 1;
            } else {
              // Keep a zero-restitution support from accumulating penetration.
              for (const surface of staticSurfaces) {
                if (!handledSurfaceIds.has(surface.id)) {
                  continue;
                }

                const geometry = surfaceContactGeometry(
                  movingCircleState(body),
                  surface
                );

                if (geometry.clearanceMeters < 0) {
                  body.pose.positionMeters.x -=
                    geometry.clearanceMeters * geometry.normal.x;
                  body.pose.positionMeters.y -=
                    geometry.clearanceMeters * geometry.normal.y;

                  const inwardSpeed =
                    body.velocity.linearMetersPerSecond.x *
                      geometry.normal.x +
                    body.velocity.linearMetersPerSecond.y *
                      geometry.normal.y;

                  if (inwardSpeed < 0) {
                    body.velocity.linearMetersPerSecond.x -=
                      inwardSpeed * geometry.normal.x;
                    body.velocity.linearMetersPerSecond.y -=
                      inwardSpeed * geometry.normal.y;
                  }
                }
              }
            }

            // Endpoint membership controls later target-entry suppression.
            const updatedCircle = movingCircleState(body);

            for (const target of targets) {
              const pairKey = targetPairKey(body.id, target.id);

              if (isCircleInsideTarget(updatedCircle, target)) {
                nextInsideTargetPairs.add(pairKey);
              } else {
                nextInsideTargetPairs.delete(pairKey);
              }
            }

            substepElapsedSeconds += segmentDurationSeconds;
            remainingTimeSeconds = Math.max(
              0,
              remainingTimeSeconds - segmentDurationSeconds
            );

            if (earliestContact === undefined) {
              break;
            }
          }
        }
      }

      // Keep events deterministic, with targets before contacts at equal TOI.
      tickEvents.sort((left, right) => {
        if (left.timeSeconds !== right.timeSeconds) {
          return left.timeSeconds - right.timeSeconds;
        }

        if (left.bodyId !== right.bodyId) {
          return left.bodyId.localeCompare(right.bodyId);
        }

        if (left.kind !== right.kind) {
          return left.kind === "targetEntered" ? -1 : 1;
        }

        const leftFeatureId = left.kind === "targetEntered"
          ? left.targetId
          : left.surfaceBodyId;
        const rightFeatureId = right.kind === "targetEntered"
          ? right.targetId
          : right.surfaceBodyId;

        return leftFeatureId.localeCompare(rightFeatureId);
      });

      // Accept the checked state, pair lifecycle, and events together.
      bodies = nextBodies;
      insideTargetPairs = nextInsideTargetPairs;
      currentEvents = tickEvents;

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
        currentEvents,
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
    insideTargetPairs = collectInsideTargetPairs(bodies);
    currentEvents = [];
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
    insideTargetPairs.clear();
    currentEvents = [];
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
