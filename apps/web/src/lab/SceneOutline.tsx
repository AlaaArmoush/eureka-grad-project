import { useEffect, useRef, useState } from "react";
import type { SceneDefinition } from "@eureka/contracts";
import { Circle, Layers, Search, Target } from "lucide-react";
import { labStore } from "./store.js";
// Supplies readable object names and kinds.
import { objectKindLabel, objectName } from "./lab-messages.js";

// List the current scene independently of the property form and canvas lifetime.
export function SceneOutline(props: {
  scene: SceneDefinition;
  selectedEntityId: string | null;
  onClose(): void;
}) {
  const entities = [...props.scene.bodies, ...props.scene.triggers];
  const [search, setSearch] = useState("");
  const visibleEntities = entities.filter((entity) => entity.id.replaceAll("-", " ").toLowerCase().includes(search.trim().toLowerCase()));
  const outlineRef = useRef<HTMLElement>(null);

  useEffect(() => {
    // Opening from the Scene button moves focus; the initial desktop layout does not.
    if (document.activeElement?.getAttribute("aria-controls") !== "editor-panels") {
      return;
    }
    const outline = outlineRef.current;
    const selectedButton = outline?.querySelector<HTMLButtonElement>('button[aria-pressed="true"]');
    const firstButton = outline?.querySelector<HTMLButtonElement>(".bodies button");

    (selectedButton ?? firstButton)?.focus();
  }, []);

  return (
    <aside
      ref={outlineRef}
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
        <h3 id="scene-outline-title"><Layers size={14} />Scene objects <span className="count-badge">{entities.length}</span></h3>
      </header>
      <label className="scene-search"><Search size={13} /><span className="visually-hidden">Filter scene objects</span><input type="search" placeholder="Find an object…" value={search} onChange={(event) => setSearch(event.currentTarget.value)} /></label>
      <p className="scene-root"><span className="status-dot" />Experiment<span>2D</span></p>
      <ul className="bodies" aria-label="Scene objects">
        {visibleEntities.map((entity) => {
          return (
            <li key={entity.id}>
              <button
                type="button"
                title={entity.id}
                aria-pressed={entity.id === props.selectedEntityId}
                onClick={() => {
                  labStore.getState().selectEntity(entity.id);
                  if (window.matchMedia("(max-width: 1100px)").matches) {
                    props.onClose();
                  }
                }}
              >
                {entity.kind === "target" ? <Target size={15} /> : entity.kind === "dynamic" ? <Circle size={15} /> : <Layers size={15} />}
                <span>{objectName(entity.id)}<small>{objectKindLabel(entity.kind)}</small></span>
              </button>
            </li>
          );
        })}
        {entities.length > 0 && visibleEntities.length === 0 && <li className="outline-empty" role="status">No matching objects.</li>}
      </ul>
      {entities.length === 0 && <p className="outline-hint">Add an object to begin your experiment.</p>}
    </aside>
  );
}
