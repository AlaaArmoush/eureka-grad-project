import { useCallback, useEffect } from "react";
import { useRef, useState } from "react";
import { PROJECTILE_LAB_MOCK } from "./lab/mocks";
import type { MoveEntityRequest, PlacementRequest } from "./lab/authoring";
import { ObjectLibrary } from "./lab/ObjectLibrary";
import {
  Atom,
  BookOpen,
  Folder,
  Users,
  Eye,
  Play,
  Pause,
  StepForward,
  RotateCcw,
  PanelLeft,
  Expand,
  Shrink,
} from "lucide-react";
import { useStore } from "zustand";
import { labStore } from "./lab/store";
import type { LabController } from "./lab/controller";
import { LabCanvas } from "./lab/LabCanvas";
import type { Snapshot, SceneDefinition } from "@eureka/contracts";
import "./App.css";
import { CanvasTools } from "./lab/CanvasTools.js";
import { SceneInspector } from "./lab/SceneInspector.js";
import { SceneOutline } from "./lab/SceneOutline.js";
import { ObservationNotebook } from "./lab/ObservationNotebook.js";

const OVERLAY_OPTIONS = [
  { key: "trail", label: "Trail" },
  { key: "velocity", label: "Velocity" },
  { key: "components", label: "Components" },
  { key: "prediction", label: "Ideal prediction" },
  { key: "events", label: "Target entry" },
  { key: "grid", label: "Grid" },
  { key: "labels", label: "Labels" },
] as const;

export function App() {
  const [displayedSnapshot, setDisplayedSnapshot] = useState<Snapshot>(
    PROJECTILE_LAB_MOCK.snapshot,
  );
  const [editableScene, setEditableScene] = useState<SceneDefinition>(() =>
    structuredClone(PROJECTILE_LAB_MOCK.scene),
  );
  const [labVisible, setLabVisible] = useState(true);
  const [sceneOutlineOpen, setSceneOutlineOpen] = useState(false);
  const outlineToggleRef = useRef<HTMLButtonElement>(null);
  const viewportRef = useRef<HTMLElement>(null);
  const [viewportExpanded, setViewportExpanded] = useState(false);
  const [viewportError, setViewportError] = useState<string | null>(null);

  function closeSceneOutline(): void {
    setSceneOutlineOpen(false);
    outlineToggleRef.current?.focus();
  }

  // Let the browser expand the existing viewport without replacing its mounted canvas.
  async function toggleViewportSize(): Promise<void> {
    const viewport = viewportRef.current;
    if (viewport === null) {
      return;
    }
    try {
      if (document.fullscreenElement === viewport) {
        await document.exitFullscreen();
      } else {
        await viewport.requestFullscreen();
      }
    } catch {
      setViewportError("The viewport could not expand. You can still zoom and pan normally.");
    }
  }

  useEffect(() => {
    function handleFullscreenChange(): void {
      setViewportExpanded(viewportRef.current !== null && document.fullscreenElement === viewportRef.current);
      setViewportError(null);
    }
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);
  const selectedEntityId = useStore(
    labStore,
    (state) => state.selectedEntityId,
  );
  const activeTool = useStore(labStore, (state) => state.activeTool);
  const overlayVisibility = useStore(labStore, (state) => state.overlayVisibility);
  let activeSampleSnapshots;

  if (
    editableScene.id === PROJECTILE_LAB_MOCK.scene.id &&
    editableScene.revision === PROJECTILE_LAB_MOCK.scene.revision
  ) {
    activeSampleSnapshots = PROJECTILE_LAB_MOCK.trailSnapshots;
  } else {
    activeSampleSnapshots = undefined;
  }

  const controllerRef = useRef<LabController | null>(null);
  const setActiveController = useCallback(
    (controller: LabController | null) => {
      controllerRef.current = controller;
    },
    [],
  );

  useEffect(() => {
    if (!labVisible) {
      return;
    }
    function handleEscKey(event: KeyboardEvent) {
      if (event.key !== "Escape") {
        return;
      }

      const target = event.target;
      if (target instanceof HTMLElement) {
        if (
          target.matches("input, textarea, select") ||
          target.isContentEditable
        ) {
          return;
        }
      }
      labStore.getState().selectEntity(null);
    }
    window.addEventListener("keydown", handleEscKey);
    return () => {
      window.removeEventListener("keydown", handleEscKey);
    };
  }, [labVisible]);
  useEffect(() => {
    if (selectedEntityId === null) {
      return;
    }

    const selectedEntityStillExists =
      editableScene.bodies.some((body) => body.id === selectedEntityId) ||
      editableScene.triggers.some((trigger) => trigger.id === selectedEntityId);

    if (!selectedEntityStillExists) {
      labStore.getState().selectEntity(null);
    }
  }, [editableScene, selectedEntityId]);
  const handlePlacementRequested = useCallback((request: PlacementRequest) => {
    const controller = controllerRef.current;

    if (controller === null) {
      return;
    }

    let placementResult;

    if (request.entityKind === "ramp") {
      placementResult = controller.placeRamp(
        request.positionMeters,
        request.rampProperties,
      );
    } else if (request.entityKind === "projectile") {
      placementResult = controller.placeProjectile(
        request.positionMeters,
        request.projectileProperties,
      );
    } else if (request.entityKind === "platform") {
      placementResult = controller.placePlatform(
        request.positionMeters,
        request.platformProperties,
      );
    } else {
      placementResult = controller.placeTarget(
        request.positionMeters,
        request.targetProperties,
      );
    }
    if (!placementResult.ok) {
      console.error("Object placement rejected", placementResult.diagnostics);
      return;
    }

    setEditableScene(placementResult.value.scene);
    labStore.getState().selectEntity(placementResult.value.entityId);
  }, []);
  const handleMoveRequested = useCallback(
    (request: MoveEntityRequest): boolean => {
      const controller = controllerRef.current;

      if (controller === null) {
        return false;
      }

      const moveResult = controller.moveEntityWhilePaused(
        request.entityId,
        request.positionMeters,
      );

      if (!moveResult.ok) {
        console.error("Object movement rejected", moveResult.diagnostics);
        return false;
      }

      setEditableScene(moveResult.value.scene);
      labStore.getState().selectEntity(moveResult.value.entityId);
      return true;
    },
    [],
  );
  const handleDeleteRequested = useCallback((entityId: string): boolean => {
    const controller = controllerRef.current;

    if (controller === null) {
      return false;
    }

    const deleteResult = controller.deleteEntity(entityId);

    if (!deleteResult.ok) {
      console.error("Object deletion rejected", deleteResult.diagnostics);
      return false;
    }

    setEditableScene(deleteResult.value.scene);
    labStore.getState().selectEntity(null);
    return true;
  }, []);
  return (
    <div className="eureka-app">
      <aside className="site-rail" aria-label="Eureka">
        <a className="brand" href="#laboratory"><Atom size={24} /><span>Eureka<small>computational physics studio</small></span></a>
        <nav aria-label="Workspace">
          <span className="rail-label">Explore</span>
          <a className="rail-link is-current" href="#laboratory" aria-current="page"><Atom size={17} />Physics laboratory</a>
          <button className="rail-link" type="button" disabled><BookOpen size={17} />Learning library</button>
          <span className="rail-label">Your work</span>
          <button className="rail-link" type="button" disabled><Folder size={17} />My experiments</button>
          <button className="rail-link" type="button" disabled><Users size={17} />Classes</button>
        </nav>
        <div className="rail-footer"><span className="status-dot" />Local laboratory<small>Explore · observe · understand</small></div>
      </aside>
      <div className="workspace">
        <div className="workspace-topbar"><span>Workspace <i>/</i> Mechanics <i>/</i> <strong>Projectiles</strong></span><span className="scene-badge">{activeSampleSnapshots === undefined ? "Authored scene" : "Sample scene"}</span></div>
        <main id="laboratory" className="lab-shell">
          <header className="lab-header">
            <div><p className="eyebrow"><span>01</span>Mechanics laboratory</p><h1>A question of trajectory.</h1><p className="lab-subtitle">Explore the relationship between motion, gravity and geometry.</p></div>
            <button onClick={() => setLabVisible((visible) => !visible)} type="button">{labVisible ? "Leave lab" : "Enter lab"}</button>
          </header>
          <div className="lab-layout">
            <div className="workbench-column">
              <div className="playback-bar">
                <span className="playback-action" title="Play">
                  <button aria-label="Play" disabled type="button">
                    <Play size={14} />
                  </button>
                </span>
                <span className="playback-action" title="Pause">
                  <button aria-label="Pause" disabled type="button">
                    <Pause size={14} />
                  </button>
                </span>
                <span className="playback-action" title="Step">
                  <button aria-label="Step" disabled type="button">
                    <StepForward size={14} />
                  </button>
                </span>
                <span className="playback-action" title="Reset">
                  <button aria-label="Reset" disabled type="button">
                    <RotateCcw size={14} />
                  </button>
                </span>
                <label htmlFor="simulation-speed">Speed </label>
                <select name="Speed:" id="simulation-speed" defaultValue="1" disabled>
                  <option value="0.25">0.25x</option>
                  <option value="0.5">0.5x </option>
                  <option value="1">1x</option>
                  <option value="2">2x</option>
                  <option value="4">4x</option>
                </select>
                <p>
                  Time:
                  {displayedSnapshot.simulationTimeSeconds.toFixed(3)} s
                </p>
                <p>Tick: {displayedSnapshot.tick}</p>
              </div>
              <section ref={viewportRef} className="canvas" aria-label="Scene viewport">
                <header className="panel-heading">
                  <h2><Atom size={15} />Scene viewport</h2>
                  <div className="viewport-actions">
                    <button
                      ref={outlineToggleRef}
                      className="tool-btn"
                      type="button"
                      aria-expanded={sceneOutlineOpen}
                      aria-controls="scene-outline"
                      onClick={() => setSceneOutlineOpen((open) => !open)}
                    >
                      <PanelLeft size={14} />Scene
                    </button>
                    <button
                      className="tool-btn"
                      type="button"
                      aria-label={viewportExpanded ? "Exit expanded viewport" : "Expand viewport"}
                      title={viewportExpanded ? "Exit expanded viewport" : "Expand viewport"}
                      disabled={!document.fullscreenEnabled}
                      onClick={() => { void toggleViewportSize(); }}
                    >
                      {viewportExpanded ? <Shrink size={14} /> : <Expand size={14} />}
                    </button>
                  </div>
                </header>
                <div className={`canvas-workbench${sceneOutlineOpen ? " outline-open" : ""}`}>
                  <aside className="object-library" aria-label="Add objects"><ObjectLibrary /></aside>
                  {sceneOutlineOpen && <SceneOutline scene={editableScene} selectedEntityId={selectedEntityId} onClose={closeSceneOutline} />}
                  <div className="canvas-page">
                    <div className="canvas-heading"><span>— Motion study</span>
                      <CanvasTools />
                    </div>
                    {labVisible ? (
                      <LabCanvas scene={editableScene} sampleSnapshots={activeSampleSnapshots} setDisplayedSnapshot={setDisplayedSnapshot} setActiveController={setActiveController} onPlacementRequested={handlePlacementRequested} onMoveRequested={handleMoveRequested} onDeleteRequested={handleDeleteRequested} />
                    ) : <div className="closed-lab"><Atom size={32} /><p>Your laboratory is closed.</p><button type="button" className="tool-btn" onClick={() => setLabVisible(true)}>Enter lab</button></div>}
                    <div className="canvas-legend" aria-label="Path legend"><span><i className="path-swatch trail" />Recorded trail</span><span><i className="path-swatch prediction" />Ideal prediction</span><span><i className="velocity-swatch" />Velocity</span><span><i className="target-swatch" />Target sensor</span></div>
                  </div>
                </div>
                <div className="viewport-status"><span><span className="status-dot" />{activeSampleSnapshots === undefined ? "Authored initial state" : "Handwritten sample"}</span><span>{activeTool.kind === "place" ? "Click the page to place your object" : activeTool.kind === "move" ? "Drag an object to move it" : activeTool.kind === "delete" ? "Click an object to delete it" : activeTool.kind === "pan" ? "Drag the page to pan" : "Select an object to inspect · Escape to deselect"}</span><code>t {displayedSnapshot.simulationTimeSeconds.toFixed(2)} s / tick {displayedSnapshot.tick}</code></div>
                {viewportError !== null && <p className="viewport-error" role="alert">{viewportError}</p>}
              </section>
              <section className="display-panel" aria-label="Display options">
                <h2><Eye size={15} />Show in viewport</h2>
                <div className="display-options">
                  {OVERLAY_OPTIONS.map((option) => (
                    <label key={option.key}>
                      <input type="checkbox" checked={overlayVisibility[option.key]} onChange={(event) => labStore.getState().setOverlayVisible(option.key, event.currentTarget.checked)} />
                      {(option.key === "trail" || option.key === "prediction") && <span aria-hidden="true" className={`path-swatch ${option.key}`} />}
                      {option.label}
                    </label>
                  ))}
                </div>
              </section>
              <ObservationNotebook snapshot={displayedSnapshot} selectedEntityId={selectedEntityId} />
            </div>
            <SceneInspector controllerRef={controllerRef} displayedSnapshot={displayedSnapshot} editableScene={editableScene} selectedEntityId={selectedEntityId} setEditableScene={setEditableScene} />
          </div>
          <footer className="workspace-footer"><span>Eureka <i>/</i> A place to make physics visible.</span><span>{activeSampleSnapshots === undefined ? "Scene authoring" : "Sample observation"} · SI units</span></footer>
        </main>
      </div>
    </div>
  );
}
