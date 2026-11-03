import { friendlyDrivers } from "../fields.js";

function Column({ title, rows, tone, max }) {
  return (
    <div className="why-col">
      <h3 className={tone}>{title}</h3>
      {rows.length ? (
        rows.map((r, i) => (
          <div className="why-row" key={r.key}>
            <div className="why-text">
              <strong>{r.label}</strong>
              <span>{r.value}</span>
            </div>
            <div className="why-figure">
              <span className={`readout ${tone}`}>
                {r.contribution > 0 ? "+" : "−"}
                {Math.abs(r.contribution * 100).toFixed(0)} pts
              </span>
              <span className="why-bar">
                <span
                  className={tone}
                  style={{ width: `${(Math.abs(r.contribution) / max) * 100}%`, "--delay": `${i * 45}ms` }}
                />
              </span>
            </div>
          </div>
        ))
      ) : (
        <p className="why-none">Nothing big here.</p>
      )}
    </div>
  );
}

/**
 * Integrated Gradients attributions, measured against the average customer,
 * split into the two questions a person actually asks.
 */
export default function DriverChart({ drivers, customer }) {
  const rows = friendlyDrivers(drivers, customer);
  if (!rows.length) return <p className="empty">No single thing moved this result much.</p>;
  const max = Math.max(...rows.map((r) => Math.abs(r.contribution)));
  return (
    <div className="why">
      <Column title="Pushing them to leave" tone="tone-risk" max={max}
        rows={rows.filter((r) => r.contribution > 0).slice(0, 5)} />
      <Column title="Keeping them around" tone="tone-hold" max={max}
        rows={rows.filter((r) => r.contribution < 0).slice(0, 5)} />
    </div>
  );
}
