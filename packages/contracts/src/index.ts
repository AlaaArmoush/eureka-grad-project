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
  // in circles
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
// because now only circle consumers are prepared
export type DynamicBody = DynamicCircleBody;

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
  readonly scales: {
    readonly lengthMeters: number;
    readonly massKilograms: number;
    readonly timeSeconds: number;
  };
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
