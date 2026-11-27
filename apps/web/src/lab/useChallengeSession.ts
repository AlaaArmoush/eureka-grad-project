import { useCallback, useRef, useState, type RefObject } from "react";
import { evaluateAttempt, type ChallengeAttempt, type ChallengeDefinition, type ChallengeResult, type ChallengeSample, type SceneDefinition, type Snapshot, type Vector2 } from "@eureka/contracts";
import { applyValues, checkValue, findLockViolations, initialValues, valueKey, type ChallengeValues } from "./challenge-player.js";
import { createAttemptObserver, type AttemptObserver, type ZoneState } from "./challenge-run.js";
import type { LabController } from "./controller.js";
import type { ChallengeLoad } from "./demo-loading.js";
import { labStore } from "./store.js";

export interface ChallengeSession {
  readonly definition: ChallengeDefinition;
  // The values the lab's scene currently holds.
  readonly values: ChallengeValues;
  readonly phase: "ready" | "running" | "finished";
  // Attempts that ran to a result, not counting sample reviews.
  readonly attempts: number;
  readonly result: ChallengeResult | null;
  // Set when the shown result is a reviewed sample and not the learner's own run.
  readonly resultLabel: string | null;
  // How many of the definition's hints are visible. Each attempt that is not a success reveals one more.
  readonly hintsShown: number;
}

// Holds the open challenge, observes each attempt and keeps the ghost of the previous one.
export function useChallengeSession(applyScene: (scene: SceneDefinition) => void, controllerRef: RefObject<LabController | null>) {
  const [session, setSession] = useState<ChallengeSession | null>(null);
  // The latest session, for callbacks such as the per-tick observer that must not wait for a render.
  const sessionRef = useRef<ChallengeSession | null>(null);
  const observerRef = useRef<AttemptObserver | null>(null);
  // The path of the last attempt that ran to a result, and the ghosts shown during the current attempt.
  const lastPathRef = useRef<readonly Vector2[] | null>(null);
  const ghostsRef = useRef<readonly (readonly Vector2[])[]>([]);

  const commit = useCallback((next: ChallengeSession | null): void => {
    sessionRef.current = next;
    setSession(next);
  }, []);

  // Draw the zones in their current states, the ghosts and the live path.
  const showOverlay = useCallback((definition: ChallengeDefinition, live: readonly Vector2[], states: readonly ZoneState[]): void => {
    const zones = definition.objective.zones.map((zone, index) => ({ zone, state: states[index] ?? "waiting" }));
    labStore.getState().setChallengeOverlay({ zones, live, ghosts: ghostsRef.current });
  }, []);

  // A new attempt begins: drop the observer, turn the last finished path into the ghost the definition asks for, turn every zone red and clear the result.
  const startNextAttempt = useCallback((next: ChallengeSession): void => {
    observerRef.current = null;
    ghostsRef.current = next.definition.reset.previousTrail === "ghost" && lastPathRef.current !== null ? [lastPathRef.current] : [];
    showOverlay(next.definition, [], []);
    commit({ ...next, phase: "ready", result: null, resultLabel: null });
  }, [commit, showOverlay]);

  const begin = useCallback((load: ChallengeLoad): void => {
    lastPathRef.current = null;
    startNextAttempt({ definition: load.definition, values: load.values, phase: "ready", attempts: 0, result: null, resultLabel: null, hintsShown: 0 });
  }, [startNextAttempt]);

  const end = useCallback((): void => {
    observerRef.current = null;
    lastPathRef.current = null;
    ghostsRef.current = [];
    labStore.getState().setChallengeOverlay({ zones: [], live: [], ghosts: [] });
    commit(null);
  }, [commit]);

  // Check one chosen value against its range. Accept it into the scene and start a new attempt, or return the reason it was refused.
  const setValue = useCallback((key: string, value: number): string | null => {
    const current = sessionRef.current;

    if (current === null) {
      return "No challenge is open.";
    }

    const item = current.definition.editable.find((candidate) => valueKey(candidate) === key);

    if (item === undefined) {
      return "That value is locked by the challenge.";
    }

    const message = checkValue(item, value);

    if (message !== null) {
      return message;
    }

    const values = { ...current.values, [key]: value };

    applyScene(applyValues(current.definition, values));
    startNextAttempt({ ...current, values });
    return null;
  }, [applyScene, startNextAttempt]);

  // Judge a finished attempt with the one shared evaluator and reveal the next hint when it was not a success.
  const conclude = useCallback((attempt: ChallengeAttempt, path: readonly Vector2[]): void => {
    const current = sessionRef.current;

    if (current === null) {
      return;
    }

    const result = evaluateAttempt(current.definition, attempt);

    if (path.length > 1) {
      lastPathRef.current = path;
    }

    observerRef.current = null;
    commit({
      ...current,
      phase: "finished",
      attempts: current.attempts + 1,
      result,
      resultLabel: null,
      hintsShown: result.status === "success" ? current.hintsShown : Math.min(current.definition.hints.length, current.hintsShown + 1),
    });
  }, [commit]);

  // Every accepted tick of the lab's run arrives here. It must stay a stable function.
  const onTick = useCallback((snapshot: Snapshot): void => {
    const current = sessionRef.current;
    const controller = controllerRef.current;

    // Tick zero is a restart, never a step of a run, and a finished attempt takes no more ticks.
    if (current === null || controller === null || current.phase === "finished" || snapshot.tick === 0) {
      return;
    }

    let observer = observerRef.current;

    if (observer === null) {
      const scene = controller.copyScene();

      // Before the first tick of an attempt, refuse a scene that differs from what the definition allows.
      if (findLockViolations(current.definition, scene, current.values).length > 0) {
        controller.pause();
        conclude({ runStatus: "forbiddenEdit", measurements: {}, firstContact: null }, []);
        return;
      }

      observer = createAttemptObserver(current.definition, scene);
      observerRef.current = observer;
      commit({ ...current, phase: "running" });
    }

    const ended = observer.observe(snapshot);
    showOverlay(current.definition, observer.path(), observer.zoneStates());

    if (ended) {
      controller.pause();
      conclude(observer.finish(), observer.path());
    }
  }, [commit, conclude, controllerRef, showOverlay]);

  // The engine reported a failed tick during an attempt.
  const onEngineFailure = useCallback((): void => {
    const observer = observerRef.current;

    if (observer === null) {
      return;
    }

    observer.fail();
    conclude(observer.finish(), observer.path());
  }, [conclude]);

  // The learner reset the lab: the attempt in progress is dropped, and its finished path becomes the ghost if there was one.
  const resetAttempt = useCallback((): void => {
    const current = sessionRef.current;

    if (current !== null) {
      startNextAttempt(current);
    }
  }, [startNextAttempt]);

  // Start the attempt over, from the learner's last values or from the authored start, as the definition says.
  const retry = useCallback((): void => {
    const current = sessionRef.current;

    if (current === null) {
      return;
    }

    if (current.definition.reset.editableValues === "restoreStart") {
      const values = initialValues(current.definition);
      applyScene(applyValues(current.definition, values));
      startNextAttempt({ ...current, values });
      return;
    }

    // Bookkeeping first, so the tick-zero snapshot of the reset is ignored by the observer.
    startNextAttempt(current);
    controllerRef.current?.reset();
  }, [applyScene, controllerRef, startNextAttempt]);

  // Called before Run. A finished attempt is retried first. False means the scene was replaced, so Run must be pressed again.
  const beforeRun = useCallback((): boolean => {
    const current = sessionRef.current;

    if (current === null || current.phase !== "finished") {
      return true;
    }

    retry();
    return current.definition.reset.editableValues !== "restoreStart";
  }, [retry]);

  // Show what the evaluator says about a reviewed, formula-derived sample, without touching the attempt count or the hints.
  const showSample = useCallback((sample: ChallengeSample): void => {
    const current = sessionRef.current;

    if (current === null) {
      return;
    }

    commit({ ...current, result: evaluateAttempt(current.definition, sample.attempt), resultLabel: sample.label });
  }, [commit]);

  return { session, begin, end, setValue, onTick, onEngineFailure, resetAttempt, retry, beforeRun, showSample };
}
