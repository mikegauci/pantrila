import csv

import pytest

from pantrila.foods import (
    DATA_DIR,
    UnitError,
    derive_allergens,
    derive_ingredient_diets,
    load_foods,
    to_grams,
)
from pantrila.schema import Allergen, DietTag, Unit


def test_every_ingredient_has_usda_values():
    with (DATA_DIR / "ingredients.csv").open() as fh:
        keys = [row["key"] for row in csv.DictReader(fh)]
    assert len(keys) == len(set(keys))
    foods = load_foods()
    assert set(foods) == set(keys)
    for food in foods.values():
        assert food.per_100g.kcal >= 0
        assert food.diet_class in {"plant", "dairy", "egg", "honey", "fish", "shellfish", "meat"}


def test_usda_table_spot_values():
    foods = load_foods()
    assert foods["olive_oil"].per_100g.fat_g == pytest.approx(100.0)
    assert foods["chickpeas"].fdc_id == 173800
    assert 10 < foods["chicken_breast"].per_100g.protein_g < 30


@pytest.mark.parametrize(
    ("food", "quantity", "unit", "grams"),
    [
        ("pasta", 300, Unit.G, 300),
        ("plain_flour", 0.5, Unit.KG, 500),
        ("milk", 250, Unit.ML, 257.5),
        ("olive_oil", 1, Unit.TBSP, 14.79 * 0.92),
        ("sugar", 1, Unit.CUP, 240 * 0.85),
        ("egg", 2, Unit.PIECE, 100),
        ("salt", 1, Unit.PINCH, 0.4),
    ],
)
def test_to_grams(food, quantity, unit, grams):
    assert to_grams(food, quantity, unit) == pytest.approx(grams)


def test_to_grams_rejects_units_the_table_cannot_convert():
    with pytest.raises(UnitError, match="by volume"):
        to_grams("chicken_breast", 1, Unit.CUP)
    with pytest.raises(UnitError, match="pieces"):
        to_grams("spinach", 2, Unit.PIECE)


def test_allergens_come_from_every_ingredient():
    assert derive_allergens({"soy_sauce", "prawns", "rice_noodles"}) == {
        Allergen.SOY,
        Allergen.GLUTEN,
        Allergen.CRUSTACEANS,
    }
    assert derive_allergens({"pesto"}) == {Allergen.MILK, Allergen.TREE_NUTS}
    assert derive_allergens({"carrot", "rice_vinegar"}) == set()


def test_ingredient_diets():
    assert derive_ingredient_diets({"tofu", "white_rice"}) >= {
        DietTag.VEGAN,
        DietTag.VEGETARIAN,
        DietTag.PESCATARIAN,
        DietTag.GLUTEN_FREE,
        DietTag.DAIRY_FREE,
        DietTag.NUT_FREE,
    }
    honey = derive_ingredient_diets({"rolled_oats", "honey"})
    assert DietTag.VEGAN not in honey and DietTag.VEGETARIAN in honey
    assert DietTag.GLUTEN_FREE not in honey
    fish_sauce = derive_ingredient_diets({"rice_noodles", "fish_sauce"})
    assert DietTag.VEGETARIAN not in fish_sauce and DietTag.PESCATARIAN in fish_sauce
    stock = derive_ingredient_diets({"chicken_stock", "leek"})
    assert DietTag.PESCATARIAN not in stock
    assert DietTag.NUT_FREE not in derive_ingredient_diets({"almonds"})
    assert DietTag.DAIRY_FREE not in derive_ingredient_diets({"butter"})
