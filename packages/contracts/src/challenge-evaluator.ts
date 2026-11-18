// The one challenge evaluator, shared by the browser player and, from W03, the server's revalidation.
import type { ChallengeAttempt, ChallengeDefinition, ChallengeExplanation, ChallengeStatus, IntervalCriterion, InvalidReason, MissCondition } from "./index.js";

// Matches {measurementId} and {criterionId.gap} inside explanation text.
export const CHALLENGE_MESSAGE_TOKEN = /\{([A-Za-z][A-Za-z0-9]*)(\.gap)?\}/g;

export type CriterionStatus = "pass" | "fail" | "borderline";

export interface CriterionResult {
  readonly criterionId: string;
  readonly value: number | undefined;
  readonly status: CriterionStatus;
  // Where the value lies: for a borderline value, the edge its uncertainty band crosses.
  readonly side: "inside" | "below" | "above" | "absent";
}

export interface ChallengeResult {
  readonly status: ChallengeStatus;
  // "success", "borderline", an invalid reason, "fallbackMiss" or the id of the miss rule that explained the miss.
  readonly reasonId: string;
  readonly title: string;
  readonly message: string;
  readonly criteria: readonly CriterionResult[];
}

// Pass when the value with its uncertainty lies inside; fail when it lies wholly outside; otherwise borderline.
export function judgeCriterion(criterion: IntervalCriterion, value: number | undefined): CriterionResult {
  if (value === undefined) {
    return { criterionId: criterion.id, value, status: "fail", side: "absent" };
  }

  const lowest = value - criterion.uncertainty;
  const highest = value + criterion.uncertainty;

  if (highest < criterion.minimum) {
    return { criterionId: criterion.id, value, status: "fail", side: "below" };
  }

  if (lowest > criterion.maximum) {
    return { criterionId: criterion.id, value, status: "fail", side: "above" };
  }

  if (lowest >= criterion.minimum && highest <= criterion.maximum) {
    return { criterionId: criterion.id, value, status: "pass", side: "inside" };
  }

  return { criterionId: criterion.id, value, status: "borderline", side: lowest < criterion.minimum ? "below" : "above" };
}

// An attempt that cannot be trusted is invalid whatever its numbers say.
function findInvalidReason(attempt: ChallengeAttempt): InvalidReason | undefined {
  if (attempt.runStatus === "forbiddenEdit") {
    return "forbiddenEdit";
  }

  if (attempt.runStatus === "engineFailure") {
    return "engineFailure";
  }

  if (attempt.runStatus === "incomplete") {
    return "incompleteRun";
  }

  if (Object.values(attempt.measurements).some((value) => value !== undefined && !Number.isFinite(value))) {
    return "nonFiniteValue";
  }

  return undefined;
}

function conditionHolds(condition: MissCondition, criteria: readonly CriterionResult[], attempt: ChallengeAttempt): boolean {
  switch (condition.kind) {
    case "criterion": {
      const result = criteria.find((item) => item.criterionId === condition.criterionId);
      return result !== undefined && result.status === "fail" && result.side === condition.side;
    }
    case "measurement": {
      const value = attempt.measurements[condition.measurementId];

      if (value === undefined) {
        return false;
      }

      return condition.side === "below" ? value < condition.threshold : value > condition.threshold;
    }
    case "firstContact":
      return attempt.firstContact === condition.surfaceId;
  }
}

function formatMeasurement(definition: ChallengeDefinition, measurementId: string, value: number | undefined): string {
  const measurement = definition.measurements.find((item) => item.id === measurementId);

  if (value === undefined || measurement === undefined) {
    return "n/a";
  }

  return `${value.toFixed(measurement.decimals)} ${measurement.unit}`;
}

// Put the attempt's own numbers into the authored text, so a miss says how far, not only that it missed.
function fillMessage(template: string, definition: ChallengeDefinition, attempt: ChallengeAttempt, criteria: readonly CriterionResult[]): string {
  return template.replace(CHALLENGE_MESSAGE_TOKEN, (token: string, name: string, gap: string | undefined) => {
    if (gap === undefined) {
      return formatMeasurement(definition, name, attempt.measurements[name]);
    }

    const criterion = definition.objective.criteria.find((item) => item.id === name);
    const value = criteria.find((item) => item.criterionId === name)?.value;

    if (criterion === undefined) {
      return token;
    }

    if (value === undefined) {
      return "n/a";
    }

    const distance = value < criterion.minimum ? criterion.minimum - value : Math.max(0, value - criterion.maximum);
    return formatMeasurement(definition, criterion.measurement, distance);
  });
}

function conclude(
  status: ChallengeStatus,
  reasonId: string,
  explanation: ChallengeExplanation,
  definition: ChallengeDefinition,
  attempt: ChallengeAttempt,
  criteria: readonly CriterionResult[],
): ChallengeResult {
  return {
    status,
    reasonId,
    title: explanation.title,
    message: fillMessage(explanation.message, definition, attempt, criteria),
    criteria,
  };
}

// The one evaluator every challenge uses: the definition's data decides everything, so no card has success code of its own.
export function evaluateAttempt(definition: ChallengeDefinition, attempt: ChallengeAttempt): ChallengeResult {
  const invalidReason = findInvalidReason(attempt);

  if (invalidReason !== undefined) {
    return conclude("invalid", invalidReason, definition.explanations.invalid[invalidReason], definition, attempt, []);
  }

  const criteria = definition.objective.criteria.map((criterion) => judgeCriterion(criterion, attempt.measurements[criterion.measurement]));

  if (criteria.some((item) => item.status === "fail")) {
    const rule = definition.explanations.misses.find((candidate) => candidate.when.every((condition) => conditionHolds(condition, criteria, attempt)));
    return conclude("miss", rule?.id ?? "fallbackMiss", rule ?? definition.explanations.fallbackMiss, definition, attempt, criteria);
  }

  if (criteria.every((item) => item.status === "pass")) {
    return conclude("success", "success", definition.explanations.success, definition, attempt, criteria);
  }

  return conclude("borderline", "borderline", definition.explanations.borderline, definition, attempt, criteria);
}
