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
  // Positive finite magnitude limit; omission uses 100 M L / T² from the scene scales.
  readonly maximumForceNewtons?: number;
}

export interface EndForceInteractionCommand {
  readonly kind: "endForceInteraction";
  readonly interactionId: string;
}

export type CommandPayload =
  | EditBodyCommand
  | LaunchBodyCommand
  | SetForceInteractionCommand
  | EndForceInteractionCommand;

export interface Command {
  readonly commandVersion: 1;
  readonly id: string;
  readonly targetTick: number;
  readonly payload: CommandPayload;
}
