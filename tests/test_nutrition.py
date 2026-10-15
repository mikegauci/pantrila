import pytest

from pantrio.foods import load_foods
from pantrio.nutrition import nutrition_diets, recipe_nutrition
from pantrio.schema import DietTag, Ingredient, NutritionFacts, Unit


def ing(food, grams):
    return Ingredient(name=food, food=food, quantity=grams, unit=Unit.G, grams=grams)


def test_nutrition_is_grams_times_per_100g_over_servings():
    foods = load_foods()
    rice, oil = foods["white_rice"].per_100g, foods["olive_oil"].per_100g
    n = recipe_nutrition([ing("white_rice", 300), ing("olive_oil", 20)], servings=2)
    assert n.kcal == pytest.approx(round((rice.kcal * 3 + oil.kcal * 0.2) / 2, 1))
    assert n.fat_g == pytest.approx(round((rice.fat_g * 3 + oil.fat_g * 0.2) / 2, 1))
    assert n.protein_g == pytest.approx(round(rice.protein_g * 3 / 2, 1))


def test_nutrition_scales_with_servings():
    one = recipe_nutrition([ing("chickpeas", 400)], servings=1)
    four = recipe_nutrition([ing("chickpeas", 400)], servings=4)
    assert one.kcal == pytest.approx(four.kcal * 4, abs=0.2)


def facts(kcal, protein, carbs):
    return NutritionFacts(kcal=kcal, protein_g=protein, carbs_g=carbs, fat_g=10, fibre_g=2)


def test_nutrition_diet_thresholds():
    assert DietTag.LOW_CARB in nutrition_diets(facts(400, 30, 20))
    assert DietTag.LOW_CARB not in nutrition_diets(facts(400, 30, 20.1))
    assert DietTag.HIGH_PROTEIN in nutrition_diets(facts(500, 25, 50))
    # 25 g protein in 900 kcal is only 11% of energy: not high protein.
    assert DietTag.HIGH_PROTEIN not in nutrition_diets(facts(900, 25, 50))
    assert DietTag.HIGH_PROTEIN not in nutrition_diets(facts(300, 24.9, 10))
