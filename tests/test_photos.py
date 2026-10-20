"""Recipe photo prompt, paths and image handling (no API calls)."""

import io

from PIL import Image

from pantrila.photos import (
    STORED_SIZE,
    Dish,
    corpus_path,
    photo_prompt,
    public_url,
    shows_bread,
    to_webp,
)

TART = Dish(
    title="Simple French Apple Tart", summary="Thin apple slices on buttery pastry.",
    ingredients=["plain flour", "butter, cold and cubed", "apples, thinly sliced", "cinnamon",
                 "butter, melted"],
    steps=["Rub the flour and butter until it looks like fine breadcrumbs.", "Bake.", ""],
    gluten_free=False,
)  # fmt: skip


def test_prompt_lists_each_ingredient_once_and_the_last_real_step():
    prompt = photo_prompt(TART)
    assert "Ingredients: plain flour, butter, apples, cinnamon." in prompt
    assert "Final step: Bake." in prompt
    assert "add no herbs, spices or toppings that are not listed" in prompt


def test_bread_only_when_the_recipe_uses_or_suggests_it():
    assert not shows_bread(TART)  # "breadcrumbs" is a texture, not bread
    side = Dish("Albondigas", "Good with crusty bread.", ["beef mince"], ["Simmer."], False)
    assert shows_bread(side) and "slices of bread" in photo_prompt(side)
    toast = Dish("Toast", "Quick.", ["wholemeal bread"], ["Toast."], False)
    assert shows_bread(toast)
    gf = Dish("Chilli", "Good with bread.", ["beef mince"], ["Simmer."], True)
    assert not shows_bread(gf) and "slices of bread" not in photo_prompt(gf)


def test_corpus_path_changes_with_the_prompt_or_model():
    a = corpus_path("tart", "p1", "m")
    assert a.startswith("recipes/tart-") and a.endswith(".webp")
    assert a == corpus_path("tart", "p1", "m")
    assert a != corpus_path("tart", "p2", "m") != corpus_path("tart", "p1", "m2")


def test_public_url_comes_from_the_environment(monkeypatch):
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    assert public_url("recipes/a.webp") is None
    monkeypatch.setenv("SUPABASE_URL", "https://x.supabase.co/")
    assert public_url("recipes/a.webp") == (
        "https://x.supabase.co/storage/v1/object/public/recipe-photos/recipes/a.webp"
    )
    assert public_url(None) is None


def test_to_webp_stores_4_by_3_at_1200x900():
    for size in [(1536, 1152), (1536, 1024)]:  # a 3:2 image is centre-cropped
        png = io.BytesIO()
        Image.new("RGB", size, "orange").save(png, "PNG")
        with Image.open(io.BytesIO(to_webp(png.getvalue()))) as img:
            assert img.format == "WEBP" and img.size == STORED_SIZE == (1200, 900)
