// Latest offline eval numbers, copied from evals/reports/ (update with each eval run).
const REPO = "https://github.com/mikegauci/pantrio/blob/main/evals/reports"

export const EVALS = [
  {
    name: "Recipe search",
    report: `${REPO}/retrieval-2026-10-15T195536Z.md`,
    what: "65 labelled queries over 300 recipes, hybrid (vector + full text)",
    metrics: [
      ["Recall@10", "0.843"],
      ["MRR", "0.922"],
    ],
  },
  {
    name: "Meal planner",
    report: `${REPO}/planner-2026-10-16T084243Z.md`,
    what: "16 eval profiles on gpt-5.4-mini",
    metrics: [
      ["Hard violations", "0"],
      ["Plans meeting every target", "13 / 16"],
      ["Cost per plan", "$0.023"],
      ["Latency p50 / p95", "19 s / 84 s"],
    ],
  },
  {
    name: "Cooking assistant",
    report: `${REPO}/assistant-2026-10-16T094533Z.md`,
    what: "24 chat cases on gpt-5.4-mini",
    metrics: [
      ["Right tools", "100%"],
      ["Unsafe or made-up recipes", "0"],
      ["Cost per turn", "$0.0022"],
      ["Latency p50 / p95", "8 s / 17 s"],
    ],
  },
] as const
