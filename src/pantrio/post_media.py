"""Hear a post's video from its link: a third-party service finds the video, Pantrio reads it.

Instagram, Facebook and TikTok give apps like Pantrio no video on their public pages, so the
video link comes from a scraping service (Apify, `PANTRIO_MEDIA_SOURCE=apify`; off by default).
Pantrio then fetches the video itself with the same SSRF guards as any page (size and time
capped), turns it into 16 kHz mono WAV and 4 JPEG frames in memory with PyAV, and drops it.
Nothing is written to disk or stored. Only public posts; never a login or cookies.
"""

from __future__ import annotations

import base64
import json
import os
import wave
from dataclasses import dataclass
from io import BytesIO
from typing import Protocol

from pantrio.recipe_import import (
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
VIDEO_TYPES = ("video/mp4", "video/quicktime", "video/webm", "application/octet-stream")
SERVICE_TIMEOUT_S = 60.0
FRAME_AT = (0.15, 0.40, 0.65, 0.90)
FRAME_PX = 1024  # longest side of a frame sent to the model
APIFY_RUN = "https://api.apify.com/v2/acts/{actor}/run-sync-get-dataset-items"
DEFAULT_ACTOR = "apify~instagram-scraper"
DEFAULT_INPUT = '{"directUrls": ["{url}"], "resultsType": "posts", "resultsLimit": 1}'
VIDEO_KEYS = ("videoUrl", "video_url", "videoUrlHd", "downloadUrl", "mediaUrl", "video")
TOO_BIG = "The post's video is too large to read."


class MediaFailed(ImportFailed):
    """The service or the video let us down; the import falls back to the caption."""


@dataclass
class PostVideo:
    video_url: str
    caption: str | None = None
    handle: str | None = None


@dataclass
class VideoMedia:
    audio: bytes | None  # 16 kHz mono 16-bit WAV; None when the video has no sound
    seconds: float
    frames: list[str]  # JPEG data URLs


class MediaSource(Protocol):
    platforms: frozenset[str]  # social.Platform values this source covers
    fee_usd: float | None  # what one service run costs; None if unknown

    def video_for(self, post_url: str) -> PostVideo | None:
        """The post's video link, or None when the service found none. Raises MediaFailed."""
        ...


class NoMedia:
    platforms: frozenset[str] = frozenset()
    fee_usd: float | None = 0.0

    def video_for(self, post_url: str) -> PostVideo | None:
        return None


def find_video(item) -> str | None:
    """The first http(s) video link in a service's result, by known keys, then any .mp4."""
    if isinstance(item, dict):
        for key in VIDEO_KEYS:
            value = item.get(key)
            if isinstance(value, str) and value.startswith("https://"):
                return value
        children = list(item.values())
    elif isinstance(item, list):
        children = item
    else:
        return item if isinstance(item, str) and item.startswith("https://") and ".mp4" in item \
            else None  # fmt: skip
    for child in children:
        if (found := find_video(child)) is not None:
            return found
    return None


def _text(item: dict, *keys: str) -> str | None:
    for key in keys:
        if isinstance(value := item.get(key), str) and value.strip():
            return value.strip()
    return None


class ApifyMedia:
    """One synchronous run of an Apify actor per post (`run-sync-get-dataset-items`). The token
    goes in a header; it is never logged or returned."""

    def __init__(self, token: str, actor: str = DEFAULT_ACTOR, input_template: str = DEFAULT_INPUT,
                 platforms: frozenset[str] = frozenset({"instagram"}), fee_usd: float | None = None,
                 http=None):  # fmt: skip
        self.token, self.actor, self.input_template = token, actor, input_template
        self.platforms, self.fee_usd, self.http = platforms, fee_usd, http

    def video_for(self, post_url: str) -> PostVideo | None:
        import httpx

        try:
            body = json.loads(self.input_template.replace("{url}", json.dumps(post_url)[1:-1]))
        except ValueError as exc:
            raise MediaFailed("The video service is not set up right.") from exc
        try:
            r = (self.http or httpx).post(
                APIFY_RUN.format(actor=self.actor), json=body, timeout=SERVICE_TIMEOUT_S,
                headers={"Authorization": f"Bearer {self.token}"},
            )  # fmt: skip
        except httpx.HTTPError as exc:
            raise MediaFailed("The video service did not answer.") from exc
        if r.status_code >= 400:
            raise MediaFailed(f"The video service answered with an error ({r.status_code}).")
        try:
            items = r.json()
        except ValueError as exc:
            raise MediaFailed("The video service sent something unreadable.") from exc
        item = items[0] if isinstance(items, list) and items else None
        if not isinstance(item, dict) or (video := find_video(item)) is None:
            return None
        return PostVideo(
            video_url=video,
            caption=_text(item, "caption", "text", "description"),
            handle=_text(item, "ownerUsername", "username"),
        )


def media_source() -> MediaSource:
    """From the environment: `PANTRIO_MEDIA_SOURCE=apify` with `APIFY_TOKEN`, else off."""
    if (os.environ.get("PANTRIO_MEDIA_SOURCE") or "off").lower() != "apify":
        return NoMedia()
    token = os.environ.get("APIFY_TOKEN")
    if not token:
        return NoMedia()
    fee = os.environ.get("PANTRIO_PRICE_MEDIA_PER_FETCH")
    platforms = os.environ.get("PANTRIO_MEDIA_PLATFORMS") or "instagram"
    return ApifyMedia(
        token,
        actor=os.environ.get("PANTRIO_APIFY_ACTOR") or DEFAULT_ACTOR,
        input_template=os.environ.get("PANTRIO_APIFY_INPUT") or DEFAULT_INPUT,
        platforms=frozenset(p.strip() for p in platforms.split(",") if p.strip()),
        fee_usd=float(fee) if fee else None,
    )


def fetch_video(url: str, http=None, resolve: Resolver = resolve_host) -> bytes:
    """The video at a service-given link, through the page fetcher's SSRF guards."""
    try:
        _, data, _ = fetch_bytes(url, http, resolve, kinds=VIDEO_TYPES, max_bytes=MAX_VIDEO_BYTES,
                                 timeout_s=VIDEO_FETCH_S, too_big=TOO_BIG)  # fmt: skip
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
    """Sound as 16 kHz mono WAV and frames at 15/40/65/90%, decoded in memory."""
    import av

    try:
        with av.open(BytesIO(data)) as container:
            seconds = (container.duration or 0) / av.time_base
            if seconds > MAX_VIDEO_S + 5:
                raise MediaFailed("The post's video is over 3 minutes.")
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
            raise MediaFailed("The post's video is over 3 minutes.")
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
