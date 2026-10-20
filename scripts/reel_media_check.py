"""Compare Apify actors that turn a reel link into a video link (step 0 of reel audio).

For each post link, runs the actor once with Apify's `run-sync-get-dataset-items` endpoint and
prints the run time, the caption and handle it returns, and every field that looks like a video
link; then requests that video link and prints only its status, content type and size (the
video is not saved). No OpenAI call. Needs `APIFY_TOKEN` in `.env` (sent as a header, never
printed). Each run is billed to the Apify account (a fraction of a cent on the free tier).

    uv run python scripts/reel_media_check.py --actor apify~instagram-scraper \\
        --input '{"directUrls": ["{url}"], "resultsType": "posts", "resultsLimit": 1}' \\
        https://www.instagram.com/reel/Dclv5Rgizvm/ [more links]

`--input` is the actor's input as JSON with `{url}` where the post link goes (each actor names
its fields differently; see its page on apify.com). The actor id uses `~` for `/`.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time

import httpx

from pantrila import config  # noqa: F401  (loads .env)

API = "https://api.apify.com/v2/acts/{actor}/run-sync-get-dataset-items"
VIDEO_HINTS = ("video", "mp4", "media", "download")


def video_fields(item, path: str = "") -> list[tuple[str, str]]:
    """(field path, value) for every string that looks like a video link."""
    found = []
    if isinstance(item, dict):
        for key, value in item.items():
            found += video_fields(value, f"{path}.{key}" if path else key)
    elif isinstance(item, list):
        for n, value in enumerate(item[:10]):
            found += video_fields(value, f"{path}[{n}]")
    elif (
        isinstance(item, str)
        and item.startswith("http")
        and (any(h in path.lower() for h in VIDEO_HINTS) or ".mp4" in item)
    ):
        found.append((path, item))
    return found


def probe(url: str) -> None:
    """Status, type and size of a video link, read without saving it."""
    start = time.perf_counter()
    try:
        with httpx.stream("GET", url, follow_redirects=True, timeout=30) as r:
            size = 0
            for chunk in r.iter_bytes():
                size += len(chunk)
            kind = r.headers.get("content-type", "-")
            print(f"      fetch: {r.status_code} {kind}, {size / 1e6:.1f} MB, "
                  f"{time.perf_counter() - start:.1f} s, host {r.url.host}")  # fmt: skip
    except httpx.HTTPError as exc:
        print(f"      fetch failed: {type(exc).__name__}: {exc}")


def check(actor: str, template: str, link: str, token: str) -> None:
    print(f"== {actor}: {link}")
    body = json.loads(template.replace("{url}", link))
    start = time.perf_counter()
    try:
        r = httpx.post(API.format(actor=actor), json=body, timeout=120,
                       headers={"Authorization": f"Bearer {token}"})  # fmt: skip
    except httpx.HTTPError as exc:
        print(f"   failed: {type(exc).__name__}: {exc}")
        return
    seconds = time.perf_counter() - start
    print(f"   run: {r.status_code}, {seconds:.1f} s")
    try:
        items = r.json()
    except ValueError:
        print(f"   body: {' '.join(r.text.split())[:300]}")
        return
    if not isinstance(items, list) or not items:
        print(f"   no items: {json.dumps(items)[:300]}")
        return
    item = items[0]
    print(f"   items: {len(items)}; keys: {', '.join(item) if isinstance(item, dict) else '-'}")
    for key in ("caption", "text", "description", "ownerUsername", "username", "author",
                "videoDuration", "duration"):  # fmt: skip
        if isinstance(item, dict) and key in item:
            print(f"   {key}: {' '.join(str(item[key]).split())[:160]!r}")
    links = video_fields(item)
    if not links:
        print("   no video link found")
    for path, url in links[:3]:
        print(f"   {path}: {url[:120]}{'...' if len(url) > 120 else ''}")
        probe(url)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--actor", required=True, help="e.g. apify~instagram-scraper")
    parser.add_argument("--input", required=True, help="actor input JSON with {url}")
    parser.add_argument("links", nargs="+")
    args = parser.parse_args()
    token = os.environ.get("APIFY_TOKEN")
    if not token:
        sys.exit("APIFY_TOKEN is not set (put it in .env)")
    for link in args.links:
        check(args.actor, args.input, link, token)


if __name__ == "__main__":
    main()
