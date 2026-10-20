"""Ingredient swaps, decided in code.

A swap replaces every use of one food in a recipe with the same weight of another, then
re-derives nutrition, allergens and diets exactly as the corpus pipeline does, and checks the
result against the person's hard rules. Suggestions come from foods that play the same part
(same aisle, or any protein for a protein) ranked by how close their nutrition is per 100 g.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from pantrio.constraints import recipe_problems
from pantrio.foods import derive_allergens, derive_ingredient_diets, load_foods
from pantrio.nutrition import nutrition_diets, recipe_nutrition
from pantrio.schema import Allergen, DietTag, Ingredient, MealType, Recipe, Unit, UserProfile

PROTEIN_AISLES = {"meat", "seafood"}
OTHER_PROTEINS = {
    "egg", "egg_white", "egg_yolk", "tofu", "tempeh", "edamame", "canned_tuna", "sardines",
    "chickpeas", "black_beans",
    "kidney_beans", "cannellini_beans", "red_lentils", "green_lentils",
}  # fmt: skip


class UnsupportedDessertSwap(ValueError):
    """Equal-weight swaps cannot establish that a dessert's method still works."""


def check_swap_supported(recipe: Recipe) -> None:
    # No verified dessert substitution rules exist yet. Even fruit/fat/dairy can be
    # structural (pectin, water, emulsification); treat the whole dessert conservatively.
    if MealType.DESSERT in recipe.meal_types:
        raise UnsupportedDessertSwap(
            "Automatic dessert swaps are unavailable: changing ingredients can affect "
            "setting, rising and texture. Use a recipe developed for those ingredients."
        )


def swap_group(food: str) -> str:
    f = load_foods()[food]
    if f.aisle in PROTEIN_AISLES or food in OTHER_PROTEINS:
        return "protein"
    return f.aisle


@dataclass(frozen=True)
class Swap:
    food: str
    replacement: str
    recipe: Recipe  # the recipe after the swap, re-derived
    added_allergens: frozenset[Allergen]
    lost_diets: frozenset[DietTag]
    kcal_change: float  # per serving
    protein_change: float  # per serving
    problems: tuple[str, ...]  # hard rules the swapped recipe breaks for the person

    @property
    def safe(self) -> bool:
        return not self.problems


def swapped_recipe(recipe: Recipe, food: str, replacement: str) -> Recipe:
    check_swap_supported(recipe)
    if food not in recipe.foods:
        raise ValueError(f"{recipe.id} does not use {food}")
    if replacement not in load_foods():
        raise ValueError(f"{replacement} is not in the ingredient table")
    ingredients = [
        Ingredient(name=f"{replacement.replace('_', ' ')} (instead of {i.name})",
                   food=replacement, quantity=round(i.grams, 1) or 1, unit=Unit.G, grams=i.grams)
        if i.food == food else i
        for i in recipe.ingredients
    ]  # fmt: skip
    nutrition = recipe_nutrition(ingredients, recipe.servings)
    foods = {i.food for i in ingredients}
    diets = derive_ingredient_diets(foods) | nutrition_diets(nutrition)
    return recipe.model_copy(
        update={
            "ingredients": ingredients,
            "nutrition": nutrition,
            "allergens": sorted(derive_allergens(foods)),
            "diet_tags": sorted(diets),
        }
    )


def evaluate_swap(recipe: Recipe, food: str, replacement: str, profile: UserProfile) -> Swap:
    new = swapped_recipe(recipe, food, replacement)
    before = derive_ingredient_diets(recipe.foods) | nutrition_diets(recipe.nutrition)
    return Swap(
        food=food,
        replacement=replacement,
        recipe=new,
        added_allergens=frozenset(set(new.allergens) - derive_allergens(recipe.foods)),
        lost_diets=frozenset((before & set(recipe.diet_tags)) - set(new.diet_tags)),
        kcal_change=round(new.nutrition.kcal - recipe.nutrition.kcal, 1),
        protein_change=round(new.nutrition.protein_g - recipe.nutrition.protein_g, 1),
        problems=tuple(msg for _, msg in recipe_problems(new, profile)),
    )


def _distance(a: str, b: str) -> float:
    foods = load_foods()
    x, y = foods[a].per_100g, foods[b].per_100g
    return math.dist(
        (x.kcal / 100, x.protein_g / 10, x.carbs_g / 10, x.fat_g / 10),
        (y.kcal / 100, y.protein_g / 10, y.carbs_g / 10, y.fat_g / 10),
    )


def swap_options(recipe: Recipe, food: str, profile: UserProfile, limit: int = 4) -> list[Swap]:
    """Safe replacements for `food`, closest in nutrition first."""
    if food not in recipe.foods:
        raise ValueError(f"{recipe.id} does not use {food}")
    check_swap_supported(recipe)
    group = swap_group(food)
    candidates = sorted(
        (k for k in load_foods() if k not in recipe.foods and swap_group(k) == group),
        key=lambda k: (_distance(food, k), k),
    )
    out = []
    for k in candidates:
        swap = evaluate_swap(recipe, food, k, profile)
        if swap.safe:
            out.append(swap)
            if len(out) == limit:
                break
    return out
