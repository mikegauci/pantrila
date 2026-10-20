import pytest

from pantrio.constraints import recipe_problems
from pantrio.schema import Allergen, DietTag, UserProfile
from pantrio.swaps import evaluate_swap, swap_group, swap_options


@pytest.fixture
def by_id(corpus):
    return {r.id: r for r in corpus}


def test_protein_swaps_for_a_vegetarian_with_an_egg_allergy(by_id):
    chicken = by_id["greek-lemon-chicken"]
    p = UserProfile(diets=[DietTag.VEGETARIAN], allergies=[Allergen.EGGS])
    options = swap_options(chicken, "chicken_thigh", p)
    assert options and len(options) <= 4
    for s in options:
        assert swap_group(s.replacement) == "protein"
        assert s.replacement != "egg"
        assert s.safe and not recipe_problems(s.recipe, p)
        assert DietTag.VEGETARIAN in s.recipe.diet_tags


def test_swap_rederives_allergens_diets_and_nutrition(by_id):
    omelette = by_id["french-mushroom-omelette"]
    s = evaluate_swap(omelette, "butter", "olive_oil", UserProfile(allergies=[Allergen.MILK]))
    assert s.safe
    assert Allergen.MILK not in s.recipe.allergens
    assert DietTag.DAIRY_FREE in s.recipe.diet_tags
    assert s.recipe.nutrition.kcal != omelette.nutrition.kcal
    assert s.kcal_change == round(s.recipe.nutrition.kcal - omelette.nutrition.kcal, 1)
    swapped = [i for i in s.recipe.ingredients if i.food == "olive_oil"]
    assert swapped[0].grams == 10.0 and "instead of butter" in swapped[0].name


def test_unsafe_swap_is_reported(by_id):
    curry = by_id["indian-chickpea-curry"]
    p = UserProfile(diets=[DietTag.VEGAN], allergies=[Allergen.CRUSTACEANS])
    s = evaluate_swap(curry, "chickpeas", "prawns", p)
    assert not s.safe
    assert s.added_allergens == {Allergen.CRUSTACEANS}
    assert DietTag.VEGAN in s.lost_diets
    assert any("crustaceans" in m for m in s.problems)


def test_swap_needs_a_food_the_recipe_uses(by_id):
    with pytest.raises(ValueError):
        swap_options(by_id["indian-chickpea-curry"], "butter", UserProfile())


@pytest.mark.parametrize("food", ["egg", "butter", "mushroom"])
def test_dessert_swaps_cannot_bypass_restriction(by_id, food):
    from pantrio.schema import MealType
    from pantrio.swaps import UnsupportedDessertSwap, swapped_recipe

    dessert = by_id["french-mushroom-omelette"].model_copy(
        update={"meal_types": [MealType.BREAKFAST, MealType.DESSERT]}
    )
    for action in [
        lambda: swap_options(dessert, food, UserProfile()),
        lambda: evaluate_swap(dessert, food, "tofu", UserProfile()),
        lambda: swapped_recipe(dessert, food, "tofu"),
    ]:
        with pytest.raises(UnsupportedDessertSwap, match="setting, rising and texture"):
            action()
