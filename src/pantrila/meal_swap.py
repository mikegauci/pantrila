"""Change one meal of a saved plan: another recipe, one of the person's own, leftovers of an
earlier meal, skipped, or eating out.

No model call. Candidates come from the same hard filters as planning and every one is checked
again in code; portions are fitted in code. A client only names the recipe it wants, so what is
saved never depends on numbers or safety claims sent from the browser.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from typing import Literal

from pantrila.backend import Catalog
from pantrila.constraints import (
    MAX_REPEATS,
    Severity,
    check_plan,
    cooked_counts,
    day_nutrition,
    fit_slot_portion,
    pantry_use,
    recipe_problems,
    recipe_violations,
    slot_filters,
    target_miss,
)
from pantrila.cookbook import Cookbook, cookbook_id, plan_recipe
from pantrila.schema import (
    MINE_PREFIX,
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

MAX_OPTIONS = 6
CANDIDATE_POOL = 400  # recipes read from the catalogue before ranking (the corpus has 300)
QUICK_MINUTES = 30  # the "Quick" filter
Source = Literal["corpus", "mine"]


class PlanCatalog:
    """The corpus plus one person's cookbook, so a plan can hold their own recipes as
    `mine-<id>`. Corpus calls pass through; cookbook recipes are derived once per request."""

    def __init__(self, store: Catalog, cookbook: Cookbook):
        self.store, self.cookbook = store, cookbook
        self._mine: dict[int, tuple[Recipe, list[str], str | None] | None] = {}
        self._listed = False

    @property
    def embed_tokens(self) -> int:
        return self.store.embed_tokens

    def search(self, query: str, filters: SearchFilters, limit: int) -> list[str]:
        return self.store.search(query, filters, limit)

    def browse(self, filters: SearchFilters, limit: int) -> list[str]:
        return self.store.browse(filters, limit)

    def _load(self, n: int) -> tuple[Recipe, list[str], str | None] | None:
        if n not in self._mine:
            saved = self.cookbook.get(n)
            made = plan_recipe(saved) if saved else None
            self._mine[n] = (*made, saved.photo_path) if made and saved else None
        return self._mine[n]

    def get(self, ids: Iterable[str]) -> dict[str, Recipe]:
        ids = set(ids)
        out = self.store.get({i for i in ids if not i.startswith(MINE_PREFIX)})
        for i in ids:
            if (n := cookbook_id(i)) is not None and (found := self._load(n)):
                out[i] = found[0]
        return out

    def photos(self, ids: Iterable[str]) -> dict[str, str]:
        ids = set(ids)
        out = self.store.photos({i for i in ids if not i.startswith(MINE_PREFIX)})
        for i in ids:
            if (n := cookbook_id(i)) is not None and (found := self._load(n)) and found[2]:
                out[i] = found[2]
        return out

    def unlisted(self, recipe_id: str) -> list[str]:
        """Names of a cookbook recipe's estimated foods, which the grocery list cannot weigh."""
        n = cookbook_id(recipe_id)
        found = self._load(n) if n is not None else None
        return found[1] if found else []

    def mine(self) -> list[Recipe]:
        """Every cookbook recipe that can be derived, newest first."""
        if not self._listed:
            for saved in self.cookbook.list():
                made = plan_recipe(saved)
                self._mine[saved.id] = (*made, saved.photo_path) if made else None
            self._listed = True
        return [found[0] for found in self._mine.values() if found]


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
    protein_change: float = 0.0


def _slot_problems(recipe: Recipe, profile: UserProfile, slot: MealType) -> list[tuple[str, str]]:
    """Hard-rule problems with eating `recipe` at `slot`. The person's own recipes carry their
    own meal types, so only the food rules apply to them."""
    if recipe.id.startswith(MINE_PREFIX):
        return recipe_problems(recipe, profile)
    return recipe_violations(recipe, profile, slot)


def _matches(recipe: Recipe, words: list[str]) -> bool:
    text = " ".join([recipe.title, recipe.cuisine, *recipe.foods]).replace("_", " ").lower()
    return all(w in text for w in words)


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
    day: PlanDay, m: int, recipe: Recipe, recipes: Mapping[str, Recipe], profile: UserProfile,
    meal: PlannedMeal | None = None,
) -> PlanDay:  # fmt: skip
    """The day with meal `m` replaced by `recipe` (or by `meal`, which eats `recipe`), its
    portions fitted to the day's targets."""
    meal = meal or PlannedMeal(meal_type=day.meals[m].meal_type, recipe_id=recipe.id)
    meal = meal.model_copy(update={"portions": 1.0})
    before, after = list(day.meals[:m]), list(day.meals[m + 1 :])
    trial = day.model_copy(update={"meals": [*before, meal, *after]})
    portions = fit_slot_portion(trial, m, profile, {**recipes, recipe.id: recipe})
    fitted = meal.model_copy(update={"portions": portions})
    return day.model_copy(update={"meals": [*before, fitted, *after]})


def meal_options(
    plan: MealPlan, day: int, meal_type: MealType, profile: UserProfile, store: Catalog,
    limit: int | None = MAX_OPTIONS, *, source: Source = "corpus", query: str = "",
    quick: bool = False, pantry_only: bool = False,
) -> list[MealOption]:  # fmt: skip
    """Recipes that pass the person's rules for this slot, best fit for the day first.

    Best means: closest to the day's nutrition targets, then using the most pantry foods, then
    closest in calories to the meal it replaces. `source` "mine" lists the person's cookbook
    (needs a `PlanCatalog`); `query` keeps recipes whose title, cuisine or foods have every
    word; `quick` keeps those done in 30 minutes; `pantry_only` those using a pantry food.
    `limit` None returns them all.
    """
    d, m = find_meal(plan, day, meal_type)
    plan_day = plan.days[d]
    slot = plan_day.meals[m]
    current_ids = {meal.recipe_id for meal in plan_day.meals if meal.eats_recipe}
    used = cooked_counts(plan)
    if source == "mine":
        if not isinstance(store, PlanCatalog):
            raise SwapError("Your recipes are not available here.", 404)
        ids = [r.id for r in store.mine()]
    else:
        ids = store.browse(slot_filters(profile, meal_type), CANDIDATE_POOL)
    recipes = store.get(set(ids) | current_ids)
    here = recipes.get(slot.recipe_id) if slot.eats_recipe else None
    here_kcal = here.nutrition.kcal * slot.portions if here else (slot.out_kcal or 0.0)
    before = day_nutrition(plan_day, recipes)
    pantry = set(profile.pantry)
    words = query.lower().split()

    ranked = []
    for rid in ids:
        recipe = recipes.get(rid)
        if recipe is None or rid in current_ids or used[rid] >= MAX_REPEATS:
            continue
        if quick and recipe.total_minutes > QUICK_MINUTES:
            continue
        if pantry_only and not recipe.foods & pantry:
            continue
        if words and not _matches(recipe, words):
            continue
        if _slot_problems(recipe, profile, meal_type):
            continue  # the SQL filters are a first pass; code decides
        new_day = _day_with(plan_day, m, recipe, recipes, profile)
        nutrition = day_nutrition(new_day, {**recipes, rid: recipe})
        portions = new_day.meals[m].portions
        overlap = recipe.foods & pantry
        kcal_gap = abs(recipe.nutrition.kcal * portions - here_kcal) / max(here_kcal, 1.0)
        ranked.append((
            (round(target_miss(nutrition, profile), 3), -len(overlap), round(kcal_gap, 3),
             recipe.title, rid),
            MealOption(recipe, portions, nutrition, round(nutrition.kcal - before.kcal, 1),
                       overlap, round(nutrition.protein_g - before.protein_g, 1)),
        ))  # fmt: skip
    ranked.sort(key=lambda pair: pair[0])
    return [option for _, option in ranked[:limit]]


def leftovers_of(plan: MealPlan, day: int, meal_type: MealType) -> list[tuple[int, MealType]]:
    """The meals that are leftovers of the one at (day, meal_type)."""
    return [
        (d, m.meal_type) for d, m in plan.meals
        if m.kind is SlotKind.LEFTOVERS and (m.from_day, m.from_meal) == (day, meal_type)
    ]  # fmt: skip


def _refit(
    plan: MealPlan, targets: list[tuple[int, MealType]], recipe: Recipe, profile: UserProfile,
    store: Catalog,
) -> MealPlan:  # fmt: skip
    """The plan with each target meal (leftovers) now eating `recipe`, portions refitted."""
    days = list(plan.days)
    for day, meal_type in targets:
        d, m = find_meal(plan, day, meal_type)
        meal = days[d].meals[m].model_copy(update={"recipe_id": recipe.id})
        recipes = store.get({x.recipe_id for x in days[d].meals if x.eats_recipe})
        days[d] = _day_with(days[d], m, recipe, recipes, profile, meal)
    return plan.model_copy(update={"days": days})


def _blocked_by_leftovers(plan: MealPlan, day: int, meal_type: MealType) -> None:
    if found := leftovers_of(plan, day, meal_type):
        where = ", ".join(f"day {d} {m}" for d, m in found)
        raise SwapError(f"{where.capitalize()} is leftovers of this meal. Change that first.")


def replace_meal(
    plan: MealPlan, day: int, meal_type: MealType, recipe_id: str, profile: UserProfile,
    store: Catalog,
) -> MealPlan:  # fmt: skip
    """The plan with that meal swapped, or a SwapError if the recipe is not allowed there."""
    d, m = find_meal(plan, day, meal_type)
    plan_day = plan.days[d]
    slot = plan_day.meals[m]
    if slot.kind is SlotKind.RECIPE and recipe_id == slot.recipe_id:
        raise SwapError("That is already the meal in this slot.")
    recipes = store.get({recipe_id} | {meal.recipe_id for meal in plan_day.meals})
    recipe = _allowed(recipes.get(recipe_id), recipe_id, profile, meal_type)
    days = list(plan.days)
    days[d] = _day_with(plan_day, m, recipe, recipes, profile)
    # Leftovers of this meal follow it to the new recipe: they are what was cooked here.
    return _refit(plan.model_copy(update={"days": days}), leftovers_of(plan, day, meal_type),
                  recipe, profile, store)  # fmt: skip


def _allowed(
    recipe: Recipe | None, recipe_id: str, profile: UserProfile, slot: MealType,
    leftovers: bool = False,
) -> Recipe:  # fmt: skip
    """`recipe` if the person may eat it at `slot`, else a SwapError saying why."""
    if recipe is None:
        mine = recipe_id.startswith(MINE_PREFIX)
        raise SwapError(f"That recipe is not in {'your' if mine else 'Pantrila’s'} recipes.", 404)
    problems = recipe_problems(recipe, profile) if leftovers else _slot_problems(
        recipe, profile, slot)  # fmt: skip
    if problems:
        raise SwapError(
            "That recipe does not suit your rules.", 422,
            [msg.removeprefix(f"{recipe.id} ") for _, msg in problems],
        )  # fmt: skip
    return recipe


def set_slot(
    plan: MealPlan, day: int, meal_type: MealType, kind: SlotKind, profile: UserProfile,
    store: Catalog, *, out_kcal: float | None = None, from_day: int | None = None,
    from_meal: MealType | None = None,
) -> MealPlan:  # fmt: skip
    """The plan with one meal skipped, eaten out, made leftovers of an earlier meal, or (kind
    `recipe`) back to the recipe planned there.

    Skipping keeps the meal's recipe so it can be added back; nothing of it is bought or
    counted. A meal other meals are leftovers of cannot stop being cooked until they change.
    """
    d, m = find_meal(plan, day, meal_type)
    plan_day = plan.days[d]
    slot = plan_day.meals[m]
    if kind is not SlotKind.RECIPE:
        _blocked_by_leftovers(plan, day, meal_type)
    days = list(plan.days)
    if kind in (SlotKind.SKIPPED, SlotKind.EATING_OUT):
        if kind is slot.kind and kind is SlotKind.SKIPPED:
            raise SwapError("This meal is already skipped.")
        meal = slot.model_copy(update={
            "kind": kind, "from_day": None, "from_meal": None,
            "out_kcal": out_kcal if kind is SlotKind.EATING_OUT else None,
        })  # fmt: skip
        days[d] = plan_day.model_copy(
            update={"meals": [*plan_day.meals[:m], meal, *plan_day.meals[m + 1 :]]}
        )
        return plan.model_copy(update={"days": days})

    if kind is SlotKind.RECIPE:
        if slot.kind is SlotKind.RECIPE:
            raise SwapError("This meal is already planned.")
        recipe_id, meal = slot.recipe_id, None
    else:  # leftovers
        if from_day is None or from_meal is None:
            raise SwapError("Say which meal these are leftovers of.")
        if from_day >= day:
            raise SwapError("Leftovers come from a meal on an earlier day.")
        sd, sm = find_meal(plan, from_day, from_meal)
        source = plan.days[sd].meals[sm]
        if source.kind is not SlotKind.RECIPE:
            raise SwapError("Leftovers come from a meal you cook.")
        recipe_id = source.recipe_id
        meal = PlannedMeal(meal_type=meal_type, recipe_id=recipe_id, kind=SlotKind.LEFTOVERS,
                           from_day=from_day, from_meal=from_meal)  # fmt: skip
    recipes = store.get({recipe_id} | {x.recipe_id for x in plan_day.meals if x.eats_recipe})
    recipe = _allowed(recipes.get(recipe_id), recipe_id, profile, meal_type,
                      leftovers=kind is SlotKind.LEFTOVERS)  # fmt: skip
    days[d] = _day_with(plan_day, m, recipe, recipes, profile, meal)
    return plan.model_copy(update={"days": days})


MAX_REPEATS_AT_ONCE = 12  # later meals one "Repeat on" can turn into leftovers


def repeat_meal(
    plan: MealPlan, day: int, meal_type: MealType, targets: list[tuple[int, MealType]],
    profile: UserProfile, store: Catalog,
) -> MealPlan:  # fmt: skip
    """Cook once, eat again: every target meal becomes leftovers of the meal at (day,
    meal_type). All of them change or none does; each passes the same checks as `set_slot`.
    A target that is already its leftovers just has its portions refitted."""
    if not targets:
        raise SwapError("Pick at least one meal to repeat it on.")
    if len(set(targets)) != len(targets) or len(targets) > MAX_REPEATS_AT_ONCE:
        raise SwapError(f"Pick up to {MAX_REPEATS_AT_ONCE} different meals.")
    d, m = find_meal(plan, day, meal_type)
    if plan.days[d].meals[m].kind is not SlotKind.RECIPE:
        raise SwapError("Only a meal you cook can be repeated.")
    for target_day, target_meal in sorted(targets):
        plan = set_slot(plan, target_day, target_meal, SlotKind.LEFTOVERS, profile, store,
                        from_day=day, from_meal=meal_type)  # fmt: skip
    return plan


def swapped_report(
    report: dict, plan: MealPlan, profile: UserProfile, store: Catalog
) -> dict:  # fmt: skip
    """The saved planner report with what a swap can change recomputed from the new plan.

    Model cost, latency and the planner's path stay as they were: they describe how the week
    was planned. Warnings (missed targets) and pantry use describe the plan as it is now.
    """
    recipes = store.get({meal.recipe_id for _, meal in plan.meals if meal.eats_recipe})
    soft = [v for v in check_plan(plan, profile, recipes) if v.severity is Severity.SOFT]
    return {
        **report,
        "warnings": [str(v) for v in soft],
        "pantry_use": round(pantry_use(plan, profile, recipes), 3),
        "swaps": int(report.get("swaps", 0)) + 1,
    }
