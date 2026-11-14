import type { Snapshot } from "@eureka/contracts";

function formatMeasurement(value: number | undefined): string {
  if (value === undefined) return "—";
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
    { title: "Horizontal position", symbol: "x", unit: "m", value: body?.pose.positionMeters.x },
    { title: "Vertical position", symbol: "y", unit: "m", value: body?.pose.positionMeters.y },
    { title: "Horizontal velocity", symbol: "vₓ", unit: "m/s", value: velocity?.x },
    { title: "Vertical velocity", symbol: "vᵧ", unit: "m/s", value: velocity?.y },
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
        <dl className="notebook-values">
          {values.map((value) => (
            <div key={value.symbol}>
              <dt>{value.title}</dt>
              <dd>{formatMeasurement(value.value)}<small>{value.unit}</small></dd>
              <span aria-hidden="true">{value.symbol}</span>
            </div>
          ))}
        </dl>
        <p className="panel-footnote">{body === undefined ? "Select a projectile or solid body to inspect its values." : "Snapshot measurements · rounded to four decimal places."}</p>
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
