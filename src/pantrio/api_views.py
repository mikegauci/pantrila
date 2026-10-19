"""Convert trusted domain records into HTTP response views."""

from __future__ import annotations

from pantrio.api_models import (
    CookbookCard,
    CookbookDetail,
    CookbookLine,
    IngredientView,
    PlanDayView,
    PlanMealView,
    PlanProblem,
    PlanView,
    RecipeCard,
    RecipeDetail,
    SwapView,
)
from pantrio.backend import Catalog
from pantrio.constraints import day_nutrition, recipe_problems
from pantrio.cookbook import (
    CookbookError,
    Derived,
    LineView,
    SavedRecipe,
    derive,
    problems_for,
)
from pantrio.photos import (
    public_url,
)
from pantrio.records import SavedPlan
from pantrio.schema import (
    Recipe,
    UserProfile,
)
from pantrio.swaps import Swap

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
