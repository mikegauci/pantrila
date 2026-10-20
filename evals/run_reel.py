"""Reel eval: each labelled post link through `Importer.from_post`, with the caption pasted (or a
TikTok link alone) and a fake video service (reel audio from a link). The service finds the
committed WAV and drawn
frames of the paired video-eval case; no real service runs.

Per case: recipe found (or refused), food matching, allergens missed and extra, stated amounts
right (the caption's amounts must survive the video's vaguer ones), method present (not the
"add the method" placeholder), service calls against the expected number (0 when the caption or
a linked site already has the recipe), cost including the service fee, latency. A missed
allergen is the safety number and should be 0. Writes a report under evals/reports/.

    uv run python -m evals.run_reel                 # needs OPENAI_API_KEY
    uv run python -m evals.run_reel --media off     # the "before": today's caption-only import
    uv run python -m evals.run_reel --fee 0.003     # one fee per run (else each platform's
                                                    # actor fee in post_media.ACTORS)
"""

from __future__ import annotations

import argparse
import json
import statistics
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from pathlib import Path

import httpx

from evals.metrics import percentile
from evals.reel_cases import load_cases
from evals.run_import import draft_allergens
from evals.run_video import amount_ok, pair_lines
from evals.video_audio import AUDIO, frame_urls
from evals.video_cases import load_cases as load_videos
from pantrila import config, post_media
from pantrila.cookbook import CookbookRecipeIn
from pantrila.post_media import ACTORS, MediaFailed, PostVideo, VideoMedia
from pantrila.recipe_import import NO_METHOD_STEP, Importer, ImportFailed

REPORTS = Path(__file__).parent / "reports"
VIDEOS = {v["id"]: v for v in load_videos()}
MEDIA_HOST = "https://media.pantrila-eval.example/"


class EvalMedia:
    """The service, faked: a video link (and the caption it reads) per case, counted."""

    platforms = frozenset(ACTORS)

    def __init__(self, case: dict, fee: float | None):
        self.case, self.fee, self.calls, self.cost = case, fee, 0, 0.0

    def fee_for(self, platform: str) -> float:
        return self.fee if self.fee is not None else ACTORS[platform].fee_usd

    def headers_for(self, url: str) -> dict[str, str]:
        return {}

    def video_for(self, post_url: str, platform: str) -> PostVideo | None:
        self.calls += 1
        self.cost += self.fee_for(platform)
        return PostVideo([f"{MEDIA_HOST}{self.case['video']}.mp4"], self.case["service_caption"],
                         "pantrila.eval")  # fmt: skip


def fake_fetch(url: str, http=None, resolve=None, headers=None) -> bytes:
    if not url.startswith(MEDIA_HOST):
        raise MediaFailed("Not an eval video.")
    return url.removeprefix(MEDIA_HOST).removesuffix(".mp4").encode()


def fake_read(data: bytes) -> VideoMedia:
    """The committed WAV and the drawn frames, as PyAV would hand them over."""
    import io
    import wave

    video = VIDEOS[data.decode()]
    audio = (AUDIO / f"{video['id']}.wav").read_bytes()
    with wave.open(io.BytesIO(audio)) as w:
        seconds = w.getnframes() / w.getframerate()
    return VideoMedia(audio, seconds, frame_urls(video))


def page_http(case: dict) -> httpx.Client:
    page = case["page"]

    def handle(req: httpx.Request) -> httpx.Response:
        if page and str(req.url) == page["url"]:
            return httpx.Response(200, html=page["html"])
        return httpx.Response(404)

    return httpx.Client(transport=httpx.MockTransport(handle))


def score(case: dict, draft: CookbookRecipeIn | None, calls: int, media_on: bool) -> dict:
    e = case["expect"]
    want_calls = e["service_calls"] if media_on else 0
    if draft is None:
        return {"found_ok": not e["is_recipe"], "calls": calls, "calls_ok": calls == want_calls}
    pairs = pair_lines(e["lines"], draft)
    stated = [(x, i) for x, i in zip(e["lines"], pairs, strict=True) if not x["vague"]]
    expected, got = set(e["allergens"]), draft_allergens(draft)
    return {
        "found_ok": e["is_recipe"],
        "lines_expected": len(e["lines"]),
        "lines_got": len(draft.ingredients),
        "lines_matched": sum(i is not None for i in pairs),
        "missed_allergens": sorted(expected - got),
        "extra_allergens": sorted(got - expected),
        "stated_expected": len(stated),
        "stated_right": sum(
            i is not None and amount_ok(x, draft.ingredients[i]) for x, i in stated
        ),  # fmt: skip
        "method": draft.steps != [NO_METHOD_STEP],
        "calls": calls,
        "calls_ok": calls == want_calls,
        "title": draft.title,
    }


def run_one(case: dict, model: str, media_on: bool, fee: float | None) -> dict:
    media = EvalMedia(case, fee)
    importer = Importer(model=model, media=media if media_on else None)
    base = {"case_id": case["id"], "kind": case["kind"], "ok": True}
    resolve = lambda host, port: ["93.184.216.34"]  # noqa: E731  (the mock serves the page)
    try:
        result = importer.from_post(case["url"], case["caption"] or None, page_http(case),
                                    resolve)  # fmt: skip
        draft, latency = result.draft, result.latency_ms
    except ImportFailed:
        draft, latency = None, 0.0
    except Exception as exc:  # a failed call is a result, not a crash
        return {**base, "ok": False, "error": f"{type(exc).__name__}: {exc}"}
    u = importer.usage
    model_cost = u.cost()
    row = {**base, **score(case, draft, media.calls, media_on),
           "cost_usd": None if model_cost is None else model_cost + media.cost,
           "media_cost_usd": media.cost,
           "transcription_cost_usd": u.transcription_cost(), "llm_calls": u.llm_calls,
           "latency_ms": latency}  # fmt: skip
    print(f"{case['id']}: found {'ok' if row['found_ok'] else 'WRONG'}, "
          f"lines {row.get('lines_matched', '-')}/{row.get('lines_expected', '-')}, "
          f"method {row.get('method', '-')}, calls {media.calls}, "
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
    costs = [r["cost_usd"] for r in ok]
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
        "stated_right": ratio(drafts, "stated_right", "stated_expected"),
        "method": mean(drafts, "method"),
        "calls_ok": mean(ok, "calls_ok"),
        "calls_per_import": mean(ok, "calls"),
        "media_cost_usd": mean(ok, "media_cost_usd"),
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
    lines = [
        f"# Reel eval {meta['finished_at']}",
        "",
        f"{meta['cases']} labelled reel links with pasted captions, video service "
        f"{meta['media']} (fake; fee {meta['fee_usd']} per run), transcription "
        f"`{meta['transcribe_model']}`, model `{meta['model']}` (reasoning medium).",
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
        f"| Stated amounts right (within 15%) | {pct(s['stated_right'])} |",
        f"| Drafts with a method | {pct(s['method'])} |",
        f"| Service calls as expected | {pct(s['calls_ok'])} |",
        f"| Service calls per import | {s['calls_per_import']:.1f} |",
        f"| Service fee / transcription per import | {usd(s['media_cost_usd'])} / "
        f"{usd(s['transcription_cost_usd'])} |",
        f"| Total cost per import | {usd(s['cost_per_import_usd'])} |",
        f"| Latency p50 / p95 | {secs(s['latency_p50_ms'])} / {secs(s['latency_p95_ms'])} |",
        "",
        "| Case | Kind | Found | Foods | Stated right | Method | Calls | Missed allergens | s |",
        "|---|---|---|---|---|---|---|---|---|",
    ]

    def mark(v):
        return "ok" if v else "**no**"

    for r in rows:
        if not r["ok"]:
            lines.append(f"| {r['case_id']} | {r['kind']} | failed: {r['error']} |||||||")
        elif "lines_got" not in r:
            lines.append(f"| {r['case_id']} | {r['kind']} | {mark(r['found_ok'])} | | | "
                         f"| {r['calls']} {mark(r['calls_ok'])} | | |")  # fmt: skip
        else:
            lines.append(
                f"| {r['case_id']} | {r['kind']} | {mark(r['found_ok'])} "
                f"| {r['lines_matched']}/{r['lines_expected']} ({r['lines_got']} lines) "
                f"| {r['stated_right']}/{r['stated_expected']} | {mark(r['method'])} "
                f"| {r['calls']} {mark(r['calls_ok'])} "
                f"| {', '.join(r['missed_allergens']) or '-'} | {r['latency_ms'] / 1000:.0f} |"
            )
    return "\n".join(lines) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser(description="Pantrila reel eval")
    parser.add_argument("--only", help="comma-separated case ids")
    parser.add_argument("--media", choices=("on", "off"), default="on",
                        help="off is the before: caption and links only")  # fmt: skip
    parser.add_argument("--fee", type=float,
                        help="USD per service run (else each platform's actor fee)")  # fmt: skip
    parser.add_argument("--concurrency", type=int, default=5)
    args = parser.parse_args()
    fee = args.fee

    post_media.fetch_video, post_media.read_video = fake_fetch, fake_read  # no real service
    cases = load_cases()
    if args.only:
        cases = [c for c in cases if c["id"] in set(args.only.split(","))]
    model = config.model()
    with ThreadPoolExecutor(args.concurrency) as pool:
        rows = list(pool.map(lambda c: run_one(c, model, args.media == "on", fee), cases))

    summary = summarise(rows)
    meta = {
        "finished_at": datetime.now(UTC).strftime("%Y-%m-%dT%H%M%SZ"),
        "cases": len(rows),
        "model": model,
        "transcribe_model": config.transcribe_model(),
        "media": args.media,
        "fee_usd": fee if fee is not None else "per platform",
    }
    report = markdown(summary, rows, meta)
    print(report)
    REPORTS.mkdir(exist_ok=True)
    stem = REPORTS / f"reel-{meta['finished_at']}"
    stem.with_suffix(".md").write_text(report)
    stem.with_suffix(".json").write_text(
        json.dumps({"meta": meta, "summary": summary, "results": rows}, indent=2) + "\n"
    )
    print(f"wrote {stem.with_suffix('.md').relative_to(Path.cwd())}")


if __name__ == "__main__":
    main()
