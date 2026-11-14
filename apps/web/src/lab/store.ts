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

// Share the camera scale between wheel input, zoom controls and initial editor state.
export const CAMERA_ZOOM = {
  basePixelsPerMeter: 48,
  minimumPercent: 5,
  maximumPercent: 3200,
  stops: [5, 10, 15, 25, 50, 75, 100, 150, 200, 300, 400, 600, 800, 1200, 1600, 2400, 3200],
} as const;

export interface OverlayVisibility {
  readonly trail: boolean;
  readonly velocity: boolean;
  readonly components: boolean;
  readonly prediction: boolean;
  readonly events: boolean;
  readonly grid: boolean;
  readonly labels: boolean;
}

export interface LabEditorState {
  readonly cameraCenterWorldMeters: Vector2;
  readonly pixelsPerMeter: number;
  readonly cameraInitialized: boolean;
  readonly cameraFitRequest: number;
  fitCamera(): void;
  readonly selectedEntityId: string | null;
  readonly overlayVisibility: OverlayVisibility;

  setCamera(centerWorldMeters: Vector2, pixelsPerMeter: number): void;
  setOverlayVisible(overlay: keyof OverlayVisibility, visible: boolean): void;

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
  pixelsPerMeter: CAMERA_ZOOM.basePixelsPerMeter,
  cameraInitialized: false,
  cameraFitRequest: 0,
  fitCamera: () => set((state) => ({ cameraFitRequest: state.cameraFitRequest + 1 })),
  selectedEntityId: "projectile",
  overlayVisibility: {
    trail: true,
    velocity: true,
    components: true,
    prediction: true,
    events: true,
    grid: true,
    labels: true,
  },

  // Keep display choices across authored edits and canvas remounts.
  setOverlayVisible: (overlay, visible) => {
    set((state) => ({
      overlayVisibility: { ...state.overlayVisibility, [overlay]: visible },
    }));
  },

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
