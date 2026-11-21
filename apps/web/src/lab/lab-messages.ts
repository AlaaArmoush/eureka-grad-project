// Learner-facing wording for the lab: diagnostics as sentences a learner can act on, and readable object names.
// The engine keeps precise developer messages and IDs; only this module decides what the lab says.
import type { Diagnostic, SceneDefinition, SnapshotEvent } from "@eureka/contracts";

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

// Lead-in for a pull the lab couldn't start or update; the sentence after it says what to do.
export const PULL_FAILED = "Couldn't pull the ball";

// The controller's reason when a pull starts without a playing run.
export const PULL_NEEDS_RUN = "Press Run first, then drag a ball to pull it.";

// Three decimals for event values, so -0.000 never appears.
function threeDecimals(value: number): string {
  const text = value.toFixed(3);
  return text === "-0.000" ? "0.000" : text;
}

// One recorded event as a plain sentence.
export function describeEvent(event: SnapshotEvent): { readonly title: string; readonly detail: string } {
  if (event.kind === "targetEntered") {
    return { title: "Entered a target", detail: `${objectName(event.bodyId)} passed into ${objectName(event.targetId)}` };
  }

  const point = `x = ${threeDecimals(event.pointMeters.x)} m, y = ${threeDecimals(event.pointMeters.y)} m`;
  return { title: "Hit a surface", detail: `${objectName(event.bodyId)} hit ${objectName(event.surfaceBodyId)} at ${point}` };
}

// The engine's signed work total for the pointer pull since the run started or was reset.
export function pullWorkText(joules: number): string {
  return `Your pull did ${joules.toFixed(2)} J of work`;
}

// Shown over an empty canvas.
export const EMPTY_SCENE_HINT = "This scene is empty. Add a ball, then press Run.";

// Two decimals at most, without trailing zeros: 17.32, 30, 0.5.
function shortNumber(value: number): string {
  return String(Number(value.toFixed(2)));
}

// One line for the scene list: what an object is and the numbers that matter most for it.
export function objectSummary(entity: SceneObject): string {
  if (entity.kind === "dynamic") {
    const { x, y } = entity.velocity.linearMetersPerSecond;
    const speed = Math.hypot(x, y);
    return speed === 0 ? "Ball · at rest" : `Ball · ${shortNumber(speed)} m/s at ${shortNumber(Math.atan2(y, x) * 180 / Math.PI)}°`;
  }

  if (entity.kind === "target") {
    return `Target · ${shortNumber(entity.shape.radiusMeters)} m radius`;
  }

  const size = `${shortNumber(entity.shape.widthMeters)} × ${shortNumber(entity.shape.heightMeters)} m`;
  const angle = entity.pose.angleRadians * 180 / Math.PI;
  return angle === 0 ? `Surface · ${size}` : `Surface · ${size} at ${shortNumber(angle)}°`;
}

// The bubble shown once above the setting a Curriculum question is about, when that question opens in the lab.
export const FIELD_GUIDE = "Try changing this, then press Run.";

// Shown when the run has more events than the lab keeps.
export function eventLimitNote(limit: number): string {
  return `Only the first ${limit} events of this run are listed.`;
}

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
  ["linearDragKilogramsPerSecond", "Linear drag"],
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
