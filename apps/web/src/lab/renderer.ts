import type { SceneDefinition, Snapshot, Vector2 } from "@eureka/contracts";

import { Application, Graphics, Container, Text } from "pixi.js";

import {
  screenToWorld,
  worldToScreen,
  type ViewportTransform,
} from "./coordinates.js";

import { labStore } from "./store.js";
import type { PlacementRequest } from "./authoring.js";
import { OutlineFilter } from "pixi-filters";

interface RenderItem {
  readonly kind: "body" | "target";
  readonly graphic: Container;
  positionMeters: Vector2;
  angleRadians: number;
  readonly sourcePixelsPerMeter: number;
  readonly entityId: string;
  readonly updateFeedback?: (snapshot: Snapshot) => void;
  readonly selectionGraphic: Container;
}

export interface LabRenderer {
  updateSnapshot(snapshot: Snapshot): void;
  dispose(): void;
}
function createRenderItems(
  scene: SceneDefinition,
  snapshot: Snapshot,
  pixelsPerMeter: number,
): readonly RenderItem[] {
  const items: RenderItem[] = [];

  for (const trigger of scene.triggers) {
    const radiusPixels = trigger.shape.radiusMeters * pixelsPerMeter;

    const graphic = new Container();
    const ring = new Graphics();
    const centreMarker = new Graphics();

    const label = new Text({
      text: "Target",
      style: {
        fontFamily: "Inter, system-ui, sans-serif",
        fontSize: 12,
        fontWeight: "500",
        fill: 0x3b8066,
      },
    });
    function updateFeedback(nextSnapshot: Snapshot): void {
      const hasEntered = nextSnapshot.events.some(
        (event) =>
          event.kind === "targetEntered" &&
          event.targetId === trigger.id &&
          event.tick === nextSnapshot.tick,
      );

      const color = hasEntered ? 0x16776e : 0x3b8066;
      ring
        .clear()
        .circle(0, 0, radiusPixels)
        .fill({
          color,
          alpha: hasEntered ? 0.16 : 0.08,
        })
        .stroke({ color, width: 2 });

      centreMarker.clear().circle(0, 0, 2).fill({ color });

      label.text = hasEntered ? "Target Entered" : "Target";
      label.style.fill = color;
    }

    updateFeedback(snapshot);
    label.anchor.set(0.5, 1);
    label.position.set(0, -radiusPixels - 8);

    graphic.addChild(ring, centreMarker, label);
    graphic.eventMode = "static";
    graphic.cursor = "pointer";

    graphic.on("pointerdown", () => {
      labStore.getState().selectEntity(trigger.id);
    });

    items.push({
      graphic,
      positionMeters: trigger.pose.positionMeters,
      angleRadians: trigger.pose.angleRadians,
      sourcePixelsPerMeter: pixelsPerMeter,
      entityId: trigger.id,
      selectionGraphic: ring,
      kind: "target",
      updateFeedback,
    });
  }

  for (const body of scene.bodies) {
    const snapshotBody = snapshot.bodies.find(
      (candidate) => candidate.id === body.id,
    );

    if (snapshotBody === undefined) {
      throw new Error(`Snapshot omitted scene body "${body.id}".`);
    }

    const isGround = body.id.toLowerCase().includes("ground");

    const graphic =
      body.kind === "dynamic"
        ? new Graphics()
            .circle(0, 0, body.shape.radiusMeters * pixelsPerMeter)
            .fill({ color: 0xdd875d })
            .stroke({ color: 0x9b553b, width: 1.5 })
        : new Graphics()
            .rect(
              (-body.shape.widthMeters * pixelsPerMeter) / 2,
              (-body.shape.heightMeters * pixelsPerMeter) / 2,
              body.shape.widthMeters * pixelsPerMeter,
              body.shape.heightMeters * pixelsPerMeter,
            )
            .fill({ color: isGround ? 0xb8c28c : 0xe0b455 })
            .stroke({ color: isGround ? 0x6f6c51 : 0x9b713b, width: 1.5 });
    graphic.eventMode = "static";

    graphic.on("pointerdown", () => {
      labStore.getState().selectEntity(body.id);
    });

    items.push({
      graphic,
      positionMeters: snapshotBody.pose.positionMeters,
      angleRadians: snapshotBody.pose.angleRadians,
      sourcePixelsPerMeter: pixelsPerMeter,
      entityId: snapshotBody.id,
      selectionGraphic: graphic,
      kind: "body",
    });
  }

  return items;
}

export function mountLabRenderer(
  host: HTMLElement,
  scene: SceneDefinition,
  snapshot: Snapshot,
  onPlacementRequested: (request: PlacementRequest) => void,
): LabRenderer {
  //deep copy of the whole snapshot (independent copy with no sharing of the nested objects)
  //The copied values remain stable no matter how and if the engine changes
  let initialSnapshot = structuredClone(snapshot);
  const application = new Application();
  let disposed = false;
  let initialized = false;
  //                          id(for renderer), item
  const renderItems = new Map<string, RenderItem>();
  let unsubscribeFromStore: (() => void) | undefined;

  let panStart: Vector2 | null = null; // null when user not panning
  let panCameraStart: Vector2 | null = null; //camera position at the start of pan

  const background = new Graphics();
  background.eventMode = "static";
  background.cursor =
    labStore.getState().activeTool.kind === "pan" ? "grab" : "default";
  const selectedFilter = new OutlineFilter({
    color: 0xd87149,
    thickness: 2,
    alpha: 1,
    quality: 0.8,
  });

  function getViewport(): ViewportTransform {
    const editorState = labStore.getState();

    return {
      widthPixels: application.screen.width,
      heightPixels: application.screen.height,
      pixelsPerMeter: editorState.pixelsPerMeter,
      centerWorldMeters: editorState.cameraCenterWorldMeters,
    };
  }
  const resizeAndRender = (): void => {
    const width = Math.max(1, host.clientWidth);
    const height = Math.max(1, host.clientHeight);

    application.renderer.resize(width, height);
    background.clear().rect(0, 0, width, height).fill({ color: 0, alpha: 0 });

    const editorState = labStore.getState();

    const viewport = getViewport();

    for (const item of renderItems.values()) {
      const screenPosition = worldToScreen(item.positionMeters, viewport);

      item.graphic.position.set(screenPosition.x, screenPosition.y);
      item.graphic.scale.set(
        editorState.pixelsPerMeter / item.sourcePixelsPerMeter,
      );
      item.graphic.rotation = -item.angleRadians;

      if (editorState.selectedEntityId === item.entityId) {
        item.selectionGraphic.filters = selectedFilter;
      } else {
        item.selectionGraphic.filters = [];
      }
    }

    application.render();
  };
  function updateSnapshot(nextSnapshot: Snapshot): void {
    if (disposed) {
      return;
    }

    if (!initialized) {
      initialSnapshot = structuredClone(nextSnapshot);
      return;
    }
    for (const item of renderItems.values()) {
      if (item.kind === "body") {
        const body = nextSnapshot.bodies.find(
          (candidate) => candidate.id === item.entityId,
        );

        if (body === undefined) {
          throw new Error(`Snapshot omitted scene body "${item.entityId}".`);
        }

        item.positionMeters = { ...body.pose.positionMeters };
        item.angleRadians = body.pose.angleRadians;
      } else {
        item.updateFeedback?.(nextSnapshot);
      }
    }

    resizeAndRender();
  }

  const initialize = async (): Promise<void> => {
    await application.init({
      antialias: true,
      autoDensity: true,
      autoStart: false,
      backgroundColor: 0xe8e0cd,
      height: Math.max(1, host.clientHeight),
      resolution: window.devicePixelRatio,
      width: Math.max(1, host.clientWidth),
    });

    initialized = true;

    if (disposed) {
      application.destroy({ removeView: true }, { children: true });
      return;
    }

    const itemsToRender = createRenderItems(
      scene,
      initialSnapshot,
      labStore.getState().pixelsPerMeter,
    );

    for (const item of itemsToRender) {
      renderItems.set(item.entityId, item);
    }

    application.stage.addChild(
      ...Array.from(renderItems.values(), (item) => item.graphic),
    );
    application.stage.addChildAt(background, 0);
    application.stage.eventMode = "static";
    application.stage.on("pointerdowncapture", (event) => {
      const activeTool = labStore.getState().activeTool;

      if (activeTool.kind !== "place") {
        return;
      }

      const positionMeters = screenToWorld(event.global, getViewport());

      let placementRequest: PlacementRequest = {
        entityKind: activeTool.entityKind,
        positionMeters,
      };

      if (activeTool.projectileProperties !== undefined) {
        placementRequest = {
          ...placementRequest,
          projectileProperties: activeTool.projectileProperties,
        };
      }

      if (activeTool.platformProperties !== undefined) {
        placementRequest = {
          ...placementRequest,
          platformProperties: activeTool.platformProperties,
        };
      }
      if (activeTool.rampProperties !== undefined) {
        placementRequest = {
          ...placementRequest,
          rampProperties: activeTool.rampProperties,
        };
      }
      if (activeTool.targetProperties !== undefined) {
        placementRequest = {
          ...placementRequest,
          targetProperties: activeTool.targetProperties,
        };
      }

      onPlacementRequested(placementRequest);

      labStore.getState().setActiveTool({ kind: "select" });

      // Prevent the object underneath from being selected instead.
      event.stopImmediatePropagation();
    });
    background.on("pointerdown", (event) => {
      if (labStore.getState().activeTool.kind !== "pan") {
        return;
      }
      panStart = { x: event.global.x, y: event.global.y };
      panCameraStart = { ...labStore.getState().cameraCenterWorldMeters };
      background.cursor = "grabbing";
    });

    background.on("pointermove", (event) => {
      if (panStart === null || panCameraStart === null) {
        return;
      }

      const p = labStore.getState().pixelsPerMeter;
      const dx = event.global.x - panStart.x;
      const dy = event.global.y - panStart.y;

      labStore
        .getState()
        .setCamera(
          { x: panCameraStart.x - dx / p, y: panCameraStart.y + dy / p },
          p,
        );
    });

    const stopPan = (): void => {
      panStart = null;
      panCameraStart = null;
      background.cursor =
        labStore.getState().activeTool.kind === "pan" ? "grab" : "default";
    };

    background.on("pointerup", stopPan);
    background.on("pointerupoutside", stopPan);
    // This host is dedicated to Pixi, so replacing its children enforces
    // one-canvas ownership even across development remounts.
    host.replaceChildren(application.canvas);
    window.addEventListener("resize", resizeAndRender);
    unsubscribeFromStore = labStore.subscribe((state, previousState) => {
      if (state.activeTool !== previousState.activeTool) {
        background.cursor =
          state.activeTool.kind === "pan" ? "grab" : "default";
      }

      if (
        state.cameraCenterWorldMeters !==
          previousState.cameraCenterWorldMeters ||
        state.pixelsPerMeter !== previousState.pixelsPerMeter ||
        state.selectedEntityId !== previousState.selectedEntityId
      ) {
        resizeAndRender();
      }
    });
    updateSnapshot(initialSnapshot);
  };

  void initialize().catch((error: unknown) => {
    if (!disposed) {
      console.error("Failed to initialize the Pixi canvas.", error);
    }
  });

  function dispose(): void {
    if (disposed) {
      return;
    }

    disposed = true;
    window.removeEventListener("resize", resizeAndRender);
    unsubscribeFromStore?.();

    if (initialized) {
      application.ticker.stop();
      application.destroy({ removeView: true }, { children: true });
    }

    selectedFilter.destroy();
  }

  return {
    updateSnapshot,
    dispose,
  };
}
