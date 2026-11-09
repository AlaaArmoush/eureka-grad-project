import { useCallback, useEffect } from "react";
import { useRef, useState } from "react";
import { mountLabRenderer } from "./lab/renderer";
import { PROJECTILE_LAB_MOCK } from "./lab/mocks";
import {
  Hand,
  ZoomIn,
  ZoomOut,
  Play,
  Pause,
  StepForward,
  RotateCcw,
  Circle,
  RectangleHorizontal,
  TriangleRight,
  Target,
} from "lucide-react";
import { useStore } from "zustand";
import { labStore } from "./lab/store";
import { createEngine } from "@eureka/engine";
import { createLabController, type LabController } from "./lab/controller";
import type { Body, TargetTrigger, Pose, Snapshot } from "@eureka/contracts";
import "./App.css";
type InspectorShape = Body["shape"] | TargetTrigger["shape"];

// setDisplayedSnapshot SO THE CHILD CAN SEND BACK INFORMATION TO THE PARENT USING THAT FUNCTION
function LabCanvas(props: {
  setDisplayedSnapshot(snapshot: Snapshot): void;
  setActiveController(controller: LabController | null): void;
}) {
  const toSetDisplayedSnapshot = props.setDisplayedSnapshot;
  const setActiveController = props.setActiveController;
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;

    if (host === null) {
      return;
    }

    setActiveController(null);
    const renderer = mountLabRenderer(
      host,
      PROJECTILE_LAB_MOCK.scene,
      PROJECTILE_LAB_MOCK.snapshot,
    );

    const engineResult = createEngine(PROJECTILE_LAB_MOCK.scene);

    if (!engineResult.ok) {
      console.error("Engine creation failed", engineResult.diagnostics);
      renderer.dispose();
      return;
    }

    const engine = engineResult.value;

    const controllerResult = createLabController(
      engine,
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
  }, [toSetDisplayedSnapshot, setActiveController]);
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

function describeDimensions(shape: InspectorShape | undefined): string {
  if (shape === undefined) {
    return "No Object Selected";
  }
  // might change
  switch (shape.kind) {
    case "circle":
      return `Radius: ${shape.radiusMeters} m`;
    case "box":
      return `
      Height: ${shape.heightMeters} m
      Width: ${shape.widthMeters} m`;
  }
}
function renderProperties(
  definition: Body | TargetTrigger | undefined,
  currentPose: Pose | undefined,
) {
  if (definition === undefined) {
    return null;
  }

  switch (definition.kind) {
    case "dynamic": {
      const initialVelocity = definition.velocity.linearMetersPerSecond;
      const launchSpeed = Math.hypot(initialVelocity.x, initialVelocity.y); // sqrt(x^2 + y^2)

      let launchAngleDegrees: number | undefined;

      if (launchSpeed === 0) {
        launchAngleDegrees = undefined;
      } else {
        // tan θ = (Vy/Vx)
        const launchAngleRadians = Math.atan2(
          initialVelocity.y,
          initialVelocity.x,
        );

        launchAngleDegrees = (launchAngleRadians * 180) / Math.PI;
      }

      return (
        <div>
          <p>
            <strong> Mass: </strong>
            {definition.massKilograms} kg
          </p>
          <p>
            <strong>Initial launch speed: </strong>
            {launchSpeed.toFixed(3)} m/s
          </p>
          <p>
            <strong>Initial launch angle: </strong>
            {launchAngleDegrees === undefined
              ? "Undefined at zero speed"
              : `${launchAngleDegrees.toFixed(2)}°`}
          </p>
          <p>
            {" "}
            <strong>Restitution: </strong>
            {definition.material.restitution}
          </p>
        </div>
      );
    }

    case "static": {
      let angleText: string;

      if (currentPose === undefined) {
        angleText = "Unavailable";
      } else {
        const surfaceAngleDegrees = (currentPose.angleRadians * 180) / Math.PI;

        angleText = `${surfaceAngleDegrees.toFixed(2)}°`;
      }

      return (
        <div>
          <p>
            <strong> Surface angle:</strong> {angleText}
          </p>
          <p>
            <strong>Restitution: </strong>
            {definition.material.restitution}
          </p>
        </div>
      );
    }

    case "target":
      return <p>Non-solid target sensor.</p>;
  }
}
export function App() {
  const [displayedSnapshot, setDisplayedSnapshot] = useState<Snapshot>(
    PROJECTILE_LAB_MOCK.snapshot,
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
  const selectedTrigger = PROJECTILE_LAB_MOCK.scene.triggers.find(
    (trigger) => trigger.id === selectedEntityId,
  );
  const selectedDefinition =
    PROJECTILE_LAB_MOCK.scene.bodies.find(
      (body) => body.id === selectedEntityId,
    ) ?? selectedTrigger;
  const selectedPose = selectedBody?.pose ?? selectedTrigger?.pose;

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
          <p>scene Id: {PROJECTILE_LAB_MOCK.scene.id}</p>
          <p>Body Count: {PROJECTILE_LAB_MOCK.scene.bodies.length}</p>
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
          <h2>Objects Library</h2>
          <h3>Tools</h3>
          <ul className="tools">
            <li>
              <button disabled type="button">
                <Circle size={16} />
                <strong>Projectile</strong>
                <span>A moving ball with mass and initial velocity.</span>
              </button>
            </li>
            <li>
              <button disabled type="button">
                <RectangleHorizontal size={16} />
                <strong>Wall / platform</strong>
                <span>A fixed rectangular collision surface.</span>
              </button>
            </li>
            <li>
              <button disabled type="button">
                <TriangleRight size={16} />
                <strong>Ramp</strong>
                <span>A fixed platform placed at an angle.</span>
              </button>
            </li>

            <li>
              <button disabled type="button">
                <Target size={16} />
                <strong>Target zone</strong>
                <span>A pass-through circular sensor that detects entry.</span>
              </button>
            </li>
          </ul>

          <h2>Scene Objects</h2>
          <ul className="bodies">
            {PROJECTILE_LAB_MOCK.scene.bodies.map((singleBody) => (
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
            {PROJECTILE_LAB_MOCK.scene.triggers.map((target) => (
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
              type="button"
              className={`tool-btn ${activeTool === "pan" ? "active" : ""}`}
              aria-pressed={activeTool === "pan"}
              onClick={() => {
                labStore
                  .getState()
                  .setActiveTool(activeTool === "pan" ? "select" : "pan");
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
                setDisplayedSnapshot={setDisplayedSnapshot}
                setActiveController={setActiveController}
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

        <section className="properties">
          <h2>Properties</h2>
          <p>
            <strong> Selected Object: </strong>
            {selectedEntityId ?? "None"}
          </p>
          <p>
            <strong>Type: </strong>
            {selectedDefinition?.kind ?? "None"}
          </p>
          <p>
            <strong>Shape: </strong>
            {selectedDefinition?.shape.kind ?? "None"}
          </p>
          <p className="dimension-readout">
            <strong>Dimensions:</strong>
            {describeDimensions(selectedDefinition?.shape)}
          </p>
          <p>
            <strong>Selected Object position:</strong>
          </p>
          <ul>
            <li>
              <strong>x(m):</strong>
              {selectedPose?.positionMeters.x ?? "Please select an Object"}
            </li>
            <li>
              <strong>y(m):</strong>
              {selectedPose?.positionMeters.y ?? "Please select an Object"}
            </li>
          </ul>
          {renderProperties(selectedDefinition, selectedPose)}
        </section>
      </div>
    </main>
  );
}
