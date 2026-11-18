import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, FlaskConical, Play, RotateCcw } from "lucide-react";
import {
  setupParameters, TOPIC_ONE_DEMONSTRATIONS, unionFrames,
  type DemonstrationControl, type DemonstrationDefinition,
} from "../lab/demonstrations.js";
import type { DemonstrationSelection } from "../lab/demo-loading.js";
import { runPreview } from "../lab/demonstration-preview.js";
import { DemonstrationPreview } from "./DemonstrationPreview.js";
import { initialState, type InvestigationState } from "./investigation-state.js";

function OptionSelect({ control, value, label, onChange }: {
  readonly control: DemonstrationControl;
  readonly value: string;
  readonly label: string;
  onChange(value: string): void;
}) {
  return (
    <select aria-label={label} value={value} onChange={(event) => onChange(event.currentTarget.value)}>
      {control.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  );
}

export function InvestigationPanel({ definition, state, index, total, onChange, onOpen, onPrevious, onNext }: {
  readonly definition: DemonstrationDefinition;
  readonly state: InvestigationState;
  readonly index: number;
  readonly total: number;
  onChange(patch: Partial<InvestigationState>): void;
  onOpen(selection: DemonstrationSelection): void;
  onPrevious: (() => void) | null;
  onNext: (() => void) | null;
}) {
  const parametersA = setupParameters(definition, state.reference, state.shared);
  const parametersB = setupParameters(definition, state.comparison, state.shared);
  const sceneA = useMemo(() => definition.buildScene(setupParameters(definition, state.reference, state.shared)), [definition, state.reference, state.shared]);
  const sceneB = useMemo(() => definition.buildScene(setupParameters(definition, state.comparison, state.shared)), [definition, state.comparison, state.shared]);
  const hasRun = state.runCount > 0;
  // Re-simulate whenever a setting changes after the first run, so exploring never needs a second page.
  const balls = useMemo(
    () => hasRun ? { A: runPreview(sceneA), B: runPreview(sceneB) } : null,
    [hasRun, sceneA, sceneB],
  );
  const view = useMemo(
    () => unionFrames([
      definition.frame(setupParameters(definition, state.reference, state.shared)),
      definition.frame(setupParameters(definition, state.comparison, state.shared)),
    ]),
    [definition, state.reference, state.comparison, state.shared],
  );
  const identical = state.reference === state.comparison;
  const answered = state.choice !== null;
  const correct = state.choice === definition.prediction.answerIndex;
  const rows = (["A", "B"] as const).flatMap((key) => (balls?.[key] ?? []).map((ball) => ({ key, ball })));

  return (
    <article className="investigation" aria-labelledby={`${definition.id}-question`}>
      <header className="investigation-head">
        <p className="investigation-step">Question {index + 1} of {total}</p>
        <h2 id={`${definition.id}-question`}>{definition.question}</h2>
        <p>{definition.summary}</p>
      </header>

      <figure className="investigation-figure">
        <DemonstrationPreview
          setups={[
            { key: "A", scene: sceneA, balls: balls?.A },
            { key: "B", scene: sceneB, balls: balls?.B },
          ]}
          view={view}
          label={`${definition.title}: setup A and setup B, drawn to scale${hasRun ? ", with their flight paths" : ""}`}
          runId={`${state.runCount}-${sceneA.id}-${sceneB.id}`}
        />
        <figcaption className="setup-legend">
          {([["A", state.reference, "reference"], ["B", state.comparison, "comparison"]] as const).map(([key, value, role]) => (
            <label key={key} className={`setup-chip series-${key.toLowerCase()}`}>
              <span className="setup-key">{key}</span>
              <span className="setup-label">{definition.primary.label}</span>
              <OptionSelect
                control={definition.primary}
                value={value}
                label={`Setup ${key} ${definition.primary.label}`}
                onChange={(next) => onChange(role === "reference" ? { reference: next } : { comparison: next })}
              />
            </label>
          ))}
        </figcaption>
        {identical && <p className="investigation-note">Both setups are identical. Choose a different value for B to compare.</p>}
      </figure>

      {definition.shared.length > 0 && (
        <div className="shared-settings">
          <span className="shared-title">Same for both setups</span>
          {definition.shared.map((control) => (
            <label key={control.key}>
              {control.label}
              <OptionSelect
                control={control}
                value={state.shared[control.key] ?? control.options[0]?.value ?? ""}
                label={`${control.label} (both setups)`}
                onChange={(next) => onChange({ shared: { ...state.shared, [control.key]: next } })}
              />
            </label>
          ))}
        </div>
      )}

      <fieldset className="prediction">
        <legend><span className="prediction-step">1</span>Predict. {definition.prediction.prompt}</legend>
        <div className="prediction-choices">
          {definition.prediction.choices.map((choice, choiceIndex) => (
            <label key={choice} className={`prediction-choice${state.choice === choiceIndex ? " is-chosen" : ""}${hasRun && choiceIndex === definition.prediction.answerIndex ? " is-answer" : ""}`}>
              <input
                type="radio"
                name={`${definition.id}-prediction`}
                checked={state.choice === choiceIndex}
                onChange={() => onChange({ choice: choiceIndex })}
              />
              {choice}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="run-row">
        <button className="run-both" type="button" onClick={() => onChange({ runCount: state.runCount + 1 })}>
          {hasRun ? <RotateCcw size={15} /> : <Play size={15} />}
          <span><span className="prediction-step">2</span>{hasRun ? "Run again" : "Run both"}</span>
        </button>
        {!hasRun && <span className="run-hint">{answered ? "Run the simulation to check your prediction." : "Pick a prediction first, or just run it."}</span>}
      </div>

      {hasRun && (
        <section className="results" aria-label="Results" aria-live="polite">
          <p className={`feedback${answered ? (correct ? " is-correct" : " is-incorrect") : ""}`}>
            {answered && <><strong>{correct ? <><Check size={14} /> Your prediction was right.</> : "Not quite."}</strong>{" "}</>}
            {definition.prediction.reason}
          </p>
          <div className="results-scroll">
            <table>
              <caption>Measured from the simulated flights</caption>
              <thead>
                <tr><th scope="col">Ball</th><th scope="col">Range</th><th scope="col">Time in air</th><th scope="col">Peak height</th></tr>
              </thead>
              <tbody>
                {rows.map(({ key, ball }) => (
                  <tr key={`${key}-${ball.id}`} className={`series-${key.toLowerCase()}`}>
                    <th scope="row">
                      <span className="setup-key">{key}</span>
                      {ball.speedMetersPerSecond.toFixed(0)} m/s at {ball.angleDegrees.toFixed(0)}° · {ball.massKilograms} kg
                    </th>
                    <td>{ball.rangeMeters.toFixed(1)} m</td>
                    <td>{ball.landed ? `${ball.flightTimeSeconds.toFixed(2)} s` : "did not land"}</td>
                    <td>{ball.peakHeightMeters.toFixed(1)} m</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="look-for"><strong>What to look for.</strong> {definition.lookFor}</p>
          <p className="try-more">Change anything above and the flights re-run straight away. Use the lab to edit objects, launch angle or gravity freely.</p>
        </section>
      )}

      <footer className="investigation-foot">
        <div className="lab-actions">
          <button className="open-lab" type="button" onClick={() => onOpen({ groupId: definition.id, parameters: parametersA })}>
            <FlaskConical size={14} />Open A in lab
          </button>
          <button className="open-lab" type="button" disabled={identical} onClick={() => onOpen({ groupId: definition.id, parameters: parametersB })}>
            <FlaskConical size={14} />Open B in lab
          </button>
        </div>
        <div className="question-nav">
          <button className="tool-btn" type="button" disabled={onPrevious === null} onClick={() => onPrevious?.()}><ArrowLeft size={14} />Previous</button>
          <button className="tool-btn" type="button" disabled={onNext === null} onClick={() => onNext?.()}>Next<ArrowRight size={14} /></button>
        </div>
      </footer>
    </article>
  );
}

export function ProjectilesBrowser({ onOpen }: {
  onOpen(selection: DemonstrationSelection): void;
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [states, setStates] = useState<Readonly<Record<string, InvestigationState>>>({});
  const definition = TOPIC_ONE_DEMONSTRATIONS[activeIndex];

  if (definition === undefined) {
    return null;
  }

  const state = states[definition.id] ?? initialState(definition);
  const total = TOPIC_ONE_DEMONSTRATIONS.length;

  return (
    <div className="investigation-layout">
      <nav className="question-rail" aria-label="Projectile questions">
        <ol>
          {TOPIC_ONE_DEMONSTRATIONS.map((item, itemIndex) => {
            const explored = (states[item.id]?.runCount ?? 0) > 0;

            return (
              <li key={item.id}>
                <button
                  type="button"
                  className={`rail-question${itemIndex === activeIndex ? " is-active" : ""}`}
                  aria-current={itemIndex === activeIndex ? "step" : undefined}
                  onClick={() => setActiveIndex(itemIndex)}
                >
                  <span className="rail-number">{explored ? <Check size={13} aria-label="explored" /> : itemIndex + 1}</span>
                  <span className="rail-text"><strong>{item.title}</strong><small>{item.question}</small></span>
                </button>
              </li>
            );
          })}
        </ol>
        <p className="rail-note">Related challenges are not available yet.</p>
      </nav>
      <InvestigationPanel
        key={definition.id}
        definition={definition}
        state={state}
        index={activeIndex}
        total={total}
        onChange={(patch) => setStates((previous) => ({ ...previous, [definition.id]: { ...(previous[definition.id] ?? initialState(definition)), ...patch } }))}
        onOpen={onOpen}
        onPrevious={activeIndex > 0 ? () => setActiveIndex(activeIndex - 1) : null}
        onNext={activeIndex < total - 1 ? () => setActiveIndex(activeIndex + 1) : null}
      />
    </div>
  );
}

// The topic card shows a real flight, so the topic is recognisable before it is opened.
function ProjectilesTopicCard({ onOpen }: { onOpen(): void }) {
  const definition = TOPIC_ONE_DEMONSTRATIONS.find((item) => item.id === "angle-sweep");
  const preview = useMemo(() => {
    if (definition === undefined) return undefined;
    const parametersA = setupParameters(definition, definition.reference, definition.sharedDefaults);
    const parametersB = setupParameters(definition, definition.comparison, definition.sharedDefaults);
    const sceneA = definition.buildScene(parametersA);
    const sceneB = definition.buildScene(parametersB);

    return {
      sceneA,
      sceneB,
      ballsA: runPreview(sceneA),
      ballsB: runPreview(sceneB),
      view: unionFrames([definition.frame(parametersA), definition.frame(parametersB)]),
    };
  }, [definition]);

  return (
    <button className="topic-card" type="button" onClick={onOpen}>
      <span className="topic-preview" aria-hidden="true">
        {preview !== undefined && (
          <DemonstrationPreview
            setups={[
              { key: "A", scene: preview.sceneA, balls: preview.ballsA },
              { key: "B", scene: preview.sceneB, balls: preview.ballsB },
            ]}
            view={preview.view}
            label=""
            runId="topic"
          />
        )}
      </span>
      <span className="topic-body">
        <span className="topic-kicker">Topic 1 · Mechanics</span>
        <strong>Projectiles</strong>
        <span>How things fly: launch angle and speed, gravity, mass and air resistance.</span>
        <span className="topic-meta">{TOPIC_ONE_DEMONSTRATIONS.length} questions · predict, run and compare</span>
        <span className="topic-start">Start exploring <ArrowRight size={14} /></span>
      </span>
    </button>
  );
}

export function CurriculumPage({ visible, topicOpen, error, onOpen, onRestoreDemonstration, onReturnToLab, onOpenProjectiles, onShowTopics }: {
  readonly visible: boolean;
  readonly topicOpen: boolean;
  readonly error: string | null;
  onOpen(selection: DemonstrationSelection): void;
  readonly onRestoreDemonstration: (() => void) | null;
  onReturnToLab(): void;
  onOpenProjectiles(): void;
  onShowTopics(): void;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (visible) {
      headingRef.current?.focus();
    }
  }, [visible, topicOpen]);

  return (
    <main className="curriculum-shell" hidden={!visible} aria-labelledby="curriculum-title">
      <header className="curriculum-heading">
        <div>
          {topicOpen && <button className="crumb-back" type="button" onClick={onShowTopics}><ArrowLeft size={13} />All topics</button>}
          <h1 id="curriculum-title" ref={headingRef} tabIndex={-1}>
            {topicOpen ? "Projectiles" : "Curriculum"}
          </h1>
          <p>{topicOpen ? "Make a prediction, run the experiment, then change something and see what happens." : "Pick a topic. Each one is a handful of questions you answer by predicting, then testing."}</p>
        </div>
        <div className="curriculum-actions">
          {onRestoreDemonstration !== null && (
            <button className="tool-btn" type="button" onClick={onRestoreDemonstration}>
              Restore last opened scene
            </button>
          )}
          <button className="tool-btn" type="button" onClick={onReturnToLab}>Return to lab</button>
        </div>
      </header>
      {error !== null && <p className="curriculum-error" role="alert">{error}</p>}
      <div hidden={!topicOpen}><ProjectilesBrowser onOpen={onOpen} /></div>
      {!topicOpen && <ProjectilesTopicCard onOpen={onOpenProjectiles} />}
    </main>
  );
}
