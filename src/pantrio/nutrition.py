"""Per-serving nutrition from ingredient grams and reviewed source-specific values per 100 g."""

from __future__ import annotations

import re
from collections.abc import Iterable, Mapping

from pantrio.foods import Food, load_foods
from pantrio.schema import DietTag, Ingredient, NutritionFacts

# Thresholds per serving for the nutrition-based diet tags.
LOW_CARB_MAX_CARBS_G = 20.0
HIGH_PROTEIN_MIN_G = 25.0
HIGH_PROTEIN_MIN_KCAL_SHARE = 0.20  # protein gives 4 kcal per gram

# Oil "for frying" mostly stays in the pan when there is a lot of it (deep or shallow frying).
# A pan-frying amount per serving is counted in full; above that, only the share the food
# absorbs. Absorption varies widely with the food and temperature; 20% is a rough middle.
FRYING_FAT_MIN_PER_100G = 80.0  # oils, butter, ghee
FRYING_OIL_EATEN_G_PER_SERVING = 15.0  # about a tablespoon
FRYING_OIL_ABSORBED_SHARE = 0.20
_FRYING = re.compile(r"\bfrying\b", re.IGNORECASE)


def eaten_grams(ing: Ingredient, servings: int, table: Mapping[str, Food] | None = None) -> float:
    """Grams of the ingredient that end up eaten; less than `grams` only for frying oil."""
    if not _FRYING.search(ing.name):
        return ing.grams
    if (table or load_foods())[ing.food].per_100g.fat_g < FRYING_FAT_MIN_PER_100G:
        return ing.grams
    full = FRYING_OIL_EATEN_G_PER_SERVING * servings
    if ing.grams <= full:
        return ing.grams
    return full + (ing.grams - full) * FRYING_OIL_ABSORBED_SHARE


def recipe_nutrition(
    ingredients: Iterable[Ingredient], servings: int, table: Mapping[str, Food] | None = None
) -> NutritionFacts:
    foods = table or load_foods()
    totals = dict.fromkeys(NutritionFacts.model_fields, 0.0)
    for ing in ingredients:
        per_100g = foods[ing.food].per_100g
        grams = eaten_grams(ing, servings, foods)
        for field in totals:
            totals[field] += getattr(per_100g, field) * grams / 100.0
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
