import type { Body, ChallengeDefinition, SceneDefinition, Snapshot, Vector2 } from "@eureka/contracts";
import { createEngine, type EngineResult } from "@eureka/engine";
import type { CameraView } from "./coordinates.js";
import { applyValues, checkValue, findLockViolations, initialValues, valueKey, type ChallengeValues } from "./challenge-player.js";
import { resolveParameters, unionFrames, type DemonstrationDefinition, type DemonstrationParameters } from "./demonstrations.js";
import { runPreview } from "./demonstration-preview.js";

// What every load into the lab supplies, whatever it was loaded from.
export interface SceneLoad {
  readonly title: string;
  readonly scene: SceneDefinition;
  readonly initialSnapshot: Snapshot;
  readonly selectedEntityId: string | null;
  readonly camera: CameraView;
  readonly overlays: DemonstrationDefinition["overlays"];
}

// A selection names a question and one complete setup, or two to compare; the scene is built when it is opened.
export interface DemonstrationSelection {
  readonly groupId: string;
  readonly parameters: DemonstrationParameters;
  // Setup B. When it differs from setup A, both are opened together.
  readonly comparison?: DemonstrationParameters;
}

export interface DemonstrationLoad extends SceneLoad {
  readonly selection: DemonstrationSelection;
  // Paths drawn faintly as a reference: setup A's flight, when the two setups cannot share one scene.
  readonly referencePaths: readonly (readonly Vector2[])[];
}

// Put setup B's balls into setup A's scene, numbered after A's. Only possible when both share the same world: environment and fixed bodies.
function combineSetups(sceneA: SceneDefinition, sceneB: SceneDefinition): SceneDefinition | undefined {
  const staticsA = sceneA.bodies.filter((body) => body.kind === "static");
  const staticsB = sceneB.bodies.filter((body) => body.kind === "static");

  if (JSON.stringify(sceneA.environment) !== JSON.stringify(sceneB.environment) || JSON.stringify(staticsA) !== JSON.stringify(staticsB)) {
    return undefined;
  }

  const taken = new Set(sceneA.bodies.map((body) => body.id));
  let next = sceneA.bodies.filter((body) => body.kind === "dynamic").length + 1;
  const added: Body[] = sceneB.bodies.flatMap((body) => {
    if (body.kind !== "dynamic") {
      return [];
    }

    while (taken.has(`projectile-${next}`)) {
      next += 1;
    }

    const id = `projectile-${next}`;
    taken.add(id);
    return [{ ...body, id }];
  });

  return { ...sceneA, id: `${sceneA.id}+${sceneB.id}`, bodies: [...sceneA.bodies, ...added] };
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

// Prepare independent starting data without changing the mounted lab or editor store. The questions are the catalogue loaded from the server.
export function prepareDemonstrationLoad(selection: DemonstrationSelection, demonstrations: readonly DemonstrationDefinition[]): EngineResult<DemonstrationLoad> {
  const group = demonstrations.find((item) => item.id === selection.groupId);

  if (group === undefined) {
    return unavailable("demonstration.selection", "The selected demonstration is unavailable.");
  }

  const parameters = resolveParameters(group, selection.parameters);

  if (parameters === undefined) {
    return unavailable("demonstration.parameters", "The selected setup uses a value this demonstration does not offer.");
  }

  const comparison = selection.comparison === undefined ? undefined : resolveParameters(group, selection.comparison);

  if (selection.comparison !== undefined && comparison === undefined) {
    return unavailable("demonstration.parameters", "The selected setup B uses a value this demonstration does not offer.");
  }

  const sceneA = group.buildScene(parameters);
  const sceneB = comparison === undefined || JSON.stringify(comparison) === JSON.stringify(parameters) ? undefined : group.buildScene(comparison);
  const combined = sceneB === undefined ? sceneA : combineSetups(sceneA, sceneB);
  // Setups that need different worlds (such as drag on and off) open as setup B, with setup A's flight drawn for reference.
  const scene = combined ?? sceneB ?? sceneA;
  const referencePaths = combined === undefined ? (runPreview(sceneA) ?? []).map((ball) => ball.trail) : [];
  const camera = comparison === undefined ? group.frame(parameters) : unionFrames([group.frame(parameters), group.frame(comparison)]);
  const title = sceneB === undefined ? group.title : `${group.title}: setups A and B`;
  const loaded = prepareSceneLoad(title, scene, scene.bodies.find((body) => body.kind === "dynamic")?.id ?? null, camera, { ...group.overlays });

  if (!loaded.ok) {
    return loaded;
  }

  const kept: DemonstrationSelection = comparison === undefined ? { groupId: selection.groupId, parameters: { ...parameters } } : { groupId: selection.groupId, parameters: { ...parameters }, comparison: { ...comparison } };
  return { ok: true, value: { ...loaded.value, selection: kept, referencePaths } };
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

