"""Postgres tests; run when PANTRIO_TEST_DATABASE_URL points at a disposable database."""

import pytest

from pantrio import db
from pantrio.embeddings import FileCache, ingest
from pantrio.schema import Allergen, DietTag, MealType
from pantrio.search import Mode, SearchFilters, search
from tests.conftest import fake_embed, fake_embed_query

pytestmark = pytest.mark.db


@pytest.fixture
def seeded(conn, corpus, tmp_path):
    db.seed(conn, corpus)
    ingest(conn, corpus, fake_embed, "fake", FileCache("fake", tmp_path))
    return conn


def run(conn, query, mode=Mode.HYBRID, **filters):
    return search(
        conn, query, SearchFilters(**filters), mode=mode, embed_query=fake_embed_query
    ).ids


def test_migrate_is_idempotent(conn):
    assert db.migrate(conn) == []


def test_seed_upserts_and_removes(conn, corpus):
    assert db.seed(conn, corpus) == 5
    assert db.seed(conn, corpus[:3]) == 3
    assert conn.execute("select count(*) from recipes").fetchone()[0] == 3
    n_ing = sum(len(r.ingredients) for r in corpus[:3])
    assert conn.execute("select count(*) from recipe_ingredients").fetchone()[0] == n_ing


def test_ingest_skips_unchanged_and_uses_file_cache(conn, corpus, tmp_path):
    db.seed(conn, corpus)
    cache = FileCache("fake", tmp_path)
    first = ingest(conn, corpus, fake_embed, "fake", cache)
    assert (first.embedded, first.unchanged) == (5, 0) and first.tokens > 0

    second = ingest(conn, corpus, fake_embed, "fake", cache)
    assert (second.embedded, second.unchanged, second.tokens) == (0, 5, 0)

    conn.execute("delete from recipe_embeddings")
    third = ingest(conn, corpus, fake_embed, "fake", FileCache("fake", tmp_path))
    assert (third.embedded, third.from_file_cache, third.tokens) == (0, 5, 0)


@pytest.mark.parametrize("mode", list(Mode))
def test_each_mode_finds_the_obvious_recipe(seeded, mode):
    assert run(seeded, "creamy salmon pasta", mode)[0] == "italian-salmon-pasta"


def test_fulltext_matches_any_word(seeded):
    ids = run(seeded, "peanut omelette", Mode.FULLTEXT)
    assert set(ids) == {"thai-peanut-noodles", "french-mushroom-omelette"}


@pytest.mark.parametrize("mode", list(Mode))
def test_hard_filters_hold_in_every_mode(seeded, corpus, mode):
    by_id = {r.id: r for r in corpus}
    cases = [
        {"exclude_allergens": [Allergen.PEANUTS, Allergen.GLUTEN]},
        {"require_diets": [DietTag.VEGAN]},
        {"max_minutes": 20},
        {"meal_types": [MealType.BREAKFAST]},
        {"cuisines": ["greek"]},
        {"exclude_foods": ["chickpeas", "mushroom"]},
    ]
    for filters in cases:
        f = SearchFilters(**filters)
        ids = run(seeded, "noodles curry pasta chicken omelette", mode, **filters)
        assert ids, filters
        assert all(not f.violations(by_id[i]) for i in ids), filters
        expected = {r.id for r in corpus if not f.violations(r)}
        if mode is not Mode.FULLTEXT:
            assert set(ids) == expected, filters


def test_no_match_returns_empty(seeded):
    assert run(seeded, "pasta", require_diets=[DietTag.VEGAN], meal_types=[MealType.DESSERT]) == []
