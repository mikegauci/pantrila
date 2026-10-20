"""One lifecycle for paid work: atomic allowance, partial usage, and exactly-once settlement."""

import os
import time
from datetime import UTC, datetime

from fastapi import HTTPException

from pantrio import config
from pantrio.planner import Usage
from pantrio.records import Kind, QuotaExceeded, Records, UsageEvent


def daily_cap(kind: Kind) -> int:
    lim = config.limits()
    return {
        "plan": lim.plans_per_user,
        "chat": lim.chats_per_user,
        "import": lim.imports_per_user,
        "photo": lim.photos_per_user,
        "search": int(os.environ.get("PANTRIO_DAILY_SEARCHES") or 100),
        "reel": int(os.environ.get("PANTRIO_DAILY_REEL_FETCHES") or 10),
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
        from pantrio.recipe_import import ImportFailed

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
