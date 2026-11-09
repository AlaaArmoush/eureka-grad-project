import { describe, expect, it } from "vitest";
import type {
  StaticBody,
  TargetTrigger
} from "@eureka/contracts";
import { expectNear } from "../test-support.js";
import {
  GRAVITY,
  TIME_STEP,
  makeScene
} from "./scene-fixtures.js";
import {
  measureLanding,
  observeFirstEvent
} from "./projectile-test-support.js";
import { createEngine } from "../../src/index.js";

// Freeze the reference launch and geometry before solver implementation.
const SPEED = 10;
const LAUNCH_ANGLE = Math.PI / 4;
const RAMP_ANGLE = Math.PI / 12;
const PROJECTILE_RADIUS = 0.1;
const TARGET_RADIUS = 0.2;
const SWEEP_POSITION_TOLERANCE = 1e-7;
const EVENT_TIME_TOLERANCE = 1e-8;
const EVENT_TICK_LIMIT = Math.ceil(1.2 / TIME_STEP) + 1;
const EXPECTED_SIMULTANEOUS_EVENT_TIME = 0.09;

const EXPECTED_POINT_X = 7.462291616400381;
const EXPECTED_POINT_TIME = 1.0553274010296465;

const EXPECTED_TARGET_ENTRY = {
  time: 1.0164529356368988,
  x: 7.187407635458245,
  y: 2.1196765578185586
};

const EXPECTED_RAMP_CONTACT = {
  time: 1.0349332864554788,
  pointX: 7.34396535379374,
  pointY: 1.9678095857911748
};

// The standard ground top is one projectile radius below centre contact height.
const GROUND_SURFACE_Y = -0.1;
const THIN_TARGET_SPEED = 100;
const THIN_TARGET_RADIUS = 0.01;
const EXPECTED_THIN_TARGET_ENTRY_TIME = 0.0089;
const EXPECTED_DOWNWARD_CONTACT_TIME = 0.30733801873654965;
const EXPECTED_ABOVE_GROUND_CONTACT_TIME = 0.04515236409857309;

// Evaluate the ideal reference trajectory independently of the engine.
function projectileStateAt(timeSeconds: number): {
  x: number;
  y: number;
  vx: number;
  vy: number;
} {
  const vx = SPEED * Math.cos(LAUNCH_ANGLE);
  const initialVy = SPEED * Math.sin(LAUNCH_ANGLE);

  return {
    x: vx * timeSeconds,
    y:
      initialVy * timeSeconds -
      0.5 * GRAVITY * timeSeconds * timeSeconds,
    vx,
    vy: initialVy - GRAVITY * timeSeconds
  };
}

// Bisect circle-circle entry using analytic projectile positions only.
function targetEntryReference(
  targetX: number,
  targetY: number,
  pointIntersectionTime: number
): { time: number; x: number; y: number } {
  const combinedRadius = PROJECTILE_RADIUS + TARGET_RADIUS;
  let lowerTime = 0;
  let upperTime = pointIntersectionTime;

  for (let iteration = 0; iteration < 60; iteration += 1) {
    const middleTime = 0.5 * (lowerTime + upperTime);
    const state = projectileStateAt(middleTime);
    const separation = Math.hypot(
      state.x - targetX,
      state.y - targetY
    );

    if (separation > combinedRadius) {
      lowerTime = middleTime;
    } else {
      upperTime = middleTime;
    }
  }

  const time = 0.5 * (lowerTime + upperTime);
  const state = projectileStateAt(time);

  return { time, x: state.x, y: state.y };
}

// Select the descending solution of the radius-offset incline equation.
function rampContactReference(): {
  time: number;
  pointX: number;
  pointY: number;
} {
  const normalSpeed =
    SPEED * Math.sin(LAUNCH_ANGLE - RAMP_ANGLE);
  const normalY = Math.cos(RAMP_ANGLE);
  const discriminant =
    normalSpeed * normalSpeed -
    2 * GRAVITY * normalY * PROJECTILE_RADIUS;

  const time =
    (normalSpeed + Math.sqrt(discriminant)) /
    (GRAVITY * normalY);
  const state = projectileStateAt(time);

  return {
    time,
    pointX:
      state.x + PROJECTILE_RADIUS * Math.sin(RAMP_ANGLE),
    pointY:
      state.y - PROJECTILE_RADIUS * Math.cos(RAMP_ANGLE)
  };
}

// Build a vertical wall whose left face is at the requested x-coordinate.
function makeVerticalWall(
  id: string,
  leftFaceX: number
): StaticBody {
  const width = 0.2;

  return {
    id,
    kind: "static",
    shape: {
      kind: "box",
      widthMeters: width,
      heightMeters: 10
    },
    material: { restitution: 0 },
    pose: {
      positionMeters: {
        x: leftFaceX + 0.5 * width,
        y: 0
      },
      angleRadians: 0
    }
  };
}

describe("projectile targets and surfaces", () => {
  // Protect the analytic incline point and non-solid target entry.
  it("enters the incline target without changing projectile motion", () => {
    const pointX =
      (
        2 *
        SPEED *
        SPEED *
        Math.cos(LAUNCH_ANGLE) ** 2 *
        (Math.tan(LAUNCH_ANGLE) - Math.tan(RAMP_ANGLE))
      ) / GRAVITY;
    const pointTime =
      pointX / (SPEED * Math.cos(LAUNCH_ANGLE));
    const pointY = pointX * Math.tan(RAMP_ANGLE);

    // Frozen values independently check the formula materialization.
    expectNear(pointX, EXPECTED_POINT_X, 1e-12);
    expectNear(pointTime, EXPECTED_POINT_TIME, 1e-12);

    const target: TargetTrigger = {
      id: "incline-target",
      kind: "target",
      shape: {
        kind: "circle",
        radiusMeters: TARGET_RADIUS
      },
      pose: {
        positionMeters: { x: pointX, y: pointY },
        angleRadians: 0
      }
    };

    const expectedEntry = targetEntryReference(
      pointX,
      pointY,
      pointTime
    );

    expectNear(
      expectedEntry.time,
      EXPECTED_TARGET_ENTRY.time,
      1e-12
    );
    expectNear(expectedEntry.x, EXPECTED_TARGET_ENTRY.x, 1e-12);
    expectNear(expectedEntry.y, EXPECTED_TARGET_ENTRY.y, 1e-12);

    const observed = observeFirstEvent(
      makeScene(10, 45, 0, false, {
        projectileRadiusMeters: PROJECTILE_RADIUS,
        triggers: [target]
      }),
      EVENT_TICK_LIMIT,
      (event) =>
        event.kind === "targetEntered" &&
        event.targetId === target.id
    );

    if (observed.event.kind !== "targetEntered") {
      throw new Error("Expected a target-entry event.");
    }

    expect(observed.event.id).not.toBe("");
    expect(observed.event.tick).toBe(observed.snapshot.tick);
    expect(observed.event.bodyId).toBe("projectile");
    expect(observed.event.targetId).toBe("incline-target");
    expectNear(
      observed.event.timeSeconds,
      expectedEntry.time,
      EVENT_TIME_TOLERANCE
    );

    // Convert event-time error into spatial localization error.
    const eventState = projectileStateAt(
      observed.event.timeSeconds
    );

    expectNear(
      Math.hypot(
        eventState.x - expectedEntry.x,
        eventState.y - expectedEntry.y
      ),
      0,
      SWEEP_POSITION_TOLERANCE
    );

    const projectile = observed.snapshot.bodies.find(
      (body) => body.id === "projectile"
    );

    if (projectile === undefined) {
      throw new Error("Snapshot omitted the projectile.");
    }

    // The post-entry tick state must remain ideal: the sensor adds no impulse.
    const expectedTickState = projectileStateAt(
      observed.snapshot.simulationTimeSeconds
    );

    expectNear(
      Math.hypot(
        projectile.pose.positionMeters.x - expectedTickState.x,
        projectile.pose.positionMeters.y - expectedTickState.y
      ),
      0,
      1e-9
    );
    expectNear(
      Math.hypot(
        projectile.velocity.linearMetersPerSecond.x -
        expectedTickState.vx,
        projectile.velocity.linearMetersPerSecond.y -
        expectedTickState.vy
      ),
      0,
      1e-9
    );
  });

  // Protect finite-radius contact with the rotated-box ramp.
  it("contacts the incline at the radius-offset point", () => {
    const reference = rampContactReference();

    expectNear(
      reference.time,
      EXPECTED_RAMP_CONTACT.time,
      1e-12
    );
    expectNear(
      reference.pointX,
      EXPECTED_RAMP_CONTACT.pointX,
      1e-12
    );
    expectNear(
      reference.pointY,
      EXPECTED_RAMP_CONTACT.pointY,
      1e-12
    );

    const rampTopMidpoint = {
      x: 10,
      y: 10 * Math.tan(RAMP_ANGLE)
    };
    const rampThickness = 0.2;

    const ramp: StaticBody = {
      id: "incline-ramp",
      kind: "static",
      shape: {
        kind: "box",
        widthMeters: 12,
        heightMeters: rampThickness
      },
      material: { restitution: 0 },
      pose: {
        positionMeters: {
          x:
            rampTopMidpoint.x +
            0.5 * rampThickness * Math.sin(RAMP_ANGLE),
          y:
            rampTopMidpoint.y -
            0.5 * rampThickness * Math.cos(RAMP_ANGLE)
        },
        angleRadians: RAMP_ANGLE
      }
    };

    const observed = observeFirstEvent(
      makeScene(10, 45, 0, false, {
        projectileRadiusMeters: PROJECTILE_RADIUS,
        surfaces: [ramp]
      }),
      EVENT_TICK_LIMIT,
      (event) =>
        event.kind === "groundContact" &&
        event.surfaceBodyId === ramp.id
    );

    if (observed.event.kind !== "groundContact") {
      throw new Error("Expected a physical surface-contact event.");
    }

    expect(observed.event.id).not.toBe("");
    expect(observed.event.tick).toBe(observed.snapshot.tick);
    expect(observed.event.bodyId).toBe("projectile");
    expect(observed.event.surfaceBodyId).toBe("incline-ramp");
    expectNear(
      observed.event.timeSeconds,
      reference.time,
      EVENT_TIME_TOLERANCE
    );
    expectNear(
      Math.hypot(
        observed.event.pointMeters.x - reference.pointX,
        observed.event.pointMeters.y - reference.pointY
      ),
      0,
      SWEEP_POSITION_TOLERANCE
    );
    expectNear(
      Math.hypot(
        observed.event.normal.x + Math.sin(RAMP_ANGLE),
        observed.event.normal.y - Math.cos(RAMP_ANGLE)
      ),
      0,
      1e-10
    );
  });

  // Detect a thin sensor even though the projectile crosses it within one tick.
  it("detects a thin target crossed within one tick", () => {
    const target: TargetTrigger = {
      id: "thin-target",
      kind: "target",
      shape: {
        kind: "circle",
        radiusMeters: THIN_TARGET_RADIUS
      },
      pose: {
        positionMeters: { x: 1, y: 0 },
        angleRadians: 0
      }
    };

    const combinedRadius =
      PROJECTILE_RADIUS + THIN_TARGET_RADIUS;
    const expectedEntryX =
      target.pose.positionMeters.x - combinedRadius;
    const expectedEntryTime =
      expectedEntryX / THIN_TARGET_SPEED;

    expectNear(
      expectedEntryTime,
      EXPECTED_THIN_TARGET_ENTRY_TIME,
      1e-12
    );

    const observed = observeFirstEvent(
      makeScene(THIN_TARGET_SPEED, 0, 0, false, {
        projectileRadiusMeters: PROJECTILE_RADIUS,
        gravityMetersPerSecondSquared: { x: 0, y: 0 },
        triggers: [target]
      }),
      1,
      (event) =>
        event.kind === "targetEntered" &&
        event.targetId === target.id
    );

    if (observed.event.kind !== "targetEntered") {
      throw new Error("Expected a thin-target entry event.");
    }

    expect(observed.event.id).not.toBe("");
    expect(observed.event.tick).toBe(observed.snapshot.tick);
    expect(observed.event.bodyId).toBe("projectile");
    expect(observed.event.targetId).toBe("thin-target");
    expect(observed.event.timeSeconds).toBeLessThan(TIME_STEP);
    expectNear(
      observed.event.timeSeconds,
      expectedEntryTime,
      EVENT_TIME_TOLERANCE
    );

    // Event-time localization must agree with the analytic entry position.
    expectNear(
      THIN_TARGET_SPEED * observed.event.timeSeconds,
      expectedEntryX,
      SWEEP_POSITION_TOLERANCE
    );

    const projectile = observed.snapshot.bodies.find(
      (body) => body.id === "projectile"
    );

    if (projectile === undefined) {
      throw new Error("Snapshot omitted the projectile.");
    }

    // By tick end the projectile is beyond the target, proving swept detection.
    expect(projectile.pose.positionMeters.x).toBeGreaterThan(
      target.pose.positionMeters.x + combinedRadius
    );

    // The target must not alter the zero-gravity motion.
    expectNear(
      projectile.pose.positionMeters.x,
      THIN_TARGET_SPEED *
      observed.snapshot.simulationTimeSeconds,
      1e-9
    );
    expectNear(projectile.pose.positionMeters.y, 0, 1e-9);
    expectNear(
      projectile.velocity.linearMetersPerSecond.x,
      THIN_TARGET_SPEED,
      1e-9
    );
    expectNear(
      projectile.velocity.linearMetersPerSecond.y,
      0,
      1e-9
    );
  });

  // Localize a downward launch against the explicit ground surface.
  it("contacts the ground during a downward launch", () => {
    // Solve 2 - 5t - gt²/2 = 0 for the positive root.
    const expectedTime =
      (-5 + Math.sqrt(25 + 4 * GRAVITY)) / GRAVITY;

    expectNear(
      expectedTime,
      EXPECTED_DOWNWARD_CONTACT_TIME,
      1e-12
    );

    const landing = measureLanding(
      makeScene(5, -90, 2, true),
      expectedTime
    );

    expect(landing.event.id).not.toBe("");
    expect(landing.event.tick).toBe(landing.snapshot.tick);
    expect(landing.event.bodyId).toBe("projectile");
    expect(landing.event.surfaceBodyId).toBe("ground");
    expectNear(
      landing.time,
      expectedTime,
      EVENT_TIME_TOLERANCE
    );
    expectNear(
      landing.event.pointMeters.x,
      0,
      SWEEP_POSITION_TOLERANCE
    );
    expectNear(
      landing.event.pointMeters.y,
      GROUND_SURFACE_Y,
      SWEEP_POSITION_TOLERANCE
    );
    expectNear(landing.event.normal.x, 0, 1e-10);
    expectNear(landing.event.normal.y, 1, 1e-10);
  });

  // Exact tangency is valid contact, not initial penetration.
  it("reports a projectile initially tangent to the ground", () => {
    const landing = measureLanding(
      makeScene(5, 0, 0, true),
      0
    );

    expect(landing.event.id).not.toBe("");
    expect(landing.event.tick).toBe(landing.snapshot.tick);
    expect(landing.event.bodyId).toBe("projectile");
    expect(landing.event.surfaceBodyId).toBe("ground");
    expectNear(landing.time, 0, 1e-12);
    expectNear(
      landing.event.pointMeters.x,
      0,
      SWEEP_POSITION_TOLERANCE
    );
    expectNear(
      landing.event.pointMeters.y,
      GROUND_SURFACE_Y,
      SWEEP_POSITION_TOLERANCE
    );
    expectNear(landing.event.normal.x, 0, 1e-10);
    expectNear(landing.event.normal.y, 1, 1e-10);
  });

  // A positive initial gap must produce a later event rather than tangency.
  it("falls from just above the ground before making contact", () => {
    // From rest, gap = gt²/2.
    const expectedTime = Math.sqrt(2 * 0.01 / GRAVITY);

    expectNear(
      expectedTime,
      EXPECTED_ABOVE_GROUND_CONTACT_TIME,
      1e-12
    );

    const landing = measureLanding(
      makeScene(0, 0, 0.01, true),
      expectedTime
    );

    expect(landing.event.id).not.toBe("");
    expect(landing.event.tick).toBe(landing.snapshot.tick);
    expect(landing.event.bodyId).toBe("projectile");
    expect(landing.event.surfaceBodyId).toBe("ground");
    expect(landing.time).toBeGreaterThan(0);
    expectNear(
      landing.time,
      expectedTime,
      EVENT_TIME_TOLERANCE
    );
    expectNear(
      landing.event.pointMeters.x,
      0,
      SWEEP_POSITION_TOLERANCE
    );
    expectNear(
      landing.event.pointMeters.y,
      GROUND_SURFACE_Y,
      SWEEP_POSITION_TOLERANCE
    );
    expectNear(landing.event.normal.x, 0, 1e-10);
    expectNear(landing.event.normal.y, 1, 1e-10);
  });

  // A tangent, parallel wall motion is contact without penetration.
  it("reports a projectile grazing a vertical wall", () => {
    const wall = makeVerticalWall("graze-wall", 2);

    const observed = observeFirstEvent(
      makeScene(5, 90, 0, false, {
        projectileRadiusMeters: PROJECTILE_RADIUS,
        horizontalPositionMeters: 1.9,
        gravityMetersPerSecondSquared: { x: 0, y: 0 },
        surfaces: [wall]
      }),
      1,
      (event) =>
        event.kind === "groundContact" &&
        event.surfaceBodyId === wall.id
    );

    if (observed.event.kind !== "groundContact") {
      throw new Error("Expected a wall-graze contact event.");
    }

    expect(observed.event.id).not.toBe("");
    expect(observed.event.tick).toBe(observed.snapshot.tick);
    expect(observed.event.bodyId).toBe("projectile");
    expect(observed.event.surfaceBodyId).toBe("graze-wall");
    expectNear(observed.event.timeSeconds, 0, 1e-12);
    expectNear(
      observed.event.pointMeters.x,
      2,
      SWEEP_POSITION_TOLERANCE
    );
    expectNear(
      observed.event.pointMeters.y,
      0,
      SWEEP_POSITION_TOLERANCE
    );
    expectNear(observed.event.normal.x, -1, 1e-10);
    expectNear(observed.event.normal.y, 0, 1e-10);

    const projectile = observed.snapshot.bodies.find(
      (body) => body.id === "projectile"
    );

    if (projectile === undefined) {
      throw new Error("Snapshot omitted the projectile.");
    }

    // Zero normal speed means the graze must not create a normal impulse.
    expectNear(
      projectile.velocity.linearMetersPerSecond.x,
      0,
      1e-10
    );
    expectNear(
      projectile.velocity.linearMetersPerSecond.y,
      5,
      1e-10
    );
  });

  // Preserve deterministic ordering when sensor entry and contact share one TOI.
  it("orders target entry before simultaneous wall contact", () => {
    const wall = makeVerticalWall("tie-wall", 1);
    const target: TargetTrigger = {
      id: "tie-target",
      kind: "target",
      shape: {
        kind: "circle",
        radiusMeters: 0.1
      },
      pose: {
        positionMeters: { x: 1.1, y: 0 },
        angleRadians: 0
      }
    };

    // Both boundaries are reached when the projectile centre reaches x = 0.9 m.
    const expectedTime = 0.9 / 10;

    expectNear(
      expectedTime,
      EXPECTED_SIMULTANEOUS_EVENT_TIME,
      1e-12
    );

    const observed = observeFirstEvent(
      makeScene(10, 0, 0, false, {
        projectileRadiusMeters: PROJECTILE_RADIUS,
        gravityMetersPerSecondSquared: { x: 0, y: 0 },
        surfaces: [wall],
        triggers: [target]
      }),
      Math.ceil(expectedTime / TIME_STEP) + 1,
      (event) =>
        (
          event.kind === "targetEntered" &&
          event.targetId === target.id
        ) ||
        (
          event.kind === "groundContact" &&
          event.surfaceBodyId === wall.id
        )
    );

    const relevantEvents = observed.snapshot.events.filter(
      (event) =>
        (
          event.kind === "targetEntered" &&
          event.targetId === target.id
        ) ||
        (
          event.kind === "groundContact" &&
          event.surfaceBodyId === wall.id
        )
    );

    expect(relevantEvents).toHaveLength(2);
    expect(relevantEvents.map((event) => event.kind)).toEqual([
      "targetEntered",
      "groundContact"
    ]);

    const targetEvent = relevantEvents[0];
    const contactEvent = relevantEvents[1];

    if (
      targetEvent?.kind !== "targetEntered" ||
      contactEvent?.kind !== "groundContact"
    ) {
      throw new Error("Simultaneous events have the wrong order.");
    }

    expect(targetEvent.id).not.toBe("");
    expect(contactEvent.id).not.toBe("");
    expect(targetEvent.id).not.toBe(contactEvent.id);

    expect(targetEvent.tick).toBe(observed.snapshot.tick);
    expect(contactEvent.tick).toBe(observed.snapshot.tick);
    expect(targetEvent.bodyId).toBe("projectile");
    expect(targetEvent.targetId).toBe("tie-target");
    expect(contactEvent.bodyId).toBe("projectile");
    expect(contactEvent.surfaceBodyId).toBe("tie-wall");

    expectNear(
      targetEvent.timeSeconds,
      expectedTime,
      EVENT_TIME_TOLERANCE
    );
    expectNear(
      contactEvent.timeSeconds,
      expectedTime,
      EVENT_TIME_TOLERANCE
    );
    expectNear(
      targetEvent.timeSeconds,
      contactEvent.timeSeconds,
      1e-12
    );

    expectNear(
      contactEvent.pointMeters.x,
      1,
      SWEEP_POSITION_TOLERANCE
    );
    expectNear(
      contactEvent.pointMeters.y,
      0,
      SWEEP_POSITION_TOLERANCE
    );
    expectNear(contactEvent.normal.x, -1, 1e-10);
    expectNear(contactEvent.normal.y, 0, 1e-10);
  });

  // Initial penetration must be rejected before any state is advanced.
  it("rejects a projectile starting inside the ground", () => {
    const result = createEngine(
      makeScene(0, 0, -0.01, true)
    );

    // Dispose defensively if the current unsupported behavior accepts the scene.
    if (result.ok) {
      expect(result.value.dispose().ok).toBe(true);
      throw new Error("Expected initial-overlap rejection.");
    }

    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toMatchObject({
      code: "INVALID_INITIAL_OVERLAP",
      path: "bodies[0].pose.positionMeters",
      entityId: "projectile"
    });
  });
});
