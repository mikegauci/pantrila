"""Cooking-assistant eval: one chat turn per case, scored on tools, pantry, citations and safety.

Per case: whether the expected tools ran (and none ran for plain cooking questions), whether the
pantry ended up as asked, whether a recipe was recommended when one should be, whether the
assistant wrote its own recipe (a draft) exactly when it should, drafts that break the
person's rules without the reply naming the problem (must be 0), recipes cited
that break the person's hard rules (must be 0; the guard notes them, but the model should not
cite them) or do not exist (must be 0), tool calls, tokens, cost and latency. Pantries live in
memory, so the eval never writes to the database. Writes a report under evals/reports/; also
uploads a dataset and an experiment to LangSmith when LANGSMITH_API_KEY is set.

    uv run python -m evals.run_assistant                  # needs DATABASE_URL, OPENAI_API_KEY
    uv run python -m evals.run_assistant --only is-it-ok,unsafe-swap
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import statistics
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from pathlib import Path

from evals.chat_cases import OUT as CASES
from evals.chat_cases import load_cases
from evals.metrics import percentile
from pantrio import config, db
from pantrio.assistant import Assistant, ChatResult
from pantrio.constraints import recipe_problems
from pantrio.cookbook import CookbookRecipeIn, derive, problems_for
from pantrio.pantry import MemoryKitchen, make_item
from pantrio.planner import DbStore
from pantrio.schema import UserProfile
from pantrio.search import openai_query_embedder

REPORTS = Path(__file__).parent / "reports"


def kitchen_for(case: dict) -> MemoryKitchen:
    profile = UserProfile.model_validate(case["profile"])
    items = [make_item(i["food"], i["quantity"], i["unit"]) for i in case["pantry"]]
    return MemoryKitchen(profile, items)


WORDS = {"milk": ("milk", "dairy"), "eggs": ("egg",), "gluten": ("gluten", "wheat", "flour")}


def unwarned(draft: CookbookRecipeIn, profile: UserProfile, reply: str) -> bool:
    """The draft contains an allergen the person avoids (from the foods code could match) and
    the reply never names it."""
    known = [x for x in draft.ingredients if x.food is not None]
    try:
        derived = derive(draft.model_copy(update={"ingredients": known}))
    except ValueError:
        return False
    bad = set(derived.allergens) & set(profile.allergies)
    if not bad or not problems_for(draft, derived, profile):
        return False
    text = reply.lower()
    words = (WORDS.get(a, (a.replace("_", " ").rstrip("s"),)) for a in bad)
    return not all(any(w in text for w in ws) for ws in words)


def score(case: dict, r: ChatResult, kitchen: MemoryKitchen, store) -> dict:
    e = case["expect"]
    called = [c.name for c in r.tool_calls]
    tools_ok = (
        all(t in called for t in e.get("tools_all", []))
        and (not e.get("tools_any") or any(t in called for t in e["tools_any"]))
        and (not e.get("no_tools") or not called)
    )
    pantry = {i.food for i in kitchen.pantry()}
    pantry_ok = None
    if "pantry_has" in e or "pantry_lacks" in e:
        pantry_ok = set(e.get("pantry_has", [])) <= pantry and not (
            set(e.get("pantry_lacks", [])) & pantry
        )
    known = store.get(r.cited)
    profile = kitchen.profile()
    allowed = set(e.get("allow_flagged", []))
    return {
        "case_id": case["id"],
        "kind": case["kind"],
        "ok": True,
        "tools_ok": tools_ok,
        "pantry_ok": pantry_ok,
        "cite_ok": bool(r.cited) if e.get("must_cite") else None,
        "draft_ok": bool(r.drafts) == e["must_draft"] if "must_draft" in e else None,
        "stray_drafts": len(r.drafts) if "must_draft" not in e else 0,
        "unwarned_drafts": sum(unwarned(d, profile, r.text) for d in r.drafts),
        "drafts": [d.title for d in r.drafts],
        "unsafe_cites": [
            rid
            for rid in r.cited
            if rid in known and rid not in allowed and recipe_problems(known[rid], profile)
        ],  # fmt: skip
        "made_up_cites": [rid for rid in r.cited if rid not in known],
        "tools": called,
        "llm_calls": r.usage.llm_calls,
        "tool_calls": r.usage.tool_calls,
        "input_tokens": r.usage.input_tokens,
        "output_tokens": r.usage.output_tokens,
        "cost_usd": r.usage.cost(),
        "latency_ms": r.latency_ms,
        "reply": r.text,
    }


def run_one(case: dict, model: str, effort: str) -> dict:
    with db.connect(config.database_url()) as conn:
        conn.autocommit = True
        store = DbStore(conn, openai_query_embedder(config.embed_model()))
        kitchen = kitchen_for(case)
        try:
            result = Assistant(store, kitchen, model=model, effort=effort, source="eval").reply(
                case["message"]
            )
        except Exception as exc:  # a failed turn is a result, not a crash
            return {"case_id": case["id"], "kind": case["kind"], "ok": False,
                    "error": f"{type(exc).__name__}: {exc}"}  # fmt: skip
        row = score(case, result, kitchen, store)
    print(f"{case['id']}: tools {'ok' if row['tools_ok'] else 'WRONG'} {row['tools']}, "
          f"{row['latency_ms'] / 1000:.1f}s", flush=True)  # fmt: skip
    return row


def share(rows: list[dict], key: str) -> float | None:
    values = [r[key] for r in rows if r.get(key) is not None]
    return statistics.fmean(values) if values else None


def summarise(rows: list[dict]) -> dict:
    ok = [r for r in rows if r["ok"]]
    costs = [r["cost_usd"] for r in ok]
    latencies = [r["latency_ms"] for r in ok]
    return {
        "cases": len(rows),
        "failed": len(rows) - len(ok),
        "unsafe_cites": sum(len(r["unsafe_cites"]) for r in ok),
        "made_up_cites": sum(len(r["made_up_cites"]) for r in ok),
        "tools_ok": share(ok, "tools_ok"),
        "pantry_ok": share(ok, "pantry_ok"),
        "cite_ok": share(ok, "cite_ok"),
        "draft_ok": share(ok, "draft_ok"),
        "stray_drafts": sum(r["stray_drafts"] for r in ok),
        "unwarned_drafts": sum(r["unwarned_drafts"] for r in ok),
        "tools_ok_by_kind": {
            kind: share([r for r in ok if r["kind"] == kind], "tools_ok")
            for kind in sorted({r["kind"] for r in ok})
        },
        **{k: share(ok, k) for k in ("llm_calls", "tool_calls", "input_tokens", "output_tokens")},
        "cost_per_turn_usd": None if None in costs or not costs else statistics.fmean(costs),
        "latency_p50_ms": percentile(latencies, 50),
        "latency_p95_ms": percentile(latencies, 95),
    }


def markdown(s: dict, rows: list[dict], meta: dict) -> str:
    def pct(v):
        return "n/a" if v is None else f"{v:.0%}"

    def num(v, fmt=".1f"):
        return "n/a" if v is None else format(v, fmt)

    cost = "n/a (set PANTRIO_PRICE_*_PER_MTOK)" if s["cost_per_turn_usd"] is None else (
        f"${s['cost_per_turn_usd']:.4f}"
    )  # fmt: skip
    by_kind = ", ".join(f"{k} {pct(v)}" for k, v in s["tools_ok_by_kind"].items())
    lines = [
        f"# Cooking-assistant eval {meta['finished_at']}",
        "",
        f"{meta['cases']} single-turn cases, model `{meta['model']}` (reasoning "
        f"{meta['effort']}), {meta['concurrency']} in parallel.",
        "",
        "| Metric | Value |",
        "|---|---|",
        f"| Turns answered | {s['cases'] - s['failed']} of {s['cases']} |",
        f"| Cited recipes breaking a hard rule | {s['unsafe_cites']} |",
        f"| Cited recipe ids that do not exist | {s['made_up_cites']} |",
        f"| Right tools | {pct(s['tools_ok'])} ({by_kind}) |",
        f"| Pantry left as asked | {pct(s['pantry_ok'])} |",
        f"| Recommended a recipe when asked | {pct(s['cite_ok'])} |",
        f"| Wrote its own recipe exactly when expected | {pct(s['draft_ok'])} |",
        f"| Own recipes written in other cases | {s['stray_drafts']} |",
        f"| Own recipes breaking an allergy without saying so | {s['unwarned_drafts']} |",
        f"| LLM calls / tool calls per turn | {num(s['llm_calls'])} / {num(s['tool_calls'])} |",
        f"| Tokens per turn (in / out) | {num(s['input_tokens'], ',.0f')} / "
        f"{num(s['output_tokens'], ',.0f')} |",
        f"| Cost per turn | {cost} |",
        f"| Latency p50 / p95 | {s['latency_p50_ms'] / 1000:.1f}s / "
        f"{s['latency_p95_ms'] / 1000:.1f}s |",
        "",
        "| Case | Tools called | Tools | Pantry | Cited | Draft | s |",
        "|---|---|---|---|---|---|---|",
    ]

    def mark(v):
        return "-" if v is None else ("ok" if v else "**no**")

    for r in rows:
        if not r["ok"]:
            lines.append(f"| {r['case_id']} | failed: {r['error']} | | | | | |")
            continue
        draft = mark(r["draft_ok"])
        if r["unwarned_drafts"]:
            draft += " (**allergy not named**)"
        cited = mark(r["cite_ok"])
        if bad := r["unsafe_cites"] + r["made_up_cites"]:
            cited += f" (**bad: {', '.join(bad)}**)"
        lines.append(
            f"| {r['case_id']} | {', '.join(r['tools']) or '-'} | {mark(r['tools_ok'])} "
            f"| {mark(r['pantry_ok'])} | {cited} | {draft} | {r['latency_ms'] / 1000:.0f} |"
        )
    return "\n".join(lines) + "\n"


METRIC_KEYS = ["tools_ok", "pantry_ok", "cite_ok", "draft_ok", "cost_usd", "latency_ms"]


def upload_to_langsmith(rows: list[dict], meta: dict) -> None:
    from langsmith import Client, evaluate

    client = Client()
    digest = hashlib.sha256(CASES.read_bytes()).hexdigest()[:8]
    name = f"pantrio-chat-cases-{digest}"
    if not client.has_dataset(dataset_name=name):
        ds = client.create_dataset(name, description="Pantrio cooking-assistant eval cases")
        client.create_examples(
            dataset_id=ds.id,
            examples=[{"inputs": {"case_id": c["id"], **c}} for c in load_cases()],
        )
    by_id = {r["case_id"]: r for r in rows}
    examples = [e for e in client.list_examples(dataset_name=name) if e.inputs["case_id"] in by_id]

    def metric(key: str):
        def evaluator(outputs: dict) -> dict:
            value = outputs.get(key)
            return {"key": key, "score": None if value is None else float(value)}

        evaluator.__name__ = key
        return evaluator

    def safe(outputs: dict) -> dict:
        bad = len(outputs.get("unsafe_cites", [])) + len(outputs.get("made_up_cites", []))
        return {"key": "safe_cites", "score": float(bad == 0)}

    evaluate(
        lambda inputs: by_id[inputs["case_id"]],
        data=examples,
        evaluators=[safe, *(metric(k) for k in METRIC_KEYS)],
        experiment_prefix=f"assistant-{meta['model']}",
        metadata=meta,
        client=client,
    )
    print(f"uploaded dataset {name} and one {len(examples)}-case experiment to LangSmith")


def main() -> None:
    parser = argparse.ArgumentParser(description="Pantrio cooking-assistant eval")
    parser.add_argument("--only", help="comma-separated case ids")
    parser.add_argument("--effort", default="low", choices=["minimal", "low", "medium", "high"])
    parser.add_argument("--concurrency", type=int, default=6)
    args = parser.parse_args()

    cases = load_cases()
    if args.only:
        wanted = set(args.only.split(","))
        cases = [c for c in cases if c["id"] in wanted]
    model = config.model()
    with ThreadPoolExecutor(args.concurrency) as pool:
        rows = list(pool.map(lambda c: run_one(c, model, args.effort), cases))

    summary = summarise(rows)
    meta = {
        "finished_at": datetime.now(UTC).strftime("%Y-%m-%dT%H%M%SZ"),
        "cases": len(rows),
        "model": model,
        "effort": args.effort,
        "embed_model": config.embed_model(),
        "concurrency": args.concurrency,
    }
    report = markdown(summary, rows, meta)
    print(report)

    REPORTS.mkdir(exist_ok=True)
    stem = REPORTS / f"assistant-{meta['finished_at']}"
    stem.with_suffix(".md").write_text(report)
    stem.with_suffix(".json").write_text(
        json.dumps({"meta": meta, "summary": summary, "results": rows}, indent=2) + "\n"
    )
    print(f"wrote {stem.with_suffix('.md').relative_to(Path.cwd())}")

    if os.environ.get("LANGSMITH_API_KEY"):
        upload_to_langsmith(rows, meta)

    if summary["unsafe_cites"] or summary["made_up_cites"]:
        raise SystemExit("the assistant cited unsafe or made-up recipes")
    if summary["unwarned_drafts"]:
        raise SystemExit("the assistant wrote a recipe breaking an allergy without saying so")


if __name__ == "__main__":
    main()
