import { useEffect, useLayoutEffect, useRef } from "react";
// Supplies the portable scene and snapshot records.
import type { SceneDefinition, Snapshot, SnapshotEvent } from "@eureka/contracts";
// Creates the headless physical-state owner for this mounted lab.
import { createEngine, type EngineStatus } from "@eureka/engine";
// Supplies typed placement and movement requests from Pixi to React.
import type { MoveEntityRequest, PlacementRequest } from "./authoring.js";
// Creates and types the lab lifetime coordinator.
import { createLabController, type LabController, type PlaybackBrowser, type PlaybackState } from "./controller.js";
// Owns the mounted renderer.
import { mountLabRenderer, type LabRenderer, type PullHandlers } from "./renderer.js";
// Names a failed tick so App can tell it apart from other rejected actions.
import { PULL_FAILED, RUN_STOPPED } from "./lab-messages.js";

// Supply browser facilities and forward failures from scheduled playback.
function createPlaybackBrowser(
  onOperationResult: (context: string, result: EngineStatus) => void,
): PlaybackBrowser {
  return {
    requestFrame: (callback) => window.requestAnimationFrame(callback),
    cancelFrame: (handle) => window.cancelAnimationFrame(handle),
    isHidden: () => document.hidden,

    // The controller removes this listener when its lifetime ends.
    subscribeVisibilityChange: (listener) => {
      document.addEventListener("visibilitychange", listener);
      return () => document.removeEventListener("visibilitychange", listener);
    },

    // The controller has already paused before reporting a failed tick.
    onFrameResult: (result) => {
      if (!result.ok) {
        onOperationResult(RUN_STOPPED, result);
      }
    },
  };
}

// setDisplayedSnapshot SO THE CHILD CAN SEND BACK INFORMATION TO THE PARENT USING THAT FUNCTION
export function LabCanvas(props: {
  scene: SceneDefinition;
  setDisplayedSnapshot(snapshot: Snapshot): void;
  setRunEvents(events: readonly SnapshotEvent[]): void;
  setActiveController(controller: LabController | null): void;
  onPlaybackChange(state: PlaybackState): void;
  onOperationResult(context: string, result: EngineStatus): void;
  onPlacementRequested(request: PlacementRequest): void;
  onMoveRequested(request: MoveEntityRequest): boolean;
  onDeleteRequested(entityId: string): boolean;
  onTick?(snapshot: Snapshot): void;
}) {
  const toSetDisplayedSnapshot = props.setDisplayedSnapshot;
  const setRunEvents = props.setRunEvents;
  const setActiveController = props.setActiveController;
  const onPlaybackChange = props.onPlaybackChange;
  const onOperationResult = props.onOperationResult;
  const onPlacementRequested = props.onPlacementRequested;
  const onMoveRequested = props.onMoveRequested;
  const onDeleteRequested = props.onDeleteRequested;
  const onTick = props.onTick;
  const scene = props.scene;
  const hostRef = useRef<HTMLDivElement>(null);
  // Keep the same Pixi application across accepted authoring edits.
  const rendererRef = useRef<LabRenderer | null>(null);
  // The renderer keeps its first pull handlers, so they find the current controller through these refs.
  const controllerRef = useRef<LabController | null>(null);
  const reportRef = useRef(onOperationResult);

  useLayoutEffect(() => {
    const host = hostRef.current;

    if (host === null) {
      return;
    }

    setActiveController(null);
    reportRef.current = onOperationResult;

    const pullHandlers: PullHandlers = {
      start(bodyId, localAnchorMeters, targetMeters) {
        const controller = controllerRef.current;

        // Before Run or while paused, the Move tool moves the starting position instead.
        if (controller === null || !controller.getPlaybackState().playing) {
          return "notRunning";
        }

        const result = controller.startPull(bodyId, localAnchorMeters, targetMeters);

        if (!result.ok) {
          reportRef.current(PULL_FAILED, result);
          return "rejected";
        }

        return "started";
      },
      move(targetMeters) {
        const result = controllerRef.current?.movePull(targetMeters);

        if (result !== undefined && !result.ok) {
          reportRef.current(PULL_FAILED, result);
          return false;
        }

        return true;
      },
      release() {
        controllerRef.current?.endPull();
      },
    };

    function failSetup(result: EngineStatus): void {
      onOperationResult("The lab couldn't open this scene", result);
      rendererRef.current?.dispose();
      rendererRef.current = null;
    }

    // Every scene, including the starting projectile launch, runs on the real engine.
    const engineResult = createEngine(scene);

    if (!engineResult.ok) {
      failSetup(engineResult);
      return;
    }

    const engine = engineResult.value;
    const initialSnapshotResult = engine.getSnapshot();

    if (!initialSnapshotResult.ok) {
      engine.dispose();
      failSetup(initialSnapshotResult);
      return;
    }

    // Start the viewport at the engine's tick-zero state.
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
      pullHandlers,
    );

    rendererRef.current = renderer;

    if (previousRenderer !== null) {
      renderer.updateScene(scene, initialViewSnapshot);
    }

    const controllerResult = createLabController({
      engine,
      initialScene: scene,
      // Draw every tick directly while sending React only copied, bounded readouts.
      consumeSnapshot: renderer.updateSnapshot,
      consumeReadout: toSetDisplayedSnapshot,
      consumeTick: onTick,
      consumeRunEvents: (events) => {
        renderer.updateRunEvents(events);
        setRunEvents(events);
      },
      releaseView: renderer.dispose,
      playbackBrowser: createPlaybackBrowser(onOperationResult),
      onPlaybackChange,
    });

    if (!controllerResult.ok) {
      engine.dispose();
      failSetup(controllerResult);
      return;
    }

    const controller = controllerResult.value;

    controllerRef.current = controller;
    setActiveController(controller);

    return () => {
      // Dispose first so any final playback report precedes clearing the toolbar.
      controller.dispose({ preserveView: true });
      controllerRef.current = null;
      setActiveController(null);
    };
  }, [
    scene,
    toSetDisplayedSnapshot,
    setRunEvents,
    setActiveController,
    onPlaybackChange,
    onOperationResult,
    onPlacementRequested,
    onMoveRequested,
    onDeleteRequested,
    onTick,
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
        aria-label="Physics canvas. Enter places an object, Escape exits placement to Move, Delete removes selection, arrow keys pan."
        aria-keyshortcuts="Enter Escape Delete Backspace ArrowLeft ArrowRight ArrowUp ArrowDown"
        tabIndex={0}
        data-pixi-host
        ref={hostRef}
        role="group"
        style={{
          overflow: "hidden",
          width: "100%",
        }}
      />

    </>
  );
}
