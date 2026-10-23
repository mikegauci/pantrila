"""Database backends and short-lived repository sessions."""

from __future__ import annotations

from collections.abc import Iterable, Iterator
from contextlib import AbstractContextManager, contextmanager
from dataclasses import dataclass
from typing import Any, Protocol

from pantrila import config
from pantrila.accounts import AuthAdmin, auth_admin, erase_rows
from pantrila.analytics import ActivityLog, DbActivity
from pantrila.chats import Chats
from pantrila.cookbook import (
    Cookbook,
)
from pantrila.import_jobs import DbImportJobs, ImportJobs
from pantrila.pantry import Kitchen
from pantrila.photos import (
    PhotoStore,
    photo_store,
)
from pantrila.planner import RecipeStore
from pantrila.records import Records
from pantrila.search import SearchFilters

# --- Backends ---------------------------------------------------------------------------------


class Catalog(RecipeStore, Protocol):
    def browse(self, filters: SearchFilters, limit: int) -> list[str]: ...

    def photos(self, ids: Iterable[str]) -> dict[str, str]:
        """Photo paths by recipe id; recipes without a photo are left out."""
        ...


@dataclass
class Session:
    """Everything one request needs, scoped to one user."""

    store: Catalog
    kitchen: Kitchen
    records: Records
    cookbook: Cookbook
    chats: Chats


class Backend(Protocol):
    client: Any  # OpenAI client, or None for the default
    photos: PhotoStore | None  # None: photo generation is off (no Storage key)
    admin: AuthAdmin | None  # None: accounts cannot be deleted (no service role key)

    def session(self, user_id: str) -> AbstractContextManager[Session]: ...

    def import_jobs(self) -> ImportJobs:
        """Where background imports are kept (see pantrila.import_jobs)."""
        ...

    def activity(self) -> ActivityLog:
        """Days each person used the app (see pantrila.analytics)."""
        ...

    def erase(self, user_id: str) -> None:
        """Delete the person's rows in every user table (see pantrila.accounts)."""
        ...

    def close(self) -> None: ...


class DbBackend:
    """Postgres through a small connection pool; one connection per request."""

    def __init__(self, url: str, max_size: int = 8):
        from psycopg_pool import ConnectionPool

        from pantrila.search import openai_query_embedder

        self.pool = ConnectionPool(url, min_size=1, max_size=max_size,
                                   kwargs={"autocommit": True}, open=True)  # fmt: skip
        self.embed_query = openai_query_embedder(config.embed_model())
        self.client = None
        self.photos = photo_store()
        self.admin = auth_admin()

    @contextmanager
    def session(self, user_id: str) -> Iterator[Session]:
        from pantrila.chats import DbChats
        from pantrila.cookbook import DbCookbook
        from pantrila.pantry import DbKitchen
        from pantrila.records import DbRecords

        yield Session(
            PooledCatalog(self.pool, self.embed_query),
            PooledRepository(self.pool, DbKitchen, user_id),
            PooledRepository(self.pool, DbRecords, user_id),
            PooledRepository(self.pool, DbCookbook, user_id),
            PooledRepository(self.pool, DbChats, user_id),
        )

    def import_jobs(self) -> DbImportJobs:
        return DbImportJobs(self.pool)

    def activity(self) -> DbActivity:
        return DbActivity(self.pool)

    def erase(self, user_id: str) -> None:
        with self.pool.connection() as conn:
            erase_rows(conn, user_id)

    def close(self) -> None:
        self.pool.close()
        for client in (self.photos, self.admin):
            if client is not None:
                client.close()


class PooledRepository:
    """Borrow a connection for one repository method, never for an external call."""

    def __init__(self, pool, factory, *args):
        self.pool, self.factory, self.args = pool, factory, args

    def __getattr__(self, name):
        def call(*args, **kwargs):
            with self.pool.connection() as conn:
                return getattr(self.factory(conn, *self.args), name)(*args, **kwargs)

        return call


class PooledCatalog(PooledRepository):
    def __init__(self, pool, embed_query):
        from pantrila.planner import DbStore

        super().__init__(pool, DbStore, embed_query)
        self.embed_query, self.embed_tokens = embed_query, 0

    def search(self, query, filters, limit):
        from pantrila.search import search

        # Embedding I/O happens before acquiring a database connection.
        vector, tokens = self.embed_query(query)
        self.embed_tokens += tokens
        with self.pool.connection() as conn:
            return search(conn, query, filters, limit=limit, embed_query=lambda _: (vector, 0)).ids
