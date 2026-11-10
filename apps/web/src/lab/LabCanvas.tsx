// Supplies the React mount reference and lifecycle effect.
import { useEffect, useRef } from "react";
// Supplies the portable scene and snapshot records.
import type { SceneDefinition, Snapshot } from "@eureka/contracts";
// Creates the headless physical-state owner for this mounted lab.
import { createEngine } from "@eureka/engine";
// Supplies typed placement and movement requests from Pixi to React.
import type { MoveEntityRequest, PlacementRequest } from "./authoring.js";
// Creates and types the lab lifetime coordinator.
import { createLabController, type LabController } from "./controller.js";
// Mounts and releases the Pixi canvas and its interactions.
import { mountLabRenderer } from "./renderer.js";

// setDisplayedSnapshot SO THE CHILD CAN SEND BACK INFORMATION TO THE PARENT USING THAT FUNCTION
export function LabCanvas(props: {
  scene: SceneDefinition;
  setDisplayedSnapshot(snapshot: Snapshot): void;
  setActiveController(controller: LabController | null): void;
  onPlacementRequested(request: PlacementRequest): void;
  onMoveRequested(request: MoveEntityRequest): boolean;
  onDeleteRequested(entityId: string): boolean;
}) {
  const toSetDisplayedSnapshot = props.setDisplayedSnapshot;
  const setActiveController = props.setActiveController;
  const onPlacementRequested = props.onPlacementRequested;
  const onMoveRequested = props.onMoveRequested;
  const onDeleteRequested = props.onDeleteRequested;
  const scene = props.scene;
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;

    if (host === null) {
      return;
    }

    setActiveController(null);

    const engineResult = createEngine(scene);

    if (!engineResult.ok) {
      console.error("Engine creation failed", engineResult.diagnostics);
      return;
    }

    const engine = engineResult.value;
    const initialSnapshotResult = engine.getSnapshot();

    if (!initialSnapshotResult.ok) {
      console.error(
        "Initial snapshot failed",
        initialSnapshotResult.diagnostics,
      );
      engine.dispose();
      return;
    }

    const renderer = mountLabRenderer(
      host,
      scene,
      initialSnapshotResult.value,
      onPlacementRequested,
      onMoveRequested,
      onDeleteRequested,
    );
    const controllerResult = createLabController(
      engine,
      scene,
      renderer.updateSnapshot,
      renderer.dispose,
    );

    if (!controllerResult.ok) {
      console.error("Controller creation failed", controllerResult.diagnostics);
      renderer.dispose();
      engine.dispose();
      return;
    }

    const controller = controllerResult.value;
    const readoutResult = controller.copySnapshot();

    if (!readoutResult.ok) {
      console.error("Readout copy failed", readoutResult.diagnostics);
      controller.dispose();
      return;
    }

    setActiveController(controller);
    toSetDisplayedSnapshot(readoutResult.value);

    return () => {
      setActiveController(null);
      controller.dispose();
    };
  }, [
    scene,
    toSetDisplayedSnapshot,
    setActiveController,
    onPlacementRequested,
    onMoveRequested,
    onDeleteRequested,
  ]);
  return (
    <div
      aria-label="Eureka physics canvas"
      data-pixi-host
      ref={hostRef}
      role="img"
      style={{
        height: "360px",
        overflow: "hidden",
        width: "100%",
      }}
    />
  );
}
