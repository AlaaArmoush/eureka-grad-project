import { expect, it, vi } from "vitest";
import type { Snapshot } from "@eureka/contracts";
import type { Engine, EngineResult } from "@eureka/engine";
import { createLabController, type LabController, type PlaybackBrowser, type PlaybackState } from "../../src/lab/controller.js";
import { PROJECTILE_LAB_MOCK } from "../../src/lab/mocks.js";
import {
  DEFAULT_PROJECTILE_PROPERTIES, DEFAULT_RAMP_PROPERTIES, DEFAULT_TARGET_PROPERTIES,
} from "../../src/lab/authoring.js";

function createPlaybackHarness(playbackBrowser?: PlaybackBrowser, stopAtTick?: number) {
  let nowMilliseconds = 0;
  let tick = 0;
  const scene = structuredClone(PROJECTILE_LAB_MOCK.scene);
  const snapshotCandidate = PROJECTILE_LAB_MOCK.trailSnapshots[0];
  const publishedSnapshots: Snapshot[] = [];
  const readouts: Snapshot[] = [];

  if (snapshotCandidate === undefined) {
    throw new Error("The reviewed mock must supply its initial snapshot.");
  }

  // Capture the checked fixture with a definite type for later snapshot reads.
  const initialSnapshot: Snapshot = snapshotCandidate;

  // Report counter metadata without calculating any physical motion.
  function readSnapshot(): EngineResult<Snapshot> {
    return {
      ok: true,
      value: {
        ...structuredClone(initialSnapshot),
        tick,
        simulationTimeSeconds: tick * scene.numericalProfile.fixedTimeStepSeconds,
      },
    };
  }

  // Implement only the public engine operations needed by this controller.
  const engine = {
    enqueue: vi.fn<Engine["enqueue"]>(() => ({ ok: true, value: { sequence: 0 } })),
    advance: vi.fn<Engine["advance"]>((tickCount) => {
      tick += tickCount;
      return { ok: true, value: { lastValidTick: tick } };
    }),
    getSnapshot: vi.fn(readSnapshot),
    copySnapshot: vi.fn(readSnapshot),
    reset: vi.fn<Engine["reset"]>(() => {
      tick = 0;
      return { ok: true };
    }),
    dispose: vi.fn<Engine["dispose"]>(() => ({ ok: true })),
  } satisfies Engine;

  const releaseView = vi.fn();
  const onPlaybackChange = vi.fn<(state: PlaybackState) => void>();
  const result = createLabController({
    engine,
    initialScene: scene,
    consumeSnapshot: (snapshot) => publishedSnapshots.push(structuredClone(snapshot)),
    consumeReadout: (snapshot) => readouts.push(snapshot),
    releaseView,
    nowMilliseconds: () => nowMilliseconds,
    playbackBrowser,
    onPlaybackChange,
    stopAtTick,
  });

  if (!result.ok) {
    throw new Error("The counter controller could not be created.");
  }

  const controller = result.value;

  return {
    controller,
    engine,
    publishedSnapshots,
    readouts,
    releaseView,
    onPlaybackChange,
    setTime(timeMilliseconds: number): void {
      nowMilliseconds = timeMilliseconds;
    },
    frameAt(timeMilliseconds: number) {
      nowMilliseconds = timeMilliseconds;
      return controller.advanceFrame();
    },
  };
}

function createBrowserHarness(initiallyHidden = false, stopAtTick?: number) {
  let hidden = initiallyHidden;
  let nextFrameHandle = 1;
  const pendingFrames = new Map<number, () => void>();
  const visibilityListeners = new Set<() => void>();

  const browser: PlaybackBrowser = {
    // Retain a requested callback until a test runs or cancels it.
    requestFrame(callback) {
      const handle = nextFrameHandle;
      nextFrameHandle += 1;
      pendingFrames.set(handle, callback);
      return handle;
    },

    cancelFrame(handle) {
      pendingFrames.delete(handle);
    },

    isHidden: () => hidden,

    // Track subscriptions so tests can prove that disposal removes them.
    subscribeVisibilityChange(listener) {
      visibilityListeners.add(listener);
      return () => {
        visibilityListeners.delete(listener);
      };
    },

    onFrameResult: vi.fn<PlaybackBrowser["onFrameResult"]>(),
  };

  const h = createPlaybackHarness(browser, stopAtTick);

  return {
    ...h,
    browser,
    pendingFrameCount: () => pendingFrames.size,
    visibilityListenerCount: () => visibilityListeners.size,

    // Deliver the same visibility event that the browser adapter subscribes to.
    setHidden(nextHidden: boolean): void {
      hidden = nextHidden;

      for (const listener of visibilityListeners) {
        listener();
      }
    },

    // Run callbacks already pending, leaving newly requested callbacks for the next frame.
    runFrameAt(timeMilliseconds: number): void {
      h.setTime(timeMilliseconds);
      const callbacks = Array.from(pendingFrames.values());
      pendingFrames.clear();

      for (const callback of callbacks) {
        callback();
      }
    },
  };
}


// Protect paused Step semantics and reject manual steps during playback.
it("steps once while paused and rejects stepping while playing", () => {
  const h = createPlaybackHarness();

  expect(h.frameAt(1000)).toEqual({ ok: true });
  expect(h.engine.advance).not.toHaveBeenCalled();

  expect(h.controller.stepOnce()).toEqual({ ok: true, value: { lastValidTick: 1 } });
  expect(h.controller.getPlaybackState().playing).toBe(false);

  expect(h.controller.play()).toEqual({ ok: true });
  expect(h.controller.stepOnce().ok).toBe(false);
  expect(h.engine.advance).toHaveBeenCalledExactlyOnceWith(1);
});

// Protect the 60 Hz profile and consecutive publication of every accepted tick.
it("runs sixty whole ticks over ten normal callbacks", () => {
  const h = createPlaybackHarness();
  h.controller.play();

  for (let frame = 1; frame <= 10; frame += 1) {
    expect(h.frameAt(frame * 100)).toEqual({ ok: true });
  }

  expect(h.engine.advance).toHaveBeenCalledTimes(60);
  expect(h.engine.advance.mock.calls.every(([count]) => count === 1)).toBe(true);
  expect(h.publishedSnapshots.map((snapshot) => snapshot.tick)).toEqual(
    Array.from({ length: 61 }, (_, tick) => tick),
  );
});

// Protect fractional carry, then prove paused time and old fractions are discarded.
it("retains fractional time until paused and resumes from a fresh baseline", () => {
  const h = createPlaybackHarness();
  h.controller.play();

  h.frameAt(8);
  expect(h.engine.advance).not.toHaveBeenCalled();

  h.frameAt(20);
  expect(h.engine.advance).toHaveBeenCalledTimes(1);

  h.frameAt(28);
  expect(h.engine.advance).toHaveBeenCalledTimes(1);

  h.controller.pause();
  h.frameAt(5000);
  expect(h.engine.advance).toHaveBeenCalledTimes(1);

  h.controller.play();
  h.frameAt(5010);
  expect(h.engine.advance).toHaveBeenCalledTimes(1);

  h.frameAt(5020);
  expect(h.engine.advance).toHaveBeenCalledTimes(2);
});

// Check each approved speed against its independently expected whole-tick count.
it.each([
  { speed: 0.25, expectedTicks: 1 },
  { speed: 0.5, expectedTicks: 3 },
  { speed: 1, expectedTicks: 6 },
  { speed: 2, expectedTicks: 12 },
  { speed: 4, expectedTicks: 24 },
] as const)("runs $expectedTicks ticks over 100 ms at speed $speed", ({ speed, expectedTicks }) => {
  const h = createPlaybackHarness();
  const originalProfile = h.controller.copyScene().numericalProfile;

  expect(h.controller.setSpeed(speed)).toEqual({ ok: true });
  h.controller.play();
  h.frameAt(50);
  h.frameAt(100);

  expect(h.engine.advance).toHaveBeenCalledTimes(expectedTicks);
  expect(h.engine.advance.mock.calls.every(([count]) => count === 1)).toBe(true);
  expect(h.controller.copyScene().numericalProfile).toEqual(originalProfile);
});

// Prevent elapsed time accumulated at one speed from being reused at another.
it("clears fractional debt and refreshes the baseline when speed changes", () => {
  const h = createPlaybackHarness();
  h.controller.play();
  h.frameAt(10);

  expect(h.controller.setSpeed(2)).toEqual({ ok: true });
  h.frameAt(14);
  expect(h.engine.advance).not.toHaveBeenCalled();

  h.frameAt(20);
  expect(h.engine.advance).toHaveBeenCalledExactlyOnceWith(1);
});

// Accept only 250 ms from a one-second callback and discard the remaining wall time.
it("caps elapsed browser time and reports the discarded interval", () => {
  const h = createPlaybackHarness();
  h.controller.play();
  h.frameAt(1000);

  expect(h.engine.advance).toHaveBeenCalledTimes(15);
  expect(h.controller.getPlaybackState().unableToMaintainRealTimeSpeed).toBe(true);
  expect(h.controller.getPlaybackState().droppedWallTimeSeconds).toBeCloseTo(0.75, 12);

  h.frameAt(1005);
  expect(h.engine.advance).toHaveBeenCalledTimes(15);
  expect(h.controller.getPlaybackState().unableToMaintainRealTimeSpeed).toBe(false);
});

// Run sixteen ticks, discard excess whole-tick debt and retain its fractional remainder.
it("bounds catch-up without skipping tick IDs or losing the fractional remainder", () => {
  const h = createPlaybackHarness();
  h.controller.setSpeed(4);
  h.controller.play();
  h.frameAt(240);

  expect(h.engine.advance).toHaveBeenCalledTimes(16);
  expect(h.controller.getPlaybackState().unableToMaintainRealTimeSpeed).toBe(true);
  expect(h.controller.getPlaybackState().droppedWallTimeSeconds).toBeCloseTo(41 / 240, 12);
  expect(h.publishedSnapshots.map((snapshot) => snapshot.tick)).toEqual(
    Array.from({ length: 17 }, (_, tick) => tick),
  );

  h.frameAt(241);
  expect(h.engine.advance).toHaveBeenCalledTimes(16);

  h.frameAt(242);
  expect(h.engine.advance).toHaveBeenCalledTimes(17);
});

// Reset the engine once, publish tick zero and discard the previous run's timing debt.
it("resets into a paused run while keeping the chosen speed", () => {
  const h = createPlaybackHarness();
  h.controller.setSpeed(4);
  h.controller.play();
  h.frameAt(240);

  expect(h.controller.reset()).toEqual({ ok: true });
  expect(h.engine.reset).toHaveBeenCalledTimes(1);
  expect(h.publishedSnapshots.at(-1)?.tick).toBe(0);
  expect(h.controller.getPlaybackState()).toEqual({
    playing: false,
    speed: 4,
    unableToMaintainRealTimeSpeed: false,
    droppedWallTimeSeconds: 0,
  });

  h.frameAt(10000);
  h.controller.play();
  h.frameAt(10002);
  expect(h.engine.advance).toHaveBeenCalledTimes(16);
});

// Stop the callback immediately when the engine rejects a tick.
it("pauses after a failed tick without publishing an unaccepted snapshot", () => {
  const h = createPlaybackHarness();
  h.engine.advance.mockReturnValueOnce({
    ok: false,
    diagnostics: [{
      code: "NONFINITE_STATE",
      path: "bodies",
      message: "Counter test rejection.",
    }],
  });

  h.controller.play();

  expect(h.frameAt(100).ok).toBe(false);
  expect(h.engine.advance).toHaveBeenCalledTimes(1);
  expect(h.controller.getPlaybackState().playing).toBe(false);
  expect(h.publishedSnapshots).toHaveLength(1);
});

// Release owned resources once and reject subsequent playback attempts.
it("stops playback and releases resources exactly once on disposal", () => {
  const h = createPlaybackHarness();
  h.controller.play();

  expect(h.controller.dispose()).toEqual({ ok: true });
  expect(h.controller.dispose()).toEqual({ ok: true });
  expect(h.controller.getPlaybackState().playing).toBe(false);
  expect(h.frameAt(100).ok).toBe(false);
  expect(h.controller.play().ok).toBe(false);
  expect(h.controller.stepOnce().ok).toBe(false);
  expect(h.engine.advance).not.toHaveBeenCalled();
  expect(h.engine.dispose).toHaveBeenCalledTimes(1);
  expect(h.releaseView).toHaveBeenCalledTimes(1);
});

// Keep one callback while playing and remove pending work on Pause or Reset.
it("owns one callback and cancels it when paused or reset", () => {
  const h = createBrowserHarness();

  expect(h.pendingFrameCount()).toBe(0);

  h.controller.play();
  h.controller.play();
  expect(h.pendingFrameCount()).toBe(1);

  h.runFrameAt(20);
  expect(h.engine.advance).toHaveBeenCalledExactlyOnceWith(1);
  expect(h.pendingFrameCount()).toBe(1);

  h.controller.pause();
  expect(h.pendingFrameCount()).toBe(0);

  h.runFrameAt(1000);
  expect(h.engine.advance).toHaveBeenCalledTimes(1);

  h.controller.play();
  expect(h.pendingFrameCount()).toBe(1);

  h.controller.reset();
  expect(h.pendingFrameCount()).toBe(0);
  expect(h.publishedSnapshots.at(-1)?.tick).toBe(0);
});

// Discard partial elapsed time and the entire hidden interval without automatic resume.
it("stays paused after a hidden interval and resumes from a fresh baseline", () => {
  const h = createBrowserHarness();
  h.controller.play();
  h.runFrameAt(8);

  h.setHidden(true);
  expect(h.controller.getPlaybackState().playing).toBe(false);
  expect(h.pendingFrameCount()).toBe(0);

  h.runFrameAt(60008);
  h.setHidden(false);
  expect(h.controller.getPlaybackState().playing).toBe(false);
  expect(h.pendingFrameCount()).toBe(0);
  expect(h.engine.advance).not.toHaveBeenCalled();

  h.controller.play();
  h.runFrameAt(60018);
  expect(h.engine.advance).not.toHaveBeenCalled();

  h.runFrameAt(60028);
  expect(h.engine.advance).toHaveBeenCalledExactlyOnceWith(1);
});

// Refuse playback when the controller is created on an already hidden page.
it("rejects Play while hidden and waits for an explicit Play after returning", () => {
  const h = createBrowserHarness(true);

  expect(h.controller.play().ok).toBe(false);
  expect(h.pendingFrameCount()).toBe(0);

  h.setHidden(false);
  expect(h.controller.getPlaybackState().playing).toBe(false);
  expect(h.pendingFrameCount()).toBe(0);

  expect(h.controller.play()).toEqual({ ok: true });
  expect(h.pendingFrameCount()).toBe(1);
});

// Release browser activity regardless of whether the existing view is retained.
it.each([false, true])("cleans up browser activity with preserveView=%s", (preserveView) => {
  const h = createBrowserHarness();
  h.controller.play();

  expect(h.pendingFrameCount()).toBe(1);
  expect(h.visibilityListenerCount()).toBe(1);

  h.controller.dispose({ preserveView });
  h.controller.dispose({ preserveView });

  expect(h.pendingFrameCount()).toBe(0);
  expect(h.visibilityListenerCount()).toBe(0);
  expect(h.engine.dispose).toHaveBeenCalledTimes(1);
  expect(h.releaseView).toHaveBeenCalledTimes(preserveView ? 0 : 1);

  h.runFrameAt(1000);
  h.setHidden(true);
  expect(h.engine.advance).not.toHaveBeenCalled();
});

// Report a failed scheduled tick and leave no callback waiting to retry it.
it("stops scheduling after a failed tick and reports the failure to the host", () => {
  const h = createBrowserHarness();
  h.engine.advance.mockReturnValueOnce({
    ok: false,
    diagnostics: [{
      code: "NONFINITE_STATE",
      path: "bodies",
      message: "Counter test rejection.",
    }],
  });

  h.controller.play();
  h.runFrameAt(20);

  expect(h.engine.advance).toHaveBeenCalledTimes(1);
  expect(h.controller.getPlaybackState().playing).toBe(false);
  expect(h.pendingFrameCount()).toBe(0);
  expect(h.browser.onFrameResult).toHaveBeenCalledWith(
    expect.objectContaining({ ok: false }),
  );
});

// Give the toolbar its initial state and each changed control value without duplicate notifications.
it("reports initial playback state and changed controls", () => {
  const h = createPlaybackHarness();

  expect(h.onPlaybackChange).toHaveBeenCalledExactlyOnceWith({
    playing: false,
    speed: 1,
    unableToMaintainRealTimeSpeed: false,
    droppedWallTimeSeconds: 0,
  });

  h.controller.play();
  h.controller.play();
  h.controller.setSpeed(2);
  h.controller.setSpeed(2);
  h.controller.pause();
  h.controller.pause();

  const reportedControls = h.onPlaybackChange.mock.calls.map(([state]) => ({
    playing: state.playing,
    speed: state.speed,
  }));
  expect(reportedControls).toEqual([
    { playing: false, speed: 1 },
    { playing: true, speed: 1 },
    { playing: true, speed: 2 },
    { playing: false, speed: 2 },
  ]);
});

// Ordinary frame callbacks must not notify React when playback metadata has not changed.
it("does not repeat playback notifications during ordinary frames", () => {
  const h = createPlaybackHarness();
  h.controller.play();

  for (const timeMilliseconds of [10, 20, 30, 40]) {
    expect(h.frameAt(timeMilliseconds)).toEqual({ ok: true });
  }

  expect(h.onPlaybackChange).toHaveBeenCalledTimes(2);
});

// Report dropped wall time, clear the warning on recovery and clear the run's ledger on reset.
it("reports slow callbacks, recovery and reset to the toolbar", () => {
  const h = createPlaybackHarness();
  h.controller.play();
  h.frameAt(1000);

  expect(h.onPlaybackChange).toHaveBeenLastCalledWith({
    playing: true,
    speed: 1,
    unableToMaintainRealTimeSpeed: true,
    droppedWallTimeSeconds: 0.75,
  });

  h.frameAt(1005);
  expect(h.onPlaybackChange).toHaveBeenLastCalledWith({
    playing: true,
    speed: 1,
    unableToMaintainRealTimeSpeed: false,
    droppedWallTimeSeconds: 0.75,
  });

  h.controller.reset();
  expect(h.onPlaybackChange).toHaveBeenLastCalledWith({
    playing: false,
    speed: 1,
    unableToMaintainRealTimeSpeed: false,
    droppedWallTimeSeconds: 0,
  });
});

// Notify the toolbar about an automatic hidden-page pause without pretending return means Play.
it("reports a visibility pause without reporting an automatic resume", () => {
  const h = createBrowserHarness();
  h.controller.play();
  h.setHidden(true);

  expect(h.onPlaybackChange.mock.calls.map(([state]) => state.playing)).toEqual([false, true, false]);

  const notificationCount = h.onPlaybackChange.mock.calls.length;
  h.setHidden(false);
  expect(h.onPlaybackChange).toHaveBeenCalledTimes(notificationCount);
});

// An engine rejection must publish the paused state as well as stop the scheduler.
it("reports the pause caused by a rejected scheduled tick", () => {
  const h = createBrowserHarness();
  h.engine.advance.mockReturnValueOnce({
    ok: false,
    diagnostics: [{ code: "NONFINITE_STATE", path: "bodies", message: "Counter test rejection." }],
  });

  h.controller.play();
  h.runFrameAt(20);

  expect(h.onPlaybackChange.mock.calls.map(([state]) => state.playing)).toEqual([false, true, false]);
  expect(h.pendingFrameCount()).toBe(0);
});

// Deliver every accepted tick to drawing, but send HTML only the latest tick at 100 ms intervals.
it("bounds running readouts to ten updates per second without dropping drawing snapshots", () => {
  const h = createPlaybackHarness();
  h.controller.play();

  for (const timeMilliseconds of [50, 100, 150, 200]) {
    expect(h.frameAt(timeMilliseconds)).toEqual({ ok: true });
  }

  expect(h.readouts.map((snapshot) => snapshot.tick)).toEqual([0, 6, 12]);
  expect(h.publishedSnapshots.map((snapshot) => snapshot.tick)).toEqual(
    Array.from({ length: 13 }, (_, tick) => tick),
  );
});

// Manual actions must show their exact accepted tick even within the running readout interval.
it("flushes readouts on Pause, Step and Reset while retaining editor scene and view ownership", () => {
  const h = createPlaybackHarness();
  const startingScene = h.controller.copyScene();
  h.controller.play();
  h.frameAt(50);
  expect(h.readouts.at(-1)?.tick).toBe(0);

  h.controller.pause();
  expect(h.readouts.at(-1)?.tick).toBe(3);

  h.setTime(51);
  h.controller.stepOnce();
  expect(h.readouts.at(-1)?.tick).toBe(4);

  h.controller.reset();
  expect(h.readouts.at(-1)?.tick).toBe(0);
  expect(h.controller.copyScene()).toEqual(startingScene);
  expect(h.releaseView).not.toHaveBeenCalled();
});

// Retained HTML state must be an owned copy rather than the engine's expiring snapshot view.
it("copies snapshots before delivering retained HTML readouts", () => {
  const h = createPlaybackHarness();
  h.controller.stepOnce();
  const lastSnapshotCall = h.engine.getSnapshot.mock.results.at(-1);

  if (lastSnapshotCall === undefined || lastSnapshotCall.type !== "return" || !lastSnapshotCall.value.ok) {
    throw new Error("The counter engine must supply the accepted snapshot.");
  }

  expect(h.readouts.at(-1)).toEqual(lastSnapshotCall.value.value);
  expect(h.readouts.at(-1)).not.toBe(lastSnapshotCall.value.value);
});

// Closing the controller must not send a final measurement update to its detached HTML consumer.
it("does not publish readouts during or after disposal", () => {
  const h = createPlaybackHarness();
  h.controller.play();
  h.frameAt(20);
  const readoutCount = h.readouts.length;

  h.controller.dispose();
  h.frameAt(1000);
  h.controller.pause();

  expect(h.readouts).toHaveLength(readoutCount);
});

// A finite sample must stop on its last accepted tick, even during a longer catch-up callback.
it("pauses at a finite sample boundary without an extra engine call", () => {
  const h = createBrowserHarness(false, 3);
  h.controller.play();
  h.runFrameAt(100);

  expect(h.engine.advance).toHaveBeenCalledTimes(3);
  expect(h.engine.advance.mock.calls.every(([count]) => count === 1)).toBe(true);
  expect(h.controller.getPlaybackState().playing).toBe(false);
  expect(h.pendingFrameCount()).toBe(0);
  expect(h.readouts.at(-1)?.tick).toBe(3);
  expect(h.controller.play().ok).toBe(false);
  expect(h.controller.stepOnce().ok).toBe(false);
  expect(h.engine.advance).toHaveBeenCalledTimes(3);

  h.controller.reset();
  expect(h.readouts.at(-1)?.tick).toBe(0);
  expect(h.controller.play()).toEqual({ ok: true });
  expect(h.pendingFrameCount()).toBe(1);
});

// A zero-length sample starts at its boundary and cannot schedule a physics advance.
it("keeps a sample ending at tick zero paused", () => {
  const h = createBrowserHarness(false, 0);

  expect(h.controller.play().ok).toBe(false);
  expect(h.controller.stepOnce().ok).toBe(false);
  expect(h.pendingFrameCount()).toBe(0);
  expect(h.engine.advance).not.toHaveBeenCalled();
});

// Physical authoring during playback must be rejected before any starting-scene mutation.
it.each([
  { name: "projectile placement", edit: (c: LabController) => c.placeProjectile({ x: 20, y: 20 }) },
  { name: "platform placement", edit: (c: LabController) => c.placePlatform({ x: 20, y: 20 }) },
  { name: "ramp placement", edit: (c: LabController) => c.placeRamp({ x: 20, y: 20 }) },
  { name: "target placement", edit: (c: LabController) => c.placeTarget({ x: 20, y: 20 }) },
  { name: "projectile properties", edit: (c: LabController) => c.updateProjectileProperties("projectile", DEFAULT_PROJECTILE_PROPERTIES) },
  { name: "static body properties", edit: (c: LabController) => c.updateStaticBodyProperties("ramp", DEFAULT_RAMP_PROPERTIES) },
  { name: "target properties", edit: (c: LabController) => c.updateTargetProperties("target", DEFAULT_TARGET_PROPERTIES) },
  { name: "paused movement", edit: (c: LabController) => c.moveEntityWhilePaused("projectile", { x: 20, y: 20 }) },
  { name: "deletion", edit: (c: LabController) => c.deleteEntity("projectile") },
])("rejects $name while playing", ({ edit }) => {
  const h = createPlaybackHarness();
  const startingScene = h.controller.copyScene();
  h.controller.play();

  expect(edit(h.controller)).toMatchObject({
    ok: false,
    diagnostics: [{ code: "OUT_OF_RANGE", path: "playback.playing" }],
  });
  expect(h.controller.copyScene()).toEqual(startingScene);
  expect(h.engine.advance).not.toHaveBeenCalled();
});
