"""Pantrila Pro: who has it and until when.

Pro is sold in the phone apps through Apple and Google, managed by RevenueCat, whose app user id
is the Supabase user id. RevenueCat calls POST /webhooks/revenuecat on every change; the body
only says that something changed, so the API asks RevenueCat's REST API for the subscriber and
stores what it says. A forged, repeated or out-of-order event cannot grant Pro or roll it back.
Pro bought on a phone also counts on the web (same user id).

One `entitlements` row per person who has or had Pro; no row means Free. `store='manual'` rows
are written by hand (early users, with an end date) and are never taken away by a webhook.
PANTRILA_PRO_USERS (comma-separated user ids) gives Pro to the owner and App Review accounts.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any, Literal, Protocol
from urllib.parse import quote

import psycopg

Tier = Literal["free", "pro"]
Status = Literal["trial", "active", "grace", "expired"]
Store = Literal["app_store", "play_store", "stripe", "manual"]

ENTITLEMENT = "pro"  # the RevenueCat entitlement id
# RevenueCat store names; promotional (granted in RevenueCat's dashboard) and others are manual.
STORES: dict[str, Store] = {"app_store": "app_store", "mac_app_store": "app_store",
                            "play_store": "play_store", "stripe": "stripe"}  # fmt: skip


@dataclass
class Entitlement:
    tier: Tier
    status: Status
    expires_at: datetime | None  # None: no end date
    store: Store
    product_id: str | None = None
    will_renew: bool = False
    updated_at: datetime = field(default_factory=lambda: datetime.now(UTC))

    def active(self, now: datetime | None = None) -> bool:
        now = now or datetime.now(UTC)
        return (self.tier == "pro" and self.status != "expired"
                and (self.expires_at is None or self.expires_at > now))  # fmt: skip


def pro_users() -> set[str]:
    return {u.strip() for u in (os.environ.get("PANTRILA_PRO_USERS") or "").split(",") if u.strip()}


def current(user_id: str, saved: Entitlement | None) -> Entitlement | None:
    """The Pro entitlement that applies now, or None for Free."""
    if user_id in pro_users():
        return Entitlement("pro", "active", None, "manual")
    return saved if saved is not None and saved.active() else None


def tier_of(user_id: str, saved: Entitlement | None) -> Tier:
    return "pro" if current(user_id, saved) else "free"


# --- What RevenueCat says ----------------------------------------------------------------


def _time(value: Any) -> datetime | None:
    if not value:
        return None
    return datetime.fromisoformat(str(value).replace("Z", "+00:00"))


def from_subscriber(subscriber: dict, now: datetime | None = None) -> Entitlement | None:
    """The entitlement a RevenueCat REST subscriber object describes; None if it never had Pro."""
    now = now or datetime.now(UTC)
    ent = (subscriber.get("entitlements") or {}).get(ENTITLEMENT)
    if not ent:
        return None
    product = ent.get("product_identifier")
    sub = (subscriber.get("subscriptions") or {}).get(product) or {}
    expires, grace = _time(ent.get("expires_date")), _time(ent.get("grace_period_expires_date"))
    end = None if expires is None else max(expires, grace or expires)
    store = STORES.get(sub.get("store") or "", "manual")
    if end is not None and end <= now:
        return Entitlement("free", "expired", end, store, product)
    if expires is not None and (expires <= now or sub.get("billing_issues_detected_at")):
        status: Status = "grace"
    else:
        status = "trial" if sub.get("period_type") == "trial" else "active"
    renews = expires is not None and not sub.get("unsubscribe_detected_at")
    return Entitlement("pro", status, end, store, product, will_renew=renews and status != "grace")


class RevenueCat(Protocol):
    def subscriber(self, app_user_id: str) -> dict:
        """The REST API's `subscriber` object."""
        ...

    def delete(self, app_user_id: str) -> None:
        """Delete the subscriber (account deletion); one already gone is not an error."""
        ...

    def close(self) -> None: ...


class RevenueCatApi:
    """RevenueCat's REST API v1 with the secret key (server side only)."""

    def __init__(self, api_key: str, base_url: str = "https://api.revenuecat.com/v1"):
        import httpx

        self.http = httpx.Client(base_url=base_url, timeout=20,
                                 headers={"Authorization": f"Bearer {api_key}"})  # fmt: skip

    def subscriber(self, app_user_id: str) -> dict:
        r = self.http.get(f"/subscribers/{quote(app_user_id, safe='')}")
        r.raise_for_status()
        return r.json()["subscriber"]

    def delete(self, app_user_id: str) -> None:
        r = self.http.delete(f"/subscribers/{quote(app_user_id, safe='')}")
        if r.status_code != 404:
            r.raise_for_status()

    def close(self) -> None:
        self.http.close()


def revenuecat() -> RevenueCatApi | None:
    """None without REVENUECAT_API_KEY: then the webhook is off and Pro comes only by hand."""
    key = os.environ.get("REVENUECAT_API_KEY")
    return RevenueCatApi(key) if key else None


def webhook_secret() -> str | None:
    return os.environ.get("REVENUECAT_WEBHOOK_SECRET") or None


# --- Storage -----------------------------------------------------------------------------


class Entitlements(Protocol):
    """One person's Pro entitlement, and the webhook events already handled for them."""

    def get(self) -> Entitlement | None: ...

    def put(self, entitlement: Entitlement) -> None:
        """Store it, unless a newer read of RevenueCat is already stored."""
        ...

    def first_event(self, event_id: str) -> bool:
        """True the first time a webhook event id is seen."""
        ...


class MemoryEntitlements:
    def __init__(self, user_id: str, shared: dict | None = None):
        self.user_id = user_id
        shared = shared if shared is not None else {}
        self.rows: dict[str, Entitlement] = shared.setdefault("entitlements", {})
        self.events: dict[str, str] = shared.setdefault("subscription_events", {})

    def get(self) -> Entitlement | None:
        return self.rows.get(self.user_id)

    def put(self, entitlement: Entitlement) -> None:
        old = self.rows.get(self.user_id)
        if old is None or old.updated_at <= entitlement.updated_at:
            self.rows[self.user_id] = entitlement

    def first_event(self, event_id: str) -> bool:
        if event_id in self.events:
            return False
        self.events[event_id] = self.user_id
        return True


COLUMNS = ("tier", "status", "expires_at", "store", "product_id", "will_renew", "updated_at")


class DbEntitlements:
    def __init__(self, conn: psycopg.Connection, user_id: str):
        if not user_id:
            raise ValueError("user_id is required")
        self.conn, self.user_id = conn, user_id

    def get(self) -> Entitlement | None:
        row = self.conn.execute(
            f"select {', '.join(COLUMNS)} from entitlements where user_id = %s", (self.user_id,)
        ).fetchone()
        return None if row is None else Entitlement(**dict(zip(COLUMNS, row, strict=True)))

    def put(self, entitlement: Entitlement) -> None:
        e = entitlement
        with self.conn.transaction():
            self.conn.execute(
                f"insert into entitlements (user_id, {', '.join(COLUMNS)})"
                f" values (%s, {', '.join(['%s'] * len(COLUMNS))})"
                " on conflict (user_id) do update set"
                f" {', '.join(f'{c} = excluded.{c}' for c in COLUMNS)}"
                " where entitlements.updated_at <= excluded.updated_at",
                (self.user_id, e.tier, e.status, e.expires_at, e.store, e.product_id,
                 e.will_renew, e.updated_at),
            )  # fmt: skip

    def first_event(self, event_id: str) -> bool:
        with self.conn.transaction():
            return bool(self.conn.execute(
                "insert into subscription_events (id, user_id) values (%s, %s)"
                " on conflict do nothing", (event_id, self.user_id),
            ).rowcount)  # fmt: skip
