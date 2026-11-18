import type { ChallengeDefinition, Diagnostic } from "./index.js";
import { CHALLENGE_MESSAGE_TOKEN, evaluateAttempt } from "./challenge-evaluator.js";
import { checkShape, exactly, listOf, mapOf, NUMBER, oneOf, orNull, OVERLAYS, record, SCENE, TEXT, TOPIC, variants, VECTOR } from "./data-shape.js";

const EXPLANATION = record({ title: TEXT, message: TEXT });
const PROPERTY = oneOf("launchSpeed", "launchAngle", "mass", "gravity", "linearDrag");

// Keep this in step with ChallengeDefinition in index.ts.
const CHALLENGE = record({
  schemaVersion: exactly(1),
  id: TEXT,
  revision: NUMBER,
  topic: TOPIC,
  level: oneOf("guided", "independent", "application"),
  title: TEXT,
  briefing: TEXT,
  scene: SCENE,
  projectileId: TEXT,
  view: record({ centerWorldMeters: VECTOR, widthMeters: NUMBER, heightMeters: NUMBER, pixelsPerMeter: NUMBER }),
  overlays: OVERLAYS,
  runLimitSeconds: NUMBER,
  attemptEnds: oneOf("firstContact", "allZonesReached"),
  editable: listOf(record({ property: PROPERTY, bodyId: orNull(TEXT), label: TEXT, unit: TEXT, minimum: NUMBER, maximum: NUMBER, step: NUMBER })),
  locked: listOf(record({ property: PROPERTY, bodyId: orNull(TEXT), label: TEXT, unit: TEXT, value: NUMBER, reason: TEXT })),
  measurements: listOf(record({
    id: TEXT,
    label: TEXT,
    unit: TEXT,
    decimals: NUMBER,
    quantity: oneOf("contactDistance", "contactTime", "apexHeight", "dragFreeContactDistance", "dragFreeContactTime"),
    onSurfaces: orNull(listOf(TEXT)),
  })),
  objective: record({
    summary: TEXT,
    criteria: listOf(record({ id: TEXT, measurement: TEXT, label: TEXT, minimum: NUMBER, maximum: NUMBER, uncertainty: NUMBER })),
    zones: listOf(record({ targetId: TEXT, label: TEXT, criterionId: orNull(TEXT) })),
  }),
  explanations: record({
    success: EXPLANATION,
    borderline: EXPLANATION,
    invalid: record({ engineFailure: EXPLANATION, nonFiniteValue: EXPLANATION, incompleteRun: EXPLANATION, forbiddenEdit: EXPLANATION }),
    misses: listOf(record({
      id: TEXT,
      title: TEXT,
      message: TEXT,
      when: listOf(variants("kind", {
        criterion: record({ kind: exactly("criterion"), criterionId: TEXT, side: oneOf("below", "above", "absent") }),
        measurement: record({ kind: exactly("measurement"), measurementId: TEXT, side: oneOf("below", "above"), threshold: NUMBER }),
        firstContact: record({ kind: exactly("firstContact"), surfaceId: TEXT }),
      })),
    })),
    fallbackMiss: EXPLANATION,
  }),
  hints: listOf(record({ text: TEXT, reveal: orNull(oneOf("apexMarker", "predictedCrossing")) })),
  reset: record({ editableValues: oneOf("keepLast", "restoreStart"), previousTrail: oneOf("ghost", "clear") }),
  comparison: oneOf("none", "dragFreePath"),
  relatedDemonstrationIds: listOf(TEXT),
  samples: listOf(record({
    id: TEXT,
    label: TEXT,
    source: TEXT,
    expectedStatus: oneOf("success", "miss", "borderline", "invalid"),
    expectedReasonId: TEXT,
    attempt: record({ runStatus: oneOf("complete", "incomplete", "engineFailure", "forbiddenEdit"), measurements: mapOf(NUMBER), firstContact: orNull(TEXT) }),
  })),
});


// Broken references, impossible bounds and text that names nothing; only run on a definition whose shape is already right.
function findReferenceProblems(definition: ChallengeDefinition): readonly Diagnostic[] {
  const problems: Diagnostic[] = [];
  const report = (code: string, path: string, message: string): void => {
    problems.push({ code, path, message });
  };
  const requireUnique = (path: string, ids: readonly string[]): void => {
    ids.forEach((id, index) => {
      if (ids.indexOf(id) !== index) {
        report("DUPLICATE_ID", `${path}[${index}]`, `The id "${id}" is used twice.`);
      }
    });
  };

  const measurementIds = new Set(definition.measurements.map((item) => item.id));
  const criterionIds = new Set(definition.objective.criteria.map((item) => item.id));
  const staticIds = new Set(definition.scene.bodies.flatMap((body) => body.kind === "static" ? [body.id] : []));
  const dynamicIds = new Set(definition.scene.bodies.flatMap((body) => body.kind === "dynamic" ? [body.id] : []));

  requireUnique("scene.bodies", definition.scene.bodies.map((item) => item.id));
  requireUnique("measurements", definition.measurements.map((item) => item.id));
  requireUnique("objective.criteria", definition.objective.criteria.map((item) => item.id));
  requireUnique("explanations.misses", definition.explanations.misses.map((item) => item.id));

  if (!dynamicIds.has(definition.projectileId)) {
    report("UNKNOWN_REFERENCE", "projectileId", `"${definition.projectileId}" is not a dynamic body of the scene.`);
  }

  if (!(definition.runLimitSeconds > 0)) {
    report("OUT_OF_RANGE", "runLimitSeconds", "The run limit must be a positive time.");
  }

  if (!(definition.view.widthMeters > 0 && definition.view.heightMeters > 0 && definition.view.pixelsPerMeter > 0)) {
    report("OUT_OF_RANGE", "view", "The view needs a positive width, height and scale.");
  }

  if (definition.objective.criteria.length === 0) {
    report("OUT_OF_RANGE", "objective.criteria", "A challenge needs at least one criterion.");
  }

  definition.measurements.forEach((measurement, index) => {
    if (!Number.isInteger(measurement.decimals) || measurement.decimals < 0 || measurement.decimals > 10) {
      report("OUT_OF_RANGE", `measurements[${index}].decimals`, "Decimals must be a whole number from 0 to 10.");
    }

    for (const surfaceId of measurement.onSurfaces ?? []) {
      if (!staticIds.has(surfaceId)) {
        report("UNKNOWN_REFERENCE", `measurements[${index}].onSurfaces`, `"${surfaceId}" is not a static body of the scene.`);
      }
    }
  });

  definition.objective.criteria.forEach((criterion, index) => {
    const path = `objective.criteria[${index}]`;

    if (!measurementIds.has(criterion.measurement)) {
      report("UNKNOWN_REFERENCE", `${path}.measurement`, `"${criterion.measurement}" is not a declared measurement.`);
    }

    if (criterion.minimum >= criterion.maximum || criterion.uncertainty < 0) {
      report("OUT_OF_RANGE", path, "Minimum must be below maximum, and uncertainty must not be negative.");
    } else if (2 * criterion.uncertainty > criterion.maximum - criterion.minimum) {
      report("OUT_OF_RANGE", path, "The uncertainty is wider than the interval, so no attempt could ever pass.");
    }
  });

  requireUnique("objective.zones", definition.objective.zones.map((item) => item.targetId));

  if (definition.attemptEnds === "allZonesReached" && definition.objective.zones.length === 0) {
    report("OUT_OF_RANGE", "attemptEnds", "An attempt cannot wait for every zone when there are no zones.");
  }

  const targetIds = new Set(definition.scene.triggers.map((trigger) => trigger.id));

  definition.objective.zones.forEach((zone, index) => {
    const path = `objective.zones[${index}]`;

    if (!targetIds.has(zone.targetId)) {
      report("UNKNOWN_REFERENCE", `${path}.targetId`, `"${zone.targetId}" is not a target of the scene.`);
    }

    if (zone.criterionId !== null && !criterionIds.has(zone.criterionId)) {
      report("UNKNOWN_REFERENCE", `${path}.criterionId`, `"${zone.criterionId}" is not a criterion.`);
    }
  });

  definition.explanations.misses.forEach((rule, ruleIndex) => {
    rule.when.forEach((condition, index) => {
      const path = `explanations.misses[${ruleIndex}].when[${index}]`;

      if (condition.kind === "criterion" && !criterionIds.has(condition.criterionId)) {
        report("UNKNOWN_REFERENCE", path, `"${condition.criterionId}" is not a criterion.`);
      } else if (condition.kind === "measurement" && !measurementIds.has(condition.measurementId)) {
        report("UNKNOWN_REFERENCE", path, `"${condition.measurementId}" is not a declared measurement.`);
      } else if (condition.kind === "firstContact" && !staticIds.has(condition.surfaceId)) {
        report("UNKNOWN_REFERENCE", path, `"${condition.surfaceId}" is not a static body of the scene.`);
      }
    });
  });

  definition.editable.forEach((item, index) => {
    const path = `editable[${index}]`;

    if (item.bodyId !== null && !dynamicIds.has(item.bodyId)) {
      report("UNKNOWN_REFERENCE", `${path}.bodyId`, `"${item.bodyId}" is not a dynamic body of the scene.`);
    }

    if (!(item.minimum < item.maximum && item.step > 0)) {
      report("OUT_OF_RANGE", path, "An editable range needs a minimum below its maximum and a positive step.");
    }

    if (definition.locked.some((lock) => lock.property === item.property && lock.bodyId === item.bodyId)) {
      report("CONFLICT", path, `"${item.label}" is both editable and locked.`);
    }
  });

  const texts: readonly (readonly [string, string])[] = [
    ["explanations.success", definition.explanations.success.message],
    ["explanations.borderline", definition.explanations.borderline.message],
    ["explanations.fallbackMiss", definition.explanations.fallbackMiss.message],
    ...Object.entries(definition.explanations.invalid).map(([reason, text]) => [`explanations.invalid.${reason}`, text.message] as const),
    ...definition.explanations.misses.map((rule, index) => [`explanations.misses[${index}]`, rule.message] as const),
  ];

  for (const [path, message] of texts) {
    for (const match of message.matchAll(CHALLENGE_MESSAGE_TOKEN)) {
      const name = match[1] ?? "";
      const known = match[2] === undefined ? measurementIds.has(name) : criterionIds.has(name);

      if (!known) {
        report("UNKNOWN_REFERENCE", `${path}.message`, `The text uses ${match[0]}, which names nothing in this definition.`);
      }
    }
  }

  return problems;
}

// The one check for challenge data from any source (a file, a database row): shape first, then references and bounds.
export function findChallengeDefinitionProblems(value: unknown): readonly Diagnostic[] {
  const problems: Diagnostic[] = [];
  checkShape(value, CHALLENGE, "", problems);

  if (problems.length > 0) {
    return problems;
  }

  const definition = value as ChallengeDefinition;
  const referenceProblems = findReferenceProblems(definition);

  if (referenceProblems.length > 0) {
    return referenceProblems;
  }

  return findSampleProblems(definition);
}

// Every reviewed sample must get exactly the verdict and reason it was reviewed with, so a rubric and its samples cannot drift apart.
function findSampleProblems(definition: ChallengeDefinition): readonly Diagnostic[] {
  const problems: Diagnostic[] = [];
  const ids = definition.samples.map((sample) => sample.id);

  definition.samples.forEach((sample, index) => {
    const path = `samples[${index}]`;

    if (ids.indexOf(sample.id) !== index) {
      problems.push({ code: "DUPLICATE_ID", path, message: `The id "${sample.id}" is used twice.` });
      return;
    }

    const result = evaluateAttempt(definition, sample.attempt);

    if (result.status !== sample.expectedStatus || result.reasonId !== sample.expectedReasonId) {
      problems.push({ code: "SAMPLE_MISMATCH", path, message: `"${sample.id}" expects ${sample.expectedStatus}/${sample.expectedReasonId} but the rubric gives ${result.status}/${result.reasonId}.` });
    }
  });

  return problems;
}
