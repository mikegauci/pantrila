"""Recipe posts on TikTok, Instagram and Facebook: which links are posts, and their captions.

Pantrio reads only what a post shares publicly as text: the caption and the creator's handle.
TikTok answers its public oEmbed endpoint (no key); Instagram and Facebook pages carry the
caption in their Open Graph tags when they let a client read them at all. Every request goes
through `recipe_import.fetch_page` (SSRF guards, size and time caps, Pantrio's own user agent:
never a spoofed browser or crawler). Videos are never downloaded, stored or embedded. When a
platform refuses, the person pastes the caption instead.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from html.parser import HTMLParser
from urllib.parse import quote, urlsplit, urlunsplit

from pantrio import recipe_import
from pantrio.cookbook import HANDLE, Platform
from pantrio.recipe_import import ImportFailed, Resolver, resolve_host

NAMES: dict[str, str] = {"tiktok": "TikTok", "instagram": "Instagram", "facebook": "Facebook"}
MAX_CAPTION_CHARS = 10_000
MAX_CAPTION_LINKS = 3  # pages tried (free fetches); at most one is read by the model

TIKTOK_HOSTS = {"tiktok.com", "www.tiktok.com", "m.tiktok.com", "vm.tiktok.com", "vt.tiktok.com"}
INSTAGRAM_HOSTS = {"instagram.com", "www.instagram.com", "m.instagram.com"}
FACEBOOK_HOSTS = {"facebook.com", "www.facebook.com", "m.facebook.com", "web.facebook.com",
                  "fb.watch", "fb.com", "www.fb.com"}  # fmt: skip
FACEBOOK_LOGIN = re.compile(r"^/(?:login|checkpoint)")
INSTAGRAM_POST = re.compile(r"^/(?:[A-Za-z0-9._]+/)?(?:p|reel|reels|tv)/[A-Za-z0-9_-]+")
# First path segments on Facebook that are not a page or person.
FACEBOOK_RESERVED = {"watch", "reel", "reels", "share", "story.php", "permalink.php", "photo",
                     "photo.php", "groups", "videos", "video.php", "events", "marketplace",
                     "profile.php", "people", "login", "hashtag", "pages", "plugins"}  # fmt: skip
# Links a caption may carry that never lead to a recipe page Pantrio can read: the platforms
# themselves, link-in-bio pages and shorteners.
SKIP_HOSTS = {
    *TIKTOK_HOSTS, *INSTAGRAM_HOSTS, *FACEBOOK_HOSTS, "youtube.com", "youtu.be", "x.com",
    "twitter.com", "pinterest.com", "pin.it", "threads.net", "snapchat.com", "linktr.ee",
    "lnk.bio", "beacons.ai", "linkin.bio", "bio.link", "stan.store", "bit.ly", "tinyurl.com",
    "t.co", "ow.ly", "buff.ly", "rebrand.ly", "shorturl.at", "tiny.cc", "is.gd", "goo.gl",
    "amzn.to", "amazon.com", "liketk.it", "shopmy.us",
}  # fmt: skip
# Domains written without http(s):// count as links only with one of these endings, so
# "sauce.then" in a run-on caption is not taken for a website.
BARE_TLDS = ("com", "co.uk", "org", "net", "io", "co", "uk", "ie", "de", "fr", "it", "es",
             "nl", "au", "com.au", "ca", "nz", "co.nz", "us", "eu", "mt", "me", "blog",
             "kitchen", "recipes", "food", "cooking")  # fmt: skip
_LINK = re.compile(
    r"(?<![@\w.])(?:https?://[^\s<>\"']+|(?:www\.)?(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+"
    r"(?:" + "|".join(re.escape(t) for t in sorted(BARE_TLDS, key=len, reverse=True)) + r")"
    r"(?![a-z0-9-])(?:/[^\s<>\"']*)?)",
    re.IGNORECASE,
)

CAPTION_BLOCKED = "{platform} didn't let Pantrio read this post. Paste the caption below."
NO_RECIPE = (
    "The caption doesn't include the recipe. It may be in the video: paste the recipe text or "
    "add screenshots."
)


@dataclass
class Post:
    platform: Platform
    url: str  # the full post link (short links followed), without tracking parameters
    handle: str | None
    caption: str


def _host(url: str) -> str:
    return (urlsplit(url).hostname or "").lower()


def with_scheme(url: str) -> str:
    url = url.strip()
    return url if re.match(r"^[a-z][a-z0-9+.-]*://", url, re.IGNORECASE) else f"https://{url}"


def detect(url: str) -> Platform | None:
    """The platform a post link belongs to, or None for any other link."""
    host = _host(with_scheme(url))
    path = urlsplit(with_scheme(url)).path
    if host in TIKTOK_HOSTS:
        return "tiktok"
    if host in INSTAGRAM_HOSTS:
        return "instagram" if INSTAGRAM_POST.match(path) else None
    if host in FACEBOOK_HOSTS:
        return None if FACEBOOK_LOGIN.match(path) else "facebook"
    return None


def is_short_link(url: str) -> bool:
    """Links that only redirect to a post: the post URL is known after following them."""
    host, path = _host(url), urlsplit(url).path
    return (host in {"vm.tiktok.com", "vt.tiktok.com", "fb.watch"}
            or (host in TIKTOK_HOSTS and path.startswith("/t/"))
            or (host in FACEBOOK_HOSTS and path.startswith("/share/")))  # fmt: skip


def clean_url(url: str, platform: Platform) -> str:
    """The post link to keep: no tracking query on TikTok and Instagram (Facebook keeps its
    query, which can be the post id), never a fragment."""
    parts = urlsplit(with_scheme(url))
    query = parts.query if platform == "facebook" else ""
    return urlunsplit(("https", parts.netloc.lower(), parts.path, query, ""))


def clean_handle(value: str | None) -> str | None:
    """A creator handle Pantrio can show: letters, digits, dots and underscores, up to 30."""
    if not value:
        return None
    value = value.strip().lstrip("@")
    return value if HANDLE.fullmatch(value) else None


def handle_from_url(url: str, platform: Platform) -> str | None:
    segments = [s for s in urlsplit(url).path.split("/") if s]
    if not segments:
        return None
    first = segments[0]
    if platform == "tiktok":
        return clean_handle(first) if first.startswith("@") else None
    if platform == "instagram":
        return clean_handle(first) if first not in {"p", "reel", "reels", "tv"} else None
    return None if first.lower() in FACEBOOK_RESERVED else clean_handle(first)


def caption_links(caption: str) -> list[str]:
    """Website links in a caption, in order, as https URLs; skips the social platforms,
    link-in-bio pages and link shorteners."""
    out: list[str] = []
    for match in _LINK.finditer(caption):
        url = with_scheme(match.group(0).rstrip(".,;:!?)]}\"'…"))
        host = _host(url)
        if not host or host in SKIP_HOSTS or host.removeprefix("www.") in SKIP_HOSTS:
            continue
        if url not in out:
            out.append(url)
    return out


class _MetaParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.meta: dict[str, str] = {}

    def handle_starttag(self, tag, attrs):
        if tag != "meta":
            return
        a = dict(attrs)
        key = (a.get("property") or a.get("name") or "").lower()
        if key and a.get("content") and key not in self.meta:
            self.meta[key] = a["content"]


def meta_tags(html: str) -> dict[str, str]:
    parser = _MetaParser()
    parser.feed(html)
    return parser.meta


# Instagram: og:description is '12 likes, 3 comments - handle on May 1, 2026: "caption"' and
# og:title 'Name on Instagram: "caption"'.
_IG_DESCRIPTION = re.compile(
    r"-\s*([A-Za-z0-9._]{1,30}) on [^:]+:\s*[\"“](.*)[\"”]\s*\.?\s*$", re.S
)
_QUOTED = re.compile(r":\s*[\"“](.*)[\"”]\s*$", re.S)


def instagram_caption(meta: dict[str, str]) -> tuple[str | None, str]:
    """(handle, caption) from an Instagram page's Open Graph tags."""
    description, title = meta.get("og:description", ""), meta.get("og:title", "")
    if m := _IG_DESCRIPTION.search(description):
        return m.group(1), m.group(2).strip()
    if m := _QUOTED.search(title):
        return None, m.group(1).strip()
    return None, ""


def facebook_caption(meta: dict[str, str]) -> str:
    """Facebook puts the post text in og:description (cut short on long posts) and sometimes
    in og:title; the longer one wins."""
    texts = [meta.get("og:description", ""), meta.get("og:title", "")]
    return max((t.strip() for t in texts), key=len)


def fetch_post(url: str, http=None, resolve: Resolver = resolve_host) -> Post:
    """The post's caption and creator, read the way the platform publishes them. Raises
    `ImportFailed` asking for the pasted caption when the platform refuses or shows none."""
    platform = detect(url)
    if platform is None:
        raise ImportFailed("That is not a TikTok, Instagram or Facebook post link.")
    blocked = CAPTION_BLOCKED.format(platform=NAMES[platform])
    url = with_scheme(url)
    try:
        if platform == "tiktok":
            if is_short_link(url):
                url, _ = recipe_import.fetch_page(url, http, resolve)
            if detect(url) != platform:  # a short link that led somewhere else
                raise ImportFailed(blocked)
            post_url = clean_url(url, platform)
            oembed = f"https://www.tiktok.com/oembed?url={quote(post_url, safe='')}"
            _, body = recipe_import.fetch_page(oembed, http, resolve, kinds=("application/json",))
            data = json.loads(body)
            if not isinstance(data, dict):
                raise ImportFailed(blocked)
            caption = str(data.get("title") or "")
            handle = clean_handle(str(data.get("author_unique_id") or "")) or handle_from_url(
                post_url, platform
            )
        else:
            final_url, html = recipe_import.fetch_page(url, http, resolve)
            if detect(final_url) != platform:  # e.g. sent to a login page
                raise ImportFailed(blocked)
            post_url = clean_url(final_url, platform)
            meta = meta_tags(html)
            if platform == "instagram":
                handle, caption = instagram_caption(meta)
                handle = clean_handle(handle) or handle_from_url(post_url, platform)
            else:
                caption = facebook_caption(meta)
                handle = handle_from_url(post_url, platform)
    except ImportFailed as exc:
        if str(exc) == blocked:
            raise
        raise ImportFailed(blocked) from exc
    except ValueError as exc:  # unreadable JSON
        raise ImportFailed(blocked) from exc
    caption = caption.strip()[:MAX_CAPTION_CHARS]
    if not caption:
        raise ImportFailed(blocked)
    return Post(platform, post_url, handle, caption)


def pasted_post(url: str | None, caption: str) -> Post | None:
    """A post the person pasted the caption of: what the link alone says about it (no fetch).
    None without a post link."""
    platform = detect(url) if url else None
    if platform is None or url is None:
        return None
    post_url = clean_url(url, platform)
    return Post(platform, post_url, handle_from_url(post_url, platform), caption)
