import type { SceneDefinition, Snapshot } from "@eureka/contracts";
import { createEngine, type EngineResult } from "@eureka/engine";
import type { CameraView } from "./coordinates.js";
import { resolveParameters, TOPIC_ONE_DEMONSTRATIONS, type DemonstrationDefinition, type DemonstrationParameters } from "./demonstrations.js";

// A selection names a question and one complete setup; the scene is built when it is opened.
export interface DemonstrationSelection {
  readonly groupId: string;
  readonly parameters: DemonstrationParameters;
}

export interface DemonstrationLoad {
  readonly selection: DemonstrationSelection;
  readonly title: string;
  readonly scene: SceneDefinition;
  readonly initialSnapshot: Snapshot;
  readonly selectedEntityId: string | null;
  readonly camera: CameraView;
  readonly overlays: DemonstrationDefinition["overlays"];
}

function unavailable(path: string, message: string): EngineResult<never> {
  return { ok: false, diagnostics: [{ code: "OUT_OF_RANGE", path, message }] };
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

    return {
      ok: true,
      value: {
        selection: { groupId: selection.groupId, parameters: { ...parameters } },
        title: group.title,
        scene,
        initialSnapshot: snapshotResult.value,
        selectedEntityId: scene.bodies.find((body) => body.kind === "dynamic")?.id ?? null,
        camera: group.frame(parameters),
        overlays: { ...group.overlays },
      },
    };
  } finally {
    engine.dispose();
  }
}
