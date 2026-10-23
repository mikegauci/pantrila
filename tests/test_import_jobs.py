"""Background import jobs: leases, take-over after a restart, and clean-up (no API calls)."""

from contextlib import contextmanager
from datetime import UTC, datetime, timedelta

import pytest
from fastapi import HTTPException

from pantrila import import_jobs as ij
from pantrila.api_models import ImportView
from pantrila.cookbook import CookbookRecipeIn
from pantrila.import_jobs import DbImportJobs, MemoryImportJobs

PHOTOS = {"kind": "photos", "images": ["data:image/jpeg;base64,AAAA"]}


def view() -> ImportView:
    from tests.test_api import TOAST

    draft = CookbookRecipeIn.model_validate(TOAST)
    return ImportView(draft=draft, notes=[], cost_usd=0.01, latency_ms=10)


def lapse(monkeypatch):
    """Move the clock past every lease."""
    later = datetime.now(UTC) + timedelta(seconds=ij.LEASE_SECONDS + 1)
    monkeypatch.setattr(ij, "_now", lambda: later)


class OnePool:
    def __init__(self, conn):
        self.conn = conn

    @contextmanager
    def connection(self):
        yield self.conn


def stores(request) -> tuple:
    """Two "servers" sharing one store: memory, or Postgres when a test database is set."""
    if request.param == "memory":
        shared: dict = {}
        return MemoryImportJobs(shared), MemoryImportJobs(shared)
    conn = request.getfixturevalue("conn")
    return DbImportJobs(OnePool(conn)), DbImportJobs(OnePool(conn))


@pytest.fixture(params=["memory", pytest.param("db", marks=pytest.mark.db)])
def servers(request):
    return stores(request)


def test_a_running_job_is_only_taken_over_once_its_lease_lapses(servers, monkeypatch):
    a, b = servers
    job = a.start("alice", "a" * 32, PHOTOS, None)
    a.step(job, "photos")
    assert b.claim_stale() == ([], [])
    if isinstance(a, MemoryImportJobs):
        lapse(monkeypatch)
    else:  # the database clock decides: expire the lease there
        a.pool.conn.execute("update import_jobs set lease_until = now() - interval '1 second'")
    claimed, given_up = b.claim_stale()
    assert [(j.id, j.attempts, j.steps, j.request) for j in claimed] == [("a" * 32, 2, [], PHOTOS)]
    assert given_up == []

    a.succeed(job, view())  # the old server lost it: no effect
    assert b.get("alice", job.id).status == "running"
    b.step(claimed[0], "recipe")
    b.succeed(claimed[0], view())
    done = a.get("alice", job.id)
    assert done.status == "done" and done.steps == ["recipe"] and done.result is not None
    assert "images" not in done.request  # photos go as soon as the job ends
    assert a.get("bob", job.id) is None


def test_release_hands_jobs_over_at_once(servers):
    a, b = servers
    a.start("alice", None, PHOTOS, None)
    a.release()
    assert len(b.claim_stale()[0]) == 1


def test_a_job_is_given_up_after_too_many_restarts(servers):
    a, b = servers
    job = a.start("alice", None, PHOTOS, "00000000-0000-4000-8000-000000000001")
    for _ in range(ij.MAX_ATTEMPTS - 1):
        a.release()
        (job,) = b.claim_stale()[0]
        a, b = b, a
    a.release()
    claimed, (gone,) = b.claim_stale()
    assert claimed == [] and gone.reservation == "00000000-0000-4000-8000-000000000001"
    failed = a.get("alice", job.id)
    assert failed.status == "failed" and failed.error == ij.INTERRUPTED
    assert "images" not in failed.request


def test_two_running_per_person_and_ids_are_unique(servers):
    a, b = servers
    a.start("alice", "c" * 32, PHOTOS, None)
    with pytest.raises(HTTPException) as dup:
        b.start("bob", "c" * 32, PHOTOS, None)
    assert dup.value.status_code == 409
    b.start("alice", None, PHOTOS, None)
    with pytest.raises(HTTPException) as busy:
        a.start("alice", None, PHOTOS, None)
    assert busy.value.status_code == 429
    assert a.running("alice") and not a.running("bob")
    a.forget("alice")
    assert not b.running("alice")


def test_heartbeat_keeps_a_long_job(servers, monkeypatch):
    a, b = servers
    if not isinstance(a, MemoryImportJobs):
        pytest.skip("leases are database time; the memory store covers the logic")
    a.start("alice", None, PHOTOS, None)
    later = datetime.now(UTC) + timedelta(seconds=ij.LEASE_SECONDS - 5)
    monkeypatch.setattr(ij, "_now", lambda: later)
    a.heartbeat()
    lapse(monkeypatch)
    assert b.claim_stale() == ([], [])  # renewed 5 s before the lapse, so still held
