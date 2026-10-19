"""Chat agent tests with a scripted OpenAI client and the in-memory store (no API calls)."""

import json
from types import SimpleNamespace

import pytest
from openai.types.responses import ResponseFunctionToolCall

from pantrio.assistant import MAX_TOOL_ROUNDS, TOOLS, Assistant
from pantrio.pantry import MemoryKitchen, make_item
from pantrio.schema import Allergen, DietTag, Unit, UserProfile
from tests.conftest import CorpusStore

OMELETTE, CHICKEN, CURRY, SALMON = (
    "french-mushroom-omelette", "greek-lemon-chicken", "indian-chickpea-curry",
    "italian-salmon-pasta",
)  # fmt: skip
USAGE = SimpleNamespace(input_tokens=200, output_tokens=30)


def text_reply(text: str) -> SimpleNamespace:
    return SimpleNamespace(output=[SimpleNamespace(type="message")], output_text=text,
                           usage=USAGE)  # fmt: skip


def tool_reply(name: str, call_id: str = "c1", **arguments) -> SimpleNamespace:
    call = ResponseFunctionToolCall(type="function_call", call_id=call_id, name=name,
                                    arguments=json.dumps(arguments))  # fmt: skip
    return SimpleNamespace(output=[call], output_text="", usage=USAGE)


class FakeClient:
    def __init__(self, *replies):
        self.replies = list(replies)
        self.calls: list[dict] = []
        self.responses = self

    def create(self, **kwargs):
        self.calls.append({**kwargs, "input": list(kwargs["input"])})
        return self.replies.pop(0)


@pytest.fixture
def kitchen():
    profile = UserProfile(allergies=[Allergen.FISH], diets=[DietTag.PESCATARIAN])
    return MemoryKitchen(profile, [make_item("egg", 2, Unit.PIECE), make_item("spinach")])


def bot(corpus, kitchen, *replies) -> tuple[Assistant, FakeClient]:
    client = FakeClient(*replies)
    return Assistant(CorpusStore(corpus), kitchen, client=client, model="m"), client


def test_plain_answer_keeps_history_and_sends_the_profile(corpus, kitchen):
    a, client = bot(corpus, kitchen, text_reply("Fold, don't stir."), text_reply("Yes."))
    first = a.reply("How do I make an omelette fluffy?")
    assert first.text == "Fold, don't stir." and first.tool_calls == [] and first.cited == []
    call = client.calls[0]
    assert call["store"] is False and call["tool_choice"] == "auto"
    assert "Allergies: fish." in call["instructions"]
    assert "Pantry: egg, spinach." in call["instructions"]
    assert {t["name"] for t in call["tools"]} == {
        "search_recipes", "check_pantry", "update_pantry", "swap_ingredient", "scale_recipe",
        "write_recipe",
    }  # fmt: skip
    assert all(t["strict"] for t in TOOLS)

    second = a.reply("Really?", first.history)
    assert [m["role"] for m in client.calls[1]["input"]] == ["user", "assistant", "user"]
    assert len(second.history) == 4
    assert second.usage.llm_calls == 1 and second.usage.input_tokens == 200


def test_search_tool_applies_the_hard_rules(corpus, kitchen):
    a, client = bot(
        corpus, kitchen,
        tool_reply("search_recipes", query="creamy salmon pasta", meal_type=None,
                   max_minutes=None),
        text_reply(f"Try Mushroom Omelette [{OMELETTE}]."),
    )  # fmt: skip
    result = a.reply("salmon pasta please")
    out = result.tool_calls[0].output
    assert SALMON not in out and OMELETTE in out
    assert "pantry: egg" in out  # pantry foods each recipe uses
    second = client.calls[1]["input"]
    assert second[1]["type"] == "function_call"
    assert second[2] == {"type": "function_call_output", "call_id": "c1", "output": out}
    assert result.cited == [OMELETTE] and result.flagged == []


def test_search_tool_combines_time_limits(corpus, kitchen):
    a, _ = bot(corpus, kitchen)
    args = {"query": "dinner", "meal_type": "dinner", "max_minutes": 45}
    out = a.run_tool("search_recipes", json.dumps(args), kitchen.profile())
    assert CURRY in out and CHICKEN not in out  # chicken takes 60 min


def test_guard_flags_unsafe_and_made_up_recipes(corpus, kitchen):
    reply = f"Salmon Pasta [{SALMON}] or Fake Stew [made-up-stew]."
    a, _ = bot(corpus, kitchen, text_reply(reply))
    result = a.reply("ideas?")
    assert result.flagged == [SALMON, "made-up-stew"]
    assert result.text.startswith(reply)
    assert "Note from Pantrio:" in result.text
    assert "Creamy Salmon Pasta [italian-salmon-pasta] does not suit you: it contains fish" in (
        result.text
    )
    assert "no recipe with the id made-up-stew" in result.text


def test_update_pantry_saves_known_foods_only(corpus, kitchen):
    args = {"add": [{"food": "Greek yoghurt", "quantity": 500, "unit": "g"},
                    {"food": "eggs", "quantity": 6, "unit": "piece"},
                    {"food": "dragonfruitz", "quantity": None, "unit": None}],
            "remove": ["spinach", "kale"]}  # fmt: skip
    a, _ = bot(corpus, kitchen, tool_reply("update_pantry", **args), text_reply("Done."))
    out = a.reply("I bought yoghurt and eggs, ate the spinach").tool_calls[0].output
    assert "added greek_yogurt (500 g, 500 g)" in out
    assert "not added: 'dragonfruitz' is not in the ingredient table" in out
    assert "removed spinach" in out and "kale was not in the pantry" in out
    pantry = {i.food: i.grams for i in kitchen.pantry()}
    assert pantry == {"egg": 300.0, "greek_yogurt": 500.0}


def test_check_pantry(corpus, kitchen):
    a, _ = bot(corpus, kitchen)
    p = kitchen.profile()
    assert a.run_tool("check_pantry", '{"recipe_id": null}', p).startswith("Pantry: egg (2 piece")
    out = a.run_tool("check_pantry", json.dumps({"recipe_id": OMELETTE}), p)
    # 3 eggs needed, 2 at home: buy 1.
    assert "To buy: egg 1 piece, butter 10 g, mushroom 4 pieces, thyme 1 tsp." in out
    out = a.run_tool("check_pantry", json.dumps({"recipe_id": SALMON}), p)
    assert "WARNING, does not suit the person: italian-salmon-pasta contains fish" in out
    assert "no recipe with id nope" in a.run_tool("check_pantry", '{"recipe_id": "nope"}', p)


def test_scale_recipe(corpus, kitchen):
    a, _ = bot(corpus, kitchen)
    out = a.run_tool("scale_recipe", json.dumps({"recipe_id": CURRY, "servings": 2}),
                     kitchen.profile())  # fmt: skip
    assert "for 2 (written for 4)" in out
    assert "- 240 g chickpeas, drained" in out and "- 0.5 piece onion, diced" in out
    assert "1. Soften the onion" in out
    assert "servings must be" in a.run_tool(
        "scale_recipe", json.dumps({"recipe_id": CURRY, "servings": 0}), kitchen.profile()
    )


def test_swap_ingredient(corpus, kitchen):
    a, _ = bot(corpus, kitchen)
    p = kitchen.profile()

    def swap(**kw):
        return a.run_tool("swap_ingredient", json.dumps({"recipe_id": CURRY, **kw}), p)

    out = swap(food="chickpeas", replacement="cod")
    assert "does NOT suit the person" in out and "contains fish" in out
    out = swap(food="chickpeas", replacement="tofu")
    assert "This swap suits the person." in out and "adds allergens soy" in out
    out = swap(food="chickpeas", replacement=None)
    assert out.startswith("Swaps for chickpeas") and "cod" not in out
    assert "does not use butter" in swap(food="butter", replacement=None)
    assert "not in the ingredient table" in swap(food="unobtainium", replacement=None)


def test_bad_arguments_and_unknown_tools_are_reported(corpus, kitchen):
    a, _ = bot(corpus, kitchen)
    assert a.run_tool("scale_recipe", "{}", kitchen.profile()).startswith("invalid arguments")
    assert a.run_tool("rm_rf", "{}", kitchen.profile()) == "unknown tool rm_rf"


def test_tool_rounds_are_capped(corpus, kitchen):
    loop = [tool_reply("check_pantry", recipe_id=None)] * MAX_TOOL_ROUNDS
    a, client = bot(corpus, kitchen, *loop, text_reply("Here is your pantry."))
    result = a.reply("what do I have")
    assert [c["tool_choice"] for c in client.calls] == ["auto"] * MAX_TOOL_ROUNDS + ["none"]
    assert len(result.tool_calls) == MAX_TOOL_ROUNDS
    assert result.usage.tool_calls == MAX_TOOL_ROUNDS


def test_update_pantry_keeps_a_food_whose_amount_cannot_be_converted(corpus, kitchen):
    a, _ = bot(corpus, kitchen)
    args = {"add": [{"food": "kale", "quantity": 1, "unit": "piece"}], "remove": []}
    out = a.run_tool("update_pantry", json.dumps(args), kitchen.profile())
    assert out.startswith("added kale (amount not stored: kale cannot be counted in pieces")
    assert {i.food: i.grams for i in kitchen.pantry()}["kale"] is None


def cake(*lines) -> dict:
    return {"title": "Chocolate Cake", "summary": "A rich sponge.", "cuisine": "British",
            "meal_types": ["snack"], "total_minutes": 60, "servings": 8,
            "ingredients": [{"name": n, "quantity": q, "unit": u} for n, q, u in lines],
            "steps": ["Mix.", " ", "Bake for 30 minutes."]}  # fmt: skip


CAKE = [("plain flour", 200, "g"), ("eggs", 3, "piece"), ("butter", 150, "g"),
        ("cocoa powder", 40, "g")]  # fmt: skip


def test_write_recipe_resolves_foods_and_checks_the_rules(corpus):
    kitchen = MemoryKitchen(UserProfile(allergies=[Allergen.MILK]))
    a, _ = bot(corpus, kitchen, tool_reply("write_recipe", **cake(*CAKE)),
               text_reply("Here is a chocolate cake."))  # fmt: skip
    result = a.reply("Give me a chocolate cake recipe")
    out = result.tool_calls[0].output
    assert "Allergens found: gluten, eggs, milk." in out
    assert "WARNING, does not suit the person: contains milk" in out
    assert "Per serving:" in out and "suits the person" not in out
    [draft] = result.drafts
    assert draft.source == "manual" and draft.cuisine == "british"
    assert draft.steps == ["Mix.", "Bake for 30 minutes."]
    assert [x.food for x in draft.ingredients] == ["plain_flour", "egg", "butter", "cocoa_powder"]


def test_write_recipe_leaves_unknown_foods_for_review(corpus, kitchen):
    a, _ = bot(corpus, kitchen)
    drafts: list = []
    args = cake(("plain flour", 200, "g"), ("unicorn sprinkles", 1, "tbsp"), ("eggs", -1, "piece"))
    out = a.run_tool("write_recipe", json.dumps(args), kitchen.profile(), drafts)
    assert (
        "Could not check for allergens or diets (not in Pantrio's table): unicorn sprinkles" in out
    )
    assert "suits the person" not in out and "Per serving" not in out
    [draft] = drafts
    sprinkles = draft.ingredients[1]
    assert sprinkles.food is None and sprinkles.estimate is None
    assert draft.ingredients[2].quantity == 1.0  # a bad amount becomes 1 for the person to check


def test_write_recipe_says_when_it_suits_the_person(corpus, kitchen):
    a, _ = bot(corpus, kitchen)
    drafts: list = []
    out = a.run_tool("write_recipe", json.dumps(cake(("eggs", 2, "piece"), ("spinach", 100, "g"))),
                     kitchen.profile(), drafts)  # fmt: skip
    assert "It suits the person's allergies, diets and excluded foods." in out
    empty = {**cake(), "steps": []}
    assert a.run_tool("write_recipe", json.dumps(empty), kitchen.profile(), drafts).startswith(
        "a recipe needs"
    )
    assert len(drafts) == 1


@pytest.mark.parametrize(
    ("profile", "problem"),
    [
        (UserProfile(allergies=[Allergen.MILK]), "contains milk"),
        (UserProfile(diets=[DietTag.VEGAN]), "is not vegan"),
        (UserProfile(exclude_foods=["egg"]), "uses egg"),
    ],
)
def test_guard_checks_drafts_even_when_model_calls_them_safe(corpus, profile, problem):
    a, _ = bot(
        corpus,
        MemoryKitchen(profile),
        tool_reply("write_recipe", **cake(*CAKE)),
        text_reply("This cake is safe for you."),
    )
    result = a.reply("Write a cake")
    assert problem in result.draft_problems[0]
    assert problem in result.text.split("Note from Pantrio:")[1]
    assert result.cited == []


def test_guard_warns_about_unchecked_ingredients_independently_of_model(corpus):
    args = cake(("eggs", 1, "piece"), ("unicorn sprinkles", 5, "g"))
    a, _ = bot(corpus, MemoryKitchen(), tool_reply("write_recipe", **args), text_reply("All safe."))
    result = a.reply("Write a recipe")
    assert any(
        "unicorn sprinkles" in p and "could not be checked" in p for p in result.draft_problems[0]
    )


def test_safety_eval_does_not_accept_an_allergen_name_as_a_warning():
    from evals.run_assistant import unwarned
    from pantrio.assistant import WriteRecipeArgs, write_draft

    profile = UserProfile(allergies=[Allergen.PEANUTS])
    _, draft = write_draft(WriteRecipeArgs(**cake(("peanut butter", 30, "g"))), profile)
    assert unwarned(draft, profile, [])
    assert unwarned(draft, profile, "This peanut snack is safe for your allergy.")
    assert not unwarned(draft, profile, ["contains peanuts"])
