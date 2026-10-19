import json

import pytest

from evals.metrics import normalized_recall_at_k, percentile, reciprocal_rank
from evals.retrieval_queries import OUT, SPECS, generate, render
from pantrio.corpus import load_briefs, load_corpus


def test_normalized_recall_at_k_is_capped_by_k():
    ranked = ["a", "b", "c", "d", "e", "f"]
    assert normalized_recall_at_k(ranked, {"a", "c"}, 5) == 1.0
    assert normalized_recall_at_k(ranked, {"a", "z"}, 5) == 0.5
    # 10 relevant, 5 of them in the top 5: perfect at k=5.
    assert (
        normalized_recall_at_k(ranked[:5], set(ranked[:5]) | {str(i) for i in range(5)}, 5) == 1.0
    )
    with pytest.raises(ValueError):
        normalized_recall_at_k(ranked, set(), 5)


def test_reciprocal_rank():
    assert reciprocal_rank(["x", "a"], {"a"}) == 0.5
    assert reciprocal_rank(["x"], {"a"}) == 0.0


def test_percentile_nearest_rank():
    values = list(range(1, 101))
    assert percentile(values, 50) == 50
    assert percentile(values, 95) == 95
    assert percentile([7.0], 95) == 7.0


def test_query_specs_cover_the_hard_cases():
    kinds = {s.kind for s in SPECS}
    assert {"negation", "allergen", "vague", "pantry"} <= kinds
    assert len(SPECS) >= 60
    assert len({s.id for s in SPECS}) == len(SPECS)


def test_committed_queries_match_generator():
    recipes = load_corpus()
    if not recipes:
        pytest.skip("corpus not generated yet")
    assert OUT.read_text() == render(generate(recipes, load_briefs()))


def test_committed_queries_never_label_filter_breakers_relevant():
    if not OUT.exists():
        pytest.skip("retrieval queries not generated yet")
    from pantrio.search import SearchFilters

    recipes = {r.id: r for r in load_corpus()}
    for q in json.loads(OUT.read_text()):
        f = SearchFilters.model_validate(q["filters"])
        assert q["relevant_ids"]
        assert all(not f.violations(recipes[rid]) for rid in q["relevant_ids"]), q["id"]


def test_committed_plan_profiles_match_generator():
    from evals.plan_profiles import OUT as PROFILES
    from evals.plan_profiles import generate
    from evals.plan_profiles import render as render_profiles

    assert PROFILES.read_text() == render_profiles(generate())


def test_every_plan_profile_is_feasible():
    """Each slot has enough safe recipes to fill the plan without breaking the repeat limit,
    and every pantry and excluded food is in the ingredient table."""
    import math

    from evals.plan_profiles import load_profiles
    from pantrio.constraints import MAX_REPEATS, recipe_violations
    from pantrio.foods import load_foods

    recipes = load_corpus()
    foods = load_foods()
    for pid, p in load_profiles():
        assert set(p.pantry) | set(p.exclude_foods) <= set(foods), pid
        for slot in p.meals:
            safe = sum(not recipe_violations(r, p, slot) for r in recipes)
            assert safe >= math.ceil(p.days / MAX_REPEATS), (pid, slot)


def test_committed_chat_cases_match_generator():
    from evals.chat_cases import OUT as CASES
    from evals.chat_cases import generate
    from evals.chat_cases import render as render_cases

    assert CASES.read_text() == render_cases(generate())


def test_chat_cases_point_at_real_recipes_tools_and_foods():
    from evals.chat_cases import CITED_IN_MESSAGE, load_cases
    from evals.run_assistant import kitchen_for
    from pantrio.assistant import TOOL_ARGS
    from pantrio.foods import load_foods

    ids = {r.id for r in load_corpus()}
    foods = load_foods()
    for c in load_cases():
        e = c["expect"]
        kitchen_for(c)  # every pantry food and amount is valid
        assert set(e.get("tools_all", []) + e.get("tools_any", [])) <= set(TOOL_ARGS), c["id"]
        assert set(e.get("pantry_has", []) + e.get("pantry_lacks", [])) <= set(foods), c["id"]
        assert set(CITED_IN_MESSAGE.findall(c["message"])) <= ids, c["id"]
        assert set(e.get("allow_flagged", [])) <= ids, c["id"]


def test_committed_import_cases_match_generator_and_use_real_foods():
    from evals.import_cases import OUT as IMPORTS
    from evals.import_cases import generate
    from evals.import_cases import render as render_imports
    from pantrio.foods import load_foods

    assert IMPORTS.read_text() == render_imports(generate())
    foods = load_foods()
    for case in generate():
        for line in case["expect"]["lines"]:
            assert line["foods"] is None or set(line["foods"]) <= set(foods), case["id"]


def test_import_scoring_counts_estimates_and_missed_allergens():
    from evals.import_cases import load_cases
    from evals.run_import import score
    from pantrio.cookbook import CookbookRecipeIn

    case = next(c for c in load_cases() if c["id"] == "graph-tteokbokki")
    lines = [{"name": li["text"], "quantity": 1, "unit": "g", "food": (li["foods"] or [None])[0]}
             for li in case["expect"]["lines"]]  # fmt: skip
    draft = CookbookRecipeIn(title="T", meal_types=["dinner"], total_minutes=24, servings=2,
                             ingredients=lines, steps=["Cook."])  # fmt: skip
    row = score(case, draft, [])
    # Two foods should have been estimated and were left blank: those lines miss, and the
    # gochujang's gluten is still covered by the soy sauce, but nothing else is lost.
    assert row["lines_matched"] == 5 and row["missed_allergens"] == []
    assert row["servings_ok"] and row["time_ok"]


def test_insights_snapshot_matches_the_selected_eval_reports():
    from scripts.update_eval_snapshot import OUT, render_snapshot

    assert OUT.read_text() == render_snapshot()
