"""Imports that keep running when the browser leaves.

A phone that locks, or a tab that goes to the background, drops the HTTP request an import was
waiting on. A job runs on the server instead: the page starts it, then polls for the result,
and can pick the same job up again after a reload. Jobs live in this process's memory (an
import is minutes, not days): a restart loses the ones in flight, and the page says so.
"""

from __future__ import annotations

import threading
import time
import uuid
from dataclasses import dataclass, field
from typing import Literal

from fastapi import HTTPException

from pantrila.api_models import ImportView

KEEP_SECONDS = 60 * 60  # a finished job can be fetched for an hour
MAX_RUNNING = 2  # per person, on top of the daily import cap


@dataclass
class ImportJob:
    id: str
    user_id: str
    created: float = field(default_factory=time.monotonic)
    status: Literal["running", "done", "failed"] = "running"
    result: ImportView | None = None
    error: tuple[int, str] | None = None  # HTTP status and message of the failure


class ImportJobs:
    def __init__(self) -> None:
        self._jobs: dict[str, ImportJob] = {}
        self._lock = threading.Lock()

    def start(self, user_id: str, job_id: str | None = None) -> ImportJob:
        with self._lock:
            now = time.monotonic()
            self._jobs = {k: j for k, j in self._jobs.items() if now - j.created < KEEP_SECONDS}
            mine = [j for j in self._jobs.values() if j.user_id == user_id]
            running = sum(j.status == "running" for j in mine)
            if running >= MAX_RUNNING:
                raise HTTPException(429, "Two imports are already running. Wait for one to finish.")
            if job_id in self._jobs:
                raise HTTPException(409, "That import was already started.")
            job = ImportJob(job_id or uuid.uuid4().hex, user_id)
            self._jobs[job.id] = job
            return job

    def get(self, user_id: str, job_id: str) -> ImportJob | None:
        with self._lock:
            job = self._jobs.get(job_id)
        return job if job is not None and job.user_id == user_id else None

    def succeed(self, job: ImportJob, result: ImportView) -> None:
        with self._lock:
            job.result, job.status = result, "done"

    def fail(self, job: ImportJob, status: int, message: str) -> None:
        with self._lock:
            job.error, job.status = (status, message), "failed"
