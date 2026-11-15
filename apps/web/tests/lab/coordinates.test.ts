// Supplies the test structure and assertions.
import { describe, expect, it } from "vitest";

import {
  screenToWorld,
  worldToScreen
} from "../../src/lab/coordinates.js";

const VIEWPORT = {
  widthPixels: 800,
  heightPixels: 600,
  pixelsPerMeter: 40,
  centerWorldMeters: {
    x: 2,
    y: -1
  }
} as const;

describe("world/screen coordinate mapping", () => {
  it("maps the camera center and positive world axes", () => {
    expect(
      worldToScreen(
        VIEWPORT.centerWorldMeters,
        VIEWPORT
      )
    ).toEqual({
      x: 400,
      y: 300
    });

    expect(
      worldToScreen(
        {
          x: 3,
          y: -1
        },
        VIEWPORT
      )
    ).toEqual({
      x: 440,
      y: 300
    });

    expect(
      worldToScreen(
        {
          x: 2,
          y: 0
        },
        VIEWPORT
      )
    ).toEqual({
      x: 400,
      y: 260
    });
  });

  it("round-trips an off-center world point", () => {
    const worldPoint = {
      x: 5,
      y: 3
    };

    const screenPoint = worldToScreen(
      worldPoint,
      VIEWPORT
    );

    expect(screenPoint).toEqual({
      x: 520,
      y: 140
    });

    expect(
      screenToWorld(screenPoint, VIEWPORT)
    ).toEqual(worldPoint);
  });
});
