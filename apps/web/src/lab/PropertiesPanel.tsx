// Owns property-form errors and types the existing controller reference.
import { Fragment, useRef, useState, type RefObject } from "react";
// Supplies the scene and displayed snapshot records.
import type { SceneDefinition, Snapshot } from "@eureka/contracts";
// Supplies the accepted property-edit operations.
import type { LabController } from "./controller.js";
import { NumberField } from "./NumberField.js";
// Supplies learner-facing wording for rejected edits.
import { describeProblem, LAB_NOT_READY, objectKindLabel } from "./lab-messages.js";

// Remember launch text alongside the physical values accepted for this projectile.
interface AcceptedLaunchInput {
  readonly sceneId: string;
  readonly velocityX: number;
  readonly velocityY: number;
  readonly speedText: string;
  readonly angleText: string;
}

function usePropertyError(scope: string): readonly [string | null, (message: string | null) => void] {
  const [entry, setEntry] = useState<{ scope: string; message: string } | null>(null);

  return [
    entry?.scope === scope ? entry.message : null,
    (message) => setEntry(message === null ? null : { scope, message }),
  ];
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
  // The tick whose boundary will apply queued edits, or null when nothing is queued.
  queuedForTick: number | null;
  playing?: boolean;
}) {
  const {
    controllerRef,
    displayedSnapshot,
    editableScene,
    selectedEntityId,
    queuedForTick,
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
  // A paused edit shows where the object was put, not where the last tick left it.
  const selectedPose = selectedDefinition === undefined
    ? undefined
    : queuedForTick !== null ? selectedDefinition.pose : selectedBody?.pose ?? selectedTrigger?.pose;

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

  const errorScope = JSON.stringify([editableScene.id, editableScene.revision, selectedEntityId]);
  const [projectileEditError, setProjectileEditError] = usePropertyError(errorScope);
  const [staticBodyEditError, setStaticBodyEditError] = usePropertyError(errorScope);
  const [targetEditError, setTargetEditError] = usePropertyError(errorScope);
  const [positionEditError, setPositionEditError] = usePropertyError(errorScope);
  const panelRef = useRef<HTMLElement>(null);


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

  function commitPosition(axis: "x" | "y", form: HTMLFormElement): void {
    const input = form.elements.namedItem(`edit-position-${axis}`);

    if (!(input instanceof HTMLInputElement) || selectedDefinition === undefined || selectedPose === undefined) {
      return;
    }

    if (input.value === input.defaultValue) {
      return;
    }

    const value = Number(input.value);
    const controller = controllerRef.current;

    if (input.value.trim() === "" || !Number.isFinite(value)) {
      form.reset();
      setPositionEditError(`${axis.toUpperCase()} must be a number.`);
      return;
    }

    if (controller === null) {
      form.reset();
      setPositionEditError(LAB_NOT_READY);
      return;
    }

    const result = controller.moveEntityWhilePaused(selectedDefinition.id, {
      ...selectedPose.positionMeters,
      [axis]: value,
    });

    if (!result.ok) {
      form.reset();
      setPositionEditError(describeProblem(result.diagnostics, "That position couldn't be used."));
      return;
    }

    setPositionEditError(null);
  }

  return (
    <section
      ref={panelRef}
      className="properties"
      onSubmit={(event) => {
        const form = event.target;

        if (!(form instanceof HTMLFormElement) || form.classList.contains("coordinate-editor")) {
          return;
        }

        const active = document.activeElement;
        const name = active instanceof HTMLInputElement && form.contains(active)
          ? active.name
          : form.querySelector<HTMLInputElement>("input[name]")?.name;

        if (name === undefined || name === "") {
          return;
        }

        // Accepted edits replace the form with the next scene revision.
        queueMicrotask(() => {
          panelRef.current?.querySelector<HTMLInputElement>(`input[name="${CSS.escape(name)}"]`)?.focus();
        });
      }}
    >
      <header className="property-identity">
        <h2>
          {selectedDefinition === undefined
            ? selectedEntityId === null ? "No object selected" : "Object no longer exists"
            : selectedDefinition.kind === "dynamic" ? "Projectile"
              : selectedDefinition.kind === "target" ? "Target zone"
                : selectedDefinition.id.toLowerCase().includes("ground") ? "Ground"
                  : selectedDefinition.id.toLowerCase().includes("ramp") ? "Inclined plane"
                    : "Platform"}
        </h2>
        <p>
          {selectedDefinition === undefined
            ? selectedEntityId === null
              ? "Select an object on the page or open the scene outline."
              : "This object is absent from the scene. Select another object."
            : objectKindLabel(selectedDefinition.kind)}
        </p>
      </header>
      {selectedPose !== undefined && selectedDefinition !== undefined && (
        <dl className="property-position">
          {(["x", "y"] as const).map((axis) => (
            <Fragment key={`${selectedDefinition.id}-${axis}`}>
              <dt>{axis.toUpperCase()}</dt>
              <dd>
                {props.playing ? `${selectedPose.positionMeters[axis].toFixed(3)} m` : (
                  <form
                    className="coordinate-editor"
                    aria-label={`Edit ${axis.toUpperCase()} position`}
                    onSubmit={(event) => {
                      event.preventDefault();
                      commitPosition(axis, event.currentTarget);
                    }}
                    onBlur={(event) => {
                      const input = event.target;

                      if (input instanceof HTMLInputElement && input.value !== input.defaultValue) {
                        event.currentTarget.requestSubmit();
                      }
                    }}
                  >
                    <NumberField key={displayedSnapshot.tick} label={`${axis.toUpperCase()} position (m)`} name={`edit-position-${axis}`} defaultValue={selectedPose.positionMeters[axis].toFixed(3)} compact />
                    <span className="coordinate-unit">m</span>
                  </form>
                )}
              </dd>
            </Fragment>
          ))}
        </dl>
      )}
      {positionEditError !== null && <p className="coordinate-error" role="alert">{positionEditError}</p>}
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
              rejectEdit("Every value must be a number.");
              return;
            }

            if (mass <= 0 || radius <= 0 || speed < 0) {
              rejectEdit(
                "Mass and radius must be more than 0, and speed can't be negative.",
              );
              return;
            }

            if (restitution < 0 || restitution > 1) {
              rejectEdit("Restitution must be between 0 and 1.");
              return;
            }

            const controller = controllerRef.current;

            if (controller === null) {
              rejectEdit(LAB_NOT_READY);
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
              // Mid-run, a ball is relaunched from where it is only when its launch values were changed.
              { relaunch: speedText !== launchSpeedInput || angleText !== launchAngleInput },
            );

            if (!editResult.ok) {
              rejectEdit(
                describeProblem(editResult.diagnostics, "That change couldn't be made."),
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

            setProjectileEditError(null);
          }}
        >
          <NumberField label="Mass (kg)" name="edit-mass" defaultValue={selectedProjectile.massKilograms} rule="positive" />
          <NumberField label="Radius (m)" name="edit-radius" defaultValue={selectedProjectile.shape.radiusMeters} rule="positive" />
          <NumberField label="Launch speed (m/s)" name="edit-speed" defaultValue={launchSpeedInput} rule="nonnegative" />
          <NumberField label="Launch angle (°)" name="edit-angle" defaultValue={launchAngleInput} />
          <NumberField label="Restitution (0–1)" name="edit-restitution" defaultValue={selectedProjectile.material.restitution} rule="unitInterval" />

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
      )
      }
      {
        selectedStaticBody !== undefined && (
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
                rejectEdit("Every value must be a number.");
                return;
              }

              if (width <= 0 || height <= 0) {
                rejectEdit("Width and height must be more than 0.");
                return;
              }

              if (restitution < 0 || restitution > 1) {
                rejectEdit("Restitution must be between 0 and 1.");
                return;
              }

              const controller = controllerRef.current;

              if (controller === null) {
                rejectEdit(LAB_NOT_READY);
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
                  describeProblem(editResult.diagnostics, "That change couldn't be made."),
                );
                return;
              }

              setStaticBodyEditError(null);
            }}
          >
            <NumberField label="Width (m)" name="edit-static-width" defaultValue={selectedStaticBody.shape.widthMeters} rule="positive" />
            <NumberField label="Height (m)" name="edit-static-height" defaultValue={selectedStaticBody.shape.heightMeters} rule="positive" />
            <NumberField label="Surface angle (°)" name="edit-static-angle" defaultValue={formatDerivedInput(selectedStaticAngleDegrees)} />
            <NumberField label="Restitution (0–1)" name="edit-static-restitution" defaultValue={selectedStaticBody.material.restitution} rule="unitInterval" />

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
        )
      }
      {
        selectedTarget !== undefined && (
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

                formElement.reset();
              };

              if (radiusText === "") {
                rejectEdit("Radius is required.");
                return;
              }

              const radius = Number(radiusText);

              if (!Number.isFinite(radius)) {
                rejectEdit("Radius must be a number.");
                return;
              }

              if (radius <= 0) {
                rejectEdit("Radius must be more than 0.");
                return;
              }

              const controller = controllerRef.current;

              if (controller === null) {
                rejectEdit(LAB_NOT_READY);
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
                  describeProblem(editResult.diagnostics, "That change couldn't be made."),
                );
                return;
              }

              setTargetEditError(null);
            }}
          >
            <NumberField label="Radius (m)" name="edit-target-radius" defaultValue={selectedTarget.shape.radiusMeters} rule="positive" />

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
        )
      }
    </section >
  );
}
