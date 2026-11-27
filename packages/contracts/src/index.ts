export interface Vector2 {
  readonly x: number;
  readonly y: number;
}

export interface Pose {
  readonly positionMeters: Vector2;
  readonly angleRadians: number;
}

export interface Velocity {
  readonly linearMetersPerSecond: Vector2;
  readonly angularRadiansPerSecond: number;
}

export interface Material {
  readonly restitution: number;

  // Resistance to starting a slide
  readonly staticFrictionCoefficient?: number;

  // Resistance during sliding
  readonly kineticFrictionCoefficient?: number;
}
// If the bodies stay together after collision
export interface WeldOnImpactPair {
  readonly bodyAId: string;
  readonly bodyBId: string;
}
export interface CircleShape {
  readonly kind: "circle";
  readonly radiusMeters: number;
}

export interface BoxShape {
  readonly kind: "box";
  readonly widthMeters: number;
  readonly heightMeters: number;
}

// circles or boxes
interface DynamicBodyProperties {
  readonly id: string;
  readonly kind: "dynamic";
  readonly massKilograms: number;
  readonly material: Material;
  readonly pose: Pose;
  readonly velocity: Velocity;
  // Inertia about the centre; omission selects the uniform model for the shape
  readonly momentOfInertiaKilogramMetersSquared?: number;
}

// A moving circle has a radius
export interface DynamicCircleBody extends DynamicBodyProperties {
  readonly shape: CircleShape;
}

// A moving box has width and height
export interface DynamicBoxBody extends DynamicBodyProperties {
  readonly shape: BoxShape;
}
// A dynamic body may use either supported collision shape
export type DynamicBody = DynamicCircleBody | DynamicBoxBody;
export interface StaticBody {
  readonly id: string;
  readonly kind: "static";
  readonly shape: BoxShape;
  readonly material: Material;
  readonly pose: Pose;
}

export type Body = DynamicBody | StaticBody;

export interface TargetTrigger {
  readonly id: string;
  readonly kind: "target";
  readonly shape: CircleShape;
  readonly pose: Pose;
}

export interface NumericalProfile {
  readonly fixedTimeStepSeconds: number;
  readonly substeps: number;
  //minimum collision speed required for objects to bounce
  // Omission selects 0.01 times the profile velocity scale; zero disables the cutoff.
  readonly restitutionSpeedThresholdMetersPerSecond?: number;
  readonly scales: {
    readonly lengthMeters: number;
    readonly massKilograms: number;
    readonly timeSeconds: number;
  };
}
// A scheduled external cosine force, expressed as portable data
export interface SinusoidalForceDefinition {
  readonly forceVersion: 1;
  readonly id: string;
  readonly bodyId: string;

  // World-space force amplitude in newtons.
  readonly amplitudeNewtons: Vector2; // force
  readonly angularFrequencyRadiansPerSecond: number; // How quickly the cosine phase change
  // The cosine starts at its amplitude at start time
  readonly startTimeSeconds: number;
  readonly endTimeSeconds: number;
}
export interface SceneDefinition {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly revision: number;
  readonly seed: number;
  readonly numericalProfile: NumericalProfile;
  readonly environment: {
    readonly gravityMetersPerSecondSquared: Vector2;
    readonly linearDragKilogramsPerSecond: number;
  };
  readonly bodies: readonly Body[];
  // nothing means no pairs are configured to weld on impact
  readonly weldOnImpactPairs?: readonly WeldOnImpactPair[];
  readonly sinusoidalForces?: readonly SinusoidalForceDefinition[];
  readonly triggers: readonly TargetTrigger[];
}

export interface Diagnostic {
  readonly code: string;
  readonly path: string;
  readonly message: string;
  readonly entityId?: string;
}

export interface SnapshotBody {
  readonly id: string;
  readonly pose: Pose;
  readonly velocity: Velocity;
}

export interface ProjectileReadout {
  readonly bodyId: string;
  readonly flightTimeSeconds: number;
  readonly horizontalDisplacementMeters: number;
  readonly heightMeters: number;
}

export interface TargetEnteredEvent {
  readonly id: string;
  readonly kind: "targetEntered";
  readonly tick: number;
  readonly timeSeconds: number;
  readonly bodyId: string;
  readonly targetId: string;
}

export interface GroundContactEvent {
  readonly id: string;
  readonly kind: "groundContact";
  readonly tick: number;
  readonly timeSeconds: number;
  readonly bodyId: string;
  readonly surfaceBodyId: string;
  readonly pointMeters: Vector2;
  readonly normal: Vector2;
}

export type SnapshotEvent = TargetEnteredEvent | GroundContactEvent;

export interface ContactObservation {
  readonly id: string;

  // the tick at when the contact appeared
  readonly tick: number;
  readonly timeSeconds: number;

  // contacting bodies
  readonly bodyAId: string;
  readonly bodyBId: string;

  // contact position in metres
  readonly pointMeters: Vector2;

  // Unit direction from A toward B
  readonly normal: Vector2;

  // Nonnegative impulse delivered to B along the normal
  readonly normalImpulseNewtonSeconds: number;

  // Signed impulse delivered to B along (-normal.y, normal.x)
  readonly tangentImpulseNewtonSeconds: number;

  //Vi
  readonly bodyAVelocityBefore: Velocity;
  readonly bodyBVelocityBefore: Velocity;
  //Vf
  readonly bodyAVelocityAfter: Velocity;
  readonly bodyBVelocityAfter: Velocity;
}
// the joint body after collision
export interface WeldClusterObservation {
  readonly id: string;

  // Original body IDs remain unchanged after joining
  readonly bodyIds: readonly string[];
}
// describing the joining event
export interface WeldObservation {
  readonly id: string;
  readonly tick: number;
  readonly timeSeconds: number;
  readonly bodyAId: string;
  readonly bodyBId: string;
  readonly clusterId: string;
  readonly energyLossJoules: number;
}

//  physical losses since engine creation or reset
export interface CollisionEnergyLosses {
  readonly restitutionLossJoules: number;
  readonly frictionLossJoules: number;
  readonly weldLossJoules: number;
}
export interface Snapshot {
  readonly contractVersion: 1;
  readonly engineVersion: string;
  readonly engineBuild: string;
  readonly tick: number;
  readonly simulationTimeSeconds: number;
  readonly bodies: readonly SnapshotBody[];
  readonly projectileReadouts: readonly ProjectileReadout[];
  // Signed work done on bodies by user force interactions since create/reset; absence means zero.
  readonly userInteractionWorkJoules?: number;
  readonly events: readonly SnapshotEvent[];
  readonly diagnostics: readonly Diagnostic[];
  // Missing means unavailable [] means no contact observations this tick
  readonly contacts?: readonly ContactObservation[];
  // Current joined groups
  readonly weldClusters?: readonly WeldClusterObservation[];

  // Joining events from this tick; missing means unavailable
  readonly welds?: readonly WeldObservation[];
  readonly collisionEnergyLosses?: CollisionEnergyLosses;

  // Missing means unavailable; supported runs start/reset at zero
  readonly sinusoidalForceWorkJoules?: number;
}

export interface EditBodyCommand {
  readonly kind: "editBody";
  readonly bodyId: string;
  readonly changes: {
    readonly massKilograms?: number;
    readonly material?: Material;
    readonly pose?: Pose;
    readonly velocity?: Velocity;
    readonly shape?: CircleShape | BoxShape;
  };
}

export interface LaunchBodyCommand {
  readonly kind: "launchBody";
  readonly bodyId: string;
  readonly positionMeters: Vector2;
  readonly velocity: Velocity;
}

export interface SetForceInteractionCommand {
  readonly kind: "setForceInteraction";
  readonly interactionId: string;
  readonly bodyId: string;
  readonly localAnchorMeters: Vector2;
  readonly targetPositionMeters: Vector2;
  readonly stiffnessNewtonsPerMeter: number;
  readonly dampingKilogramsPerSecond: number;
  readonly maximumForceNewtons?: number;
}

export interface EndForceInteractionCommand {
  readonly kind: "endForceInteraction";
  readonly interactionId: string;
}

export interface AddEntityCommand {
  readonly kind: "addEntity";
  readonly entity: Body | TargetTrigger;
}

export interface RemoveEntityCommand {
  readonly kind: "removeEntity";
  readonly entityId: string;
}

export interface EditTargetCommand {
  readonly kind: "editTarget";
  readonly targetId: string;
  readonly changes: {
    readonly pose?: Pose;
    readonly shape?: CircleShape;
  };
}

export interface SetEnvironmentCommand {
  readonly kind: "setEnvironment";
  readonly environment: SceneDefinition["environment"];
}

export type CommandPayload =
  | EditBodyCommand
  | LaunchBodyCommand
  | SetForceInteractionCommand
  | EndForceInteractionCommand
  | AddEntityCommand
  | RemoveEntityCommand
  | EditTargetCommand
  | SetEnvironmentCommand;

export interface Command {
  readonly commandVersion: 1;
  readonly id: string;
  readonly targetTick: number;
  readonly payload: CommandPayload;
}


// The saved world view a challenge opens with. Same shape as the lab camera view.
export interface ChallengeView {
  readonly centerWorldMeters: Vector2;
  readonly widthMeters: number;
  readonly heightMeters: number;
  readonly pixelsPerMeter: number;
}

// The overlay switches a challenge starts with. Same shape as the lab overlay switches.
export interface ChallengeOverlays {
  readonly trail: boolean;
  readonly velocity: boolean;
  readonly components: boolean;
  readonly prediction: boolean;
  readonly events: boolean;
  readonly grid: boolean;
  readonly labels: boolean;
}

// The only values a challenge can open for editing or hold fixed. Angles are degrees; speed m/s; mass kg; gravity m/s²; drag kg/s.
export type ChallengeProperty = "launchSpeed" | "launchAngle" | "mass" | "gravity" | "linearDrag";

// A value the learner may change, inside a closed range.
export interface EditableProperty {
  readonly property: ChallengeProperty;
  // The body that owns the value, or null for an environment value such as drag.
  readonly bodyId: string | null;
  readonly label: string;
  readonly unit: string;
  readonly minimum: number;
  readonly maximum: number;
  readonly step: number;
}

// A value held fixed. The player compares it with the scene, and shows the reason to the learner.
export interface LockedProperty {
  readonly property: ChallengeProperty;
  readonly bodyId: string | null;
  readonly label: string;
  readonly unit: string;
  readonly value: number;
  readonly reason: string;
}

// What the player reads from a finished run. Each is an authoritative tick or event value, never a drawn pixel.
export type MeasurementQuantity =
  | "contactDistance"
  | "contactTime"
  | "apexHeight"
  | "dragFreeContactDistance"
  | "dragFreeContactTime";

export interface ChallengeMeasurement {
  readonly id: string;
  readonly label: string;
  readonly unit: string;
  readonly decimals: number;
  readonly quantity: MeasurementQuantity;
  // Only a first contact with one of these surfaces counts; any other first contact leaves the value absent. Null accepts any.
  readonly onSurfaces: readonly string[] | null;
}

// A measurement must lie inside [minimum, maximum]. Uncertainty is in the measurement's unit.
export interface IntervalCriterion {
  readonly id: string;
  readonly measurement: string;
  readonly label: string;
  readonly minimum: number;
  readonly maximum: number;
  readonly uncertainty: number;
}

// One of the scene's target objects used as a challenge zone. It shows red until reached and green once reached.
export interface ChallengeZone {
  // A target trigger of the scene.
  readonly targetId: string;
  readonly label: string;
  // Null: reached when the engine reports the projectile entering the target. Otherwise reached only when this criterion passes.
  readonly criterionId: string | null;
}

export interface ChallengeObjective {
  readonly summary: string;
  // Every criterion must hold. OR is not supported until a card needs it.
  readonly criteria: readonly IntervalCriterion[];
  readonly zones: readonly ChallengeZone[];
}

export interface ChallengeExplanation {
  readonly title: string;
  readonly message: string;
}

// Why an attempt cannot be judged at all. These are never a miss.
export type InvalidReason = "engineFailure" | "nonFiniteValue" | "incompleteRun" | "forbiddenEdit";

// One test inside a miss rule. A rule matches when all of its tests hold.
export type MissCondition =
  | { readonly kind: "criterion"; readonly criterionId: string; readonly side: "below" | "above" | "absent" }
  | { readonly kind: "measurement"; readonly measurementId: string; readonly side: "below" | "above"; readonly threshold: number }
  | { readonly kind: "firstContact"; readonly surfaceId: string };

export interface MissRule extends ChallengeExplanation {
  readonly id: string;
  readonly when: readonly MissCondition[];
}

export interface ChallengeExplanations {
  readonly success: ChallengeExplanation;
  readonly borderline: ChallengeExplanation;
  readonly invalid: Readonly<Record<InvalidReason, ChallengeExplanation>>;
  // Tried in order; the first matching rule explains the miss.
  readonly misses: readonly MissRule[];
  readonly fallbackMiss: ChallengeExplanation;
}

// A hint may also switch on one drawn aid, always computed from the learner's current launch values.
export type ChallengeReveal = "apexMarker" | "predictedCrossing";

export interface ChallengeHint {
  readonly text: string;
  readonly reveal: ChallengeReveal | null;
}

export interface ChallengeReset {
  // Keep the learner's last edited values, or return to the authored start.
  readonly editableValues: "keepLast" | "restoreStart";
  // Keep the previous attempt's path visible as a ghost, or clear it.
  readonly previousTrail: "ghost" | "clear";
}

// The seven core topics. A challenge names the one it mainly applies, even when its scene uses others too.
export type ChallengeTopic = "projectiles" | "collisions" | "rotationFriction" | "oscillations" | "energyMeasurement" | "fields" | "optics";

// How a finished attempt ended. Only a complete run can be judged.
export type ChallengeRunStatus = "complete" | "incomplete" | "engineFailure" | "forbiddenEdit";

// Everything the evaluator knows about one attempt: no scene, no pixels, no success flag.
export interface ChallengeAttempt {
  readonly runStatus: ChallengeRunStatus;
  // One value per measurement id. Absent means the run never produced it, which is a miss and not an error.
  readonly measurements: Readonly<Record<string, number | undefined>>;
  // The first surface the projectile touched after launching, or null when it touched none.
  readonly firstContact: string | null;
}

export type ChallengeStatus = "success" | "miss" | "borderline" | "invalid";

// A reviewed attempt calculated from formulas, never from the engine, with the verdict the evaluator must give it.
export interface ChallengeSample {
  readonly id: string;
  readonly label: string;
  // How the numbers were calculated, so a reviewer can recompute them.
  readonly source: string;
  readonly expectedStatus: ChallengeStatus;
  // "success", "borderline", an invalid reason, "fallbackMiss" or a miss rule id.
  readonly expectedReasonId: string;
  readonly attempt: ChallengeAttempt;
}

// One challenge. A published id and revision is immutable: a change to any bound or rule is a new revision.
export interface ChallengeDefinition {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly revision: number;
  readonly topic: ChallengeTopic;
  readonly level: "guided" | "independent" | "application";
  readonly title: string;
  readonly briefing: string;
  readonly scene: SceneDefinition;
  // The dynamic body that is launched and measured.
  readonly projectileId: string;
  readonly view: ChallengeView;
  readonly overlays: ChallengeOverlays;
  // A run that has not produced its landing by this time is incomplete, not a miss.
  readonly runLimitSeconds: number;
  // Stop at the first landing, or keep running after it until every zone is settled (entered, or its criterion judged) or the run limit passes.
  readonly attemptEnds: "firstContact" | "allZonesReached";
  readonly editable: readonly EditableProperty[];
  readonly locked: readonly LockedProperty[];
  readonly measurements: readonly ChallengeMeasurement[];
  readonly objective: ChallengeObjective;
  readonly explanations: ChallengeExplanations;
  // Shown one more at a time after each attempt that is not a success.
  readonly hints: readonly ChallengeHint[];
  readonly reset: ChallengeReset;
  // Draw the drag-free path of the current launch beside the real one.
  readonly comparison: "none" | "dragFreePath";
  // Curriculum questions that teach what this challenge applies.
  readonly relatedDemonstrationIds: readonly string[];
  // Reviewed formula-derived attempts, shown under "Review sample verdicts" and used to check the evaluator against the rubric.
  readonly samples: readonly ChallengeSample[];
}


// ---------- Demonstrations: the Curriculum's predict-run-compare questions ----------

// A number in a demonstration's scene or frame: fixed, or taken from one chosen setting as offset + scale × value.
export type DemonstrationNumber = number | { readonly parameter: string; readonly scale: number; readonly offset: number };

export interface DemonstrationVector {
  readonly x: DemonstrationNumber;
  readonly y: DemonstrationNumber;
}

// One body of the scene template. A dynamic body is launched with a speed and an angle in degrees.
export type DemonstrationBody =
  | {
    readonly kind: "static";
    readonly id: string;
    readonly widthMeters: DemonstrationNumber;
    readonly heightMeters: DemonstrationNumber;
    readonly restitution: number;
    readonly positionMeters: DemonstrationVector;
    readonly angleDegrees: DemonstrationNumber;
  }
  | {
    readonly kind: "dynamic";
    readonly id: string;
    readonly radiusMeters: DemonstrationNumber;
    readonly massKilograms: DemonstrationNumber;
    readonly restitution: number;
    readonly positionMeters: DemonstrationVector;
    readonly launchSpeedMetersPerSecond: DemonstrationNumber;
    readonly launchAngleDegrees: DemonstrationNumber;
  };

// The scene a demonstration builds for one choice of settings. No scene list is stored; each setup is built when asked for.
export interface DemonstrationSceneTemplate {
  // The built scene's id. Each {key} is replaced by the chosen value of that setting.
  readonly id: string;
  readonly seed: number;
  readonly numericalProfile: NumericalProfile;
  // Gravity points straight down with this strength.
  readonly gravityStrengthMetersPerSecondSquared: DemonstrationNumber;
  readonly linearDragKilogramsPerSecond: DemonstrationNumber;
  readonly bodies: readonly DemonstrationBody[];
}

// The ideal flight a frame is sized around, from the origin down to height zero.
// level: R = v²·sin(2θ)/g and peak = (v·sinθ)²/(2g). fall: launched horizontally from heightMeters, R = v·√(2h/g) and peak = h.
export type DemonstrationFlight =
  | { readonly kind: "level"; readonly speedMetersPerSecond: DemonstrationNumber; readonly angleDegrees: DemonstrationNumber; readonly gravityMetersPerSecondSquared: DemonstrationNumber }
  | { readonly kind: "fall"; readonly speedMetersPerSecond: DemonstrationNumber; readonly heightMeters: DemonstrationNumber; readonly gravityMetersPerSecondSquared: DemonstrationNumber };

// The view that shows a whole flight: from x = −left to range + right and from y = −bottom to peak + top.
export interface DemonstrationFrame {
  readonly flight: DemonstrationFlight;
  readonly marginsMeters: { readonly left: number; readonly right: number; readonly bottom: number; readonly top: number };
  readonly pixelsPerMeter: number;
}

export interface DemonstrationOption {
  readonly value: string;
  readonly label: string;
}

export interface DemonstrationControl {
  readonly key: string;
  readonly label: string;
  readonly options: readonly DemonstrationOption[];
}

// One stored Curriculum question: two setups that differ in the primary setting, and shared settings for both. Plain data only.
export interface SavedDemonstration {
  readonly schemaVersion: 1;
  readonly id: string;
  // A published id and revision is immutable; a change is a new revision.
  readonly revision: number;
  readonly topic: ChallengeTopic;
  // Position in its topic's question list, from 1.
  readonly order: number;
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
  readonly sharedDefaults: Readonly<Record<string, string>>;
  readonly overlays: ChallengeOverlays;
  readonly scene: DemonstrationSceneTemplate;
  // How the view around one setup's flight is sized.
  readonly framing: DemonstrationFrame;
}

export { buildDemonstrationScene, demonstrationFrame, frameAround } from "./demonstration-builder.js";
export { findDemonstrationProblems } from "./demonstration-checks.js";
export { findChallengeDefinitionProblems } from "./challenge-checks.js";
export { CHALLENGE_MESSAGE_TOKEN, evaluateAttempt, judgeCriterion, type ChallengeResult, type CriterionResult, type CriterionStatus } from "./challenge-evaluator.js";
