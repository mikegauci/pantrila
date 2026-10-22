"""Pydantic models shared across Pantrila.

Models sent to the model as structured outputs carry field descriptions; those descriptions are
part of the prompt, so change them with the same care as prompt text.
"""

from __future__ import annotations

from enum import StrEnum
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, model_validator


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
    food: str = Field(description="Key of the food in Pantrila's ingredient table.")
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


# --- People and plans ----------------------------------------------------------------------

DEFAULT_MEALS = [MealType.BREAKFAST, MealType.LUNCH, MealType.DINNER]


class NutritionTargets(BaseModel):
    """Daily targets for one person. Unset means no target.

    Energy is either one number (`kcal`, met within +/-10%) or a range (`min_kcal` and/or
    `max_kcal`, met anywhere inside it); a range, when set, replaces `kcal`."""

    model_config = ConfigDict(allow_inf_nan=False)

    kcal: float | None = Field(default=None, gt=0, description="Energy per day.")
    min_kcal: float | None = Field(default=None, gt=0, le=10_000, description="Energy floor.")
    max_kcal: float | None = Field(default=None, gt=0, le=10_000, description="Energy ceiling.")
    min_protein_g: float | None = Field(default=None, gt=0)
    max_carbs_g: float | None = Field(default=None, gt=0)

    @model_validator(mode="after")
    def _range_in_order(self) -> NutritionTargets:
        if self.min_kcal and self.max_kcal and self.min_kcal > self.max_kcal:
            raise ValueError("the energy floor is above the ceiling")
        return self

    @property
    def kcal_range(self) -> bool:
        return bool(self.min_kcal or self.max_kcal)

    @property
    def kcal_goal(self) -> float | None:
        """One number to aim for: the range's middle (or its only end), else `kcal`."""
        if self.min_kcal and self.max_kcal:
            return (self.min_kcal + self.max_kcal) / 2
        return self.min_kcal or self.max_kcal or self.kcal

    @property
    def any(self) -> bool:
        return bool(self.kcal or self.kcal_range or self.min_protein_g or self.max_carbs_g)

    def kcal_text(self) -> str | None:
        """The energy target as people say it: '2000 kcal', '1600-1900 kcal', 'at least ...'."""
        lo, hi = self.min_kcal, self.max_kcal
        if lo and hi:
            return f"{lo:.0f}-{hi:.0f} kcal"
        if lo:
            return f"at least {lo:.0f} kcal"
        if hi:
            return f"at most {hi:.0f} kcal"
        return f"{self.kcal:.0f} kcal" if self.kcal else None


class UserProfile(BaseModel):
    """What the planner knows about a person. Allergies, diets, excluded foods and the time
    limit are hard rules; targets, pantry, cuisines and notes are goals."""

    allergies: list[Allergen] = Field(default_factory=list, max_length=14)
    diets: list[DietTag] = Field(default_factory=list, max_length=8)
    exclude_foods: list[Annotated[str, Field(max_length=80)]] = Field(
        default_factory=list, max_length=512, description="Food keys the person will not eat."
    )
    max_minutes: int | None = Field(default=None, gt=0, description="Longest recipe to cook.")
    days: int = Field(default=7, ge=1, le=7)
    meals: list[MealType] = Field(
        default_factory=lambda: list(DEFAULT_MEALS), min_length=1, max_length=5
    )
    targets: NutritionTargets = Field(default_factory=NutritionTargets)
    pantry: list[Annotated[str, Field(max_length=80)]] = Field(
        default_factory=list,
        max_length=512,
        description="Food keys already in the kitchen, to use up first.",
    )
    cuisines: list[Annotated[str, Field(max_length=40)]] = Field(
        default_factory=list, max_length=15, description="Preferred cuisines."
    )
    notes: str = Field(
        default="", max_length=300, description="Free-text tastes, e.g. 'loves spicy food'."
    )


class SlotKind(StrEnum):
    """What the person does at a meal of a plan. The planner only makes `recipe` slots."""

    RECIPE = "recipe"  # cook `recipe_id`: a corpus recipe, or `mine-<id>` from the cookbook
    LEFTOVERS = "leftovers"  # eat more of the recipe cooked at `from_day`/`from_meal`
    SKIPPED = "skipped"
    EATING_OUT = "eating_out"


MINE_PREFIX = "mine-"  # recipe ids of cookbook recipes in a plan: mine-<cookbook id>


class PlannedMeal(BaseModel):
    meal_type: MealType
    recipe_id: str = Field(
        description="The recipe eaten; for skipped and eating out, the one planned there before."
    )
    portions: float = Field(default=1.0, description="Servings of the recipe per person.")
    kind: SlotKind = SlotKind.RECIPE
    from_day: int | None = Field(default=None, ge=1, description="Leftovers: day it was cooked.")
    from_meal: MealType | None = Field(default=None, description="Leftovers: meal it was cooked.")
    out_kcal: float | None = Field(
        default=None, gt=0, le=3000, description="Eating out: the person's rough energy estimate."
    )

    @property
    def eats_recipe(self) -> bool:
        """True when the recipe's food is eaten here (cooked now or as leftovers)."""
        return self.kind in (SlotKind.RECIPE, SlotKind.LEFTOVERS)


class PlanDay(BaseModel):
    day: int = Field(ge=1)
    meals: list[PlannedMeal]


class MealPlan(BaseModel):
    days: list[PlanDay]
    notes: str = ""

    @property
    def meals(self) -> list[tuple[int, PlannedMeal]]:
        return [(d.day, m) for d in self.days for m in d.meals]


# --- Pantry and shopping -------------------------------------------------------------------


class PantryItem(BaseModel):
    """A food the person has at home. No quantity means "some", enough for any recipe."""

    food: str = Field(description="Key of the food in Pantrila's ingredient table.")
    quantity: float | None = Field(default=None, gt=0)
    unit: Unit | None = None
    grams: float | None = Field(default=None, ge=0, description="Quantity normalised in code.")

    @model_validator(mode="after")
    def _amount_is_complete(self) -> PantryItem:
        if (self.quantity is None) != (self.unit is None):
            raise ValueError("quantity and unit go together")
        if (self.quantity is None) != (self.grams is None):
            raise ValueError("grams are set exactly when a quantity is")
        return self


class GroceryItem(BaseModel):
    food: str
    aisle: str
    need_g: float = Field(description="Grams the plan uses.")
    have_g: float = Field(description="Grams the pantry covers.")
    buy_g: float = Field(description="Grams to buy: need minus have, never below zero.")
    amount: str = Field(description="What to buy in shop terms, e.g. '3 pieces' or '400 g'.")
    recipes: list[str] = Field(description="Recipe ids that use the food.")


class GroceryList(BaseModel):
    people: int = 1
    items: list[GroceryItem] = Field(description="Foods to buy, grouped by aisle.")
    covered: list[GroceryItem] = Field(description="Foods the pantry fully covers.")
    unlisted: list[str] = Field(
        default_factory=list,
        description="Estimated foods of the person's own recipes, which cannot be weighed here.",
    )
