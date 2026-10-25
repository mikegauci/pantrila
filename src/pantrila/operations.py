"""One lifecycle for paid work: atomic allowance, partial usage, and exactly-once settlement."""

from __future__ import annotations

import math
import os
import statistics
import time
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Literal

from fastapi import HTTPException

from pantrila import config
from pantrila.entitlements import Tier
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
    """Pro's caps (fair use), which are also everyone's for kinds Free does not limit."""
    lim = config.limits()
    return {
        "plan": lim.plans_per_user,
        "chat": lim.chats_per_user,
        "import": lim.imports_per_user,
        "photo": lim.photos_per_user,
        "search": int(os.environ.get("PANTRILA_DAILY_SEARCHES") or 100),
        "reel": int(os.environ.get("PANTRILA_DAILY_REEL_FETCHES") or 10),
        "estimate": int(os.environ.get("PANTRILA_DAILY_ESTIMATES") or 20),
    }[kind]


Window = Literal["day", "week", "month"]
Feature = Literal["plan", "chat", "import", "photo"]
# Free's caps: (env name, default count, default window). Days, weeks (from Monday) and months
# start at midnight UTC. PANTRILA_FREE_<NAME> and PANTRILA_FREE_<NAME>_WINDOW change them.
FREE: dict[str, tuple[str, int, Window]] = {
    "plan": ("PLANS", 1, "week"),
    "chat": ("CHATS", 10, "day"),
    "import": ("IMPORTS", 5, "month"),
    "photo": ("PHOTOS", 0, "day"),
}
NOUNS = {"plan": "meal plan", "chat": "assistant message", "import": "recipe import",
         "photo": "AI recipe photo"}  # fmt: skip


@dataclass(frozen=True)
class Allowance:
    limit: int
    window: Window

    def start(self, now: datetime) -> datetime:
        day = now.astimezone(UTC).replace(hour=0, minute=0, second=0, microsecond=0)
        if self.window == "week":
            return day - timedelta(days=day.weekday())
        if self.window == "month":
            return day.replace(day=1)
        return day

    def resets_at(self, now: datetime) -> datetime:
        start = self.start(now)
        if self.window == "month":
            return (start + timedelta(days=32)).replace(day=1)
        return start + timedelta(days=7 if self.window == "week" else 1)


def allowance(kind: Kind, tier: Tier) -> Allowance:
    if tier == "free" and kind in FREE:
        name, count, window = FREE[kind]
        chosen = os.environ.get(f"PANTRILA_FREE_{name}_WINDOW")
        return Allowance(int(os.environ.get(f"PANTRILA_FREE_{name}") or count),
                         chosen if chosen in ("day", "week", "month") else window)  # type: ignore[arg-type]  # fmt: skip
    return Allowance(daily_cap(kind), "day")


class ProRequired(HTTPException):
    """A Free cap is reached: 402 with `code: pro_required`, the feature and when it resets."""

    def __init__(self, feature: str, allow: Allowance, now: datetime):
        noun, n = NOUNS[feature], allow.limit
        if n == 0:
            message = f"{noun[0].upper()}{noun[1:]}s come with Pantrila Pro."
        else:
            per = {"day": "a day", "week": "a week", "month": "a month"}[allow.window]
            used = "it is" if n == 1 else "they are"
            message = (f"Pantrila Free includes {n} {noun}{'' if n == 1 else 's'} {per}, and "
                       f"{used} used. Pantrila Pro gives you more.")  # fmt: skip
        super().__init__(402, message)
        self.feature, self.resets_at = feature, allow.resets_at(now)


class PaidOperation:
    """Reserve the allowance for one paid call. `tier` only matters for Free's features (plans,
    chats, imports, photos); searches, reel runs and estimates have one cap for everyone."""

    def __init__(self, records: Records, kind: Kind, model: str, tier: Tier = "free"):
        self.records, self.kind, self.model = records, kind, model
        now = datetime.now(UTC)
        allow = allowance(kind, tier)
        try:
            self.reservation = records.reserve(
                kind,
                allow.start(now),
                allow.limit,
                config.limits().budget_usd,
                config.reservation_usd(kind),
            )
        except QuotaExceeded as exc:
            if exc.status == 429 and tier == "free" and kind in FREE:
                raise ProRequired(kind, allow, now) from exc
            raise HTTPException(exc.status, str(exc)) from exc
        self.started = time.perf_counter()
        self.finished = False

    @classmethod
    def resume(cls, records: Records, kind: Kind, model: str, reservation: str) -> PaidOperation:
        """Settle work another process reserved (an import job taken over after a restart)."""
        op = cls.__new__(cls)
        op.records, op.kind, op.model, op.reservation = records, kind, model, reservation
        op.started, op.finished = time.perf_counter(), False
        return op

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
