"""Generate the recipe corpus from the fixed dish briefs in data/dish_briefs.csv.

The model writes each recipe as a structured output (`RecipeDraft`). Code converts units to
grams, computes nutrition from USDA values, derives allergens and diet tags, and rejects drafts
whose allergen list disagrees with the ingredients. Rejected drafts are sent back once or twice
with the problems listed. Recipes already on disk are skipped, so re-runs only fill gaps.

    uv run python scripts/generate_corpus.py --sample          # 3 sample recipes
    uv run python scripts/generate_corpus.py                   # everything missing
    uv run python scripts/generate_corpus.py --only greek-salad --force
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
import time
from dataclasses import dataclass, field
from datetime import UTC, datetime

from openai import APIError, AsyncOpenAI

from pantrila import config
from pantrila.corpus import (
    DATA_DIR,
    Brief,
    CorpusValidationError,
    RecipeDraft,
    build_recipe,
    load_briefs,
    recipe_path,
    save_recipe,
)
from pantrila.schema import Recipe

MANIFEST = DATA_DIR / "corpus_manifest.json"
SAMPLE_IDS = ["indian-chana-masala", "british-kedgeree", "greek-salad"]
MAX_ATTEMPTS = 3

INSTRUCTIONS = """\
You write reliable home-cooking recipes for Pantrila, a meal-planning app.

- Write the dish described in the brief, in the stated cuisine, for the stated meal.
- Every ingredient must map to a food in Pantrila's ingredient table (the `food` field). When the
  authentic ingredient is missing, substitute the closest available food and name the
  substitute honestly in `name` (for example use `miso` for doenjang and say "miso").
- Use realistic quantities for the number of servings, and include oil, salt and spices.
- Prefer metric: g for solids, ml for liquids, tsp/tbsp for small amounts, piece for countable
  items. Never use a unit the ingredient table cannot convert (the validator will say so).
- If the brief names a diet, every ingredient must fit it: vegan means no meat, fish, dairy,
  eggs or honey; vegetarian means no meat or fish; pescatarian means no meat; gluten_free means
  no wheat, barley, rye, oats, couscous, bulgur, regular soy sauce (use tamari); dairy_free
  means no milk products; high_protein means at least 25 g protein per serving.
- List every EU allergen the ingredients contain. Check sauces and stocks carefully.
- Steps are clear, in order, and say when something is done (colour, texture, time).
"""


@dataclass
class Usage:
    input_tokens: int = 0
    output_tokens: int = 0
    calls: int = 0
    failures: list[str] = field(default_factory=list)


def brief_prompt(brief: Brief) -> str:
    diet = brief.diet.value if brief.diet else "none in particular"
    return (
        f"Brief: {brief.brief}\nCuisine: {brief.cuisine.replace('_', ' ')}\n"
        f"Meal: {brief.meal_type.value}\nDiet: {diet}"
    )


async def generate_one(
    client: AsyncOpenAI, brief: Brief, model: str, effort: str, usage: Usage
) -> Recipe | None:
    messages: list[dict] = [{"role": "user", "content": brief_prompt(brief)}]
    for attempt in range(1, MAX_ATTEMPTS + 1):
        resp = await client.responses.parse(
            model=model,
            instructions=INSTRUCTIONS,
            input=messages,
            text_format=RecipeDraft,
            reasoning={"effort": effort},
            store=False,
        )
        usage.calls += 1
        if resp.usage:
            usage.input_tokens += resp.usage.input_tokens
            usage.output_tokens += resp.usage.output_tokens
        draft = resp.output_parsed
        if draft is None:
            problems = ["no parsable recipe returned"]
        else:
            try:
                return build_recipe(brief, draft)
            except CorpusValidationError as exc:
                problems = exc.problems
        print(f"  {brief.id} attempt {attempt}: {'; '.join(problems)}", file=sys.stderr)
        if draft is not None:
            messages.append({"role": "assistant", "content": draft.model_dump_json()})
        messages.append(
            {
                "role": "user",
                "content": "The recipe failed validation:\n- "
                + "\n- ".join(problems)
                + "\nReturn the full corrected recipe.",
            }
        )
    usage.failures.append(brief.id)
    return None


async def run(
    briefs: list[Brief], model: str, effort: str, concurrency: int
) -> tuple[list[Recipe], Usage]:
    client = AsyncOpenAI()
    usage = Usage()
    sem = asyncio.Semaphore(concurrency)
    done: list[Recipe] = []

    async def worker(brief: Brief) -> None:
        async with sem:
            try:
                recipe = await generate_one(client, brief, model, effort, usage)
            except APIError as exc:
                # Record and move on so the manifest is still written for the whole run.
                print(f"  {brief.id}: API error: {exc}", file=sys.stderr)
                usage.failures.append(brief.id)
                return
        if recipe:
            save_recipe(recipe)
            done.append(recipe)
            print(f"ok {recipe.id}: {recipe.title}")

    await asyncio.gather(*(worker(b) for b in briefs))
    return done, usage


def record_run(model: str, effort: str, done: list[Recipe], usage: Usage, seconds: float) -> dict:
    cost = config.prices().chat_cost(usage.input_tokens, usage.output_tokens)
    entry = {
        "finished_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "model": model,
        "reasoning_effort": effort,
        "generated": len(done),
        "failed": sorted(usage.failures),
        "calls": usage.calls,
        "input_tokens": usage.input_tokens,
        "output_tokens": usage.output_tokens,
        "cost_usd": None if cost is None else round(cost, 4),
        "seconds": round(seconds, 1),
    }
    manifest = json.loads(MANIFEST.read_text()) if MANIFEST.exists() else {"runs": []}
    manifest["runs"].append(entry)
    MANIFEST.write_text(json.dumps(manifest, indent=2) + "\n")
    return entry


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--sample", action="store_true", help=f"only {', '.join(SAMPLE_IDS)}")
    parser.add_argument("--only", help="comma-separated brief ids")
    parser.add_argument("--limit", type=int, help="stop after this many missing briefs")
    parser.add_argument("--force", action="store_true", help="regenerate recipes already on disk")
    parser.add_argument("--effort", default="low", choices=["minimal", "low", "medium", "high"])
    parser.add_argument("--concurrency", type=int, default=8)
    args = parser.parse_args()

    briefs = load_briefs()
    if args.sample:
        briefs = [b for b in briefs if b.id in SAMPLE_IDS]
    elif args.only:
        wanted = set(args.only.split(","))
        briefs = [b for b in briefs if b.id in wanted]
    if not args.force:
        briefs = [b for b in briefs if not recipe_path(b.id).exists()]
    if args.limit:
        briefs = briefs[: args.limit]
    if not briefs:
        print("nothing to generate")
        return

    model = config.model()
    print(f"generating {len(briefs)} recipes with {model} (effort {args.effort})")
    start = time.perf_counter()
    done, usage = asyncio.run(run(briefs, model, args.effort, args.concurrency))
    entry = record_run(model, args.effort, done, usage, time.perf_counter() - start)
    print(
        f"\n{entry['generated']} generated, {len(entry['failed'])} failed, "
        f"{usage.input_tokens:,} input + {usage.output_tokens:,} output tokens, "
        f"cost {config.fmt_cost(entry['cost_usd'])}, {entry['seconds']}s"
    )
    if args.sample:
        for r in sorted(done, key=lambda r: r.id):
            print(f"\n--- {r.id} ---\n{recipe_path(r.id).read_text()}")


if __name__ == "__main__":
    main()
