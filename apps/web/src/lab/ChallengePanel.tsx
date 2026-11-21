import { useState } from "react";
import { Lock, Play, RotateCcw, X } from "lucide-react";
import type { ChallengeDefinition, ChallengeSample, ChallengeStatus, CriterionResult } from "@eureka/contracts";
import { TOPIC_LABEL, valueKey } from "./challenge-player.js";
import type { ChallengeSession } from "./useChallengeSession.js";

const LEVEL_LABEL = { guided: "Guided", independent: "Independent", application: "Application" } as const;
const STATUS_TITLE: Readonly<Record<ChallengeStatus, string>> = { success: "Success", miss: "Missed", borderline: "Too close to call", invalid: "Could not be judged" };
const CRITERION_WORD = { pass: "Pass", fail: "Miss", borderline: "Borderline" } as const;

// Show a number the way a person types it, without floating-point noise.
function formatValue(value: number): string {
  return String(Number(value.toPrecision(12)));
}

function without(record: Readonly<Record<string, string>>, key: string): Record<string, string> {
  return Object.fromEntries(Object.entries(record).filter(([name]) => name !== key));
}

// One line for a criterion: what was measured and what the definition accepts.
function describeCriterion(definition: ChallengeDefinition, item: CriterionResult): string {
  const criterion = definition.objective.criteria.find((candidate) => candidate.id === item.criterionId);
  const measurement = definition.measurements.find((candidate) => candidate.id === criterion?.measurement);

  if (criterion === undefined || measurement === undefined) {
    return item.criterionId;
  }

  const format = (value: number): string => value.toFixed(measurement.decimals);
  const measured = item.value === undefined ? "not reached" : `${format(item.value)} ${measurement.unit}`;

  return `${criterion.label}: ${measured}. Accepted ${format(criterion.minimum)} to ${format(criterion.maximum)} ${measurement.unit}, uncertainty ±${criterion.uncertainty} ${measurement.unit}.`;
}

export function ChallengePanel({ session, playing, canLaunch, onSetValue, onLaunch, onRetry, onShowSample, onExit }: {
  readonly session: ChallengeSession;
  readonly playing: boolean;
  readonly canLaunch: boolean;
  onSetValue(key: string, value: number): string | null;
  onLaunch(): void;
  onRetry(): void;
  onShowSample(sample: ChallengeSample): void;
  onExit(): void;
}) {
  const { definition, values, result } = session;
  // What has been typed but not yet accepted, and why an entry was refused.
  const [drafts, setDrafts] = useState<Readonly<Record<string, string>>>({});
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const samples = definition.samples;
  const hints = definition.hints.slice(0, session.hintsShown);

  // Accept the typed value into the scene, or keep the last accepted value and say why not.
  function commit(key: string): void {
    const draft = drafts[key];

    if (draft === undefined) {
      return;
    }

    const text = draft.trim();
    const message = text === "" ? "Enter a number." : onSetValue(key, Number(text));

    setDrafts(without(drafts, key));
    setErrors(message === null ? without(errors, key) : { ...errors, [key]: message });
  }

  return (
    <aside className="scene-inspector challenge-panel" aria-label="Challenge">
      <header className="panel-heading">
        <h2>{definition.title}</h2>
        <button className="tool-btn" type="button" aria-label="Leave the challenge" title="Leave the challenge" onClick={onExit}><X size={14} /></button>
      </header>
      <div className="challenge-body">
        <p className="challenge-level">{LEVEL_LABEL[definition.level]} · {TOPIC_LABEL[definition.topic]}</p>
        <p>{definition.briefing}</p>
        <section aria-label="Objective">
          <h3>Objective</h3>
          <p>{definition.objective.summary}</p>
        </section>
        <section aria-label="Your choices">
          <h3>You choose</h3>
          <div className="challenge-values">
            {definition.editable.map((item) => {
              const key = valueKey(item);
              const error = errors[key];

              return (
                <label key={key}>
                  <span>{item.label} ({item.unit}) <small>{item.minimum} to {item.maximum}</small></span>
                  <input
                    type="text"
                    inputMode="decimal"
                    disabled={playing}
                    value={drafts[key] ?? formatValue(values[key] ?? item.minimum)}
                    aria-invalid={error !== undefined}
                    onChange={(event) => setDrafts({ ...drafts, [key]: event.currentTarget.value })}
                    onBlur={() => commit(key)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        commit(key);
                      }
                    }}
                  />
                  {error !== undefined && <span role="alert">{error}</span>}
                </label>
              );
            })}
          </div>
          {playing && <p>Pause or reset to change a value.</p>}
          <div className="challenge-actions">
            <button className="tool-btn challenge-launch" type="button" disabled={!canLaunch || playing} onClick={onLaunch}>
              <Play size={13} />{session.phase === "finished" ? "Launch again" : "Launch"}
            </button>
            <button className="tool-btn" type="button" disabled={playing || session.phase === "ready"} onClick={onRetry}><RotateCcw size={13} />Retry</button>
          </div>
          <p>Attempts so far: {session.attempts}</p>
        </section>
        <div aria-live="polite">
          {result !== null && (
            <section className="challenge-result" data-status={result.status} aria-label="Result">
              <h3>{STATUS_TITLE[result.status]}</h3>
              <p><strong>{result.title}.</strong> {result.message}</p>
              {session.resultLabel !== null && <p className="challenge-sample-note">Sample verdict: {session.resultLabel}. Calculated from formulas, not from a run.</p>}
              {result.criteria.length > 0 && (
                <ul className="challenge-criteria">
                  {result.criteria.map((item) => (
                    <li key={item.criterionId}><strong>{CRITERION_WORD[item.status]}.</strong> {describeCriterion(definition, item)}</li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </div>
        <section aria-label="Hints">
          <h3>Hints</h3>
          {hints.length === 0
            ? <p>A hint appears after an attempt that is not a success.</p>
            : <ol className="challenge-hints">{hints.map((hint) => <li key={hint.text}>{hint.text}</li>)}</ol>}
        </section>
        <section aria-label="Locked values">
          <h3>Locked</h3>
          <ul className="challenge-locks">
            {definition.locked.map((lock) => (
              <li key={valueKey(lock)}><Lock size={12} aria-hidden="true" /><span><strong>{lock.label}: {formatValue(lock.value)} {lock.unit}.</strong> {lock.reason}</span></li>
            ))}
          </ul>
          <p>Everything else in the scene is locked too.</p>
        </section>
        {samples.length > 0 && <details className="challenge-samples">
          <summary>Review sample verdicts</summary>
          <p>Each sample is a reviewed attempt calculated from formulas. Choose one to see how it would be judged, and why.</p>
          <ul>
            {samples.map((sample) => (
              <li key={sample.id}><button className="tool-btn" type="button" onClick={() => onShowSample(sample)}>{sample.label}</button></li>
            ))}
          </ul>
        </details>}
      </div>
    </aside>
  );
}
