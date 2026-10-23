"""Product analytics: the sign-up -> first import -> first plan -> cooking mode -> return funnel.

Events are sent from the API only, to PostHog's EU cloud, keyed by the Supabase user id: no
browser SDK, no cookies, no IP or location (geoip off), no email, no recipe or message text.
PostHog funnels count the first time each event happens, so "first import" is the first
`recipe_imported`. The API keeps one row per person per active day (`user_activity`), which
gives `signed_up` (their first day), `app_opened` (once a day, for retention) and
`returned_within_7_days` (the first later day, if within a week of signing up).

Off unless POSTHOG_API_KEY (the project key) is set. Deleting an account deletes the person
and their events too when POSTHOG_PERSONAL_API_KEY (scope person:write) and POSTHOG_PROJECT_ID
are set.
"""

from __future__ import annotations

import logging
import os
import threading
from datetime import UTC, date, datetime
from typing import Any, Literal, Protocol

log = logging.getLogger("pantrila.analytics")

Event = Literal[
    "signed_up",
    "app_opened",
    "returned_within_7_days",
    "recipe_imported",
    "plan_created",
    "cooking_mode_opened",
]
RETURN_DAYS = 7
EU_INGEST = "https://eu.i.posthog.com"
EU_APP = "https://eu.posthog.com"


class Analytics(Protocol):
    def capture(self, user_id: str, event: Event, properties: dict[str, Any] | None = None
                ) -> None: ...  # fmt: skip

    def forget(self, user_id: str) -> None:
        """Delete the person and their events (account deletion)."""
        ...

    def close(self) -> None: ...


class NoAnalytics:
    def capture(self, user_id, event, properties=None) -> None:
        pass

    def forget(self, user_id) -> None:
        pass

    def close(self) -> None:
        pass


class MemoryAnalytics:
    def __init__(self) -> None:
        self.events: list[tuple[str, str, dict]] = []
        self.forgotten: list[str] = []

    def capture(self, user_id, event, properties=None) -> None:
        self.events.append((user_id, event, properties or {}))

    def forget(self, user_id) -> None:
        self.forgotten.append(user_id)
        self.events = [e for e in self.events if e[0] != user_id]

    def close(self) -> None:
        pass


class PostHogAnalytics:
    """PostHog's client queues events and sends them in batches from its own thread."""

    def __init__(self, api_key: str, host: str = EU_INGEST, personal_key: str | None = None,
                 project_id: str | None = None, app_host: str = EU_APP):  # fmt: skip
        from posthog import Posthog

        self.client = Posthog(api_key, host=host, disable_geoip=True)
        self.personal_key, self.project_id, self.app_host = personal_key, project_id, app_host

    def capture(self, user_id, event, properties=None) -> None:
        try:
            self.client.capture(event, distinct_id=user_id, properties=properties or {})
        except Exception:  # analytics never breaks a request
            log.warning("could not queue %s", event, exc_info=True)

    def forget(self, user_id) -> None:
        if not (self.personal_key and self.project_id):
            log.warning("PostHog person %s kept: POSTHOG_PERSONAL_API_KEY is not set", user_id)
            return
        import httpx

        r = httpx.post(
            f"{self.app_host}/api/projects/{self.project_id}/persons/bulk_delete/",
            headers={"Authorization": f"Bearer {self.personal_key}"},
            json={"distinct_ids": [user_id], "delete_events": True},
            timeout=20,
        )
        r.raise_for_status()

    def close(self) -> None:
        self.client.shutdown()  # sends what is still queued


def analytics() -> Analytics:
    key = os.environ.get("POSTHOG_API_KEY")
    if not key:
        return NoAnalytics()
    return PostHogAnalytics(
        key,
        host=os.environ.get("POSTHOG_HOST") or EU_INGEST,
        personal_key=os.environ.get("POSTHOG_PERSONAL_API_KEY") or None,
        project_id=os.environ.get("POSTHOG_PROJECT_ID") or None,
        app_host=os.environ.get("POSTHOG_APP_HOST") or EU_APP,
    )


# --- Active days -------------------------------------------------------------------------


class ActivityLog(Protocol):
    def record(self, user_id: str, day: date) -> list[date] | None:
        """Note that the person used the app on `day`. None if that day was already noted,
        else every day they were active (oldest first, including `day`)."""
        ...


class MemoryActivity:
    def __init__(self, shared: dict | None = None):
        self.days: dict[str, set[date]] = shared if shared is not None else {}

    def record(self, user_id, day):
        mine = self.days.setdefault(user_id, set())
        if day in mine:
            return None
        mine.add(day)
        return sorted(mine)


class DbActivity:
    def __init__(self, pool):
        self.pool = pool

    def record(self, user_id, day):
        with self.pool.connection() as conn:
            new = conn.execute(
                "insert into user_activity (user_id, day) values (%s, %s) on conflict do nothing",
                (user_id, day),
            ).rowcount
            if not new:
                return None
            rows = conn.execute(
                "select day from user_activity where user_id = %s order by day", (user_id,)
            ).fetchall()
        return [r[0] for r in rows]


class Visits:
    """Turns requests into once-a-day events. Each process remembers who it has already seen
    today, so the database is asked once per person per day per process."""

    def __init__(self, activity: ActivityLog, sink: Analytics):
        self.activity, self.sink = activity, sink
        self._seen: set[tuple[str, date]] = set()
        self._lock = threading.Lock()

    def seen(self, user_id: str, guest: bool) -> None:
        today = datetime.now(UTC).date()
        with self._lock:
            if (user_id, today) in self._seen:
                return
            if len(self._seen) > 50_000:  # a new day: yesterday's entries are no use
                self._seen = {k for k in self._seen if k[1] == today}
            self._seen.add((user_id, today))
        try:
            days = self.activity.record(user_id, today)
        except Exception:
            log.warning("could not record activity", exc_info=True)
            return
        if days is None:
            return
        props = {"guest": guest, "$set": {"guest": guest}}
        if len(days) == 1:
            self.sink.capture(user_id, "signed_up", props)
        self.sink.capture(user_id, "app_opened", props)
        after = (days[1] - days[0]).days if len(days) == 2 else None
        if after is not None and after <= RETURN_DAYS:
            self.sink.capture(user_id, "returned_within_7_days",
                              {**props, "days_after_sign_up": after})  # fmt: skip
