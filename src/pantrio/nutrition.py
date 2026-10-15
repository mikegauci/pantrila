"""Per-serving nutrition from ingredient grams and USDA FoodData Central values per 100 g."""

from __future__ import annotations

from collections.abc import Iterable

from pantrio.foods import load_foods
from pantrio.schema import DietTag, Ingredient, NutritionFacts

# Thresholds per serving for the nutrition-based diet tags.
LOW_CARB_MAX_CARBS_G = 20.0
HIGH_PROTEIN_MIN_G = 25.0
HIGH_PROTEIN_MIN_KCAL_SHARE = 0.20  # protein gives 4 kcal per gram


def recipe_nutrition(ingredients: Iterable[Ingredient], servings: int) -> NutritionFacts:
    foods = load_foods()
    totals = dict.fromkeys(NutritionFacts.model_fields, 0.0)
    for ing in ingredients:
        per_100g = foods[ing.food].per_100g
        for field in totals:
            totals[field] += getattr(per_100g, field) * ing.grams / 100.0
    return NutritionFacts(**{k: round(v / servings, 1) for k, v in totals.items()})


def nutrition_diets(n: NutritionFacts) -> set[DietTag]:
    tags: set[DietTag] = set()
    if n.carbs_g <= LOW_CARB_MAX_CARBS_G:
        tags.add(DietTag.LOW_CARB)
    if (
        n.protein_g >= HIGH_PROTEIN_MIN_G
        and n.kcal
        and (n.protein_g * 4 / n.kcal >= HIGH_PROTEIN_MIN_KCAL_SHARE)
    ):
        tags.add(DietTag.HIGH_PROTEIN)
    return tags
