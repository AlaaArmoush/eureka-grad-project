// Supplies the portable camera-center coordinate.
import type { Vector2 } from "@eureka/contracts";

// Supplies a framework-independent editor store.
import { createStore } from "zustand/vanilla";
import type {
  PlaceableEntityKind,
  PlatformPlacementProperties,
  ProjectilePlacementProperties,
  RampPlacementProperties,
  TargetPlacementProperties,
} from "./authoring.js";
export interface LabEditorState {
  readonly cameraCenterWorldMeters: Vector2;
  readonly pixelsPerMeter: number;
  readonly cameraInitialized: boolean;
  readonly selectedEntityId: string | null;

  setCamera(centerWorldMeters: Vector2, pixelsPerMeter: number): void;

  selectEntity(entityId: string | null): void;
  readonly activeTool: LabTool;
  setActiveTool(tool: LabTool): void;
}

export type LabTool =
  | { readonly kind: "select" }
  | { readonly kind: "move" }
  | { readonly kind: "pan" }
  | { readonly kind: "delete" }
  | {
      readonly kind: "place";
      readonly entityKind: PlaceableEntityKind;
      readonly projectileProperties?: ProjectilePlacementProperties;
      readonly platformProperties?: PlatformPlacementProperties;
      readonly rampProperties?: RampPlacementProperties;
      readonly targetProperties?: TargetPlacementProperties;
    };

// Share editor state outside React; keep it across canvas remounts.
export const labStore = createStore<LabEditorState>()((set) => ({
  cameraCenterWorldMeters: {
    x: 5,
    y: 0,
  },
  // Startup framing may reduce this scale; later resizing preserves zoom.
  pixelsPerMeter: 48,
  cameraInitialized: false,
  selectedEntityId: null,

  setCamera: (cameraCenterWorldMeters, pixelsPerMeter) => {
    if (
      !Number.isFinite(cameraCenterWorldMeters.x) ||
      !Number.isFinite(cameraCenterWorldMeters.y) ||
      !Number.isFinite(pixelsPerMeter) ||
      pixelsPerMeter <= 0
    ) {
      throw new RangeError(
        "Camera center must be finite and scale must be positive.",
      );
    }

    // Copy the point so later caller changes cannot move the stored camera.
    set({
      cameraCenterWorldMeters: {
        ...cameraCenterWorldMeters,
      },
      pixelsPerMeter,
      cameraInitialized: true,
    });
  },

  selectEntity: (selectedEntityId) => {
    set({ selectedEntityId });
  },

  activeTool: { kind: "select" },

  setActiveTool: (activeTool) => {
    set({ activeTool });
  },
}));
