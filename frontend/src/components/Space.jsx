import { useEffect, useRef } from "react";

// left %, top %, diameter px, colour, ringed, seconds per bob
const PLANETS = [
  [1, 46, 70, "var(--hold)", true, 22],
  [94, 30, 110, "var(--watch)", false, 28],
  [90, 84, 46, "var(--risk)", true, 19],
  [5, 78, 120, "var(--stay)", false, 30],
  [60, 7, 24, "var(--hold)", false, 17],
];

const ROCKET = `<svg viewBox="0 0 46 20" width="46" height="20" aria-hidden="true">
  <g class="rocket-thrust"><path class="rocket-flame" d="M10 6.5 L0 10 L10 13.5 Z"/></g>
  <path class="rocket-fin" d="M13 5 L8 0.5 L20 5 Z M13 15 L8 19.5 L20 15 Z"/>
  <path class="rocket-body" d="M10 5 H32 Q41 5 45 10 Q41 15 32 15 H10 Q8.5 10 10 5 Z"/>
  <circle class="rocket-window" cx="32" cy="10" r="2.6"/>
</svg>`;

const ROCKETS = 4;
const CURIOUS_RADIUS = 260; // px: inside this, a rocket turns toward the cursor
// Clicks on these are the app's, not the sky's.
const NOT_SKY = "button, a, input, select, textarea, label, summary, details, .panel, .rail, [role=slider]";

function Rockets() {
  const layer = useRef(null);

  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const el = layer.current;
    const rockets = [];
    const mouse = { x: -1e4, y: -1e4 };

    const spawn = (x, y, a, speed) => {
      const node = document.createElement("div");
      node.className = "rocket";
      node.innerHTML = ROCKET;
      el.appendChild(node);
      rockets.push({ node, thrust: node.firstChild.firstElementChild, x, y, a, base: speed, boost: 0 });
    };

    for (let i = 0; i < ROCKETS; i++) {
      spawn(Math.random() * innerWidth, Math.random() * innerHeight, Math.random() * 7, 1 + Math.random() * 0.8);
    }

    const onMove = (e) => {
      mouse.x = e.clientX;
      mouse.y = e.clientY;
    };
    const onLeave = () => {
      mouse.x = mouse.y = -1e4;
    };
    const onDown = (e) => {
      if (e.target.closest?.(NOT_SKY)) return;
      const near = rockets.find((r) => Math.hypot(r.x - e.clientX, r.y - e.clientY) < 40);
      if (near) near.boost = 6;
    };

    let frame;
    const tick = () => {
      const W = innerWidth;
      const H = innerHeight;
      for (const r of rockets) {
        const dx = mouse.x - r.x;
        const dy = mouse.y - r.y;
        if (Math.hypot(dx, dy) < CURIOUS_RADIUS) {
          // shortest signed angle to the cursor, eased: they orbit, never snap
          const diff = Math.atan2(Math.sin(Math.atan2(dy, dx) - r.a), Math.cos(Math.atan2(dy, dx) - r.a));
          r.a += diff * 0.035;
        } else {
          r.a += (Math.random() - 0.5) * 0.04; // idle wander
        }
        r.boost *= 0.97;
        const v = r.base + r.boost;
        r.x += Math.cos(r.a) * v;
        r.y += Math.sin(r.a) * v;
        if (r.x < -60) r.x = W + 60;
        if (r.x > W + 60) r.x = -60;
        if (r.y < -60) r.y = H + 60;
        if (r.y > H + 60) r.y = -60;
        r.node.style.transform = `translate(${r.x}px, ${r.y}px) rotate(${r.a}rad)`;
        r.thrust.style.transform = `scaleX(${0.7 + v * 0.35})`;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerdown", onDown);
    document.addEventListener("pointerleave", onLeave);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onDown);
      document.removeEventListener("pointerleave", onLeave);
      el.replaceChildren();
    };
  }, []);

  return <div className="rockets" ref={layer} />;
}

/** Background: drifting planets and rockets that follow the cursor. */
export default function Space() {
  return (
    <div className="space" aria-hidden="true">
      {PLANETS.map(([left, top, size, color, ringed, secs], i) => (
        <div
          key={i}
          className="planet"
          style={{ left: `${left}%`, top: `${top}%`, width: size, height: size, "--c": color, "--bob": `${secs}s`, animationDelay: `${-i * 4}s` }}
        >
          <span className="planet-body" />
          {ringed && <span className="planet-ring" />}
        </div>
      ))}
      <Rockets />
    </div>
  );
}
