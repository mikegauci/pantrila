"""Pantrio's ingredient table: unit conversion, allergens and diet classes per food.

`data/ingredients.csv` maps each food key to a USDA FoodData Central id plus the facts code
needs to normalise and check recipes: density for volume units, weight per piece, the EU
allergens the food contains and its diet class. Labelling is conservative: if a common product
usually contains an allergen (soy sauce has wheat, UK sausages have rusk), the food carries it.
"""

from __future__ import annotations

import csv
from dataclasses import dataclass
from functools import cache
from pathlib import Path

from pantrio.schema import Allergen, DietTag, NutritionFacts, Unit

DATA_DIR = Path(__file__).resolve().parents[2] / "data"

ML_PER_UNIT = {Unit.ML: 1.0, Unit.L: 1000.0, Unit.TSP: 4.93, Unit.TBSP: 14.79, Unit.CUP: 240.0}
GRAMS_PER_UNIT = {Unit.G: 1.0, Unit.KG: 1000.0, Unit.PINCH: 0.4}

# What each diet class rules out.
NOT_VEGAN = {"dairy", "egg", "honey", "fish", "shellfish", "meat"}
NOT_VEGETARIAN = {"fish", "shellfish", "meat"}
NOT_PESCATARIAN = {"meat"}


class UnitError(ValueError):
    pass


@dataclass(frozen=True)
class Food:
    key: str
    fdc_id: int
    description: str
    aisle: str
    diet_class: str
    allergens: frozenset[Allergen]
    grams_per_ml: float | None
    grams_per_piece: float | None
    per_100g: NutritionFacts


def _opt_float(value: str) -> float | None:
    return float(value) if value else None


@cache
def load_foods(data_dir: Path = DATA_DIR) -> dict[str, Food]:
    with (data_dir / "usda_foods.csv").open() as fh:
        usda = {row["fdc_id"]: row for row in csv.DictReader(fh)}
    foods: dict[str, Food] = {}
    with (data_dir / "ingredients.csv").open() as fh:
        for row in csv.DictReader(fh):
            u = usda[row["fdc_id"]]
            foods[row["key"]] = Food(
                key=row["key"],
                fdc_id=int(row["fdc_id"]),
                description=u["description"],
                aisle=row["aisle"],
                diet_class=row["diet_class"],
                allergens=frozenset(Allergen(a) for a in row["allergens"].split("|") if a),
                grams_per_ml=_opt_float(row["grams_per_ml"]),
                grams_per_piece=_opt_float(row["grams_per_piece"]),
                per_100g=NutritionFacts(
                    kcal=float(u["kcal"]),
                    protein_g=float(u["protein_g"]),
                    carbs_g=float(u["carbs_g"]),
                    fat_g=float(u["fat_g"]),
                    fibre_g=float(u["fibre_g"]),
                ),
            )
    return foods


def food_keys() -> list[str]:
    return sorted(load_foods())


def to_grams(food: str, quantity: float, unit: Unit) -> float:
    f = load_foods()[food]
    if unit in GRAMS_PER_UNIT:
        return quantity * GRAMS_PER_UNIT[unit]
    if unit in ML_PER_UNIT:
        if f.grams_per_ml is None:
            raise UnitError(f"{food} cannot be measured by volume; use g or piece")
        return quantity * ML_PER_UNIT[unit] * f.grams_per_ml
    if unit is Unit.PIECE:
        if f.grams_per_piece is None:
            raise UnitError(f"{food} cannot be counted in pieces; use g")
        return quantity * f.grams_per_piece
    raise UnitError(f"unknown unit {unit}")


def derive_allergens(foods: set[str]) -> set[Allergen]:
    table = load_foods()
    return set().union(*(table[f].allergens for f in foods))


def derive_ingredient_diets(foods: set[str]) -> set[DietTag]:
    """Diet tags that follow from ingredients alone (nutrition-based tags are separate)."""
    table = load_foods()
    classes = {table[f].diet_class for f in foods}
    allergens = derive_allergens(foods)
    tags: set[DietTag] = set()
    if not classes & NOT_VEGAN:
        tags.add(DietTag.VEGAN)
    if not classes & NOT_VEGETARIAN:
        tags.add(DietTag.VEGETARIAN)
    if not classes & NOT_PESCATARIAN:
        tags.add(DietTag.PESCATARIAN)
    if Allergen.GLUTEN not in allergens:
        tags.add(DietTag.GLUTEN_FREE)
    if Allergen.MILK not in allergens:
        tags.add(DietTag.DAIRY_FREE)
    if not allergens & {Allergen.PEANUTS, Allergen.TREE_NUTS}:
        tags.add(DietTag.NUT_FREE)
    return tags
