import { LABELS, HINTS, GROUPS, OPTION_TEXT, INTERNET_EXTRAS } from "../fields.js";

const WIDE = new Set(["tenure", "MonthlyCharges", "Contract", "PaymentMethod", "InternetService"]);

const optionText = (o) => (typeof o === "number" ? (o ? "Yes" : "No") : OPTION_TEXT[o] ?? o);

function Choice({ name, options, value, onChange, disabled, hint }) {
  return (
    <fieldset className={`field choice${options.length > 3 ? " choice-grid" : ""}`} disabled={disabled}>
      <legend>{LABELS[name] ?? name}</legend>
      <div className="choice-options">
        {options.map((o) => (
          <label key={String(o)}>
            <input
              type="radio"
              name={`field-${name}`}
              checked={value === o}
              onChange={() => onChange(name, o)}
            />
            <span>{optionText(o)}</span>
          </label>
        ))}
      </div>
      {hint && <small className="hint">{hint}</small>}
    </fieldset>
  );
}

function Slider({ name, spec, value, onChange, format, step }) {
  const id = `field-${name}`;
  return (
    <div className="field">
      <label htmlFor={id} className="slider-head">
        <span>{LABELS[name]}</span>
        <output className="readout">{value === "" ? "–" : format(value)}</output>
      </label>
      <input
        id={id}
        type="range"
        min={spec.min}
        max={spec.max}
        step={step}
        value={value === "" ? spec.min : value}
        onChange={(e) => onChange(name, Number(e.target.value))}
      />
    </div>
  );
}

/** Built from /api/schema, so a new model column gets a control with no
 *  frontend change; fields.js only decides wording and placement. */
export default function CustomerForm({ schema, value, onChange, onPreset }) {
  if (!schema) {
    return (
      <div className="panel-body" style={{ display: "grid", gap: 11 }}>
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="skeleton" style={{ height: 38 }} />
        ))}
      </div>
    );
  }

  const byName = Object.fromEntries(schema.fields.map((f) => [f.name, f]));
  const noInternet = value.InternetService === "No";
  const noPhone = value.PhoneService === "No";

  const render = (name) => {
    const spec = byName[name];
    if (name === "tenure") {
      return <Slider name={name} spec={spec} value={value[name] ?? ""} onChange={onChange} step={1}
        format={(v) => (v < 12 ? `${v} mo` : `${(v / 12).toFixed(v % 12 ? 1 : 0)} yr`)} />;
    }
    if (name === "MonthlyCharges") {
      return <Slider name={name} spec={spec} value={value[name] ?? ""} onChange={onChange} step={0.05}
        format={(v) => `$${Number(v).toFixed(0)}`} />;
    }
    if (spec.type !== "select") return null;

    // "No internet service" / "No phone service" are set automatically by the
    // parent switch, so they never need to be a button.
    const options = spec.options.filter((o) => !String(o).startsWith("No ") || o === "No");
    const disabled = (noInternet && INTERNET_EXTRAS.includes(name)) || (noPhone && name === "MultipleLines");
    const hint = disabled
      ? noPhone && name === "MultipleLines" ? "Needs a phone plan" : "Needs internet"
      : HINTS[name];
    return <Choice name={name} options={options} value={value[name]} onChange={onChange} disabled={disabled} hint={hint} />;
  };

  return (
    <div className="panel-body">
      <div className="presets">
        <span>Start with</span>
        {[
          ["high", "someone about to leave"],
          ["average", "a typical customer"],
          ["low", "a loyal fan"],
        ].map(([p, text]) => (
          <button type="button" key={p} onClick={() => onPreset(p)}>
            {text}
          </button>
        ))}
      </div>

      {GROUPS.map((group) => (
        <div className="form-group" key={group.title}>
          <h4>{group.title}</h4>
          <div className="form-rows">
            {group.fields
              .filter((name) => byName[name])
              .map((name) => (
                <div key={name} className={WIDE.has(name) ? "span-2" : undefined}>
                  {render(name)}
                </div>
              ))}
          </div>
        </div>
      ))}

      {byName.TotalCharges && (
        <details className="form-more">
          <summary>Fine-tune the total paid</summary>
          <label className="field" htmlFor="field-TotalCharges">
            <span>{LABELS.TotalCharges} ($)</span>
            <input
              id="field-TotalCharges"
              type="number"
              inputMode="decimal"
              min={byName.TotalCharges.min}
              max={byName.TotalCharges.max}
              step={0.05}
              value={value.TotalCharges ?? ""}
              onChange={(e) => onChange("TotalCharges", e.target.value === "" ? "" : Number(e.target.value))}
            />
            <small className="hint">{HINTS.TotalCharges}</small>
          </label>
        </details>
      )}
    </div>
  );
}
