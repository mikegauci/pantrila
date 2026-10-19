"""Meal-planning agent: a LangGraph workflow around one tool-calling model.

    profile -> retrieve -> draft -> check -> (repair -> check)* -> finalise

- profile: drop unknown food keys and describe the person for the prompt.
- retrieve: hybrid search per meal slot with the hard rules as SQL filters.
- draft: the model picks one recipe per meal, calling `search_recipes` when the candidates
  cannot meet a goal (capped at MAX_TOOL_ROUNDS).
- check: code fits portions to the nutrition targets, then `constraints.check_plan` decides.
- repair: the model gets the problems and returns a corrected plan (at most MAX_REPAIRS).
- finalise: any meal still breaking a hard rule is replaced in code by a safe candidate; if
  none exists the planner raises rather than return an unsafe plan.
"""

from __future__ import annotations

import time
import uuid
from collections import Counter
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from typing import Protocol, TypedDict

from langgraph.graph import END, START, StateGraph
from openai.lib._pydantic import to_strict_json_schema
from pydantic import BaseModel, Field, ValidationError

from pantrio import config
from pantrio.constraints import (
    Violation,
    check_plan,
    day_nutrition,
    fit_portions,
    hard_violations,
    pantry_use,
    recipe_violations,
    slot_filters,
)
from pantrio.foods import load_foods
from pantrio.schema import (
    MealPlan,
    MealType,
    NutritionFacts,
    PlanDay,
    PlannedMeal,
    Recipe,
    UserProfile,
)
from pantrio.search import SearchFilters, rrf_merge

MAX_TOOL_ROUNDS = 4
MAX_REPAIRS = 2
CANDIDATES_PER_SLOT = 12
SEARCH_LIMIT = 8


class RecipeStore(Protocol):
    """Where recipes come from. Everything the checker sees is loaded through here."""

    embed_tokens: int

    def search(self, query: str, filters: SearchFilters, limit: int) -> list[str]: ...

    def get(self, ids: Iterable[str]) -> dict[str, Recipe]: ...


class DbStore:
    def __init__(self, conn, embed_query):
        self.conn, self.embed_query, self.embed_tokens = conn, embed_query, 0

    def search(self, query: str, filters: SearchFilters, limit: int) -> list[str]:
        from pantrio.search import search

        result = search(self.conn, query, filters, limit=limit, embed_query=self.embed_query)
        self.embed_tokens += result.embed_tokens
        return result.ids

    def browse(self, filters: SearchFilters, limit: int) -> list[str]:
        from pantrio.search import browse

        return browse(self.conn, filters, limit)

    def get(self, ids: Iterable[str]) -> dict[str, Recipe]:
        from pantrio.db import load_recipes

        return load_recipes(self.conn, ids)

    def photos(self, ids: Iterable[str]) -> dict[str, str]:
        from pantrio.photos import corpus_paths

        return corpus_paths(self.conn, ids)


# --- What the model sees -------------------------------------------------------------------


class DraftMeal(BaseModel):
    meal_type: MealType
    recipe_id: str = Field(
        description="Exact id of a recipe from the candidate lists or a search_recipes result."
    )


class DraftDay(BaseModel):
    day: int = Field(description="Day number, starting at 1.")
    meals: list[DraftMeal] = Field(description="One entry per requested meal.")


class PlanDraft(BaseModel):
    days: list[DraftDay]
    notes: str = Field(
        description="One or two plain sentences for the person on how the plan uses their "
        "pantry and fits their targets. Describe the plan itself, not earlier drafts or fixes. No "
        "allergy or safety claims; code checks those."
    )


class SearchArgs(BaseModel):
    query: str = Field(
        description="What to look for, e.g. 'high protein vegetarian breakfast' or 'dinner "
        "using spinach and feta'."
    )
    meal_type: MealType = Field(description="The plan slot the recipe would fill.")


SEARCH_TOOL = {
    "type": "function",
    "name": "search_recipes",
    "description": "Search the recipe corpus for one meal slot. Results already respect the "
    "person's allergies, diets, excluded foods and time limit.",
    "parameters": to_strict_json_schema(SearchArgs),
    "strict": True,
}

INSTRUCTIONS = """\
You plan meals for one person from Pantrio's recipe corpus.

Code has already removed every recipe that breaks the person's allergies, diets, excluded \
foods or time limit, and it checks the finished plan again. Only choose recipes from the \
candidate lists or search_recipes results, by exact id.

Choose one recipe for each requested meal on each day. Goals, most important first:
1. Nutrition. Code sets each meal's portion between 0.5 and 2 servings to hit the daily \
energy target, so pick recipes whose kcal at one serving add up to roughly 0.7 to 1.4 times \
the target. Portions cannot fix a day that is too low in protein or too high in carbs for its \
energy, so balance those with recipe choice.
2. Pantry. Use every pantry food at least once, earliest in the week.
3. Variety. A recipe at most twice a week and never twice in a day; mix cuisines and main \
ingredients.
4. Tastes. Favour the preferred cuisines and the notes.

Call search_recipes only when the candidates cannot meet a goal, for example to find a \
high-protein breakfast or a recipe that uses a pantry food. Keep tool calls few."""


def recipe_line(r: Recipe, pantry: set[str]) -> str:
    n = r.nutrition
    used = sorted(r.foods & pantry)
    line = (
        f"{r.id} | {r.title} | {r.cuisine} | {r.total_minutes} min | {n.kcal:.0f} kcal, "
        f"protein {n.protein_g:.0f} g, carbs {n.carbs_g:.0f} g, fat {n.fat_g:.0f} g"
    )
    return line + (f" | pantry: {', '.join(used)}" if used else "")


def profile_text(p: UserProfile) -> str:
    t = p.targets
    targets = [
        f"{t.kcal:.0f} kcal" if t.kcal else None,
        f"at least {t.min_protein_g:.0f} g protein" if t.min_protein_g else None,
        f"at most {t.max_carbs_g:.0f} g carbs" if t.max_carbs_g else None,
    ]
    lines = [
        f"Plan {p.days} day(s) of: {', '.join(p.meals)}.",
        f"Daily targets: {', '.join(x for x in targets if x) or 'none'}.",
        f"Pantry: {', '.join(p.pantry) or 'nothing listed'}.",
        f"Preferred cuisines: {', '.join(p.cuisines) or 'any'}.",
    ]
    rules = [
        f"allergies {', '.join(p.allergies)}" if p.allergies else None,
        f"diets {', '.join(p.diets)}" if p.diets else None,
        f"never {', '.join(p.exclude_foods)}" if p.exclude_foods else None,
        f"max {p.max_minutes} min per recipe" if p.max_minutes else None,
    ]
    if rules := [x for x in rules if x]:
        lines.append(f"Hard rules (already enforced): {'; '.join(rules)}.")
    if p.notes:
        lines.append(f"Notes: {p.notes}")
    return "\n".join(lines)


def plan_text(plan: MealPlan, recipes: dict[str, Recipe]) -> str:
    lines = []
    for day in plan.days:
        meals = ", ".join(f"{m.meal_type} {m.recipe_id} x{m.portions:g}" for m in day.meals)
        n = day_nutrition(day, recipes)
        lines.append(
            f"Day {day.day}: {meals} | {n.kcal:.0f} kcal, protein {n.protein_g:.0f} g, "
            f"carbs {n.carbs_g:.0f} g"
        )
    return "\n".join(lines)


# --- Results ---------------------------------------------------------------------------------


class PlanningError(RuntimeError):
    pass


class UnsafePlanError(PlanningError):
    def __init__(self, violations: list[Violation]):
        super().__init__("; ".join(map(str, violations)))
        self.violations = violations


@dataclass
class Usage:
    llm_calls: int = 0
    tool_calls: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    embed_tokens: int = 0

    def add(self, resp) -> None:
        self.llm_calls += 1
        if resp.usage:
            self.input_tokens += resp.usage.input_tokens
            self.output_tokens += resp.usage.output_tokens

    def cost(self) -> float | None:
        prices = config.prices()
        chat = prices.chat_cost(self.input_tokens, self.output_tokens)
        embed = prices.embed_cost(self.embed_tokens)
        return None if chat is None else chat + (embed or 0.0)


@dataclass
class PlanResult:
    plan: MealPlan
    recipes: dict[str, Recipe]
    warnings: list[Violation]  # soft violations left after repair; hard ones never get here
    nutrition: list[NutritionFacts]  # per day, per person
    pantry_use: float
    repairs: int
    fallbacks: int  # meals replaced in code because they broke a hard rule
    first_draft_violations: list[Violation]
    usage: Usage
    latency_ms: float
    path: list[str] = field(default_factory=list)


class PlanState(TypedDict, total=False):
    profile: UserProfile
    brief: str
    candidates: dict[MealType, list[str]]
    recipes: dict[str, Recipe]
    plan: MealPlan
    violations: list[Violation]
    first_violations: list[Violation]
    repairs: int
    fallbacks: int
    path: list[str]


# --- The graph -------------------------------------------------------------------------------


class Planner:
    def __init__(self, store: RecipeStore, client=None, model: str | None = None,
                 effort: str = "low", source: str = "cli"):  # fmt: skip
        self.store, self.effort, self.source = store, effort, source
        self.client = client or config.openai_client()
        self.model = model or config.model()
        self.usage = Usage()
        self.graph = self._build()

    def _build(self):
        g = StateGraph(PlanState)
        g.add_node("profile", self._profile)
        g.add_node("retrieve", self._retrieve)
        g.add_node("draft", self._draft)
        g.add_node("check", self._check)
        g.add_node("repair", self._repair)
        g.add_node("finalise", self._finalise)
        g.add_edge(START, "profile")
        g.add_edge("profile", "retrieve")
        g.add_edge("retrieve", "draft")
        g.add_edge("draft", "check")
        g.add_conditional_edges("check", self._after_check, ["repair", "finalise"])
        g.add_edge("repair", "check")
        g.add_edge("finalise", END)
        return g.compile()

    def plan(
        self, profile: UserProfile, on_step: Callable[[str], None] | None = None
    ) -> PlanResult:
        """Plan meals. `on_step` is called with each graph node's name as it finishes."""
        self.usage = Usage()
        start_tokens = self.store.embed_tokens
        start = time.perf_counter()
        state: PlanState = {}
        inputs = {"profile": profile, "path": []}
        run_id = uuid.uuid4()
        trace = config.trace_config(
            "plan", self.source, run_id, model=self.model, effort=self.effort
        )
        try:
            for mode, chunk in self.graph.stream(inputs, trace, stream_mode=["updates", "values"]):
                if mode == "values":
                    state = chunk
                elif on_step:
                    for node in chunk:
                        on_step(node)
        finally:
            self.usage.embed_tokens = self.store.embed_tokens - start_tokens
        latency = (time.perf_counter() - start) * 1000
        profile, plan, recipes = state["profile"], state["plan"], state["recipes"]
        used = pantry_use(plan, profile, recipes)
        config.log_feedback(run_id, {
            "targets_met": float(not state["violations"]),
            "repairs": state.get("repairs", 0),
            "fallbacks": state.get("fallbacks", 0),
            "pantry_use": used if profile.pantry else None,
        })  # fmt: skip
        return PlanResult(
            plan=plan,
            recipes={m.recipe_id: recipes[m.recipe_id] for _, m in plan.meals},
            warnings=state["violations"],
            nutrition=[day_nutrition(d, recipes) for d in plan.days],
            pantry_use=used,
            repairs=state.get("repairs", 0),
            fallbacks=state.get("fallbacks", 0),
            first_draft_violations=state["first_violations"],
            usage=self.usage,
            latency_ms=latency,
            path=state["path"],
        )

    # nodes

    def _profile(self, s: PlanState) -> PlanState:
        known = load_foods()
        p = s["profile"]
        p = p.model_copy(
            update={
                "pantry": sorted({f for f in p.pantry if f in known}),
                "exclude_foods": sorted({f for f in p.exclude_foods if f in known}),
                "meals": list(dict.fromkeys(p.meals)),
            }
        )
        return {"profile": p, "path": [*s["path"], "profile"]}

    def _retrieve(self, s: PlanState) -> PlanState:
        p = s["profile"]
        pantry_words = " ".join(f.replace("_", " ") for f in p.pantry)
        goals = " ".join(
            x
            for x in (
                "high protein" if p.targets.min_protein_g else "",
                "low carb" if p.targets.max_carbs_g else "",
                " ".join(c.replace("_", " ") for c in p.cuisines),
                p.notes,
            )
            if x
        )
        candidates: dict[MealType, list[str]] = {}
        for slot in p.meals:
            filters = slot_filters(p, slot)
            queries = [f"{slot} {goals}".strip()]
            if pantry_words:
                queries.append(f"{slot} with {pantry_words}")
            rankings = [self.store.search(q, filters, CANDIDATES_PER_SLOT) for q in queries]
            candidates[slot] = [rid for rid, _ in rrf_merge(rankings)][:CANDIDATES_PER_SLOT]
        recipes = self.store.get({rid for ids in candidates.values() for rid in ids})
        empty = [slot for slot, ids in candidates.items() if not ids]
        if empty:
            raise PlanningError(f"no recipe fits the rules for {', '.join(empty)}")

        pantry = set(p.pantry)
        sections = [profile_text(p)]
        for slot, ids in candidates.items():
            lines = [recipe_line(recipes[rid], pantry) for rid in ids if rid in recipes]
            sections.append(f"Candidates for {slot}:\n" + "\n".join(lines))
        return {
            "candidates": candidates,
            "recipes": recipes,
            "brief": "\n\n".join(sections),
            "path": [*s["path"], "retrieve"],
        }

    def _draft(self, s: PlanState) -> PlanState:
        draft, recipes = self._ask(s["brief"], s)
        return {"plan": _to_plan(draft), "recipes": recipes, "repairs": 0,
                "path": [*s["path"], "draft"]}  # fmt: skip

    def _check(self, s: PlanState) -> PlanState:
        recipes = {**s["recipes"], **self._load_unknown(s["plan"], s["recipes"])}
        plan = fit_portions(s["plan"], s["profile"], recipes)
        violations = check_plan(plan, s["profile"], recipes)
        out: PlanState = {"plan": plan, "recipes": recipes, "violations": violations,
                          "path": [*s["path"], "check"]}  # fmt: skip
        if "first_violations" not in s:
            out["first_violations"] = violations
        return out

    def _after_check(self, s: PlanState) -> str:
        if s["violations"] and s.get("repairs", 0) < MAX_REPAIRS:
            return "repair"
        return "finalise"

    def _repair(self, s: PlanState) -> PlanState:
        problems = "\n".join(f"- {v}" for v in s["violations"])
        message = (
            f"{s['brief']}\n\nYour last plan, after code fitted the portions:\n"
            f"{plan_text(s['plan'], s['recipes'])}\n\nCode found these problems:\n{problems}\n\n"
            "Return the full corrected plan. Change only the meals needed to fix the problems."
        )
        draft, recipes = self._ask(message, s)
        return {"plan": _to_plan(draft), "recipes": recipes, "repairs": s.get("repairs", 0) + 1,
                "path": [*s["path"], "repair"]}  # fmt: skip

    def _finalise(self, s: PlanState) -> PlanState:
        p, plan, recipes, violations = s["profile"], s["plan"], s["recipes"], s["violations"]
        fallbacks = 0
        if hard_violations(violations):
            plan, fallbacks = _safe_plan(plan, p, recipes, s["candidates"])
            plan = fit_portions(plan, p, recipes)
            violations = check_plan(plan, p, recipes)
            if hard := hard_violations(violations):
                raise UnsafePlanError(hard)
        return {"plan": plan, "violations": violations, "fallbacks": fallbacks,
                "path": [*s["path"], "finalise"]}  # fmt: skip

    # model and tools

    def _ask(self, message: str, s: PlanState) -> tuple[PlanDraft, dict[str, Recipe]]:
        """One tool-calling conversation that ends in a PlanDraft. Returns the draft and the
        recipes seen so far, loaded from the store (never from the model's text)."""
        recipes = dict(s["recipes"])
        items: list = [{"role": "user", "content": message}]
        for round_ in range(MAX_TOOL_ROUNDS + 1):
            resp = self.client.responses.parse(
                model=self.model,
                instructions=INSTRUCTIONS,
                input=items,
                tools=[SEARCH_TOOL],
                tool_choice="none" if round_ == MAX_TOOL_ROUNDS else "auto",
                text_format=PlanDraft,
                reasoning={"effort": self.effort},
                include=["reasoning.encrypted_content"],
                store=False,
            )
            self.usage.add(resp)
            calls = [o for o in resp.output if o.type == "function_call"]
            if not calls:
                if resp.output_parsed is None:
                    raise PlanningError("the model returned no plan")
                return resp.output_parsed, recipes
            items += [as_input(o) for o in resp.output]
            for call in calls:
                self.usage.tool_calls += 1
                output = self._search_tool(call.arguments, s["profile"], recipes)
                items.append(
                    {"type": "function_call_output", "call_id": call.call_id, "output": output}
                )
        raise PlanningError("tool-call limit reached without a plan")

    def _search_tool(self, arguments: str, p: UserProfile, recipes: dict[str, Recipe]) -> str:
        try:
            args = SearchArgs.model_validate_json(arguments)
        except ValidationError as exc:
            return f"invalid arguments: {exc.errors()[0]['msg']}"
        ids = self.store.search(args.query, slot_filters(p, args.meal_type), SEARCH_LIMIT)
        recipes.update(self.store.get(rid for rid in ids if rid not in recipes))
        pantry = set(p.pantry)
        lines = [recipe_line(recipes[rid], pantry) for rid in ids if rid in recipes]
        return "\n".join(lines) or "no recipes match"

    def _load_unknown(self, plan: MealPlan, recipes: dict[str, Recipe]) -> dict[str, Recipe]:
        missing = {m.recipe_id for _, m in plan.meals} - set(recipes)
        return self.store.get(missing) if missing else {}


def as_input(item) -> dict:
    """An output item as input for the next call (store=False keeps no server-side state)."""
    d = item.model_dump(exclude_none=True)
    d.pop("parsed_arguments", None)
    for c in d.get("content", []) or []:
        c.pop("parsed", None)
    return d


def _to_plan(draft: PlanDraft) -> MealPlan:
    return MealPlan(
        days=[
            PlanDay(day=d.day, meals=[PlannedMeal(meal_type=m.meal_type, recipe_id=m.recipe_id)
                                      for m in d.meals])
            for d in draft.days
        ],
        notes=draft.notes,
    )  # fmt: skip


def _safe_plan(
    plan: MealPlan,
    p: UserProfile,
    recipes: dict[str, Recipe],
    candidates: dict[MealType, list[str]],
) -> tuple[MealPlan, int]:
    """Rebuild the plan's structure and replace every meal that breaks a hard rule with the
    best-ranked safe candidate used least so far. Returns the plan and how many meals changed."""
    by_day = {d.day: d for d in plan.days}
    kept: dict[tuple[int, MealType], PlannedMeal] = {}
    for day in range(1, p.days + 1):
        for m in by_day[day].meals if day in by_day else []:
            r = recipes.get(m.recipe_id)
            if (day, m.meal_type) not in kept and r and not recipe_violations(r, p, m.meal_type):
                kept[(day, m.meal_type)] = m
    used = Counter(m.recipe_id for m in kept.values())
    days, replaced = [], 0
    for day in range(1, p.days + 1):
        meals = []
        for slot in p.meals:
            m = kept.get((day, slot))
            if m is None:
                safe = [
                    rid
                    for rid in candidates.get(slot, [])
                    if rid in recipes and not recipe_violations(recipes[rid], p, slot)
                ]
                if not safe:
                    raise PlanningError(f"no safe recipe for {slot}")
                rid = min(safe, key=lambda r: (used[r], safe.index(r)))
                used[rid] += 1
                m = PlannedMeal(meal_type=slot, recipe_id=rid)
                replaced += 1
            meals.append(m)
        days.append(PlanDay(day=day, meals=meals))
    return MealPlan(days=days, notes=plan.notes), replaced
