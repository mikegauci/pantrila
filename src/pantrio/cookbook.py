"""A person's own recipes: added from a photo, a web page or typed in.

They live in the person's cookbook (table `user_recipes`), not the shared corpus, and the
planner never uses them. What is stored is what the person reviewed: ingredient lines, steps
and, for each line, either a food from the ingredient table or a model estimate for a food the
table lacks (`FoodEstimate`). Grams, nutrition, allergens and diet tags are derived in code on
every read, the same way as for the corpus, with estimated foods joining the table for that
recipe only. A recipe with any estimated food is marked `estimated`: its numbers are only as
good as the estimate, and the app says so.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Annotated, Literal, Protocol

import psycopg
from pydantic import BaseModel, Field, HttpUrl, field_validator, model_validator

from pantrio.constraints import rule_problems
from pantrio.foods import Food, UnitError, derive_allergens, derive_ingredient_diets, load_foods
from pantrio.foods import to_grams as table_grams
from pantrio.nutrition import nutrition_diets, recipe_nutrition
from pantrio.schema import (
    Allergen,
    DietTag,
    Ingredient,
    MealType,
    NutritionFacts,
    Unit,
    UserProfile,
)

MAX_RECIPES_PER_USER = 200
HANDLE = re.compile(r"[A-Za-z0-9._]{1,30}")
DietClass = Literal["plant", "dairy", "egg", "honey", "fish", "shellfish", "meat"]
Source = Literal["manual", "photo", "link", "post", "text", "video"]
Platform = Literal["tiktok", "instagram", "facebook"]


class FoodFacts(BaseModel):
    """Facts for a food missing from Pantrio's ingredient table, estimated by the model."""

    description: str = Field(
        description="What the food is in plain words, e.g. 'gochujang (Korean chilli paste)'."
    )
    diet_class: DietClass = Field(
        description="What it is made from: plant (incl. fungi), dairy, egg, honey, fish, "
        "shellfish or meat. A mixed product takes the most restrictive animal class."
    )
    allergens: list[Allergen] = Field(
        description="Every EU allergen the usual shop-bought product contains, including those "
        "of its usual components: think through what sauces, pastes, blends and stocks are made "
        "of (shrimp paste: crustaceans; fish sauce: fish; soy sauce: soy and gluten; wine: "
        "sulphites). Be conservative: if common brands contain it, list it."
    )
    kcal: float = Field(description="Energy per 100 g.")
    protein_g: float = Field(description="Protein per 100 g.")
    carbs_g: float = Field(description="Carbohydrate per 100 g.")
    fat_g: float = Field(description="Fat per 100 g.")
    fibre_g: float = Field(description="Fibre per 100 g.")
    grams_per_ml: float | None = Field(
        description="Grams per millilitre when it can be measured by volume (water 1.0, oil "
        "0.92, flour 0.53); null when it cannot."
    )
    grams_per_piece: float | None = Field(
        description="Grams of one typical piece when it is counted (one tortilla, one stock "
        "cube); null when it is not."
    )


class FoodEstimate(FoodFacts):
    """A `FoodFacts` that passed range checks (the JSON schema sent to the model has none)."""

    @model_validator(mode="after")
    def _plausible(self) -> FoodEstimate:
        macros = (self.protein_g, self.carbs_g, self.fat_g, self.fibre_g)
        if not 0 <= self.kcal <= 900 or any(not 0 <= m <= 100 for m in macros):
            raise ValueError("nutrition per 100 g is out of range")
        if self.protein_g + self.carbs_g + self.fat_g > 101:
            raise ValueError("protein, carbs and fat add up to more than 100 g per 100 g")
        for v in (self.grams_per_ml, self.grams_per_piece):
            if v is not None and not 0 < v <= 2000:
                raise ValueError("grams per ml or per piece is out of range")
        return self

    def food(self, key: str) -> Food:
        return Food(
            key=key, fdc_id=None, description=self.description, aisle="other",
            diet_class=self.diet_class, allergens=frozenset(self.allergens),
            grams_per_ml=self.grams_per_ml, grams_per_piece=self.grams_per_piece,
            per_100g=NutritionFacts(kcal=self.kcal, protein_g=self.protein_g,
                                    carbs_g=self.carbs_g, fat_g=self.fat_g,
                                    fibre_g=self.fibre_g),
        )  # fmt: skip


class RecipeLine(BaseModel):
    """One ingredient line. Drafts may leave `food` and `estimate` unset; saving needs one."""

    name: str = Field(min_length=1, max_length=200)
    quantity: float = Field(gt=0, le=100_000)
    unit: Unit
    food: str | None = Field(default=None, description="Key in the ingredient table.")
    estimate: FoodEstimate | None = None


class CookbookRecipeIn(BaseModel):
    """What the person saves: the review form's contents."""

    title: str = Field(min_length=1, max_length=120)
    summary: str = Field(default="", max_length=600)
    cuisine: str = Field(default="", max_length=40)
    meal_types: list[MealType] = Field(min_length=1)
    total_minutes: int = Field(gt=0, le=24 * 60)
    servings: int = Field(gt=0, le=24)
    ingredients: list[RecipeLine] = Field(min_length=1, max_length=60)
    steps: list[Annotated[str, Field(min_length=1, max_length=2000)]] = Field(
        min_length=1, max_length=40
    )
    source: Source = "manual"
    source_url: str | None = Field(default=None, max_length=2000)
    # Credit for a recipe from a social post: source_url is the post, recipe_url the recipe
    # website its caption linked to (when that is where the recipe came from).
    source_platform: Platform | None = None
    source_author: str | None = Field(
        default=None, max_length=31, description="The creator's handle, without the @."
    )
    recipe_url: str | None = Field(default=None, max_length=2000)

    @field_validator("source_url", "recipe_url")
    @classmethod
    def valid_source_url(cls, value):
        return str(HttpUrl(value)) if value is not None else None

    @field_validator("source_author")
    @classmethod
    def valid_handle(cls, value):
        if value is None or not (value := value.strip().removeprefix("@")):
            return None
        if not HANDLE.fullmatch(value):
            raise ValueError("a handle has up to 30 letters, digits, dots or underscores")
        return value


class LineView(RecipeLine):
    grams: float


class Derived(BaseModel):
    """Everything computed from a recipe's lines."""

    ingredients: list[LineView]
    nutrition: NutritionFacts = Field(description="Per serving.")
    allergens: list[Allergen]
    diet_tags: list[DietTag]
    estimated: bool = Field(description="True when any line uses a model estimate.")
    foods: list[str] = Field(description="Ingredient-table foods it uses.")


class CookbookError(ValueError):
    def __init__(self, problems: list[str]):
        super().__init__("; ".join(problems))
        self.problems = problems


def derive(recipe: CookbookRecipeIn) -> Derived:
    """Grams, nutrition, allergens and diets from the lines, or raise with every problem.

    A line with a table food uses the table even if it also carries an estimate."""
    table = dict(load_foods())
    problems: list[str] = []
    ingredients: list[Ingredient] = []
    for n, line in enumerate(recipe.ingredients, start=1):
        label = f"ingredient {n} ({line.name})"
        if line.food is not None:
            if line.food not in table:
                problems.append(f"{label}: {line.food!r} is not in the ingredient table")
                continue
            key = line.food
        elif line.estimate is not None:
            key = f"estimate:{n}"
            table[key] = line.estimate.food(key)
        else:
            problems.append(f"{label}: pick a food or estimate it")
            continue
        try:
            grams = table_grams(key, line.quantity, line.unit, table)
        except UnitError as exc:
            what = str(exc).replace(key, line.name)
            problems.append(f"{label}: {what}")
            continue
        ingredients.append(Ingredient(name=line.name, food=key, quantity=line.quantity,
                                      unit=line.unit, grams=round(grams, 1)))  # fmt: skip
    if problems:
        raise CookbookError(problems)

    keys, known = {i.food for i in ingredients}, load_foods()
    nutrition = recipe_nutrition(ingredients, recipe.servings, table)
    allergens = derive_allergens(keys, table)
    diets = derive_ingredient_diets(keys, table) | nutrition_diets(nutrition)
    return Derived(
        ingredients=[LineView(**line.model_dump(), grams=i.grams)
                     for line, i in zip(recipe.ingredients, ingredients, strict=True)],
        nutrition=nutrition,
        allergens=sorted(allergens, key=list(Allergen).index),
        diet_tags=sorted(diets, key=list(DietTag).index),
        estimated=any(k not in known for k in keys),
        foods=sorted(k for k in keys if k in known),
    )  # fmt: skip


def problems_for(recipe: CookbookRecipeIn, derived: Derived, profile: UserProfile) -> list[str]:
    """The person's hard rules this recipe breaks, as messages like 'contains milk'."""
    found = rule_problems("", set(derived.allergens), set(derived.diet_tags), set(derived.foods),
                          recipe.total_minutes, profile)  # fmt: skip
    return [msg.strip() for _, msg in found]


# --- Storage ----------------------------------------------------------------------------------


@dataclass
class SavedRecipe:
    id: int
    recipe: CookbookRecipeIn
    created_at: datetime
    updated_at: datetime
    photo_path: str | None = None  # in the recipe-photos bucket; see pantrio.photos


class Cookbook(Protocol):
    """One person's saved recipes, newest first."""

    def list(self) -> list[SavedRecipe]: ...

    def get(self, recipe_id: int) -> SavedRecipe | None: ...

    def add(self, recipe: CookbookRecipeIn) -> SavedRecipe: ...

    def update(self, recipe_id: int, recipe: CookbookRecipeIn) -> SavedRecipe | None: ...

    def delete(self, recipe_id: int) -> bool: ...

    def set_photo(self, recipe_id: int, path: str | None) -> None: ...


class CookbookFull(ValueError):
    pass


class MemoryCookbook:
    def __init__(self, user_id: str, shared: dict | None = None):
        self.user_id = user_id
        self.shared = shared if shared is not None else {}
        self.shared.setdefault("cookbook", [])

    @property
    def _rows(self) -> list[tuple[str, SavedRecipe]]:
        return self.shared["cookbook"]

    def list(self) -> list[SavedRecipe]:
        return [r for u, r in reversed(self._rows) if u == self.user_id]

    def get(self, recipe_id: int) -> SavedRecipe | None:
        return next((r for r in self.list() if r.id == recipe_id), None)

    def add(self, recipe: CookbookRecipeIn) -> SavedRecipe:
        if len(self.list()) >= MAX_RECIPES_PER_USER:
            raise CookbookFull(f"A cookbook holds at most {MAX_RECIPES_PER_USER} recipes.")
        now = datetime.now(UTC)
        saved = SavedRecipe(len(self._rows) + 1, recipe, now, now)
        self._rows.append((self.user_id, saved))
        return saved

    def update(self, recipe_id: int, recipe: CookbookRecipeIn) -> SavedRecipe | None:
        saved = self.get(recipe_id)
        if saved is not None:
            saved.recipe, saved.updated_at = recipe, datetime.now(UTC)
        return saved

    def delete(self, recipe_id: int) -> bool:
        for n, (u, r) in enumerate(self._rows):
            if u == self.user_id and r.id == recipe_id:
                del self._rows[n]
                return True
        return False

    def set_photo(self, recipe_id: int, path: str | None) -> None:
        saved = self.get(recipe_id)
        if saved is not None:
            saved.photo_path = path


class DbCookbook:
    def __init__(self, conn: psycopg.Connection, user_id: str):
        if not user_id:
            raise ValueError("user_id is required")
        self.conn, self.user_id = conn, user_id

    @staticmethod
    def _saved(row) -> SavedRecipe:
        rid, recipe, created, updated, photo = row
        return SavedRecipe(rid, CookbookRecipeIn.model_validate(recipe), created, updated, photo)

    def list(self) -> list[SavedRecipe]:
        rows = self.conn.execute(
            "select id, recipe, created_at, updated_at, photo_path from user_recipes"
            " where user_id = %s order by created_at desc, id desc",
            (self.user_id,),
        ).fetchall()
        return [self._saved(r) for r in rows]

    def get(self, recipe_id: int) -> SavedRecipe | None:
        row = self.conn.execute(
            "select id, recipe, created_at, updated_at, photo_path from user_recipes"
            " where user_id = %s and id = %s",
            (self.user_id, recipe_id),
        ).fetchone()
        return None if row is None else self._saved(row)

    def add(self, recipe: CookbookRecipeIn) -> SavedRecipe:
        with self.conn.transaction():
            (count,) = self.conn.execute(
                "select count(*) from user_recipes where user_id = %s", (self.user_id,)
            ).fetchone()
            if count >= MAX_RECIPES_PER_USER:
                raise CookbookFull(f"A cookbook holds at most {MAX_RECIPES_PER_USER} recipes.")
            row = self.conn.execute(
                "insert into user_recipes (user_id, recipe) values (%s, %s)"
                " returning id, recipe, created_at, updated_at, photo_path",
                (self.user_id, recipe.model_dump_json()),
            ).fetchone()
        return self._saved(row)

    def update(self, recipe_id: int, recipe: CookbookRecipeIn) -> SavedRecipe | None:
        with self.conn.transaction():
            row = self.conn.execute(
                "update user_recipes set recipe = %s, updated_at = now()"
                " where user_id = %s and id = %s"
                " returning id, recipe, created_at, updated_at, photo_path",
                (recipe.model_dump_json(), self.user_id, recipe_id),
            ).fetchone()
        return None if row is None else self._saved(row)

    def delete(self, recipe_id: int) -> bool:
        with self.conn.transaction():
            cur = self.conn.execute(
                "delete from user_recipes where user_id = %s and id = %s",
                (self.user_id, recipe_id),
            )
        return cur.rowcount > 0

    def set_photo(self, recipe_id: int, path: str | None) -> None:
        with self.conn.transaction():
            self.conn.execute(
                "update user_recipes set photo_path = %s where user_id = %s and id = %s",
                (path, self.user_id, recipe_id),
            )
