# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Pantrio

AI cooking and meal-planning assistant. A user tells Pantrio what is in their kitchen, their
diet, allergies and nutrition targets; Pantrio finds recipes with RAG over a recipe corpus,
plans a week of meals with a LangGraph agent that uses tool calling, builds a grocery list
from what is missing, and answers cooking questions in a chat. Every plan is checked by
deterministic rules (allergens, diet, nutrition targets) before the user sees it.

This is a portfolio project for AI Engineer roles: retrieval quality, eval numbers, cost and
latency per plan, and clear architecture matter as much as features.

## Build plan

1. **Recipe corpus + RAG + retrieval evals**: Python package `pantrio`, recipe and ingredient
   models, ingestion into Postgres with pgvector embeddings, hybrid search (vector + full text
   + filters), labelled retrieval queries with recall@k and MRR.
2. **Meal-planning agent**: LangGraph workflow (profile → retrieve → draft plan → check
   constraints → repair → finalise) with OpenAI tool calling; deterministic constraint checker;
   plan evals in LangSmith (constraint violations, nutrition error, pantry use, cost, latency).
3. **Pantry, grocery list and assistant chat**: pantry CRUD, grocery list diff, chat agent
   with tools (search recipes, check pantry, swap ingredient, scale recipe).
4. **Web app**: FastAPI + Next.js following `web/DESIGN_SYSTEM.md`; deployed (API on Render,
   web on Vercel, Supabase Postgres).
5. **Portfolio polish**: README with architecture diagram, eval snapshot, LangSmith
   dashboards for quality/cost/latency, demo script and video.

Work on one step at a time; each step is its own PR (commits within it can be split for a
readable history). Start a fresh Claude Code chat per step; this file carries the context.

## Status (update as work lands)

Recipe save/import UX: saving a new recipe automatically calls its existing photo endpoint
with a visible "Making the photo…" step; photo failures/allowance limits keep the saved recipe
and offer a retry on its page. Edits do not regenerate photos. Social imports show an estimated
countdown and an overrun message. `GET /me/recipes/import/timing` uses this user's last five
successful imports containing a reel event (last 30 days, latest 100 events), median + 15%,
rounded to 5 seconds and bounded 30–300 seconds. Fallback 105 seconds comes from production
logs on 2026-10-20: successful requests 75.140 / 103.070 s; photo generation 15.111 s. Timing
is a rough request estimate, not server stage telemetry; concurrent request intervals can
occasionally overlap. Upload-video UI, browser extraction, fixtures and the `/import/video`
endpoint are removed. Automatic video/audio reading from social links and its evals remain;
fallbacks are pasted text/captions and screenshots. No prompt/model or database schema change.
Local checks: 360 Python tests passed (26 skipped, 8 live deselected); production browser
checks passed for photo success/failure, edit behavior, fallback and countdown overrun. Web
typecheck/lint/build and Ruff passed. No paid eval rerun: prompts/models are unchanged.
The historical uploaded-video entries below describe the retired feature.

Import amount estimates: missing/vague quantities and unsupported measures (sprigs, handfuls)
are estimated rather than requiring manual unit edits. `RecipeLine.amount_estimate` persists
assumptions in the existing recipe JSON; `derive.estimated` covers amounts as well as foods.
The import prompt requests estimates and deduplicates method references; a single bounded
follow-up call repairs remaining incompatible units without changing food identity/allergens.
The form and saved recipe show "Estimated nutrition" and per-ingredient assumptions; entering
a quantity/unit clears that line's estimate. Older saved recipes remain compatible; no migration.
Before/after import reports: `import-2026-10-20T094538Z` / `import-2026-10-20T094933Z`, 23 cases:
0 missed allergens, foods 98% -> 99%, manual fixes 0.11 -> 0/recipe, $0.0057 -> $0.0068,
p50/p95 6.4/12.1 -> 7.0/19.8 s. Video reports `video-2026-10-20T094527Z` /
`video-2026-10-20T094934Z`, 6 cases: 0 missed allergens, vague flagged 67% -> 100%, foods 97%
both, stated amounts 100% -> 96% (one food mismatch), $0.0110 -> $0.0135, p50/p95
11.7/18.0 -> 13.2/31.4 s. New 2-case amount report `import-2026-10-20T095015Z`:
100% saveable, labelled and no duplicates; 0 missed allergens. These are small single-run
samples. Regression tests cover repair validation, deduplication, saved provenance and API edits.
Branch prefixes apply only to branches; commit messages are plain descriptive text.

Next planned work: **European nutrition data + 100 sourced recipes**, four sequential PRs.
Read [`docs/plans/european-ingredients-and-recipe-expansion.md`](docs/plans/european-ingredients-and-recipe-expansion.md)
before starting; it contains the full scope, safeguards, sources, checklists and handoff log.
**PR 1 complete in [PR #38](https://github.com/mikegauci/pantrio/pull/38). Next: PR 2 only,
after confirming merge and live prerequisite deployment.**
PR 1 adds eight ingredients (six Ciqual, two USDA), source identity, weight-only new foods,
central dessert swap restrictions and corpus seed preservation. Original 300 recipes unchanged.
See the plan for verification and deployment status. PR 2: recipe provenance/licensing + 5–10 dessert
pilot; PR 3: expand to **60 added desserts including the pilot**; PR 4: **40 everyday recipes**.
Target is 100 additions / 400 total, subject to review. Initial recipe source is Wikibooks;
Ciqual supplies nutrition, not recipe testing. Preserve the original 300 recipes. Start a fresh
chat per PR and update the plan's progress/handoff after each. Do not implement this feature
merely because this status entry exists; follow the user's selected task/PR.

Reel audio from a link (plan `docs/plans/reel-audio-from-link.md`, first PR): `from_post`
tries caption -> linked site -> the post's video, found by a third-party service
(`post_media.py`, Apify, `PANTRIO_MEDIA_SOURCE`, default off) and read in memory with PyAV.
Service runs are usage kind `reel` (migration `20261020100000_reel_usage`, applied on Supabase;
cap `PANTRIO_DAILY_REEL_FETCHES`). Prompt: steps only as the source gives them. Reel eval
before/after `reel-2026-10-20T082713Z` / `reel-2026-10-20T082734Z`: found 80% -> 100%, method
67% -> 100%, 0 missed allergens; import eval `import-2026-10-20T082701Z` unchanged in quality.
Second PR: one Apify actor per platform (`post_media.ACTORS`: Instagram, TikTok, Facebook;
$0.0027 / $0.0043 / $0.006 per post), token only ever sent to api.apify.com, TikTok links
alone work (caption from the service). Reel eval 7 cases, before/after
`reel-2026-10-20T084302Z` / `reel-2026-10-20T084329Z`: found 57% -> 100%, method 67% -> 100%,
0 missed allergens. Live on the test reel: 17 lines, 7 steps, ~60-90 s, ~$0.05 (the video
read's reasoning tokens; effort low is a follow-up). Still to do (owner): `APIFY_TOKEN` and
`PANTRIO_MEDIA_SOURCE=apify` on Render, then a live check on the deployed app.

Social recipe import, two PRs; plan and checklists in `docs/plans/social-recipe-import.md`
(read it before either PR). PR 1 (PR #36, merged): `social.py` (post detection, TikTok
oEmbed / Open Graph captions, caption links), `Importer.from_post` (caption, then the linked
recipe site) and `from_text`, `/me/recipes/import/post|text`, cookbook credit fields
(`source_platform`, `source_author`, `recipe_url`; no migration), web "From a post" and
credit, 10 caption eval cases. Prompt unchanged: caption lines were tried and dropped, since
the old prompt already scored the same on all 22 cases (`import-2026-10-20T061450Z` old prompt
vs `import-2026-10-20T061631Z` with the lines: 0 missed allergens, food matching 100%, 4/4
no-recipe captions refused; the lines cost +7%, $0.0054 -> $0.0058). Platform check
(2026-10-20, `scripts/platform_check.py` on the owner's Mac): Instagram and Facebook links
import from the link (Open Graph captions); TikTok oEmbed sends only the player and its page
has no preview tags, so TikTok links open the caption box straight away. Short links in
captions (bzfd.it) are followed.
PR 2 (uploaded video, PR #37, merged): the browser reads a saved or
screen-recorded video (`web/src/lib/video.ts`: 16 kHz mono WAV via `decodeAudioData`, 4 JPEG
frames at 15/40/65/90%, up to 3 min); `POST /me/recipes/import/video` checks the WAV in code,
transcribes it (`PANTRIO_TRANSCRIBE_MODEL`, default `gpt-4o-mini-transcribe`, priced per minute
with `PANTRIO_PRICE_TRANSCRIBE_PER_MIN`; the cost is in the import's usage event and shown
apart as `transcription_cost_usd`), then one extraction call with transcript + frames +
caption. A video with no sound sends frames only (audio null, no transcription); a link that
is not a post is kept as `source_url`. Video-only prompt lines (`VIDEO_INSTRUCTIONS`, `VideoRecipe.vague_amount`); page,
photo, text and caption imports keep the old prompt. Source `"video"` without a post link.
Eval: 6 spoken cases (`evals/video_cases.py`), audio from `evals.video_audio` (`gpt-4o-mini-tts`,
committed in `evals/data/video_audio/`), `evals.run_video` (`--plain` is the before). Reports
on `gpt-5.4-mini`: before `video-2026-10-20T065810Z` (plain prompt) vs after
`video-2026-10-20T065841Z`: 0 missed allergens both, food matching 100% both, stated amounts
right 100% both, vague amounts flagged 0/3 -> 3/3, 0 stated amounts wrongly flagged, sponsor
kept out, not-a-recipe refused, $0.0121 -> $0.0102 per import (transcription $0.0016 of it,
31 s of audio), p50 10.1/9.1 s, p95 29.4/17.3 s. `gpt-4o-transcribe`
(`video-2026-10-20T065914Z`): food matching 97%, vague flagged 2/3, $0.0131, so the default
stays `gpt-4o-mini-transcribe` ($0.003/min; both env vars set on Render).
Ingredients-only captions: a reel whose caption lists the
ingredients and says "full recipe in my bio" was refused, since `to_draft` required steps.
Now a draft with no method is kept when every ingredient line names a word found in the
source text (`grounded`; photos stay strict), with the step "Add the method here." and the
`NO_METHOD` note; `from_post` still tries a linked site first and keeps the caption's draft if
that fails. New eval case `caption-ingredients-only` (23 import cases). PR #39, merged.
`import-2026-10-20T081143Z`: 23/23, found/refused 100% (4/4 no-recipe refused), 0 missed
allergens, 1 extra (tofu bowl: milk, as before), food matching 99% (captions 100%), the new
case a draft with 8/8 foods, $0.0056 per import, p50 4.5 s / p95 12.6 s.
Next: hearing a reel from its link (no screen recording) through a scraping service; plan in
`docs/plans/reel-audio-from-link.md` (Instagram gives no `og:video`, checked 2026-10-20).

Review maintenance: API models/views/backend construction now live in `api_models.py`,
`api_views.py`, and `backend.py`; `api.py` owns routes and app lifecycle. Insights is generated
from `evals/report_selection.json` with `scripts/update_eval_snapshot.py`, checked by pytest.
Retrieval metrics are explicitly named normalized recall (the existing formula is unchanged).
Plan streams send keep-alives and detect premature EOF; recipe previews are tied to the exact
recipe/profile payload. Four production-browser regressions run in CI. Pinned page fetches
fail over among vetted addresses without re-resolving the hostname.

Chat recipe drafts restored from the saved work: write_recipe resolves foods and hands a
draft to the cookbook form. The final guard independently computes structured draft warnings,
including unchecked ingredients, and the UI renders them beside each save action. Saved
chats refresh these warnings too. The evaluator checks rule warnings, not allergen-name
mentions. Before/after 28-case reports: `assistant-2026-10-19T130451Z` and
`assistant-2026-10-19T132325Z`; after: 0 unsafe/made-up citations, 0 missing draft warnings,
100% expected tools, 3/4 expected drafting decisions, $0.00375/turn, p50 4.7s/p95 8.0s.
Existing-recipe citation coverage was 9/11 (before 11/11), so draft/corpus selection remains
a model-quality limitation. Intermediate reports are retained. Unknown IDs are now blocked
as citations and tracked as blocked attempts. All 8 paid live gates passed. The original stash is retained as a recovery backup.

Review safety/data bounds: saved chats refresh cited cards and expose current-profile warnings.
Concurrent chat writes compare the original history and return 409 on conflict; messages retain
the latest 200 entries. Malformed plan structure skips portion enumeration and reaches repair.
Profile fields, recipe steps/source URLs, uploads (24 MB), and avatar pixels are validated.
Quota reservation migration is applied on Supabase; PR #26 passed CI and merged.

Review usage hardening: migration `20261019124726_usage_reservations` adds RLS-protected
reservations. `operations.py` reserves per-user quota and shared budget atomically before
paid work, settles once on success/failure, and conservatively budgets unknown cost. Searches
are metered and query embeddings cached. Repository calls borrow pooled connections briefly;
external I/O holds none. Local DB concurrency and real-role RLS regressions are included.

Review account isolation: authenticated users get separate SWR caches and retained page state;
remembered chat and grocery keys include the user id. Profile/pantry mutations invalidate all
derived views. Playwright exercises account switching with delayed data; web CI runs it.

Review hardening: recipe imports connect directly to validated IP addresses, preserving HTTPS
hostname verification, with a ten-second overall DNS/socket deadline and bounded DNS workers.
Regression tests cover rebinding, TLS identity, stalled DNS and trickling headers.

Step 1 merged (PR #1): 300-recipe corpus, Supabase seeded and embedded, 65 labelled queries,
hybrid recall@10 0.843, MRR 0.922 (`evals/reports/retrieval-2026-10-15T195536Z.md`).

Step 2 merged (PR #2): LangGraph planner, `constraints.py`, 16 eval profiles. First
eval `evals/reports/planner-2026-10-16T084243Z.md` on `gpt-5.4-mini` (reasoning low; now the
default model, chosen as the cheapest; `gpt-5.5` never evaluated): 16/16 plans, 0 hard
violations, 13/16 meet every target, protein days 94%, pantry use 94%, $0.023 per plan,
p50 19s / p95 84s. Weakest: `cutting` (130 g protein in 1600 kcal, 43% of days met).
Migration 0002 widened `recipe_ingredients.quantity` to 3 decimals (applied and reseeded on
Supabase).

Step 3 (PR #6): pantry and profiles per user (migration 0003, RLS on every table, applied on
Supabase), grocery list, deterministic swaps, LangGraph chat agent with 5 tools and a citation
guard; 24 chat eval cases. `evals/reports/assistant-2026-10-16T094533Z.md` on `gpt-5.4-mini`:
right tools 100%, pantry as asked 100%, 0 unsafe and 0 made-up cited recipes, $0.0022 per
turn, p50 8s / p95 17s (first run before the prompt fix: 96% tools, 50% pantry, 1 made-up id).
Step 4 (PR #7): FastAPI `api.py` (Supabase Auth ES256 tokens verified via JWKS; `sub` is
`user_id`), migration 0004 (`meal_plans`, `usage_events`, RLS; applied on Supabase), plan
progress as SSE, daily caps per user and a total daily budget; Next.js 16 app in `web/` (10
screens per `DESIGN_SYSTEM.md`). Local end-to-end run on `gpt-5.4-mini`: plan 17 s / $0.012,
chat turn 4.5 s / $0.0023. Deployed: web https://pantrio-azure.vercel.app (Vercel project `pantrio`,
root `web/`, auto-deploys `main`), API https://pantrio-api.onrender.com (Render Blueprint from
`render.yaml`, free plan, sleeps when idle). Supabase Auth: anonymous sign-ins on, Site URL and
`/auth/callback` redirects set for the Vercel URL and localhost:3000. Live check: guest sign-in,
search, a 2-day plan (18.6 s, $0.005) and a chat turn all pass. Decision: guests are the public
way in; magic-link email is owner-only (Supabase's built-in sender, no custom domain for SMTP).
Step 5 (this PR): README rewritten (mermaid architecture and planner diagrams, eval table,
design decisions, limitations, screenshots in `docs/screenshots/`), `docs/demo-script.md` for
the video (to be recorded by the owner and linked in the README). Traces: root runs named
`plan`/`chat`, tagged `api|cli|eval`, with feedback `targets_met`, `repairs`, `fallbacks`,
`pantry_use` (plans) and `flagged_citations` (chat); "Pantrio live" LangSmith dashboard (EU)
built by `scripts/langsmith_dashboard.py`, filtered to `api` traffic. LangSmith's charts API
only accepts V2 definitions (`metric_definition` + `filter_definition`). Fixed plan day cards
overflowing at 1280 px. No prompt/model change, so no eval rerun. Paid evals workflow needs
`OPENAI_API_KEY` and `DATABASE_URL` repository secrets; `LANGSMITH_API_KEY` is set locally
(EU endpoint), so local eval runs upload LangSmith experiments.
User recipes (this PR): cookbook per user (migration 0005: `user_recipes`, usage kind `import`;
applied on Supabase), import from photos (shrunk to JPEG in the browser, not stored) or a link
(SSRF-guarded fetch, schema.org JSON-LD first, else page text), or typed in; one review form
for all three. Unknown foods get a model estimate (marked "Estimated"; the person can edit its
allergens); everything else is derived in code on every read. Not used by the planner (owner's
decision). Imports run at reasoning effort medium. `evals/reports/import-2026-10-16T185930Z.md`:
0 missed allergens, food matching 99%, $0.006 per import, p50 6.5 s / p95 11.5 s (effort low:
2 of 12 drafts missed an allergen; the named-food safety net fixed one, medium the other).
Bot-blocking sites (Allrecipes) refuse the fetch; the app suggests a screenshot.
Chat threads (this PR): migration 0006 (`chat_threads`, RLS; applied on Supabase), `/me/chats`
routes, `POST /chat` takes `thread_id` instead of client-sent history. Assistant page has a
thread list (left column on desktop, "Chats" drawer on mobile) and "New chat". No prompt,
tool or model change, so no eval rerun.
Header avatar (PR #13): food emoji on a soft tint, picked from a hash of the Supabase user id
(`web/src/lib/avatar.ts`); nothing stored, no backend change.
Server wake-up notice (PR #14): any API request pending over 3 s shows one shared Sonner toast
("Waking up the Pantrio server…") until every slow request answers (`request()` in
`web/src/lib/api.ts`); `AppShell` pings `/health` on mount to start the Render wake-up early.
Recipe photos (this PR): migration 0007 (`recipe_photos`, `user_recipes.photo_path`, usage kind
`photo`; applied on Supabase), public Storage bucket `recipe-photos` (created by `pantrio photos
generate`; needs `SUPABASE_SERVICE_ROLE_KEY`, also set on Render). All 300 corpus recipes
photographed with `gpt-image-2.5-flare` at 1536x1152 medium, stored as 1200x900 WebP: $4.15
total, $0.0138 per photo (408 output tokens each), p50 ~14.5 s / p95 ~20 s. OpenAI allows ~20
images/min, so the run uses 4 workers and SDK retries (6 workers hit 429s). Prompt chosen over
7 sample rounds (owner-reviewed): only the recipe's ingredients as garnish and props, no
generic herb bowls or salt dishes. Cookbook recipes get Generate/New/Remove photo
(`PANTRIO_DAILY_PHOTOS`, default 5). Web uses `next/image` (Vercel Hobby: 5K transformations a
month; `minimumCacheTTL` 31 days). No text-model prompt change, so no eval rerun.
Assistant first (this PR): Assistant is second in the nav (sidebar and mobile tabs) and Home
opens with an "Ask Pantrio" card (`web/src/components/ask-pantrio.tsx`: question box, starters,
last 3 chats); it links to `/assistant?q=` (asked in a new chat) or `?thread=`. Web only.

Profile picture (this PR): migration 0008 (`user_avatars`, path only; applied on Supabase), stored
in the `recipe-photos` bucket under `avatars/<user>/` (no new bucket). The browser crops to a
square and shrinks to JPEG; `PUT /me/avatar` re-encodes it as a 256 px WebP (`photos.to_avatar_webp`),
`DELETE /me/avatar` removes it, `/me` carries `avatar_url`. Header and Profile page show it, else the
emoji avatar. No model call, so no eval rerun.

Profile picture (this PR): migration 0008 (`user_avatars`, path only; applied on Supabase), stored
in the `recipe-photos` bucket under `avatars/<user>/` (no new bucket). The browser crops to a
square and shrinks to JPEG; `PUT /me/avatar` re-encodes it as a 256 px WebP (`photos.to_avatar_webp`),
`DELETE /me/avatar` removes it, `/me` carries `avatar_url`. Header and Profile page show it, else the
emoji avatar. No model call, so no eval rerun.
First-run tour (this PR): `web/src/components/tour.tsx`, 8 steps across Home, Assistant, Recipes,
Plan and Grocery, pointing at elements marked `data-tour="…"` (nav links carry `nav-<key>`; the
visible match wins because hidden pages stay mounted). Opens once per user id
(`localStorage["pantrio-tour-done:<id>"]`), replay from the account menu ("App tour") or Profile
("Help"). Web only, no new dependency, so no eval rerun.
Favicon (this PR): `web/src/app/icon.svg` (white lucide Leaf on the #3fa34d rounded square, like
`Logo`), with `apple-icon.png` (180 px) and `favicon.ico` (16/32/48) rendered from it with `sharp`.
File-convention icons, no `layout.tsx` change. Web only, so no eval rerun.
Mobile recipe filters (this PR): Recipes chips are four rows (Meal, Time, Diet, Cuisine) that scroll
sideways edge to edge below `md` (`no-scrollbar` utility) and wrap from `md`; shorter safety banner on
phones, so the first recipe shows above the fold at 390 px. Web only, so no eval rerun.
Cooking mode (this PR): `/recipes/[id]/cook` and `/recipes/mine/[id]/cook` (full-screen
`CookingMode` in `web/src/components/cooking-mode.tsx`): one step at a time, ingredient
checklist (with "for this step" chips matched from the step text), timers parsed from step text
in code (`web/src/lib/cooking.ts`, lower bound of a range), Screen Wake Lock, progress in
`localStorage["pantrio-cook:<user>:<corpus|mine>:<id>"]` for 12 h. "I cooked this" posts
`/me/cooked` (migration `20261019160000_cooked_meals`, RLS, applied on Supabase; latest 500 per user), which by
default takes the grams used out of measured pantry items (`cooking.py`; "some" items stay);
`/me/cooked/preview` shows that first. No model call, so no eval rerun.

Swap a meal (this PR): each meal on the Meal plan page has a swap button that opens a sheet
(`web/src/components/swap-meal.tsx`) listing recipes for that slot. `GET
/plans/latest/meals/{day}/{meal_type}/options` returns up to 6 recipes that pass the person's
current hard rules (SQL filters, then re-checked in code), best fit first; `PUT
/plans/latest/meals/{day}/{meal_type}` with `{plan_id, recipe_id}` re-checks the recipe, fits its
portions in code and saves the change in place (`Records.update_plan`; no migration, no new
plan, no usage event). A stale `plan_id` is a 409; a rule-breaking recipe a 422 with the
problems. The saved report keeps planning cost and path and recomputes warnings and pantry
use. No model call, so no eval rerun; offline tests cover ranking, rule checks and the API.

## Stack

- Python 3.12, `uv`, Pydantic v2, FastAPI, pytest, ruff.
- PostgreSQL + `pgvector`, SQL migrations in `supabase/migrations/` (add a new file; never
  edit an applied one). Plain SQL via `psycopg`, no ORM. Locally and in CI: Postgres 16 in
  Docker. Deployed: Supabase project `pantrio` (ref `tlnigvzkselebbtetibt`, eu-north-1,
  Postgres 17, pgvector 0.8.2), reached through the session pooler; migrations and seed run
  with `pantrio db migrate|seed`, not the Supabase CLI, so `pantrio_migrations` stays the
  record. The Supabase MCP server (claude.ai connector) can inspect tables and run SQL there.
  Tables in `public` are exposed by Supabase's REST API: enable row level security before any
  user data (pantry, profiles) lands. Migration 0003 enables RLS with no policies on every
  table: the REST roles see nothing; the API connects as the owner (`postgres`), which bypasses
  RLS. Create new tables with RLS enabled in the same migration.
- OpenAI Python SDK (Responses API, structured outputs, tool calling). Default chat model
  `gpt-5.4-mini`, the cheapest that passes the evals (override `PANTRIO_MODEL`; the first 144
  corpus recipes came from `gpt-5.5`), embeddings `text-embedding-3-small`
  (override `PANTRIO_EMBED_MODEL`). Do not use the Anthropic API.
- LangGraph for the planner and chat agent.
- LangSmith for tracing, datasets and experiments (`LANGSMITH_*`); everything works with
  tracing off when the variables are unset.
- Next.js App Router + Tailwind v4 + shadcn/ui (Base UI) in `web/`.

## Layout (keep this section current as code lands)

- `src/pantrio/schema.py`: Pydantic models (Recipe, Ingredient, NutritionFacts; enums for the
  14 EU allergens, diet tags, meal types, units; UserProfile, NutritionTargets, MealPlan,
  PantryItem, GroceryItem, GroceryList). Models sent as structured outputs carry field
  descriptions, which are part of the prompt.
- `src/pantrio/foods.py`: the ingredient table (`data/ingredients.csv` joined to
  `data/usda_foods.csv` and `data/ciqual_foods.csv`): source identity/attribution, unit conversion
  to grams, allergens and diet class per food,
  allergen and diet derivation.
- `src/pantrio/nutrition.py`: per-serving nutrition from ingredient grams (USDA SR Legacy
  and reviewed Ciqual 2025 additions; see `docs/nutrition-data.md`) and diet thresholds.
- `src/pantrio/corpus.py`: `RecipeDraft` (the model's structured output), `build_recipe`
  (normalise, compute, derive, reject allergen disagreements), `check_recipe`, load/save.
- `src/pantrio/embeddings.py`: embedding text builder and batched OpenAI embedding calls with
  a content-hash cache (DB + `.cache/embeddings/`) so re-ingest is free.
- `src/pantrio/search.py`: hybrid retrieval (pgvector cosine + Postgres full text, merged with
  reciprocal rank fusion) with hard SQL filters for allergens, diets, time, meal, cuisine and
  excluded foods; optional LLM query parser.
- `src/pantrio/config.py`: settings and prices from the environment; LangSmith helpers
  (`trace_config` names root runs `plan`/`chat` and tags them `api|cli|eval`; `log_feedback`
  attaches deterministic scores to a run; both no-ops with tracing off).
- `src/pantrio/constraints.py`: deterministic plan checks, the single source of truth for "is
  this plan safe and valid". Hard rules (allergens and diets re-derived from ingredients,
  excluded foods, time, meal slot, structure, unknown ids) vs soft goals (daily kcal +/-10%,
  protein minimum, carb limit, repeats); `fit_portions` sets 0.5-2 servings per meal in code.
- `src/pantrio/planner.py`: LangGraph graph profile -> retrieve -> draft -> check -> repair
  (max 2) -> finalise; one `search_recipes` tool (max 4 rounds), `PlanDraft` structured output,
  `store=False`. Finalise replaces any meal still breaking a hard rule with a safe candidate
  or raises; it never returns an unsafe plan. `RecipeStore` protocol (`DbStore` in prod,
  `tests.conftest.CorpusStore` offline).
- `src/pantrio/db.py`: connections, migrations (`pantrio_migrations` table), seeding,
  `load_recipes` (the trusted recipe source for the checker).
- `src/pantrio/cli.py`: `pantrio db migrate|seed`, `ingest`, `search`, `plan`, `pantry`,
  `profile`, `chat`, `corpus check`.
- `src/pantrio/pantry.py`: `resolve_food` (free text to food key: normalise, plural, aliases,
  else `UnknownFood` with suggestions), `make_item`, the `Kitchen` protocol (one user's profile
  and pantry) with `DbKitchen` (`user_profiles`, `pantry_items`) and `MemoryKitchen`.
- `src/pantrio/grocery.py`: plan needs in grams (portions x people), minus the pantry, by aisle,
  rounded up to shop amounts.
- `src/pantrio/swaps.py`: same-weight ingredient swaps re-derived like the corpus (nutrition,
  allergens, diets) and checked with `constraints.recipe_problems`; suggestions from the same
  aisle (or any protein) ranked by nutrition distance.
- `src/pantrio/meal_swap.py`: swap one meal of a saved plan, no model call. `meal_options`
  (candidates from `slot_filters` via `Catalog.browse`, re-checked with `recipe_violations`,
  ranked by distance to the day's targets, then pantry use, then calories) and `replace_meal`
  (re-checks the chosen recipe, fits portions with `constraints.fit_slot_portion`);
  `swapped_report` recomputes warnings and pantry use. `SwapError` carries the HTTP status.
- `src/pantrio/assistant.py`: LangGraph chat agent agent -> tools (max 4 rounds) -> guard;
  tools search_recipes, check_pantry, update_pantry, swap_ingredient, scale_recipe; replies
  cite recipes as `[recipe-id]` and the guard appends a note for any cited recipe that breaks
  a hard rule or does not exist.
- `src/pantrio/auth.py`: verifies Supabase Auth access tokens (ES256 via the project JWKS,
  audience `authenticated`, issuer `SUPABASE_URL/auth/v1`); returns the user id.
- `src/pantrio/records.py`: saved plans (`save_plan`, `latest_plan`, `update_plan` for a swap)
  and the usage log per user (`Records` protocol, `DbRecords` on `meal_plans`/`usage_events`,
  `MemoryRecords` for tests).
- `src/pantrio/chats.py`: saved assistant threads per user (`Chats` protocol, `DbChats` on
  `chat_threads`, `MemoryChats`): model `history` plus the `messages` the app shows; titled
  from the first message; 100 threads per user, least recently used dropped.
- `src/pantrio/cookbook.py`: the person's own recipes. `CookbookRecipeIn` (what is stored:
  lines with a table `food` or a `FoodEstimate`), `derive` (grams, nutrition, allergens, diets
  in code; estimates join the food table for that recipe only), `problems_for`, the `Cookbook`
  protocol (`DbCookbook` on `user_recipes`, `MemoryCookbook`), 200 recipes per user.
- `src/pantrio/recipe_import.py`: `Importer` (one structured-output call, effort medium,
  `store=False`) `from_link` / `from_html` / `from_photos` / `from_text` / `from_post` (caption,
  then a recipe site it links: a second call on the same import) / `estimate`; `fetch_page` with SSRF
  guards; `jsonld_recipe`, `page_text`; `to_draft` checks every line in code and returns notes;
  `with_named_allergens` adds the allergens of table foods an estimated line names.
- `src/pantrio/social.py`: TikTok/Instagram/Facebook posts. `detect`, short links, `clean_url`
  (tracking query dropped), `fetch_post` (TikTok oEmbed; Instagram/Facebook Open Graph tags;
  all through `fetch_page`, Pantrio's own user agent; refusal or empty caption -> "Paste the
  caption"), `pasted_post` (no fetch), `caption_links` (skips platforms, link-in-bio pages,
  and shops; short links are kept and followed), `platform_page` (profiles refused before a paid call). Never downloads or stores videos.
- Video import (`recipe_import.py`): `check_audio` (WAV only, 1 s to 3 min, 12 MB),
  `Importer.transcribe` and `from_video(audio, frames, url, caption, guided)`; vague spoken
  amounts become notes ("the video only says ..."). Audio and frames are never stored.
- `src/pantrio/post_media.py`: reel audio from a link. `MediaSource` (`ApifyMedia`: one actor
  run per post, one actor per platform in `ACTORS`, token only to api.apify.com; `NoMedia`),
  `media_source()` from the environment (off by default),
  `fetch_video` (SSRF-guarded via `recipe_import.fetch_bytes`, 60 MB), `read_video` (PyAV in
  memory: 16 kHz mono WAV, 4 JPEG frames). `Importer(media=, meter=)` uses it in `from_post`
  only when the caption and links give no full recipe; `operations.ReelMeter` caps runs.
- `src/pantrio/photos.py`: recipe photos. `photo_prompt` (the dish as the recipe makes it:
  ingredient names and final step, garnish and background props only from those ingredients,
  bread only if used or suggested and never for gluten-free; fixed stoneware/stone/linen
  scene), `generate` (`PANTRIO_IMAGE_MODEL`, 1536x1152 = 4:3, stored as 1200x900 WebP),
  `SupabasePhotos` (public bucket `recipe-photos`, service role key), `photograph_corpus`.
  The DB stores paths only (`recipe_photos`, `user_recipes.photo_path`); `public_url` builds
  URLs from `SUPABASE_URL`. Corpus paths carry a hash of prompt + model, so only changed
  recipes regenerate.
- `src/pantrio/cooking.py`: "I cooked this": `grams_used` (per food for the servings cooked)
  and `use_from_pantry` (measured items go down in their own unit, removed under 0.5 g; items
  without an amount stay). The cooking log is in `records.py` (`Cooked`, `cooked_meals`).
- `src/pantrio/api.py`: FastAPI app (`create_app(backend, verify)`; tests pass an in-memory
  backend). Routes: `/health`, `/meta`, `/foods`, `/me`, `/me/profile`, `/me/pantry`,
  `/me/usage`, `/me/avatar` (PUT/DELETE), `/recipes` (search or browse, profile rules as filters unless `safe=false`),
  `/recipes/{id}`, `/recipes/{id}/swaps`, `POST /plans` (SSE: `step`, then `plan` or `error`),
  `/plans/latest`, `/plans/latest/grocery`, `/plans/latest/meals/{day}/{meal_type}` (`/options`
  GET, PUT to swap), `POST /chat` (continues `thread_id` or starts a
  thread; the server supplies the thread's history), `/me/chats` (list, get, delete),
  `/me/cooked` (GET log, POST "I cooked this"; `/preview`), `/me/recipes` (cookbook CRUD,
  `/preview`, `/import/link`, `/import/photos`, `/import/post`, `/import/text`, `/import/video`, `/estimate`, `/{id}/photo` POST/DELETE). Every
  recipe returned carries the hard rules it breaks for the person's current profile and its
  `photo_url` (or null). Paid calls are capped per user per day (`PANTRIO_DAILY_PLANS`,
  `PANTRIO_DAILY_CHATS`, `PANTRIO_DAILY_IMPORTS`, `PANTRIO_DAILY_PHOTOS`) and in total
  (`PANTRIO_DAILY_BUDGET_USD`).
- `render.yaml`: Render Blueprint for the API.
- `data/`: `ingredients.csv` (hand-curated), `usda_foods.csv` (built by
  `scripts/build_usda_table.py`), `dish_briefs.csv` (300 fixed briefs), `recipes/*.json`
  (generated corpus, one file per recipe), `corpus_manifest.json` (generation runs and cost).
- `scripts/`: `generate_corpus.py`, `build_usda_table.py`, `langsmith_dashboard.py` (rebuilds the
  "Pantrio live" LangSmith dashboard via the charts API).
- `docs/`: `demo-script.md` (video walkthrough), `screenshots/` (README images, taken from the
  web app at 1280 px wide).
- `supabase/migrations/`: SQL migrations.
- `evals/`: `retrieval_queries.py` (deterministic query generator) -> `data/retrieval_queries.json`,
  `plan_profiles.py` (16 eval profiles) -> `data/plan_profiles.json`, `chat_cases.py` (24
  assistant cases) -> `data/chat_cases.json`, `import_cases.py` (12 synthetic recipe pages,
  11 post captions) -> `data/import_cases.json`, `video_cases.py` (6 spoken cooking videos) ->
  `data/video_cases.json`, `video_audio.py` (TTS audio -> `data/video_audio/*.wav`, committed;
  frames drawn at run time), `metrics.py`, `run_retrieval.py`, `run_planner.py`,
  `run_assistant.py`, `run_import.py`, `run_video.py`, `reports/`.
- `.github/workflows/evals.yml`: manual paid evals (needs `OPENAI_API_KEY`, `DATABASE_URL`
  repository secrets).
- `tests/`: offline tests; OpenAI is mocked. DB tests run when `PANTRIO_TEST_DATABASE_URL` is
  set. Paid tests are marked `live`.
- `web/`: Next.js 16 App Router (Cache Components on), Tailwind v4, shadcn/ui on Base UI;
  see `web/DESIGN_SYSTEM.md` (tokens live in `src/app/globals.css`). Signed-in screens are
  client components under `src/app/(app)/` fetching the API with SWR (`src/lib/hooks.ts`,
  `src/lib/api.ts`, types in `src/lib/types.ts` mirror `api_models.py`); Supabase is used only for
  sign-in (magic link or anonymous guest). The cookbook lives under `recipes/mine` (list,
  `new`, `[id]`) with the shared form in `src/components/cookbook-form.tsx`; "From a post" can
  import the post directly, with an estimated countdown. The first-run tour
  is `src/components/tour.tsx` (`TourProvider` in `AppShell`, `useTour().start`). Cooking mode is
  `src/components/cooking-mode.tsx` with helpers in `src/lib/cooking.ts`. The assistant's
  thread list is `src/components/chat-threads.tsx`; the Home card is `src/components/ask-pantrio.tsx`. `RecipeArt` (`src/components/bits.tsx`)
  shows the recipe photo with `next/image` (host allowed from `NEXT_PUBLIC_SUPABASE_URL` in
  `next.config.ts`) or the meal-type art when there is none. Read `web/AGENTS.md`: this Next.js differs from
  older versions (e.g. `proxy.ts` replaces middleware; check `node_modules/next/dist/docs/`).

## Commands

```bash
uv sync                                  # install
uv run pytest                            # offline tests (no API calls)
uv run ruff check . && uv run ruff format --check .
docker compose up -d db                  # local Postgres 16 + pgvector
uv run pantrio db migrate && uv run pantrio db seed   # DATABASE_URL (config loads .env)
uv run pantrio ingest                    # embed the corpus (needs OPENAI_API_KEY)
uv run pantrio search "quick vegan dinner with chickpeas" [--parse] [--mode vector|fulltext]
uv run pantrio corpus check              # re-derive nutrition/allergens/diets, report drift
uv run python scripts/generate_corpus.py [--sample | --only ids | --force | --limit n]  # paid
#   other model for one run: PANTRIO_MODEL=<model> PANTRIO_PRICE_INPUT_PER_MTOK=<usd> \
#   PANTRIO_PRICE_OUTPUT_PER_MTOK=<usd> (shell variables override .env)
uv run python scripts/build_usda_table.py           # rebuild data/usda_foods.csv
uv run python scripts/build_ciqual_table.py         # pinned workbook -> reviewed Ciqual subset
uv run python -m evals.retrieval_queries # regenerate labelled queries from the corpus
uv run python -m evals.run_retrieval     # retrieval eval (vector vs full text vs hybrid)
uv run pantrio plan vegan-high-protein   # plan for an eval profile id or a UserProfile JSON file
uv run python -m evals.plan_profiles     # regenerate the planner eval profiles
uv run python -m evals.run_planner [--only ids]   # planner eval (paid; ~$0.03/plan on mini)
uv run pantrio plan --user me --grocery [--people 2]   # plan from a saved profile + grocery list
uv run pantrio profile set coeliac --with-pantry [--user me]   # save a profile (file or eval id)
uv run pantrio pantry add eggs 6 piece | remove eggs | list [--user me]   # or PANTRIO_USER
uv run pantrio chat [--user me] [--message "..."]  # cooking assistant (paid)
uv run python -m evals.chat_cases        # regenerate the assistant eval cases
uv run python -m evals.run_assistant [--only ids] # assistant eval (paid; ~$0.002/turn)
uv run python -m evals.import_cases      # regenerate the recipe-import eval pages
uv run python -m evals.run_import [--only ids] [--instructions-from <git ref>]  # recipe-import eval (paid; ~$0.006/import)
uv run python -m evals.video_cases       # regenerate the video-import eval cases
uv run python -m evals.video_audio [--only ids] [--force]   # their audio, once (paid TTS)
uv run python -m evals.run_video [--plain] [--transcribe-model m --transcribe-price usd] [--only ids]  # video eval (paid)
uv run python -m evals.reel_cases        # regenerate the reel eval cases
uv run python -m evals.run_reel [--media off] [--fee usd] [--only ids]   # reel eval, fake service (paid)
uv run python scripts/reel_media_check.py --actor <id> --input '<json with {url}>' <post links>  # Apify actor check
uv run pytest -m live -s                 # paid evals with pass/fail thresholds
uv run pantrio photos generate [--only ids] [--limit n] [--force] [--dry-run]  # corpus photos (paid; ~$0.014 each)
uv run python scripts/langsmith_dashboard.py [--source api|cli|eval|all]  # LangSmith dashboard
uv run uvicorn pantrio.api:app --env-file .env --reload   # API on :8000 (SUPABASE_URL, DATABASE_URL)
cd web && npm ci && npm run dev          # :3000; web/.env.local from web/.env.example
cd web && npm run lint && npm run typecheck && npm run build   # what CI runs for web
```

Update this block when commands change.

## Conventions

- **Safety is deterministic.** The LLM proposes; `constraints.py` decides. Allergen and diet
  filters run in SQL before retrieval and again on the final plan. A plan with any allergen
  violation is never returned to the user, whatever the model says.
- Extract and store what the source says; normalise units in code, not in prompts.
- Any change to a prompt, schema, tool definition, retrieval setting or model comes with a
  before/after eval run, and the numbers go in the PR description.
- Evals report quality, cost per call (from token usage and `PANTRIO_PRICE_*_PER_MTOK`) and
  latency (p50/p95). The live gate fails on any constraint violation.
- Eval data and seed data are generated deterministically and committed; tests check the
  committed files match the generators.
- Agents use `store=False` on the Responses API and cap tool-call iterations.
- Secrets (OpenAI key, database URL, LangSmith key, Supabase service role key) come only from
  the environment. `.env.example` lists every variable with no real values.
- Explain cooking and nutrition terms plainly in docs and UI (for example, "macros" means
  protein, carbs and fat).

## Git and PRs

- Every commit and PR is authored by **Mike Gauci
  <13453945+mikegauci@users.noreply.github.com>**. Set `git config user.name "Mike Gauci"` and
  `git config user.email "13453945+mikegauci@users.noreply.github.com"` before committing.
  No `Co-Authored-By` or `Claude-Session` trailers.
- Branches: `feat/<short-feature-name>` in kebab-case, `fix/<name>` for bug fixes. No random
  suffixes.
- Commit messages use plain descriptive text. `feat/` and `fix/` are branch prefixes only;
  do not prefix commit messages with them.
- PR titles say specifically what the PR does (for example "Add hybrid recipe search with
  pgvector and a 60-query retrieval eval"). No "Step N" prefix and no branch names.
- CI (GitHub Actions) runs ruff, pytest against Postgres 16 + pgvector, and the web
  typecheck/lint/build. Paid evals are manual `workflow_dispatch` jobs.
- **Ship every build-plan step or big feature without asking** (standing approval to push and
  merge):
  1. Work on a `feat/<name>` branch off up-to-date `main` (never commit to `main`).
  2. Run ruff and pytest locally; commit (split into readable commits) and
     `git push -u origin <branch>`.
  3. Open the PR with `gh pr create --base main` (title per the rule above; body has a summary,
     the eval numbers when relevant, and a test plan).
  4. Watch CI with `gh pr checks <pr> --watch --fail-fast`. On failure, read the logs
     (`gh run view <run-id> --log-failed`), fix, push and watch again. Stop and ask after three
     failed attempts or when the fix needs a product decision.
  5. When every check passes, merge with `gh pr merge <pr> --merge --delete-branch` (merge
     commit, so the split commits stay), then `git switch main && git pull`.
  6. Update the Status section of this file in that PR's last commit, before merging.
