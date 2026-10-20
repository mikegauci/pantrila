"""Recipe posts on TikTok, Instagram and Facebook: which links are posts, and their captions.

Pantrio reads only what a post shares publicly as text: the caption and the creator's handle.
TikTok's public oEmbed endpoint (no key) gives the caption and handle on some posts and only
the player on others; then the post page's Open Graph tags are tried. Instagram and Facebook
pages carry the caption in their Open Graph tags when they let a client read them at all.
Every request goes through `recipe_import.fetch_page` (SSRF guards, size and time caps,
Pantrio's own user agent: never a spoofed browser or crawler). Videos are never downloaded, stored or embedded. When a
platform refuses, the person pastes the caption instead.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from html.parser import HTMLParser
from urllib.parse import parse_qsl, quote, urlencode, urlsplit, urlunsplit

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
# Facebook pages that are never a post: sign-in walls and browser notices.
FACEBOOK_NOT_POST = re.compile(r"^/(?:login|checkpoint|unsupportedbrowser|recover|r\.php)")
FACEBOOK_ID_KEYS = ("v", "story_fbid", "fbid", "id")  # the query keys that name a post
FACEBOOK_LOGIN_TEXT = re.compile(  # a sign-in wall's text, which mentions Facebook itself
    r"\b(?:log ?in|log into|sign up)\b[^.]*\bfacebook\b|\bfacebook\b[^.]*\b(?:log ?in|sign up)\b",
    re.IGNORECASE,
)
TIKTOK_POST = re.compile(r"^/(?:@[A-Za-z0-9._]+/(?:video|photo)/\d+|t/[A-Za-z0-9]+)")
INSTAGRAM_POST = re.compile(r"^/(?:[A-Za-z0-9._]+/)?(?:p|reel|reels|tv)/[A-Za-z0-9_-]+")
# First path segments on Facebook that are not a page or person.
FACEBOOK_RESERVED = {"watch", "reel", "reels", "share", "story.php", "permalink.php", "photo",
                     "photo.php", "groups", "videos", "video.php", "events", "marketplace",
                     "profile.php", "people", "login", "hashtag", "pages", "plugins"}  # fmt: skip
# Links a caption may carry that never lead to a recipe page Pantrio can read: the platforms
# themselves, link-in-bio pages and shops. Short links (bit.ly, bzfd.it) are kept: fetch_page
# checks every redirect, and creators often link their recipe that way ("PRINT RECIPE:
# bzfd.it/…" on Tasty's Facebook posts).
SKIP_HOSTS = {
    *TIKTOK_HOSTS, *INSTAGRAM_HOSTS, *FACEBOOK_HOSTS, "youtube.com", "youtu.be", "x.com",
    "twitter.com", "pinterest.com", "pin.it", "threads.net", "snapchat.com", "linktr.ee",
    "lnk.bio", "beacons.ai", "linkin.bio", "bio.link", "stan.store", "amzn.to", "liketk.it",
    "shopmy.us",
}  # fmt: skip
SKIP_SITES = re.compile(r"(?:^|\.)amazon\.[a-z.]+$")  # every Amazon country site
# A domain written without http(s):// counts as a link only when it is lowercase and has a
# path ("site.com/pasta") or a common website ending, so "together.It's" or "sauce.then" in a
# run-on caption is not taken for a website.
BARE_TLDS = ("com", "co.uk", "org", "net", "com.au", "co.nz", "blog", "kitchen", "recipes",
             "food", "cooking")  # fmt: skip
_LINK = re.compile(
    r"(?<![@\w.])(?:https?://[^\s<>\"']+|(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+"
    r"[a-z]{2,}(?:\.[a-z]{2})?(?![\w-])(?:/[^\s<>\"']*)?)",
    re.IGNORECASE,
)
_BARE_OK = re.compile(
    r"^(?:www\.[a-z0-9.-]+|[a-z0-9.-]+/.*|[a-z0-9.-]+\.(?:"
    + "|".join(re.escape(t) for t in BARE_TLDS)
    + r"))$",
    re.S,
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
        short = host in {"vm.tiktok.com", "vt.tiktok.com"}
        return "tiktok" if short or TIKTOK_POST.match(path) else None
    if host in INSTAGRAM_HOSTS:
        return "instagram" if INSTAGRAM_POST.match(path) else None
    if host in FACEBOOK_HOSTS:
        return None if FACEBOOK_NOT_POST.match(path) or path in ("", "/") else "facebook"
    return None


NOT_A_POST = "That's a profile or page, not a post. Open the post and copy its link."


def platform_page(url: str) -> bool:
    """A TikTok, Instagram or Facebook link that is not a post (a profile, a sign-in page)."""
    host = _host(with_scheme(url))
    return detect(url) is None and host in TIKTOK_HOSTS | INSTAGRAM_HOSTS | FACEBOOK_HOSTS


def is_short_link(url: str) -> bool:
    """Links that only redirect to a post: the post URL is known after following them."""
    host, path = _host(url), urlsplit(url).path
    return (host in {"vm.tiktok.com", "vt.tiktok.com", "fb.watch"}
            or (host in TIKTOK_HOSTS and path.startswith("/t/"))
            or (host in FACEBOOK_HOSTS and path.startswith("/share/")))  # fmt: skip


def clean_url(url: str, platform: Platform) -> str:
    """The post link to keep: no tracking query (Facebook keeps only the keys that name the
    post, such as ?v= or ?story_fbid=), never a fragment."""
    parts = urlsplit(with_scheme(url))
    query = ""
    if platform == "facebook":
        kept = [(k, v) for k, v in parse_qsl(parts.query) if k in FACEBOOK_ID_KEYS]
        query = urlencode(kept)
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


def _trim(link: str) -> str:
    """Drop trailing punctuation, keeping a closing bracket the link itself opened."""
    while link and link[-1] in ".,;:!?)]}\"'…":
        if link[-1] == ")" and link.count("(") >= link.count(")"):
            break
        link = link[:-1]
    return link


def skipped(host: str) -> bool:
    """A platform, link-in-bio page or shop: never a recipe page to read."""
    return any(host == h or host.endswith(f".{h}") for h in SKIP_HOSTS) or bool(
        SKIP_SITES.search(host)
    )


def caption_links(caption: str) -> list[str]:
    """Website links in a caption, in order, as https URLs; skips the social platforms,
    link-in-bio pages and shops."""
    out: list[str] = []
    for match in _LINK.finditer(caption):
        link = _trim(match.group(0))
        if not re.match(r"https?://", link, re.IGNORECASE) and not _BARE_OK.match(link):
            continue  # "together.It", "min.Me": words, not a website
        url = with_scheme(link)
        host = _host(url)
        if not host or skipped(host):
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
# Long captions are cut short, sometimes without the closing quote.
_IG_DESCRIPTION = re.compile(
    r"-\s*([A-Za-z0-9._]{1,30}) on [^:]+:\s*[\"“](.*?)(?:[\"”]\s*\.?)?\s*$", re.S
)
_QUOTED = re.compile(r":\s*[\"“](.*?)(?:[\"”])?\s*$", re.S)


def instagram_caption(meta: dict[str, str]) -> tuple[str | None, str]:
    """(handle, caption) from an Instagram page's Open Graph tags."""
    description, title = meta.get("og:description", ""), meta.get("og:title", "")
    if m := _IG_DESCRIPTION.search(description):
        return m.group(1), m.group(2).strip()
    if m := _QUOTED.search(title):
        return None, m.group(1).strip()
    return None, ""


def facebook_caption(meta: dict[str, str]) -> str:
    """The post text Facebook puts in og:description (cut short on long posts). og:title is
    only the page or person's name, and a sign-in wall's text is no caption: both give ''."""
    text = meta.get("og:description", "").strip()
    return "" if FACEBOOK_LOGIN_TEXT.search(text) and len(text) < 200 else text


def tiktok_caption(meta: dict[str, str]) -> str:
    """The caption from a TikTok post page's preview tags; '' for TikTok's generic text."""
    text = (meta.get("og:description") or meta.get("description") or "").strip()
    return "" if text.lower().startswith(("tiktok - make your day", "watch more")) else text


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
            if is_short_link(url):  # follow the redirects only as far as the post's URL
                url, _ = recipe_import.fetch_page(
                    url,
                    http,
                    resolve,
                    stop=lambda u: detect(u) == "tiktok" and not is_short_link(u),
                )
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
            if not caption.strip():  # oEmbed now often sends only the player: try the page
                final_url, html = recipe_import.fetch_page(post_url, http, resolve)
                if detect(final_url) != platform:
                    raise ImportFailed(blocked)
                caption = tiktok_caption(meta_tags(html))
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
