import pytest

from pantrila.cooking import grams_used, use_from_pantry
from pantrila.pantry import make_item
from pantrila.schema import PantryItem


def test_grams_used_scales_by_servings_and_skips_estimated_lines():
    lines = [("egg", 150.0), ("butter", 10.0), (None, 40.0), ("egg", 50.0)]
    assert grams_used(lines, recipe_servings=2, servings=3) == {"egg": 300.0, "butter": 15.0}


def test_measured_items_go_down_in_their_own_unit_and_used_up_ones_go():
    eggs, butter = make_item("eggs", 6, "piece"), make_item("butter", 10, "g")
    salt = PantryItem(food="salt")  # "some": Pantrila cannot know it ran out
    changes = use_from_pantry({"egg": 100.0, "butter": 12.0, "salt": 0.4, "milk": 50.0},
                              [butter, eggs, salt])  # fmt: skip
    assert [(c.food, c.used_g) for c in changes] == [("butter", 10.0), ("egg", 100.0)]
    used_up, left = changes
    assert used_up.after is None and used_up.before == butter
    assert left.after.unit == eggs.unit and left.after.quantity == pytest.approx(4)
    assert left.after.grams == pytest.approx(eggs.grams - 100)


def test_a_crumb_left_counts_as_used_up():
    oil = make_item("olive oil", 20, "g")
    assert use_from_pantry({"olive_oil": 19.8}, [oil])[0].after is None
    assert use_from_pantry({"olive_oil": 19.0}, [oil])[0].after.quantity == pytest.approx(1)
