import pytest
from pydantic import ValidationError

from pantrila.foods import UnitError
from pantrila.pantry import (
    ALIASES,
    DbKitchen,
    MemoryKitchen,
    UnknownFood,
    make_item,
    resolve_food,
)
from pantrila.schema import Allergen, PantryItem, Unit, UserProfile


@pytest.mark.parametrize(
    "text, key",
    [("egg", "egg"), ("Eggs", "egg"), ("red onions", "red_onion"), ("tomatoes", "tomato"),
     ("chickpea", "chickpeas"), ("Greek yoghurt", "greek_yogurt"), ("zucchini", "courgette"),
     ("spring-onion", "spring_onion")],
)  # fmt: skip
def test_resolve_food(text, key):
    assert resolve_food(text) == key


def test_unknown_food_comes_with_suggestions():
    with pytest.raises(UnknownFood) as exc:
        resolve_food("brocoli")
    assert "broccoli" in exc.value.suggestions
    with pytest.raises(UnknownFood):
        resolve_food("unobtainium")


def test_aliases_point_at_real_foods():
    from pantrila.foods import load_foods

    assert set(ALIASES.values()) <= set(load_foods())


def test_make_item_normalises_to_grams():
    item = make_item("eggs", 6, Unit.PIECE)
    assert (item.food, item.grams) == ("egg", 300.0)
    assert make_item("spinach").grams is None
    with pytest.raises(UnitError):
        make_item("chicken_breast", 1, Unit.CUP)


def test_pantry_item_amount_is_all_or_nothing():
    with pytest.raises(ValidationError):
        PantryItem(food="egg", quantity=2)
    with pytest.raises(ValidationError):
        PantryItem(food="egg", quantity=2, unit=Unit.PIECE)


def test_memory_kitchen():
    k = MemoryKitchen(UserProfile(allergies=[Allergen.EGGS], pantry=["ignored"]))
    k.put(make_item("rice"))
    k.put(make_item("feta", 200, Unit.G))
    k.put(make_item("feta", 100, Unit.G))
    assert k.profile().pantry == ["feta", "white_rice"]
    assert k.profile().allergies == [Allergen.EGGS]
    assert [i.grams for i in k.pantry()] == [100.0, None]
    assert k.remove("feta") and not k.remove("feta")


@pytest.mark.db
def test_db_kitchen_round_trips_and_isolates_users(conn):
    me, other = DbKitchen(conn, "me"), DbKitchen(conn, "other")
    assert me.profile() == UserProfile()
    me.save_profile(UserProfile(allergies=[Allergen.MILK], pantry=["not_saved"], days=3))
    me.put(make_item("eggs", 6, Unit.PIECE))
    me.put(make_item("spinach"))
    me.put(make_item("eggs", 4, Unit.PIECE))
    other.put(make_item("tofu"))

    p = me.profile()
    assert p.allergies == [Allergen.MILK] and p.days == 3
    assert p.pantry == ["egg", "spinach"]
    assert me.pantry() == [make_item("egg", 4, Unit.PIECE), make_item("spinach")]
    assert other.profile().pantry == ["tofu"]
    assert me.remove("egg") and not me.remove("egg")
    assert [i.food for i in me.pantry()] == ["spinach"]
