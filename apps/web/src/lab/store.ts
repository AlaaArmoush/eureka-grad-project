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
}

export const labStore = createStore<LabEditorState>()(
  (set) => ({
    cameraCenterWorldMeters: {
      x: 5,
      y: 0
    },
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

      set({
        cameraCenterWorldMeters: {
          ...cameraCenterWorldMeters
        },
        pixelsPerMeter
      });
    },

    selectEntity: (selectedEntityId) => {
      set({ selectedEntityId });
    }
  })
);
