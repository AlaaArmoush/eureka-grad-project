import { useState } from "react";
import {
  Circle,
  RectangleHorizontal,
  Target,
  TriangleRight,
} from "lucide-react";
import { useStore } from "zustand";
import {
  DEFAULT_PLATFORM_PROPERTIES,
  DEFAULT_PROJECTILE_PROPERTIES,
  DEFAULT_RAMP_PROPERTIES,
  DEFAULT_TARGET_PROPERTIES,
} from "./authoring.js";
import { labStore } from "./store.js";

export function ObjectLibrary() {
  const activeTool = useStore(labStore, (state) => state.activeTool);

  const [projectileMenuOpen, setProjectileMenuOpen] = useState(false);
  const [projectileFormError, setProjectileFormError] = useState<string | null>(
    null,
  );
  const [platformMenuOpen, setPlatformMenuOpen] = useState(false);
  const [platformFormError, setPlatformFormError] = useState<string | null>(
    null,
  );
  const [rampMenuOpen, setRampMenuOpen] = useState(false);
  const [rampFormError, setRampFormError] = useState<string | null>(null);
  const [targetMenuOpen, setTargetMenuOpen] = useState(false);
  const [targetFormError, setTargetFormError] = useState<string | null>(null);

  return (
    <>
      <h2>Objects</h2>
      <ul className="tools">
        <li>
          <button
            className="object-tool-button"
            type="button"
            aria-expanded={projectileMenuOpen}
            aria-pressed={
              activeTool.kind === "place" &&
              activeTool.entityKind === "projectile"
            }
            onClick={() => {
              setPlatformMenuOpen(false);
              setRampMenuOpen(false);
              setTargetMenuOpen(false);
              setProjectileMenuOpen((open) => !open);
            }}
          >
            <Circle size={16} />
            <strong>Projectile</strong>
            <span>A moving ball with mass and initial velocity.</span>
          </button>

          {projectileMenuOpen && (
            <form
              className="placement-submenu"
              onSubmit={(event) => {
                event.preventDefault();

                const form = new FormData(event.currentTarget);
                const read = (name: string) =>
                  String(form.get(name) ?? "").trim();

                const massText = read("mass");
                const radiusText = read("radius");
                const speedText = read("speed");
                const angleText = read("angle");
                const restitutionText = read("restitution");

                if (
                  massText === "" ||
                  radiusText === "" ||
                  speedText === "" ||
                  angleText === "" ||
                  restitutionText === ""
                ) {
                  setProjectileFormError("Every field is required.");
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
                  setProjectileFormError("Every value must be finite.");
                  return;
                }

                if (mass <= 0 || radius <= 0 || speed < 0) {
                  setProjectileFormError(
                    "Mass, radius and speed must be positive",
                  );
                  return;
                }

                if (restitution < 0 || restitution > 1) {
                  setProjectileFormError(
                    "Restitution must be between 0 and 1.",
                  );
                  return;
                }

                labStore.getState().setActiveTool({
                  kind: "place",
                  entityKind: "projectile",
                  projectileProperties: {
                    massKilograms: mass,
                    radiusMeters: radius,
                    launchSpeedMetersPerSecond: speed,
                    launchAngleDegrees: angle,
                    restitution,
                  },
                });

                setProjectileFormError(null);
                setProjectileMenuOpen(false);
              }}
            >
              <label>
                Mass (kg)
                <input
                  name="mass"
                  defaultValue={DEFAULT_PROJECTILE_PROPERTIES.massKilograms}
                />
              </label>

              <label>
                Radius (m)
                <input
                  name="radius"
                  defaultValue={DEFAULT_PROJECTILE_PROPERTIES.radiusMeters}
                />
              </label>

              <label>
                Launch speed (m/s)
                <input
                  name="speed"
                  defaultValue={
                    DEFAULT_PROJECTILE_PROPERTIES.launchSpeedMetersPerSecond
                  }
                />
              </label>

              <label>
                Launch angle (°)
                <input
                  name="angle"
                  defaultValue={
                    DEFAULT_PROJECTILE_PROPERTIES.launchAngleDegrees
                  }
                />
              </label>

              <label>
                Restitution (0–1)
                <input
                  name="restitution"
                  defaultValue={DEFAULT_PROJECTILE_PROPERTIES.restitution}
                />
              </label>

              {projectileFormError !== null && (
                <p role="alert">{projectileFormError}</p>
              )}

              <div className="placement-submenu__actions">
                <button
                  type="button"
                  onClick={() => {
                    setProjectileFormError(null);
                    setProjectileMenuOpen(false);
                  }}
                >
                  Cancel
                </button>

                <button type="submit">Place projectile</button>
              </div>
            </form>
          )}
        </li>
        <li>
          <button
            className="object-tool-button"
            type="button"
            aria-expanded={platformMenuOpen}
            aria-pressed={
              activeTool.kind === "place" &&
              activeTool.entityKind === "platform"
            }
            onClick={() => {
              setProjectileMenuOpen(false);
              setRampMenuOpen(false);
              setTargetMenuOpen(false);
              setPlatformMenuOpen((open) => !open);
            }}
          >
            <RectangleHorizontal size={16} />
            <strong>Wall / platform</strong>
            <span>A fixed rectangular collision surface.</span>
          </button>

          {platformMenuOpen && (
            <form
              className="placement-submenu"
              onSubmit={(event) => {
                event.preventDefault();

                const form = new FormData(event.currentTarget);
                const read = (name: string) =>
                  String(form.get(name) ?? "").trim();

                const widthText = read("width");
                const heightText = read("height");
                const restitutionText = read("restitution");

                if (
                  widthText === "" ||
                  heightText === "" ||
                  restitutionText === ""
                ) {
                  setPlatformFormError("Every field is required.");
                  return;
                }

                const width = Number(widthText);
                const height = Number(heightText);
                const restitution = Number(restitutionText);

                if (
                  !Number.isFinite(width) ||
                  !Number.isFinite(height) ||
                  !Number.isFinite(restitution)
                ) {
                  setPlatformFormError("Every value must be finite.");
                  return;
                }

                if (width <= 0 || height <= 0) {
                  setPlatformFormError(
                    "Width and height must be greater than zero.",
                  );
                  return;
                }

                if (restitution < 0 || restitution > 1) {
                  setPlatformFormError("Restitution must be between 0 and 1.");
                  return;
                }

                labStore.getState().setActiveTool({
                  kind: "place",
                  entityKind: "platform",
                  platformProperties: {
                    widthMeters: width,
                    heightMeters: height,
                    restitution,
                  },
                });

                setPlatformFormError(null);
                setPlatformMenuOpen(false);
              }}
            >
              <label>
                Width (m)
                <input
                  name="width"
                  defaultValue={DEFAULT_PLATFORM_PROPERTIES.widthMeters}
                />
              </label>

              <label>
                Height (m)
                <input
                  name="height"
                  defaultValue={DEFAULT_PLATFORM_PROPERTIES.heightMeters}
                />
              </label>

              <label>
                Restitution (0–1)
                <input
                  name="restitution"
                  defaultValue={DEFAULT_PLATFORM_PROPERTIES.restitution}
                />
              </label>

              {platformFormError !== null && (
                <p role="alert">{platformFormError}</p>
              )}

              <div className="placement-submenu__actions">
                <button
                  type="button"
                  onClick={() => {
                    setPlatformFormError(null);
                    setPlatformMenuOpen(false);
                  }}
                >
                  Cancel
                </button>

                <button type="submit">Place platform</button>
              </div>
            </form>
          )}
        </li>
        <li>
          <button
            className="object-tool-button"
            type="button"
            aria-expanded={rampMenuOpen}
            aria-pressed={
              activeTool.kind === "place" && activeTool.entityKind === "ramp"
            }
            onClick={() => {
              setProjectileMenuOpen(false);
              setPlatformMenuOpen(false);
              setTargetMenuOpen(false);
              setRampMenuOpen((open) => !open);
            }}
          >
            <TriangleRight size={16} />
            <strong>Ramp</strong>
            <span>A fixed platform placed at an angle.</span>
          </button>

          {rampMenuOpen && (
            <form
              className="placement-submenu"
              onSubmit={(event) => {
                event.preventDefault();

                const form = new FormData(event.currentTarget);
                const read = (name: string) =>
                  String(form.get(name) ?? "").trim();

                const widthText = read("width");
                const heightText = read("height");
                const angleText = read("angle");
                const restitutionText = read("restitution");

                if (
                  widthText === "" ||
                  heightText === "" ||
                  angleText === "" ||
                  restitutionText === ""
                ) {
                  setRampFormError("Every field is required.");
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
                  setRampFormError("Every value must be finite.");
                  return;
                }

                if (width <= 0 || height <= 0) {
                  setRampFormError(
                    "Width and height must be greater than zero.",
                  );
                  return;
                }

                if (restitution < 0 || restitution > 1) {
                  setRampFormError("Restitution must be between 0 and 1.");
                  return;
                }

                labStore.getState().setActiveTool({
                  kind: "place",
                  entityKind: "ramp",
                  rampProperties: {
                    widthMeters: width,
                    heightMeters: height,
                    angleDegrees: angle,
                    restitution,
                  },
                });

                setRampFormError(null);
                setRampMenuOpen(false);
              }}
            >
              <label>
                Width (m)
                <input
                  name="width"
                  defaultValue={DEFAULT_RAMP_PROPERTIES.widthMeters}
                />
              </label>

              <label>
                Height (m)
                <input
                  name="height"
                  defaultValue={DEFAULT_RAMP_PROPERTIES.heightMeters}
                />
              </label>

              <label>
                Surface angle (°)
                <input
                  name="angle"
                  defaultValue={DEFAULT_RAMP_PROPERTIES.angleDegrees}
                />
              </label>

              <label>
                Restitution (0–1)
                <input
                  name="restitution"
                  defaultValue={DEFAULT_RAMP_PROPERTIES.restitution}
                />
              </label>

              {rampFormError !== null && <p role="alert">{rampFormError}</p>}

              <div className="placement-submenu__actions">
                <button
                  type="button"
                  onClick={() => {
                    setRampFormError(null);
                    setRampMenuOpen(false);
                  }}
                >
                  Cancel
                </button>

                <button type="submit">Place ramp</button>
              </div>
            </form>
          )}
        </li>

        <li>
          <button
            className="object-tool-button"
            type="button"
            aria-expanded={targetMenuOpen}
            aria-pressed={
              activeTool.kind === "place" && activeTool.entityKind === "target"
            }
            onClick={() => {
              setProjectileMenuOpen(false);
              setPlatformMenuOpen(false);
              setRampMenuOpen(false);
              setTargetMenuOpen((open) => !open);
            }}
          >
            <Target size={16} />
            <strong>Target zone</strong>
            <span>A pass-through circular sensor that detects entry.</span>
          </button>

          {targetMenuOpen && (
            <form
              className="placement-submenu"
              onSubmit={(event) => {
                event.preventDefault();

                const form = new FormData(event.currentTarget);
                const radiusText = String(form.get("radius") ?? "").trim();

                if (radiusText === "") {
                  setTargetFormError("Radius is required.");
                  return;
                }

                const radius = Number(radiusText);

                if (!Number.isFinite(radius)) {
                  setTargetFormError("Radius must be finite.");
                  return;
                }

                if (radius <= 0) {
                  setTargetFormError("Radius must be greater than zero.");
                  return;
                }

                labStore.getState().setActiveTool({
                  kind: "place",
                  entityKind: "target",
                  targetProperties: {
                    radiusMeters: radius,
                  },
                });

                setTargetFormError(null);
                setTargetMenuOpen(false);
              }}
            >
              <label>
                Radius (m)
                <input
                  name="radius"
                  defaultValue={DEFAULT_TARGET_PROPERTIES.radiusMeters}
                />
              </label>

              {targetFormError !== null && (
                <p role="alert">{targetFormError}</p>
              )}

              <div className="placement-submenu__actions">
                <button
                  type="button"
                  onClick={() => {
                    setTargetFormError(null);
                    setTargetMenuOpen(false);
                  }}
                >
                  Cancel
                </button>

                <button type="submit">Place target</button>
              </div>
            </form>
          )}
        </li>
      </ul>
    </>
  );
}
