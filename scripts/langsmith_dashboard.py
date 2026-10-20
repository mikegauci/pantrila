"""Create (or rebuild) the "Pantrila live" LangSmith dashboard: quality, cost and latency of
the plans and chat turns the deployed API serves.

Every root run is named `plan` or `chat` and tagged with where it ran (`api`, `cli`, `eval`;
see `config.trace_config`); plans carry deterministic feedback (`targets_met`, `repairs`,
`fallbacks`, `pantry_use`) and chat turns `flagged_citations` (`config.log_feedback`). The
charts read those. Re-running deletes the old dashboard with the same title and rebuilds it.

    uv run python scripts/langsmith_dashboard.py [--source api|cli|eval|all]

Needs LANGSMITH_API_KEY (and LANGSMITH_ENDPOINT for EU accounts); LANGSMITH_PROJECT
defaults to `pantrila`.
"""

from __future__ import annotations

import argparse
import os

import httpx

from pantrila import config  # noqa: F401  (loads .env)

TITLE = "Pantrila live"
RUNS = ("plan", "chat")


def runs_filter(name: str, source: str) -> str:
    parts = ["eq(is_root, true)", f'eq(name, "{name}")']
    if source != "all":
        parts.append(f'has(tags, "{source}")')
    return f"and({', '.join(parts)})"


def count() -> dict:
    return {"type": "count"}


def total(field: str) -> dict:
    return {"type": "sum", "field": field}


def pct(field: str, p: float) -> dict:
    return {"type": "percentile", "field": field, "params": {"p": p}}


def feedback(key: str) -> dict:
    return {"type": "avg", "field": "feedback_score", "params": {"feedback_key": key}}


ERROR_RATE = {"type": "ratio", "numerator": {"type": "count", "filter": 'eq(status, "error")'},
              "denominator": count()}  # fmt: skip


def charts() -> list[tuple[str, str, str, list[tuple[str, str, dict]]]]:
    """(title, description, chart type, [(series name, run name, metric)]) in display order."""
    both = lambda metric: [(r, r, metric) for r in RUNS]  # noqa: E731
    plan_fb = lambda key: (key, "plan", feedback(key))  # noqa: E731
    return [
        ("Requests", "Plans and chat turns served.", "bar", both(count())),
        ("Spend (USD)", "Total model cost from token usage.", "bar", both(total("total_cost"))),
        ("Cost per request p50 (USD)", "Median cost of one plan or one chat turn.", "line",
         both(pct("total_cost", 0.5))),
        ("Latency p50 (s)", "Median end-to-end time of the LangGraph run.", "line",
         both(pct("latency_seconds", 0.5))),
        ("Latency p95 (s)", "Slowest 5% of runs start here.", "line",
         both(pct("latency_seconds", 0.95))),
        ("Error rate", "Share of runs that raised (for plans: no safe plan found).", "line",
         both(ERROR_RATE)),
        ("Plan quality", "targets_met: share of plans meeting every nutrition target; "
         "pantry_use: share of pantry foods used (people with a pantry).", "line",
         [plan_fb("targets_met"), plan_fb("pantry_use")]),
        ("Plan repairs", "Mean repair rounds (max 2) and meals the code had to replace.",
         "line", [plan_fb("repairs"), plan_fb("fallbacks")]),
        ("Chat citation guard", "Mean cited recipes per turn that broke a hard rule or did "
         "not exist (the guard flags them; 0 is the goal).", "line",
         [("flagged_citations", "chat", feedback("flagged_citations"))]),
        ("Tokens per request p50", "Median prompt + completion tokens.", "line",
         both(pct("total_tokens", 0.5))),
    ]  # fmt: skip


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--source", default="api", choices=["api", "cli", "eval", "all"])
    args = ap.parse_args()

    key = os.environ.get("LANGSMITH_API_KEY")
    if not key:
        raise SystemExit("LANGSMITH_API_KEY is not set")
    base = (os.environ.get("LANGSMITH_ENDPOINT") or "https://api.smith.langchain.com").rstrip("/")
    project = os.environ.get("LANGSMITH_PROJECT") or "pantrila"
    http = httpx.Client(base_url=f"{base}/api/v1", headers={"x-api-key": key}, timeout=30)

    def call(method: str, path: str, **kw):
        r = http.request(method, path, **kw)
        if r.is_error:
            raise SystemExit(f"{method} {path}: {r.status_code} {r.text}")
        return r.json() if r.content else None

    sessions = call("GET", "/sessions", params={"name": project})
    if not sessions:
        raise SystemExit(f"LangSmith project {project!r} not found; run a traced plan first")
    session_id = sessions[0]["id"]

    for old in call("GET", "/charts/section", params={"title_contains": TITLE}):
        if old["title"] == TITLE:
            call("DELETE", f"/charts/section/{old['id']}")
    section = call("POST", "/charts/section", json={
        "title": TITLE,
        "description": f"Project {project}, root runs tagged {args.source!r}. "
                       "Built by scripts/langsmith_dashboard.py.",
    })  # fmt: skip
    for i, (title, desc, kind, rows) in enumerate(charts()):
        call("POST", "/charts/create", json={
            "title": title, "description": desc, "chart_type": kind, "index": i,
            "section_id": section["id"],
            "series": [{
                "name": name, "metric_definition": metric,
                "filter_definition": {"source_type": "tracing_project",
                                      "project_ids": [session_id],
                                      "run_filter": runs_filter(run, args.source)},
            } for name, run, metric in rows],
        })  # fmt: skip
    host = base.replace("api.smith", "smith").replace("/api", "")
    print(f"dashboard {TITLE!r} with {i + 1} charts: {host}/dashboards/{section['id']}")


if __name__ == "__main__":
    main()
