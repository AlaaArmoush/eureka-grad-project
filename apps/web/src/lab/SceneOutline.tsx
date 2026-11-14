import type { SceneDefinition } from "@eureka/contracts";
import { Circle, Layers, Target, X } from "lucide-react";
import { labStore } from "./store.js";

// List the current scene independently of the property form and canvas lifetime.
export function SceneOutline(props: {
  scene: SceneDefinition;
  selectedEntityId: string | null;
  onClose(): void;
}) {
  const entities = [...props.scene.bodies, ...props.scene.triggers];

  return (
    <aside
      id="scene-outline"
      className="scene-outline"
      aria-labelledby="scene-outline-title"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          props.onClose();
        }
      }}
    >
      <header className="outline-heading">
        <h3 id="scene-outline-title">Scene <span className="count-badge">{entities.length}</span></h3>
        <button className="tool-btn" type="button" aria-label="Close scene outline" title="Close scene outline" onClick={props.onClose}>
          <X size={14} />
        </button>
      </header>
      <ul className="bodies" aria-label="Scene objects">
        {entities.map((entity) => {
          const name = entity.id.replaceAll("-", " ");
          return (
            <li key={entity.id}>
              <button
                type="button"
                title={entity.id}
                aria-pressed={entity.id === props.selectedEntityId}
                onClick={() => {
                  labStore.getState().selectEntity(entity.id);
                  if (window.matchMedia("(max-width: 1250px)").matches) {
                    props.onClose();
                  }
                }}
              >
                {entity.kind === "target" ? <Target size={15} /> : entity.kind === "dynamic" ? <Circle size={15} /> : <Layers size={15} />}
                <span>{name.charAt(0).toUpperCase() + name.slice(1)}<small>{entity.kind === "target" ? "Sensor" : entity.kind === "dynamic" ? "Dynamic body" : "Fixed surface"}</small></span>
              </button>
            </li>
          );
        })}
      </ul>
      <p className="outline-hint">{entities.length === 0 ? "Add an object to begin your experiment." : "Select an object to inspect its properties."}</p>
    </aside>
  );
}
