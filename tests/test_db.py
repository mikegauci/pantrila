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


def test_load_recipes_round_trips(conn, corpus):
    first = corpus[0]
    eighth = first.ingredients[0].model_copy(update={"quantity": 0.125})  # 1/8 tsp
    corpus[0] = first.model_copy(update={"ingredients": [eighth, *first.ingredients[1:]]})
    db.seed(conn, corpus)
    loaded = db.load_recipes(conn, [r.id for r in corpus] + ["missing"])
    assert loaded == {r.id: r for r in corpus}


def test_every_table_has_row_level_security(conn):
    rows = conn.execute(
        "select relname, relrowsecurity from pg_class c join pg_namespace n"
        " on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r'"
    ).fetchall()
    assert {"recipes", "pantry_items", "user_profiles"} <= {name for name, _ in rows}
    assert [name for name, rls in rows if not rls] == []


def test_db_records_keep_plans_and_usage_per_user(conn):
    from datetime import UTC, datetime, timedelta

    from pantrio.records import DbRecords, UsageEvent
    from pantrio.schema import MealPlan, PlanDay, PlannedMeal

    alice, bob = DbRecords(conn, "alice"), DbRecords(conn, "bob")
    assert alice.latest_plan() is None
    plan = MealPlan(
        days=[
            PlanDay(
                day=1, meals=[PlannedMeal(meal_type=MealType.DINNER, recipe_id="x", portions=1.5)]
            )
        ]
    )
    alice.save_plan(plan, {"repairs": 0})
    second = alice.save_plan(plan.model_copy(update={"notes": "newer"}), {"repairs": 1})
    latest = alice.latest_plan()
    assert latest.id == second.id and latest.plan.notes == "newer"
    assert latest.report == {"repairs": 1} and bob.latest_plan() is None

    alice.log(UsageEvent("plan", "m", 1200, llm_calls=2, cost_usd=0.02))
    alice.log(UsageEvent("chat", "m", 300, cost_usd=None, ok=False))
    bob.log(UsageEvent("chat", "m", 300, cost_usd=0.005))
    since = datetime.now(UTC) - timedelta(minutes=1)
    assert alice.count_since("chat", since) == 1 and bob.count_since("plan", since) == 0
    assert alice.spend_since(since) == pytest.approx(0.025)
    events = alice.events()
    assert [(e.kind, e.ok, e.cost_usd) for e in events] == [("chat", False, None),
                                                             ("plan", True, 0.02)]  # fmt: skip


def test_db_cookbook_is_per_user_and_import_is_a_usage_kind(conn):
    from pantrio.cookbook import CookbookRecipeIn, DbCookbook
    from pantrio.records import DbRecords, UsageEvent

    recipe = CookbookRecipeIn.model_validate({
        "title": "Toast", "meal_types": ["breakfast"], "total_minutes": 5, "servings": 1,
        "ingredients": [{"name": "bread", "quantity": 2, "unit": "piece", "food": "white_bread"}],
        "steps": ["Toast it."], "source": "manual",
    })  # fmt: skip
    alice, bob = DbCookbook(conn, "alice"), DbCookbook(conn, "bob")
    saved = alice.add(recipe)
    assert alice.get(saved.id).recipe == recipe and bob.get(saved.id) is None
    assert [r.id for r in alice.list()] == [saved.id] and bob.list() == []
    renamed = recipe.model_copy(update={"title": "Hot toast"})
    assert bob.update(saved.id, renamed) is None and not bob.delete(saved.id)
    assert alice.update(saved.id, renamed).recipe.title == "Hot toast"
    assert alice.delete(saved.id) and alice.list() == []
    DbRecords(conn, "alice").log(UsageEvent("import", "m", 900, llm_calls=1))


def test_db_chats_are_per_user_and_keep_history_and_messages(conn):
    from pantrio.chats import DbChats

    alice, bob = DbChats(conn, "alice"), DbChats(conn, "bob")
    first = alice.create("Pasta", [], [])
    second = alice.create("Soup", [], [])
    turn = [{"role": "user", "content": "Pasta?"}, {"role": "assistant", "content": "Yes."}]
    shown = [{"role": "user", "text": "Pasta?"}, {"role": "assistant", "text": "Yes."}]
    assert bob.append(first.id, shown, turn) is None and bob.get(first.id) is None
    saved = alice.append(first.id, shown, turn)
    assert saved.history == turn and saved.messages == shown
    assert alice.append(first.id, shown[:1], turn).messages == shown + shown[:1]
    assert [(t.id, t.messages) for t in alice.list()] == [(first.id, 3), (second.id, 0)]
    assert bob.list() == [] and not bob.delete(first.id)
    assert alice.delete(first.id) and [t.id for t in alice.list()] == [second.id]
