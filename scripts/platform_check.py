"""Check which platforms let Pantrio read a post's caption (plan step 1 of social import).

Runs the real `social.fetch_post` (Pantrio's own user agent, the same guards as the app) on one
post per platform and prints what came back, or the message the person would see. No model
call, nothing saved. Run it where the platforms are reachable (not the cloud container):

    uv run python scripts/platform_check.py                       # the default posts
    uv run python scripts/platform_check.py <post link> [...]     # e.g. an Instagram reel
"""

from __future__ import annotations

import sys

from pantrio.recipe_import import ImportFailed
from pantrio.social import detect, fetch_post

DEFAULT_POSTS = [
    "https://www.tiktok.com/@jose.elcook/video/7448169436764212510",
    "https://www.facebook.com/buzzfeedtasty/videos/"
    "one-pot-swedish-meatball-pastaprint-recipe-httpbzfdit1vthgfv/1746461835606458/",
]


def check(url: str) -> None:
    print(f"== {detect(url) or 'not a post link'}: {url}")
    try:
        post = fetch_post(url)
    except ImportFailed as exc:
        print(f"   BLOCKED: {exc}")
        return
    caption = " ".join(post.caption.split())
    print(f"   OK: @{post.handle or '?'} | saved as {post.url}")
    print(f"   caption: {caption[:300]}{'…' if len(caption) > 300 else ''}")


if __name__ == "__main__":
    for link in sys.argv[1:] or DEFAULT_POSTS:
        check(link)
