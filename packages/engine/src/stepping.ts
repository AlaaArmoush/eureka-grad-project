// Coordinate one draft tick without owning the engine's queue or committed state.
import type { SnapshotEvent, TargetTrigger, Vector2 } from "@eureka/contracts";

import type { MutableBodyState, MutableDynamicBody, MutableStaticBody } from "./body-state.js";
import {
  findStaticContactCandidate, findTargetEntryCandidate, isCircleInsideTarget,
  resolveStaticContactVelocity, surfaceContactGeometry,
  type MovingCircleState, type StaticContactCandidate
} from "./contacts.js";
import { failure, type EngineFailure, type EngineResult } from "./diagnostics.js";
import { integrateSmoothMotion, type ForceInteraction } from "./mechanics.js";

const MAXIMUM_EVENT_ADVANCES_PER_SUBSTEP = 8;
const EVENT_TIME_TOLERANCE_SECONDS = 1e-12;

export interface StepSettings {
  readonly fixedTimeStepSeconds: number;
  readonly substepCount: number;
  readonly gravityMetersPerSecondSquared: Vector2;
  readonly linearDragKilogramsPerSecond: number;
  readonly targets: readonly TargetTrigger[];
}

interface TickObservations {
  readonly insideTargetPairs: Set<string>;
  readonly events: SnapshotEvent[];
  readonly userInteractionWorkJoules: number;
}

interface TickContext {
  readonly tick: number;
  readonly settings: StepSettings;
  readonly internalTimeStepSeconds: number;
  readonly staticSurfaces: readonly MutableStaticBody[];
  readonly nextInsideTargetPairs: Set<string>;
  readonly tickEvents: SnapshotEvent[];
  readonly interactions: readonly ForceInteraction[];
  userInteractionWorkJoules: number;
}

interface SelectedStaticContact {
  readonly candidate: StaticContactCandidate;
  readonly surface: MutableStaticBody;
}

interface MotionSegment {
  readonly segmentDurationSeconds: number;
  readonly segmentStartTimeSeconds: number;
  readonly positionAtTime: (timeSeconds: number) => Vector2;
  readonly maximumSpeedMetersPerSecond: number;
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

// Initialize sensor membership at creation and reset without emitting events.
export function collectInsideTargetPairs(bodies: readonly MutableBodyState[], targets: readonly TargetTrigger[]): Set<string> {
  const pairs = new Set<string>();

  for (const body of bodies) {
    if (body.kind === "dynamic") {
      updateTargetMembership(body, targets, pairs);
    }
  }

  return pairs;
}

// Translate a draft body's fields into the existing smooth-motion solver input.
function smoothMotion(body: MutableDynamicBody, timeStepSeconds: number, settings: StepSettings, interactions: readonly ForceInteraction[]) {
  return integrateSmoothMotion({
    positionMeters: body.pose.positionMeters,
    velocityMetersPerSecond: body.velocity.linearMetersPerSecond,
    massKilograms: body.massKilograms,
    gravityMetersPerSecondSquared: settings.gravityMetersPerSecondSquared,
    linearDragKilogramsPerSecond: settings.linearDragKilogramsPerSecond,
    timeStepSeconds,
    angleRadians: body.pose.angleRadians,
    interactions
  });
}

// Both a sweep preview and its accepted segment must have finite physical values.
function isFiniteMotion(motion: ReturnType<typeof integrateSmoothMotion>): boolean {
  return Number.isFinite(motion.positionMeters.x) && Number.isFinite(motion.positionMeters.y) &&
    Number.isFinite(motion.velocityMetersPerSecond.x) && Number.isFinite(motion.velocityMetersPerSecond.y) &&
    Number.isFinite(motion.interactionForceNewtons.x) && Number.isFinite(motion.interactionForceNewtons.y);
}

// Choose the earliest unhandled contact, retaining the existing time and ID rules.
function findEarliestContact(
  body: MutableDynamicBody, staticSurfaces: readonly MutableStaticBody[],
  handledSurfaceIds: ReadonlySet<string>, remainingTimeSeconds: number,
  positionAtTime: (timeSeconds: number) => Vector2, maximumSpeedMetersPerSecond: number
): SelectedStaticContact | undefined {
  const circle = movingCircleState(body);
  const velocity = body.velocity.linearMetersPerSecond;
  let earliestContact: SelectedStaticContact | undefined;

  for (const surface of staticSurfaces) {
    if (handledSurfaceIds.has(surface.id)) {
      continue;
    }

    const candidate = findStaticContactCandidate(circle, surface, remainingTimeSeconds, positionAtTime, maximumSpeedMetersPerSecond);

    if (
      candidate !== undefined &&
      candidate.timeOffsetSeconds <= EVENT_TIME_TOLERANCE_SECONDS &&
      (velocity.x * candidate.normal.x + velocity.y * candidate.normal.y) > 0
    ) {
      continue;
    }

    if (
      candidate !== undefined &&
      (
        earliestContact === undefined ||
        candidate.timeOffsetSeconds < earliestContact.candidate.timeOffsetSeconds ||
        (
          Math.abs(candidate.timeOffsetSeconds - earliestContact.candidate.timeOffsetSeconds) <= EVENT_TIME_TOLERANCE_SECONDS &&
          candidate.surfaceBodyId < earliestContact.candidate.surfaceBodyId
        )
      )
    ) {
      earliestContact = { candidate, surface };
    }
  }

  return earliestContact;
}

// Record sensor crossings along the current segment without changing its motion.
function recordTargetEntries(body: MutableDynamicBody, segment: MotionSegment, earliestContact: SelectedStaticContact | undefined, context: TickContext): void {
  const circle = movingCircleState(body);
  const { segmentDurationSeconds, segmentStartTimeSeconds, positionAtTime, maximumSpeedMetersPerSecond } = segment;
  const { tick, nextInsideTargetPairs, tickEvents } = context;
  const targets = context.settings.targets;

  for (const target of targets) {
    const pairKey = targetPairKey(body.id, target.id);

    if (nextInsideTargetPairs.has(pairKey) && !isCircleInsideTarget(circle, target)) {
      nextInsideTargetPairs.delete(pairKey);
    }

    if (nextInsideTargetPairs.has(pairKey)) {
      continue;
    }

    const candidate = findTargetEntryCandidate(circle, target, segmentDurationSeconds, positionAtTime, maximumSpeedMetersPerSecond);

    if (candidate === undefined) {
      continue;
    }

    let timeOffsetSeconds = candidate.timeOffsetSeconds;

    if (
      earliestContact !== undefined &&
      Math.abs(candidate.timeOffsetSeconds - earliestContact.candidate.timeOffsetSeconds) <= EVENT_TIME_TOLERANCE_SECONDS
    ) {
      timeOffsetSeconds = earliestContact.candidate.timeOffsetSeconds;
    }

    tickEvents.push({
      id: `targetEntered:${tick + 1}:${tickEvents.length}:` + `${candidate.bodyId}:${candidate.targetId}`,
      kind: "targetEntered",
      tick: tick + 1,
      timeSeconds: segmentStartTimeSeconds + timeOffsetSeconds,
      bodyId: candidate.bodyId,
      targetId: candidate.targetId
    });
    nextInsideTargetPairs.add(pairKey);
  }
}

// Apply the existing contact response and append its event to the draft.
function applyStaticContact(body: MutableDynamicBody, earliestContact: SelectedStaticContact, segmentStartTimeSeconds: number, context: TickContext): void {
  const { tick, tickEvents } = context;

  const { candidate, surface } = earliestContact;

  // Preserve the first impact time until another explicit launch occurs.
  const contactTimeSeconds = segmentStartTimeSeconds + candidate.timeOffsetSeconds;

  if (body.flight.firstContactTimeSeconds === undefined) {
    body.flight = {
      ...body.flight,
      firstContactTimeSeconds: contactTimeSeconds
    };
  }

  // Snap roundoff-sized localization error to exact tangency.
  body.pose.positionMeters.x = candidate.pointMeters.x + candidate.normal.x * body.shape.radiusMeters;
  body.pose.positionMeters.y = candidate.pointMeters.y + candidate.normal.y * body.shape.radiusMeters;

  tickEvents.push({
    id: `groundContact:${tick + 1}:${tickEvents.length}:` + `${candidate.bodyId}:${candidate.surfaceBodyId}`,
    kind: "groundContact",
    tick: tick + 1,
    timeSeconds: contactTimeSeconds,
    bodyId: candidate.bodyId,
    surfaceBodyId: candidate.surfaceBodyId,
    pointMeters: { ...candidate.pointMeters },
    normal: { ...candidate.normal }
  });

  const resolvedVelocity = resolveStaticContactVelocity(body.velocity.linearMetersPerSecond, candidate.normal, body.material.restitution, surface.material.restitution);
  body.velocity.linearMetersPerSecond.x = resolvedVelocity.x;
  body.velocity.linearMetersPerSecond.y = resolvedVelocity.y;
}

// Keep previously handled supports from accumulating penetration.
function maintainHandledSupports(body: MutableDynamicBody, staticSurfaces: readonly MutableStaticBody[], handledSurfaceIds: ReadonlySet<string>): void {
  for (const surface of staticSurfaces) {
    if (!handledSurfaceIds.has(surface.id)) {
      continue;
    }

    const geometry = surfaceContactGeometry(movingCircleState(body), surface);

    if (geometry.clearanceMeters < 0) {
      body.pose.positionMeters.x -= geometry.clearanceMeters * geometry.normal.x;
      body.pose.positionMeters.y -= geometry.clearanceMeters * geometry.normal.y;

      const inwardSpeed = body.velocity.linearMetersPerSecond.x * geometry.normal.x + body.velocity.linearMetersPerSecond.y * geometry.normal.y;

      if (inwardSpeed < 0) {
        body.velocity.linearMetersPerSecond.x -= inwardSpeed * geometry.normal.x;
        body.velocity.linearMetersPerSecond.y -= inwardSpeed * geometry.normal.y;
      }
    }
  }
}

// Carry endpoint membership forward so later segments emit only new entries.
function updateTargetMembership(body: MutableDynamicBody, targets: readonly TargetTrigger[], nextInsideTargetPairs: Set<string>): void {
  const updatedCircle = movingCircleState(body);

  for (const target of targets) {
    const pairKey = targetPairKey(body.id, target.id);

    if (isCircleInsideTarget(updatedCircle, target)) {
      nextInsideTargetPairs.add(pairKey);
    } else {
      nextInsideTargetPairs.delete(pairKey);
    }
  }
}

// Advance one projectile through a substep, stopping at unresolved or nonfinite motion.
function advanceBodySubstep(body: MutableDynamicBody, substepIndex: number, context: TickContext): EngineFailure | undefined {
  const { tick, settings, internalTimeStepSeconds, staticSurfaces } = context;
  const { fixedTimeStepSeconds, gravityMetersPerSecondSquared: gravityAcceleration } = settings;

  let remainingTimeSeconds = internalTimeStepSeconds;
  let substepElapsedSeconds = 0;
  let eventAdvanceCount = 0;
  const handledSurfaceIds = new Set<string>();
  const interactions: ForceInteraction[] = [];
  let maximumInteractionAcceleration = 0;
  let interactionDampingRate = 0;

  for (const interaction of context.interactions) {
    if (interaction.bodyId === body.id) {
      interactions.push(interaction);
      maximumInteractionAcceleration += interaction.maximumForceNewtons / body.massKilograms;
      interactionDampingRate += interaction.dampingKilogramsPerSecond / body.massKilograms;
    }
  }

  while (remainingTimeSeconds > EVENT_TIME_TOLERANCE_SECONDS) {
    const velocity = body.velocity.linearMetersPerSecond;
    const initialSpeed = Math.hypot(velocity.x, velocity.y);
    let maximumSpeedMetersPerSecond = initialSpeed + (Math.hypot(gravityAcceleration.x, gravityAcceleration.y) + maximumInteractionAcceleration) * remainingTimeSeconds;

    // The sweep also bounds the interaction damping's dependence on the exact
    // environmental half-drag flow used by the position-at-time calculation.
    if (interactions.length > 0 && settings.linearDragKilogramsPerSecond > 0 && initialSpeed > 0 && interactionDampingRate > 0) {
      const dragRate = settings.linearDragKilogramsPerSecond / body.massKilograms;
      maximumSpeedMetersPerSecond += 0.25 * remainingTimeSeconds ** 2 * dragRate * initialSpeed * interactionDampingRate;
    }

    const fullMotion = smoothMotion(body, remainingTimeSeconds, settings, interactions);

    // Reject a bad force before passing its trajectory to swept geometry.
    if (!isFiniteMotion(fullMotion) || !Number.isFinite(maximumSpeedMetersPerSecond)) {
      return failure("NONFINITE_STATE", "", `Advancing tick ${tick + 1} produced a nonfinite force or motion.`, body.id);
    }

    const positionAtTime = (timeSeconds: number) => smoothMotion(body, timeSeconds, settings, interactions).positionMeters;

    const earliestContact = findEarliestContact(body, staticSurfaces, handledSurfaceIds, remainingTimeSeconds, positionAtTime, maximumSpeedMetersPerSecond);

    if (earliestContact !== undefined && eventAdvanceCount >= MAXIMUM_EVENT_ADVANCES_PER_SUBSTEP) {
      return failure(
        "UNRESOLVED_EVENT_LIMIT",
        "",
        (`Advancing tick ${tick + 1} exceeded ` + `${MAXIMUM_EVENT_ADVANCES_PER_SUBSTEP} event advances ` + `for body "${body.id}".`),
        body.id
      );
    }

    let segmentDurationSeconds = remainingTimeSeconds;

    if (earliestContact !== undefined) {
      segmentDurationSeconds = earliestContact.candidate.timeOffsetSeconds;
    }
    const segmentStartTimeSeconds = tick * fixedTimeStepSeconds + substepIndex * internalTimeStepSeconds + substepElapsedSeconds;

    recordTargetEntries(
      body,
      {
        segmentDurationSeconds,
        segmentStartTimeSeconds,
        positionAtTime,
        maximumSpeedMetersPerSecond
      },
      earliestContact,
      context
    );

    let nextMotion = fullMotion;

    if (segmentDurationSeconds !== remainingTimeSeconds) {
      nextMotion = smoothMotion(body, segmentDurationSeconds, settings, interactions);
    }

    const nextTimeSeconds = (tick + 1) * fixedTimeStepSeconds;

    // Any failure discards this outer tick and all proposed events.
    if (
      !isFiniteMotion(nextMotion) ||
      !Number.isFinite(nextTimeSeconds)
    ) {
      // Identify the affected body while rejecting the entire proposed tick.
      return failure("NONFINITE_STATE", "", `Advancing tick ${tick + 1} produced a nonfinite value.`, body.id);
    }

    const previousX = body.pose.positionMeters.x;
    const previousY = body.pose.positionMeters.y;
    body.pose.positionMeters.x = nextMotion.positionMeters.x;
    body.pose.positionMeters.y = nextMotion.positionMeters.y;
    body.velocity.linearMetersPerSecond.x = nextMotion.velocityMetersPerSecond.x;
    body.velocity.linearMetersPerSecond.y = nextMotion.velocityMetersPerSecond.y;

    if (earliestContact !== undefined) {
      applyStaticContact(body, earliestContact, segmentStartTimeSeconds, context);
      handledSurfaceIds.add(earliestContact.surface.id);
      eventAdvanceCount += 1;
    } else {
      maintainHandledSupports(body, staticSurfaces, handledSurfaceIds);
    }

    // Use the accepted physical displacement, excluding support corrections and
    // unused sweep previews. Environmental drag and gravity are not user work.
    if (interactions.length > 0) {
      const force = nextMotion.interactionForceNewtons;
      context.userInteractionWorkJoules +=
        force.x * (body.pose.positionMeters.x - previousX) + force.y * (body.pose.positionMeters.y - previousY);

      if (!Number.isFinite(context.userInteractionWorkJoules)) {
        return failure("NONFINITE_STATE", "userInteractionWorkJoules", `Advancing tick ${tick + 1} produced nonfinite interaction work.`, body.id);
      }
    }

    updateTargetMembership(body, settings.targets, context.nextInsideTargetPairs);

    substepElapsedSeconds += segmentDurationSeconds;
    remainingTimeSeconds = Math.max(0, remainingTimeSeconds - segmentDurationSeconds);

    if (earliestContact === undefined) {
      break;
    }
  }

  return undefined;
}

// Preserve the existing deterministic event order after all bodies have advanced.
function sortTickEvents(tickEvents: SnapshotEvent[]): void {
  tickEvents.sort((left, right) => {
    if (left.timeSeconds !== right.timeSeconds) {
      return left.timeSeconds - right.timeSeconds;
    }

    if (left.bodyId !== right.bodyId) {
      return left.bodyId.localeCompare(right.bodyId);
    }

    if (left.kind !== right.kind) {
      if (left.kind === "targetEntered") {
        return -1;
      }

      return 1;
    }

    let leftFeatureId: string;
    let rightFeatureId: string;

    if (left.kind === "targetEntered") {
      leftFeatureId = left.targetId;
    } else {
      leftFeatureId = left.surfaceBodyId;
    }

    if (right.kind === "targetEntered") {
      rightFeatureId = right.targetId;
    } else {
      rightFeatureId = right.surfaceBodyId;
    }

    return leftFeatureId.localeCompare(rightFeatureId);
  });
}

// Mutate only the caller's draft bodies; successful observations are committed by the engine.
export function simulateTick(
  bodies: MutableBodyState[], insideTargetPairs: ReadonlySet<string>, tick: number,
  settings: StepSettings, interactions: ReadonlyMap<string, ForceInteraction>, userInteractionWorkJoules: number
): EngineResult<TickObservations> {
  const staticSurfaces: MutableStaticBody[] = [];

  for (const body of bodies) {
    if (body.kind === "static") {
      staticSurfaces.push(body);
    }
  }

  staticSurfaces.sort((left, right) => left.id.localeCompare(right.id));
  const orderedInteractions = Array.from(interactions.values());
  orderedInteractions.sort((left, right) => left.interactionId.localeCompare(right.interactionId));

  const context: TickContext = {
    tick,
    settings,
    internalTimeStepSeconds: settings.fixedTimeStepSeconds / settings.substepCount,
    staticSurfaces,
    nextInsideTargetPairs: new Set(insideTargetPairs),
    tickEvents: [],
    interactions: orderedInteractions,
    userInteractionWorkJoules
  };

  for (let substepIndex = 0; substepIndex < settings.substepCount; substepIndex += 1) {
    for (const body of bodies) {
      if (body.kind === "static") {
        continue;
      }

      const bodyFailure = advanceBodySubstep(body, substepIndex, context);

      if (bodyFailure !== undefined) {
        return bodyFailure;
      }
    }
  }

  sortTickEvents(context.tickEvents);

  return {
    ok: true,
    value: {
      insideTargetPairs: context.nextInsideTargetPairs,
      events: context.tickEvents,
      userInteractionWorkJoules: context.userInteractionWorkJoules
    }
  };
}

