import type { ComponentProps } from "react";
import { PropertiesPanel } from "./PropertiesPanel.js";

// Keep selected-object properties and identity in one stable inspector.
export function SceneInspector(props: ComponentProps<typeof PropertiesPanel>) {
  return (
    <aside className="scene-inspector" aria-label="Scene inspector">
      <header className="panel-heading">
        <h2>Properties</h2>
      </header>
      <PropertiesPanel {...props} />
      <footer className="inspector-footer">ID <code>{props.selectedEntityId ?? "—"}</code></footer>
    </aside>
  );
}
