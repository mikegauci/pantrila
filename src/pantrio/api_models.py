"""HTTP request and response models."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, Field, model_validator

from pantrio.cookbook import (
    CookbookRecipeIn,
    LineView,
    Platform,
    Source,
)
from pantrio.recipe_import import (
    MAX_FRAMES,
    MAX_IMAGES,
    MAX_PAGE_CHARS,
    NamedEstimate,
)
from pantrio.schema import (
    Allergen,
    DietTag,
    MealType,
    NutritionFacts,
    NutritionTargets,
    Unit,
)
from pantrio.search import SearchFilters
from pantrio.social import MAX_CAPTION_CHARS

MAX_MESSAGE_CHARS = 2000

# --- Response models ----------------------------------------------------------------------


class RecipeCard(BaseModel):
    id: str
    title: str
    summary: str
    cuisine: str
    meal_types: list[MealType]
    diet_tags: list[DietTag]
    allergens: list[Allergen]
    total_minutes: int
    servings: int
    nutrition: NutritionFacts
    ingredient_count: int
    pantry_foods: list[str] = Field(description="Foods from the person's pantry it uses.")
    problems: list[str] = Field(description="Hard rules it breaks for the person; empty if none.")
    photo_url: str | None = Field(default=None, description="4:3 photo; none yet if null.")


class IngredientView(BaseModel):
    name: str
    food: str
    quantity: float
    unit: Unit
    grams: float
    in_pantry: bool


class RecipeDetail(RecipeCard):
    ingredients: list[IngredientView]
    steps: list[str]


class RecipeList(BaseModel):
    query: str
    rules: SearchFilters = Field(description="Filters applied, the person's rules included.")
    recipes: list[RecipeCard]


class SwapView(BaseModel):
    food: str
    replacement: str
    safe: bool
    problems: list[str]
    added_allergens: list[Allergen]
    lost_diets: list[DietTag]
    kcal_change: float
    protein_change: float
    nutrition: NutritionFacts


class SwapList(BaseModel):
    recipe_id: str
    food: str
    swaps: list[SwapView]


class FoodView(BaseModel):
    key: str
    name: str
    aisle: str


class PantryItemView(FoodView):
    quantity: float | None
    unit: Unit | None
    grams: float | None


class PantryAdd(BaseModel):
    food: str = Field(min_length=1, max_length=80)
    quantity: float | None = Field(default=None, gt=0)
    unit: Unit | None = None


class CookRequest(BaseModel):
    recipe_id: str | None = Field(
        default=None,
        min_length=1,
        max_length=200,
        description="A Pantrio recipe; or set cookbook_id.",
    )
    cookbook_id: int | None = Field(default=None, description="A cookbook recipe.")
    servings: int = Field(ge=1, le=24)
    update_pantry: bool = Field(default=True, description="Take what was used out of the pantry.")

    @model_validator(mode="after")
    def _one_recipe(self) -> CookRequest:
        if (self.recipe_id is None) == (self.cookbook_id is None):
            raise ValueError("set exactly one of recipe_id and cookbook_id")
        return self


class PantryChangeView(BaseModel):
    food: str
    name: str
    used_g: float
    unit: Unit
    before: float = Field(description="Quantity in `unit` before cooking.")
    after: float | None = Field(description="Quantity left; null when used up and removed.")


class CookedView(BaseModel):
    id: int
    recipe_id: str | None
    cookbook_id: int | None
    title: str
    servings: int
    pantry_updated: bool
    cooked_at: datetime


class CookResult(BaseModel):
    cooked: CookedView | None = Field(description="The log entry; null for a preview.")
    pantry: list[PantryChangeView] = Field(
        description="Pantry items the recipe uses, before and after; applied unless a preview "
        "or update_pantry is false."
    )


class Meta(BaseModel):
    allergens: list[Allergen]
    diets: list[DietTag]
    meal_types: list[MealType]
    units: list[Unit]
    cuisines: list[str]


class LimitsView(BaseModel):
    plans_per_day: int
    plans_left: int
    chats_per_day: int
    chats_left: int
    imports_per_day: int
    imports_left: int
    photos_per_day: int
    photos_left: int


class Me(BaseModel):
    id: str
    email: str | None
    anonymous: bool
    avatar_url: str | None = Field(description="Uploaded profile picture; null: show the emoji.")
    limits: LimitsView


class PlanMealView(BaseModel):
    meal_type: MealType
    portions: float
    recipe: RecipeCard


class PlanDayView(BaseModel):
    day: int
    meals: list[PlanMealView]
    nutrition: NutritionFacts = Field(description="Per person, at the planned portions.")


class PlanProblem(BaseModel):
    day: int
    meal_type: MealType
    recipe_id: str
    message: str


class PlanView(BaseModel):
    id: int
    created_at: datetime
    days: list[PlanDayView]
    notes: str
    targets: NutritionTargets
    problems: list[PlanProblem] = Field(
        description="Meals that break the person's current hard rules (e.g. a new allergy)."
    )
    report: dict = Field(description="Planner metrics: warnings, repairs, cost, latency, path.")


class MealOptionView(BaseModel):
    recipe: RecipeCard
    portions: float = Field(description="Servings per person that fit the day's targets best.")
    day_nutrition: NutritionFacts = Field(description="The day's total per person with this meal.")
    kcal_change: float = Field(description="Change in the day's kcal against the current meal.")


class MealOptions(BaseModel):
    plan_id: int
    day: int
    meal_type: MealType
    current: PlanMealView
    options: list[MealOptionView] = Field(
        description="Recipes that pass the person's rules for this slot, best fit first."
    )


class SwapMealRequest(BaseModel):
    plan_id: int = Field(description="The plan being edited; a newer plan makes this a conflict.")
    recipe_id: str


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=MAX_MESSAGE_CHARS)
    thread_id: int | None = Field(default=None, description="Thread to continue; none starts one.")


class ToolCallView(BaseModel):
    name: str
    arguments: dict
    output: str


class ChatReply(BaseModel):
    thread_id: int
    text: str
    cited: list[RecipeCard]
    flagged: list[str]
    tool_calls: list[ToolCallView]
    pantry_changed: bool
    cost_usd: float | None
    latency_ms: float
    profile_problems: list[str] = Field(default_factory=list)
    draft_problems: list[list[str]] = Field(default_factory=list)
    drafts: list[CookbookRecipeIn] = Field(
        default=[], description="Recipes the assistant wrote, for the cookbook's review form."
    )


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    text: str
    reply: ChatReply | None = None


class ChatThreadSummary(BaseModel):
    id: int
    title: str
    messages: int
    updated_at: datetime


class ChatThreadView(BaseModel):
    id: int
    title: str
    messages: list[ChatMessage]
    updated_at: datetime


class CookbookCard(BaseModel):
    id: int
    title: str
    summary: str
    cuisine: str
    meal_types: list[MealType]
    total_minutes: int
    servings: int
    source: Source
    source_url: str | None
    source_platform: Platform | None = None
    source_author: str | None = None
    recipe_url: str | None = Field(default=None, description="Recipe site a post linked to.")
    created_at: datetime
    updated_at: datetime
    ingredient_count: int
    # Derived in code; empty with `invalid` set when the stored lines no longer check out
    # (e.g. a food was removed from the ingredient table).
    nutrition: NutritionFacts | None
    allergens: list[Allergen]
    diet_tags: list[DietTag]
    estimated: bool
    invalid: list[str]
    pantry_foods: list[str]
    problems: list[str] = Field(description="Hard rules it breaks for the person; empty if none.")
    photo_url: str | None = Field(default=None, description="Generated 4:3 photo, if any.")


class CookbookLine(LineView):
    in_pantry: bool


class CookbookDetail(CookbookCard):
    ingredients: list[CookbookLine]
    steps: list[str]
    recipe: CookbookRecipeIn = Field(description="As stored, for the edit form.")


class CookbookPreview(BaseModel):
    ingredients: list[LineView]
    nutrition: NutritionFacts
    allergens: list[Allergen]
    diet_tags: list[DietTag]
    estimated: bool
    problems: list[str]


class LinkImport(BaseModel):
    url: str = Field(min_length=4, max_length=2000)


class PostImport(BaseModel):
    url: str | None = Field(default=None, max_length=2000, description="The post's link.")
    caption: str | None = Field(
        default=None, max_length=MAX_CAPTION_CHARS, description="Pasted; else read from the link."
    )

    @model_validator(mode="after")
    def _something(self) -> PostImport:
        if not (self.url or "").strip() and not (self.caption or "").strip():
            raise ValueError("Paste the post's link or its caption.")
        return self


class TextImport(BaseModel):
    text: str = Field(min_length=10, max_length=MAX_PAGE_CHARS)


class PhotoImport(BaseModel):
    images: list[str] = Field(
        min_length=1, max_length=MAX_IMAGES, description="Data URLs: JPEG, PNG or WebP, < 4 MB."
    )


class VideoImport(BaseModel):
    audio: str | None = Field(
        default=None,
        max_length=17_000_000,
        description="Data URL: the video's sound as WAV, up to 3 minutes; null when it has none.",
    )
    frames: list[str] = Field(
        default_factory=list, max_length=MAX_FRAMES, description="Data URLs of video frames."
    )
    url: str | None = Field(default=None, max_length=2000, description="The post's link.")
    caption: str | None = Field(default=None, max_length=MAX_CAPTION_CHARS)


class AvatarIn(BaseModel):
    image: str = Field(description="Data URL: JPEG, PNG or WebP, < 4 MB.")


class EstimateRequest(BaseModel):
    names: list[Annotated[str, Field(min_length=1, max_length=120)]] = Field(
        min_length=1, max_length=10
    )


class ImportView(BaseModel):
    draft: CookbookRecipeIn
    notes: list[str] = Field(description="What to check or fix before saving.")
    cost_usd: float | None
    transcription_cost_usd: float | None = Field(
        default=0.0, description="The part of cost_usd spent transcribing a video's sound."
    )
    latency_ms: float


class EstimateView(BaseModel):
    estimates: list[NamedEstimate]
    cost_usd: float | None


class UsageEventView(BaseModel):
    kind: str
    model: str
    created_at: datetime
    latency_ms: int
    llm_calls: int
    tool_calls: int
    input_tokens: int
    output_tokens: int
    cost_usd: float | None
    ok: bool


class UsageView(BaseModel):
    events: list[UsageEventView]
    limits: LimitsView
