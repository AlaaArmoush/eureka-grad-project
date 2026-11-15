// Verify the real fixture adapter through the same public operations used by the controller.
import { expect, it } from "vitest";
import { createSnapshotPlaybackEngine, PROJECTILE_LAB_MOCK, PROJECTILE_PLAYBACK_SNAPSHOTS } from "../../src/lab/mocks.js";
import { createLabController } from "../../src/lab/controller.js";

// Start each case with an independently owned playback cursor over the reviewed fixture frames.
function createFixturePlayback() {
  const result = createSnapshotPlaybackEngine(PROJECTILE_PLAYBACK_SNAPSHOTS);

  if (!result.ok) {
    throw new Error("The reviewed playback fixture must create successfully.");
  }

  return result.value;
}

// Forward each exact fixture frame in order; this verifies delivery, not the motion formulas.
it("delivers every reviewed tick and resets to the first frame", () => {
  const engine = createFixturePlayback();
  expect(PROJECTILE_PLAYBACK_SNAPSHOTS.map((frame) => frame.tick)).toEqual(
    Array.from({ length: 61 }, (_, tick) => tick),
  );

  for (const frame of PROJECTILE_PLAYBACK_SNAPSHOTS) {
    if (frame.tick > 0) {
      expect(engine.advance(1)).toEqual({ ok: true, value: { lastValidTick: frame.tick } });
    }
    expect(engine.getSnapshot()).toEqual({ ok: true, value: frame });
  }

  expect(engine.advance(1).ok).toBe(false);
  expect(engine.getSnapshot()).toEqual({ ok: true, value: PROJECTILE_PLAYBACK_SNAPSHOTS.at(-1) });
  expect(engine.reset()).toEqual({ ok: true });
  expect(engine.getSnapshot()).toEqual({ ok: true, value: PROJECTILE_PLAYBACK_SNAPSHOTS[0] });
});

// Invalid counts must leave the current fixture cursor unchanged.
it.each([-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY])("rejects invalid advance count %s", (count) => {
  const engine = createFixturePlayback();
  const before = engine.copySnapshot();

  expect(engine.advance(count).ok).toBe(false);
  expect(engine.copySnapshot()).toEqual(before);
});

// Advancing zero ticks is valid and must preserve the first frame.
it("accepts a zero-tick advance without moving its cursor", () => {
  const engine = createFixturePlayback();

  expect(engine.advance(0)).toEqual({ ok: true, value: { lastValidTick: 0 } });
  expect(engine.getSnapshot()).toEqual({ ok: true, value: PROJECTILE_PLAYBACK_SNAPSHOTS[0] });
});

// A retained copy must not be the fixture adapter's borrowed view.
it("provides an owned snapshot copy", () => {
  const engine = createFixturePlayback();
  const borrowed = engine.getSnapshot();
  const copy = engine.copySnapshot();

  if (!borrowed.ok || !copy.ok) {
    throw new Error("The active fixture adapter must provide snapshots.");
  }

  expect(copy.value).toEqual(borrowed.value);
  expect(copy.value).not.toBe(borrowed.value);
  expect(copy.value.bodies).not.toBe(borrowed.value.bodies);
});

// The sample source must own its frames rather than retain the caller's mutable array.
it("owns its fixture list independently of the caller", () => {
  const frames = [...PROJECTILE_PLAYBACK_SNAPSHOTS];
  const result = createSnapshotPlaybackEngine(frames);
  expect(result.ok).toBe(true);

  if (!result.ok) {
    throw new Error("The reviewed playback fixture must create successfully.");
  }

  frames.length = 0;
  expect(result.value.advance(1)).toEqual({ ok: true, value: { lastValidTick: 1 } });
});

// Sparse trail points cannot masquerade as consecutive whole-tick playback frames.
it("rejects empty or skipped-tick fixture sequences", () => {
  expect(createSnapshotPlaybackEngine([]).ok).toBe(false);
  const frames = PROJECTILE_PLAYBACK_SNAPSHOTS.filter((frame) => frame.tick !== 1);
  expect(createSnapshotPlaybackEngine(frames).ok).toBe(false);
});

// Fixture playback must never pretend to execute physical edit commands.
it("rejects commands without changing its frame", () => {
  const engine = createFixturePlayback();
  const before = engine.copySnapshot();

  const result = engine.enqueue({
    commandVersion: 1,
    id: "sample-mass-edit",
    targetTick: 0,
    payload: { kind: "editBody", bodyId: "projectile", changes: { massKilograms: 2 } },
  });

  expect(result).toMatchObject({ ok: false, diagnostics: [{ code: "UNSUPPORTED_COMMAND" }] });
  expect(engine.copySnapshot()).toEqual(before);
});

// Disposed playback sources must reject later operations and allow repeated cleanup.
it("rejects operations after disposal", () => {
  const engine = createFixturePlayback();

  expect(engine.dispose()).toEqual({ ok: true });
  expect(engine.dispose()).toEqual({ ok: true });
  expect(engine.getSnapshot().ok).toBe(false);
  expect(engine.copySnapshot().ok).toBe(false);
  expect(engine.advance(1).ok).toBe(false);
  expect(engine.reset().ok).toBe(false);
});

// Join the real fixture adapter to the product controller while keeping physics entirely mocked.
it("plays the reviewed sample to tick sixty and resets without releasing its view", () => {
  const engine = createFixturePlayback();
  let nowMilliseconds = 0;
  let viewReleased = false;
  const drawnTicks: number[] = [];
  const readoutTicks: number[] = [];
  const result = createLabController({
    engine,
    initialScene: PROJECTILE_LAB_MOCK.scene,
    consumeSnapshot: (snapshot) => drawnTicks.push(snapshot.tick),
    consumeReadout: (snapshot) => readoutTicks.push(snapshot.tick),
    releaseView: () => { viewReleased = true; },
    nowMilliseconds: () => nowMilliseconds,
    stopAtTick: 60,
  });

  if (!result.ok) {
    throw new Error("The reviewed sample controller must create successfully.");
  }

  const controller = result.value;
  controller.play();

  for (let frame = 1; frame <= 10; frame += 1) {
    nowMilliseconds = frame * 100;
    expect(controller.advanceFrame()).toEqual({ ok: true });
  }

  expect(drawnTicks).toEqual(Array.from({ length: 61 }, (_, tick) => tick));
  expect(readoutTicks.at(-1)).toBe(60);
  expect(controller.getPlaybackState().playing).toBe(false);
  expect(controller.copySnapshot()).toEqual({ ok: true, value: PROJECTILE_PLAYBACK_SNAPSHOTS.at(-1) });
  expect(controller.reset()).toEqual({ ok: true });
  expect(readoutTicks.at(-1)).toBe(0);
  expect(viewReleased).toBe(false);
});
