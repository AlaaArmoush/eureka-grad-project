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
// Owns the mounted renderer.
import { mountLabRenderer, type LabRenderer } from "./renderer.js";

// setDisplayedSnapshot SO THE CHILD CAN SEND BACK INFORMATION TO THE PARENT USING THAT FUNCTION
export function LabCanvas(props: {
  scene: SceneDefinition;
  setDisplayedSnapshot(snapshot: Snapshot): void;
  setActiveController(controller: LabController | null): void;
  onPlacementRequested(request: PlacementRequest): void;
  onMoveRequested(request: MoveEntityRequest): boolean;
  onDeleteRequested(entityId: string): boolean;
  sampleSnapshots?: readonly Snapshot[] | undefined;
}) {
  const toSetDisplayedSnapshot = props.setDisplayedSnapshot;
  const setActiveController = props.setActiveController;
  const onPlacementRequested = props.onPlacementRequested;
  const onMoveRequested = props.onMoveRequested;
  const onDeleteRequested = props.onDeleteRequested;
  const sampleSnapshots = props.sampleSnapshots;
  const scene = props.scene;
  const hostRef = useRef<HTMLDivElement>(null);
  // Keep the same Pixi application across accepted authoring edits.
  const rendererRef = useRef<LabRenderer | null>(null);

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

    const sampleSnapshot =
      sampleSnapshots === undefined
        ? undefined
        : sampleSnapshots[sampleSnapshots.length - 1];

    const initialViewSnapshot = sampleSnapshot ?? initialSnapshotResult.value;

    // Create Pixi once, then update its scene without removing the canvas.
    const previousRenderer = rendererRef.current;
    const renderer = previousRenderer ?? mountLabRenderer(
      host,
      scene,
      initialViewSnapshot,
      onPlacementRequested,
      onMoveRequested,
      onDeleteRequested,
      sampleSnapshots ?? [],
    );

    rendererRef.current = renderer;

    if (previousRenderer !== null) {
      renderer.updateScene(scene, initialViewSnapshot, sampleSnapshots ?? []);
    }

    function consumeLiveSnapshot(nextSnapshot: Snapshot): void {
      if (sampleSnapshot !== undefined) {
        return;
      }

      renderer.updateSnapshot(nextSnapshot);
      toSetDisplayedSnapshot(structuredClone(nextSnapshot));
    }

    const controllerResult = createLabController(
      engine,
      scene,
      consumeLiveSnapshot,
      renderer.dispose,
    );
    if (!controllerResult.ok) {
      console.error("Controller creation failed", controllerResult.diagnostics);
      renderer.dispose();
      // Clear the retained handle after failed controller construction.
      rendererRef.current = null;
      engine.dispose();
      return;
    }

    const controller = controllerResult.value;

    setActiveController(controller);

    if (sampleSnapshot !== undefined) {
      toSetDisplayedSnapshot(structuredClone(sampleSnapshot));
    }

    return () => {
      setActiveController(null);
      // Retain Pixi for the next authored revision.
      controller.dispose({ preserveView: true });
    };
  }, [
    scene,
    toSetDisplayedSnapshot,
    setActiveController,
    onPlacementRequested,
    onMoveRequested,
    onDeleteRequested,
    sampleSnapshots,
  ]);

  // Release Pixi when this canvas host actually leaves the mounted lab.
  useEffect(() => {
    return () => {
      rendererRef.current?.dispose();
      rendererRef.current = null;
    };
  }, []);

  return (
    <>
      {/* Keep this host dedicated to Pixi. */}
      <div
        aria-label="Eureka physics canvas"
        data-pixi-host
        ref={hostRef}
        role="img"
        style={{
          overflow: "hidden",
          width: "100%",
        }}
      />

    </>
  );
}
