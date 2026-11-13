import type { SceneDefinition, Snapshot, Vector2 } from "@eureka/contracts";

import {
  Application,
  Container,
  Graphics,
  Text,
  type FederatedPointerEvent,
} from "pixi.js";
import {
  screenToWorld,
  worldToScreen,
  type ViewportTransform,
} from "./coordinates.js";

import { labStore } from "./store.js";
import type { MoveEntityRequest, PlacementRequest } from "./authoring.js";
import { OutlineFilter } from "pixi-filters";

// Keep velocity arrows readable without changing physical values.
export const VELOCITY_ARROW_SCALE = {
  pixelsPerMeterPerSecond: 6,
  minimumLengthPixels: 24,
  maximumLengthPixels: 144,
} as const;

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
interface DragState {
  readonly entityId: string;
  readonly pointerId: number; //prevent another pointer from finishing the drag
  readonly acceptedPositionMeters: Vector2; //restores the object after cancellation
  readonly pointerOffsetMeters: Vector2; // Preserves the exact point where the object was grabbed.
}
export interface LabRenderer {
  updateSnapshot(snapshot: Snapshot): void;
  // Replace an authored scene without replacing the mounted canvas.
  updateScene(scene: SceneDefinition, snapshot: Snapshot, trailSnapshots?: readonly Snapshot[]): void;
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
  onMoveRequested: (request: MoveEntityRequest) => boolean,
  onDeleteRequested: (entityId: string) => boolean,
  initialTrailSnapshots: readonly Snapshot[] = [],
): LabRenderer {
  // Keep an owned snapshot for later camera and selection redraws.
  // Keep the accepted scene available to drawing and selection.
  let currentScene = structuredClone(scene);
  let currentSnapshot = structuredClone(snapshot);
  const application = new Application();
  let disposed = false;
  let initialized = false;
  //                          id(for renderer), item
  const renderItems = new Map<string, RenderItem>();
  let unsubscribeFromStore: (() => void) | undefined;
  // Replace history when an authored revision changes the displayed scene.
  let trailSnapshots = structuredClone(initialTrailSnapshots);

  const trailGraphic = new Graphics({ label: "selected-projectile-trail", });
  // Keep the velocity overlay outside pointer hit-testing.
  const velocityGraphic = new Graphics({
    label: "selected-projectile-velocity",
  });
  velocityGraphic.eventMode = "none";
  trailGraphic.eventMode = "none";
  let panStart: Vector2 | null = null; // null when user not panning
  let panCameraStart: Vector2 | null = null; //camera position at the start of pan
  let dragState: DragState | null = null;
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
  function redrawSelectedTrail(viewport: ViewportTransform): void {
    trailGraphic.clear();

    const selectedEntityId = labStore.getState().selectedEntityId;

    const selectedProjectile = currentScene.bodies.find(
      (body) => body.id === selectedEntityId && body.kind === "dynamic",
    );

    if (selectedProjectile === undefined) {
      return;
    }

    const trailPoints: Vector2[] = [];

    for (const trailSnapshot of trailSnapshots) {
      const snapshotBody = trailSnapshot.bodies.find(
        (body) => body.id === selectedProjectile.id,
      );

      if (snapshotBody !== undefined) {
        trailPoints.push(snapshotBody.pose.positionMeters);
      }
    }

    const [firstPointMeters, ...remainingPoints] = trailPoints;

    if (firstPointMeters === undefined) {
      return;
    }

    const firstPoint = worldToScreen(firstPointMeters, viewport);

    trailGraphic.moveTo(firstPoint.x, firstPoint.y);

    for (const pointMeters of remainingPoints) {
      const point = worldToScreen(pointMeters, viewport);
      trailGraphic.lineTo(point.x, point.y);
    }

    trailGraphic.stroke({
      color: 0x555449,
      width: 1.7,
      alpha: 0.86,
      cap: "round",
      join: "round",
    });
  }


  // Draw velocity from the selected projectile's authoritative snapshot.
  function redrawSelectedVelocity(viewport: ViewportTransform): void {
    velocityGraphic.clear();

    const selectedEntityId = labStore.getState().selectedEntityId;

    let selectedProjectile;

    for (const body of currentScene.bodies) {
      if (body.id === selectedEntityId && body.kind === "dynamic") {
        selectedProjectile = body;
        break;
      }
    }

    if (selectedProjectile === undefined) {
      return;
    }

    let snapshotBody;

    for (const body of currentSnapshot.bodies) {
      if (body.id === selectedProjectile.id) {
        snapshotBody = body;
        break;
      }
    }

    if (snapshotBody === undefined) {
      return;
    }

    const position = snapshotBody.pose.positionMeters;
    const velocity = snapshotBody.velocity.linearMetersPerSecond;
    const speedMetersPerSecond = Math.hypot(velocity.x, velocity.y);

    if (speedMetersPerSecond === 0) {
      return;
    }

    // Bound screen length independently of zoom and leave room on small canvases.
    const maximumLengthPixels = Math.min(
      VELOCITY_ARROW_SCALE.maximumLengthPixels,
      Math.min(viewport.widthPixels, viewport.heightPixels) * 0.35,
    );
    const minimumLengthPixels = Math.min(VELOCITY_ARROW_SCALE.minimumLengthPixels, maximumLengthPixels);
    const lengthPixels = Math.min(
      maximumLengthPixels,
      Math.max(minimumLengthPixels, speedMetersPerSecond * VELOCITY_ARROW_SCALE.pixelsPerMeterPerSecond),
    );

    // Keep the authoritative anchor and reverse world y once for screen direction.
    const start = worldToScreen(position, viewport);
    const tip = {
      x: start.x + (velocity.x / speedMetersPerSecond) * lengthPixels,
      y: start.y - (velocity.y / speedMetersPerSecond) * lengthPixels,
    };

    // Keep the head readable without extending beyond a short shaft.
    const headLengthPixels = Math.min(8, lengthPixels / 2);
    const reverseAngle = Math.atan2(start.y - tip.y, start.x - tip.x);

    const leftWingTip = {
      x: tip.x + headLengthPixels * Math.cos(reverseAngle - 0.45),
      y: tip.y + headLengthPixels * Math.sin(reverseAngle - 0.45),
    };

    const rightWingTip = {
      x: tip.x + headLengthPixels * Math.cos(reverseAngle + 0.45),
      y: tip.y + headLengthPixels * Math.sin(reverseAngle + 0.45),
    };

    // Put paper backing beneath the blue shaft and open V head.
    for (const stroke of [
      { color: 0xe8e0cd, width: 4 },
      { color: 0x357ea0, width: 1.8 },
    ]) {
      velocityGraphic
        .moveTo(start.x, start.y)
        .lineTo(tip.x, tip.y)
        .moveTo(leftWingTip.x, leftWingTip.y)
        .lineTo(tip.x, tip.y)
        .lineTo(rightWingTip.x, rightWingTip.y)
        .stroke({ ...stroke, cap: "round", join: "round" });
    }
  }

  const resizeAndRender = (): void => {
    const width = Math.max(1, host.clientWidth);
    const height = Math.max(1, host.clientHeight);

    // Resize the canvas only when its actual display dimensions change.
    if (application.screen.width !== width || application.screen.height !== height) {
      application.renderer.resize(width, height);
    }
    background.clear().rect(0, 0, width, height).fill({ color: 0, alpha: 0 });

    const editorState = labStore.getState();

    const viewport = getViewport();
    redrawSelectedTrail(viewport);
    redrawSelectedVelocity(viewport);

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

  // Apply an authored revision without another asynchronous Pixi initialization.
  function updateScene(
    nextScene: SceneDefinition,
    nextSnapshot: Snapshot,
    nextTrailSnapshots: readonly Snapshot[] = [],
  ): void {
    if (disposed) {
      return;
    }

    currentScene = structuredClone(nextScene);
    currentSnapshot = structuredClone(nextSnapshot);
    trailSnapshots = structuredClone(nextTrailSnapshots);

    // Discard pointer previews belonging to the previous revision.
    dragState = null;
    panStart = null;
    panCameraStart = null;

    if (!initialized) {
      return;
    }

    background.cursor = labStore.getState().activeTool.kind === "pan" ? "grab" : "default";
    rebuildRenderItems();
    resizeAndRender();
  }

  function updateSnapshot(nextSnapshot: Snapshot): void {
    if (disposed) {
      return;
    }

    currentSnapshot = structuredClone(nextSnapshot);

    if (!initialized) {
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

  function deleteItem(item: RenderItem, event: FederatedPointerEvent): void {
    if (event.button !== 0 || !event.isPrimary) {
      return;
    }

    const deleted = onDeleteRequested(item.entityId);

    if (deleted) {
      labStore.getState().setActiveTool({ kind: "select" });
    }

    event.stopPropagation();
  }

  function startDrag(item: RenderItem, event: FederatedPointerEvent): void {
    if (event.button !== 0 || !event.isPrimary || dragState !== null) {
      return;
    }

    const pointerWorld = screenToWorld(event.global, getViewport());

    dragState = {
      entityId: item.entityId,
      pointerId: event.pointerId,
      acceptedPositionMeters: { ...item.positionMeters },
      pointerOffsetMeters: {
        x: item.positionMeters.x - pointerWorld.x,
        y: item.positionMeters.y - pointerWorld.y,
      },
    };

    item.graphic.cursor = "grabbing";
    event.stopPropagation();
  }

  function handleItemPointerDown(
    item: RenderItem,
    event: FederatedPointerEvent,
  ): void {
    const activeTool = labStore.getState().activeTool;

    if (activeTool.kind === "delete") {
      deleteItem(item, event);
      return;
    }

    labStore.getState().selectEntity(item.entityId);

    if (activeTool.kind === "move") {
      startDrag(item, event);
    }
  }

  function previewDrag(event: FederatedPointerEvent): void {
    if (dragState === null || dragState.pointerId !== event.pointerId) {
      return;
    }

    const item = renderItems.get(dragState.entityId);

    if (item === undefined) {
      dragState = null;
      return;
    }

    const pointerWorld = screenToWorld(event.global, getViewport());

    item.positionMeters = {
      x: pointerWorld.x + dragState.pointerOffsetMeters.x,
      y: pointerWorld.y + dragState.pointerOffsetMeters.y,
    };

    resizeAndRender();
  }
  function cancelActiveDrag(): void {
    if (dragState === null) {
      return;
    }

    const cancelledDrag = dragState;
    dragState = null;

    const item = renderItems.get(cancelledDrag.entityId);

    if (item !== undefined) {
      item.positionMeters = { ...cancelledDrag.acceptedPositionMeters };
      item.graphic.cursor = "pointer";
    }

    resizeAndRender();
  }

  function cancelPointerDrag(event: FederatedPointerEvent): void {
    if (dragState?.pointerId === event.pointerId) {
      cancelActiveDrag();
    }
  }
  function finishDrag(event: FederatedPointerEvent): void {
    if (dragState === null || dragState.pointerId !== event.pointerId) {
      return;
    }

    const completedDrag = dragState;
    dragState = null;

    const item = renderItems.get(completedDrag.entityId);

    if (item === undefined) {
      return;
    }

    item.graphic.cursor = "pointer";

    const positionChanged =
      item.positionMeters.x !== completedDrag.acceptedPositionMeters.x ||
      item.positionMeters.y !== completedDrag.acceptedPositionMeters.y;

    if (!positionChanged) {
      resizeAndRender();
      return;
    }

    const accepted = onMoveRequested({
      entityId: item.entityId,
      positionMeters: { ...item.positionMeters },
    });

    if (!accepted) {
      item.positionMeters = { ...completedDrag.acceptedPositionMeters };
    }

    resizeAndRender();
  }

  // Replace authoring graphics synchronously inside the existing application.
  function rebuildRenderItems(): void {
    const nextItems = createRenderItems(
      currentScene,
      currentSnapshot,
      labStore.getState().pixelsPerMeter,
    );

    for (const item of renderItems.values()) {
      item.graphic.destroy({ children: true });
    }

    renderItems.clear();

    for (const item of nextItems) {
      renderItems.set(item.entityId, item);
      item.graphic.cursor = "pointer";

      item.graphic.on("pointerdown", (event: FederatedPointerEvent) => {
        handleItemPointerDown(item, event);
      });

      item.graphic.on("pointerup", finishDrag);
      item.graphic.on("pointerupoutside", finishDrag);
      item.graphic.on("pointercancel", cancelPointerDrag);

      const velocityIndex = application.stage.getChildIndex(velocityGraphic);
      application.stage.addChildAt(item.graphic, velocityIndex);
    }
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

    // Establish persistent layers before adding the current scene objects.
    application.stage.addChild(trailGraphic, velocityGraphic);
    application.stage.addChildAt(background, 0);
    rebuildRenderItems();
    application.stage.eventMode = "static";
    application.stage.on("globalpointermove", previewDrag);
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
    window.addEventListener("blur", cancelActiveDrag);
    unsubscribeFromStore = labStore.subscribe((state, previousState) => {
      if (state.activeTool !== previousState.activeTool) {
        background.cursor =
          state.activeTool.kind === "pan" ? "grab" : "default";
        cancelActiveDrag();
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
    updateSnapshot(currentSnapshot);
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
    window.removeEventListener("blur", cancelActiveDrag);
    dragState = null;
    unsubscribeFromStore?.();
    // Release these graphics even when initialization is still pending.
    trailGraphic.destroy();
    background.destroy();
    velocityGraphic.destroy();

    if (initialized) {
      application.ticker.stop();
      application.destroy({ removeView: true }, { children: true });
    }

    selectedFilter.destroy();
  }

  return {
    updateSnapshot,
    updateScene,
    dispose,
  };
}
