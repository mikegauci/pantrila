"""API tests: in-memory backend, scripted OpenAI client, fake token verifier (no API calls)."""

import json
from contextlib import contextmanager
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from openai.types.responses import ResponseFunctionToolCall

from pantrila.api import Session, create_app
from pantrila.auth import AuthError, User
from pantrila.chats import MAX_THREADS_PER_USER, MemoryChats
from pantrila.cookbook import MemoryCookbook
from pantrila.pantry import MemoryKitchen
from pantrila.photos import MemoryPhotos
from pantrila.planner import PlanDraft
from pantrila.records import MemoryRecords
from pantrila.schema import MealType
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


def png_b64(size=(1536, 1152)) -> str:
    import base64
    import io

    from PIL import Image

    out = io.BytesIO()
    Image.new("RGB", size, (200, 120, 60)).save(out, "PNG")
    return base64.b64encode(out.getvalue()).decode()


class FakeClient:
    def __init__(self):
        self.replies: list = []
        self.calls: list[dict] = []
        self.responses = self
        self.images = SimpleNamespace(generate=self.generate_image)
        self.image_calls: list[dict] = []
        self.image_error: Exception | None = None
        self.audio = SimpleNamespace(transcriptions=SimpleNamespace(create=self.transcribe))
        self.transcripts: list[str] = []

    def transcribe(self, **kwargs):
        self.calls.append(kwargs)
        return SimpleNamespace(text=self.transcripts.pop(0))

    def generate_image(self, **kwargs):
        self.image_calls.append(kwargs)
        if self.image_error:
            raise self.image_error
        usage = SimpleNamespace(input_tokens=200, output_tokens=400)
        return SimpleNamespace(data=[SimpleNamespace(b64_json=png_b64())], usage=usage)

    def parse(self, **kwargs):
        self.calls.append(kwargs)
        return self.replies.pop(0)

    create = parse


class MemoryBackend:
    def __init__(self, corpus):
        self.store = CorpusStore(corpus)
        self.kitchens: dict[str, MemoryKitchen] = {}
        self.shared: dict = {"plans": [], "events": []}
        self.client = FakeClient()
        self.photos: MemoryPhotos | None = MemoryPhotos()

    @contextmanager
    def session(self, user_id):
        kitchen = self.kitchens.setdefault(user_id, MemoryKitchen())
        yield Session(self.store, kitchen, MemoryRecords(user_id, self.shared),
                      MemoryCookbook(user_id, self.shared),
                      MemoryChats(user_id, self.shared))  # fmt: skip

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
    monkeypatch.setenv("PANTRILA_PRICE_INPUT_PER_MTOK", "1")
    monkeypatch.setenv("PANTRILA_PRICE_OUTPUT_PER_MTOK", "10")
    monkeypatch.setenv("PANTRILA_MEDIA_SOURCE", "off")  # never the real video service
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


def make_plan(api, backend, allergies=("fish",)) -> dict:
    """Plan two days (omelette, then chicken and curry for dinner) and return the plan."""
    api.put("/me/profile", json={"days": 2, "meals": ["breakfast", "dinner"],
                                 "allergies": list(allergies)})  # fmt: skip
    backend.client.replies = [plan_reply(CHICKEN, CURRY)]
    with api.stream("POST", "/plans") as r:
        events = sse(r.read().decode())
    kind, plan = events[-1]
    assert kind == "plan"
    return plan


def test_a_meal_can_be_swapped_for_a_safe_recipe_and_the_grocery_list_follows(api, backend):
    plan = make_plan(api, backend)
    options = api.get("/plans/latest/meals/1/dinner/options").json()
    assert options["plan_id"] == plan["id"] and options["current"]["recipe"]["id"] == CHICKEN
    ids = {o["recipe"]["id"] for o in options["options"]}
    assert ids == {CURRY, NOODLES}  # the salmon pasta has fish; the chicken is the current meal
    assert all(o["recipe"]["problems"] == [] and o["portions"] > 0 for o in options["options"])
    paid = api.get("/me/usage").json()["events"]

    r = api.put("/plans/latest/meals/1/dinner", json={"plan_id": plan["id"], "recipe_id": NOODLES})
    assert r.status_code == 200
    swapped = r.json()
    assert [m["recipe"]["id"] for m in swapped["days"][0]["meals"]] == [OMELETTE, NOODLES]
    assert swapped["id"] == plan["id"] and swapped["problems"] == []
    assert swapped["report"]["swaps"] == 1
    assert swapped["report"]["cost_usd"] == plan["report"]["cost_usd"]  # planning cost is kept
    assert api.get("/plans/latest").json()["days"][0]["meals"][1]["recipe"]["id"] == NOODLES

    grocery = api.get("/plans/latest/grocery").json()
    foods = {i["food"] for i in grocery["items"] + grocery["covered"]}
    assert "rice_noodles" in foods and "chicken_thigh" not in foods
    assert api.get("/me/usage").json()["events"] == paid  # swapping is not a paid call


def test_a_swap_is_refused_when_unsafe_stale_or_unknown(api, backend):
    plan = make_plan(api, backend)
    url, body = "/plans/latest/meals/1/dinner", {"plan_id": plan["id"], "recipe_id": SALMON}
    unsafe = api.put(url, json=body)
    assert unsafe.status_code == 422
    detail = unsafe.json()["detail"]
    assert detail["message"] == "That recipe does not suit your rules."
    assert detail["problems"] == ["contains fish"]
    assert api.put(url, json={**body, "plan_id": plan["id"] + 1, "recipe_id": CURRY}
                   ).status_code == 409  # fmt: skip
    assert api.put(url, json={**body, "recipe_id": "no-such-recipe"}).status_code == 404
    assert api.put(url, json={**body, "recipe_id": CHICKEN}).status_code == 422
    assert api.put("/plans/latest/meals/1/lunch", json={**body, "recipe_id": CURRY}
                   ).status_code == 404  # fmt: skip
    assert api.put("/plans/latest/meals/1/brunch", json=body).status_code == 422
    assert api.get("/plans/latest/meals/9/dinner/options").status_code == 404
    assert api.get("/plans/latest").json()["days"][0]["meals"][1]["recipe"]["id"] == CHICKEN

    bob = {"Authorization": "Bearer bob"}
    assert api.get("/plans/latest/meals/1/dinner/options", headers=bob).status_code == 404
    assert api.put(url, json=body, headers=bob).status_code == 404


def test_a_swap_replaces_a_meal_that_a_new_allergy_flags(api, backend):
    make_plan(api, backend)
    api.put("/me/profile", json={"days": 2, "meals": ["breakfast", "dinner"],
                                 "allergies": ["fish", "mustard"]})  # fmt: skip
    flagged = api.get("/plans/latest").json()
    assert {(p["day"], p["meal_type"]) for p in flagged["problems"]} == {(2, "dinner")}
    options = api.get("/plans/latest/meals/2/dinner/options").json()["options"]
    assert {o["recipe"]["id"] for o in options} == {CHICKEN, NOODLES}
    r = api.put("/plans/latest/meals/2/dinner",
                json={"plan_id": flagged["id"], "recipe_id": CHICKEN})  # fmt: skip
    assert r.status_code == 200 and r.json()["problems"] == []


def test_meals_can_be_skipped_eaten_out_or_leftovers_and_added_back(api, backend):
    plan = make_plan(api, backend)
    slot = "/plans/latest/meals/{}/{}/slot"
    r = api.put(slot.format(2, "dinner"), json={"plan_id": plan["id"], "kind": "leftovers",
                                                 "from_day": 1, "from_meal": "dinner"})  # fmt: skip
    assert r.status_code == 200
    left = r.json()["days"][1]["meals"][1]
    assert left["kind"] == "leftovers" and left["recipe"]["id"] == CHICKEN
    assert (left["from_day"], left["from_meal"]) == (1, "dinner")
    blocked = api.put(slot.format(1, "dinner"), json={"plan_id": plan["id"], "kind": "skipped"})
    assert blocked.status_code == 422 and "leftovers of this meal" in blocked.json()["detail"]

    r = api.put(slot.format(1, "breakfast"), json={"plan_id": plan["id"], "kind": "eating_out",
                                                    "out_kcal": 700})  # fmt: skip
    day1 = r.json()["days"][0]
    out = day1["meals"][0]
    assert out["kind"] == "eating_out" and out["out_kcal"] == 700
    assert out["recipe"]["id"] == OMELETTE  # kept so it can be added back
    chicken = day1["meals"][1]
    assert day1["nutrition"]["kcal"] == pytest.approx(
        700 + chicken["recipe"]["nutrition"]["kcal"] * chicken["portions"], abs=0.2
    )
    grocery = api.get("/plans/latest/grocery").json()
    foods = {i["food"] for i in grocery["items"] + grocery["covered"]}
    assert "eggs" not in foods and "chicken_thigh" in foods and grocery["unlisted"] == []

    r = api.put(slot.format(1, "breakfast"), json={"plan_id": plan["id"], "kind": "recipe"})
    assert r.json()["days"][0]["meals"][0]["kind"] == "recipe"
    assert r.json()["report"]["swaps"] == 3
    bad = {"plan_id": plan["id"], "kind": "eating_out", "out_kcal": 9000}
    assert api.put(slot.format(1, "breakfast"), json=bad).status_code == 422
    stale = {"plan_id": plan["id"] + 1, "kind": "skipped"}
    assert api.put(slot.format(1, "breakfast"), json=stale).status_code == 409


def test_a_meal_is_repeated_on_later_days_all_or_nothing(api, backend):
    plan = make_plan(api, backend)
    url = "/plans/latest/meals/1/dinner/repeat"
    bad = api.put(url, json={"plan_id": plan["id"], "on": [{"day": 1, "meal_type": "breakfast"}]})
    assert bad.status_code == 422
    assert api.put(url, json={"plan_id": plan["id"], "on": []}).status_code == 422
    r = api.put(url, json={"plan_id": plan["id"], "on": [{"day": 2, "meal_type": "dinner"}]})
    assert r.status_code == 200
    dinner = r.json()["days"][1]["meals"][1]
    assert dinner["kind"] == "leftovers" and dinner["recipe"]["id"] == CHICKEN
    stale = api.put(
        url, json={"plan_id": plan["id"] + 1, "on": [{"day": 2, "meal_type": "dinner"}]}
    )
    assert stale.status_code == 409


def test_the_swap_sheet_pages_searches_and_offers_own_recipes(api, backend):
    plan = make_plan(api, backend)
    url = "/plans/latest/meals/1/dinner/options"
    first = api.get(url, params={"limit": 1}).json()
    assert first["total"] == 2 and len(first["options"]) == 1 and first["offset"] == 0
    second = api.get(url, params={"limit": 1, "offset": 1}).json()
    assert {o["recipe"]["id"] for o in first["options"] + second["options"]} == {CURRY, NOODLES}
    assert "protein_change" in first["options"][0]
    found = api.get(url, params={"q": "peanut"}).json()["options"]
    assert [o["recipe"]["id"] for o in found] == [NOODLES]
    assert api.get(url, params={"limit": 50}).status_code == 422

    own = api.post("/me/recipes", json={**TOAST, "meal_types": ["dinner"]}).json()
    mine = api.get(url, params={"source": "mine"}).json()["options"]
    assert [o["recipe"]["id"] for o in mine] == [f"mine-{own['id']}"]
    r = api.put("/plans/latest/meals/1/dinner",
                json={"plan_id": plan["id"], "recipe_id": f"mine-{own['id']}"})  # fmt: skip
    assert r.status_code == 200
    meal = r.json()["days"][0]["meals"][1]
    assert meal["cookbook_id"] == own["id"] and meal["recipe"]["title"] == "Cheese toast"
    grocery = api.get("/plans/latest/grocery").json()
    assert "white_bread" in {i["food"] for i in grocery["items"] + grocery["covered"]}

    api.put("/me/profile", json={"days": 2, "meals": ["breakfast", "dinner"],
                                 "allergies": ["fish", "milk"]})  # fmt: skip
    flagged = api.get("/plans/latest").json()
    assert {(p["day"], p["meal_type"]) for p in flagged["problems"]} >= {(1, "dinner")}
    assert api.get(url, params={"source": "mine"}).json()["options"] == []
    api.delete(f"/me/recipes/{own['id']}")
    gone = api.get("/plans/latest").json()
    assert any(p["message"] == "is no longer in your recipes" for p in gone["problems"])


def test_planning_error_is_streamed_and_logged(api, backend):
    api.put("/me/profile", json={"days": 1, "meals": ["snack"]})
    with api.stream("POST", "/plans") as r:
        events = sse(r.read().decode())
    assert events[-1][0] == "error" and "snack" in events[-1][1]["message"]
    assert api.get("/me/usage").json()["events"][0]["ok"] is False


def test_daily_limits(api, backend, monkeypatch):
    monkeypatch.setenv("PANTRILA_DAILY_CHATS", "1")
    backend.client.replies = [text_reply("Fold gently.")]
    assert api.post("/chat", json={"message": "Fluffy omelette?"}).status_code == 200
    r = api.post("/chat", json={"message": "Again?"})
    assert r.status_code == 429

    monkeypatch.setenv("PANTRILA_DAILY_BUDGET_USD", "0.001")
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
    body = api.post("/chat", json={"message": "I bought eggs. Ideas?"}).json()
    assert [c["id"] for c in body["cited"]] == [OMELETTE, SALMON]
    assert body["flagged"] == [SALMON] and "does not suit you" in body["text"]
    assert body["pantry_changed"] is True
    assert body["tool_calls"][0]["name"] == "update_pantry"
    assert [i["key"] for i in api.get("/me/pantry").json()] == ["egg"]
    thread = api.get(f"/me/chats/{body['thread_id']}").json()
    assert thread["title"] == "I bought eggs. Ideas?"
    assert [(m["role"], m["text"]) for m in thread["messages"]] == [
        ("user", "I bought eggs. Ideas?"), ("assistant", body["text"])]  # fmt: skip
    assert thread["messages"][1]["reply"]["flagged"] == [SALMON]


def test_chat_returns_recipe_drafts_and_old_messages_still_load(api, backend):
    cake = {"title": "Chocolate Cake", "summary": "", "cuisine": "", "meal_types": ["snack"],
            "total_minutes": 60, "servings": 8, "steps": ["Mix.", "Bake."],
            "ingredients": [{"name": "plain flour", "quantity": 200, "unit": "g"},
                            {"name": "eggs", "quantity": 3, "unit": "piece"}]}  # fmt: skip
    call = ResponseFunctionToolCall(type="function_call", call_id="c1", name="write_recipe",
                                    arguments=json.dumps(cake))  # fmt: skip
    backend.client.replies = [SimpleNamespace(output=[call], output_text="", usage=USAGE),
                              text_reply("Here is a cake.")]  # fmt: skip
    body = api.post("/chat", json={"message": "Chocolate cake recipe?"}).json()
    [draft] = body["drafts"]
    assert draft["title"] == "Chocolate Cake" and draft["source"] == "manual"
    assert [x["food"] for x in draft["ingredients"]] == ["plain_flour", "egg"]
    saved = api.get(f"/me/chats/{body['thread_id']}").json()["messages"][1]["reply"]
    assert saved["drafts"] == body["drafts"]
    assert api.post("/me/recipes", json=draft).status_code in (200, 201)
    api.put("/me/profile", json={"allergies": ["eggs"]})
    refreshed = api.get(f"/me/chats/{body['thread_id']}").json()["messages"][1]["reply"]
    assert "contains eggs" in refreshed["draft_problems"][0]

    old = {k: v for k, v in body.items() if k != "drafts"}  # saved before replies had drafts
    chats = MemoryChats("alice", backend.shared)
    tid = chats.create("Old", [{"role": "assistant", "text": "Hi", "reply": old}], []).id
    assert api.get(f"/me/chats/{tid}").json()["messages"][0]["reply"]["drafts"] == []


def model_inputs(call: dict) -> list[tuple[str, str]]:
    return [(i["role"], i["content"]) for i in call["input"] if isinstance(i, dict) and "role" in i]


def test_chat_threads_keep_their_own_context(api, backend):
    backend.client.replies = [text_reply("Pasta it is."), text_reply("Soup it is."),
                              text_reply("Add basil.")]  # fmt: skip
    pasta = api.post("/chat", json={"message": "Pasta tonight?"}).json()["thread_id"]
    soup = api.post("/chat", json={"message": "Soup tonight?"}).json()["thread_id"]
    assert pasta != soup
    assert ("user", "Pasta tonight?") not in model_inputs(backend.client.calls[1])

    again = api.post("/chat", json={"message": "Any herb?", "thread_id": pasta}).json()
    assert again["thread_id"] == pasta
    seen = model_inputs(backend.client.calls[2])
    assert ("user", "Pasta tonight?") in seen and ("assistant", "Pasta it is.") in seen
    assert ("user", "Soup tonight?") not in seen

    listed = api.get("/me/chats").json()
    assert [(t["id"], t["messages"]) for t in listed] == [(pasta, 4), (soup, 2)]

    bob = {"Authorization": "Bearer bob"}
    assert api.get("/me/chats", headers=bob).json() == []
    assert api.get(f"/me/chats/{pasta}", headers=bob).status_code == 404
    r = api.post("/chat", json={"message": "Hi", "thread_id": pasta}, headers=bob)
    assert r.status_code == 404 and backend.client.calls[3:] == []
    assert api.delete(f"/me/chats/{pasta}", headers=bob).status_code == 404

    assert api.delete(f"/me/chats/{pasta}").status_code == 204
    assert [t["id"] for t in api.get("/me/chats").json()] == [soup]
    assert api.get(f"/me/chats/{pasta}").status_code == 404


def test_failed_chat_saves_no_thread(api, backend):
    backend.client.replies = []  # the scripted client runs dry: the model call fails
    assert api.post("/chat", json={"message": "Hi"}).status_code == 502
    assert api.get("/me/chats").json() == []


def test_chat_threads_drop_the_least_recently_used_past_the_cap():
    chats = MemoryChats("alice")
    ids = [chats.create(f"t{n}", [], []).id for n in range(MAX_THREADS_PER_USER)]
    chats.append(ids[0], [{"role": "user", "text": "still here"}], [])
    chats.create("one more", [], [])
    kept = {t.id for t in chats.list()}
    assert len(kept) == MAX_THREADS_PER_USER and ids[0] in kept and ids[1] not in kept


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
    from pantrila.recipe_import import ImportedRecipe

    parsed = ImportedRecipe.model_validate({
        "is_recipe": True, "title": "Toast", "summary": "", "cuisine": "", "total_minutes": 5,
        "servings": 1, "meal_types": ["breakfast"], "steps": ["Toast."],
        "ingredients": [{"name": "bread", "quantity": 2, "unit": "piece",
                         "food": "white_bread", "estimate": None}],
    })  # fmt: skip
    return SimpleNamespace(output=[], output_parsed=parsed, usage=USAGE)


def test_link_import_returns_a_draft_logs_usage_and_saves_nothing(api, backend, monkeypatch):
    import pantrila.recipe_import as ri

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


def wait_for_job(api, job_id: str) -> dict:
    import time

    for _ in range(200):
        job = api.get(f"/me/recipes/import/jobs/{job_id}").json()
        if job["status"] != "running":
            return job
        time.sleep(0.05)
    raise AssertionError("the import never finished")


def test_background_import_finishes_without_the_request_that_started_it(api, backend, monkeypatch):
    import pantrila.recipe_import as ri

    monkeypatch.setattr(ri, "fetch_page", lambda url, http=None, resolve=None:
                        (url, "<p>Toast: 2 slices of bread</p>"))  # fmt: skip
    backend.client.replies = [imported_reply()]
    started = api.post("/me/recipes/import/jobs",
                       json={"kind": "link", "url": "https://example.com/toast"})  # fmt: skip
    assert started.status_code == 202 and started.json()["status"] in ("running", "done")
    job = wait_for_job(api, started.json()["id"])
    assert job["status"] == "done" and job["error"] is None
    assert job["result"]["draft"]["ingredients"][0]["food"] == "white_bread"
    # The page lists what the import did, in plain words.
    assert job["steps"] == [
        {"key": "page", "label": "Opening the recipe page"},
        {"key": "recipe", "label": "Reading the recipe"},
        {"key": "ingredients", "label": "Matching ingredients to nutrition data"},
    ]
    assert [e["kind"] for e in api.get("/me/usage").json()["events"]] == ["import"]
    assert api.get("/me/recipes").json() == []


def test_background_import_reports_a_failure_and_keeps_the_http_status(api):
    started = api.post("/me/recipes/import/jobs",
                       json={"kind": "link", "url": "http://127.0.0.1/admin"})  # fmt: skip
    job = wait_for_job(api, started.json()["id"])
    assert job["status"] == "failed" and job["result"] is None
    assert job["error"]["status"] == 422 and "private" in job["error"]["message"]


def test_background_import_needs_input_and_unknown_jobs_are_404(api):
    for body in ({"kind": "link"}, {"kind": "post"}, {"kind": "text", "text": "short"},
                 {"kind": "photos", "images": []}, {"kind": "video"}):  # fmt: skip
        assert api.post("/me/recipes/import/jobs", json=body).status_code == 422
    assert api.get("/me/usage").json()["events"] == []
    missing = api.get("/me/recipes/import/jobs/nope")
    assert missing.status_code == 404 and "interrupted" in missing.json()["detail"]


def test_background_import_checks_the_daily_cap_when_it_starts(api, backend, monkeypatch):
    import pantrila.recipe_import as ri

    monkeypatch.setenv("PANTRILA_DAILY_IMPORTS", "1")
    monkeypatch.setattr(ri, "fetch_page", lambda url, http=None, resolve=None:
                        (url, "<p>Toast: 2 slices of bread</p>"))  # fmt: skip
    backend.client.replies = [imported_reply()]
    body = {"kind": "link", "url": "https://example.com/toast"}
    first = api.post("/me/recipes/import/jobs", json=body)
    assert first.status_code == 202
    assert wait_for_job(api, first.json()["id"])["status"] == "done"
    assert api.post("/me/recipes/import/jobs", json=body).status_code == 429


def test_sending_the_same_job_id_again_does_not_start_or_charge_twice(api, backend, monkeypatch):
    import pantrila.recipe_import as ri

    monkeypatch.setattr(ri, "fetch_page", lambda url, http=None, resolve=None:
                        (url, "<p>Toast: 2 slices of bread</p>"))  # fmt: skip
    backend.client.replies = [imported_reply()]
    body = {"id": "a" * 32, "kind": "link", "url": "https://example.com/toast"}
    assert api.post("/me/recipes/import/jobs", json=body).json()["id"] == "a" * 32
    assert api.post("/me/recipes/import/jobs", json=body).json()["id"] == "a" * 32
    assert wait_for_job(api, "a" * 32)["status"] == "done"
    assert [e["kind"] for e in api.get("/me/usage").json()["events"]] == ["import"]
    assert api.post("/me/recipes/import/jobs", json={**body, "id": "not-an-id"}).status_code == 422


def test_two_background_imports_at_a_time(api, monkeypatch):
    import threading

    import pantrila.recipe_import as ri

    gate = threading.Event()

    def slow_fetch(url, http=None, resolve=None):
        gate.wait(5)
        return url, "<p>Toast: 2 slices of bread</p>"

    monkeypatch.setattr(ri, "fetch_page", slow_fetch)
    body = {"kind": "link", "url": "https://example.com/toast"}
    try:
        assert api.post("/me/recipes/import/jobs", json=body).status_code == 202
        assert api.post("/me/recipes/import/jobs", json=body).status_code == 202
        assert api.post("/me/recipes/import/jobs", json=body).status_code == 429
    finally:
        gate.set()


def test_bad_links_fail_before_any_paid_call(api):
    r = api.post("/me/recipes/import/link", json={"url": "http://127.0.0.1/admin"})
    assert r.status_code == 422 and "private" in r.json()["detail"]
    assert api.get("/me/usage").json()["events"] == []


def test_post_import_reads_the_caption_and_keeps_the_credit(api, backend, monkeypatch):
    import pantrila.recipe_import as ri

    post = "https://www.tiktok.com/@toastqueen/video/7300000000000000001"
    oembed = json.dumps({"title": "Toast 🍞 2 slices of bread #breakfast",
                         "author_unique_id": "toastqueen"})  # fmt: skip
    monkeypatch.setattr(ri, "fetch_page", lambda url, http=None, resolve=None, kinds=None:
                        (url, oembed))  # fmt: skip
    backend.client.replies = [imported_reply()]
    r = api.post("/me/recipes/import/post", json={"url": post + "?_t=x"}).json()
    d = r["draft"]
    assert (d["source"], d["source_url"], d["source_platform"], d["source_author"]) == (
        "post", post, "tiktok", "toastqueen")  # fmt: skip
    assert [e["kind"] for e in api.get("/me/usage").json()["events"]] == ["import"]

    saved = api.post("/me/recipes", json=d).json()
    assert saved["source_author"] == "toastqueen" and saved["source_platform"] == "tiktok"
    assert saved["recipe"]["source_url"] == post


def test_post_and_text_imports_need_something_to_read(api):
    assert api.post("/me/recipes/import/post", json={}).status_code == 422
    assert api.post("/me/recipes/import/post", json={"url": " ", "caption": ""}).status_code == 422
    assert api.post("/me/recipes/import/text", json={"text": ""}).status_code == 422
    assert api.get("/me/usage").json()["events"] == []


def test_text_import_and_bad_handles(api, backend):
    backend.client.replies = [imported_reply()]
    r = api.post("/me/recipes/import/text", json={"text": "Toast: 2 slices of bread, toast."})
    assert r.json()["draft"]["source"] == "text"
    bad = {**TOAST, "source": "post", "source_author": "not a handle"}
    assert api.post("/me/recipes", json=bad).status_code == 422
    ok = api.post("/me/recipes", json={**TOAST, "source": "post", "source_author": "@sam.c"})
    assert ok.json()["source_author"] == "sam.c"


def test_post_imports_share_the_daily_import_cap(api, backend, monkeypatch):
    monkeypatch.setenv("PANTRILA_DAILY_IMPORTS", "1")
    backend.client.replies = [imported_reply()]
    toast = {"caption": "Toast: 2 slices bread"}
    assert api.post("/me/recipes/import/post", json=toast).status_code == 200
    assert api.post("/me/recipes/import/post", json={"caption": "Toast"}).status_code == 429
    assert api.post("/me/recipes/import/text", json={"text": "Toast: 2 slices"}).status_code == 429


def test_video_upload_endpoint_is_removed(api):
    assert api.post("/me/recipes/import/video", json={}).status_code == 404


def test_imports_are_capped_per_day(api, backend, monkeypatch):
    monkeypatch.setenv("PANTRILA_DAILY_IMPORTS", "1")
    png = "data:image/png;base64,iVBORw0KGgo="
    backend.client.replies = [imported_reply()]
    assert api.post("/me/recipes/import/photos", json={"images": [png]}).status_code == 200
    r = api.post("/me/recipes/estimate", json={"names": ["gochujang"]})
    assert r.status_code == 429


# --- Photos ---


@pytest.fixture
def photo_env(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("PANTRILA_PRICE_IMAGE_INPUT_PER_MTOK", "5")
    monkeypatch.setenv("PANTRILA_PRICE_IMAGE_OUTPUT_PER_MTOK", "30")


def test_corpus_recipes_carry_their_photo_url(api, backend, photo_env):
    backend.store.photo_paths[CURRY] = f"recipes/{CURRY}-abc.webp"
    url = f"https://example.supabase.co/storage/v1/object/public/recipe-photos/recipes/{CURRY}-abc.webp"
    assert api.get(f"/recipes/{CURRY}").json()["photo_url"] == url
    cards = {c["id"]: c for c in api.get("/recipes", params={"safe": "false", "limit": 60})
             .json()["recipes"]}  # fmt: skip
    assert cards[CURRY]["photo_url"] == url and cards[OMELETTE]["photo_url"] is None


def test_saved_copy_of_a_corpus_recipe_gets_its_photo(api, backend, photo_env):
    src = f"recipes/{CURRY}-abc.webp"
    backend.store.photo_paths[CURRY] = src
    backend.photos.files[src] = b"RIFFcurry"
    rid = api.post("/me/recipes", json=TOAST).json()["id"]
    done = api.post(f"/me/recipes/{rid}/photo/from/{CURRY}")
    assert done.status_code == 200 and "/user-recipes/alice/" in done.json()["photo_url"]
    assert sorted(backend.photos.files.values()) == [b"RIFFcurry", b"RIFFcurry"]
    assert api.delete(f"/me/recipes/{rid}").status_code == 204
    assert list(backend.photos.files) == [src]  # the corpus photo stays
    # a recipe without a photo is fine: nothing to copy
    rid = api.post("/me/recipes", json=TOAST).json()["id"]
    assert api.post(f"/me/recipes/{rid}/photo/from/{OMELETTE}").json()["photo_url"] is None


def test_cookbook_photo_is_generated_stored_replaced_and_deleted(api, backend, photo_env):
    rid = api.post("/me/recipes", json=TOAST).json()["id"]
    first = api.post(f"/me/recipes/{rid}/photo")
    assert first.status_code == 200
    url = first.json()["photo_url"]
    assert url.startswith("https://example.supabase.co/storage/v1/object/public/recipe-photos/"
                          "user-recipes/alice/") and url.endswith(".webp")  # fmt: skip
    (path,) = backend.photos.files
    assert backend.photos.files[path][:4] == b"RIFF"  # WebP

    call = backend.client.image_calls[0]
    assert call["size"] == "1536x1152" and "Ingredients: bread, butter." in call["prompt"]
    assert "Final step: Butter." in call["prompt"]

    usage = api.get("/me/usage").json()
    event = usage["events"][0]
    assert event["kind"] == "photo" and event["cost_usd"] == pytest.approx(0.013)
    assert usage["limits"]["photos_left"] == usage["limits"]["photos_per_day"] - 1
    assert api.get("/me/recipes").json()[0]["photo_url"] == url

    second = api.post(f"/me/recipes/{rid}/photo").json()["photo_url"]
    assert second != url and len(backend.photos.files) == 1  # the old file is gone

    bob = {"Authorization": "Bearer bob"}
    assert api.post(f"/me/recipes/{rid}/photo", headers=bob).status_code == 404
    assert api.delete(f"/me/recipes/{rid}").status_code == 204
    assert backend.photos.files == {}


def test_cookbook_photo_can_be_removed(api, backend, photo_env):
    rid = api.post("/me/recipes", json=TOAST).json()["id"]
    api.post(f"/me/recipes/{rid}/photo")
    r = api.delete(f"/me/recipes/{rid}/photo")
    assert r.status_code == 200 and r.json()["photo_url"] is None and backend.photos.files == {}


def test_cookbook_photos_are_capped_and_failures_logged(api, backend, photo_env, monkeypatch):
    import openai

    monkeypatch.setenv("PANTRILA_DAILY_PHOTOS", "2")
    rid = api.post("/me/recipes", json=TOAST).json()["id"]
    backend.client.image_error = openai.APIConnectionError(request=None)
    r = api.post(f"/me/recipes/{rid}/photo")
    assert r.status_code == 502 and "could not reach" in r.json()["detail"]
    assert api.get("/me/usage").json()["events"][0]["ok"] is False
    backend.client.image_error = None
    assert api.post(f"/me/recipes/{rid}/photo").status_code == 200
    assert api.post(f"/me/recipes/{rid}/photo").status_code == 429


def test_cookbook_photos_need_storage(api, backend):
    backend.photos = None
    rid = api.post("/me/recipes", json=TOAST).json()["id"]
    assert api.post(f"/me/recipes/{rid}/photo").status_code == 503
    assert backend.client.image_calls == []


# --- Profile picture ---


def avatar_data_url(size=(900, 400)) -> str:
    return f"data:image/png;base64,{png_b64(size)}"


def test_avatar_is_stored_as_a_square_replaced_and_removed(api, backend, photo_env):
    from io import BytesIO

    from PIL import Image

    assert api.get("/me").json()["avatar_url"] is None
    first = api.put("/me/avatar", json={"image": avatar_data_url()})
    assert first.status_code == 200
    url = first.json()["avatar_url"]
    assert url.startswith("https://example.supabase.co/storage/v1/object/public/recipe-photos/"
                          "avatars/alice/") and url.endswith(".webp")  # fmt: skip
    (path,) = backend.photos.files
    with Image.open(BytesIO(backend.photos.files[path])) as img:
        assert img.format == "WEBP" and img.size == (256, 256)
    assert api.get("/me").json()["avatar_url"] == url
    assert api.get("/me", headers={"Authorization": "Bearer bob"}).json()["avatar_url"] is None

    second = api.put("/me/avatar", json={"image": avatar_data_url()}).json()["avatar_url"]
    assert second != url and len(backend.photos.files) == 1  # the old file is gone

    gone = api.delete("/me/avatar")
    assert gone.status_code == 200 and gone.json()["avatar_url"] is None
    assert backend.photos.files == {}


def test_avatar_rejects_bad_files_and_needs_storage(api, backend, photo_env):
    assert api.put("/me/avatar", json={"image": "data:image/png;base64,AAAA"}).status_code == 422
    assert api.put("/me/avatar", json={"image": "data:text/html;base64,AAAA"}).status_code == 422
    assert backend.photos.files == {}
    backend.photos = None
    assert api.put("/me/avatar", json={"image": avatar_data_url()}).status_code == 503


def test_concurrent_chat_requests_cannot_share_the_last_allowance(api, backend, monkeypatch):
    import threading
    from concurrent.futures import ThreadPoolExecutor

    monkeypatch.setenv("PANTRILA_DAILY_CHATS", "1")
    entered, release = threading.Event(), threading.Event()

    def respond(**kwargs):
        entered.set()
        assert release.wait(5)
        return text_reply("Hello")

    backend.client.create = respond
    with ThreadPoolExecutor(max_workers=1) as pool:
        first = pool.submit(api.post, "/chat", json={"message": "Hi"})
        try:
            assert entered.wait(5)
            assert api.post("/chat", json={"message": "Hi again"}).status_code == 429
            assert api.get("/me").json()["limits"]["chats_left"] == 0
        finally:
            release.set()
        assert first.result().status_code == 200
    assert len(backend.shared["events"]) == 1
    assert backend.shared["reservations"] == {}


def test_search_is_metered_and_budget_checked(api, backend, monkeypatch):
    monkeypatch.setenv("PANTRILA_DAILY_SEARCHES", "1")
    assert api.get("/recipes", params={"q": "eggs"}).status_code == 200
    assert api.get("/recipes", params={"q": "eggs"}).status_code == 429
    assert api.get("/recipes").status_code == 200  # browsing has no embedding call
    assert api.get("/me/usage").json()["events"][0]["kind"] == "search"
    monkeypatch.setenv("PANTRILA_DAILY_BUDGET_USD", "0.0001")
    assert api.get("/recipes?q=salmon", headers={"Authorization": "Bearer bob"}).status_code == 503


def test_unexpected_plan_failure_records_partial_usage(api, backend, monkeypatch):
    from pantrila.planner import Usage

    def failed(self, profile, on_step=None):
        self.usage = Usage(llm_calls=1, input_tokens=1000, output_tokens=100, embed_tokens=20)
        raise RuntimeError("failure after a successful paid call")

    monkeypatch.setattr("pantrila.api.Planner.plan", failed)
    events = sse(api.post("/plans").text)
    assert events[-1][0] == "error"
    event = api.get("/me/usage").json()["events"][0]
    assert event["ok"] is False and event["input_tokens"] == 1000
    assert event["cost_usd"] > 0
    assert backend.shared["reservations"] == {}


def test_saved_chat_citations_are_rechecked_after_profile_change(api, backend):
    backend.client.replies = [text_reply(f"Try these noodles [{NOODLES}].")]
    reply = api.post("/chat", json={"message": "Noodles?"}).json()
    assert reply["cited"][0]["problems"] == []
    api.put("/me/profile", json={"allergies": ["peanuts"]})
    loaded = api.get(f"/me/chats/{reply['thread_id']}").json()["messages"][-1]["reply"]
    assert loaded["cited"][0]["problems"] == ["contains peanuts"]
    assert loaded["flagged"] == [NOODLES]
    assert "contains peanuts" in loaded["profile_problems"][0]
    # Removing an allergy refreshes the card as well; historical prose remains historical.
    api.put("/me/profile", json={})
    loaded = api.get(f"/me/chats/{reply['thread_id']}").json()["messages"][-1]["reply"]
    assert loaded["profile_problems"] == [] and loaded["cited"][0]["problems"] == []


def test_profile_inputs_have_server_side_bounds(api):
    assert api.put("/me/profile", json={"notes": "a" * 301}).status_code == 422
    assert api.put("/me/profile", json={"meals": ["dinner"] * 6}).status_code == 422


def test_concurrent_turns_report_a_conflict_instead_of_losing_history(api, backend):
    import threading
    from concurrent.futures import ThreadPoolExecutor

    backend.client.replies = [text_reply("First answer")]
    tid = api.post("/chat", json={"message": "Start"}).json()["thread_id"]
    barrier = threading.Barrier(2)

    def respond(**kwargs):
        barrier.wait(timeout=5)
        return text_reply("Concurrent answer")

    backend.client.create = respond
    with ThreadPoolExecutor(max_workers=2) as pool:
        requests = list(
            pool.map(
                lambda text: api.post("/chat", json={"message": text, "thread_id": tid}),
                ["One", "Two"],
            )
        )
    assert sorted(r.status_code for r in requests) == [200, 409]
    messages = api.get(f"/me/chats/{tid}").json()["messages"]
    assert len(messages) == 4
    assert messages[2]["text"] in ("One", "Two")


def test_i_cooked_this_logs_and_takes_what_was_used_out_of_the_pantry(api):
    api.post("/me/pantry", json={"food": "eggs", "quantity": 6, "unit": "piece"})
    api.post("/me/pantry", json={"food": "butter", "quantity": 15, "unit": "g"})
    api.post("/me/pantry", json={"food": "thyme"})
    body = {"recipe_id": OMELETTE, "servings": 1}
    preview = api.post("/me/cooked/preview", json=body).json()
    assert preview["cooked"] is None
    assert [(c["food"], c["unit"], c["before"], c["after"]) for c in preview["pantry"]] == [
        ("butter", "g", 15, 5), ("egg", "piece", 6, 3)]  # fmt: skip
    assert len(api.get("/me/pantry").json()) == 3 and api.get("/me/cooked").json() == []

    done = api.post("/me/cooked", json={**body, "servings": 2})
    assert done.status_code == 201
    cooked = done.json()["cooked"]
    assert (cooked["recipe_id"], cooked["title"], cooked["servings"], cooked["pantry_updated"]
            ) == (OMELETTE, "Mushroom Omelette", 2, True)  # fmt: skip
    pantry = {i["key"]: i["quantity"] for i in api.get("/me/pantry").json()}
    assert pantry == {"thyme": None}  # 6 eggs and 15 g butter used up by two omelettes
    assert [c["id"] for c in api.get("/me/cooked").json()] == [cooked["id"]]
    assert api.get("/me/cooked", headers={"Authorization": "Bearer bob"}).json() == []


def test_i_cooked_this_can_leave_the_pantry_alone_and_works_for_the_cookbook(api):
    api.post("/me/pantry", json={"food": "butter", "quantity": 50, "unit": "g"})
    toast = api.post("/me/recipes", json=TOAST).json()
    r = api.post("/me/cooked", json={"cookbook_id": toast["id"], "servings": 2,
                                     "update_pantry": False}).json()  # fmt: skip
    assert r["cooked"]["cookbook_id"] == toast["id"] and not r["cooked"]["pantry_updated"]
    assert [(c["food"], c["after"]) for c in r["pantry"]] == [("butter", 30)]
    assert api.get("/me/pantry").json()[0]["quantity"] == 50

    bob = {"Authorization": "Bearer bob"}
    assert api.post("/me/cooked", json={"cookbook_id": toast["id"], "servings": 1},
                    headers=bob).status_code == 404  # fmt: skip
    assert api.post("/me/cooked", json={"recipe_id": "nope", "servings": 1}).status_code == 404
    both = {"recipe_id": OMELETTE, "cookbook_id": toast["id"], "servings": 1}
    assert api.post("/me/cooked", json=both).status_code == 422
    assert api.post("/me/cooked", json={"recipe_id": OMELETTE, "servings": 0}).status_code == 422


@pytest.mark.parametrize("replacement", [None, "olive_oil"])
def test_dessert_swap_api_rejects_suggestions_and_direct_calls(api, backend, replacement):
    recipe = backend.store.recipes[OMELETTE]
    backend.store.recipes[OMELETTE] = recipe.model_copy(update={"meal_types": [MealType.DESSERT]})
    params = {"food": "butter"}
    if replacement:
        params["replacement"] = replacement
    response = api.get(f"/recipes/{OMELETTE}/swaps", params=params)
    assert response.status_code == 422
    assert "Automatic dessert swaps are unavailable" in response.json()["detail"]


def test_post_import_hears_the_reel_under_its_own_daily_cap(backend, monkeypatch):
    from pantrila import post_media
    from tests.test_post_media import CAPTION, MP4, FakeMedia, caption_only, heard

    monkeypatch.setenv("PANTRILA_PRICE_INPUT_PER_MTOK", "1")
    monkeypatch.setenv("PANTRILA_PRICE_OUTPUT_PER_MTOK", "10")
    monkeypatch.setenv("PANTRILA_PRICE_TRANSCRIBE_PER_MIN", "0.003")
    monkeypatch.setenv("PANTRILA_DAILY_REEL_FETCHES", "1")
    monkeypatch.setattr(post_media, "fetch_video", lambda url, *args: MP4)
    media = FakeMedia()
    reply = lambda parsed: SimpleNamespace(output=[], output_parsed=parsed, usage=USAGE)  # noqa: E731
    backend.client.replies = [reply(caption_only()), reply(heard()), reply(caption_only())]
    backend.client.transcripts = ["Brown the sausage, then layer and bake."]
    reel = "https://www.instagram.com/reel/Dclv5Rgizvm/"
    with TestClient(create_app(backend, verify, media)) as api:
        api.headers["Authorization"] = "Bearer alice"
        body = api.post("/me/recipes/import/post", json={"url": reel, "caption": CAPTION}).json()
        assert body["draft"]["steps"] == ["Brown the sausage.", "Layer and bake."]
        assert body["media_cost_usd"] == pytest.approx(0.003)
        assert body["cost_usd"] == pytest.approx(
            0.004 + body["transcription_cost_usd"] + 0.003
        )  # two reads, sound and the service
        events = api.get("/me/usage").json()["events"]
        assert sorted(e["kind"] for e in events) == ["import", "reel"]
        assert next(e for e in events if e["kind"] == "reel")["cost_usd"] == pytest.approx(0.003)

        again = api.post("/me/recipes/import/post", json={"url": reel, "caption": CAPTION}).json()
        assert media.asked == [reel]  # today's one video read is used: caption only
        assert again["media_cost_usd"] == 0 and "add the steps" in " ".join(again["notes"])


def test_estimated_amounts_survive_preview_save_read_and_edit(api):
    recipe = {
        **TOAST,
        "ingredients": [
            {**TOAST["ingredients"][0], "amount_estimate": "Typical two-slice serving."},
            TOAST["ingredients"][1],
        ],
    }
    preview = api.post("/me/recipes/preview", json=recipe)
    assert preview.status_code == 200 and preview.json()["estimated"]
    created = api.post("/me/recipes", json=recipe)
    assert created.status_code == 201
    saved = api.get(f"/me/recipes/{created.json()['id']}").json()
    assert saved["estimated"] and saved["nutrition"]["kcal"] > 0
    assert saved["ingredients"][0]["amount_estimate"] == "Typical two-slice serving."
    assert saved["recipe"]["ingredients"][0]["amount_estimate"]
    assert saved["allergens"] == ["gluten", "milk"]
    recipe["ingredients"][0]["amount_estimate"] = None
    updated = api.put(f"/me/recipes/{saved['id']}", json=recipe).json()
    assert not updated["estimated"]


def test_import_repairs_amounts_under_one_quota_and_accounts_for_both_calls(api, backend):
    from pantrila.recipe_import import AmountRepairs, ImportedRecipe

    recipe = imported_reply().output_parsed.model_dump()
    recipe["ingredients"] = [
        {"name": "1 sprig basil", "food": "basil", "quantity": 1, "unit": "piece", "estimate": None}
    ]
    backend.client.replies = [
        SimpleNamespace(output=[], output_parsed=ImportedRecipe(**recipe), usage=USAGE),
        SimpleNamespace(
            output=[],
            output_parsed=AmountRepairs(
                ingredients=[
                    {"index": 0, "grams": 2, "reason": "Typical basil sprig."},
                ]
            ),
            usage=USAGE,
        ),
    ]
    response = api.post("/me/recipes/import/text", json={"text": "1 sprig basil. Add to sauce."})
    assert response.status_code == 200
    result = response.json()
    assert result["cost_usd"] == pytest.approx(0.004)
    assert result["draft"]["ingredients"][0]["amount_estimate"] == "Typical basil sprig."
    assert api.post("/me/recipes", json=result["draft"]).status_code == 201
    events = api.get("/me/usage").json()["events"]
    assert len(events) == 1 and events[0]["kind"] == "import"


def test_import_timing_is_scoped_to_the_user_and_costs_no_allowance(api, backend):
    from datetime import UTC, datetime, timedelta

    from pantrila.records import UsageEvent

    now = datetime.now(UTC)
    with backend.session("alice") as session:
        session.records.log(
            UsageEvent(kind="import", model="test", latency_ms=60000, created_at=now)
        )
        session.records.log(
            UsageEvent(
                kind="reel", model="test", latency_ms=5000, created_at=now - timedelta(seconds=30)
            )
        )
    assert api.get("/me/recipes/import/timing").json() == {
        "estimated_seconds": 70,
        "sample_count": 1,
    }
    assert api.get("/me/recipes/import/timing", headers={"Authorization": "Bearer bob"}).json() == {
        "estimated_seconds": 105,
        "sample_count": 0,
    }
    assert len(api.get("/me/usage").json()["events"]) == 2
