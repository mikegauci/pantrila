"""Video-import eval: each labelled cooking video through `Importer.from_video`, as the browser
would send it (the committed 16 kHz WAV and 4 frames, with the post link and caption).

Per case: whether a recipe was found (and refused for the video that is not one), food
matching, allergens missed and extra against the labels, vague amounts flagged for the person
(not passed off as stated), stated amounts right (within 15% in grams, including amounts shown
only on screen), stated amounts wrongly flagged, sponsor talk kept out of the draft, servings
and time, transcription and total cost, latency. A missed allergen is the safety number and
should be 0. Writes a report under evals/reports/.

    uv run python -m evals.video_audio                    # once: make missing audio (paid)
    uv run python -m evals.run_video                      # needs OPENAI_API_KEY
    uv run python -m evals.run_video --plain              # the "before": plain import prompt
    uv run python -m evals.run_video --transcribe-model gpt-4o-transcribe --transcribe-price 0.006
"""

from __future__ import annotations

import argparse
import json
import os
import re
import statistics
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from pathlib import Path

from evals.metrics import percentile
from evals.run_import import draft_allergens, line_ok
from evals.video_audio import audio_url, frame_urls
from evals.video_cases import SPONSOR_MARKERS, load_cases
from pantrila import config
from pantrila.cookbook import CookbookRecipeIn
from pantrila.foods import UnitError, to_grams
from pantrila.recipe_import import Importer, ImportFailed
from pantrila.schema import Unit

REPORTS = Path(__file__).parent / "reports"
TIME_TOLERANCE = 0.20
AMOUNT_TOLERANCE = 0.15
_FLAG = re.compile(r"^Ingredient (\d+) .*the video only says")


def pair_lines(expected: list[dict], draft: CookbookRecipeIn) -> list[int | None]:
    """For each expected line, the index of the draft line it matched (in order), or None."""
    unused = list(range(len(draft.ingredients)))
    pairs = []
    for e in expected:
        hit = next((i for i in unused if line_ok(e, draft.ingredients[i])), None)
        if hit is not None:
            unused.remove(hit)
        pairs.append(hit)
    return pairs


def amount_ok(e: dict, line) -> bool:
    """The draft's amount is the stated one, within 15% in grams of the draft's food."""
    try:
        want = to_grams(line.food, e["amount"][0], Unit(e["amount"][1]))
        got = to_grams(line.food, line.quantity, line.unit)
    except (UnitError, KeyError, TypeError):
        return False
    return abs(got - want) <= AMOUNT_TOLERANCE * want


def score(case: dict, draft: CookbookRecipeIn | None, notes: list[str]) -> dict:
    e = case["expect"]
    if draft is None:
        return {"found_ok": not e["is_recipe"]}
    flagged = {int(m.group(1)) - 1 for n in notes if (m := _FLAG.match(n))}
    pairs = pair_lines(e["lines"], draft)
    vague = [(x, i) for x, i in zip(e["lines"], pairs, strict=True) if x["vague"]]
    stated = [(x, i) for x, i in zip(e["lines"], pairs, strict=True) if not x["vague"]]
    expected, got = set(e["allergens"]), draft_allergens(draft)
    text = draft.model_dump_json().lower()
    return {
        "found_ok": e["is_recipe"],
        "lines_expected": len(e["lines"]),
        "lines_got": len(draft.ingredients),
        "lines_matched": sum(i is not None for i in pairs),
        "missed_allergens": sorted(expected - got),
        "extra_allergens": sorted(got - expected),
        "vague_expected": len(vague),
        "vague_flagged": sum(i is not None and i in flagged for _, i in vague),
        "stated_expected": len(stated),
        "stated_right": sum(
            i is not None and amount_ok(x, draft.ingredients[i]) for x, i in stated
        ),  # fmt: skip
        "stated_flagged": sum(i is not None and i in flagged for _, i in stated),
        "sponsor_ignored": not any(m.lower() in text for m in SPONSOR_MARKERS),
        "servings_ok": draft.servings == e["servings"],
        "time_ok": abs(draft.total_minutes - e["minutes"]) <= TIME_TOLERANCE * e["minutes"],
        "title": draft.title,
    }


def run_one(case: dict, model: str, transcribe_model: str, guided: bool, frames: bool) -> dict:
    importer = Importer(model=model, transcribe_model=transcribe_model)
    base = {"case_id": case["id"], "kind": case["kind"], "ok": True}
    try:
        result = importer.from_video(audio_url(case), frame_urls(case) if frames else [],
                                     case["url"], case["caption"], guided=guided)  # fmt: skip
        draft, notes, latency = result.draft, result.notes, result.latency_ms
    except ImportFailed:
        draft, notes, latency = None, [], 0.0
    except Exception as exc:  # a failed call is a result, not a crash
        return {**base, "ok": False, "error": f"{type(exc).__name__}: {exc}"}
    u = importer.usage
    row = {**base, **score(case, draft, notes), "cost_usd": u.cost(),
           "transcription_cost_usd": u.transcription_cost(), "audio_seconds": u.audio_seconds,
           "latency_ms": latency, "input_tokens": u.input_tokens,
           "output_tokens": u.output_tokens}  # fmt: skip
    print(f"{case['id']}: found {'ok' if row['found_ok'] else 'WRONG'}, "
          f"lines {row.get('lines_matched', '-')}/{row.get('lines_expected', '-')}, "
          f"vague {row.get('vague_flagged', '-')}/{row.get('vague_expected', '-')}, "
          f"missed {row.get('missed_allergens', [])}", flush=True)  # fmt: skip
    return row


def ratio(rows: list[dict], hit: str, total: str) -> float | None:
    n = sum(r[total] for r in rows)
    return sum(r[hit] for r in rows) / n if n else None


def mean(rows: list[dict], key: str) -> float | None:
    values = [r[key] for r in rows if r.get(key) is not None]
    return statistics.fmean(values) if values else None


def summarise(rows: list[dict]) -> dict:
    ok = [r for r in rows if r["ok"]]
    drafts = [r for r in ok if "lines_got" in r]
    costs = [r["cost_usd"] for r in drafts]
    latencies = [r["latency_ms"] for r in drafts]
    return {
        "cases": len(rows),
        "failed": len(rows) - len(ok),
        "found_ok": mean(ok, "found_ok"),
        "food_match": ratio(drafts, "lines_matched", "lines_expected"),
        "cases_missing_allergens": sum(bool(r["missed_allergens"]) for r in drafts),
        "missed_allergens": {
            r["case_id"]: r["missed_allergens"] for r in drafts if r["missed_allergens"]
        },  # fmt: skip
        "extra_allergens": sum(len(r["extra_allergens"]) for r in drafts),
        "vague_flagged": ratio(drafts, "vague_flagged", "vague_expected"),
        "stated_right": ratio(drafts, "stated_right", "stated_expected"),
        "stated_flagged": sum(r["stated_flagged"] for r in drafts),
        "sponsor_ignored": mean(drafts, "sponsor_ignored"),
        "servings_ok": mean(drafts, "servings_ok"),
        "time_ok": mean(drafts, "time_ok"),
        "audio_seconds": mean(ok, "audio_seconds"),
        "transcription_cost_usd": mean(ok, "transcription_cost_usd"),
        "cost_per_import_usd": None if None in costs or not costs else statistics.fmean(costs),
        "latency_p50_ms": percentile(latencies, 50) if latencies else None,
        "latency_p95_ms": percentile(latencies, 95) if latencies else None,
    }


def markdown(s: dict, rows: list[dict], meta: dict) -> str:
    def pct(v):
        return "n/a" if v is None else f"{v:.0%}"

    def usd(v):
        return "n/a (set PANTRILA_PRICE_*)" if v is None else f"${v:.4f}"

    def secs(v):
        return "n/a" if v is None else f"{v / 1000:.1f}s"

    missed = "; ".join(f"{k}: {', '.join(v)}" for k, v in s["missed_allergens"].items())
    audio = "n/a" if s["audio_seconds"] is None else f"{s['audio_seconds']:.0f}s"
    lines = [
        f"# Video-import eval {meta['finished_at']}",
        "",
        f"{meta['cases']} labelled cooking videos (16 kHz WAV + {meta['frames']} frames), "
        f"transcription `{meta['transcribe_model']}` (${meta['transcribe_usd_per_min']}/min), "
        f"model `{meta['model']}` (reasoning medium), prompt {meta['prompt']}.",
        "",
        "| Metric | Value |",
        "|---|---|",
        f"| Imports completed | {s['cases'] - s['failed']} of {s['cases']} |",
        f"| Recipe found / refused correctly | {pct(s['found_ok'])} |",
        f"| Cases with a missed allergen | {s['cases_missing_allergens']}"
        + (f" ({missed})" if missed else "")
        + " |",
        f"| Extra allergens (over-cautious) | {s['extra_allergens']} |",
        f"| Food matching | {pct(s['food_match'])} |",
        f"| Vague amounts flagged for the person | {pct(s['vague_flagged'])} |",
        f"| Stated amounts right (within 15%) | {pct(s['stated_right'])} |",
        f"| Stated amounts wrongly flagged | {s['stated_flagged']} |",
        f"| Sponsor talk kept out of the draft | {pct(s['sponsor_ignored'])} |",
        f"| Servings exact / time within 20% | {pct(s['servings_ok'])} / {pct(s['time_ok'])} |",
        f"| Audio per video | {audio} |",
        f"| Transcription cost per import | {usd(s['transcription_cost_usd'])} |",
        f"| Total cost per import | {usd(s['cost_per_import_usd'])} |",
        f"| Latency p50 / p95 | {secs(s['latency_p50_ms'])} / {secs(s['latency_p95_ms'])} |",
        "",
        "| Case | Kind | Found | Foods | Vague flagged | Stated right | Missed allergens | s |",
        "|---|---|---|---|---|---|---|---|",
    ]

    def mark(v):
        return "ok" if v else "**no**"

    for r in rows:
        if not r["ok"]:
            lines.append(f"| {r['case_id']} | {r['kind']} | failed: {r['error']} ||||||")
        elif "lines_got" not in r:
            lines.append(f"| {r['case_id']} | {r['kind']} | {mark(r['found_ok'])} | | | | | |")
        else:
            lines.append(
                f"| {r['case_id']} | {r['kind']} | {mark(r['found_ok'])} "
                f"| {r['lines_matched']}/{r['lines_expected']} ({r['lines_got']} lines) "
                f"| {r['vague_flagged']}/{r['vague_expected']} "
                f"| {r['stated_right']}/{r['stated_expected']} "
                f"| {', '.join(r['missed_allergens']) or '-'} | {r['latency_ms'] / 1000:.0f} |"
            )
    return "\n".join(lines) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser(description="Pantrila video-import eval")
    parser.add_argument("--only", help="comma-separated case ids")
    parser.add_argument("--plain", action="store_true", help="the plain import prompt (before)")
    parser.add_argument("--transcribe-model", default=None)
    parser.add_argument("--transcribe-price", type=float, metavar="USD_PER_MIN",
                        help="its price (else PANTRILA_PRICE_TRANSCRIBE_PER_MIN)")  # fmt: skip
    parser.add_argument("--no-frames", action="store_true", help="send the audio only")
    parser.add_argument("--concurrency", type=int, default=6)
    args = parser.parse_args()
    if args.transcribe_model and args.transcribe_price is None:
        parser.error("--transcribe-model needs --transcribe-price, so its cost is not mispriced")
    if args.transcribe_price is not None:
        os.environ["PANTRILA_PRICE_TRANSCRIBE_PER_MIN"] = str(args.transcribe_price)

    cases = load_cases()
    if args.only:
        cases = [c for c in cases if c["id"] in set(args.only.split(","))]
    model, transcribe = config.model(), args.transcribe_model or config.transcribe_model()
    with ThreadPoolExecutor(args.concurrency) as pool:
        rows = list(pool.map(
            lambda c: run_one(c, model, transcribe, not args.plain, not args.no_frames), cases
        ))  # fmt: skip

    summary = summarise(rows)
    meta = {
        "finished_at": datetime.now(UTC).strftime("%Y-%m-%dT%H%M%SZ"),
        "cases": len(rows),
        "model": model,
        "transcribe_model": transcribe,
        "transcribe_usd_per_min": config.prices().transcribe_per_min,
        "frames": 0 if args.no_frames else 4,
        "prompt": "plain import (before)" if args.plain else "video (HEAD)",
    }
    report = markdown(summary, rows, meta)
    print(report)
    REPORTS.mkdir(exist_ok=True)
    stem = REPORTS / f"video-{meta['finished_at']}"
    stem.with_suffix(".md").write_text(report)
    stem.with_suffix(".json").write_text(
        json.dumps({"meta": meta, "summary": summary, "results": rows}, indent=2) + "\n"
    )
    print(f"wrote {stem.with_suffix('.md').relative_to(Path.cwd())}")


if __name__ == "__main__":
    main()
