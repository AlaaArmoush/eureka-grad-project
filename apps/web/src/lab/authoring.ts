// Supplies the physical types used to construct editable scene objects.
import type {
  Body,
  DynamicCircleBody,
  SceneDefinition,
  StaticBody,
  TargetTrigger,
  Vector2,
} from "@eureka/contracts";

// Supplies the engine's own surface geometry, so editing uses the same contact definition as validation.
import { surfaceContactGeometry } from "@eureka/engine";

// A gap this small (1 micrometre) still counts as resting on a surface when resizing.
const SUPPORT_CONTACT_TOLERANCE_METERS = 1e-6;

// Build starting conditions without changing any scene object's identity.
export function updateEnvironmentInScene(scene: SceneDefinition, environment: SceneDefinition["environment"]): SceneDefinition {
  return {
    ...scene,
    revision: scene.revision + 1,
    environment: structuredClone(environment),
  };
}

// Each kind carries only its own properties.
export type PlacementDefinition =
  | { readonly entityKind: "projectile"; readonly projectileProperties: ProjectilePlacementProperties }
  | { readonly entityKind: "platform"; readonly platformProperties: PlatformPlacementProperties }
  | { readonly entityKind: "ramp"; readonly rampProperties: RampPlacementProperties }
  | { readonly entityKind: "target"; readonly targetProperties: TargetPlacementProperties };

export type PlaceableEntityKind = PlacementDefinition["entityKind"];

export type PlacementRequest = PlacementDefinition & { readonly positionMeters: Vector2 };

export interface MoveEntityRequest {
  readonly entityId: string;
  readonly positionMeters: Vector2;
}
// reservedIds holds IDs used earlier in this run, so a removed object's ID is never given to a new one.
export function createUniqueEntityId(
  prefix: PlaceableEntityKind,
  scene: SceneDefinition,
  reservedIds: ReadonlySet<string> = new Set(),
): string {
  const existingIds = new Set<string>(reservedIds);

  for (const sceneBody of scene.bodies) {
    existingIds.add(sceneBody.id);
  }

  for (const sceneTrigger of scene.triggers) {
    existingIds.add(sceneTrigger.id);
  }

  let suffix = 1;
  let candidate = `${prefix}-${suffix}`;

  while (existingIds.has(candidate)) {
    suffix += 1;
    candidate = `${prefix}-${suffix}`;
  }

  return candidate;
}
export interface SceneDraftChange {
  readonly scene: SceneDefinition;
  readonly entityId: string;
}
//RAMPS
export interface RampPlacementProperties {
  readonly widthMeters: number;
  readonly heightMeters: number;
  readonly angleDegrees: number;
  readonly restitution: number;
}

export const DEFAULT_RAMP_PROPERTIES: RampPlacementProperties = {
  widthMeters: 6,
  heightMeters: 0.5,
  angleDegrees: 30,
  restitution: 0,
};
function createRamp(
  id: string,
  positionMeters: Vector2,
  properties: RampPlacementProperties,
): StaticBody {
  const angleRadians = (properties.angleDegrees * Math.PI) / 180;

  return {
    id,
    kind: "static",
    shape: {
      kind: "box",
      widthMeters: properties.widthMeters,
      heightMeters: properties.heightMeters,
    },
    material: {
      restitution: properties.restitution,
    },
    pose: {
      positionMeters: { ...positionMeters },
      angleRadians,
    },
  };
}
export function updateStaticBodyInScene(
  scene: SceneDefinition,
  bodyId: string,
  properties: RampPlacementProperties,
): SceneDraftChange {
  const angleRadians = (properties.angleDegrees * Math.PI) / 180;

  const updatedBodies = scene.bodies.map<Body>((body) => {
    const isSelectedStaticBody = body.id === bodyId && body.kind === "static";

    if (!isSelectedStaticBody) {
      return body;
    }

    return {
      ...body,
      shape: {
        ...body.shape,
        widthMeters: properties.widthMeters,
        heightMeters: properties.heightMeters,
      },
      material: {
        ...body.material,
        restitution: properties.restitution,
      },
      pose: {
        ...body.pose,
        angleRadians,
      },
    };
  });

  return {
    scene: {
      ...scene,
      revision: scene.revision + 1,
      bodies: updatedBodies,
    },
    entityId: bodyId,
  };
}
// Dynamic Ball
export interface ProjectilePlacementProperties {
  readonly massKilograms: number;
  readonly radiusMeters: number;
  readonly launchSpeedMetersPerSecond: number;
  readonly launchAngleDegrees: number;
  readonly restitution: number;
}

export const DEFAULT_PROJECTILE_PROPERTIES: ProjectilePlacementProperties = {
  massKilograms: 1,
  radiusMeters: 0.5,
  launchSpeedMetersPerSecond: 20,
  launchAngleDegrees: 30,
  restitution: 0,
};
function createProjectile(
  id: string,
  positionMeters: Vector2,
  properties: ProjectilePlacementProperties,
): DynamicCircleBody {
  const launchAngleRadians = (properties.launchAngleDegrees * Math.PI) / 180;

  return {
    id,
    kind: "dynamic",
    shape: {
      kind: "circle",
      radiusMeters: properties.radiusMeters,
    },
    massKilograms: properties.massKilograms,
    material: {
      restitution: properties.restitution,
    },
    pose: {
      positionMeters: { ...positionMeters },
      angleRadians: 0,
    },
    velocity: {
      linearMetersPerSecond: {
        x: properties.launchSpeedMetersPerSecond * Math.cos(launchAngleRadians),
        y: properties.launchSpeedMetersPerSecond * Math.sin(launchAngleRadians),
      },
      angularRadiansPerSecond: 0,
    },
  };
}

export function updateProjectileInScene(
  scene: SceneDefinition,
  projectileId: string,
  properties: ProjectilePlacementProperties,
): SceneDraftChange {
  const angleRadians = (properties.launchAngleDegrees * Math.PI) / 180;

  const velocityX =
    properties.launchSpeedMetersPerSecond * Math.cos(angleRadians);

  const velocityY =
    properties.launchSpeedMetersPerSecond * Math.sin(angleRadians);

  const staticSurfaces = scene.bodies.filter((body): body is StaticBody => body.kind === "static");

  const updatedBodies = scene.bodies.map<Body>((body) => {
    // The projectile form edits moving circles, not moving boxes.
    if (body.id !== projectileId || body.kind !== "dynamic" || body.shape.kind !== "circle") {
      return body;
    }

    // A ball resting on a surface grows or shrinks away from that surface, so it stays supported.
    const radiusChange = properties.radiusMeters - body.shape.radiusMeters;
    let positionMeters = body.pose.positionMeters;

    for (const surface of staticSurfaces) {
      const contact = surfaceContactGeometry(
        { id: body.id, radiusMeters: body.shape.radiusMeters, positionMeters: body.pose.positionMeters },
        surface,
      );

      if (Math.abs(contact.clearanceMeters) <= SUPPORT_CONTACT_TOLERANCE_METERS) {
        positionMeters = {
          x: positionMeters.x + contact.normal.x * radiusChange,
          y: positionMeters.y + contact.normal.y * radiusChange,
        };
      }
    }

    return {
      ...body,
      pose: { ...body.pose, positionMeters },
      shape: {
        kind: "circle",
        radiusMeters: properties.radiusMeters,
      },
      massKilograms: properties.massKilograms,
      material: {
        ...body.material,
        restitution: properties.restitution,
      },
      velocity: {
        ...body.velocity,
        linearMetersPerSecond: {
          x: velocityX,
          y: velocityY,
        },
      },
    };
  });

  return {
    scene: {
      ...scene,
      revision: scene.revision + 1,
      bodies: updatedBodies,
    },
    entityId: projectileId,
  };
}
// Platform
export interface PlatformPlacementProperties {
  readonly widthMeters: number;
  readonly heightMeters: number;
  readonly restitution: number;
}

export const DEFAULT_PLATFORM_PROPERTIES: PlatformPlacementProperties = {
  widthMeters: 4,
  heightMeters: 1,
  restitution: 0,
};
function createPlatform(
  id: string,
  positionMeters: Vector2,
  properties: PlatformPlacementProperties,
): StaticBody {
  return {
    id,
    kind: "static",
    shape: {
      kind: "box",
      widthMeters: properties.widthMeters,
      heightMeters: properties.heightMeters,
    },
    material: {
      restitution: properties.restitution,
    },
    pose: {
      positionMeters: { ...positionMeters },
      angleRadians: 0,
    },
  };
}

// Target
export interface TargetPlacementProperties {
  readonly radiusMeters: number;
}

export const DEFAULT_TARGET_PROPERTIES: TargetPlacementProperties = {
  radiusMeters: 0.75,
};
function createTarget(
  id: string,
  positionMeters: Vector2,
  properties: TargetPlacementProperties,
): TargetTrigger {
  return {
    id,
    kind: "target",
    shape: {
      kind: "circle",
      radiusMeters: properties.radiusMeters,
    },
    pose: {
      positionMeters: { ...positionMeters },
      angleRadians: 0,
    },
  };
}
export function placeEntityInScene(scene: SceneDefinition, request: PlacementRequest, reservedIds?: ReadonlySet<string>): SceneDraftChange {
  const id = createUniqueEntityId(request.entityKind, scene, reservedIds);
  let bodies = scene.bodies;
  let triggers = scene.triggers;

  switch (request.entityKind) {
    case "projectile":
      bodies = [...scene.bodies, createProjectile(id, request.positionMeters, request.projectileProperties)];
      break;
    case "platform":
      bodies = [...scene.bodies, createPlatform(id, request.positionMeters, request.platformProperties)];
      break;
    case "ramp":
      bodies = [...scene.bodies, createRamp(id, request.positionMeters, request.rampProperties)];
      break;
    case "target":
      triggers = [...scene.triggers, createTarget(id, request.positionMeters, request.targetProperties)];
      break;
    default: {
      // Compile error here means a placement kind has no case.
      const unplacedRequest: never = request;
      return unplacedRequest;
    }
  }

  return {
    scene: { ...scene, revision: scene.revision + 1, bodies, triggers },
    entityId: id,
  };
}
export function updateTargetInScene(
  scene: SceneDefinition,
  targetId: string,
  properties: TargetPlacementProperties,
): SceneDraftChange {
  const updatedTriggers = scene.triggers.map((trigger) => {
    if (trigger.id !== targetId) {
      return trigger;
    }

    return {
      ...trigger,
      shape: {
        ...trigger.shape,
        radiusMeters: properties.radiusMeters,
      },
    };
  });

  return {
    scene: {
      ...scene,
      revision: scene.revision + 1,
      triggers: updatedTriggers,
    },
    entityId: targetId,
  };
}
export function moveEntityInScene(
  scene: SceneDefinition,
  entityId: string,
  positionMeters: Vector2,
): SceneDraftChange {
  const movedBodies = scene.bodies.map((body) => {
    if (body.id !== entityId) {
      return body;
    }

    return {
      ...body,
      pose: {
        ...body.pose,
        positionMeters: { ...positionMeters },
      },
    };
  });

  const movedTriggers = scene.triggers.map((trigger) => {
    if (trigger.id !== entityId) {
      return trigger;
    }

    return {
      ...trigger,
      pose: {
        ...trigger.pose,
        positionMeters: { ...positionMeters },
      },
    };
  });

  return {
    scene: {
      ...scene,
      revision: scene.revision + 1,
      bodies: movedBodies,
      triggers: movedTriggers,
    },
    entityId,
  };
}
export function deleteEntityFromScene(
  scene: SceneDefinition,
  entityId: string,
): SceneDraftChange {
  return {
    scene: {
      ...scene,
      revision: scene.revision + 1,
      bodies: scene.bodies.filter((body) => body.id !== entityId),
      triggers: scene.triggers.filter((trigger) => trigger.id !== entityId),
    },
    entityId,
  };
}
