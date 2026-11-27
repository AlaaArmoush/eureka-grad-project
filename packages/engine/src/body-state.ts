// Internal body data is shared by engine lifetime management and physical stepping.
import type { Body, Material } from "@eureka/contracts";

interface MutableBodyBase {
  readonly id: string;
  material: Material;
  pose: {
    positionMeters: { x: number; y: number; };
    angleRadians: number;
  };
  velocity: {
    linearMetersPerSecond: { x: number; y: number; };
    angularRadiansPerSecond: number;
  };
}

// Keep each projectile's measurement reference with its engine-owned state.
export interface MutableDynamicBody extends MutableBodyBase {
  readonly kind: "dynamic";
  shape: { readonly kind: "circle"; readonly radiusMeters: number; };
  massKilograms: number;
  flight: {
    readonly launchTick: number;
    readonly launchPositionXMeters: number;
    readonly firstContactTimeSeconds: number | undefined;
  };
}

export interface MutableStaticBody extends MutableBodyBase {
  readonly kind: "static";
  shape: { readonly kind: "box"; readonly widthMeters: number; readonly heightMeters: number; };
}

export type MutableBodyState = MutableDynamicBody | MutableStaticBody;

// Create engine-owned body data without retaining scene references.
export function createMutableBody(body: Body, launchTick = 0): MutableBodyState {
  const sharedState = {
    id: body.id,
    material: { ...body.material },
    pose: {
      positionMeters: { ...body.pose.positionMeters },
      angleRadians: body.pose.angleRadians
    }
  };

  if (body.kind === "dynamic") {
    const shape = body.shape;

    // createEngine, setInitialScene and addEntity reject moving boxes first.
    if (shape.kind !== "circle") {
      throw new Error("Internal error: unsupported moving shape reached body initialization.");
    }

    return {
      ...sharedState,
      kind: "dynamic",
      shape: { ...shape },
      massKilograms: body.massKilograms,
      flight: {
        launchTick,
        launchPositionXMeters: body.pose.positionMeters.x,
        firstContactTimeSeconds: undefined
      },
      velocity: {
        linearMetersPerSecond: { ...body.velocity.linearMetersPerSecond },
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
export function cloneBodies(bodies: readonly MutableBodyState[]): MutableBodyState[] {
  return bodies.map((body) => {
    const sharedState = {
      id: body.id,
      material: { ...body.material },
      pose: {
        positionMeters: { ...body.pose.positionMeters },
        angleRadians: body.pose.angleRadians
      },
      velocity: {
        linearMetersPerSecond: { ...body.velocity.linearMetersPerSecond },
        angularRadiansPerSecond: body.velocity.angularRadiansPerSecond
      }
    };

    if (body.kind === "dynamic") {
      return {
        ...sharedState,
        kind: "dynamic",
        shape: { ...body.shape },
        massKilograms: body.massKilograms,
        flight: { ...body.flight }
      };
    }

    return {
      ...sharedState,
      kind: "static",
      shape: { ...body.shape }
    };
  });
}

// Describe engine-owned state as a portable scene body.
export function describeBody(body: MutableBodyState): Body {
  const pose = {
    positionMeters: { ...body.pose.positionMeters },
    angleRadians: body.pose.angleRadians
  };

  if (body.kind === "dynamic") {
    return {
      id: body.id,
      kind: "dynamic",
      shape: { ...body.shape },
      massKilograms: body.massKilograms,
      material: { ...body.material },
      pose,
      velocity: {
        linearMetersPerSecond: { ...body.velocity.linearMetersPerSecond },
        angularRadiansPerSecond: body.velocity.angularRadiansPerSecond
      }
    };
  }

  return { id: body.id, kind: "static", shape: { ...body.shape }, material: { ...body.material }, pose };
}
