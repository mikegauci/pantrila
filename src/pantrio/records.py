"""What the web app remembers per user besides the kitchen: saved plans and a usage log.

The usage log has one event per paid call (a plan, a chat turn or a recipe import) with
tokens, cost and latency. The API counts events for its daily limits and shows them on the
Insights page.
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from typing import Literal, Protocol

import psycopg

from pantrio.planner import Usage
from pantrio.schema import MealPlan

Kind = Literal["plan", "chat", "import"]


@dataclass
class UsageEvent:
    kind: Kind
    model: str
    latency_ms: int
    llm_calls: int = 0
    tool_calls: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    embed_tokens: int = 0
    cost_usd: float | None = None
    ok: bool = True
    created_at: datetime = field(default_factory=lambda: datetime.now(UTC))

    @classmethod
    def from_usage(cls, kind: Kind, model: str, usage: Usage, latency_ms: float,
                   ok: bool = True) -> UsageEvent:  # fmt: skip
        return cls(
            kind=kind, model=model, latency_ms=round(latency_ms), llm_calls=usage.llm_calls,
            tool_calls=usage.tool_calls, input_tokens=usage.input_tokens,
            output_tokens=usage.output_tokens, embed_tokens=usage.embed_tokens,
            cost_usd=usage.cost(), ok=ok,
        )  # fmt: skip


@dataclass
class SavedPlan:
    id: int
    plan: MealPlan
    report: dict
    created_at: datetime


class Records(Protocol):
    """One user's saved plans and usage, plus the total spend across all users."""

    def save_plan(self, plan: MealPlan, report: dict) -> SavedPlan: ...

    def latest_plan(self) -> SavedPlan | None: ...

    def log(self, event: UsageEvent) -> None: ...

    def events(self, limit: int = 50) -> list[UsageEvent]:
        """This user's events, newest first."""
        ...

    def count_since(self, kind: Kind, since: datetime) -> int:
        """This user's events of a kind since a time."""
        ...

    def spend_since(self, since: datetime) -> float:
        """Known cost of every user's events since a time."""
        ...


class MemoryRecords:
    def __init__(self, user_id: str, shared: dict | None = None):
        self.user_id = user_id
        self.shared = shared if shared is not None else {"plans": [], "events": []}

    def save_plan(self, plan: MealPlan, report: dict) -> SavedPlan:
        saved = SavedPlan(len(self.shared["plans"]) + 1, plan, report, datetime.now(UTC))
        self.shared["plans"].append((self.user_id, saved))
        return saved

    def latest_plan(self) -> SavedPlan | None:
        mine = [p for u, p in self.shared["plans"] if u == self.user_id]
        return mine[-1] if mine else None

    def log(self, event: UsageEvent) -> None:
        self.shared["events"].append((self.user_id, event))

    def events(self, limit: int = 50) -> list[UsageEvent]:
        return [e for u, e in reversed(self.shared["events"]) if u == self.user_id][:limit]

    def count_since(self, kind: Kind, since: datetime) -> int:
        return sum(e.kind == kind and e.created_at >= since for e in self.events(10**9))

    def spend_since(self, since: datetime) -> float:
        return sum(e.cost_usd or 0.0 for _, e in self.shared["events"] if e.created_at >= since)


EVENT_COLUMNS = (
    "kind", "model", "latency_ms", "llm_calls", "tool_calls", "input_tokens", "output_tokens",
    "embed_tokens", "cost_usd", "ok", "created_at",
)  # fmt: skip


class DbRecords:
    def __init__(self, conn: psycopg.Connection, user_id: str):
        if not user_id:
            raise ValueError("user_id is required")
        self.conn, self.user_id = conn, user_id

    def save_plan(self, plan: MealPlan, report: dict) -> SavedPlan:
        with self.conn.transaction():
            pid, created = self.conn.execute(
                "insert into meal_plans (user_id, plan, report) values (%s, %s, %s)"
                " returning id, created_at",
                (self.user_id, plan.model_dump_json(), json.dumps(report)),
            ).fetchone()
        return SavedPlan(pid, plan, report, created)

    def latest_plan(self) -> SavedPlan | None:
        row = self.conn.execute(
            "select id, plan, report, created_at from meal_plans where user_id = %s"
            " order by created_at desc, id desc limit 1",
            (self.user_id,),
        ).fetchone()
        if row is None:
            return None
        pid, plan, report, created = row
        return SavedPlan(pid, MealPlan.model_validate(plan), report, created)

    def log(self, event: UsageEvent) -> None:
        values = asdict(event)
        with self.conn.transaction():
            self.conn.execute(
                f"insert into usage_events (user_id, {', '.join(EVENT_COLUMNS)})"
                f" values (%s, {', '.join(['%s'] * len(EVENT_COLUMNS))})",
                (self.user_id, *(values[c] for c in EVENT_COLUMNS)),
            )

    def events(self, limit: int = 50) -> list[UsageEvent]:
        rows = self.conn.execute(
            f"select {', '.join(EVENT_COLUMNS)} from usage_events where user_id = %s"
            " order by created_at desc, id desc limit %s",
            (self.user_id, limit),
        ).fetchall()
        out = []
        for row in rows:
            e = UsageEvent(**dict(zip(EVENT_COLUMNS, row, strict=True)))
            e.cost_usd = None if e.cost_usd is None else float(e.cost_usd)
            out.append(e)
        return out

    def count_since(self, kind: Kind, since: datetime) -> int:
        return self.conn.execute(
            "select count(*) from usage_events where user_id = %s and kind = %s"
            " and created_at >= %s",
            (self.user_id, kind, since),
        ).fetchone()[0]

    def spend_since(self, since: datetime) -> float:
        row = self.conn.execute(
            "select coalesce(sum(cost_usd), 0) from usage_events where created_at >= %s",
            (since,),
        ).fetchone()
        return float(row[0])
