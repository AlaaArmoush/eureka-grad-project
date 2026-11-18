// Turns a stored demonstration and one choice of settings into a scene and a view. The one generic builder: no question has code of its own.
import type { Body, ChallengeView, DemonstrationNumber, DemonstrationVector, SavedDemonstration, SceneDefinition } from "./index.js";

type Settings = Readonly<Record<string, string>>;

// A fixed number, or offset + scale × the chosen value of one setting.
function resolveNumber(value: DemonstrationNumber, settings: Settings): number {
  if (typeof value === "number") {
    return value;
  }

  return value.offset + value.scale * Number(settings[value.parameter]);
}

function resolveVector(vector: DemonstrationVector, settings: Settings): { x: number; y: number } {
  return { x: resolveNumber(vector.x, settings), y: resolveNumber(vector.y, settings) };
}

const radians = (degrees: number): number => (degrees * Math.PI) / 180;

// Build the starting scene of one setup. Settings must already be checked against the offered options.
export function buildDemonstrationScene(demonstration: SavedDemonstration, settings: Settings): SceneDefinition {
  const template = demonstration.scene;
  const bodies: Body[] = template.bodies.map((body) => {
    const positionMeters = resolveVector(body.positionMeters, settings);

    if (body.kind === "static") {
      return {
        id: body.id,
        kind: "static",
        shape: { kind: "box", widthMeters: resolveNumber(body.widthMeters, settings), heightMeters: resolveNumber(body.heightMeters, settings) },
        material: { restitution: body.restitution },
        pose: { positionMeters, angleRadians: radians(resolveNumber(body.angleDegrees, settings)) },
      };
    }

    const speed = resolveNumber(body.launchSpeedMetersPerSecond, settings);
    const angle = radians(resolveNumber(body.launchAngleDegrees, settings));

    return {
      id: body.id,
      kind: "dynamic",
      shape: { kind: "circle", radiusMeters: resolveNumber(body.radiusMeters, settings) },
      massKilograms: resolveNumber(body.massKilograms, settings),
      material: { restitution: body.restitution },
      pose: { positionMeters, angleRadians: 0 },
      velocity: { linearMetersPerSecond: { x: speed * Math.cos(angle), y: speed * Math.sin(angle) }, angularRadiansPerSecond: 0 },
    };
  });

  return {
    schemaVersion: 1,
    id: template.id.replace(/\{([A-Za-z][A-Za-z0-9]*)\}/g, (token: string, key: string) => settings[key] ?? token),
    revision: 1,
    seed: template.seed,
    numericalProfile: structuredClone(template.numericalProfile),
    environment: {
      gravityMetersPerSecondSquared: { x: 0, y: -resolveNumber(template.gravityStrengthMetersPerSecondSquared, settings) },
      linearDragKilogramsPerSecond: resolveNumber(template.linearDragKilogramsPerSecond, settings),
    },
    bodies,
    triggers: [],
  };
}

// A view around the given world box, wide enough to read and never so wide that a flight becomes a thin strip.
export function frameAround(xMin: number, xMax: number, yMin: number, yMax: number, pixelsPerMeter: number): ChallengeView {
  const width = Math.max(xMax - xMin, (yMax - yMin) * 1.6);
  const height = Math.max(yMax - yMin, width / 3.2);

  return {
    centerWorldMeters: { x: (xMin + xMax) / 2, y: (yMin + yMax) / 2 },
    widthMeters: width,
    heightMeters: height,
    pixelsPerMeter,
  };
}

// The view that shows the whole ideal flight of one setup, from the formulas named in DemonstrationFlight.
export function demonstrationFrame(demonstration: SavedDemonstration, settings: Settings): ChallengeView {
  const { flight, marginsMeters, pixelsPerMeter } = demonstration.framing;
  const speed = resolveNumber(flight.speedMetersPerSecond, settings);
  const gravity = resolveNumber(flight.gravityMetersPerSecondSquared, settings);
  let range: number;
  let peak: number;

  if (flight.kind === "level") {
    const angle = radians(resolveNumber(flight.angleDegrees, settings));
    range = Math.max(0, speed * speed * Math.sin(2 * angle) / gravity);
    peak = (speed * Math.sin(angle)) ** 2 / (2 * gravity);
  } else {
    const height = resolveNumber(flight.heightMeters, settings);
    range = speed * Math.sqrt(2 * height / gravity);
    peak = height;
  }

  return frameAround(-marginsMeters.left, range + marginsMeters.right, -marginsMeters.bottom, peak + marginsMeters.top, pixelsPerMeter);
}
