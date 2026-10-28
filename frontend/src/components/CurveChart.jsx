/**
 * A small line chart for the ROC, PR and reliability curves.
 *
 * Hand-rolled SVG rather than a chart library: these are three polylines on a
 * unit square, and the axes, tick spacing and colours then match the rest of
 * the instrument language instead of a vendor's defaults.
 */
const W = 320;
const H = 230;
const PAD = { top: 12, right: 12, bottom: 32, left: 40 };

export default function CurveChart({
  points,
  xKey,
  yKey,
  xLabel,
  yLabel,
  diagonal = false,
  flatline = null,
  tone = "var(--accent)",
}) {
  if (!points?.length) return null;

  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const sx = (v) => PAD.left + v * plotW;
  const sy = (v) => PAD.top + (1 - v) * plotH;

  const path = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${sx(p[xKey]).toFixed(1)},${sy(p[yKey]).toFixed(1)}`)
    .join(" ");

  const ticks = [0, 0.25, 0.5, 0.75, 1];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`${yLabel} against ${xLabel}`}>
      {ticks.map((t) => (
        <g key={t}>
          <line
            x1={sx(t)}
            y1={PAD.top}
            x2={sx(t)}
            y2={PAD.top + plotH}
            stroke="var(--line)"
            strokeWidth="1"
          />
          <line
            x1={PAD.left}
            y1={sy(t)}
            x2={PAD.left + plotW}
            y2={sy(t)}
            stroke="var(--line)"
            strokeWidth="1"
          />
          <text
            x={sx(t)}
            y={H - 14}
            textAnchor="middle"
            fontSize="9"
            fill="var(--faint)"
            fontFamily="var(--mono)"
          >
            {t}
          </text>
          <text
            x={PAD.left - 7}
            y={sy(t) + 3}
            textAnchor="end"
            fontSize="9"
            fill="var(--faint)"
            fontFamily="var(--mono)"
          >
            {t}
          </text>
        </g>
      ))}

      {diagonal && (
        <line
          x1={sx(0)}
          y1={sy(0)}
          x2={sx(1)}
          y2={sy(1)}
          stroke="var(--faint)"
          strokeWidth="1"
          strokeDasharray="4 4"
        />
      )}

      {flatline != null && (
        <line
          x1={sx(0)}
          y1={sy(flatline)}
          x2={sx(1)}
          y2={sy(flatline)}
          stroke="var(--faint)"
          strokeWidth="1"
          strokeDasharray="4 4"
        />
      )}

      <path d={path} fill="none" stroke={tone} strokeWidth="2" strokeLinejoin="round" />

      <text
        x={PAD.left + plotW / 2}
        y={H - 1}
        textAnchor="middle"
        fontSize="10"
        fill="var(--muted)"
      >
        {xLabel}
      </text>
      <text
        transform={`rotate(-90 10 ${PAD.top + plotH / 2})`}
        x="10"
        y={PAD.top + plotH / 2}
        textAnchor="middle"
        fontSize="10"
        fill="var(--muted)"
      >
        {yLabel}
      </text>
    </svg>
  );
}
