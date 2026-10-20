"""Generate the web Insights snapshot from explicit selections of committed eval reports.

Run after changing evals/report_selection.json. Historical retrieval reports used recall@k
keys for the capped-denominator (normalized) metric; new reports name it explicitly.
"""

import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SELECTION = ROOT / "evals" / "report_selection.json"
OUT = ROOT / "web" / "src" / "lib" / "eval-snapshot.json"
REPO = "https://github.com/mikegauci/pantrila/blob/main/evals/reports"


def render_snapshot() -> str:
    selected = json.loads(SELECTION.read_text())
    reports = {
        kind: json.loads((ROOT / "evals" / "reports" / name).read_text())
        for kind, name in selected.items()
    }
    retrieval, planner, assistant = (reports[k] for k in ("retrieval", "planner", "assistant"))
    hybrid, plan, chat = (retrieval["summary"]["hybrid"], planner["summary"], assistant["summary"])
    normalized = hybrid.get("normalized_recall@10", hybrid.get("recall@10"))
    rows = assistant["results"]

    def passed(key):
        scored = [r[key] for r in rows if r.get(key) is not None]
        return f"{sum(scored)} / {len(scored)}"

    def latency(summary):
        return (
            f"{summary['latency_p50_ms'] / 1000:.1f} s / {summary['latency_p95_ms'] / 1000:.1f} s"
        )

    snapshot = [
        {
            "name": "Recipe search",
            "report": f"{REPO}/{Path(selected['retrieval']).stem}.md",
            "what": f"{retrieval['meta']['queries']} labelled queries over "
            f"{retrieval['meta']['recipes']} recipes, hybrid (vector + full text)",
            "metrics": [
                ["Normalized recall@10", f"{normalized:.3f}"],
                ["MRR", f"{hybrid['mrr']:.3f}"],
            ],
        },
        {
            "name": "Meal planner",
            "report": f"{REPO}/{Path(selected['planner']).stem}.md",
            "what": f"{plan['plans']} eval profiles on {planner['meta']['model']}",
            "metrics": [
                ["Hard violations", str(plan["hard_violations"])],
                ["Plans meeting every target", f"{plan['plans_clean']} / {plan['plans']}"],
                ["Cost per plan", f"${plan['cost_per_plan_usd']:.3f}"],
                ["Latency p50 / p95", latency(plan)],
            ],
        },
        {
            "name": "Cooking assistant",
            "report": f"{REPO}/{Path(selected['assistant']).stem}.md",
            "what": f"{chat['cases']} chat cases on {assistant['meta']['model']}",
            "metrics": [
                ["Right tools", f"{chat['tools_ok']:.0%}"],
                ["Expected draft choices", passed("draft_ok")],
                ["Recipe citations when expected", passed("cite_ok")],
                [
                    "Unsafe or made-up cited recipes",
                    str(chat["unsafe_cites"] + chat["made_up_cites"]),
                ],
                ["Missing draft warnings", str(chat["unwarned_drafts"])],
                ["Cost per turn", f"${chat['cost_per_turn_usd']:.4f}"],
                ["Latency p50 / p95", latency(chat)],
            ],
        },
    ]
    return json.dumps(snapshot, indent=2) + "\n"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    rendered = render_snapshot()
    if args.check:
        if not OUT.exists() or OUT.read_text() != rendered:
            raise SystemExit("Insights snapshot is stale: run scripts/update_eval_snapshot.py")
    else:
        OUT.write_text(rendered)
        print(OUT.relative_to(ROOT))


if __name__ == "__main__":
    main()
