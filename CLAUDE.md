# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Pantrila

AI cooking and meal-planning assistant. A user tells Pantrila what is in their kitchen, their
diet, allergies and nutrition targets; Pantrila finds recipes with RAG over a recipe corpus,
plans a week of meals with a LangGraph agent that uses tool calling, builds a grocery list
from what is missing, and answers cooking questions in a chat. Every plan is checked by
deterministic rules (allergens, diet, nutrition targets) before the user sees it.

This is a portfolio project for AI Engineer roles: retrieval quality, eval numbers, cost and
latency per plan, and clear architecture matter as much as features.

## Build plan

1. **Recipe corpus + RAG + retrieval evals**: Python package `pantrila`, recipe and ingredient
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
6. **iPhone and Android apps (Expo)**: React Native app in `mobile/` on the same API and Supabase
   Auth, shared logic in `packages/core`, Free and Pro tiers (RevenueCat; €4.99 a month or €29.99 a
   year, 7-day trial), EAS builds and store submission. 15 steps (PR 0 for the owner's accounts,
   then PR 1-14), each its own PR, in
   [`docs/plans/mobile-app.md`](docs/plans/mobile-app.md).
7. **Cooking XP, bingo cards and sharing**: XP and chef levels from cooking, cook cards that tag the recipe's
   creator, a weekly cooking goal, Plan Bingo, badges, level rewards and referrals (some Pro time), quiet push
   notifications, published recipes, Kitchen Circles and Pro challenge cards. 10 PRs in
   [`docs/plans/gamification.md`](docs/plans/gamification.md); never rewards eating less.

Work on one step at a time; each step is its own PR (commits within it can be split for a
readable history). Start a fresh Claude Code chat per step; this file carries the context.

## Mobile apps (current track)

Building the iOS and Android apps with Expo in [`docs/plans/mobile-app.md`](docs/plans/mobile-app.md). Every code
PR (1-14) has landed; fixes from testers come as `fix/` PRs. To continue the plan, read that file first and finish
by ticking its checklist, updating Progress and the handoff log, and adding a Status entry.

Owner's state (2026-10-26). Done: EAS project `@mikegauci/pantrila`; Google iOS and Android OAuth clients and
Supabase's Google client ids ("Skip nonce checks" on) and `pantrila://auth/callback`; EAS variables (Google client
ids, Supabase publishable key, `EXPO_PUBLIC_SENTRY_DSN`, `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN`);
RevenueCat project with entitlement `pro` and a placeholder `default` offering, webhook to
`/webhooks/revenuecat` returning 200, `REVENUECAT_WEBHOOK_SECRET` on Render; Play developer account verified (device
check passed on Samsung Remote Test Lab); Play app "Pantrila: AI Cooking Companion" (`com.pantrila.app`) with its
setup checklist, store listing, icon, feature graphic (`docs/store-assets/`) and phone screenshots (web app at
phone size); reviewer account `pantrila.review@gmail.com` for Play's sign-in details. Closed test "Alpha" (versionCode 2, tester group
`testers-community@googlegroups.com`) sent for Google's review on 2026-10-27; a second Google Android client "Pantrila
Android (Play)" with Play's app signing SHA-1, and `ANDROID_CERT_SHA256` (Play signing + EAS upload SHA-256) on Vercel. Android builds on EAS:
production 0.1.0 (versionCode 2, no RevenueCat key) and a preview APK.
Still to do: upload the production `.aab` to Play internal testing, then closed testing (Testers Community for most
of the 12 testers, 14 days) and apply for production; Play subscription `pantrila_pro` (`monthly` EUR 4.99, `yearly`
EUR 29.99, 7-day trial); RevenueCat Android app (Play service account), products in the offering, and
`EXPO_PUBLIC_REVENUECAT_ANDROID_KEY` on EAS, then a new build; confirm `REVENUECAT_API_KEY` on Render with a sandbox
purchase; make the reviewer account Pro (a `manual` `entitlements` row; not yet confirmed); everything Apple once the
team is active (App Store Connect app, Sign in with Apple, products, iOS key, iOS build, TestFlight, review);
`APPLE_TEAM_ID` on Vercel (`docs/share-and-links.md`); `NEXT_PUBLIC_APP_STORE_ID` /
`NEXT_PUBLIC_PLAY_STORE_LIVE` on both Vercel projects once listed; phone screenshots in the README. Maestro flows
on EAS need a paid Expo plan (run locally with the Maestro CLI instead). The owner has no Android phone and this
Mac (2017, dual-core) cannot run the Android emulator.

## Status (update as work lands)

The full history of shipped changes, with each PR's eval numbers, is [`docs/status-log.md`](docs/status-log.md)
(newest first). When a PR lands, add its entry at the top of that file in the same style (what changed, where it
lives, eval before/after or "no model call, so no eval rerun"), and update this summary only when what is true now
changes. Keep this section short.

Where things stand (2026-10-26):

- **Live**: web https://app.pantrila.com (Vercel project `pantrila`, root `web/`, deploys `main`); landing site
  https://pantrila.com (Vercel `pantrila-site`, root `site/`); API https://api.pantrila.com (Render `pantrila-api`,
  free plan, UptimeRobot pings `/health` every 5 min); Supabase project `pantrila`. Sign-in: Google, email link
  (Resend, `send.pantrila.com`), anonymous guests. Errors to Sentry EU, funnel and replays to PostHog EU.
- **Product**: ask (streaming assistant with tools and a citation guard), save (imports from posts, links, photos and
  text as background jobs), cook (cooking mode with voice and timers), plan and shop (LangGraph planner checked by
  `constraints.py`, meal menu, grocery list). Free and Pro tiers (RevenueCat webhook to `entitlements`).
- **Latest eval reports** (`evals/reports/`): retrieval `retrieval-2026-10-15T195536Z` (hybrid recall@10 0.843,
  MRR 0.922); planner `planner-2026-10-16T084243Z` (16 profiles) and `planner-2026-10-22T113756Z` (energy ranges);
  assistant `assistant-2026-10-23T121004Z`; import `import-2026-10-22T130618Z`; reel `reel-2026-10-22T134102Z`;
  video `video-2026-10-21T103356Z`. The Insights page reads `evals/report_selection.json`.
- **Phone apps**: every code PR of `docs/plans/mobile-app.md` has landed; EAS builds work again (runtime version =
  app `version`). Owner steps are under "Mobile apps" above.
- **Next planned work**: [`docs/plans/guest-safeguards.md`](docs/plans/guest-safeguards.md) (CAPTCHA, guest limits,
  link prompt; after launch) and [`docs/plans/european-ingredients-and-recipe-expansion.md`](docs/plans/european-ingredients-and-recipe-expansion.md)
  (PR 1 merged; PR 2 next), and [`docs/plans/gamification.md`](docs/plans/gamification.md) (XP, cook cards, bingo,
  rewards, Circles; start once the Play closed test runs). Follow the user's chosen task; a plan existing is not a request to start it.

## Stack

- Python 3.12, `uv`, Pydantic v2, FastAPI, pytest, ruff.
- PostgreSQL + `pgvector`, SQL migrations in `supabase/migrations/` (add a new file; never
  edit an applied one). Plain SQL via `psycopg`, no ORM. Locally and in CI: Postgres 16 in
  Docker. Deployed: Supabase project `pantrila` (ref `tlnigvzkselebbtetibt`, eu-north-1,
  Postgres 17, pgvector 0.8.2), reached through the session pooler; migrations and seed run
  with `pantrila db migrate|seed`, not the Supabase CLI, so `pantrio_migrations` stays the
  record. The Supabase MCP server (claude.ai connector) can inspect tables and run SQL there.
  Tables in `public` are exposed by Supabase's REST API: enable row level security before any
  user data (pantry, profiles) lands. Migration 0003 enables RLS with no policies on every
  table: the REST roles see nothing; the API connects as the owner (`postgres`), which bypasses
  RLS. Create new tables with RLS enabled in the same migration.
- OpenAI Python SDK (Responses API, structured outputs, tool calling). Default chat model
  `gpt-5.4-mini`, the cheapest that passes the evals (override `PANTRILA_MODEL`; the first 144
  corpus recipes came from `gpt-5.5`), embeddings `text-embedding-3-small`
  (override `PANTRILA_EMBED_MODEL`). Do not use the Anthropic API.
- LangGraph for the planner and chat agent.
- LangSmith for tracing, datasets and experiments (`LANGSMITH_*`); everything works with
  tracing off when the variables are unset.
- Next.js App Router + Tailwind v4 + shadcn/ui (Base UI) in `web/`.

## Layout (keep this section current as code lands)

- `src/pantrila/schema.py`: Pydantic models (Recipe, Ingredient, NutritionFacts; enums for the
  14 EU allergens, diet tags, meal types, units; UserProfile, NutritionTargets, MealPlan,
  PantryItem, GroceryItem, GroceryList). Models sent as structured outputs carry field
  descriptions, which are part of the prompt.
- `src/pantrila/foods.py`: the ingredient table (`data/ingredients.csv` joined to
  `data/usda_foods.csv` and `data/ciqual_foods.csv`): source identity/attribution, unit conversion
  to grams, allergens and diet class per food,
  allergen and diet derivation.
- `src/pantrila/nutrition.py`: per-serving nutrition from ingredient grams (USDA SR Legacy
  and reviewed Ciqual 2025 additions; see `docs/nutrition-data.md`) and diet thresholds.
- `src/pantrila/corpus.py`: `RecipeDraft` (the model's structured output), `build_recipe`
  (normalise, compute, derive, reject allergen disagreements), `check_recipe`, load/save.
- `src/pantrila/embeddings.py`: embedding text builder and batched OpenAI embedding calls with
  a content-hash cache (DB + `.cache/embeddings/`) so re-ingest is free.
- `src/pantrila/search.py`: hybrid retrieval (pgvector cosine + Postgres full text, merged with
  reciprocal rank fusion) with hard SQL filters for allergens, diets, time, meal, cuisine and
  excluded foods; optional LLM query parser.
- `src/pantrila/config.py`: settings and prices from the environment; `init_sentry`; LangSmith helpers
  (`trace_config` names root runs `plan`/`chat` and tags them `api|cli|eval`; `log_feedback`
  attaches deterministic scores to a run; both no-ops with tracing off).
- `src/pantrila/constraints.py`: deterministic plan checks, the single source of truth for "is
  this plan safe and valid". Hard rules (allergens and diets re-derived from ingredients,
  excluded foods, time, meal slot, structure, unknown ids) vs soft goals (daily kcal +/-10%,
  protein minimum, carb limit, repeats); `fit_portions` sets 0.5-2 servings per meal in code.
- `src/pantrila/planner.py`: LangGraph graph profile -> retrieve -> draft -> check -> repair
  (max 2) -> finalise; one `search_recipes` tool (max 4 rounds), `PlanDraft` structured output,
  `store=False`. Finalise replaces any meal still breaking a hard rule with a safe candidate
  or raises; it never returns an unsafe plan. `RecipeStore` protocol (`DbStore` in prod,
  `tests.conftest.CorpusStore` offline).
- `src/pantrila/db.py`: connections, migrations (`pantrio_migrations` table), seeding,
  `load_recipes` (the trusted recipe source for the checker).
- `src/pantrila/cli.py`: `pantrila db migrate|seed`, `ingest`, `search`, `plan`, `pantry`,
  `profile`, `chat`, `corpus check`.
- `src/pantrila/pantry.py`: `resolve_food` (free text to food key: normalise, plural, aliases,
  else `UnknownFood` with suggestions), `make_item`, the `Kitchen` protocol (one user's profile
  and pantry) with `DbKitchen` (`user_profiles`, `pantry_items`) and `MemoryKitchen`.
- `src/pantrila/grocery.py`: plan needs in grams (portions x people), minus the pantry, by aisle,
  rounded up to shop amounts.
- `src/pantrila/swaps.py`: same-weight ingredient swaps re-derived like the corpus (nutrition,
  allergens, diets) and checked with `constraints.recipe_problems`; suggestions from the same
  aisle (or any protein) ranked by nutrition distance.
- `src/pantrila/meal_swap.py`: change one meal of a saved plan, no model call. `PlanCatalog`
  (corpus + the person's cookbook as `mine-<id>`), `meal_options` (candidates from
  `slot_filters` via `Catalog.browse`, or the cookbook with `source="mine"`; query and
  quick/pantry filters in code; re-checked with `recipe_violations`, ranked by distance to the
  day's targets, then pantry use, then calories), `replace_meal` (re-checks the chosen recipe,
  fits portions with `constraints.fit_slot_portion`, moves leftovers along) and `set_slot`
  (skip, eating out, leftovers, add back) and `repeat_meal` (several leftovers at once);
  `swapped_report` recomputes warnings and pantry
  use. `SwapError` carries the HTTP status.
- `src/pantrila/assistant.py`: LangGraph chat agent (presearch in code) -> agent -> tools (max 4 rounds) -> guard;
  tools search_recipes, check_pantry, update_pantry, swap_ingredient, scale_recipe; replies
  cite recipes as `[recipe-id]` and the guard appends a note for any cited recipe that breaks
  a hard rule or does not exist.
- `src/pantrila/accounts.py`: account deletion (`USER_TABLES`, `erase_rows`, `storage_folders`,
  `SupabaseAuthAdmin` deletes the Auth user); `Backend.erase` and `Backend.admin` wire it in.
- `src/pantrila/entitlements.py`: Pantrila Pro (`Entitlement`, `tier_of`, `from_subscriber`, `RevenueCatApi`,
  `DbEntitlements`/`MemoryEntitlements`); caps per tier are `operations.allowance`.
- `src/pantrila/analytics.py`: PostHog funnel events from the API (`Analytics`, `PostHogAnalytics`,
  `MemoryAnalytics`), `Visits` (once-a-day sign-up/open/return from `user_activity`), `client_of` (the
  `X-Pantrila-Client` header: ios, android or web, sent as each event's `client`).
- `src/pantrila/auth.py`: verifies Supabase Auth access tokens (ES256 via the project JWKS,
  audience `authenticated`, issuer `SUPABASE_URL/auth/v1`); returns the user id.
- `src/pantrila/records.py`: saved plans (`save_plan`, `latest_plan`, `update_plan` for a swap)
  and the usage log per user (`Records` protocol, `DbRecords` on `meal_plans`/`usage_events`,
  `MemoryRecords` for tests).
- `src/pantrila/chats.py`: saved assistant threads per user (`Chats` protocol, `DbChats` on
  `chat_threads`, `MemoryChats`): model `history` plus the `messages` the app shows; titled
  from the first message; 100 threads per user, least recently used dropped.
- `src/pantrila/cookbook.py`: the person's own recipes. `CookbookRecipeIn` (what is stored:
  lines with a table `food` or a `FoodEstimate`, an optional `section` per line, `step_sections` headings), `bare_name`
  (drops a leading amount from a line's name), `derive` (grams, nutrition, allergens, diets
  in code; estimates join the food table for that recipe only), `problems_for`, the `Cookbook`
  protocol (`DbCookbook` on `user_recipes`, `MemoryCookbook`), 200 recipes per user.
- `src/pantrila/recipe_import.py`: `Importer` (one structured-output call, effort medium,
  `store=False`) `from_link` / `from_html` / `from_photos` / `from_text` / `from_post` (caption,
  then a recipe site it links: a second call on the same import) / `estimate`; `fetch_page` with SSRF
  guards; `jsonld_recipe` (adds `ingredientSections` via `ingredient_groups`), `page_text`; `to_draft` checks every line in code and returns notes;
  `with_named_allergens` adds the allergens of table foods an estimated line names.
- `src/pantrila/import_jobs.py`: `ImportJobs` behind background imports (`app.state.import_jobs`):
  `DbImportJobs` on `import_jobs` with per-process leases and take-over after a restart, `MemoryImportJobs`; web side is `web/src/lib/import-jobs.ts`. The new recipe's photo is made in the
  background by `web/src/lib/photo-jobs.ts`.
- `src/pantrila/social.py`: TikTok/Instagram/Facebook posts. `detect`, short links, `clean_url`
  (tracking query dropped), `fetch_post` (TikTok oEmbed; Instagram/Facebook Open Graph tags;
  all through `fetch_page`, Pantrila's own user agent; refusal or empty caption -> "Paste the
  caption"), `pasted_post` (no fetch), `caption_links` (skips platforms, link-in-bio pages,
  and shops; short links are kept and followed), `platform_page` (profiles refused before a paid call). Never downloads or stores videos.
- Video import (`recipe_import.py`): `check_audio` (WAV only, 1 s to 3 min, 12 MB),
  `Importer.transcribe` and `from_video(audio, frames, url, caption, guided)`; vague spoken
  amounts become notes ("the video only says ..."). Audio and frames are never stored.
- `src/pantrila/post_media.py`: reel audio from a link. `MediaSource` (`ApifyMedia`: one actor
  run per post, one actor per platform in `ACTORS`, token only to api.apify.com; `NoMedia`),
  `creator_comments` (`COMMENT_ACTORS`, `COMMENT_LIMIT` comments; keeps only the post creator's,
  used by `Importer._creator_links` before the video),
  `media_source()` from the environment (off by default),
  `fetch_video` (SSRF-guarded via `recipe_import.fetch_bytes`, 60 MB), `read_video` (PyAV in
  memory: 16 kHz mono WAV, 4 JPEG frames). `Importer(media=, meter=)` uses it in `from_post`
  only when the caption and links give no full recipe; `operations.ReelMeter` caps runs.
- `src/pantrila/photos.py`: recipe photos. `photo_prompt` (the dish as the recipe makes it:
  ingredient names and final step, garnish and background props only from those ingredients,
  bread only if used or suggested and never for gluten-free; fixed stoneware/stone/linen
  scene), `generate` (`PANTRILA_IMAGE_MODEL`, 1536x1152 = 4:3, stored as 1200x900 WebP),
  `SupabasePhotos` (public bucket `recipe-photos`, service role key), `photograph_corpus`.
  The DB stores paths only (`recipe_photos`, `user_recipes.photo_path`); `public_url` builds
  URLs from `SUPABASE_URL`. Corpus paths carry a hash of prompt + model, so only changed
  recipes regenerate.
- `src/pantrila/cooking.py`: "I cooked this": `grams_used` (per food for the servings cooked)
  and `use_from_pantry` (measured items go down in their own unit, removed under 0.5 g; items
  without an amount stay). The cooking log is in `records.py` (`Cooked`, `cooked_meals`).
- `src/pantrila/api.py`: FastAPI app (`create_app(backend, verify)`; tests pass an in-memory
  backend). Routes: `/health`, `/meta`, `/foods`, `/me`, `/me/profile`, `/me/pantry`,
  `/me/usage`, `/webhooks/revenuecat`, `/me/avatar` (PUT/DELETE), `DELETE /me` (the whole account), `POST /me/events` (funnel steps from the apps: cooking mode, the paywall), `/recipes` (search or browse, profile rules as filters unless `safe=false`, `limit`/`offset` pages),
  `/recipes/{id}`, `/recipes/{id}/swaps`, `POST /plans` (SSE: `step`, then `plan` or `error`),
  `/plans/latest`, `/plans/latest/grocery`, `/plans/latest/meals/{day}/{meal_type}` (`/options`
  GET, PUT to swap), `POST /chat` (continues `thread_id` or starts a
  thread; the server supplies the thread's history; `POST /chat/stream` is the same as SSE), `/me/chats` (list, get, delete),
  `/me/cooked` (GET log, POST "I cooked this"; `/preview`), `/me/recipes` (cookbook CRUD,
  `/preview`, `/import/link|photos|post|text` (one request), `/import/jobs` POST + `/import/jobs/{id}` GET (the same imports as background jobs), `/import/timing`, `/estimate`, `/{id}/photo` POST/DELETE). Every
  recipe returned carries the hard rules it breaks for the person's current profile and its
  `photo_url` (or null). Paid calls are capped per user and tier (Pro: `PANTRILA_DAILY_PLANS`,
  `PANTRILA_DAILY_CHATS`, `PANTRILA_DAILY_IMPORTS`, `PANTRILA_DAILY_PHOTOS`; Free: `PANTRILA_FREE_*`)
  and in total (`PANTRILA_DAILY_BUDGET_USD`).
- `render.yaml`: Render Blueprint for the API.
- `package.json` (root): npm workspaces `web`, `mobile` and `packages/*`; one `package-lock.json` at the root.
- `mobile/`: the Expo phone app (see `mobile/README.md` and `mobile/AGENTS.md`: read Expo's versioned docs,
  not memory). `app.config.ts`, `eas.json`, `metro.config.js` (Uniwind), `src/global.css` (tokens),
  `expo-updates` (runtime version = app `version`, channels per build profile), `src/app/` (Expo Router screens; `_layout.tsx` loads the fonts and guards `welcome` / the signed-in screens
  with `Stack.Protected`; `(tabs)/` holds Home, Assistant, Recipes, Plan, Grocery; `recipes/[id]`,
  `recipes/mine/*`, `account.tsx`, `pantry.tsx`, `profile.tsx`, `pro.tsx` (the paywall, `lib/pro.ts`) and `intro.tsx` (first-run cards, `lib/intro.ts`) open over them; `auth/callback.tsx` finishes email links),
  `src/lib/api.ts` (`createApi` with `expo/fetch`, the session's token, `X-Pantrila-Client` and `waking.ts`), `src/lib/sentry.ts`
  (errors and feedback), `src/lib/purchases.ts` (RevenueCat: offers, buy, restore, manage), `src/lib/hooks.ts`
  (SWR hooks, `useRecipePages`), `src/lib/recipes.ts` (filters), `src/lib/temperature.ts` (°C/°F per user),
  `src/lib/import-jobs.ts` (import jobs, saved per user), `src/lib/photo-jobs.ts` (background recipe photos,
  `saveNewRecipe`), `src/lib/images.ts` (photos to import), `src/lib/share.ts` + `src/components/share-handler.tsx` (the share
  sheet; `src/app/+native-intent.tsx` routes iOS's share link), `src/lib/chat-draft.ts` (an assistant draft on its way to
  the form), `src/lib/supabase.ts` + `secure-session.ts` (session storage), `src/lib/auth.ts` (Google, Apple, guest, email
  link, linking, sign-out), `src/components/` (`bits.tsx` like the web's, `form.tsx` (`Field`, `Toggle`, `Segmented`),
  `UserAvatar`, `FeedbackSheet`, `DeleteAccount`, `Icon`, `RecipeCard`, `ChipRow`,
  `MeasuredLine`, `MacroRing`, `WakeNotice`, `Soon`, `Sheet`, `OptionSheet`, `Toaster` (`lib/toast.ts`, in the root
  layout), `CookbookForm`, `ImportProgress`, `StartCooking`, `Bubble`/`ChatThreads` (`chat.tsx`), `DictateButton`, `MealSheet` with
  `SwapMeal`/`RepeatMeal`, `MealRow`, `DayTargets`, `CookingScreen` (`cooking-mode.tsx`, `cooking-parts.tsx`),
  `VoiceControl`, `AuthProvider`, `AccountCard`, `Choice`; `lib/grocery.ts` keeps the list's ticks, `lib/cooking.ts`
  progress and sounds, `lib/timer-alerts.ts` timer notifications, `lib/voice.ts` speech, `lib/stored.ts` per-user
  settings), `src/__tests__/`
  (Jest; `src/test/` has the fake API and fixtures; `jest.config.js`, `jest.setup.js`), `.maestro/` (Maestro flows,
  `subflows/guest.yaml`) and `.eas/workflows/` (`e2e.yml`, `screenshots.yml`), `src/uniwind-types.d.ts`
  (written by Metro, committed), `assets/` (from `web/brand/`).
- `packages/core/`: `@pantrila/core`, code shared by web and the phone app (no React, DOM or React
  Native): `src/types.ts` (API types), `api.ts` (`createApi`, `ApiError`), `sse.ts`, `amounts.ts`,
  `cooking.ts`, `cookbook.ts`, `chat.ts`, `temperature.ts`, `voice.ts`, `sections.ts`, `plan.ts`, `grocery.ts`, `format.ts`, `avatar.ts`;
  Vitest tests in `test/`. Imported as `@pantrila/core/<module>`.
- `site/`: the pantrila.com landing site (Next.js, static, no API or sign-in): `src/app/page.tsx` (sections),
  `privacy/`, `terms/`, `src/lib.ts` (addresses, contact and the store links from `NEXT_PUBLIC_APP_STORE_ID` /
  `NEXT_PUBLIC_PLAY_STORE_LIVE`), `public/badges/` (official store badges), `src/components/` (header/footer, screenshot
  frames, logo copied from `web/`; animation in `motion.tsx`, `hero-art.tsx`, `demos.tsx`, `allergen-check.tsx`),
  `public/screens/` (app screenshots).
- `data/`: `ingredients.csv` (hand-curated), `usda_foods.csv` (built by
  `scripts/build_usda_table.py`), `dish_briefs.csv` (300 fixed briefs), `recipes/*.json`
  (generated corpus, one file per recipe), `corpus_manifest.json` (generation runs and cost).
- `scripts/`: `generate_corpus.py`, `build_usda_table.py`, `langsmith_dashboard.py` (rebuilds the
  "Pantrila live" LangSmith dashboard via the charts API).
- `docs/`: `status-log.md` (every shipped change, newest first), `plans/` (multi-PR plans with checklists),
  `store-assets/` (Play icon, feature graphic), `demo-script.md` (video walkthrough), `google-sign-in.md` (Google Cloud + Supabase setup),
  `store-listing.md` (store text, privacy answers, review notes, screenshot list),
  `share-and-links.md` (share sheet and app links, owner steps), `screenshots/` (README images, taken from the
  web app at 1280 px wide).
- `supabase/migrations/`: SQL migrations. `supabase/templates/`: auth email templates written by
  `scripts/email_templates.py`, pasted into the Supabase dashboard.
- `evals/`: `retrieval_queries.py` (deterministic query generator) -> `data/retrieval_queries.json`,
  `plan_profiles.py` (16 eval profiles) -> `data/plan_profiles.json`, `chat_cases.py` (24
  assistant cases) -> `data/chat_cases.json`, `import_cases.py` (12 synthetic recipe pages,
  11 post captions) -> `data/import_cases.json`, `video_cases.py` (6 spoken cooking videos) ->
  `data/video_cases.json`, `video_audio.py` (TTS audio -> `data/video_audio/*.wav`, committed;
  frames drawn at run time), `metrics.py`, `run_retrieval.py`, `run_planner.py`,
  `run_assistant.py`, `run_import.py`, `run_video.py`, `reports/`.
- `.github/workflows/evals.yml`: manual paid evals (needs `OPENAI_API_KEY`, `DATABASE_URL`
  repository secrets).
- `tests/`: offline tests; OpenAI is mocked. DB tests run when `PANTRILA_TEST_DATABASE_URL` is
  set. Paid tests are marked `live`.
- `web/`: Next.js 16 App Router (Cache Components on), Tailwind v4, shadcn/ui on Base UI;
  see `web/DESIGN_SYSTEM.md` (tokens live in `src/app/globals.css`). Signed-in screens are
  client components under `src/app/(app)/` fetching the API with SWR (`src/lib/hooks.ts`,
  `src/lib/api.ts`, types in `@pantrila/core/types` mirror `api_models.py`); Supabase is used only for
  sign-in (Google, magic link or anonymous guest; a guest links Google with `linkGoogle`). The cookbook lives under `recipes/mine` (list,
  `new`, `[id]`) with the shared form in `src/components/cookbook-form.tsx`; "From a post" can
  import the post directly, with an estimated countdown. The first-run tour
  is `src/components/tour.tsx` (`TourProvider` in `AppShell`, `useTour().start`). Cooking mode is
  `src/components/cooking-mode.tsx` with helpers in `@pantrila/core/cooking` and `src/lib/cooking.ts`
  (storage, wake lock, sounds); voice commands are `src/components/voice-control.tsx`,
  `@pantrila/core/voice` (words to commands) and `src/lib/voice.ts` (browser listener). The assistant's
  thread list is `src/components/chat-threads.tsx`; the Home card is `src/components/ask-pantrila.tsx`. `RecipeArt` (`src/components/bits.tsx`)
  shows the recipe photo with `next/image` (host allowed from `NEXT_PUBLIC_SUPABASE_URL` in
  `next.config.ts`) or the meal-type art when there is none. `src/proxy.ts` only redirects the retired Vercel addresses. `src/lib/return-to.ts` brings someone who opened a page signed out back to it after sign-in. `src/lib/stores.ts` holds the phone apps' store
  links (Safari's banner in the root layout, `components/app-banner.tsx` on Android, the Pro sheet). `src/app/.well-known/` serves the phone app's link
  files (`src/lib/app-links.ts`). Read `web/AGENTS.md`: this Next.js differs from
  older versions (e.g. `proxy.ts` replaces middleware; check `node_modules/next/dist/docs/`).

## Commands

```bash
uv sync                                  # install
uv run pytest                            # offline tests (no API calls)
uv run ruff check . && uv run ruff format --check .
docker compose up -d db                  # local Postgres 16 + pgvector
uv run pantrila db migrate && uv run pantrila db seed   # DATABASE_URL (config loads .env)
uv run pantrila ingest                    # embed the corpus (needs OPENAI_API_KEY)
uv run pantrila search "quick vegan dinner with chickpeas" [--parse] [--mode vector|fulltext]
uv run pantrila corpus check              # re-derive nutrition/allergens/diets, report drift
uv run python scripts/generate_corpus.py [--sample | --only ids | --force | --limit n]  # paid
#   other model for one run: PANTRILA_MODEL=<model> PANTRILA_PRICE_INPUT_PER_MTOK=<usd> \
#   PANTRILA_PRICE_OUTPUT_PER_MTOK=<usd> (shell variables override .env)
uv run python scripts/build_usda_table.py           # rebuild data/usda_foods.csv
uv run python scripts/build_ciqual_table.py         # pinned workbook -> reviewed Ciqual subset
uv run python -m evals.retrieval_queries # regenerate labelled queries from the corpus
uv run python -m evals.run_retrieval     # retrieval eval (vector vs full text vs hybrid)
uv run pantrila plan vegan-high-protein   # plan for an eval profile id or a UserProfile JSON file
uv run python -m evals.plan_profiles     # regenerate the planner eval profiles
uv run python -m evals.run_planner [--only ids] [--range-as-target]   # planner eval (paid; ~$0.03/plan on mini)
uv run pantrila plan --user me --grocery [--people 2]   # plan from a saved profile + grocery list
uv run pantrila profile set coeliac --with-pantry [--user me]   # save a profile (file or eval id)
uv run pantrila pantry add eggs 6 piece | remove eggs | list [--user me]   # or PANTRILA_USER
uv run pantrila chat [--user me] [--message "..."]  # cooking assistant (paid)
uv run python -m evals.chat_cases        # regenerate the assistant eval cases
uv run python -m evals.run_assistant [--only ids] # assistant eval (paid; ~$0.002/turn)
uv run python -m evals.import_cases      # regenerate the recipe-import eval pages
uv run python -m evals.run_import [--only ids] [--instructions-from <git ref>] [--no-match]  # recipe-import eval (paid; ~$0.006/import)
uv run python -m evals.video_cases       # regenerate the video-import eval cases
uv run python -m evals.video_audio [--only ids] [--force]   # their audio, once (paid TTS)
uv run python -m evals.run_video [--plain] [--video-effort low|medium] [--transcribe-model m --transcribe-price usd] [--only ids]  # video eval (paid)
uv run python -m evals.reel_cases        # regenerate the reel eval cases
uv run python -m evals.run_reel [--media off] [--comments off] [--video-effort low|medium] [--fee usd] [--only ids]   # reel eval, fake service (paid)
uv run python scripts/reel_media_check.py --actor <id> --input '<json with {url}>' [--save dir] <post links>  # Apify actor check
uv run pytest -m live -s                 # paid evals with pass/fail thresholds
uv run pantrila photos generate [--only ids] [--limit n] [--force] [--dry-run]  # corpus photos (paid; ~$0.014 each)
uv run python scripts/langsmith_dashboard.py [--source api|cli|eval|all]  # LangSmith dashboard
uv run python scripts/email_templates.py      # rewrite supabase/templates/ (then paste into Supabase)
uv run python scripts/cooking_sounds.py       # rewrite mobile/assets/sounds/ (timer ring, voice chime)
uv run uvicorn pantrila.api:app --env-file .env --reload   # API on :8000 (SUPABASE_URL, DATABASE_URL)
npm ci                                   # from the root: installs web, mobile and packages/* (one lockfile)
npm test --workspace @pantrila/core      # shared-code unit tests (Vitest); typecheck: npm run typecheck --workspace @pantrila/core
cd web && npm run dev                    # :3000; web/.env.local from web/.env.example
cd web && npm run lint && npm run typecheck && npm run build   # what CI runs for web
cd site && npm ci && npm run dev         # landing site on :3001 (lint, typecheck, build as for web)
cd mobile && npx expo start              # phone app; open it in the Pantrila development build (not Expo Go)
cd mobile && npm run lint && npm run typecheck && npm test && npx expo-doctor   # what CI runs for mobile
cd mobile && npx eas-cli build --profile development --platform android|ios   # device builds on EAS (owner)
cd mobile && npx eas-cli workflow:run e2e.yml        # Maestro flows on EAS (screenshots.yml for store shots)
cd mobile && npx eas-cli build --profile production --platform all && npx eas-cli submit   # store builds (owner)
cd mobile && npx eas-cli update --channel production --environment production --message "..."   # JS-only fix to store builds
```

Update this block when commands change.

## Conventions

- **Safety is deterministic.** The LLM proposes; `constraints.py` decides. Allergen and diet
  filters run in SQL before retrieval and again on the final plan. A plan with any allergen
  violation is never returned to the user, whatever the model says.
- Extract and store what the source says; normalise units in code, not in prompts.
- Any change to a prompt, schema, tool definition, retrieval setting or model comes with a
  before/after eval run, and the numbers go in the PR description.
- Evals report quality, cost per call (from token usage and `PANTRILA_PRICE_*_PER_MTOK`) and
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
  suffixes. **Never use a `claude/` branch** (owner's rule, for every session and tool): if the
  session or harness assigns one (such as `claude/<random-words>`), ignore it and create the
  `feat/` or `fix/` branch from up-to-date `main` instead; push and open the PR from that branch.
  For mobile-plan PRs, use the branch name the plan gives (fixes after launch: `fix/<name>`).
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
  4. Turn on auto-merge with `gh pr merge <pr> --auto --merge` (merge commit, so the split commits
     stay; a ruleset makes it wait for CI, and branches are deleted on merge) and move on instead
     of watching CI. If CI fails, read the logs (`gh run view <run-id> --log-failed`), fix and
     push. Stop and ask after three failed attempts or when the fix needs a product decision.
  5. Locally, run only ruff, pytest and the tests touching the changed files; CI runs the rest.
  6. In that PR's last commit, add an entry at the top of `docs/status-log.md`, and update the
     Status summary in this file if what is true now changed.
