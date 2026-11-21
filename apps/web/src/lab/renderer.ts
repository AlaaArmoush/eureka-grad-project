import type { DynamicBody, SceneDefinition, Snapshot, SnapshotEvent, StaticBody, Vector2 } from "@eureka/contracts";

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
  fitCameraView,
  screenToWorld,
  worldToScreen,
  type ViewportTransform,
} from "./coordinates.js";

import { CAMERA_ZOOM, labStore } from "./store.js";
import type { MoveEntityRequest, PlacementRequest } from "./authoring.js";
import { ballPigment, createPaperTexture, sceneColors } from "./materials.js";
import { createNotebookGrid } from "./sketchbook.js";
import { createEntityVisual } from "./entity-visuals.js";

const DELETE_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" stroke="#303b42" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M3 2v16l4-4 3 7 3-1-3-7h7Z" fill="#fff"/><circle cx="18" cy="17" r="5" fill="#fff"/><path d="M15 17h6" fill="none" stroke-width="2"/></svg>',
)}") 3 2, pointer`;

// A level static box this wide is a ground plane: it gives the scene its height, never its width.
const GROUND_PLANE_WIDTH_METERS = 100;

// Keep velocity arrows readable without changing physical values.
export const VELOCITY_ARROW_SCALE = {
  pixelsPerMeterPerSecond: 6,
  minimumLengthPixels: 24,
  maximumLengthPixels: 144,
} as const;

// Used only when there is no ground below the ball to land on.
export const IDEAL_PREDICTION_DURATION_SECONDS = 2;

// A ball's whole trail stays while it flies; this long after it first touches a surface, the trail starts erasing from its start.
const TRAIL_AFTER_CONTACT_SECONDS = 3;
// Memory bound for very long runs: keep at most this many recorded ticks (one minute at 60 Hz).
const MAXIMUM_TRAIL_SAMPLES = 3600;

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

// During a run, dragging a ball pulls it with a spring instead of moving it.
interface PullState {
  readonly entityId: string;
  readonly pointerId: number;
  readonly localAnchorMeters: Vector2; // Grab point, relative to the ball.
  targetMeters: Vector2; // Current pointer position.
}

// Implemented by LabCanvas; the renderer only reports pointer positions.
export interface PullHandlers {
  // "notRunning" means the Move tool should move the starting position as before.
  start(bodyId: string, localAnchorMeters: Vector2, targetMeters: Vector2): "started" | "notRunning" | "rejected";
  move(targetMeters: Vector2): boolean;
  release(): void;
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
  updateRunEvents(events: readonly SnapshotEvent[]): void;
  // Replace an authored scene without replacing the mounted canvas.
  updateScene(scene: SceneDefinition, snapshot: Snapshot): void;
  dispose(): void;
}

// One drawn tick of the simulated trail: where each projectile was at that tick.
interface TrailSample {
  readonly tick: number;
  readonly positionsMeters: ReadonlyMap<string, Vector2>;
}
function createRenderItems(
  scene: SceneDefinition,
  snapshot: Snapshot,
): readonly RenderItem[] {
  const ballIds = scene.bodies.filter((body) => body.kind === "dynamic").map((body) => body.id);

  return [...scene.triggers, ...scene.bodies].map((entity) => {
    const pose = entity.kind === "target"
      ? entity.pose
      : snapshot.bodies.find((body) => body.id === entity.id)?.pose;
    if (pose === undefined) {
      throw new Error(`Snapshot omitted scene body "${entity.id}".`);
    }
    const visual = createEntityVisual(entity, ballIds.indexOf(entity.id));
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

function isGroundPlane(body: SceneDefinition["bodies"][number]): body is StaticBody {
  return body.kind === "static" && body.pose.angleRadians === 0 && body.shape.widthMeters >= GROUND_PLANE_WIDTH_METERS;
}

// Ideal time for the ball's centre to come down onto the highest ground below it.
// Solves y0 + vy·t − g·t²/2 = yLand: t = (vy + √(vy² + 2·g·(y0 − yLand))) / g.
function idealLandingTimeSeconds(scene: SceneDefinition, projectile: DynamicBody): number {
  const g = -scene.environment.gravityMetersPerSecondSquared.y;
  const startY = projectile.pose.positionMeters.y;
  const vy = projectile.velocity.linearMetersPerSecond.y;
  let landingY: number | undefined;

  for (const body of scene.bodies) {
    if (!isGroundPlane(body)) {
      continue;
    }

    // The centre stops one radius above the ground's top.
    const centreY = body.pose.positionMeters.y + body.shape.heightMeters / 2 + projectile.shape.radiusMeters;

    if (centreY <= startY && (landingY === undefined || centreY > landingY)) {
      landingY = centreY;
    }
  }

  if (landingY === undefined || g <= 0) {
    return IDEAL_PREDICTION_DURATION_SECONDS;
  }

  return (vy + Math.sqrt(vy * vy + 2 * g * (startY - landingY))) / g;
}

// Ideal position at time t from the starting conditions: x = x0 + vx·t + gx·t²/2, and the same for y.
function idealPositionMeters(scene: SceneDefinition, projectile: DynamicBody, timeSeconds: number): Vector2 {
  const position = projectile.pose.positionMeters;
  const velocity = projectile.velocity.linearMetersPerSecond;
  const gravity = scene.environment.gravityMetersPerSecondSquared;
  const halfTimeSquared = 0.5 * timeSeconds * timeSeconds;

  return {
    x: position.x + velocity.x * timeSeconds + gravity.x * halfTimeSquared,
    y: position.y + velocity.y * timeSeconds + gravity.y * halfTimeSquared,
  };
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
    { color: sceneColors.paper, width: 4 },
    { color: sceneColors.velocity, width: widthPixels },
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
  pullHandlers: PullHandlers,
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
  // The simulated trail, recorded from the ticks this renderer is given to draw.
  let trailSamples: TrailSample[] = [];

  const trailGraphic = new Graphics({ label: "projectile-trails" });
  const predictionGraphic = new Graphics({ label: "selected-projectile-ideal-prediction" });
  predictionGraphic.eventMode = "none";
  const challengePathGraphic = new Graphics({ label: "challenge-paths" });
  challengePathGraphic.eventMode = "none";
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
  const pullGraphic = new Graphics({ label: "pointer-pull-spring" });
  pullGraphic.eventMode = "none";
  let panState: PanState | null = null;
  let dragState: DragState | null = null;
  let pullState: PullState | null = null;
  // A newly loaded scene is fitted on the next draw.
  let fitPending = false;
  // The camera the last fit chose; while it is unchanged, the view refits when the canvas changes size.
  let fittedCamera: { readonly center: Vector2; readonly pixelsPerMeter: number } | null = null;
  // This run's events, so a target stays coloured after the tick it was entered.
  let runEvents: readonly SnapshotEvent[] = [];
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

    if (initialized && !disposed) {
      resizeAndRender();
    }
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

  function placeObjectAt(positionMeters: Vector2): void {
    const tool = labStore.getState().activeTool;

    if (tool.kind !== "place") {
      return;
    }

    onPlacementRequested({ ...tool, positionMeters: { ...positionMeters } });
  }

  function handleCanvasKey(event: KeyboardEvent): void {
    if (event.altKey || event.ctrlKey || event.metaKey || disposed) {
      return;
    }

    const state = labStore.getState();

    if (event.key === "Escape" && state.activeTool.kind === "place") {
      event.preventDefault();
      state.setActiveTool({ kind: "move" });
      return;
    }

    if (event.key === "Enter" && state.activeTool.kind === "place") {
      event.preventDefault();

      if (!event.repeat) {
        placeObjectAt(state.cameraCenterWorldMeters);
      }

      return;
    }

    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();

      if (!event.repeat && state.selectedEntityId !== null) {
        onDeleteRequested(state.selectedEntityId);
      }

      return;
    }

    const x = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
    const y = event.key === "ArrowUp" ? 1 : event.key === "ArrowDown" ? -1 : 0;

    if (x !== 0 || y !== 0) {
      event.preventDefault();
      stopPan();
      cancelActiveDrag();
      const distanceMeters = 120 / state.pixelsPerMeter;
      state.setCamera({
        x: state.cameraCenterWorldMeters.x + x * distanceMeters,
        y: state.cameraCenterWorldMeters.y + y * distanceMeters,
      }, state.pixelsPerMeter);
    }
  }

  // Use the same selected dynamic body for every projectile-only overlay.
  function getSelectedProjectile(selectedEntityId: string | null) {
    return currentScene.bodies.find(
      (body) => body.id === selectedEntityId && body.kind === "dynamic",
    );
  }

  // Ideal flight from the starting conditions, up to the formula landing time.
  function redrawSelectedPrediction(
    viewport: ViewportTransform,
    selectedProjectile: ReturnType<typeof getSelectedProjectile>,
  ): void {
    predictionGraphic.clear();

    if (!predictionGraphic.visible || selectedProjectile === undefined || selectedProjectile.kind !== "dynamic") {
      return;
    }

    const screenPoints: Vector2[] = [];
    const intervalCount = 100;
    const flightTimeSeconds = idealLandingTimeSeconds(currentScene, selectedProjectile);

    // Calculate 101 independent positions, including both endpoints.
    for (let index = 0; index <= intervalCount; index += 1) {
      const timeSeconds = flightTimeSeconds * index / intervalCount;
      const point = worldToScreen(idealPositionMeters(currentScene, selectedProjectile, timeSeconds), viewport);
      screenPoints.push(point);

      if (index === 0) {
        predictionGraphic.moveTo(point.x, point.y);
      } else {
        predictionGraphic.lineTo(point.x, point.y);
      }
    }

    // Put a faint backing beneath the dashed reference.
    predictionGraphic.stroke({
      color: sceneColors.reference,
      width: 7,
      alpha: 0.12,
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
      color: sceneColors.reference,
      width: 2.2,
      alpha: 1,
      cap: "round",
      join: "round",
    });
  }

  // Every ball draws its own trail in its own colour, selected or not.
  function redrawTrails(viewport: ViewportTransform): void {
    trailGraphic.clear();

    if (!trailGraphic.visible) {
      return;
    }

    const balls = currentScene.bodies.filter((body) => body.kind === "dynamic");
    const waitTicks = Math.round(TRAIL_AFTER_CONTACT_SECONDS / currentScene.numericalProfile.fixedTimeStepSeconds);
    const firstTick = trailSamples[0]?.tick ?? 0;

    for (const [ballIndex, ball] of balls.entries()) {
      const trailPoints: Vector2[] = [];
      // Erasing starts a few seconds after the first touch and moves forward one tick per tick.
      const contactTick = runEvents.find((event) => event.kind === "groundContact" && event.bodyId === ball.id)?.tick;
      const oldestTick = contactTick === undefined ? firstTick : firstTick + Math.max(0, currentSnapshot.tick - contactTick - waitTicks);

      for (const sample of trailSamples) {
        const positionMeters = sample.positionsMeters.get(ball.id);

        if (positionMeters !== undefined && sample.tick >= oldestTick) {
          trailPoints.push(positionMeters);
        }
      }

      const [firstPointMeters, ...remainingPoints] = trailPoints;

      if (firstPointMeters === undefined || remainingPoints.length === 0) {
        continue;
      }

      const firstPoint = worldToScreen(firstPointMeters, viewport);
      trailGraphic.moveTo(firstPoint.x, firstPoint.y);

      for (const pointMeters of remainingPoints) {
        const point = worldToScreen(pointMeters, viewport);
        trailGraphic.lineTo(point.x, point.y);
      }

      trailGraphic.stroke({ color: ballPigment(ballIndex).edge, width: 1.7, alpha: 0.86, cap: "round", join: "round" });
    }
  }


  // Draw the challenge's ghost of the previous attempt faintly and the current attempt's path solid, from the shared store.
  function redrawChallengePaths(viewport: ViewportTransform): void {
    challengePathGraphic.clear();

    const { live, ghosts } = labStore.getState().challengeOverlay;

    const strokePath = (points: readonly Vector2[], alpha: number, width: number): void => {
      const [first, ...rest] = points;

      if (first === undefined || rest.length === 0) {
        return;
      }

      const start = worldToScreen(first, viewport);
      challengePathGraphic.moveTo(start.x, start.y);

      for (const point of rest) {
        const screen = worldToScreen(point, viewport);
        challengePathGraphic.lineTo(screen.x, screen.y);
      }

      challengePathGraphic.stroke({ color: sceneColors.trail, width, alpha, cap: "round", join: "round" });
    };

    for (const ghost of ghosts) {
      strokePath(ghost, 0.3, 1.5);
    }

    strokePath(live, 0.9, 2);
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

  // A line from the grab point on the ball to the pointer while a pull is held.
  function redrawPull(viewport: ViewportTransform): void {
    pullGraphic.clear();
    const pull = pullState;
    const item = pull === null ? undefined : renderItems.get(pull.entityId);

    if (pull === null || item === undefined) {
      return;
    }

    // Rotate the grab point with the ball, as the engine does.
    const cosine = Math.cos(item.angleRadians);
    const sine = Math.sin(item.angleRadians);
    const anchor = worldToScreen({
      x: item.positionMeters.x + cosine * pull.localAnchorMeters.x - sine * pull.localAnchorMeters.y,
      y: item.positionMeters.y + sine * pull.localAnchorMeters.x + cosine * pull.localAnchorMeters.y,
    }, viewport);
    const pointer = worldToScreen(pull.targetMeters, viewport);

    pullGraphic.moveTo(anchor.x, anchor.y).lineTo(pointer.x, pointer.y).stroke({ color: sceneColors.ink, width: 1.5, alpha: 0.75, cap: "round" });
    pullGraphic.circle(pointer.x, pointer.y, 4).stroke({ color: sceneColors.ink, width: 1.5 });
  }

  const resizeAndRender = (): void => {
    // Hidden pages retain their view instead of resizing it to a one-pixel canvas.
    if (!initialized || disposed || host.clientWidth === 0 || host.clientHeight === 0) {
      return;
    }

    const width = host.clientWidth;
    const height = host.clientHeight;

    // Resize the canvas only when its actual display dimensions change.
    const resized = application.screen.width !== width || application.screen.height !== height;

    if (resized) {
      application.renderer.resize(width, height);
    }
    if (backgroundWidth !== width || backgroundHeight !== height) {
      background.clear().rect(0, 0, width, height).fill({ color: 0, alpha: 0 });
      backgroundWidth = width;
      backgroundHeight = height;
    }

    const editorState = labStore.getState();

    // A loaded demonstration waits for the actual visible canvas dimensions.
    if (editorState.pendingCameraView !== null) {
      const camera = fitCameraView(editorState.pendingCameraView, width, height);
      editorState.setCamera(camera.centerWorldMeters, camera.pixelsPerMeter);
      return;
    }

    // Fit the first scene, a newly loaded scene, or a still-fitted view whose canvas changed size.
    const stillFitted = fittedCamera !== null &&
      editorState.pixelsPerMeter === fittedCamera.pixelsPerMeter &&
      editorState.cameraCenterWorldMeters.x === fittedCamera.center.x &&
      editorState.cameraCenterWorldMeters.y === fittedCamera.center.y;

    if (!editorState.cameraInitialized || fitPending || (resized && stillFitted)) {
      fitPending = false;
      fitScene();
      return;
    }

    // Apply editor choices without changing the physical snapshot.
    const toolCursor = panState !== null || dragState !== null || pullState !== null ? "grabbing" :
      editorState.activeTool.kind === "pan" ? "grab" :
        editorState.activeTool.kind === "move" ? "move" :
          editorState.activeTool.kind === "place" ? "copy" :
            editorState.activeTool.kind === "delete" ? DELETE_CURSOR : "default";
    background.cursor = toolCursor;
    trailGraphic.visible = editorState.overlayVisibility.trail;
    challengePathGraphic.visible = editorState.overlayVisibility.trail;
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
    redrawTrails(viewport);
    redrawChallengePaths(viewport);
    redrawSelectedVelocity(viewport, selectedProjectile);
    redrawSelectedPrediction(viewport, selectedProjectile);
    redrawPull(viewport);

    for (const item of renderItems.values()) {
      item.graphic.cursor = editorState.activeTool.kind === "select" && panState === null ? "pointer" : toolCursor;
      // Once a ball enters a target, the target changes colour until Reset.
      const entered = editorState.overlayVisibility.events && runEvents.some(
        (event) => event.kind === "targetEntered" && event.targetId === item.entityId,
      );
      // A target used as a challenge zone shows the attempt's state instead.
      const zone = editorState.challengeOverlay.zones.find((view) => view.zone.targetId === item.entityId);
      item.updateAppearance(
        editorState.pixelsPerMeter,
        item.angleRadians,
        editorState.selectedEntityId === item.entityId,
        zone === undefined ? entered : zone,
        editorState.overlayVisibility.labels,
        worldToScreen(item.positionMeters, viewport),
        width,
        height,
        editorState.activeTool.kind === "move",
      );
    }

    application.render();
  };

  // Record one drawn tick; a tick that does not move forward is a Reset or a new run, so the old path is cleared.
  function recordTrailSample(snapshot: Snapshot): void {
    const previous = trailSamples.at(-1);

    if (previous !== undefined && snapshot.tick <= previous.tick) {
      trailSamples = [];
      // Reset also removed the engine's pull.
      pullState = null;
    }

    const positionsMeters = new Map<string, Vector2>();

    for (const body of snapshot.bodies) {
      if (currentScene.bodies.some((entity) => entity.id === body.id && entity.kind === "dynamic")) {
        positionsMeters.set(body.id, { ...body.pose.positionMeters });
      }
    }

    trailSamples.push({ tick: snapshot.tick, positionsMeters });

    if (trailSamples.length > MAXIMUM_TRAIL_SAMPLES) {
      trailSamples.splice(0, trailSamples.length - MAXIMUM_TRAIL_SAMPLES);
    }
  }

  // Apply an authored revision without another asynchronous Pixi initialization.
  function updateScene(nextScene: SceneDefinition, nextSnapshot: Snapshot): void {
    if (disposed) {
      return;
    }

    // A different or reloaded scene (a question, challenge or restored setup) is fitted; an edit keeps the view.
    // Edits only raise the revision, so a lower one means the scene was loaded again.
    if (nextScene.id !== currentScene.id || nextScene.revision < currentScene.revision) {
      fitPending = true;
    }

    currentScene = structuredClone(nextScene);
    currentSnapshot = structuredClone(nextSnapshot);
    // A new starting scene begins a new path at its own tick zero.
    trailSamples = [];
    recordTrailSample(currentSnapshot);

    // Discard pointer work and events from the previous scene.
    dragState = null;
    pullState = null;
    runEvents = [];
    stopPan();

    if (!initialized) {
      return;
    }

    rebuildRenderItems();
    resizeAndRender();
  }

  function updateSnapshot(nextSnapshot: Snapshot): void {
    if (disposed) {
      return;
    }

    currentSnapshot = structuredClone(nextSnapshot);
    recordTrailSample(currentSnapshot);

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

  function updateRunEvents(events: readonly SnapshotEvent[]): void {
    if (disposed) {
      return;
    }

    runEvents = events;

    if (initialized) {
      resizeAndRender();
    }
  }

  function deleteItem(item: RenderItem, event: FederatedPointerEvent): void {
    if (event.button !== 0 || !event.isPrimary) {
      return;
    }

    onDeleteRequested(item.entityId);
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
    resizeAndRender();
    event.stopPropagation();
  }

  // Returns false when the Move tool should move the starting position instead.
  function startPull(item: RenderItem, event: FederatedPointerEvent): boolean {
    const isBall = currentScene.bodies.some((body) => body.id === item.entityId && body.kind === "dynamic");

    if (!isBall) {
      return false;
    }

    if (pullState !== null) {
      return true;
    }

    const pointerWorld = screenToWorld(event.global, getViewport());
    // Store the grab point relative to the ball, undoing the ball's rotation.
    const offsetX = pointerWorld.x - item.positionMeters.x;
    const offsetY = pointerWorld.y - item.positionMeters.y;
    const cosine = Math.cos(item.angleRadians);
    const sine = Math.sin(item.angleRadians);
    const localAnchorMeters = { x: cosine * offsetX + sine * offsetY, y: -sine * offsetX + cosine * offsetY };
    const outcome = pullHandlers.start(item.entityId, localAnchorMeters, pointerWorld);

    if (outcome === "notRunning") {
      return false;
    }

    if (outcome === "started") {
      pullState = { entityId: item.entityId, pointerId: event.pointerId, localAnchorMeters, targetMeters: pointerWorld };
      resizeAndRender();
    }

    event.stopPropagation();
    return true;
  }

  // The ball moves only through the engine; here we just send the new target.
  function updatePull(event: FederatedPointerEvent): void {
    const pull = pullState;

    if (pull === null) {
      return;
    }

    if (labStore.getState().activeTool.kind !== "move" || (event.buttons & 1) === 0) {
      cancelActiveDrag();
      return;
    }

    pull.targetMeters = screenToWorld(event.global, getViewport());

    if (!pullHandlers.move(pull.targetMeters)) {
      pullState = null;
      pullHandlers.release();
    }

    resizeAndRender();
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

    if (activeTool.kind === "move" && !startPull(item, event)) {
      startDrag(item, event);
    }
  }

  function previewDrag(event: FederatedPointerEvent): void {
    if (pullState !== null && pullState.pointerId === event.pointerId) {
      updatePull(event);
      return;
    }

    if (dragState === null || dragState.pointerId !== event.pointerId) {
      return;
    }
    if (labStore.getState().activeTool.kind !== "move" || (event.buttons & 1) === 0) {
      cancelActiveDrag();
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
    // Ending a pull removes the force; the ball keeps moving.
    if (pullState !== null) {
      pullState = null;
      pullHandlers.release();
      resizeAndRender();
    }

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
    if (dragState?.pointerId === event.pointerId || pullState?.pointerId === event.pointerId) {
      cancelActiveDrag();
    }
  }
  function finishDrag(event: FederatedPointerEvent): void {
    if (pullState !== null && pullState.pointerId === event.pointerId) {
      cancelActiveDrag();
      return;
    }

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

  // Draw the selected object above the others, so a ball hidden under another ball shows when picked.
  function raiseSelected(): void {
    const item = renderItems.get(labStore.getState().selectedEntityId ?? "");

    if (!initialized || item === undefined) {
      return;
    }

    const overlayIndex = application.stage.getChildIndex(horizontalVelocityGraphic);
    application.stage.setChildIndex(item.graphic, overlayIndex - 1);
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

    raiseSelected();
  }

  function fitScene(): void {
    const bounds = new Bounds();
    const editorState = labStore.getState();
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
        // A long ground establishes height without shrinking the experiment, whatever its id.
        const groundPlane = entity.kind !== "target" && isGroundPlane(entity);
        include(pose.positionMeters.x, pose.positionMeters.y, groundPlane ? 0 : halfWidth, halfHeight);
      }
      if (entity.kind === "dynamic") {
        include(entity.pose.positionMeters.x, entity.pose.positionMeters.y);
      }
    }
    for (const sample of trailSamples) {
      for (const positionMeters of sample.positionsMeters.values()) {
        include(positionMeters.x, positionMeters.y);
      }
    }
    // Frame where each ball is going, so a launched ball starts near the left with room for its flight.
    for (const entity of currentScene.bodies) {
      if (entity.kind !== "dynamic") {
        continue;
      }

      const flightSeconds = idealLandingTimeSeconds(currentScene, entity);

      for (let index = 1; index <= 24; index += 1) {
        const point = idealPositionMeters(currentScene, entity, flightSeconds * index / 24);
        include(point.x, point.y, entity.shape.radiusMeters, entity.shape.radiusMeters);
      }
    }
    if (currentScene.bodies.length + currentScene.triggers.length === 0) {
      editorState.setCamera({ x: 0, y: 0 }, CAMERA_ZOOM.basePixelsPerMeter);
      return;
    }
    // Leave a margin around the frame, and never zoom in past the normal 100% scale.
    const scale = Math.max(.01, Math.min(
      CAMERA_ZOOM.basePixelsPerMeter,
      Math.max(1, application.screen.width * .8) / Math.max(1, bounds.width),
      Math.max(1, application.screen.height * .7) / Math.max(1, bounds.height),
    ));
    const center = {
      x: bounds.x + bounds.width / 2,
      // Reserve more room for the title/tools above the diagram.
      y: bounds.y + bounds.height / 2 + 25 / scale,
    };

    fittedCamera = { center, pixelsPerMeter: scale };
    labStore.getState().setCamera(center, scale);
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
    const minimumScale = CAMERA_ZOOM.minimumPercent / 100 * CAMERA_ZOOM.basePixelsPerMeter;
    const maximumScale = CAMERA_ZOOM.maximumPercent / 100 * CAMERA_ZOOM.basePixelsPerMeter;
    const scale = Math.max(minimumScale, Math.min(maximumScale, viewport.pixelsPerMeter * Math.exp(-delta * .001)));
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
      backgroundColor: sceneColors.paper,
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
    // Paths stay behind bodies; arrows and the pull line go above them.
    application.stage.addChild(
      trailGraphic, challengePathGraphic, predictionGraphic,
      horizontalVelocityGraphic, verticalVelocityGraphic, velocityGraphic, pullGraphic,
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
      host.focus({ preventScroll: true });
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

      placeObjectAt(screenToWorld(event.global, getViewport()));

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
    host.addEventListener("keydown", handleCanvasKey);
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
      if (state.selectedEntityId !== previousState.selectedEntityId) {
        raiseSelected();
      }
      if ((dragState !== null && state.selectedEntityId !== dragState.entityId) || (pullState !== null && state.selectedEntityId !== pullState.entityId)) {
        cancelActiveDrag();
      }

      if (
        state.cameraCenterWorldMeters !==
        previousState.cameraCenterWorldMeters ||
        state.pixelsPerMeter !== previousState.pixelsPerMeter ||
        state.pendingCameraView !== previousState.pendingCameraView ||
        state.selectedEntityId !== previousState.selectedEntityId ||
        state.activeTool !== previousState.activeTool ||
        state.overlayVisibility !== previousState.overlayVisibility ||
        state.challengeOverlay !== previousState.challengeOverlay
      ) {
        resizeAndRender();

        if (state.activeTool !== previousState.activeTool) {
          application.renderer.events.setCursor(background.cursor ?? "default");
        }
      }
    });
    updateSnapshot(currentSnapshot);
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
    host.removeEventListener("keydown", handleCanvasKey);
    window.removeEventListener("blur", cancelInteractions);
    stopPan();
    dragState = null;
    pullState = null;
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
      challengePathGraphic.destroy();
      pullGraphic.destroy();
      notebook.root.destroy({ children: true });
    }

    paperTexture?.destroy(true);
  }

  return {
    updateSnapshot,
    updateRunEvents,
    updateScene,
    dispose,
  };
}
