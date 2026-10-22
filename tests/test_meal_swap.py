"""Swapping one meal of a saved plan: candidates, rule checks, portions and the report."""

import pytest

from pantrila.constraints import (
    PORTION_STEPS,
    check_plan,
    cooked_counts,
    day_nutrition,
    fit_slot_portion,
    target_miss,
)
from pantrila.cookbook import CookbookRecipeIn, FoodEstimate, MemoryCookbook, RecipeLine
from pantrila.grocery import plan_needs
from pantrila.meal_swap import (
    MAX_OPTIONS,
    PlanCatalog,
    SwapError,
    find_meal,
    leftovers_of,
    meal_options,
    replace_meal,
    set_slot,
    swapped_report,
)
from pantrila.schema import (
    MealPlan,
    MealType,
    NutritionTargets,
    PlanDay,
    PlannedMeal,
    SlotKind,
    UserProfile,
)
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


# --- Slots: leftovers, skipped, eating out; the person's own recipes ------------------------

S, L, OUT, R = SlotKind.SKIPPED, SlotKind.LEFTOVERS, SlotKind.EATING_OUT, SlotKind.RECIPE
GOCHUJANG = {
    "description": "gochujang (Korean chilli paste)", "diet_class": "plant",
    "allergens": ["soy", "gluten"], "kcal": 220, "protein_g": 5, "carbs_g": 45, "fat_g": 2,
    "fibre_g": 3, "grams_per_ml": 1.2, "grams_per_piece": None,
}  # fmt: skip


def own_recipe(**kw) -> CookbookRecipeIn:
    return CookbookRecipeIn(**{
        "title": "Gochujang rice bowl", "meal_types": ["dinner"], "total_minutes": 20,
        "servings": 2, "steps": ["Cook the rice.", "Stir in the paste."],
        "ingredients": [
            RecipeLine(name="rice", quantity=150, unit="g", food="white_rice"),
            RecipeLine(name="2 tbsp gochujang", quantity=2, unit="tbsp",
                       estimate=FoodEstimate(**GOCHUJANG)),
        ], **kw,
    })  # fmt: skip


@pytest.fixture
def catalog(store):
    cookbook = MemoryCookbook("me")
    saved = cookbook.add(own_recipe())
    return PlanCatalog(store, cookbook), f"mine-{saved.id}"


def test_skipping_a_meal_keeps_its_recipe_and_counts_nothing(plan, store):
    skipped = set_slot(plan, 1, MealType.DINNER, S, profile(), store)
    dinner = skipped.days[0].meals[1]
    assert dinner.kind is S and dinner.recipe_id == CHICKEN
    recipes = store.get({OMELETTE, CHICKEN})
    assert day_nutrition(skipped.days[0], recipes) == day_nutrition(
        plan.days[0].model_copy(update={"meals": plan.days[0].meals[:1]}), recipes
    )
    # The chicken takes 60 minutes: over a new 30-minute limit, but skipped, so not flagged.
    short = profile(max_minutes=30)
    assert check_plan(skipped, short, store.get({OMELETTE, CHICKEN, CURRY})) == []
    assert check_plan(plan, short, store.get({OMELETTE, CHICKEN, CURRY}))
    needs, _, _ = plan_needs(skipped, store.get({OMELETTE, CHICKEN, CURRY}))
    assert "chicken_thigh" not in needs
    with pytest.raises(SwapError):
        set_slot(skipped, 1, MealType.DINNER, S, profile(), store)

    back = set_slot(skipped, 1, MealType.DINNER, R, profile(), store)
    assert back.days[0].meals[1].kind is R and back.days[0].meals[1].recipe_id == CHICKEN
    with pytest.raises(SwapError):
        set_slot(back, 1, MealType.DINNER, R, profile(), store)
    with pytest.raises(SwapError) as e:  # over the new time limit: it cannot come back
        set_slot(skipped, 1, MealType.DINNER, R, short, store)
    assert e.value.status == 422 and "takes 60 min" in e.value.problems[0]


def test_eating_out_counts_only_the_energy_estimate(plan, store):
    out = set_slot(plan, 1, MealType.DINNER, OUT, profile(), store, out_kcal=800)
    assert out.days[0].meals[1].kind is OUT and out.days[0].meals[1].out_kcal == 800
    recipes = store.get({OMELETTE, CHICKEN})
    omelette = recipes[OMELETTE].nutrition
    n = day_nutrition(out.days[0], recipes)
    assert n.kcal == pytest.approx(omelette.kcal + 800, abs=0.1)
    assert n.protein_g == pytest.approx(omelette.protein_g, abs=0.1)
    unknown = set_slot(plan, 1, MealType.DINNER, OUT, profile(), store)
    assert day_nutrition(unknown.days[0], recipes).kcal == pytest.approx(omelette.kcal, abs=0.1)
    # Swapping the eating-out meal for a recipe makes it a planned meal again.
    swapped = replace_meal(out, 1, MealType.DINNER, CHICKEN, profile(), store)
    assert swapped.days[0].meals[1].kind is R and swapped.days[0].meals[1].out_kcal is None


def test_leftovers_eat_an_earlier_meal_and_do_not_count_as_a_repeat(plan, store):
    left = set_slot(plan, 2, MealType.DINNER, L, profile(), store, from_day=1,
                    from_meal=MealType.DINNER)  # fmt: skip
    dinner = left.days[1].meals[1]
    assert (dinner.kind, dinner.recipe_id, dinner.from_day) == (L, CHICKEN, 1)
    assert cooked_counts(left)[CHICKEN] == 1
    needs, _, _ = plan_needs(left, store.get({OMELETTE, CHICKEN}))
    once, _, _ = plan_needs(plan, store.get({OMELETTE, CHICKEN, CURRY}))
    assert needs["chicken_thigh"] == pytest.approx(2 * once["chicken_thigh"])  # cook double
    # A breakfast slot may hold dinner leftovers; the food rules still apply.
    early = set_slot(plan, 2, MealType.BREAKFAST, L, profile(), store, from_day=1,
                     from_meal=MealType.DINNER)  # fmt: skip
    assert early.days[1].meals[0].recipe_id == CHICKEN
    assert check_plan(early, profile(), store.get({OMELETTE, CHICKEN, CURRY})) == []
    with pytest.raises(SwapError):  # the food rules still apply to leftovers
        set_slot(plan, 2, MealType.BREAKFAST, L, profile(max_minutes=30), store, from_day=1,
                 from_meal=MealType.DINNER)  # fmt: skip

    for kw in ({"from_day": 2, "from_meal": MealType.DINNER},  # not an earlier day
               {"from_day": 1, "from_meal": None}):  # fmt: skip
        with pytest.raises(SwapError):
            set_slot(plan, 2, MealType.DINNER, L, profile(), store, **kw)
    skipped = set_slot(plan, 1, MealType.DINNER, S, profile(), store)
    with pytest.raises(SwapError):  # leftovers of a meal nobody cooks
        set_slot(skipped, 2, MealType.DINNER, L, profile(), store, from_day=1,
                 from_meal=MealType.DINNER)  # fmt: skip


def test_a_meal_with_leftovers_cannot_stop_being_cooked_and_swaps_carry_them(plan, store):
    left = set_slot(plan, 2, MealType.DINNER, L, profile(), store, from_day=1,
                    from_meal=MealType.DINNER)  # fmt: skip
    assert leftovers_of(left, 1, MealType.DINNER) == [(2, MealType.DINNER)]
    with pytest.raises(SwapError) as e:
        set_slot(left, 1, MealType.DINNER, S, profile(), store)
    assert "Day 2 dinner is leftovers" in str(e.value)
    swapped = replace_meal(left, 1, MealType.DINNER, NOODLES, profile(), store)
    assert swapped.days[1].meals[1].recipe_id == NOODLES
    assert swapped.days[1].meals[1].kind is L


def test_options_can_be_narrowed_paged_and_report_the_protein_change(plan, store):
    everything = meal_options(plan, 1, MealType.DINNER, profile(), store, None)
    assert len(everything) == 3
    assert ids(meal_options(plan, 1, MealType.DINNER, profile(), store, None,
                            query="salmon pasta")) == [SALMON]  # fmt: skip
    assert ids(meal_options(plan, 1, MealType.DINNER, profile(), store, None,
                            query="peanut")) == [NOODLES]  # fmt: skip
    quick = meal_options(plan, 1, MealType.DINNER, profile(), store, None, quick=True)
    assert all(o.recipe.total_minutes <= 30 for o in quick)
    pantry = meal_options(plan, 1, MealType.DINNER, profile(pantry=["salmon"]), store, None,
                          pantry_only=True)  # fmt: skip
    assert ids(pantry) == [SALMON]
    recipes = store.get({OMELETTE, CHICKEN})
    before = day_nutrition(plan.days[0], recipes).protein_g
    for o in everything:
        assert o.protein_change == pytest.approx(o.day_nutrition.protein_g - before, abs=0.1)


def test_own_recipes_are_offered_checked_and_derived_with_their_estimates(plan, catalog):
    store, mine = catalog
    options = meal_options(plan, 1, MealType.BREAKFAST, profile(), store, None, source="mine")
    assert ids(options) == [mine]  # own recipes are not held to their meal types
    assert meal_options(plan, 1, MealType.DINNER, profile(allergies=["soy"]), store, None,
                        source="mine") == []  # the estimated paste has soy  # fmt: skip
    with pytest.raises(SwapError):
        meal_options(plan, 1, MealType.DINNER, profile(), store.store, None, source="mine")

    swapped = replace_meal(plan, 1, MealType.DINNER, mine, profile(), store)
    assert swapped.days[0].meals[1].recipe_id == mine
    recipe = store.get({mine})[mine]
    assert {"soy", "gluten"} <= set(recipe.allergens)
    assert recipe.foods == {"white_rice"} and store.unlisted(mine) == ["gochujang"]
    with pytest.raises(SwapError) as e:
        replace_meal(plan, 1, MealType.DINNER, mine, profile(allergies=["soy"]), store)
    assert e.value.problems == ["contains soy"]
    with pytest.raises(SwapError) as e:
        replace_meal(plan, 1, MealType.DINNER, "mine-999", profile(), store)
    assert e.value.status == 404 and "your recipes" in str(e.value)
    needs, _, _ = plan_needs(swapped, store.get({OMELETTE, mine, CURRY}))
    assert "white_rice" in needs
    assert swapped_report({}, swapped, profile(), store)["swaps"] == 1
