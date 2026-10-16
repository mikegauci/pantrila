"""API tests: in-memory backend, scripted OpenAI client, fake token verifier (no API calls)."""

import json
from contextlib import contextmanager
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from openai.types.responses import ResponseFunctionToolCall

from pantrio.api import Session, create_app
from pantrio.auth import AuthError, User
from pantrio.cookbook import MemoryCookbook
from pantrio.pantry import MemoryKitchen
from pantrio.planner import PlanDraft
from pantrio.records import MemoryRecords
from pantrio.schema import MealType
from tests.conftest import CorpusStore

OMELETTE, CHICKEN, CURRY, SALMON, NOODLES = (
    "french-mushroom-omelette", "greek-lemon-chicken", "indian-chickpea-curry",
    "italian-salmon-pasta", "thai-peanut-noodles",
)  # fmt: skip
USAGE = SimpleNamespace(input_tokens=1000, output_tokens=100)


def plan_reply(*dinners: str) -> SimpleNamespace:
    draft = PlanDraft.model_validate(
        {"days": [{"day": i, "meals": [{"meal_type": "breakfast", "recipe_id": OMELETTE},
                                       {"meal_type": "dinner", "recipe_id": rid}]}
                  for i, rid in enumerate(dinners, start=1)],
         "notes": "Uses the eggs early."}
    )  # fmt: skip
    return SimpleNamespace(output=[SimpleNamespace(type="message")], output_parsed=draft,
                           usage=USAGE)  # fmt: skip


def text_reply(text: str) -> SimpleNamespace:
    return SimpleNamespace(output=[SimpleNamespace(type="message")], output_text=text,
                           usage=USAGE)  # fmt: skip


class FakeClient:
    def __init__(self):
        self.replies: list = []
        self.responses = self

    def parse(self, **kwargs):
        return self.replies.pop(0)

    create = parse


class MemoryBackend:
    def __init__(self, corpus):
        self.store = CorpusStore(corpus)
        self.kitchens: dict[str, MemoryKitchen] = {}
        self.shared: dict = {"plans": [], "events": []}
        self.client = FakeClient()

    @contextmanager
    def session(self, user_id):
        kitchen = self.kitchens.setdefault(user_id, MemoryKitchen())
        yield Session(self.store, kitchen, MemoryRecords(user_id, self.shared),
                      MemoryCookbook(user_id, self.shared))  # fmt: skip

    def close(self):
        pass


def verify(token: str) -> User:
    if token not in {"alice", "bob"}:
        raise AuthError("bad signature")
    return User(id=token, email=f"{token}@example.com")


@pytest.fixture
def backend(corpus):
    return MemoryBackend(corpus)


@pytest.fixture
def api(backend, monkeypatch):
    monkeypatch.setenv("PANTRIO_PRICE_INPUT_PER_MTOK", "1")
    monkeypatch.setenv("PANTRIO_PRICE_OUTPUT_PER_MTOK", "10")
    with TestClient(create_app(backend, verify)) as client:
        client.headers["Authorization"] = "Bearer alice"
        yield client


def sse(text: str) -> list[tuple[str, dict]]:
    events = []
    for block in text.strip().split("\n\n"):
        lines = dict(line.split(": ", 1) for line in block.splitlines())
        events.append((lines["event"], json.loads(lines["data"])))
    return events


def test_health_is_public_and_everything_else_needs_a_token(api):
    assert api.get("/health").json() == {"ok": True}
    assert api.get("/me/profile", headers={"Authorization": ""}).status_code == 401
    r = api.get("/me/profile", headers={"Authorization": "Bearer forged"})
    assert r.status_code == 401 and "bad signature" in r.json()["detail"]


def test_profile_round_trip_resolves_excluded_foods(api):
    profile = {"allergies": ["fish"], "diets": [], "exclude_foods": ["mushrooms"],
               "days": 2, "meals": ["breakfast", "dinner"]}  # fmt: skip
    saved = api.put("/me/profile", json=profile).json()
    assert saved["exclude_foods"] == ["mushroom"] and saved["allergies"] == ["fish"]
    assert api.get("/me/profile").json() == saved
    bad = api.put("/me/profile", json={**profile, "exclude_foods": ["unobtainium"]})
    assert bad.status_code == 422


def test_users_do_not_see_each_others_pantry(api):
    assert api.post("/me/pantry", json={"food": "eggs", "quantity": 6, "unit": "piece"}
                    ).status_code == 201  # fmt: skip
    mine = api.get("/me/pantry").json()
    assert [(i["key"], i["quantity"], i["unit"]) for i in mine] == [("egg", 6, "piece")]
    assert mine[0]["grams"] > 0
    assert api.get("/me/pantry", headers={"Authorization": "Bearer bob"}).json() == []

    unknown = api.post("/me/pantry", json={"food": "chikpeas"})
    assert unknown.status_code == 422 and "chickpeas" in unknown.json()["suggestions"]
    assert api.delete("/me/pantry/egg").status_code == 204
    assert api.delete("/me/pantry/egg").status_code == 404


def test_recipe_search_applies_the_profile_unless_asked_not_to(api):
    api.put("/me/profile", json={"allergies": ["peanuts", "fish"]})
    safe = api.get("/recipes", params={"q": "noodles salmon pasta"}).json()
    ids = [r["id"] for r in safe["recipes"]]
    assert NOODLES not in ids and SALMON not in ids and ids
    assert set(safe["rules"]["exclude_allergens"]) == {"peanuts", "fish"}

    everything = api.get("/recipes", params={"safe": "false"}).json()["recipes"]
    flagged = {r["id"]: r["problems"] for r in everything}
    assert flagged[NOODLES] == ["contains peanuts"] and flagged[CHICKEN] == []
    assert [r["title"] for r in everything] == sorted(r["title"] for r in everything)

    breakfast = api.get("/recipes", params={"meal": "breakfast"}).json()["recipes"]
    assert [r["id"] for r in breakfast] == [OMELETTE]


def test_recipe_detail_marks_pantry_ingredients_and_problems(api):
    api.put("/me/profile", json={"allergies": ["eggs"]})
    api.post("/me/pantry", json={"food": "mushroom"})
    r = api.get(f"/recipes/{OMELETTE}").json()
    assert r["problems"] == ["contains eggs"]
    assert {i["food"]: i["in_pantry"] for i in r["ingredients"]}["mushroom"] is True
    assert r["pantry_foods"] == ["mushroom"] and r["steps"]
    assert api.get("/recipes/no-such-recipe").status_code == 404


def test_swaps_are_checked_against_the_profile(api):
    options = api.get(f"/recipes/{SALMON}/swaps", params={"food": "double cream"}).json()
    assert options["food"] == "double_cream"
    assert options["swaps"] and all(s["safe"] for s in options["swaps"])
    # Every dairy-aisle swap for cream contains milk, so none suits a milk allergy.
    api.put("/me/profile", json={"allergies": ["milk"]})
    assert api.get(f"/recipes/{SALMON}/swaps", params={"food": "cream"}).json()["swaps"] == []
    named = api.get(f"/recipes/{SALMON}/swaps",
                    params={"food": "double cream", "replacement": "butter"}).json()  # fmt: skip
    (swap,) = named["swaps"]
    assert swap["safe"] is False and "milk" in swap["problems"][0]
    assert api.get(f"/recipes/{SALMON}/swaps", params={"food": "egg"}).status_code == 422


def test_plan_streams_steps_saves_the_plan_and_logs_usage(api, backend):
    api.put("/me/profile", json={"days": 2, "meals": ["breakfast", "dinner"],
                                 "allergies": ["fish"]})  # fmt: skip
    api.post("/me/pantry", json={"food": "potato", "quantity": 500, "unit": "g"})
    backend.client.replies = [plan_reply(CHICKEN, CURRY)]
    with api.stream("POST", "/plans") as r:
        assert r.headers["content-type"].startswith("text/event-stream")
        events = sse(r.read().decode())
    steps = [d["node"] for kind, d in events if kind == "step"]
    assert steps == ["profile", "retrieve", "draft", "check", "finalise"]
    kind, plan = events[-1]
    assert kind == "plan"
    assert [[m["recipe"]["id"] for m in d["meals"]] for d in plan["days"]] == [
        [OMELETTE, CHICKEN],
        [OMELETTE, CURRY],
    ]
    assert plan["problems"] == [] and plan["report"]["llm_calls"] == 1
    assert plan["report"]["cost_usd"] == pytest.approx(0.002)

    latest = api.get("/plans/latest").json()
    assert latest["id"] == plan["id"]
    usage = api.get("/me/usage").json()
    assert [(e["kind"], e["ok"]) for e in usage["events"]] == [("plan", True)]
    assert usage["limits"]["plans_left"] == usage["limits"]["plans_per_day"] - 1

    grocery = api.get("/plans/latest/grocery", params={"people": 2}).json()
    assert grocery["people"] == 2
    potato = next(i for i in grocery["items"] + grocery["covered"] if i["food"] == "potato")
    assert potato["have_g"] == min(500, potato["need_g"]) > 0

    # A new allergy after planning is shown loudly on the saved plan.
    api.put("/me/profile", json={"days": 2, "meals": ["breakfast", "dinner"],
                                 "allergies": ["fish", "eggs"]})  # fmt: skip
    problems = api.get("/plans/latest").json()["problems"]
    assert {(p["day"], p["meal_type"]) for p in problems} == {(1, "breakfast"), (2, "breakfast")}
    assert api.get("/plans/latest", headers={"Authorization": "Bearer bob"}).status_code == 404


def test_planning_error_is_streamed_and_logged(api, backend):
    api.put("/me/profile", json={"days": 1, "meals": ["snack"]})
    with api.stream("POST", "/plans") as r:
        events = sse(r.read().decode())
    assert events[-1][0] == "error" and "snack" in events[-1][1]["message"]
    assert api.get("/me/usage").json()["events"][0]["ok"] is False


def test_daily_limits(api, backend, monkeypatch):
    monkeypatch.setenv("PANTRIO_DAILY_CHATS", "1")
    backend.client.replies = [text_reply("Fold gently.")]
    assert api.post("/chat", json={"message": "Fluffy omelette?"}).status_code == 200
    r = api.post("/chat", json={"message": "Again?"})
    assert r.status_code == 429

    monkeypatch.setenv("PANTRIO_DAILY_BUDGET_USD", "0.001")
    bob = {"Authorization": "Bearer bob"}
    assert api.post("/chat", json={"message": "Hi"}, headers=bob).status_code == 503
    assert api.post("/plans", headers=bob).status_code == 503


def test_chat_returns_cited_recipes_tools_and_guard_notes(api, backend):
    api.put("/me/profile", json={"allergies": ["fish"]})
    call = ResponseFunctionToolCall(
        type="function_call", call_id="c1", name="update_pantry",
        arguments=json.dumps({"add": [{"food": "eggs", "quantity": None, "unit": None}],
                              "remove": []}),
    )  # fmt: skip
    backend.client.replies = [
        SimpleNamespace(output=[call], output_text="", usage=USAGE),
        text_reply(f"Try [{OMELETTE}] or [{SALMON}]."),
    ]
    r = api.post(
        "/chat",
        json={
            "message": "I bought eggs. Ideas?",
            "history": [
                {"role": "user", "content": "hi"},
                {"role": "assistant", "content": "Hello!"},
            ],
        },
    )
    body = r.json()
    assert [c["id"] for c in body["cited"]] == [OMELETTE, SALMON]
    assert body["flagged"] == [SALMON] and "does not suit you" in body["text"]
    assert body["pantry_changed"] is True
    assert body["tool_calls"][0]["name"] == "update_pantry"
    assert len(body["history"]) == 4
    assert [i["key"] for i in api.get("/me/pantry").json()] == ["egg"]


def test_meta_and_foods(api):
    meta = api.get("/meta").json()
    assert len(meta["allergens"]) == 14 and "italian" in meta["cuisines"]
    assert MealType.BREAKFAST in meta["meal_types"]
    foods = {f["key"]: f for f in api.get("/foods").json()}
    assert foods["red_lentils"]["name"] == "red lentils" and "water" not in foods


TOAST = {
    "title": "Cheese toast", "meal_types": ["breakfast"], "total_minutes": 10, "servings": 1,
    "ingredients": [
        {"name": "bread", "quantity": 2, "unit": "piece", "food": "white_bread"},
        {"name": "butter", "quantity": 10, "unit": "g", "food": "butter"},
    ],
    "steps": ["Toast.", "Butter."],
}  # fmt: skip


def test_cookbook_crud_is_per_user_and_derived_in_code(api):
    api.put("/me/profile", json={"allergies": ["milk"]})
    api.post("/me/pantry", json={"food": "butter"})
    created = api.post("/me/recipes", json=TOAST)
    assert created.status_code == 201
    r = created.json()
    assert r["allergens"] == ["gluten", "milk"] and r["problems"] == ["contains milk"]
    assert r["source"] == "manual" and not r["estimated"] and r["pantry_foods"] == ["butter"]
    assert [i["in_pantry"] for i in r["ingredients"]] == [False, True]
    assert r["nutrition"]["kcal"] > 0 and r["recipe"]["title"] == "Cheese toast"

    assert [c["id"] for c in api.get("/me/recipes").json()] == [r["id"]]
    bob = {"Authorization": "Bearer bob"}
    assert api.get("/me/recipes", headers=bob).json() == []
    assert api.get(f"/me/recipes/{r['id']}", headers=bob).status_code == 404
    assert api.delete(f"/me/recipes/{r['id']}", headers=bob).status_code == 404

    vegan = {**TOAST, "ingredients": TOAST["ingredients"][:1]}
    updated = api.put(f"/me/recipes/{r['id']}", json=vegan).json()
    assert updated["problems"] == [] and "vegan" in updated["diet_tags"]
    assert api.delete(f"/me/recipes/{r['id']}").status_code == 204
    assert api.get(f"/me/recipes/{r['id']}").status_code == 404


def test_cookbook_refuses_lines_it_cannot_derive(api):
    bad = {**TOAST, "ingredients": [{"name": "dragon fruit", "quantity": 1, "unit": "piece"},
                                    {"name": "butter", "quantity": 1, "unit": "piece",
                                     "food": "butter"}]}  # fmt: skip
    r = api.post("/me/recipes", json=bad)
    assert r.status_code == 422
    problems = r.json()["detail"]["problems"]
    assert "pick a food or estimate it" in problems[0] and "pieces" in problems[1]
    assert api.post("/me/recipes/preview", json=bad).status_code == 422
    preview = api.post("/me/recipes/preview", json=TOAST).json()
    assert preview["allergens"] == ["gluten", "milk"] and api.get("/me/recipes").json() == []


def imported_reply() -> SimpleNamespace:
    from pantrio.recipe_import import ImportedRecipe

    parsed = ImportedRecipe.model_validate({
        "is_recipe": True, "title": "Toast", "summary": "", "cuisine": "", "total_minutes": 5,
        "servings": 1, "meal_types": ["breakfast"], "steps": ["Toast."],
        "ingredients": [{"name": "bread", "quantity": 2, "unit": "piece",
                         "food": "white_bread", "estimate": None}],
    })  # fmt: skip
    return SimpleNamespace(output=[], output_parsed=parsed, usage=USAGE)


def test_link_import_returns_a_draft_logs_usage_and_saves_nothing(api, backend, monkeypatch):
    import pantrio.recipe_import as ri

    monkeypatch.setattr(ri, "fetch_page", lambda url, http=None, resolve=None:
                        (url, "<p>Toast: 2 slices of bread</p>"))  # fmt: skip
    backend.client.replies = [imported_reply()]
    r = api.post("/me/recipes/import/link", json={"url": "https://example.com/toast"}).json()
    assert r["draft"]["source"] == "link" and r["draft"]["source_url"].endswith("/toast")
    assert r["draft"]["ingredients"][0]["food"] == "white_bread" and r["notes"] == []
    assert r["cost_usd"] == pytest.approx(0.002)
    assert api.get("/me/recipes").json() == []
    usage = api.get("/me/usage").json()
    assert [e["kind"] for e in usage["events"]] == ["import"]
    assert usage["limits"]["imports_left"] == usage["limits"]["imports_per_day"] - 1


def test_bad_links_fail_before_any_paid_call(api):
    r = api.post("/me/recipes/import/link", json={"url": "http://127.0.0.1/admin"})
    assert r.status_code == 422 and "private" in r.json()["detail"]
    assert api.get("/me/usage").json()["events"] == []


def test_imports_are_capped_per_day(api, backend, monkeypatch):
    monkeypatch.setenv("PANTRIO_DAILY_IMPORTS", "1")
    png = "data:image/png;base64,iVBORw0KGgo="
    backend.client.replies = [imported_reply()]
    assert api.post("/me/recipes/import/photos", json={"images": [png]}).status_code == 200
    r = api.post("/me/recipes/estimate", json={"names": ["gochujang"]})
    assert r.status_code == 429
