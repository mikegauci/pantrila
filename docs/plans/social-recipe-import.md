# Plan: save recipes from TikTok, Instagram and Facebook

Owner-approved plan, 19 October 2026. Two PRs; start a fresh chat for each and point it here
("Do PR 1 of `docs/plans/social-recipe-import.md`"). Tick the checklists as work lands and
record findings (platform check results, eval numbers) in this file.

## What the person does

They paste a post's link (or its caption) into "From a post". Pantrio tries, in order:

1. **Caption** of the post.
2. **Recipe website linked in the caption** ("full recipe 👉 site.com/…"), via the existing
   link import.
3. **The video's audio**, when the person uploads the video (PR 2).
4. **Pasted text or screenshots** (existing photo import).

Every draft goes through the existing review form and is saved with the post link and the
creator's @handle. Pantrio never downloads, stores or embeds the video itself: downloading from
the platforms breaks their terms and is blocked from server addresses. (ReciMe does caption ->
audio from the link -> original website; the audio-from-link step is the part we replace with
an upload.)

## Decisions already made

- No video download from links, no embedded players, no stored thumbnails, no logos (platform
  names only).
- Credit: post link + creator @handle shown on the recipe page.
- Entry point: paste in the app (iPhone web apps cannot join the Share menu). No native app,
  no Android share target.
- Two PRs, each with its own before/after eval (prompt changes require one, see CLAUDE.md).
- Keep the general "paste any recipe text" import (`from_text`); it is needed for pasted
  captions anyway.

---

## PR 1: Import cookbook recipes from post captions and linked recipe sites

Branch `feat/social-recipe-import`.

### 1. Check what each platform returns (before writing code)

The Claude Code cloud container cannot reach TikTok/Instagram; test from the deployed API
(Render) or the owner's machine. Report results to the owner before building on them.

- TikTok: public oEmbed `https://www.tiktok.com/oembed?url=<post>` (no key) should return the
  caption (`title`) and handle (`author_unique_id`).
- Instagram / Facebook: does the public page's `og:description` / `og:title` carry the caption
  when fetched with Pantrio's own `USER_AGENT`? Never spoof a browser or crawler user agent.
- Caption comes back -> paste-a-link works for that platform. Blocked or empty -> that
  platform asks for the pasted caption.

Results (2026-10-20, owner's Mac, `scripts/platform_check.py`, Pantrio's own user agent):

| Platform | Post | Result |
|---|---|---|
| Instagram | `instagram.com/reel/DTtm5zrkfHA` | **Works.** og:description carries the handle (`cheesegal`) and the full caption. |
| Facebook | Tasty video `buzzfeedtasty/videos/…/1746461835606458` | **Works.** og:description carries the caption ("PRINT RECIPE: http://bzfd.it/…"); the handle comes from the URL. Short links are therefore followed, not skipped. |
| TikTok | `@jose.elcook/video/7448169436764212510` | **Paste only.** oEmbed answers 200 with just the player (no `title`, no `author_unique_id`); the post page answers 200 but is built in the browser with no preview tags. |

So TikTok links open the caption box straight away (with a line on copying it in TikTok) and
keep the link for the credit; Instagram and Facebook links import from the link alone. The
oEmbed call stays: it is fast and would pick captions up again if TikTok restores them.

### 2. Backend: `src/pantrio/social.py` (new)

- `detect(url)`: `tiktok.com`, `vm.tiktok.com`, `instagram.com/p|reel/…`, `facebook.com`,
  `fb.watch`. Anything else keeps using `Importer.from_link`.
- `fetch_post(url) -> Post(platform, url, handle, caption)` through the SSRF-guarded
  `recipe_import.fetch_page` (same limits). Short links follow the checked redirects, so the
  full post URL is what gets saved.
- `caption_links(caption)`: website links in the caption, ignoring the social platforms and
  link shorteners it cannot check. (Changed in PR 1: short links are kept, since
  `fetch_page` checks every redirect and Tasty's Facebook captions link recipes via bzfd.it.)

### 3. Backend: `src/pantrio/recipe_import.py`

- `Importer.from_post(url=None, caption=None)` runs the order above: caption (pasted or
  fetched) -> if no recipe and the caption has a website link, `from_html` on that page
  (JSON-LD first, else page text) -> otherwise `ImportFailed` with a message that points to the
  next option. The linked-site call is a second paid call, only when the caption fails; both
  count on the same import's usage.
- `Importer.from_text(text)`: pasted caption or any recipe text, source `"text"`.
- `INSTRUCTIONS` additions: captions are informal (emojis, hashtags, run-on ingredient lists);
  ignore calls to action ("follow for more", "comment RECIPE"); "link in bio" / "comment
  RECIPE" with no recipe -> `is_recipe` false.
- Messages:
  - "The caption doesn't include the recipe. It may be in the video: upload it, or paste the
    recipe text or add screenshots." (mention upload only once PR 2 lands)
  - "Instagram didn't let Pantrio read this post. Paste the caption below."

### 4. Data (no migration; `user_recipes.recipe` is JSONB)

- `cookbook.Source` gains `"post"` and `"text"`.
- `CookbookRecipeIn` gains `source_platform: Literal["tiktok", "instagram", "facebook"] | None`,
  `source_author: str | None` (handle, `[A-Za-z0-9._]`, max 30) and `recipe_url: str | None`
  (the linked site when used; `source_url` stays the post link). Editable in the form.

### 5. API (`api.py`, `api_models.py`, `api_views.py`)

- `POST /me/recipes/import/post` `{url?, caption?}` (422 when both are empty).
- `POST /me/recipes/import/text` `{text}`.
- Both via `import_view` / `paid_import`: same `PANTRIO_DAILY_IMPORTS` cap, budget reservation
  and `import` usage kind.
- `CookbookDetail` and `web/src/lib/types.ts` carry the new fields.

### 6. Web

- `recipes/mine/new`: fourth option "From a post" (TikTok, Instagram or Facebook): link field
  plus a "Paste the caption" box that opens on its own when the link can't be read. The
  no-recipe error also offers screenshots (and "Upload the video" after PR 2).
- `recipes/mine/[id]`: "From @creator on TikTok ↗" (post link) and "Recipe from site.com ↗"
  when the linked site was used.
- `cookbook-form.tsx`: shows and edits the credit. Mobile first.

### 7. Evals (before/after required)

- ~10 synthetic caption cases in `evals/import_cases.py` (written, not copied from real posts):
  emoji list, run-on paragraph, hashtag noise, metric, US cups, "link in bio" (reject),
  "comment RECIPE" (reject), injection attempt, caption linking to a recipe page (served
  locally), link to a non-recipe page.
- Run `evals.run_import` on the current prompt and the new one over the 12 existing + new
  cases. Gates: missed allergens 0, food matching >= 99% on old cases. Cost per import and
  p50/p95 in the PR body. ~$0.15–0.20 per run.

### 8. Tests (offline, OpenAI mocked)

- Platform detection and short links; caption parsing per platform; caption link finding.
- Fallback order: caption works / caption fails then site works / both fail.
- API: daily cap, 422 on empty body. Plain links still go through `from_link`.

### Checklist

- [x] Platform check results recorded above
- [x] `social.py` + tests
- [x] `from_post` / `from_text` (prompt change tried and dropped: no gain, see below)
- [x] Data fields, API routes, types
- [x] Web: "From a post", credit on recipe page and form (Playwright: `post-import.spec.ts`)
- [x] Eval cases (10 captions, `--instructions-from` for the before run)
- [x] Before/after reports: `evals/reports/import-2026-10-20T061450Z.md` (old prompt) and
      `import-2026-10-20T061631Z.md` (with caption lines), `gpt-5.4-mini`, 22 cases. Both: 0
      missed allergens, food matching 100% (pages and captions), 4/4 no-recipe cases refused,
      injection ignored. Caption lines: $0.0054 -> $0.0058 per import, p50 5.6 -> 6.1 s, no
      quality gain, so they were dropped and the prompt matches `main`.
- [x] README, CLAUDE.md Status/Layout
- [x] PR merged (#36)

Notes from building PR 1:

- A caption pasted with no post link goes to `/import/text` (source "Pasted text"): there is no
  post to credit. With a link it goes to `/import/post`, which uses the pasted caption and
  doesn't fetch, so the handle comes from the link when it carries one (TikTok `/@handle/`,
  Instagram `/<handle>/reel/`) and the person can type it in the form's Credit panel.
- A non-social link pasted into "From a post" falls through to the link import.
- Up to 3 caption links are fetched (free, 20 s budget); the first with schema.org Recipe data
  is sent to the model, else the first that loaded. A non-post link pasted with a caption is
  tried first.
- Code review fixes: bare domains count as links only when lowercase with a path or a common
  ending (no "together.It"); platform subdomains and every Amazon site are skipped; Facebook
  sign-in walls and og:title-only pages count as blocked; TikTok short links stop at the post
  URL without loading the app page; Facebook links keep only the post-id query keys; cut-short
  Instagram captions are read; TikTok/Instagram/Facebook profile links fail before any paid
  call; post links pasted in "From a link" read the caption.

---

## PR 2: Import cookbook recipes from an uploaded cooking video

Branch `feat/video-recipe-import`. Start after PR 1 merges.

### 1. Browser (no video reaches the server)

- The person uploads a video they saved (TikTok "Save video") or screen-recorded
  (Instagram/Facebook), up to 3 minutes.
- The browser extracts the audio to a small mono file (~3 MB for 90 s) and grabs 4 frames (for
  amounts shown only as on-screen text). The optional post link and caption go along for the
  credit.

### 2. Server

- `POST /me/recipes/import/video` `{audio, frames[], url?, caption?}`: OpenAI transcription,
  then the existing extraction call with transcript + frames + caption. Audio and frames are
  discarded. Same cap and budget; transcription cost recorded separately.
- Prompt additions: vague amounts ("a glug of oil") are flagged for the person, never invented;
  ignore intros and sponsor talk; not a recipe -> `is_recipe` false.

### 3. Evals

- ~6 synthetic spoken recipes, turned into audio once with OpenAI text-to-speech and committed:
  clear amounts, vague amounts, background music, fast speech, amounts only on screen, not a
  recipe.
- Report missed allergens (0), food matching, vague amounts flagged not invented, cost,
  p50/p95. Pick `gpt-4o-mini-transcribe` vs `gpt-4o-transcribe` from the results. Expect
  ~$0.01–0.02 per import, 10–20 s; check current prices before setting config.

### 4. Web

- "Upload the video" step in "From a post" and in the no-recipe message, with a help line on
  saving or screen-recording a video per platform.

### Checklist

- [x] Browser audio + frame extraction (`web/src/lib/video.ts`; Playwright
      `video-import.spec.ts` uploads a 4 s WebM and checks the 16 kHz mono WAV and 4 frames)
- [x] `/me/recipes/import/video` + prompt change + tests
- [x] Audio eval cases (`evals/video_cases.py`) and runner (`evals/run_video.py`, `--plain` for
      the before, `--transcribe-model` to compare)
- [ ] Audio made (`uv run python -m evals.video_audio`, ~$0.01) and committed
- [ ] Before/after reports, transcription model chosen
- [x] Web upload step
- [x] README, CLAUDE.md Status/Layout
- [ ] PR merged

Notes from building PR 2:

- Built in a cloud session with no OpenAI access, so the TTS audio and both eval runs are left
  for the owner's machine. Run, in order: `evals.video_audio`, `evals.run_video --plain`,
  `evals.run_video`, `evals.run_video --transcribe-model gpt-4o-transcribe`; commit the WAV
  files and reports and put the numbers here and in the PR.
- The video lines live in `VIDEO_INSTRUCTIONS` and the `VideoRecipe` output (lines carry
  `vague_amount`), used only by `from_video`; other imports keep the current prompt, so the
  22-case import eval is unaffected. `--plain` reads videos with that unchanged prompt.
- A vague amount still needs a number for nutrition: the model puts a typical one and the draft
  notes "the video only says “a glug”, so the amount is a guess. Set it."
- Prices (checked 2026-10-20): `gpt-4o-mini-transcribe` ~$0.003/min, `gpt-4o-transcribe`
  ~$0.006/min. One report says OpenAI plans to retire both on 2027-02-26 in favour of
  `gpt-transcribe` ($0.0045/min); not confirmed with OpenAI, so worth checking before choosing.
- WAV, not a compressed format, so the server can check the length in code with the standard
  library (`wave`): 90 s is 2.9 MB, 3 min 5.8 MB, under the 24 MB request cap.

## Main risk

Platforms can change what they share at any time. As checked on 2026-10-20, Instagram and
Facebook links work alone and TikTok is paste-only (or video upload after PR 2); any platform
that stops sharing falls back to the pasted caption with no code change.
