"""Account deletion: every user table, Storage folder and the sign-in (no API calls)."""

import re
from pathlib import Path

import pytest

from pantrila.accounts import USER_TABLES, erase_rows, storage_folders
from pantrila.photos import MemoryPhotos, avatar_path, cookbook_path

MIGRATIONS = Path(__file__).parents[1] / "supabase" / "migrations"


def test_every_table_with_a_user_id_is_erased():
    sql = "\n".join(p.read_text() for p in sorted(MIGRATIONS.glob("*.sql")))
    tables = {m.group(1) for m in re.finditer(
        r"create table (\w+) \((?:(?!\n\);).)*?\buser_id\b", sql, re.S)}  # fmt: skip
    assert tables == set(USER_TABLES)


def test_storage_folders_hold_every_user_file():
    folders = storage_folders("alice")
    for path in (cookbook_path("alice"), avatar_path("alice")):
        assert any(path.startswith(f"{f}/") for f in folders)
    photos = MemoryPhotos()
    photos.put("avatars/alice/a.webp", b"1")
    photos.put("avatars/alice-2/b.webp", b"2")  # another id that starts the same
    photos.delete_folder("avatars/alice")
    assert list(photos.files) == ["avatars/alice-2/b.webp"]


@pytest.mark.db
def test_erase_rows_deletes_only_that_person(conn):
    for user in ("alice", "bob"):
        conn.execute("insert into user_profiles (user_id, profile) values (%s, '{}')", (user,))
        conn.execute("insert into pantry_items (user_id, food) values (%s, 'eggs')", (user,))
    assert erase_rows(conn, "alice") == 2
    rows = conn.execute("select user_id from user_profiles union all "
                        "select user_id from pantry_items").fetchall()  # fmt: skip
    assert {r[0] for r in rows} == {"bob"}
