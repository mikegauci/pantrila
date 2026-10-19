from types import SimpleNamespace
from urllib.parse import quote

import httpx
import pytest

from pantrio.recipe_import import ImportedRecipe, Importer, ImportFailed
from pantrio.social import (
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
        "Follow @sam.cooks, link in bio linktr.ee/sam or bit.ly/abc, "
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
    with pytest.raises(ImportFailed, match="TikTok didn't let Pantrio read this post"):
        fetch_post("https://vm.tiktok.com/ZMabc/", http, resolve)


@pytest.mark.parametrize(
    "response",
    [httpx.Response(403), httpx.Response(200, json={"title": ""}), httpx.Response(200, json=[])],
)
def test_tiktok_refusal_or_empty_caption_asks_for_the_caption(response):
    http = mock_http({oembed(TIKTOK): response})
    with pytest.raises(ImportFailed, match="TikTok didn't let Pantrio read this post"):
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


def test_instagram_login_redirect_asks_for_the_caption():
    url = "https://www.instagram.com/p/C1abc/"
    http = mock_http({
        url: httpx.Response(302, headers={"location": "https://www.instagram.com/accounts/login/"}),
        "https://www.instagram.com/accounts/login/": httpx.Response(200, html="<p>Log in</p>"),
    })  # fmt: skip
    with pytest.raises(ImportFailed, match="Instagram didn't let Pantrio read this post. Paste"):
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

    alone = Importer(client=FakeClient(recipe()), model="m").from_post(caption="Egg pasta: eggs")
    assert alone.draft.source == "post" and alone.draft.source_url is None


def test_caption_without_recipe_falls_back_to_the_linked_site():
    client = FakeClient(recipe(is_recipe=False), recipe())
    caption = "Egg pasta 🍝 full recipe on sambakes.com/egg-pasta #pasta"
    http = mock_http({
        "https://sambakes.com/egg-pasta": httpx.Response(301, headers={"location": "/r/egg"}),
        "https://sambakes.com/r/egg": httpx.Response(200, html="<p>Egg pasta: 2 eggs</p>"),
    })  # fmt: skip
    result = Importer(client=client, model="m").from_post(TIKTOK, caption, http, resolve)
    assert result.draft.recipe_url == "https://sambakes.com/r/egg"
    assert result.draft.source_url == TIKTOK and result.draft.source == "post"
    assert "Text of the web page https://sambakes.com/r/egg" in sent(client)
    assert result.usage.llm_calls == 2  # both calls count on the one import


def test_unreadable_links_are_skipped_and_no_recipe_anywhere_says_what_to_do_next():
    client = FakeClient(recipe(is_recipe=False), recipe(is_recipe=False))
    caption = "Recipe on dead.example.com and sambakes.com/knives"
    http = mock_http({"https://sambakes.com/knives": httpx.Response(200, html="<p>Knives</p>")})
    with pytest.raises(ImportFailed) as exc:
        Importer(client=client, model="m").from_post(TIKTOK, caption, http, resolve)
    assert str(exc.value) == NO_RECIPE and len(client.calls) == 2

    client = FakeClient(recipe(is_recipe=False))
    with pytest.raises(ImportFailed, match="paste the recipe text or add screenshots"):
        Importer(client=client, model="m").from_post(TIKTOK, "Comment RECIPE 👇", http, resolve)
    assert len(client.calls) == 1  # no link, no second call


def test_plain_recipe_links_still_go_through_the_link_import(monkeypatch):
    import pantrio.recipe_import as ri

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
