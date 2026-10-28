// Display names and grouping for the customer form. The *existence* of each
// field comes from the API schema; this file only decides how it reads and
// where it sits, which is a presentation concern.

export const LABELS = {
  gender: "Gender",
  SeniorCitizen: "Senior citizen",
  Partner: "Has a partner",
  Dependents: "Has dependents",
  tenure: "Tenure (months)",
  PhoneService: "Phone service",
  MultipleLines: "Multiple lines",
  InternetService: "Internet service",
  OnlineSecurity: "Online security",
  OnlineBackup: "Online backup",
  DeviceProtection: "Device protection",
  TechSupport: "Tech support",
  StreamingTV: "Streaming TV",
  StreamingMovies: "Streaming movies",
  Contract: "Contract",
  PaperlessBilling: "Paperless billing",
  PaymentMethod: "Payment method",
  MonthlyCharges: "Monthly charges ($)",
  TotalCharges: "Total charges ($)",
};

export const GROUPS = [
  {
    title: "Who they are",
    fields: ["gender", "SeniorCitizen", "Partner", "Dependents"],
  },
  {
    title: "The account",
    fields: ["tenure", "Contract", "PaymentMethod", "PaperlessBilling"],
  },
  {
    title: "Services",
    fields: [
      "PhoneService",
      "MultipleLines",
      "InternetService",
      "OnlineSecurity",
      "OnlineBackup",
      "DeviceProtection",
      "TechSupport",
      "StreamingTV",
      "StreamingMovies",
    ],
  },
  {
    title: "Billing",
    fields: ["MonthlyCharges", "TotalCharges"],
  },
];

export const THRESHOLD_POLICIES = [
  {
    id: "f1_optimal",
    name: "Balanced",
    blurb: "Best trade-off between catching churners and wasting offers.",
  },
  {
    id: "cost_optimal",
    name: "Lowest cost",
    blurb: "Minimises 5x the cost of a missed churner plus 1x a wasted offer.",
  },
  {
    id: "high_recall",
    name: "Catch 80%",
    blurb: "Cheapest cut-off that still finds four out of five churners.",
  },
];
