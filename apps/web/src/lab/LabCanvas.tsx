import { useEffect, useLayoutEffect, useRef } from "react";
// Supplies the portable scene and snapshot records.
import type { SceneDefinition, Snapshot, SnapshotEvent } from "@eureka/contracts";
// Creates the headless physical-state owner for this mounted lab.
import { createEngine, type EngineStatus } from "@eureka/engine";
// Supplies typed placement and movement requests from Pixi to React.
import type { MoveEntityRequest, PlacementRequest } from "./authoring.js";
// Creates and types the lab lifetime coordinator.
import { createLabController, type LabController, type LabSceneView, type PlaybackBrowser, type PlaybackState } from "./controller.js";
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

interface LabCanvasProps {
  // The simulation source. Only a new source (opening a question or challenge) creates a new engine.
  source: SceneDefinition;
  setDisplayedSnapshot(snapshot: Snapshot): void;
  setRunEvents(events: readonly SnapshotEvent[]): void;
  setActiveController(controller: LabController | null): void;
  onSceneView(view: LabSceneView): void;
  onPlaybackChange(state: PlaybackState): void;
  onOperationResult(context: string, result: EngineStatus): void;
  onPlacementRequested(request: PlacementRequest): void;
  onMoveRequested(request: MoveEntityRequest): boolean;
  onDeleteRequested(entityId: string): boolean;
  onTick?(snapshot: Snapshot): void;
}

export function LabCanvas(props: LabCanvasProps) {
  const source = props.source;
  const hostRef = useRef<HTMLDivElement>(null);
  // Keep the same Pixi application across sources.
  const rendererRef = useRef<LabRenderer | null>(null);
  const controllerRef = useRef<LabController | null>(null);
  // Callbacks are read at call time, so a new callback never recreates the engine.
  const latest = useRef(props);

  useLayoutEffect(() => {
    latest.current = props;
  });

  useLayoutEffect(() => {
    const host = hostRef.current;

    if (host === null) {
      return;
    }

    latest.current.setActiveController(null);

    const pullHandlers: PullHandlers = {
      start(bodyId, localAnchorMeters, targetMeters) {
        const controller = controllerRef.current;

        // Before Run or while paused, the Move tool moves the object instead.
        if (controller === null || !controller.getPlaybackState().playing) {
          return "notRunning";
        }

        const result = controller.startPull(bodyId, localAnchorMeters, targetMeters);

        if (!result.ok) {
          latest.current.onOperationResult(PULL_FAILED, result);
          return "rejected";
        }

        return "started";
      },
      move(targetMeters) {
        const result = controllerRef.current?.movePull(targetMeters);

        if (result !== undefined && !result.ok) {
          latest.current.onOperationResult(PULL_FAILED, result);
          return false;
        }

        return true;
      },
      release() {
        controllerRef.current?.endPull();
      },
    };

    function failSetup(result: EngineStatus): void {
      latest.current.onOperationResult("The lab couldn't open this scene", result);
      rendererRef.current?.dispose();
      rendererRef.current = null;
    }

    // One engine for this source; edits change it through the controller, never by replacing it.
    const engineResult = createEngine(source);

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

    const initialViewSnapshot = initialSnapshotResult.value;

    // Create Pixi once, then hand it each new source without removing the canvas.
    const previousRenderer = rendererRef.current;
    const renderer = previousRenderer ?? mountLabRenderer(
      host,
      source,
      initialViewSnapshot,
      (request) => latest.current.onPlacementRequested(request),
      (request) => latest.current.onMoveRequested(request),
      (entityId) => latest.current.onDeleteRequested(entityId),
      pullHandlers,
    );

    rendererRef.current = renderer;

    if (previousRenderer !== null) {
      renderer.updateScene(source, initialViewSnapshot);
    }

    const controllerResult = createLabController({
      engine,
      initialScene: source,
      // Draw every tick directly while sending React only copied, bounded readouts.
      consumeSnapshot: renderer.updateSnapshot,
      consumeReadout: (snapshot) => latest.current.setDisplayedSnapshot(snapshot),
      consumeTick: (snapshot) => latest.current.onTick?.(snapshot),
      consumeScene: (view, snapshot) => {
        renderer.updateWorld(view.scene, view.preview, view.start, snapshot);
        latest.current.onSceneView(view);
      },
      consumeRunEvents: (events) => {
        renderer.updateRunEvents(events);
        latest.current.setRunEvents(events);
      },
      releaseView: renderer.dispose,
      playbackBrowser: createPlaybackBrowser((context, result) => latest.current.onOperationResult(context, result)),
      onPlaybackChange: (state) => latest.current.onPlaybackChange(state),
    });

    if (!controllerResult.ok) {
      engine.dispose();
      failSetup(controllerResult);
      return;
    }

    const controller = controllerResult.value;

    const setActiveController = latest.current.setActiveController;
    controllerRef.current = controller;
    setActiveController(controller);

    return () => {
      // Dispose first so any final playback report precedes clearing the toolbar.
      controller.dispose({ preserveView: true });
      controllerRef.current = null;
      setActiveController(null);
    };
  }, [source]);

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
