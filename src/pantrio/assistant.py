"""Cooking assistant: a LangGraph chat agent with tools over the corpus and the person's kitchen.

    agent -> (tools -> agent)* -> guard

- agent: one Responses API call (store=False) with the person's profile in the instructions.
- tools: search_recipes, check_pantry, update_pantry, swap_ingredient, scale_recipe. Each one is
  plain code; the model only picks arguments. Capped at MAX_TOOL_ROUNDS, after which the model
  must answer.
- guard: code checks every recipe the reply cites (as `[recipe-id]`) against the person's hard
  rules and appends a note for any that breaks one or does not exist, whatever the model said.
"""

from __future__ import annotations

import re
import time
from dataclasses import dataclass
from typing import TypedDict

from langgraph.graph import END, START, StateGraph
from openai.lib._pydantic import to_strict_json_schema
from pydantic import BaseModel, Field, ValidationError

from pantrio import config
from pantrio.constraints import recipe_problems
from pantrio.foods import UnitError
from pantrio.grocery import shop_amount
from pantrio.pantry import Kitchen, UnknownFood, item_text, make_item, resolve_food
from pantrio.planner import RecipeStore, Usage, as_input, recipe_line
from pantrio.schema import MealType, Recipe, Unit, UserProfile
from pantrio.search import SearchFilters
from pantrio.swaps import Swap, evaluate_swap, swap_options

MAX_TOOL_ROUNDS = 4
SEARCH_LIMIT = 6
MAX_HISTORY = 20  # messages kept from earlier turns
CITED = re.compile(r"\[([a-z0-9]+(?:-[a-z0-9]+)+)\]")


# --- Tools the model sees ------------------------------------------------------------------


class SearchArgs(BaseModel):
    query: str = Field(description="What to look for, e.g. 'quick dinner with spinach and feta'.")
    meal_type: MealType | None = Field(description="Meal the recipe is for, or null for any.")
    max_minutes: int | None = Field(description="Time limit the person asked for, or null.")


class CheckPantryArgs(BaseModel):
    recipe_id: str | None = Field(
        description="Recipe to compare with the pantry, or null to list the pantry."
    )


class PantryChange(BaseModel):
    food: str = Field(description="Food name, e.g. 'eggs' or 'greek yogurt'.")
    quantity: float | None = Field(description="Amount, or null if not stated.")
    unit: Unit | None = Field(description="Unit of the amount, or null if not stated.")


class UpdatePantryArgs(BaseModel):
    add: list[PantryChange] = Field(description="Foods bought or found; replaces stored amounts.")
    remove: list[str] = Field(description="Food names used up or thrown away.")


class SwapArgs(BaseModel):
    recipe_id: str
    food: str = Field(description="The ingredient to replace, e.g. 'double cream'.")
    replacement: str | None = Field(
        description="What the person wants to use instead, or null to get suggestions."
    )


class ScaleArgs(BaseModel):
    recipe_id: str
    servings: int = Field(description="Servings wanted, 1 to 24.")


def _tool(name: str, args: type[BaseModel], description: str) -> dict:
    return {"type": "function", "name": name, "description": description,
            "parameters": to_strict_json_schema(args), "strict": True}  # fmt: skip


TOOL_ARGS: dict[str, type[BaseModel]] = {
    "search_recipes": SearchArgs,
    "check_pantry": CheckPantryArgs,
    "update_pantry": UpdatePantryArgs,
    "swap_ingredient": SwapArgs,
    "scale_recipe": ScaleArgs,
}
TOOLS = [
    _tool("search_recipes", SearchArgs, "Search Pantrio's recipes. Results already respect the "
          "person's allergies, diets, excluded foods and time limit."),
    _tool("check_pantry", CheckPantryArgs, "List the pantry, or show which ingredients of a "
          "recipe the person has and which they still need to buy."),
    _tool("update_pantry", UpdatePantryArgs, "Add foods to or remove foods from the pantry."),
    _tool("swap_ingredient", SwapArgs, "Replace an ingredient in a recipe. Returns the new "
          "nutrition, any allergens or diets the swap changes, and whether it suits the person."),
    _tool("scale_recipe", ScaleArgs, "A recipe's ingredients for a number of servings, with its "
          "steps and nutrition per serving."),
]  # fmt: skip

INSTRUCTIONS = """\
You are Pantrio's cooking assistant. You help one person cook from their kitchen: find \
recipes, check what they have, swap ingredients, scale recipes and answer cooking questions. \
Talk to them as "you".

- Recipes: only suggest recipes your tools returned in this conversation. Write each as its \
title followed by its id in square brackets, copied exactly from the tool output, e.g. \
Mushroom Omelette [french-mushroom-omelette]. Never invent recipes, ids, amounts or nutrition \
numbers; get them from tools.
- Safety: search_recipes already removes recipes that break the person's allergies, diets, \
excluded foods and time limit. Other tools report problems; pass them on plainly. Never say a \
recipe or swap is safe for an allergy unless a tool said so.
- Pantry: whenever the person says they bought, have, used up or ran out of a food, call \
update_pantry, even if they also ask for something else. An amount is optional. Use \
check_pantry to see what a recipe still needs.
- Swaps and scaling: use swap_ingredient and scale_recipe; they work out the amounts, \
nutrition and allergens.
- Cooking questions (techniques, terms, timings, food safety) you may answer from knowledge, \
plainly. Explain jargon, e.g. "macros" means protein, carbs and fat.
- Be brief: a few sentences or a short list. If the ask is unclear, ask one question."""


def person_text(p: UserProfile) -> str:
    t = p.targets
    targets = [
        f"{t.kcal:.0f} kcal" if t.kcal else None,
        f"at least {t.min_protein_g:.0f} g protein" if t.min_protein_g else None,
        f"at most {t.max_carbs_g:.0f} g carbs" if t.max_carbs_g else None,
    ]
    lines = [
        f"Allergies: {', '.join(p.allergies) or 'none'}.",
        f"Diets: {', '.join(p.diets) or 'none'}.",
        f"Never eats: {', '.join(p.exclude_foods) or 'nothing listed'}.",
        f"Longest recipe: {f'{p.max_minutes} min' if p.max_minutes else 'no limit'}.",
        f"Daily targets: {', '.join(x for x in targets if x) or 'none'}.",
        f"Pantry: {', '.join(p.pantry) or 'empty'}.",
    ]
    if p.cuisines:
        lines.append(f"Likes: {', '.join(p.cuisines)} food.")
    if p.notes:
        lines.append(f"Notes: {p.notes}")
    return "About the person:\n" + "\n".join(lines)


# --- Results -----------------------------------------------------------------------------------


@dataclass
class ToolCall:
    name: str
    arguments: str
    output: str


@dataclass
class ChatResult:
    text: str  # what the person sees, including any notes code appended
    history: list[dict]  # earlier messages plus this turn, to pass to the next reply()
    cited: list[str]  # recipe ids the reply cites, in order
    flagged: list[str]  # cited ids that break a hard rule or do not exist
    tool_calls: list[ToolCall]
    usage: Usage
    latency_ms: float


class ChatState(TypedDict, total=False):
    profile: UserProfile
    items: list
    rounds: int
    pending: list
    text: str
    flagged: list[str]
    tool_calls: list[ToolCall]


# --- The graph -----------------------------------------------------------------------------


class Assistant:
    def __init__(self, store: RecipeStore, kitchen: Kitchen, client=None,
                 model: str | None = None, effort: str = "low"):  # fmt: skip
        self.store, self.kitchen, self.effort = store, kitchen, effort
        self.client = client or config.openai_client()
        self.model = model or config.model()
        self.usage = Usage()
        self.graph = self._build()

    def _build(self):
        g = StateGraph(ChatState)
        g.add_node("agent", self._agent)
        g.add_node("tools", self._tools)
        g.add_node("guard", self._guard)
        g.add_edge(START, "agent")
        g.add_conditional_edges("agent", lambda s: "tools" if s["pending"] else "guard",
                                ["tools", "guard"])  # fmt: skip
        g.add_edge("tools", "agent")
        g.add_edge("guard", END)
        return g.compile()

    def reply(self, message: str, history: list[dict] = ()) -> ChatResult:
        self.usage = Usage()
        start_tokens = self.store.embed_tokens
        start = time.perf_counter()
        history = list(history)[-MAX_HISTORY:]
        state = self.graph.invoke(
            {
                "profile": self.kitchen.profile(),
                "items": [*history, {"role": "user", "content": message}],
                "rounds": 0,
                "tool_calls": [],
            }
        )
        self.usage.embed_tokens = self.store.embed_tokens - start_tokens
        text = state["text"]
        cited = list(dict.fromkeys(CITED.findall(text)))
        return ChatResult(
            text=text,
            history=[*history, {"role": "user", "content": message},
                     {"role": "assistant", "content": text}],
            cited=cited,
            flagged=state.get("flagged", []),
            tool_calls=state["tool_calls"],
            usage=self.usage,
            latency_ms=(time.perf_counter() - start) * 1000,
        )  # fmt: skip

    # nodes

    def _agent(self, s: ChatState) -> ChatState:
        last = s["rounds"] >= MAX_TOOL_ROUNDS
        resp = self.client.responses.create(
            model=self.model,
            instructions=f"{INSTRUCTIONS}\n\n{person_text(s['profile'])}",
            input=s["items"],
            tools=TOOLS,
            tool_choice="none" if last else "auto",
            reasoning={"effort": self.effort},
            include=["reasoning.encrypted_content"],
            store=False,
        )
        self.usage.add(resp)
        calls = [o for o in resp.output if o.type == "function_call"]
        if calls:
            return {"items": [*s["items"], *(as_input(o) for o in resp.output)],
                    "pending": calls}  # fmt: skip
        return {"pending": [], "text": resp.output_text.strip()}

    def _tools(self, s: ChatState) -> ChatState:
        items, log = list(s["items"]), list(s["tool_calls"])
        for call in s["pending"]:
            self.usage.tool_calls += 1
            output = self.run_tool(call.name, call.arguments, s["profile"])
            log.append(ToolCall(call.name, call.arguments, output))
            items.append({"type": "function_call_output", "call_id": call.call_id,
                          "output": output})  # fmt: skip
        return {"items": items, "pending": [], "rounds": s["rounds"] + 1, "tool_calls": log}

    def _guard(self, s: ChatState) -> ChatState:
        cited = list(dict.fromkeys(CITED.findall(s["text"])))
        recipes = self.store.get(cited) if cited else {}
        notes, flagged = [], []
        for rid in cited:
            if rid not in recipes:
                flagged.append(rid)
                notes.append(f"Pantrio has no recipe with the id {rid}.")
            elif problems := recipe_problems(recipes[rid], s["profile"]):
                flagged.append(rid)
                why = "; ".join(msg.removeprefix(f"{rid} ") for _, msg in problems)
                notes.append(f"{recipes[rid].title} [{rid}] does not suit you: it {why}.")
        text = s["text"]
        if notes:
            text += "\n\nNote from Pantrio: " + " ".join(notes)
        return {"text": text, "flagged": flagged}

    # tools

    def run_tool(self, name: str, arguments: str, profile: UserProfile) -> str:
        if name not in TOOL_ARGS:
            return f"unknown tool {name}"
        try:
            args = TOOL_ARGS[name].model_validate_json(arguments)
        except ValidationError as exc:
            return f"invalid arguments: {exc.errors()[0]['msg']}"
        return getattr(self, f"_{name}")(args, profile)

    def _recipe(self, rid: str) -> Recipe | None:
        return self.store.get([rid]).get(rid)

    def _search_recipes(self, a: SearchArgs, p: UserProfile) -> str:
        limits = [m for m in (a.max_minutes, p.max_minutes) if m]
        filters = SearchFilters(
            exclude_allergens=p.allergies,
            require_diets=p.diets,
            exclude_foods=p.exclude_foods,
            max_minutes=min(limits) if limits else None,
            meal_types=[a.meal_type] if a.meal_type else [],
        )
        ids = self.store.search(a.query, filters, SEARCH_LIMIT)
        recipes = self.store.get(ids)
        pantry = set(self.kitchen.profile().pantry)
        lines = [recipe_line(recipes[rid], pantry) for rid in ids if rid in recipes]
        return "\n".join(lines) or "no recipes match"

    def _check_pantry(self, a: CheckPantryArgs, p: UserProfile) -> str:
        pantry = {i.food: i for i in self.kitchen.pantry()}
        if a.recipe_id is None:
            return "Pantry: " + (", ".join(item_text(i) for i in pantry.values()) or "empty")
        r = self._recipe(a.recipe_id)
        if r is None:
            return f"no recipe with id {a.recipe_id}; use search_recipes"
        have, need = [], []
        for ing in r.ingredients:
            item = pantry.get(ing.food)
            if item is not None and (item.grams is None or item.grams >= ing.grams):
                have.append(ing.food)
            else:
                short = ing.grams - (item.grams if item else 0.0)
                need.append(f"{ing.food} {shop_amount(ing.food, short, {ing.unit})}")
        lines = [
            f"{r.title} [{r.id}], {r.servings} servings.",
            f"In the pantry: {', '.join(have) or 'none of it'}.",
            f"To buy: {', '.join(need) or 'nothing'}.",
        ]
        return "\n".join(lines + _problem_lines(r, p))

    def _update_pantry(self, a: UpdatePantryArgs, p: UserProfile) -> str:
        out = []
        for change in a.add:
            note = ""
            try:
                try:
                    item = make_item(change.food, change.quantity, change.unit)
                except UnitError as exc:  # keep the food, drop an amount code cannot convert
                    item, note = make_item(change.food), f" (amount not stored: {exc})"
            except UnknownFood as exc:
                out.append(f"not added: {exc}")
                continue
            self.kitchen.put(item)
            out.append(f"added {item_text(item)}{note}")
        for name in a.remove:
            try:
                food = resolve_food(name)
            except UnknownFood as exc:
                out.append(f"not removed: {exc}")
                continue
            removed = self.kitchen.remove(food)
            out.append(f"removed {food}" if removed else f"{food} was not in the pantry")
        return "\n".join(out) or "no changes"

    def _swap_ingredient(self, a: SwapArgs, p: UserProfile) -> str:
        r = self._recipe(a.recipe_id)
        if r is None:
            return f"no recipe with id {a.recipe_id}; use search_recipes"
        try:
            food = resolve_food(a.food)
            if food not in r.foods:
                return f"{r.title} does not use {food}; it uses {', '.join(sorted(r.foods))}"
            if a.replacement is None:
                options = swap_options(r, food, p)
                if not options:
                    return f"no swap for {food} in {r.title} suits the person"
                return f"Swaps for {food} in {r.title} [{r.id}], same weight:\n" + "\n".join(
                    _swap_line(s) for s in options
                )
            swap = evaluate_swap(r, food, resolve_food(a.replacement), p)
        except UnknownFood as exc:
            return str(exc)
        verdict = (
            "suits the person"
            if swap.safe
            else "does NOT suit the person: " + "; ".join(swap.problems)
        )
        return f"{r.title} [{r.id}]: {_swap_line(swap)}\nThis swap {verdict}."

    def _scale_recipe(self, a: ScaleArgs, p: UserProfile) -> str:
        r = self._recipe(a.recipe_id)
        if r is None:
            return f"no recipe with id {a.recipe_id}; use search_recipes"
        if not 1 <= a.servings <= 24:
            return "servings must be between 1 and 24"
        k = a.servings / r.servings
        n = r.nutrition
        lines = [
            f"{r.title} [{r.id}] for {a.servings} (written for {r.servings}), "
            f"{r.total_minutes} min.",
            f"Per serving: {n.kcal:.0f} kcal, protein {n.protein_g:.0f} g, carbs "
            f"{n.carbs_g:.0f} g, fat {n.fat_g:.0f} g. Allergens: "
            f"{', '.join(r.allergens) or 'none'}.",
            "Ingredients:",
            *(f"- {_amount(i.quantity * k)} {i.unit} {i.name}" for i in r.ingredients),
            "Steps:",
            *(f"{i}. {step}" for i, step in enumerate(r.steps, 1)),
        ]
        return "\n".join(lines + _problem_lines(r, p))


def _amount(q: float) -> str:
    return f"{round(q, 2):g}" if q < 10 else f"{round(q):g}"


def _problem_lines(r: Recipe, p: UserProfile) -> list[str]:
    problems = recipe_problems(r, p)
    return [f"WARNING, does not suit the person: {msg}" for _, msg in problems]


def _swap_line(s: Swap) -> str:
    parts = [
        f"{s.replacement} for {s.food}: {s.kcal_change:+.0f} kcal, "
        f"{s.protein_change:+.0f} g protein per serving"
    ]
    if s.added_allergens:
        parts.append(f"adds allergens {', '.join(sorted(s.added_allergens))}")
    if s.lost_diets:
        parts.append(f"no longer {', '.join(sorted(s.lost_diets))}")
    return "; ".join(parts)
