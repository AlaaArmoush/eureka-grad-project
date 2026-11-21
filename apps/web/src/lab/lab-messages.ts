// Learner-facing wording for the lab: diagnostics as sentences a learner can act on, and readable object names.
// The engine keeps precise developer messages and IDs; only this module decides what the lab says.
import type { Diagnostic, SceneDefinition } from "@eureka/contracts";

type SceneObject = SceneDefinition["bodies"][number] | SceneDefinition["triggers"][number];

// "platform-1" reads as "Platform 1"; the ID itself stays the stable reference everywhere else.
export function objectName(id: string): string {
  const words = id.replaceAll("-", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// What kind of thing an object is, in the words the lab uses for it.
export function objectKindLabel(kind: SceneObject["kind"]): string {
  return kind === "dynamic" ? "Moving ball" : kind === "target" ? "Target · balls pass through" : "Solid surface";
}

// Reported by the canvas when a running or stepped tick fails; App uses it to mark a challenge attempt unjudgeable.
export const RUN_STOPPED = "The run stopped";

// Shown when the lab is between canvases, for example while a new scene is loading.
export const LAB_NOT_READY = "The lab isn't ready yet. Try again in a moment.";

// Plain names for the scene fields a diagnostic path can point at.
const FIELD_NAMES: readonly (readonly [string, string])[] = [
  ["massKilograms", "Mass"],
  ["radiusMeters", "Radius"],
  ["widthMeters", "Width"],
  ["heightMeters", "Height"],
  ["restitution", "Restitution"],
  ["angleRadians", "Angle"],
  ["positionMeters", "Position"],
  ["linearMetersPerSecond", "Launch velocity"],
  ["gravityMetersPerSecondSquared", "Gravity"],
  ["linearDragKilogramsPerSecond", "Air resistance"],
];

function fieldName(path: string): string | undefined {
  return FIELD_NAMES.find(([key]) => path.includes(key))?.[1];
}

// One sentence for one diagnostic. Unknown or internal codes get a safe general sentence, never a code or path.
export function describeDiagnostic(diagnostic: Diagnostic): string {
  const field = fieldName(diagnostic.path);

  switch (diagnostic.code) {
    case "INVALID_INITIAL_OVERLAP":
      return "A ball can't start inside a solid object. Move it to an empty spot.";
    case "NONFINITE_NUMBER":
      return `${field ?? "Each value"} must be a number.`;
    case "OUT_OF_RANGE":
      // Controller messages are already written for learners; engine range messages are rephrased per field.
      if (field === undefined) {
        return diagnostic.message;
      }
      if (diagnostic.message.includes("between zero and one")) {
        return `${field} must be between 0 and 1.`;
      }
      if (diagnostic.message.includes("nonnegative")) {
        return `${field} can't be negative.`;
      }
      return `${field} must be more than 0.`;
    case "UNKNOWN_ENTITY_ID":
      return "That object is no longer in the scene. Select another one.";
    case "INVALID_BODY_KIND":
      return "That change only works on a ball.";
    case "DUPLICATE_ENTITY_ID":
      return "Two objects ended up with the same name. Undo the last change and try again.";
    case "DISPOSED_ENGINE":
      return "The lab was closed. Open it again to continue.";
    case "NONFINITE_STATE":
      return "The numbers grew too large to calculate. Reset and try smaller values.";
    case "UNRESOLVED_EVENT_LIMIT":
      return "Too many collisions happened at once. Reset and move the objects further apart.";
    default:
      return "Something went wrong in the lab. Reset and try again.";
  }
}

// The first problem is the one to fix; listing several at once overwhelms a learner.
export function describeProblem(diagnostics: readonly Diagnostic[], fallback: string): string {
  const first = diagnostics[0];
  return first === undefined ? fallback : describeDiagnostic(first);
}
