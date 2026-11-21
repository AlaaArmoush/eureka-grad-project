// Register the cases and check public results.
import { expect, it } from "vitest";
// Type the scene bodies, scheduled launch, and public snapshots.
import type { Command, DynamicCircleBody, SceneDefinition, Snapshot, SnapshotBody, StaticBody } from "@eureka/contracts";
// Open a run through the public engine API.
import { createEngine } from "../../src/index.js";
// Read successful results and compare finite numbers within fixed bounds.
import { expectNear, unwrap } from "../test-support.js";

// Keep the corridor geometry fixed while each test chooses its speed and substeps.
function makeCorridorScene(speedMetersPerSecond: number, substeps = 1): SceneDefinition {
  const walls = [
    { id: "left-wall", x: -0.5 },
    { id: "right-wall", x: 2.5 },
  ];
  const circles = [
    { id: "observer-circle", x: 0, y: 3, velocityX: 3 },
    { id: "puck", x: 1, y: 0, velocityX: speedMetersPerSecond },
  ];

  return {
    schemaVersion: 1,
    id: "elastic-puck-corridor",
    revision: 1,
    seed: 17,
    numericalProfile: {
      fixedTimeStepSeconds: 1 / 60,
      substeps,
      restitutionSpeedThresholdMetersPerSecond: 0,
      scales: { lengthMeters: 1, massKilograms: 1, timeSeconds: 1 },
    },
    environment: {
      gravityMetersPerSecondSquared: { x: 0, y: 0 },
      linearDragKilogramsPerSecond: 0,
    },
    bodies: [
      ...walls.map<StaticBody>(({ id, x }) => ({
        id,
        kind: "static",
        shape: { kind: "box", widthMeters: 1, heightMeters: 2 },
        material: { restitution: 1 },
        pose: { positionMeters: { x, y: 0 }, angleRadians: 0 },
      })),
      ...circles.map<DynamicCircleBody>(({ id, x, y, velocityX }) => ({
        id,
        kind: "dynamic",
        shape: { kind: "circle", radiusMeters: 0.5 },
        massKilograms: 1,
        material: { restitution: 1 },
        pose: { positionMeters: { x, y }, angleRadians: 0 },
        velocity: {
          linearMetersPerSecond: { x: velocityX, y: 0 },
          angularRadiansPerSecond: 0,
        },
      })),
    ],
    triggers: [],
  };
}

// Schedule a launch for the transition from tick 1 to tick 2.
function makeCorridorLaunch(speedMetersPerSecond: number): Command {
  return {
    commandVersion: 1,
    id: "launch-corridor-puck",
    targetTick: 1,
    payload: {
      kind: "launchBody",
      bodyId: "puck",
      positionMeters: { x: 1, y: 0 },
      velocity: {
        linearMetersPerSecond: { x: speedMetersPerSecond, y: 0 },
        angularRadiansPerSecond: 0,
      },
    },
  };
}

// Find a body by its stable ID in the current public snapshot.
function readBody(snapshot: Snapshot, id: string): SnapshotBody {
  const body = snapshot.bodies.find((candidate) => candidate.id === id);
  if (body === undefined) {
    throw new Error(`Expected ${id} in the snapshot at tick ${snapshot.tick}.`);
  }

  return body;
}it.each([
  // Eight impacts fit in one substep and leave the puck moving right.
  { name: "completes eight impacts in one substep", speed: 480, substeps: 1, expectedX: 1, expectedVX: 480 },
  // Nine impacts fit across two substeps and leave the puck moving left.
  { name: "allows nine impacts across two substeps", speed: 552, substeps: 2, expectedX: 0.8, expectedVX: -552 },
])("$name", ({ speed, substeps, expectedX, expectedVX }) => {
  const engine = unwrap(createEngine(makeCorridorScene(speed, substeps)));

  try {
    unwrap(engine.advance(1));
    const snapshot = unwrap(engine.getSnapshot());
    const puck = readBody(snapshot, "puck");

    expect(snapshot.tick).toBe(1);
    expectNear(puck.pose.positionMeters.x, expectedX, 2e-6);
    expectNear(puck.velocity.linearMetersPerSecond.x, expectedVX, 1e-10 + 1e-8 * speed);
  } finally {
    expect(engine.dispose().ok).toBe(true);
  }
});// Catch a ninth impact that commits any of the attempted tick.
it("keeps the last committed tick when a ninth impact exceeds the limit", () => {
  const engine = unwrap(createEngine(makeCorridorScene(60)));

  try {
    unwrap(engine.advance(1));
    const lastValid = unwrap(engine.copySnapshot());
    const puck = readBody(lastValid, "puck");
    const observer = readBody(lastValid, "observer-circle");

    expect(lastValid.tick).toBe(1);
    expectNear(puck.pose.positionMeters.x, 1, 2.5e-7);
    expectNear(puck.velocity.linearMetersPerSecond.x, -60, 6.01e-7);
    expectNear(observer.pose.positionMeters.x, 0.05, 1.01e-8);
    expect(lastValid.events.some(
      (event) => event.kind === "groundContact" && event.bodyId === "puck" && event.surfaceBodyId === "right-wall",
    )).toBe(true);

    unwrap(engine.enqueue(makeCorridorLaunch(552)));

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const advance = engine.advance(1);
      if (advance.ok) {
        throw new Error(`Attempt ${attempt} committed tick 2 despite the ninth impact.`);
      }

      expect(advance.diagnostics[0]).toMatchObject({
        code: "UNRESOLVED_EVENT_LIMIT",
        entityId: "puck",
      });
      expect(unwrap(engine.copySnapshot())).toEqual(lastValid);
    }
  } finally {
    expect(engine.dispose().ok).toBe(true);
  }
});// Walk the public snapshot data and report the location of any nonfinite number.
function expectFiniteNumbers(value: unknown, path: string): void {
  if (typeof value === "number") {
    expect(Number.isFinite(value), path).toBe(true);
    return;
  }

  if (typeof value === "object" && value !== null) {
    for (const [key, child] of Object.entries(value)) {
      expectFiniteNumbers(child, `${path}.${key}`);
    }
  }
}

// Capture every tick, including finite values and actual wall events.
function recordCorridorHistory(): Snapshot[] {
  const engine = unwrap(createEngine(makeCorridorScene(60)));
  const history: Snapshot[] = [];

  try {
    unwrap(engine.enqueue(makeCorridorLaunch(120)));

    for (let tick = 0; tick <= 6; tick += 1) {
      if (tick > 0) {
        unwrap(engine.advance(1));
      }

      const snapshot = unwrap(engine.copySnapshot());
      const puck = readBody(snapshot, "puck");
      const wallIds = snapshot.events.flatMap((event) =>
        event.kind === "groundContact" && event.bodyId === "puck" ? [event.surfaceBodyId] : [],
      );
      const expectedWalls = tick === 0 ? [] : tick === 1 ? ["right-wall"] : ["right-wall", "left-wall"];
      const expectedVX = tick === 0 ? 60 : tick === 1 ? -60 : 120;

      expect(snapshot.tick).toBe(tick);
      expect(wallIds).toEqual(expectedWalls);
      expectNear(puck.pose.positionMeters.x, 1, 2.5e-7);
      expectNear(puck.velocity.linearMetersPerSecond.x, expectedVX, 1e-10 + 1e-8 * Math.abs(expectedVX));
      expectFiniteNumbers(snapshot, `tick ${tick}`);

      history.push(snapshot);
    }

    return history;
  } finally {
    expect(engine.dispose().ok).toBe(true);
  }
}

// Catch any difference in state, events, or diagnostics between matching runs.
it("repeats the same wall contacts and snapshots at every tick", () => {
  expect(recordCorridorHistory()).toEqual(recordCorridorHistory());
});