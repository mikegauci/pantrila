"""HTTP API for the web app: recipes, profile, pantry, plans, grocery list, chat and cookbook.

Every route except /health needs a Supabase Auth access token; its user id scopes all data.
The same safety rules as the CLI apply: search filters run in SQL, plans come out of the
planner's checker, chat replies pass the citation guard, and every recipe shown is checked
against the person's current profile so a later allergy change shows up loudly.

Planning takes 10 to 90 seconds, so POST /plans streams server-sent events: one `step` per
LangGraph node as it finishes, then `plan` (the saved plan) or `error`.

Chat threads (/me/chats) are saved per user; each POST /chat continues one thread (or starts
one) and the server, not the client, supplies that thread's history to the assistant.

The cookbook (/me/recipes) holds recipes people add from a photo, a link, a TikTok, Instagram or
Facebook post (caption, linked recipe site or the post's video), pasted text or by hand.
Imports return a draft for the person to review; nothing is saved until they post it back. Grams,
nutrition, allergens and diets are derived in code on every read, like the corpus. A cookbook
recipe can get a generated photo (POST /me/recipes/{id}/photo), capped per user per day.

Cooking mode ends with "I cooked this" (POST /me/cooked): it logs the cook and, unless the
person opts out, takes the amounts used out of their pantry (see pantrila.cooking).
/me/cooked/preview shows that pantry change first without saving anything.

Recipes carry `photo_url` when they have a photo (Supabase Storage; see pantrila.photos), else
null and the web app shows its placeholder art.

Run: uv run uvicorn pantrila.api:app --env-file .env --reload
"""

from __future__ import annotations

import base64
import json
import logging
import queue
import threading
from collections.abc import Callable, Iterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from datetime import time as dtime
from typing import Annotated, Any

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse

from pantrila import config
from pantrila.api_models import (
    AvatarIn,
    ChatMessage,
    ChatReply,
    ChatRequest,
    ChatThreadSummary,
    ChatThreadView,
    CookbookCard,
    CookbookDetail,
    CookbookPreview,
    CookedView,
    CookRequest,
    CookResult,
    EstimateRequest,
    EstimateView,
    ImportJobError,
    ImportJobIn,
    ImportJobView,
    ImportStep,
    ImportTiming,
    ImportView,
    LimitsView,
    LinkImport,
    Me,
    MealOptions,
    Meta,
    PantryAdd,
    PantryChangeView,
    PantryItemView,
    PhotoImport,
    PlanView,
    PostImport,
    RecipeDetail,
    RecipeList,
    RepeatRequest,
    SlotRequest,
    SwapList,
    SwapMealRequest,
    TableFood,
    TextImport,
    ToolCallView,
    UsageEventView,
    UsageView,
)
from pantrila.api_views import (
    cookbook_card,
    cookbook_detail,
    food_name,
    meal_options_view,
    plan_report,
    plan_view,
    recipe_card,
    recipe_detail,
    swap_view,
)
from pantrila.assistant import Assistant, draft_warnings
from pantrila.auth import AuthError, User, verifier
from pantrila.backend import (
    Backend,
    DbBackend,
    Session,
)
from pantrila.chats import SavedThread, title_for
from pantrila.cookbook import (
    CookbookError,
    CookbookFull,
    CookbookRecipeIn,
    SavedRecipe,
    derive,
    problems_for,
)
from pantrila.cooking import grams_used, use_from_pantry
from pantrila.foods import UnitError, load_foods, measures
from pantrila.grocery import grocery_list
from pantrila.import_jobs import ImportJob, ImportJobs
from pantrila.meal_swap import (
    PlanCatalog,
    Source,
    SwapError,
    meal_options,
    repeat_meal,
    replace_meal,
    set_slot,
    swapped_report,
)
from pantrila.operations import (
    EmbeddingUsage,
    PaidOperation,
    ReelMeter,
    daily_cap,
    reel_import_timing,
)
from pantrila.pantry import UnknownFood, make_item, resolve_food
from pantrila.photos import (
    Dish,
    PhotoStore,
    PhotoUsage,
    avatar_path,
    cookbook_path,
    generate,
    public_url,
    to_avatar_webp,
)
from pantrila.planner import Planner, PlanningError, Usage
from pantrila.post_media import MediaSource, media_source
from pantrila.recipe_import import (
    STEPS,
    Importer,
    ImportFailed,
    check_image,
)
from pantrila.records import Cooked, Records
from pantrila.request_limits import RequestSizeLimit
from pantrila.schema import (
    Allergen,
    DietTag,
    GroceryList,
    MealType,
    Recipe,
    Unit,
    UserProfile,
)
from pantrila.search import SearchFilters
from pantrila.swaps import UnsupportedDessertSwap, evaluate_swap, swap_options

log = logging.getLogger("pantrila.api")

MAX_CHAT_HISTORY = 20


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
    backend: Backend | None = None,
    verify: Callable[[str], User] | None = None,
    media: MediaSource | None = None,
) -> FastAPI:
    """The API. Tests pass an in-memory backend, a token verifier and maybe a fake video
    service; production builds a Postgres backend, verifies Supabase tokens at startup and
    reads the video service from the environment (off unless configured)."""

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.backend = backend or DbBackend(config.database_url())
        app.state.verify = verify or verifier(config.supabase_url()).verify
        app.state.media = media or media_source()
        app.state.import_jobs = ImportJobs()
        yield
        app.state.backend.close()

    app = FastAPI(title="Pantrila API", version="0.4.0", lifespan=lifespan)
    app.add_middleware(RequestSizeLimit)
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

    @app.api_route("/health", methods=["GET", "HEAD"])
    def health() -> dict:
        return {"ok": True}

    @app.get("/meta")
    def meta(request: Request, _: UserDep) -> Meta:
        from pantrila.corpus import load_briefs

        return Meta(allergens=list(Allergen), diets=list(DietTag), meal_types=list(MealType),
                    units=list(Unit), cuisines=sorted({b.cuisine for b in load_briefs()}),
                    reel_platforms=sorted(request.app.state.media.platforms))  # fmt: skip

    @app.get("/foods")
    def foods(_: UserDep) -> list[TableFood]:
        return [TableFood(key=k, name=food_name(k), aisle=f.aisle, **measures(f))
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
            raise HTTPException(422, "That file is not a picture Pantrila can read.") from exc
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
        except (UnknownFood, UnsupportedDessertSwap) as exc:
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

    def paid_import(s: Session, work: Callable[[Importer], Any],
                    operation: PaidOperation | None = None,
                    on_step: Callable[[str], None] | None = None) -> tuple:  # fmt: skip
        """Run one paid import or estimate under the daily cap and log its usage; a caller that
        already reserved the allowance passes its `operation`.
        Returns (work's result, the importer, latency in ms)."""
        model = config.model()
        source = app.state.media
        meter = ReelMeter(s.records, getattr(source, "actor", "media"))
        importer = Importer(client=app.state.backend.client, model=model, media=source,
                            meter=meter, on_step=on_step)  # fmt: skip
        operation = operation or PaidOperation(s.records, "import", model)

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

    def import_view(s: Session, work: Callable[[Importer], Any],
                    operation: PaidOperation | None = None,
                    on_step: Callable[[str], None] | None = None) -> ImportView:  # fmt: skip
        result, importer, ms = paid_import(s, work, operation, on_step)
        model_cost, media_cost = importer.usage.cost(), importer.media_cost
        return ImportView(draft=result.draft, notes=result.notes,
                          cost_usd=None if model_cost is None or media_cost is None
                          else model_cost + media_cost,
                          transcription_cost_usd=importer.usage.transcription_cost(),
                          media_cost_usd=media_cost, latency_ms=round(ms))  # fmt: skip

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
    def import_link(body: LinkImport, s: SessionDep) -> ImportView:
        return import_view(s, work_for(body))

    @app.post("/me/recipes/import/post")
    def import_post(body: PostImport, s: SessionDep) -> ImportView:
        """A TikTok, Instagram or Facebook post: its caption, else a recipe site it links."""
        return import_view(s, work_for(body))

    @app.post("/me/recipes/import/text")
    def import_text(body: TextImport, s: SessionDep) -> ImportView:
        return import_view(s, work_for(body))

    def work_for(req: LinkImport | PostImport | TextImport | PhotoImport
                 ) -> Callable[[Importer], Any]:  # fmt: skip
        """What each kind of import asks the importer to do."""
        if isinstance(req, LinkImport):
            return lambda i: i.from_link(req.url)
        if isinstance(req, PostImport):
            return lambda i: i.from_post(req.url, req.caption)
        if isinstance(req, TextImport):
            return lambda i: i.from_text(req.text)
        return lambda i: i.from_photos(req.images)

    @app.get("/me/recipes/import/timing")
    def import_timing(s: SessionDep) -> ImportTiming:
        seconds, count = reel_import_timing(s.records.events(100))
        return ImportTiming(estimated_seconds=seconds, sample_count=count)

    @app.post("/me/recipes/import/photos")
    def import_photos(body: PhotoImport, s: SessionDep) -> ImportView:
        return import_view(s, work_for(body))

    def job_view(job: ImportJob) -> ImportJobView:
        error = ImportJobError(status=job.error[0], message=job.error[1]) if job.error else None
        steps = [ImportStep(key=k, label=STEPS.get(k, k)) for k in job.steps]
        return ImportJobView(id=job.id, status=job.status, steps=steps, result=job.result,
                             error=error)  # fmt: skip

    @app.post("/me/recipes/import/jobs", status_code=202)
    def start_import(body: ImportJobIn, user: UserDep) -> ImportJobView:
        """Start an import that keeps running if the browser goes away (a locked phone, another
        tab); poll `GET /me/recipes/import/jobs/{id}` for the result. Sending the same `id`
        again returns the job it started. The daily allowance is reserved here, so a person
        over their cap is told at once."""
        jobs, backend = app.state.import_jobs, app.state.backend
        if body.id and (existing := jobs.get(user.id, body.id)):
            return job_view(existing)
        with backend.session(user.id) as s:
            operation = PaidOperation(s.records, "import", config.model())
        try:
            job = jobs.start(user.id, body.id)
        except HTTPException:
            operation.finish(Usage(), ok=False, discard_empty=True)
            raise
        work = work_for(body.request)

        def run() -> None:
            try:
                with backend.session(user.id) as s:
                    view = import_view(s, work, operation, lambda key: jobs.step(job, key))
                    jobs.succeed(job, view)
            except HTTPException as exc:
                operation.finish(Usage(), ok=False, discard_empty=True)
                jobs.fail(job, exc.status_code, str(exc.detail))
            except Exception:
                operation.finish(Usage(), ok=False, discard_empty=True)
                log.exception("background import failed")
                jobs.fail(job, 500, "Reading the recipe failed. Try again.")

        threading.Thread(target=run, daemon=True).start()
        return job_view(job)

    @app.get("/me/recipes/import/jobs/{job_id}")
    def import_job(job_id: str, user: UserDep) -> ImportJobView:
        job = app.state.import_jobs.get(user.id, job_id)
        if job is None:
            raise HTTPException(404, "This import was interrupted. Start it again.")
        return job_view(job)

    @app.post("/me/recipes/estimate")
    def estimate_foods(body: EstimateRequest, s: SessionDep) -> EstimateView:
        """Nutrition and allergen estimates for foods the ingredient table lacks."""
        estimates, importer, _ = paid_import(s, lambda i: i.estimate(body.names))
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

    @app.post("/me/recipes/{recipe_id}/photo/from/{corpus_id}")
    def copy_corpus_photo(recipe_id: int, corpus_id: str, request: Request, user: UserDep,
                          s: SessionDep) -> CookbookDetail:  # fmt: skip
        """Give a saved copy of a corpus recipe its photo (a private copy, no model call)."""
        saved = get_saved(s, recipe_id)
        old_path = saved.photo_path
        backend: Backend = request.app.state.backend
        source = s.store.photos([corpus_id]).get(corpus_id)
        if backend.photos is None or source is None:
            return cookbook_detail(saved, s.kitchen.profile())
        path = cookbook_path(user.id)
        try:
            backend.photos.put(path, backend.photos.get(source))
        except Exception as exc:
            log.exception("photo copy failed")
            raise HTTPException(502, "The photo could not be copied.") from exc
        s.cookbook.set_photo(recipe_id, path)
        drop_photo(request, old_path)
        return cookbook_detail(get_saved(s, recipe_id), s.kitchen.profile())

    @app.delete("/me/recipes/{recipe_id}/photo")
    def delete_photo(recipe_id: int, request: Request, s: SessionDep) -> CookbookDetail:
        old_path = get_saved(s, recipe_id).photo_path
        s.cookbook.set_photo(recipe_id, None)
        drop_photo(request, old_path)
        return cookbook_detail(get_saved(s, recipe_id), s.kitchen.profile())

    # --- Cooking mode: "I cooked this" ---

    def cook(body: CookRequest, s: Session, save: bool) -> CookResult:
        if body.recipe_id is not None:
            r = get_recipe(s, body.recipe_id)
            title, servings = r.title, r.servings
            lines = [(i.food, i.grams) for i in r.ingredients]
        else:
            saved = get_saved(s, body.cookbook_id)
            title, servings = saved.recipe.title, saved.recipe.servings
            try:
                lines = [(line.food, line.grams) for line in derive(saved.recipe).ingredients]
            except CookbookError:  # its lines no longer check out; log it, leave the pantry
                lines = []
        used = grams_used(lines, servings, body.servings)
        changes = use_from_pantry(used, s.kitchen.pantry())
        cooked = None
        if save:
            if body.update_pantry:
                for c in changes:
                    if c.after is None:
                        s.kitchen.remove(c.food)
                    else:
                        s.kitchen.put(c.after)
            cooked = s.records.log_cooked(Cooked(
                title=title, servings=body.servings, pantry_updated=body.update_pantry,
                recipe_id=body.recipe_id, cookbook_id=body.cookbook_id,
            ))  # fmt: skip
        return CookResult(
            cooked=cooked and CookedView(**vars(cooked)),
            pantry=[PantryChangeView(food=c.food, name=food_name(c.food), used_g=c.used_g,
                                     unit=c.before.unit, before=c.before.quantity,
                                     after=c.after and c.after.quantity)
                    for c in changes],
        )  # fmt: skip

    @app.post("/me/cooked/preview")
    def preview_cooked(body: CookRequest, s: SessionDep) -> CookResult:
        """What "I cooked this" would take out of the pantry; nothing is saved."""
        return cook(body, s, save=False)

    @app.post("/me/cooked", status_code=201)
    def add_cooked(body: CookRequest, s: SessionDep) -> CookResult:
        return cook(body, s, save=True)

    @app.get("/me/cooked")
    def list_cooked(s: SessionDep, limit: Annotated[int, Query(ge=1, le=200)] = 50
                    ) -> list[CookedView]:  # fmt: skip
        return [CookedView(**vars(c)) for c in s.records.cooked(limit)]

    @app.get("/plans/latest")
    def latest_plan(s: SessionDep) -> PlanView:
        saved = s.records.latest_plan()
        if saved is None:
            raise HTTPException(404, "No plan yet.")
        return plan_view(saved, PlanCatalog(s.store, s.cookbook), s.kitchen.profile())

    @app.get("/plans/latest/grocery")
    def latest_grocery(s: SessionDep, people: Annotated[int, Query(ge=1, le=12)] = 1
                       ) -> GroceryList:  # fmt: skip
        saved = s.records.latest_plan()
        if saved is None:
            raise HTTPException(404, "No plan yet.")
        store = PlanCatalog(s.store, s.cookbook)
        recipes = store.get({m.recipe_id for _, m in saved.plan.meals if m.eats_recipe})
        plan = saved.plan.model_copy(update={"days": [
            d.model_copy(update={"meals": [m for m in d.meals if m.recipe_id in recipes]})
            for d in saved.plan.days
        ]})  # fmt: skip
        unlisted = [name for rid in dict.fromkeys(m.recipe_id for _, m in plan.meals
                                                  if m.eats_recipe)
                    for name in store.unlisted(rid)]  # fmt: skip
        groceries = grocery_list(plan, recipes, s.kitchen.pantry(), people)
        return groceries.model_copy(update={"unlisted": list(dict.fromkeys(unlisted))})

    def swap_http_error(exc: SwapError) -> HTTPException:
        detail = {"message": str(exc), "problems": exc.problems} if exc.problems else str(exc)
        return HTTPException(exc.status, detail)

    @app.get("/plans/latest/meals/{day}/{meal_type}/options")
    def meal_swap_options(
        day: int, meal_type: MealType, s: SessionDep, source: Source = "corpus",
        q: Annotated[str, Query(max_length=80)] = "", quick: bool = False,
        pantry: bool = False, offset: Annotated[int, Query(ge=0, le=1000)] = 0,
        limit: Annotated[int, Query(ge=1, le=24)] = 6,
    ) -> MealOptions:  # fmt: skip
        """Recipes that could replace one meal of the latest plan, best fit first, a page at a
        time: Pantrila's (`source=corpus`) or the person's own (`mine`), narrowed by words
        (`q`), 30 minutes or less (`quick`) or pantry foods (`pantry`). Nothing is saved and
        nothing is paid for: candidates pass the person's rules, ranked in code."""
        saved = s.records.latest_plan()
        if saved is None:
            raise HTTPException(404, "No plan yet.")
        profile, store = s.kitchen.profile(), PlanCatalog(s.store, s.cookbook)
        try:
            ranked = meal_options(
                saved.plan,
                day,
                meal_type,
                profile,
                store,
                None,
                source=source,
                query=q,
                quick=quick,
                pantry_only=pantry,
            )
        except SwapError as exc:
            raise swap_http_error(exc) from exc
        page = ranked[offset : offset + limit]
        return meal_options_view(saved, day, meal_type, page, store, profile, len(ranked),
                                 offset)  # fmt: skip

    def save_change(s: Session, saved, plan, profile, store: PlanCatalog) -> PlanView:
        report = swapped_report(saved.report, plan, profile, store)
        updated = s.records.update_plan(saved.id, plan, report)
        if updated is None:
            raise HTTPException(409, "Your plan changed. Reload it and try again.")
        return plan_view(updated, store, profile)

    def editable_plan(s: Session, plan_id: int):
        saved = s.records.latest_plan()
        if saved is None:
            raise HTTPException(404, "No plan yet.")
        if saved.id != plan_id:
            raise HTTPException(409, "Your plan changed. Reload it and try again.")
        return saved

    @app.put("/plans/latest/meals/{day}/{meal_type}")
    def swap_meal(day: int, meal_type: MealType, body: SwapMealRequest, s: SessionDep
                  ) -> PlanView:  # fmt: skip
        """Swap one meal of the latest plan for a corpus recipe or the person's own
        (`mine-<id>`). The recipe is checked against the person's rules and its portions are
        fitted here, so a request cannot save an unsafe meal."""
        saved = editable_plan(s, body.plan_id)
        profile, store = s.kitchen.profile(), PlanCatalog(s.store, s.cookbook)
        try:
            plan = replace_meal(saved.plan, day, meal_type, body.recipe_id, profile, store)
        except SwapError as exc:
            raise swap_http_error(exc) from exc
        return save_change(s, saved, plan, profile, store)

    @app.put("/plans/latest/meals/{day}/{meal_type}/slot")
    def change_slot(day: int, meal_type: MealType, body: SlotRequest, s: SessionDep
                    ) -> PlanView:  # fmt: skip
        """Skip one meal, eat out, eat leftovers of an earlier meal, or add back the recipe
        planned there. No model call; rules and portions are checked here."""
        saved = editable_plan(s, body.plan_id)
        profile, store = s.kitchen.profile(), PlanCatalog(s.store, s.cookbook)
        try:
            plan = set_slot(saved.plan, day, meal_type, body.kind, profile, store,
                            out_kcal=body.out_kcal, from_day=body.from_day,
                            from_meal=body.from_meal)  # fmt: skip
        except SwapError as exc:
            raise swap_http_error(exc) from exc
        return save_change(s, saved, plan, profile, store)

    @app.put("/plans/latest/meals/{day}/{meal_type}/repeat")
    def repeat_slot(day: int, meal_type: MealType, body: RepeatRequest, s: SessionDep
                    ) -> PlanView:  # fmt: skip
        """Cook one meal once and eat it again: the meals in `on` (on later days) become its
        leftovers, all or none. The grocery list buys for them; they are not repeats."""
        saved = editable_plan(s, body.plan_id)
        profile, store = s.kitchen.profile(), PlanCatalog(s.store, s.cookbook)
        try:
            plan = repeat_meal(
                saved.plan, day, meal_type, [(t.day, t.meal_type) for t in body.on], profile, store
            )
        except SwapError as exc:
            raise swap_http_error(exc) from exc
        return save_change(s, saved, plan, profile, store)

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
                    view = plan_view(saved, PlanCatalog(s.store, s.cookbook), s.kitchen.profile())
                    events.put(("plan", view.model_dump(mode="json")))
            except Exception:
                operation.finish(planner.usage if planner else Usage(), ok=False)
                log.exception("planning failed")
                events.put(("error", {"message": "Something went wrong while planning."}))
            finally:
                events.put(None)

        threading.Thread(target=work, daemon=True).start()

        def stream() -> Iterator[str]:
            while True:
                try:
                    item = events.get(timeout=15)
                except queue.Empty:
                    yield ": keep-alive\n\n"
                    continue
                if item is None:
                    return
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
        profile = s.kitchen.profile()
        ids = {card.id for m in messages if m.reply for card in m.reply.cited}
        recipes, photos = s.store.get(ids), s.store.photos(ids)
        for message in messages:
            if message.reply is None:
                continue
            reply = message.reply
            reply.draft_problems = [draft_warnings(d, profile) for d in reply.drafts]
            cited_ids = [card.id for card in reply.cited]
            reply.cited = [
                recipe_card(recipes[rid], profile, photos.get(rid))
                for rid in cited_ids
                if rid in recipes
            ]
            reply.profile_problems = [
                f"{card.title}: {problem}" for card in reply.cited for problem in card.problems
            ] + [f"{rid} is no longer available." for rid in cited_ids if rid not in recipes]
            reply.flagged = list(
                dict.fromkeys(
                    [
                        *[rid for rid in reply.flagged if rid not in cited_ids],
                        *[card.id for card in reply.cited if card.problems],
                        *[rid for rid in cited_ids if rid not in recipes],
                    ]
                )
            )
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
        original_history = list(thread.history) if thread else []
        history = original_history[-MAX_CHAT_HISTORY:]
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
            drafts=result.drafts,
            draft_problems=result.draft_problems,
            cost_usd=result.usage.cost(),
            latency_ms=round(result.latency_ms),
        )
        asked = ChatMessage(role="user", text=body.message)
        answered = ChatMessage(role="assistant", text=reply.text, reply=reply)
        saved = s.chats.append(
            thread.id,
            [asked.model_dump(mode="json"), answered.model_dump(mode="json")],
            result.history[-MAX_CHAT_HISTORY:],
            expected_history=original_history,
        )
        if saved is None:
            raise HTTPException(409, "This chat changed in another tab. Reload it and try again.")
        return reply

    return app


def _json(text: str) -> dict:
    try:
        value = json.loads(text)
    except ValueError:
        return {}
    return value if isinstance(value, dict) else {}


app = create_app()
