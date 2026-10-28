import { useCallback, useEffect, useRef, useState } from "react";

const BANDS = [
  { to: 0.2, name: "Low", token: "hold" },
  { to: 0.4, name: "Medium", token: "watch" },
  { to: 0.65, name: "High", token: "risk" },
  { to: 1.0, name: "Critical", token: "critical" },
];

const TICKS = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1];
const LABELLED = new Set([0, 0.25, 0.5, 0.75, 1]);

export function bandFor(p) {
  return BANDS.find((b) => p < b.to) ?? BANDS[BANDS.length - 1];
}

const pct = (v) => `${(v * 100).toFixed(1)}%`;

/**
 * The instrument the whole product is built around: one probability scale
 * carrying the prediction, the decision threshold and any what-if ghosts, so
 * every number in the app is read against the same axis.
 */
export default function RiskScale({
  probability,
  threshold,
  onThresholdChange,
  ghosts = [],
  baseline,
  pending = false,
}) {
  const trackRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const band = bandFor(probability);

  const positionFromEvent = useCallback((clientX) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  }, []);

  const handleMove = useCallback(
    (event) => {
      const next = positionFromEvent(event.clientX);
      if (next !== null) onThresholdChange?.(Math.round(next * 100) / 100);
    },
    [positionFromEvent, onThresholdChange]
  );

  useEffect(() => {
    if (!dragging) return;
    const move = (e) => handleMove(e);
    const up = () => setDragging(false);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [dragging, handleMove]);

  const nudge = (event) => {
    const step = event.shiftKey ? 0.1 : 0.01;
    let next = null;
    if (event.key === "ArrowLeft" || event.key === "ArrowDown") next = threshold - step;
    if (event.key === "ArrowRight" || event.key === "ArrowUp") next = threshold + step;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = 1;
    if (next === null) return;
    event.preventDefault();
    onThresholdChange?.(Math.round(Math.min(1, Math.max(0, next)) * 100) / 100);
  };

  return (
    <div className="scale" data-pending={pending || undefined}>
      <div className="scale-flag" style={{ left: pct(probability) }}>
        <span className={`scale-flag-value readout tone-${band.token}`}>
          {(probability * 100).toFixed(1)}
          <small>%</small>
        </span>
        <span className="scale-flag-band">{band.name} risk</span>
      </div>

      <div
        className="scale-track"
        ref={trackRef}
        onPointerDown={(e) => {
          if (!onThresholdChange) return;
          setDragging(true);
          handleMove(e);
        }}
      >
        {/* Zones and ticks are clipped to the rounded track; the markers below
            sit in an unclipped layer so the needle and drag handle can
            overhang it. */}
        <span className="scale-bed">
          {BANDS.map((b, i) => {
            const from = i === 0 ? 0 : BANDS[i - 1].to;
            return (
              <span
                key={b.name}
                className={`scale-zone zone-${b.token}`}
                style={{ left: pct(from), width: pct(b.to - from) }}
              />
            );
          })}

          {TICKS.map((t) => (
            <span
              key={t}
              className="scale-tick"
              data-major={LABELLED.has(t) || undefined}
              style={{ left: pct(t) }}
            />
          ))}
        </span>

        {baseline != null && (
          <span
            className="scale-baseline"
            style={{ left: pct(baseline) }}
            title={`Average customer: ${(baseline * 100).toFixed(1)}%`}
          />
        )}

        {ghosts.map((g) => (
          <span
            key={g.label}
            className="scale-ghost"
            style={{ left: pct(g.probability) }}
            title={`${g.label}: ${(g.probability * 100).toFixed(1)}%`}
          />
        ))}

        <span className={`scale-needle tone-${band.token}`} style={{ left: pct(probability) }} />

        {onThresholdChange && (
          <span
            className="scale-threshold"
            style={{ left: pct(threshold) }}
            data-dragging={dragging || undefined}
            role="slider"
            tabIndex={0}
            aria-label="Decision threshold"
            aria-valuemin={0}
            aria-valuemax={1}
            aria-valuenow={threshold}
            aria-valuetext={`${(threshold * 100).toFixed(0)} percent`}
            onKeyDown={nudge}
            onPointerDown={(e) => {
              e.stopPropagation();
              setDragging(true);
            }}
          >
            <span className="scale-threshold-grip" />
          </span>
        )}
      </div>

      <div className="scale-axis">
        {/* A tick label within 9 points of the cut-off would collide with it,
            and the cut-off is the one a user is actively moving. */}
        {[0, 0.25, 0.5, 0.75, 1]
          .filter((t) => !onThresholdChange || Math.abs(t - threshold) > 0.09)
          .map((t) => (
            <span key={t} className="readout" style={{ left: pct(t) }}>
              {(t * 100).toFixed(0)}
            </span>
          ))}
        <span
          className="scale-axis-threshold readout"
          style={{ left: pct(threshold) }}
          aria-hidden="true"
        >
          cut-off {(threshold * 100).toFixed(0)}
        </span>
      </div>
    </div>
  );
}
