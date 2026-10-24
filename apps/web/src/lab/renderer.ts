import type {
  SceneDefinition,
  Snapshot,
  Vector2
} from "@eureka/contracts";

import {
  Application,
  Graphics
} from "pixi.js";

import {
  worldToScreen,
  type ViewportTransform
} from "./coordinates.js";
import { labStore } from "./store.js";

interface RenderItem {
  readonly graphic: Graphics;
  readonly positionMeters: Vector2;
  readonly angleRadians: number;
  readonly sourcePixelsPerMeter: number;
}

function createRenderItems(
  scene: SceneDefinition,
  snapshot: Snapshot,
  pixelsPerMeter: number
): readonly RenderItem[] {
  const items: RenderItem[] = [];

  for (const trigger of scene.triggers) {
    const radiusPixels =
      trigger.shape.radiusMeters * pixelsPerMeter;

    const graphic = new Graphics()
      .circle(0, 0, radiusPixels)
      .fill({
        alpha: 0.12,
        color: 0xfacc15
      })
      .stroke({
        color: 0xfacc15,
        width: 2
      });

    items.push({
      graphic,
      positionMeters: trigger.pose.positionMeters,
      angleRadians: trigger.pose.angleRadians,
      sourcePixelsPerMeter: pixelsPerMeter
    });
  }

  for (const body of scene.bodies) {
    const snapshotBody = snapshot.bodies.find(
      (candidate) => candidate.id === body.id
    );

    if (snapshotBody === undefined) {
      throw new Error(
        `Snapshot omitted scene body "${body.id}".`
      );
    }

    const graphic =
      body.kind === "dynamic"
        ? new Graphics()
          .circle(
            0,
            0,
            body.shape.radiusMeters *
            pixelsPerMeter
          )
          .fill({ color: 0x38bdf8 })
        : new Graphics()
          .rect(
            (-body.shape.widthMeters *
              pixelsPerMeter) /
            2,
            (-body.shape.heightMeters *
              pixelsPerMeter) /
            2,
            body.shape.widthMeters *
            pixelsPerMeter,
            body.shape.heightMeters *
            pixelsPerMeter
          )
          .fill({ color: 0x94a3b8 });

    items.push({
      graphic,
      positionMeters:
        snapshotBody.pose.positionMeters,
      angleRadians:
        snapshotBody.pose.angleRadians,
      sourcePixelsPerMeter: pixelsPerMeter
    });
  }

  return items;
}

export function mountLabRenderer(
  host: HTMLElement,
  scene: SceneDefinition,
  snapshot: Snapshot
): () => void {
  const application = new Application();
  let disposed = false;
  let initialized = false;
  let renderItems: readonly RenderItem[] = [];
  let unsubscribeFromStore:
    | (() => void)
    | undefined;

  const resizeAndRender = (): void => {
    const width = Math.max(1, host.clientWidth);
    const height = Math.max(1, host.clientHeight);

    application.renderer.resize(width, height);

    const editorState = labStore.getState();

    const viewport: ViewportTransform = {
      widthPixels: application.screen.width,
      heightPixels: application.screen.height,
      pixelsPerMeter: editorState.pixelsPerMeter,
      centerWorldMeters:
        editorState.cameraCenterWorldMeters
    };

    for (const item of renderItems) {
      const screenPosition = worldToScreen(
        item.positionMeters,
        viewport
      );

      item.graphic.position.set(
        screenPosition.x,
        screenPosition.y
      );
      item.graphic.scale.set(
        editorState.pixelsPerMeter /
          item.sourcePixelsPerMeter
      );
      item.graphic.rotation = -item.angleRadians;
    }

    application.render();
  };

  const initialize = async (): Promise<void> => {
    await application.init({
      antialias: true,
      autoDensity: true,
      autoStart: false,
      backgroundColor: 0x0f172a,
      height: Math.max(1, host.clientHeight),
      resolution: window.devicePixelRatio,
      width: Math.max(1, host.clientWidth)
    });

    initialized = true;

    if (disposed) {
      application.destroy(
        { removeView: true },
        { children: true }
      );
      return;
    }

    renderItems = createRenderItems(
      scene,
      snapshot,
      labStore.getState().pixelsPerMeter
    );

    application.stage.addChild(
      ...renderItems.map((item) => item.graphic)
    );

    // This host is dedicated to Pixi, so replacing its children enforces
    // one-canvas ownership even across development remounts.
    host.replaceChildren(application.canvas);
    window.addEventListener("resize", resizeAndRender);
    unsubscribeFromStore = labStore.subscribe(
      (state, previousState) => {
        if (
          state.cameraCenterWorldMeters !==
            previousState.cameraCenterWorldMeters ||
          state.pixelsPerMeter !==
            previousState.pixelsPerMeter
        ) {
          resizeAndRender();
        }
      }
    );
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
      application.destroy(
        { removeView: true },
        { children: true }
      );
    }
  };
}
