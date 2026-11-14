import type { SceneDefinition, Snapshot, Vector2 } from "@eureka/contracts";

import {
  Application,
  Bounds,
  Container,
  Graphics,
  TilingSprite,
  type Texture,
  type FederatedPointerEvent,
} from "pixi.js";
import {
  screenToWorld,
  worldToScreen,
  type ViewportTransform,
} from "./coordinates.js";

import { labStore } from "./store.js";
import type { MoveEntityRequest, PlacementRequest } from "./authoring.js";
import { createPaperTexture } from "./materials.js";
import { createNotebookGrid } from "./sketchbook.js";
import { createEntityVisual } from "./entity-visuals.js";

// Keep velocity arrows readable without changing physical values.
export const VELOCITY_ARROW_SCALE = {
  pixelsPerMeterPerSecond: 6,
  minimumLengthPixels: 24,
  maximumLengthPixels: 144,
} as const;

export const IDEAL_PREDICTION_DURATION_SECONDS = 2;

interface RenderItem {
  readonly kind: "body" | "target";
  readonly graphic: Container;
  positionMeters: Vector2;
  angleRadians: number;
  readonly entityId: string;
  readonly updateAppearance: ReturnType<typeof createEntityVisual>["update"];
}
interface DragState {
  readonly entityId: string;
  readonly pointerId: number; //prevent another pointer from finishing the drag
  readonly acceptedPositionMeters: Vector2; //restores the object after cancellation
  readonly pointerOffsetMeters: Vector2; // Preserves the exact point where the object was grabbed.
}

interface PanState {
  readonly pointerId: number;
  readonly buttonMask: number;
  readonly startPixels: Vector2;
  readonly cameraCenterWorldMeters: Vector2;
  readonly pixelsPerMeter: number;
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
): readonly RenderItem[] {
  return [...scene.triggers, ...scene.bodies].map((entity) => {
    const pose = entity.kind === "target"
      ? entity.pose
      : snapshot.bodies.find((body) => body.id === entity.id)?.pose;
    if (pose === undefined) {
      throw new Error(`Snapshot omitted scene body "${entity.id}".`);
    }
    const visual = createEntityVisual(entity);
    return {
      kind: entity.kind === "target" ? "target" : "body",
      graphic: visual.graphic,
      positionMeters: pose.positionMeters,
      angleRadians: pose.angleRadians,
      entityId: entity.id,
      updateAppearance: visual.update,
    };
  });
}

// Draw an open-headed arrow between two screen positions.
function drawVelocityArrow(graphic: Graphics, start: Vector2, tip: Vector2, widthPixels: number): void {
  const lengthPixels = Math.hypot(tip.x - start.x, tip.y - start.y);

  if (lengthPixels === 0) {
    return;
  }

  // Keep the head inside short arrows without moving the tip.
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

  // Back the blue strokes with paper for contrast.
  for (const stroke of [
    { color: 0xe8e0cd, width: 4 },
    { color: 0x357ea0, width: widthPixels },
  ]) {
    graphic
      .moveTo(start.x, start.y)
      .lineTo(tip.x, tip.y)
      .moveTo(leftWingTip.x, leftWingTip.y)
      .lineTo(tip.x, tip.y)
      .lineTo(rightWingTip.x, rightWingTip.y)
      .stroke({ ...stroke, cap: "round", join: "round" });
  }
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
  const predictionGraphic = new Graphics({ label: "selected-projectile-ideal-prediction" });
  predictionGraphic.eventMode = "none";
  const velocityGraphic = new Graphics({
    label: "selected-projectile-velocity",
  });
  velocityGraphic.eventMode = "none";
  const horizontalVelocityGraphic = new Graphics({
    label: "selected-projectile-horizontal-velocity",
  });
  const verticalVelocityGraphic = new Graphics({
    label: "selected-projectile-vertical-velocity",
  });
  verticalVelocityGraphic.eventMode = "none";
  horizontalVelocityGraphic.eventMode = "none";

  trailGraphic.eventMode = "none";
  let panState: PanState | null = null;
  let dragState: DragState | null = null;
  const background = new Graphics();
  background.eventMode = "static";
  let backgroundWidth = 0;
  let backgroundHeight = 0;
  background.cursor =
    labStore.getState().activeTool.kind === "pan" ? "grab" : "default";
  const notebook = createNotebookGrid();
  let paperTexture: Texture | undefined;
  let paper: TilingSprite | undefined;
  const resizeObserver = new ResizeObserver(() => {
    if (initialized && !disposed) resizeAndRender();
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

  // Both pan gestures share one camera origin and leave the selected tool unchanged.
  function stopPan(): void {
    panState = null;
    host.classList.remove("is-panning");
    background.cursor = labStore.getState().activeTool.kind === "pan" ? "grab" : "default";
  }

  function finishPan(event: FederatedPointerEvent): void {
    if (panState?.pointerId === event.pointerId &&
      (event.type === "pointercancel" || (event.buttons & panState.buttonMask) === 0)) {
      stopPan();
    }
  }

  // Cancel temporary pointer work when the browser loses focus.
  function cancelInteractions(): void {
    stopPan();
    cancelActiveDrag();
  }

  // Reserve middle-click on this canvas for panning rather than browser autoscroll or paste.
  function preventMiddleMouseDefault(event: MouseEvent): void {
    if (event.button === 1) {
      event.preventDefault();
    }
  }

  // Use the same selected dynamic body for every projectile-only overlay.
  function getSelectedProjectile(selectedEntityId: string | null) {
    return currentScene.bodies.find(
      (body) => body.id === selectedEntityId && body.kind === "dynamic",
    );
  }

  // Predict free flight from the scene's initial conditions.
  function redrawSelectedPrediction(
    viewport: ViewportTransform,
    selectedProjectile: ReturnType<typeof getSelectedProjectile>,
  ): void {
    predictionGraphic.clear();

    if (!predictionGraphic.visible || selectedProjectile === undefined || selectedProjectile.kind !== "dynamic") {
      return;
    }

    const position = selectedProjectile.pose.positionMeters;
    const velocity = selectedProjectile.velocity.linearMetersPerSecond;
    const gravity = currentScene.environment.gravityMetersPerSecondSquared;
    const screenPoints: Vector2[] = [];
    const intervalCount = 100;

    // Calculate 101 independent positions, including both endpoints.
    for (let index = 0; index <= intervalCount; index += 1) {
      const timeSeconds = IDEAL_PREDICTION_DURATION_SECONDS * index / intervalCount;
      const halfTimeSquared = 0.5 * timeSeconds * timeSeconds;
      const pointMeters = {
        x: position.x + velocity.x * timeSeconds + gravity.x * halfTimeSquared,
        y: position.y + velocity.y * timeSeconds + gravity.y * halfTimeSquared,
      };
      const point = worldToScreen(pointMeters, viewport);
      screenPoints.push(point);

      if (index === 0) {
        predictionGraphic.moveTo(point.x, point.y);
      } else {
        predictionGraphic.lineTo(point.x, point.y);
      }
    }

    // Put a faint backing beneath the dashed reference.
    predictionGraphic.stroke({
      color: 0xdd875d,
      width: 7,
      alpha: 0.08,
      cap: "round",
      join: "round",
    });

    predictionGraphic.beginPath();

    // Draw two intervals, then leave two intervals empty.
    for (const [index, point] of screenPoints.entries()) {
      if (index === 0 || Math.floor((index - 1) / 2) % 2 !== 0) {
        predictionGraphic.moveTo(point.x, point.y);
      } else {
        predictionGraphic.lineTo(point.x, point.y);
      }
    }

    predictionGraphic.stroke({
      color: 0xb86f4c,
      width: 1.7,
      alpha: 0.9,
      cap: "round",
      join: "round",
    });
  }

  function redrawSelectedTrail(
    viewport: ViewportTransform,
    selectedProjectile: ReturnType<typeof getSelectedProjectile>,
  ): void {
    trailGraphic.clear();

    if (!trailGraphic.visible || selectedProjectile === undefined) {
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
  function redrawSelectedVelocity(
    viewport: ViewportTransform,
    selectedProjectile: ReturnType<typeof getSelectedProjectile>,
  ): void {
    // Remove previous arrows before checking selection and visibility.
    velocityGraphic.clear();
    horizontalVelocityGraphic.clear();
    verticalVelocityGraphic.clear();

    if (selectedProjectile === undefined || (!velocityGraphic.visible && !horizontalVelocityGraphic.visible)) {
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

    // Project the displayed full vector onto the horizontal direction.
    const horizontalTip = {
      x: tip.x,
      y: start.y,
    };

    const verticalTip = {
      x: start.x,
      y: tip.y,
    };
    if (horizontalVelocityGraphic.visible) {
      drawVelocityArrow(horizontalVelocityGraphic, start, horizontalTip, 1);
      drawVelocityArrow(verticalVelocityGraphic, start, verticalTip, 1);
    }

    if (velocityGraphic.visible) {
      drawVelocityArrow(velocityGraphic, start, tip, 1.8);
    }
  }

  const resizeAndRender = (): void => {
    const width = Math.max(1, host.clientWidth);
    const height = Math.max(1, host.clientHeight);

    // Resize the canvas only when its actual display dimensions change.
    if (application.screen.width !== width || application.screen.height !== height) {
      application.renderer.resize(width, height);
    }
    if (backgroundWidth !== width || backgroundHeight !== height) {
      background.clear().rect(0, 0, width, height).fill({ color: 0, alpha: 0 });
      backgroundWidth = width;
      backgroundHeight = height;
    }

    const editorState = labStore.getState();

    // Apply editor choices without changing the physical snapshot.
    trailGraphic.visible = editorState.overlayVisibility.trail;
    predictionGraphic.visible = editorState.overlayVisibility.prediction;
    velocityGraphic.visible = editorState.overlayVisibility.velocity;
    horizontalVelocityGraphic.visible = editorState.overlayVisibility.components;
    verticalVelocityGraphic.visible = editorState.overlayVisibility.components;

    const viewport = getViewport();
    if (paper !== undefined) {
      paper.width = width;
      paper.height = height;
    }
    notebook.update(viewport, editorState.overlayVisibility.grid);
    const selectedProjectile = getSelectedProjectile(editorState.selectedEntityId);
    redrawSelectedTrail(viewport, selectedProjectile);
    redrawSelectedVelocity(viewport, selectedProjectile);
    redrawSelectedPrediction(viewport, selectedProjectile);

    for (const item of renderItems.values()) {
      const entered = editorState.overlayVisibility.events && currentSnapshot.events.some(
        (event) => event.kind === "targetEntered" && event.targetId === item.entityId && event.tick === currentSnapshot.tick,
      );
      item.updateAppearance(
        editorState.pixelsPerMeter,
        item.angleRadians,
        editorState.selectedEntityId === item.entityId,
        entered,
        editorState.overlayVisibility.labels,
        worldToScreen(item.positionMeters, viewport),
        width,
      );
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
    stopPan();

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
    if (event.button !== 0 || !event.isPrimary || panState !== null) {
      return;
    }
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

      // Keep rebuilt bodies beneath both velocity overlays.
      const overlayIndex = application.stage.getChildIndex(horizontalVelocityGraphic);
      application.stage.addChildAt(item.graphic, overlayIndex);
    }
  }

  function fitScene(): void {
    const bounds = new Bounds();
    const include = (x: number, y: number, halfWidth = 0, halfHeight = 0) => {
      bounds.addFrame(x - halfWidth, y - halfHeight, x + halfWidth, y + halfHeight);
    };
    // Frame physical geometry, never text bounds or decorative selection strokes.
    for (const entity of [...currentScene.bodies, ...currentScene.triggers]) {
      const pose = entity.kind === "target" ? entity.pose : currentSnapshot.bodies.find((body) => body.id === entity.id)?.pose;
      if (pose === undefined) continue;
      if (entity.shape.kind === "circle") {
        include(pose.positionMeters.x, pose.positionMeters.y, entity.shape.radiusMeters, entity.shape.radiusMeters);
      } else {
        const shape = entity.shape;
        const cosine = Math.abs(Math.cos(pose.angleRadians));
        const sine = Math.abs(Math.sin(pose.angleRadians));
        const halfWidth = (shape.widthMeters * cosine + shape.heightMeters * sine) / 2;
        const halfHeight = (shape.widthMeters * sine + shape.heightMeters * cosine) / 2;
        // The long default ground establishes height without shrinking the experiment.
        include(pose.positionMeters.x, pose.positionMeters.y, entity.id === "default-ground" ? 0 : halfWidth, halfHeight);
      }
      if (entity.kind === "dynamic") include(entity.pose.positionMeters.x, entity.pose.positionMeters.y);
    }
    for (const snapshot of trailSnapshots) {
      for (const body of snapshot.bodies) {
        if (currentScene.bodies.some((entity) => entity.id === body.id && entity.kind === "dynamic")) {
          include(body.pose.positionMeters.x, body.pose.positionMeters.y);
        }
      }
    }
    // Include the already-drawn reference, using the same prediction as the viewport.
    if (predictionGraphic.visible && getSelectedProjectile(labStore.getState().selectedEntityId) !== undefined) {
      const reference = predictionGraphic.getBounds();
      const viewport = getViewport();
      const first = screenToWorld({ x: reference.x, y: reference.y }, viewport);
      const last = screenToWorld({ x: reference.x + reference.width, y: reference.y + reference.height }, viewport);
      include(first.x, first.y);
      include(last.x, last.y);
    }
    if (currentScene.bodies.length + currentScene.triggers.length === 0) {
      labStore.getState().setCamera({ x: 0, y: 0 }, 48);
      return;
    }
    const scale = Math.max(.01, Math.min(
      96,
      Math.max(1, application.screen.width - 100) / Math.max(1, bounds.width),
      Math.max(1, application.screen.height - 180) / Math.max(1, bounds.height),
    ));
    labStore.getState().setCamera({
      x: bounds.x + bounds.width / 2,
      // Reserve more room for the title/tools above the diagram.
      y: bounds.y + bounds.height / 2 + 25 / scale,
    }, scale);
  }

  function handleWheel(event: WheelEvent): void {
    event.preventDefault();
    stopPan();
    cancelActiveDrag();
    const viewport = getViewport();
    const rect = application.canvas.getBoundingClientRect();
    const pointer = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const world = screenToWorld(pointer, viewport);
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.heightPixels : 1);
    const scale = Math.max(12, Math.min(192, viewport.pixelsPerMeter * Math.exp(-delta * .001)));
    labStore.getState().setCamera({
      x: world.x - (pointer.x - viewport.widthPixels / 2) / scale,
      y: world.y + (pointer.y - viewport.heightPixels / 2) / scale,
    }, scale);
  }

  const initialize = async (): Promise<void> => {
    // The local handwriting font must be ready before Pixi measures captions.
    try {
      await document.fonts.load('17px "Kalam"');
    } catch {
      // Retain a usable canvas if the local font fails to load.
    }
    if (disposed) return;
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

    paperTexture = createPaperTexture();
    paper = new TilingSprite({ texture: paperTexture, width: host.clientWidth, height: host.clientHeight, eventMode: "none" });
    application.stage.addChild(paper, notebook.root);
    // Keep paths behind bodies and velocity arrows.
    application.stage.addChild(
      trailGraphic, predictionGraphic,
      horizontalVelocityGraphic, verticalVelocityGraphic, velocityGraphic,
    );
    application.stage.addChildAt(background, 0);
    rebuildRenderItems();
    application.stage.eventMode = "static";
    application.stage.on("globalpointermove", previewDrag);
    application.stage.on("pointerdowncapture", (event) => {
      const activeTool = labStore.getState().activeTool;

      if (!event.isPrimary) {
        return;
      }
      if (panState !== null) {
        event.stopImmediatePropagation();
        return;
      }
      if (event.button === 1 || (event.button === 0 && activeTool.kind === "pan")) {
        cancelActiveDrag();
        const editorState = labStore.getState();
        panState = {
          pointerId: event.pointerId,
          // Held-button flags use 4 for middle and 1 for left.
          buttonMask: event.button === 1 ? 4 : 1,
          startPixels: { x: event.global.x, y: event.global.y },
          cameraCenterWorldMeters: { ...editorState.cameraCenterWorldMeters },
          pixelsPerMeter: editorState.pixelsPerMeter,
        };
        host.classList.add("is-panning");
        background.cursor = "grabbing";
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }

      if (event.button !== 0 || activeTool.kind !== "place") {
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
    application.stage.on("globalpointermove", (event) => {
      if (panState === null || panState.pointerId !== event.pointerId) {
        return;
      }
      if ((event.buttons & panState.buttonMask) === 0) {
        stopPan();
        return;
      }

      const { startPixels, cameraCenterWorldMeters, pixelsPerMeter } = panState;
      const dx = event.global.x - startPixels.x;
      const dy = event.global.y - startPixels.y;
      labStore.getState().setCamera({
        x: cameraCenterWorldMeters.x - dx / pixelsPerMeter,
        y: cameraCenterWorldMeters.y + dy / pixelsPerMeter,
      }, pixelsPerMeter);
    });

    application.stage.on("pointerup", finishPan);
    application.stage.on("pointerupoutside", finishPan);
    application.stage.on("pointercancel", finishPan);
    // This host is dedicated to Pixi, so replacing its children enforces
    // one-canvas ownership even across development remounts.
    host.replaceChildren(application.canvas);
    resizeObserver.observe(host);
    host.addEventListener("wheel", handleWheel, { passive: false });
    host.addEventListener("mousedown", preventMiddleMouseDefault);
    host.addEventListener("auxclick", preventMiddleMouseDefault);
    window.addEventListener("blur", cancelInteractions);
    unsubscribeFromStore = labStore.subscribe((state, previousState) => {
      if (state.cameraFitRequest !== previousState.cameraFitRequest) {
        stopPan();
        cancelActiveDrag();
        fitScene();
        return;
      }
      if (state.activeTool !== previousState.activeTool) {
        stopPan();
        cancelActiveDrag();
      }

      if (
        state.cameraCenterWorldMeters !==
        previousState.cameraCenterWorldMeters ||
        state.pixelsPerMeter !== previousState.pixelsPerMeter ||
        state.selectedEntityId !== previousState.selectedEntityId ||
        state.overlayVisibility !== previousState.overlayVisibility
      ) {
        resizeAndRender();
      }
    });
    updateSnapshot(currentSnapshot);

    if (!labStore.getState().cameraInitialized) fitScene();
  };

  void initialize().catch((error: unknown) => {
    if (!disposed) {
      console.error("Failed to initialize the Pixi canvas.", error);
      dispose();
    }
  });

  function dispose(): void {
    if (disposed) {
      return;
    }

    disposed = true;
    resizeObserver.disconnect();
    host.removeEventListener("wheel", handleWheel);
    host.removeEventListener("mousedown", preventMiddleMouseDefault);
    host.removeEventListener("auxclick", preventMiddleMouseDefault);
    window.removeEventListener("blur", cancelInteractions);
    stopPan();
    dragState = null;
    unsubscribeFromStore?.();
    if (initialized) {
      application.destroy({ removeView: true }, { children: true });
    } else {
      // These graphics are not stage children yet, so release them directly.
      trailGraphic.destroy();
      background.destroy();
      velocityGraphic.destroy();
      horizontalVelocityGraphic.destroy();
      verticalVelocityGraphic.destroy();
      predictionGraphic.destroy();
      notebook.root.destroy({ children: true });
    }

    paperTexture?.destroy(true);
  }

  return {
    updateSnapshot,
    updateScene,
    dispose,
  };
}
