# Plan: hear a reel's recipe from its link

Owner-approved direction, 20 October 2026. Start a fresh chat with "Do
`docs/plans/reel-audio-from-link.md`", after PR #39 (ingredients-only captions) has merged; this
plan builds on its `NO_METHOD` draft. Tick the checklist and record findings here as work lands.

## Why

Pasting a reel link today reads only the caption (and a recipe site it links). When the method
is only spoken in the video, the person has to screen-record the reel and upload it (PR #37),
which the owner finds too many steps. Goal: paste the link, tap "Read recipe", and Pantrio also
hears the video, like ReciMe (caption -> audio -> original website).

## What was checked (20 October 2026)

- Test reel: `instagram.com/reel/Dclv5Rgizvm` (@zachs.foods, "Spicy Sausage Vodka Lasagna").
  Its caption (497 characters, read fine from Open Graph tags) lists 15 ingredients with amounts
  and says "Full recipe in my bio"; the creator speaks the method in the video.
- Instagram's public page gives apps like Pantrio no video: no `og:video` tag (owner's Mac,
  Pantrio's user agent). TikTok gives neither caption nor video. So the audio can only come
  from a third-party scraping service. Decision (owner): use one, knowing it goes against
  Instagram's terms more clearly than reading the caption does. ReciMe's help pages describe
  caption -> audio -> website but not how it gets the audio.
- Never download in a hidden browser or with the owner's Instagram login; never store videos.

## Step 0: free-tier test before any code (owner's Mac)

1. Owner makes an Apify account (free tier) and puts `APIFY_TOKEN` in `.env` (never committed).
2. Compare 2-3 actors that take a reel URL and return a video link. Candidates seen on
   20 October 2026 (check the live pages: prices and output fields change):
   - Instagram Reel Downloader (presetshubham), ~$3 / 1,000 results, takes reel URLs and
     returns caption and video URLs.
   - Instagram Reel Scraper Enhanced (ayeeyee), ~$3 / 1,000 results plus a start fee.
   - Apify's own Instagram Scraper (`apify/instagram-scraper`, `directUrls` input), if it
     returns `videoUrl` for a single reel.
3. Write `scripts/reel_media_check.py` (no OpenAI call): for a reel link, run the actor with
   Apify's `run-sync-get-dataset-items` endpoint, print the run time, cost if reported, the
   caption and handle it returns, and the video link's fields; then request the video link and
   print only status, content type and size (do not save it). Run it on the test reel plus one
   Facebook video and one TikTok (does the actor cover them?).
4. Record per actor: works yes/no, seconds, $ per reel, video size, whether the video link
   expires and whether it loads from a server (Instagram's CDN may refuse datacenter
   addresses; if Render can't load it, use an actor that stores the video in Apify's storage
   and fetch it from `api.apify.com`). Pick one with the owner before building.

## Design

### Order of attempts in `Importer.from_post`

1. Caption (pasted or read from the link): a full recipe -> done (one paid call).
2. A recipe website linked in the caption (free fetch, one paid call) -> done.
3. **Audio** (new): only when 1 and 2 give no full recipe (no recipe, or the caption's
   ingredients with no method), the media source is configured, and the platform is one the
   chosen actor supports. The service returns the video link -> Pantrio fetches the video
   (SSRF guards, size cap) -> extracts 16 kHz mono WAV and 4 frames in memory -> discards the
   video -> the existing video extraction (`VIDEO_INSTRUCTIONS`, `VideoRecipe`) reads
   transcript + frames + the caption. The caption's exact amounts and the spoken method end
   up in one draft.
4. Anything fails (service down, blocked, too long, no speech) -> today's behaviour: the
   ingredients-only draft from PR #39 if there is one, else "The caption doesn't include the
   recipe..." with "Upload the video" still offered.

Website before audio because it is free to fetch and exact; audio costs the service fee plus
transcription. Revisit if the eval shows otherwise.

### Code

- `src/pantrio/post_media.py` (new): `MediaSource` protocol, `video_for(post_url) -> PostVideo
  | None` (video link, caption and handle if the service gives them); `ApifyMedia`
  (`APIFY_TOKEN`, `PANTRIO_APIFY_ACTOR`, one synchronous run with a timeout of about 60 s);
  `NoMedia` (off). Built from settings like the photo store; tests pass a fake.
- Video fetch: reuse `recipe_import.fetch_page` with `kinds=("video/mp4", ...)` and a separate
  byte cap (about 60 MB; one reel at 1080p for 90 s is roughly 10-30 MB). Never written to
  disk beyond a temp file deleted in `finally`.
- Audio and frames on the server: PyAV (`av`, wheels bundle FFmpeg, no system package needed
  on Render) decodes the audio to 16 kHz mono 16-bit WAV and grabs frames at 15/40/65/90%;
  reject over 3 minutes. Alternative if PyAV is a problem: send the MP4 straight to OpenAI
  transcription (accepts mp4 up to 25 MB) and skip frames.
- `Importer.from_video` gets an internal entry that takes WAV bytes and frames directly (the
  browser path keeps its data URLs). `from_post` calls it at step 3 with the caption.
- Settings (`.env.example`, `render.yaml` with `sync: false` for the token): `APIFY_TOKEN`,
  `PANTRIO_MEDIA_SOURCE=apify|off` (default off, so the app works without an account),
  `PANTRIO_APIFY_ACTOR`, `PANTRIO_PRICE_MEDIA_PER_FETCH` (USD per service run, for cost
  reports), `PANTRIO_DAILY_REEL_FETCHES` (per-user cap, default 10; the service fee is real
  money). Raise `PANTRIO_RESERVE_IMPORT_USD` if needed so a reel import's reservation covers
  service + transcription + two model calls.
- Usage: one `import` event as today; its cost adds the service fee and transcription;
  `ImportView` keeps `transcription_cost_usd` and gains `media_cost_usd`.
- Time: caption + site + service + video fetch + transcription + extraction can reach 60-90 s.
  Check Render's request timeout and the web `request()`; if needed stream progress like
  `POST /plans` (SSE) or keep one request with honest progress text.

### Web

- No new step for the person: "Read recipe" on a post link does it all. While waiting, the
  button text moves through "Reading the caption…", "Listening to the video…".
- The draft notes say where things came from ("Amounts from the caption, method from the
  video").
- "Upload the video" stays as the fallback in the error, for TikTok and when the service
  fails. Remove the screen-recording help line only for platforms the service covers.

### Privacy and terms

- README Limitations and the import screen's small print say that for posts Pantrio uses a
  third-party service to hear the video, that the video is not stored, and that it may stop
  working when platforms change.
- Only public posts; never the owner's login, cookies or a spoofed browser on Pantrio's side.

## Evals (before/after required: new path, and the video prompt is used for posts)

- Extend `evals/run_import.py` (or `run_video.py`) with post cases that pair a caption with
  one of the committed WAVs (`evals/data/video_audio/`): ingredients-only caption + spoken
  method (like the test reel), "comment RECIPE" caption + full spoken recipe, a full-recipe
  caption (must not fetch: 0 service calls), a caption linking a recipe site (site wins, 0
  service calls). The media source is a fake that returns the WAV and drawn frames: no real
  service in evals.
- Report: missed allergens (0), food matching, amounts taken from the caption when it has
  them, method present, service calls per import, cost including the service fee, p50/p95.
- One live run of the real service on the test reel, by hand, recorded here (not in CI).

## Tests (offline, service and OpenAI mocked)

- Order: full caption -> no service call; ingredients-only caption -> service -> merged draft;
  service failure / timeout / too-long video -> ingredients-only draft or the old message;
  `PANTRIO_MEDIA_SOURCE=off` -> today's behaviour exactly.
- Video fetch: size cap, wrong content type, SSRF guards on the video link; temp file removed.
- PyAV extraction on a small committed MP4 fixture (WAV rate, mono, length; 4 frames).
- API: per-user reel cap, cost in the usage event, token never in responses or logs.

## Checklist

- [ ] Step 0: Apify account, `scripts/reel_media_check.py`, 2-3 actors compared, results
      recorded here, actor chosen with the owner
- [ ] `post_media.py` + video fetch + PyAV extraction + tests
- [ ] `from_post` step 3 + settings + usage/cost + tests
- [ ] Web progress text and notes; Playwright case with the service mocked
- [ ] Eval cases and before/after reports (numbers in the PR)
- [ ] `APIFY_TOKEN` and settings on Render (owner); live check on the test reel
- [ ] README (Limitations, privacy line), CLAUDE.md Status/Layout/Commands; PR merged

## Risks

- The service breaks or gets blocked when Instagram changes: the fallback keeps the app
  working, and the per-user cap and `off` switch limit cost.
- Instagram's terms: owner's accepted risk for this portfolio app; easy to switch off.
- Cost creep: a few tenths of a cent per reel at the prices seen, plus transcription
  (~$0.003/min); watch the daily budget.
