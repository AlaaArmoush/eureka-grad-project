import { Application } from "pixi.js";
import { Graphics } from "pixi.js";

export function mountPixiCircle(host: HTMLElement): () => void {
  const application = new Application();
  let disposed = false;
  let initialized = false;

  const resizeAndRender = (): void => {
    const width = Math.max(1, host.clientWidth);
    const height = Math.max(1, host.clientHeight);

    application.renderer.resize(width, height);

    const circle = application.stage.children[0];

    if (circle !== undefined) {
      circle.position.set(
        application.screen.width / 2,
        application.screen.height / 2
      );
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

    const circle = new Graphics()
      .circle(0, 0, 48)
      .fill({ color: 0x38bdf8 });

    application.stage.addChild(circle);

    // This host is dedicated to Pixi, so replacing its children enforces
    // one-canvas ownership even across development remounts.
    host.replaceChildren(application.canvas);
    window.addEventListener("resize", resizeAndRender);
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

    if (initialized) {
      application.ticker.stop();
      application.destroy(
        { removeView: true },
        { children: true }
      );
    }
  };
}
