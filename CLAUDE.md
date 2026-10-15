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

## Layout (target; keep this section current as code lands)

- `src/pantrio/schema.py`: Pydantic models (Recipe, Ingredient, NutritionFacts, UserProfile,
  PantryItem, MealPlan, GroceryList). Models sent as structured outputs carry field
  descriptions, which are part of the prompt.
- `src/pantrio/corpus.py`: load, normalise and validate the recipe corpus.
- `src/pantrio/nutrition.py`: per-recipe nutrition from ingredient quantities (USDA FoodData
  Central values, public domain).
- `src/pantrio/embeddings.py`: embedding text builder and batched OpenAI embedding calls with
  a content-hash cache so re-ingest is free.
- `src/pantrio/search.py`: hybrid retrieval (pgvector cosine + Postgres full text, merged with
  reciprocal rank fusion) with hard SQL filters for diet, allergens and time.
- `src/pantrio/constraints.py`: deterministic checks (allergens, diet, calorie/macro targets,
  repeats, pantry use). The single source of truth for "is this plan safe and valid".
- `src/pantrio/planner.py`: LangGraph meal-planning graph and its tools.
- `src/pantrio/assistant.py`: chat agent and tools.
- `src/pantrio/db.py`, `src/pantrio/api.py`, `src/pantrio/cli.py`.
- `evals/`: datasets (retrieval queries, planning profiles), scorers, runners, LangSmith upload.
- `tests/`: offline tests; OpenAI is mocked. Paid tests are marked `live`.
- `web/`: frontend; see `web/DESIGN_SYSTEM.md`.

## Commands

```bash
uv sync                                  # install
uv run pytest                            # offline tests (no API calls)
uv run ruff check . && uv run ruff format --check .
docker compose up -d db                  # local Postgres 16 + pgvector
uv run pantrio db migrate && uv run pantrio db seed   # needs DATABASE_URL
uv run pantrio ingest                    # embed the corpus (needs OPENAI_API_KEY)
uv run pantrio search "quick vegan dinner with chickpeas"
uv run python -m evals.run_retrieval     # retrieval eval
uv run pytest -m live -s                 # paid evals with pass/fail thresholds
uv run uvicorn pantrio.api:app --env-file .env --reload
cd web && npm ci && npm run dev          # :3000
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
