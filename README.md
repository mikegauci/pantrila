# Pantrio

AI cooking and meal-planning assistant: tell it what is in your kitchen, your diet, allergies
and nutrition targets; it finds recipes with hybrid RAG search, plans your week, builds a
grocery list and answers cooking questions. Allergen and diet safety is checked by
deterministic code, never by the model's word.

Status: step 1 of 5, the recipe corpus, hybrid pgvector search and retrieval evals.
See `CLAUDE.md` for the build plan and commands.

## Quick start

```bash
uv sync
cp .env.example .env                     # add OPENAI_API_KEY and prices
docker compose up -d db
uv run pantrio db migrate && uv run pantrio db seed
uv run pantrio ingest
uv run pantrio search "quick vegan dinner with chickpeas" --parse
```

## How the corpus is made

300 fixed dish briefs (`data/dish_briefs.csv`, 15 cuisines × 20) go to the model, which
returns each recipe as a structured output with ingredients picked from a 207-food table.
Code then converts every quantity to grams, computes nutrition per serving from USDA
FoodData Central values, derives the 14 EU allergens and diet tags from the ingredients, and
rejects any recipe where the model's allergen list disagrees with the derived one.

Nutrition values: USDA FoodData Central, SR Legacy (public domain).
