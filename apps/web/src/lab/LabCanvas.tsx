// Supplies the React mount reference and lifecycle effect.
import { useEffect, useRef } from "react";
// Supplies the portable scene and snapshot records.
import type { SceneDefinition, Snapshot } from "@eureka/contracts";
// Creates the headless physical-state owner for this mounted lab.
import { createEngine } from "@eureka/engine";
// Adapt reviewed frame sequences without running the numerical solver.
import { createSnapshotPlaybackEngine } from "./mocks.js";
// Supplies typed placement and movement requests from Pixi to React.
import type { MoveEntityRequest, PlacementRequest } from "./authoring.js";
// Creates and types the lab lifetime coordinator.
import { createLabController, type LabController, type PlaybackBrowser, type PlaybackState } from "./controller.js";
// Owns the mounted renderer.
import { mountLabRenderer, type LabRenderer } from "./renderer.js";

// Supply browser facilities while leaving callback and listener lifetime with the controller.
function createPlaybackBrowser(): PlaybackBrowser {
  return {
    requestFrame: (callback) => window.requestAnimationFrame(callback),
    cancelFrame: (handle) => window.cancelAnimationFrame(handle),
    isHidden: () => document.hidden,

    // Return the matching listener cleanup for controller disposal.
    subscribeVisibilityChange: (listener) => {
      document.addEventListener("visibilitychange", listener);
      return () => document.removeEventListener("visibilitychange", listener);
    },

    // Preserve asynchronous failure information until the visible error UI is wired.
    onFrameResult: (result) => {
      if (!result.ok) {
        console.error("Playback frame failed", result.diagnostics);
      }
    },
  };
}

// setDisplayedSnapshot SO THE CHILD CAN SEND BACK INFORMATION TO THE PARENT USING THAT FUNCTION
export function LabCanvas(props: {
  scene: SceneDefinition;
  setDisplayedSnapshot(snapshot: Snapshot): void;
  setActiveController(controller: LabController | null): void;
  onPlaybackChange(state: PlaybackState): void;
  onPlacementRequested(request: PlacementRequest): void;
  onMoveRequested(request: MoveEntityRequest): boolean;
  onDeleteRequested(entityId: string): boolean;
  sampleSnapshots?: readonly Snapshot[] | undefined;
}) {
  const toSetDisplayedSnapshot = props.setDisplayedSnapshot;
  const setActiveController = props.setActiveController;
  const onPlaybackChange = props.onPlaybackChange;
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

    // Use prepared frames for reviewed samples and the existing initial-state source for authoring.
    const engineResult = sampleSnapshots === undefined
      ? createEngine(scene)
      : createSnapshotPlaybackEngine(sampleSnapshots);

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

    // Start the viewport at the selected source's tick-zero state.
    const initialViewSnapshot = initialSnapshotResult.value;

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

    const controllerResult = createLabController({
      engine,
      initialScene: scene,
      // Draw every tick directly while sending React only copied, bounded readouts.
      consumeSnapshot: renderer.updateSnapshot,
      consumeReadout: toSetDisplayedSnapshot,
      releaseView: renderer.dispose,
      playbackBrowser: createPlaybackBrowser(),
      onPlaybackChange,
      stopAtTick: sampleSnapshots?.at(-1)?.tick,
    });

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

    return () => {
      // Dispose first so any final playback report precedes clearing the toolbar.
      controller.dispose({ preserveView: true });
      setActiveController(null);
    };
  }, [
    scene,
    toSetDisplayedSnapshot,
    setActiveController,
    onPlaybackChange,
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
