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
    assert db.seed(conn, corpus[:3], allow_delete=True) == 3
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


def test_db_records_update_a_plan_only_for_its_owner(conn):
    from pantrio.records import DbRecords
    from pantrio.schema import MealPlan, PlanDay, PlannedMeal

    alice, bob = DbRecords(conn, "alice"), DbRecords(conn, "bob")
    meals = [PlannedMeal(meal_type=MealType.DINNER, recipe_id="x")]
    plan = MealPlan(days=[PlanDay(day=1, meals=meals)])
    saved = alice.save_plan(plan, {"repairs": 0})
    changed = plan.model_copy(update={"notes": "swapped"})

    assert bob.update_plan(saved.id, changed, {"swaps": 1}) is None
    assert alice.update_plan(saved.id + 999, changed, {"swaps": 1}) is None
    assert alice.latest_plan().plan.notes == ""
    updated = alice.update_plan(saved.id, changed, {"swaps": 1})
    assert updated.id == saved.id and updated.created_at == saved.created_at
    latest = alice.latest_plan()
    assert latest.plan.notes == "swapped" and latest.report == {"swaps": 1}


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


def test_recipe_photos_survive_reseeding_and_go_with_their_recipe(conn, corpus):
    from pantrio.photos import corpus_paths, save_corpus_path

    db.seed(conn, corpus)
    a, b = corpus[0].id, corpus[1].id
    assert save_corpus_path(conn, a, f"recipes/{a}-1.webp", "m") is None
    assert save_corpus_path(conn, a, f"recipes/{a}-2.webp", "m") == f"recipes/{a}-1.webp"
    save_corpus_path(conn, b, f"recipes/{b}-1.webp", "m")
    db.seed(conn, corpus)
    assert corpus_paths(conn, [a, b, "nope"]) == {
        a: f"recipes/{a}-2.webp",
        b: f"recipes/{b}-1.webp",
    }
    db.seed(conn, [r for r in corpus if r.id != b], allow_delete=True)
    assert corpus_paths(conn, [a, b]) == {a: f"recipes/{a}-2.webp"}


def test_db_cookbook_keeps_a_photo_path_and_photo_is_a_usage_kind(conn):
    from pantrio.cookbook import CookbookRecipeIn, DbCookbook
    from pantrio.records import DbRecords, UsageEvent

    recipe = CookbookRecipeIn.model_validate({
        "title": "Toast", "meal_types": ["breakfast"], "total_minutes": 5, "servings": 1,
        "ingredients": [{"name": "bread", "quantity": 2, "unit": "piece", "food": "white_bread"}],
        "steps": ["Toast it."], "source": "manual",
    })  # fmt: skip
    alice, bob = DbCookbook(conn, "alice"), DbCookbook(conn, "bob")
    saved = alice.add(recipe)
    assert saved.photo_path is None
    bob.set_photo(saved.id, "user-recipes/bob/x.webp")
    assert alice.get(saved.id).photo_path is None
    alice.set_photo(saved.id, "user-recipes/alice/x.webp")
    assert alice.update(saved.id, recipe).photo_path == "user-recipes/alice/x.webp"
    assert alice.list()[0].photo_path == "user-recipes/alice/x.webp"
    DbRecords(conn, "alice").log(UsageEvent("photo", "m", 12000, llm_calls=1))


def test_reservations_serialize_across_connections_and_settle_once(conn):
    import os
    from concurrent.futures import ThreadPoolExecutor
    from datetime import UTC, datetime

    import psycopg

    from pantrio.records import DbRecords, QuotaExceeded, UsageEvent

    conn.commit()
    since = datetime.now(UTC).replace(hour=0, minute=0, second=0, microsecond=0)

    def reserve(user):
        with psycopg.connect(os.environ["PANTRIO_TEST_DATABASE_URL"], autocommit=True) as other:
            try:
                return user, DbRecords(other, user).reserve("chat", since, 10, 0.15, 0.15)
            except QuotaExceeded:
                return user, None

    with ThreadPoolExecutor(max_workers=2) as pool:
        attempts = list(pool.map(reserve, ["alice", "bob"]))
    assert sum(rid is not None for _, rid in attempts) == 1
    user, rid = next((u, r) for u, r in attempts if r is not None)
    records = DbRecords(conn, user)
    assert records.count_since("chat", since) == 1
    assert records.spend_since(since) == pytest.approx(0.15)
    event = UsageEvent("chat", "m", 100, cost_usd=0.01)
    records.settle(rid, event)
    records.settle(rid, event)
    assert records.count_since("chat", since) == 1
    assert records.spend_since(since) == pytest.approx(0.01)
    assert len(records.events()) == 1


def test_pooled_backend_does_not_hold_a_connection_during_external_work(conn, monkeypatch):
    import os

    from pantrio.api import DbBackend
    from pantrio.pantry import make_item

    conn.commit()
    monkeypatch.setattr("pantrio.search.openai_query_embedder", lambda _: lambda _: ([0.0], 0))
    monkeypatch.setattr("pantrio.backend.photo_store", lambda: None)
    backend = DbBackend(os.environ["PANTRIO_TEST_DATABASE_URL"], max_size=1)
    backend.pool.wait()

    def embed(_):
        assert backend.pool.get_stats()["pool_available"] == 1
        raise RuntimeError("stop before the query")

    backend.embed_query = embed
    try:
        with backend.session("alice") as s:
            s.kitchen.put(make_item("egg"))
            assert backend.pool.get_stats()["pool_available"] == 1
            with pytest.raises(RuntimeError, match="stop before"):
                s.store.search("egg", SearchFilters(), 3)
        assert backend.pool.get_stats()["pool_available"] == 1
    finally:
        backend.close()


def test_rest_role_cannot_read_or_write_user_data_even_with_table_grants(conn):
    import uuid

    import psycopg
    from psycopg import sql

    from pantrio.pantry import DbKitchen, make_item

    DbKitchen(conn, "alice").put(make_item("egg"))
    role = sql.Identifier("pantrio_rest_" + uuid.uuid4().hex)
    # A transaction-local test role with explicit grants distinguishes RLS from missing grants.
    with conn.transaction():
        conn.execute(sql.SQL("create role {} nologin").format(role))
        conn.execute(sql.SQL("grant usage on schema public to {}").format(role))
        conn.execute(
            sql.SQL(
                "grant select, insert, update, delete on all tables in schema public to {}"
            ).format(role)
        )
        conn.execute(sql.SQL("set local role {}").format(role))
        assert conn.execute("select * from pantry_items").fetchall() == []
        assert conn.execute("update pantry_items set food = 'milk'").rowcount == 0
        with pytest.raises(psycopg.errors.InsufficientPrivilege), conn.transaction():
            conn.execute("insert into pantry_items (user_id, food) values ('alice', 'milk')")
        conn.execute("reset role")
        conn.execute(sql.SQL("drop owned by {}").format(role))
        conn.execute(sql.SQL("drop role {}").format(role))
    assert DbKitchen(conn, "alice").pantry()[0].food == "egg"


def test_chat_updates_detect_conflicts_and_bound_retained_messages(conn):
    from pantrio.chats import MAX_THREAD_MESSAGES, DbChats

    chats = DbChats(conn, "alice")
    thread = chats.create("Test", [], [])
    old_history = list(thread.history)
    updated = chats.append(
        thread.id, [{"text": "first"}], [{"content": "first"}], expected_history=old_history
    )
    assert updated is not None
    assert (
        chats.append(
            thread.id, [{"text": "lost"}], [{"content": "lost"}], expected_history=old_history
        )
        is None
    )
    assert chats.get(thread.id).messages == [{"text": "first"}]
    messages = [{"text": str(i)} for i in range(MAX_THREAD_MESSAGES + 10)]
    retained = chats.append(thread.id, messages, [])
    assert retained.messages == messages[-MAX_THREAD_MESSAGES:]


def test_db_cooking_log_is_per_user_newest_first_and_bounded(conn, monkeypatch):
    from pantrio import records
    from pantrio.records import Cooked, DbRecords

    monkeypatch.setattr(records, "MAX_COOKED_PER_USER", 2)
    alice, bob = DbRecords(conn, "alice"), DbRecords(conn, "bob")
    first = alice.log_cooked(Cooked(title="Omelette", servings=1, pantry_updated=True,
                                    recipe_id="french-mushroom-omelette"))  # fmt: skip
    assert first.id > 0 and first.cooked_at is not None
    alice.log_cooked(Cooked(title="Toast", servings=2, pantry_updated=False, cookbook_id=7))
    alice.log_cooked(Cooked(title="Curry", servings=4, pantry_updated=True, recipe_id="curry"))
    bob.log_cooked(Cooked(title="Soup", servings=1, pantry_updated=True, recipe_id="soup"))
    assert [(c.title, c.cookbook_id) for c in alice.cooked()] == [("Curry", None), ("Toast", 7)]
    assert [c.title for c in bob.cooked()] == ["Soup"]
    with pytest.raises(Exception, match="check"):
        alice.log_cooked(Cooked(title="Both", servings=1, pantry_updated=True, recipe_id="x",
                                cookbook_id=1))  # fmt: skip


def test_seed_refuses_partial_empty_or_duplicate_corpus_before_writes(conn, corpus):
    from pantrio.cookbook import CookbookRecipeIn, DbCookbook

    db.seed(conn, corpus)
    conn.commit()
    cookbook = DbCookbook(conn, "alice")
    saved = cookbook.add(
        CookbookRecipeIn(
            title="Mine",
            meal_types=["dessert"],
            total_minutes=5,
            servings=1,
            steps=["Serve."],
            ingredients=[dict(name="sugar", quantity=10, unit="g", food="sugar")],
        )
    )
    conn.commit()
    changed = corpus[0].model_copy(update={"title": "Must not persist"})
    for invalid in [[changed], [], [changed, changed]]:
        with pytest.raises(ValueError):
            db.seed(conn, invalid)
        assert db.load_recipes(conn, [corpus[0].id])[corpus[0].id] == corpus[0]
        assert conn.execute("select count(*) from recipes").fetchone()[0] == len(corpus)
        assert cookbook.get(saved.id).recipe == saved.recipe
