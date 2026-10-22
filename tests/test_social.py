from types import SimpleNamespace
from urllib.parse import quote

import httpx
import pytest

from pantrila.cookbook import bare_name
from pantrila.recipe_import import (
    DishPage,
    ImportedRecipe,
    Importer,
    ImportFailed,
    may_hold_recipe,
)
from pantrila.social import (
    NO_RECIPE,
    caption_links,
    clean_handle,
    detect,
    facebook_caption,
    fetch_post,
    instagram_caption,
    is_short_link,
    meta_tags,
)

PUBLIC = "93.184.216.34"
USAGE = SimpleNamespace(input_tokens=1000, output_tokens=300)
TIKTOK = "https://www.tiktok.com/@cookwithsam/video/7300000000000000001"


def resolve(host, port):
    return [PUBLIC]


def mock_http(routes: dict[str, httpx.Response]) -> httpx.Client:
    def handle(req: httpx.Request) -> httpx.Response:
        if str(req.url) not in routes:
            return httpx.Response(404)
        return routes[str(req.url)]

    return httpx.Client(transport=httpx.MockTransport(handle))


def oembed(post: str) -> str:
    return "https://www.tiktok.com/oembed?url=" + quote(post, safe="")


@pytest.mark.parametrize(
    ("url", "platform"),
    [
        (TIKTOK, "tiktok"),
        ("https://vm.tiktok.com/ZMabc123/", "tiktok"),
        ("tiktok.com/@sam/video/1", "tiktok"),
        ("https://www.instagram.com/reel/C1abc_-2/?igsh=xyz", "instagram"),
        ("https://instagram.com/p/C1abc/", "instagram"),
        ("https://www.instagram.com/cookwithsam/reel/C1abc/", "instagram"),
        ("https://www.instagram.com/cookwithsam/", None),  # a profile, not a post
        ("https://www.facebook.com/cookwithsam/videos/123/", "facebook"),
        ("https://fb.watch/abcDEF/", "facebook"),
        ("https://www.facebook.com/login/?next=x", None),
        ("https://www.bbcgoodfood.com/recipes/x", None),
        ("https://nottiktok.com/@a/video/1", None),
    ],
)
def test_detect_knows_post_links(url, platform):
    assert detect(url) == platform


def test_short_links():
    assert is_short_link("https://vm.tiktok.com/ZMabc/")
    assert is_short_link("https://www.tiktok.com/t/ZTabc/")
    assert is_short_link("https://fb.watch/abc/")
    assert is_short_link("https://www.facebook.com/share/r/abc/")
    assert not is_short_link(TIKTOK)


def test_handles_are_cleaned_or_dropped():
    assert clean_handle("@cook.with_sam ") == "cook.with_sam"
    assert clean_handle("has space") is None and clean_handle("x" * 31) is None
    assert clean_handle("") is None and clean_handle(None) is None


def test_caption_links_skip_platforms_shorteners_and_non_links():
    caption = (
        "Crispy gnocchi 🥔 full recipe 👉 sambakes.co.uk/gnocchi. Also on www.example.com/x! "
        "Follow @sam.cooks, link in bio linktr.ee/sam, "
        "tiktok.com/@sam. Toss with the sauce.Then bake 1.5kg e.g. hi@mail.com "
        "https://Blog.example.org/a?b=1)"
    )
    assert caption_links(caption) == [
        "https://sambakes.co.uk/gnocchi",
        "https://www.example.com/x",
        "https://Blog.example.org/a?b=1",
    ]


def test_tiktok_caption_comes_from_oembed_and_short_links_are_followed():
    data = {"title": "Easy pasta 🍝 200g pasta, 2 eggs #pasta", "author_unique_id": "cookwithsam"}
    http = mock_http({
        "https://vm.tiktok.com/ZMabc/": httpx.Response(301, headers={
            "location": TIKTOK + "?is_from_webapp=1&_t=abc"}),
        TIKTOK + "?is_from_webapp=1&_t=abc": httpx.Response(200, html="<html></html>"),
        oembed(TIKTOK): httpx.Response(200, json=data),
    })  # fmt: skip
    post = fetch_post("https://vm.tiktok.com/ZMabc/", http, resolve)
    assert post.platform == "tiktok" and post.url == TIKTOK  # tracking query dropped
    assert post.handle == "cookwithsam" and post.caption.startswith("Easy pasta")


def test_tiktok_short_link_to_somewhere_else_is_refused():
    http = mock_http({"https://vm.tiktok.com/ZMabc/": httpx.Response(
        302, headers={"location": "https://example.com/"}),
        "https://example.com/": httpx.Response(200, html="<p>hi</p>")})  # fmt: skip
    with pytest.raises(ImportFailed, match="TikTok didn't let Pantrila read this post"):
        fetch_post("https://vm.tiktok.com/ZMabc/", http, resolve)


@pytest.mark.parametrize(
    "response",
    [httpx.Response(403), httpx.Response(200, json={"title": ""}), httpx.Response(200, json=[])],
)
def test_tiktok_refusal_or_empty_caption_suggests_another_link(response):
    http = mock_http({oembed(TIKTOK): response})
    with pytest.raises(ImportFailed, match="TikTok didn't let Pantrila read this post"):
        fetch_post(TIKTOK, http, resolve)


IG_PAGE = """<html><head>
<meta property="og:title" content="Sam on Instagram: &quot;Gnocchi night&quot;">
<meta property="og:description" content="1,234 likes, 56 comments - cookwithsam on May 1,
2026: &quot;Crispy gnocchi&#10;500 g gnocchi&#10;2 tbsp butter&quot;. ">
</head><body></body></html>"""


def test_instagram_caption_and_handle_come_from_open_graph_tags():
    url = "https://www.instagram.com/reel/C1abc/"
    http = mock_http({url + "?igsh=x": httpx.Response(200, html=IG_PAGE)})
    post = fetch_post(url + "?igsh=x", http, resolve)
    assert post.url == url and post.handle == "cookwithsam"
    assert post.caption == "Crispy gnocchi\n500 g gnocchi\n2 tbsp butter"
    title = '<meta property="og:title" content="Sam on Instagram: “Soup”">'
    assert instagram_caption(meta_tags(title)) == (None, "Soup")


def test_instagram_login_redirect_suggests_another_link():
    url = "https://www.instagram.com/p/C1abc/"
    http = mock_http({
        url: httpx.Response(302, headers={"location": "https://www.instagram.com/accounts/login/"}),
        "https://www.instagram.com/accounts/login/": httpx.Response(200, html="<p>Log in</p>"),
    })  # fmt: skip
    with pytest.raises(
        ImportFailed,
        match="Instagram didn't let Pantrila read this post. Try another public recipe link",
    ):
        fetch_post(url, http, resolve)


def test_facebook_caption_takes_the_longer_open_graph_text():
    meta = {"og:title": "Sam Cooks", "og:description": "One-pan chicken: 4 thighs, 1 lemon"}
    assert facebook_caption(meta) == "One-pan chicken: 4 thighs, 1 lemon"
    url = "https://www.facebook.com/samcooks/videos/123/"
    page = f'<meta property="og:description" content="{meta["og:description"]}">'
    post = fetch_post(url, mock_http({url: httpx.Response(200, html=page)}), resolve)
    assert post.platform == "facebook" and post.handle == "samcooks"


# --- Importer.from_post -------------------------------------------------------------------------


def recipe(is_recipe=True) -> ImportedRecipe:
    return ImportedRecipe.model_validate({
        "is_recipe": is_recipe, "title": "Egg pasta", "summary": "", "cuisine": "italian",
        "meal_types": ["dinner"], "total_minutes": 15, "servings": 2, "steps": ["Cook."],
        "ingredients": [{"name": "2 eggs", "quantity": 2, "unit": "piece", "food": "egg",
                         "estimate": None}] if is_recipe else [],
    })  # fmt: skip


class FakeClient:
    """Returns the queued parsed outputs in order."""

    def __init__(self, *parsed):
        self.parsed, self.calls, self.responses = list(parsed), [], self

    def parse(self, **kwargs):
        self.calls.append(kwargs)
        return SimpleNamespace(output_parsed=self.parsed.pop(0), usage=USAGE)


def sent(client, n=-1) -> str:
    return client.calls[n]["input"][0]["content"][0]["text"]


def test_caption_with_the_recipe_is_one_call_and_keeps_the_credit():
    client = FakeClient(recipe())
    http = mock_http({oembed(TIKTOK): httpx.Response(200, json={
        "title": "Egg pasta 🍝 2 eggs, cook", "author_unique_id": "cookwithsam"})})  # fmt: skip
    result = Importer(client=client, model="m").from_post(TIKTOK, http=http, resolve=resolve)
    d = result.draft
    assert (d.source, d.source_url, d.source_platform, d.source_author, d.recipe_url) == (
        "post", TIKTOK, "tiktok", "cookwithsam", None)  # fmt: skip
    assert sent(client).startswith("Caption of a TikTok post by @cookwithsam:")
    assert result.usage.llm_calls == 1


def test_pasted_caption_is_used_without_fetching():
    client = FakeClient(recipe())
    http = mock_http({})  # any request would 404
    url = "https://www.instagram.com/cookwithsam/reel/C1abc/?igsh=x"
    result = Importer(client=client, model="m").from_post(url, "Egg pasta: 2 eggs", http, resolve)
    assert result.draft.source_url == "https://www.instagram.com/cookwithsam/reel/C1abc/"
    assert result.draft.source_author == "cookwithsam"
    assert result.draft.source_platform == "instagram"

    alone = Importer(client=FakeClient(recipe()), model="m").from_post(caption="Egg pasta: 2 eggs")
    assert alone.draft.source == "post" and alone.draft.source_url is None


def test_caption_without_recipe_falls_back_to_the_linked_site():
    client = FakeClient(recipe())  # the caption is a hook: no call for it
    caption = "Egg pasta 🍝 full recipe on sambakes.com/egg-pasta #pasta"
    http = mock_http({
        "https://sambakes.com/egg-pasta": httpx.Response(301, headers={"location": "/r/egg"}),
        "https://sambakes.com/r/egg": httpx.Response(200, html="<p>Egg pasta: 2 eggs</p>"),
    })  # fmt: skip
    result = Importer(client=client, model="m").from_post(TIKTOK, caption, http, resolve)
    assert result.draft.recipe_url == "https://sambakes.com/r/egg"
    assert result.draft.source_url == TIKTOK and result.draft.source == "post"
    assert "Text of the web page https://sambakes.com/r/egg" in sent(client)
    assert result.usage.llm_calls == 1 and len(client.calls) == 1


def test_unreadable_links_are_skipped_and_no_recipe_anywhere_says_what_to_do_next():
    client = FakeClient(recipe(is_recipe=False))
    caption = "Recipe on dead.example.com and sambakes.com/knives"
    http = mock_http({"https://sambakes.com/knives": httpx.Response(200, html="<p>Knives</p>")})
    with pytest.raises(ImportFailed) as exc:
        Importer(client=client, model="m").from_post(TIKTOK, caption, http, resolve)
    assert str(exc.value) == NO_RECIPE and len(client.calls) == 1  # the knife page only

    client = FakeClient()
    with pytest.raises(ImportFailed, match="Try another public recipe link"):
        Importer(client=client, model="m").from_post(TIKTOK, "Comment RECIPE 👇", http, resolve)
    assert len(client.calls) == 0  # a hook with no link: no paid call at all


@pytest.mark.parametrize(("caption", "worth_a_call"), [
    ("Egg pasta 🍝 2 eggs, cook", True),  # a count of a table food
    ("Cookies: 115 g butter, 1 cup sugar", True),  # amounts with units
    ("3-ingredient fluffy pancakes", True),
    ("Summer chickpea salad with tomato, cucumber and feta #salad", True),  # three table foods
    ("Shakshuka\n- tomatoes\n- peppers\n- eggs", True),  # a list
    ("Best chicken bowl ever 🔥 recipe on my blog", False),
    ("Peanut noodles in 15 min 🥜 Write EAT for this recipe!", False),  # minutes are no amount
    ("Comment RECIPE 👇", False),
])  # fmt: skip
def test_only_captions_that_could_hold_a_recipe_get_a_model_call(caption, worth_a_call):
    assert may_hold_recipe(caption) is worth_a_call


def test_plain_recipe_links_still_go_through_the_link_import(monkeypatch):
    import pantrila.recipe_import as ri

    monkeypatch.setattr(ri, "fetch_page", lambda url, http=None, resolve=None:
                        (url, "<p>Egg pasta: 2 eggs</p>"))  # fmt: skip
    client = FakeClient(recipe())
    result = Importer(client=client, model="m").from_post("bbcgoodfood.com/recipes/egg-pasta")
    assert result.draft.source == "link"
    assert result.draft.source_url == "https://bbcgoodfood.com/recipes/egg-pasta"


def test_pasted_text_import():
    client = FakeClient(recipe())
    result = Importer(client=client, model="m").from_text("  Egg pasta: 2 eggs, cook  ")
    assert result.draft.source == "text" and result.draft.source_url is None
    assert sent(client) == "Recipe text pasted by the person:\n\nEgg pasta: 2 eggs, cook"


# --- Review fixes ---------------------------------------------------------------------------


def test_words_joined_by_a_dot_are_not_links():
    caption = ("Stir it all together.It's so good. Cook 10 min.Me and the kids love it, "
               "the sauce.then bake. Recipe: example.com and blog.example.org/pie")  # fmt: skip
    assert caption_links(caption) == ["https://example.com", "https://blog.example.org/pie"]


def test_shops_and_platform_subdomains_are_skipped_and_brackets_kept():
    caption = ("m.youtube.com/x music.youtube.com/y amazon.co.uk/z www.amazon.de/w "
               "https://example.com/a(b) (see sambakes.com/r)")  # fmt: skip
    assert caption_links(caption) == ["https://example.com/a(b)", "https://sambakes.com/r"]


def test_profiles_and_sign_in_pages_are_not_posts():
    assert detect("https://www.tiktok.com/@chef") is None
    assert detect("https://www.facebook.com/") is None
    assert detect("https://www.facebook.com/unsupportedbrowser") is None


def test_facebook_query_keeps_only_the_post_id():
    from pantrila.social import clean_url

    url = "https://www.facebook.com/watch/?v=123&mibextid=abc&fbclid=XYZ#x"
    assert clean_url(url, "facebook") == "https://www.facebook.com/watch/?v=123"


def test_facebook_sign_in_wall_suggests_another_link():
    assert facebook_caption({"og:title": "Sam Cooks", "og:description": ""}) == ""
    wall = {"og:description": "Log into Facebook to start sharing and connecting."}
    assert facebook_caption(wall) == ""
    url = "https://www.facebook.com/samcooks/videos/123/"
    page = f'<meta property="og:description" content="{wall["og:description"]}">'
    with pytest.raises(ImportFailed, match="Facebook didn't let Pantrila read this post"):
        fetch_post(url, mock_http({url: httpx.Response(200, html=page)}), resolve)


def test_cut_short_instagram_caption_is_still_read():
    meta = {"og:description": '3 likes - chef.a on May 1, 2026: "Pasta 200g spaghetti, 2 eggs...'}
    assert instagram_caption(meta) == ("chef.a", "Pasta 200g spaghetti, 2 eggs...")


def test_tiktok_short_link_stops_at_the_post_url_without_loading_it():
    data = {"title": "Pasta: 200g pasta", "author_unique_id": "sam"}
    http = mock_http({
        "https://vm.tiktok.com/ZMabc/": httpx.Response(301, headers={"location": TIKTOK}),
        TIKTOK: httpx.Response(403),  # the app page refuses bots; oEmbed does not
        oembed(TIKTOK): httpx.Response(200, json=data),
    })  # fmt: skip
    assert fetch_post("https://vm.tiktok.com/ZMabc/", http, resolve).url == TIKTOK


def test_linked_page_with_recipe_data_wins_over_earlier_links():
    client = FakeClient(recipe())
    caption = "My knives: shop.example.com/k. Recipe: sambakes.com/pasta"
    recipe_page = '<script type="application/ld+json">{"@type": "Recipe", "name": "P"}</script>'
    http = mock_http({
        "https://shop.example.com/k.": httpx.Response(404),
        "https://shop.example.com/k": httpx.Response(200, html="<p>Knives</p>"),
        "https://sambakes.com/pasta": httpx.Response(200, html=recipe_page),
    })  # fmt: skip
    result = Importer(client=client, model="m").from_post(TIKTOK, caption, http, resolve)
    assert result.draft.recipe_url == "https://sambakes.com/pasta"
    assert len(client.calls) == 1  # the knife page was fetched but never sent to the model


def test_pasted_caption_with_a_recipe_link_tries_that_link():
    client = FakeClient(recipe())
    http = mock_http({"https://myblog.com/pasta": httpx.Response(200, html="<p>2 eggs</p>")})
    result = Importer(client=client, model="m").from_post(
        "myblog.com/pasta", "Best pasta ever 🍝", http, resolve)  # fmt: skip
    assert result.draft.recipe_url == "https://myblog.com/pasta"


def test_post_links_in_the_link_import_read_the_caption():
    client = FakeClient(recipe())
    http = mock_http({oembed(TIKTOK): httpx.Response(200, json={"title": "Pasta: 2 eggs"})})
    result = Importer(client=client, model="m").from_link(TIKTOK, http, resolve)
    assert result.draft.source == "post" and result.draft.source_platform == "tiktok"


def test_profile_links_fail_before_any_paid_call():
    client = FakeClient()
    with pytest.raises(ImportFailed, match="not a post"):
        Importer(client=client, model="m").from_post("https://www.tiktok.com/@chef")
    with pytest.raises(ImportFailed, match="not a post"):
        Importer(client=client, model="m").from_link("instagram.com/chef")
    assert client.calls == []


def test_short_links_are_kept_so_print_recipe_links_work():
    caption = "One-Pot Swedish Meatball Pasta PRINT RECIPE: http://bzfd.it/1VThGfV"
    assert caption_links(caption) == ["http://bzfd.it/1VThGfV"]


def test_tiktok_oembed_with_only_the_player_suggests_another_link():
    player_only = {"version": "1.0", "type": "video", "html": "<iframe></iframe>"}
    http = mock_http({oembed(TIKTOK): httpx.Response(200, json=player_only)})
    with pytest.raises(ImportFailed, match="TikTok didn't let Pantrila read this post"):
        fetch_post(TIKTOK, http, resolve)


def test_from_a_link_suggests_another_public_recipe_link(monkeypatch):
    from pantrila.social import NO_RECIPE_LINK

    def no_recipe(self, *args):
        raise ImportFailed(NO_RECIPE)

    monkeypatch.setattr(Importer, "from_post", no_recipe)
    with pytest.raises(ImportFailed) as exc:
        Importer(client=FakeClient(recipe()), model="m").from_link(TIKTOK)
    assert str(exc.value) == NO_RECIPE_LINK and "another public recipe link" in NO_RECIPE_LINK


def ingredients_only(*names: str) -> ImportedRecipe:
    data = recipe().model_dump()
    data["steps"] = []
    data["ingredients"] = [{"name": n, "quantity": 1, "unit": "piece", "food": "egg",
                            "estimate": None} for n in names]  # fmt: skip
    return ImportedRecipe.model_validate(data)


LASAGNA = ("Spicy Sausage Vodka Lasagna 🤤 Full recipe in my bio :) #pasta\n\n"
           "For the sauce:\n1 lb spicy Italian sausage\n3 garlic cloves\n2 tbsp vodka")  # fmt: skip


def test_caption_with_only_ingredients_becomes_a_draft_that_asks_for_the_method():
    from pantrila.recipe_import import NO_METHOD, NO_METHOD_STEP

    lines = ("1 lb spicy Italian sausage", "3 garlic cloves", "2 tbsp vodka")
    client = FakeClient(ingredients_only(*lines), DishPage(url=None))
    url = "https://www.instagram.com/reel/Dclv5Rgizvm/"
    result = Importer(client=client, model="m").from_post(url, LASAGNA)
    assert [i.name for i in result.draft.ingredients] == [bare_name(line) for line in lines]
    assert result.draft.steps == [NO_METHOD_STEP] and NO_METHOD in result.notes
    assert result.draft.source_url == url and len(client.calls) == 2  # no link; no page found


def test_invented_ingredients_without_a_method_are_still_refused():
    client = FakeClient(ingredients_only("200 g flour", "2 eggs", "300 ml milk"))
    with pytest.raises(ImportFailed) as exc:
        Importer(client=client, model="m").from_post(
            TIKTOK, "3-ingredient pancakes 🥞 Comment RECIPE and I'll DM you!", mock_http({}),
            resolve)  # fmt: skip
    assert str(exc.value) == NO_RECIPE


def test_caption_with_only_ingredients_prefers_a_linked_full_recipe():
    lines = ("1 lb spicy Italian sausage", "3 garlic cloves")
    client = FakeClient(ingredients_only(*lines), recipe())
    caption = LASAGNA + "\nMethod on sambakes.com/lasagna"
    http = mock_http({"https://sambakes.com/lasagna": httpx.Response(200, html="<p>Lasagna</p>")})
    result = Importer(client=client, model="m").from_post(TIKTOK, caption, http, resolve)
    assert result.draft.steps == ["Cook."] and result.draft.recipe_url.endswith("/lasagna")

    client = FakeClient(ingredients_only(*lines))  # the linked page fails: keep the caption's
    result = Importer(client=client, model="m").from_post(TIKTOK, caption, mock_http({}), resolve)
    assert [i.name for i in result.draft.ingredients] == [bare_name(line) for line in lines]
    assert result.draft.recipe_url is None


# --- A caption's dish with no method -------------------------------------------------------------


def caption_draft(title: str, *foods: tuple[str, str]) -> ImportedRecipe:
    """What the model reads from a caption that lists (line, food) and no method."""
    data = recipe().model_dump()
    data.update(title=title, steps=[], ingredients=[
        {"name": name, "quantity": 100, "unit": "g", "food": food, "estimate": None}
        for name, food in foods])  # fmt: skip
    return ImportedRecipe.model_validate(data)


def test_caption_dish_takes_the_method_of_a_pantrila_recipe_for_the_same_dish():
    from pantrila.recipe_import import shipped_corpus

    dish = shipped_corpus()[0]
    names = [i.name for i in dish.ingredients]
    caption = f"{dish.title} 🍽️ ingredients: " + ", ".join(names) + ". Full recipe in comments"
    draft = caption_draft(dish.title, *((i.name, i.food) for i in dish.ingredients))
    client = FakeClient(draft)
    result = Importer(client=client, model="m", corpus=[dish]).from_post(caption=caption)
    assert result.draft.steps == dish.steps and len(client.calls) == 1  # no web search
    assert "matched by the dish name" in result.draft.notes
    assert "Pantrila's recipe" in result.draft.notes and "NO_METHOD" not in result.draft.notes


def test_no_pantrila_recipe_takes_the_method_of_the_page_a_search_finds():
    page = "https://recipes.example/egg-pasta"
    html = "<html><body><p>Whisk the eggs. Cook the pasta.</p></body></html>"
    http = mock_http(
        {page: httpx.Response(200, content=html.encode(), headers={"content-type": "text/html"})}
    )
    client = FakeClient(
        caption_draft("Egg pasta", ("egg", "egg"), ("butter", "butter")),
        DishPage(url=page),
        ImportedRecipe.model_validate({**recipe().model_dump(),
            "steps": ["Whisk the eggs.", "Cook the pasta."],
            "ingredients": [{"name": "2 eggs", "quantity": 2, "unit": "piece", "food": "egg",
                             "estimate": None},
                            {"name": "olive oil", "quantity": 1, "unit": "tbsp",
                             "food": "olive_oil", "estimate": None}]}),
    )  # fmt: skip
    caption = "Egg pasta 🍝 ingredients: egg, butter. Recipe on the link"
    result = Importer(client=client, model="m", corpus=[]).from_post(
        caption=caption, http=http, resolve=resolve
    )
    d = result.draft
    assert d.steps == ["Whisk the eggs.", "Cook the pasta."] and d.recipe_url == page
    assert [i.name for i in d.ingredients] == ["egg", "butter"]  # the creator's list stays
    assert "Method from recipes.example" in d.notes
    assert "not in the ingredient list: check it." in d.notes
    assert "not the method: check it." in d.notes
    assert len(client.calls) == 3


def test_a_failed_search_keeps_the_captions_ingredients_and_asks_for_the_method():
    from pantrila.recipe_import import NO_METHOD, NO_METHOD_STEP

    client = FakeClient(caption_draft("Egg pasta", ("egg", "egg"), ("butter", "butter")))
    result = Importer(client=client, model="m", corpus=[]).from_post(
        caption="Egg pasta 🍝 ingredients: egg, butter. Recipe on the link"
    )
    assert result.draft.steps == [NO_METHOD_STEP] and NO_METHOD in result.notes
