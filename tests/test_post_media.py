"""Hearing a post's video from its link: the service, the video fetch, PyAV, and the order of
attempts in `from_post`. Offline: the service, the video host and OpenAI are faked."""

import io
import wave
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest

from pantrio import post_media
from pantrio.post_media import (
    ApifyMedia,
    MediaFailed,
    NoMedia,
    PostVideo,
    fetch_video,
    media_source,
    read_video,
)
from pantrio.recipe_import import (
    HEARD,
    NO_METHOD,
    ImportedRecipe,
    Importer,
    ImportFailed,
    VideoRecipe,
)

REEL = "https://www.instagram.com/reel/Dclv5Rgizvm/"
VIDEO = "https://cdn.example/v/reel.mp4"
MP4 = (Path(__file__).parent / "data" / "reel.mp4").read_bytes()
USAGE = SimpleNamespace(input_tokens=1000, output_tokens=300)
CAPTION = ("Spicy Sausage Vodka Lasagna 🤤 Full recipe in my bio\n"
           "1 lb spicy Italian sausage\n3 garlic cloves\n2 tbsp vodka")  # fmt: skip


def resolve(host, port):
    return ["93.184.216.34"]


def video_host(body: bytes = MP4, kind: str = "video/mp4", status: int = 200) -> httpx.Client:
    def handle(req: httpx.Request) -> httpx.Response:
        if str(req.url) != VIDEO:
            return httpx.Response(404)
        return httpx.Response(status, content=body, headers={"content-type": kind})

    return httpx.Client(transport=httpx.MockTransport(handle))


class FakeClient:
    """Queued parsed outputs in order; transcription returns a fixed text."""

    def __init__(self, *parsed, transcript="Brown the sausage, add garlic and vodka, layer it"):
        self.parsed, self.calls, self.responses = list(parsed), [], self
        self.transcript = transcript
        self.audio = SimpleNamespace(transcriptions=SimpleNamespace(create=self.transcribe))

    def transcribe(self, **kwargs):
        self.calls.append(("transcribe", kwargs))
        return SimpleNamespace(text=self.transcript)

    def parse(self, **kwargs):
        self.calls.append(("parse", kwargs))
        return SimpleNamespace(output_parsed=self.parsed.pop(0), usage=USAGE)


def lines(*names: str) -> list[dict]:
    return [{"name": n, "quantity": 1, "unit": "piece", "food": "egg", "estimate": None}
            for n in names]  # fmt: skip


def caption_only() -> ImportedRecipe:
    return ImportedRecipe.model_validate({
        "is_recipe": True, "title": "Lasagna", "summary": "", "cuisine": "italian",
        "meal_types": ["dinner"], "total_minutes": 60, "servings": 4, "steps": [],
        "ingredients": lines("1 lb spicy Italian sausage", "3 garlic cloves"),
    })  # fmt: skip


def heard(steps=("Brown the sausage.", "Layer and bake.")) -> VideoRecipe:
    data = caption_only().model_dump()
    data["steps"] = list(steps)
    data["ingredients"] = [{**i, "vague_amount": None} for i in data["ingredients"]]
    return VideoRecipe.model_validate(data)


class FakeMedia:
    platforms = frozenset({"instagram"})
    fee_usd = 0.003

    def __init__(self, found: PostVideo | None = None, error: Exception | None = None):
        self.found = found if found is not None or error else PostVideo(VIDEO, None, "zachs.foods")
        self.error, self.asked = error, []

    def video_for(self, post_url):
        self.asked.append(post_url)
        if self.error:
            raise self.error
        return self.found


class Meter:
    def __init__(self, allow=True):
        self.allow, self.runs = allow, []

    def start(self):
        if not self.allow:
            raise ImportFailed("Today's video reads are used up.")

    def finish(self, fee, ok):
        self.runs.append((fee, ok))


def importer(client, media=None, meter=None) -> Importer:
    return Importer(client=client, model="m", media=media, meter=meter)


# --- Order of attempts ------------------------------------------------------------------------


def test_full_caption_never_calls_the_service():
    media = FakeMedia()
    client = FakeClient(heard())
    result = importer(client, media).from_post(REEL, CAPTION, video_host(), resolve)
    assert media.asked == [] and len(client.calls) == 1 and HEARD not in result.notes


def test_ingredients_only_caption_hears_the_video_and_keeps_the_caption():
    media, meter = FakeMedia(), Meter()
    client = FakeClient(caption_only(), heard())
    imp = importer(client, media, meter)
    result = imp.from_post(REEL, CAPTION, video_host(), resolve)
    assert media.asked == [REEL] and meter.runs == [(0.003, True)]
    assert result.notes[0] == HEARD and NO_METHOD not in result.notes
    assert result.draft.steps == ["Brown the sausage.", "Layer and bake."]
    d = result.draft
    assert (d.source, d.source_url, d.source_platform, d.source_author) == (
        "post", REEL, "instagram", "zachs.foods")  # fmt: skip
    kinds = [kind for kind, _ in client.calls]
    assert kinds == ["parse", "transcribe", "parse"]
    sent = client.calls[-1][1]["input"][0]["content"]
    assert "Transcript of the audio of a Instagram cooking video by @zachs.foods" in sent[0][
        "text"]  # fmt: skip
    assert "The post's caption:\n\nSpicy Sausage" in sent[0]["text"]
    assert sum(c["type"] == "input_image" for c in sent) == 4  # frames from the video
    assert imp.media_runs == 1 and imp.media_cost == pytest.approx(0.003)
    assert result.usage.audio_seconds == pytest.approx(4, abs=0.2)


@pytest.mark.parametrize("media, host", [
    (FakeMedia(error=MediaFailed("The video service did not answer.")), video_host()),
    (FakeMedia(found=PostVideo("https://cdn.example/none.mp4")), video_host()),
    (FakeMedia(), video_host(b"<html>", "text/html")),
    (FakeMedia(), video_host(b"not a video at all")),
    (FakeMedia(), video_host(status=403)),
])  # fmt: skip
def test_any_failure_falls_back_to_the_captions_ingredients(media, host):
    meter = Meter()
    client = FakeClient(caption_only())
    imp = importer(client, media, meter)
    result = imp.from_post(REEL, CAPTION, host, resolve)
    assert NO_METHOD in result.notes and HEARD not in result.notes
    assert meter.runs == [(0.003, False)] and imp.media_cost == pytest.approx(0.003)
    assert [kind for kind, _ in client.calls] == ["parse"]


def test_no_recipe_anywhere_still_says_what_to_do_next():
    from pantrio.social import NO_RECIPE

    no_recipe = ImportedRecipe.model_validate({**caption_only().model_dump(), "is_recipe": False})
    no_video_recipe = VideoRecipe.model_validate({**heard().model_dump(), "is_recipe": False})
    client = FakeClient(no_recipe, no_video_recipe)
    with pytest.raises(ImportFailed) as exc:
        importer(client, FakeMedia()).from_post(REEL, "Comment RECIPE 👇", video_host(), resolve)
    assert str(exc.value) == NO_RECIPE


def test_video_without_a_method_does_not_replace_the_caption_draft():
    client = FakeClient(caption_only(), heard(steps=()))
    result = importer(client, FakeMedia()).from_post(REEL, CAPTION, video_host(), resolve)
    assert NO_METHOD in result.notes and HEARD not in result.notes


@pytest.mark.parametrize("media, meter, url", [
    (None, None, REEL),  # off: today's behaviour exactly
    (FakeMedia(), Meter(allow=False), REEL),  # today's allowance used up
    (FakeMedia(), None, "https://www.tiktok.com/@sam/video/7300000000000000001"),  # not covered
])  # fmt: skip
def test_off_capped_or_uncovered_platforms_skip_the_service(media, meter, url):
    client = FakeClient(caption_only())
    imp = importer(client, media, meter)
    result = imp.from_post(url, CAPTION, video_host(), resolve)
    assert NO_METHOD in result.notes and len(client.calls) == 1
    assert media is None or media.asked == []
    assert imp.media_runs == 0 and imp.media_cost == 0


# --- Service, fetch and decoding ---------------------------------------------------------------


def test_read_video_gives_16k_mono_wav_and_four_frames():
    media = read_video(MP4)
    with wave.open(io.BytesIO(media.audio)) as w:
        assert (w.getframerate(), w.getnchannels(), w.getsampwidth()) == (16_000, 1, 2)
        assert w.getnframes() / 16_000 == pytest.approx(4, abs=0.2)
    assert media.seconds == pytest.approx(4, abs=0.2)
    assert len(media.frames) == 4
    assert all(f.startswith("data:image/jpeg;base64,") for f in media.frames)


def test_read_video_refuses_long_or_unreadable_videos(monkeypatch):
    with pytest.raises(MediaFailed, match="could not be read"):
        read_video(b"not a video")
    monkeypatch.setattr(post_media, "MAX_VIDEO_S", -2)  # 4 s is now too long
    with pytest.raises(MediaFailed, match="over 3 minutes"):
        read_video(MP4)


def test_fetch_video_checks_size_type_and_address(monkeypatch):
    assert fetch_video(VIDEO, video_host(), resolve) == MP4
    with pytest.raises(MediaFailed, match="not a web page"):
        fetch_video(VIDEO, video_host(b"<p>", "text/html"), resolve)
    with pytest.raises(MediaFailed, match="private address"):
        fetch_video(VIDEO, video_host(), lambda host, port: ["10.0.0.5"])
    monkeypatch.setattr(post_media, "MAX_VIDEO_BYTES", 1000)
    with pytest.raises(MediaFailed, match="too large"):
        fetch_video(VIDEO, video_host(), resolve)


def apify(answer: httpx.Response, seen: list) -> httpx.Client:
    def handle(req: httpx.Request) -> httpx.Response:
        seen.append(req)
        return answer

    return httpx.Client(transport=httpx.MockTransport(handle))


def test_apify_runs_the_actor_with_the_token_in_a_header():
    seen: list[httpx.Request] = []
    item = {"caption": "Lasagna", "ownerUsername": "zachs.foods", "videoUrl": VIDEO}
    media = ApifyMedia("secret-token", http=apify(httpx.Response(200, json=[item]), seen))
    assert media.video_for(REEL) == PostVideo(VIDEO, "Lasagna", "zachs.foods")
    (req,) = seen
    assert req.headers["authorization"] == "Bearer secret-token"
    assert "secret-token" not in str(req.url) and "secret-token" not in req.content.decode()
    assert str(req.url).endswith("/acts/apify~instagram-scraper/run-sync-get-dataset-items")
    assert REEL in req.content.decode()


def test_apify_failures_and_empty_results():
    seen: list = []
    with pytest.raises(MediaFailed, match="error \\(502\\)"):
        ApifyMedia("t", http=apify(httpx.Response(502), seen)).video_for(REEL)
    assert ApifyMedia("t", http=apify(httpx.Response(200, json=[]), seen)).video_for(REEL) is None
    nested = [{"items": [{"url": "https://cdn.example/x.mp4?sig=1"}]}]
    found = ApifyMedia("t", http=apify(httpx.Response(200, json=nested), seen)).video_for(REEL)
    assert found is not None and found.video_url == "https://cdn.example/x.mp4?sig=1"


def test_media_source_is_off_unless_configured(monkeypatch):
    for name in ("PANTRIO_MEDIA_SOURCE", "APIFY_TOKEN", "PANTRIO_PRICE_MEDIA_PER_FETCH"):
        monkeypatch.delenv(name, raising=False)
    assert isinstance(media_source(), NoMedia)
    monkeypatch.setenv("PANTRIO_MEDIA_SOURCE", "apify")
    assert isinstance(media_source(), NoMedia)  # no token
    monkeypatch.setenv("APIFY_TOKEN", "t")
    monkeypatch.setenv("PANTRIO_PRICE_MEDIA_PER_FETCH", "0.004")
    source = media_source()
    assert isinstance(source, ApifyMedia) and source.fee_usd == 0.004
    assert source.platforms == frozenset({"instagram"})
