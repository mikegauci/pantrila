"""Pydantic models shared across Pantrio.

Models sent to the model as structured outputs carry field descriptions; those descriptions are
part of the prompt, so change them with the same care as prompt text.
"""

from __future__ import annotations

from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field


class Allergen(StrEnum):
    """The 14 allergens that EU law (Regulation 1169/2011, Annex II) requires on labels."""

    CELERY = "celery"
    GLUTEN = "gluten"  # cereals containing gluten: wheat, rye, barley, oats
    CRUSTACEANS = "crustaceans"
    EGGS = "eggs"
    FISH = "fish"
    LUPIN = "lupin"
    MILK = "milk"
    MOLLUSCS = "molluscs"
    MUSTARD = "mustard"
    TREE_NUTS = "tree_nuts"
    PEANUTS = "peanuts"
    SESAME = "sesame"
    SOY = "soy"
    SULPHITES = "sulphites"


class DietTag(StrEnum):
    """Diet labels. All are derived in code from ingredients and nutrition, never trusted."""

    VEGAN = "vegan"
    VEGETARIAN = "vegetarian"
    PESCATARIAN = "pescatarian"
    GLUTEN_FREE = "gluten_free"
    DAIRY_FREE = "dairy_free"
    NUT_FREE = "nut_free"
    LOW_CARB = "low_carb"
    HIGH_PROTEIN = "high_protein"


class MealType(StrEnum):
    BREAKFAST = "breakfast"
    LUNCH = "lunch"
    DINNER = "dinner"
    SNACK = "snack"
    DESSERT = "dessert"


class Unit(StrEnum):
    G = "g"
    KG = "kg"
    ML = "ml"
    L = "l"
    TSP = "tsp"
    TBSP = "tbsp"
    CUP = "cup"
    PIECE = "piece"
    PINCH = "pinch"


class Ingredient(BaseModel):
    model_config = ConfigDict(frozen=True)

    name: str = Field(
        description="Ingredient line as a cook would write it, e.g. 'red onion, diced'."
    )
    food: str = Field(description="Key of the food in Pantrio's ingredient table.")
    quantity: float = Field(gt=0)
    unit: Unit
    grams: float = Field(ge=0, description="Quantity normalised to grams in code.")


class NutritionFacts(BaseModel):
    """Per serving. 'Macros' means protein, carbs and fat."""

    model_config = ConfigDict(frozen=True)

    kcal: float = Field(ge=0)
    protein_g: float = Field(ge=0)
    carbs_g: float = Field(ge=0)
    fat_g: float = Field(ge=0)
    fibre_g: float = Field(ge=0)


class Recipe(BaseModel):
    id: str = Field(pattern=r"^[a-z0-9]+(-[a-z0-9]+)*$")
    title: str
    summary: str
    cuisine: str
    meal_types: list[MealType] = Field(min_length=1)
    diet_tags: list[DietTag]
    allergens: list[Allergen]
    total_minutes: int = Field(gt=0, le=24 * 60)
    servings: int = Field(gt=0, le=24)
    ingredients: list[Ingredient] = Field(min_length=1)
    steps: list[str] = Field(min_length=1)
    nutrition: NutritionFacts

    @property
    def foods(self) -> set[str]:
        return {i.food for i in self.ingredients}
