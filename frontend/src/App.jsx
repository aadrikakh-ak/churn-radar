import { useEffect, useState } from "react";
import { api } from "./api.js";
import Assess from "./pages/Assess.jsx";
import Portfolio from "./pages/Portfolio.jsx";
import ModelCard from "./pages/ModelCard.jsx";

const PAGES = [
  { id: "assess", label: "Assess", render: (p) => <Assess {...p} /> },
  { id: "portfolio", label: "Portfolio", render: () => <Portfolio /> },
  { id: "model", label: "Model", render: (p) => <ModelCard {...p} /> },
];

function Mark() {
  // A signal reading: the same needle-on-a-scale idea as the instrument.
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
      <rect x="1" y="7" width="18" height="6" rx="2" fill="none" stroke="currentColor" strokeWidth="1.4" opacity="0.45" />
      <rect x="12.4" y="4.5" width="2.2" height="11" rx="1" fill="var(--risk)" />
    </svg>
  );
}

function useTheme() {
  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem("churn-radar-theme");
    if (saved) return saved;
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("churn-radar-theme", theme);
  }, [theme]);

  return [theme, () => setTheme((t) => (t === "dark" ? "light" : "dark"))];
}

export default function App() {
  const [page, setPage] = useState("assess");
  const [schema, setSchema] = useState(null);
  const [info, setInfo] = useState(null);
  const [boot, setBoot] = useState({ state: "loading", message: null });
  const [theme, toggleTheme] = useTheme();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const health = await api.health();
        if (!health.model_loaded) throw new Error(health.error ?? "The model failed to load.");
        const [s, i] = await Promise.all([api.schema(), api.info()]);
        if (cancelled) return;
        setSchema(s);
        setInfo(i);
        setBoot({ state: "ready", message: null });
      } catch (e) {
        if (!cancelled) setBoot({ state: "error", message: e.message });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const active = PAGES.find((p) => p.id === page);

  return (
    <>
      <header className="rail">
        <div className="rail-inner">
          <span className="wordmark">
            <Mark />
            Churn Radar
          </span>
          <nav className="nav">
            {PAGES.map((p) => (
              <button
                key={p.id}
                onClick={() => setPage(p.id)}
                aria-current={page === p.id ? "page" : undefined}
              >
                {p.label}
              </button>
            ))}
          </nav>
          <button
            className="icon-button"
            onClick={toggleTheme}
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
            title={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
          >
            {theme === "dark" ? (
              <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                <circle cx="8" cy="8" r="3.2" />
                <g stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
                  <path d="M8 1v1.6M8 13.4V15M1 8h1.6M13.4 8H15M3 3l1.1 1.1M11.9 11.9L13 13M13 3l-1.1 1.1M4.1 11.9L3 13" />
                </g>
              </svg>
            ) : (
              <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                <path d="M13.5 10.4A6 6 0 0 1 5.6 2.5a6 6 0 1 0 7.9 7.9Z" />
              </svg>
            )}
          </button>
        </div>
      </header>

      <main className="shell">
        {boot.state === "error" ? (
          <>
            <header className="page-head">
              <h1>The API isn't answering</h1>
              <p>{boot.message}</p>
            </header>
            <div className="panel">
              <div className="panel-body">
                <p style={{ marginBottom: 14 }}>Start the backend from the project root:</p>
                <pre
                  style={{
                    background: "var(--panel-sunk)",
                    border: "1px solid var(--line)",
                    borderRadius: "var(--radius)",
                    padding: 14,
                    fontFamily: "var(--mono)",
                    fontSize: "var(--t-xs)",
                    overflowX: "auto",
                    margin: 0,
                  }}
                >
                  uvicorn backend.app.main:app --reload
                </pre>
                <p style={{ marginTop: 14, color: "var(--muted)", fontSize: "var(--t-sm)" }}>
                  If the model artifacts are missing, run <code>python -m ml.train</code> first.
                </p>
                <button
                  className="button button-primary"
                  style={{ marginTop: 18 }}
                  onClick={() => window.location.reload()}
                >
                  Try again
                </button>
              </div>
            </div>
          </>
        ) : (
          active.render({ schema, info })
        )}
      </main>
    </>
  );
}
