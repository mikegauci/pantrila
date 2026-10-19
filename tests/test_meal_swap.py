"""Swapping one meal of a saved plan: candidates, rule checks, portions and the report."""

import pytest

from pantrio.constraints import PORTION_STEPS, day_nutrition, fit_slot_portion, target_miss
from pantrio.meal_swap import (
    MAX_OPTIONS,
    SwapError,
    find_meal,
    meal_options,
    replace_meal,
    swapped_report,
)
from pantrio.schema import MealPlan, MealType, NutritionTargets, PlanDay, PlannedMeal, UserProfile
from tests.conftest import CorpusStore

OMELETTE, CHICKEN, CURRY, SALMON, NOODLES = (
    "french-mushroom-omelette", "greek-lemon-chicken", "indian-chickpea-curry",
    "italian-salmon-pasta", "thai-peanut-noodles",
)  # fmt: skip


def meal(kind: MealType, rid: str, portions: float = 1.0) -> PlannedMeal:
    return PlannedMeal(meal_type=kind, recipe_id=rid, portions=portions)


@pytest.fixture
def store(corpus):
    return CorpusStore(corpus)


@pytest.fixture
def plan():
    b, d = MealType.BREAKFAST, MealType.DINNER
    return MealPlan(days=[
        PlanDay(day=1, meals=[meal(b, OMELETTE), meal(d, CHICKEN)]),
        PlanDay(day=2, meals=[meal(b, OMELETTE), meal(d, CURRY)]),
    ])  # fmt: skip


def profile(**kw) -> UserProfile:
    return UserProfile(days=2, meals=[MealType.BREAKFAST, MealType.DINNER], **kw)


def ids(options) -> list[str]:
    return [o.recipe.id for o in options]


def test_options_pass_the_rules_and_leave_out_what_the_day_already_has(plan, store):
    options = meal_options(plan, 1, MealType.DINNER, profile(), store)
    # Dinner slots take dinner or lunch recipes; the current meal is never offered, and the
    # curry is allowed because day 1 does not have it.
    assert set(ids(options)) == {CURRY, SALMON, NOODLES}
    assert CHICKEN not in ids(options)

    safe = meal_options(plan, 1, MealType.DINNER, profile(allergies=["peanuts", "fish"]), store)
    assert ids(safe) == [CURRY]


def test_options_come_from_code_checks_not_only_the_sql_filters(plan, store, monkeypatch):
    # A catalogue that ignores the filters still cannot put an unsafe recipe in the options.
    monkeypatch.setattr(store, "browse", lambda filters, limit: list(store.recipes))
    options = meal_options(plan, 1, MealType.DINNER, profile(allergies=["peanuts"]), store)
    assert NOODLES not in ids(options) and SALMON in ids(options)
    breakfast = meal_options(plan, 1, MealType.BREAKFAST, profile(), store)
    assert breakfast == []  # nothing else is a breakfast


def test_recipes_at_the_weekly_repeat_limit_are_not_offered(store):
    d, b = MealType.DINNER, MealType.BREAKFAST
    plan = MealPlan(days=[
        PlanDay(day=1, meals=[meal(b, OMELETTE), meal(d, CHICKEN)]),
        PlanDay(day=2, meals=[meal(b, OMELETTE), meal(d, CURRY)]),
        PlanDay(day=3, meals=[meal(b, OMELETTE), meal(d, CURRY)]),
    ])  # fmt: skip
    options = meal_options(plan, 1, d, profile(), store)
    assert CURRY not in ids(options)  # already twice in the plan


def test_options_prefer_pantry_foods_without_targets(plan, store):
    pantry = profile(pantry=["salmon", "pasta"])
    assert ids(meal_options(plan, 1, MealType.DINNER, pantry, store))[0] == SALMON
    assert len(meal_options(plan, 1, MealType.DINNER, profile(), store, limit=1)) == 1
    assert MAX_OPTIONS >= 3


def test_options_report_the_day_and_the_calorie_change(plan, store):
    p = profile()
    recipes = store.get({CHICKEN, OMELETTE})
    before = day_nutrition(plan.days[0], recipes).kcal
    for option in meal_options(plan, 1, MealType.DINNER, p, store):
        assert option.portions == 1.0  # no targets: normal portions
        assert option.kcal_change == pytest.approx(option.day_nutrition.kcal - before, abs=0.1)
        assert option.day_nutrition.kcal > 0


def test_portions_are_fitted_to_the_day_and_never_leave_the_allowed_steps(plan, store):
    recipes = store.get({OMELETTE, CHICKEN, CURRY, SALMON, NOODLES})
    targets = NutritionTargets(kcal=1800, min_protein_g=None, max_carbs_g=None)
    p = profile(targets=targets)
    for option in meal_options(plan, 1, MealType.DINNER, p, store):
        assert option.portions in PORTION_STEPS
        # Never worse than a normal portion, and the day's other meal is left alone.
        normal = plan.days[0].model_copy(
            update={"meals": [plan.days[0].meals[0], meal(MealType.DINNER, option.recipe.id, 1.0)]}
        )
        assert (
            target_miss(option.day_nutrition, p)
            <= target_miss(day_nutrition(normal, recipes), p) + 1e-9
        )
    day = plan.days[0].model_copy(
        update={"meals": [plan.days[0].meals[0], meal(MealType.DINNER, SALMON, 1.0)]}
    )
    assert fit_slot_portion(day, 1, profile(), recipes) == 1.0


def test_options_for_a_missing_slot_say_so(plan, store):
    with pytest.raises(SwapError) as e:
        meal_options(plan, 1, MealType.LUNCH, profile(), store)
    assert e.value.status == 404
    with pytest.raises(SwapError):
        find_meal(plan, 9, MealType.DINNER)


def test_replace_meal_swaps_only_that_slot(plan, store):
    swapped = replace_meal(plan, 1, MealType.DINNER, CURRY, profile(), store)
    assert [(m.meal_type, m.recipe_id) for m in swapped.days[0].meals] == [
        (MealType.BREAKFAST, OMELETTE), (MealType.DINNER, CURRY)]  # fmt: skip
    assert swapped.days[1] == plan.days[1]
    assert plan.days[0].meals[1].recipe_id == CHICKEN  # the saved plan is not mutated


def test_replace_meal_refuses_what_breaks_the_rules(plan, store):
    with pytest.raises(SwapError) as e:
        replace_meal(plan, 1, MealType.DINNER, SALMON, profile(allergies=["fish"]), store)
    assert e.value.status == 422 and e.value.problems == ["contains fish"]
    with pytest.raises(SwapError) as e:
        replace_meal(plan, 1, MealType.DINNER, CURRY, profile(max_minutes=20), store)
    assert "takes 30 min" in e.value.problems[0]
    with pytest.raises(SwapError) as e:  # a breakfast recipe in a dinner slot
        replace_meal(plan, 1, MealType.DINNER, OMELETTE, profile(), store)
    assert "not a dinner recipe" in e.value.problems[0]


def test_replace_meal_rejects_unknown_and_unchanged_recipes(plan, store):
    with pytest.raises(SwapError) as e:
        replace_meal(plan, 1, MealType.DINNER, "no-such-recipe", profile(), store)
    assert e.value.status == 404
    with pytest.raises(SwapError) as e:
        replace_meal(plan, 1, MealType.DINNER, CHICKEN, profile(), store)
    assert e.value.status == 422


def test_a_swap_can_fix_a_meal_the_profile_now_forbids(plan, store):
    # Mustard became an allergy after planning: the curry is unsafe, the chicken is not.
    swapped = replace_meal(plan, 2, MealType.DINNER, CHICKEN, profile(allergies=["mustard"]), store)
    assert swapped.days[1].meals[1].recipe_id == CHICKEN


def test_swapped_report_recomputes_warnings_and_keeps_planning_costs(plan, store):
    p = profile(targets=NutritionTargets(kcal=5000, min_protein_g=None, max_carbs_g=None),
                pantry=["salmon"])  # fmt: skip
    swapped = replace_meal(plan, 1, MealType.DINNER, SALMON, p, store)
    report = swapped_report({"cost_usd": 0.02, "path": ["draft"], "warnings": ["old"]},
                            swapped, p, store)  # fmt: skip
    assert report["cost_usd"] == 0.02 and report["path"] == ["draft"]
    assert report["swaps"] == 1 and report["pantry_use"] == 1.0
    assert report["warnings"] and all(w != "old" for w in report["warnings"])
    assert swapped_report(report, swapped, p, store)["swaps"] == 2
