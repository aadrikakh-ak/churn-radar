// Display names, hints and grouping for the customer form. The *existence* of
// each field comes from the API schema; this file only decides how it reads.

export const LABELS = {
  gender: "Gender",
  SeniorCitizen: "Aged 65 or over",
  Partner: "Has a partner",
  Dependents: "Has kids or dependents",
  tenure: "Months as a customer",
  PhoneService: "Phone plan",
  MultipleLines: "More than one phone line",
  InternetService: "Internet",
  OnlineSecurity: "Online security",
  OnlineBackup: "Cloud backup",
  DeviceProtection: "Device insurance",
  TechSupport: "Tech support",
  StreamingTV: "TV streaming",
  StreamingMovies: "Movie streaming",
  Contract: "Contract",
  PaperlessBilling: "Paperless bills",
  PaymentMethod: "Pays by",
  MonthlyCharges: "Monthly bill",
  TotalCharges: "Paid so far",
};

export const HINTS = {
  Contract: "Month-to-month means they can quit any time.",
  TotalCharges: "Filled in for you from months × monthly bill.",
};

// Shorter button text for long option values.
export const OPTION_TEXT = {
  "Month-to-month": "Monthly",
  "One year": "1 year",
  "Two year": "2 years",
  "Fiber optic": "Fibre",
  "Electronic check": "E-check",
  "Mailed check": "Paper check",
  "Bank transfer (automatic)": "Auto bank transfer",
  "Credit card (automatic)": "Auto card",
};

export const INTERNET_EXTRAS = [
  "OnlineSecurity",
  "OnlineBackup",
  "DeviceProtection",
  "TechSupport",
  "StreamingTV",
  "StreamingMovies",
];

export const GROUPS = [
  {
    title: "The basics",
    fields: ["tenure", "MonthlyCharges", "Contract", "PaymentMethod"],
  },
  {
    title: "What they pay for",
    fields: ["InternetService", "PhoneService", "MultipleLines", ...INTERNET_EXTRAS],
  },
  {
    title: "About them",
    fields: ["SeniorCitizen", "Partner", "Dependents", "gender", "PaperlessBilling"],
  },
];

export const THRESHOLD_POLICIES = [
  {
    id: "f1_optimal",
    name: "Balanced",
    blurb: "A fair middle ground between catching leavers and false alarms.",
  },
  {
    id: "cost_optimal",
    name: "Cautious",
    blurb: "Flags more people, because missing a leaver costs more than a wasted offer.",
  },
  {
    id: "high_recall",
    name: "Catch 4 in 5",
    blurb: "The highest alert line that still catches four out of five leavers.",
  },
];

// Engineered model features are folded back onto the thing a person would
// recognise, so "tenure", "tenure band" and "tenure in years" read as one row.
const DRIVER_GROUPS = {
  tenure: "tenure",
  TenureBucket: "tenure",
  TenureYears: "tenure",
  Contract: "Contract",
  ContractMonths: "Contract",
  AvgChargesPerMonth: "bill",
  ChargesDelta: "bill",
  MonthlyChargeRatio: "bill",
  MonthlyCharges: "bill",
  TotalCharges: "bill",
  NumServices: "extras",
};

const DRIVER_NAMES = {
  tenure: "How long they've stayed",
  Contract: "Their contract",
  bill: "Their bill",
  extras: "Number of extras",
};

export function friendlyDrivers(drivers, customer) {
  const merged = new Map();
  for (const d of drivers ?? []) {
    const key = DRIVER_GROUPS[d.feature] ?? d.feature;
    const row = merged.get(key) ?? {
      key,
      label: DRIVER_NAMES[key] ?? LABELS[d.feature] ?? d.label,
      value: describe(key, d, customer),
      contribution: 0,
    };
    row.contribution += d.contribution;
    merged.set(key, row);
  }
  return [...merged.values()]
    .filter((r) => Math.abs(r.contribution) >= 0.003)
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
}

function describe(key, driver, c) {
  if (!c) return driver.value;
  if (key === "tenure") return `${c.tenure} month${c.tenure === 1 ? "" : "s"}`;
  if (key === "Contract") return c.Contract;
  if (key === "bill") return `$${Number(c.MonthlyCharges).toFixed(0)} a month`;
  return driver.value;
}
