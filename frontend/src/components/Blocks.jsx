/**
 * Isometric blocks drawn with CSS 3D transforms — no WebGL, no library.
 * Every block stands for something countable (a customer, a group of
 * customers), so the 3D is a chart, not decoration.
 */
function Prism({ x, y, w, d, h, color, title, delay = 0 }) {
  return (
    <div
      className="prism"
      title={title}
      style={{ left: x, top: y, width: w, height: d, "--h": h, "--c": color, "--delay": `${delay}ms` }}
    >
      <span className="prism-top" />
      <span className="prism-front" />
      <span className="prism-side" />
    </div>
  );
}

/** Ten customers like this one; the ones who leave stand tall. */
export function People({ leaving, total = 10, tone = "var(--risk)", label }) {
  const s = 22;
  const gap = 14;
  const cols = 5;
  const rows = Math.ceil(total / cols);
  const width = cols * s + (cols - 1) * gap;
  const depth = rows * s + (rows - 1) * gap;
  return (
    <div className="people" role="img" aria-label={label}>
      <div className="iso" style={{ width, height: depth }}>
        <Prism x={-10} y={-10} w={`${width + 20}px`} d={`${depth + 20}px`} h="3px" color="var(--plate)" />
        {Array.from({ length: total }, (_, i) => {
          const out = i < leaving;
          return (
            <Prism
              key={i}
              x={(i % cols) * (s + gap)}
              y={Math.floor(i / cols) * (s + gap)}
              w={`${s}px`}
              d={`${s}px`}
              h={out ? `${s * 2}px` : `${s * 0.55}px`}
              color={out ? tone : "var(--stay)"}
              delay={i * 30}
            />
          );
        })}
      </div>
    </div>
  );
}

/** A row of columns whose heights are fractions of the tallest. */
export function Skyline({ columns, label }) {
  const n = columns.length;
  const pitch = 92 / n;
  const w = pitch * 0.74;
  return (
    <div className="skyline" role="img" aria-label={label}>
      <div className="iso iso-flat" style={{ width: "92cqw", height: `${w}cqw` }}>
        <Prism x="-1.5cqw" y="-1.5cqw" w="95cqw" d={`${w + 3}cqw`} h="0.5cqw" color="var(--plate)" />
        {columns.map((c, i) => (
          <Prism
            key={i}
            x={`${i * pitch}cqw`}
            y={0}
            w={`${w}cqw`}
            d={`${w}cqw`}
            h={`${Math.max(0.4, c.fraction * 17)}cqw`}
            color={c.color}
            title={c.title}
            delay={i * 25}
          />
        ))}
      </div>
    </div>
  );
}
