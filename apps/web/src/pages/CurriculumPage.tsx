import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, Check, FlaskConical, Play, RefreshCw, RotateCcw } from "lucide-react";
import type { SceneDefinition } from "@eureka/contracts";
import { setupParameters, unionFrames, type DemonstrationControl, type DemonstrationDefinition } from "../lab/demonstrations.js";
import type { DemonstrationCatalogue } from "../lab/demonstration-client.js";
import type { DemonstrationSelection } from "../lab/demo-loading.js";
import { runPreview } from "../lab/demonstration-preview.js";
import { DemonstrationPreview } from "./DemonstrationPreview.js";
import { initialState, type InvestigationState } from "./investigation-state.js";

// How many balls a setup launches, said in words.
function ballCount(scene: SceneDefinition): string {
  const count = scene.bodies.filter((body) => body.kind === "dynamic").length;
  return count === 1 ? "1 ball" : `${count} balls`;
}

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

  return (
    <article className="investigation" aria-labelledby={`${definition.id}-question`}>
      <header className="investigation-head">
        <div className="investigation-topline">
          <p className="investigation-step">Question {index + 1} of {total}</p>
          <div className="question-nav">
            <button
              className="open-lab"
              type="button"
              title={identical ? "Opens the one setup in the lab" : "Opens setups A and B together in the lab"}
              onClick={() => onOpen(identical ? { groupId: definition.id, parameters: parametersA } : { groupId: definition.id, parameters: parametersA, comparison: parametersB })}
            >
              <FlaskConical size={14} />Open in lab
            </button>
            <button className="tool-btn" type="button" aria-label="Previous question" disabled={onPrevious === null} onClick={() => onPrevious?.()}><ArrowLeft size={14} />Previous</button>
            <button className="tool-btn" type="button" aria-label="Next question" disabled={onNext === null} onClick={() => onNext?.()}>Next<ArrowRight size={14} /></button>
          </div>
        </div>
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
          {([["A", state.reference, "reference", sceneA], ["B", state.comparison, "comparison", sceneB]] as const).map(([key, value, role, scene]) => (
            <label key={key} className={`setup-chip series-${key.toLowerCase()}`}>
              <span className={`setup-key${key === "B" ? " is-ring" : ""}`}>{key}</span>
              <span className="setup-label">{definition.primary.label}</span>
              <OptionSelect
                control={definition.primary}
                value={value}
                label={`Setup ${key} ${definition.primary.label}`}
                onChange={(next) => onChange(role === "reference" ? { reference: next } : { comparison: next })}
              />
              <span className="setup-count">{ballCount(scene)}</span>
            </label>
          ))}
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
        </figcaption>
        {identical && <p className="investigation-note">Both setups are identical. Choose a different value for B to compare.</p>}
      </figure>

      <fieldset className="prediction">
        <legend><span className="prediction-step">1</span>Predict. {definition.prediction.prompt}</legend>
        <div className="prediction-row">
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
          <button className="run-both" type="button" onClick={() => onChange({ runCount: state.runCount + 1 })}>
            {hasRun ? <RotateCcw size={15} /> : <Play size={15} />}
            <span><span className="prediction-step">2</span>{hasRun ? "Run again" : "Run both"}</span>
          </button>
        </div>
      </fieldset>

      {hasRun && (
        <section className="results" aria-label="Results" aria-live="polite">
          <p className={`feedback${answered ? (correct ? " is-correct" : " is-incorrect") : ""}`}>
            {answered && <><strong>{correct ? <><Check size={14} /> Your prediction was right.</> : "Not quite."}</strong>{" "}</>}
            {definition.prediction.reason}
            <span className="look-for"><strong>What to look for.</strong> {definition.lookFor}</span>
          </p>
        </section>
      )}
    </article>
  );
}

export function ProjectilesBrowser({ demonstrations, heading, onOpen }: {
  readonly demonstrations: readonly DemonstrationDefinition[];
  // The topic's title and page actions, shown above the question list.
  readonly heading?: ReactNode;
  onOpen(selection: DemonstrationSelection): void;
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [states, setStates] = useState<Readonly<Record<string, InvestigationState>>>({});
  const definition = demonstrations[activeIndex];

  if (definition === undefined) {
    return null;
  }

  const state = states[definition.id] ?? initialState(definition);
  const total = demonstrations.length;

  return (
    <div className="investigation-layout">
      <div className="question-column">
      {heading}
      <nav className="question-rail" aria-label="Projectile questions">
        <ol>
          {demonstrations.map((item, itemIndex) => {
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
      </div>
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

// The topic card shows a real flight, so the topic is recognisable before it is opened: the angle question when it is published, else the first.
function ProjectilesTopicCard({ demonstrations, onOpen }: { readonly demonstrations: readonly DemonstrationDefinition[]; onOpen(): void }) {
  const definition = demonstrations.find((item) => item.id === "angle-sweep") ?? demonstrations[0];
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
        <span className="topic-meta">{demonstrations.length} questions · predict, run and compare</span>
        <span className="topic-start">Start exploring <ArrowRight size={14} /></span>
      </span>
    </button>
  );
}

export function CurriculumPage({ visible, topicOpen, catalogue, onRetry, error, onOpen, onRestoreDemonstration, onReturnToLab, onOpenProjectiles, onShowTopics }: {
  readonly visible: boolean;
  readonly topicOpen: boolean;
  // The questions as loaded from the server.
  readonly catalogue: DemonstrationCatalogue;
  onRetry(): void;
  readonly error: string | null;
  onOpen(selection: DemonstrationSelection): void;
  readonly onRestoreDemonstration: (() => void) | null;
  onReturnToLab(): void;
  onOpenProjectiles(): void;
  onShowTopics(): void;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const projectiles = useMemo(() => catalogue.status === "ready" ? catalogue.demonstrations.filter((item) => item.topic === "projectiles") : [], [catalogue]);

  useEffect(() => {
    if (visible) {
      headingRef.current?.focus();
    }
  }, [visible, topicOpen]);

  const heading = (
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
  );
  // An open topic puts its heading above the question list, so the question itself starts at the top of the page.
  const headingInColumn = topicOpen && projectiles.length > 0;

  return (
    <main className={`curriculum-shell${headingInColumn ? " is-topic" : ""}`} hidden={!visible} aria-labelledby="curriculum-title">
      {!headingInColumn && heading}
      {error !== null && <p className="curriculum-error" role="alert">{error}</p>}
      {catalogue.status === "loading" && <p role="status">Loading questions…</p>}
      {catalogue.status === "error" && (
        <div className="curriculum-error" role="alert">
          <p>{catalogue.message}</p>
          <button className="tool-btn" type="button" onClick={onRetry}><RefreshCw size={13} />Try again</button>
        </div>
      )}
      {catalogue.status === "ready" && projectiles.length === 0 && <p role="status">No questions are published yet.</p>}
      {projectiles.length > 0 && (
        <>
          <div hidden={!topicOpen}><ProjectilesBrowser demonstrations={projectiles} heading={headingInColumn ? heading : undefined} onOpen={onOpen} /></div>
          {!topicOpen && <ProjectilesTopicCard demonstrations={projectiles} onOpen={onOpenProjectiles} />}
        </>
      )}
    </main>
  );
}
