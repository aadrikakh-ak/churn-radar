import { useMemo, useRef, useState } from "react";
import { api } from "../api.js";
import { bandFor } from "../components/RiskScale.jsx";

const money = (n) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

const BINS = 20;

function Histogram({ rows }) {
  const bins = useMemo(() => {
    const counts = new Array(BINS).fill(0);
    rows.forEach((r) => {
      const i = Math.min(BINS - 1, Math.floor(r.churn_probability * BINS));
      counts[i] += 1;
    });
    return counts;
  }, [rows]);

  const max = Math.max(...bins, 1);

  return (
    <>
      <div className="histogram">
        {bins.map((count, i) => {
          const mid = (i + 0.5) / BINS;
          return (
            <div
              key={i}
              className={`histogram-bar tone-${bandFor(mid).token}`}
              style={{ height: `${(count / max) * 100}%`, "--delay": `${i * 18}ms` }}
              title={`${(i / BINS).toFixed(2)}–${((i + 1) / BINS).toFixed(2)}: ${count} customers`}
            />
          );
        })}
      </div>
      <div className="histogram-axis readout">
        <span>0</span>
        <span>25</span>
        <span>50</span>
        <span>75</span>
        <span>100% risk</span>
      </div>
    </>
  );
}

export default function Portfolio() {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [over, setOver] = useState(false);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState({ key: "churn_probability", dir: -1 });
  const [fileName, setFileName] = useState(null);
  const inputRef = useRef(null);

  const upload = async (file) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    setFileName(file.name);
    try {
      setData(await api.predictCsv(file));
    } catch (e) {
      setError(e.message);
      setData(null);
    } finally {
      setBusy(false);
    }
  };

  const rows = useMemo(() => {
    if (!data) return [];
    const needle = query.trim().toLowerCase();
    const filtered = needle
      ? data.results.filter(
          (r) =>
            r.customer_id?.toLowerCase().includes(needle) ||
            r.risk_band.toLowerCase().includes(needle)
        )
      : data.results;
    return [...filtered].sort((a, b) => {
      const x = a[sort.key];
      const y = b[sort.key];
      if (x === y) return 0;
      return (x > y ? 1 : -1) * sort.dir;
    });
  }, [data, query, sort]);

  const accuracy = useMemo(() => {
    if (!data?.results?.length || data.results[0].actual == null) return null;
    let tp = 0, fp = 0, fn = 0, tn = 0;
    data.results.forEach((r) => {
      if (r.will_churn && r.actual === 1) tp += 1;
      else if (r.will_churn) fp += 1;
      else if (r.actual === 1) fn += 1;
      else tn += 1;
    });
    return {
      recall: tp / (tp + fn || 1),
      precision: tp / (tp + fp || 1),
      accuracy: (tp + tn) / data.results.length,
    };
  }, [data]);

  const downloadCsv = () => {
    const header = "customer_id,churn_probability,risk_band,flagged,annual_revenue_at_risk\n";
    const body = rows
      .map((r) =>
        [
          r.customer_id ?? r.row,
          r.churn_probability.toFixed(5),
          r.risk_band,
          r.will_churn,
          r.expected_revenue_at_risk,
        ].join(",")
      )
      .join("\n");
    const url = URL.createObjectURL(new Blob([header + body], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `churn-scores-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const sortBy = (key) =>
    setSort((s) => ({ key, dir: s.key === key ? -s.dir : -1 }));

  return (
    <>
      <header className="page-head">
        <h1>Score a whole book</h1>
        <p>
          Upload a customer file with the original Telco columns. Every row goes through
          the network in one pass, ranked so the retention team can work top-down.
        </p>
      </header>

      {error && (
        <div className="notice" style={{ marginBottom: 20 }} role="alert">
          {error}
        </div>
      )}

      {!data && (
        <div
          className="drop"
          data-over={over || undefined}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            upload(e.dataTransfer.files?.[0]);
          }}
        >
          <h3>{busy ? "Scoring the file" : "Drop a CSV here"}</h3>
          <p>
            {busy
              ? "One forward pass over every row."
              : "Needs the 19 original Telco columns. A Churn column, if present, is used to score accuracy."}
          </p>
          <input
            ref={inputRef}
            type="file"
            accept=".csv"
            hidden
            onChange={(e) => upload(e.target.files?.[0])}
          />
          <button
            className="button button-primary"
            onClick={() => inputRef.current?.click()}
            disabled={busy}
          >
            {busy ? "Working" : "Choose a file"}
          </button>
        </div>
      )}

      {data && (
        <div className="section-gap">
          <dl className="stats">
            <div className="stat">
              <dt>Customers scored</dt>
              <dd>
                {data.count.toLocaleString()}
                <small>{fileName}</small>
              </dd>
            </div>
            <div className="stat">
              <dt>Flagged at risk</dt>
              <dd>
                {data.flagged.toLocaleString()}
                <small>{((data.flagged / data.count) * 100).toFixed(1)}% of the book</small>
              </dd>
            </div>
            <div className="stat">
              <dt>Average risk</dt>
              <dd>
                {(data.mean_probability * 100).toFixed(1)}%
                <small>cut-off at {(data.threshold * 100).toFixed(0)}%</small>
              </dd>
            </div>
            <div className="stat">
              <dt>Revenue at risk</dt>
              <dd>
                {money(data.total_revenue_at_risk)}
                <small>annualised, probability-weighted</small>
              </dd>
            </div>
            {accuracy && (
              <div className="stat">
                <dt>Caught</dt>
                <dd>
                  {(accuracy.recall * 100).toFixed(1)}%
                  <small>
                    of real churners, at {(accuracy.precision * 100).toFixed(0)}% precision
                  </small>
                </dd>
              </div>
            )}
          </dl>

          <section className="panel">
            <div className="panel-head">
              <h2>How risk is spread</h2>
              <p>Every customer placed on the same scale used on the single-customer page.</p>
            </div>
            <div className="panel-body">
              <Histogram rows={data.results} />
            </div>
          </section>

          <section className="panel">
            <div className="table-toolbar">
              <input
                type="search"
                placeholder="Find a customer ID or band"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Filter customers"
              />
              <span style={{ color: "var(--muted)", fontSize: "var(--t-xs)" }}>
                {rows.length.toLocaleString()} shown
              </span>
              <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
                <button className="button button-quiet" onClick={downloadCsv}>
                  Download scores
                </button>
                <button
                  className="button button-quiet"
                  onClick={() => {
                    setData(null);
                    setQuery("");
                  }}
                >
                  Score another file
                </button>
              </div>
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Customer</th>
                    <th className="sortable" onClick={() => sortBy("risk_band")}>
                      Band
                    </th>
                    <th
                      className="sortable num"
                      onClick={() => sortBy("churn_probability")}
                      style={{ textAlign: "right" }}
                    >
                      Risk
                    </th>
                    <th
                      className="sortable num"
                      onClick={() => sortBy("expected_revenue_at_risk")}
                      style={{ textAlign: "right" }}
                    >
                      Revenue at risk
                    </th>
                    <th>Action</th>
                    {accuracy && <th>Actual</th>}
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 300).map((r) => {
                    const band = bandFor(r.churn_probability);
                    return (
                      <tr key={r.row}>
                        <td className="readout" style={{ fontSize: "var(--t-xs)" }}>
                          {r.customer_id ?? `row ${r.row + 1}`}
                        </td>
                        <td className={`tone-${band.token}`} style={{ fontWeight: 500 }}>
                          {r.risk_band}
                        </td>
                        <td className="num">{(r.churn_probability * 100).toFixed(1)}%</td>
                        <td className="num">{money(r.expected_revenue_at_risk)}</td>
                        <td style={{ color: "var(--muted)" }}>
                          {r.will_churn ? "Contact" : "Leave alone"}
                        </td>
                        {accuracy && (
                          <td style={{ color: "var(--muted)" }}>
                            {r.actual === 1 ? "Churned" : "Stayed"}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {rows.length > 300 && (
              <div
                style={{
                  padding: "12px 22px",
                  borderTop: "1px solid var(--line)",
                  color: "var(--muted)",
                  fontSize: "var(--t-xs)",
                }}
              >
                Showing the top 300 of {rows.length.toLocaleString()}. Download the file for
                the rest.
              </div>
            )}
          </section>
        </div>
      )}
    </>
  );
}
