"""HTTP API for the web app: recipes, profile, pantry, plans, grocery list, chat and cookbook.

Every route except /health needs a Supabase Auth access token; its user id scopes all data.
The same safety rules as the CLI apply: search filters run in SQL, plans come out of the
planner's checker, chat replies pass the citation guard, and every recipe shown is checked
against the person's current profile so a later allergy change shows up loudly.

Planning takes 10 to 90 seconds, so POST /plans streams server-sent events: one `step` per
LangGraph node as it finishes, then `plan` (the saved plan) or `error`.

Chat threads (/me/chats) are saved per user; each POST /chat continues one thread (or starts
one) and the server, not the client, supplies that thread's history to the assistant.

The cookbook (/me/recipes) holds recipes people add from a photo, a link or by hand. Imports
return a draft for the person to review; nothing is saved until they post it back. Grams,
nutrition, allergens and diets are derived in code on every read, like the corpus. A cookbook
recipe can get a generated photo (POST /me/recipes/{id}/photo), capped per user per day.

Recipes carry `photo_url` when they have a photo (Supabase Storage; see pantrio.photos), else
null and the web app shows its placeholder art.

Run: uv run uvicorn pantrio.api:app --env-file .env --reload
"""

from __future__ import annotations

import base64
import json
import logging
import queue
import threading
from collections.abc import Callable, Iterable, Iterator
from contextlib import AbstractContextManager, asynccontextmanager, contextmanager
from dataclasses import dataclass
from datetime import UTC, datetime
from datetime import time as dtime
from typing import Annotated, Any, Literal, Protocol

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field

from pantrio import config
from pantrio.assistant import Assistant
from pantrio.auth import AuthError, User, verifier
from pantrio.chats import Chats, SavedThread, title_for
from pantrio.constraints import day_nutrition, recipe_problems
from pantrio.cookbook import (
    Cookbook,
    CookbookError,
    CookbookFull,
    CookbookRecipeIn,
    Derived,
    LineView,
    SavedRecipe,
    Source,
    derive,
    problems_for,
)
from pantrio.foods import UnitError, load_foods
from pantrio.grocery import grocery_list
from pantrio.operations import EmbeddingUsage, PaidOperation, daily_cap
from pantrio.pantry import Kitchen, UnknownFood, make_item, resolve_food
from pantrio.photos import (
    Dish,
    PhotoStore,
    PhotoUsage,
    avatar_path,
    cookbook_path,
    generate,
    photo_store,
    public_url,
    to_avatar_webp,
)
from pantrio.planner import Planner, PlanningError, RecipeStore, Usage
from pantrio.recipe_import import (
    MAX_IMAGES,
    Importer,
    ImportFailed,
    NamedEstimate,
    check_image,
)
from pantrio.records import Records, SavedPlan
from pantrio.schema import (
    Allergen,
    DietTag,
    GroceryList,
    MealType,
    NutritionFacts,
    NutritionTargets,
    Recipe,
    Unit,
    UserProfile,
)
from pantrio.search import SearchFilters
from pantrio.swaps import Swap, evaluate_swap, swap_options

log = logging.getLogger("pantrio.api")

MAX_MESSAGE_CHARS = 2000
MAX_CHAT_HISTORY = 20


# --- Backends ---------------------------------------------------------------------------------


class Catalog(RecipeStore, Protocol):
    def browse(self, filters: SearchFilters, limit: int) -> list[str]: ...

    def photos(self, ids: Iterable[str]) -> dict[str, str]:
        """Photo paths by recipe id; recipes without a photo are left out."""
        ...


@dataclass
class Session:
    """Everything one request needs, scoped to one user."""

    store: Catalog
    kitchen: Kitchen
    records: Records
    cookbook: Cookbook
    chats: Chats


class Backend(Protocol):
    client: Any  # OpenAI client, or None for the default
    photos: PhotoStore | None  # None: photo generation is off (no Storage key)

    def session(self, user_id: str) -> AbstractContextManager[Session]: ...

    def close(self) -> None: ...


class DbBackend:
    """Postgres through a small connection pool; one connection per request."""

    def __init__(self, url: str, max_size: int = 8):
        from psycopg_pool import ConnectionPool

        from pantrio.search import openai_query_embedder

        self.pool = ConnectionPool(url, min_size=1, max_size=max_size,
                                   kwargs={"autocommit": True}, open=True)  # fmt: skip
        self.embed_query = openai_query_embedder(config.embed_model())
        self.client = None
        self.photos = photo_store()

    @contextmanager
    def session(self, user_id: str) -> Iterator[Session]:
        from pantrio.chats import DbChats
        from pantrio.cookbook import DbCookbook
        from pantrio.pantry import DbKitchen
        from pantrio.records import DbRecords

        yield Session(
            PooledCatalog(self.pool, self.embed_query),
            PooledRepository(self.pool, DbKitchen, user_id),
            PooledRepository(self.pool, DbRecords, user_id),
            PooledRepository(self.pool, DbCookbook, user_id),
            PooledRepository(self.pool, DbChats, user_id),
        )

    def close(self) -> None:
        self.pool.close()
        if self.photos is not None:
            self.photos.close()


class PooledRepository:
    """Borrow a connection for one repository method, never for an external call."""

    def __init__(self, pool, factory, *args):
        self.pool, self.factory, self.args = pool, factory, args

    def __getattr__(self, name):
        def call(*args, **kwargs):
            with self.pool.connection() as conn:
                return getattr(self.factory(conn, *self.args), name)(*args, **kwargs)

        return call


class PooledCatalog(PooledRepository):
    def __init__(self, pool, embed_query):
        from pantrio.planner import DbStore

        super().__init__(pool, DbStore, embed_query)
        self.embed_query, self.embed_tokens = embed_query, 0

    def search(self, query, filters, limit):
        from pantrio.search import search

        # Embedding I/O happens before acquiring a database connection.
        vector, tokens = self.embed_query(query)
        self.embed_tokens += tokens
        with self.pool.connection() as conn:
            return search(conn, query, filters, limit=limit, embed_query=lambda _: (vector, 0)).ids


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


class PhotoImport(BaseModel):
    images: list[str] = Field(
        min_length=1, max_length=MAX_IMAGES, description="Data URLs: JPEG, PNG or WebP, < 4 MB."
    )


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


# --- Views --------------------------------------------------------------------------------


def food_name(key: str) -> str:
    return key.replace("_", " ")


def problem_messages(r: Recipe, profile: UserProfile) -> list[str]:
    return [msg.removeprefix(f"{r.id} ") for _, msg in recipe_problems(r, profile)]


def recipe_card(r: Recipe, profile: UserProfile, photo: str | None = None) -> RecipeCard:
    return RecipeCard(
        **r.model_dump(include=set(RecipeCard.model_fields) & set(Recipe.model_fields)),
        ingredient_count=len(r.ingredients),
        pantry_foods=sorted(r.foods & set(profile.pantry)),
        problems=problem_messages(r, profile),
        photo_url=public_url(photo),
    )


def recipe_detail(r: Recipe, profile: UserProfile, photo: str | None = None) -> RecipeDetail:
    pantry = set(profile.pantry)
    return RecipeDetail(
        **recipe_card(r, profile, photo).model_dump(),
        ingredients=[IngredientView(**i.model_dump(), in_pantry=i.food in pantry)
                     for i in r.ingredients],
        steps=r.steps,
    )  # fmt: skip


def swap_view(s: Swap) -> SwapView:
    return SwapView(
        food=s.food, replacement=s.replacement, safe=s.safe, problems=list(s.problems),
        added_allergens=sorted(s.added_allergens), lost_diets=sorted(s.lost_diets),
        kcal_change=s.kcal_change, protein_change=s.protein_change, nutrition=s.recipe.nutrition,
    )  # fmt: skip


def cookbook_detail(saved: SavedRecipe, profile: UserProfile) -> CookbookDetail:
    r, pantry = saved.recipe, set(profile.pantry)
    try:
        d: Derived | None = derive(r)
        invalid: list[str] = []
    except CookbookError as exc:
        d, invalid = None, exc.problems
    lines = d.ingredients if d else [LineView(**i.model_dump(), grams=0) for i in r.ingredients]
    return CookbookDetail(
        id=saved.id, title=r.title, summary=r.summary, cuisine=r.cuisine,
        meal_types=r.meal_types, total_minutes=r.total_minutes, servings=r.servings,
        source=r.source, source_url=r.source_url, created_at=saved.created_at,
        updated_at=saved.updated_at, ingredient_count=len(r.ingredients),
        nutrition=d.nutrition if d else None, allergens=d.allergens if d else [],
        diet_tags=d.diet_tags if d else [], estimated=d.estimated if d else False,
        invalid=invalid, pantry_foods=sorted(set(d.foods) & pantry) if d else [],
        problems=problems_for(r, d, profile) if d else [],
        photo_url=public_url(saved.photo_path),
        ingredients=[CookbookLine(**line.model_dump(), in_pantry=line.food in pantry)
                     for line in lines],
        steps=r.steps, recipe=r,
    )  # fmt: skip


def cookbook_card(saved: SavedRecipe, profile: UserProfile) -> CookbookCard:
    detail = cookbook_detail(saved, profile)
    return CookbookCard(**detail.model_dump(include=set(CookbookCard.model_fields)))


def plan_view(saved: SavedPlan, store: Catalog, profile: UserProfile) -> PlanView:
    ids = {m.recipe_id for _, m in saved.plan.meals}
    recipes, photos = store.get(ids), store.photos(ids)
    days, problems = [], []
    for day in saved.plan.days:
        meals = []
        for m in day.meals:
            r = recipes.get(m.recipe_id)
            if r is None:  # removed from the corpus since; never show it
                problems.append(
                    PlanProblem(
                        day=day.day,
                        meal_type=m.meal_type,
                        recipe_id=m.recipe_id,
                        message="is no longer in Pantrio's recipes",
                    )
                )
                continue
            problems += [
                PlanProblem(day=day.day, meal_type=m.meal_type, recipe_id=r.id, message=msg)
                for msg in problem_messages(r, profile)
            ]
            card = recipe_card(r, profile, photos.get(r.id))
            meals.append(PlanMealView(meal_type=m.meal_type, portions=m.portions, recipe=card))
        days.append(PlanDayView(day=day.day, meals=meals, nutrition=day_nutrition(day, recipes)))
    return PlanView(id=saved.id, created_at=saved.created_at, days=days, notes=saved.plan.notes,
                    targets=profile.targets, problems=problems, report=saved.report)  # fmt: skip


def plan_report(result, model: str) -> dict:
    u = result.usage
    return {
        "model": model,
        "warnings": [str(v) for v in result.warnings],
        "first_draft_problems": [str(v) for v in result.first_draft_violations],
        "repairs": result.repairs,
        "fallbacks": result.fallbacks,
        "pantry_use": round(result.pantry_use, 3),
        "path": result.path,
        "llm_calls": u.llm_calls,
        "tool_calls": u.tool_calls,
        "input_tokens": u.input_tokens,
        "output_tokens": u.output_tokens,
        "cost_usd": u.cost(),
        "latency_ms": round(result.latency_ms),
    }


def today_start() -> datetime:
    return datetime.combine(datetime.now(UTC).date(), dtime.min, tzinfo=UTC)


def limits_view(records: Records) -> LimitsView:
    since = today_start()
    left = {k: max(0, daily_cap(k) - records.count_since(k, since))
            for k in ("plan", "chat", "import", "photo")}  # fmt: skip
    return LimitsView(
        plans_per_day=daily_cap("plan"), plans_left=left["plan"],
        chats_per_day=daily_cap("chat"), chats_left=left["chat"],
        imports_per_day=daily_cap("import"), imports_left=left["import"],
        photos_per_day=daily_cap("photo"), photos_left=left["photo"],
    )  # fmt: skip


# --- App ----------------------------------------------------------------------------------


def current_user(request: Request, authorization: Annotated[str | None, Header()] = None) -> User:
    scheme, _, token = (authorization or "").partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(401, "Sign in first.", {"WWW-Authenticate": "Bearer"})
    try:
        return request.app.state.verify(token)
    except AuthError as exc:
        raise HTTPException(401, f"Invalid token: {exc}",
                            {"WWW-Authenticate": "Bearer"}) from exc  # fmt: skip


UserDep = Annotated[User, Depends(current_user)]


def session(request: Request, user: UserDep) -> Iterator[Session]:
    with request.app.state.backend.session(user.id) as s:
        yield s


SessionDep = Annotated[Session, Depends(session)]


def describe_failure(exc: Exception, what: str = "Reading the recipe") -> str:
    """A plain-language reason for a failed paid call, with the provider's message."""
    import openai

    if isinstance(exc, openai.APITimeoutError):
        if what != "Reading the recipe":
            return "The AI model took too long. Try again."
        return "The AI model took too long to read this. Try again, or use fewer or smaller photos."
    if isinstance(exc, openai.RateLimitError):
        return "The AI provider is rate-limiting requests right now. Wait a minute and try again."
    if isinstance(exc, openai.APIConnectionError):
        return "The server could not reach the AI provider. Try again in a moment."
    if isinstance(exc, openai.BadRequestError):
        return f"The AI provider rejected the request: {getattr(exc, 'message', exc)}"
    if isinstance(exc, openai.APIStatusError):
        return f"The AI provider returned an error ({exc.status_code}). Try again."
    return f"{what} failed ({type(exc).__name__}: {str(exc)[:200]}). Try again."


def create_app(
    backend: Backend | None = None, verify: Callable[[str], User] | None = None
) -> FastAPI:
    """The API. Tests pass an in-memory backend and a token verifier; production builds a
    Postgres backend and verifies Supabase tokens at startup."""

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.backend = backend or DbBackend(config.database_url())
        app.state.verify = verify or verifier(config.supabase_url()).verify
        yield
        app.state.backend.close()

    app = FastAPI(title="Pantrio API", version="0.4.0", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=config.cors_origins(),
        allow_methods=["*"],
        allow_headers=["Authorization", "Content-Type"],
    )

    def get_recipe(s: Session, recipe_id: str) -> Recipe:
        r = s.store.get([recipe_id]).get(recipe_id)
        if r is None:
            raise HTTPException(404, f"No recipe {recipe_id}.")
        return r

    @app.get("/health")
    def health() -> dict:
        return {"ok": True}

    @app.get("/meta")
    def meta(_: UserDep) -> Meta:
        from pantrio.corpus import load_briefs

        return Meta(allergens=list(Allergen), diets=list(DietTag), meal_types=list(MealType),
                    units=list(Unit),
                    cuisines=sorted({b.cuisine for b in load_briefs()}))  # fmt: skip

    @app.get("/foods")
    def foods(_: UserDep) -> list[FoodView]:
        return [FoodView(key=k, name=food_name(k), aisle=f.aisle)
                for k, f in sorted(load_foods().items()) if f.aisle != "tap"]  # fmt: skip

    @app.get("/me")
    def me(user: UserDep, s: SessionDep) -> Me:
        return Me(id=user.id, email=user.email, anonymous=user.anonymous,
                  avatar_url=public_url(s.records.avatar_path()),
                  limits=limits_view(s.records))  # fmt: skip

    @app.put("/me/avatar")
    def put_avatar(body: AvatarIn, request: Request, user: UserDep, s: SessionDep) -> Me:
        """Replace the profile picture: any image is re-encoded as a 256 px square WebP."""
        backend: Backend = request.app.state.backend
        if backend.photos is None:
            raise HTTPException(503, "Pictures are not set up on this server.")
        try:
            data = base64.b64decode(check_image(body.image).split(",", 1)[1])
            webp = to_avatar_webp(data)
        except ImportFailed as exc:
            raise HTTPException(422, str(exc)) from exc
        except Exception as exc:  # Pillow raises many types for a corrupt file
            raise HTTPException(422, "That file is not a picture Pantrio can read.") from exc
        old, path = s.records.avatar_path(), avatar_path(user.id)
        try:
            backend.photos.put(path, webp)
        except Exception as exc:
            log.exception("avatar upload failed")
            raise HTTPException(502, "The picture could not be saved. Try again.") from exc
        s.records.set_avatar(path)
        drop_photo(request, old)
        return me(user, s)

    @app.delete("/me/avatar")
    def delete_avatar(request: Request, user: UserDep, s: SessionDep) -> Me:
        old = s.records.avatar_path()
        s.records.set_avatar(None)
        drop_photo(request, old)
        return me(user, s)

    @app.get("/me/profile")
    def get_profile(s: SessionDep) -> UserProfile:
        return s.kitchen.profile()

    @app.put("/me/profile")
    def put_profile(profile: UserProfile, s: SessionDep) -> UserProfile:
        try:
            excluded = sorted({resolve_food(f) for f in profile.exclude_foods})
        except UnknownFood as exc:
            raise HTTPException(422, str(exc)) from exc
        s.kitchen.save_profile(profile.model_copy(update={"exclude_foods": excluded}))
        return s.kitchen.profile()

    @app.get("/me/pantry")
    def get_pantry(s: SessionDep) -> list[PantryItemView]:
        foods = load_foods()
        return [PantryItemView(key=i.food, name=food_name(i.food), aisle=foods[i.food].aisle,
                               quantity=i.quantity, unit=i.unit, grams=i.grams)
                for i in s.kitchen.pantry()]  # fmt: skip

    @app.post("/me/pantry", status_code=201)
    def add_pantry(body: PantryAdd, s: SessionDep) -> PantryItemView:
        try:
            item = make_item(body.food, body.quantity, body.unit)
        except UnknownFood as exc:
            return JSONResponse(  # type: ignore[return-value]
                {"detail": str(exc), "suggestions": exc.suggestions}, status_code=422
            )
        except UnitError as exc:
            raise HTTPException(422, str(exc)) from exc
        s.kitchen.put(item)
        return PantryItemView(key=item.food, name=food_name(item.food),
                              aisle=load_foods()[item.food].aisle, quantity=item.quantity,
                              unit=item.unit, grams=item.grams)  # fmt: skip

    @app.delete("/me/pantry/{food}", status_code=204)
    def remove_pantry(food: str, s: SessionDep) -> Response:
        if not s.kitchen.remove(food):
            raise HTTPException(404, f"{food_name(food)} is not in your pantry.")
        return Response(status_code=204)

    @app.get("/me/usage")
    def usage(s: SessionDep) -> UsageView:
        events = [UsageEventView(**{k: getattr(e, k) for k in UsageEventView.model_fields})
                  for e in s.records.events(100)]  # fmt: skip
        return UsageView(events=events, limits=limits_view(s.records))

    @app.get("/recipes")
    def recipes(
        s: SessionDep,
        q: str = "",
        meal: MealType | None = None,
        max_minutes: Annotated[int | None, Query(gt=0)] = None,
        cuisine: str | None = None,
        diet: Annotated[list[DietTag] | None, Query()] = None,
        safe: bool = True,
        limit: Annotated[int, Query(ge=1, le=60)] = 24,
    ) -> RecipeList:
        """Hybrid search, or browse by title when `q` is empty. With `safe` (the default) the
        person's allergies, diets, excluded foods and time limit are added as filters."""
        profile = s.kitchen.profile()
        diets, limits = set(diet or []), [m for m in (max_minutes,) if m]
        f = SearchFilters(meal_types=[meal] if meal else [],
                          cuisines=[cuisine] if cuisine else [])  # fmt: skip
        if safe:
            diets |= set(profile.diets)
            limits += [profile.max_minutes] if profile.max_minutes else []
            f.exclude_allergens = profile.allergies
            f.exclude_foods = profile.exclude_foods
        f.require_diets = sorted(diets)
        f.max_minutes = min(limits) if limits else None
        q = q.strip()[:200]
        if q:
            operation = PaidOperation(s.records, "search", config.embed_model())
            before = s.store.embed_tokens
            try:
                ids = s.store.search(q, f, limit)
            except Exception:
                operation.finish(
                    EmbeddingUsage(embed_tokens=s.store.embed_tokens - before), ok=False
                )
                raise
            operation.finish(EmbeddingUsage(embed_tokens=s.store.embed_tokens - before))
        else:
            ids = s.store.browse(f, limit)
        found, photos = s.store.get(ids), s.store.photos(ids)
        return RecipeList(query=q, rules=f, recipes=[recipe_card(found[i], profile, photos.get(i))
                                                     for i in ids if i in found])  # fmt: skip

    @app.get("/recipes/{recipe_id}")
    def recipe(recipe_id: str, s: SessionDep) -> RecipeDetail:
        photo = s.store.photos([recipe_id]).get(recipe_id)
        return recipe_detail(get_recipe(s, recipe_id), s.kitchen.profile(), photo)

    @app.get("/recipes/{recipe_id}/swaps")
    def swaps(recipe_id: str, food: str, s: SessionDep, replacement: str | None = None
              ) -> SwapList:  # fmt: skip
        """Safe swaps for an ingredient, or the verdict on one replacement the person named."""
        r, profile = get_recipe(s, recipe_id), s.kitchen.profile()
        try:
            key = resolve_food(food)
            if key not in r.foods:
                raise HTTPException(422, f"{r.title} does not use {food_name(key)}.")
            if replacement:
                options = [evaluate_swap(r, key, resolve_food(replacement), profile)]
            else:
                options = swap_options(r, key, profile)
        except UnknownFood as exc:
            raise HTTPException(422, str(exc)) from exc
        return SwapList(recipe_id=r.id, food=key, swaps=[swap_view(o) for o in options])

    # --- Cookbook: the person's own recipes ---

    def get_saved(s: Session, recipe_id: int) -> SavedRecipe:
        saved = s.cookbook.get(recipe_id)
        if saved is None:
            raise HTTPException(404, "No such recipe in your cookbook.")
        return saved

    def checked(recipe: CookbookRecipeIn) -> CookbookRecipeIn:
        """Only recipes whose every line derives cleanly are saved."""
        try:
            derive(recipe)
        except CookbookError as exc:
            raise HTTPException(422, {"message": "Fix these first.", "problems": exc.problems}
                                ) from exc  # fmt: skip
        return recipe

    def paid_import(s: Session, request: Request, work: Callable[[Importer], Any]) -> tuple:
        """Run one paid import or estimate under the daily cap and log its usage.
        Returns (work's result, the importer, latency in ms)."""
        model = config.model()
        importer = Importer(client=request.app.state.backend.client, model=model)
        operation = PaidOperation(s.records, "import", model)

        def logged(ok: bool) -> float:
            return operation.finish(importer.usage, ok, discard_empty=True)

        try:
            result = work(importer)
        except ImportFailed as exc:
            logged(ok=False)
            raise HTTPException(422, str(exc)) from exc
        except Exception as exc:
            logged(ok=False)
            log.exception("recipe import failed")
            raise HTTPException(502, describe_failure(exc)) from exc
        return result, importer, logged(ok=True)

    def import_view(s: Session, request: Request, work: Callable[[Importer], Any]) -> ImportView:
        result, importer, ms = paid_import(s, request, work)
        return ImportView(draft=result.draft, notes=result.notes,
                          cost_usd=importer.usage.cost(), latency_ms=round(ms))  # fmt: skip

    @app.get("/me/recipes")
    def my_recipes(s: SessionDep) -> list[CookbookCard]:
        profile = s.kitchen.profile()
        return [cookbook_card(r, profile) for r in s.cookbook.list()]

    @app.post("/me/recipes", status_code=201)
    def add_recipe(body: CookbookRecipeIn, s: SessionDep) -> CookbookDetail:
        try:
            saved = s.cookbook.add(checked(body))
        except CookbookFull as exc:
            raise HTTPException(409, str(exc)) from exc
        return cookbook_detail(saved, s.kitchen.profile())

    @app.post("/me/recipes/preview")
    def preview_recipe(body: CookbookRecipeIn, s: SessionDep) -> CookbookPreview:
        """What saving would derive, so the form can show nutrition and warnings live."""
        d = derive(checked(body))
        return CookbookPreview(**d.model_dump(exclude={"foods"}),
                               problems=problems_for(body, d, s.kitchen.profile()))  # fmt: skip

    @app.post("/me/recipes/import/link")
    def import_link(body: LinkImport, request: Request, s: SessionDep) -> ImportView:
        return import_view(s, request, lambda i: i.from_link(body.url))

    @app.post("/me/recipes/import/photos")
    def import_photos(body: PhotoImport, request: Request, s: SessionDep) -> ImportView:
        return import_view(s, request, lambda i: i.from_photos(body.images))

    @app.post("/me/recipes/estimate")
    def estimate_foods(body: EstimateRequest, request: Request, s: SessionDep) -> EstimateView:
        """Nutrition and allergen estimates for foods the ingredient table lacks."""
        estimates, importer, _ = paid_import(s, request, lambda i: i.estimate(body.names))
        return EstimateView(estimates=estimates, cost_usd=importer.usage.cost())

    @app.get("/me/recipes/{recipe_id}")
    def my_recipe(recipe_id: int, s: SessionDep) -> CookbookDetail:
        return cookbook_detail(get_saved(s, recipe_id), s.kitchen.profile())

    @app.put("/me/recipes/{recipe_id}")
    def update_recipe(recipe_id: int, body: CookbookRecipeIn, s: SessionDep) -> CookbookDetail:
        saved = s.cookbook.update(recipe_id, checked(body))
        if saved is None:
            raise HTTPException(404, "No such recipe in your cookbook.")
        return cookbook_detail(saved, s.kitchen.profile())

    @app.delete("/me/recipes/{recipe_id}", status_code=204)
    def delete_recipe(recipe_id: int, request: Request, s: SessionDep) -> Response:
        saved = get_saved(s, recipe_id)
        if not s.cookbook.delete(recipe_id):
            raise HTTPException(404, "No such recipe in your cookbook.")
        drop_photo(request, saved.photo_path)
        return Response(status_code=204)

    def drop_photo(request: Request, path: str | None) -> None:
        """Best effort: an orphaned file in Storage is harmless, a failed request is not."""
        photos: PhotoStore | None = request.app.state.backend.photos
        if path and photos is not None:
            try:
                photos.delete([path])
            except Exception:
                log.warning("could not delete photo %s", path, exc_info=True)

    @app.post("/me/recipes/{recipe_id}/photo")
    def generate_photo(recipe_id: int, request: Request, user: UserDep, s: SessionDep
                       ) -> CookbookDetail:  # fmt: skip
        """Generate a photo of the recipe from its own ingredients (replaces any earlier one)."""
        saved = get_saved(s, recipe_id)
        old_path = saved.photo_path
        backend: Backend = request.app.state.backend
        if backend.photos is None:
            raise HTTPException(503, "Photos are not set up on this server.")
        r, model = saved.recipe, config.image_model()
        try:
            gluten_free = DietTag.GLUTEN_FREE in derive(r).diet_tags
        except CookbookError:
            gluten_free = False
        dish = Dish(title=r.title, summary=r.summary, ingredients=[i.name for i in r.ingredients],
                    steps=r.steps, gluten_free=gluten_free)  # fmt: skip
        operation = PaidOperation(s.records, "photo", model)
        photo_usage = PhotoUsage()
        try:
            photo = generate(dish, client=backend.client, model=model, usage=photo_usage)
        except Exception as exc:
            operation.finish(photo_usage, ok=False)
            log.exception("photo generation failed")
            raise HTTPException(502, describe_failure(exc, "Making the photo")) from exc
        operation.finish(photo.usage)
        path = cookbook_path(user.id)
        try:
            backend.photos.put(path, photo.webp)
        except Exception as exc:
            log.exception("photo upload failed")
            msg = "The photo was made but could not be saved. Try again."
            raise HTTPException(502, msg) from exc
        s.cookbook.set_photo(recipe_id, path)
        drop_photo(request, old_path)
        return cookbook_detail(get_saved(s, recipe_id), s.kitchen.profile())

    @app.delete("/me/recipes/{recipe_id}/photo")
    def delete_photo(recipe_id: int, request: Request, s: SessionDep) -> CookbookDetail:
        old_path = get_saved(s, recipe_id).photo_path
        s.cookbook.set_photo(recipe_id, None)
        drop_photo(request, old_path)
        return cookbook_detail(get_saved(s, recipe_id), s.kitchen.profile())

    @app.get("/plans/latest")
    def latest_plan(s: SessionDep) -> PlanView:
        saved = s.records.latest_plan()
        if saved is None:
            raise HTTPException(404, "No plan yet.")
        return plan_view(saved, s.store, s.kitchen.profile())

    @app.get("/plans/latest/grocery")
    def latest_grocery(s: SessionDep, people: Annotated[int, Query(ge=1, le=12)] = 1
                       ) -> GroceryList:  # fmt: skip
        saved = s.records.latest_plan()
        if saved is None:
            raise HTTPException(404, "No plan yet.")
        recipes = s.store.get({m.recipe_id for _, m in saved.plan.meals})
        plan = saved.plan.model_copy(update={"days": [
            d.model_copy(update={"meals": [m for m in d.meals if m.recipe_id in recipes]})
            for d in saved.plan.days
        ]})  # fmt: skip
        return grocery_list(plan, recipes, s.kitchen.pantry(), people)

    @app.post("/plans")
    def create_plan(request: Request, user: UserDep) -> StreamingResponse:
        """Plan the week from the saved profile and pantry, streaming progress as SSE."""
        backend: Backend = request.app.state.backend
        with backend.session(user.id) as s:
            operation = PaidOperation(s.records, "plan", config.model())
        events: queue.Queue = queue.Queue()

        def work() -> None:
            model = config.model()
            planner = None
            try:
                with backend.session(user.id) as s:
                    planner = Planner(s.store, client=backend.client, model=model, source="api")
                    try:
                        result = planner.plan(
                            s.kitchen.profile(), on_step=lambda n: events.put(("step", {"node": n}))
                        )
                    except PlanningError as exc:
                        operation.finish(planner.usage, ok=False)
                        events.put(("error", {"message": f"Could not plan: {exc}"}))
                        return
                    operation.finish(result.usage)
                    saved = s.records.save_plan(result.plan, plan_report(result, model))
                    view = plan_view(saved, s.store, s.kitchen.profile())
                    events.put(("plan", view.model_dump(mode="json")))
            except Exception:
                operation.finish(planner.usage if planner else Usage(), ok=False)
                log.exception("planning failed")
                events.put(("error", {"message": "Something went wrong while planning."}))
            finally:
                events.put(None)

        threading.Thread(target=work, daemon=True).start()

        def stream() -> Iterator[str]:
            while (item := events.get()) is not None:
                kind, data = item
                yield f"event: {kind}\ndata: {json.dumps(data)}\n\n"

        return StreamingResponse(stream(), media_type="text/event-stream",
                                 headers={"Cache-Control": "no-cache",
                                          "X-Accel-Buffering": "no"})  # fmt: skip

    # --- Assistant chat, saved as threads ---

    def get_thread(s: Session, thread_id: int) -> SavedThread:
        thread = s.chats.get(thread_id)
        if thread is None:
            raise HTTPException(404, "No such chat.")
        return thread

    @app.get("/me/chats")
    def list_chats(s: SessionDep) -> list[ChatThreadSummary]:
        return [ChatThreadSummary(id=t.id, title=t.title, messages=t.messages,
                                  updated_at=t.updated_at) for t in s.chats.list()]  # fmt: skip

    @app.get("/me/chats/{thread_id}")
    def get_chat(thread_id: int, s: SessionDep) -> ChatThreadView:
        t = get_thread(s, thread_id)
        messages = [ChatMessage.model_validate(m) for m in t.messages]
        return ChatThreadView(id=t.id, title=t.title, messages=messages, updated_at=t.updated_at)

    @app.delete("/me/chats/{thread_id}", status_code=204)
    def delete_chat(thread_id: int, s: SessionDep) -> Response:
        if not s.chats.delete(thread_id):
            raise HTTPException(404, "No such chat.")
        return Response(status_code=204)

    @app.post("/chat")
    def chat(body: ChatRequest, request: Request, s: SessionDep) -> ChatReply:
        thread = None if body.thread_id is None else get_thread(s, body.thread_id)
        backend: Backend = request.app.state.backend
        model = config.model()
        bot = Assistant(s.store, s.kitchen, client=backend.client, model=model, source="api")
        history = (thread.history if thread else [])[-MAX_CHAT_HISTORY:]
        operation = PaidOperation(s.records, "chat", model)
        try:
            result = bot.reply(body.message, history)
        except Exception as exc:
            operation.finish(bot.usage, ok=False)
            log.exception("chat failed")
            raise HTTPException(502, "The assistant could not answer. Try again.") from exc
        operation.finish(result.usage)
        profile = s.kitchen.profile()
        cited, photos = s.store.get(result.cited), s.store.photos(result.cited)
        if thread is None:
            thread = s.chats.create(title_for(body.message), [], [])
        reply = ChatReply(
            thread_id=thread.id,
            text=result.text,
            cited=[
                recipe_card(cited[i], profile, photos.get(i)) for i in result.cited if i in cited
            ],
            flagged=result.flagged,
            tool_calls=[
                ToolCallView(name=c.name, arguments=_json(c.arguments), output=c.output)
                for c in result.tool_calls
            ],  # fmt: skip
            pantry_changed=any(c.name == "update_pantry" for c in result.tool_calls),
            cost_usd=result.usage.cost(),
            latency_ms=round(result.latency_ms),
        )
        asked = ChatMessage(role="user", text=body.message)
        answered = ChatMessage(role="assistant", text=reply.text, reply=reply)
        s.chats.append(thread.id, [asked.model_dump(mode="json"), answered.model_dump(mode="json")],
                       result.history[-MAX_CHAT_HISTORY:])  # fmt: skip
        return reply

    return app


def _json(text: str) -> dict:
    try:
        value = json.loads(text)
    except ValueError:
        return {}
    return value if isinstance(value, dict) else {}


app = create_app()
