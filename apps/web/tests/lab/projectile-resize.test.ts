// Resizing a ball must keep a supported ball on its surface instead of leaving it overlapping.
import { expect, it } from "vitest";
import { validateScene } from "@eureka/engine";
import { addPlatformToScene, addProjectileToScene, DEFAULT_PROJECTILE_PROPERTIES, updateProjectileInScene } from "../../src/lab/authoring.js";
import { prepareDemonstrationLoad } from "../../src/lab/demo-loading.js";

function sceneWithBallOnPlatform(ballY: number) {
  const loaded = prepareDemonstrationLoad({ groupId: "angle-sweep", parameters: { angle: "45", speed: "20" } });
  if (!loaded.ok) throw new Error("The reference scene must load.");
  // Remove the demonstration ground so the platform is the only surface under the ball.
  const bare = { ...loaded.value.scene, bodies: [] };
  const withPlatform = addPlatformToScene(bare, { x: 0, y: 0 }, { widthMeters: 10, heightMeters: 1, restitution: 0 }).scene;
  return addProjectileToScene(withPlatform, { x: 0, y: ballY }, { ...DEFAULT_PROJECTILE_PROPERTIES, radiusMeters: 0.1 }).scene;
}

// The platform top is y = 0.5, so a radius r ball resting on it has its centre at y = 0.5 + r.
it.each([0.25, 0.5, 1.5])("keeps a ball resting on a platform supported when its radius becomes %f", (radius) => {
  const scene = sceneWithBallOnPlatform(0.5 + 0.1);
  const resized = updateProjectileInScene(scene, "projectile-1", { ...DEFAULT_PROJECTILE_PROPERTIES, radiusMeters: radius }).scene;
  const ball = resized.bodies.find((body) => body.id === "projectile-1");

  expect(ball?.pose.positionMeters.y).toBeCloseTo(0.5 + radius, 12);
  expect(ball?.pose.positionMeters.x).toBe(0);
  expect(validateScene(resized).ok).toBe(true);
});

// A ball that is clearly in the air has no support, so resizing must not move it.
it("leaves a ball that is not touching any surface where it was", () => {
  const scene = sceneWithBallOnPlatform(3);
  const resized = updateProjectileInScene(scene, "projectile-1", { ...DEFAULT_PROJECTILE_PROPERTIES, radiusMeters: 0.4 }).scene;

  expect(resized.bodies.find((body) => body.id === "projectile-1")?.pose.positionMeters).toEqual({ x: 0, y: 3 });
});

// A ball at the edge of the cliff demonstration must also stay on the ledge when enlarged.
it("keeps the cliff-launch ball on the ledge when enlarged", () => {
  const loaded = prepareDemonstrationLoad({ groupId: "cliff-launch", parameters: { speed: "10" } });
  if (!loaded.ok) throw new Error("The cliff scene must load.");
  const resized = updateProjectileInScene(loaded.value.scene, "projectile-1", { ...DEFAULT_PROJECTILE_PROPERTIES, radiusMeters: 1 }).scene;

  // The ledge top is at y = 19.5, so a radius-1 ball rests with its centre at y = 20.5.
  expect(resized.bodies.find((body) => body.id === "projectile-1")?.pose.positionMeters.y).toBeCloseTo(20.5, 12);
  expect(validateScene(resized).ok).toBe(true);
});
