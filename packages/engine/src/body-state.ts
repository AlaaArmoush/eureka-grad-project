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

export interface MutableDynamicBody extends MutableBodyBase {
  readonly kind: "dynamic";
  readonly shape: { readonly kind: "circle"; readonly radiusMeters: number; };
  massKilograms: number;
}

export interface MutableStaticBody extends MutableBodyBase {
  readonly kind: "static";
  readonly shape: { readonly kind: "box"; readonly widthMeters: number; readonly heightMeters: number; };
}

export type MutableBodyState = MutableDynamicBody | MutableStaticBody;

// Create engine-owned body data without retaining scene references.
export function createMutableBody(body: Body): MutableBodyState {
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
