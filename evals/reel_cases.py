"""Deterministic generator for the reel eval: post links whose caption alone may not hold the
recipe, paired with the spoken video the service would find (reel audio from a link).

Each case is a post link (Instagram, TikTok or Facebook) with its caption (written here, not
copied; a TikTok link alone gets its caption from the service). Where the
video matters, its sound is one of the committed video-eval WAVs (`evals/data/video_audio/`) and
its frames are drawn from that case's on-screen text; a fake service hands them over, so no real
service runs in the eval. The cases: a caption that lists the ingredients with amounts but leaves
the method to the video (the owner's test reel had this shape), a "comment for the recipe"
caption over a fully spoken recipe, a caption with the full recipe (the service must not run),
a caption linking a recipe site (the site wins, the service must not run), and a video that is
not a recipe. Expected allergens are derived from the foods.

    uv run python -m evals.reel_cases          # rewrite evals/data/reel_cases.json
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

from evals.video_cases import CASES as VIDEOS
from pantrila.foods import load_foods

OUT = Path(__file__).parent / "data" / "reel_cases.json"
SITE = "https://pantrila-eval.example/peanut-noodles"


@dataclass
class Case:
    id: str
    kind: str  # ingredients-only | comment-recipe | full-caption | linked-site | not-recipe |
    # no-caption (a TikTok link alone: the caption comes from the service)
    caption: str
    video: str | None  # the video-eval case whose sound and frames the service finds
    service_calls: int  # with the service on
    lines: list[tuple[str, tuple[str, ...], tuple[float, str] | None]] | None = None
    title: str = ""
    page: str | None = None  # the linked site's HTML
    platform: str = "instagram"
    service_caption: str | None = None  # the caption the service reads (TikTok shares none)


def video(case_id: str):
    return next(c for c in VIDEOS if c.id == case_id)


PEANUT = video("video-fast-peanut-noodles")
PEANUT_PAGE = (
    '<html><head><title>Peanut noodles</title><script type="application/ld+json">'
    + json.dumps(
        {
            "@context": "https://schema.org",
            "@type": "Recipe",
            "name": "Peanut Noodles",
            "recipeYield": "2",
            "totalTime": "PT15M",
            "recipeIngredient": [line for line, _, _ in PEANUT.lines],
            "recipeInstructions": [
                "Cook the rice noodles.",
                "Whisk the peanut butter, soy sauce, sesame oil, lime juice and honey with a "
                "splash of the noodle water.",
                "Toss the noodles in the sauce and top with the spring onions.",
            ],
        }
    )  # fmt: skip
    + "</script></head><body><h1>Peanut noodles</h1></body></html>"
)
SHAKSHUKA = video("video-music-shakshuka")

CASES = [
    Case("reel-ingredients-only", "ingredients-only", (
        "Spaghetti aglio e olio 🍝🧄 my empty-fridge pasta, serves 2\n\n"
        "200 g spaghetti\n4 tbsp olive oil\n4 cloves garlic, thinly sliced\n"
        "1 tsp chilli flakes\n10 g parsley, chopped\n\n"
        "Method in the video 👆 #pasta #budget #fyp"
    ), "video-vague-aglio-olio", 1, [
        ("200 g spaghetti", ("pasta",), (200, "g")),
        ("4 tbsp olive oil", ("olive_oil",), (4, "tbsp")),
        ("4 cloves garlic", ("garlic",), (4, "piece")),
        ("1 tsp chilli flakes", ("chilli", "chilli_powder", "cayenne"), (1, "tsp")),
        ("10 g parsley", ("parsley",), (10, "g")),
    ], "Spaghetti Aglio e Olio"),
    Case("reel-comment-recipe", "comment-recipe", (
        "Garlic butter prawns in 15 minutes 🍤🧈 Comment PRAWNS and I'll send you the recipe! "
        "#dinner #seafood"
    ), "video-clear-prawns", 1, video("video-clear-prawns").lines, "Garlic Butter Prawns"),
    Case("reel-full-caption", "full-caption", (
        "Shakshuka for two 🍳 30 min\n\n" + "\n".join(line for line, _, _ in SHAKSHUKA.lines)
        + "\n\nCook the onion and pepper in the oil for 8 min. Add the garlic, cumin and paprika "
        "for 1 min. Add the tomatoes and simmer 10 min. Make 4 wells, crack in the eggs, cover "
        "and cook 6-8 min. #brunch"
    ), "video-music-shakshuka", 0, SHAKSHUKA.lines, "Shakshuka"),
    Case("reel-linked-site", "linked-site", (
        "Peanut noodles in 15 min 🥜🍜 Recipe: pantrila-eval.example/peanut-noodles #noodles"
    ), "video-fast-peanut-noodles", 0, PEANUT.lines, "Peanut Noodles", PEANUT_PAGE),
    Case("reel-not-recipe", "not-recipe", "New toy in the kitchen 😍 #kitchen #mixer",
         "video-not-recipe", 1),
    Case("reel-tiktok-no-caption", "no-caption", "", "video-fast-peanut-noodles", 1,
         PEANUT.lines, "Peanut Noodles", platform="tiktok",
         service_caption="Peanut noodles 🥜 15 min, the method's in the video #noodles #fyp"),
    Case("reel-facebook-comment-recipe", "comment-recipe",
         "Shakshuka for two 🍳🌶️ Comment EGGS and I'll message you the recipe!",
         "video-music-shakshuka", 1, SHAKSHUKA.lines, "Shakshuka", platform="facebook"),
]  # fmt: skip

URLS = {
    "instagram": "https://www.instagram.com/reel/PantrilaEval{n}/",
    "tiktok": "https://www.tiktok.com/@pantrila.eval/video/74100000000000000{n:02d}",
    "facebook": "https://www.facebook.com/pantrila.eval/videos/{n}/",
}


def generate() -> list[dict]:
    table = load_foods()
    out = []
    for n, c in enumerate(CASES):
        lines = c.lines or []
        allergens = sorted(set().union(set(), *(table[f[0]].allergens for _, f, _ in lines)))
        out.append({
            "id": c.id,
            "kind": c.kind,
            "platform": c.platform,
            "url": URLS[c.platform].format(n=n),
            "caption": c.caption,
            "service_caption": c.service_caption,
            "video": c.video,
            "page": {"url": SITE, "html": c.page} if c.page else None,
            "expect": {
                "is_recipe": c.lines is not None,
                "title": c.title,
                "service_calls": c.service_calls,
                "lines": [{"text": t, "foods": list(f), "amount": list(a) if a else None,
                           "vague": a is None} for t, f, a in lines],  # fmt: skip
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
