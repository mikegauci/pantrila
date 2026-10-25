"""Pantrila Pro: RevenueCat subscribers to entitlements, and Free's windows (no API calls)."""

from datetime import UTC, datetime, timedelta

import pytest

from pantrila.entitlements import (
    DbEntitlements,
    Entitlement,
    MemoryEntitlements,
    current,
    from_subscriber,
    tier_of,
)
from pantrila.operations import Allowance, ProRequired, allowance

NOW = datetime(2026, 10, 25, 15, 30, tzinfo=UTC)  # a Sunday


def subscriber(expires=NOW + timedelta(days=5), **sub) -> dict:
    stamp = None if expires is None else expires.isoformat().replace("+00:00", "Z")
    return {
        "entitlements": {"pro": {"expires_date": stamp, "product_identifier": "pro_monthly",
                                 "grace_period_expires_date": sub.pop("grace", None)}},
        "subscriptions": {"pro_monthly": {"store": "app_store", "period_type": "normal",
                                          "unsubscribe_detected_at": None, **sub}},
    }  # fmt: skip


def test_a_trial_an_active_and_a_cancelled_subscription():
    trial = from_subscriber(subscriber(period_type="trial"), NOW)
    assert (trial.tier, trial.status, trial.store, trial.will_renew) == (
        "pro",
        "trial",
        "app_store",
        True,
    )
    active = from_subscriber(subscriber(store="play_store"), NOW)
    assert (active.status, active.store, active.product_id) == (
        "active",
        "play_store",
        "pro_monthly",
    )
    cancelled = from_subscriber(subscriber(unsubscribe_detected_at="2026-10-24T10:00:00Z"), NOW)
    assert cancelled.active(NOW) and not cancelled.will_renew  # Pro until the period ends


def test_billing_trouble_is_a_grace_period_then_expiry():
    grace = from_subscriber(subscriber(expires=NOW - timedelta(hours=1),
                                       grace="2026-10-30T00:00:00Z"), NOW)  # fmt: skip
    assert grace.status == "grace" and grace.active(NOW)
    assert grace.expires_at == datetime(2026, 10, 30, tzinfo=UTC)
    gone = from_subscriber(subscriber(expires=NOW - timedelta(days=1)), NOW)
    assert (gone.tier, gone.status) == ("free", "expired") and not gone.active(NOW)


def test_no_pro_entitlement_and_other_stores():
    assert from_subscriber({"entitlements": {}, "subscriptions": {}}, NOW) is None
    lifetime = from_subscriber(subscriber(expires=None, store="promotional"), NOW)
    assert lifetime.active(NOW) and lifetime.store == "manual" and lifetime.expires_at is None


def test_pro_users_from_the_environment_and_expired_rows(monkeypatch):
    monkeypatch.setenv("PANTRILA_PRO_USERS", "owner, review")
    assert tier_of("review", None) == "pro" and tier_of("someone", None) == "free"
    old = Entitlement("pro", "active", datetime(2026, 1, 1, tzinfo=UTC), "manual")
    assert current("someone", old) is None  # an end date in the past is Free, no job needed


def test_memory_store_keeps_the_newest_read_and_each_event_once():
    rows = MemoryEntitlements("alice")
    newer = Entitlement("pro", "active", None, "app_store", updated_at=NOW)
    rows.put(newer)
    rows.put(Entitlement("free", "expired", None, "app_store", updated_at=NOW - timedelta(1)))
    assert rows.get() is newer
    assert rows.first_event("evt-1") and not rows.first_event("evt-1")


@pytest.mark.parametrize(
    ("window", "start", "resets"),
    [("day", datetime(2026, 10, 25, tzinfo=UTC), datetime(2026, 10, 26, tzinfo=UTC)),
     ("week", datetime(2026, 10, 19, tzinfo=UTC), datetime(2026, 10, 26, tzinfo=UTC)),
     ("month", datetime(2026, 10, 1, tzinfo=UTC), datetime(2026, 11, 1, tzinfo=UTC))],
)  # fmt: skip
def test_windows_start_at_midnight_utc(window, start, resets):
    allow = Allowance(1, window)
    assert (allow.start(NOW), allow.resets_at(NOW)) == (start, resets)
    assert Allowance(1, "month").resets_at(datetime(2026, 12, 31, tzinfo=UTC)) == datetime(
        2027, 1, 1, tzinfo=UTC
    )


def test_free_and_pro_caps_and_their_environment(monkeypatch):
    for name in ("PLANS", "CHATS", "IMPORTS", "PHOTOS"):
        monkeypatch.delenv(f"PANTRILA_FREE_{name}", raising=False)
        monkeypatch.delenv(f"PANTRILA_FREE_{name}_WINDOW", raising=False)
    monkeypatch.delenv("PANTRILA_DAILY_CHATS", raising=False)
    assert allowance("plan", "free") == Allowance(1, "week")
    assert allowance("import", "free") == Allowance(5, "month")
    assert allowance("chat", "free") == Allowance(10, "day")
    assert allowance("photo", "free") == Allowance(0, "day")
    assert allowance("chat", "pro") == Allowance(50, "day")
    assert allowance("search", "free") == allowance("search", "pro")  # one cap for everyone
    monkeypatch.setenv("PANTRILA_FREE_PLANS", "2")
    monkeypatch.setenv("PANTRILA_FREE_PLANS_WINDOW", "month")
    assert allowance("plan", "free") == Allowance(2, "month")
    monkeypatch.setenv("PANTRILA_FREE_PLANS_WINDOW", "fortnight")  # not a window: the default
    assert allowance("plan", "free").window == "week"


def test_pro_required_says_what_is_used_up():
    plans = ProRequired("plan", Allowance(1, "week"), NOW)
    assert plans.status_code == 402 and "1 meal plan a week" in plans.detail
    assert plans.resets_at == datetime(2026, 10, 26, tzinfo=UTC)
    assert ProRequired("photo", Allowance(0, "day"), NOW).detail == (
        "AI recipe photos come with Pantrila Pro."
    )


@pytest.mark.db
def test_db_entitlements_round_trip_and_ignore_older_reads(conn):
    rows = DbEntitlements(conn, "alice")
    assert rows.get() is None
    rows.put(Entitlement("pro", "trial", NOW, "play_store", "pro_yearly", True, updated_at=NOW))
    rows.put(Entitlement("free", "expired", NOW, "play_store", updated_at=NOW - timedelta(1)))
    saved = rows.get()
    assert (saved.status, saved.product_id, saved.will_renew) == ("trial", "pro_yearly", True)
    assert rows.first_event("evt-1") and not rows.first_event("evt-1")
    assert DbEntitlements(conn, "bob").get() is None
