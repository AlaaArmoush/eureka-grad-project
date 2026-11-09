import { describe, expect, it } from "vitest";
import type { Command, Snapshot } from "@eureka/contracts";
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

describe("projectile lifecycle", () => {
  // Compare complete public histories, not only their final positions.
  it.each([0, 0.1])(
    "repeats the same command history exactly with drag %s kg/s",
    (drag) => {
      function runSequence(): Snapshot[] {
        const engine = unwrap(
          createEngine(
            makeScene(5, 0, 0, true, {
              linearDragKilogramsPerSecond: drag
            })
          )
        );

        try {
          for (const command of repeatedCommands) {
            unwrap(engine.enqueue(command));
          }

          const history: Snapshot[] = [];

          for (let tick = 0; tick <= 8; tick += 1) {
            const snapshot = unwrap(engine.copySnapshot());

            expect(snapshot.tick).toBe(tick);
            expectFiniteSnapshot(snapshot);
            history.push(snapshot);

            if (tick < 8) {
              unwrap(engine.advance(1));
            }
          }

          return history;
        } finally {
          expect(engine.dispose().ok).toBe(true);
        }
      }

      const firstRun = runSequence();
      const secondRun = runSequence();

      expect(secondRun).toEqual(firstRun);
    }
  );
});
