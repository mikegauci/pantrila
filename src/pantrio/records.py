"""What the web app remembers per user besides the kitchen: saved plans, a usage log and a
cooking log.

The usage log has one event per paid call (a plan, a chat turn, a recipe import or a
generated photo) with tokens, cost and latency. The API counts events for its daily limits
and shows them on the Insights page. The cooking log has one entry per "I cooked this".
"""

from __future__ import annotations

import json
import threading
import uuid
from dataclasses import asdict, dataclass, field, replace
from datetime import UTC, datetime
from typing import Literal, Protocol

import psycopg

from pantrio.planner import Usage
from pantrio.schema import MealPlan

Kind = Literal["plan", "chat", "import", "photo", "search"]
MAX_COOKED_PER_USER = 500  # older cooking log entries are dropped


class QuotaExceeded(ValueError):
    def __init__(self, message: str, status: int):
        super().__init__(message)
        self.status = status


def enforce_quota(count: int, spend: float, cap: int, budget: float, reserve: float) -> None:
    if count >= cap:
        raise QuotaExceeded("Your daily allowance is used up. Try again tomorrow.", 429)
    if spend + reserve > budget + 1e-9:
        raise QuotaExceeded("Pantrio’s demo budget is used or reserved. Try again later.", 503)


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


@dataclass
class Cooked:
    """One "I cooked this": a corpus recipe (`recipe_id`) or a cookbook one (`cookbook_id`)."""

    title: str
    servings: int
    pantry_updated: bool
    recipe_id: str | None = None
    cookbook_id: int | None = None
    id: int = 0
    cooked_at: datetime = field(default_factory=lambda: datetime.now(UTC))


class Records(Protocol):
    """One user's saved plans and usage, plus the total spend across all users."""

    def save_plan(self, plan: MealPlan, report: dict) -> SavedPlan: ...

    def latest_plan(self) -> SavedPlan | None: ...

    def log(self, event: UsageEvent) -> None: ...

    def reserve(
        self, kind: Kind, since: datetime, cap: int, budget: float, amount: float
    ) -> str: ...

    def settle(self, reservation: str, event: UsageEvent | None) -> None: ...

    def events(self, limit: int = 50) -> list[UsageEvent]:
        """This user's events, newest first."""
        ...

    def count_since(self, kind: Kind, since: datetime) -> int:
        """This user's events of a kind since a time."""
        ...

    def spend_since(self, since: datetime) -> float:
        """Known cost of every user's events since a time."""
        ...

    def avatar_path(self) -> str | None: ...

    def set_avatar(self, path: str | None) -> None: ...

    def log_cooked(self, cooked: Cooked) -> Cooked:
        """Add to this user's cooking log; returns it with its id and time."""
        ...

    def cooked(self, limit: int = 50) -> list[Cooked]:
        """This user's cooking log, newest first."""
        ...


class MemoryRecords:
    def __init__(self, user_id: str, shared: dict | None = None):
        self.user_id = user_id
        self.shared = shared if shared is not None else {"plans": [], "events": []}
        self.reservations = self.shared.setdefault("reservations", {})
        self.lock = self.shared.setdefault("usage_lock", threading.RLock())

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
        return sum(e.kind == kind and e.created_at >= since for e in self.events(10**9)) + sum(
            u == self.user_id and k == kind and t >= since
            for u, k, _, t in self.reservations.values()
        )

    def spend_since(self, since: datetime) -> float:
        return sum(
            e.cost_usd or 0.0 for _, e in self.shared["events"] if e.created_at >= since
        ) + sum(amount for _, _, amount, t in self.reservations.values() if t >= since)

    def reserve(self, kind, since, cap, budget, amount) -> str:
        with self.lock:
            enforce_quota(
                self.count_since(kind, since), self.spend_since(since), cap, budget, amount
            )
            rid = str(uuid.uuid4())
            self.reservations[rid] = (self.user_id, kind, amount, datetime.now(UTC))
            return rid

    def settle(self, reservation: str, event: UsageEvent | None) -> None:
        with self.lock:
            row = self.reservations.get(reservation)
            if row is None or row[0] != self.user_id:
                return
            if event is not None:
                if event.cost_usd is None:
                    event.cost_usd = row[2]  # unknown cost is conservatively budgeted
                self.log(event)
            del self.reservations[reservation]

    def avatar_path(self) -> str | None:
        return self.shared.get("avatars", {}).get(self.user_id)

    def set_avatar(self, path: str | None) -> None:
        avatars = self.shared.setdefault("avatars", {})
        if path is None:
            avatars.pop(self.user_id, None)
        else:
            avatars[self.user_id] = path

    def log_cooked(self, cooked: Cooked) -> Cooked:
        log = self.shared.setdefault("cooked", [])
        saved = replace(cooked, id=len(log) + 1, cooked_at=datetime.now(UTC))
        log.append((self.user_id, saved))
        mine = [c for u, c in log if u == self.user_id]
        for old in mine[:-MAX_COOKED_PER_USER]:
            log.remove((self.user_id, old))
        return saved

    def cooked(self, limit: int = 50) -> list[Cooked]:
        return [c for u, c in reversed(self.shared.get("cooked", [])) if u == self.user_id][:limit]


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
            "select (select count(*) from usage_events where user_id = %s and kind = %s"
            " and created_at >= %s) + (select count(*) from usage_reservations"
            " where user_id = %s and kind = %s and created_at >= %s)",
            (self.user_id, kind, since, self.user_id, kind, since),
        ).fetchone()[0]

    def spend_since(self, since: datetime) -> float:
        row = self.conn.execute(
            "select (select coalesce(sum(cost_usd), 0) from usage_events where created_at >= %s)"
            " + (select coalesce(sum(reserved_usd), 0) from usage_reservations"
            " where created_at >= %s)",
            (since, since),
        ).fetchone()
        return float(row[0])

    def reserve(self, kind, since, cap, budget, amount) -> str:
        with self.conn.transaction():
            self.conn.execute("select pg_advisory_xact_lock(73492810)")
            enforce_quota(
                self.count_since(kind, since), self.spend_since(since), cap, budget, amount
            )
            rid = str(uuid.uuid4())
            self.conn.execute(
                "insert into usage_reservations (id, user_id, kind, reserved_usd)"
                " values (%s, %s, %s, %s)",
                (rid, self.user_id, kind, amount),
            )
        return rid

    def settle(self, reservation: str, event: UsageEvent | None) -> None:
        with self.conn.transaction():
            self.conn.execute("select pg_advisory_xact_lock(73492810)")
            row = self.conn.execute(
                "delete from usage_reservations where id = %s and user_id = %s"
                " returning reserved_usd",
                (reservation, self.user_id),
            ).fetchone()
            if row is not None and event is not None:
                if event.cost_usd is None:
                    event.cost_usd = float(row[0])
                self.log(event)

    def avatar_path(self) -> str | None:
        row = self.conn.execute(
            "select path from user_avatars where user_id = %s", (self.user_id,)
        ).fetchone()
        return row[0] if row else None

    def set_avatar(self, path: str | None) -> None:
        with self.conn.transaction():
            if path is None:
                self.conn.execute("delete from user_avatars where user_id = %s", (self.user_id,))
            else:
                self.conn.execute(
                    "insert into user_avatars (user_id, path) values (%s, %s)"
                    " on conflict (user_id) do update set path = excluded.path, updated_at = now()",
                    (self.user_id, path),
                )

    def log_cooked(self, cooked: Cooked) -> Cooked:
        with self.conn.transaction():
            cid, at = self.conn.execute(
                "insert into cooked_meals (user_id, recipe_id, cookbook_id, title, servings,"
                " pantry_updated) values (%s, %s, %s, %s, %s, %s) returning id, cooked_at",
                (self.user_id, cooked.recipe_id, cooked.cookbook_id, cooked.title,
                 cooked.servings, cooked.pantry_updated),
            ).fetchone()  # fmt: skip
            self.conn.execute(
                "delete from cooked_meals where user_id = %s and id not in (select id from"
                " cooked_meals where user_id = %s order by cooked_at desc, id desc limit %s)",
                (self.user_id, self.user_id, MAX_COOKED_PER_USER),
            )
        return replace(cooked, id=cid, cooked_at=at)

    def cooked(self, limit: int = 50) -> list[Cooked]:
        rows = self.conn.execute(
            "select id, recipe_id, cookbook_id, title, servings, pantry_updated, cooked_at"
            " from cooked_meals where user_id = %s order by cooked_at desc, id desc limit %s",
            (self.user_id, limit),
        ).fetchall()
        return [Cooked(id=i, recipe_id=r, cookbook_id=c, title=t, servings=n,
                       pantry_updated=p, cooked_at=at)
                for i, r, c, t, n, p, at in rows]  # fmt: skip
