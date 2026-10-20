"""Load, normalise and validate the recipe corpus.

The model writes a `RecipeDraft` (what a cook would write: ingredient lines with quantities and
units, steps, and the allergens it believes are present). Code then normalises units to grams,
computes nutrition from USDA values, derives allergens and diet tags from the ingredient table,
and rejects the draft if the model's allergen list disagrees with the derived one.
"""

from __future__ import annotations

import csv
import json
from dataclasses import dataclass
from enum import StrEnum
from pathlib import Path

from pydantic import BaseModel, Field

from pantrila.foods import (
    DATA_DIR,
    UnitError,
    derive_allergens,
    derive_ingredient_diets,
    food_keys,
    to_grams,
)
from pantrila.nutrition import nutrition_diets, recipe_nutrition
from pantrila.schema import Allergen, DietTag, Ingredient, MealType, Recipe, Unit

RECIPES_DIR = DATA_DIR / "recipes"
BRIEFS_PATH = DATA_DIR / "dish_briefs.csv"

FoodKey = StrEnum("FoodKey", {k.upper(): k for k in food_keys()})


class DraftIngredient(BaseModel):
    name: str = Field(
        description="Ingredient line as written in a recipe, e.g. 'red onion, finely diced'."
    )
    food: FoodKey = Field(  # type: ignore[valid-type]
        description="Closest food in Pantrila's ingredient table. Pick the specific item when one "
        "exists (red_onion, not onion)."
    )
    quantity: float = Field(description="Amount in `unit`; must be greater than zero.")
    unit: Unit = Field(
        description="Use g or ml for most things, tsp/tbsp for small amounts, piece for countable "
        "items (eggs, cloves of garlic, lemons), pinch for a pinch of salt or spice."
    )


class RecipeDraft(BaseModel):
    title: str = Field(description="Short, appetising recipe name in English, no emoji.")
    summary: str = Field(
        description="One or two sentences: what the dish is, how it tastes, when you'd cook it."
    )
    meal_types: list[MealType] = Field(description="Meals this recipe suits; at least one.")
    total_minutes: int = Field(description="Realistic total time including prep, in minutes.")
    servings: int = Field(description="Number of servings the quantities make.")
    ingredients: list[DraftIngredient] = Field(
        description="Every ingredient, including oil, salt and spices, with real quantities."
    )
    steps: list[str] = Field(description="Method as numbered steps without the numbers.")
    allergens: list[Allergen] = Field(
        description="Every EU allergen present in any ingredient. Soy sauce contains soy and "
        "gluten; wine and wine vinegar contain sulphites; stock usually contains celery."
    )


@dataclass(frozen=True)
class Brief:
    id: str
    cuisine: str
    meal_type: MealType
    diet: DietTag | None
    brief: str


class CorpusValidationError(ValueError):
    def __init__(self, problems: list[str]):
        super().__init__("; ".join(problems))
        self.problems = problems


def load_briefs(path: Path = BRIEFS_PATH) -> list[Brief]:
    with path.open() as fh:
        return [
            Brief(
                id=row["id"],
                cuisine=row["cuisine"],
                meal_type=MealType(row["meal_type"]),
                diet=DietTag(row["diet"]) if row["diet"] else None,
                brief=row["brief"],
            )
            for row in csv.DictReader(fh)
        ]


def build_recipe(brief: Brief, draft: RecipeDraft) -> Recipe:
    """Normalise a model draft into a Recipe, or raise with every problem found."""
    problems: list[str] = []
    ingredients: list[Ingredient] = []
    for d in draft.ingredients:
        food = str(d.food)
        if d.quantity <= 0:
            problems.append(f"ingredient '{d.name}' has quantity {d.quantity}")
            continue
        try:
            grams = to_grams(food, d.quantity, d.unit)
        except UnitError as exc:
            problems.append(f"ingredient '{d.name}': {exc}")
            continue
        ingredients.append(
            Ingredient(
                name=d.name, food=food, quantity=d.quantity, unit=d.unit, grams=round(grams, 1)
            )
        )

    if len(draft.ingredients) < 3:
        problems.append("a recipe needs at least 3 ingredients")
    if len(draft.steps) < 2:
        problems.append("a recipe needs at least 2 steps")
    if not 1 <= draft.servings <= 24:
        problems.append(f"servings must be 1-24, got {draft.servings}")
    if not 1 <= draft.total_minutes <= 1440:
        problems.append(f"total_minutes must be 1-1440, got {draft.total_minutes}")
    if brief.meal_type not in draft.meal_types:
        problems.append(f"meal_types must include '{brief.meal_type}'")

    foods = {i.food for i in ingredients}
    derived_allergens = derive_allergens(foods)
    claimed = set(draft.allergens)
    if claimed != derived_allergens and not problems:
        missing = sorted(a.value for a in derived_allergens - claimed)
        extra = sorted(a.value for a in claimed - derived_allergens)
        problems.append(
            f"allergen list disagrees with ingredients (missing {missing}, unexpected {extra})"
        )

    if problems:
        raise CorpusValidationError(problems)

    servings = draft.servings
    nutrition = recipe_nutrition(ingredients, servings)
    diets = derive_ingredient_diets(foods) | nutrition_diets(nutrition)
    if brief.diet and brief.diet not in diets:
        raise CorpusValidationError([f"brief asks for a {brief.diet} recipe but it is not"])

    return Recipe(
        id=brief.id,
        title=draft.title.strip(),
        summary=draft.summary.strip(),
        cuisine=brief.cuisine,
        meal_types=sorted(set(draft.meal_types), key=list(MealType).index),
        diet_tags=sorted(diets, key=list(DietTag).index),
        allergens=sorted(derived_allergens, key=list(Allergen).index),
        total_minutes=draft.total_minutes,
        servings=servings,
        ingredients=ingredients,
        steps=[s.strip() for s in draft.steps],
        nutrition=nutrition,
    )


def check_recipe(recipe: Recipe) -> list[str]:
    """Recompute everything derived and report drift from what is stored."""
    problems = []
    for ing in recipe.ingredients:
        grams = round(to_grams(ing.food, ing.quantity, ing.unit), 1)
        if abs(grams - ing.grams) > 0.05:
            problems.append(f"{ing.food}: grams {ing.grams} != {grams}")
    foods = recipe.foods
    nutrition = recipe_nutrition(recipe.ingredients, recipe.servings)
    if nutrition != recipe.nutrition:
        problems.append("nutrition does not match ingredient table")
    if set(recipe.allergens) != derive_allergens(foods):
        problems.append("allergens do not match ingredient table")
    if set(recipe.diet_tags) != derive_ingredient_diets(foods) | nutrition_diets(nutrition):
        problems.append("diet tags do not match ingredient table")
    return problems


def recipe_path(recipe_id: str, recipes_dir: Path = RECIPES_DIR) -> Path:
    return recipes_dir / f"{recipe_id}.json"


def save_recipe(recipe: Recipe, recipes_dir: Path = RECIPES_DIR) -> Path:
    recipes_dir.mkdir(parents=True, exist_ok=True)
    path = recipe_path(recipe.id, recipes_dir)
    path.write_text(json.dumps(recipe.model_dump(mode="json"), indent=2, ensure_ascii=False) + "\n")
    return path


def load_corpus(recipes_dir: Path = RECIPES_DIR) -> list[Recipe]:
    return [Recipe.model_validate_json(p.read_text()) for p in sorted(recipes_dir.glob("*.json"))]
