"""Hear a post's video from its link: a third-party service finds the video, Pantrila reads it.

Instagram, Facebook and TikTok give apps like Pantrila no video on their public pages, so the
video link comes from a scraping service (Apify, one actor per platform;
`PANTRILA_MEDIA_SOURCE=apify`, off by default). Pantrila then fetches the video itself with the
same SSRF guards as any page (size and time capped), turns it into 16 kHz mono WAV and 4 JPEG
frames in memory with PyAV, and drops it. Nothing is written to disk or stored. Only public
posts; never a login or cookies. The Apify token is sent only to api.apify.com.

The same service reads a post's top comments (`COMMENT_ACTORS`) when the caption only says
"comment for the recipe": comments by the post's own creator are kept (a link one of them gives
is tried before the video, which costs more); everyone else's are dropped unread.
"""

from __future__ import annotations

import base64
import json
import os
import wave
from dataclasses import dataclass
from io import BytesIO
from typing import Protocol
from urllib.parse import urlsplit

from pantrila.recipe_import import (
    MAX_FRAMES,
    MAX_IMAGE_BYTES,
    MAX_VIDEO_S,
    ImportFailed,
    Resolver,
    fetch_bytes,
    resolve_host,
)

MAX_VIDEO_BYTES = 60_000_000  # a 90 s reel at 1080p is about 10-30 MB
VIDEO_FETCH_S = 30.0
VIDEO_TYPES = ("video/mp4", "video/quicktime", "video/webm", "audio/mp4",
               "application/octet-stream")  # fmt: skip
SERVICE_TIMEOUT_S = 60.0
FRAME_AT = (0.15, 0.40, 0.65, 0.90)
FRAME_PX = 1024  # longest side of a frame sent to the model
APIFY_RUN = "https://api.apify.com/v2/acts/{actor}/run-sync-get-dataset-items"
APIFY_HOST = "api.apify.com"  # the only host the token is ever sent to
TOO_BIG = "The post's video is too large to read."
TOO_LONG = "The post's video is over 3 minutes."


class MediaFailed(ImportFailed):
    """The service or the video let us down; the import falls back to the caption."""


@dataclass
class PostVideo:
    video_urls: list[str]  # best first: a video with pictures, then an audio-only track
    caption: str | None = None
    handle: str | None = None
    seconds: float | None = None  # the length the service reports


@dataclass
class VideoMedia:
    audio: bytes | None  # 16 kHz mono 16-bit WAV; None when the video has no sound
    seconds: float
    frames: list[str]  # JPEG data URLs


@dataclass
class CreatorComments:
    texts: list[str]  # the creator's own comments, in the order the service gives them
    fetched: int  # comments the service returned (and charged for), anyone's
    handle: str | None = None  # the creator's, as their comments name them


class MediaSource(Protocol):
    platforms: frozenset[str]  # social.Platform values this source covers
    comment_platforms: frozenset[str]  # platforms whose comments it can read

    def fee_for(self, platform: str) -> float | None:
        """What one service run costs on this platform; None if unknown."""
        ...

    def video_for(self, post_url: str, platform: str) -> PostVideo | None:
        """The post's video links and caption, or None when the service found nothing.
        Raises MediaFailed."""
        ...

    def headers_for(self, url: str) -> dict[str, str]:
        """Headers one of its video links needs (the service's own storage wants its token)."""
        ...

    def comment_fee_for(self, platform: str, fetched: int) -> float | None:
        """What one comments run costs for that many comments; None if unknown."""
        ...

    def creator_comments(self, post_url: str, platform: str, handle: str | None
                         ) -> CreatorComments:  # fmt: skip
        """The post creator's comments among its top ones. `handle` is the creator's when known
        (Instagram's comments do not say whose post it is). Raises MediaFailed."""
        ...


class NoMedia:
    platforms: frozenset[str] = frozenset()
    comment_platforms: frozenset[str] = frozenset()

    def fee_for(self, platform: str) -> float | None:
        return 0.0

    def video_for(self, post_url: str, platform: str) -> PostVideo | None:
        return None

    def headers_for(self, url: str) -> dict[str, str]:
        return {}

    def comment_fee_for(self, platform: str, fetched: int) -> float | None:
        return 0.0

    def creator_comments(self, post_url: str, platform: str, handle: str | None
                         ) -> CreatorComments:  # fmt: skip
        return CreatorComments([], 0)


@dataclass(frozen=True)
class Actor:
    """One Apify actor and where its result keeps what Pantrila needs (dotted paths; a number is
    a list index). Checked on 20 October 2026 with scripts/reel_media_check.py."""

    id: str
    input: str  # JSON with {url} where the post link goes
    fee_usd: float  # per result, as charged then
    videos: tuple[str, ...]  # best first
    caption: tuple[str, ...]
    handle: tuple[str, ...] = ()
    seconds: tuple[tuple[str, float], ...] = ()  # (path, factor to seconds)


ACTORS = {
    # Instagram's CDN video (pictures and sound), then its audio-only track (0.3 MB).
    "instagram": Actor(
        "apify~instagram-scraper",
        '{"directUrls": ["{url}"], "resultsType": "posts", "resultsLimit": 1}',
        0.0027, ("videoUrl", "audioUrl"), ("caption",), ("ownerUsername",),
        (("videoDuration", 1.0),),
    ),
    # TikTok's own links in the result are not the video: the actor stores it in Apify's
    # key-value store, fetched from api.apify.com with the token. Its caption is one TikTok's
    # oEmbed never gives Pantrila.
    "tiktok": Actor(
        "clockworks~tiktok-video-scraper",
        '{"postURLs": ["{url}"], "shouldDownloadVideos": true}',
        0.0043, ("mediaUrls.0",), ("text",), ("authorMeta.name",),
        (("videoMeta.duration", 1.0),),
    ),
    # Ordinary Facebook videos use root fields; shared reels nest their playback data.
    # Neither has an audio-only link: prefer the SD video, then HD.
    "facebook": Actor(
        "apify~facebook-posts-scraper",
        '{"startUrls": [{"url": "{url}"}], "resultsLimit": 1}',
        0.006,
        ("videoDeliveryLegacyFields.browser_native_sd_url",
         "short_form_video_context.playback_video.videoDeliveryLegacyFields.browser_native_sd_url",
         "videoDeliveryLegacyFields.browser_native_hd_url",
         "short_form_video_context.playback_video.videoDeliveryLegacyFields.browser_native_hd_url"),
        ("previewTitle", "text", "message.text"), ("user.name", "pageName"),
        (("playable_duration_in_ms", 0.001),
         ("short_form_video_context.video.playable_duration_in_ms", 0.001)),
    ),
}  # fmt: skip


COMMENT_LIMIT = 10  # comment actors charge per comment; a creator's link is usually near the top


@dataclass(frozen=True)
class CommentActor:
    """One Apify comments actor: where a comment's text and author are, and where (if anywhere)
    each comment names the post's owner. Handles are compared lower-case; a profile link counts
    as its first path segment. Checked on 21 October 2026 with scripts/reel_media_check.py
    (`--save`): Facebook comments carry the post page's `pageAdLibrary.uri_token`, TikTok's the
    post link (`/@handle/video/...`); Instagram's say nothing about the post, so the creator's
    handle must come from the caption fetch."""

    id: str
    input: str  # JSON with {url} and {limit}
    fee_usd: float  # per comment, as charged then (Apify's FREE tier)
    start_fee_usd: float  # per run
    text: str
    author: tuple[str, ...]
    owner: tuple[str, ...] = ()


COMMENT_ACTORS = {
    # Ranked comments (Facebook's "most relevant"): the creator's link was first of 50 on the
    # test reel. No author flag; the commenter's profile link vs the post page's name.
    "facebook": CommentActor(
        "apify~facebook-comments-scraper",
        '{"startUrls": [{"url": "{url}"}], "resultsLimit": {limit}, '
        '"includeNestedComments": false, "viewOption": "RANKED_UNFILTERED"}',
        0.0025, 0.001, "text", ("profileUrl",), ("pageAdLibrary.uri_token",),
    ),
    # Newest comments first, with no sort option: a creator's comment from upload day on a busy
    # post is past the first page and is missed (the video is read instead).
    "instagram": CommentActor(
        "apify~instagram-comment-scraper",
        '{"directUrls": ["{url}"], "resultsLimit": {limit}}',
        0.0026, 0.0, "text", ("ownerUsername", "owner.username"),
    ),
    # Ranked; the creator's own comment came in the top ten on the posts checked.
    "tiktok": CommentActor(
        "clockworks~tiktok-comments-scraper",
        '{"postURLs": ["{url}"], "commentsPerPost": {limit}, "maxRepliesPerComment": 0}',
        0.00125, 0.0, "text", ("uniqueId",), ("videoWebUrl",),
    ),
}  # fmt: skip


def comments_name_owner(platform: str) -> bool:
    """Whether a platform's comments say whose post it is (else the creator's handle is needed
    before a comments run is worth paying for)."""
    return platform in COMMENT_ACTORS and bool(COMMENT_ACTORS[platform].owner)


def handle_of(value) -> str | None:
    """A handle, lower-case, from a plain name or a profile or post link (its first path
    segment, without "@"); None for numeric-id profile links."""
    if not isinstance(value, str) or not value.strip():
        return None
    value = value.strip()
    if "://" in value:
        first = next((s for s in urlsplit(value).path.split("/") if s), "")
        value = "" if first.lower() == "profile.php" else first
    return value.removeprefix("@").lower() or None


def value_at(item, path: str):
    """The value at a dotted path ("a.b.0"), or None."""
    for part in path.split("."):
        if isinstance(item, list) and part.isdigit() and int(part) < len(item):
            item = item[int(part)]
        elif isinstance(item, dict):
            item = item.get(part)
        else:
            return None
    return item


def _first_text(item: dict, paths: tuple[str, ...]) -> str | None:
    for path in paths:
        if isinstance(value := value_at(item, path), str) and value.strip():
            return value.strip()
    return None


class ApifyMedia:
    """One synchronous actor run per post (`run-sync-get-dataset-items`), one actor per
    platform. The token goes only in a header, only to api.apify.com, and is never logged."""

    def __init__(self, token: str, platforms: frozenset[str] = frozenset(ACTORS),
                 actors: dict[str, Actor] | None = None, http=None,
                 comment_actors: dict[str, CommentActor] | None = None):  # fmt: skip
        self.token, self.actors, self.http = token, actors or ACTORS, http
        self.comment_actors = COMMENT_ACTORS if comment_actors is None else comment_actors
        self.platforms = frozenset(p for p in platforms if p in self.actors)
        self.comment_platforms = frozenset(p for p in platforms if p in self.comment_actors)

    def fee_for(self, platform: str) -> float | None:
        override = os.environ.get(f"PANTRILA_PRICE_MEDIA_{platform.upper()}")
        return float(override) if override else self.actors[platform].fee_usd

    def headers_for(self, url: str) -> dict[str, str]:
        parts = urlsplit(url)
        if parts.scheme == "https" and parts.hostname == APIFY_HOST and parts.port is None:
            return {"Authorization": f"Bearer {self.token}"}
        return {}

    def comment_fee_for(self, platform: str, fetched: int) -> float | None:
        actor = self.comment_actors[platform]
        override = os.environ.get(f"PANTRILA_PRICE_COMMENT_{platform.upper()}")
        per = float(override) if override else actor.fee_usd
        return actor.start_fee_usd + per * fetched

    def _run(self, actor_id: str, template: str, fields: dict[str, str]) -> object:
        """One synchronous actor run; its dataset items."""
        import httpx

        for key, value in fields.items():
            template = template.replace("{" + key + "}", value)
        try:
            r = (self.http or httpx).post(
                APIFY_RUN.format(actor=actor_id), json=json.loads(template),
                timeout=SERVICE_TIMEOUT_S, headers={"Authorization": f"Bearer {self.token}"},
            )  # fmt: skip
        except httpx.HTTPError as exc:
            raise MediaFailed("The video service did not answer.") from exc
        if r.status_code >= 400:
            raise MediaFailed(f"The video service answered with an error ({r.status_code}).")
        try:
            return r.json()
        except ValueError as exc:
            raise MediaFailed("The video service sent something unreadable.") from exc

    def creator_comments(self, post_url: str, platform: str, handle: str | None
                         ) -> CreatorComments:  # fmt: skip
        actor = self.comment_actors[platform]
        items = self._run(actor.id, actor.input, {"url": json.dumps(post_url)[1:-1],
                                                  "limit": str(COMMENT_LIMIT)})  # fmt: skip
        items = [i for i in items if isinstance(i, dict)] if isinstance(items, list) else []
        creator = handle_of(handle)
        texts, mine = [], None
        for item in items:
            owners = {handle_of(value_at(item, p)) for p in actor.owner} | {creator}
            author = next((a for p in actor.author if (a := handle_of(value_at(item, p)))), None)
            text = value_at(item, actor.text)
            if author and author in owners and isinstance(text, str) and text.strip():
                texts.append(text.strip())
                mine = author
        return CreatorComments(texts, len(items), mine)

    def video_for(self, post_url: str, platform: str) -> PostVideo | None:
        actor = self.actors[platform]
        items = self._run(actor.id, actor.input, {"url": json.dumps(post_url)[1:-1]})
        item = items[0] if isinstance(items, list) and items else None
        if not isinstance(item, dict):
            return None
        found = (value_at(item, p) for p in actor.videos)
        links = [v for v in found if isinstance(v, str) and v.startswith("https://")]
        seconds = next((float(v) * k for p, k in actor.seconds
                        if isinstance(v := value_at(item, p), int | float) and v > 0),
                       None)  # fmt: skip
        caption = _first_text(item, actor.caption)
        if not links and not caption:
            return None
        return PostVideo(links, caption, _first_text(item, actor.handle), seconds)


def media_source() -> MediaSource:
    """From the environment: `PANTRILA_MEDIA_SOURCE=apify` with `APIFY_TOKEN`, else off.
    `PANTRILA_MEDIA_PLATFORMS` narrows the platforms (default: all three)."""
    if (os.environ.get("PANTRILA_MEDIA_SOURCE") or "off").lower() != "apify":
        return NoMedia()
    token = os.environ.get("APIFY_TOKEN")
    if not token:
        return NoMedia()
    platforms = os.environ.get("PANTRILA_MEDIA_PLATFORMS") or ",".join(ACTORS)
    return ApifyMedia(token, frozenset(p.strip() for p in platforms.split(",") if p.strip()))


def fetch_video(url: str, http=None, resolve: Resolver = resolve_host,
                headers: dict[str, str] | None = None) -> bytes:  # fmt: skip
    """The video at a service-given link, through the page fetcher's SSRF guards. `headers`
    go only to that link's own host over https, never after a redirect elsewhere."""
    host = urlsplit(url).hostname if headers else None
    try:
        _, data, _ = fetch_bytes(url, http, resolve, kinds=VIDEO_TYPES, max_bytes=MAX_VIDEO_BYTES,
                                 timeout_s=VIDEO_FETCH_S, too_big=TOO_BIG, headers=headers,
                                 header_host=host)  # fmt: skip
    except ImportFailed as exc:
        raise MediaFailed(str(exc)) from exc
    if not data:
        raise MediaFailed("The post's video was empty.")
    return data


def _jpeg(image) -> str:
    image = image.convert("RGB")
    image.thumbnail((FRAME_PX, FRAME_PX))
    for quality in (82, 65, 50):
        out = BytesIO()
        image.save(out, "JPEG", quality=quality)
        if out.tell() <= MAX_IMAGE_BYTES:
            break
    return "data:image/jpeg;base64," + base64.b64encode(out.getvalue()).decode()


def read_video(data: bytes) -> VideoMedia:
    """Sound as 16 kHz mono WAV and frames at 15/40/65/90%, decoded in memory. An audio-only
    file gives sound and no frames."""
    import av

    try:
        with av.open(BytesIO(data)) as container:
            seconds = (container.duration or 0) / av.time_base
            if seconds > MAX_VIDEO_S + 5:
                raise MediaFailed(TOO_LONG)
            audio = _audio(container) if container.streams.audio else None
        with av.open(BytesIO(data)) as container:
            frames = _frames(container, seconds) if container.streams.video else []
    except av.FFmpegError as exc:
        raise MediaFailed("The post's video could not be read.") from exc
    if audio is not None:
        audio, heard = audio
        seconds = seconds or heard
        if heard < 1:
            audio = None
    if audio is None and not frames:
        raise MediaFailed("The post's video has no sound or pictures to read.")
    return VideoMedia(audio, seconds, frames)


def _audio(container) -> tuple[bytes, float]:
    import av

    resampler = av.AudioResampler(format="s16", layout="mono", rate=16_000)
    pcm = bytearray()
    for frame in container.decode(container.streams.audio[0]):
        for out in resampler.resample(frame):
            pcm += bytes(out.planes[0])[: out.samples * 2]
        if len(pcm) > (MAX_VIDEO_S + 5) * 32_000:
            raise MediaFailed(TOO_LONG)
    for out in resampler.resample(None):
        pcm += bytes(out.planes[0])[: out.samples * 2]
    wav = BytesIO()
    with wave.open(wav, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(16_000)
        w.writeframes(bytes(pcm))
    return wav.getvalue(), len(pcm) / 32_000


def _frames(container, seconds: float) -> list[str]:
    import av

    stream = container.streams.video[0]
    frames: list[str] = []
    for at in FRAME_AT[:MAX_FRAMES]:
        target, frame = seconds * at, None
        try:  # seek lands on the keyframe before; decode on to the moment wanted
            container.seek(int(target / stream.time_base), stream=stream)
            for frame in container.decode(stream):
                if frame.time is None or frame.time >= target:
                    break
        except av.FFmpegError:
            pass
        if frame is not None:
            frames.append(_jpeg(frame.to_image()))
    return frames
