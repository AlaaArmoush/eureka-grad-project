import type { Snapshot } from "@eureka/contracts";

function formatMeasurement(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) {
    return "Unavailable";
  }

  const text = value.toFixed(4);
  return text === "-0.0000" ? "0.0000" : text;
}

// HTML readouts consume the displayed snapshot, never the rendered pixel positions.
export function ObservationNotebook({ snapshot, selectedEntityId }: {
  snapshot: Snapshot;
  selectedEntityId: string | null;
}) {
  const body = snapshot.bodies.find((item) => item.id === selectedEntityId);
  const velocity = body?.velocity.linearMetersPerSecond;
  const events = snapshot.events.filter((event) => selectedEntityId === null ||
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

  return (
    <>
      <section className="observation-notebook" aria-labelledby="notebook-title">
        <header className="panel-heading">
          <h2 id="notebook-title">Observation notebook</h2>
          <span>{selectedEntityId ?? "No selection"} · tick {snapshot.tick}</span>
        </header>
        <dl className={`notebook-values${body === undefined ? " is-time-only" : ""}`}>
          {values.filter((value) => body !== undefined || value.symbol === "t").map((value) => {
            const available = value.value !== undefined && Number.isFinite(value.value);

            return (
              <div key={value.symbol}>
                <dt>{value.title}</dt>
                <dd>
                  {formatMeasurement(value.value)}
                  {available && <small>{value.unit}</small>}
                </dd>
                <span aria-hidden="true">{value.symbol}</span>
              </div>
            );
          })}
        </dl>
        {body === undefined && (
          <p className="panel-empty" role="status">
            {selectedEntityId === null ? "No object selected." : "Measurement unavailable for this selection."}
          </p>
        )}
      </section>
      <details className="event-notebook" open={events.length > 0}>
        <summary>Recorded events <span className="count-badge">{events.length}</span></summary>
        {events.length === 0 ? <p className="panel-empty">No events reported for this selection.</p> : (
          <ul className="event-list">
            {events.map((event) => (
              <li key={event.id}>
                <div><strong>{event.kind === "targetEntered" ? "Target entry" : "Surface contact"}</strong><span>{event.bodyId} · {event.kind === "targetEntered" ? event.targetId : event.surfaceBodyId}</span></div>
                <time>{event.timeSeconds.toFixed(3)} s</time>
              </li>
            ))}
          </ul>
        )}
      </details>
      {snapshot.diagnostics.length > 0 && (
        <section className="lab-diagnostics" aria-label="Diagnostics">
          <h2>Diagnostics</h2>
          <ul>{snapshot.diagnostics.map((item, index) => <li key={index}>{item.message}</li>)}</ul>
        </section>
      )}
    </>
  );
}
