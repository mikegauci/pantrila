"""Once-a-day events from requests: sign-up, daily opens and a return within a week."""

from datetime import date

import pytest

import pantrila.analytics as an
from pantrila.analytics import MemoryActivity, MemoryAnalytics, NoAnalytics, Visits, analytics


def visit_on(monkeypatch, visits: Visits, day: date, user: str = "alice") -> None:
    class Day:
        @staticmethod
        def now(tz):
            return type("T", (), {"date": lambda self: day})()

    monkeypatch.setattr(an, "datetime", Day)
    visits.seen(user, guest=True)


def names(sink: MemoryAnalytics) -> list[str]:
    return [e for _, e, _ in sink.events]


def test_sign_up_daily_opens_and_a_return_within_a_week(monkeypatch):
    sink = MemoryAnalytics()
    visits = Visits(MemoryActivity(), sink)
    for d in (1, 1, 6, 6, 20):
        visit_on(monkeypatch, visits, date(2026, 11, d))
    assert names(sink) == ["signed_up", "app_opened", "app_opened", "returned_within_7_days",
                           "app_opened"]  # fmt: skip
    assert sink.events[3][2]["days_after_sign_up"] == 5


def test_a_return_after_a_week_is_not_counted(monkeypatch):
    sink = MemoryAnalytics()
    visits = Visits(MemoryActivity(), sink)
    visit_on(monkeypatch, visits, date(2026, 11, 1))
    visit_on(monkeypatch, visits, date(2026, 11, 9))
    assert names(sink) == ["signed_up", "app_opened", "app_opened"]


def test_two_servers_count_a_day_once(monkeypatch):
    sink, shared = MemoryAnalytics(), {}
    a, b = Visits(MemoryActivity(shared), sink), Visits(MemoryActivity(shared), sink)
    visit_on(monkeypatch, a, date(2026, 11, 1))
    visit_on(monkeypatch, b, date(2026, 11, 1))
    assert names(sink) == ["signed_up", "app_opened"]


def test_activity_errors_never_break_a_request(monkeypatch):
    class Broken:
        def record(self, user_id, day):
            raise RuntimeError("db down")

    sink = MemoryAnalytics()
    visit_on(monkeypatch, Visits(Broken(), sink), date(2026, 11, 1))
    assert sink.events == []


def test_off_without_a_key_and_eu_by_default(monkeypatch):
    assert isinstance(analytics(), NoAnalytics)
    monkeypatch.setenv("POSTHOG_API_KEY", "phc_test")
    sink = analytics()
    try:
        assert sink.client.host == "https://eu.i.posthog.com"
        assert sink.client.disable_geoip is True
    finally:
        sink.client.disabled = True  # nothing is sent from tests
        sink.close()


@pytest.mark.db
def test_db_activity_records_each_day_once(conn):
    from tests.test_import_jobs import OnePool

    log = an.DbActivity(OnePool(conn))
    assert log.record("alice", date(2026, 11, 1)) == [date(2026, 11, 1)]
    assert log.record("alice", date(2026, 11, 1)) is None
    assert log.record("alice", date(2026, 11, 3)) == [date(2026, 11, 1), date(2026, 11, 3)]
