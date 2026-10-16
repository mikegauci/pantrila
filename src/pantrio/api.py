"""HTTP API for the web app: recipes, profile, pantry, plans, grocery list and chat.

Every route except /health needs a Supabase Auth access token; its user id scopes all data.
The same safety rules as the CLI apply: search filters run in SQL, plans come out of the
planner's checker, chat replies pass the citation guard, and every recipe shown is checked
against the person's current profile so a later allergy change shows up loudly.

Planning takes 10 to 90 seconds, so POST /plans streams server-sent events: one `step` per
LangGraph node as it finishes, then `plan` (the saved plan) or `error`.

Run: uv run uvicorn pantrio.api:app --env-file .env --reload
"""

from __future__ import annotations

import json
import logging
import queue
import threading
import time
from collections.abc import Callable, Iterator
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
from pantrio.constraints import day_nutrition, recipe_problems
from pantrio.foods import UnitError, load_foods
from pantrio.grocery import grocery_list
from pantrio.pantry import Kitchen, UnknownFood, make_item, resolve_food
from pantrio.planner import Planner, PlanningError, RecipeStore
from pantrio.records import Records, SavedPlan, UsageEvent
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


@dataclass
class Session:
    """Everything one request needs, scoped to one user."""

    store: Catalog
    kitchen: Kitchen
    records: Records


class Backend(Protocol):
    client: Any  # OpenAI client, or None for the default

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

    @contextmanager
    def session(self, user_id: str) -> Iterator[Session]:
        from pantrio.pantry import DbKitchen
        from pantrio.planner import DbStore
        from pantrio.records import DbRecords

        with self.pool.connection() as conn:
            yield Session(DbStore(conn, self.embed_query), DbKitchen(conn, user_id),
                          DbRecords(conn, user_id))  # fmt: skip

    def close(self) -> None:
        self.pool.close()


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


class Me(BaseModel):
    id: str
    email: str | None
    anonymous: bool
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


class ChatTurn(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=8000)


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=MAX_MESSAGE_CHARS)
    history: list[ChatTurn] = Field(default_factory=list)


class ToolCallView(BaseModel):
    name: str
    arguments: dict
    output: str


class ChatReply(BaseModel):
    text: str
    history: list[ChatTurn]
    cited: list[RecipeCard]
    flagged: list[str]
    tool_calls: list[ToolCallView]
    pantry_changed: bool
    cost_usd: float | None
    latency_ms: float


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


def recipe_card(r: Recipe, profile: UserProfile) -> RecipeCard:
    return RecipeCard(
        **r.model_dump(include=set(RecipeCard.model_fields) & set(Recipe.model_fields)),
        ingredient_count=len(r.ingredients),
        pantry_foods=sorted(r.foods & set(profile.pantry)),
        problems=problem_messages(r, profile),
    )


def recipe_detail(r: Recipe, profile: UserProfile) -> RecipeDetail:
    pantry = set(profile.pantry)
    return RecipeDetail(
        **recipe_card(r, profile).model_dump(),
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


def plan_view(saved: SavedPlan, store: RecipeStore, profile: UserProfile) -> PlanView:
    recipes = store.get({m.recipe_id for _, m in saved.plan.meals})
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
            meals.append(PlanMealView(meal_type=m.meal_type, portions=m.portions,
                                      recipe=recipe_card(r, profile)))  # fmt: skip
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
    lim, since = config.limits(), today_start()
    return LimitsView(
        plans_per_day=lim.plans_per_user,
        plans_left=max(0, lim.plans_per_user - records.count_since("plan", since)),
        chats_per_day=lim.chats_per_user,
        chats_left=max(0, lim.chats_per_user - records.count_since("chat", since)),
    )


def check_quota(records: Records, kind: Literal["plan", "chat"]) -> None:
    """Refuse a paid call over the user's daily cap or the demo's daily budget."""
    lim, since = config.limits(), today_start()
    cap = lim.plans_per_user if kind == "plan" else lim.chats_per_user
    if records.count_since(kind, since) >= cap:
        raise HTTPException(429, f"You have used today's {cap} {kind}s. Try again tomorrow.")
    if records.spend_since(since) >= lim.budget_usd:
        raise HTTPException(503, "Pantrio's demo budget for today is used up. Try tomorrow.")


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
                  limits=limits_view(s.records))  # fmt: skip

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
        ids = s.store.search(q, f, limit) if q else s.store.browse(f, limit)
        found = s.store.get(ids)
        return RecipeList(
            query=q, rules=f, recipes=[recipe_card(found[i], profile) for i in ids if i in found]
        )

    @app.get("/recipes/{recipe_id}")
    def recipe(recipe_id: str, s: SessionDep) -> RecipeDetail:
        return recipe_detail(get_recipe(s, recipe_id), s.kitchen.profile())

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
            check_quota(s.records, "plan")
        events: queue.Queue = queue.Queue()

        def work() -> None:
            model = config.model()
            planner = None
            start = time.perf_counter()
            try:
                with backend.session(user.id) as s:
                    planner = Planner(s.store, client=backend.client, model=model, source="api")
                    try:
                        result = planner.plan(
                            s.kitchen.profile(), on_step=lambda n: events.put(("step", {"node": n}))
                        )
                    except PlanningError as exc:
                        s.records.log(UsageEvent.from_usage(
                            "plan", model, planner.usage, (time.perf_counter() - start) * 1000,
                            ok=False))  # fmt: skip
                        events.put(("error", {"message": f"Could not plan: {exc}"}))
                        return
                    s.records.log(UsageEvent.from_usage("plan", model, result.usage,
                                                        result.latency_ms))  # fmt: skip
                    saved = s.records.save_plan(result.plan, plan_report(result, model))
                    view = plan_view(saved, s.store, s.kitchen.profile())
                    events.put(("plan", view.model_dump(mode="json")))
            except Exception:
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

    @app.post("/chat")
    def chat(body: ChatRequest, request: Request, s: SessionDep) -> ChatReply:
        check_quota(s.records, "chat")
        backend: Backend = request.app.state.backend
        model = config.model()
        bot = Assistant(s.store, s.kitchen, client=backend.client, model=model, source="api")
        history = [t.model_dump() for t in body.history][-MAX_CHAT_HISTORY:]
        start = time.perf_counter()
        try:
            result = bot.reply(body.message, history)
        except Exception as exc:
            s.records.log(
                UsageEvent.from_usage(
                    "chat", model, bot.usage, (time.perf_counter() - start) * 1000, ok=False
                )
            )
            log.exception("chat failed")
            raise HTTPException(502, "The assistant could not answer. Try again.") from exc
        s.records.log(UsageEvent.from_usage("chat", model, result.usage, result.latency_ms))
        profile = s.kitchen.profile()
        cited = s.store.get(result.cited)
        return ChatReply(
            text=result.text,
            history=[ChatTurn(**t) for t in result.history],
            cited=[recipe_card(cited[i], profile) for i in result.cited if i in cited],
            flagged=result.flagged,
            tool_calls=[
                ToolCallView(name=c.name, arguments=_json(c.arguments), output=c.output)
                for c in result.tool_calls
            ],  # fmt: skip
            pantry_changed=any(c.name == "update_pantry" for c in result.tool_calls),
            cost_usd=result.usage.cost(),
            latency_ms=round(result.latency_ms),
        )

    return app


def _json(text: str) -> dict:
    try:
        value = json.loads(text)
    except ValueError:
        return {}
    return value if isinstance(value, dict) else {}


app = create_app()
