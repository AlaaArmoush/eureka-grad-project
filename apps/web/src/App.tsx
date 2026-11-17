import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
// Supply the reviewed static observation and its consecutive playback frames.
import { PROJECTILE_LAB_MOCK, PROJECTILE_PLAYBACK_SNAPSHOTS } from "./lab/mocks.js";
import type { MoveEntityRequest, PlacementRequest } from "./lab/authoring";
import { ObjectLibrary } from "./lab/ObjectLibrary";
import {
  Atom,
  Activity,
  ChevronDown,
  ChevronRight,
  Crosshair,
  Layers,
  BookOpen,
  CircleHelp,
  FolderOpen,
  GraduationCap,
  Images,
  LayoutDashboard,
  Plus,
  Settings2,
  Trophy,
  UserRound,
  X,
  Play,
  Pause,
  StepForward,
  RotateCcw,
  PanelLeft,
  Expand,
  Shrink,
  Power,
} from "lucide-react";
import { useStore } from "zustand";
import { labStore } from "./lab/store";
import { PLAYBACK_SPEEDS, type LabController, type PlaybackState } from "./lab/controller.js";
// Describe operation results displayed by the playback controls.
import type { EngineStatus } from "@eureka/engine";
import { LabCanvas } from "./lab/LabCanvas";
import type { Snapshot, SceneDefinition } from "@eureka/contracts";
import "./App.css";
import { CanvasTools } from "./lab/CanvasTools.js";
import { SceneInspector } from "./lab/SceneInspector.js";
import { SceneOutline } from "./lab/SceneOutline.js";
import { ObservationNotebook } from "./lab/ObservationNotebook.js";

const WORKSPACE_NAVIGATION = [
  { label: "Workspace", items: [
    { id: "dashboard", label: "Dashboard", Icon: LayoutDashboard },
    { id: "laboratory", label: "Physics lab", Icon: Atom },
    { id: "experiments", label: "My experiments", Icon: FolderOpen },
  ] },
  { label: "Learn & teach", items: [
    { id: "curriculum", label: "Curriculum", Icon: BookOpen },
    { id: "challenges", label: "Challenges", Icon: Trophy },
    { id: "classes", label: "Classes", Icon: GraduationCap },
  ] },
  { label: "Discover", items: [
    { id: "gallery", label: "Community gallery", Icon: Images },
  ] },
] as const;

export function App() {
  const [displayedSnapshot, setDisplayedSnapshot] = useState<Snapshot>(
    PROJECTILE_PLAYBACK_SNAPSHOTS[0] ?? PROJECTILE_LAB_MOCK.snapshot,
  );
  const [editableScene, setEditableScene] = useState<SceneDefinition>(() =>
    structuredClone(PROJECTILE_LAB_MOCK.scene),
  );
  const [labVisible, setLabVisible] = useState(true);
  const [sceneOutlineOpen, setSceneOutlineOpen] = useState(() => window.matchMedia("(min-width: 1101px)").matches);
  const [inspectorOpen, setInspectorOpen] = useState(() => window.matchMedia("(min-width: 901px)").matches);
  const [measurementsOpen, setMeasurementsOpen] = useState(true);
  const [navigationOpen, setNavigationOpen] = useState(() => window.matchMedia("(min-width: 1280px)").matches);
  const [dockTab, setDockTab] = useState<"scene" | "objects">("scene");
  const outlineToggleRef = useRef<HTMLButtonElement>(null);
  const inspectorToggleRef = useRef<HTMLButtonElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [viewportExpanded, setViewportExpanded] = useState(false);
  const [viewportError, setViewportError] = useState<string | null>(null);

  function closeSceneOutline(): void {
    setSceneOutlineOpen(false);
    outlineToggleRef.current?.focus();
  }

  function toggleSceneOutline(): void {
    setSceneOutlineOpen((open) => !open);
    setDockTab("scene");
    if (!sceneOutlineOpen && window.matchMedia("(max-width: 900px)").matches) {
      setInspectorOpen(false);
    }
  }

  function openObjectLibrary(): void {
    setSceneOutlineOpen(true);
    setDockTab("objects");
    if (window.matchMedia("(max-width: 900px)").matches) {
      setInspectorOpen(false);
    }
  }

  function toggleInspector(): void {
    setInspectorOpen((open) => !open);
    if (!inspectorOpen && window.matchMedia("(max-width: 900px)").matches) {
      setSceneOutlineOpen(false);
    }
  }

  function closeInspector(): void {
    setInspectorOpen(false);
    inspectorToggleRef.current?.focus();
  }

  // Expand the whole editor so its existing panels and canvas remain interactive.
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

  // Fill the available desktop space while keeping the complete measurement panel visible.
  useLayoutEffect(() => {
    const layout = viewportRef.current;

    if (layout === null) {
      return;
    }

    const canvasPage = layout.querySelector<HTMLElement>(".canvas-page");
    const canvasFrame = layout.querySelector<HTMLElement>(".canvas");
    const measurements = layout.querySelector<HTMLElement>(".measurement-dock");

    if (canvasPage === null || canvasFrame === null || measurements === null) {
      return;
    }

    let pendingFrame: number | null = null;

    const sizeCanvas = (): void => {
      // Mobile and expanded-editor modes retain their dedicated CSS layouts.
      if (window.matchMedia("(max-width: 700px)").matches || document.fullscreenElement === layout) {
        layout.style.removeProperty("--canvas-height");
        layout.style.removeProperty("--scene-dock-height");
        return;
      }

      const canvasBounds = canvasPage.getBoundingClientRect();
      const belowCanvas = measurements.getBoundingClientRect().bottom - canvasBounds.bottom;
      const canvasTop = canvasBounds.top + window.scrollY;
      const availableHeight = document.documentElement.clientHeight - canvasTop - belowCanvas - 12;
      const height = `${Math.max(160, Math.min(1000, Math.floor(availableHeight)))}px`;

      if (layout.style.getPropertyValue("--canvas-height") !== height) {
        layout.style.setProperty("--canvas-height", height);
      }

      // Align the scene dock to the canvas frame rather than an estimated toolbar height.
      const dockHeight = `${Math.ceil(canvasFrame.getBoundingClientRect().bottom - layout.getBoundingClientRect().top)}px`;

      if (layout.style.getPropertyValue("--scene-dock-height") !== dockHeight) {
        layout.style.setProperty("--scene-dock-height", dockHeight);
      }
    };

    // Coalesce layout notifications and avoid writing sizes inside an observer callback.
    function scheduleSizing(): void {
      if (pendingFrame !== null) {
        return;
      }

      pendingFrame = window.requestAnimationFrame(() => {
        pendingFrame = null;
        sizeCanvas();
      });
    }

    const observer = new ResizeObserver(scheduleSizing);
    observer.observe(layout);
    observer.observe(measurements);
    window.addEventListener("resize", scheduleSizing);
    document.addEventListener("fullscreenchange", scheduleSizing);
    sizeCanvas();

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", scheduleSizing);
      document.removeEventListener("fullscreenchange", scheduleSizing);
      if (pendingFrame !== null) {
        window.cancelAnimationFrame(pendingFrame);
      }
      layout.style.removeProperty("--canvas-height");
      layout.style.removeProperty("--scene-dock-height");
    };
  }, []);

  const selectedEntityId = useStore(
    labStore,
    (state) => state.selectedEntityId,
  );
  const selectionNotice = useStore(labStore, (state) => state.selectionNotice);
  let activeSampleSnapshots;

  if (
    editableScene.id === PROJECTILE_LAB_MOCK.scene.id &&
    editableScene.revision === PROJECTILE_LAB_MOCK.scene.revision
  ) {
    // Enable motion only for the scene covered by these reviewed frames.
    activeSampleSnapshots = PROJECTILE_PLAYBACK_SNAPSHOTS;
  } else {
    activeSampleSnapshots = undefined;
  }

  // Hold the last reported playback metadata for HTML rendering.
  const [playbackState, setPlaybackState] = useState<PlaybackState | null>(null);
  const [labError, setLabError] = useState<string | null>(null);

  const sampleEndTick = activeSampleSnapshots?.at(-1)?.tick;
  const playbackReady = playbackState !== null && sampleEndTick !== undefined;
  const sampleFinished = sampleEndTick !== undefined && displayedSnapshot.tick >= sampleEndTick;
  const controllerRef = useRef<LabController | null>(null);

  // Keep the imperative handle and clear toolbar availability when it is released.
  const setActiveController = useCallback((controller: LabController | null) => {
    controllerRef.current = controller;

    if (controller === null) {
      setPlaybackState(null);
      setLabError(null);
    }
  }, []);

  // Display typed failures with enough context to distinguish their source.
  const reportLabResult = useCallback((context: string, result: EngineStatus | void): void => {
    if (result === undefined || result.ok) {
      setLabError(null);
      return;
    }

    const details = result.diagnostics
      .map((diagnostic) => diagnostic.message || `${diagnostic.code} (${diagnostic.path})`)
      .join(" ");

    setLabError(`${context}: ${details || "No diagnostic details were supplied."}`);
  }, []);

  // Run the requested operation through the mounted controller.
  function handlePlaybackAction(action: "play" | "pause" | "stepOnce" | "reset"): void {
    const controller = controllerRef.current;

    if (controller === null) {
      setLabError("Command rejected: the laboratory is not available.");
      return;
    }

    const context = action === "stepOnce"
      ? "Physics failed to complete a tick"
      : "Command rejected";

    reportLabResult(context, controller[action]());
  }

  // Accept only a speed listed by the existing controller boundary.
  function handleSpeedChange(value: string): void {
    const controller = controllerRef.current;
    const selectedSpeed = PLAYBACK_SPEEDS.find((candidate) => String(candidate) === value);

    if (controller === null || selectedSpeed === undefined) {
      setLabError("Command rejected: the laboratory or requested speed is unavailable.");
      return;
    }

    reportLabResult("Command rejected", controller.setSpeed(selectedSpeed));
  }

  useEffect(() => {
    if (!labVisible) {
      return;
    }
    function handleEscKey(event: KeyboardEvent) {
      if (event.key !== "Escape" || event.defaultPrevented) {
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
      labStore.getState().selectEntity(
        null,
        `Object no longer exists: ${selectedEntityId}. Select another object.`,
      );
    }
  }, [editableScene, selectedEntityId]);
  const handlePlacementRequested = useCallback((request: PlacementRequest) => {
    const controller = controllerRef.current;

    if (controller === null) {
      setLabError("Command rejected: the laboratory is not available.");
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
      reportLabResult("Command rejected — placement", placementResult);
      return;
    }

    reportLabResult("Command rejected — placement", placementResult);
    setEditableScene(placementResult.value.scene);
    labStore.getState().selectEntity(placementResult.value.entityId);
  }, [reportLabResult]);
  const handleMoveRequested = useCallback(
    (request: MoveEntityRequest): boolean => {
      const controller = controllerRef.current;

      if (controller === null) {
        setLabError("Command rejected: the laboratory is not available.");
        return false;
      }

      const moveResult = controller.moveEntityWhilePaused(
        request.entityId,
        request.positionMeters,
      );

      if (!moveResult.ok) {
        reportLabResult("Command rejected — movement", moveResult);
        return false;
      }

      reportLabResult("Command rejected — movement", moveResult);
      setEditableScene(moveResult.value.scene);
      labStore.getState().selectEntity(moveResult.value.entityId);
      return true;
    },
    [reportLabResult],
  );
  const handleDeleteRequested = useCallback((entityId: string): boolean => {
    const controller = controllerRef.current;

    if (controller === null) {
      setLabError("Command rejected: the laboratory is not available.");
      return false;
    }

    const deleteResult = controller.deleteEntity(entityId);

    if (!deleteResult.ok) {
      reportLabResult("Command rejected — deletion", deleteResult);
      return false;
    }

    reportLabResult("Command rejected — deletion", deleteResult);
    setEditableScene(deleteResult.value.scene);
    labStore.getState().selectEntity(null);
    return true;
  }, [reportLabResult]);
  return (
    <div className={`eureka-app${navigationOpen ? " navigation-open" : ""}`}>
      <aside id="eureka-navigation" className="site-rail" aria-label="Eureka">
        <a className="brand" href="#laboratory" aria-label="Eureka laboratory" title="Eureka laboratory"><Atom size={25} /><span>Eureka<small>The physics workspace</small></span></a>
        <button className="rail-close" type="button" aria-label="Close main navigation" onClick={() => setNavigationOpen(false)}><X size={17} /></button>
        <nav aria-label="Main navigation">
          {WORKSPACE_NAVIGATION.map((section) => (
            <div className="navigation-group" key={section.label}>
              <span className="rail-label">{section.label}</span>
              {section.items.map(({ id, label, Icon }) => id === "laboratory" ? (
                <a key={id} className="rail-link is-current" href="#laboratory" aria-current="page" aria-label={label} title={label}><Icon size={18} /><span>{label}</span></a>
              ) : (
                <button key={id} className="rail-link" type="button" aria-label={label} title={label} disabled><Icon size={18} /><span>{label}</span></button>
              ))}
            </div>
          ))}
        </nav>
        <div className="rail-bottom">
          <button className="rail-link" type="button" aria-label="Help & guides" title="Help & guides" disabled><CircleHelp size={18} /><span>Help & guides</span></button>
          <button className="rail-link" type="button" aria-label="Settings" title="Settings" disabled><Settings2 size={18} /><span>Settings</span></button>
          <div className="rail-footer"><span className="guest-avatar"><UserRound size={17} /></span><span>Guest workspace<small>Local session</small></span></div>
        </div>
      </aside>
      <button className="navigation-backdrop" type="button" aria-label="Close navigation overlay" hidden={!navigationOpen} onClick={() => setNavigationOpen(false)} />
      <div className="workspace">
        <div className="workspace-topbar">
          <button className="tool-btn navigation-toggle" type="button" aria-label="Toggle main navigation" title="Toggle main navigation" aria-expanded={navigationOpen} aria-controls="eureka-navigation" onClick={() => setNavigationOpen((open) => !open)}><PanelLeft size={18} /></button>
          <div className="workspace-breadcrumb"><span>Workspace</span><ChevronRight size={12} /><span>Physics lab</span><ChevronRight size={12} /><strong>Projectiles</strong></div>
          <span className="local-status"><span className="status-dot" />Local workspace</span>
        </div>
        <main id="laboratory" className="lab-shell">
          <header className="lab-header">
            <div className="experiment-heading"><span className="experiment-mark"><Atom size={21} /></span><div><h1>Projectile laboratory</h1><p>Build a scene. Follow the physics.</p></div><span className="scene-badge">{activeSampleSnapshots === undefined ? "Authored scene" : "Sample scene"}</span></div>
            <div className="header-actions">
              <button className="tool-btn lab-power" onClick={() => setLabVisible((visible) => !visible)} type="button"><Power size={14} />{labVisible ? "Leave lab" : "Enter lab"}</button>
            </div>
          </header>
          <div ref={viewportRef} className={`lab-layout${sceneOutlineOpen ? " scene-open" : ""}${inspectorOpen ? "" : " inspector-closed"}`}>
            <aside id="editor-panels" className="scene-dock" aria-label="Scene and object library" hidden={!sceneOutlineOpen}>
              <div className="scene-dock-tabs" aria-label="Editor panels">
                <button type="button" aria-pressed={dockTab === "scene"} onClick={() => setDockTab("scene")}><Layers size={13} />Scene</button>
                <button type="button" aria-pressed={dockTab === "objects"} onClick={() => setDockTab("objects")}><Plus size={14} />Objects</button>
                <button className="dock-close" type="button" aria-label="Close editor panels" onClick={closeSceneOutline}><X size={13} /></button>
              </div>
              <div className="scene-content" hidden={dockTab !== "scene"}>
                {sceneOutlineOpen && <SceneOutline scene={editableScene} selectedEntityId={selectedEntityId} onClose={closeSceneOutline} />}
                <button className="add-object-button" type="button" onClick={openObjectLibrary}><Plus size={14} />Add an object</button>
              </div>
              <div className="object-library" aria-label="Object library" hidden={dockTab !== "objects"}><ObjectLibrary /></div>
            </aside>
            <div className="workbench-column">
              <div className="playback-bar">
                <div className="transport-controls">
                  <span className="playback-action" title={playbackState?.playing ? "Pause" : "Play"}>
                    <button
                      className="run-button"
                      aria-label={playbackState?.playing ? "Pause" : "Play"} type="button"
                      disabled={playbackState?.playing !== true && (!playbackReady || sampleFinished)}
                      onClick={() => handlePlaybackAction(playbackState?.playing ? "pause" : "play")}
                    >
                      {playbackState?.playing ? <Pause size={14} /> : <Play size={14} />}<span>{playbackState?.playing ? "Pause" : "Run"}</span>
                    </button>
                  </span>
                  <span className="playback-action" title="Step">
                    <button
                      aria-label="Step" type="button"
                      disabled={!playbackReady || playbackState?.playing === true || sampleFinished}
                      onClick={() => handlePlaybackAction("stepOnce")}
                    >
                      <StepForward size={14} />
                    </button>
                  </span>
                  <span className="playback-action" title="Reset">
                    <button
                      aria-label="Reset" type="button"
                      disabled={playbackState === null}
                      onClick={() => handlePlaybackAction("reset")}
                    >
                      <RotateCcw size={14} />
                    </button>
                  </span>
                  <span className="transport-divider" />
                  <label className="visually-hidden" htmlFor="simulation-speed">Playback speed</label>
                  <select
                    id="simulation-speed" name="speed"
                    value={playbackState?.speed ?? 1}
                    disabled={playbackState === null}
                    onChange={(event) => handleSpeedChange(event.currentTarget.value)}
                  >
                    {PLAYBACK_SPEEDS.map((speed) => (
                      <option key={speed} value={speed}>{speed}×</option>
                    ))}
                  </select>
                </div>
                <span className={`playback-status${playbackState?.playing ? " is-playing" : ""}`} role="status">
                  <span className="status-dot" />
                  {playbackState === null
                    ? "Unavailable"
                    : playbackState.playing
                      ? "Playing"
                      : playbackReady && sampleFinished
                        ? "Finished · Reset to replay"
                        : "Paused"}
                </span>
                {playbackState?.unableToMaintainRealTimeSpeed && (
                  <span role="status">Unable to maintain real-time speed.</span>
                )}
                <div className="transport-readouts"><span>Time <b>{displayedSnapshot.simulationTimeSeconds.toFixed(3)} <small>s</small></b></span><span>Tick <b>{displayedSnapshot.tick}</b></span></div>
              </div>
              <section className="canvas" aria-label="Scene viewport">
                <header className="panel-heading">
                  <h2><Crosshair size={14} />Viewport<span className="viewport-dimension">2D</span></h2>
                  <div className="viewport-actions">
                    <button className="tool-btn add-object-toolbar" type="button" onClick={openObjectLibrary}><Plus size={14} />Add</button>
                    <button
                      ref={outlineToggleRef}
                      className="tool-btn"
                      type="button"
                      aria-label="Scene"
                      title="Scene objects"
                      aria-expanded={sceneOutlineOpen}
                      aria-controls="editor-panels"
                      onClick={toggleSceneOutline}
                    >
                      <PanelLeft size={14} /><span className="tool-label">Scene</span>
                    </button>
                    <button ref={inspectorToggleRef} className="tool-btn" type="button" aria-label="Toggle inspector" title="Toggle inspector" aria-expanded={inspectorOpen} aria-controls="inspector-dock" onClick={toggleInspector}><Settings2 size={14} /><span className="tool-label">Inspector</span></button>
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
                <div className="canvas-workbench">
                  <div className="canvas-page">
                    <div className="canvas-heading"><span>— Motion study</span>
                      <CanvasTools />
                    </div>
                    {labVisible ? (
                      <LabCanvas
                        scene={editableScene} sampleSnapshots={activeSampleSnapshots}
                        setDisplayedSnapshot={setDisplayedSnapshot} setActiveController={setActiveController}
                        onPlaybackChange={setPlaybackState}
                        onOperationResult={reportLabResult}
                        onPlacementRequested={handlePlacementRequested}
                        onMoveRequested={handleMoveRequested} onDeleteRequested={handleDeleteRequested}
                      />
                    ) : <div className="closed-lab"><Atom size={32} /><p>Your laboratory is closed.</p><button type="button" className="tool-btn" onClick={() => setLabVisible(true)}>Enter lab</button></div>}
                  </div>
                </div>
                <div className="viewport-status"><span><span className="status-dot" />{activeSampleSnapshots === undefined ? "Authored initial state" : "Sample playback"}</span><span>Metres · Seconds · Kilograms</span></div>
                {selectionNotice !== null && (
                  <p className="viewport-error" role="status">{selectionNotice}</p>
                )}
                {labError !== null && (
                  <p className="viewport-error" role="alert">{labError}</p>
                )}
                {viewportError !== null && <p className="viewport-error" role="alert">{viewportError}</p>}
              </section>
              <section className="measurement-dock" aria-label="Measurement dock">
                <button className="measurement-toggle" type="button" aria-expanded={measurementsOpen} aria-controls="measurement-content" onClick={() => setMeasurementsOpen((open) => !open)}><Activity size={15} /><span>Measurements & events</span><span className="measurement-source">Snapshot readouts</span><ChevronDown size={14} /></button>
                <div id="measurement-content" className="measurement-content" hidden={!measurementsOpen}><ObservationNotebook snapshot={displayedSnapshot} selectedEntityId={selectedEntityId} /></div>
              </section>
            </div>
            <div id="inspector-dock" className="inspector-dock" hidden={!inspectorOpen}><SceneInspector onClose={closeInspector} controllerRef={controllerRef} displayedSnapshot={displayedSnapshot} editableScene={editableScene} selectedEntityId={selectedEntityId} setEditableScene={setEditableScene} playing={playbackState?.playing ?? false} /></div>
          </div>
        </main>
      </div>
    </div>
  );
}
