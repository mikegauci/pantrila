"""Grocery list: what a meal plan needs, minus what the pantry already has.

Everything is in grams (the recipes are normalised in code), summed per food across the plan,
scaled by portions and people, then turned back into shop amounts: pieces for foods recipes
count, ml or spoons for foods recipes measure by volume, grams otherwise.
"""

from __future__ import annotations

import math
from collections import defaultdict
from collections.abc import Mapping

from pantrila.foods import ML_PER_UNIT, load_foods
from pantrila.schema import GroceryItem, GroceryList, MealPlan, PantryItem, Recipe, Unit

# Walking order through a typical supermarket; unknown aisles go last.
AISLE_ORDER = [
    "produce", "herbs", "bakery", "meat", "seafood", "dairy", "chilled", "frozen", "grains",
    "dried_goods", "canned", "nuts_seeds", "baking", "spices", "oils_condiments", "drinks",
]  # fmt: skip
AISLE_NAMES = {"nuts_seeds": "Nuts and seeds", "oils_condiments": "Oils and condiments"}
NOT_BOUGHT = {"tap"}  # water
EPSILON_G = 0.5  # a pantry food with less than this left to buy counts as covered


def plan_needs(
    plan: MealPlan, recipes: Mapping[str, Recipe], people: int = 1
) -> tuple[dict[str, float], dict[str, set[Unit]], dict[str, list[str]]]:
    """Grams per food the plan uses, the units recipes measure each food in, and which recipes
    use it (in plan order)."""
    grams: dict[str, float] = defaultdict(float)
    units: dict[str, set[Unit]] = defaultdict(set)
    used_by: dict[str, list[str]] = defaultdict(list)
    for _, meal in plan.meals:
        if not meal.eats_recipe:  # skipped or eating out: nothing to buy
            continue
        r = recipes[meal.recipe_id]
        for ing in r.ingredients:
            grams[ing.food] += ing.grams / r.servings * meal.portions * people
            units[ing.food].add(ing.unit)
            if r.id not in used_by[ing.food]:
                used_by[ing.food].append(r.id)
    return dict(grams), dict(units), dict(used_by)


def shop_amount(food: str, grams: float, units: set[Unit]) -> str:
    """Grams as a shop amount, rounded up so the cook never runs short."""
    f = load_foods()[food]
    if Unit.PIECE in units and f.grams_per_piece:
        n = math.ceil(grams / f.grams_per_piece - 0.05)
        return f"{max(n, 1)} piece{'s' if n > 1 else ''}"
    if units & set(ML_PER_UNIT) and f.grams_per_ml:
        ml = grams / f.grams_per_ml
        if ml < ML_PER_UNIT[Unit.TBSP]:
            return f"{math.ceil(ml / ML_PER_UNIT[Unit.TSP] - 0.05)} tsp"
        if ml < 60:
            return f"{math.ceil(ml / ML_PER_UNIT[Unit.TBSP] - 0.05)} tbsp"
        if units & {Unit.ML, Unit.L}:  # a liquid; spooned foods like spices go by weight
            return f"{math.ceil(ml / 10) * 10} ml"
    if grams < 20:
        return f"{math.ceil(grams)} g"
    return f"{math.ceil(grams / 10) * 10} g"


def grocery_list(
    plan: MealPlan,
    recipes: Mapping[str, Recipe],
    pantry: list[PantryItem] = (),
    people: int = 1,
) -> GroceryList:
    """Foods to buy for the plan, by aisle. A pantry item without a quantity covers the food
    fully; one with a quantity covers that many grams."""
    if people < 1:
        raise ValueError("people must be at least 1")
    foods = load_foods()
    have = {i.food: i.grams for i in pantry}
    need, units, used_by = plan_needs(plan, recipes, people)
    items, covered = [], []
    for food, need_g in need.items():
        aisle = foods[food].aisle
        if aisle in NOT_BOUGHT:
            continue
        if food in have:
            have_g = need_g if have[food] is None else min(have[food], need_g)
        else:
            have_g = 0.0
        buy_g = max(0.0, need_g - have_g)
        is_covered = food in have and buy_g < EPSILON_G
        item = GroceryItem(
            food=food,
            aisle=aisle,
            need_g=round(need_g, 1),
            have_g=round(have_g, 1),
            buy_g=round(buy_g, 1),
            amount=shop_amount(food, need_g if is_covered else buy_g, units[food]),
            recipes=used_by[food],
        )
        (covered if is_covered else items).append(item)

    def order(i: GroceryItem):
        rank = AISLE_ORDER.index(i.aisle) if i.aisle in AISLE_ORDER else len(AISLE_ORDER)
        return rank, i.aisle, i.food

    return GroceryList(people=people, items=sorted(items, key=order),
                       covered=sorted(covered, key=order))  # fmt: skip


def grocery_text(g: GroceryList) -> str:
    lines, aisle = [], None
    for i in g.items:
        if i.aisle != aisle:
            aisle = i.aisle
            lines.append(f"{AISLE_NAMES.get(aisle, aisle.replace('_', ' ').capitalize())}:")
        have = f" (have {i.have_g:.0f} g)" if i.have_g else ""
        lines.append(f"  {i.food.replace('_', ' ')}: {i.amount}{have}")
    if g.covered:
        lines.append("From your pantry: " + ", ".join(i.food.replace("_", " ") for i in g.covered))
    return "\n".join(lines) or "nothing to buy"
