from collections import Counter

import pytest

from pantrio.constraints import (
    PORTION_STEPS,
    Severity,
    check_plan,
    day_nutrition,
    fit_portions,
    hard_violations,
    pantry_use,
    recipe_violations,
    slot_filters,
)
from pantrio.schema import (
    Allergen,
    DietTag,
    MealPlan,
    MealType,
    NutritionTargets,
    PlanDay,
    PlannedMeal,
    UserProfile,
)

B, L, D = MealType.BREAKFAST, MealType.LUNCH, MealType.DINNER


@pytest.fixture
def recipes(corpus):
    return {r.id: r for r in corpus}


def plan(*days: list[tuple[MealType, str]]) -> MealPlan:
    return MealPlan(
        days=[
            PlanDay(day=i, meals=[PlannedMeal(meal_type=m, recipe_id=r) for m, r in meals])
            for i, meals in enumerate(days, start=1)
        ]
    )


def profile(**kw) -> UserProfile:
    return UserProfile(days=kw.pop("days", 1), meals=kw.pop("meals", [B, D]), **kw)


def rules(violations):
    return sorted(v.rule for v in violations)


def test_slot_filters_carry_the_hard_rules():
    p = profile(
        allergies=[Allergen.PEANUTS], diets=[DietTag.VEGAN], max_minutes=30,
        exclude_foods=["mushroom"],
    )  # fmt: skip
    f = slot_filters(p, L)
    assert f.exclude_allergens == [Allergen.PEANUTS]
    assert f.require_diets == [DietTag.VEGAN]
    assert f.max_minutes == 30
    assert f.exclude_foods == ["mushroom"]
    assert f.meal_types == [L, D]  # dinner recipes can be lunch


def test_clean_plan_has_no_violations(recipes):
    p = profile(days=2)
    ok = plan(
        [(B, "french-mushroom-omelette"), (D, "greek-lemon-chicken")],
        [(B, "french-mushroom-omelette"), (D, "indian-chickpea-curry")],
    )
    assert check_plan(ok, p, recipes) == []


def test_allergens_are_rederived_not_trusted(recipes):
    # A recipe whose stored allergen list was emptied is still caught from its ingredients.
    tampered = recipes["italian-salmon-pasta"].model_copy(update={"allergens": []})
    p = profile(allergies=[Allergen.FISH])
    assert [r for r, _ in recipe_violations(tampered, p, D)] == ["allergen"]


def test_diet_tags_are_rederived_not_trusted(recipes):
    tampered = recipes["greek-lemon-chicken"].model_copy(update={"diet_tags": [DietTag.VEGAN]})
    p = profile(diets=[DietTag.VEGAN])
    assert [r for r, _ in recipe_violations(tampered, p, D)] == ["diet"]


def test_every_hard_rule(recipes):
    p = profile(
        allergies=[Allergen.PEANUTS], diets=[DietTag.VEGETARIAN], max_minutes=30,
        exclude_foods=["mushroom"],
    )  # fmt: skip
    bad = plan([(B, "french-mushroom-omelette"), (D, "greek-lemon-chicken")])
    assert rules(check_plan(bad, p, recipes)) == ["diet", "excluded_food", "time"]
    assert rules(check_plan(plan([(B, "x"), (D, "thai-peanut-noodles")]), p, recipes)) == [
        "allergen", "unknown_recipe",
    ]  # fmt: skip
    wrong_slot = plan([(B, "indian-chickpea-curry"), (D, "indian-chickpea-curry")])
    assert "meal_type" in rules(check_plan(wrong_slot, profile(), recipes))


def test_structure_and_portions(recipes):
    p = profile(days=2)
    one_day = plan([(B, "french-mushroom-omelette"), (D, "greek-lemon-chicken")])
    assert rules(check_plan(one_day, p, recipes)) == ["structure"]
    missing_meal = plan([(D, "greek-lemon-chicken")], [(B, "x"), (D, "y")])
    assert "structure" in rules(check_plan(missing_meal, p, recipes))
    big = one_day.model_copy(deep=True)
    big.days[0].meals[0].portions = 3
    assert "portions" in rules(check_plan(big, profile(), recipes))
    assert all(v.severity is Severity.HARD for v in check_plan(missing_meal, p, recipes))


def test_soft_rules(recipes):
    p = profile(
        days=3, meals=[D],
        targets=NutritionTargets(kcal=5000, min_protein_g=200, max_carbs_g=10),
    )  # fmt: skip
    pasta = plan(*[[(D, "italian-salmon-pasta")]] * 3)
    v = check_plan(pasta, p, recipes)
    assert hard_violations(v) == []
    assert rule_counts(v) == {"kcal": 3, "protein": 3, "carbs": 3, "variety": 1}


def test_fit_portions_hits_the_energy_target(recipes):
    meals = [(B, "french-mushroom-omelette"), (D, "greek-lemon-chicken")]
    base = day_nutrition(plan(meals).days[0], recipes).kcal
    target = round(base * 1.4)
    p = profile(targets=NutritionTargets(kcal=target))
    fitted = fit_portions(plan(meals), p, recipes)
    assert all(m.portions in PORTION_STEPS for _, m in fitted.meals)
    assert abs(day_nutrition(fitted.days[0], recipes).kcal - target) <= 0.1 * target
    assert check_plan(fitted, p, recipes) == []


def test_fit_portions_without_targets_is_a_no_op(recipes):
    original = plan([(B, "french-mushroom-omelette"), (D, "greek-lemon-chicken")])
    assert fit_portions(original, profile(), recipes) == original


def test_pantry_use(recipes):
    p = profile(pantry=["egg", "lemon", "tofu"])
    used = plan([(B, "french-mushroom-omelette"), (D, "greek-lemon-chicken")])
    assert pantry_use(used, p, recipes) == pytest.approx(2 / 3)
    assert pantry_use(used, profile(), recipes) == 1.0


def rule_counts(violations):
    return dict(Counter(v.rule for v in violations))
