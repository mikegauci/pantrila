"""One lifecycle for paid work: atomic allowance, partial usage, and exactly-once settlement."""

import math
import os
import statistics
import time
from datetime import UTC, datetime, timedelta

from fastapi import HTTPException

from pantrila import config
from pantrila.planner import Usage
from pantrila.records import Kind, QuotaExceeded, Records, UsageEvent

# Seeded from production reel imports on 2026-10-20: 75.1 s and 103.1 s.
DEFAULT_REEL_IMPORT_SECONDS = 105


def reel_import_timing(events: list[UsageEvent]) -> tuple[int, int]:
    """Estimate the whole request from this user's recent successful reel imports.

    Reel-service events finish inside their parent import's time interval. Caption-only
    imports, failures, implausible timings and older samples do not set the video estimate.
    The median of the latest five samples plus 15% gives a rough countdown, not a deadline.
    """
    recent = datetime.now(UTC) - timedelta(days=30)
    reels = [e for e in events if e.kind == "reel" and e.ok and e.created_at >= recent]
    samples = [
        e.latency_ms
        for e in sorted(events, key=lambda e: e.created_at, reverse=True)
        if e.kind == "import"
        and e.ok
        and e.created_at >= recent
        and 5_000 <= e.latency_ms <= 600_000
        and any(
            e.created_at - timedelta(milliseconds=e.latency_ms) <= r.created_at <= e.created_at
            for r in reels
        )
    ][:5]
    if not samples:
        return DEFAULT_REEL_IMPORT_SECONDS, 0
    seconds = math.ceil(statistics.median(samples) / 1000 * 1.15 / 5) * 5
    return min(300, max(30, seconds)), len(samples)


def daily_cap(kind: Kind) -> int:
    lim = config.limits()
    return {
        "plan": lim.plans_per_user,
        "chat": lim.chats_per_user,
        "import": lim.imports_per_user,
        "photo": lim.photos_per_user,
        "search": int(os.environ.get("PANTRILA_DAILY_SEARCHES") or 100),
        "reel": int(os.environ.get("PANTRILA_DAILY_REEL_FETCHES") or 10),
    }[kind]


class PaidOperation:
    def __init__(self, records: Records, kind: Kind, model: str):
        self.records, self.kind, self.model = records, kind, model
        since = datetime.now(UTC).replace(hour=0, minute=0, second=0, microsecond=0)
        try:
            self.reservation = records.reserve(
                kind,
                since,
                daily_cap(kind),
                config.limits().budget_usd,
                config.reservation_usd(kind),
            )
        except QuotaExceeded as exc:
            raise HTTPException(exc.status, str(exc)) from exc
        self.started = time.perf_counter()
        self.finished = False

    def finish(self, usage: Usage, ok: bool = True, *, discard_empty: bool = False) -> float:
        ms = (time.perf_counter() - self.started) * 1000
        if not self.finished:
            event = UsageEvent.from_usage(self.kind, self.model, usage, ms, ok=ok)
            self.records.settle(
                self.reservation, None if discard_empty and not usage.llm_calls else event
            )
            self.finished = True
        return ms


class FeeUsage(Usage):
    """A flat fee, such as one run of the service that finds a post's video."""

    def __init__(self, fee_usd: float | None):
        super().__init__()
        self.fee_usd = fee_usd

    def cost(self) -> float | None:
        return self.fee_usd


class ReelMeter:
    """The per-user daily cap on video-service runs, and their fees in the usage log."""

    def __init__(self, records: Records, actor: str):
        self.records, self.actor = records, actor
        self.operation: PaidOperation | None = None

    def start(self) -> None:
        from pantrila.recipe_import import ImportFailed

        try:
            self.operation = PaidOperation(self.records, "reel", self.actor)
        except HTTPException as exc:
            raise ImportFailed(str(exc.detail)) from exc

    def finish(self, fee_usd: float | None, ok: bool) -> None:
        if self.operation is not None:
            self.operation.finish(FeeUsage(fee_usd), ok)
            self.operation = None


class EmbeddingUsage(Usage):
    def cost(self) -> float | None:
        return config.prices().embed_cost(self.embed_tokens)
