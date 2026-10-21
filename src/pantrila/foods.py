"""Pantrila's ingredient table: unit conversion, allergens and diet classes per food.

`data/ingredients.csv` maps each food key to a source-specific nutrition identity plus facts
code needs to normalise and check recipes: density for volume units, weight per piece, the EU
allergens the food contains and its diet class. Labelling is conservative: if a common product
usually contains an allergen (soy sauce has wheat, UK sausages have rusk), the food carries it.
"""

from __future__ import annotations

import csv
from collections.abc import Mapping
from dataclasses import dataclass
from functools import cache
from pathlib import Path

from pantrila.schema import Allergen, DietTag, NutritionFacts, Unit

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
    fdc_id: int | None
    description: str
    aisle: str
    diet_class: str
    allergens: frozenset[Allergen]
    grams_per_ml: float | None
    grams_per_piece: float | None
    per_100g: NutritionFacts
    grams_only: bool = False
    source: str = "estimated"
    source_food_code: str | None = None
    dataset_version: str | None = None
    source_url: str | None = None
    attribution: str | None = None


def _opt_float(value: str) -> float | None:
    return float(value) if value else None


@cache
def load_foods(data_dir: Path = DATA_DIR) -> dict[str, Food]:
    with (data_dir / "usda_foods.csv").open() as fh:
        usda = {row["fdc_id"]: row for row in csv.DictReader(fh)}
    with (data_dir / "ciqual_foods.csv").open() as fh:
        ciqual = {row["source_food_code"]: row for row in csv.DictReader(fh)}
    foods: dict[str, Food] = {}
    with (data_dir / "ingredients.csv").open() as fh:
        for row in csv.DictReader(fh):
            source = row.get("source") or "usda"
            code = row.get("source_food_code") or row["fdc_id"]
            if source not in {"usda", "ciqual"}:
                raise ValueError(f"unsupported nutrition source: {source}")
            u = (usda if source == "usda" else ciqual)[code]
            if row["key"] in foods:
                raise ValueError(f"duplicate ingredient key: {row['key']}")
            foods[row["key"]] = Food(
                key=row["key"],
                fdc_id=int(code) if source == "usda" else None,
                source=source,
                source_food_code=code,
                dataset_version="SR Legacy 2018-04" if source == "usda" else "Ciqual 2025",
                source_url=(
                    f"https://fdc.nal.usda.gov/food-details/{code}/nutrients"
                    if source == "usda"
                    else "https://ciqual.anses.fr/"
                ),
                attribution=(
                    "USDA FoodData Central, SR Legacy 2018-04 (public domain)"
                    if source == "usda"
                    else "Anses. 2025. Ciqual French food composition table"
                ),
                grams_only=row.get("grams_only") == "true",
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


def to_grams(
    food: str, quantity: float, unit: Unit, table: Mapping[str, Food] | None = None
) -> float:
    f = (table or load_foods())[food]
    if f.grams_only and unit not in {Unit.G, Unit.KG}:
        raise UnitError(f"{food} supports g/kg only; no supported conversion for {unit}")
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


def measures(f: Food) -> dict[str, float | None]:
    """Grams per ml and per piece the food converts with; none for a weight-only food."""
    if f.grams_only:
        return {"grams_per_ml": None, "grams_per_piece": None}
    return {"grams_per_ml": f.grams_per_ml, "grams_per_piece": f.grams_per_piece}


def derive_allergens(foods: set[str], table: Mapping[str, Food] | None = None) -> set[Allergen]:
    table = table or load_foods()
    return set().union(*(table[f].allergens for f in foods))


def derive_ingredient_diets(
    foods: set[str], table: Mapping[str, Food] | None = None
) -> set[DietTag]:
    """Diet tags that follow from ingredients alone (nutrition-based tags are separate)."""
    table = table or load_foods()
    classes = {table[f].diet_class for f in foods}
    allergens = derive_allergens(foods, table)
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
