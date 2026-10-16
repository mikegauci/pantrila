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
Next: step 4 (FastAPI + Next.js; auth decides `user_id`). Paid evals workflow needs
`OPENAI_API_KEY` and `DATABASE_URL` repository secrets; `LANGSMITH_API_KEY` is set locally
(EU endpoint), so local eval runs upload LangSmith experiments.

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
  `data/usda_foods.csv`): unit conversion to grams, allergens and diet class per food,
  allergen and diet derivation.
- `src/pantrio/nutrition.py`: per-serving nutrition from ingredient grams (USDA FoodData
  Central SR Legacy values, public domain) and the low-carb/high-protein thresholds.
- `src/pantrio/corpus.py`: `RecipeDraft` (the model's structured output), `build_recipe`
  (normalise, compute, derive, reject allergen disagreements), `check_recipe`, load/save.
- `src/pantrio/embeddings.py`: embedding text builder and batched OpenAI embedding calls with
  a content-hash cache (DB + `.cache/embeddings/`) so re-ingest is free.
- `src/pantrio/search.py`: hybrid retrieval (pgvector cosine + Postgres full text, merged with
  reciprocal rank fusion) with hard SQL filters for allergens, diets, time, meal, cuisine and
  excluded foods; optional LLM query parser.
- `src/pantrio/config.py`: settings and prices from the environment.
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
- `src/pantrio/assistant.py`: LangGraph chat agent agent -> tools (max 4 rounds) -> guard;
  tools search_recipes, check_pantry, update_pantry, swap_ingredient, scale_recipe; replies
  cite recipes as `[recipe-id]` and the guard appends a note for any cited recipe that breaks
  a hard rule or does not exist.
- Planned: `api.py`.
- `data/`: `ingredients.csv` (hand-curated), `usda_foods.csv` (built by
  `scripts/build_usda_table.py`), `dish_briefs.csv` (300 fixed briefs), `recipes/*.json`
  (generated corpus, one file per recipe), `corpus_manifest.json` (generation runs and cost).
- `scripts/`: `generate_corpus.py`, `build_usda_table.py`.
- `supabase/migrations/`: SQL migrations.
- `evals/`: `retrieval_queries.py` (deterministic query generator) -> `data/retrieval_queries.json`,
  `plan_profiles.py` (16 eval profiles) -> `data/plan_profiles.json`, `chat_cases.py` (24
  assistant cases) -> `data/chat_cases.json`, `metrics.py`, `run_retrieval.py`,
  `run_planner.py`, `run_assistant.py`, `reports/`.
- `.github/workflows/evals.yml`: manual paid evals (needs `OPENAI_API_KEY`, `DATABASE_URL`
  repository secrets).
- `tests/`: offline tests; OpenAI is mocked. DB tests run when `PANTRIO_TEST_DATABASE_URL` is
  set. Paid tests are marked `live`.
- `web/`: frontend; see `web/DESIGN_SYSTEM.md`.

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
uv run pytest -m live -s                 # paid evals with pass/fail thresholds
uv run uvicorn pantrio.api:app --env-file .env --reload   # from step 4
cd web && npm ci && npm run dev          # :3000, from step 4
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
