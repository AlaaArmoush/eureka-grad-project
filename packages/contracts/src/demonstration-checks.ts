// The one check for a stored demonstration from any source: exact shape, then references between its parts.
import type { DemonstrationNumber, Diagnostic, SavedDemonstration } from "./index.js";
import { anyOf, checkShape, exactly, listOf, mapOf, NUMBER, NUMERICAL_PROFILE, OVERLAYS, record, TEXT, TOPIC, variants } from "./data-shape.js";

// A number field may also name one setting: offset + scale × its chosen value.
const AMOUNT = anyOf("a number or { parameter, scale, offset }", NUMBER, record({ parameter: TEXT, scale: NUMBER, offset: NUMBER }));
const POINT = record({ x: AMOUNT, y: AMOUNT });
const CONTROL = record({ key: TEXT, label: TEXT, options: listOf(record({ value: TEXT, label: TEXT })) });

// Keep this in step with SavedDemonstration in index.ts.
const DEMONSTRATION = record({
  schemaVersion: exactly(1),
  id: TEXT,
  revision: NUMBER,
  topic: TOPIC,
  order: NUMBER,
  title: TEXT,
  question: TEXT,
  summary: TEXT,
  prediction: record({ prompt: TEXT, choices: listOf(TEXT), answerIndex: NUMBER, reason: TEXT }),
  lookFor: TEXT,
  scenarioReference: TEXT,
  primary: CONTROL,
  reference: TEXT,
  comparison: TEXT,
  shared: listOf(CONTROL),
  sharedDefaults: mapOf(TEXT),
  overlays: OVERLAYS,
  scene: record({
    id: TEXT,
    seed: NUMBER,
    numericalProfile: NUMERICAL_PROFILE,
    gravityStrengthMetersPerSecondSquared: AMOUNT,
    linearDragKilogramsPerSecond: AMOUNT,
    bodies: listOf(variants("kind", {
      static: record({ kind: exactly("static"), id: TEXT, widthMeters: AMOUNT, heightMeters: AMOUNT, restitution: NUMBER, positionMeters: POINT, angleDegrees: AMOUNT }),
      dynamic: record({ kind: exactly("dynamic"), id: TEXT, radiusMeters: AMOUNT, massKilograms: AMOUNT, restitution: NUMBER, positionMeters: POINT, launchSpeedMetersPerSecond: AMOUNT, launchAngleDegrees: AMOUNT }),
    })),
  }),
  framing: record({
    flight: variants("kind", {
      level: record({ kind: exactly("level"), speedMetersPerSecond: AMOUNT, angleDegrees: AMOUNT, gravityMetersPerSecondSquared: AMOUNT }),
      fall: record({ kind: exactly("fall"), speedMetersPerSecond: AMOUNT, heightMeters: AMOUNT, gravityMetersPerSecondSquared: AMOUNT }),
    }),
    marginsMeters: record({ left: NUMBER, right: NUMBER, bottom: NUMBER, top: NUMBER }),
    pixelsPerMeter: NUMBER,
  }),
});

// Every number source in the template and frame, with its path, so each named setting can be checked.
function* numberSources(demonstration: SavedDemonstration): Generator<readonly [string, DemonstrationNumber]> {
  const scene = demonstration.scene;
  yield ["scene.gravityStrengthMetersPerSecondSquared", scene.gravityStrengthMetersPerSecondSquared];
  yield ["scene.linearDragKilogramsPerSecond", scene.linearDragKilogramsPerSecond];

  for (const [index, body] of scene.bodies.entries()) {
    const path = `scene.bodies[${index}]`;
    yield [`${path}.positionMeters.x`, body.positionMeters.x];
    yield [`${path}.positionMeters.y`, body.positionMeters.y];

    if (body.kind === "static") {
      yield [`${path}.widthMeters`, body.widthMeters];
      yield [`${path}.heightMeters`, body.heightMeters];
      yield [`${path}.angleDegrees`, body.angleDegrees];
    } else {
      yield [`${path}.radiusMeters`, body.radiusMeters];
      yield [`${path}.massKilograms`, body.massKilograms];
      yield [`${path}.launchSpeedMetersPerSecond`, body.launchSpeedMetersPerSecond];
      yield [`${path}.launchAngleDegrees`, body.launchAngleDegrees];
    }
  }

  const flight = demonstration.framing.flight;
  yield ["framing.flight.speedMetersPerSecond", flight.speedMetersPerSecond];
  yield ["framing.flight.gravityMetersPerSecondSquared", flight.gravityMetersPerSecondSquared];
  yield flight.kind === "level" ? ["framing.flight.angleDegrees", flight.angleDegrees] : ["framing.flight.heightMeters", flight.heightMeters];
}

// Broken references between parts; only run on a demonstration whose shape is already right.
function findReferenceProblems(demonstration: SavedDemonstration): readonly Diagnostic[] {
  const problems: Diagnostic[] = [];
  const report = (code: string, path: string, message: string): void => {
    problems.push({ code, path, message });
  };
  const controls = [demonstration.primary, ...demonstration.shared];
  const keys = controls.map((control) => control.key);
  const offers = (key: string, value: string | undefined): boolean => controls.find((control) => control.key === key)?.options.some((option) => option.value === value) === true;

  keys.forEach((key, index) => {
    if (keys.indexOf(key) !== index) {
      report("DUPLICATE_ID", "shared", `The setting "${key}" is used twice.`);
    }
  });

  controls.forEach((control) => {
    const values = control.options.map((option) => option.value);

    if (values.length === 0) {
      report("OUT_OF_RANGE", control.key, `"${control.key}" offers no options.`);
    }

    values.forEach((value, index) => {
      if (values.indexOf(value) !== index) {
        report("DUPLICATE_ID", control.key, `"${control.key}" offers "${value}" twice.`);
      } else if (!Number.isFinite(Number(value)) || value.trim() === "") {
        report("INVALID_SHAPE", control.key, `"${control.key}" option "${value}" is not a number.`);
      }
    });
  });

  for (const [field, value] of [["reference", demonstration.reference], ["comparison", demonstration.comparison]] as const) {
    if (!offers(demonstration.primary.key, value)) {
      report("UNKNOWN_REFERENCE", field, `"${value}" is not an option of "${demonstration.primary.key}".`);
    }
  }

  for (const control of demonstration.shared) {
    if (!offers(control.key, demonstration.sharedDefaults[control.key])) {
      report("UNKNOWN_REFERENCE", `sharedDefaults.${control.key}`, `The default for "${control.key}" must be one of its options.`);
    }
  }

  for (const key of Object.keys(demonstration.sharedDefaults)) {
    if (!demonstration.shared.some((control) => control.key === key)) {
      report("UNKNOWN_REFERENCE", `sharedDefaults.${key}`, `"${key}" is not a shared setting.`);
    }
  }

  const { choices, answerIndex } = demonstration.prediction;

  if (!Number.isInteger(answerIndex) || answerIndex < 0 || answerIndex >= choices.length) {
    report("OUT_OF_RANGE", "prediction.answerIndex", "The answer must point at one of the choices.");
  }

  if (!Number.isInteger(demonstration.order) || demonstration.order < 1) {
    report("OUT_OF_RANGE", "order", "The order must be a whole number from 1.");
  }

  for (const [path, source] of numberSources(demonstration)) {
    if (typeof source !== "number" && !keys.includes(source.parameter)) {
      report("UNKNOWN_REFERENCE", path, `"${source.parameter}" is not a setting of this demonstration.`);
    }
  }

  for (const match of demonstration.scene.id.matchAll(/\{([A-Za-z][A-Za-z0-9]*)\}/g)) {
    if (!keys.includes(match[1] ?? "")) {
      report("UNKNOWN_REFERENCE", "scene.id", `{${match[1]}} is not a setting of this demonstration.`);
    }
  }

  const bodyIds = demonstration.scene.bodies.map((body) => body.id);

  bodyIds.forEach((id, index) => {
    if (bodyIds.indexOf(id) !== index) {
      report("DUPLICATE_ID", `scene.bodies[${index}]`, `The body id "${id}" is used twice.`);
    }
  });

  if (!demonstration.scene.bodies.some((body) => body.kind === "dynamic")) {
    report("OUT_OF_RANGE", "scene.bodies", "A demonstration needs at least one launched ball.");
  }

  const margins = demonstration.framing.marginsMeters;

  if (!(demonstration.framing.pixelsPerMeter > 0) || [margins.left, margins.right, margins.bottom, margins.top].some((margin) => margin < 0)) {
    report("OUT_OF_RANGE", "framing", "The framing needs a positive scale and margins that are not negative.");
  }

  return problems;
}

// Returns every problem found; an empty list means the demonstration can be used. Scene physics is checked by the engine where it is available (the seed step).
export function findDemonstrationProblems(value: unknown): readonly Diagnostic[] {
  const problems: Diagnostic[] = [];
  checkShape(value, DEMONSTRATION, "", problems);

  if (problems.length > 0) {
    return problems;
  }

  return findReferenceProblems(value as SavedDemonstration);
}
