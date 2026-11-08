import type { SceneDefinition, Snapshot, Vector2 } from "@eureka/contracts";

import { Application, Graphics, Container, Text } from "pixi.js";

import { worldToScreen, type ViewportTransform } from "./coordinates.js";
import { labStore } from "./store.js";
import { OutlineFilter } from "pixi-filters";

interface RenderItem {
  readonly graphic: Container;
  readonly positionMeters: Vector2;
  readonly angleRadians: number;
  readonly sourcePixelsPerMeter: number;
  readonly entityId: string;
  readonly selectionGraphic: Container;
}

function createRenderItems(
  scene: SceneDefinition,
  snapshot: Snapshot,
  pixelsPerMeter: number,
): readonly RenderItem[] {
  const items: RenderItem[] = [];

  for (const trigger of scene.triggers) {
    const radiusPixels = trigger.shape.radiusMeters * pixelsPerMeter;

    const hasTargetEntered: boolean = snapshot.events.some((event) => {
      return (
        event.kind === "targetEntered" &&
        event.targetId === trigger.id &&
        event.tick === snapshot.tick
      );
    });
    const targetColor = hasTargetEntered ? 0x16776e : 0x9a6700;

    const graphic = new Container();

    const ring = new Graphics()
      .circle(0, 0, radiusPixels)
      .fill({
        alpha: hasTargetEntered ? 0.16 : 0.08,
        color: targetColor,
      })
      .stroke({
        color: targetColor,
        width: 2,
      });

    const centreMarker = new Graphics()
      .circle(0, 0, 2)
      .fill({ color: targetColor });

    const label = new Text({
      text: hasTargetEntered ? "Target Entered" : "Target",
      style: {
        fontFamily: "Inter, system-ui, sans-serif",
        fontSize: 12,
        fontWeight: "500",
        fill: targetColor,
      },
    });

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
    });
  }

  for (const body of scene.bodies) {
    const snapshotBody = snapshot.bodies.find(
      (candidate) => candidate.id === body.id,
    );

    if (snapshotBody === undefined) {
      throw new Error(`Snapshot omitted scene body "${body.id}".`);
    }

    const graphic =
      body.kind === "dynamic"
        ? new Graphics()
            .circle(0, 0, body.shape.radiusMeters * pixelsPerMeter)
            .fill({ color: 0x38bdf8 })
        : new Graphics()
            .rect(
              (-body.shape.widthMeters * pixelsPerMeter) / 2,
              (-body.shape.heightMeters * pixelsPerMeter) / 2,
              body.shape.widthMeters * pixelsPerMeter,
              body.shape.heightMeters * pixelsPerMeter,
            )
            .fill({ color: 0x57564d })
            .stroke({ color: 0x302f29, width: 1 });
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
    });
  }

  return items;
}

export function mountLabRenderer(
  host: HTMLElement,
  scene: SceneDefinition,
  snapshot: Snapshot,
): () => void {
  const application = new Application();
  let disposed = false;
  let initialized = false;
  let renderItems: readonly RenderItem[] = [];
  let unsubscribeFromStore: (() => void) | undefined;
  const selectedFilter = new OutlineFilter({
    color: 0xf26b2a,
    thickness: 2,
    alpha: 1,
    quality: 0.8,
  });
  const resizeAndRender = (): void => {
    const width = Math.max(1, host.clientWidth);
    const height = Math.max(1, host.clientHeight);

    application.renderer.resize(width, height);

    const editorState = labStore.getState();

    const viewport: ViewportTransform = {
      widthPixels: application.screen.width,
      heightPixels: application.screen.height,
      pixelsPerMeter: editorState.pixelsPerMeter,
      centerWorldMeters: editorState.cameraCenterWorldMeters,
    };

    for (const item of renderItems) {
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

  const initialize = async (): Promise<void> => {
    await application.init({
      antialias: true,
      autoDensity: true,
      autoStart: false,
      backgroundColor: 0xf5f0e4,
      height: Math.max(1, host.clientHeight),
      resolution: window.devicePixelRatio,
      width: Math.max(1, host.clientWidth),
    });

    initialized = true;

    if (disposed) {
      application.destroy({ removeView: true }, { children: true });
      return;
    }

    renderItems = createRenderItems(
      scene,
      snapshot,
      labStore.getState().pixelsPerMeter,
    );

    application.stage.addChild(...renderItems.map((item) => item.graphic));

    // This host is dedicated to Pixi, so replacing its children enforces
    // one-canvas ownership even across development remounts.
    host.replaceChildren(application.canvas);
    window.addEventListener("resize", resizeAndRender);
    unsubscribeFromStore = labStore.subscribe((state, previousState) => {
      if (
        state.cameraCenterWorldMeters !==
          previousState.cameraCenterWorldMeters ||
        state.pixelsPerMeter !== previousState.pixelsPerMeter ||
        state.selectedEntityId !== previousState.selectedEntityId
      ) {
        resizeAndRender();
      }
    });
    resizeAndRender();
  };

  void initialize().catch((error: unknown) => {
    if (!disposed) {
      console.error("Failed to initialize the Pixi canvas.", error);
    }
  });

  return () => {
    disposed = true;
    window.removeEventListener("resize", resizeAndRender);
    unsubscribeFromStore?.();

    if (initialized) {
      application.ticker.stop();
      application.destroy({ removeView: true }, { children: true });
    }
    selectedFilter.destroy();
  };
}
