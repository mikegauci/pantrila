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

Work on one step at a time; each step is its own PR.

## Stack

- Python 3.12, `uv`, Pydantic v2, FastAPI, pytest, ruff.
- PostgreSQL 16 + `pgvector` (Supabase in deploy, Docker locally), SQL migrations in
  `supabase/migrations/` (add a new file; never edit an applied one). Plain SQL via `psycopg`,
  no ORM.
- OpenAI Python SDK (Responses API, structured outputs, tool calling). Default chat model
  `gpt-5.5` (override `PANTRIO_MODEL`), embeddings `text-embedding-3-small`
  (override `PANTRIO_EMBED_MODEL`). Do not use the Anthropic API.
- LangGraph for the planner and chat agent.
- LangSmith for tracing, datasets and experiments (`LANGSMITH_*`); everything works with
  tracing off when the variables are unset.
- Next.js App Router + Tailwind v4 + shadcn/ui (Base UI) in `web/`.

## Layout (keep this section current as code lands)

- `src/pantrio/schema.py`: Pydantic models (Recipe, Ingredient, NutritionFacts; enums for the
  14 EU allergens, diet tags, meal types, units). Planned: UserProfile, PantryItem, MealPlan,
  GroceryList. Models sent as structured outputs carry field descriptions, which are part of
  the prompt.
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
- `src/pantrio/db.py`: connections, migrations (`pantrio_migrations` table), seeding.
- `src/pantrio/cli.py`: `pantrio db migrate|seed`, `ingest`, `search`, `corpus check`.
- Planned: `constraints.py` (deterministic plan checks, the single source of truth for "is
  this plan safe and valid"), `planner.py` (LangGraph meal-planning graph), `assistant.py`
  (chat agent), `api.py`.
- `data/`: `ingredients.csv` (hand-curated), `usda_foods.csv` (built by
  `scripts/build_usda_table.py`), `dish_briefs.csv` (300 fixed briefs), `recipes/*.json`
  (generated corpus, one file per recipe), `corpus_manifest.json` (generation runs and cost).
- `scripts/`: `generate_corpus.py`, `build_usda_table.py`.
- `supabase/migrations/`: SQL migrations.
- `evals/`: `retrieval_queries.py` (deterministic query generator) -> `data/retrieval_queries.json`,
  `metrics.py`, `run_retrieval.py`, `reports/`.
- `tests/`: offline tests; OpenAI is mocked. DB tests run when `PANTRIO_TEST_DATABASE_URL` is
  set. Paid tests are marked `live`.
- `web/`: frontend; see `web/DESIGN_SYSTEM.md`.

## Commands

```bash
uv sync                                  # install
uv run pytest                            # offline tests (no API calls)
uv run ruff check . && uv run ruff format --check .
docker compose up -d db                  # local Postgres 16 + pgvector
uv run pantrio db migrate && uv run pantrio db seed   # needs DATABASE_URL
uv run pantrio ingest                    # embed the corpus (needs OPENAI_API_KEY)
uv run pantrio search "quick vegan dinner with chickpeas" [--parse] [--mode vector|fulltext]
uv run pantrio corpus check              # re-derive nutrition/allergens/diets, report drift
uv run python scripts/generate_corpus.py [--sample | --only ids | --force]  # paid
uv run python scripts/build_usda_table.py           # rebuild data/usda_foods.csv
uv run python -m evals.retrieval_queries # regenerate labelled queries from the corpus
uv run python -m evals.run_retrieval     # retrieval eval (vector vs full text vs hybrid)
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
