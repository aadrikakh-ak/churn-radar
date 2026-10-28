import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import CustomerForm from "../components/CustomerForm.jsx";
import DriverChart from "../components/DriverChart.jsx";
import RiskScale, { bandFor } from "../components/RiskScale.jsx";
import { THRESHOLD_POLICIES } from "../fields.js";

const money = (n) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export default function Assess({ schema, info }) {
  const [customer, setCustomer] = useState(null);
  const [result, setResult] = useState(null);
  const [offers, setOffers] = useState(null);
  const [threshold, setThreshold] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const requestId = useRef(0);

  // Seed the form with the at-risk preset so the page is never empty on load.
  useEffect(() => {
    api.sample("high").then(setCustomer).catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (threshold == null && info?.thresholds?.default != null) {
      setThreshold(info.thresholds.default);
    }
  }, [info, threshold]);

  const score = useCallback(
    async (payload, cut) => {
      const id = ++requestId.current;
      setBusy(true);
      setError(null);
      try {
        const [prediction, whatIf] = await Promise.all([
          api.predict(payload, { threshold: cut }),
          api.whatIf(payload),
        ]);
        if (id !== requestId.current) return; // a newer request already won
        setResult(prediction);
        setOffers(whatIf);
      } catch (e) {
        if (id === requestId.current) setError(e.message);
      } finally {
        if (id === requestId.current) setBusy(false);
      }
    },
    []
  );

  const update = (name, value) => setCustomer((c) => ({ ...c, [name]: value }));

  const loadPreset = async (profile) => {
    try {
      const preset = await api.sample(profile);
      setCustomer(preset);
      score(preset, threshold);
    } catch (e) {
      setError(e.message);
    }
  };

  // Moving the threshold is a pure re-read of the same probability, so it is
  // applied locally rather than round-tripping to the server.
  const verdict = result && threshold != null ? result.churn_probability >= threshold : null;
  const band = result ? bandFor(result.churn_probability) : null;

  return (
    <>
      <header className="page-head">
        <h1>Score one customer</h1>
        <p>
          Enter an account and the network returns a calibrated churn probability, the
          features that moved it, and what each retention offer would be worth.
        </p>
      </header>

      {error && (
        <div className="notice" style={{ marginBottom: 20 }} role="alert">
          {error}
        </div>
      )}

      <div className="assess-grid">
        <section className="panel">
          <div className="panel-head">
            <h2>Customer</h2>
          </div>
          <CustomerForm
            schema={schema}
            value={customer ?? {}}
            onChange={update}
            onSubmit={() => customer && score(customer, threshold)}
            onPreset={loadPreset}
            busy={busy}
          />
        </section>

        <div className="section-gap">
          <section className="panel">
            <div className="panel-head">
              <h2>Churn risk</h2>
              <p>Drag the cut-off to change how aggressively customers are flagged.</p>
            </div>
            <div className="panel-body">
              {result ? (
                <RiskScale
                  probability={result.churn_probability}
                  threshold={threshold ?? result.threshold}
                  onThresholdChange={setThreshold}
                  baseline={result.baseline_probability}
                  ghosts={offers?.scenarios?.map((s) => ({
                    label: s.label,
                    probability: s.churn_probability,
                  }))}
                  pending={busy}
                />
              ) : (
                <div className="empty">
                  {busy ? (
                    <>
                      <span className="spin" />
                      Scoring
                    </>
                  ) : (
                    "Fill in the customer and score them to see the risk reading."
                  )}
                </div>
              )}
            </div>

            {result && (
              <div className="verdict">
                <span className={`chip tone-${band.token}`}>
                  {verdict ? "Flag for retention" : "No action needed"}
                </span>
                <span className="verdict-meta">
                  {money(result.expected_revenue_at_risk)} of annual revenue at risk ·{" "}
                  average customer sits at{" "}
                  {(result.baseline_probability * 100).toFixed(0)}% · scored in{" "}
                  {result.latency_ms.toFixed(0)} ms
                </span>
                <div className="presets">
                  {THRESHOLD_POLICIES.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      title={p.blurb}
                      onClick={() => setThreshold(info?.thresholds?.[p.id] ?? 0.5)}
                    >
                      {p.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </section>

          {result && (
            <section className="panel">
              <div className="panel-head">
                <h2>Why</h2>
                <p>
                  Integrated Gradients, measured against the average customer. The bars sum
                  to the gap between this account and that average.
                </p>
              </div>
              <div className="panel-body">
                <DriverChart drivers={result.drivers} />
              </div>
            </section>
          )}

          {result && offers && (
            <section className="panel">
              <div className="panel-head">
                <h2>What would help</h2>
                <p>Each offer re-scored through the same network.</p>
              </div>
              <div className="panel-body">
                {verdict ? (
                  <>
                    <ul className="actions-list" style={{ marginBottom: 20 }}>
                      {result.recommended_actions.map((action) => (
                        <li key={action}>
                          <span />
                          {action}
                        </li>
                      ))}
                    </ul>
                    {offers.scenarios.map((s) => (
                      <div className="offer" key={s.label}>
                        <div className="offer-name">{s.label}</div>
                        <div className="offer-change">{s.change}</div>
                        <div className="offer-figures">
                          <div
                            className={`offer-prob readout tone-${
                              bandFor(s.churn_probability).token
                            }`}
                          >
                            {(s.churn_probability * 100).toFixed(1)}%
                          </div>
                          <div className="offer-delta" data-worse={s.delta > 0 || undefined}>
                            {s.delta <= 0 ? "−" : "+"}
                            {Math.abs(s.delta * 100).toFixed(1)} pts
                            {s.revenue_saved > 0 && ` · ${money(s.revenue_saved)} kept`}
                          </div>
                        </div>
                      </div>
                    ))}
                  </>
                ) : (
                  <ul className="actions-list">
                    {result.recommended_actions.map((action) => (
                      <li key={action}>
                        <span />
                        {action}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
          )}
        </div>
      </div>
    </>
  );
}
