/**
 * Integrated Gradients attributions as a diverging bar chart.
 *
 * Bars grow out from a centre line that represents the average customer, which
 * is the actual baseline the attributions were computed against — so the chart
 * is a direct picture of the maths rather than a decorative ranking.
 */
export default function DriverChart({ drivers }) {
  if (!drivers?.length) {
    return <p className="empty">No single feature moved this prediction much.</p>;
  }

  const max = Math.max(...drivers.map((d) => Math.abs(d.contribution)));

  return (
    <div className="drivers">
      <div className="driver-axis" aria-hidden="true">
        <span>lowers risk</span>
        <span>raises risk</span>
      </div>

      {drivers.map((driver, i) => {
        const share = max ? Math.abs(driver.contribution) / max : 0;
        const width = share * 50; // half the track, since zero sits at centre
        const raises = driver.direction === "increases";
        return (
          <div className="driver-row" key={driver.feature}>
            <div className="driver-label">
              <strong>{driver.label}</strong>
              <span>{driver.value}</span>
            </div>
            <div className="driver-track">
              <span
                className={`driver-bar ${raises ? "tone-risk" : "tone-hold"}`}
                style={{
                  left: raises ? "50%" : `${50 - width}%`,
                  width: `${width}%`,
                  "--origin": raises ? "left" : "right",
                  "--delay": `${i * 45}ms`,
                }}
              />
            </div>
            <div className={`driver-value readout ${raises ? "tone-risk" : "tone-hold"}`}>
              {driver.contribution > 0 ? "+" : "−"}
              {Math.abs(driver.contribution).toFixed(3)}
            </div>
          </div>
        );
      })}
    </div>
  );
}
