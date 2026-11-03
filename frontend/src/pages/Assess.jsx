import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import CustomerForm from "../components/CustomerForm.jsx";
import DriverChart from "../components/DriverChart.jsx";
import RiskScale, { bandFor } from "../components/RiskScale.jsx";
import { People } from "../components/Blocks.jsx";
import { THRESHOLD_POLICIES, INTERNET_EXTRAS } from "../fields.js";

const money = (n) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const pct = (p) => `${Math.round(p * 100)}%`;

// Keep linked fields consistent, the way a real account would be.
function applyChange(c, name, value) {
  const next = { ...c, [name]: value };
  if ((name === "tenure" || name === "MonthlyCharges") && next.tenure !== "" && next.MonthlyCharges !== "") {
    next.TotalCharges = Math.round(next.tenure * next.MonthlyCharges * 100) / 100;
  }
  if (name === "InternetService") {
    for (const f of INTERNET_EXTRAS) {
      if (value === "No") next[f] = "No internet service";
      else if (next[f] === "No internet service") next[f] = "No";
    }
  }
  if (name === "PhoneService") {
    if (value === "No") next.MultipleLines = "No phone service";
    else if (next.MultipleLines === "No phone service") next.MultipleLines = "No";
  }
  return next;
}

export default function Assess({ schema, info }) {
  const [customer, setCustomer] = useState(null);
  const [result, setResult] = useState(null);
  const [offers, setOffers] = useState(null);
  const [threshold, setThreshold] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const requestId = useRef(0);

  useEffect(() => {
    api.sample("high").then(setCustomer).catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (threshold == null && info?.thresholds?.default != null) setThreshold(info.thresholds.default);
  }, [info, threshold]);

  const score = useCallback(async (payload) => {
    const id = ++requestId.current;
    setBusy(true);
    setError(null);
    try {
      const [prediction, whatIf] = await Promise.all([api.predict(payload), api.whatIf(payload)]);
      if (id !== requestId.current) return; // a newer request already won
      setResult(prediction);
      setOffers(whatIf);
    } catch (e) {
      if (id === requestId.current) setError(e.message);
    } finally {
      if (id === requestId.current) setBusy(false);
    }
  }, []);

  // Every change re-scores on its own, so there is no "submit" step to learn.
  useEffect(() => {
    if (!customer || customer.tenure === "" || customer.MonthlyCharges === "" || customer.TotalCharges === "") return;
    const t = setTimeout(() => score(customer), 250);
    return () => clearTimeout(t);
  }, [customer, score]);

  const update = (name, value) => setCustomer((c) => applyChange(c, name, value));
  const loadPreset = (profile) => api.sample(profile).then(setCustomer).catch((e) => setError(e.message));

  const cut = threshold ?? result?.threshold ?? 0.5;
  const p = result?.churn_probability;
  const verdict = result ? p >= cut : null;
  const band = result ? bandFor(p) : null;
  const helpful = offers?.scenarios?.filter((s) => s.delta < -0.005) ?? [];

  return (
    <>
      <header className="page-head">
        <h1>Will this customer leave?</h1>
        <p>
          Describe a customer of a phone and internet company. The model guesses how likely they
          are to cancel, explains why, and suggests what might change their mind.
        </p>
        <ol className="steps">
          <li>Pick a starting customer</li>
          <li>Change anything you like</li>
          <li>Watch the result update</li>
        </ol>
      </header>

      {error && (
        <div className="notice" style={{ marginBottom: 20 }} role="alert">
          {error}
        </div>
      )}

      <div className="assess-grid">
        <section className="panel form-panel">
          <div className="panel-head">
            <h2>The customer</h2>
          </div>
          <CustomerForm schema={schema} value={customer ?? {}} onChange={update} onPreset={loadPreset} />
        </section>

        <div className="section-gap">
          <section className="panel result" data-pending={busy || undefined} aria-live="polite">
            {result ? (
              <>
                <div className="result-top">
                  <div>
                    <p className="kicker">Chance they leave</p>
                    <div className={`result-number readout tone-${band.token}`}>
                      {Math.round(p * 100)}
                      <small>%</small>
                    </div>
                    <h2 className="result-verdict">
                      {verdict ? "Likely to leave" : "Likely to stay"}
                      <span className={`chip tone-${band.token}`}>{band.name} risk</span>
                    </h2>
                    <p className="result-line">
                      Out of 10 customers like this, about <b>{Math.round(p * 10)}</b> would cancel.
                      {result.expected_revenue_at_risk >= 1 && (
                        <> That puts roughly <b>{money(result.expected_revenue_at_risk)}</b> a year at stake.</>
                      )}
                    </p>
                  </div>
                  <People
                    leaving={Math.round(p * 10)}
                    tone={`var(--${band.token})`}
                    label={`${Math.round(p * 10)} of 10 similar customers leave`}
                  />
                </div>

                <div className="result-scale">
                  <div className="result-scale-head">
                    <h3>Alert line</h3>
                    <p>
                      Anyone above the line gets flagged for a call. Drag it, or pick a style:
                    </p>
                    <div className="presets">
                      {THRESHOLD_POLICIES.map((pol) => {
                        const v = info?.thresholds?.[pol.id];
                        return (
                          <button key={pol.id} type="button" title={pol.blurb}
                            aria-pressed={v != null && Math.abs(v - cut) < 0.001}
                            onClick={() => setThreshold(v ?? 0.5)}>
                            {pol.name}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <RiskScale
                    probability={p}
                    threshold={cut}
                    onThresholdChange={setThreshold}
                    baseline={result.baseline_probability}
                    ghosts={helpful.map((s) => ({ label: s.label, probability: s.churn_probability }))}
                    pending={busy}
                  />
                  <p className="legend">
                    <span className="legend-avg" /> average customer ({pct(result.baseline_probability)})
                    {helpful.length > 0 && (
                      <>
                        <span className="legend-ghost" /> after one of the ideas below
                      </>
                    )}
                  </p>
                </div>
              </>
            ) : (
              <div className="empty">
                <span className="spin" />
                Working it out
              </div>
            )}
          </section>

          {result && (
            <section className="panel">
              <div className="panel-head">
                <h2>Why?</h2>
                <p>Compared with an average customer. Points add to or take away from the chance of leaving.</p>
              </div>
              <div className="panel-body">
                <DriverChart drivers={result.drivers} customer={customer} />
              </div>
            </section>
          )}

          {result && offers && (
            <section className="panel">
              <div className="panel-head">
                <h2>{verdict ? "What could keep them" : "Nothing urgent"}</h2>
                <p>
                  {verdict
                    ? "Each idea is run back through the model to see how much it would help."
                    : "This customer is below the alert line. Small things still help:"}
                </p>
              </div>
              <div className="panel-body">
                {verdict && helpful.length > 0 && (
                  <div className="ideas">
                    {helpful.map((s) => (
                      <div className="idea" key={s.label}>
                        <div className="idea-name">{s.label}</div>
                        <div className="idea-bars" aria-hidden="true">
                          <span className="idea-before" style={{ width: pct(p) }} />
                          <span className={`idea-after tone-${bandFor(s.churn_probability).token}`}
                            style={{ width: pct(s.churn_probability) }} />
                        </div>
                        <div className="idea-figures readout">
                          {pct(p)} → <b className={`tone-${bandFor(s.churn_probability).token}`}>{pct(s.churn_probability)}</b>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {result.recommended_actions.length > 0 && (
                  <>
                    {verdict && helpful.length > 0 && <h3 className="tips-title">Tips for the support team</h3>}
                    <ul className="actions-list">
                      {result.recommended_actions.map((action) => (
                        <li key={action}>{action}</li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            </section>
          )}
        </div>
      </div>

      {result && (
        <button
          type="button"
          className="mini-result"
          onClick={() => document.querySelector(".result")?.scrollIntoView({ behavior: "smooth" })}
        >
          <b className={`readout tone-${band.token}`}>{pct(p)}</b>
          {verdict ? "Likely to leave" : "Likely to stay"}
          <span>See why ↓</span>
        </button>
      )}
    </>
  );
}
