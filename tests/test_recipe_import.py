import base64
from types import SimpleNamespace

import httpx
import pytest

from pantrio.recipe_import import (
    ImportedRecipe,
    Importer,
    ImportFailed,
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
            {"name": "milk", "quantity": 0, "unit": "piece", "food": "milk", "estimate": None},
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


def test_page_text_keeps_visible_text_only():
    text = page_text(PAGE)
    assert text.startswith("Best Pancakes | Blog")
    assert "My grandmother's recipe." in text and "100 g flour\n2 eggs" in text
    assert "tracking" not in text and "@graph" not in text


def test_to_draft_checks_every_line_in_code():
    draft, notes = to_draft(imported(), "link", "https://a.example/r")
    lines = draft.ingredients
    assert [i.food for i in lines] == ["plain_flour", "egg", None, "milk", None]
    assert lines[2].estimate.allergens == ["soy"] and lines[3].quantity == 1.0
    assert draft.steps == ["Whisk.", "Fry."] and draft.cuisine == "french"
    assert draft.source == "link" and draft.source_url == "https://a.example/r"
    joined = " ".join(notes)
    assert "Ingredient 3 (a jar of gochujang): not in Pantrio's table" in joined
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
    def __init__(self, parsed):
        self.parsed, self.calls, self.responses = parsed, [], self

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
    curry.update(name="2 tbsp medium curry powder")
    curry["estimate"]["allergens"] = []
    draft, notes = to_draft(imported(ingredients=[curry]), "link", None)
    assert draft.ingredients[0].estimate.allergens == ["mustard"]
    assert "allergens of curry powder added to be safe" in notes[-1]

    paste = imported().model_dump()["ingredients"][2]  # gochujang: names no table food
    draft, notes = to_draft(imported(ingredients=[paste]), "link", None)
    assert draft.ingredients[0].estimate.allergens == ["soy"] and len(notes) == 1
