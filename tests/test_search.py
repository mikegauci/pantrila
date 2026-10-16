import pytest

from pantrio.schema import Allergen, DietTag, MealType
from pantrio.search import RRF_K, SearchFilters, filter_sql, rrf_merge


def test_rrf_merge_scores_and_order():
    merged = rrf_merge([["a", "b", "c"], ["b", "d"]], k=60)
    scores = dict(merged)
    assert scores["b"] == pytest.approx(1 / 62 + 1 / 61)
    assert scores["a"] == pytest.approx(1 / 61)
    assert scores["d"] == pytest.approx(1 / 62)
    assert [d for d, _ in merged] == ["b", "a", "d", "c"]


def test_rrf_merge_breaks_ties_by_id():
    assert [d for d, _ in rrf_merge([["x", "y"], ["y", "x"]])] == ["x", "y"]


def test_rrf_default_k():
    assert RRF_K == 60
    assert rrf_merge([["only"]]) == [("only", pytest.approx(1 / 61))]


def test_empty_filters_are_a_no_op():
    assert filter_sql(SearchFilters()) == ("true", {})


def test_filter_sql_builds_every_clause():
    f = SearchFilters(
        exclude_allergens=[Allergen.PEANUTS, Allergen.TREE_NUTS],
        require_diets=[DietTag.VEGAN],
        max_minutes=30,
        meal_types=[MealType.DINNER],
        cuisines=["thai"],
        exclude_foods=["mushroom"],
    )
    sql, params = filter_sql(f, alias="x")
    assert "not (x.allergens && %(exclude_allergens)s::text[])" in sql
    assert "x.diet_tags @> %(require_diets)s::text[]" in sql
    assert "x.total_minutes <= %(max_minutes)s" in sql
    assert "x.meal_types && %(meal_types)s::text[]" in sql
    assert "x.cuisine = any(%(cuisines)s::text[])" in sql
    assert "ri.recipe_id = x.id and ri.food = any(%(exclude_foods)s::text[])" in sql
    assert params == {
        "exclude_allergens": ["peanuts", "tree_nuts"],
        "require_diets": ["vegan"],
        "max_minutes": 30,
        "meal_types": ["dinner"],
        "cuisines": ["thai"],
        "exclude_foods": ["mushroom"],
    }


def test_python_violations_mirror_the_sql(corpus):
    by_id = {r.id: r for r in corpus}
    nut_free = SearchFilters(exclude_allergens=[Allergen.PEANUTS])
    assert nut_free.violations(by_id["thai-peanut-noodles"]) == ["contains ['peanuts']"]
    assert nut_free.violations(by_id["indian-chickpea-curry"]) == []

    vegan_quick = SearchFilters(require_diets=[DietTag.VEGAN], max_minutes=15)
    assert len(vegan_quick.violations(by_id["greek-lemon-chicken"])) == 2

    no_mushrooms = SearchFilters(exclude_foods=["mushroom"], meal_types=[MealType.DINNER])
    assert no_mushrooms.violations(by_id["french-mushroom-omelette"]) == [
        "wrong meal",
        "uses ['mushroom']",
    ]
