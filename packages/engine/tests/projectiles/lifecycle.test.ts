import { describe, expect, it } from "vitest";
import type {
  Command,
  SceneDefinition,
  Snapshot,
  StaticBody,
  TargetTrigger
} from "@eureka/contracts";
import { createEngine } from "../../src/index.js";
import { unwrap } from "../test-support.js";
import { makeScene } from "./scene-fixtures.js";
import { expectFiniteSnapshot } from "./projectile-test-support.js";

// Reuse one editor-like command history in both independent engine runs.
const repeatedCommands: readonly Command[] = [
  {
    commandVersion: 1,
    id: "scheduled-launch",
    targetTick: 2,
    payload: {
      kind: "launchBody",
      bodyId: "projectile",
      positionMeters: { x: 1, y: 3 },
      velocity: {
        linearMetersPerSecond: { x: 6, y: 8 },
        angularRadiansPerSecond: 0
      }
    }
  },
  {
    commandVersion: 1,
    id: "scheduled-velocity-edit",
    targetTick: 5,
    payload: {
      kind: "editBody",
      bodyId: "projectile",
      changes: {
        velocity: {
          linearMetersPerSecond: { x: 5, y: 2 },
          angularRadiansPerSecond: 0
        }
      }
    }
  }
];

// Copy every public tick so exact repeatability includes intermediate states,
// events and diagnostics rather than only a final position.
function copyPublicHistory(
  scene: SceneDefinition,
  terminalTick: number,
  commands: readonly Command[] = []
): Snapshot[] {
  const engine = unwrap(createEngine(scene));

  try {
    for (const command of commands) {
      unwrap(engine.enqueue(command));
    }

    const history: Snapshot[] = [];

    for (let tick = 0; tick <= terminalTick; tick += 1) {
      const snapshot = unwrap(engine.copySnapshot());

      expect(snapshot.tick).toBe(tick);
      expectFiniteSnapshot(snapshot);
      history.push(snapshot);

      if (tick < terminalTick) {
        unwrap(engine.advance(1));
      }
    }

    return history;
  } finally {
    expect(engine.dispose().ok).toBe(true);
  }
}

const inclineAngleRadians = Math.PI / 12;
const inclineTargetX =
  100 * (1 - Math.tan(inclineAngleRadians)) / 9.81;
const inclineTarget: TargetTrigger = {
  id: "repeatability-incline-target",
  kind: "target",
  shape: { kind: "circle", radiusMeters: 0.2 },
  pose: {
    positionMeters: {
      x: inclineTargetX,
      y: inclineTargetX * Math.tan(inclineAngleRadians)
    },
    angleRadians: 0
  }
};
const inclineRampThickness = 0.2;
const inclineRamp: StaticBody = {
  id: "repeatability-incline-ramp",
  kind: "static",
  shape: {
    kind: "box",
    widthMeters: 12,
    heightMeters: inclineRampThickness
  },
  material: { restitution: 0 },
  pose: {
    positionMeters: {
      x: 10 + 0.5 * inclineRampThickness * Math.sin(inclineAngleRadians),
      y:
        10 * Math.tan(inclineAngleRadians) -
        0.5 * inclineRampThickness * Math.cos(inclineAngleRadians)
    },
    angleRadians: inclineAngleRadians
  }
};

// One representative from every mandatory scenario group freezes complete
// same-runtime histories while the behavior-specific suites protect variants.
const repeatabilityScenes = [
  {
    name: "reference ideal launch",
    scene: makeScene(20, 30, 0, true),
    terminalTick: 130
  },
  {
    name: "linear-drag launch",
    scene: makeScene(20, 30, 0, false, {
      linearDragKilogramsPerSecond: 0.1
    }),
    terminalTick: 60
  },
  {
    name: "horizontal cliff launch",
    scene: makeScene(10, 0, 20, true),
    terminalTick: 125
  },
  {
    name: "angle-sweep launch",
    scene: makeScene(20, 45, 0, true),
    terminalTick: 180
  },
  {
    name: "complementary-angle launch",
    scene: makeScene(20, 60, 0, true),
    terminalTick: 215
  },
  {
    name: "incline target and surface launch",
    scene: makeScene(10, 45, 0, false, {
      triggers: [inclineTarget],
      surfaces: [inclineRamp]
    }),
    terminalTick: 73
  }
] as const;

describe("projectile lifecycle", () => {
  // Compare complete public histories, not only their final positions.
  it.each([0, 0.1])(
    "repeats the same command history exactly with drag %s kg/s",
    (drag) => {
      const scene = makeScene(5, 0, 0, true, {
        linearDragKilogramsPerSecond: drag
      });
      const firstRun = copyPublicHistory(scene, 8, repeatedCommands);
      const secondRun = copyPublicHistory(scene, 8, repeatedCommands);

      expect(secondRun).toEqual(firstRun);
    }
  );

  // Each row is a separate case, so one unsupported capability does not hide
  // repeatability evidence for the other mandatory scenario groups.
  it.each(repeatabilityScenes)(
    "repeats every finite public tick for the $name",
    ({ scene, terminalTick }) => {
      const firstRun = copyPublicHistory(scene, terminalTick);
      const secondRun = copyPublicHistory(scene, terminalTick);

      expect(secondRun).toEqual(firstRun);
    }
  );
});
