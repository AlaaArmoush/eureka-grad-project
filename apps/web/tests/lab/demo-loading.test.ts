// Test content preparation and replacement semantics without advancing the solver.
import { expect, it } from "vitest";
import { prepareDemonstrationLoad } from "../../src/lab/demo-loading.js";
import { readDemonstrations, setupParameters } from "../../src/lab/demonstrations.js";
import { updateEnvironmentInScene } from "../../src/lab/authoring.js";
import { labStore } from "../../src/lab/store.js";

// The Topic 1 questions as stored in the seed files, read through the same check the browser uses on the server's answer.
const TOPIC_ONE_DEMONSTRATIONS = readDemonstrations(Object.values(import.meta.glob("../../../server/prisma/demonstrations/*.json", { eager: true, import: "default" })), (message) => {
  throw new Error(message);
});

const angleSweep = TOPIC_ONE_DEMONSTRATIONS.find((group) => group.id === "angle-sweep");

// A stale link or a hand-edited value must fail without changing the editor state.
it.each([
  { name: "an unknown question", selection: { groupId: "missing-group", parameters: {} } },
  { name: "a value that is not offered", selection: { groupId: "cliff-launch", parameters: { speed: "999" } } },
  { name: "a missing setting", selection: { groupId: "angle-sweep", parameters: { angle: "45" } } },
])("rejects $name without changing the view", ({ selection }) => {
  const before = labStore.getState();
  expect(prepareDemonstrationLoad(selection, TOPIC_ONE_DEMONSTRATIONS)).toMatchObject({ ok: false, diagnostics: [{ code: "OUT_OF_RANGE" }] });
  expect(labStore.getState()).toBe(before);
});

// The saved physical profile and seed are scene data; preparing a setup never touches playback or the live view.
it("prepares the scene's profile and seed independently of editor state", () => {
  const before = labStore.getState();
  const result = prepareDemonstrationLoad({ groupId: "linear-drag", parameters: { drag: "0.5", mass: "10" } }, TOPIC_ONE_DEMONSTRATIONS);
  if (!result.ok) throw new Error("The drag setup must load.");

  expect(result.value.scene.numericalProfile).toEqual({
    fixedTimeStepSeconds: 1 / 60,
    substeps: 1,
    scales: { lengthMeters: 1, massKilograms: 1, timeSeconds: 1 },
  });
  expect(result.value.scene.environment.linearDragKilogramsPerSecond).toBe(0.5);
  expect(result.value.scene.seed).toBe(17);
  expect(result.value.initialSnapshot.tick).toBe(0);
  expect(result.value.initialSnapshot.simulationTimeSeconds).toBe(0);
  expect(labStore.getState()).toBe(before);
});

// Restore rebuilds from the choice itself, never from an edited run, and shares no mutable data.
it("restores the chosen setup with independent scene, snapshot and view data", () => {
  if (angleSweep === undefined) throw new Error("The angle question must exist.");
  const selection = { groupId: "angle-sweep", parameters: setupParameters(angleSweep, "60", { speed: "30" }) };
  const first = prepareDemonstrationLoad(selection, TOPIC_ONE_DEMONSTRATIONS);
  if (!first.ok) throw new Error("The chosen setup must prepare successfully.");

  const edited = updateEnvironmentInScene(first.value.scene, {
    gravityMetersPerSecondSquared: { x: 0, y: 0 },
    linearDragKilogramsPerSecond: 0.5,
  });
  const restored = prepareDemonstrationLoad(selection, TOPIC_ONE_DEMONSTRATIONS);
  if (!restored.ok) throw new Error("Restoring an existing setup must succeed.");

  expect(edited.environment).not.toEqual(restored.value.scene.environment);
  expect(restored.value.scene).toEqual(first.value.scene);
  expect(restored.value.scene).not.toBe(first.value.scene);
  expect(restored.value.scene.bodies).not.toBe(first.value.scene.bodies);
  expect(restored.value.initialSnapshot).not.toBe(first.value.initialSnapshot);
  expect(restored.value.camera).toEqual(first.value.camera);
  expect(restored.value.camera.centerWorldMeters).not.toBe(first.value.camera.centerWorldMeters);
  expect(restored.value.overlays).toEqual(angleSweep.overlays);
  expect(restored.value.overlays).not.toBe(angleSweep.overlays);
  expect(restored.value.selection).not.toBe(selection);
  expect(restored.value.title).toBe(angleSweep.title);
});

// Switching from a cliff to a flat launch must not carry old objects or events.
it("prepares only the next setup's objects, readouts and empty event history", () => {
  const cliff = prepareDemonstrationLoad({ groupId: "cliff-launch", parameters: { speed: "20" } }, TOPIC_ONE_DEMONSTRATIONS);
  const flat = prepareDemonstrationLoad({ groupId: "ideal-launch", parameters: { mass: "1", speed: "20", gravity: "9.81" } }, TOPIC_ONE_DEMONSTRATIONS);
  if (!cliff.ok || !flat.ok) throw new Error("Both setups must load.");

  expect(cliff.value.scene.bodies.map((body) => body.id)).toContain("platform-1");
  expect(flat.value.scene.bodies.map((body) => body.id)).toEqual(["default-ground", "projectile-1"]);
  expect(flat.value.initialSnapshot.projectileReadouts.map((readout) => readout.bodyId)).toEqual(["projectile-1"]);
  expect(flat.value.initialSnapshot.events).toEqual([]);
  expect(flat.value.selectedEntityId).toBe("projectile-1");
});
