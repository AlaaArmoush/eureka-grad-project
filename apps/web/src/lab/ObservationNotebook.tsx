import type { Snapshot, SnapshotEvent } from "@eureka/contracts";
// Supplies learner-facing wording for the engine's notes about a tick.
import { describeDiagnostic, describeEvent, eventLimitNote, objectName, pullWorkText } from "./lab-messages.js";
import { RUN_EVENT_LIMIT } from "./controller.js";

function formatMeasurement(value: number | undefined): string {
  // A body without readouts (a target, or nothing selected) shows a short dash, so every cell keeps its height.
  if (value === undefined) {
    return "—";
  }

  if (!Number.isFinite(value)) {
    return "Unavailable";
  }

  const text = value.toFixed(4);
  return text === "-0.0000" ? "0.0000" : text;
}

// HTML readouts consume the displayed snapshot, never the rendered pixel positions.
export function ObservationNotebook({ snapshot, selectedEntityId, runEvents }: {
  snapshot: Snapshot;
  selectedEntityId: string | null;
  // The whole run's events; without them, only this tick's events are listed.
  runEvents?: readonly SnapshotEvent[];
}) {
  const body = snapshot.bodies.find((item) => item.id === selectedEntityId);
  const velocity = body?.velocity.linearMetersPerSecond;
  const events = (runEvents ?? snapshot.events).filter((event) => selectedEntityId === null ||
    event.bodyId === selectedEntityId ||
    (event.kind === "targetEntered" ? event.targetId === selectedEntityId : event.surfaceBodyId === selectedEntityId));
  const values = [
    { title: "X", symbol: "x", unit: "m", value: body?.pose.positionMeters.x },
    { title: "Y", symbol: "y", unit: "m", value: body?.pose.positionMeters.y },
    { title: "Velocity X", symbol: "vₓ", unit: "m/s", value: velocity?.x },
    { title: "Velocity Y", symbol: "vᵧ", unit: "m/s", value: velocity?.y },
    { title: "Speed", symbol: "|v|", unit: "m/s", value: velocity === undefined ? undefined : Math.hypot(velocity.x, velocity.y) },
    { title: "Time", symbol: "t", unit: "s", value: snapshot.simulationTimeSeconds },
  ];
  // Older snapshots omit the work total, which means zero.
  const pullWorkJoules = snapshot.userInteractionWorkJoules ?? 0;

  return (
    <>
      <section className="observation-notebook" aria-labelledby="notebook-title">
        <header className="panel-heading">
          <h2 id="notebook-title">Observation notebook</h2>
          {/* The heading explains missing readouts, so no extra row changes the notebook's height. */}
          <span>
            {selectedEntityId === null ? "No object selected" : body === undefined ? `${objectName(selectedEntityId)} · Measurement unavailable` : objectName(selectedEntityId)} · tick {snapshot.tick}
            {pullWorkJoules !== 0 && <> · {pullWorkText(pullWorkJoules)}</>}
          </span>
        </header>
        {/* Always the same six cells, so the notebook and the canvas above it keep their size for every selection. */}
        <dl className="notebook-values">
          {values.map((value) => {
            const available = value.value !== undefined && Number.isFinite(value.value);

            return (
              <div key={value.symbol}>
                <dt>{value.title}</dt>
                {/* Hovering shows the snapshot's full-precision value; the text stays rounded for reading. */}
                <dd title={available ? `${value.value} ${value.unit}` : undefined}>
                  {formatMeasurement(value.value)}
                  {available && <small>{value.unit}</small>}
                </dd>
                <span aria-hidden="true">{value.symbol}</span>
              </div>
            );
          })}
        </dl>
      </section>
      {/* Opens only when the learner opens it; new events update the count without expanding the list. */}
      <details className="event-notebook">
        <summary>Recorded events <span className="count-badge">{events.length}</span></summary>
        {events.length === 0 ? <p className="panel-empty">No events reported for this selection.</p> : (
          <ul className="event-list">
            {events.map((event) => {
              const description = describeEvent(event);

              return (
                <li key={event.id}>
                  <div><strong>{description.title}</strong><span>{description.detail}</span></div>
                  <time title={`${event.timeSeconds} s, tick ${event.tick}`}>{event.timeSeconds.toFixed(3)} s</time>
                </li>
              );
            })}
          </ul>
        )}
        {runEvents !== undefined && runEvents.length >= RUN_EVENT_LIMIT && <p className="panel-empty">{eventLimitNote(RUN_EVENT_LIMIT)}</p>}
      </details>
      {snapshot.diagnostics.length > 0 && (
        <section className="lab-diagnostics" aria-label="Simulation notes">
          <h2>Simulation notes</h2>
          <ul>{snapshot.diagnostics.map((item, index) => <li key={index}>{describeDiagnostic(item)}</li>)}</ul>
        </section>
      )}
    </>
  );
}
