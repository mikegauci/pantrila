"""Deleting an account: every row, file and sign-in Pantrila holds for one person.

GDPR gives people the right to erasure and Apple requires in-app deletion, so DELETE /me
removes it all at once, with no grace period: the person's rows in every user table (one
transaction), their files in Storage (recipe photos and profile pictures, found by their
folder so earlier orphans go too), their Supabase Auth user and their analytics person in
PostHog (pantrila.analytics). Each step can run
again, so a failure part way is fixed by trying again.
"""

from __future__ import annotations

from typing import Protocol

import psycopg

from pantrila import config

# Every table with a user_id column. tests/test_accounts.py checks this against the migrations.
USER_TABLES = (
    "import_jobs",
    "user_activity",
    "usage_reservations",
    "usage_events",
    "cooked_meals",
    "chat_threads",
    "meal_plans",
    "user_recipes",
    "user_avatars",
    "pantry_items",
    "user_profiles",
)


def storage_folders(user_id: str) -> list[str]:
    """The Storage folders holding this person's files (see photos.cookbook_path/avatar_path)."""
    return [f"user-recipes/{user_id}", f"avatars/{user_id}"]


def erase_rows(conn: psycopg.Connection, user_id: str) -> int:
    """Delete the person's rows from every user table; returns how many rows went."""
    deleted = 0
    with conn.transaction():
        for table in USER_TABLES:
            deleted += conn.execute(f"delete from {table} where user_id = %s", (user_id,)).rowcount
    return deleted


class AuthAdmin(Protocol):
    def delete_user(self, user_id: str) -> None:
        """Remove the sign-in; a user that is already gone is not an error."""
        ...


class SupabaseAuthAdmin:
    """Supabase Auth's admin API with the service role key (server side only)."""

    def __init__(self, url: str, service_key: str):
        import httpx

        self.http = httpx.Client(
            base_url=f"{url.rstrip('/')}/auth/v1",
            headers={"Authorization": f"Bearer {service_key}", "apikey": service_key},
            timeout=20,
        )

    def delete_user(self, user_id: str) -> None:
        r = self.http.delete(f"/admin/users/{user_id}")
        if r.status_code != 404:
            r.raise_for_status()

    def close(self) -> None:
        self.http.close()


def auth_admin() -> SupabaseAuthAdmin | None:
    """None without the service role key: then accounts cannot be deleted from the app."""
    url, key = config.supabase_url_or_none(), config.supabase_service_key()
    return SupabaseAuthAdmin(url, key) if url and key else None
