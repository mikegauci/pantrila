import pytest
from pydantic import ValidationError

from pantrila.cookbook import (
    MAX_RECIPES_PER_USER,
    CookbookError,
    CookbookFull,
    CookbookRecipeIn,
    FoodEstimate,
    MemoryCookbook,
    bare_name,
    derive,
    problems_for,
)
from pantrila.nutrition import recipe_nutrition
from pantrila.schema import Allergen, DietTag, UserProfile

GOCHUJANG = {
    "description": "gochujang (Korean chilli paste)", "diet_class": "plant",
    "allergens": ["soy", "gluten"], "kcal": 220, "protein_g": 5, "carbs_g": 45, "fat_g": 2,
    "fibre_g": 3, "grams_per_ml": 1.2, "grams_per_piece": None,
}  # fmt: skip


def pancakes(**overrides) -> CookbookRecipeIn:
    base = {
        "title": "Pancakes", "meal_types": ["breakfast"], "total_minutes": 20, "servings": 2,
        "ingredients": [
            {"name": "plain flour", "quantity": 100, "unit": "g", "food": "plain_flour"},
            {"name": "eggs", "quantity": 2, "unit": "piece", "food": "egg"},
            {"name": "milk", "quantity": 250, "unit": "ml", "food": "milk"},
        ],
        "steps": ["Whisk.", "Fry thin pancakes."],
    }  # fmt: skip
    return CookbookRecipeIn.model_validate({**base, **overrides})


def test_groups_are_stored_and_older_recipes_without_them_still_load():
    r = pancakes(
        ingredients=[
            {"name": "plain flour", "quantity": 100, "unit": "g", "food": "plain_flour",
             "section": " For the  batter "},
            {"name": "milk", "quantity": 250, "unit": "ml", "food": "milk"},
        ],
        step_sections=[{"title": "Batter", "first_step": 1}, {"title": "Cook", "first_step": 2}],
    )  # fmt: skip
    again = CookbookRecipeIn.model_validate_json(r.model_dump_json())
    assert again.ingredients[0].section == "For the batter" and again.ingredients[1].section == ""
    assert [s.first_step for s in again.step_sections] == [1, 2]
    assert derive(again).ingredients[0].section == "For the batter"
    old = r.model_dump(exclude={"step_sections"})
    for line in old["ingredients"]:
        del line["section"]
    assert CookbookRecipeIn.model_validate(old).step_sections == []


@pytest.mark.parametrize(
    ("name", "bare"),
    [
        ("1 cup basmati rice", "basmati rice"),
        ("1 pound boneless chicken thighs (see note 1)", "boneless chicken thighs (see note 1)"),
        ("1-1/4 teaspoons paprika", "paprika"),
        ("½ tsp. oregano", "oregano"),
        ("2 pinches of salt", "salt"),
        ("400g chickpeas", "chickpeas"),
        ("3-4 cloves garlic", "cloves garlic"),
        ("1 lemon", "lemon"),
        ("00 flour", "00 flour"),
        ("2 x 400 g cans tomatoes", "2 x 400 g cans tomatoes"),
        ("Salt", "Salt"),
    ],
)
def test_bare_name_drops_a_leading_amount_only(name, bare):
    assert bare_name(name) == bare


def test_derived_lines_carry_what_they_convert_with():
    d = derive(pancakes(ingredients=[
        {"name": "milk", "quantity": 250, "unit": "ml", "food": "milk"},
        {"name": "gochujang", "quantity": 1, "unit": "tbsp", "estimate": GOCHUJANG},
    ]))  # fmt: skip
    assert d.ingredients[0].grams_per_ml and d.ingredients[0].grams_per_piece is None
    assert d.ingredients[1].grams_per_ml == 1.2


@pytest.mark.parametrize("starts", [[2, 1], [1, 1], [3]])
def test_method_headings_must_be_in_order_and_inside_the_method(starts):
    with pytest.raises(ValueError, match="method headings"):
        pancakes(step_sections=[{"title": "x", "first_step": n} for n in starts])


def test_known_foods_derive_like_the_corpus():
    d = derive(pancakes())
    assert [i.grams for i in d.ingredients] == [100.0, 100.0, 257.5]
    assert set(d.allergens) == {Allergen.GLUTEN, Allergen.EGGS, Allergen.MILK}
    assert DietTag.VEGETARIAN in d.diet_tags and DietTag.VEGAN not in d.diet_tags
    assert not d.estimated and d.foods == ["egg", "milk", "plain_flour"]


def test_estimated_food_joins_the_table_for_that_recipe_only():
    r = pancakes(ingredients=[
        {"name": "rice cakes", "quantity": 300, "unit": "g", "food": "white_rice"},
        {"name": "gochujang", "quantity": 2, "unit": "tbsp", "estimate": GOCHUJANG},
    ])  # fmt: skip
    d = derive(r)
    assert d.estimated and d.foods == ["white_rice"]
    assert d.ingredients[1].grams == pytest.approx(2 * 14.79 * 1.2, abs=0.1)
    assert set(d.allergens) == {Allergen.SOY, Allergen.GLUTEN}
    assert DietTag.VEGAN in d.diet_tags and DietTag.GLUTEN_FREE not in d.diet_tags
    rice_only = recipe_nutrition([d.ingredients[0].model_copy(update={"food": "white_rice"})], 2)
    assert d.nutrition.kcal > rice_only.kcal


def test_a_table_food_wins_over_an_estimate_on_the_same_line():
    lines = pancakes().ingredients
    lines[2] = lines[2].model_copy(update={"estimate": FoodEstimate(**GOCHUJANG)})
    d = derive(pancakes(ingredients=[i.model_dump() for i in lines]))
    assert not d.estimated and Allergen.SOY not in d.allergens


def test_every_unusable_line_is_reported():
    r = pancakes(ingredients=[
        {"name": "mystery", "quantity": 1, "unit": "g"},
        {"name": "flour", "quantity": 1, "unit": "piece", "food": "plain_flour"},
        {"name": "unobtainium", "quantity": 1, "unit": "g", "food": "unobtainium"},
    ])  # fmt: skip
    with pytest.raises(CookbookError) as exc:
        derive(r)
    assert len(exc.value.problems) == 3
    assert "pick a food or estimate it" in exc.value.problems[0]
    assert "cannot be counted in pieces" in exc.value.problems[1]


IMPLAUSIBLE = [{"kcal": 1200}, {"protein_g": -1}, {"protein_g": 60, "carbs_g": 50},
               {"grams_per_ml": 0}]  # fmt: skip


@pytest.mark.parametrize("change", IMPLAUSIBLE)
def test_implausible_estimates_are_rejected(change):
    with pytest.raises(ValidationError):
        FoodEstimate(**{**GOCHUJANG, **change})


def test_problems_use_the_person_s_rules():
    r = pancakes()
    profile = UserProfile(allergies=[Allergen.MILK], diets=[DietTag.VEGAN], max_minutes=10,
                          exclude_foods=["egg"])  # fmt: skip
    assert problems_for(r, derive(r), profile) == [
        "contains milk", "is not vegan", "uses egg", "takes 20 min (limit 10)",
    ]  # fmt: skip
    assert problems_for(r, derive(r), UserProfile()) == []


def test_memory_cookbook_is_per_user_and_capped():
    shared: dict = {}
    alice, bob = MemoryCookbook("alice", shared), MemoryCookbook("bob", shared)
    first = alice.add(pancakes())
    assert alice.get(first.id) and bob.get(first.id) is None and not bob.delete(first.id)
    for _ in range(MAX_RECIPES_PER_USER - 1):
        alice.add(pancakes())
    with pytest.raises(CookbookFull):
        alice.add(pancakes())
    assert bob.add(pancakes())


@pytest.mark.parametrize(
    "url", ["not-a-url", "javascript:alert(1)", "https://bad host/", "https://example.com:bad/"]
)
def test_saved_source_links_must_be_valid_web_urls(url):
    with pytest.raises(ValidationError):
        pancakes(source_url=url)


def test_recipe_step_length_is_bounded():
    with pytest.raises(ValidationError):
        pancakes(steps=["x" * 2001])
