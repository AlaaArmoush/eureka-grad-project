import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { SceneDefinition } from "@eureka/contracts";
import { Layers, Search } from "lucide-react";
import { labStore } from "./store.js";
// Supplies the same colours the canvas draws each object in.
import { ballPigment, objectColor, zoneColors } from "./materials.js";
// Supplies readable object names and kinds.
import { objectName, objectSummary } from "./lab-messages.js";

type SceneEntity = SceneDefinition["bodies"][number] | SceneDefinition["triggers"][number];

// A small swatch in the object's canvas colour: a ball in its own colour, a target ring as it looks before a hit,
// and a surface bar tilted to its angle.
function swatchStyle(entity: SceneEntity, ballIndex: number): CSSProperties {
  const color = entity.kind === "dynamic" ? ballPigment(ballIndex).fill : entity.kind === "target" ? zoneColors.waiting.ink : objectColor(entity, 0);
  const angleDegrees = entity.kind === "static" ? -entity.pose.angleRadians * 180 / Math.PI : 0;

  return { "--swatch": `#${color.toString(16).padStart(6, "0")}`, transform: angleDegrees === 0 ? undefined : `rotate(${angleDegrees}deg)` } as CSSProperties;
}

// List the current scene independently of the property form and canvas lifetime.
export function SceneOutline(props: {
  scene: SceneDefinition;
  selectedEntityId: string | null;
  onClose(): void;
}) {
  // Group by kind so related objects sit together: balls, then surfaces, then targets.
  const balls = props.scene.bodies.filter((body) => body.kind === "dynamic");
  const entities = [
    ...balls,
    ...props.scene.bodies.filter((body) => body.kind === "static"),
    ...props.scene.triggers,
  ];
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
      <ul className="bodies" aria-label="Scene objects">
        {visibleEntities.map((entity) => {
          return (
            <li key={entity.id}>
              <button
                type="button"
                title={entity.id}
                aria-pressed={entity.id === props.selectedEntityId}
                onClick={() => {
                  // Clicking the selected object again clears the selection.
                  labStore.getState().selectEntity(entity.id === props.selectedEntityId ? null : entity.id);
                  if (window.matchMedia("(max-width: 1100px)").matches) {
                    props.onClose();
                  }
                }}
              >
                <span className={`object-swatch is-${entity.kind}`} style={swatchStyle(entity, balls.findIndex((ball) => ball.id === entity.id))} aria-hidden="true" />
                <span>{objectName(entity.id)}<small>{objectSummary(entity)}</small></span>
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
