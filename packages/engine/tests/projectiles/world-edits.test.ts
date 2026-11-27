import { describe, expect, it } from "vitest";
import type { Body, Command, CommandPayload, DynamicBody, SceneDefinition, StaticBody, TargetTrigger } from "@eureka/contracts";
import { createEngine, type Engine } from "../../src/index.js";
import { expectNear, unwrap } from "../test-support.js";
import { GRAVITY, TIME_STEP, makeScene } from "./scene-fixtures.js";
import { expectFiniteSnapshot } from "./projectile-test-support.js";

// Ideal flight is exact under the kick-drift-kick step, so only rounding separates engine and formula.
const STATE_TOLERANCE = 1e-9;
const EVENT_TIME_TOLERANCE = 1e-8;
const EVENT_POINT_TOLERANCE = 1e-7;

const SPEED = 10;
const ANGLE_DEGREES = 45;
const VX = SPEED * Math.cos(ANGLE_DEGREES * Math.PI / 180);
const VY = SPEED * Math.sin(ANGLE_DEGREES * Math.PI / 180);
const EDIT_TICK = 30;

// x = vx·t, y = vy·t − g·t²/2, vy(t) = vy − g·t for the default ball launched from the origin.
function idealState(timeSeconds: number, gravity = GRAVITY) {
  return {
    x: VX * timeSeconds,
    y: VY * timeSeconds - gravity * timeSeconds ** 2 / 2,
    vx: VX,
    vy: VY - gravity * timeSeconds
  };
}

// Later root of vy·t − g·t²/2 = height: the descending crossing.
function descendingCrossingTime(height: number): number {
  return (VY + Math.sqrt(VY ** 2 - 2 * GRAVITY * height)) / GRAVITY;
}

function command(id: string, targetTick: number, payload: CommandPayload): Command {
  return { commandVersion: 1, id, targetTick, payload };
}

function box(id: string, x: number, y: number, widthMeters: number, heightMeters: number): StaticBody {
  return {
    id,
    kind: "static",
    shape: { kind: "box", widthMeters, heightMeters },
    material: { restitution: 0 },
    pose: { positionMeters: { x, y }, angleRadians: 0 }
  };
}

function ball(id: string, x: number, y: number, vx: number, vy: number): DynamicBody {
  return {
    id,
    kind: "dynamic",
    shape: { kind: "circle", radiusMeters: 0.1 },
    massKilograms: 1,
    material: { restitution: 0 },
    pose: { positionMeters: { x, y }, angleRadians: 0 },
    velocity: { linearMetersPerSecond: { x: vx, y: vy }, angularRadiansPerSecond: 0 }
  };
}

function target(id: string, x: number, y: number, radiusMeters: number): TargetTrigger {
  return { id, kind: "target", shape: { kind: "circle", radiusMeters }, pose: { positionMeters: { x, y }, angleRadians: 0 } };
}

function withBodies(scene: SceneDefinition, ...extra: Body[]): SceneDefinition {
  return { ...scene, bodies: [...scene.bodies, ...extra] };
}

function bodyState(engine: Engine, bodyId: string) {
  const body = unwrap(engine.getSnapshot()).bodies.find((candidate) => candidate.id === bodyId);

  if (body === undefined) {
    throw new Error(`Body "${bodyId}" is missing from the snapshot.`);
  }

  return body;
}

function expectIdealProjectile(engine: Engine, timeSeconds: number, gravity = GRAVITY): void {
  const expected = idealState(timeSeconds, gravity);
  const body = bodyState(engine, "projectile");

  expectNear(body.pose.positionMeters.x, expected.x, STATE_TOLERANCE);
  expectNear(body.pose.positionMeters.y, expected.y, STATE_TOLERANCE);
  expectNear(body.velocity.linearMetersPerSecond.x, expected.vx, STATE_TOLERANCE);
  expectNear(body.velocity.linearMetersPerSecond.y, expected.vy, STATE_TOLERANCE);
}

// Advance one tick at a time until the projectile's first contact with one surface.
function advanceToContact(engine: Engine, surfaceBodyId: string, tickLimit: number) {
  for (let ticks = 0; ticks < tickLimit; ticks += 1) {
    unwrap(engine.advance(1));
    const snapshot = unwrap(engine.copySnapshot());
    expectFiniteSnapshot(snapshot);
    const event = snapshot.events.find((candidate) => candidate.kind === "groundContact" && candidate.bodyId === "projectile");

    if (event !== undefined && event.kind === "groundContact") {
      expect(event.surfaceBodyId).toBe(surfaceBodyId);
      return event;
    }
  }

  throw new Error(`No contact with "${surfaceBodyId}" within ${tickLimit} ticks.`);
}

function expectRejected(result: { readonly ok: boolean; readonly diagnostics?: readonly unknown[] }, code: string, path?: string): void {
  expect(result.ok).toBe(false);
  expect(result.diagnostics?.[0]).toMatchObject(path === undefined ? { code } : { code, path });
}

describe("world edits on one persistent engine", () => {
  // A platform placed while paused mid-flight must not disturb the ball, and the ball must then land on it on time.
  it("adds a platform mid-run, keeps the ball's state and time, and is hit at the formula contact time", () => {
    const engine = unwrap(createEngine(makeScene(SPEED, ANGLE_DEGREES)));
    // Top at y = 1.0 m spanning x = 7..11 m; the descending ball (r = 0.1 m) reaches centre height 1.1 m near x ≈ 8.94 m.
    const platform = box("platform", 9, 0.75, 4, 0.5);

    unwrap(engine.advance(EDIT_TICK));
    const beforeEdit = unwrap(engine.copySnapshot());
    unwrap(engine.enqueue(command("add-platform", EDIT_TICK, { kind: "addEntity", entity: platform })));

    // Queued, not applied: the authoritative state and world are unchanged until the next advance.
    expect(unwrap(engine.copySnapshot())).toEqual(beforeEdit);
    expect(unwrap(engine.copyScene()).bodies.map((body) => body.id)).toEqual(["projectile"]);
    expect(beforeEdit.tick).toBe(EDIT_TICK);
    expectNear(beforeEdit.simulationTimeSeconds, EDIT_TICK * TIME_STEP, 1e-12);
    expectIdealProjectile(engine, EDIT_TICK * TIME_STEP);

    unwrap(engine.advance(1));
    expect(unwrap(engine.copyScene()).bodies.map((body) => body.id)).toEqual(["projectile", "platform"]);
    expectIdealProjectile(engine, (EDIT_TICK + 1) * TIME_STEP);

    const contactTime = descendingCrossingTime(1.1);
    const contact = advanceToContact(engine, "platform", Math.ceil(contactTime / TIME_STEP) + 2);

    expectNear(contact.timeSeconds, contactTime, EVENT_TIME_TOLERANCE);
    expectNear(contact.pointMeters.x, VX * contactTime, EVENT_POINT_TOLERANCE);
    expectNear(contact.pointMeters.y, 1, EVENT_POINT_TOLERANCE);
    expect(engine.dispose().ok).toBe(true);
  });

  // Removing one ball leaves the other on its ideal path and drops every observation of the removed one.
  it("removes a body mid-run without changing unrelated state", () => {
    const engine = unwrap(createEngine(withBodies(makeScene(SPEED, ANGLE_DEGREES), ball("second", 0, 5, 3, 0))));

    unwrap(engine.advance(20));
    unwrap(engine.enqueue(command("remove-second", 20, { kind: "removeEntity", entityId: "second" })));
    unwrap(engine.advance(30));

    const snapshot = unwrap(engine.copySnapshot());
    expect(snapshot.tick).toBe(50);
    expect(snapshot.bodies.map((body) => body.id)).toEqual(["projectile"]);
    expect(snapshot.projectileReadouts.map((readout) => readout.bodyId)).toEqual(["projectile"]);
    expect(unwrap(engine.copyScene()).bodies.map((body) => body.id)).toEqual(["projectile"]);
    expectIdealProjectile(engine, 50 * TIME_STEP);
    expect(engine.dispose().ok).toBe(true);
  });

  // A ball added mid-run measures its flight from the tick it appears: t = 0.5 s, Δx = 2·0.5 m, y = 20 − g·0.5²/2.
  it("starts an added ball's flight measurement at the tick it is added", () => {
    const engine = unwrap(createEngine(makeScene(SPEED, ANGLE_DEGREES)));

    unwrap(engine.advance(EDIT_TICK));
    unwrap(engine.enqueue(command("add-ball", EDIT_TICK, { kind: "addEntity", entity: ball("late-ball", 0, 20, 2, 0) })));
    unwrap(engine.advance(30));

    const snapshot = unwrap(engine.copySnapshot());
    const readout = snapshot.projectileReadouts.find((candidate) => candidate.bodyId === "late-ball");

    expectNear(readout?.flightTimeSeconds ?? Number.NaN, 0.5, 1e-12);
    expectNear(readout?.horizontalDisplacementMeters ?? Number.NaN, 1, STATE_TOLERANCE);
    expectNear(readout?.heightMeters ?? Number.NaN, 20 - GRAVITY * 0.25 / 2, STATE_TOLERANCE);
    expectIdealProjectile(engine, 60 * TIME_STEP);
    expect(engine.dispose().ok).toBe(true);
  });

  // After g changes at t₀ = 0.5 s: y = y₀ + vy₀·τ − g'·τ²/2 and vy = vy₀ − g'·τ, with x unchanged in form.
  it("applies a mid-run environment change from its boundary tick", () => {
    const engine = unwrap(createEngine(makeScene(SPEED, ANGLE_DEGREES)));
    const newGravity = 4;

    unwrap(engine.advance(EDIT_TICK));
    unwrap(engine.enqueue(command("weaker-gravity", EDIT_TICK, {
      kind: "setEnvironment",
      environment: { gravityMetersPerSecondSquared: { x: 0, y: -newGravity }, linearDragKilogramsPerSecond: 0 }
    })));
    unwrap(engine.advance(30));

    const editTime = EDIT_TICK * TIME_STEP;
    const tau = 30 * TIME_STEP;
    const atEdit = idealState(editTime);
    const body = bodyState(engine, "projectile");

    expectNear(body.pose.positionMeters.x, VX * (editTime + tau), STATE_TOLERANCE);
    expectNear(body.pose.positionMeters.y, atEdit.y + atEdit.vy * tau - newGravity * tau ** 2 / 2, STATE_TOLERANCE);
    expectNear(body.velocity.linearMetersPerSecond.y, atEdit.vy - newGravity * tau, STATE_TOLERANCE);
    expect(unwrap(engine.copyScene()).environment.gravityMetersPerSecondSquared).toEqual({ x: 0, y: -newGravity });
    expect(engine.dispose().ok).toBe(true);
  });

  // Ground top is −0.1 m; after the radius becomes 0.3 m the centre touches at y = 0.2 m on the way down.
  it("resizes a ball mid-run and lands with the new radius", () => {
    const engine = unwrap(createEngine(makeScene(SPEED, ANGLE_DEGREES, 0, true)));

    unwrap(engine.advance(EDIT_TICK));
    unwrap(engine.enqueue(command("grow", EDIT_TICK, { kind: "editBody", bodyId: "projectile", changes: { shape: { kind: "circle", radiusMeters: 0.3 } } })));

    const contactTime = descendingCrossingTime(0.2);
    const contact = advanceToContact(engine, "ground", Math.ceil(contactTime / TIME_STEP) + 2);

    expectNear(contact.timeSeconds, contactTime, EVENT_TIME_TOLERANCE);
    expectNear(contact.pointMeters.x, VX * contactTime, EVENT_POINT_TOLERANCE);
    expect(engine.dispose().ok).toBe(true);
  });

  // A target placed around a ball counts it as already inside, like a scene that starts that way: no entry event.
  it("adds a target around a ball without reporting an entry", () => {
    const engine = unwrap(createEngine(makeScene(SPEED, ANGLE_DEGREES)));
    const here = idealState(EDIT_TICK * TIME_STEP);

    unwrap(engine.advance(EDIT_TICK));
    unwrap(engine.enqueue(command("add-target", EDIT_TICK, { kind: "addEntity", entity: target("around", here.x, here.y, 1) })));

    for (let ticks = 0; ticks < 5; ticks += 1) {
      unwrap(engine.advance(1));
      expect(unwrap(engine.getSnapshot()).events.filter((event) => event.kind === "targetEntered")).toEqual([]);
    }

    expect(unwrap(engine.copyScene()).triggers.map((trigger) => trigger.id)).toEqual(["around"]);
    expect(engine.dispose().ok).toBe(true);
  });

  // Removing a pulled ball ends its pull: the recorded pull work stops changing and ending the pull later is harmless.
  it("ends the force interaction on a removed body and keeps the recorded work", () => {
    const engine = unwrap(createEngine(withBodies(makeScene(SPEED, ANGLE_DEGREES), ball("second", 0, 5, 3, 0))));

    unwrap(engine.enqueue(command("pull", 0, {
      kind: "setForceInteraction",
      interactionId: "pull",
      bodyId: "second",
      localAnchorMeters: { x: 0, y: 0 },
      targetPositionMeters: { x: 2, y: 6 },
      stiffnessNewtonsPerMeter: 100,
      dampingKilogramsPerSecond: 20
    })));
    unwrap(engine.advance(10));
    const workBeforeRemoval = unwrap(engine.getSnapshot()).userInteractionWorkJoules;

    unwrap(engine.enqueue(command("remove-second", 10, { kind: "removeEntity", entityId: "second" })));
    unwrap(engine.advance(10));

    expect(workBeforeRemoval).not.toBe(0);
    expect(unwrap(engine.getSnapshot()).userInteractionWorkJoules).toBe(workBeforeRemoval);
    unwrap(engine.enqueue(command("end-pull", 20, { kind: "endForceInteraction", interactionId: "pull" })));
    unwrap(engine.advance(1));
    expectIdealProjectile(engine, 21 * TIME_STEP);
    expect(engine.dispose().ok).toBe(true);
  });

  // Each invalid edit is refused when queued, and the run continues exactly as if it had never been tried.
  it("rejects invalid world edits without queuing or changing anything", () => {
    const engine = unwrap(createEngine(withBodies(makeScene(SPEED, ANGLE_DEGREES), ball("second", 0, 5, 3, 0))));
    const here = idealState(EDIT_TICK * TIME_STEP);

    unwrap(engine.advance(EDIT_TICK));
    const before = unwrap(engine.copySnapshot());
    const sceneBefore = unwrap(engine.copyScene());

    expectRejected(engine.enqueue(command("duplicate", EDIT_TICK, { kind: "addEntity", entity: ball("projectile", 0, 9, 0, 0) })), "DUPLICATE_ENTITY_ID", "payload.entity.id");
    expectRejected(engine.enqueue(command("overlap", EDIT_TICK, { kind: "addEntity", entity: box("block", here.x, here.y, 1, 1) })), "INVALID_INITIAL_OVERLAP");
    expectRejected(engine.enqueue(command("bad-radius", EDIT_TICK, { kind: "addEntity", entity: { ...ball("tiny", 0, 9, 0, 0), shape: { kind: "circle", radiusMeters: 0 } } })), "OUT_OF_RANGE", "payload.entity.shape.radiusMeters");
    expectRejected(engine.enqueue(command("wrong-shape", EDIT_TICK, { kind: "editBody", bodyId: "projectile", changes: { shape: { kind: "box", widthMeters: 1, heightMeters: 1 } } })), "INVALID_BODY_KIND", "payload.changes.shape");
    expectRejected(engine.enqueue(command("missing", EDIT_TICK, { kind: "removeEntity", entityId: "missing" })), "UNKNOWN_ENTITY_ID", "payload.entityId");
    expectRejected(engine.enqueue(command("missing-target", EDIT_TICK, { kind: "editTarget", targetId: "missing", changes: { shape: { kind: "circle", radiusMeters: 1 } } })), "UNKNOWN_ENTITY_ID", "payload.targetId");
    expectRejected(engine.enqueue(command("negative-drag", EDIT_TICK, {
      kind: "setEnvironment",
      environment: { gravityMetersPerSecondSquared: { x: 0, y: -GRAVITY }, linearDragKilogramsPerSecond: -1 }
    })), "OUT_OF_RANGE", "payload.environment.linearDragKilogramsPerSecond");

    // An edit of a body already queued for removal at this tick refers to nothing.
    unwrap(engine.enqueue(command("remove-second", EDIT_TICK, { kind: "removeEntity", entityId: "second" })));
    expectRejected(engine.enqueue(command("edit-removed", EDIT_TICK, { kind: "editBody", bodyId: "second", changes: { massKilograms: 2 } })), "UNKNOWN_ENTITY_ID", "payload.bodyId");

    expect(unwrap(engine.copySnapshot())).toEqual(before);
    expect(unwrap(engine.copyScene())).toEqual(sceneBefore);
    unwrap(engine.advance(1));
    expect(unwrap(engine.copyScene()).bodies.map((body) => body.id)).toEqual(["projectile"]);
    expectIdealProjectile(engine, (EDIT_TICK + 1) * TIME_STEP);
    expect(engine.dispose().ok).toBe(true);
  });
});

describe("starting scene on one persistent engine", () => {
  const firstStart = makeScene(SPEED, ANGLE_DEGREES);
  const editedStart = withBodies(
    { ...makeScene(12, 30, 0, true), triggers: [target("goal", 6, 2, 0.5)] },
    box("platform", 9, 0.75, 4, 0.5)
  );

  // Editing the start at tick 0 must give exactly the run a fresh engine of that scene gives.
  it("replaces the start at tick 0 without advancing, matching a fresh engine", () => {
    const edited = unwrap(createEngine(firstStart));
    const fresh = unwrap(createEngine(editedStart));

    expect(edited.setInitialScene(editedStart).ok).toBe(true);
    expect(unwrap(edited.copySnapshot())).toEqual(unwrap(fresh.copySnapshot()));
    expect(unwrap(edited.copyScene())).toEqual(editedStart);

    for (let tick = 1; tick <= 40; tick += 1) {
      unwrap(edited.advance(1));
      unwrap(fresh.advance(1));
      expect(unwrap(edited.copySnapshot())).toEqual(unwrap(fresh.copySnapshot()));
    }

    expect(edited.dispose().ok).toBe(true);
    expect(fresh.dispose().ok).toBe(true);
  });

  // The start is locked once a tick has run or a command is waiting; Reset unlocks it again.
  it("refuses start changes during a run or for another source, without mutation", () => {
    const engine = unwrap(createEngine(firstStart));

    expectRejected(engine.setInitialScene({ ...editedStart, seed: editedStart.seed + 1 }), "SOURCE_CHANGED", "seed");
    expectRejected(engine.setInitialScene({ ...editedStart, id: "another-scene" }), "SOURCE_CHANGED", "id");
    expectRejected(engine.setInitialScene({ ...editedStart, numericalProfile: { ...editedStart.numericalProfile, substeps: 2 } }), "SOURCE_CHANGED", "numericalProfile");
    expectRejected(engine.setInitialScene(withBodies(editedStart, { ...ball("heavy", 0, 9, 0, 0), massKilograms: -1 })), "OUT_OF_RANGE");
    expect(unwrap(engine.copyScene())).toEqual(firstStart);

    unwrap(engine.enqueue(command("waiting", 0, { kind: "editBody", bodyId: "projectile", changes: { massKilograms: 2 } })));
    expectRejected(engine.setInitialScene(editedStart), "RUN_IN_PROGRESS");

    unwrap(engine.advance(1));
    const during = unwrap(engine.copySnapshot());
    expectRejected(engine.setInitialScene(editedStart), "RUN_IN_PROGRESS");
    expect(unwrap(engine.copySnapshot())).toEqual(during);

    expect(engine.reset().ok).toBe(true);
    expect(engine.setInitialScene(editedStart).ok).toBe(true);
    expect(unwrap(engine.copyScene())).toEqual(editedStart);
    expect(engine.dispose().ok).toBe(true);
  });

  // Reset returns to the start: run additions, removals, environment and shape changes all disappear.
  it("resets every run edit back to the committed start", () => {
    const engine = unwrap(createEngine(editedStart));
    const fresh = unwrap(createEngine(editedStart));

    unwrap(engine.advance(20));
    unwrap(engine.enqueue(command("add", 20, { kind: "addEntity", entity: box("wall", 30, 5, 1, 10) })));
    unwrap(engine.enqueue(command("remove-goal", 20, { kind: "removeEntity", entityId: "goal" })));
    unwrap(engine.enqueue(command("remove-platform", 20, { kind: "removeEntity", entityId: "platform" })));
    unwrap(engine.enqueue(command("gravity", 20, { kind: "setEnvironment", environment: { gravityMetersPerSecondSquared: { x: 0, y: -2 }, linearDragKilogramsPerSecond: 0.5 } })));
    unwrap(engine.enqueue(command("grow", 20, { kind: "editBody", bodyId: "projectile", changes: { shape: { kind: "circle", radiusMeters: 0.2 } } })));
    unwrap(engine.advance(5));

    expect(engine.reset().ok).toBe(true);
    expect(unwrap(engine.copySnapshot())).toEqual(unwrap(fresh.copySnapshot()));
    expect(unwrap(engine.copyScene())).toEqual(editedStart);

    unwrap(engine.advance(30));
    unwrap(fresh.advance(30));
    expect(unwrap(engine.copySnapshot())).toEqual(unwrap(fresh.copySnapshot()));
    expect(engine.dispose().ok).toBe(true);
    expect(fresh.dispose().ok).toBe(true);
  });
});
