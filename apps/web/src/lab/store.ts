// Supplies the portable camera-center coordinate.
import type { ChallengeZone, Vector2 } from "@eureka/contracts";
import type { CameraView } from "./coordinates.js";

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

// A target object used as a challenge zone, and where the current attempt stands with it: red until reached, green once reached, amber when too close to call.
export interface ChallengeZoneView {
  readonly zone: ChallengeZone;
  readonly state: "waiting" | "reached" | "borderline" | "missed";
}

// What the open challenge draws over the scene, in world metres: its target zones, the live path and the ghost of the previous attempt.
export interface ChallengeOverlay {
  readonly zones: readonly ChallengeZoneView[];
  readonly live: readonly Vector2[];
  readonly ghosts: readonly (readonly Vector2[])[];
}

// The inspector's three panels; the store owns which one is showing so selection can bring the Object panel forward.
export type InspectorTab = "properties" | "environment" | "display";

export interface LabEditorState {
  readonly cameraCenterWorldMeters: Vector2;
  readonly pixelsPerMeter: number;
  readonly cameraInitialized: boolean;
  readonly cameraFitRequest: number;
  readonly pendingCameraView: CameraView | null;
  fitCamera(): void;
  readonly selectedEntityId: string | null;
  readonly selectionNotice: string | null;
  selectEntity(entityId: string | null, notice?: string): void;
  readonly inspectorTab: InspectorTab;
  setInspectorTab(tab: InspectorTab): void;
  readonly overlayVisibility: OverlayVisibility;
  readonly challengeOverlay: ChallengeOverlay;
  setChallengeOverlay(overlay: ChallengeOverlay): void;

  setCamera(centerWorldMeters: Vector2, pixelsPerMeter: number): void;
  setOverlayVisible(overlay: keyof OverlayVisibility, visible: boolean): void;

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
  pendingCameraView: null,
  fitCamera: () => set((state) => ({ cameraFitRequest: state.cameraFitRequest + 1, pendingCameraView: null })),
  selectedEntityId: "projectile",
  selectionNotice: null,
  inspectorTab: "properties",
  setInspectorTab: (inspectorTab) => {
    set({ inspectorTab });
  },
  overlayVisibility: {
    trail: true,
    velocity: true,
    components: true,
    prediction: true,
    events: true,
    grid: true,
    labels: true,
  },

  challengeOverlay: { zones: [], live: [], ghosts: [] },
  setChallengeOverlay: (challengeOverlay) => {
    set({ challengeOverlay });
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
      pendingCameraView: null,
    });
  },

  // Choosing a different object shows its properties; deselecting or re-selecting the same object keeps the current panel.
  selectEntity: (selectedEntityId, notice) => {
    set((state) => ({
      selectedEntityId,
      selectionNotice: notice ?? null,
      ...(selectedEntityId !== null && selectedEntityId !== state.selectedEntityId ? { inspectorTab: "properties" as const } : {}),
    }));
  },

  activeTool: { kind: "select" },

  setActiveTool: (activeTool) => {
    set({ activeTool });
  },
}));
