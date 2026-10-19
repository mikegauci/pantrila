"""Retrieval eval: vector-only vs full-text-only vs hybrid on the labelled queries.

Reports normalized recall@5/@10, MRR, filter violations (must be 0), latency p50/p95 and
query embedding cost per mode. Always writes a local report under evals/reports/; also uploads the
dataset and one LangSmith experiment per mode when LANGSMITH_API_KEY is set.

    uv run python -m evals.run_retrieval                  # needs DATABASE_URL, OPENAI_API_KEY
    uv run python -m evals.run_retrieval --modes fulltext # free: no embeddings
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import statistics
import time
from collections import defaultdict
from datetime import UTC, datetime
from pathlib import Path

from evals.metrics import normalized_recall_at_k, percentile, reciprocal_rank
from pantrio import config, db
from pantrio.corpus import load_corpus
from pantrio.search import Mode, SearchFilters, openai_query_embedder, search

QUERIES = Path(__file__).parent / "data" / "retrieval_queries.json"
REPORTS = Path(__file__).parent / "reports"
LIMIT = 10


def run_mode(conn, queries: list[dict], mode: Mode, recipes: dict, embed_query) -> list[dict]:
    rows = []
    for q in queries:
        filters = SearchFilters.model_validate(q["filters"])
        start = time.perf_counter()
        result = search(conn, q["query"], filters, mode=mode, limit=LIMIT, embed_query=embed_query)
        latency_ms = (time.perf_counter() - start) * 1000
        relevant = set(q["relevant_ids"])
        violations = {rid: v for rid in result.ids if (v := filters.violations(recipes[rid]))}
        rows.append(
            {
                "query_id": q["id"],
                "kind": q["kind"],
                "ranked": result.ids,
                "normalized_recall@5": normalized_recall_at_k(result.ids, relevant, 5),
                "normalized_recall@10": normalized_recall_at_k(result.ids, relevant, 10),
                "rr": reciprocal_rank(result.ids, relevant),
                "violations": violations,
                "latency_ms": latency_ms,
                "embed_tokens": result.embed_tokens,
            }
        )
    return rows


def summarise(rows: list[dict]) -> dict:
    latencies = [r["latency_ms"] for r in rows]
    tokens = sum(r["embed_tokens"] for r in rows)
    cost = config.prices().embed_cost(tokens)
    return {
        "queries": len(rows),
        "normalized_recall@5": statistics.fmean(r["normalized_recall@5"] for r in rows),
        "normalized_recall@10": statistics.fmean(r["normalized_recall@10"] for r in rows),
        "mrr": statistics.fmean(r["rr"] for r in rows),
        "filter_violations": sum(len(r["violations"]) for r in rows),
        "latency_p50_ms": percentile(latencies, 50),
        "latency_p95_ms": percentile(latencies, 95),
        "embed_tokens": tokens,
        "cost_usd": cost,
        "cost_per_query_usd": None if cost is None else cost / len(rows),
    }


def by_kind(rows: list[dict]) -> dict[str, float]:
    groups: dict[str, list[float]] = defaultdict(list)
    for r in rows:
        groups[r["kind"]].append(r["normalized_recall@10"])
    return {k: statistics.fmean(v) for k, v in sorted(groups.items())}


def markdown(summary: dict[str, dict], kinds: dict[str, dict], meta: dict) -> str:
    def cost(v):
        return "n/a" if v is None else f"${v:.6f}"

    lines = [
        f"# Retrieval eval {meta['finished_at']}",
        "",
        f"{meta['queries']} queries, {meta['recipes']} recipes, embeddings `{meta['embed_model']}`,"
        f" top {LIMIT}, RRF k=60. Normalized recall@k: hits / min(k, relevant).",
        "",
        "| Mode | Normalized recall@5 | Normalized recall@10 | MRR | Filter violations"
        " | p50 ms | p95 ms"
        " | Cost / query |",
        "|---|---|---|---|---|---|---|---|",
    ]
    for mode, s in summary.items():
        lines.append(
            f"| {mode} | {s['normalized_recall@5']:.3f} | "
            f"{s['normalized_recall@10']:.3f} | {s['mrr']:.3f} | "
            f"{s['filter_violations']} | {s['latency_p50_ms']:.0f} | {s['latency_p95_ms']:.0f} | "
            f"{cost(s['cost_per_query_usd'])} |"
        )
    kind_names = sorted({k for v in kinds.values() for k in v})
    lines += [
        "",
        "Normalized recall@10 by query kind:",
        "",
        "| Mode | " + " | ".join(kind_names) + " |",
    ]
    lines.append("|---" * (len(kind_names) + 1) + "|")
    for mode, v in kinds.items():
        lines.append(f"| {mode} | " + " | ".join(f"{v[k]:.3f}" for k in kind_names) + " |")
    return "\n".join(lines) + "\n"


def upload_to_langsmith(queries: list[dict], results: dict[str, list[dict]], meta: dict) -> None:
    from langsmith import Client, evaluate

    client = Client()
    digest = hashlib.sha256(QUERIES.read_bytes()).hexdigest()[:8]
    name = f"pantrio-retrieval-{digest}"
    if not client.has_dataset(dataset_name=name):
        ds = client.create_dataset(name, description="Pantrio labelled recipe retrieval queries")
        client.create_examples(
            dataset_id=ds.id,
            examples=[
                {
                    "inputs": {"query_id": q["id"], "query": q["query"], "filters": q["filters"]},
                    "outputs": {"relevant_ids": q["relevant_ids"]},
                    "metadata": {"kind": q["kind"]},
                }
                for q in queries
            ],
        )

    def metric(key: str):
        def evaluator(outputs: dict, reference_outputs: dict) -> dict:
            return {"key": key, "score": outputs[key]}

        evaluator.__name__ = key.replace("@", "_at_")
        return evaluator

    keys = ["normalized_recall@5", "normalized_recall@10", "rr", "filter_violations", "latency_ms"]
    for mode, rows in results.items():
        by_id = {r["query_id"]: r for r in rows}

        def target(inputs: dict, by_id=by_id) -> dict:
            r = by_id[inputs["query_id"]]
            return {
                "ranked": r["ranked"],
                "normalized_recall@5": r["normalized_recall@5"],
                "normalized_recall@10": r["normalized_recall@10"],
                "rr": r["rr"],
                "filter_violations": len(r["violations"]),
                "latency_ms": r["latency_ms"],
            }

        evaluate(
            target,
            data=name,
            evaluators=[metric(k) for k in keys],
            experiment_prefix=f"retrieval-{mode}",
            metadata={**meta, "mode": mode},
            client=client,
        )
    print(f"uploaded dataset {name} and {len(results)} experiments to LangSmith")


def main() -> None:
    parser = argparse.ArgumentParser(description="Pantrio retrieval eval")
    parser.add_argument("--modes", default="vector,fulltext,hybrid")
    args = parser.parse_args()
    modes = [Mode(m) for m in args.modes.split(",")]

    queries = json.loads(QUERIES.read_text())
    recipes = {r.id: r for r in load_corpus()}
    model = config.embed_model()
    embed_query = openai_query_embedder(model) if any(m != Mode.FULLTEXT for m in modes) else None

    results: dict[str, list[dict]] = {}
    with db.connect(config.database_url()) as conn:
        for mode in modes:
            results[mode.value] = run_mode(conn, queries, mode, recipes, embed_query)

    summary = {mode: summarise(rows) for mode, rows in results.items()}
    kinds = {mode: by_kind(rows) for mode, rows in results.items()}
    meta = {
        "finished_at": datetime.now(UTC).strftime("%Y-%m-%dT%H%M%SZ"),
        "queries": len(queries),
        "recipes": len(recipes),
        "embed_model": model,
        "limit": LIMIT,
    }
    report = markdown(summary, kinds, meta)
    print(report)

    REPORTS.mkdir(exist_ok=True)
    stem = REPORTS / f"retrieval-{meta['finished_at']}"
    stem.with_suffix(".md").write_text(report)
    stem.with_suffix(".json").write_text(
        json.dumps({"meta": meta, "summary": summary, "by_kind": kinds, "results": results},
                   indent=2) + "\n"
    )  # fmt: skip
    print(f"wrote {stem.with_suffix('.md').relative_to(Path.cwd())}")

    if os.environ.get("LANGSMITH_API_KEY"):
        upload_to_langsmith(queries, results, meta)

    if any(s["filter_violations"] for s in summary.values()):
        raise SystemExit("filter violations found")


if __name__ == "__main__":
    main()
