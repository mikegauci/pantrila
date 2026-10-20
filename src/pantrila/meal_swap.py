"""Swap one meal of a saved plan for another recipe.

No model call. Candidates come from the same hard filters as planning and every one is checked
again in code; portions are fitted in code. A client only names the recipe it wants, so what is
saved never depends on numbers or safety claims sent from the browser.
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Mapping
from dataclasses import dataclass, field

from pantrila.backend import Catalog
from pantrila.constraints import (
    MAX_REPEATS,
    Severity,
    check_plan,
    day_nutrition,
    fit_slot_portion,
    pantry_use,
    recipe_violations,
    slot_filters,
    target_miss,
)
from pantrila.schema import (
    MealPlan,
    MealType,
    NutritionFacts,
    PlanDay,
    PlannedMeal,
    Recipe,
    UserProfile,
)

MAX_OPTIONS = 6
CANDIDATE_POOL = 400  # recipes read from the catalogue before ranking (the corpus has 300)


class SwapError(ValueError):
    """Why a swap cannot happen, with the HTTP status the API answers with."""

    def __init__(self, message: str, status: int = 422, problems: list[str] | None = None):
        super().__init__(message)
        self.status = status
        self.problems = problems or []


@dataclass
class MealOption:
    recipe: Recipe
    portions: float
    day_nutrition: NutritionFacts  # the day's total per person with this meal
    kcal_change: float  # against the meal it would replace
    pantry_foods: set[str] = field(default_factory=set)


def find_meal(plan: MealPlan, day: int, meal_type: MealType) -> tuple[int, int]:
    """Indexes of the day and of the meal in it."""
    for d, plan_day in enumerate(plan.days):
        if plan_day.day != day:
            continue
        for m, meal in enumerate(plan_day.meals):
            if meal.meal_type == meal_type:
                return d, m
    raise SwapError(f"Day {day} has no {meal_type} in this plan.", 404)


def _day_with(
    day: PlanDay, m: int, recipe: Recipe, recipes: Mapping[str, Recipe], profile: UserProfile
) -> PlanDay:  # fmt: skip
    """The day with meal `m` replaced by `recipe`, its portions fitted to the day's targets."""
    meal = PlannedMeal(meal_type=day.meals[m].meal_type, recipe_id=recipe.id, portions=1.0)
    before, after = list(day.meals[:m]), list(day.meals[m + 1 :])
    trial = day.model_copy(update={"meals": [*before, meal, *after]})
    portions = fit_slot_portion(trial, m, profile, {**recipes, recipe.id: recipe})
    fitted = meal.model_copy(update={"portions": portions})
    return day.model_copy(update={"meals": [*before, fitted, *after]})


def meal_options(
    plan: MealPlan, day: int, meal_type: MealType, profile: UserProfile, store: Catalog,
    limit: int = MAX_OPTIONS,
) -> list[MealOption]:  # fmt: skip
    """Recipes that pass the person's rules for this slot, best fit for the day first.

    Best means: closest to the day's nutrition targets, then using the most pantry foods, then
    closest in calories to the meal it replaces.
    """
    d, m = find_meal(plan, day, meal_type)
    plan_day = plan.days[d]
    current_ids = {meal.recipe_id for meal in plan_day.meals}
    used = Counter(meal.recipe_id for _, meal in plan.meals)
    ids = store.browse(slot_filters(profile, meal_type), CANDIDATE_POOL)
    recipes = store.get(set(ids) | current_ids)
    here = recipes.get(plan_day.meals[m].recipe_id)
    here_kcal = here.nutrition.kcal * plan_day.meals[m].portions if here else 0.0
    before = day_nutrition(plan_day, recipes).kcal
    pantry = set(profile.pantry)

    ranked = []
    for rid in ids:
        recipe = recipes.get(rid)
        if recipe is None or rid in current_ids or used[rid] >= MAX_REPEATS:
            continue
        if recipe_violations(recipe, profile, meal_type):
            continue  # the SQL filters are a first pass; code decides
        new_day = _day_with(plan_day, m, recipe, recipes, profile)
        nutrition = day_nutrition(new_day, {**recipes, rid: recipe})
        portions = new_day.meals[m].portions
        overlap = recipe.foods & pantry
        kcal_gap = abs(recipe.nutrition.kcal * portions - here_kcal) / max(here_kcal, 1.0)
        ranked.append((
            (round(target_miss(nutrition, profile), 3), -len(overlap), round(kcal_gap, 3),
             recipe.title, rid),
            MealOption(recipe, portions, nutrition, round(nutrition.kcal - before, 1), overlap),
        ))  # fmt: skip
    ranked.sort(key=lambda pair: pair[0])
    return [option for _, option in ranked[:limit]]


def replace_meal(
    plan: MealPlan, day: int, meal_type: MealType, recipe_id: str, profile: UserProfile,
    store: Catalog,
) -> MealPlan:  # fmt: skip
    """The plan with that meal swapped, or a SwapError if the recipe is not allowed there."""
    d, m = find_meal(plan, day, meal_type)
    plan_day = plan.days[d]
    if recipe_id == plan_day.meals[m].recipe_id:
        raise SwapError("That is already the meal in this slot.")
    recipes = store.get({recipe_id} | {meal.recipe_id for meal in plan_day.meals})
    recipe = recipes.get(recipe_id)
    if recipe is None:
        raise SwapError("That recipe is not in Pantrila's recipes.", 404)
    if problems := recipe_violations(recipe, profile, meal_type):
        raise SwapError(
            "That recipe does not suit your rules.", 422,
            [msg.removeprefix(f"{recipe.id} ") for _, msg in problems],
        )  # fmt: skip
    days = list(plan.days)
    days[d] = _day_with(plan_day, m, recipe, recipes, profile)
    return plan.model_copy(update={"days": days})


def swapped_report(
    report: dict, plan: MealPlan, profile: UserProfile, store: Catalog
) -> dict:  # fmt: skip
    """The saved planner report with what a swap can change recomputed from the new plan.

    Model cost, latency and the planner's path stay as they were: they describe how the week
    was planned. Warnings (missed targets) and pantry use describe the plan as it is now.
    """
    recipes = store.get({meal.recipe_id for _, meal in plan.meals})
    soft = [v for v in check_plan(plan, profile, recipes) if v.severity is Severity.SOFT]
    return {
        **report,
        "warnings": [str(v) for v in soft],
        "pantry_use": round(pantry_use(plan, profile, recipes), 3),
        "swaps": int(report.get("swaps", 0)) + 1,
    }
