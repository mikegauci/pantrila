from __future__ import annotations

import hashlib
import math
import os
import re

import pytest

from pantrio.corpus import Brief, RecipeDraft, build_recipe
from pantrio.schema import DietTag, MealType, Recipe


@pytest.fixture(autouse=True)
def no_tracing(monkeypatch):
    """Offline tests never send traces or feedback to LangSmith, whatever .env says."""
    monkeypatch.setenv("LANGSMITH_TRACING", "false")


def draft(**overrides) -> RecipeDraft:
    base = {
        "title": "Chickpea and Spinach Curry",
        "summary": "A quick, mild curry of chickpeas and spinach in a tomato and coconut sauce.",
        "meal_types": ["dinner"],
        "total_minutes": 30,
        "servings": 4,
        "ingredients": [
            {"name": "olive oil", "food": "olive_oil", "quantity": 2, "unit": "tbsp"},
            {"name": "onion, diced", "food": "onion", "quantity": 1, "unit": "piece"},
            {"name": "garlic, crushed", "food": "garlic", "quantity": 3, "unit": "piece"},
            {"name": "curry powder", "food": "curry_powder", "quantity": 2, "unit": "tbsp"},
            {"name": "chickpeas, drained", "food": "chickpeas", "quantity": 480, "unit": "g"},
            {"name": "chopped tomatoes", "food": "canned_tomatoes", "quantity": 400, "unit": "g"},
            {"name": "coconut milk", "food": "coconut_milk", "quantity": 400, "unit": "ml"},
            {"name": "baby spinach", "food": "spinach", "quantity": 100, "unit": "g"},
            {"name": "salt", "food": "salt", "quantity": 1, "unit": "pinch"},
        ],
        "steps": ["Soften the onion and garlic in the oil.", "Add the rest and simmer 15 min."],
        "allergens": ["mustard"],
    }
    base.update(overrides)
    return RecipeDraft.model_validate(base)


def brief(id="indian-chickpea-curry", cuisine="indian", meal=MealType.DINNER, diet=None) -> Brief:
    return Brief(id=id, cuisine=cuisine, meal_type=meal, diet=diet, brief="test brief")


@pytest.fixture
def curry() -> Recipe:
    return build_recipe(brief(diet=DietTag.VEGAN), draft())


def _ing(name, food, quantity, unit):
    return {"name": name, "food": food, "quantity": quantity, "unit": unit}


def fixture_corpus() -> list[Recipe]:
    """Five small recipes spanning diets and allergens, built through the real pipeline."""
    curry = build_recipe(brief(diet=DietTag.VEGAN), draft())
    salmon_pasta = build_recipe(
        brief("italian-salmon-pasta", "italian"),
        draft(
            title="Creamy Salmon Pasta",
            summary="Pasta with flaked salmon, cream, lemon and dill.",
            ingredients=[
                _ing("pasta", "pasta", 320, "g"),
                _ing("salmon fillets", "salmon", 2, "piece"),
                _ing("double cream", "double_cream", 150, "ml"),
                _ing("lemon", "lemon", 1, "piece"),
                _ing("dill", "dill", 2, "tbsp"),
            ],
            allergens=["gluten", "fish", "milk"],
        ),
    )
    noodles = build_recipe(
        brief("thai-peanut-noodles", "thai", MealType.LUNCH, DietTag.VEGAN),
        draft(
            title="Peanut Noodle Salad",
            summary="Rice noodles with crunchy vegetables in a peanut and lime dressing.",
            meal_types=["lunch"],
            total_minutes=20,
            ingredients=[
                _ing("rice noodles", "rice_noodles", 200, "g"),
                _ing("peanut butter", "peanut_butter", 3, "tbsp"),
                _ing("soy sauce", "soy_sauce", 2, "tbsp"),
                _ing("lime juice", "lime_juice", 2, "tbsp"),
                _ing("carrot, grated", "carrot", 2, "piece"),
                _ing("cucumber", "cucumber", 1, "piece"),
            ],
            allergens=["peanuts", "soy", "gluten"],
        ),
    )
    chicken = build_recipe(
        brief("greek-lemon-chicken", "greek", diet=DietTag.GLUTEN_FREE),
        draft(
            title="Lemon Oregano Chicken with Potatoes",
            summary="Chicken thighs roasted with potatoes, lemon and oregano.",
            total_minutes=60,
            ingredients=[
                _ing("chicken thighs", "chicken_thigh", 8, "piece"),
                _ing("potatoes", "potato", 4, "piece"),
                _ing("lemon", "lemon", 2, "piece"),
                _ing("olive oil", "olive_oil", 3, "tbsp"),
                _ing("dried oregano", "dried_oregano", 2, "tsp"),
            ],
            allergens=[],
        ),
    )
    mushroom = build_recipe(
        brief("french-mushroom-omelette", "french", MealType.BREAKFAST, DietTag.VEGETARIAN),
        draft(
            title="Mushroom Omelette",
            summary="A soft omelette filled with buttery mushrooms and thyme.",
            meal_types=["breakfast"],
            total_minutes=10,
            servings=1,
            ingredients=[
                _ing("eggs", "egg", 3, "piece"),
                _ing("butter", "butter", 10, "g"),
                _ing("mushrooms, sliced", "mushroom", 4, "piece"),
                _ing("thyme", "thyme", 1, "tsp"),
            ],
            allergens=["eggs", "milk"],
        ),
    )
    return [curry, salmon_pasta, noodles, chicken, mushroom]


@pytest.fixture
def corpus() -> list[Recipe]:
    return fixture_corpus()


# --- offline embeddings ----------------------------------------------------------------------


def fake_vector(text: str, dim: int = 1536) -> list[float]:
    """Bag-of-words hashing embedding: texts sharing words get similar vectors."""
    vec = [0.0] * dim
    for word in re.findall(r"[a-z]+", text.lower()):
        h = int(hashlib.md5(word.encode()).hexdigest(), 16)
        vec[h % dim] += 1.0
    norm = math.sqrt(sum(x * x for x in vec)) or 1.0
    return [x / norm for x in vec]


def fake_embed(texts):
    return [fake_vector(t) for t in texts], sum(len(t.split()) for t in texts)


def fake_embed_query(text):
    return fake_vector(text), len(text.split())


# --- database ----------------------------------------------------------------------------------


@pytest.fixture
def conn():
    url = os.environ.get("PANTRIO_TEST_DATABASE_URL")
    if not url:
        pytest.skip("PANTRIO_TEST_DATABASE_URL is not set")
    from pantrio import db

    with db.connect(url) as c:
        c.autocommit = True
        c.execute(
            "drop table if exists recipe_embeddings, recipe_ingredients, recipes, pantry_items,"
            " user_profiles, meal_plans, usage_events, user_recipes, chat_threads, recipe_photos,"
            " user_avatars, usage_reservations, pantrio_migrations cascade"
        )
        c.autocommit = False
        db.migrate(c)
        yield c


# --- offline recipe store ------------------------------------------------------------------


class CorpusStore:
    """In-memory RecipeStore: the same hard filters as SQL, ranked by word overlap."""

    def __init__(self, recipes):
        self.recipes = {r.id: r for r in recipes}
        self.embed_tokens = 0
        self.queries: list[str] = []
        self.photo_paths: dict[str, str] = {}

    def search(self, query, filters, limit):
        self.queries.append(query)
        words = set(re.findall(r"[a-z]+", query.lower()))

        def overlap(r):
            text = f"{r.title} {r.summary} {' '.join(r.foods)}".lower().replace("_", " ")
            return len(words & set(re.findall(r"[a-z]+", text)))

        ok = [r for r in self.recipes.values() if not filters.violations(r)]
        return [r.id for r in sorted(ok, key=lambda r: (-overlap(r), r.id))][:limit]

    def browse(self, filters, limit):
        ok = [r for r in self.recipes.values() if not filters.violations(r)]
        return [r.id for r in sorted(ok, key=lambda r: (r.title, r.id))][:limit]

    def get(self, ids):
        return {i: self.recipes[i] for i in ids if i in self.recipes}

    def photos(self, ids):
        return {i: self.photo_paths[i] for i in ids if i in self.photo_paths}
