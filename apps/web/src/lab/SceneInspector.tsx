import { useState, type ComponentProps } from "react";
import { Eye, SlidersHorizontal, X } from "lucide-react";
import { useStore } from "zustand";
import { PropertiesPanel } from "./PropertiesPanel.js";
import { labStore } from "./store.js";

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
  const [activeTab, setActiveTab] = useState<"properties" | "display">("properties");
  const overlayVisibility = useStore(labStore, (state) => state.overlayVisibility);

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
        const nextTab = event.key === "Home" ? "properties" : event.key === "End" ? "display" : activeTab === "properties" ? "display" : "properties";
        setActiveTab(nextTab);
        event.currentTarget.querySelector<HTMLButtonElement>(`#inspector-tab-${nextTab}`)?.focus();
      }}>
        <button id="inspector-tab-properties" type="button" role="tab" aria-selected={activeTab === "properties"} aria-controls="inspector-properties" tabIndex={activeTab === "properties" ? 0 : -1} onClick={() => setActiveTab("properties")}><SlidersHorizontal size={13} />Properties</button>
        <button id="inspector-tab-display" type="button" role="tab" aria-selected={activeTab === "display"} aria-controls="inspector-display" tabIndex={activeTab === "display" ? 0 : -1} onClick={() => setActiveTab("display")}><Eye size={13} />Display</button>
      </div>
      <div id="inspector-properties" role="tabpanel" aria-labelledby="inspector-tab-properties" hidden={activeTab !== "properties"}>
        <PropertiesPanel {...props} />
        <footer className="inspector-footer"><span>Object ID</span><code>{props.selectedEntityId ?? "—"}</code></footer>
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
