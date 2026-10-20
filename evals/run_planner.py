"""Meal-planning eval: run the planner on every eval profile and score the plans.

Per plan: hard constraint violations on the returned plan (re-checked here, must be 0),
violations in the first draft (what the checker and repair loop catch), soft violations left,
daily energy error against the target, days meeting the protein and carb targets, pantry use,
variety, repairs, code fallbacks, tool calls, tokens, cost and latency. Writes a local report
under evals/reports/; also uploads a dataset and an experiment to LangSmith when
LANGSMITH_API_KEY is set.

    uv run python -m evals.run_planner                    # needs DATABASE_URL, OPENAI_API_KEY
    uv run python -m evals.run_planner --only coeliac,bulking
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import statistics
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from pathlib import Path

from evals.metrics import percentile
from evals.plan_profiles import OUT as PROFILES
from evals.plan_profiles import load_profiles
from pantrila import config, db
from pantrila.constraints import Severity, check_plan, hard_violations
from pantrila.planner import MAX_REPAIRS, DbStore, Planner, PlanResult
from pantrila.schema import UserProfile
from pantrila.search import openai_query_embedder

REPORTS = Path(__file__).parent / "reports"


def score(pid: str, profile: UserProfile, r: PlanResult) -> dict:
    t = profile.targets
    violations = check_plan(r.plan, profile, r.recipes)  # independent re-check
    meals = [m.recipe_id for _, m in r.plan.meals]
    first = r.first_draft_violations
    return {
        "profile_id": pid,
        "ok": True,
        "hard_violations": len(hard_violations(violations)),
        "first_draft_hard": len(hard_violations(first)),
        "first_draft_soft": sum(v.severity is Severity.SOFT for v in first),
        "soft_violations": sum(v.severity is Severity.SOFT for v in violations),
        "violation_rules": dict(Counter(v.rule for v in violations)),
        "first_draft_rules": dict(Counter(v.rule for v in first)),
        "kcal_error": statistics.fmean(abs(n.kcal - t.kcal) / t.kcal for n in r.nutrition)
        if t.kcal
        else None,
        "protein_days_met": statistics.fmean(n.protein_g >= t.min_protein_g for n in r.nutrition)
        if t.min_protein_g
        else None,
        "carb_days_met": statistics.fmean(n.carbs_g <= t.max_carbs_g for n in r.nutrition)
        if t.max_carbs_g
        else None,
        "pantry_use": r.pantry_use,
        "variety": len(set(meals)) / len(meals),
        "repairs": r.repairs,
        "fallbacks": r.fallbacks,
        "llm_calls": r.usage.llm_calls,
        "tool_calls": r.usage.tool_calls,
        "input_tokens": r.usage.input_tokens,
        "output_tokens": r.usage.output_tokens,
        "cost_usd": r.usage.cost(),
        "latency_ms": r.latency_ms,
        "plan": r.plan.model_dump(mode="json"),
        "warnings": [str(v) for v in r.warnings],
    }


def run_one(pid: str, profile: UserProfile, model: str, effort: str) -> dict:
    with db.connect(config.database_url()) as conn:
        store = DbStore(conn, openai_query_embedder(config.embed_model()))
        try:
            result = Planner(store, model=model, effort=effort, source="eval").plan(profile)
        except Exception as exc:  # a refused or failed plan is a result, not a crash
            return {"profile_id": pid, "ok": False, "error": f"{type(exc).__name__}: {exc}"}
    row = score(pid, profile, result)
    print(f"{pid}: {row['soft_violations']} warnings, {row['repairs']} repairs, "
          f"{row['latency_ms'] / 1000:.1f}s", flush=True)  # fmt: skip
    return row


def mean(rows: list[dict], key: str) -> float | None:
    values = [r[key] for r in rows if r.get(key) is not None]
    return statistics.fmean(values) if values else None


def summarise(rows: list[dict]) -> dict:
    ok = [r for r in rows if r["ok"]]
    costs = [r["cost_usd"] for r in ok]
    latencies = [r["latency_ms"] for r in ok]
    return {
        "plans": len(rows),
        "failed": len(rows) - len(ok),
        "hard_violations": sum(r["hard_violations"] for r in ok),
        "plans_with_first_draft_hard": sum(r["first_draft_hard"] > 0 for r in ok),
        "plans_with_first_draft_soft": sum(r["first_draft_soft"] > 0 for r in ok),
        "plans_clean": sum(r["soft_violations"] == 0 for r in ok),
        **{
            k: mean(ok, k)
            for k in (
                "soft_violations",
                "kcal_error",
                "protein_days_met",
                "carb_days_met",
                "pantry_use",
                "variety",
                "repairs",
                "fallbacks",
                "llm_calls",
                "tool_calls",
                "input_tokens",
                "output_tokens",
            )
        },  # fmt: skip
        "cost_per_plan_usd": None if None in costs or not costs else statistics.fmean(costs),
        "latency_p50_ms": percentile(latencies, 50),
        "latency_p95_ms": percentile(latencies, 95),
    }


def markdown(s: dict, rows: list[dict], meta: dict) -> str:
    def pct(v):
        return "n/a" if v is None else f"{v:.0%}"

    def num(v, fmt=".2f"):
        return "n/a" if v is None else format(v, fmt)

    cost = "n/a (set PANTRILA_PRICE_*_PER_MTOK)" if s["cost_per_plan_usd"] is None else (
        f"${s['cost_per_plan_usd']:.4f}"
    )  # fmt: skip
    lines = [
        f"# Meal-planning eval {meta['finished_at']}",
        "",
        f"{meta['plans']} profiles, model `{meta['model']}` (reasoning {meta['effort']}), "
        f"up to {MAX_REPAIRS} repairs, {meta['concurrency']} plans in parallel.",
        "",
        "| Metric | Value |",
        "|---|---|",
        f"| Plans returned | {s['plans'] - s['failed']} of {s['plans']} |",
        f"| Hard constraint violations in returned plans | {s['hard_violations']} |",
        f"| First drafts with a hard violation | {s['plans_with_first_draft_hard']} |",
        f"| First drafts missing a target | {s['plans_with_first_draft_soft']} |",
        f"| Plans meeting every target | {s['plans_clean']} |",
        f"| Mean daily kcal error | {pct(s['kcal_error'])} |",
        f"| Days meeting protein minimum | {pct(s['protein_days_met'])} |",
        f"| Days under carb limit | {pct(s['carb_days_met'])} |",
        f"| Pantry foods used | {pct(s['pantry_use'])} |",
        f"| Distinct recipes / meals | {pct(s['variety'])} |",
        f"| Repairs per plan | {num(s['repairs'])} |",
        f"| Meals replaced by code fallback | {num(s['fallbacks'])} |",
        f"| LLM calls / tool calls per plan | {num(s['llm_calls'], '.1f')} / "
        f"{num(s['tool_calls'], '.1f')} |",
        f"| Tokens per plan (in / out) | {num(s['input_tokens'], ',.0f')} / "
        f"{num(s['output_tokens'], ',.0f')} |",
        f"| Cost per plan | {cost} |",
        f"| Latency p50 / p95 | {s['latency_p50_ms'] / 1000:.1f}s / "
        f"{s['latency_p95_ms'] / 1000:.1f}s |",
        "",
        "| Profile | First draft | Repairs | Left | kcal err | Protein days | Pantry | s |",
        "|---|---|---|---|---|---|---|---|",
    ]
    for r in rows:
        if not r["ok"]:
            lines.append(f"| {r['profile_id']} | failed: {r['error']} | | | | | | |")
            continue
        first = ", ".join(f"{k} {v}" for k, v in sorted(r["first_draft_rules"].items())) or "-"
        left = ", ".join(f"{k} {v}" for k, v in sorted(r["violation_rules"].items())) or "-"
        lines.append(
            f"| {r['profile_id']} | {first} | {r['repairs']} | {left} | {pct(r['kcal_error'])} "
            f"| {pct(r['protein_days_met'])} | {pct(r['pantry_use'])} "
            f"| {r['latency_ms'] / 1000:.0f} |"
        )
    return "\n".join(lines) + "\n"


METRIC_KEYS = [
    "hard_violations", "soft_violations", "kcal_error", "protein_days_met", "pantry_use",
    "variety", "repairs", "cost_usd", "latency_ms",
]  # fmt: skip


def upload_to_langsmith(rows: list[dict], meta: dict) -> None:
    from langsmith import Client, evaluate

    client = Client()
    digest = hashlib.sha256(PROFILES.read_bytes()).hexdigest()[:8]
    name = f"pantrila-plan-profiles-{digest}"
    if not client.has_dataset(dataset_name=name):
        ds = client.create_dataset(name, description="Pantrila meal-planning eval profiles")
        client.create_examples(
            dataset_id=ds.id,
            examples=[
                {"inputs": {"profile_id": p["id"], "profile": p["profile"]}}
                for p in json.loads(PROFILES.read_text())
            ],
        )
    by_id = {r["profile_id"]: r for r in rows}
    # Only the profiles this run planned (all of them unless --only), so partial runs
    # don't leave empty rows in the experiment.
    examples = [
        e for e in client.list_examples(dataset_name=name) if e.inputs["profile_id"] in by_id
    ]

    def target(inputs: dict) -> dict:
        return by_id[inputs["profile_id"]]

    def metric(key: str):
        def evaluator(outputs: dict) -> dict:
            value = outputs.get(key)
            return {"key": key, "score": None if value is None else float(value)}

        evaluator.__name__ = key
        return evaluator

    evaluate(
        target,
        data=examples,
        evaluators=[metric(k) for k in METRIC_KEYS],
        experiment_prefix=f"planner-{meta['model']}",
        metadata=meta,
        client=client,
    )
    print(f"uploaded dataset {name} and one {len(examples)}-plan experiment to LangSmith")


def main() -> None:
    parser = argparse.ArgumentParser(description="Pantrila meal-planning eval")
    parser.add_argument("--only", help="comma-separated profile ids")
    parser.add_argument("--effort", default="low", choices=["minimal", "low", "medium", "high"])
    parser.add_argument("--concurrency", type=int, default=4)
    args = parser.parse_args()

    profiles = load_profiles()
    if args.only:
        wanted = set(args.only.split(","))
        profiles = [(pid, p) for pid, p in profiles if pid in wanted]
    model = config.model()
    with ThreadPoolExecutor(args.concurrency) as pool:
        rows = list(pool.map(lambda pp: run_one(*pp, model, args.effort), profiles))

    summary = summarise(rows)
    meta = {
        "finished_at": datetime.now(UTC).strftime("%Y-%m-%dT%H%M%SZ"),
        "plans": len(rows),
        "model": model,
        "effort": args.effort,
        "embed_model": config.embed_model(),
        "concurrency": args.concurrency,
    }
    report = markdown(summary, rows, meta)
    print(report)

    REPORTS.mkdir(exist_ok=True)
    stem = REPORTS / f"planner-{meta['finished_at']}"
    stem.with_suffix(".md").write_text(report)
    stem.with_suffix(".json").write_text(
        json.dumps({"meta": meta, "summary": summary, "results": rows}, indent=2) + "\n"
    )
    print(f"wrote {stem.with_suffix('.md').relative_to(Path.cwd())}")

    if os.environ.get("LANGSMITH_API_KEY"):
        upload_to_langsmith(rows, meta)

    if summary["hard_violations"]:
        raise SystemExit("hard constraint violations in returned plans")


if __name__ == "__main__":
    main()
