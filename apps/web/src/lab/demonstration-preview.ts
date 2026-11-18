import type { SceneDefinition, Vector2 } from "@eureka/contracts";
import { createEngine } from "@eureka/engine";

// What the Curriculum page shows for one ball after "Run both".
export interface PreviewBall {
  readonly id: string;
  readonly massKilograms: number;
  readonly speedMetersPerSecond: number;
  readonly angleDegrees: number;
  readonly trail: readonly Vector2[];
  readonly landed: boolean;
  readonly flightTimeSeconds: number;
  readonly rangeMeters: number;
  readonly peakHeightMeters: number;
}

const MAXIMUM_PREVIEW_SECONDS = 12;

// Run a scene headlessly until every ball touches a surface, collecting each ball's path.
// This uses the same engine as the lab and never draws or advances any visible controller.
export function runPreview(scene: SceneDefinition): readonly PreviewBall[] | undefined {
  const engineResult = createEngine(structuredClone(scene));

  if (!engineResult.ok) {
    return undefined;
  }

  const engine = engineResult.value;

  try {
    const balls = scene.bodies.flatMap((body) => body.kind === "dynamic" ? [body] : []);
    const start = new Map(balls.map((ball) => [ball.id, ball.pose.positionMeters]));
    const trails = new Map<string, Vector2[]>(balls.map((ball) => [ball.id, [{ ...ball.pose.positionMeters }]]));
    const landedAt = new Map<string, number>();
    // A ball launched from a ledge touches it for a tick; only contact after leaving it is a landing.
    const airborne = new Set<string>();
    const peaks = new Map(balls.map((ball) => [ball.id, 0]));
    const stepSeconds = scene.numericalProfile.fixedTimeStepSeconds;
    const stepLimit = Math.ceil(MAXIMUM_PREVIEW_SECONDS / stepSeconds);

    for (let step = 0; step < stepLimit && landedAt.size < balls.length; step += 1) {
      if (!engine.advance(1).ok) {
        break;
      }

      const snapshot = engine.getSnapshot();

      if (!snapshot.ok) {
        break;
      }

      for (const body of snapshot.value.bodies) {
        const trail = trails.get(body.id);
        const origin = start.get(body.id);

        if (trail === undefined || origin === undefined || landedAt.has(body.id)) {
          continue;
        }

        trail.push({ ...body.pose.positionMeters });
        peaks.set(body.id, Math.max(peaks.get(body.id) ?? 0, body.pose.positionMeters.y - origin.y));
      }

      const touching = new Set(
        snapshot.value.events.flatMap((event) => event.kind === "groundContact" && event.tick === snapshot.value.tick ? [event.bodyId] : []),
      );

      for (const ball of balls) {
        if (landedAt.has(ball.id)) {
          continue;
        }

        if (!touching.has(ball.id)) {
          airborne.add(ball.id);
        } else if (airborne.has(ball.id)) {
          landedAt.set(ball.id, snapshot.value.simulationTimeSeconds);
        }
      }
    }

    return balls.map((ball) => {
      const trail = trails.get(ball.id) ?? [];
      const last = trail[trail.length - 1] ?? ball.pose.positionMeters;
      const launch = ball.velocity.linearMetersPerSecond;

      return {
        id: ball.id,
        massKilograms: ball.massKilograms,
        speedMetersPerSecond: Math.hypot(launch.x, launch.y),
        angleDegrees: Math.atan2(launch.y, launch.x) * 180 / Math.PI,
        trail,
        landed: landedAt.has(ball.id),
        flightTimeSeconds: landedAt.get(ball.id) ?? stepLimit * stepSeconds,
        rangeMeters: last.x - ball.pose.positionMeters.x,
        peakHeightMeters: peaks.get(ball.id) ?? 0,
      };
    });
  } finally {
    engine.dispose();
  }
}
