import { useCallback, useEffect } from "react";
import { useRef, useState } from "react";
import { PROJECTILE_LAB_MOCK } from "./lab/mocks";
import type { MoveEntityRequest, PlacementRequest } from "./lab/authoring";
import { ObjectLibrary } from "./lab/ObjectLibrary";
import {
  Hand,
  ZoomIn,
  ZoomOut,
  Play,
  Pause,
  StepForward,
  RotateCcw,
  Move,
  Trash2,
} from "lucide-react";
import { useStore } from "zustand";
import { labStore } from "./lab/store";
import type { LabController } from "./lab/controller";
import { LabCanvas } from "./lab/LabCanvas";
import type { Snapshot, SceneDefinition } from "@eureka/contracts";
import "./App.css";
import { PropertiesPanel } from "./lab/PropertiesPanel";

export function App() {
  const [displayedSnapshot, setDisplayedSnapshot] = useState<Snapshot>(
    PROJECTILE_LAB_MOCK.snapshot,
  );
  const [editableScene, setEditableScene] = useState<SceneDefinition>(() =>
    structuredClone(PROJECTILE_LAB_MOCK.scene),
  );
  const [labVisible, setLabVisible] = useState(true);
  const selectedEntityId = useStore(
    labStore,
    (state) => state.selectedEntityId,
  );
  const activeTool = useStore(labStore, (state) => state.activeTool);
  const selectedBody = displayedSnapshot.bodies.find(
    (body) => body.id === selectedEntityId,
  );

  const visibleEvents = displayedSnapshot.events.filter((event) => {
    if (selectedEntityId === null) {
      return true;
    }

    if (event.bodyId === selectedEntityId) {
      return true;
    }

    if (event.kind === "targetEntered") {
      return event.targetId === selectedEntityId;
    }

    return event.surfaceBodyId === selectedEntityId;
  });
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
    <main className="lab-shell">
      <header className="lab-header">
        <h1>Eureka</h1>
        <button
          onClick={() => {
            setLabVisible((visible) => !visible);
          }}
          type="button"
        >
          {labVisible ? "Leave lab" : "Enter lab"}
        </button>
        <section>
          <h2> Sample Scene</h2>
          <p>scene Id: {editableScene.id}</p>
          <p>Body Count: {editableScene.bodies.length}</p>
        </section>
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
      </header>

      <div className="lab-layout">
        <section className="object-library">
          <ObjectLibrary />
          <h2>Scene Objects</h2>
          <ul className="bodies">
            {editableScene.bodies.map((singleBody) => (
              <li key={singleBody.id}>
                <button
                  type="button"
                  aria-pressed={selectedEntityId === singleBody.id}
                  onClick={() => {
                    labStore.getState().selectEntity(singleBody.id);
                  }}
                >
                  {singleBody.id}: {singleBody.kind}
                </button>
              </li>
            ))}
            {editableScene.triggers.map((target) => (
              <li key={target.id}>
                <button
                  type="button"
                  aria-pressed={selectedEntityId === target.id}
                  onClick={() => {
                    labStore.getState().selectEntity(target.id);
                  }}
                >
                  {target.id}: {target.kind}
                </button>
              </li>
            ))}
          </ul>
        </section>
        <section className="canvas">
          <h2>Canvas</h2>

          <div className="canvas-toolbar">
            <button
              aria-label="Delete objects"
              aria-pressed={activeTool.kind === "delete"}
              className={`tool-btn ${activeTool.kind === "delete" ? "active" : ""}`}
              title="Delete objects"
              type="button"
              onClick={() => {
                labStore
                  .getState()
                  .setActiveTool(
                    activeTool.kind === "delete"
                      ? { kind: "select" }
                      : { kind: "delete" },
                  );
              }}
            >
              <Trash2 size={14} />
            </button>
            <button
              aria-label="Move objects"
              aria-pressed={activeTool.kind === "move"}
              className={`tool-btn ${activeTool.kind === "move" ? "active" : ""}`}
              title="Move objects"
              type="button"
              onClick={() => {
                labStore
                  .getState()
                  .setActiveTool(
                    activeTool.kind === "move"
                      ? { kind: "select" }
                      : { kind: "move" },
                  );
              }}
            >
              <Move size={14} />
            </button>
            <button
              type="button"
              className={`tool-btn ${activeTool.kind === "pan" ? "active" : ""}`}
              aria-pressed={activeTool.kind === "pan"}
              onClick={() => {
                labStore
                  .getState()
                  .setActiveTool(
                    activeTool.kind === "pan"
                      ? { kind: "select" }
                      : { kind: "pan" },
                  );
              }}
            >
              <Hand size={14} />
            </button>

            <button
              type="button"
              className="tool-btn"
              onClick={() => {
                const state = labStore.getState();
                state.setCamera(
                  state.cameraCenterWorldMeters,
                  state.pixelsPerMeter + 12,
                );
              }}
            >
              <ZoomIn size={14} />
            </button>

            <button
              type="button"
              className="tool-btn"
              onClick={() => {
                const state = labStore.getState();
                const nextScale = state.pixelsPerMeter - 12;

                if (nextScale >= 12) {
                  state.setCamera(state.cameraCenterWorldMeters, nextScale);
                }
              }}
            >
              <ZoomOut size={14} />
            </button>
          </div>

          <section
            aria-label="Physics laboratory"
            style={{ marginTop: "16px" }}
          >
            {labVisible ? (
              <LabCanvas
                scene={editableScene}
                setDisplayedSnapshot={setDisplayedSnapshot}
                setActiveController={setActiveController}
                onPlacementRequested={handlePlacementRequested}
                onMoveRequested={handleMoveRequested}
                onDeleteRequested={handleDeleteRequested}
              />
            ) : (
              <p>The lab is closed.</p>
            )}
          </section>
          <section className="measurements">
            <h2>Measurements and display</h2>

            <h3>Current velocity</h3>
            <p>
              <strong>vx: </strong>
              {selectedBody?.velocity.linearMetersPerSecond.x ?? "—"} m/s
            </p>
            <p>
              <strong>vy: </strong>
              {selectedBody?.velocity.linearMetersPerSecond.y ?? "—"} m/s
            </p>

            <h3>Recent events</h3>
            {visibleEvents.length === 0 ? (
              <p>No events reported for this selection.</p>
            ) : (
              <ul>
                {visibleEvents.map((event) => (
                  <li key={event.id}>
                    {event.kind} — {event.bodyId} at
                    {event.timeSeconds.toFixed(3)} s
                  </li>
                ))}
              </ul>
            )}

            <h3>Errors</h3>
            {displayedSnapshot.diagnostics.length === 0 ? (
              <p>No errors reported.</p>
            ) : (
              <ul>
                {displayedSnapshot.diagnostics.map((diagnostic, index) => (
                  <li key={index}>{diagnostic.message}</li>
                ))}
              </ul>
            )}

            <h3>Display options</h3>
            <div className="display-options">
              {["Trail", "Velocity", "Components", "Prediction", "Normals"].map(
                (option) => (
                  <label key={option}>
                    <input type="checkbox" disabled /> {option}
                  </label>
                ),
              )}
            </div>
          </section>
        </section>
        <PropertiesPanel
          controllerRef={controllerRef}
          displayedSnapshot={displayedSnapshot}
          editableScene={editableScene}
          selectedEntityId={selectedEntityId}
          setEditableScene={setEditableScene}
        />
      </div>
    </main>
  );
}
