// In dev, Vite proxies /api to the FastAPI server (see vite.config.js).
// In production the same origin serves both, so a relative base works for the
// single-container deploy and VITE_API_BASE covers split deployments.
const BASE = (import.meta.env.VITE_API_BASE ?? "").replace(/\/$/, "");

async function request(path, options = {}) {
  let response;
  try {
    response = await fetch(`${BASE}${path}`, options);
  } catch {
    throw new Error("Can't reach the API. Check that the backend is running.");
  }

  if (!response.ok) {
    let detail = `Request failed (${response.status})`;
    try {
      const body = await response.json();
      if (typeof body.detail === "string") {
        detail = body.detail;
      } else if (Array.isArray(body.detail)) {
        // FastAPI validation errors: surface the field that actually failed.
        detail = body.detail
          .map((d) => `${d.loc?.slice(1).join(".") ?? "field"}: ${d.msg}`)
          .join("; ");
      }
    } catch {
      /* response had no JSON body; keep the status message */
    }
    throw new Error(detail);
  }
  return response.json();
}

export const api = {
  health: () => request("/api/health"),
  info: () => request("/api/model/info"),
  metrics: () => request("/api/model/metrics"),
  schema: () => request("/api/schema"),
  sample: (profile) => request(`/api/sample?profile=${profile}`),

  predict: (customer, { policy = "default", threshold } = {}) =>
    request("/api/predict", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customer,
        threshold_policy: policy,
        ...(threshold != null ? { threshold } : {}),
      }),
    }),

  whatIf: (customer) =>
    request("/api/what-if", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(customer),
    }),

  predictCsv: (file, { threshold } = {}) => {
    const form = new FormData();
    form.append("file", file);
    const query = threshold != null ? `?threshold=${threshold}` : "";
    return request(`/api/predict/csv${query}`, { method: "POST", body: form });
  },

  plotUrl: (name) => `${BASE}/api/plots/${name}`,
};
