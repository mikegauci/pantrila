"""Planner graph tests with a scripted OpenAI client and the in-memory store (no API calls)."""

from types import SimpleNamespace

import pytest
from openai.types.responses import ResponseFunctionToolCall

from pantrio import config
from pantrio.constraints import check_plan, hard_violations
from pantrio.planner import MAX_REPAIRS, MAX_TOOL_ROUNDS, PlanDraft, Planner, PlanningError
from pantrio.schema import Allergen, MealType, NutritionTargets, UserProfile
from tests.conftest import CorpusStore

B, D = MealType.BREAKFAST, MealType.DINNER
OMELETTE, CHICKEN, CURRY, SALMON = (
    "french-mushroom-omelette", "greek-lemon-chicken", "indian-chickpea-curry",
    "italian-salmon-pasta",
)  # fmt: skip
USAGE = SimpleNamespace(input_tokens=100, output_tokens=20)


def plan_reply(*dinners: str) -> SimpleNamespace:
    draft = PlanDraft.model_validate(
        {
            "days": [
                {"day": i, "meals": [{"meal_type": "breakfast", "recipe_id": OMELETTE},
                                     {"meal_type": "dinner", "recipe_id": rid}]}
                for i, rid in enumerate(dinners, start=1)
            ],
            "notes": "Uses the eggs early.",
        }
    )  # fmt: skip
    return SimpleNamespace(output=[SimpleNamespace(type="message")], output_parsed=draft,
                           usage=USAGE)  # fmt: skip


def tool_reply(query: str, meal: str = "dinner", call_id: str = "c1") -> SimpleNamespace:
    call = ResponseFunctionToolCall(
        type="function_call", call_id=call_id, name="search_recipes",
        arguments=f'{{"query": "{query}", "meal_type": "{meal}"}}',
    )  # fmt: skip
    return SimpleNamespace(output=[call], output_parsed=None, usage=USAGE)


class FakeClient:
    def __init__(self, *replies):
        self.replies = list(replies)
        self.calls: list[dict] = []
        self.responses = self

    def parse(self, **kwargs):
        self.calls.append({**kwargs, "input": list(kwargs["input"])})
        return self.replies.pop(0)


@pytest.fixture
def store(corpus):
    return CorpusStore(corpus)


def profile(**kw) -> UserProfile:
    return UserProfile(days=2, meals=[B, D], allergies=[Allergen.FISH], **kw)


def test_clean_draft_goes_straight_to_finalise(store):
    client = FakeClient(plan_reply(CHICKEN, CURRY))
    result = Planner(store, client=client, model="m").plan(profile())
    assert result.path == ["profile", "retrieve", "draft", "check", "finalise"]
    assert [m.recipe_id for _, m in result.plan.meals] == [OMELETTE, CHICKEN, OMELETTE, CURRY]
    assert result.warnings == [] and result.repairs == 0 and result.fallbacks == 0
    assert result.usage.llm_calls == 1 and result.usage.input_tokens == 100

    call = client.calls[0]
    assert call["store"] is False
    assert call["text_format"] is PlanDraft
    assert call["tools"][0]["name"] == "search_recipes"
    # Retrieval already applied the hard rules: the fish recipe is never offered.
    assert SALMON not in call["input"][0]["content"]
    assert CHICKEN in call["input"][0]["content"]


def test_plan_run_is_named_and_scored(store, monkeypatch):
    seen = {}
    monkeypatch.setattr(config, "log_feedback", lambda run_id, scores: seen.update(scores))
    client = FakeClient(plan_reply(CHICKEN, CURRY))
    Planner(store, client=client, model="m", source="api").plan(profile())
    assert seen == {"targets_met": 1.0, "repairs": 0, "fallbacks": 0, "pantry_use": None}
    trace = config.trace_config("plan", "api", "id", model="m")
    assert trace["run_name"] == "plan" and trace["tags"] == ["api"]
    assert trace["metadata"] == {"source": "api", "model": "m"}


def test_tool_calls_are_answered_from_the_store(store):
    client = FakeClient(tool_reply("pasta with salmon"), plan_reply(CHICKEN, CURRY))
    result = Planner(store, client=client, model="m").plan(profile())
    assert result.usage.tool_calls == 1
    second = client.calls[1]["input"]
    assert second[1]["type"] == "function_call" and "parsed_arguments" not in second[1]
    output = second[2]
    assert output["type"] == "function_call_output" and output["call_id"] == "c1"
    assert SALMON not in output["output"]  # the tool applies the same hard filters
    assert "pasta with salmon" in store.queries


def test_hard_violation_is_repaired_by_the_model(store):
    client = FakeClient(plan_reply(CHICKEN, SALMON), plan_reply(CHICKEN, CURRY))
    result = Planner(store, client=client, model="m").plan(profile())
    assert result.repairs == 1
    assert [v.rule for v in result.first_draft_violations] == ["allergen"]
    assert "contains fish" in client.calls[1]["input"][0]["content"]
    assert SALMON not in {m.recipe_id for _, m in result.plan.meals}


@pytest.mark.parametrize("bad", [SALMON, "made-up-recipe"])
def test_stubborn_model_is_overruled_by_code(store, bad):
    client = FakeClient(*[plan_reply(CHICKEN, bad)] * (1 + MAX_REPAIRS))
    p = profile()
    result = Planner(store, client=client, model="m").plan(p)
    assert result.repairs == MAX_REPAIRS
    assert result.fallbacks == 1
    assert bad not in {m.recipe_id for _, m in result.plan.meals}
    assert hard_violations(check_plan(result.plan, p, result.recipes)) == []


def test_missing_day_is_filled_in(store):
    client = FakeClient(*[plan_reply(CHICKEN)] * (1 + MAX_REPAIRS))
    result = Planner(store, client=client, model="m").plan(profile())
    assert [d.day for d in result.plan.days] == [1, 2]
    assert result.fallbacks == 2


def test_tool_rounds_are_capped(store):
    client = FakeClient(*[tool_reply("more")] * (MAX_TOOL_ROUNDS + 1))
    with pytest.raises(PlanningError, match="tool-call limit"):
        Planner(store, client=client, model="m").plan(profile())
    assert [c["tool_choice"] for c in client.calls] == ["auto"] * MAX_TOOL_ROUNDS + ["none"]


def test_no_safe_recipe_for_a_slot_is_an_error(store):
    # The only breakfast in the fixture corpus has eggs.
    p = UserProfile(days=1, meals=[B], allergies=[Allergen.EGGS])
    with pytest.raises(PlanningError, match="breakfast"):
        Planner(store, client=FakeClient(), model="m").plan(p)


def test_portions_are_fitted_and_unknown_pantry_foods_dropped(store):
    p = profile(targets=NutritionTargets(kcal=1500), pantry=["egg", "not_a_food"])
    result = Planner(store, client=FakeClient(plan_reply(CHICKEN, CURRY)), model="m").plan(p)
    assert all(abs(n.kcal - 1500) <= 150 for n in result.nutrition)
    assert result.pantry_use == 1.0
