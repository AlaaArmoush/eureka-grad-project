import type { DynamicCircleBody, SceneDefinition, Vector2 } from "@eureka/contracts";
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
    const balls = scene.bodies.filter((body): body is DynamicCircleBody => body.kind === "dynamic" && body.shape.kind === "circle");
    const start = new Map(balls.map((ball) => [ball.id, ball.pose.positionMeters]));
    const trails = new Map<string, Vector2[]>(balls.map((ball) => [ball.id, [{ ...ball.pose.positionMeters }]]));
    const landedAt = new Map<string, number>();
    // The ball's centre at the moment it touched down, from the engine's contact event rather than the end of that tick.
    const landingPoint = new Map<string, Vector2>();
    const radii = new Map(balls.map((ball) => [ball.id, ball.shape.radiusMeters]));
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

      const contacts = new Map(
        snapshot.value.events.flatMap((event) => event.kind === "groundContact" && event.tick === snapshot.value.tick ? [[event.bodyId, event] as const] : []),
      );

      for (const ball of balls) {
        if (landedAt.has(ball.id)) {
          continue;
        }

        const contact = contacts.get(ball.id);

        if (contact === undefined) {
          airborne.add(ball.id);
        } else if (airborne.has(ball.id)) {
          const radius = radii.get(ball.id) ?? 0;
          const point = { x: contact.pointMeters.x + contact.normal.x * radius, y: contact.pointMeters.y + contact.normal.y * radius };
          landedAt.set(ball.id, contact.timeSeconds);
          landingPoint.set(ball.id, point);
          // End the drawn path where the ball touched, not where the rest of the tick carried it.
          const trail = trails.get(ball.id);
          trail?.splice(trail.length - 1, 1, point);
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
        rangeMeters: (landingPoint.get(ball.id) ?? last).x - ball.pose.positionMeters.x,
        peakHeightMeters: peaks.get(ball.id) ?? 0,
      };
    });
  } finally {
    engine.dispose();
  }
}
