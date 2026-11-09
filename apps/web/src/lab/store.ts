// Supplies the portable camera-center coordinate.
import type { Vector2 } from "@eureka/contracts";

// Supplies a framework-independent editor store.
import { createStore } from "zustand/vanilla";

export interface LabEditorState {
  readonly cameraCenterWorldMeters: Vector2;
  readonly pixelsPerMeter: number;
  readonly selectedEntityId: string | null;
  

  setCamera(
    centerWorldMeters: Vector2,
    pixelsPerMeter: number
  ): void;

  selectEntity(entityId: string | null): void;
    readonly activeTool: "select" | "pan";
  setActiveTool(tool: "select" | "pan"): void;
}

// Share editor state outside React; keep it across canvas remounts.
export const labStore = createStore<LabEditorState>()(
  (set) => ({
    cameraCenterWorldMeters: {
      x: 5,
      y: 0
    },
    // Pixels per metre. A narrower browser shows less world, not smaller objects.
    pixelsPerMeter: 48,
    selectedEntityId: null,

    setCamera: (
      cameraCenterWorldMeters,
      pixelsPerMeter
    ) => {
      if (
        !Number.isFinite(cameraCenterWorldMeters.x) ||
        !Number.isFinite(cameraCenterWorldMeters.y) ||
        !Number.isFinite(pixelsPerMeter) ||
        pixelsPerMeter <= 0
      ) {
        throw new RangeError(
          "Camera center must be finite and scale must be positive."
        );
      }

      // Copy the point so later caller changes cannot move the stored camera.
      set({
        cameraCenterWorldMeters: {
          ...cameraCenterWorldMeters
        },
        pixelsPerMeter
      });
    },

      selectEntity: (selectedEntityId) => {
      set({ selectedEntityId });
    },

    activeTool: "select",
    setActiveTool: (activeTool) => {
      set({ activeTool });
    }
  })
);