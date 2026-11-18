import type { SceneDefinition } from "@eureka/contracts";
import type { CameraView } from "./coordinates.js";
import { addPlatformToScene, addProjectileToScene, DEFAULT_PROJECTILE_PROPERTIES } from "./authoring.js";
import type { OverlayVisibility } from "./store.js";

export type DemonstrationParameters = Readonly<Record<string, string>>;

export interface DemonstrationOption {
  readonly value: string;
  readonly label: string;
}

export interface DemonstrationControl {
  readonly key: string;
  readonly label: string;
  readonly options: readonly DemonstrationOption[];
}

// One investigation: two setups that differ in the primary variable, and shared settings for both.
export interface DemonstrationDefinition {
  readonly id: string;
  readonly title: string;
  readonly question: string;
  readonly summary: string;
  readonly prediction: {
    readonly prompt: string;
    readonly choices: readonly string[];
    readonly answerIndex: number;
    readonly reason: string;
  };
  readonly lookFor: string;
  readonly scenarioReference: string;
  readonly primary: DemonstrationControl;
  readonly reference: string;
  readonly comparison: string;
  readonly shared: readonly DemonstrationControl[];
  readonly sharedDefaults: DemonstrationParameters;
  readonly overlays: OverlayVisibility;
  // Build a starting scene from one complete set of parameters, so no scene list has to be stored.
  buildScene(parameters: DemonstrationParameters): SceneDefinition;
  // The world area that shows the whole flight of these parameters.
  frame(parameters: DemonstrationParameters): CameraView;
}

// Combine the varied value with the settings both setups share.
export function setupParameters(definition: DemonstrationDefinition, primaryValue: string, shared: DemonstrationParameters): DemonstrationParameters {
  return { ...shared, [definition.primary.key]: primaryValue };
}

// Accept only parameters that name an offered option for every control, never arbitrary strings.
export function resolveParameters(definition: DemonstrationDefinition, parameters: DemonstrationParameters): DemonstrationParameters | undefined {
  const resolved: Record<string, string> = {};

  for (const control of [definition.primary, ...definition.shared]) {
    const value = parameters[control.key];

    if (value === undefined || !control.options.some((option) => option.value === value)) {
      return undefined;
    }

    resolved[control.key] = value;
  }

  return resolved;
}

// One frame that contains every given frame, for previews that show several setups together.
export function unionFrames(frames: readonly CameraView[]): CameraView {
  const bounds = frames.map((frame) => ({
    xMin: frame.centerWorldMeters.x - frame.widthMeters / 2,
    xMax: frame.centerWorldMeters.x + frame.widthMeters / 2,
    yMin: frame.centerWorldMeters.y - frame.heightMeters / 2,
    yMax: frame.centerWorldMeters.y + frame.heightMeters / 2,
  }));

  return frameOf(
    Math.min(...bounds.map((item) => item.xMin)),
    Math.max(...bounds.map((item) => item.xMax)),
    Math.min(...bounds.map((item) => item.yMin)),
    Math.max(...bounds.map((item) => item.yMax)),
    Math.min(...frames.map((frame) => frame.pixelsPerMeter)),
  );
}

const DEMONSTRATION_OVERLAYS: OverlayVisibility = {
  trail: true,
  velocity: true,
  components: true,
  prediction: true,
  events: true,
  grid: true,
  labels: true,
};

// A 1 m ball stays readable at the zoom levels that show a whole trajectory.
const DEMONSTRATION_BALL_RADIUS_METERS = 0.5;
const STANDARD_GRAVITY = 9.81;

// Keep a frame wide enough to read and not so wide that the flight becomes a thin strip.
function frameOf(xMin: number, xMax: number, yMin: number, yMax: number, pixelsPerMeter = 40): CameraView {
  const width = Math.max(xMax - xMin, (yMax - yMin) * 1.6);
  const height = Math.max(yMax - yMin, width / 3.2);

  return {
    centerWorldMeters: { x: (xMin + xMax) / 2, y: (yMin + yMax) / 2 },
    widthMeters: width,
    heightMeters: height,
    pixelsPerMeter,
  };
}

// Frame an ideal flight from launch height 0 to the same height, plus margin for the ball.
function launchFrame(speed: number, angleDegrees: number, gravity: number): CameraView {
  const angle = angleDegrees * Math.PI / 180;
  const range = Math.max(0, speed * speed * Math.sin(2 * angle) / gravity);
  const peak = (speed * Math.sin(angle)) ** 2 / (2 * gravity);

  return frameOf(-2, range + 2, -1.5, peak + 1.5);
}

type Launch = readonly [speedMetersPerSecond: number, angleDegrees: number];

interface LaunchSceneOptions {
  readonly gravityStrengthMetersPerSecondSquared?: number;
  readonly massKilograms?: number;
  readonly linearDragKilogramsPerSecond?: number;
  readonly heightMeters?: number;
}

function createLaunchScene(id: string, launches: readonly Launch[], options: LaunchSceneOptions = {}): SceneDefinition {
  let scene: SceneDefinition = {
    schemaVersion: 1,
    id,
    revision: 0,
    seed: 17,
    numericalProfile: {
      fixedTimeStepSeconds: 1 / 60,
      substeps: 1,
      scales: {
        lengthMeters: 1,
        massKilograms: 1,
        timeSeconds: 1,
      },
    },
    environment: {
      gravityMetersPerSecondSquared: {
        x: 0,
        y: -(options.gravityStrengthMetersPerSecondSquared ?? STANDARD_GRAVITY),
      },
      linearDragKilogramsPerSecond: options.linearDragKilogramsPerSecond ?? 0,
    },
    // The ground top sits one ball radius below zero, so a ball lands at centre height zero.
    bodies: [{
      id: "default-ground",
      kind: "static",
      shape: { kind: "box", widthMeters: 1200, heightMeters: 0.5 },
      material: { restitution: 0 },
      pose: {
        positionMeters: { x: 0, y: -DEMONSTRATION_BALL_RADIUS_METERS - 0.25 },
        angleRadians: 0,
      },
    }],
    triggers: [],
  };

  for (const [speed, angle] of launches) {
    scene = addProjectileToScene(scene, { x: 0, y: options.heightMeters ?? 0 }, {
      ...DEFAULT_PROJECTILE_PROPERTIES,
      massKilograms: options.massKilograms ?? 1,
      radiusMeters: DEMONSTRATION_BALL_RADIUS_METERS,
      launchSpeedMetersPerSecond: speed,
      launchAngleDegrees: angle,
    }).scene;
  }

  // Object construction increments revisions; publish the finished scene as revision one.
  return { ...scene, revision: 1 };
}

const speedOptions = (values: readonly number[]): readonly DemonstrationOption[] =>
  values.map((value) => ({ value: String(value), label: `${value} m/s` }));

const massOptions: readonly DemonstrationOption[] = [0.1, 1, 10].map((value) => ({ value: String(value), label: `${value} kg` }));

const gravityOptions: readonly DemonstrationOption[] = [
  { value: "9.81", label: "Earth · 9.81 m/s²" },
  { value: "1.62", label: "Moon · 1.62 m/s²" },
];

const cliffHeightMeters = 20;

export const TOPIC_ONE_DEMONSTRATIONS: readonly DemonstrationDefinition[] = [
  {
    id: "ideal-launch",
    title: "Heavy or light",
    question: "Does a heavier ball follow a different path?",
    summary: "Two balls leave the same spot at 20 m/s and 30°, with no air resistance. Only their mass differs.",
    prediction: {
      prompt: "How will the 10 kg ball's path compare with the 1 kg ball's?",
      choices: ["It goes farther", "It falls shorter", "The paths are identical"],
      answerIndex: 2,
      reason: "With no air resistance the only force is gravity, F = mg. Acceleration is F/m = g for every mass, so both balls follow the same parabola.",
    },
    lookFor: "Compare the rows: range, flight time and peak height are the same for both masses, so the two paths lie on top of each other.",
    scenarioReference: "S01-01 / D01-01 / A01-01",
    primary: { key: "mass", label: "Mass", options: massOptions },
    reference: "1",
    comparison: "10",
    shared: [
      { key: "speed", label: "Launch speed", options: speedOptions([5, 10, 20, 30]) },
      { key: "gravity", label: "Gravity", options: gravityOptions },
    ],
    sharedDefaults: { speed: "20", gravity: "9.81" },
    overlays: DEMONSTRATION_OVERLAYS,
    buildScene: (p) => createLaunchScene(`ideal-launch-m${p.mass}-v${p.speed}-g${p.gravity}`, [[Number(p.speed), 30]], {
      gravityStrengthMetersPerSecondSquared: Number(p.gravity),
      massKilograms: Number(p.mass),
    }),
    frame: (p) => launchFrame(Number(p.speed), 30, Number(p.gravity)),
  },
  {
    id: "linear-drag",
    title: "Air resistance",
    question: "What changes when air resistance is added?",
    summary: "The same 20 m/s, 30° launch with and without a drag force that pushes against the motion, F = −b·v.",
    prediction: {
      prompt: "Compared with no drag, what will strong drag (b = 0.5 kg/s) do to the flight?",
      choices: ["Longer range, higher peak", "Shorter range, lower peak", "No change"],
      answerIndex: 1,
      reason: "Drag opposes the velocity all the time, so the ball loses speed in both directions. It rises less and travels less far. The path is no longer a parabola.",
    },
    lookFor: "The drag path is shorter and steeper on the way down. Try mass 0.1 kg: acceleration from drag is (b/m)·v, so a light ball is slowed far more than a 10 kg one.",
    scenarioReference: "S01-02 / D01-02 / A01-02",
    primary: { key: "drag", label: "Drag coefficient b", options: [
      { value: "0", label: "None" },
      { value: "0.1", label: "0.1 kg/s" },
      { value: "0.5", label: "0.5 kg/s" },
    ] },
    reference: "0",
    comparison: "0.5",
    shared: [{ key: "mass", label: "Mass", options: massOptions }],
    sharedDefaults: { mass: "1" },
    overlays: DEMONSTRATION_OVERLAYS,
    buildScene: (p) => createLaunchScene(`linear-drag-b${p.drag}-m${p.mass}`, [[20, 30]], {
      massKilograms: Number(p.mass),
      linearDragKilogramsPerSecond: Number(p.drag),
    }),
    // Drag only shortens the flight, so the drag-free frame always contains it.
    frame: () => launchFrame(20, 30, STANDARD_GRAVITY),
  },
  {
    id: "cliff-launch",
    title: "Off a cliff",
    question: "Does a faster horizontal launch take longer to fall?",
    summary: "Two balls roll off the same 20 m ledge horizontally, at different speeds.",
    prediction: {
      prompt: "Which ball reaches the lower ground first?",
      choices: ["The slower ball", "The faster ball", "They land together"],
      answerIndex: 2,
      reason: "Vertical and horizontal motion are independent. Both start with zero vertical speed and fall 20 m, so t = √(2h/g) ≈ 2.0 s for each. Speed only decides how far they travel in that time.",
    },
    lookFor: "The flight times match; only the ranges differ, and each range is horizontal speed × 2.0 s.",
    scenarioReference: "S01-03 / D01-03 / A01-03",
    primary: { key: "speed", label: "Horizontal speed", options: speedOptions([5, 10, 20]) },
    reference: "5",
    comparison: "20",
    shared: [],
    sharedDefaults: {},
    overlays: DEMONSTRATION_OVERLAYS,
    buildScene: (p) => {
      const launched = createLaunchScene(`cliff-launch-v${p.speed}`, [[Number(p.speed), 0]], { heightMeters: cliffHeightMeters });
      // The ball touches the ledge top, and the solid cliff reaches the lower ground.
      const cliff = addPlatformToScene(launched, { x: -2, y: cliffHeightMeters / 2 - DEMONSTRATION_BALL_RADIUS_METERS }, {
        widthMeters: 4,
        heightMeters: cliffHeightMeters,
        restitution: 0,
      }).scene;

      return { ...cliff, revision: 1 };
    },
    frame: (p) => frameOf(-6, Number(p.speed) * Math.sqrt(2 * cliffHeightMeters / STANDARD_GRAVITY) + 3, -1.5, cliffHeightMeters + 2.5),
  },
  {
    id: "angle-sweep",
    title: "Best angle",
    question: "Does aiming higher always send the ball farther?",
    summary: "Two launches at the same speed from the ground, at different angles.",
    prediction: {
      prompt: "Which launch angle gives the longer range, 30° or 45°?",
      choices: ["30°", "45°", "They are equal"],
      answerIndex: 1,
      reason: "On level ground R = v²·sin(2θ)/g, which is greatest at 45°. A lower angle wastes speed sideways too early; a higher one spends it going up.",
    },
    lookFor: "Range peaks at 45°. Now try 75°: it goes much higher but lands nearer than 45°, and it takes longer.",
    scenarioReference: "S01-04 / D01-04 / A01-04",
    primary: { key: "angle", label: "Launch angle", options: [15, 30, 45, 60, 75].map((value) => ({ value: String(value), label: `${value}°` })) },
    reference: "30",
    comparison: "45",
    shared: [{ key: "speed", label: "Launch speed", options: speedOptions([10, 20, 30]) }],
    sharedDefaults: { speed: "20" },
    overlays: DEMONSTRATION_OVERLAYS,
    buildScene: (p) => createLaunchScene(`angle-sweep-a${p.angle}-v${p.speed}`, [[Number(p.speed), Number(p.angle)]]),
    frame: (p) => launchFrame(Number(p.speed), Number(p.angle), STANDARD_GRAVITY),
  },
  {
    id: "complementary-angles",
    title: "Same landing spot",
    question: "Can two different launch angles land in the same place?",
    summary: "Each setup fires two balls at the same speed. Their angles add up to 90°.",
    prediction: {
      prompt: "In each pair, how will the two balls land?",
      choices: ["Same place, same time", "Same place, different times", "Different places"],
      answerIndex: 1,
      reason: "R = v²·sin(2θ)/g and sin(2θ) = sin(2(90° − θ)), so complementary angles share a range. The steeper ball rises higher and stays in the air longer.",
    },
    lookFor: "Within each pair the two balls land at the same distance, but the steeper one takes longer and goes higher. Compare 15°/75° with 30°/60°.",
    scenarioReference: "S01-05 / D01-05 / A01-05",
    primary: { key: "angle", label: "Shallow angle of the pair", options: [15, 30].map((value) => ({ value: String(value), label: `${value}° and ${90 - value}°` })) },
    reference: "15",
    comparison: "30",
    shared: [{ key: "speed", label: "Launch speed", options: speedOptions([10, 20, 30]) }],
    sharedDefaults: { speed: "20" },
    overlays: DEMONSTRATION_OVERLAYS,
    buildScene: (p) => createLaunchScene(`complementary-a${p.angle}-v${p.speed}`, [
      [Number(p.speed), Number(p.angle)],
      [Number(p.speed), 90 - Number(p.angle)],
    ]),
    frame: (p) => launchFrame(Number(p.speed), 90 - Number(p.angle), STANDARD_GRAVITY),
  },
];
