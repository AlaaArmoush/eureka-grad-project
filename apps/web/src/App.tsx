import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
// Supply the lab's starting 20 m/s, 30° projectile scene.
import { PROJECTILE_LAB_MOCK } from "./lab/mocks.js";
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
import type { ChallengeDefinition, Snapshot, SceneDefinition } from "@eureka/contracts";
import "./App.css";
import { CanvasTools } from "./lab/CanvasTools.js";
import { SceneInspector } from "./lab/SceneInspector.js";
import { SceneOutline } from "./lab/SceneOutline.js";
import { ObservationNotebook } from "./lab/ObservationNotebook.js";
import { copyInitialSnapshot, prepareChallengeLoad, prepareDemonstrationLoad, type ChallengeLoad, type DemonstrationLoad, type DemonstrationSelection, type SceneLoad } from "./lab/demo-loading.js";
import { ChallengePanel } from "./lab/ChallengePanel.js";
import { useChallengeSession } from "./lab/useChallengeSession.js";
import { ReplaceSceneDialog } from "./lab/ReplaceSceneDialog.js";
import { CurriculumPage } from "./pages/CurriculumPage.js";
import { useDemonstrationCatalogue } from "./lab/demonstration-client.js";
import { ChallengesPage } from "./pages/ChallengesPage.js";
import { createWorkspaceNavigation, type WorkspacePage } from "./navigation.js";
// Supplies learner-facing wording for engine and controller problems.
import { describeProblem, LAB_NOT_READY, RUN_STOPPED } from "./lab/lab-messages.js";

const WORKSPACE_NAVIGATION = [
  {
    label: "Workspace", items: [
      { id: "dashboard", label: "Dashboard", Icon: LayoutDashboard },
      { id: "laboratory", label: "Physics lab", Icon: Atom },
      { id: "experiments", label: "My experiments", Icon: FolderOpen },
    ]
  },
  {
    label: "Learn & teach", items: [
      { id: "curriculum", label: "Curriculum", Icon: BookOpen },
      { id: "challenges", label: "Challenges", Icon: Trophy },
      { id: "classes", label: "Classes", Icon: GraduationCap },
    ]
  },
  {
    label: "Discover", items: [
      { id: "gallery", label: "Community gallery", Icon: Images },
    ]
  },
] as const;

export function App() {
  // The first readout is the engine's own tick-zero state of the starting scene.
  const [displayedSnapshot, setDisplayedSnapshot] = useState<Snapshot>(() => {
    const result = copyInitialSnapshot(PROJECTILE_LAB_MOCK.scene);

    if (!result.ok) {
      throw new Error("The starting projectile scene must be accepted by the engine.");
    }

    return result.value;
  });
  const [editableScene, setEditableScene] = useState<SceneDefinition>(() =>
    structuredClone(PROJECTILE_LAB_MOCK.scene),
  );
  const [labVisible, setLabVisible] = useState(true);
  const [navigation] = useState(() => createWorkspaceNavigation(window));
  const activePage = useSyncExternalStore(navigation.subscribe, navigation.getSnapshot, navigation.getSnapshot);
  // The sidebar's Curriculum link returns to where the student left off, not to the topic list.
  const lastCurriculumPageRef = useRef<"curriculum" | "projectiles">("curriculum");

  if (activePage === "curriculum" || activePage === "projectiles") {
    lastCurriculumPageRef.current = activePage;
  }
  const [activeDemonstration, setActiveDemonstration] = useState<DemonstrationSelection | null>(null);
  // The Curriculum questions, loaded from the server once; the lab works without them.
  const demonstrationCatalogue = useDemonstrationCatalogue();
  const [pendingLoad, setPendingLoad] = useState<{ readonly title: string; apply(): void } | null>(null);
  const pristineSceneRef = useRef(editableScene);
  const [sceneGeneration, setSceneGeneration] = useState(0);
  const controllerRef = useRef<LabController | null>(null);
  const challenge = useChallengeSession(setEditableScene, controllerRef);
  const reportEngineFailure = challenge.onEngineFailure;
  const challengeActive = challenge.session !== null;
  const [sceneOutlineOpen, setSceneOutlineOpen] = useState(() => window.matchMedia("(min-width: 1101px)").matches);
  const [inspectorOpen, setInspectorOpen] = useState(() => window.matchMedia("(min-width: 901px)").matches);
  const [measurementsOpen, setMeasurementsOpen] = useState(true);
  const [navigationOpen, setNavigationOpen] = useState(() => window.matchMedia("(min-width: 1280px)").matches);
  const [dockTab, setDockTab] = useState<"scene" | "objects">("scene");
  const outlineToggleRef = useRef<HTMLButtonElement>(null);
  const inspectorToggleRef = useRef<HTMLButtonElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const labHeadingRef = useRef<HTMLHeadingElement>(null);
  const previousPageRef = useRef<WorkspacePage>(activePage);
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

    if (layout === null || activePage !== "laboratory") {
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
  }, [activePage]);

  const selectedEntityId = useStore(
    labStore,
    (state) => state.selectedEntityId,
  );
  const selectionNotice = useStore(labStore, (state) => state.selectionNotice);

  // Hold the last reported playback metadata for HTML rendering.
  const [playbackState, setPlaybackState] = useState<PlaybackState | null>(null);
  const [labError, setLabError] = useState<string | null>(null);

  // Any mounted controller can run its scene on the real engine.
  const playbackReady = playbackState !== null;

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

    // A failed tick during a challenge attempt makes that attempt unjudgeable.
    if (context === RUN_STOPPED) {
      reportEngineFailure();
    }

    // A short lead-in names what failed; the sentence after it says what to do.
    setLabError(`${context}. ${describeProblem(result.diagnostics, "Please try again.")}`);
  }, [reportEngineFailure]);

  function handleDemonstrationOpen(selection: DemonstrationSelection): void {
    const demonstrations = demonstrationCatalogue.catalogue.status === "ready" ? demonstrationCatalogue.catalogue.demonstrations : [];
    const result = prepareDemonstrationLoad(selection, demonstrations);

    if (!result.ok) {
      reportLabResult("Demonstration unavailable", result);
      return;
    }

    // Nothing to lose when the lab still holds the scene it loaded; otherwise ask inside the site.
    if (editableScene === pristineSceneRef.current) {
      applyDemonstration(result.value);
      return;
    }

    setPendingLoad({ title: result.value.title, apply: () => applyDemonstration(result.value) });
  }

  function handleChallengeOpen(definition: ChallengeDefinition): void {
    const result = prepareChallengeLoad(definition);

    if (!result.ok) {
      reportLabResult("Challenge unavailable", result);
      return;
    }

    // Same rule as a demonstration: ask only when the lab holds changes.
    if (editableScene === pristineSceneRef.current) {
      applyChallenge(result.value);
      return;
    }

    setPendingLoad({ title: result.value.title, apply: () => applyChallenge(result.value) });
  }

  function applyLoad(loaded: SceneLoad): void {
    setPendingLoad(null);
    controllerRef.current?.pause();
    controllerRef.current = null;
    setPlaybackState(null);

    setDisplayedSnapshot(loaded.initialSnapshot);
    labStore.setState({
      selectedEntityId: loaded.selectedEntityId,
      selectionNotice: null,
      activeTool: { kind: "select" },
      cameraCenterWorldMeters: { ...loaded.camera.centerWorldMeters },
      pixelsPerMeter: loaded.camera.pixelsPerMeter,
      cameraInitialized: true,
      pendingCameraView: loaded.camera,
      overlayVisibility: { ...loaded.overlays },
    });

    setSceneGeneration((generation) => generation + 1);
    setDockTab("scene");
    setLabVisible(true);
    setLabError(null);
    pristineSceneRef.current = loaded.scene;
    setEditableScene(loaded.scene);
    navigateTo("laboratory");
  }

  function applyDemonstration(loaded: DemonstrationLoad): void {
    challenge.end();
    setActiveDemonstration(loaded.selection);
    applyLoad(loaded);
    // The overlay's ghost paths also carry a demonstration's reference flight; a challenge or the next load replaces them.
    labStore.getState().setChallengeOverlay({ zones: [], live: [], ghosts: loaded.referencePaths });
  }

  function applyChallenge(loaded: ChallengeLoad): void {
    challenge.begin(loaded);
    setInspectorOpen(true);
    applyLoad(loaded);
  }

  // Change page visibility without replacing authored data or mounted editor components.
  function navigateTo(page: WorkspacePage): void {
    controllerRef.current?.pause();

    const editor = labStore.getState();
    editor.setActiveTool({ ...editor.activeTool });

    navigation.navigate(page);

    if (window.matchMedia("(max-width: 1279px)").matches) {
      setNavigationOpen(false);
    }
  }

  useEffect(() => {
    // Browser Back/Forward must pause and cancel pointer previews just like sidebar navigation.
    controllerRef.current?.pause();
    const editor = labStore.getState();
    editor.setActiveTool({ ...editor.activeTool });
    // Move focus to the heading only when arriving from another page, never on the first load.
    if (activePage === "laboratory" && previousPageRef.current !== "laboratory") {
      labHeadingRef.current?.focus();
    }

    previousPageRef.current = activePage;
  }, [activePage]);

  // Run the requested operation through the mounted controller.
  function handlePlaybackAction(action: "play" | "pause" | "stepOnce" | "reset"): void {
    const controller = controllerRef.current;

    if (controller === null) {
      setLabError(LAB_NOT_READY);
      return;
    }

    const context = action === "stepOnce"
      ? RUN_STOPPED
      : "Couldn't do that";

    // A finished attempt is retried before Run, and a reset ends the attempt in progress.
    if (challengeActive && action === "play" && !challenge.beforeRun()) {
      return;
    }

    if (challengeActive && action === "reset") {
      challenge.resetAttempt();
    }

    reportLabResult(context, controller[action]());
  }

  // Accept only a speed listed by the existing controller boundary.
  function handleSpeedChange(value: string): void {
    const controller = controllerRef.current;
    const selectedSpeed = PLAYBACK_SPEEDS.find((candidate) => String(candidate) === value);

    if (controller === null || selectedSpeed === undefined) {
      setLabError("That speed isn't available.");
      return;
    }

    reportLabResult("Couldn't change the speed", controller.setSpeed(selectedSpeed));
  }

  useEffect(() => {
    if (!labVisible || activePage !== "laboratory") {
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
  }, [labVisible, activePage]);
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
    if (challengeActive) {
      setLabError("Locked by the challenge: objects cannot be added.");
      return;
    }

    const controller = controllerRef.current;

    if (controller === null) {
      setLabError(LAB_NOT_READY);
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
      reportLabResult("Couldn't place that", placementResult);
      return;
    }

    reportLabResult("Couldn't place that", placementResult);
    setEditableScene(placementResult.value.scene);
    labStore.getState().selectEntity(placementResult.value.entityId);
  }, [reportLabResult, challengeActive]);
  const handleMoveRequested = useCallback(
    (request: MoveEntityRequest): boolean => {
      if (challengeActive) {
        setLabError("Locked by the challenge: objects cannot be moved.");
        return false;
      }

      const controller = controllerRef.current;

      if (controller === null) {
        setLabError(LAB_NOT_READY);
        return false;
      }

      const moveResult = controller.moveEntityWhilePaused(
        request.entityId,
        request.positionMeters,
      );

      if (!moveResult.ok) {
        reportLabResult("Couldn't move that", moveResult);
        return false;
      }

      reportLabResult("Couldn't move that", moveResult);
      setEditableScene(moveResult.value.scene);
      labStore.getState().selectEntity(moveResult.value.entityId);
      return true;
    },
    [reportLabResult, challengeActive],
  );
  const handleDeleteRequested = useCallback((entityId: string): boolean => {
    if (challengeActive) {
      setLabError("Locked by the challenge: objects cannot be deleted.");
      return false;
    }

    const controller = controllerRef.current;

    if (controller === null) {
      setLabError(LAB_NOT_READY);
      return false;
    }

    const deleteResult = controller.deleteEntity(entityId);

    if (!deleteResult.ok) {
      reportLabResult("Couldn't delete that", deleteResult);
      return false;
    }

    reportLabResult("Couldn't delete that", deleteResult);
    setEditableScene(deleteResult.value.scene);
    labStore.getState().selectEntity(null);
    return true;
  }, [reportLabResult, challengeActive]);
  return (
    <div className={`eureka-app${navigationOpen ? " navigation-open" : ""}`}>
      <aside id="eureka-navigation" className="site-rail" aria-label="Eureka">
        <a className="brand" href="#/lab" aria-label="Eureka laboratory" title="Eureka laboratory" onClick={(event) => {
          event.preventDefault();
          navigateTo("laboratory");
        }}><Atom size={25} /><span>Eureka<small>The physics workspace</small></span></a>
        <button className="rail-close" type="button" aria-label="Close main navigation" onClick={() => setNavigationOpen(false)}><X size={17} /></button>
        <nav aria-label="Main navigation">
          {WORKSPACE_NAVIGATION.map((section) => (
            <div className="navigation-group" key={section.label}>
              <span className="rail-label">{section.label}</span>
              {section.items.map(({ id, label, Icon }) => id === "laboratory" || id === "curriculum" || id === "challenges" ? (
                <button
                  key={id}
                  className={`rail-link${activePage === id || (id === "curriculum" && activePage === "projectiles") ? " is-current" : ""}`}
                  type="button"
                  aria-current={activePage === id || (id === "curriculum" && activePage === "projectiles") ? "page" : undefined}
                  aria-label={label}
                  title={label}
                  onClick={() => navigateTo(id === "curriculum" ? lastCurriculumPageRef.current : id)}
                ><Icon size={18} /><span>{label}</span></button>
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
          <div className="workspace-breadcrumb">
            <span>Workspace</span><ChevronRight size={12} />
            {activePage === "laboratory" ? (
              <><span>Physics lab</span><ChevronRight size={12} /><strong>Projectiles</strong></>
            ) : activePage === "challenges" ? (
              <><span>Challenges</span><ChevronRight size={12} /><strong>Projectiles</strong></>
            ) : (
              <><span>Curriculum</span>{activePage === "projectiles" && <><ChevronRight size={12} /><strong>Projectiles</strong></>}</>
            )}
          </div>
          <span className="local-status"><span className="status-dot" />Local workspace</span>
        </div>
        <CurriculumPage
          visible={activePage === "curriculum" || activePage === "projectiles"}
          topicOpen={activePage === "projectiles"}
          catalogue={demonstrationCatalogue.catalogue}
          onRetry={demonstrationCatalogue.retry}
          onOpenProjectiles={() => navigateTo("projectiles")}
          onShowTopics={() => navigateTo("curriculum")}
          error={labError}
          onOpen={handleDemonstrationOpen}
          onRestoreDemonstration={activeDemonstration === null ? null : () => handleDemonstrationOpen(activeDemonstration)}
          onReturnToLab={() => navigateTo("laboratory")}
        />
        <ChallengesPage visible={activePage === "challenges"} error={labError} onPlay={handleChallengeOpen} />
        <main id="laboratory" className="lab-shell" hidden={activePage !== "laboratory"}>
          <header className="lab-header">
            <div className="experiment-heading"><span className="experiment-mark"><Atom size={21} /></span><div><h1 ref={labHeadingRef} tabIndex={-1}>Projectile laboratory</h1><p>Build a scene. Follow the physics.</p></div><span className="scene-badge">{challengeActive ? "Challenge" : "Your scene"}</span></div>
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
                {sceneOutlineOpen && <SceneOutline key={sceneGeneration} scene={editableScene} selectedEntityId={selectedEntityId} onClose={closeSceneOutline} />}
                <button className="add-object-button" type="button" onClick={openObjectLibrary}><Plus size={14} />Add an object</button>
              </div>
              <div className="object-library" aria-label="Object library" hidden={dockTab !== "objects"}>{challengeActive ? <p className="properties">Locked by the challenge: the scene cannot gain objects.</p> : <ObjectLibrary key={sceneGeneration} />}</div>
            </aside>
            <div className="workbench-column">
              <div className="playback-bar">
                <div className="transport-controls">
                  <span className="playback-action" title={playbackState?.playing ? "Pause" : "Play"}>
                    <button
                      className="run-button"
                      aria-label={playbackState?.playing ? "Pause" : "Play"} type="button"
                      disabled={playbackState?.playing !== true && !playbackReady}
                      onClick={() => handlePlaybackAction(playbackState?.playing ? "pause" : "play")}
                    >
                      {playbackState?.playing ? <Pause size={14} /> : <Play size={14} />}<span>{playbackState?.playing ? "Pause" : "Run"}</span>
                    </button>
                  </span>
                  <span className="playback-action" title="Step">
                    <button
                      aria-label="Step" type="button"
                      disabled={!playbackReady || playbackState?.playing === true}
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
                        scene={editableScene}
                        setDisplayedSnapshot={setDisplayedSnapshot} setActiveController={setActiveController}
                        onPlaybackChange={setPlaybackState}
                        onTick={challenge.onTick}
                        onOperationResult={reportLabResult}
                        onPlacementRequested={handlePlacementRequested}
                        onMoveRequested={handleMoveRequested} onDeleteRequested={handleDeleteRequested}
                      />
                    ) : <div className="closed-lab"><Atom size={32} /><p>Your laboratory is closed.</p><button type="button" className="tool-btn" onClick={() => setLabVisible(true)}>Enter lab</button></div>}
                    {/* Messages float over the paper so the canvas never changes size; the next successful action or the close button clears them. */}
                    {(selectionNotice !== null || labError !== null || viewportError !== null) && (
                      <div className="canvas-notices">
                        {selectionNotice !== null && <p className="canvas-notice" role="status">{selectionNotice}</p>}
                        {labError !== null && (
                          <p className="canvas-notice is-error" role="alert">
                            <span>{labError}</span>
                            <button type="button" aria-label="Dismiss message" title="Dismiss" onClick={() => setLabError(null)}><X size={12} /></button>
                          </p>
                        )}
                        {viewportError !== null && (
                          <p className="canvas-notice is-error" role="alert">
                            <span>{viewportError}</span>
                            <button type="button" aria-label="Dismiss message" title="Dismiss" onClick={() => setViewportError(null)}><X size={12} /></button>
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </section>
              <section className="measurement-dock" aria-label="Measurement dock">
                <button className="measurement-toggle" type="button" aria-expanded={measurementsOpen} aria-controls="measurement-content" onClick={() => setMeasurementsOpen((open) => !open)}><Activity size={15} /><span>Measurements & events</span><ChevronDown size={14} /></button>
                <div id="measurement-content" className="measurement-content" hidden={!measurementsOpen}><ObservationNotebook key={sceneGeneration} snapshot={displayedSnapshot} selectedEntityId={selectedEntityId} /></div>
              </section>
            </div>
            <div id="inspector-dock" className="inspector-dock" hidden={!inspectorOpen}>
              {challenge.session === null
                ? <SceneInspector key={sceneGeneration} onClose={closeInspector} controllerRef={controllerRef} displayedSnapshot={displayedSnapshot} editableScene={editableScene} selectedEntityId={selectedEntityId} setEditableScene={setEditableScene} playing={playbackState?.playing ?? false} />
                : <ChallengePanel session={challenge.session} playing={playbackState?.playing ?? false} canLaunch={playbackState !== null} onSetValue={challenge.setValue} onLaunch={() => handlePlaybackAction("play")} onRetry={challenge.retry} onShowSample={challenge.showSample} onExit={challenge.end} />}
            </div>
          </div>
        </main>
      </div>
      {pendingLoad !== null && (
        <ReplaceSceneDialog
          title={pendingLoad.title}
          onConfirm={pendingLoad.apply}
          onCancel={() => setPendingLoad(null)}
        />
      )}
    </div>
  );
}
