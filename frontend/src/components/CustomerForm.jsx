import { LABELS, GROUPS } from "../fields.js";

function Field({ name, spec, value, onChange }) {
  const label = LABELS[name] ?? name;
  const id = `field-${name}`;

  if (spec.type === "select") {
    return (
      <label className="field" htmlFor={id}>
        <span>{label}</span>
        <select
          id={id}
          value={value ?? ""}
          onChange={(e) => {
            const raw = e.target.value;
            const next = spec.options.every((o) => typeof o === "number")
              ? Number(raw)
              : raw;
            onChange(name, next);
          }}
        >
          {spec.options.map((option) => (
            <option key={String(option)} value={option}>
              {typeof option === "number" ? (option ? "Yes" : "No") : option}
            </option>
          ))}
        </select>
      </label>
    );
  }

  return (
    <label className="field" htmlFor={id}>
      <span>{label}</span>
      <input
        id={id}
        type="number"
        inputMode="decimal"
        min={spec.min}
        max={spec.max}
        step={name === "tenure" ? 1 : 0.05}
        value={value ?? ""}
        onChange={(e) => onChange(name, e.target.value === "" ? "" : Number(e.target.value))}
      />
    </label>
  );
}

/** The form is built from /api/schema, so adding a column to the model adds a
 *  control here with no frontend change. */
export default function CustomerForm({ schema, value, onChange, onSubmit, busy, onPreset }) {
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

  return (
    <form
      className="panel-body"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <div className="presets">
        <span>Start from</span>
        {["high", "average", "low"].map((p) => (
          <button type="button" key={p} onClick={() => onPreset(p)}>
            {{ high: "at-risk", average: "typical", low: "loyal" }[p]} customer
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
                <div key={name} className={group.wide?.includes(name) ? "span-2" : undefined}>
                  <Field
                    name={name}
                    spec={byName[name]}
                    value={value[name]}
                    onChange={onChange}
                  />
                </div>
              ))}
          </div>
        </div>
      ))}

      <div className="form-actions">
        <button className="button button-primary" type="submit" disabled={busy}>
          {busy ? "Scoring" : "Score this customer"}
        </button>
      </div>
    </form>
  );
}
