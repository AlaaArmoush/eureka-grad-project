// Curriculum questions as the browser uses them: stored data from the server, given the one generic scene builder and frame.
import { buildDemonstrationScene, demonstrationFrame, findDemonstrationProblems, frameAround, type DemonstrationControl, type SavedDemonstration, type SceneDefinition } from "@eureka/contracts";
import type { CameraView } from "./coordinates.js";

export type { DemonstrationControl, DemonstrationOption } from "@eureka/contracts";

export type DemonstrationParameters = Readonly<Record<string, string>>;

// One investigation: two setups that differ in the primary variable, and shared settings for both.
export interface DemonstrationDefinition extends SavedDemonstration {
  // Build a starting scene from one complete set of parameters, so no scene list has to be stored.
  buildScene(parameters: DemonstrationParameters): SceneDefinition;
  // The world area that shows the whole flight of these parameters.
  frame(parameters: DemonstrationParameters): CameraView;
}

// Give a checked stored question its scene builder and frame. Both are the shared generic ones; no question has code of its own.
function toDemonstration(saved: SavedDemonstration): DemonstrationDefinition {
  return {
    ...saved,
    buildScene: (parameters) => buildDemonstrationScene(saved, parameters),
    frame: (parameters) => demonstrationFrame(saved, parameters),
  };
}

// Keep each record that passes the shared check, in topic order, and report every one that does not.
export function readDemonstrations(records: readonly unknown[], onRejected: (message: string) => void): readonly DemonstrationDefinition[] {
  const accepted: SavedDemonstration[] = [];

  for (const record of records) {
    const first = findDemonstrationProblems(record)[0];

    if (first === undefined) {
      accepted.push(record as SavedDemonstration);
    } else {
      const name = typeof record === "object" && record !== null && "id" in record ? String(record.id) : "a demonstration";
      onRejected(`Demonstration ${name} was left out: ${first.path || "(definition)"}: ${first.message}`);
    }
  }

  return accepted.sort((left, right) => left.topic.localeCompare(right.topic) || left.order - right.order).map(toDemonstration);
}

// Combine the varied value with the settings both setups share.
export function setupParameters(definition: DemonstrationDefinition, primaryValue: string, shared: DemonstrationParameters): DemonstrationParameters {
  return { ...shared, [definition.primary.key]: primaryValue };
}

// Accept only parameters that name an offered option for every control, never arbitrary strings.
export function resolveParameters(definition: DemonstrationDefinition, parameters: DemonstrationParameters): DemonstrationParameters | undefined {
  const resolved: Record<string, string> = {};

  for (const control of [definition.primary, ...definition.shared] as readonly DemonstrationControl[]) {
    const value = parameters[control.key];

    if (value === undefined || !control.options.some((option) => option.value === value)) {
      return undefined;
    }

    resolved[control.key] = value;
  }

  return resolved;
}

// One frame that contains every given frame, for previews that show several setups together.
export function unionFrames(frames: readonly CameraView[]): CameraView {
  const bounds = frames.map((frame) => ({
    xMin: frame.centerWorldMeters.x - frame.widthMeters / 2,
    xMax: frame.centerWorldMeters.x + frame.widthMeters / 2,
    yMin: frame.centerWorldMeters.y - frame.heightMeters / 2,
    yMax: frame.centerWorldMeters.y + frame.heightMeters / 2,
  }));

  return frameAround(
    Math.min(...bounds.map((item) => item.xMin)),
    Math.max(...bounds.map((item) => item.xMax)),
    Math.min(...bounds.map((item) => item.yMin)),
    Math.max(...bounds.map((item) => item.yMax)),
    Math.min(...frames.map((frame) => frame.pixelsPerMeter)),
  );
}
