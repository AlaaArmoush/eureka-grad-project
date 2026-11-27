// The records a run is read from and the attempt it produces.
import { judgeCriterion, type ChallengeAttempt, type ChallengeDefinition, type ChallengeMeasurement, type GroundContactEvent, type SceneDefinition, type Snapshot, type Vector2 } from "@eureka/contracts";

// Waiting: not reached yet. Missed: its criterion was judged and failed, so it can no longer be reached in this attempt.
export type ZoneState = "waiting" | "reached" | "borderline" | "missed";

export interface AttemptObserver {
  // Take the next tick's snapshot. True once the attempt has ended: it landed, settled every zone, ran out of time or failed.
  observe(snapshot: Snapshot): boolean;
  // The projectile's centre at every observed tick, starting from the launch point.
  path(): readonly Vector2[];
  // Where the attempt stands with each zone, in the definition's order.
  zoneStates(): readonly ZoneState[];
  // Record that the engine reported a failure.
  fail(): void;
  // The attempt as the evaluator wants it.
  finish(): ChallengeAttempt;
}

interface Landing {
  readonly surfaceId: string;
  readonly timeSeconds: number;
  readonly distanceMeters: number;
}

// Watch one run of a challenge, from the scene it launched with. It never advances the engine.
export function createAttemptObserver(definition: ChallengeDefinition, launchScene: SceneDefinition): AttemptObserver {
  const projectile = launchScene.bodies.find((body) => body.id === definition.projectileId);
  const launch = projectile?.kind === "dynamic" ? projectile : undefined;
  const origin = launch?.pose.positionMeters ?? { x: 0, y: 0 };
  const radius = launch?.shape.kind === "circle" ? launch.shape.radiusMeters : 0;
  const velocity = launch?.velocity.linearMetersPerSecond ?? { x: 0, y: 0 };
  const gravity = Math.hypot(launchScene.environment.gravityMetersPerSecondSquared.x, launchScene.environment.gravityMetersPerSecondSquared.y);
  const speed = Math.hypot(velocity.x, velocity.y);
  const angleRadians = Math.atan2(velocity.y, velocity.x);
  const zones = definition.objective.zones;

  const points: Vector2[] = [{ x: origin.x, y: origin.y }];
  const states: ZoneState[] = zones.map(() => "waiting");
  let status: "running" | "ended" | "failed" = launch === undefined ? "failed" : "running";
  let apexHeightMeters = 0;
  let airborne = false;
  let landing: Landing | undefined;

  // One measurement: a landing value counts only when the first surface touched is one the definition accepts.
  function measure(measurement: ChallengeMeasurement): number | undefined {
    const counted = landing !== undefined && (measurement.onSurfaces === null || measurement.onSurfaces.includes(landing.surfaceId)) ? landing : undefined;

    switch (measurement.quantity) {
      case "contactDistance":
        return counted?.distanceMeters;
      case "contactTime":
        return counted?.timeSeconds;
      case "apexHeight":
        return apexHeightMeters;
      // Ideal flight over level ground: R = v²·sin(2θ)/g and t = 2·v·sinθ/g.
      case "dragFreeContactDistance":
        return speed * speed * Math.sin(2 * angleRadians) / gravity;
      case "dragFreeContactTime":
        return 2 * speed * Math.sin(angleRadians) / gravity;
    }
  }

  // Settle what this tick decides: an entered target zone is reached; a criterion zone is judged once the landing gives its value.
  function updateZones(snapshot: Snapshot): void {
    zones.forEach((zone, index) => {
      if (states[index] !== "waiting") {
        return;
      }

      if (zone.criterionId === null) {
        const entered = snapshot.events.some((event) => event.kind === "targetEntered" && event.bodyId === definition.projectileId && event.targetId === zone.targetId);
        if (entered) {
          states[index] = "reached";
        }
        return;
      }

      const criterion = definition.objective.criteria.find((item) => item.id === zone.criterionId);
      const measurement = definition.measurements.find((item) => item.id === criterion?.measurement);

      if (criterion === undefined || measurement === undefined || landing === undefined) {
        return;
      }

      const judged = judgeCriterion(criterion, measure(measurement)).status;
      states[index] = judged === "pass" ? "reached" : judged === "borderline" ? "borderline" : "missed";
    });
  }

  function observe(snapshot: Snapshot): boolean {
    if (status !== "running") {
      return true;
    }

    const body = snapshot.bodies.find((candidate) => candidate.id === definition.projectileId);

    if (body === undefined) {
      status = "failed";
      return true;
    }

    const position = { x: body.pose.positionMeters.x, y: body.pose.positionMeters.y };
    points.push(position);

    // The apex belongs to the flight, not to whatever the projectile does after it lands.
    if (landing === undefined) {
      apexHeightMeters = Math.max(apexHeightMeters, position.y - origin.y);
    }

    const contact = snapshot.events.find((event): event is GroundContactEvent => event.kind === "groundContact" && event.bodyId === definition.projectileId);

    if (contact === undefined) {
      airborne = true;
    } else if (airborne && landing === undefined) {
      // The centre at touch is the contact point moved one radius along the surface normal.
      landing = {
        surfaceId: contact.surfaceBodyId,
        timeSeconds: contact.timeSeconds,
        distanceMeters: contact.pointMeters.x + contact.normal.x * radius - origin.x,
      };
    }

    updateZones(snapshot);

    const allSettled = zones.length > 0 && states.every((state) => state !== "waiting");

    if ((landing !== undefined && definition.attemptEnds === "firstContact") || (landing !== undefined && allSettled) || snapshot.simulationTimeSeconds >= definition.runLimitSeconds) {
      status = "ended";
      return true;
    }

    return false;
  }

  function finish(): ChallengeAttempt {
    if (status === "failed") {
      return { runStatus: "engineFailure", measurements: {}, firstContact: null };
    }

    if (landing === undefined) {
      return { runStatus: "incomplete", measurements: {}, firstContact: null };
    }

    const measurements: Record<string, number | undefined> = {};

    for (const measurement of definition.measurements) {
      measurements[measurement.id] = measure(measurement);
    }

    return { runStatus: "complete", measurements, firstContact: landing.surfaceId };
  }

  return {
    observe,
    path: () => points.slice(),
    zoneStates: () => states.slice(),
    fail: () => {
      status = "failed";
    },
    finish,
  };
}
