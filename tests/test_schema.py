import pytest
from pydantic import ValidationError

from pantrio.schema import Allergen, Recipe


def test_fourteen_eu_allergens():
    assert len(Allergen) == 14


def test_recipe_round_trips_through_json(curry):
    assert Recipe.model_validate_json(curry.model_dump_json()) == curry


@pytest.mark.parametrize(
    "change",
    [
        {"id": "Not A Slug"},
        {"servings": 0},
        {"total_minutes": 0},
        {"ingredients": []},
        {"meal_types": []},
        {"allergens": ["shellfish"]},
        {"diet_tags": ["paleo"]},
    ],
)
def test_recipe_rejects_invalid_fields(curry, change):
    data = curry.model_dump(mode="json") | change
    with pytest.raises(ValidationError):
        Recipe.model_validate(data)
