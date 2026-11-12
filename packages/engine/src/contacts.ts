// Calculate contact between a circular projectile and static ground, walls, or ramps.
import type { Body, StaticBody, Vector2, TargetTrigger } from "@eureka/contracts";

const CONTACT_TOLERANCE_METERS = 1e-10;

export interface MovingCircleState {
  readonly id: string;
  readonly radiusMeters: number;
  readonly positionMeters: Vector2;
}

export interface SurfaceContactGeometry {
  readonly clearanceMeters: number;
  readonly pointMeters: Vector2;
  readonly normal: Vector2;
}

export interface InitialSurfaceOverlap {
  readonly bodyIndex: number;
  readonly bodyId: string;
  readonly surfaceBodyId: string;
}

// Find the gap, closest contact point, and direction pointing away from the static body.
export function surfaceContactGeometry(circle: MovingCircleState, surface: StaticBody): SurfaceContactGeometry {
  const cosine = Math.cos(surface.pose.angleRadians);
  const sine = Math.sin(surface.pose.angleRadians);
  const offsetX = circle.positionMeters.x - surface.pose.positionMeters.x;
  const offsetY = circle.positionMeters.y - surface.pose.positionMeters.y;

  const localX = cosine * offsetX + sine * offsetY;
  const localY = -sine * offsetX + cosine * offsetY;
  const halfWidth = surface.shape.widthMeters / 2;
  const halfHeight = surface.shape.heightMeters / 2;

  let pointLocalX = Math.max(-halfWidth, Math.min(halfWidth, localX));
  let pointLocalY = Math.max(-halfHeight, Math.min(halfHeight, localY));

  const separationX = localX - pointLocalX;
  const separationY = localY - pointLocalY;
  const outsideDistance = Math.hypot(separationX, separationY);

  let normalLocalX: number;
  let normalLocalY: number;
  let signedCentreDistance: number;

  if (outsideDistance > 0) {
    // When the projectile centre is outside, the closest point gives the outward direction.
    normalLocalX = separationX / outsideDistance;
    normalLocalY = separationY / outsideDistance;
    signedCentreDistance = outsideDistance;
  } else {
    // If it starts inside, use the nearest side so scene validation can reject the overlap.
    const distanceToVerticalFace = halfWidth - Math.abs(localX);
    const distanceToHorizontalFace = halfHeight - Math.abs(localY);

    if (distanceToVerticalFace <= distanceToHorizontalFace) {
      normalLocalX = localX >= 0 ? 1 : -1;
      normalLocalY = 0;
      pointLocalX = normalLocalX * halfWidth;
      pointLocalY = localY;
      signedCentreDistance = -distanceToVerticalFace;
    } else {
      normalLocalX = 0;
      normalLocalY = localY >= 0 ? 1 : -1;
      pointLocalX = localX;
      pointLocalY = normalLocalY * halfHeight;
      signedCentreDistance = -distanceToHorizontalFace;
    }
  }

  return {
    clearanceMeters: signedCentreDistance - circle.radiusMeters,
    pointMeters: {
      x: surface.pose.positionMeters.x + cosine * pointLocalX - sine * pointLocalY,
      y: surface.pose.positionMeters.y + sine * pointLocalX + cosine * pointLocalY
    },
    normal: {
      x: cosine * normalLocalX - sine * normalLocalY,
      y: sine * normalLocalX + cosine * normalLocalY
    }
  };
}

// Find the first projectile whose starting position overlaps a static body.
export function findInitialSurfaceOverlap(bodies: readonly Body[]): InitialSurfaceOverlap | undefined {
  const surfaces = bodies
    .filter((body): body is StaticBody => body.kind === "static")
    .sort((left, right) => left.id.localeCompare(right.id));

  for (let bodyIndex = 0; bodyIndex < bodies.length; bodyIndex += 1) {
    const body = bodies[bodyIndex];

    if (body?.kind !== "dynamic") {
      continue;
    }

    const circle: MovingCircleState = {
      id: body.id,
      radiusMeters: body.shape.radiusMeters,
      positionMeters: body.pose.positionMeters
    };

    for (const surface of surfaces) {
      const geometry = surfaceContactGeometry(circle, surface);

      if (geometry.clearanceMeters < -CONTACT_TOLERANCE_METERS) {
        return {
          bodyIndex,
          bodyId: body.id,
          surfaceBodyId: surface.id
        };
      }
    }
  }

  return undefined;
}

// Describes the first non-solid target entry during one internal substep.
export interface TargetEntryCandidate {
  readonly kind: "targetEntry";
  readonly timeOffsetSeconds: number;
  readonly bodyId: string;
  readonly targetId: string;
}

export interface StaticContactCandidate {
  readonly kind: "staticContact";
  readonly timeOffsetSeconds: number;
  readonly bodyId: string;
  readonly surfaceBodyId: string;
  readonly pointMeters: Vector2;
  readonly normal: Vector2;
}

const SWEEP_TIME_TOLERANCE_SECONDS = 1e-12;
const MAXIMUM_SWEEP_SEARCH_ITERATIONS = 96;
const SWEEP_BISECTION_ITERATIONS = 48;

// Find the first time a continuous clearance reaches exact tangency.
function findFirstTouchTime(
  durationSeconds: number,
  maximumSpeedMetersPerSecond: number,
  clearanceAtTime: (timeSeconds: number) => number
): number | undefined {
  let lowerTimeSeconds = 0;
  let lowerClearanceMeters = clearanceAtTime(0);

  if (lowerClearanceMeters <= CONTACT_TOLERANCE_METERS) {
    return 0;
  }

  if (maximumSpeedMetersPerSecond <= 0 || durationSeconds <= 0) {
    return undefined;
  }

  for (
    let searchIteration = 0;
    searchIteration < MAXIMUM_SWEEP_SEARCH_ITERATIONS;
    searchIteration += 1
  ) {
    // Clearance divided by the speed bound cannot step past first contact.
    const safeAdvanceSeconds = Math.max(
      (lowerClearanceMeters - CONTACT_TOLERANCE_METERS) /
        maximumSpeedMetersPerSecond,
      SWEEP_TIME_TOLERANCE_SECONDS
    );
    const upperTimeSeconds = Math.min(
      durationSeconds,
      lowerTimeSeconds + safeAdvanceSeconds
    );
    const upperClearanceMeters = clearanceAtTime(upperTimeSeconds);

    if (upperClearanceMeters <= 0) {
      let bracketStartSeconds = lowerTimeSeconds;
      let bracketEndSeconds = upperTimeSeconds;

      // Narrow the separated/overlapping interval to a stable contact time.
      for (
        let bisectionIteration = 0;
        bisectionIteration < SWEEP_BISECTION_ITERATIONS;
        bisectionIteration += 1
      ) {
        const middleTimeSeconds =
          (bracketStartSeconds + bracketEndSeconds) * 0.5;

        if (clearanceAtTime(middleTimeSeconds) > 0) {
          bracketStartSeconds = middleTimeSeconds;
        } else {
          bracketEndSeconds = middleTimeSeconds;
        }
      }

      return bracketEndSeconds;
    }

    if (upperClearanceMeters <= CONTACT_TOLERANCE_METERS) {
      return upperTimeSeconds;
    }

    if (upperTimeSeconds === durationSeconds) {
      return undefined;
    }

    lowerTimeSeconds = upperTimeSeconds;
    lowerClearanceMeters = upperClearanceMeters;
  }

  return undefined;
}

// Positive clearance means separated; zero is exact tangency.
function targetClearanceMeters(
  circle: MovingCircleState,
  target: TargetTrigger,
  positionMeters: Vector2
): number {
  return (
    Math.hypot(
      positionMeters.x - target.pose.positionMeters.x,
      positionMeters.y - target.pose.positionMeters.y
    ) -
    (circle.radiusMeters + target.shape.radiusMeters)
  );
}

// Tracks whether a pair is already overlapping so entry fires only once.
export function isCircleInsideTarget(
  circle: MovingCircleState,
  target: TargetTrigger
): boolean {
  return (
    targetClearanceMeters(circle, target, circle.positionMeters) <=
    CONTACT_TOLERANCE_METERS
  );
}

// Finds the earliest target boundary crossing without changing motion.
export function findTargetEntryCandidate(
  circle: MovingCircleState,
  target: TargetTrigger,
  durationSeconds: number,
  positionAtTime: (timeSeconds: number) => Vector2,
  maximumSpeedMetersPerSecond: number
): TargetEntryCandidate | undefined {
  const timeOffsetSeconds = findFirstTouchTime(
    durationSeconds,
    maximumSpeedMetersPerSecond,
    (timeSeconds) =>
      targetClearanceMeters(
        circle,
        target,
        positionAtTime(timeSeconds)
      )
  );

  return timeOffsetSeconds === undefined
    ? undefined
    : {
      kind: "targetEntry",
      timeOffsetSeconds,
      bodyId: circle.id,
      targetId: target.id
    };
}

// Find the first contact with a finite rotated static body.
export function findStaticContactCandidate(
  circle: MovingCircleState,
  surface: StaticBody,
  durationSeconds: number,
  positionAtTime: (timeSeconds: number) => Vector2,
  maximumSpeedMetersPerSecond: number
): StaticContactCandidate | undefined {
  const timeOffsetSeconds = findFirstTouchTime(
    durationSeconds,
    maximumSpeedMetersPerSecond,
    (timeSeconds) =>
      surfaceContactGeometry(
        {
          ...circle,
          positionMeters: positionAtTime(timeSeconds)
        },
        surface
      ).clearanceMeters
  );

  if (timeOffsetSeconds === undefined) {
    return undefined;
  }

  const geometry = surfaceContactGeometry(
    {
      ...circle,
      positionMeters: positionAtTime(timeOffsetSeconds)
    },
    surface
  );

  return {
    kind: "staticContact",
    timeOffsetSeconds,
    bodyId: circle.id,
    surfaceBodyId: surface.id,
    pointMeters: geometry.pointMeters,
    normal: geometry.normal
  };
}

// Apply a frictionless normal impulse against an immovable static body.
export function resolveStaticContactVelocity(
  velocityMetersPerSecond: Vector2,
  normal: Vector2,
  projectileRestitution: number,
  surfaceRestitution: number
): Vector2 {
  const normalSpeed =
    velocityMetersPerSecond.x * normal.x +
    velocityMetersPerSecond.y * normal.y;

  if (normalSpeed >= 0) {
    return { ...velocityMetersPerSecond };
  }

  const restitution = Math.min(
    projectileRestitution,
    surfaceRestitution
  );
  const normalSpeedChange = -(1 + restitution) * normalSpeed;

  return {
    x: velocityMetersPerSecond.x + normalSpeedChange * normal.x,
    y: velocityMetersPerSecond.y + normalSpeedChange * normal.y
  };
}

