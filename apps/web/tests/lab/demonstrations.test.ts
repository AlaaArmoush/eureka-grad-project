// Exercise the demonstration catalogue through the same public engine/controller boundary as the editor.
import { expect, it, vi } from "vitest";
import { createEngine } from "@eureka/engine";
import { createLabController } from "../../src/lab/controller.js";
import { readDemonstrations, setupParameters, unionFrames, type DemonstrationDefinition } from "../../src/lab/demonstrations.js";
import { prepareDemonstrationLoad } from "../../src/lab/demo-loading.js";
import { runPreview } from "../../src/lab/demonstration-preview.js";
import { fitCameraView, worldToScreen } from "../../src/lab/coordinates.js";

// The Topic 1 questions as stored in the seed files, read through the same check the browser uses on the server's answer.
const TOPIC_ONE_DEMONSTRATIONS = readDemonstrations(Object.values(import.meta.glob("../../../server/prisma/demonstrations/*.json", { eager: true, import: "default" })), (message) => {
  throw new Error(message);
});

const STEP_SECONDS = 1 / 60;

// Every control combination a student can pick, built from the offered options rather than a stored list.
function* everySetup(definition: DemonstrationDefinition) {
  let shared: Record<string, string>[] = [{}];

  for (const control of definition.shared) {
    shared = shared.flatMap((partial) => control.options.map((option) => ({ ...partial, [control.key]: option.value })));
  }

  for (const sharedValues of shared) {
    for (const option of definition.primary.options) {
      yield setupParameters(definition, option.value, sharedValues);
    }
  }
}

const everySetupCase = TOPIC_ONE_DEMONSTRATIONS.flatMap((definition) => [...everySetup(definition)].map((parameters) => ({ definition, parameters, name: `${definition.id} ${JSON.stringify(parameters)}` })));

// A comparison needs two distinct, offered values, and defaults for every shared setting.
it.each(TOPIC_ONE_DEMONSTRATIONS)("offers a valid reference and comparison for $id", (definition) => {
  const values = definition.primary.options.map((option) => option.value);
  expect(values).toContain(definition.reference);
  expect(values).toContain(definition.comparison);
  expect(definition.reference).not.toBe(definition.comparison);

  for (const control of definition.shared) {
    expect(control.options.map((option) => option.value)).toContain(definition.sharedDefaults[control.key]);
  }

  expect(definition.prediction.choices.length).toBeGreaterThanOrEqual(2);
  expect(definition.prediction.answerIndex).toBeLessThan(definition.prediction.choices.length);
});

it("keeps five distinct questions", () => {
  expect(TOPIC_ONE_DEMONSTRATIONS).toHaveLength(5);
  expect(new Set(TOPIC_ONE_DEMONSTRATIONS.map((definition) => definition.id)).size).toBe(5);
});

// Any setup the page can offer must be accepted by the real engine, with its own scene identity.
it("builds a valid, uniquely identified scene for every offered setup", () => {
  const ids = new Set<string>();

  for (const { definition, parameters, name } of everySetupCase) {
    const scene = definition.buildScene(parameters);
    const engine = createEngine(structuredClone(scene));
    expect(engine.ok, name).toBe(true);
    if (engine.ok) engine.value.dispose();
    ids.add(scene.id);
  }

  expect(ids.size).toBe(everySetupCase.length);
});

// The picture and the lab must show the whole launch, with a ball big enough to see, on a typical canvas.
it.each(TOPIC_ONE_DEMONSTRATIONS)("frames both setups of $id readably", (definition) => {
  const parameters = [definition.reference, definition.comparison].map((value) => setupParameters(definition, value, definition.sharedDefaults));
  const canvas = { widthPixels: 900, heightPixels: 560 };
  const frame = unionFrames(parameters.map((item) => definition.frame(item)));
  const camera = fitCameraView(frame, canvas.widthPixels, canvas.heightPixels);

  for (const item of parameters) {
    const projectile = definition.buildScene(item).bodies.find((body) => body.kind === "dynamic");
    if (projectile?.shape.kind !== "circle") throw new Error("Each setup needs a circular projectile.");
    const position = worldToScreen(projectile.pose.positionMeters, { ...canvas, ...camera });
    expect(position.x).toBeGreaterThanOrEqual(24);
    expect(position.x).toBeLessThanOrEqual(canvas.widthPixels - 24);
    expect(position.y).toBeGreaterThanOrEqual(48);
    expect(position.y).toBeLessThanOrEqual(canvas.heightPixels - 48);
    expect(2 * projectile.shape.radiusMeters * camera.pixelsPerMeter).toBeGreaterThanOrEqual(12);
  }
});

// Each cliff speed must start supported at the ledge, without a gap or penetration.
it.each(["5", "10", "20"])("places the cliff launch at %s m/s tangent to the solid ledge", (speed) => {
  const result = prepareDemonstrationLoad({ groupId: "cliff-launch", parameters: { speed } }, TOPIC_ONE_DEMONSTRATIONS);
  if (!result.ok) throw new Error("The cliff setup must initialize successfully.");
  const projectile = result.value.scene.bodies.find((body) => body.kind === "dynamic");
  const cliff = result.value.scene.bodies.find((body) => body.id === "platform-1");
  if (projectile?.shape.kind !== "circle" || cliff?.shape.kind !== "box") {
    throw new Error("The cliff needs a circular projectile and a solid rectangular body.");
  }
  expect(projectile.pose.positionMeters.y).toBe(20);
  expect(cliff.pose.positionMeters.x + cliff.shape.widthMeters / 2).toBeCloseTo(projectile.pose.positionMeters.x, 12);
  expect(cliff.pose.positionMeters.y + cliff.shape.heightMeters / 2).toBeCloseTo(projectile.pose.positionMeters.y - projectile.shape.radiusMeters, 12);
  expect(cliff.pose.positionMeters.y - cliff.shape.heightMeters / 2).toBeCloseTo(-projectile.shape.radiusMeters, 12);
});

// Setups open in the normal controller at tick zero, unchanged by resets, as the lab does with them.
it.each(TOPIC_ONE_DEMONSTRATIONS.flatMap((definition) => [definition.reference, definition.comparison].map((value) => ({
  title: `${definition.title} / ${definition.primary.label} ${value}`,
  selection: { groupId: definition.id, parameters: setupParameters(definition, value, definition.sharedDefaults) },
}))))("opens $title in the normal controller at tick zero", ({ selection }) => {
  const prepared = prepareDemonstrationLoad(selection, TOPIC_ONE_DEMONSTRATIONS);
  if (!prepared.ok) throw new Error(prepared.diagnostics.map((diagnostic) => diagnostic.message).join(" "));

  const scene = structuredClone(prepared.value.scene);
  expect(JSON.parse(JSON.stringify(scene))).toEqual(scene);
  const engineResult = createEngine(scene);
  if (!engineResult.ok) throw new Error(engineResult.diagnostics.map((diagnostic) => diagnostic.message).join(" "));

  const consumeSnapshot = vi.fn();
  const result = createLabController({ engine: engineResult.value, initialScene: scene, consumeSnapshot, releaseView: vi.fn(), nowMilliseconds: () => 0 });

  if (!result.ok) {
    engineResult.value.dispose();
    throw new Error("A valid demonstration scene must open in the normal controller.");
  }

  try {
    const controller = result.value;
    expect(controller.copyScene()).toEqual(prepared.value.scene);
    expect(controller.getPlaybackState().playing).toBe(false);
    expect(consumeSnapshot).toHaveBeenCalledWith(expect.objectContaining({ tick: 0, simulationTimeSeconds: 0 }));
    const snapshot = controller.copySnapshot();
    if (!snapshot.ok) throw new Error("A loaded demonstration must expose its initial snapshot.");
    expect(prepared.value.initialSnapshot).toEqual(snapshot.value);
    expect(snapshot.value.events).toEqual([]);
    expect(controller.reset().ok).toBe(true);
    expect(controller.copyScene()).toEqual(prepared.value.scene);
  } finally {
    result.value.dispose();
  }
});

// The page's results come from a headless run; check them against the textbook formulas, not stored numbers.
// A landing is detected on the first tick that touches the surface, so one step of motion is the tolerance.
function range(definition: DemonstrationDefinition, parameters: Record<string, string>) {
  const balls = runPreview(definition.buildScene(parameters));
  if (balls === undefined) throw new Error("The preview run must succeed.");
  return balls;
}

const byId = (id: string) => {
  const definition = TOPIC_ONE_DEMONSTRATIONS.find((item) => item.id === id);
  if (definition === undefined) throw new Error(`Missing ${id}`);
  return definition;
};

// R = v² sin(2θ)/g and T = 2 v sin θ / g for a launch from and back to the same height; mass must not matter.
it("reports the ideal range and flight time, equal for every mass", () => {
  const definition = byId("ideal-launch");
  const light = range(definition, setupParameters(definition, "1", definition.sharedDefaults))[0];
  const heavy = range(definition, setupParameters(definition, "10", definition.sharedDefaults))[0];
  const rangeFormula = 20 * 20 * Math.sin(2 * Math.PI / 6) / 9.81;
  const timeFormula = 2 * 20 * Math.sin(Math.PI / 6) / 9.81;
  const peakFormula = (20 * Math.sin(Math.PI / 6)) ** 2 / (2 * 9.81);

  expect(light?.landed).toBe(true);
  expect(light?.rangeMeters).toBeCloseTo(rangeFormula, 0);
  expect(Math.abs((light?.rangeMeters ?? 0) - rangeFormula)).toBeLessThanOrEqual(20 * STEP_SECONDS);
  expect(Math.abs((light?.flightTimeSeconds ?? 0) - timeFormula)).toBeLessThanOrEqual(2 * STEP_SECONDS);
  expect(Math.abs((light?.peakHeightMeters ?? 0) - peakFormula)).toBeLessThanOrEqual(0.2);
  expect(heavy?.rangeMeters).toBeCloseTo(light?.rangeMeters ?? NaN, 9);
  expect(heavy?.flightTimeSeconds).toBeCloseTo(light?.flightTimeSeconds ?? NaN, 9);
});

// Drag removes energy, so the same launch must go shorter and lower than without it.
it("shortens and lowers the flight when drag is added", () => {
  const definition = byId("linear-drag");
  const free = range(definition, setupParameters(definition, "0", definition.sharedDefaults))[0];
  const dragged = range(definition, setupParameters(definition, "0.5", definition.sharedDefaults))[0];

  expect(dragged?.rangeMeters).toBeLessThan(free?.rangeMeters ?? 0);
  expect(dragged?.peakHeightMeters).toBeLessThan(free?.peakHeightMeters ?? 0);
});

// Fall time from rest is t = sqrt(2h/g) = 2.02 s for 20 m, whatever the horizontal speed; range is speed × time.
it.each(["5", "10", "20"])("lands the %s m/s cliff ball after the free-fall time", (speed) => {
  const definition = byId("cliff-launch");
  const ball = range(definition, setupParameters(definition, speed, definition.sharedDefaults))[0];
  const fall = Math.sqrt(2 * 20 / 9.81);

  expect(ball?.landed).toBe(true);
  expect(Math.abs((ball?.flightTimeSeconds ?? 0) - fall)).toBeLessThanOrEqual(2 * STEP_SECONDS);
  expect(Math.abs((ball?.rangeMeters ?? 0) - Number(speed) * fall)).toBeLessThanOrEqual(Number(speed) * 2 * STEP_SECONDS);
});

// R = v² sin(2θ)/g is largest at 45° (v²/g) and smaller at 30°.
it("ranks the 45° launch above 30° and matches v²/g", () => {
  const definition = byId("angle-sweep");
  const at30 = range(definition, setupParameters(definition, "30", definition.sharedDefaults))[0];
  const at45 = range(definition, setupParameters(definition, "45", definition.sharedDefaults))[0];

  expect(at45?.rangeMeters).toBeGreaterThan(at30?.rangeMeters ?? Infinity);
  expect(Math.abs((at45?.rangeMeters ?? 0) - 400 / 9.81)).toBeLessThanOrEqual(20 * STEP_SECONDS);
});

// sin 2θ = sin 2(90° − θ): both balls of a pair share a range, and the steeper one stays up longer.
it.each(["15", "30"])("lands the %s° complementary pair together in range but not in time", (angle) => {
  const definition = byId("complementary-angles");
  const [shallow, steep] = range(definition, setupParameters(definition, angle, definition.sharedDefaults));

  expect(Math.abs((shallow?.rangeMeters ?? 0) - (steep?.rangeMeters ?? Infinity))).toBeLessThanOrEqual(20 * STEP_SECONDS);
  expect(steep?.flightTimeSeconds).toBeGreaterThan(shallow?.flightTimeSeconds ?? Infinity);
  expect(steep?.peakHeightMeters).toBeGreaterThan(shallow?.peakHeightMeters ?? Infinity);
});
