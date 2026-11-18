import { useEffect, useRef, useState } from "react";
import { Play, RefreshCw } from "lucide-react";
import type { ChallengeDefinition } from "@eureka/contracts";
import { fetchChallengeCatalogue, type ChallengeCatalogue } from "../lab/challenge-client.js";
import { TOPIC_LABEL } from "../lab/challenge-player.js";

const LEVELS = ["guided", "independent", "application"] as const;
const LEVEL_LABEL = { guided: "Guided", independent: "Independent", application: "Application" } as const;

type CatalogueState =
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly message: string }
  | { readonly status: "ready"; readonly catalogue: ChallengeCatalogue };

export function ChallengesPage({ visible, error, onPlay }: {
  readonly visible: boolean;
  readonly error: string | null;
  onPlay(definition: ChallengeDefinition): void;
}) {
  const [state, setState] = useState<CatalogueState>({ status: "loading" });
  const [reloads, setReloads] = useState(0);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (visible) {
      headingRef.current?.focus();
    }
  }, [visible]);

  // Ask the server whenever the page is shown or a retry is requested; ignore an answer that arrives after leaving.
  useEffect(() => {
    if (!visible) {
      return;
    }

    let cancelled = false;

    void fetchChallengeCatalogue().then((result) => {
      if (!cancelled) {
        setState(result.ok ? { status: "ready", catalogue: result.value } : { status: "error", message: result.message });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [visible, reloads]);

  function reload(): void {
    setState({ status: "loading" });
    setReloads((count) => count + 1);
  }

  const challenges = state.status === "ready"
    ? [...state.catalogue.challenges].sort((left, right) => LEVELS.indexOf(left.level) - LEVELS.indexOf(right.level))
    : [];

  return (
    <main className="curriculum-shell challenges-page" hidden={!visible} aria-labelledby="challenges-title">
      <header className="curriculum-heading">
        <div>
          <h1 id="challenges-title" ref={headingRef} tabIndex={-1}>Challenges</h1>
          <p>Short missions in the lab. Choose a launch, run it, and see why it worked or missed.</p>
        </div>
      </header>
      {error !== null && <p className="curriculum-error" role="alert">{error}</p>}
      {state.status === "loading" && <p role="status">Loading challenges…</p>}
      {state.status === "error" && (
        <div className="curriculum-error" role="alert">
          <p>{state.message}</p>
          <button className="tool-btn" type="button" onClick={reload}><RefreshCw size={13} />Try again</button>
        </div>
      )}
      {state.status === "ready" && challenges.length === 0 && <p role="status">No challenges are published yet.</p>}
      <ul className="challenge-grid">
        {challenges.map((challenge) => (
          <li key={challenge.id} className="challenge-card">
            <span className="challenge-level">{LEVEL_LABEL[challenge.level]} · {TOPIC_LABEL[challenge.topic]}</span>
            <h2>{challenge.title}</h2>
            <p>{challenge.briefing}</p>
            <p><strong>Goal.</strong> {challenge.objective.summary}</p>
            <p><strong>You can change:</strong> {challenge.editable.map((item) => `${item.label.toLowerCase()} (${item.minimum} to ${item.maximum} ${item.unit})`).join(", ")}.</p>
            <button className="tool-btn" type="button" onClick={() => onPlay(challenge)}><Play size={13} />Play</button>
          </li>
        ))}
      </ul>
    </main>
  );
}

