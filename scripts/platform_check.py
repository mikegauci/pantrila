"""Check which platforms let Pantrio read a post's caption (plan step 1 of social import).

Runs the real `social.fetch_post` (Pantrio's own user agent, the same guards as the app) on one
post per platform and prints what came back, or the message the person would see. No model
call, nothing saved. Run it where the platforms are reachable (not the cloud container):

    uv run python scripts/platform_check.py                       # the default posts
    uv run python scripts/platform_check.py <post link> [...]     # e.g. an Instagram reel
"""

from __future__ import annotations

import sys
from urllib.parse import quote

import httpx

from pantrio.recipe_import import USER_AGENT, ImportFailed
from pantrio.social import clean_url, detect, fetch_post

DEFAULT_POSTS = [
    "https://www.tiktok.com/@jose.elcook/video/7448169436764212510",
    "https://www.facebook.com/buzzfeedtasty/videos/"
    "one-pot-swedish-meatball-pastaprint-recipe-httpbzfdit1vthgfv/1746461835606458/",
]


def raw_oembed(url: str) -> None:
    """What TikTok's oEmbed endpoint answers Pantrio's user agent, redirects included."""
    oembed = f"https://www.tiktok.com/oembed?url={quote(clean_url(url, 'tiktok'), safe='')}"
    r = httpx.get(oembed, headers={"User-Agent": USER_AGENT}, timeout=10)
    print(f"   oEmbed: {r.status_code} {r.headers.get('content-type', '-')}, "
          f"{len(r.history)} redirect(s) -> {r.url}")  # fmt: skip
    try:
        data = r.json()
    except ValueError:
        print(f"   body: {' '.join(r.text.split())[:200]}")
        return
    print(f"   keys: {', '.join(data) if isinstance(data, dict) else type(data).__name__}")
    for key, value in data.items() if isinstance(data, dict) else []:
        if key != "html":
            print(f"   {key}: {' '.join(str(value).split())[:200]!r}")
    if isinstance(data, dict) and "html" in data:
        print(f"   html (start): {' '.join(str(data['html']).split())[:400]}")


def check(url: str) -> None:
    print(f"== {detect(url) or 'not a post link'}: {url}")
    try:
        post = fetch_post(url)
    except ImportFailed as exc:
        print(f"   BLOCKED: {exc}")
        cause = exc.__cause__
        while cause is not None:  # why: the HTTP status, a redirect, unreadable JSON...
            print(f"   because: {type(cause).__name__}: {cause}")
            cause = cause.__cause__
        if detect(url) == "tiktok":
            raw_oembed(url)
        return
    caption = " ".join(post.caption.split())
    print(f"   OK: @{post.handle or '?'} | saved as {post.url}")
    print(f"   caption: {caption[:300]}{'…' if len(caption) > 300 else ''}")


if __name__ == "__main__":
    for link in sys.argv[1:] or DEFAULT_POSTS:
        check(link)
