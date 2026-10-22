"""Deterministic plan checks: the single source of truth for "is this plan safe and valid".

The model proposes recipes; this module decides. Hard violations (allergens, diets, excluded
foods, time limit, wrong meal, malformed plan, unknown recipe) mean the plan is never shown to
the user. Soft violations (nutrition targets, repeats) are goals: the planner tries to repair
them and reports any that remain.

Allergens and diets are re-derived from each recipe's ingredients here rather than trusted
from the stored tags, and the stricter of the two is used.
"""

from __future__ import annotations

import itertools
from collections import Counter
from collections.abc import Mapping
from dataclasses import dataclass
from enum import StrEnum

from pantrila.foods import derive_allergens, derive_ingredient_diets
from pantrila.nutrition import nutrition_diets
from pantrila.schema import (
    MINE_PREFIX,
    Allergen,
    DietTag,
    MealPlan,
    MealType,
    NutritionFacts,
    PlanDay,
    PlannedMeal,
    Recipe,
    SlotKind,
    UserProfile,
)
from pantrila.search import SearchFilters

# Which recipe meal types can fill each slot in a plan.
SLOT_MEALS: dict[MealType, list[MealType]] = {
    MealType.BREAKFAST: [MealType.BREAKFAST],
    MealType.LUNCH: [MealType.LUNCH, MealType.DINNER],
    MealType.DINNER: [MealType.DINNER, MealType.LUNCH],
    MealType.SNACK: [MealType.SNACK, MealType.DESSERT],
    MealType.DESSERT: [MealType.DESSERT, MealType.SNACK],
}

PORTION_STEPS = (0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0)
KCAL_TOLERANCE = 0.10  # daily energy within +/-10% of the target
MAX_REPEATS = 2  # the same recipe at most twice a week (cook once, eat the leftovers)


class Severity(StrEnum):
    HARD = "hard"
    SOFT = "soft"


@dataclass(frozen=True)
class Violation:
    rule: str
    severity: Severity
    message: str
    day: int | None = None
    meal: MealType | None = None

    def __str__(self) -> str:
        where = " ".join(p for p in (self.day and f"day {self.day}", self.meal) if p)
        return f"{where}: {self.message}" if where else self.message


def slot_filters(profile: UserProfile, slot: MealType) -> SearchFilters:
    """The hard rules as search filters, so retrieval only ever offers safe recipes."""
    return SearchFilters(
        exclude_allergens=profile.allergies,
        require_diets=profile.diets,
        max_minutes=profile.max_minutes,
        meal_types=SLOT_MEALS[slot],
        exclude_foods=profile.exclude_foods,
    )


def recipe_allergens(recipe: Recipe) -> set[Allergen]:
    return set(recipe.allergens) | derive_allergens(recipe.foods)


def recipe_diets(recipe: Recipe) -> set[DietTag]:
    derived = derive_ingredient_diets(recipe.foods) | nutrition_diets(recipe.nutrition)
    return set(recipe.diet_tags) & derived


def recipe_violations(
    recipe: Recipe, profile: UserProfile, slot: MealType
) -> list[tuple[str, str]]:
    """Hard-rule problems, as (rule, message), with putting this recipe in this slot."""
    out = recipe_problems(recipe, profile)
    if not set(recipe.meal_types) & set(SLOT_MEALS[slot]):
        out.append(("meal_type", f"{recipe.id} is not a {slot} recipe"))
    return out


def recipe_problems(recipe: Recipe, profile: UserProfile) -> list[tuple[str, str]]:
    """Hard-rule problems, as (rule, message), with this person eating this recipe at all."""
    try:
        allergens, diets = recipe_allergens(recipe), recipe_diets(recipe)
    except KeyError as exc:
        return [("unverifiable", f"{recipe.id} uses {exc}, which is not in the ingredient table")]
    return rule_problems(recipe.id, allergens, diets, recipe.foods, recipe.total_minutes, profile)


def rule_problems(
    name: str,
    allergens: set[Allergen],
    diets: set[DietTag],
    foods: set[str],
    minutes: int,
    profile: UserProfile,
) -> list[tuple[str, str]]:
    """The hard rules a dish with these derived facts breaks for this person."""
    out = []
    if bad := allergens & set(profile.allergies):
        out.append(("allergen", f"{name} contains {', '.join(sorted(bad))}"))
    if missing := set(profile.diets) - diets:
        out.append(("diet", f"{name} is not {', '.join(sorted(missing))}"))
    if bad := foods & set(profile.exclude_foods):
        out.append(("excluded_food", f"{name} uses {', '.join(sorted(bad))}"))
    if profile.max_minutes is not None and minutes > profile.max_minutes:
        out.append(("time", f"{name} takes {minutes} min (limit {profile.max_minutes})"))
    return out


def meal_facts(m: PlannedMeal, recipes: Mapping[str, Recipe]) -> dict[str, float]:
    """What one meal adds to its day, per person. A skipped meal adds nothing; eating out adds
    only the person's energy estimate (protein and carbs are not known)."""
    if m.kind is SlotKind.EATING_OUT:
        return {"kcal": m.out_kcal or 0.0}
    if m.eats_recipe and (r := recipes.get(m.recipe_id)):
        return {f: getattr(r.nutrition, f) * m.portions for f in NutritionFacts.model_fields}
    return {}


def day_nutrition(day: PlanDay, recipes: Mapping[str, Recipe]) -> NutritionFacts:
    totals = dict.fromkeys(NutritionFacts.model_fields, 0.0)
    for m in day.meals:
        for f, v in meal_facts(m, recipes).items():
            totals[f] += v
    return NutritionFacts(**{k: round(v, 1) for k, v in totals.items()})


def _target_cost(n: dict[str, float], profile: UserProfile) -> float:
    t = profile.targets
    cost = 0.0
    if t.kcal_range:  # anywhere inside the range is as good as anywhere else
        if t.min_kcal:
            cost += max(0.0, t.min_kcal - n["kcal"]) / t.min_kcal
        if t.max_kcal:
            cost += max(0.0, n["kcal"] - t.max_kcal) / t.max_kcal
    elif t.kcal:
        cost += abs(n["kcal"] - t.kcal) / t.kcal
    if t.min_protein_g:
        cost += max(0.0, t.min_protein_g - n["protein_g"]) / t.min_protein_g
    if t.max_carbs_g:
        cost += max(0.0, n["carbs_g"] - t.max_carbs_g) / t.max_carbs_g
    return cost


def target_miss(n: NutritionFacts, profile: UserProfile) -> float:
    """How far a day's nutrition is from the person's targets; 0 when it meets them all."""
    return _target_cost(n.model_dump(), profile)


def fit_slot_portion(
    day: PlanDay, index: int, profile: UserProfile, recipes: Mapping[str, Recipe]
) -> float:
    """Portions for one meal of a day that bring the day closest to the targets, with the
    day's other meals left as they are. Ties go to a normal portion; 1.0 without targets."""
    t = profile.targets
    if not t.any:
        return 1.0
    base = dict.fromkeys(("kcal", "protein_g", "carbs_g"), 0.0)
    for i, m in enumerate(day.meals):
        if i != index:
            for f, v in meal_facts(m, recipes).items():
                if f in base:
                    base[f] += v
    facts = recipes[day.meals[index].recipe_id].nutrition

    def cost(p: float) -> float:
        n = {f: base[f] + getattr(facts, f) * p for f in base}
        return _target_cost(n, profile) + 0.001 * abs(p - 1)

    return min(PORTION_STEPS, key=cost)


def fit_portions(plan: MealPlan, profile: UserProfile, recipes: Mapping[str, Recipe]) -> MealPlan:
    """Choose portions (0.5 to 2 servings, in quarters) per meal to bring each day closest to
    the targets. Exhaustive over at most 7^5 combinations a day; ties go to normal portions."""
    # Model output is untrusted: malformed structure must reach the checker without
    # starting a 7**N search over an arbitrary number of meals.
    if sorted(d.day for d in plan.days) != list(range(1, profile.days + 1)) or any(
        Counter(m.meal_type for m in d.meals) != Counter(profile.meals)
        or len(d.meals) > len(MealType)
        for d in plan.days
    ):
        return plan
    if not profile.targets.any:
        return plan
    days = []
    for day in plan.days:
        known = [i for i, m in enumerate(day.meals) if m.eats_recipe and m.recipe_id in recipes]
        best, best_cost = None, float("inf")
        for combo in itertools.product(PORTION_STEPS, repeat=len(known)):
            n = dict.fromkeys(("kcal", "protein_g", "carbs_g"), 0.0)
            for i, p in zip(known, combo, strict=True):
                facts = recipes[day.meals[i].recipe_id].nutrition
                for f in n:
                    n[f] += getattr(facts, f) * p
            cost = _target_cost(n, profile) + 0.001 * sum(abs(p - 1) for p in combo)
            if cost < best_cost - 1e-12:
                best, best_cost = combo, cost
        portions = dict(zip(known, best or (), strict=True))
        meals = [
            m.model_copy(update={"portions": portions.get(i, m.portions)})
            for i, m in enumerate(day.meals)
        ]
        days.append(day.model_copy(update={"meals": meals}))
    return plan.model_copy(update={"days": days})


def check_plan(
    plan: MealPlan, profile: UserProfile, recipes: Mapping[str, Recipe]
) -> list[Violation]:
    """Every rule the plan breaks. `recipes` must come from the trusted corpus, not the model."""
    out: list[Violation] = []

    def hard(rule, msg, day=None, meal=None):
        out.append(Violation(rule, Severity.HARD, msg, day, meal))

    def soft(rule, msg, day=None, meal=None):
        out.append(Violation(rule, Severity.SOFT, msg, day, meal))

    if sorted(d.day for d in plan.days) != list(range(1, profile.days + 1)):
        hard("structure", f"plan must have days 1 to {profile.days}, one each")
    for day in plan.days:
        slots = Counter(m.meal_type for m in day.meals)
        if slots != Counter(profile.meals):
            hard("structure", f"meals must be exactly {', '.join(profile.meals)}", day.day)
        for m in day.meals:
            if not m.eats_recipe:
                continue  # skipped or eating out: nothing of Pantrila's is eaten
            recipe = recipes.get(m.recipe_id)
            if recipe is None:
                hard("unknown_recipe", f"{m.recipe_id!r} is not a known recipe", day.day,
                     m.meal_type)  # fmt: skip
                continue
            # Leftovers may be eaten at any meal; the person's own recipes carry their own
            # meal types. Both still pass every food rule.
            free_slot = m.kind is SlotKind.LEFTOVERS or m.recipe_id.startswith(MINE_PREFIX)
            check = (
                recipe_problems(recipe, profile)
                if free_slot
                else recipe_violations(recipe, profile, m.meal_type)
            )
            for rule, msg in check:
                hard(rule, msg, day.day, m.meal_type)
            if not PORTION_STEPS[0] <= m.portions <= PORTION_STEPS[-1]:
                hard("portions", f"{m.portions} portions is outside 0.5-2", day.day, m.meal_type)
        if any(c > 1 for c in Counter(m.recipe_id for m in day.meals if m.eats_recipe).values()):
            soft("variety", "the same recipe twice in one day", day.day)

        t = profile.targets
        n = day_nutrition(day, recipes)
        if t.kcal_range:
            if (t.min_kcal and n.kcal < t.min_kcal) or (t.max_kcal and n.kcal > t.max_kcal):
                soft("kcal", f"{n.kcal:.0f} kcal, target {t.kcal_text()}", day.day)
        elif t.kcal and abs(n.kcal - t.kcal) > KCAL_TOLERANCE * t.kcal:
            soft("kcal", f"{n.kcal:.0f} kcal, target {t.kcal:.0f} +/-10%", day.day)
        if t.min_protein_g and n.protein_g < t.min_protein_g:
            soft("protein", f"{n.protein_g:.0f} g protein, need {t.min_protein_g:.0f}", day.day)
        if t.max_carbs_g and n.carbs_g > t.max_carbs_g:
            soft("carbs", f"{n.carbs_g:.0f} g carbs, limit {t.max_carbs_g:.0f}", day.day)

    for rid, count in cooked_counts(plan).items():
        if count > MAX_REPEATS and rid in recipes:
            soft("variety", f"{rid} appears {count} times (limit {MAX_REPEATS})")
    return out


def cooked_counts(plan: MealPlan) -> Counter[str]:
    """How often each recipe is cooked. Leftovers are the same cooking, so they do not count
    towards the repeat limit; skipped meals and eating out are not cooked."""
    return Counter(m.recipe_id for _, m in plan.meals if m.kind is SlotKind.RECIPE)


def hard_violations(violations: list[Violation]) -> list[Violation]:
    return [v for v in violations if v.severity is Severity.HARD]


def pantry_use(plan: MealPlan, profile: UserProfile, recipes: Mapping[str, Recipe]) -> float:
    """Share of the pantry foods the plan uses at least once (1.0 when the pantry is empty)."""
    if not profile.pantry:
        return 1.0
    plan_foods = [recipes[m.recipe_id].foods for _, m in plan.meals
                  if m.eats_recipe and m.recipe_id in recipes]  # fmt: skip
    used = set().union(*plan_foods)
    return len(used & set(profile.pantry)) / len(set(profile.pantry))
