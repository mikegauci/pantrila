"""Release invariants, cross-source arithmetic and Ciqual missing-value policy."""

import csv
import hashlib
import json

import pytest
from pydantic import ValidationError

from pantrio.cookbook import CookbookRecipeIn, FoodEstimate, derive
from pantrio.corpus import CorpusValidationError, build_recipe, check_recipe, load_corpus
from pantrio.foods import (
    DATA_DIR,
    UnitError,
    derive_allergens,
    derive_ingredient_diets,
    load_foods,
    to_grams,
)
from pantrio.nutrition import recipe_nutrition
from pantrio.schema import Allergen, DietTag, Ingredient, Unit, UserProfile
from scripts.build_ciqual_table import normalize, numeric
from tests.conftest import brief, draft

NEW = {
    "mascarpone",
    "sweetened_condensed_milk",
    "milk_chocolate",
    "white_chocolate",
    "ladyfingers",
    "butter_puff_pastry",
    "egg_white",
    "egg_yolk",
}


def test_original_recipes_and_food_values_are_preserved():
    baseline = json.loads((DATA_DIR / "european_expansion_baseline.json").read_text())
    recipes = {r.id: r for r in load_corpus()}
    assert len(baseline["recipes"]) == 300
    for rid, old in baseline["recipes"].items():
        recipe = recipes[rid]
        assert (
            hashlib.sha256((DATA_DIR / "recipes" / f"{rid}.json").read_bytes()).hexdigest()
            == (old["sha256"])
        )
        assert recipe.nutrition.model_dump() == old["nutrition"]
        assert list(recipe.allergens) == old["allergens"]
        assert list(recipe.diet_tags) == old["diet_tags"]
        assert not check_recipe(recipe)
    foods = load_foods()
    for key, old in baseline["foods"].items():
        assert foods[key].fdc_id == old["fdc_id"]
        assert foods[key].per_100g.model_dump() == old["per_100g"]
        assert foods[key].source == "usda"
    assert foods.keys() >= NEW


def test_provenance_and_exact_distinctions():
    foods = load_foods()
    for key in NEW:
        f = foods[key]
        assert f.source_food_code and f.dataset_version and f.source_url and f.attribution
        assert (f.fdc_id is None) == (f.source == "ciqual")
    assert foods["egg_white"].fdc_id == 172183
    assert foods["egg_yolk"].fdc_id == 172184
    assert foods["egg"].fdc_id == 171287
    assert foods["sweetened_condensed_milk"].source_food_code == "19027"
    assert foods["butter_puff_pastry"].source_food_code == "23424"
    assert "gelatin" not in foods
    assert derive_allergens(NEW) == {Allergen.EGGS, Allergen.MILK, Allergen.GLUTEN, Allergen.SOY}
    assert DietTag.VEGAN not in derive_ingredient_diets(NEW)
    assert DietTag.VEGETARIAN in derive_ingredient_diets(NEW)


@pytest.mark.parametrize("key", sorted(NEW))
def test_new_entries_require_weights(key):
    assert to_grams(key, 2, Unit.KG) == 2000
    for unit in set(Unit) - {Unit.G, Unit.KG}:
        with pytest.raises(UnitError, match="g/kg only"):
            to_grams(key, 1, unit)


def test_mixed_source_nutrition_independent_arithmetic():
    ingredients = [
        Ingredient(name=k, food=k, quantity=g, unit=Unit.G, grams=g)
        for k, g in [("mascarpone", 200), ("egg_white", 100), ("milk_chocolate", 50)]
    ]
    result = recipe_nutrition(ingredients, 2)
    # Pinned upstream numbers, not the loader/production summation reused as an oracle.
    assert result.kcal == round((369 * 2 + 52 + 550 / 2) / 2, 1)
    assert result.protein_g == round((6 * 2 + 10.9 + 7.5 / 2) / 2, 1)
    assert result.carbs_g == round(((3.1 + 0.5) * 2 + 0.73 + (58.9 + 2.9) / 2) / 2, 1)
    assert result.fat_g == round((37 * 2 + 0.17 + 30.8 / 2) / 2, 1)
    assert result.fibre_g == round((0.5 * 2 + 2.9 / 2) / 2, 1)


@pytest.mark.parametrize("value", ["-", "", "traces", "< 0,5", "NaN", "inf", "-1"])
def test_ciqual_rejects_unknown_trace_and_unsupported_values(value):
    with pytest.raises(ValueError):
        numeric(value)


def test_fibre_bound_keeps_raw_qualifier_and_checksum_is_mandatory(tmp_path):
    assert numeric("< 0,5", fibre_upper_bound=True) == 0.5
    assert numeric("3,1") == 3.1
    with (DATA_DIR / "ciqual_foods.csv").open() as f:
        row = next(r for r in csv.DictReader(f) if r["source_food_code"] == "19584")
    assert row["fibre_raw"] == "< 0,5" and row["fibre_policy"] == "upper bound"
    bad = tmp_path / "bad.xlsx"
    bad.write_bytes(b"changed source")
    with pytest.raises(ValueError, match="checksum mismatch"):
        normalize(bad, json.loads((DATA_DIR / "ciqual_manifest.json").read_text()))


def test_existing_estimate_is_not_remapped_to_new_food():
    estimate = FoodEstimate(
        description="mascarpone",
        diet_class="dairy",
        allergens=["milk"],
        kcal=400,
        protein_g=4,
        carbs_g=5,
        fat_g=40,
        fibre_g=0,
        grams_per_ml=None,
        grams_per_piece=None,
    )
    recipe = CookbookRecipeIn(
        title="Personal dessert",
        meal_types=["dessert"],
        total_minutes=10,
        servings=1,
        steps=["Serve."],
        ingredients=[dict(name="mascarpone", quantity=100, unit="g", estimate=estimate)],
    )
    restored = CookbookRecipeIn.model_validate_json(recipe.model_dump_json())
    assert restored.ingredients[0].food is None
    assert derive(restored).estimated and derive(restored).nutrition.kcal == 400
    assert estimate.food("estimate:0").source == "estimated"
    assert estimate.food("estimate:0").source_food_code is None


@pytest.mark.parametrize("field", ["pantry", "exclude_foods"])
def test_profile_catalogue_lists_have_deliberate_bounds(field):
    assert len(getattr(UserProfile(**{field: ["onion"] * 512}), field)) == 512
    with pytest.raises(ValidationError):
        UserProfile(**{field: ["onion"] * 513})


def test_corpus_bounds_agree_with_recipe():
    assert build_recipe(brief(), draft(servings=24, total_minutes=1440)).servings == 24
    assert build_recipe(brief(), draft(servings=1, total_minutes=1)).total_minutes == 1
    for changes in [
        {"servings": 0},
        {"servings": 25},
        {"total_minutes": 0},
        {"total_minutes": 1441},
    ]:
        with pytest.raises(CorpusValidationError):
            build_recipe(brief(), draft(**changes))
