// Tests running force interactions, user work, command timing and state safety.
import { describe, expect, it } from "vitest";
import type { Command, LaunchBodyCommand, SetForceInteractionCommand, Snapshot, SnapshotBody, SnapshotEvent } from "@eureka/contracts";
import { createEngine } from "../../src/index.js";
import { expectNear, unwrap } from "../test-support.js";
import { expectFiniteSnapshot } from "./projectile-test-support.js";
import { makeScene } from "./scene-fixtures.js";

const STEP_SECONDS = 1 / 240;
const sceneOptions = {
  fixedTimeStepSeconds: STEP_SECONDS,
  gravityMetersPerSecondSquared: { x: 0, y: 0 }
};

// Build a force command with the settings needed by each test.
function interactionCommand(id: string, targetTick = 0, changes: Partial<SetForceInteractionCommand> = {}): Command {
  return {
    commandVersion: 1,
    id,
    targetTick,
    payload: {
      kind: "setForceInteraction",
      interactionId: "pointer",
      bodyId: "projectile",
      localAnchorMeters: { x: 0, y: 0 },
      targetPositionMeters: { x: 1, y: 0 },
      stiffnessNewtonsPerMeter: 4,
      dampingKilogramsPerSecond: 0,
      ...changes
    }
  };
}

// Find the projectile by ID.
function projectile(snapshot: Snapshot): SnapshotBody {
  const body = snapshot.bodies.find((candidate) => candidate.id === "projectile");

  if (body === undefined) {
    throw new Error("Snapshot omitted the projectile.");
  }

  return body;
}

// Require a finite interaction-work reading.
function interactionWork(snapshot: Snapshot): number {
  const work = snapshot.userInteractionWorkJoules;

  if (work === undefined) {
    throw new Error("Snapshot omitted interaction work.");
  }

  expect(Number.isFinite(work)).toBe(true);
  return work;
}

describe("running force interactions", () => {
  // Check spring motion and work for three masses.
  it.each([0.1, 1, 10])("follows the independent spring solution for mass %s kg", (mass) => {
    const engine = unwrap(createEngine(makeScene(0, 0, 0, false, { ...sceneOptions, massKilograms: mass })));

    try {
      unwrap(engine.enqueue(interactionCommand("start", 0, { stiffnessNewtonsPerMeter: 4 * mass, maximumForceNewtons: 1000 })));

      for (let tick = 1; tick <= 120; tick += 1) {
        unwrap(engine.advance(1));
        const snapshot = unwrap(engine.copySnapshot());
        const body = projectile(snapshot);
        const time = tick * STEP_SECONDS;
        const expectedX = 1 - Math.cos(2 * time);
        const expectedV = 2 * Math.sin(2 * time);
        const kineticEnergy = 0.5 * mass * body.velocity.linearMetersPerSecond.x ** 2;

        expectFiniteSnapshot(snapshot);
        expectNear(body.pose.positionMeters.x, expectedX, 1e-4);
        expectNear(body.velocity.linearMetersPerSecond.x, expectedV, 1e-4);
        expectNear(kineticEnergy - interactionWork(snapshot), 0, 1e-3 * mass);
      }
    } finally {
      expect(engine.dispose().ok).toBe(true);
    }
  });

  // Damping should slow the projectile and record negative work.
  it.each([0.1, 1, 10])("records negative damping work for mass %s kg", (mass) => {
    const engine = unwrap(createEngine(makeScene(2, 0, 0, false, { ...sceneOptions, massKilograms: mass })));

    try {
      unwrap(engine.enqueue(interactionCommand("damp", 0, {
        stiffnessNewtonsPerMeter: 0,
        dampingKilogramsPerSecond: mass,
        maximumForceNewtons: 1000
      })));
      unwrap(engine.advance(240));
      const snapshot = unwrap(engine.copySnapshot());
      const body = projectile(snapshot);

      expectFiniteSnapshot(snapshot);
      expectNear(body.pose.positionMeters.x, 2 * (1 - Math.exp(-1)), 2e-5);
      expectNear(body.velocity.linearMetersPerSecond.x, 2 * Math.exp(-1), 2e-5);
      expectNear(interactionWork(snapshot), 2 * mass * (Math.exp(-2) - 1), 1e-3 * mass);
      expect(interactionWork(snapshot)).toBeLessThan(0);
    } finally {
      expect(engine.dispose().ok).toBe(true);
    }
  });

  // Check that the force limit also holds for a diagonal pull.
  it.each([{ x: 1, y: 0 }, { x: Math.SQRT1_2, y: Math.SQRT1_2 }])("caps the complete vector along %j", (direction) => {
    const engine = unwrap(createEngine(makeScene(0, 0, 0, false, sceneOptions)));

    try {
      unwrap(engine.enqueue(interactionCommand("pull", 0, {
        targetPositionMeters: { x: 100 * direction.x, y: 100 * direction.y },
        stiffnessNewtonsPerMeter: 100,
        maximumForceNewtons: 2
      })));
      unwrap(engine.advance(240));
      const snapshot = unwrap(engine.copySnapshot());
      const body = projectile(snapshot);

      expectNear(body.pose.positionMeters.x, direction.x, 1e-10);
      expectNear(body.pose.positionMeters.y, direction.y, 1e-10);
      expectNear(body.velocity.linearMetersPerSecond.x, 2 * direction.x, 1e-10);
      expectNear(body.velocity.linearMetersPerSecond.y, 2 * direction.y, 1e-10);
      expectNear(interactionWork(snapshot), 2, 1e-10);
    } finally {
      expect(engine.dispose().ok).toBe(true);
    }
  });

  // Check default force limits for two sets of scene scales.
  it.each([
    { scales: { massKilograms: 1, lengthMeters: 1, timeSeconds: 1 }, force: 100 },
    { scales: { massKilograms: 2, lengthMeters: 3, timeSeconds: 2 }, force: 150 }
  ])("resolves the omitted limit from scene scales %j", ({ scales, force }) => {
    const scene = makeScene(0, 0, 0, false, sceneOptions);
    const engine = unwrap(createEngine({ ...scene, numericalProfile: { ...scene.numericalProfile, scales } }));

    try {
      unwrap(engine.enqueue(interactionCommand("default-limit", 0, {
        targetPositionMeters: { x: 1000, y: 0 },
        stiffnessNewtonsPerMeter: 1000
      })));
      unwrap(engine.advance(24));
      const snapshot = unwrap(engine.copySnapshot());
      const body = projectile(snapshot);

      expectNear(body.pose.positionMeters.x, 0.5 * force * 0.1 ** 2, 1e-10);
      expectNear(body.velocity.linearMetersPerSecond.x, force * 0.1, 1e-10);
      expectNear(interactionWork(snapshot), 0.5 * force ** 2 * 0.1 ** 2, 1e-8);
    } finally {
      expect(engine.dispose().ok).toBe(true);
    }
  });

  // Halving the timestep should reduce the error by about four.
  it("converges at second order for the smooth spring", () => {
    const errors: number[] = [];

    for (const timeStep of [1 / 60, 1 / 120, 1 / 240]) {
      const engine = unwrap(createEngine(makeScene(0, 0, 0, false, {
        ...sceneOptions, fixedTimeStepSeconds: timeStep
      })));

      try {
        unwrap(engine.enqueue(interactionCommand("spring")));
        unwrap(engine.advance(Math.round(0.5 / timeStep)));
        const body = projectile(unwrap(engine.copySnapshot()));
        const error = Math.hypot(body.pose.positionMeters.x - (1 - Math.cos(1)), body.velocity.linearMetersPerSecond.x - 2 * Math.sin(1));

        expect(error).toBeLessThan(0.002);
        errors.push(error);
      } finally {
        expect(engine.dispose().ok).toBe(true);
      }
    }

    for (let index = 0; index < 2; index += 1) {
      const coarse = errors[index];
      const fine = errors[index + 1];

      if (coarse === undefined || fine === undefined) {
        throw new Error("Missing a refinement result.");
      }

      expect(coarse / fine).toBeGreaterThan(3);
      expect(coarse / fine).toBeLessThan(5);
    }
  });

  // Check command timing, ending a drag, retained snapshots and reset.
  it("schedules updates and ends without teleporting or rewriting retained copies", () => {
    const engine = unwrap(createEngine(makeScene(0, 0, 0, false, sceneOptions)));

    try {
      const initial = unwrap(engine.copySnapshot());
      unwrap(engine.enqueue(interactionCommand("future", 2)));
      expect(unwrap(engine.copySnapshot())).toEqual(initial);
      unwrap(engine.advance(2));
      expect(projectile(unwrap(engine.copySnapshot())).pose.positionMeters.x).toBe(0);
      unwrap(engine.advance(1));
      const retained = unwrap(engine.copySnapshot());
      expect(projectile(retained).pose.positionMeters.x).toBeGreaterThan(0);
      expect(projectile(retained).pose.positionMeters.x).toBeLessThan(0.01);

      unwrap(engine.enqueue(interactionCommand("update", 3, { targetPositionMeters: { x: -1, y: 0 } })));
      unwrap(engine.enqueue({ commandVersion: 1, id: "end", targetTick: 3, payload: { kind: "endForceInteraction", interactionId: "pointer" } }));
      unwrap(engine.advance(10));
      const ended = unwrap(engine.copySnapshot());
      expectNear(projectile(ended).velocity.linearMetersPerSecond.x, projectile(retained).velocity.linearMetersPerSecond.x, 1e-12);
      expect(interactionWork(ended)).toBe(interactionWork(retained));
      expect(retained.tick).toBe(3);

      unwrap(engine.enqueue({ commandVersion: 1, id: "end-again", targetTick: ended.tick, payload: { kind: "endForceInteraction", interactionId: "pointer" } }));
      unwrap(engine.advance(1));
      expect(engine.reset().ok).toBe(true);
      expect(unwrap(engine.copySnapshot())).toEqual(initial);
      unwrap(engine.advance(10));
      expect(projectile(unwrap(engine.copySnapshot())).pose.positionMeters.x).toBe(0);
      expect(interactionWork(unwrap(engine.copySnapshot()))).toBe(0);
    } finally {
      expect(engine.dispose().ok).toBe(true);
    }
  });

  // Separate IDs add forces; reusing an ID replaces its force.
  it("adds distinct interactions and replaces an existing interaction by ID", () => {
    const engine = unwrap(createEngine(makeScene(0, 0, 0, false, sceneOptions)));

    try {
      const pull = { targetPositionMeters: { x: 100, y: 0 }, stiffnessNewtonsPerMeter: 100, maximumForceNewtons: 2 };
      unwrap(engine.enqueue(interactionCommand("first", 0, pull)));
      unwrap(engine.enqueue(interactionCommand("replacement", 0, pull)));
      unwrap(engine.enqueue(interactionCommand("second", 0, { ...pull, interactionId: "second-pointer" })));
      unwrap(engine.advance(240));
      const snapshot = unwrap(engine.copySnapshot());

      expectNear(projectile(snapshot).pose.positionMeters.x, 2, 1e-10);
      expectNear(projectile(snapshot).velocity.linearMetersPerSecond.x, 4, 1e-10);
      expectNear(interactionWork(snapshot), 8, 1e-10);
    } finally {
      expect(engine.dispose().ok).toBe(true);
    }
  });

  // A rotated grab point already at its target should not move the projectile.
  it("transforms the local grab point into world coordinates", () => {
    const scene = makeScene(0, 0, 0, false, sceneOptions);
    const body = scene.bodies[0];

    if (body === undefined) {
      throw new Error("Scene omitted the projectile.");
    }

    const engine = unwrap(createEngine({ ...scene, bodies: [{ ...body, pose: { ...body.pose, angleRadians: Math.PI / 2 } }] }));

    try {
      unwrap(engine.enqueue(interactionCommand("grab", 0, {
        localAnchorMeters: { x: 0.1, y: 0 }, targetPositionMeters: { x: 0, y: 0.1 }
      })));
      unwrap(engine.advance(24));
      const snapshot = unwrap(engine.copySnapshot());
      expectNear(projectile(snapshot).pose.positionMeters.x, 0, 1e-12);
      expectNear(projectile(snapshot).pose.positionMeters.y, 0, 1e-12);
      expectNear(interactionWork(snapshot), 0, 1e-12);
    } finally {
      expect(engine.dispose().ok).toBe(true);
    }
  });

  // Count only interaction work when gravity and environmental drag are present.
  it("excludes gravity and environmental drag from user work", () => {
    const engine = unwrap(createEngine(makeScene(0, 0, 0, false, {
      ...sceneOptions, gravityMetersPerSecondSquared: { x: 1, y: 0 }, linearDragKilogramsPerSecond: 1
    })));

    try {
      unwrap(engine.enqueue(interactionCommand("pull", 0, {
        targetPositionMeters: { x: 100, y: 0 }, stiffnessNewtonsPerMeter: 100, maximumForceNewtons: 2
      })));
      unwrap(engine.advance(240));
      const snapshot = unwrap(engine.copySnapshot());
      const expectedX = 3 * Math.exp(-1);
      expectNear(projectile(snapshot).pose.positionMeters.x, expectedX, 1e-4);
      expectNear(projectile(snapshot).velocity.linearMetersPerSecond.x, 3 * (1 - Math.exp(-1)), 1e-4);
      expectNear(interactionWork(snapshot), 2 * expectedX, 2e-4);
    } finally {
      expect(engine.dispose().ok).toBe(true);
    }
  });

  // Check target entry and wall contact without adding work while blocked.
  it("sweeps accelerated target/contact motion and counts only accepted work", () => {
    const engine = unwrap(createEngine(makeScene(0, 0, 0, false, {
      ...sceneOptions,
      fixedTimeStepSeconds: 0.3,
      surfaces: [{
        id: "wall", kind: "static", shape: { kind: "box", widthMeters: 0.2, heightMeters: 4 },
        material: { restitution: 0 }, pose: { positionMeters: { x: 1.2, y: 0 }, angleRadians: 0 }
      }],
      triggers: [{
        id: "target", kind: "target", shape: { kind: "circle", radiusMeters: 0.01 },
        pose: { positionMeters: { x: 0.6, y: 0 }, angleRadians: 0 }
      }]
    })));

    try {
      unwrap(engine.enqueue(interactionCommand("pull", 0, {
        targetPositionMeters: { x: 100, y: 0 }, stiffnessNewtonsPerMeter: 100, maximumForceNewtons: 2
      })));
      const events: SnapshotEvent[] = [];

      for (let tick = 0; tick < 4; tick += 1) {
        unwrap(engine.advance(1));
        events.push(...unwrap(engine.copySnapshot()).events);
      }

      const target = events.find((event) => event.kind === "targetEntered");
      const contact = events.find((event) => event.kind === "groundContact");

      if (target === undefined || contact === undefined) {
        throw new Error("Expected both target entry and wall contact.");
      }

      expectNear(target.timeSeconds, 0.7, 1e-7);
      expectNear(contact.timeSeconds, 1, 1e-7);
      const snapshot = unwrap(engine.copySnapshot());
      expectNear(projectile(snapshot).pose.positionMeters.x, 1, 1e-7);
      expectNear(projectile(snapshot).velocity.linearMetersPerSecond.x, 0, 1e-10);
      expectNear(interactionWork(snapshot), 2, 2e-7);
    } finally {
      expect(engine.dispose().ok).toBe(true);
    }
  });

  // Keep work after relaunch and preserve state when a command batch fails.
  it("retains work through launch and rejects a whole mixed command batch", () => {
    const engine = unwrap(createEngine(makeScene(0, 0, 1, true, sceneOptions)));

    try {
      const initial = unwrap(engine.copySnapshot());
      unwrap(engine.enqueue(interactionCommand("pull", 0, {
        targetPositionMeters: { x: 100, y: 1 }, stiffnessNewtonsPerMeter: 100, maximumForceNewtons: 2
      })));
      unwrap(engine.advance(24));
      const moving = unwrap(engine.copySnapshot());
      expectNear(interactionWork(moving), 0.02, 1e-12);
      const launchPayload: LaunchBodyCommand = {
        kind: "launchBody", bodyId: "projectile", positionMeters: { x: 20, y: 1 },
        velocity: { linearMetersPerSecond: { x: 0, y: 0 }, angularRadiansPerSecond: 0 }
      };
      const launch: Command = { commandVersion: 1, id: "launch", targetTick: 24, payload: launchPayload };
      unwrap(engine.enqueue(launch));
      unwrap(engine.enqueue({ commandVersion: 1, id: "end", targetTick: 24, payload: { kind: "endForceInteraction", interactionId: "pointer" } }));
      // Queued a tick early so the overlap is found only when tick 25 runs.
      unwrap(engine.enqueue(interactionCommand("restart-pull", 25)));
      unwrap(engine.enqueue({
        ...launch, id: "overlap", targetTick: 25,
        payload: { ...launchPayload, positionMeters: { x: 20, y: -0.01 } }
      }));
      unwrap(engine.advance(1));
      const relaunched = unwrap(engine.copySnapshot());
      expect(interactionWork(relaunched)).toBe(interactionWork(moving));
      const rejected = engine.advance(1);
      expect(rejected.ok).toBe(false);
      expect(unwrap(engine.copySnapshot())).toEqual(relaunched);
      expect(engine.reset().ok).toBe(true);
      expect(unwrap(engine.copySnapshot())).toEqual(initial);
      unwrap(engine.advance(1));
      expect(projectile(unwrap(engine.copySnapshot())).pose.positionMeters.x).toBe(0);
    } finally {
      expect(engine.dispose().ok).toBe(true);
    }
  });

  // Invalid force limits must leave the scene and command ID unchanged.
  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])("rejects invalid limit %s without changing the run", (limit) => {
    const engine = unwrap(createEngine(makeScene(0, 0, 0, false, sceneOptions)));

    try {
      const before = unwrap(engine.copySnapshot());
      const result = engine.enqueue(interactionCommand("retry", 0, { maximumForceNewtons: limit }));

      expect(result.ok).toBe(false);

      if (result.ok) {
        throw new Error("Invalid limit was accepted.");
      }

      expect(result.diagnostics[0]?.path).toBe("payload.maximumForceNewtons");
      expect(unwrap(engine.copySnapshot())).toEqual(before);
      unwrap(engine.enqueue(interactionCommand("retry", 0, { maximumForceNewtons: 2 })));
    } finally {
      expect(engine.dispose().ok).toBe(true);
    }
  });

  // Reject forces on missing or static bodies.
  it.each([
    { bodyId: "missing", code: "UNKNOWN_ENTITY_ID" },
    { bodyId: "ground", code: "INVALID_BODY_KIND" }
  ])("rejects force target $bodyId with $code", ({ bodyId, code }) => {
    const engine = unwrap(createEngine(makeScene(0, 0, 1, true, sceneOptions)));

    try {
      const before = unwrap(engine.copySnapshot());
      const rejected = engine.enqueue(interactionCommand("retry", 0, { bodyId }));
      expect(rejected.ok).toBe(false);

      if (rejected.ok) {
        throw new Error("Invalid force target was accepted.");
      }

      expect(rejected.diagnostics[0]?.code).toBe(code);
      expect(rejected.diagnostics[0]?.entityId).toBe(bodyId);
      expect(unwrap(engine.copySnapshot())).toEqual(before);
      expect(unwrap(engine.enqueue(interactionCommand("retry"))).sequence).toBe(0);
    } finally {
      expect(engine.dispose().ok).toBe(true);
    }
  });

  // An unusable default must still allow a valid explicit limit.
  it("requires an explicit cap when the default is not representable", () => {
    const scene = makeScene(0, 0, 0, false, sceneOptions);
    const engine = unwrap(createEngine({
      ...scene,
      numericalProfile: {
        ...scene.numericalProfile,
        scales: { massKilograms: Number.MAX_VALUE, lengthMeters: Number.MAX_VALUE, timeSeconds: 1 }
      }
    }));

    try {
      expect(engine.enqueue(interactionCommand("retry")).ok).toBe(false);
      unwrap(engine.enqueue(interactionCommand("retry", 0, { maximumForceNewtons: 2 })));
      unwrap(engine.advance(1));
      expectFiniteSnapshot(unwrap(engine.copySnapshot()));
    } finally {
      expect(engine.dispose().ok).toBe(true);
    }
  });

  // Reject force overflow without changing state; reset must allow recovery.
  it("rolls back an overflowing force and clears it on reset", () => {
    const engine = unwrap(createEngine(makeScene(0, 0, 0, false, sceneOptions)));

    try {
      const before = unwrap(engine.copySnapshot());
      unwrap(engine.enqueue(interactionCommand("overflow", 0, {
        targetPositionMeters: { x: 1e308, y: 0 },
        stiffnessNewtonsPerMeter: 1e308,
        maximumForceNewtons: 2
      })));
      const result = engine.advance(1);

      expect(result.ok).toBe(false);

      if (result.ok) {
        throw new Error("Overflowing force was accepted.");
      }

      expect(result.diagnostics[0]?.code).toBe("NONFINITE_STATE");
      expect(result.diagnostics[0]?.entityId).toBe("projectile");
      expect(unwrap(engine.copySnapshot())).toEqual(before);
      expect(engine.reset().ok).toBe(true);
      expect(unwrap(engine.copySnapshot())).toEqual(before);
      unwrap(engine.advance(1));
    } finally {
      expect(engine.dispose().ok).toBe(true);
    }
  });

  // Check identical runs and reject operations after disposal.
  it("repeats force state, work and events exactly and rejects use after disposal", () => {
    const first = unwrap(createEngine(makeScene(0, 0, 0, false, sceneOptions)));
    const second = unwrap(createEngine(makeScene(0, 0, 0, false, sceneOptions)));

    try {
      for (const engine of [first, second]) {
        unwrap(engine.enqueue(interactionCommand("start")));
        unwrap(engine.enqueue(interactionCommand("update", 30, { targetPositionMeters: { x: 0, y: 1 } })));
        unwrap(engine.enqueue({ commandVersion: 1, id: "end", targetTick: 60, payload: { kind: "endForceInteraction", interactionId: "pointer" } }));
      }

      for (let tick = 0; tick < 90; tick += 1) {
        unwrap(first.advance(1));
        unwrap(second.advance(1));
        const snapshot = unwrap(first.copySnapshot());
        expectFiniteSnapshot(snapshot);
        interactionWork(snapshot);
        expect(snapshot).toEqual(unwrap(second.copySnapshot()));
      }
    } finally {
      expect(first.dispose().ok).toBe(true);
      expect(second.dispose().ok).toBe(true);
    }

    expect(first.dispose().ok).toBe(true);
    expect(first.enqueue(interactionCommand("disposed")).ok).toBe(false);
    expect(first.advance(1).ok).toBe(false);
    expect(first.copySnapshot().ok).toBe(false);
    expect(first.reset().ok).toBe(false);
  });
});
