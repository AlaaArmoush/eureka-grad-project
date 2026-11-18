import type { ChallengeDefinition, ChallengeProperty, ChallengeTopic, EditableProperty, SceneDefinition } from "@eureka/contracts";

// How each topic is named on the Challenges page and in the player.
export const TOPIC_LABEL: Readonly<Record<ChallengeTopic, string>> = {
  projectiles: "Projectiles",
  collisions: "Collisions",
  rotationFriction: "Rotation and friction",
  oscillations: "Oscillations",
  energyMeasurement: "Energy and measurement",
  fields: "Force fields",
  optics: "Optics",
};

// The numbers a learner has chosen, one per editable value, keyed by valueKey.
export type ChallengeValues = Readonly<Record<string, number>>;

// Relative slack when comparing a value read from a velocity vector with the number written in the definition.
const TOLERANCE = 1e-9;

// An editable or locked value is named by its property and by the body that owns it (or by the scene).
export function valueKey(item: { readonly property: ChallengeProperty; readonly bodyId: string | null }): string {
  return `${item.property}:${item.bodyId ?? "scene"}`;
}

// Read a value in the unit the definition uses: m/s, degrees, kg, m/s² (strength) or kg/s.
export function readProperty(scene: SceneDefinition, property: ChallengeProperty, bodyId: string | null): number | undefined {
  if (property === "gravity") {
    const gravity = scene.environment.gravityMetersPerSecondSquared;
    return Math.hypot(gravity.x, gravity.y);
  }

  if (property === "linearDrag") {
    return scene.environment.linearDragKilogramsPerSecond;
  }

  const body = scene.bodies.find((candidate) => candidate.id === bodyId);

  if (body?.kind !== "dynamic") {
    return undefined;
  }

  const velocity = body.velocity.linearMetersPerSecond;

  if (property === "mass") {
    return body.massKilograms;
  }

  if (property === "launchSpeed") {
    return Math.hypot(velocity.x, velocity.y);
  }

  return Math.atan2(velocity.y, velocity.x) * 180 / Math.PI;
}

// The starting values: what the definition's own scene holds, rounded to hide the noise of reading an angle back from a vector.
export function initialValues(definition: ChallengeDefinition): ChallengeValues {
  const values: Record<string, number> = {};

  for (const item of definition.editable) {
    const value = readProperty(definition.scene, item.property, item.bodyId);

    if (value !== undefined) {
      values[valueKey(item)] = Number(value.toPrecision(12));
    }
  }

  return values;
}

// Build the scene that chosen values describe. Only editable values change; everything else is the definition's own scene.
export function applyValues(definition: ChallengeDefinition, values: ChallengeValues): SceneDefinition {
  const base = structuredClone(definition.scene);
  const chosen = (property: ChallengeProperty, bodyId: string | null): number | undefined => values[valueKey({ property, bodyId })];
  const editsLaunch = (bodyId: string): boolean => definition.editable.some((item) => item.bodyId === bodyId && (item.property === "launchSpeed" || item.property === "launchAngle"));

  const bodies = base.bodies.map((body) => {
    if (body.kind !== "dynamic") {
      return body;
    }

    const massKilograms = chosen("mass", body.id) ?? body.massKilograms;

    // A body whose launch is not editable keeps its authored velocity exactly, with no round trip through speed and angle.
    if (!editsLaunch(body.id)) {
      return { ...body, massKilograms };
    }

    const speed = chosen("launchSpeed", body.id) ?? readProperty(base, "launchSpeed", body.id) ?? 0;
    const angleRadians = (chosen("launchAngle", body.id) ?? readProperty(base, "launchAngle", body.id) ?? 0) * Math.PI / 180;

    return {
      ...body,
      massKilograms,
      velocity: { ...body.velocity, linearMetersPerSecond: { x: speed * Math.cos(angleRadians), y: speed * Math.sin(angleRadians) } },
    };
  });

  const gravityStrength = chosen("gravity", null);

  return {
    ...base,
    bodies,
    environment: {
      gravityMetersPerSecondSquared: gravityStrength === undefined ? base.environment.gravityMetersPerSecondSquared : { x: 0, y: -gravityStrength },
      linearDragKilogramsPerSecond: chosen("linearDrag", null) ?? base.environment.linearDragKilogramsPerSecond,
    },
  };
}

// Why a value is refused, or null when it is a number inside the editable range.
export function checkValue(item: EditableProperty, value: number): string | null {
  if (!Number.isFinite(value)) {
    return `${item.label} must be a number.`;
  }

  if (value < item.minimum - TOLERANCE || value > item.maximum + TOLERANCE) {
    return `${item.label} must be between ${item.minimum} and ${item.maximum} ${item.unit}.`;
  }

  return null;
}

// Every way the scene differs from what the definition allows. Empty means nothing locked was changed.
export function findLockViolations(definition: ChallengeDefinition, scene: SceneDefinition, values: ChallengeValues): readonly string[] {
  const violations: string[] = [];

  for (const lock of definition.locked) {
    const current = readProperty(scene, lock.property, lock.bodyId);

    if (current === undefined || Math.abs(current - lock.value) > TOLERANCE * Math.max(1, Math.abs(lock.value))) {
      violations.push(`${lock.label} must stay ${lock.value} ${lock.unit}.`);
    }
  }

  // The scene must equal the definition's scene with only the chosen values applied. The revision counter may differ.
  const expected = applyValues(definition, values);

  if (JSON.stringify({ ...expected, revision: 0 }) !== JSON.stringify({ ...scene, revision: 0 })) {
    violations.push("A locked part of the scene was changed.");
  }

  return violations;
}

