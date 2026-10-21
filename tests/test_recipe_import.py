import base64
import re
from types import SimpleNamespace

import httpx
import pytest

from pantrila.recipe_import import (
    ImportedRecipe,
    Importer,
    ImportFailed,
    VideoRecipe,
    check_audio,
    check_image,
    check_url,
    fetch_page,
    jsonld_recipe,
    page_text,
    to_draft,
)

PUBLIC = "93.184.216.34"
USAGE = SimpleNamespace(input_tokens=2000, output_tokens=500)

PAGE = """<html><head><title>Best Pancakes | Blog</title>
<script type="application/ld+json">{"@context": "https://schema.org", "@graph": [
  {"@type": "WebPage", "name": "Best Pancakes"},
  {"@type": ["Recipe", "HowTo"], "name": "Best Pancakes", "recipeYield": "2",
   "recipeIngredient": ["100 g flour", "2 eggs", "250 ml milk"],
   "recipeInstructions": [{"@type": "HowToStep", "text": "Whisk."}], "image": "x.jpg",
   "review": [{"reviewBody": "lovely"}]}]}</script>
<script>var tracking = 1;</script></head>
<body><nav>Home</nav><h1>Best Pancakes</h1><p>My grandmother's
   recipe.</p><ul><li>100 g flour</li><li>2 eggs</li></ul></body></html>"""


def resolver(*addresses):
    return lambda host, port: list(addresses)


def imported(**overrides) -> ImportedRecipe:
    base = {
        "is_recipe": True, "title": "Best Pancakes", "summary": "Thin pancakes.",
        "cuisine": "French", "meal_types": ["breakfast"], "total_minutes": 20, "servings": 2,
        "ingredients": [
            {"name": "100 g flour", "quantity": 100, "unit": "g", "food": "plain_flour",
             "estimate": None},
            {"name": "2 eggs", "quantity": 2, "unit": "piece", "food": "egg", "estimate": None},
            {"name": "a jar of gochujang", "quantity": 1, "unit": "tbsp", "food": None,
             "estimate": {"description": "gochujang", "diet_class": "plant",
                          "allergens": ["soy"], "kcal": 220, "protein_g": 5, "carbs_g": 45,
                          "fat_g": 2, "fibre_g": 3, "grams_per_ml": 1.2,
                          "grams_per_piece": None}},
            {"name": "milk", "quantity": 250, "unit": "ml", "food": "milk", "estimate": None},
            {"name": "dragon fruit", "quantity": 1, "unit": "piece", "food": None,
             "estimate": None},
        ],
        "steps": ["Whisk.", " ", "Fry."],
    }  # fmt: skip
    return ImportedRecipe.model_validate({**base, **overrides})


@pytest.mark.parametrize(
    ("url", "addresses", "message"),
    [
        ("ftp://example.com/r", [PUBLIC], "http or https"),
        ("file:///etc/passwd", [PUBLIC], "http or https"),
        ("http://user:pw@example.com/", [PUBLIC], "user name"),
        ("http://example.com:8080/", [PUBLIC], "standard web ports"),
        ("http://localhost/", ["127.0.0.1"], "private"),
        ("http://metadata/", ["169.254.169.254"], "private"),
        ("http://intranet/", [PUBLIC, "10.0.0.5"], "private"),
        ("http://v6/", ["::ffff:192.168.1.1"], "private"),
        ("http://v6/", ["fd00::1"], "private"),
    ],
)
def test_check_url_refuses_anything_but_public_web_hosts(url, addresses, message):
    with pytest.raises(ImportFailed, match=message):
        check_url(url, resolver(*addresses))


def test_check_url_allows_public_hosts():
    check_url("https://www.bbcgoodfood.com/recipes/x", resolver(PUBLIC, "2606:2800:220:1::1"))


def mock_http(routes: dict[str, httpx.Response]) -> httpx.Client:
    return httpx.Client(transport=httpx.MockTransport(lambda req: routes[str(req.url)]))


def test_fetch_follows_redirects_but_checks_every_hop():
    http = mock_http({
        "https://a.example/r": httpx.Response(301, headers={"location": "/final"}),
        "https://a.example/final": httpx.Response(200, html=PAGE),
    })  # fmt: skip
    url, html = fetch_page("https://a.example/r", http, resolver(PUBLIC))
    assert url == "https://a.example/final" and "Best Pancakes" in html

    hosts = {"a.example": PUBLIC, "internal.example": "10.1.2.3"}
    http = mock_http({"https://a.example/r": httpx.Response(
        302, headers={"location": "https://internal.example/admin"})})  # fmt: skip
    with pytest.raises(ImportFailed, match="private"):
        fetch_page("https://a.example/r", http, lambda host, port: [hosts[host]])


def test_fetch_refuses_errors_and_non_html():
    http = mock_http({
        "https://a.example/404": httpx.Response(404),
        "https://a.example/bot": httpx.Response(403),
        "https://a.example/pdf": httpx.Response(200, content=b"%PDF",
                                                headers={"content-type": "application/pdf"}),
    })  # fmt: skip
    with pytest.raises(ImportFailed, match="404"):
        fetch_page("https://a.example/404", http, resolver(PUBLIC))
    with pytest.raises(ImportFailed, match="add it as a photo"):
        fetch_page("https://a.example/bot", http, resolver(PUBLIC))
    with pytest.raises(ImportFailed, match="not a web page"):
        fetch_page("https://a.example/pdf", http, resolver(PUBLIC))


def test_jsonld_recipe_is_found_in_a_graph_and_trimmed():
    recipe = jsonld_recipe(PAGE)
    assert recipe["recipeIngredient"] == ["100 g flour", "2 eggs", "250 ml milk"]
    assert "image" not in recipe and "review" not in recipe
    assert jsonld_recipe("<html><p>no data</p></html>") is None
    assert jsonld_recipe('<script type="application/ld+json">{bad json</script>') is None


GROUPED = """<html><head><script type="application/ld+json">{"@type": "Recipe",
  "recipeIngredient": ["1 cup basmati rice", "1 pound chicken thighs (see note 1)",
                       "1 tablespoon olive oil", "2 tablespoons red curry paste",
                       "Toasted sesame seeds"],
  "recipeInstructions": [{"@type": "HowToSection", "name": "Chicken",
                          "itemListElement": [{"@type": "HowToStep", "text": "Bake."}]}]}
</script></head><body><h2>Ingredients</h2><h4>Rice &amp; Chicken</h4>
<ul><li>&#9634; 1 cup <a>basmati rice</a></li>
<li>1 pound chicken thighs <i>see note 1</i></li></ul><h4>Broth</h4>
<ul><li>1 tablespoon olive oil</li><li>2 tablespoons red curry paste</li></ul>
<h4>Optional Toppings</h4><ul><li>Toasted sesame seeds</li></ul></body></html>"""


def test_jsonld_recipe_adds_the_headings_the_page_groups_ingredients_under():
    groups = jsonld_recipe(GROUPED)["ingredientSections"]
    assert [g["heading"] for g in groups] == ["Rice & Chicken", "Broth", "Optional Toppings"]
    assert [len(g["ingredients"]) for g in groups] == [2, 2, 1]
    assert groups[2]["ingredients"] == ["Toasted sesame seeds"]
    # A page whose ingredients sit in one plain list adds nothing.
    assert "ingredientSections" not in jsonld_recipe(PAGE)
    assert "ingredientSections" not in jsonld_recipe(re.sub(r"<h4>.*?</h4>", "", GROUPED))


def test_to_draft_keeps_the_sources_groups_for_ingredients_and_steps():
    raw = imported(
        steps=["Whisk.", " ", "Fry.", "Serve."],
        step_sections=[{"title": " Batter ", "first_step": 1},
                       {"title": "Cooking", "first_step": 2},  # step 2 is blank: starts at Fry
                       {"title": "Beyond", "first_step": 9}],
    )  # fmt: skip
    for line, section in zip(
        raw.ingredients, ["Batter", "Batter", " ", "", "Toppings"], strict=True
    ):
        line.section = section
    draft, _ = to_draft(raw, "link", "https://a.example/r")
    assert [i.section for i in draft.ingredients] == ["Batter", "Batter", "", "", "Toppings"]
    assert draft.steps == ["Whisk.", "Fry.", "Serve."]
    assert [(s.title, s.first_step) for s in draft.step_sections] == [("Batter", 1), ("Cooking", 2)]


def test_page_text_keeps_visible_text_only():
    text = page_text(PAGE)
    assert text.startswith("Best Pancakes | Blog")
    assert "My grandmother's recipe." in text and "100 g flour\n2 eggs" in text
    assert "tracking" not in text and "@graph" not in text


def test_to_draft_checks_every_line_in_code():
    raw = imported()
    raw.ingredients[3].quantity = 0
    raw.ingredients[3].unit = "piece"
    draft, notes = to_draft(raw, "link", "https://a.example/r")
    lines = draft.ingredients
    assert [i.food for i in lines] == ["plain_flour", "egg", None, "milk", None]
    assert lines[2].estimate.allergens == ["soy"] and lines[3].quantity == 1.0
    assert draft.steps == ["Whisk.", "Fry."] and draft.cuisine == "french"
    assert draft.source == "link" and draft.source_url == "https://a.example/r"
    joined = " ".join(notes)
    assert "Ingredient 3 (a jar of gochujang): not in Pantrila's table" in joined
    assert "Ingredient 4 (milk): check the amount" in joined
    assert "Ingredient 5 (dragon fruit): pick a food or estimate it" in joined


def test_implausible_model_estimates_are_dropped_not_trusted():
    gochujang = imported().model_dump()["ingredients"][2]
    gochujang["estimate"]["kcal"] = 5000
    draft, notes = to_draft(imported(ingredients=[gochujang]), "photo", None)
    assert draft.ingredients[0].estimate is None
    assert "pick a food or estimate it" in notes[0]


def test_no_recipe_is_an_error_the_person_sees():
    with pytest.raises(ImportFailed, match="Could not find a recipe"):
        to_draft(imported(is_recipe=False), "link", None)


class FakeClient:
    def __init__(self, parsed, transcript: str = ""):
        self.parsed, self.calls, self.responses = parsed, [], self
        self.transcript = transcript
        self.audio = SimpleNamespace(transcriptions=SimpleNamespace(create=self.transcribe))

    def transcribe(self, **kwargs):
        self.calls.append(kwargs)
        return SimpleNamespace(text=self.transcript)

    def parse(self, **kwargs):
        self.calls.append(kwargs)
        return SimpleNamespace(output_parsed=self.parsed, usage=USAGE)


def test_link_import_sends_only_the_json_ld_when_there_is_some():
    client = FakeClient(imported())
    result = Importer(client=client, model="m").from_html("https://a.example/r", PAGE)
    (call,) = client.calls
    text = call["input"][0]["content"][0]["text"]
    assert text.startswith("schema.org Recipe data from https://a.example/r")
    assert "grandmother" not in text and call["store"] is False
    assert result.usage.llm_calls == 1 and result.draft.title == "Best Pancakes"

    Importer(client=client, model="m").from_html("https://b.example", "<p>2 eggs, fry</p>")
    assert "Text of the web page" in client.calls[-1]["input"][0]["content"][0]["text"]


def test_photo_import_sends_each_image():
    png = "data:image/png;base64," + base64.b64encode(b"\x89PNG fake").decode()
    client = FakeClient(imported())
    Importer(client=client, model="m").from_photos([png, png])
    parts = client.calls[0]["input"][0]["content"]
    assert [p["type"] for p in parts] == ["input_text", "input_image", "input_image"]


def test_check_image_refuses_other_types_and_big_files():
    with pytest.raises(ImportFailed, match="JPEG, PNG or WebP"):
        check_image("data:image/svg+xml;base64,PHN2Zz4=")
    with pytest.raises(ImportFailed, match="JPEG, PNG or WebP"):
        check_image("https://example.com/x.png")
    big = "data:image/jpeg;base64," + base64.b64encode(b"x" * 4_000_001).decode()
    with pytest.raises(ImportFailed, match="under 4 MB"):
        check_image(big)


def test_estimates_gain_the_allergens_of_table_foods_the_line_names():
    curry = imported().model_dump()["ingredients"][2]
    curry.update(name="2 tbsp madras curry powder")
    curry["estimate"]["allergens"] = []
    draft, notes = to_draft(imported(ingredients=[curry]), "link", None)
    assert draft.ingredients[0].estimate.allergens == ["mustard"]
    assert "allergens of curry powder added to be safe" in notes[-1]

    paste = imported().model_dump()["ingredients"][2]  # gochujang: names no table food
    draft, notes = to_draft(imported(ingredients=[paste]), "link", None)
    assert draft.ingredients[0].estimate.allergens == ["soy"] and len(notes) == 1


def test_fetch_pins_the_validated_address_without_a_second_dns_lookup(monkeypatch):
    import socket
    from unittest.mock import Mock

    from pantrila.safe_http import PinnedConnection

    sock = Mock()
    sock.connect.side_effect = OSError("stop before network")
    monkeypatch.setattr(socket, "socket", lambda *a: sock)
    monkeypatch.setattr(socket, "getaddrinfo", Mock(side_effect=AssertionError("second DNS")))
    with pytest.raises(ImportFailed, match="Could not load"):
        fetch_page("http://rebind.example/", resolve=resolver(PUBLIC))
    sock.connect.assert_called_once_with((PUBLIC, 80))
    sock.close.assert_called()
    # HTTPS must still authenticate the original hostname, not the pinned address.
    import time

    conn = PinnedConnection("recipes.example", 443, PUBLIC, True, time.monotonic() + 10)
    sock.connect.side_effect = None
    context = Mock()
    monkeypatch.setattr("ssl.create_default_context", lambda: context)
    try:
        conn.connect()
        context.wrap_socket.assert_called_once_with(
            sock, server_hostname="recipes.example", do_handshake_on_connect=False
        )
        context.wrap_socket.return_value.do_handshake.assert_called_once()
    finally:
        conn.close()


def test_dns_resolution_has_an_overall_deadline(monkeypatch):
    import threading

    release = threading.Event()
    monkeypatch.setattr("pantrila.recipe_import.FETCH_TIMEOUT_S", 0.02)
    try:
        with pytest.raises(ImportFailed, match="too long"):
            fetch_page("https://slow.example/", resolve=lambda *_: (release.wait(2), [PUBLIC])[1])
    finally:
        release.set()


def test_trickling_headers_cannot_extend_socket_deadline():
    import socket
    import threading
    import time
    from contextlib import suppress

    from pantrila.safe_http import pinned_page

    listener = socket.socket()
    listener.bind(("127.0.0.1", 0))
    listener.listen()
    stop = threading.Event()

    def serve():
        with listener.accept()[0] as sock, suppress(OSError):
            sock.recv(4096)
            sock.sendall(b"HTTP/1.1 200 OK\r\nX-Slow: ")
            while not stop.wait(0.01):
                sock.sendall(b"a")

    thread = threading.Thread(target=serve, daemon=True)
    thread.start()
    start = time.monotonic()
    try:
        with (
            pytest.raises((OSError, ValueError)),
            pinned_page(
                f"http://localhost:{listener.getsockname()[1]}/", ["127.0.0.1"], {}, start + 0.1
            ) as response,
        ):
            list(response.iter_bytes())
        assert time.monotonic() - start < 1
    finally:
        stop.set()
        listener.close()
        thread.join(timeout=1)


def test_pinned_fetch_falls_back_only_to_other_validated_addresses():
    import threading
    import time
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

    from pantrila.safe_http import pinned_page

    hosts = []
    body = b"<html>recipe</html>"

    class Handler(BaseHTTPRequestHandler):
        wbufsize = 8192  # one send for headers and body; split sends flake on loopback

        def do_GET(self):
            hosts.append(self.headers["Host"])
            self.send_response(200)
            self.send_header("Content-Type", "text/html")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        port = server.server_port
        with pinned_page(
            f"http://recipes.example:{port}/", ["127.0.0.2", "127.0.0.1"], {}, time.monotonic() + 2
        ) as response:
            assert b"recipe" in b"".join(response.iter_bytes())
        assert hosts == [f"recipes.example:{port}"]
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


def wav(seconds: float, rate: int = 16_000) -> str:
    import io
    import wave

    out = io.BytesIO()
    with wave.open(out, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(b"\0\0" * int(seconds * rate))
    return "data:audio/wav;base64," + base64.b64encode(out.getvalue()).decode()


def video_recipe(**line_overrides) -> VideoRecipe:
    data = imported().model_dump()
    data["ingredients"] = [{**i, "vague_amount": None} for i in data["ingredients"][:2]]
    data["ingredients"][1].update(line_overrides)
    return VideoRecipe.model_validate(data)


def test_check_audio_reads_the_length_and_refuses_the_rest():
    data, seconds = check_audio(wav(90))
    assert seconds == pytest.approx(90) and data[:4] == b"RIFF"
    for bad, message in [
        ("data:audio/mpeg;base64,AAAA", "WAV"),
        ("data:audio/wav;base64,AAAA", "could not be read"),
        (wav(186, rate=8000), "under 3 minutes"),
        (wav(0.5), "no sound"),
    ]:
        with pytest.raises(ImportFailed, match=message):
            check_audio(bad)


def test_video_import_flags_vague_amounts_and_never_stores_audio():
    client = FakeClient(video_recipe(vague_amount="a glug"), transcript="Crack in a glug of eggs")
    png = "data:image/png;base64," + base64.b64encode(b"\x89PNG fake").decode()
    result = Importer(client=client, model="m", transcribe_model="t").from_video(
        wav(30), [png] * 6, caption="Pancakes #fyp"
    )
    transcribe, read = client.calls
    assert transcribe["model"] == "t" and read["store"] is False
    assert "cooking video" in read["instructions"] and read["text_format"] is VideoRecipe
    parts = read["input"][0]["content"]
    assert "Crack in a glug of eggs" in parts[0]["text"] and "Pancakes #fyp" in parts[0]["text"]
    assert [p["type"] for p in parts].count("input_image") == 4  # at most 4 frames
    assert result.draft.source == "video" and result.draft.source_url is None
    assert result.usage.llm_calls == 2 and result.usage.audio_seconds == pytest.approx(30)
    assert any("only says \u201ca glug\u201d" in n and "Ingredient 2" in n
               for n in result.notes)  # fmt: skip
    assert "audio" not in result.draft.model_dump_json()


def test_video_import_plain_prompt_and_failures():
    client = FakeClient(imported(), transcript="Toast.")
    Importer(client=client, model="m").from_video(wav(5), [], guided=False)
    assert client.calls[-1]["text_format"] is ImportedRecipe
    assert "cooking video" not in client.calls[-1]["instructions"]

    nothing = FakeClient(imported())
    with pytest.raises(ImportFailed, match="couldn't read any sound or pictures"):
        Importer(client=nothing, model="m").from_video(None, [])
    assert nothing.calls == []  # refused before any paid call

    vlog = FakeClient(imported(is_recipe=False), transcript="Welcome to my kitchen tour")
    with pytest.raises(ImportFailed, match="couldn't find a recipe in this video"):
        Importer(client=vlog, model="m").from_video(wav(5), [])


def test_video_without_sound_reads_the_frames_and_keeps_other_links():
    png = "data:image/png;base64," + base64.b64encode(b"\x89PNG fake").decode()
    client = FakeClient(imported())
    result = Importer(client=client, model="m").from_video(None, [png], "youtube.com/shorts/abc")
    (read,) = client.calls  # no transcription
    assert "(no speech)" in read["input"][0]["content"][0]["text"]
    assert result.usage.audio_seconds == 0 and result.usage.llm_calls == 1
    assert result.draft.source == "video"
    assert result.draft.source_url == "https://youtube.com/shorts/abc"


def test_photos_without_a_method_are_still_refused():
    png = "data:image/png;base64," + base64.b64encode(b"\x89PNG fake").decode()
    client = FakeClient(imported(steps=[]))
    with pytest.raises(ImportFailed, match="Could not find a recipe"):
        Importer(client=client, model="m").from_photos([png])


def amount_client(recipe, repairs):
    from pantrila.recipe_import import AmountRepairs

    client = FakeClient(recipe)
    original_parse = client.parse

    def parse(**kwargs):
        if kwargs["text_format"] is AmountRepairs:
            client.calls.append(kwargs)
            return SimpleNamespace(output_parsed=AmountRepairs(ingredients=repairs), usage=USAGE)
        return original_parse(**kwargs)

    client.parse = parse
    return client


def test_import_repairs_sprigs_and_missing_pasta_without_manual_edits():
    from pantrila.cookbook import derive

    raw = imported(
        servings=4,
        ingredients=[
            {
                "name": "1 sprig basil leaves",
                "quantity": 1,
                "unit": "piece",
                "food": "basil",
                "estimate": None,
            },
            {
                "name": "cooked pasta",
                "quantity": 1,
                "unit": "piece",
                "food": "pasta",
                "estimate": None,
            },
        ],
    )
    client = amount_client(
        raw,
        [
            {"index": 0, "grams": 2, "reason": "A typical basil sprig weighs about 2 g."},
            {"index": 1, "grams": 300, "reason": "Estimated 75 g dry pasta per serving."},
        ],
    )
    result = Importer(client=client).from_text("Basil pasta for four. Toss and serve.")
    derived = derive(result.draft)
    assert [i.grams for i in derived.ingredients] == [2, 300]
    # The amount is in quantity and unit, so a leading one is dropped from the name.
    assert [i.name for i in result.draft.ingredients] == ["sprig basil leaves", "cooked pasta"]
    assert derived.estimated and derived.nutrition.kcal > 0
    assert derived.allergens == ["gluten"]
    assert all(line.amount_estimate for line in result.draft.ingredients)
    assert not any("pick a unit" in note for note in result.notes)
    assert result.usage.llm_calls == 2
    assert all(call["store"] is False for call in client.calls)


def test_cooked_reference_is_counted_once_but_explicit_extra_amount_is_kept():
    from pantrila.cookbook import derive

    raw = imported(
        ingredients=[
            {
                "name": "400 g pasta",
                "quantity": 400,
                "unit": "g",
                "food": "pasta",
                "estimate": None,
            },
            {
                "name": "cooked pasta",
                "quantity": 1,
                "unit": "piece",
                "food": "pasta",
                "estimate": None,
            },
            {
                "name": "100 g pasta for topping",
                "quantity": 100,
                "unit": "g",
                "food": "pasta",
                "estimate": None,
            },
        ]
    )
    client = FakeClient(raw)
    result = Importer(client=client).from_text("Cook 400 g pasta; add cooked pasta to sauce.")
    assert [i.quantity for i in result.draft.ingredients] == [400, 100]
    assert sum(i.grams for i in derive(result.draft).ingredients) == 500
    assert len(client.calls) == 1
    assert any("counted once" in n for n in result.notes)
    assert not any("pick a unit" in n for n in result.notes)


@pytest.mark.parametrize(
    "repairs",
    [
        [],
        [{"index": 2, "grams": 2, "reason": "Sprig"}],
        [{"index": 0, "grams": -1, "reason": "Sprig"}],
        [{"index": 0, "grams": float("nan"), "reason": "Sprig"}],
        [{"index": 0, "grams": 100001, "reason": "Sprig"}],
        [{"index": 0, "grams": 2, "reason": " "}],
        [{"index": 0, "grams": 2, "reason": "Sprig"}] * 2,
    ],
)
def test_invalid_amount_repairs_cannot_silently_change_a_recipe(repairs):
    raw = imported(
        ingredients=[
            {
                "name": "1 sprig basil",
                "quantity": 1,
                "unit": "piece",
                "food": "basil",
                "estimate": None,
            },
        ]
    )
    with pytest.raises(ImportFailed, match="Could not estimate ingredient amounts"):
        Importer(client=amount_client(raw, repairs)).from_text("Basil. Add to sauce.")


def test_missing_amount_is_estimated_instead_of_silently_becoming_one_gram():
    raw = imported(
        ingredients=[
            {"name": "milk", "quantity": 0, "unit": "g", "food": "milk", "estimate": None},
        ]
    )
    client = amount_client(raw, [{"index": 0, "grams": 250, "reason": "Typical pancake batter."}])
    result = Importer(client=client).from_text("Add milk and whisk.")
    assert result.draft.ingredients[0].quantity == 250
    assert result.draft.ingredients[0].amount_estimate
    assert not any("check the amount" in n for n in result.notes)


def test_vague_video_amount_remains_estimated_after_saving():
    from pantrila.cookbook import CookbookRecipeIn, derive

    raw = video_recipe(vague_amount="a glug")
    result = Importer(client=FakeClient(raw)).from_video(wav(2), [])
    restored = CookbookRecipeIn.model_validate_json(result.draft.model_dump_json())
    assert "a glug" in restored.ingredients[1].amount_estimate
    assert derive(restored).estimated


def test_estimated_food_unit_repair_keeps_its_allergens_and_facts():
    from pantrila.cookbook import derive

    raw_line = imported().ingredients[2].model_dump()
    raw_line["unit"] = "piece"
    raw_line["estimate"]["grams_per_piece"] = None
    raw = imported(ingredients=[raw_line])
    client = amount_client(raw, [{"index": 0, "grams": 30, "reason": "Typical sauce amount."}])
    result = Importer(client=client).from_text("A little gochujang. Stir in.")
    assert result.draft.ingredients[0].estimate.allergens == ["soy"]
    assert result.draft.ingredients[0].estimate.kcal == 220
    assert derive(result.draft).estimated
    assert derive(result.draft).nutrition.kcal == pytest.approx(33)


def test_video_repair_failure_is_not_reported_as_no_recipe():
    from pantrila.recipe_import import AmountEstimateFailed

    raw = video_recipe(vague_amount="some eggs")
    raw.ingredients[0].unit = "piece"
    client = amount_client(raw, [])
    with pytest.raises(AmountEstimateFailed, match="Could not estimate ingredient amounts"):
        Importer(client=client).from_video(wav(2), [])


def test_unmatched_lines_that_name_a_table_food_keep_the_sources_measure():
    from pantrila.cookbook import derive

    soda = imported().ingredients[2].model_dump()
    soda.update(name="baking soda", quantity=0.5, unit="tsp")
    soda["estimate"].update(description="baking soda", allergens=[], grams_per_ml=None)
    salt = {**soda, "name": "salt", "quantity": 0.125, "estimate": {**soda["estimate"]}}
    client = amount_client(imported(ingredients=[soda, salt]), [])
    result = Importer(client=client).from_text("Whisk the baking soda and salt. Bake.")
    lines = result.draft.ingredients
    assert [(line.food, line.quantity, line.unit) for line in lines] == [
        ("baking_powder", 0.5, "tsp"),
        ("salt", 0.125, "tsp"),
    ]
    assert all(line.estimate is None for line in lines)
    assert result.usage.llm_calls == 1  # no amount repair needed
    assert not derive(result.draft).estimated


def test_estimated_food_in_spoons_keeps_its_spoons_and_learns_its_weight():
    from pantrila.cookbook import derive

    line = imported().ingredients[2].model_dump()
    line.update(name="coconut sugar", quantity=0.5, unit="cup")
    line["estimate"].update(description="coconut sugar", allergens=[], grams_per_ml=None)
    client = amount_client(
        imported(ingredients=[line]), [{"index": 0, "grams": 96, "reason": "About 96 g."}]
    )
    result = Importer(client=client).from_text("Stir in the coconut sugar.")
    (kept,) = result.draft.ingredients
    assert (kept.quantity, kept.unit) == (0.5, "cup")
    assert kept.estimate.grams_per_ml == pytest.approx(0.8)
    assert derive(result.draft).ingredients[0].grams == pytest.approx(96)


def test_recipe_notes_read_from_the_page_html():
    from pantrila.recipe_import import recipe_notes

    html = (
        '<div class="wprm-recipe-notes-container"><h3>Notes</h3>'
        "<div>FLOUR: use <b>plain</b> flour.<br>DOUBLING: easily doubled.</div>"
        "<span>{vegan, low fat}</span></div><p>Comments</p>"
    )
    assert recipe_notes(html) == "FLOUR: use plain flour.\nDOUBLING: easily doubled."
    assert recipe_notes("<p>No notes here</p>") == ""


def test_bare_name_drops_a_second_measure():
    from pantrila.cookbook import bare_name

    assert bare_name("(97g) white whole wheat flour") == "white whole wheat flour"
    assert bare_name("+ 2 tsp (40mL) almond milk") == "almond milk"
    assert bare_name("(see notes) salt") == "(see notes) salt"
