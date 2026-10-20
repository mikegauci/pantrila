"""Hearing a post's video from its link: the service, the video fetch, PyAV, and the order of
attempts in `from_post`. Offline: the service, the video host and OpenAI are faked."""

import io
import wave
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest

from pantrila import post_media
from pantrila.post_media import (
    ApifyMedia,
    MediaFailed,
    NoMedia,
    PostVideo,
    fetch_video,
    media_source,
    read_video,
)
from pantrila.recipe_import import (
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
    platforms = frozenset({"instagram", "tiktok"})

    def __init__(self, found: PostVideo | None = None, error: Exception | None = None):
        self.found = found if found is not None or error else PostVideo([VIDEO], None,
                                                                        "zachs.foods")  # fmt: skip
        self.error, self.asked = error, []

    def fee_for(self, platform):
        return 0.003

    def headers_for(self, url):
        return {}

    def video_for(self, post_url, platform):
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
    (FakeMedia(found=PostVideo(["https://cdn.example/none.mp4"])), video_host()),
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
    assert meter.runs == [(0.003, media.error is None)]
    assert imp.media_cost == pytest.approx(0.003)
    assert [kind for kind, _ in client.calls] == ["parse"]


def test_no_recipe_anywhere_still_says_what_to_do_next():
    from pantrila.social import VIDEO_INCOMPLETE

    no_recipe = ImportedRecipe.model_validate({**caption_only().model_dump(), "is_recipe": False})
    no_video_recipe = VideoRecipe.model_validate({**heard().model_dump(), "is_recipe": False})
    client = FakeClient(no_recipe, no_video_recipe)
    with pytest.raises(ImportFailed) as exc:
        importer(client, FakeMedia()).from_post(REEL, "Comment RECIPE 👇", video_host(), resolve)
    assert str(exc.value) == VIDEO_INCOMPLETE


def test_video_without_a_method_does_not_replace_the_caption_draft():
    client = FakeClient(caption_only(), heard(steps=()))
    result = importer(client, FakeMedia()).from_post(REEL, CAPTION, video_host(), resolve)
    assert NO_METHOD in result.notes and HEARD not in result.notes


@pytest.mark.parametrize("media, meter, url", [
    (None, None, REEL),  # off: today's behaviour exactly
    (FakeMedia(), Meter(allow=False), REEL),  # today's allowance used up
    (FakeMedia(), None, "https://www.facebook.com/sam/videos/123/"),  # not covered
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


@pytest.mark.parametrize("platform, item, want", [
    ("instagram", {"caption": "Lasagna", "ownerUsername": "zachs.foods", "videoDuration": 34.4,
                   "videoUrl": VIDEO, "audioUrl": "https://cdn.example/a.mp4"},
     PostVideo([VIDEO, "https://cdn.example/a.mp4"], "Lasagna", "zachs.foods", 34.4)),
    ("tiktok", {"text": "Noodles", "authorMeta": {"name": "jose.elcook"},
                "videoMeta": {"duration": 61}, "webVideoUrl": "https://www.tiktok.com/x",
                "mediaUrls": ["https://api.apify.com/v2/key-value-stores/k/records/v"]},
     PostVideo(["https://api.apify.com/v2/key-value-stores/k/records/v"], "Noodles",
               "jose.elcook", 61.0)),
    ("facebook", {"previewTitle": "Meatball pasta", "playable_duration_in_ms": 66730,
                  "videoDeliveryLegacyFields": {
                      "browser_native_sd_url": "https://video.fbcdn.net/sd.mp4",
                      "browser_native_hd_url": "https://video.fbcdn.net/hd.mp4"}},
     PostVideo(["https://video.fbcdn.net/sd.mp4", "https://video.fbcdn.net/hd.mp4"],
               "Meatball pasta", None, 66.73)),
    ("facebook", {"message": {"text": "Comment PASTA for the recipe"}, "pageName": "samcooks",
                  "short_form_video_context": {
                      "video": {"playable_duration_in_ms": 20431},
                      "playback_video": {"videoDeliveryLegacyFields": {
                          "browser_native_sd_url": "https://video.fbcdn.net/reel-sd.mp4",
                          "browser_native_hd_url": "https://video.fbcdn.net/reel-hd.mp4"}}}},
     PostVideo(["https://video.fbcdn.net/reel-sd.mp4", "https://video.fbcdn.net/reel-hd.mp4"],
               "Comment PASTA for the recipe", "samcooks", 20.431)),
])  # fmt: skip
def test_apify_reads_each_platforms_actor(platform, item, want):
    seen: list[httpx.Request] = []
    media = ApifyMedia("secret-token", http=apify(httpx.Response(200, json=[item]), seen))
    got = media.video_for("https://example.com/post", platform)
    assert got is not None and got.video_urls == want.video_urls
    assert (got.caption, got.handle) == (want.caption, want.handle)
    assert got.seconds == pytest.approx(want.seconds)
    (req,) = seen
    assert req.headers["authorization"] == "Bearer secret-token"
    assert "secret-token" not in str(req.url) and "secret-token" not in req.content.decode()
    assert str(req.url).endswith(f"/acts/{post_media.ACTORS[platform].id}"
                                 "/run-sync-get-dataset-items")  # fmt: skip
    assert "https://example.com/post" in req.content.decode()


def test_apify_failures_and_empty_results():
    seen: list = []
    with pytest.raises(MediaFailed, match="error \\(502\\)"):
        ApifyMedia("t", http=apify(httpx.Response(502), seen)).video_for(REEL, "instagram")
    empty = ApifyMedia("t", http=apify(httpx.Response(200, json=[]), seen))
    assert empty.video_for(REEL, "instagram") is None
    nothing = ApifyMedia("t", http=apify(httpx.Response(200, json=[{"likes": 3}]), seen))
    assert nothing.video_for(REEL, "instagram") is None


def test_the_token_goes_only_to_apify_storage_and_never_after_a_redirect():
    media = ApifyMedia("secret-token")
    store = "https://api.apify.com/v2/key-value-stores/k/records/v"
    assert media.headers_for(store) == {"Authorization": "Bearer secret-token"}
    for url in ("http://api.apify.com/x", "https://api.apify.com.evil.example/x",
                "https://cdn.example/v.mp4", "https://api.apify.com:8443/x"):  # fmt: skip
        assert media.headers_for(url) == {}, url

    seen: list[httpx.Request] = []

    def handle(req: httpx.Request) -> httpx.Response:
        seen.append(req)
        if req.url.host == "api.apify.com":
            return httpx.Response(302, headers={"location": VIDEO})
        return httpx.Response(200, content=MP4, headers={"content-type": "video/mp4"})

    http = httpx.Client(transport=httpx.MockTransport(handle))
    assert fetch_video(store, http, resolve, media.headers_for(store)) == MP4
    assert seen[0].headers["authorization"] == "Bearer secret-token"
    assert "authorization" not in seen[1].headers and seen[1].url.host == "cdn.example"


def test_a_failed_video_link_falls_back_to_the_next_one():
    client = FakeClient(caption_only(), heard())
    media = FakeMedia(found=PostVideo(["https://cdn.example/broken.mp4", VIDEO]))
    result = importer(client, media).from_post(REEL, CAPTION, video_host(), resolve)
    assert result.notes[0] == HEARD


def test_a_video_the_service_says_is_too_long_is_never_fetched():
    client = FakeClient(caption_only())
    media = FakeMedia(found=PostVideo([VIDEO], seconds=600))
    host = video_host(status=500)  # any fetch would fail loudly in the result
    result = importer(client, media).from_post(REEL, CAPTION, host, resolve)
    assert NO_METHOD in result.notes and len(client.calls) == 1


def test_tiktok_caption_comes_from_the_service_and_one_run_serves_both():
    tiktok = "https://www.tiktok.com/@jose.elcook/video/7448169436764212510"
    oembed = "https://www.tiktok.com/oembed?url=" + tiktok.replace(":", "%3A").replace("/", "%2F")

    def handle(req: httpx.Request) -> httpx.Response:
        if str(req.url) == oembed:
            return httpx.Response(200, json={"title": "", "author_unique_id": "jose.elcook"})
        if str(req.url) == VIDEO:
            return httpx.Response(200, content=MP4, headers={"content-type": "video/mp4"})
        return httpx.Response(404)

    http = httpx.Client(transport=httpx.MockTransport(handle))
    media, meter = FakeMedia(found=PostVideo([VIDEO], CAPTION, "jose.elcook")), Meter()
    client = FakeClient(caption_only(), heard())
    result = importer(client, media, meter).from_post(tiktok, None, http, resolve)
    assert media.asked == [tiktok] and meter.runs == [(0.003, True)]
    assert result.notes[0] == HEARD
    d = result.draft
    assert (d.source_url, d.source_platform, d.source_author) == (tiktok, "tiktok", "jose.elcook")
    assert "Caption of a TikTok post by @jose.elcook" in client.calls[0][1]["input"][0][
        "content"][0]["text"]  # fmt: skip

    no_caption = FakeMedia(found=PostVideo([VIDEO]))
    with pytest.raises(ImportFailed, match="TikTok"):
        importer(FakeClient(), no_caption).from_post(tiktok, None, http, resolve)


def test_media_source_is_off_unless_configured(monkeypatch):
    for name in (
        "PANTRILA_MEDIA_SOURCE",
        "APIFY_TOKEN",
        "PANTRILA_MEDIA_PLATFORMS",
        "PANTRILA_PRICE_MEDIA_FACEBOOK",
    ):
        monkeypatch.delenv(name, raising=False)
    assert isinstance(media_source(), NoMedia)
    monkeypatch.setenv("PANTRILA_MEDIA_SOURCE", "apify")
    assert isinstance(media_source(), NoMedia)  # no token
    monkeypatch.setenv("APIFY_TOKEN", "t")
    source = media_source()
    assert isinstance(source, ApifyMedia)
    assert source.platforms == frozenset({"instagram", "tiktok", "facebook"})
    assert source.fee_for("facebook") == 0.006
    monkeypatch.setenv("PANTRILA_PRICE_MEDIA_FACEBOOK", "0.007")
    monkeypatch.setenv("PANTRILA_MEDIA_PLATFORMS", "instagram, myspace")
    source = media_source()
    assert source.platforms == frozenset({"instagram"}) and source.fee_for("facebook") == 0.007


def test_facebook_shared_reel_reads_video_when_the_caption_only_says_comment_recipe():
    share = "https://www.facebook.com/share/r/Example123/"
    requested = []
    item = {
        "message": {"text": "Comment RECIPE"},
        "pageName": "samcooks",
        "short_form_video_context": {
            "video": {"playable_duration_in_ms": 20431},
            "playback_video": {"videoDeliveryLegacyFields": {"browser_native_sd_url": VIDEO}},
        },
    }

    def handle(req):
        requested.append(req)
        if req.url.host == "api.apify.com":
            return httpx.Response(200, json=[item])
        if str(req.url) == VIDEO:
            return httpx.Response(200, content=MP4, headers={"content-type": "video/mp4"})
        return httpx.Response(403)

    http = httpx.Client(transport=httpx.MockTransport(handle))
    no_recipe = caption_only().model_copy(update={"is_recipe": False})
    client, meter = FakeClient(no_recipe, heard()), Meter()
    source = ApifyMedia("secret-token", http=http)
    result = importer(client, source, meter).from_post(share, http=http, resolve=resolve)
    assert result.notes[0] == HEARD
    assert result.draft.source_url == share and result.draft.source_platform == "facebook"
    assert result.draft.source_author == "samcooks"
    assert result.draft.steps == ["Brown the sausage.", "Layer and bake."]
    assert meter.runs == [(0.006, True)]
    assert len([r for r in requested if r.url.host == "api.apify.com"]) == 1
    assert all("authorization" not in r.headers for r in requested if r.url.host != "api.apify.com")


def test_unreadable_video_is_not_reported_as_a_successfully_read_incomplete_recipe():
    from pantrila.social import NO_RECIPE

    no_recipe = caption_only().model_copy(update={"is_recipe": False})
    client = FakeClient(no_recipe)
    with pytest.raises(ImportFailed) as exc:
        importer(client, FakeMedia()).from_post(REEL, "Comment RECIPE", video_host(b"bad"), resolve)
    assert str(exc.value) == NO_RECIPE
