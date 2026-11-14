import { useState } from "react";
import { Hand, Maximize2, Minus, MousePointer2, Move, Plus, Trash2 } from "lucide-react";
import { useStore } from "zustand";
import { labStore } from "./store.js";

// Camera and tool intent live in the editor store; these controls never edit physics.
export function CanvasTools() {
  const activeTool = useStore(labStore, (state) => state.activeTool);
  const scale = useStore(labStore, (state) => state.pixelsPerMeter);
  const [zoomDraft, setZoomDraft] = useState<string | null>(null);
  const [zoomError, setZoomError] = useState<string | null>(null);
  const percent = scale / 48 * 100;
  const zoomTo = (value: number) => {
    const state = labStore.getState();
    state.setCamera(state.cameraCenterWorldMeters, value / 100 * 48);
    setZoomError(null);
    setZoomDraft(null);
  };
  const tools = [
    { kind: "select", label: "Select objects", Icon: MousePointer2 },
    { kind: "move", label: "Move objects", Icon: Move },
    { kind: "pan", label: "Pan canvas", Icon: Hand },
    { kind: "delete", label: "Delete objects", Icon: Trash2 },
  ] as const;

  return (
    <div className="canvas-tools">
      <div className="canvas-toolbar" aria-label="Canvas tools">
        {tools.map(({ kind, label, Icon }) => (
          <button key={kind} type="button" className="tool-btn" aria-label={label} title={label} aria-pressed={activeTool.kind === kind} onClick={() => labStore.getState().setActiveTool({ kind: activeTool.kind === kind ? "select" : kind })}><Icon size={14} /></button>
        ))}
        <span className="toolbar-divider" />
        <button type="button" className="tool-btn" aria-label="Zoom out" title="Zoom out" disabled={percent <= 25} onClick={() => zoomTo(Math.max(25, Math.ceil(percent / 25 - .000001) * 25 - 25))}><Minus size={14} /></button>
        <form className="zoom-form" onSubmit={(event) => {
          event.preventDefault();
          const text = (zoomDraft ?? String(percent)).trim().replace(/%$/, "");
          const value = Number(text);
          if (text === "" || !Number.isFinite(value) || value < 25 || value > 400) {
            setZoomError("Enter a zoom from 25% to 400%.");
            return;
          }
          zoomTo(value);
          event.currentTarget.querySelector("input")?.blur();
        }}>
          <input aria-label="Zoom percentage" aria-invalid={zoomError !== null} aria-describedby={zoomError === null ? undefined : "zoom-error"} inputMode="decimal" value={zoomDraft ?? String(Math.round(percent))} onChange={(event) => setZoomDraft(event.currentTarget.value)} onBlur={() => { setZoomDraft(null); setZoomError(null); }} onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              setZoomDraft(null);
              setZoomError(null);
              event.currentTarget.blur();
            }
          }} /><span>%</span>
        </form>
        <button type="button" className="tool-btn" aria-label="Zoom in" title="Zoom in" disabled={percent >= 400} onClick={() => zoomTo(Math.min(400, Math.floor(percent / 25 + .000001) * 25 + 25))}><Plus size={14} /></button>
        <button type="button" className="tool-btn" aria-label="Fit scene" title="Fit scene" onClick={() => { labStore.getState().fitCamera(); setZoomDraft(null); setZoomError(null); }}><Maximize2 size={14} /></button>
      </div>
      {zoomError !== null && <p id="zoom-error" role="alert" className="zoom-error">{zoomError}</p>}
    </div>
  );
}
