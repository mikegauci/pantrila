from pantrio.grocery import AISLE_ORDER, grocery_list, grocery_text, shop_amount
from pantrio.pantry import make_item
from pantrio.schema import MealPlan, PlanDay, PlannedMeal, Unit

CURRY, CHICKEN = "indian-chickpea-curry", "greek-lemon-chicken"


def plan() -> MealPlan:
    return MealPlan(days=[
        PlanDay(day=1, meals=[PlannedMeal(meal_type="dinner", recipe_id=CURRY)]),
        PlanDay(day=2, meals=[PlannedMeal(meal_type="dinner", recipe_id=CHICKEN, portions=2)]),
    ])  # fmt: skip


def test_grocery_list_sums_scales_and_subtracts_the_pantry(corpus):
    recipes = {r.id: r for r in corpus}
    pantry = [make_item("onion"), make_item("chicken_thigh", 440, Unit.G)]
    g = grocery_list(plan(), recipes, pantry, people=2)
    items = {i.food: i for i in g.items}

    # 880 g of thighs for 4 servings; 2 portions each for 2 people is 880 g; 440 g at home.
    thighs = items["chicken_thigh"]
    assert (thighs.need_g, thighs.have_g, thighs.buy_g) == (880.0, 440.0, 440.0)
    assert thighs.amount == "4 pieces" and thighs.recipes == [CHICKEN]
    # Lemon only in the chicken; olive oil in both recipes, measured in spoons.
    assert items["lemon"].need_g == 120.0
    assert items["olive_oil"].recipes == [CURRY, CHICKEN]
    assert items["olive_oil"].need_g == round(27.2 / 4 * 2 + 40.8 / 4 * 4, 1)
    # A pantry item without an amount covers the food.
    assert [i.food for i in g.covered] == ["onion"]
    assert "onion" not in items

    ranks = [AISLE_ORDER.index(i.aisle) for i in g.items]
    assert ranks == sorted(ranks)
    text = grocery_text(g)
    assert "Meat:" in text and "chicken thigh: 4 pieces (have 440 g)" in text
    assert text.endswith("From your pantry: onion")


def test_shop_amounts_round_up():
    assert shop_amount("egg", 120, {Unit.PIECE}) == "3 pieces"
    assert shop_amount("egg", 50, {Unit.PIECE}) == "1 piece"
    assert shop_amount("olive_oil", 5, {Unit.TBSP}) == "2 tsp"
    assert shop_amount("olive_oil", 30, {Unit.TBSP}) == "3 tbsp"
    assert shop_amount("milk", 300, {Unit.ML}) == "300 ml"
    assert shop_amount("salt", 85, {Unit.TSP}) == "90 g"  # a lot of spoons goes by weight
    assert shop_amount("chickpeas", 481, {Unit.G}) == "490 g"
    assert shop_amount("salt", 0.4, {Unit.PINCH}) == "1 g"
