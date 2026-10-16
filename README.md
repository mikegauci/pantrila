# Pantrio

AI cooking and meal-planning assistant: tell it what is in your kitchen, your diet, allergies
and nutrition targets; it finds recipes with hybrid RAG search, plans your week, builds a
grocery list and answers cooking questions. Allergen and diet safety is checked by
deterministic code, never by the model's word.

Status: step 4 of 5. Done: the recipe corpus, hybrid pgvector search and retrieval evals;
the LangGraph meal-planning agent with a deterministic constraint checker and plan evals;
pantry, grocery list and a tool-calling cooking assistant; the FastAPI + Next.js web app.
See `CLAUDE.md` for the build plan and commands.

## Quick start

```bash
uv sync
cp .env.example .env                     # add OPENAI_API_KEY and prices
docker compose up -d db
uv run pantrio db migrate && uv run pantrio db seed
uv run pantrio ingest
uv run pantrio search "quick vegan dinner with chickpeas" --parse
uv run pantrio plan vegan-high-protein    # a week of meals for an eval profile

# web app: API on :8000, web on :3000 (sign in with Supabase Auth)
uv run uvicorn pantrio.api:app --env-file .env --reload
cd web && cp .env.example .env.local && npm ci && npm run dev
```

## Web app

```
browser (Next.js, Vercel) --Supabase Auth--> access token (ES256 JWT)
        |  Bearer token
        v
FastAPI (Render) -- verifies the token with Supabase's public keys, user id = token `sub`
        |-- recipes: hybrid search with the person's rules as SQL filters
        |-- plans: LangGraph planner, progress streamed as server-sent events
        |-- chat: LangGraph assistant with 5 tools and the citation guard
        v
Supabase Postgres + pgvector (RLS on every table; only the API's owner role reads data)
```

Every recipe the API returns is checked against the person's current profile, so a new
allergy shows up in red on a saved plan. Each paid call (plan or chat turn) is logged with
tokens, cost and latency; the Insights page shows them next to the offline eval numbers,
and daily caps per user plus a total daily budget keep the public demo cheap.

## How the corpus is made

300 fixed dish briefs (`data/dish_briefs.csv`, 15 cuisines × 20) go to the model, which
returns each recipe as a structured output with ingredients picked from a 207-food table.
Code then converts every quantity to grams, computes nutrition per serving from USDA
FoodData Central values, derives the 14 EU allergens and diet tags from the ingredients, and
rejects any recipe where the model's allergen list disagrees with the derived one.

Nutrition values: USDA FoodData Central, SR Legacy (public domain).

## How a plan is made

```
profile -> retrieve -> draft -> check -> (repair -> check) x2 max -> finalise
```

1. **Retrieve**: hybrid search per meal slot. Allergies, diets, excluded foods and the time
   limit are SQL filters, so the model is only ever shown safe recipes.
2. **Draft**: the model (OpenAI Responses API, `store=False`) picks one recipe per meal as a
   structured output, and may call a `search_recipes` tool (at most 4 rounds) that applies the
   same filters.
3. **Check**: code picks portions (0.5 to 2 servings per meal) to hit the daily energy
   target, then `constraints.py` checks every rule. Allergens and diets are re-derived from
   the ingredients, not read from tags.
4. **Repair**: problems go back to the model, up to twice.
5. **Finalise**: any meal still breaking a hard rule is swapped in code for a safe candidate.
   If none exists the planner raises; it never returns an unsafe plan. Missed nutrition
   targets come back as warnings.

"Macros" means protein, carbs and fat; "kcal" is food energy (calories).
