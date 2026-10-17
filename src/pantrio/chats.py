"""Saved assistant conversations per user (table `chat_threads`).

A thread keeps two lists: `history`, the model turns the assistant sees on the next message,
and `messages`, what the app shows (the person's text and each reply as it was answered).
The API writes a thread only after a reply succeeds, so a failed turn leaves no trace.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Protocol

import psycopg

MAX_THREADS_PER_USER = 100
TITLE_CHARS = 60


def title_for(message: str) -> str:
    """The first message, on one line, cut at a word near 60 characters."""
    text = " ".join(message.split())
    if len(text) <= TITLE_CHARS:
        return text
    cut = text[:TITLE_CHARS].rsplit(" ", 1)[0] or text[:TITLE_CHARS]
    return cut.rstrip(",.;:") + "…"


@dataclass
class ThreadSummary:
    id: int
    title: str
    messages: int
    updated_at: datetime


@dataclass
class SavedThread:
    id: int
    title: str
    history: list[dict]
    messages: list[dict]
    created_at: datetime
    updated_at: datetime


class Chats(Protocol):
    """One person's threads, most recently used first."""

    def list(self) -> list[ThreadSummary]: ...

    def get(self, thread_id: int) -> SavedThread | None: ...

    def create(self, title: str, messages: list[dict], history: list[dict]) -> SavedThread:
        """Save a new thread, dropping the least recently used past the cap."""
        ...

    def append(self, thread_id: int, messages: list[dict],
               history: list[dict]) -> SavedThread | None:  # fmt: skip
        """Add messages and replace the history."""
        ...

    def delete(self, thread_id: int) -> bool: ...


class MemoryChats:
    def __init__(self, user_id: str, shared: dict | None = None):
        self.user_id = user_id
        self.shared = shared if shared is not None else {}
        self.shared.setdefault("chats", [])
        self.shared.setdefault("chat_ids", 0)

    @property
    def _rows(self) -> list[tuple[str, SavedThread]]:
        return self.shared["chats"]

    def _mine(self) -> list[SavedThread]:
        rows = [t for u, t in self._rows if u == self.user_id]
        return sorted(rows, key=lambda t: (t.updated_at, t.id), reverse=True)

    def list(self) -> list[ThreadSummary]:
        return [ThreadSummary(t.id, t.title, len(t.messages), t.updated_at) for t in self._mine()]

    def get(self, thread_id: int) -> SavedThread | None:
        return next((t for t in self._mine() if t.id == thread_id), None)

    def create(self, title: str, messages: list[dict], history: list[dict]) -> SavedThread:
        for old in self._mine()[MAX_THREADS_PER_USER - 1 :]:
            self.delete(old.id)
        self.shared["chat_ids"] += 1
        now = datetime.now(UTC)
        thread = SavedThread(self.shared["chat_ids"], title, list(history), list(messages),
                             now, now)  # fmt: skip
        self._rows.append((self.user_id, thread))
        return thread

    def append(self, thread_id: int, messages: list[dict],
               history: list[dict]) -> SavedThread | None:  # fmt: skip
        thread = self.get(thread_id)
        if thread is not None:
            thread.messages = thread.messages + messages
            thread.history, thread.updated_at = list(history), datetime.now(UTC)
        return thread

    def delete(self, thread_id: int) -> bool:
        for n, (u, t) in enumerate(self._rows):
            if u == self.user_id and t.id == thread_id:
                del self._rows[n]
                return True
        return False


THREAD_COLUMNS = "id, title, history, messages, created_at, updated_at"


class DbChats:
    def __init__(self, conn: psycopg.Connection, user_id: str):
        if not user_id:
            raise ValueError("user_id is required")
        self.conn, self.user_id = conn, user_id

    def list(self) -> list[ThreadSummary]:
        rows = self.conn.execute(
            "select id, title, jsonb_array_length(messages), updated_at from chat_threads"
            " where user_id = %s order by updated_at desc, id desc",
            (self.user_id,),
        ).fetchall()
        return [ThreadSummary(*r) for r in rows]

    def get(self, thread_id: int) -> SavedThread | None:
        row = self.conn.execute(
            f"select {THREAD_COLUMNS} from chat_threads where user_id = %s and id = %s",
            (self.user_id, thread_id),
        ).fetchone()
        return None if row is None else SavedThread(*row)

    def create(self, title: str, messages: list[dict], history: list[dict]) -> SavedThread:
        with self.conn.transaction():
            self.conn.execute(
                "delete from chat_threads where id in (select id from chat_threads"
                " where user_id = %s order by updated_at desc, id desc offset %s)",
                (self.user_id, MAX_THREADS_PER_USER - 1),
            )
            row = self.conn.execute(
                "insert into chat_threads (user_id, title, history, messages)"
                f" values (%s, %s, %s, %s) returning {THREAD_COLUMNS}",
                (self.user_id, title, json.dumps(history), json.dumps(messages)),
            ).fetchone()
        return SavedThread(*row)

    def append(self, thread_id: int, messages: list[dict],
               history: list[dict]) -> SavedThread | None:  # fmt: skip
        with self.conn.transaction():
            row = self.conn.execute(
                "update chat_threads set messages = messages || %s::jsonb, history = %s,"
                " updated_at = clock_timestamp() where user_id = %s and id = %s"
                f" returning {THREAD_COLUMNS}",
                (json.dumps(messages), json.dumps(history), self.user_id, thread_id),
            ).fetchone()
        return None if row is None else SavedThread(*row)

    def delete(self, thread_id: int) -> bool:
        with self.conn.transaction():
            cur = self.conn.execute(
                "delete from chat_threads where user_id = %s and id = %s",
                (self.user_id, thread_id),
            )
        return cur.rowcount > 0
