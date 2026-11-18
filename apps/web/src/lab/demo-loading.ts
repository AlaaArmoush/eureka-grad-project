import type { ChallengeDefinition, SceneDefinition, Snapshot } from "@eureka/contracts";
import { createEngine, type EngineResult } from "@eureka/engine";
import type { CameraView } from "./coordinates.js";
import { applyValues, checkValue, findLockViolations, initialValues, valueKey, type ChallengeValues } from "./challenge-player.js";
import { resolveParameters, TOPIC_ONE_DEMONSTRATIONS, type DemonstrationDefinition, type DemonstrationParameters } from "./demonstrations.js";

// What every load into the lab supplies, whatever it was loaded from.
export interface SceneLoad {
  readonly title: string;
  readonly scene: SceneDefinition;
  readonly initialSnapshot: Snapshot;
  readonly selectedEntityId: string | null;
  readonly camera: CameraView;
  readonly overlays: DemonstrationDefinition["overlays"];
}

// A selection names a question and one complete setup; the scene is built when it is opened.
export interface DemonstrationSelection {
  readonly groupId: string;
  readonly parameters: DemonstrationParameters;
}

export interface DemonstrationLoad extends SceneLoad {
  readonly selection: DemonstrationSelection;
}

// A challenge load also carries the definition and the values its scene starts with.
export interface ChallengeLoad extends SceneLoad {
  readonly definition: ChallengeDefinition;
  readonly values: ChallengeValues;
}

function unavailable(path: string, message: string): EngineResult<never> {
  return { ok: false, diagnostics: [{ code: "OUT_OF_RANGE", path, message }] };
}

// Check a scene with the engine and copy its tick-zero snapshot. The temporary engine is always disposed.
function prepareSceneLoad(title: string, scene: SceneDefinition, selectedEntityId: string | null, camera: CameraView, overlays: SceneLoad["overlays"]): EngineResult<SceneLoad> {
  const engineResult = createEngine(scene);

  if (!engineResult.ok) {
    return engineResult;
  }

  const engine = engineResult.value;

  try {
    const snapshotResult = engine.copySnapshot();

    if (!snapshotResult.ok) {
      return snapshotResult;
    }

    return { ok: true, value: { title, scene, initialSnapshot: snapshotResult.value, selectedEntityId, camera, overlays } };
  } finally {
    engine.dispose();
  }
}

// Prepare independent starting data without changing the mounted lab or editor store.
export function prepareDemonstrationLoad(selection: DemonstrationSelection): EngineResult<DemonstrationLoad> {
  const group = TOPIC_ONE_DEMONSTRATIONS.find((item) => item.id === selection.groupId);

  if (group === undefined) {
    return unavailable("demonstration.selection", "The selected demonstration is unavailable.");
  }

  const parameters = resolveParameters(group, selection.parameters);

  if (parameters === undefined) {
    return unavailable("demonstration.parameters", "The selected setup uses a value this demonstration does not offer.");
  }

  const scene = group.buildScene(parameters);
  const loaded = prepareSceneLoad(group.title, scene, scene.bodies.find((body) => body.kind === "dynamic")?.id ?? null, group.frame(parameters), { ...group.overlays });

  if (!loaded.ok) {
    return loaded;
  }

  return { ok: true, value: { ...loaded.value, selection: { groupId: selection.groupId, parameters: { ...parameters } } } };
}

// Prepare a challenge's own scene, after checking that its starting values sit inside its ranges and agree with its locks.
export function prepareChallengeLoad(definition: ChallengeDefinition): EngineResult<ChallengeLoad> {
  const values = initialValues(definition);
  const scene = applyValues(definition, values);

  for (const item of definition.editable) {
    const message = checkValue(item, values[valueKey(item)] ?? Number.NaN);

    if (message !== null) {
      return unavailable("challenge.editable", `"${definition.title}" starts outside its own editable range. ${message}`);
    }
  }

  const violations = findLockViolations(definition, scene, values);

  if (violations.length > 0) {
    return unavailable("challenge.locked", `"${definition.title}" disagrees with its own locks. ${violations.join(" ")}`);
  }

  const loaded = prepareSceneLoad(definition.title, scene, definition.projectileId, definition.view, { ...definition.overlays });

  if (!loaded.ok) {
    return loaded;
  }

  return { ok: true, value: { ...loaded.value, definition, values } };
}

