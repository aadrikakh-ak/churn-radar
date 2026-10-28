import { useEffect, useState } from "react";
import { api } from "../api.js";
import CurveChart from "../components/CurveChart.jsx";

const pc = (v, d = 1) => `${(v * 100).toFixed(d)}%`;

export default function ModelCard({ info }) {
  const [metrics, setMetrics] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.metrics().then(setMetrics).catch((e) => setError(e.message));
  }, []);

  if (error) {
    return (
      <>
        <header className="page-head">
          <h1>The model</h1>
        </header>
        <div className="notice" role="alert">
          {error}
        </div>
      </>
    );
  }

  if (!metrics || !info) {
    return (
      <>
        <header className="page-head">
          <h1>The model</h1>
        </header>
        <div className="section-gap">
          {[180, 300, 240].map((h, i) => (
            <div key={i} className="skeleton" style={{ height: h }} />
          ))}
        </div>
      </>
    );
  }

  const t = metrics.test;
  const churnRate = metrics.dataset.churn_rate;

  return (
    <>
      <header className="page-head">
        <h1>The model</h1>
        <p>
          Everything here comes from the held-out test split the network never saw during
          training, scored at the cut-off tuned on the validation split.
        </p>
      </header>

      <div className="section-gap">
        <dl className="stats">
          <div className="stat">
            <dt>ROC-AUC</dt>
            <dd>
              {t.roc_auc.toFixed(3)}
              <small>ranking quality</small>
            </dd>
          </div>
          <div className="stat">
            <dt>PR-AUC</dt>
            <dd>
              {t.pr_auc.toFixed(3)}
              <small>vs {churnRate.toFixed(2)} by chance</small>
            </dd>
          </div>
          <div className="stat">
            <dt>Recall</dt>
            <dd>
              {pc(t.recall)}
              <small>of churners caught</small>
            </dd>
          </div>
          <div className="stat">
            <dt>Precision</dt>
            <dd>
              {pc(t.precision)}
              <small>of flags are real</small>
            </dd>
          </div>
          <div className="stat">
            <dt>F1</dt>
            <dd>
              {t.f1.toFixed(3)}
              <small>balance of the two</small>
            </dd>
          </div>
          <div className="stat">
            <dt>Brier</dt>
            <dd>
              {t.brier.toFixed(3)}
              <small>probability accuracy</small>
            </dd>
          </div>
        </dl>

        <section className="panel">
          <div className="panel-head">
            <h2>How it performs</h2>
            <p>
              Precision-recall matters more than ROC here: only{" "}
              {pc(churnRate, 0)} of customers churn, so a model can look strong on ROC
              while still flooding the retention team with false alarms.
            </p>
          </div>
          <div className="panel-body curve-grid">
            <div>
              <CurveChart
                points={metrics.curves.roc}
                xKey="fpr"
                yKey="tpr"
                xLabel="false positive rate"
                yLabel="true positive rate"
                diagonal
              />
              <p className="curve-caption">
                ROC curve, area {t.roc_auc.toFixed(3)}. The dashed line is random guessing.
              </p>
            </div>
            <div>
              <CurveChart
                points={metrics.curves.pr}
                xKey="recall"
                yKey="precision"
                xLabel="recall"
                yLabel="precision"
                flatline={churnRate}
                tone="var(--hold)"
              />
              <p className="curve-caption">
                Precision-recall, area {t.pr_auc.toFixed(3)}. The dashed line is the base
                churn rate.
              </p>
            </div>
            <div>
              <CurveChart
                points={metrics.curves.calibration}
                xKey="predicted"
                yKey="observed"
                xLabel="predicted probability"
                yLabel="observed churn rate"
                diagonal
                tone="var(--watch)"
              />
              <p className="curve-caption">
                Reliability after Platt scaling. Points on the diagonal mean a stated 70%
                risk really does churn 70% of the time.
              </p>
            </div>
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2>Where the value is</h2>
            <p>
              Customers sorted by risk and cut into ten equal groups. Working the list
              top-down is what the scores are for.
            </p>
          </div>
          <div className="table-scroll" style={{ maxHeight: "none" }}>
            <table>
              <thead>
                <tr>
                  <th>Decile</th>
                  <th className="num">Customers</th>
                  <th className="num">Churned</th>
                  <th className="num">Churn rate</th>
                  <th className="num">Lift</th>
                  <th className="num">Churners found so far</th>
                </tr>
              </thead>
              <tbody>
                {metrics.lift.map((row) => (
                  <tr key={row.decile}>
                    <td>{row.decile === 1 ? "1 (riskiest)" : row.decile}</td>
                    <td className="num">{row.customers}</td>
                    <td className="num">{row.churners}</td>
                    <td className="num">{pc(row.churn_rate)}</td>
                    <td className="num" style={{ fontWeight: row.lift >= 2 ? 600 : 400 }}>
                      {row.lift.toFixed(2)}×
                    </td>
                    <td className="num">{pc(row.cumulative_capture, 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2>Against simpler models</h2>
            <p>
              Trained on the same split and scored the same way. The honest result: on 7,000
              rows of tabular data the network matches classical models rather than beating
              them, and earns its place on F1 and on the explanations it supports.
            </p>
          </div>
          <div className="table-scroll" style={{ maxHeight: "none" }}>
            <table>
              <thead>
                <tr>
                  <th>Model</th>
                  <th className="num">ROC-AUC</th>
                  <th className="num">PR-AUC</th>
                  <th className="num">F1</th>
                  <th className="num">Accuracy</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style={{ fontWeight: 600 }}>Neural network (this model)</td>
                  <td className="num">{t.roc_auc.toFixed(4)}</td>
                  <td className="num">{t.pr_auc.toFixed(4)}</td>
                  <td className="num">{t.f1.toFixed(4)}</td>
                  <td className="num">{t.accuracy.toFixed(4)}</td>
                </tr>
                {metrics.baselines.map((b) => (
                  <tr key={b.model}>
                    <td>{b.model}</td>
                    <td className="num">{b.roc_auc.toFixed(4)}</td>
                    <td className="num">{b.pr_auc.toFixed(4)}</td>
                    <td className="num">{b.f1.toFixed(4)}</td>
                    <td className="num">{b.accuracy.toFixed(4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2>How it is built</h2>
          </div>
          <div className="panel-body section-gap">
            <div className="arch">
              <span className="arch-layer">{info.model.inputs} inputs</span>
              {info.model.architecture.map((units, i) => (
                <span key={i} style={{ display: "contents" }}>
                  <span className="arch-arrow">→</span>
                  <span className="arch-layer">
                    dense {units} · bn · relu · drop {info.model.dropout[i]}
                  </span>
                </span>
              ))}
              <span className="arch-arrow">→</span>
              <span className="arch-layer">sigmoid</span>
            </div>

            <dl className="kv">
              <dt>Ensemble</dt>
              <dd>{info.model.ensemble_size} networks averaged</dd>
              <dt>Parameters</dt>
              <dd>{info.model.parameters.toLocaleString()}</dd>
              <dt>Training rows</dt>
              <dd>
                {info.rows.train.toLocaleString()} train · {info.rows.validation.toLocaleString()}{" "}
                validation · {info.rows.test.toLocaleString()} test
              </dd>
              <dt>Calibration</dt>
              <dd>
                {info.model.calibration} (Brier{" "}
                {metrics.calibration_effect.brier_before.toFixed(3)} →{" "}
                {metrics.calibration_effect.brier_after.toFixed(3)})
              </dd>
              <dt>Class imbalance</dt>
              <dd>balanced class weights</dd>
              <dt>Explanations</dt>
              <dd>
                {info.explainer.method}, {info.explainer.steps} steps
              </dd>
              <dt>Trained</dt>
              <dd>{new Date(info.model.trained_at).toLocaleString()}</dd>
            </dl>
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2>What the model looks at</h2>
            <p>
              Drop in test ROC-AUC when a feature is shuffled. Features engineered for this
              project are marked.
            </p>
          </div>
          <div className="panel-body">
            {metrics.importance.slice(0, 12).map((row, i) => {
              const max = metrics.importance[0].importance || 1;
              const derived = info.feature_notes?.[row.feature];
              return (
                <div className="driver-row" key={row.feature} title={derived ?? undefined}>
                  <div className="driver-label">
                    <strong>{row.feature}</strong>
                    {derived && <span>engineered</span>}
                  </div>
                  <div className="driver-track" data-oneside>
                    <span
                      className="driver-bar tone-hold"
                      style={{
                        left: 0,
                        width: `${Math.max(1, (row.importance / max) * 100)}%`,
                        "--origin": "left",
                        "--delay": `${i * 35}ms`,
                      }}
                    />
                  </div>
                  <div className="driver-value readout">{row.importance.toFixed(4)}</div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2>Training run</h2>
            <p>
              Produced by <code>python -m ml.train</code>, over {info.model.epochs_run} epochs
              with early stopping on validation PR-AUC.
            </p>
          </div>
          <div className="panel-body curve-grid">
            {[
              ["training_history.png", "Loss and AUC per epoch for the first ensemble member."],
              ["evaluation_curves.png", "ROC, precision-recall and reliability on the test split."],
              ["confusion_matrix.png", "Test-set confusion matrix at the tuned cut-off."],
              ["feature_importance.png", "Permutation importance across all features."],
            ].map(([file, caption]) => (
              <figure key={file} style={{ margin: 0 }}>
                <img className="plot-image" src={api.plotUrl(file)} alt={caption} loading="lazy" />
                <figcaption className="curve-caption">{caption}</figcaption>
              </figure>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}
