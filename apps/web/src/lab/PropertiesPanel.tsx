// Owns property-form errors and types the existing controller reference.
import { useState, type RefObject } from "react";
// Supplies the scene and displayed snapshot records.
import type { SceneDefinition, Snapshot } from "@eureka/contracts";
// Supplies the accepted property-edit operations.
import type { LabController } from "./controller.js";

// Remember launch text alongside the physical values accepted for this projectile.
interface AcceptedLaunchInput {
  readonly sceneId: string;
  readonly velocityX: number;
  readonly velocityY: number;
  readonly speedText: string;
  readonly angleText: string;
}

// Hide conversion noise when reconstructing an input from physical values.
function formatDerivedInput(value: number): string {
  return String(Number(value.toPrecision(15)));
}

export function PropertiesPanel(props: {
  controllerRef: RefObject<LabController | null>;
  displayedSnapshot: Snapshot;
  editableScene: SceneDefinition;
  selectedEntityId: string | null;
  setEditableScene(scene: SceneDefinition): void;
}) {
  const {
    controllerRef,
    displayedSnapshot,
    editableScene,
    selectedEntityId,
    setEditableScene,
  } = props;

  const selectedBody = displayedSnapshot.bodies.find(
    (body) => body.id === selectedEntityId,
  );
  const selectedTrigger = editableScene.triggers.find(
    (trigger) => trigger.id === selectedEntityId,
  );
  const selectedDefinition =
    editableScene.bodies.find((body) => body.id === selectedEntityId) ??
    selectedTrigger;
  const selectedPose = selectedBody?.pose ?? selectedTrigger?.pose;

  const selectedProjectile =
    selectedDefinition?.kind === "dynamic" ? selectedDefinition : undefined;

  const selectedProjectileSpeed =
    selectedProjectile === undefined
      ? 0
      : Math.hypot(
          selectedProjectile.velocity.linearMetersPerSecond.x,
          selectedProjectile.velocity.linearMetersPerSecond.y,
        );

  const selectedProjectileAngleDegrees =
    selectedProjectile === undefined || selectedProjectileSpeed === 0
      ? 0
      : (Math.atan2(
          selectedProjectile.velocity.linearMetersPerSecond.y,
          selectedProjectile.velocity.linearMetersPerSecond.x,
        ) *
          180) /
        Math.PI;

  const selectedStaticBody =
    selectedDefinition?.kind === "static" ? selectedDefinition : undefined;

  const selectedStaticAngleDegrees =
    selectedStaticBody === undefined
      ? 0
      : (selectedStaticBody.pose.angleRadians * 180) / Math.PI;

  const selectedTarget =
    selectedDefinition?.kind === "target" ? selectedDefinition : undefined;

  const [projectileEditError, setProjectileEditError] = useState<string | null>(
    null,
  );
  const [staticBodyEditError, setStaticBodyEditError] = useState<string | null>(
    null,
  );
  const [targetEditError, setTargetEditError] = useState<string | null>(null);

  // Keep accepted launch text across renders and selection changes.
  const [acceptedLaunchInputs, setAcceptedLaunchInputs] = useState<
    ReadonlyMap<string, AcceptedLaunchInput>
  >(() => new Map());

  let launchSpeedInput = formatDerivedInput(selectedProjectileSpeed);
  let launchAngleInput = formatDerivedInput(selectedProjectileAngleDegrees);

  // Reuse the text only while it still describes this scene's accepted velocity.
  if (selectedProjectile !== undefined) {
    const acceptedInput = acceptedLaunchInputs.get(selectedProjectile.id);
    const velocity = selectedProjectile.velocity.linearMetersPerSecond;

    if (
      acceptedInput !== undefined &&
      acceptedInput.sceneId === editableScene.id &&
      acceptedInput.velocityX === velocity.x &&
      acceptedInput.velocityY === velocity.y
    ) {
      launchSpeedInput = acceptedInput.speedText;
      launchAngleInput = acceptedInput.angleText;
    }
  }

  return (
    <section className="properties">
      <h2>Properties</h2>
      <p>
        <strong> Selected Object: </strong>
        {selectedEntityId ?? "None"}
      </p>
      <p>
        <strong>Type: </strong>
        {selectedDefinition?.kind ?? "None"}
      </p>
      <p>
        <strong>Shape: </strong>
        {selectedDefinition?.shape.kind ?? "None"}
      </p>
      {selectedDefinition === undefined && (
        <p className="dimension-readout">
          <strong>Dimensions:</strong>
          No object selected
        </p>
      )}
      <p>
        <strong>Selected Object position:</strong>
      </p>
      <ul>
        <li>
          <strong>x(m):</strong>
          {selectedPose?.positionMeters.x ?? "Please select an Object"}
        </li>
        <li>
          <strong>y(m):</strong>
          {selectedPose?.positionMeters.y ?? "Please select an Object"}
        </li>
      </ul>
      {selectedProjectile !== undefined && (
        <form
          className="property-editor-inline"
          key={`${selectedProjectile.id}-${editableScene.revision}`}
          onSubmit={(event) => {
            event.preventDefault();

            const formElement = event.currentTarget;
            const form = new FormData(formElement);

            const read = (name: string) => String(form.get(name) ?? "").trim();

            const rejectEdit = (message: string) => {
              setProjectileEditError(message);

              formElement.reset();
            };

            const massText = read("edit-mass");
            const radiusText = read("edit-radius");
            const speedText = read("edit-speed");
            const angleText = read("edit-angle");
            const restitutionText = read("edit-restitution");

            if (
              massText === "" ||
              radiusText === "" ||
              speedText === "" ||
              angleText === "" ||
              restitutionText === ""
            ) {
              rejectEdit("Every field is required.");
              return;
            }

            const mass = Number(massText);
            const radius = Number(radiusText);
            const speed = Number(speedText);
            const angle = Number(angleText);
            const restitution = Number(restitutionText);

            if (
              !Number.isFinite(mass) ||
              !Number.isFinite(radius) ||
              !Number.isFinite(speed) ||
              !Number.isFinite(angle) ||
              !Number.isFinite(restitution)
            ) {
              rejectEdit("Every value must be finite.");
              return;
            }

            if (mass <= 0 || radius <= 0 || speed < 0) {
              rejectEdit(
                "Mass and radius must be positive; speed cannot be negative.",
              );
              return;
            }

            if (restitution < 0 || restitution > 1) {
              rejectEdit("Restitution must be between 0 and 1.");
              return;
            }

            const controller = controllerRef.current;

            if (controller === null) {
              rejectEdit("The laboratory is not available.");
              return;
            }

            const editResult = controller.updateProjectileProperties(
              selectedProjectile.id,
              {
                massKilograms: mass,
                radiusMeters: radius,
                launchSpeedMetersPerSecond: speed,
                launchAngleDegrees: angle,
                restitution,
              },
            );

            if (!editResult.ok) {
              rejectEdit(
                editResult.diagnostics[0]?.message ??
                  "The projectile edit was rejected.",
              );
              return;
            }

            // Associate the submitted text with the controller's accepted values.
            const acceptedScene = editResult.value.scene;

            for (const body of acceptedScene.bodies) {
              if (body.id === selectedProjectile.id && body.kind === "dynamic") {
                setAcceptedLaunchInputs((previousInputs) => {
                  const nextInputs = new Map(previousInputs);

                  nextInputs.set(body.id, {
                    sceneId: acceptedScene.id,
                    velocityX: body.velocity.linearMetersPerSecond.x,
                    velocityY: body.velocity.linearMetersPerSecond.y,
                    speedText,
                    angleText,
                  });

                  return nextInputs;
                });

                break;
              }
            }

            setEditableScene(acceptedScene);
            setProjectileEditError(null);
          }}
        >
          <label>
            Mass (kg)
            <input
              name="edit-mass"
              defaultValue={selectedProjectile.massKilograms}
            />
          </label>

          <label>
            Radius (m)
            <input
              name="edit-radius"
              defaultValue={selectedProjectile.shape.radiusMeters}
            />
          </label>

          <label>
            Launch speed (m/s)
            {/* Preserve accepted speed text instead of exposing conversion noise. */}
            <input name="edit-speed" defaultValue={launchSpeedInput} />
          </label>

          <label>
            Launch angle (°)
            {/* Preserve accepted degrees while physical data remains in radians. */}
            <input
              name="edit-angle"
              defaultValue={launchAngleInput}
            />
          </label>

          <label>
            Restitution (0–1)
            <input
              name="edit-restitution"
              defaultValue={selectedProjectile.material.restitution}
            />
          </label>

          {projectileEditError !== null && (
            <p role="alert">{projectileEditError}</p>
          )}

          <div className="property-editor-inline__actions">
            <button
              type="button"
              onClick={(event) => {
                event.currentTarget.form?.reset();
                setProjectileEditError(null);
              }}
            >
              Cancel
            </button>

            <button type="submit">Apply changes</button>
          </div>
        </form>
      )}
      {selectedStaticBody !== undefined && (
        <form
          className="property-editor-inline"
          key={`${selectedStaticBody.id}-${editableScene.revision}`}
          onSubmit={(event) => {
            event.preventDefault();

            const formElement = event.currentTarget;
            const form = new FormData(formElement);

            const read = (name: string) => String(form.get(name) ?? "").trim();

            const rejectEdit = (message: string) => {
              setStaticBodyEditError(message);
              formElement.reset();
            };

            const widthText = read("edit-static-width");
            const heightText = read("edit-static-height");
            const angleText = read("edit-static-angle");
            const restitutionText = read("edit-static-restitution");

            if (
              widthText === "" ||
              heightText === "" ||
              angleText === "" ||
              restitutionText === ""
            ) {
              rejectEdit("Every field is required.");
              return;
            }

            const width = Number(widthText);
            const height = Number(heightText);
            const angle = Number(angleText);
            const restitution = Number(restitutionText);

            if (
              !Number.isFinite(width) ||
              !Number.isFinite(height) ||
              !Number.isFinite(angle) ||
              !Number.isFinite(restitution)
            ) {
              rejectEdit("Every value must be finite.");
              return;
            }

            if (width <= 0 || height <= 0) {
              rejectEdit("Width and height must be greater than zero.");
              return;
            }

            if (restitution < 0 || restitution > 1) {
              rejectEdit("Restitution must be between 0 and 1.");
              return;
            }

            const controller = controllerRef.current;

            if (controller === null) {
              rejectEdit("The laboratory is not available.");
              return;
            }

            const editResult = controller.updateStaticBodyProperties(
              selectedStaticBody.id,
              {
                widthMeters: width,
                heightMeters: height,
                angleDegrees: angle,
                restitution,
              },
            );

            if (!editResult.ok) {
              rejectEdit(
                editResult.diagnostics[0]?.message ??
                  "The static-body edit was rejected.",
              );
              return;
            }

            setEditableScene(editResult.value.scene);
            setStaticBodyEditError(null);
          }}
        >
          <label>
            Width (m)
            <input
              name="edit-static-width"
              defaultValue={selectedStaticBody.shape.widthMeters}
            />
          </label>

          <label>
            Height (m)
            <input
              name="edit-static-height"
              defaultValue={selectedStaticBody.shape.heightMeters}
            />
          </label>

          <label>
            Surface angle (°)
            {/* Format degrees reconstructed from the static body's radians. */}
            <input
              name="edit-static-angle"
              defaultValue={formatDerivedInput(selectedStaticAngleDegrees)}
            />
          </label>

          <label>
            Restitution (0–1)
            <input
              name="edit-static-restitution"
              defaultValue={selectedStaticBody.material.restitution}
            />
          </label>

          {staticBodyEditError !== null && (
            <p role="alert">{staticBodyEditError}</p>
          )}

          <div className="property-editor-inline__actions">
            <button
              type="button"
              onClick={(event) => {
                event.currentTarget.form?.reset();
                setStaticBodyEditError(null);
              }}
            >
              Cancel
            </button>

            <button type="submit">Apply changes</button>
          </div>
        </form>
      )}
      {selectedTarget !== undefined && (
        <form
          className="property-editor-inline"
          key={`${selectedTarget.id}-${editableScene.revision}`}
          onSubmit={(event) => {
            event.preventDefault();

            const formElement = event.currentTarget;
            const form = new FormData(formElement);

            const radiusText = String(
              form.get("edit-target-radius") ?? "",
            ).trim();

            const rejectEdit = (message: string) => {
              setTargetEditError(message);

              // Restore the last accepted radius.
              formElement.reset();
            };

            if (radiusText === "") {
              rejectEdit("Radius is required.");
              return;
            }

            const radius = Number(radiusText);

            if (!Number.isFinite(radius)) {
              rejectEdit("Radius must be finite.");
              return;
            }

            if (radius <= 0) {
              rejectEdit("Radius must be greater than zero.");
              return;
            }

            const controller = controllerRef.current;

            if (controller === null) {
              rejectEdit("The laboratory is not available.");
              return;
            }

            const editResult = controller.updateTargetProperties(
              selectedTarget.id,
              {
                radiusMeters: radius,
              },
            );

            if (!editResult.ok) {
              rejectEdit(
                editResult.diagnostics[0]?.message ??
                  "The target edit was rejected.",
              );
              return;
            }

            setEditableScene(editResult.value.scene);
            setTargetEditError(null);
          }}
        >
          <label>
            Radius (m)
            <input
              name="edit-target-radius"
              defaultValue={selectedTarget.shape.radiusMeters}
            />
          </label>

          {targetEditError !== null && <p role="alert">{targetEditError}</p>}

          <div className="property-editor-inline__actions">
            <button
              type="button"
              onClick={(event) => {
                event.currentTarget.form?.reset();
                setTargetEditError(null);
              }}
            >
              Cancel
            </button>

            <button type="submit">Apply changes</button>
          </div>
        </form>
      )}
    </section>
  );
}
