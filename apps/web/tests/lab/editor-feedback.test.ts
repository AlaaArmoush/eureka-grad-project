import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { ObservationNotebook } from "../../src/lab/ObservationNotebook.js";
import { PropertiesPanel } from "../../src/lab/PropertiesPanel.js";
import { PROJECTILE_LAB_MOCK } from "../../src/lab/mocks.js";

// Position editing stays in the X/Y readout without another set of action buttons.
it("offers inline X and Y editing without duplicate position actions", () => {
  const html = renderToStaticMarkup(createElement(PropertiesPanel, {
    controllerRef: { current: null },
    displayedSnapshot: PROJECTILE_LAB_MOCK.snapshot,
    editableScene: PROJECTILE_LAB_MOCK.scene,
    selectedEntityId: "projectile",
    setEditableScene: () => {},
  }));

  expect(html).toContain('aria-label="Edit X position"');
  expect(html).toContain('aria-label="Edit Y position"');
  expect(html).not.toContain("Apply position");
  expect(html).not.toContain("Cancel position edit");
  expect(html).not.toContain("Horizontal position");
  expect(html).not.toContain("Vertical position");
});

// Running positions are readouts; physical coordinate editing waits until playback is paused.
it("keeps coordinate controls unavailable while playback is running", () => {
  const html = renderToStaticMarkup(createElement(PropertiesPanel, {
    controllerRef: { current: null },
    displayedSnapshot: PROJECTILE_LAB_MOCK.snapshot,
    editableScene: PROJECTILE_LAB_MOCK.scene,
    selectedEntityId: "projectile",
    playing: true,
    setEditableScene: () => {},
  }));

  expect(html).not.toContain('name="edit-position-x"');
  expect(html).not.toContain('name="edit-position-y"');
  expect(html).toContain("Rotation");
});

// No selection is an ordinary editor state, with guidance rather than a missing-object error.
it("explains how to select an object when the inspector has no selection", () => {
  const html = renderToStaticMarkup(createElement(PropertiesPanel, {
    controllerRef: { current: null },
    displayedSnapshot: PROJECTILE_LAB_MOCK.snapshot,
    editableScene: PROJECTILE_LAB_MOCK.scene,
    selectedEntityId: null,
    setEditableScene: () => {},
  }));

  expect(html).toContain("No object selected");
  expect(html).not.toContain("Object no longer exists");
  expect(html).not.toContain("Apply changes");
});

// A retained ID absent from the scene must not receive the ordinary empty-selection message.
it("identifies a missing selected object without offering a property edit", () => {
  const html = renderToStaticMarkup(createElement(PropertiesPanel, {
    controllerRef: { current: null },
    displayedSnapshot: PROJECTILE_LAB_MOCK.snapshot,
    editableScene: PROJECTILE_LAB_MOCK.scene,
    selectedEntityId: "removed-projectile",
    setEditableScene: () => {},
  }));

  expect(html).toContain("Object no longer exists");
  expect(html).not.toContain("No object selected");
  expect(html).not.toContain("Apply changes");
});

// Missing body data gets one explanation while scene time stays visible.
it("explains unavailable body measurements while keeping scene time visible", () => {
  const html = renderToStaticMarkup(createElement(ObservationNotebook, {
    snapshot: { ...PROJECTILE_LAB_MOCK.snapshot, bodies: [], simulationTimeSeconds: 2.5 },
    selectedEntityId: "projectile",
  }));

  expect(html).toContain("Measurement unavailable");
  expect(html.match(/Measurement unavailable/g)).toHaveLength(1);
  expect(html).toContain("2.5000");
});

// Missing selection explains the next action; it does not imply a failed physical calculation.
it("asks for a selection when the notebook has none", () => {
  const html = renderToStaticMarkup(createElement(ObservationNotebook, {
    snapshot: PROJECTILE_LAB_MOCK.snapshot,
    selectedEntityId: null,
  }));

  expect(html).toContain("No object selected");
  expect(html).not.toContain("Measurement unavailable:");
});

// Each invalid number gets its own case, so one failure cannot hide the other inputs.
it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
  "labels a nonfinite position (%s) as unavailable without exposing numeric garbage",
  (invalidPosition) => {
    const snapshot = structuredClone(PROJECTILE_LAB_MOCK.snapshot);
    const html = renderToStaticMarkup(createElement(ObservationNotebook, {
      snapshot: {
        ...snapshot,
        bodies: snapshot.bodies.map((body) => body.id === "projectile" ? {
          ...body,
          pose: { ...body.pose, positionMeters: { ...body.pose.positionMeters, x: invalidPosition } },
        } : body),
      },
      selectedEntityId: "projectile",
    }));

    expect(html).toContain("Unavailable");
    expect(html).not.toContain("NaN");
    expect(html).not.toContain("Infinity");
  },
);

// A real zero is valid data, including zero speed; truthiness must not hide it.
it("preserves zero position and velocity as available measurements", () => {
  const snapshot = structuredClone(PROJECTILE_LAB_MOCK.snapshot);
  const html = renderToStaticMarkup(createElement(ObservationNotebook, {
    snapshot: {
      ...snapshot,
      bodies: snapshot.bodies.map((body) => ({
        ...body,
        pose: { ...body.pose, positionMeters: { x: 0, y: 0 } },
        velocity: { linearMetersPerSecond: { x: 0, y: 0 }, angularRadiansPerSecond: 0 },
      })),
    },
    selectedEntityId: "projectile",
  }));

  expect(html).toContain("0.0000");
  expect(html).not.toContain("Unavailable");
  expect(html).not.toContain("Measurement unavailable");
});
