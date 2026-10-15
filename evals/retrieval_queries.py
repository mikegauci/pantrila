"""Deterministic generator for the labelled retrieval queries.

Each query has search text, the hard filters a parser should extract from it, and a relevance
rule. Relevance is judged from the hand-written dish briefs (what the dish is meant to be) and
the recipe's structured fields (ingredients, cuisine, meal, diet), never from generated prose,
so full-text search gets no free win from matching its own labels. A recipe that breaks the
query's filters is never relevant.

    uv run python -m evals.retrieval_queries          # rewrite evals/data/retrieval_queries.json
"""

from __future__ import annotations

import json
import re
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path

from pantrio.corpus import Brief, load_briefs, load_corpus
from pantrio.foods import load_foods
from pantrio.schema import Allergen as A
from pantrio.schema import DietTag as D
from pantrio.schema import MealType as M
from pantrio.schema import Recipe
from pantrio.search import SearchFilters

OUT = Path(__file__).parent / "data" / "retrieval_queries.json"

Pred = Callable[[Recipe, Brief], bool]


@dataclass(frozen=True)
class Spec:
    id: str
    kind: str
    query: str
    relevant: Pred
    filters: SearchFilters = field(default_factory=SearchFilters)


# --- predicate helpers ---------------------------------------------------------------------

CHICKEN = {"chicken_breast", "chicken_thigh"}
BEEF = {"beef_mince", "beef_steak", "beef_stewing"}
LAMB = {"lamb_mince", "lamb_shoulder"}
FISH = {f for f, food in load_foods().items() if food.diet_class == "fish"} - {
    "fish_sauce",
    "worcestershire_sauce",
}
NOODLES = {"egg_noodles", "rice_noodles", "soba_noodles"}
RICE = {"white_rice", "brown_rice", "sushi_rice", "risotto_rice"}
CHEESE = {"cheddar", "parmesan", "mozzarella", "feta", "ricotta", "cream_cheese", "goat_cheese"}
BREAD = {"white_bread", "wholemeal_bread", "pita", "flour_tortilla"}
CITRUS = {"lemon", "lime", "lemon_juice", "lime_juice"}
CHILLI = {"chilli", "jalapeno", "cayenne", "chilli_powder", "sriracha"}
EAST_ASIAN = {"chinese", "japanese", "korean", "thai", "vietnamese"}


def has(*foods: str | set[str]) -> Pred:
    """Recipe uses at least one of the foods."""
    wanted = set().union(*({f} if isinstance(f, str) else f for f in foods))
    return lambda r, b: bool(r.foods & wanted)


def has_n(n: int, *groups: str | set[str]) -> Pred:
    """Recipe uses something from at least n of the groups (a pantry match)."""
    sets = [{g} if isinstance(g, str) else g for g in groups]
    return lambda r, b: sum(bool(r.foods & s) for s in sets) >= n


def brief(pattern: str) -> Pred:
    rx = re.compile(pattern, re.I)
    return lambda r, b: bool(rx.search(b.brief) or rx.search(b.id))


def cuisine(*names: str) -> Pred:
    return lambda r, b: r.cuisine in names


def meal(*meals: M) -> Pred:
    return lambda r, b: bool(set(meals) & set(r.meal_types))


def diet(*tags: D) -> Pred:
    return lambda r, b: set(tags) <= set(r.diet_tags)


def ids(*recipe_ids: str) -> Pred:
    return lambda r, b: r.id in recipe_ids


def all_of(*preds: Pred) -> Pred:
    return lambda r, b: all(p(r, b) for p in preds)


def F(**kw) -> SearchFilters:  # noqa: N802
    return SearchFilters(**kw)


DINNER = [M.DINNER]

SPECS: list[Spec] = [
    # Direct dish asks.
    Spec("dish-01", "dish", "chicken curry", all_of(has(CHICKEN), brief(r"curry|tikka|masala"))),
    Spec("dish-02", "dish", "salmon rice bowl", all_of(has("salmon", "smoked_salmon"), has(RICE))),
    Spec("dish-03", "dish", "prawn stir fry", all_of(has("prawns"), brief(r"stir|pad thai|rice"))),
    Spec(
        "dish-04",
        "dish",
        "lentil soup",
        all_of(has("red_lentils", "green_lentils"), brief(r"soup|dal|harira")),
    ),
    Spec("dish-05", "dish", "tacos", brief(r"taco")),
    Spec(
        "dish-06",
        "dish",
        "slow cooked beef stew",
        all_of(has(BEEF), brief(r"stew|bourguignon|braise|slow")),
    ),
    Spec("dish-07", "dish", "pancakes", brief(r"pancake"), F(meal_types=[M.BREAKFAST])),
    Spec("dish-08", "dish", "noodle soup", brief(r"noodle soup|pho|udon")),
    Spec("dish-09", "dish", "crispy tofu", all_of(has("tofu"), meal(M.DINNER, M.LUNCH))),
    Spec("dish-10", "dish", "salad with feta", all_of(brief(r"salad"), has("feta"))),
    Spec(
        "dish-11",
        "dish",
        "chocolate dessert",
        all_of(meal(M.DESSERT), has("dark_chocolate", "cocoa_powder")),
    ),
    Spec("dish-12", "dish", "eggs for breakfast", has("egg"), F(meal_types=[M.BREAKFAST])),
    # Ingredient-led asks.
    Spec("ingr-01", "ingredient", "recipes with chickpeas", has("chickpeas")),
    Spec("ingr-02", "ingredient", "what can I cook with aubergine", has("aubergine")),
    Spec("ingr-03", "ingredient", "sweet potato dinner", has("sweet_potato"), F(meal_types=DINNER)),
    Spec("ingr-04", "ingredient", "mushroom recipes", has("mushroom", "shiitake")),
    Spec("ingr-05", "ingredient", "something with salmon", has("salmon", "smoked_salmon")),
    Spec("ingr-06", "ingredient", "ways to use up spinach", has("spinach")),
    Spec("ingr-07", "ingredient", "lamb dinner", has(LAMB), F(meal_types=DINNER)),
    Spec("ingr-08", "ingredient", "dishes with peanut butter", has("peanut_butter", "peanuts")),
    # Cuisine and diet.
    Spec(
        "cuis-01",
        "cuisine_diet",
        "vegan thai dinner",
        cuisine("thai"),
        F(require_diets=[D.VEGAN], meal_types=DINNER),
    ),
    Spec(
        "cuis-02",
        "cuisine_diet",
        "vegetarian italian pasta",
        all_of(cuisine("italian"), has("pasta")),
        F(require_diets=[D.VEGETARIAN]),
    ),
    Spec(
        "cuis-03",
        "cuisine_diet",
        "gluten-free mexican food",
        cuisine("mexican"),
        F(require_diets=[D.GLUTEN_FREE]),
    ),
    Spec(
        "cuis-04",
        "cuisine_diet",
        "japanese fish dinner",
        all_of(cuisine("japanese"), has(FISH)),
        F(meal_types=DINNER),
    ),
    Spec(
        "cuis-05",
        "cuisine_diet",
        "low carb chicken dinner",
        has(CHICKEN),
        F(require_diets=[D.LOW_CARB], meal_types=DINNER),
    ),
    Spec("cuis-06", "cuisine_diet", "korean beef", all_of(cuisine("korean"), has(BEEF))),
    Spec(
        "cuis-07",
        "cuisine_diet",
        "middle eastern vegan lunch",
        cuisine("middle_eastern"),
        F(require_diets=[D.VEGAN], meal_types=[M.LUNCH]),
    ),
    Spec(
        "cuis-08",
        "cuisine_diet",
        "dairy-free indian curry",
        all_of(cuisine("indian"), brief(r"curry|masala|dal|rogan|gobi")),
        F(require_diets=[D.DAIRY_FREE]),
    ),
    Spec(
        "cuis-09",
        "cuisine_diet",
        "pescatarian spanish dishes",
        all_of(cuisine("spanish"), has(FISH | {"prawns", "mussels", "squid"})),
        F(require_diets=[D.PESCATARIAN]),
    ),
    Spec(
        "cuis-10",
        "cuisine_diet",
        "high protein breakfast",
        meal(M.BREAKFAST),
        F(require_diets=[D.HIGH_PROTEIN], meal_types=[M.BREAKFAST]),
    ),
    # Allergen constraints.
    Spec(
        "allg-01",
        "allergen",
        "thai noodles, I have a nut allergy",
        all_of(cuisine("thai"), has(NOODLES)),
        F(exclude_allergens=[A.PEANUTS, A.TREE_NUTS]),
    ),
    Spec(
        "allg-02",
        "allergen",
        "coeliac friendly chicken dinner",
        has(CHICKEN),
        F(exclude_allergens=[A.GLUTEN], meal_types=DINNER),
    ),
    Spec(
        "allg-03",
        "allergen",
        "breakfast for someone allergic to eggs",
        meal(M.BREAKFAST),
        F(exclude_allergens=[A.EGGS], meal_types=[M.BREAKFAST]),
    ),
    Spec(
        "allg-04",
        "allergen",
        "seafood dinner, shellfish allergy",
        has(FISH),
        F(exclude_allergens=[A.CRUSTACEANS, A.MOLLUSCS], meal_types=DINNER),
    ),
    Spec(
        "allg-05",
        "allergen",
        "sesame-free asian noodles",
        all_of(cuisine(*EAST_ASIAN), has(NOODLES)),
        F(exclude_allergens=[A.SESAME]),
    ),
    Spec(
        "allg-06",
        "allergen",
        "dessert with no milk",
        meal(M.DESSERT),
        F(exclude_allergens=[A.MILK], meal_types=[M.DESSERT]),
    ),
    Spec("allg-07", "allergen", "soy-free stir fry", brief(r"stir"), F(exclude_allergens=[A.SOY])),
    Spec(
        "allg-08",
        "allergen",
        "stew without mustard or celery",
        brief(r"stew|tagine|casserole|cassoulet|chilli"),
        F(exclude_allergens=[A.MUSTARD, A.CELERY]),
    ),
    # Negations.
    Spec(
        "neg-01",
        "negation",
        "pasta dinner, no mushrooms",
        has("pasta"),
        F(exclude_foods=["mushroom", "shiitake"], meal_types=DINNER),
    ),
    Spec(
        "neg-02",
        "negation",
        "curry but no coconut",
        brief(r"curry"),
        F(exclude_foods=["coconut_milk", "coconut_cream", "desiccated_coconut"]),
    ),
    Spec(
        "neg-03",
        "negation",
        "salad without tomatoes",
        brief(r"salad"),
        F(exclude_foods=["tomato", "cherry_tomato", "canned_tomatoes"]),
    ),
    Spec(
        "neg-04",
        "negation",
        "rice dish, hold the peas",
        all_of(has(RICE), brief(r"rice")),
        F(exclude_foods=["peas"]),
    ),
    Spec(
        "neg-05",
        "negation",
        "taco night but not beef",
        brief(r"taco"),
        F(exclude_foods=sorted(BEEF)),
    ),
    Spec(
        "neg-06",
        "negation",
        "fish for dinner, anything but salmon",
        has(FISH),
        F(exclude_foods=["salmon", "smoked_salmon"], meal_types=DINNER),
    ),
    Spec(
        "neg-07",
        "negation",
        "soup with no meat",
        brief(r"soup|pho|harira|congee"),
        F(require_diets=[D.VEGETARIAN]),
    ),
    Spec(
        "neg-08",
        "negation",
        "breakfast without eggs or bread",
        meal(M.BREAKFAST),
        F(exclude_foods=["egg", *sorted(BREAD)], meal_types=[M.BREAKFAST]),
    ),
    # Vague asks.
    Spec(
        "vague-01",
        "vague",
        "something cosy for a cold night",
        brief(r"stew|soup|pie|chilli|curry|braise|tagine|bake|slow"),
        F(meal_types=DINNER),
    ),
    Spec(
        "vague-02",
        "vague",
        "light summer lunch",
        brief(r"salad|chilled|rolls|gazpacho|slaw"),
        F(meal_types=[M.LUNCH]),
    ),
    Spec(
        "vague-03",
        "vague",
        "comfort food",
        brief(r"mac|pie|mash|bake|grilled cheese|stew|chilli|toad|meatloaf|burger|risotto"),
    ),
    Spec(
        "vague-04",
        "vague",
        "healthy high protein lunch",
        diet(D.HIGH_PROTEIN),
        F(meal_types=[M.LUNCH]),
    ),
    Spec("vague-05", "vague", "something sweet", meal(M.DESSERT)),
    Spec("vague-06", "vague", "a fresh zingy salad", all_of(brief(r"salad|slaw"), has(CITRUS))),
    Spec(
        "vague-07",
        "vague",
        "date night dinner to impress",
        ids(
            "french-coq-au-vin",
            "french-beef-bourguignon",
            "french-moules-marinieres",
            "french-salmon-en-papillote",
            "italian-mushroom-risotto",
            "greek-lamb-kleftiko",
            "spanish-seafood-paella",
            "moroccan-lamb-apricot-tagine",
            "spanish-garlic-prawns",
            "indian-lamb-rogan-josh",
            "japanese-teriyaki-salmon",
            "italian-beef-ragu",
        ),
        F(meal_types=DINNER),
    ),  # fmt: skip
    Spec(
        "vague-08",
        "vague",
        "kid friendly dinner",
        ids(
            "american-mac-cheese",
            "british-fish-chips-baked",
            "american-burger",
            "british-sausage-mash",
            "american-meatloaf",
            "mexican-quesadilla",
            "mexican-chicken-fajitas",
            "italian-pasta-pomodoro",
            "british-toad-in-hole",
            "american-bbq-chicken-traybake",
            "british-cauliflower-cheese",
            "japanese-chicken-katsu-curry",
            "spanish-albondigas",
        ),
        F(meal_types=DINNER),
    ),  # fmt: skip
    Spec(
        "vague-09",
        "vague",
        "hangover breakfast",
        ids(
            "british-full-english-lite",
            "mexican-breakfast-burrito",
            "mexican-huevos-rancheros",
            "french-croque-madame",
            "middle_eastern-shakshuka",
            "spanish-huevos-flamencos",
            "british-beans-on-toast",
            "american-avocado-toast-egg",
        ),
        F(meal_types=[M.BREAKFAST]),
    ),  # fmt: skip
    # Pantry lists.
    Spec(
        "pantry-01",
        "pantry",
        "I have chickpeas, spinach and tomatoes",
        has_n(2, "chickpeas", "spinach", {"tomato", "cherry_tomato", "canned_tomatoes"}),
    ),
    Spec("pantry-02", "pantry", "eggs, cheese and bread", has_n(2, "egg", CHEESE, BREAD)),
    Spec(
        "pantry-03",
        "pantry",
        "leftover rice, eggs, frozen peas and soy sauce",
        has_n(3, RICE, "egg", "peas", {"soy_sauce", "tamari"}),
    ),
    Spec(
        "pantry-04",
        "pantry",
        "chicken thighs, a lemon and some potatoes",
        all_of(has(CHICKEN), has_n(1, CITRUS, "potato")),
    ),
    Spec(
        "pantry-05",
        "pantry",
        "tofu, broccoli, ginger and garlic",
        all_of(has("tofu"), has_n(2, "broccoli", {"ginger", "ground_ginger"}, "garlic")),
    ),
    Spec(
        "pantry-06",
        "pantry",
        "canned tuna, pasta and sweetcorn",
        all_of(has("canned_tuna"), has_n(1, "pasta", "sweetcorn", RICE, "potato")),
    ),
    Spec(
        "pantry-07",
        "pantry",
        "sweet potato, black beans and an avocado",
        has_n(2, "sweet_potato", "black_beans", "avocado"),
    ),
    Spec(
        "pantry-08",
        "pantry",
        "oats, bananas and peanut butter",
        has_n(2, "rolled_oats", "banana", "peanut_butter"),
    ),
    Spec(
        "pantry-09",
        "pantry",
        "red lentils, coconut milk and an onion",
        all_of(has("red_lentils", "green_lentils"), has_n(1, "coconut_milk", "onion")),
    ),
    Spec(
        "pantry-10",
        "pantry",
        "salmon fillets, rice and a cucumber",
        all_of(has("salmon", "smoked_salmon"), has_n(1, RICE, "cucumber")),
    ),
]


def generate(recipes: list[Recipe], briefs: list[Brief]) -> list[dict]:
    by_id = {b.id: b for b in briefs}
    out = []
    for spec in SPECS:
        relevant = sorted(
            r.id
            for r in recipes
            if not spec.filters.violations(r) and spec.relevant(r, by_id[r.id])
        )
        if not relevant:
            raise ValueError(f"{spec.id} ({spec.query!r}) has no relevant recipes")
        out.append(
            {
                "id": spec.id,
                "kind": spec.kind,
                "query": spec.query,
                "filters": spec.filters.model_dump(mode="json", exclude_defaults=True),
                "relevant_ids": relevant,
            }
        )
    return out


def render(queries: list[dict]) -> str:
    return json.dumps(queries, indent=2) + "\n"


def main() -> None:
    queries = generate(load_corpus(), load_briefs())
    OUT.write_text(render(queries))
    sizes = sorted(len(q["relevant_ids"]) for q in queries)
    print(f"wrote {len(queries)} queries; relevant per query min {sizes[0]}, "
          f"median {sizes[len(sizes) // 2]}, max {sizes[-1]}")  # fmt: skip


if __name__ == "__main__":
    main()
