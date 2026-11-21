import { useState, type ComponentProps } from "react";
import { Eye, SlidersHorizontal, X } from "lucide-react";
import { useStore } from "zustand";
import { NumberField } from "./NumberField.js";
import { PropertiesPanel } from "./PropertiesPanel.js";
import { labStore } from "./store.js";
// Supplies learner-facing wording for rejected settings.
import { describeProblem, LAB_NOT_READY } from "./lab-messages.js";

const OVERLAY_OPTIONS = [
  { key: "trail", label: "Recorded trail", description: "The projectile's recorded positions." },
  { key: "velocity", label: "Velocity vector", description: "Direction and magnitude of motion." },
  { key: "components", label: "Vector components", description: "Horizontal and vertical velocity." },
  { key: "prediction", label: "Ideal prediction", description: "Reference flight without air resistance." },
  { key: "events", label: "Target entry", description: "Reported target-entry markers." },
  { key: "grid", label: "Coordinate grid", description: "World-space axes and metre divisions." },
  { key: "labels", label: "Object labels", description: "Names and annotations in the scene." },
] as const;

// Keep selected-object properties and identity in one stable inspector.
export function SceneInspector({ onClose, ...props }: ComponentProps<typeof PropertiesPanel> & { onClose(): void }) {
  // The store owns the active panel, so selecting an object elsewhere can switch it to Object.
  const activeTab = useStore(labStore, (state) => state.inspectorTab);
  const setActiveTab = labStore.getState().setInspectorTab;
  const overlayVisibility = useStore(labStore, (state) => state.overlayVisibility);
  const environmentScope = JSON.stringify([props.editableScene.id, props.editableScene.revision]);
  // Present gravity as strength, while retaining the scene's stored direction.
  const gravity = props.editableScene.environment.gravityMetersPerSecondSquared;
  const gravityStrength = Math.hypot(gravity.x, gravity.y);
  const gravityDirectionDegrees = gravityStrength === 0
    ? -90
    : Math.atan2(gravity.y, gravity.x) * 180 / Math.PI;
  const [environmentError, setEnvironmentError] = useState<{ scope: string; message: string } | null>(null);

  // Commit friendly environment inputs through the existing new-run boundary.
  function applyEnvironment(formElement: HTMLFormElement): void {
    const form = new FormData(formElement);
    const read = (name: string) => String(form.get(name) ?? "").trim();
    const strengthText = read("environment-gravity");
    const directionText = read("environment-direction");
    const dragText = read("environment-drag");

    function reject(message: string): void {
      formElement.reset();
      setEnvironmentError({ scope: environmentScope, message });
    }

    if ([strengthText, directionText, dragText].some((text) => text === "")) {
      reject("Every environment field is required.");
      return;
    }

    const strength = Number(strengthText);
    const direction = Number(directionText);
    const drag = Number(dragText);

    if (![strength, direction, drag].every(Number.isFinite) || strength < 0 || drag < 0) {
      reject("Enter a number in every field. Gravity and drag can't be negative.");
      return;
    }

    const controller = props.controllerRef.current;

    if (controller === null) {
      reject(LAB_NOT_READY);
      return;
    }

    // Keep unchanged gravity exact, including when only air resistance changes.
    let nextGravity = gravity;

    if (strength !== gravityStrength || direction !== gravityDirectionDegrees) {
      const normalizedDirection = ((direction % 360) + 360) % 360;
      const radians = normalizedDirection * Math.PI / 180;

      nextGravity = {
        x: normalizedDirection === 90 || normalizedDirection === 270
          ? 0
          : strength * Math.cos(radians),
        y: normalizedDirection === 0 || normalizedDirection === 180
          ? 0
          : strength * Math.sin(radians),
      };
    }

    const result = controller.updateEnvironment({
      gravityMetersPerSecondSquared: nextGravity,
      linearDragKilogramsPerSecond: drag,
    });

    if (!result.ok) {
      reject(describeProblem(result.diagnostics, "Those settings couldn't be used."));
      return;
    }

    setEnvironmentError(null);
    props.setEditableScene(result.value);
  }

  return (
    <aside className="scene-inspector" aria-label="Scene inspector">
      <header className="panel-heading">
        <h2><SlidersHorizontal size={14} />Inspector</h2>
        <button className="tool-btn" type="button" aria-label="Close inspector" onClick={onClose}><X size={14} /></button>
      </header>
      <div className="inspector-tabs" role="tablist" aria-label="Inspector panels" onKeyDown={(event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
          return;
        }

        event.preventDefault();
        const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
        const currentIndex = tabs.findIndex((tab) => tab.id === `inspector-tab-${activeTab}`);
        const nextIndex = event.key === "Home" ? 0
          : event.key === "End" ? tabs.length - 1
            : event.key === "ArrowRight" ? (currentIndex + 1) % tabs.length
              : (currentIndex + tabs.length - 1) % tabs.length;

        tabs[nextIndex]?.click();
        tabs[nextIndex]?.focus();
      }}>
        <button id="inspector-tab-properties" type="button" role="tab" aria-selected={activeTab === "properties"} aria-controls="inspector-properties" tabIndex={activeTab === "properties" ? 0 : -1} onClick={() => setActiveTab("properties")}>Object</button>
        <button id="inspector-tab-environment" type="button" role="tab" aria-selected={activeTab === "environment"} aria-controls="inspector-environment" tabIndex={activeTab === "environment" ? 0 : -1} onClick={() => setActiveTab("environment")}>Environment</button>
        <button id="inspector-tab-display" type="button" role="tab" aria-selected={activeTab === "display"} aria-controls="inspector-display" tabIndex={activeTab === "display" ? 0 : -1} onClick={() => setActiveTab("display")}><Eye size={13} />Display</button>
      </div>
      <div id="inspector-properties" role="tabpanel" aria-labelledby="inspector-tab-properties" hidden={activeTab !== "properties"}>
        {/* start: tick 0 / run: tick greater than 0 */}
        <PropertiesPanel key={props.displayedSnapshot.tick === 0 ? "start" : "run"} {...props} />
        <footer className="inspector-footer"><span>Object ID</span><code>{props.selectedEntityId ?? "—"}</code></footer>
      </div>
      <div id="inspector-environment" role="tabpanel" aria-labelledby="inspector-tab-environment" hidden={activeTab !== "environment"}>
        <section className="properties" aria-label="Scene environment">
          <form
            className="property-editor-inline environment-form"
            key={environmentScope}
            onSubmit={(event) => {
              event.preventDefault();
              applyEnvironment(event.currentTarget);
            }}
            onReset={() => setEnvironmentError(null)}
          >
            <NumberField label="Gravity (m/s²)" name="environment-gravity" defaultValue={gravityStrength} rule="nonnegative" />
            <NumberField label="Linear drag (kg/s)" name="environment-drag" defaultValue={props.editableScene.environment.linearDragKilogramsPerSecond} rule="nonnegative" />
            <details className="gravity-direction">
              <summary>Gravity direction</summary>
              <NumberField label="Gravity direction (° counterclockwise from right)" name="environment-direction" defaultValue={gravityDirectionDegrees} />
            </details>
            {environmentError?.scope === environmentScope && (
              <p role="alert">{environmentError.message}</p>
            )}
            <div className="property-editor-inline__actions">
              <button type="reset">Cancel</button>
              <button type="submit" disabled={props.playing ?? false}>Apply as new run</button>
            </div>
          </form>
        </section>
      </div>
      <div id="inspector-display" className="display-panel" role="tabpanel" aria-labelledby="inspector-tab-display" hidden={activeTab !== "display"}>
        <h3>Viewport overlays</h3>
        <p>Choose what the experiment reveals.</p>
        <div className="display-options">
          {OVERLAY_OPTIONS.map((option) => (
            <label key={option.key}>
              <span><strong><i className={`overlay-key overlay-key-${option.key}`} aria-hidden="true" />{option.label}</strong><small>{option.description}</small></span>
              <input type="checkbox" checked={overlayVisibility[option.key]} onChange={(event) => labStore.getState().setOverlayVisible(option.key, event.currentTarget.checked)} />
            </label>
          ))}
        </div>
      </div>
    </aside>
  );
}
