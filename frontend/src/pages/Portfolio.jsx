import { useMemo, useRef, useState } from "react";
import { api } from "../api.js";
import { bandFor } from "../components/RiskScale.jsx";
import { Skyline } from "../components/Blocks.jsx";

const money = (n) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

const BINS = 20;
const REQUIRED = ["gender", "SeniorCitizen", "Partner", "Dependents", "tenure", "PhoneService",
  "MultipleLines", "InternetService", "OnlineSecurity", "OnlineBackup", "DeviceProtection",
  "TechSupport", "StreamingTV", "StreamingMovies", "Contract", "PaperlessBilling",
  "PaymentMethod", "MonthlyCharges", "TotalCharges"];

function Histogram({ rows }) {
  const bins = useMemo(() => {
    const counts = new Array(BINS).fill(0);
    rows.forEach((r) => {
      counts[Math.min(BINS - 1, Math.floor(r.churn_probability * BINS))] += 1;
    });
    return counts;
  }, [rows]);
  const max = Math.max(...bins, 1);
  return (
    <>
      <Skyline
        label="How many customers sit at each level of risk"
        columns={bins.map((count, i) => ({
          fraction: count / max,
          color: `var(--${bandFor((i + 0.5) / BINS).token})`,
          title: `${i * 5}–${(i + 1) * 5}% chance: ${count} customers`,
        }))}
      />
      <div className="histogram-axis readout">
        <span>0% chance of leaving</span>
        <span>50%</span>
        <span>100%</span>
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

  const tryExample = async () => {
    try {
      const res = await fetch("/example-customers.csv");
      const blob = await res.blob();
      upload(new File([blob], "example-customers.csv", { type: "text/csv" }));
    } catch {
      setError("Couldn't load the example file.");
    }
  };

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
        <h1>Check a whole list of customers</h1>
        <p>
          Upload a spreadsheet (CSV) of customers and every one gets a score in under a second,
          sorted so the people most likely to leave are at the top.
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
          <h3>{busy ? "Checking everyone…" : "Drop a CSV file here"}</h3>
          <p>
            {busy
              ? "This takes about a second."
              : "No file? Try the example list of 1,000 real customers."}
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
          <button className="button button-quiet" style={{ marginLeft: 8 }} onClick={tryExample} disabled={busy}>
            Try the example
          </button>
          <details className="drop-help">
            <summary>What should the file look like?</summary>
            <p>
              One row per customer with these columns: {REQUIRED.join(", ")}. An optional{" "}
              <code>customerID</code> labels each row, and an optional <code>Churn</code> column
              (Yes/No) lets the app check how many real leavers it caught.
            </p>
          </details>
        </div>
      )}

      {data && (
        <div className="section-gap">
          <dl className="stats">
            <div className="stat">
              <dt>Customers checked</dt>
              <dd>
                {data.count.toLocaleString()}
                <small>{fileName}</small>
              </dd>
            </div>
            <div className="stat">
              <dt>Flagged to call</dt>
              <dd>
                {data.flagged.toLocaleString()}
                <small>{((data.flagged / data.count) * 100).toFixed(1)}% of the list</small>
              </dd>
            </div>
            <div className="stat">
              <dt>Average chance of leaving</dt>
              <dd>
                {(data.mean_probability * 100).toFixed(1)}%
                <small>alert line at {(data.threshold * 100).toFixed(0)}%</small>
              </dd>
            </div>
            <div className="stat">
              <dt>Money at stake</dt>
              <dd>
                {money(data.total_revenue_at_risk)}
                <small>per year, if nothing is done</small>
              </dd>
            </div>
            {accuracy && (
              <div className="stat">
                <dt>Real leavers caught</dt>
                <dd>
                  {(accuracy.recall * 100).toFixed(1)}%
                  <small>
                    and {(accuracy.precision * 100).toFixed(0)}% of flags were right
                  </small>
                </dd>
              </div>
            )}
          </dl>

          <section className="panel">
            <div className="panel-head">
              <h2>Where everyone lands</h2>
              <p>Each column is a group of customers; taller means more people at that level of risk.</p>
            </div>
            <div className="panel-body">
              <Histogram rows={data.results} />
            </div>
          </section>

          <section className="panel">
            <div className="table-toolbar">
              <input
                type="search"
                placeholder="Search by customer ID or risk level"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Filter customers"
              />
              <span style={{ color: "var(--muted)", fontSize: "var(--t-xs)" }}>
                {rows.length.toLocaleString()} shown
              </span>
              <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
                <button className="button button-quiet" onClick={downloadCsv}>
                  Download results
                </button>
                <button
                  className="button button-quiet"
                  onClick={() => {
                    setData(null);
                    setQuery("");
                  }}
                >
                  Check another file
                </button>
              </div>
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Customer</th>
                    <th className="sortable" onClick={() => sortBy("risk_band")}>
                      Risk level
                    </th>
                    <th
                      className="sortable num"
                      onClick={() => sortBy("churn_probability")}
                      style={{ textAlign: "right" }}
                    >
                      Chance of leaving
                    </th>
                    <th
                      className="sortable num"
                      onClick={() => sortBy("expected_revenue_at_risk")}
                      style={{ textAlign: "right" }}
                    >
                      Money at stake
                    </th>
                    <th>What to do</th>
                    {accuracy && <th>What really happened</th>}
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
                          {r.will_churn ? "Give them a call" : "Nothing yet"}
                        </td>
                        {accuracy && (
                          <td style={{ color: "var(--muted)" }}>
                            {r.actual === 1 ? "Left" : "Stayed"}
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
