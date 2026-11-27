// The small JSON-shape language every stored record (challenge, demonstration) is checked with, because it arrives as untrusted data.
import type { Diagnostic } from "./index.js";

export type Shape =
  | { readonly kind: "string" }
  | { readonly kind: "number" }
  | { readonly kind: "boolean" }
  | { readonly kind: "exactly"; readonly value: string | number }
  | { readonly kind: "oneOf"; readonly values: readonly string[] }
  | { readonly kind: "orNull"; readonly shape: Shape }
  | { readonly kind: "listOf"; readonly item: Shape }
  | { readonly kind: "record"; readonly fields: Readonly<Record<string, Shape>> }
  | { readonly kind: "mapOf"; readonly value: Shape }
  | { readonly kind: "variants"; readonly tag: string; readonly cases: Readonly<Record<string, Shape>> }
  | { readonly kind: "anyOf"; readonly description: string; readonly shapes: readonly Shape[] };

export const TEXT: Shape = { kind: "string" };
export const NUMBER: Shape = { kind: "number" };
export const FLAG: Shape = { kind: "boolean" };
export const exactly = (value: string | number): Shape => ({ kind: "exactly", value });
export const oneOf = (...values: string[]): Shape => ({ kind: "oneOf", values });
export const orNull = (shape: Shape): Shape => ({ kind: "orNull", shape });
export const listOf = (item: Shape): Shape => ({ kind: "listOf", item });
export const record = (fields: Record<string, Shape>): Shape => ({ kind: "record", fields });
// An object whose keys are free (such as measurement ids) and whose values all have one shape.
export const mapOf = (value: Shape): Shape => ({ kind: "mapOf", value });
export const variants = (tag: string, cases: Record<string, Shape>): Shape => ({ kind: "variants", tag, cases });
// A value that may have any one of several shapes, such as a fixed number or a setting reference.
export const anyOf = (description: string, ...shapes: Shape[]): Shape => ({ kind: "anyOf", description, shapes });

export const VECTOR = record({ x: NUMBER, y: NUMBER });
export const POSE = record({ positionMeters: VECTOR, angleRadians: NUMBER });
export const MATERIAL = record({ restitution: NUMBER });
export const TOPIC = oneOf("projectiles", "collisions", "rotationFriction", "oscillations", "energyMeasurement", "fields", "optics");
export const NUMERICAL_PROFILE = record({
  fixedTimeStepSeconds: NUMBER,
  substeps: NUMBER,
  scales: record({ lengthMeters: NUMBER, massKilograms: NUMBER, timeSeconds: NUMBER }),
});
export const OVERLAYS = record({ trail: FLAG, velocity: FLAG, components: FLAG, prediction: FLAG, events: FLAG, grid: FLAG, labels: FLAG });

// Keep this in step with SceneDefinition in index.ts.
export const SCENE = record({
  schemaVersion: exactly(1),
  id: TEXT,
  revision: NUMBER,
  seed: NUMBER,
  numericalProfile: NUMERICAL_PROFILE,
  environment: record({ gravityMetersPerSecondSquared: VECTOR, linearDragKilogramsPerSecond: NUMBER }),
  bodies: listOf(variants("kind", {
    dynamic: record({
      id: TEXT,
      kind: exactly("dynamic"),
      shape: record({ kind: exactly("circle"), radiusMeters: NUMBER }),
      massKilograms: NUMBER,
      material: MATERIAL,
      pose: POSE,
      velocity: record({ linearMetersPerSecond: VECTOR, angularRadiansPerSecond: NUMBER }),
    }),
    static: record({
      id: TEXT,
      kind: exactly("static"),
      shape: record({ kind: exactly("box"), widthMeters: NUMBER, heightMeters: NUMBER }),
      material: MATERIAL,
      pose: POSE,
    }),
  })),
  triggers: listOf(record({ id: TEXT, kind: exactly("target"), shape: record({ kind: exactly("circle"), radiusMeters: NUMBER }), pose: POSE })),
});

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function checkRecord(value: unknown, fields: Readonly<Record<string, Shape>>, path: string, problems: Diagnostic[]): void {
  if (!isRecord(value)) {
    problems.push({ code: "INVALID_SHAPE", path, message: "Expected an object." });
    return;
  }

  for (const [name, fieldShape] of Object.entries(fields)) {
    const fieldPath = path === "" ? name : `${path}.${name}`;

    if (!Object.hasOwn(value, name)) {
      problems.push({ code: "MISSING_FIELD", path: fieldPath, message: `"${name}" is required.` });
    } else {
      checkShape(value[name], fieldShape, fieldPath, problems);
    }
  }

  for (const name of Object.keys(value)) {
    if (!Object.hasOwn(fields, name)) {
      problems.push({ code: "UNKNOWN_FIELD", path: path === "" ? name : `${path}.${name}`, message: `"${name}" is not a field of this record.` });
    }
  }
}

export function checkShape(value: unknown, shape: Shape, path: string, problems: Diagnostic[]): void {
  const report = (message: string): void => {
    problems.push({ code: "INVALID_SHAPE", path, message });
  };

  switch (shape.kind) {
    case "string":
      if (typeof value !== "string") {
        report("Expected text.");
      }
      return;
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value)) {
        report("Expected a finite number.");
      }
      return;
    case "boolean":
      if (typeof value !== "boolean") {
        report("Expected true or false.");
      }
      return;
    case "exactly":
      if (value !== shape.value) {
        report(`Expected ${JSON.stringify(shape.value)}.`);
      }
      return;
    case "oneOf":
      if (typeof value !== "string" || !shape.values.includes(value)) {
        report(`Expected one of: ${shape.values.join(", ")}.`);
      }
      return;
    case "orNull":
      if (value !== null) {
        checkShape(value, shape.shape, path, problems);
      }
      return;
    case "listOf":
      if (!Array.isArray(value)) {
        report("Expected a list.");
        return;
      }

      value.forEach((item: unknown, index: number) => {
        checkShape(item, shape.item, `${path}[${index}]`, problems);
      });
      return;
    case "record":
      checkRecord(value, shape.fields, path, problems);
      return;
    case "mapOf":
      if (!isRecord(value)) {
        report("Expected an object.");
        return;
      }

      for (const [name, item] of Object.entries(value)) {
        checkShape(item, shape.value, `${path}.${name}`, problems);
      }
      return;
    case "variants": {
      const tag = isRecord(value) ? value[shape.tag] : undefined;
      const chosen = typeof tag === "string" && Object.hasOwn(shape.cases, tag) ? shape.cases[tag] : undefined;

      if (chosen === undefined) {
        report(`"${shape.tag}" must be one of: ${Object.keys(shape.cases).join(", ")}.`);
        return;
      }

      checkShape(value, chosen, path, problems);
      return;
    }
    case "anyOf":
      if (!shape.shapes.some((candidate) => {
        const trial: Diagnostic[] = [];
        checkShape(value, candidate, path, trial);
        return trial.length === 0;
      })) {
        report(`Expected ${shape.description}.`);
      }
      return;
  }
}
