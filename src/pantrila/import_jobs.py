"""Imports that keep running when the browser leaves, or the server restarts.

A phone that locks, or a tab that goes to the background, drops the HTTP request an import was
waiting on. A job runs on the server instead: the page starts it, then polls for the result,
and can pick the same job up again after a reload.

Jobs live in the database (`import_jobs`), so a deploy does not lose them. Each server process
has an owner token and holds a lease on the jobs it runs, renewed every `HEARTBEAT_SECONDS`.
When a process stops (a deploy, a crash) the lease lapses, or is given back on a clean
shutdown, and another process claims the job and runs it again from its saved request, on the
same allowance reservation. Writes carry the owner token, so a process that lost a job can no
longer change it. After `MAX_ATTEMPTS` runs a job fails with "try again". Photos in a request
are dropped as soon as the job ends; every job is deleted after `KEEP_SECONDS`.
"""

from __future__ import annotations

import json
import threading
import uuid
from dataclasses import dataclass, field, replace
from datetime import UTC, datetime, timedelta
from typing import Any, Literal, Protocol

from fastapi import HTTPException

from pantrila.api_models import ImportView

KEEP_SECONDS = 60 * 60  # a job can be fetched for an hour
MAX_RUNNING = 2  # per person, on top of the daily import cap
LEASE_SECONDS = 90  # a job whose server has not renewed it for this long is taken over
HEARTBEAT_SECONDS = 20
MAX_ATTEMPTS = 3
INTERRUPTED = (500, "The server restarted during this import too often. Try again.")

Status = Literal["running", "done", "failed"]


@dataclass
class ImportJob:
    id: str
    user_id: str
    request: dict[str, Any]  # ImportJobIn without its id
    reservation: str | None = None  # the allowance held for it (usage_reservations)
    status: Status = "running"
    result: ImportView | None = None
    error: tuple[int, str] | None = None  # HTTP status and message of the failure
    steps: list[str] = field(default_factory=list)  # keys of recipe_import.STEPS, in order
    attempts: int = 1


def _now() -> datetime:
    return datetime.now(UTC)


def _lease() -> datetime:
    return _now() + timedelta(seconds=LEASE_SECONDS)


def _without_photos(request: dict) -> dict:
    return {k: v for k, v in request.items() if k != "images"}


class ImportJobs(Protocol):
    owner: str  # this process

    def start(self, user_id: str, job_id: str | None, request: dict,
              reservation: str | None) -> ImportJob: ...  # fmt: skip

    def get(self, user_id: str, job_id: str) -> ImportJob | None: ...

    def step(self, job: ImportJob, key: str) -> None:
        """The import started `key`; a repeat of the current step is not a new one."""
        ...

    def succeed(self, job: ImportJob, result: ImportView) -> None: ...

    def fail(self, job: ImportJob, status: int, message: str) -> None: ...

    def running(self, user_id: str) -> bool: ...

    def forget(self, user_id: str) -> None: ...

    def heartbeat(self) -> None:
        """Renew the lease on every job this process runs."""
        ...

    def claim_stale(self) -> tuple[list[ImportJob], list[ImportJob]]:
        """Take over jobs whose lease lapsed: (jobs to run again here, jobs given up on)."""
        ...

    def release(self) -> None:
        """Give back this process's leases (clean shutdown), so another takes over at once."""
        ...


@dataclass
class _Row:
    job: ImportJob
    owner: str
    lease_until: datetime
    created: datetime = field(default_factory=_now)


class MemoryImportJobs:
    """Single-process jobs for tests and local runs without a database. `shared` lets two
    instances (two "servers") see the same jobs."""

    def __init__(self, shared: dict | None = None):
        self.owner = uuid.uuid4().hex
        self._rows: dict[str, _Row] = shared if shared is not None else {}
        self._lock = threading.Lock()

    def _mine(self, job: ImportJob) -> _Row | None:
        row = self._rows.get(job.id)
        return row if row is not None and row.owner == self.owner else None

    def start(self, user_id, job_id, request, reservation):
        with self._lock:
            old = _now() - timedelta(seconds=KEEP_SECONDS)
            for k in [k for k, r in self._rows.items() if r.created < old]:
                del self._rows[k]
            running = sum(r.job.user_id == user_id and r.job.status == "running"
                          for r in self._rows.values())  # fmt: skip
            if running >= MAX_RUNNING:
                raise HTTPException(429, "Two imports are already running. Wait for one to finish.")
            if job_id in self._rows:
                raise HTTPException(409, "That import was already started.")
            job = ImportJob(job_id or uuid.uuid4().hex, user_id, request, reservation)
            self._rows[job.id] = _Row(job, self.owner, _lease())
            return replace(job)

    def get(self, user_id, job_id):
        with self._lock:
            row = self._rows.get(job_id)
            if row is None or row.job.user_id != user_id:
                return None
            return replace(row.job, steps=list(row.job.steps))

    def step(self, job, key):
        with self._lock:
            if (row := self._mine(job)) and row.job.status == "running":
                if not row.job.steps or row.job.steps[-1] != key:
                    row.job.steps.append(key)
                row.lease_until = _lease()

    def _end(self, job: ImportJob, **changes) -> None:
        with self._lock:
            if (row := self._mine(job)) and row.job.status == "running":
                row.job = replace(row.job, request=_without_photos(row.job.request), **changes)

    def succeed(self, job, result):
        self._end(job, status="done", result=result)

    def fail(self, job, status, message):
        self._end(job, status="failed", error=(status, message))

    def running(self, user_id):
        with self._lock:
            return any(r.job.user_id == user_id and r.job.status == "running"
                       for r in self._rows.values())  # fmt: skip

    def forget(self, user_id):
        with self._lock:
            for k in [k for k, r in self._rows.items() if r.job.user_id == user_id]:
                del self._rows[k]

    def heartbeat(self):
        with self._lock:
            for r in self._rows.values():
                if r.owner == self.owner and r.job.status == "running":
                    r.lease_until = _lease()

    def claim_stale(self):
        claimed, given_up = [], []
        with self._lock:
            now = _now()
            for r in self._rows.values():
                if r.job.status != "running" or r.lease_until >= now:
                    continue
                if r.job.attempts >= MAX_ATTEMPTS:
                    r.job = replace(r.job, status="failed", error=INTERRUPTED,
                                    request=_without_photos(r.job.request))  # fmt: skip
                    given_up.append(replace(r.job))
                else:
                    r.owner, r.lease_until = self.owner, _lease()
                    r.job = replace(r.job, attempts=r.job.attempts + 1, steps=[])
                    claimed.append(replace(r.job, steps=[]))
        return claimed, given_up

    def release(self):
        with self._lock:
            for r in self._rows.values():
                if r.owner == self.owner and r.job.status == "running":
                    r.lease_until = _now()


class DbImportJobs:
    """Jobs in Postgres (`import_jobs`), shared by every server process."""

    COLUMNS = "id, user_id, request, reservation, status, result, error, steps, attempts"

    def __init__(self, pool):
        self.pool = pool
        self.owner = uuid.uuid4().hex

    @staticmethod
    def _job(row) -> ImportJob:
        jid, user_id, request, reservation, status, result, error, steps, attempts = row
        return ImportJob(
            jid, user_id, request, str(reservation) if reservation else None, status,
            ImportView.model_validate(result) if result else None,
            (error["status"], error["message"]) if error else None, list(steps), attempts,
        )  # fmt: skip

    def start(self, user_id, job_id, request, reservation):
        job = ImportJob(job_id or uuid.uuid4().hex, user_id, request, reservation)
        with self.pool.connection() as conn, conn.transaction():
            # One person's starts run one at a time, so two cannot both pass the running check.
            conn.execute("select pg_advisory_xact_lock(hashtext('import:' || %s))", (user_id,))
            conn.execute("delete from import_jobs where created_at < now() - make_interval("
                         "secs => %s)", (KEEP_SECONDS,))  # fmt: skip
            (running,) = conn.execute(
                "select count(*) from import_jobs where user_id = %s and status = 'running'",
                (user_id,),
            ).fetchone()
            if running >= MAX_RUNNING:
                raise HTTPException(429, "Two imports are already running. Wait for one to finish.")
            inserted = conn.execute(
                "insert into import_jobs (id, user_id, request, reservation, owner, lease_until)"
                " values (%s, %s, %s, %s, %s, %s) on conflict (id) do nothing",
                (job.id, user_id, json.dumps(request), reservation, self.owner, _lease()),
            ).rowcount
            if not inserted:
                raise HTTPException(409, "That import was already started.")
        return job

    def get(self, user_id, job_id):
        with self.pool.connection() as conn:
            row = conn.execute(
                f"select {self.COLUMNS} from import_jobs where id = %s and user_id = %s",
                (job_id, user_id),
            ).fetchone()
        return self._job(row) if row else None

    def step(self, job, key):
        with self.pool.connection() as conn:
            conn.execute(
                "update import_jobs set steps = case when steps ->> -1 = %s then steps"
                " else steps || to_jsonb(%s::text) end, lease_until = %s, updated_at = now()"
                " where id = %s and owner = %s and status = 'running'",
                (key, key, _lease(), job.id, self.owner),
            )

    def _end(self, job: ImportJob, status: Status, result: str | None, error: str | None) -> None:
        with self.pool.connection() as conn:
            conn.execute(
                "update import_jobs set status = %s, result = %s, error = %s,"
                " request = request - 'images', updated_at = now()"
                " where id = %s and owner = %s and status = 'running'",
                (status, result, error, job.id, self.owner),
            )

    def succeed(self, job, result):
        self._end(job, "done", result.model_dump_json(), None)

    def fail(self, job, status, message):
        self._end(job, "failed", None, json.dumps({"status": status, "message": message}))

    def running(self, user_id):
        with self.pool.connection() as conn:
            return conn.execute(
                "select exists (select 1 from import_jobs where user_id = %s"
                " and status = 'running')", (user_id,)).fetchone()[0]  # fmt: skip

    def forget(self, user_id):
        with self.pool.connection() as conn:
            conn.execute("delete from import_jobs where user_id = %s", (user_id,))

    def heartbeat(self):
        with self.pool.connection() as conn:
            conn.execute("update import_jobs set lease_until = %s where owner = %s"
                         " and status = 'running'", (_lease(), self.owner))  # fmt: skip

    def claim_stale(self):
        error = json.dumps({"status": INTERRUPTED[0], "message": INTERRUPTED[1]})
        with self.pool.connection() as conn, conn.transaction():
            given_up = conn.execute(
                "update import_jobs set status = 'failed', error = %s,"
                " request = request - 'images', updated_at = now()"
                " where status = 'running' and lease_until < now() and attempts >= %s"
                f" returning {self.COLUMNS}",
                (error, MAX_ATTEMPTS),
            ).fetchall()
            claimed = conn.execute(
                "update import_jobs set owner = %s, lease_until = %s, attempts = attempts + 1,"
                " steps = '[]', updated_at = now() where id in (select id from import_jobs"
                " where status = 'running' and lease_until < now() for update skip locked)"
                f" returning {self.COLUMNS}",
                (self.owner, _lease()),
            ).fetchall()
        return [self._job(r) for r in claimed], [self._job(r) for r in given_up]

    def release(self):
        with self.pool.connection() as conn:
            conn.execute("update import_jobs set lease_until = now() where owner = %s"
                         " and status = 'running'", (self.owner,))  # fmt: skip
