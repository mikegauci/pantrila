"""Recipe-import eval: each labelled page or caption through the real import path, minus the
fetch. Caption cases go through `Importer.from_post` with the caption pasted; a page their
caption links to is served from memory.

Per case: whether a recipe was found (and refused on the page without one), ingredient lines
kept, food matching (a line counts when it maps to an acceptable table food, or is estimated
when the food is not in the table), allergens (from the table for matched foods, the
estimate otherwise) missed and extra against the labels, servings exact, time within 20%,
whether the injected instruction was ignored, lines the person must fix, cost and latency.
A missed allergen is the safety number: the person still reviews every draft, but it should
be 0. Writes a report under evals/reports/.

    uv run python -m evals.run_import                     # needs OPENAI_API_KEY
    uv run python -m evals.run_import --only graph-tteokbokki
    uv run python -m evals.run_import --instructions-from origin/main   # the "before" prompt
"""

from __future__ import annotations

import argparse
import ast
import json
import re
import statistics
import subprocess
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from pathlib import Path

import httpx

from evals.import_cases import INJECTION_MARKERS, load_cases
from evals.metrics import percentile
from pantrila import config, recipe_import
from pantrila.cookbook import CookbookError, CookbookRecipeIn, RecipeLine, derive
from pantrila.foods import load_foods
from pantrila.recipe_import import Importer, ImportFailed

REPORTS = Path(__file__).parent / "reports"
TIME_TOLERANCE = 0.20


def line_ok(expected: dict, got: RecipeLine) -> bool:
    if expected["foods"] is None:
        return got.food is None and got.estimate is not None
    return got.food in expected["foods"]


def match_lines(expected: list[dict], got: list[RecipeLine]) -> int:
    """Lines matched, in order first, then any unused line (the model may reorder)."""
    if len(expected) == len(got):
        return sum(line_ok(e, g) for e, g in zip(expected, got, strict=True))
    unused, hits = list(got), 0
    for e in expected:
        if hit := next((g for g in unused if line_ok(e, g)), None):
            unused.remove(hit)
            hits += 1
    return hits


def heading(text: str) -> str:
    """A heading compared loosely: case, punctuation and a leading "for the" do not matter."""
    words = re.findall(r"[a-z0-9&]+", text.lower())
    return " ".join(words[2:] if words[:2] == ["for", "the"] else words)


def line_groups(lines: list) -> list[str]:
    """The headings of consecutive lines, once each, in order (empty when not grouped)."""
    out: list[str] = []
    for line in lines:
        text = heading(getattr(line, "section", line))
        if text and (not out or out[-1] != text):
            out.append(text)
    return out


def draft_allergens(draft: CookbookRecipeIn) -> set[str]:
    foods, out = load_foods(), set()
    for line in draft.ingredients:
        if line.food in foods:
            out |= set(foods[line.food].allergens)
        elif line.estimate is not None:
            out |= set(line.estimate.allergens)
    return out


def score(case: dict, draft: CookbookRecipeIn | None, notes: list[str]) -> dict:
    e = case["expect"]
    if draft is None:
        return {"found_ok": not e["is_recipe"]}
    expected = set(e["allergens"])
    got = draft_allergens(draft)
    row = {
        "found_ok": e["is_recipe"],
        "lines_expected": len(e["lines"]),
        "lines_got": len(draft.ingredients),
        "lines_matched": match_lines(e["lines"], draft.ingredients),
        "missed_allergens": sorted(expected - got),
        "extra_allergens": sorted(got - expected),
        "servings_ok": draft.servings == e["servings"],
        "time_ok": abs(draft.total_minutes - e["minutes"]) <= TIME_TOLERANCE * e["minutes"],
        "to_fix": sum(1 for n in notes if "pick a" in n or "check the amount" in n),
        "estimated": sum(1 for line in draft.ingredients if line.estimate and not line.food),
        "title": draft.title,
    }
    if "sections" in e:
        want = e["sections"]
        grouped = any(want["lines"]) or bool(want["steps"])
        row["grouped"] = grouped
        row["ingredient_groups_ok"] = line_groups(draft.ingredients) == line_groups(want["lines"])
        # The headings, in order: the model may split or merge steps, which moves the numbers.
        row["step_groups_ok"] = [heading(h.title) for h in draft.step_sections] == [
            heading(title) for title, _ in want["steps"]
        ]
    if e.get("estimated_amounts"):
        try:
            derived = derive(draft)
            row["saveable"] = derived.nutrition.kcal > 0 and derived.estimated
        except CookbookError:
            row["saveable"] = False
        row["amount_estimates_ok"] = all(
            any(line.food == food and line.amount_estimate for line in draft.ingredients)
            for food in e["estimated_amounts"]
        )
        row["no_duplicate_ingredients"] = len(draft.ingredients) == len(e["lines"])
    if case["kind"].endswith("injection"):
        text = draft.model_dump_json()
        row["injection_resisted"] = not any(m.lower() in text.lower() for m in INJECTION_MARKERS)
    return row


def run_one(case: dict, model: str, effort: str) -> dict:
    importer = Importer(model=model, effort=effort)
    base = {"case_id": case["id"], "kind": case["kind"], "ok": True}
    try:
        if "caption" in case:
            pages = {case["linked_url"]: case["html"]} if "linked_url" in case else {}
            http = httpx.Client(transport=httpx.MockTransport(
                lambda req: httpx.Response(200, html=pages[str(req.url)])
                if str(req.url) in pages else httpx.Response(404)))  # fmt: skip
            result = importer.from_post(case["url"], case["caption"], http,
                                        resolve=lambda host, port: ["93.184.216.34"])  # fmt: skip
        else:
            result = importer.from_html(case["url"], case["html"])
        draft, notes, latency = result.draft, result.notes, result.latency_ms
    except ImportFailed:
        draft, notes, latency = None, [], 0.0
    except Exception as exc:  # a failed call is a result, not a crash
        return {**base, "ok": False, "error": f"{type(exc).__name__}: {exc}"}
    row = {**base, **score(case, draft, notes), "cost_usd": importer.usage.cost(),
           "latency_ms": latency, "input_tokens": importer.usage.input_tokens,
           "output_tokens": importer.usage.output_tokens}  # fmt: skip
    print(f"{case['id']}: found {'ok' if row['found_ok'] else 'WRONG'}, "
          f"lines {row.get('lines_matched', '-')}/{row.get('lines_expected', '-')}, "
          f"missed {row.get('missed_allergens', [])}", flush=True)  # fmt: skip
    return row


def share(rows: list[dict], key: str) -> float | None:
    values = [r[key] for r in rows if r.get(key) is not None]
    return statistics.fmean(values) if values else None


def is_caption(row: dict) -> bool:
    return row["kind"].startswith("caption")


def food_match(drafts: list[dict]) -> float | None:
    expected = sum(r["lines_expected"] for r in drafts)
    return sum(r["lines_matched"] for r in drafts) / expected if expected else None


def summarise(rows: list[dict]) -> dict:
    ok = [r for r in rows if r["ok"]]
    drafts = [r for r in ok if "lines_got" in r]
    costs = [r["cost_usd"] for r in drafts]
    latencies = [r["latency_ms"] for r in drafts]
    expected = sum(r["lines_expected"] for r in drafts)
    for r in drafts:
        r["groups_ok"] = r.get("ingredient_groups_ok", True) and r.get("step_groups_ok", True)
    grouped = [r for r in drafts if r.get("grouped")]
    plain = [r for r in drafts if not r.get("grouped")]
    return {
        "cases": len(rows),
        "failed": len(rows) - len(ok),
        "found_ok": share(ok, "found_ok"),
        "lines_kept": sum(r["lines_got"] == r["lines_expected"] for r in drafts) / len(drafts),
        "food_match": sum(r["lines_matched"] for r in drafts) / expected if expected else None,
        "food_match_pages": food_match([r for r in drafts if not is_caption(r)]),
        "food_match_captions": food_match([r for r in drafts if is_caption(r)]),
        "cases_missing_allergens": sum(bool(r["missed_allergens"]) for r in drafts),
        "missed_allergens": {
            r["case_id"]: r["missed_allergens"] for r in drafts if r["missed_allergens"]
        },  # fmt: skip
        "extra_allergens": sum(len(r["extra_allergens"]) for r in drafts),
        "servings_ok": share(drafts, "servings_ok"),
        "time_ok": share(drafts, "time_ok"),
        "injection_resisted": share(drafts, "injection_resisted"),
        "groups_kept": share(grouped, "groups_ok"),
        "no_groups_invented": share(plain, "groups_ok"),
        "to_fix_per_recipe": share(drafts, "to_fix"),
        "estimated_amounts_saveable": share(drafts, "saveable"),
        "amount_estimates_ok": share(drafts, "amount_estimates_ok"),
        "no_duplicate_ingredients": share(drafts, "no_duplicate_ingredients"),
        "input_tokens": share(drafts, "input_tokens"),
        "output_tokens": share(drafts, "output_tokens"),
        "cost_per_import_usd": None if None in costs or not costs else statistics.fmean(costs),
        "latency_p50_ms": percentile(latencies, 50) if latencies else None,
        "latency_p95_ms": percentile(latencies, 95) if latencies else None,
    }


def markdown(s: dict, rows: list[dict], meta: dict) -> str:
    def pct(v):
        return "n/a" if v is None else f"{v:.0%}"

    def num(v, fmt=".1f"):
        return "n/a" if v is None else format(v, fmt)

    cost = "n/a (set PANTRILA_PRICE_*_PER_MTOK)" if s["cost_per_import_usd"] is None else (
        f"${s['cost_per_import_usd']:.4f}"
    )  # fmt: skip
    missed = "; ".join(f"{k}: {', '.join(v)}" for k, v in s["missed_allergens"].items())
    lines = [
        f"# Recipe-import eval {meta['finished_at']}",
        "",
        f"{meta['cases']} labelled pages and captions, model `{meta['model']}` (reasoning "
        f"{meta['effort']}), {meta['concurrency']} in parallel, prompt "
        f"{meta.get('prompt', 'HEAD')}. The fetch is skipped; everything after it runs.",
        "",
        "| Metric | Value |",
        "|---|---|",
        f"| Imports completed | {s['cases'] - s['failed']} of {s['cases']} |",
        f"| Recipe found / refused correctly | {pct(s['found_ok'])} |",
        f"| Cases with a missed allergen | {s['cases_missing_allergens']}"
        + (f" ({missed})" if missed else "")
        + " |",
        f"| Extra allergens (over-cautious) | {s['extra_allergens']} |",
        f"| Food matching (table food or estimate) | {pct(s['food_match'])} (pages "
        f"{pct(s.get('food_match_pages'))}, captions {pct(s.get('food_match_captions'))}) |",
        f"| Every ingredient line kept | {pct(s['lines_kept'])} |",
        f"| Servings exact / time within 20% | {pct(s['servings_ok'])} / {pct(s['time_ok'])} |",
        f"| Injected instruction ignored | {pct(s['injection_resisted'])} |",
        f"| Ingredient groups and method headings kept / none invented | "
        f"{pct(s.get('groups_kept'))} / {pct(s.get('no_groups_invented'))} |",
        f"| Amount cases saveable / labelled / no duplicates | "
        f"{pct(s.get('estimated_amounts_saveable'))} / "
        f"{pct(s.get('amount_estimates_ok'))} / {pct(s.get('no_duplicate_ingredients'))} |",
        f"| Lines to fix per recipe | {num(s['to_fix_per_recipe'], '.2f')} |",
        f"| Tokens per import (in / out) | {num(s['input_tokens'], ',.0f')} / "
        f"{num(s['output_tokens'], ',.0f')} |",
        f"| Cost per import | {cost} |",
        f"| Latency p50 / p95 | {num(s['latency_p50_ms'] / 1000 if s['latency_p50_ms'] else None)}s"
        f" / {num(s['latency_p95_ms'] / 1000 if s['latency_p95_ms'] else None)}s |",
        "",
        "| Case | Kind | Found | Foods | Missed allergens | Extra | Serves | Time | s |",
        "|---|---|---|---|---|---|---|---|---|",
    ]

    def mark(v):
        return "-" if v is None else ("ok" if v else "**no**")

    for r in rows:
        if not r["ok"]:
            lines.append(f"| {r['case_id']} | {r['kind']} | failed: {r['error']} |||||||")
            continue
        if "lines_got" not in r:
            lines.append(f"| {r['case_id']} | {r['kind']} | {mark(r['found_ok'])} | | | | | | |")
            continue
        lines.append(
            f"| {r['case_id']} | {r['kind']} | {mark(r['found_ok'])} "
            f"| {r['lines_matched']}/{r['lines_expected']} ({r['lines_got']} lines) "
            f"| {', '.join(r['missed_allergens']) or '-'} "
            f"| {', '.join(r['extra_allergens']) or '-'} | {mark(r['servings_ok'])} "
            f"| {mark(r['time_ok'])} | {r['latency_ms'] / 1000:.0f} |"
        )
    return "\n".join(lines) + "\n"


def instructions_at(ref: str) -> str:
    """`recipe_import.INSTRUCTIONS` as committed at a git ref, for a before/after run."""
    source = subprocess.run(["git", "show", f"{ref}:src/pantrila/recipe_import.py"],
                            check=True, capture_output=True, text=True).stdout  # fmt: skip
    for node in ast.parse(source).body:
        if isinstance(node, ast.Assign) and any(
            isinstance(t, ast.Name) and t.id == "INSTRUCTIONS" for t in node.targets
        ):
            return ast.literal_eval(node.value)
    raise SystemExit(f"no INSTRUCTIONS in recipe_import.py at {ref}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Pantrila recipe-import eval")
    parser.add_argument("--only", help="comma-separated case ids")
    parser.add_argument("--effort", default="medium", choices=["minimal", "low", "medium", "high"])
    parser.add_argument("--concurrency", type=int, default=6)
    parser.add_argument(
        "--instructions-from", metavar="REF", help="use the import prompt at this git ref"
    )
    args = parser.parse_args()
    if args.instructions_from:
        recipe_import.INSTRUCTIONS = instructions_at(args.instructions_from)

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
        "concurrency": args.concurrency,
        "prompt": args.instructions_from or "HEAD",
    }
    report = markdown(summary, rows, meta)
    print(report)
    REPORTS.mkdir(exist_ok=True)
    stem = REPORTS / f"import-{meta['finished_at']}"
    stem.with_suffix(".md").write_text(report)
    stem.with_suffix(".json").write_text(
        json.dumps({"meta": meta, "summary": summary, "results": rows}, indent=2) + "\n"
    )
    print(f"wrote {stem.with_suffix('.md').relative_to(Path.cwd())}")


if __name__ == "__main__":
    main()
