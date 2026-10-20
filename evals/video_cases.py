"""Deterministic generator for the video-import eval: spoken cooking videos, written here.

Each case is what a person would upload: the creator's speech (turned into audio once with
OpenAI text-to-speech by `evals.video_audio` and committed), the text shown on screen in 4
frames (drawn by the eval at run time), and the post link and caption when there is one. The
cases: clear spoken amounts with an intro and a sponsor read, vague amounts ("a glug of olive
oil"), speech over background music, fast speech, amounts shown only on screen, and a video
that is not a recipe. Labels per ingredient line: the acceptable food keys, the amount as
stated (None when the video only gives a vague one, which the import must flag, not pass off
as stated). Expected allergens are derived from the foods.

    uv run python -m evals.video_cases         # rewrite evals/data/video_cases.json
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

from pantrio.foods import load_foods, to_grams
from pantrio.schema import Unit

OUT = Path(__file__).parent / "data" / "video_cases.json"
AUDIO = Path(__file__).parent / "data" / "video_audio"
SPONSOR_MARKERS = ("FreshBox", "CHEF20", "KitchenPro")  # must never reach a draft


@dataclass
class Case:
    id: str
    kind: str  # clear | vague | music | fast | on-screen | not-recipe
    title: str
    servings: int
    minutes: int
    script: str  # what the creator says
    # (line, acceptable food keys, stated amount as (quantity, unit) or None when vague)
    lines: list[tuple[str, tuple[str, ...], tuple[float, str] | None]] = field(default_factory=list)
    frames: list[list[str]] = field(default_factory=lambda: [[], [], [], []])  # on-screen text
    caption: str = ""
    voice: str = "coral"
    speed: float = 1.0
    music: bool = False


CASES = [
    Case("video-clear-prawns", "clear", "Garlic Butter Prawns", 2, 15, (
        "Hey guys, welcome back to the channel! Before we start, this video is sponsored by "
        "FreshBox meal kits. Use code CHEF20 for twenty percent off your first box. Okay, "
        "garlic butter prawns. Serves two, ready in fifteen minutes. You need three hundred "
        "grams of raw prawns, thirty grams of butter, four cloves of garlic, one tablespoon of "
        "lemon juice and two tablespoons of chopped parsley. Melt the butter in a pan over a "
        "medium heat. Add the garlic and cook for one minute. Add the prawns and cook for two "
        "minutes on each side until they turn pink. Squeeze in the lemon juice, toss with the "
        "parsley and serve straight away. Don't forget to like and subscribe!"
    ), [
        ("300 g raw prawns", ("prawns",), (300, "g")),
        ("30 g butter", ("butter",), (30, "g")),
        ("4 cloves garlic", ("garlic",), (4, "piece")),
        ("1 tbsp lemon juice", ("lemon_juice", "lemon"), (1, "tbsp")),
        ("2 tbsp chopped parsley", ("parsley",), (2, "tbsp")),
    ], frames=[["GARLIC BUTTER PRAWNS"], [], ["15 MINUTES"], []],
        caption="Garlic butter prawns in 15 minutes 🍤🧈 #dinner #seafood #fyp"),
    Case("video-vague-aglio-olio", "vague", "Spaghetti Aglio e Olio", 2, 15, (
        "This is the pasta I make when the fridge is empty. Spaghetti aglio e olio, enough for "
        "two. Get two hundred grams of spaghetti into well salted boiling water. While that "
        "cooks, a really good glug of olive oil goes into a cold pan with four cloves of "
        "garlic, thinly sliced. Bring it up slowly so the garlic goes golden, not brown. Then "
        "some chilli flakes, however hot you like it. Scoop out a mug of pasta water, drain "
        "the spaghetti and toss it in the pan with a splash of that water until it's glossy. "
        "Finish with a handful of chopped parsley. Fifteen minutes, done."
    ), [
        ("200 g spaghetti", ("pasta",), (200, "g")),
        ("a good glug of olive oil", ("olive_oil",), None),
        ("4 cloves garlic, thinly sliced", ("garlic",), (4, "piece")),
        ("some chilli flakes", ("chilli", "chilli_powder", "cayenne"), None),
        ("a handful of chopped parsley", ("parsley",), None),
    ], frames=[["AGLIO E OLIO"], [], [], []],
        caption="Full recipe in the video 🍝 #pasta #budget #fyp", voice="ash"),
    Case("video-music-shakshuka", "music", "Shakshuka", 2, 30, (
        "Shakshuka for two, about thirty minutes. Heat one tablespoon of olive oil in a frying "
        "pan. Add one diced onion and one sliced red pepper and cook for eight minutes until "
        "soft. Stir in two cloves of garlic, one teaspoon of ground cumin and one teaspoon of "
        "paprika for a minute. Pour in one four hundred gram can of chopped tomatoes and "
        "simmer for ten minutes. Make four little wells, crack an egg into each, cover and "
        "cook for six to eight minutes until the whites are set."
    ), [
        ("1 tbsp olive oil", ("olive_oil",), (1, "tbsp")),
        ("1 onion, diced", ("onion",), (1, "piece")),
        ("1 red pepper, sliced", ("red_bell_pepper",), (1, "piece")),
        ("2 cloves garlic", ("garlic",), (2, "piece")),
        ("1 tsp ground cumin", ("cumin",), (1, "tsp")),
        ("1 tsp paprika", ("paprika",), (1, "tsp")),
        ("400 g can chopped tomatoes", ("canned_tomatoes",), (400, "g")),
        ("4 eggs", ("egg",), (4, "piece")),
    ], music=True, voice="sage"),
    Case("video-fast-peanut-noodles", "fast", "Peanut Noodles", 2, 15, (
        "Peanut noodles, two servings, fifteen minutes, let's go. Cook two hundred grams of "
        "rice noodles. Sauce: three tablespoons of peanut butter, two tablespoons of soy "
        "sauce, one tablespoon of sesame oil, one tablespoon of lime juice and one tablespoon "
        "of honey, whisk it with a splash of the noodle water. Toss the noodles in the sauce "
        "and top with two sliced spring onions. That's it, that's the recipe."
    ), [
        ("200 g rice noodles", ("rice_noodles",), (200, "g")),
        ("3 tbsp peanut butter", ("peanut_butter",), (3, "tbsp")),
        ("2 tbsp soy sauce", ("soy_sauce",), (2, "tbsp")),
        ("1 tbsp sesame oil", ("sesame_oil",), (1, "tbsp")),
        ("1 tbsp lime juice", ("lime_juice", "lime"), (1, "tbsp")),
        ("1 tbsp honey", ("honey",), (1, "tbsp")),
        ("2 spring onions, sliced", ("spring_onion",), (2, "piece")),
    ], speed=1.6, voice="ballad"),
    Case("video-onscreen-pancakes", "on-screen", "Fluffy Pancakes", 4, 20, (
        "Sunday pancakes! Flour into the bowl, then the sugar and the baking powder. Make a "
        "well, crack in the egg, pour in the milk and whisk until it's smooth. Melt the butter "
        "in a pan over a medium heat, add a small ladle of batter and cook until bubbles "
        "appear, about two minutes. Flip and give it one more minute. Keep going until the "
        "batter's gone."
    ), [
        ("125 g plain flour", ("plain_flour",), (125, "g")),
        ("1 tbsp sugar", ("sugar",), (1, "tbsp")),
        ("2 tsp baking powder", ("baking_powder",), (2, "tsp")),
        ("1 egg", ("egg",), (1, "piece")),
        ("250 ml milk", ("milk",), (250, "ml")),
        ("15 g butter", ("butter",), (15, "g")),
    ], frames=[
        ["FLUFFY PANCAKES", "Serves 4 · 20 min"],
        ["125 g plain flour", "1 tbsp sugar", "2 tsp baking powder"],
        ["1 egg", "250 ml milk"],
        ["15 g butter for the pan"],
    ], voice="verse"),
    Case("video-not-recipe", "not-recipe", "", 0, 0, (
        "Today I'm reviewing the new KitchenPro stand mixer. It's got a five litre bowl, ten "
        "speeds and it comes in six colours. I've used it for a month: bread dough, cake "
        "batter, whipping egg whites. It's quieter than my old one but the bowl is heavy. Is "
        "it worth the money? Honestly, if you bake every week, yes. Let me know in the "
        "comments what you'd like me to review next."
    ), frames=[["KITCHENPRO REVIEW"], [], ["WORTH IT?"], []], voice="echo"),
]  # fmt: skip


def expected_line(text: str, foods: tuple[str, ...], amount) -> dict:
    grams = None
    if amount is not None:
        grams = round(to_grams(foods[0], amount[0], Unit(amount[1])), 1)
    return {"text": text, "foods": list(foods), "amount": list(amount) if amount else None,
            "grams": grams, "vague": amount is None}  # fmt: skip


def generate() -> list[dict]:
    table = load_foods()
    out = []
    for n, c in enumerate(CASES):
        allergens = sorted(set().union(set(), *(table[f[0]].allergens for _, f, _ in c.lines)))
        out.append({
            "id": c.id,
            "kind": c.kind,
            "url": f"https://www.tiktok.com/@pantrio.eval/video/{7_400_000_000_000_000_000 + n}",
            "caption": c.caption,
            "script": c.script,
            "tts": {"voice": c.voice, "speed": c.speed, "music": c.music},
            "frames": c.frames,
            "expect": {
                "is_recipe": c.kind != "not-recipe",
                "title": c.title,
                "servings": c.servings,
                "minutes": c.minutes,
                "lines": [expected_line(*line) for line in c.lines],
                "allergens": [str(a) for a in allergens],
            },
        })  # fmt: skip
    return out


def render(cases: list[dict]) -> str:
    return json.dumps(cases, indent=2, ensure_ascii=False) + "\n"


def load_cases(path: Path = OUT) -> list[dict]:
    return json.loads(path.read_text())


if __name__ == "__main__":
    OUT.write_text(render(generate()))
    print(f"wrote {len(CASES)} cases to {OUT}")
