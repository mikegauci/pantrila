import asyncio
import importlib.util
import re
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

from pantrila.corpus import (
    CorpusValidationError,
    build_recipe,
    check_recipe,
    load_briefs,
    load_corpus,
)
from pantrila.schema import Allergen, DietTag, MealType
from tests.conftest import brief, draft

ROOT = Path(__file__).resolve().parents[1]


def test_build_recipe_normalises_and_derives(curry):
    assert curry.id == "indian-chickpea-curry"
    assert curry.cuisine == "indian"
    garlic = next(i for i in curry.ingredients if i.food == "garlic")
    assert garlic.grams == 15.0  # 3 cloves x 5 g
    assert curry.allergens == [Allergen.MUSTARD]
    assert DietTag.VEGAN in curry.diet_tags and DietTag.GLUTEN_FREE in curry.diet_tags
    assert 200 < curry.nutrition.kcal < 600
    assert check_recipe(curry) == []


def test_missing_allergen_fails_validation():
    with pytest.raises(CorpusValidationError, match=r"missing \['mustard'\]"):
        build_recipe(brief(), draft(allergens=[]))


def test_extra_allergen_fails_validation():
    with pytest.raises(CorpusValidationError, match=r"unexpected \['peanuts'\]"):
        build_recipe(brief(), draft(allergens=["mustard", "peanuts"]))


def test_brief_diet_is_enforced():
    bad = draft(
        ingredients=[
            *draft().model_dump()["ingredients"],
            {"name": "honey", "food": "honey", "quantity": 1, "unit": "tbsp"},
        ]
    )
    with pytest.raises(CorpusValidationError, match="vegan"):
        build_recipe(brief(diet=DietTag.VEGAN), bad)


def test_unconvertible_unit_and_wrong_meal_are_reported_together():
    d = draft(
        meal_types=["lunch"],
        ingredients=[
            *draft().model_dump()["ingredients"],
            {"name": "spinach", "food": "spinach", "quantity": 2, "unit": "piece"},
        ],
    )
    with pytest.raises(CorpusValidationError) as exc:
        build_recipe(brief(meal=MealType.DINNER), d)
    assert len(exc.value.problems) == 2


def test_check_recipe_detects_tampering(curry):
    tampered = curry.model_copy(update={"allergens": []})
    assert "allergens do not match ingredient table" in check_recipe(tampered)


def test_briefs_are_unique_slugs():
    briefs = load_briefs()
    assert len(briefs) == 300
    assert len({b.id for b in briefs}) == 300
    # Same pattern as Recipe.id, so every brief can become a recipe.
    assert all(re.fullmatch(r"[a-z0-9]+(-[a-z0-9]+)*", b.id) for b in briefs)
    assert all(b.id.startswith(b.cuisine.replace("_", "-") + "-") for b in briefs)


def test_committed_corpus_is_consistent():
    recipes = load_corpus()
    if not recipes:
        pytest.skip("corpus not generated yet")
    briefs = {b.id: b for b in load_briefs()}
    for r in recipes:
        assert r.id in briefs
        assert check_recipe(r) == [], r.id
        b = briefs[r.id]
        assert b.meal_type in r.meal_types
        assert b.diet is None or b.diet in r.diet_tags


# --- generator with OpenAI mocked ---------------------------------------------------------------


def load_generator():
    spec = importlib.util.spec_from_file_location(
        "generate_corpus", ROOT / "scripts" / "generate_corpus.py"
    )
    module = importlib.util.module_from_spec(spec)
    sys.modules["generate_corpus"] = module
    spec.loader.exec_module(module)
    return module


class FakeResponses:
    def __init__(self, drafts):
        self.drafts = list(drafts)
        self.calls = []

    async def parse(self, **kwargs):
        self.calls.append(kwargs)
        return SimpleNamespace(
            output_parsed=self.drafts.pop(0),
            usage=SimpleNamespace(input_tokens=1000, output_tokens=500),
        )


def test_generator_retries_with_validation_feedback():
    gen = load_generator()
    responses = FakeResponses([draft(allergens=[]), draft()])
    client = SimpleNamespace(responses=responses)
    usage = gen.Usage()
    recipe = asyncio.run(gen.generate_one(client, brief(), "gpt-test", "low", usage))

    assert recipe is not None and recipe.allergens == [Allergen.MUSTARD]
    assert usage.calls == 2 and usage.input_tokens == 2000 and usage.failures == []
    second = responses.calls[1]
    assert second["store"] is False
    assert "missing ['mustard']" in second["input"][-1]["content"]
    assert second["input"][-2]["role"] == "assistant"


def test_generator_gives_up_after_max_attempts():
    gen = load_generator()
    responses = FakeResponses([draft(allergens=[])] * gen.MAX_ATTEMPTS)
    usage = gen.Usage()
    recipe = asyncio.run(
        gen.generate_one(SimpleNamespace(responses=responses), brief(), "m", "low", usage)
    )
    assert recipe is None
    assert usage.failures == ["indian-chickpea-curry"]
