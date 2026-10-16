"""Command line: `pantrio db migrate|seed`, `pantrio ingest`, `pantrio search`, `pantrio corpus`."""

from __future__ import annotations

from typing import Annotated

import typer

from pantrio import config
from pantrio.schema import Allergen, DietTag, MealType

app = typer.Typer(no_args_is_help=True, add_completion=False)
db_app = typer.Typer(no_args_is_help=True, help="Database migrations and seed data.")
corpus_app = typer.Typer(no_args_is_help=True, help="Inspect the committed recipe corpus.")
app.add_typer(db_app, name="db")
app.add_typer(corpus_app, name="corpus")


@db_app.command("migrate")
def db_migrate() -> None:
    """Apply new SQL files from supabase/migrations."""
    from pantrio import db

    with db.connect(config.database_url()) as conn:
        ran = db.migrate(conn)
    typer.echo(f"applied {', '.join(ran)}" if ran else "database is up to date")


@db_app.command("seed")
def db_seed() -> None:
    """Load data/recipes into the recipe tables (upsert; removes recipes no longer present)."""
    from pantrio import db
    from pantrio.corpus import load_corpus

    with db.connect(config.database_url()) as conn:
        n = db.seed(conn, load_corpus())
    typer.echo(f"seeded {n} recipes")


@app.command()
def ingest() -> None:
    """Embed every recipe whose embedding text changed; cached vectors cost nothing."""
    from pantrio import db
    from pantrio.corpus import load_corpus
    from pantrio.embeddings import ingest as run_ingest
    from pantrio.embeddings import openai_embedder

    model = config.embed_model()
    with db.connect(config.database_url()) as conn:
        report = run_ingest(conn, load_corpus(), openai_embedder(model), model)
    cost = config.prices().embed_cost(report.tokens)
    typer.echo(
        f"{report.recipes} recipes: {report.unchanged} unchanged, "
        f"{report.from_file_cache} from local cache, {report.embedded} embedded with {model}\n"
        f"tokens {report.tokens:,}, cost {config.fmt_cost(cost)}"
    )


@app.command()
def search(
    query: str,
    mode: Annotated[str, typer.Option(help="hybrid, vector or fulltext")] = "hybrid",
    limit: int = 10,
    exclude_allergen: Annotated[list[Allergen] | None, typer.Option()] = None,
    diet: Annotated[list[DietTag] | None, typer.Option()] = None,
    meal: Annotated[list[MealType] | None, typer.Option()] = None,
    max_minutes: int | None = None,
    without: Annotated[list[str] | None, typer.Option(help="food key to exclude")] = None,
    parse: Annotated[bool, typer.Option(help="turn the query into filters with the LLM")] = False,
) -> None:
    """Search recipes, e.g. pantrio search "quick vegan dinner with chickpeas" --parse."""
    from pantrio import db
    from pantrio.search import Mode, SearchFilters, openai_query_embedder, parse_query
    from pantrio.search import search as run_search

    text = query
    filters = SearchFilters(
        exclude_allergens=exclude_allergen or [],
        require_diets=diet or [],
        meal_types=meal or [],
        max_minutes=max_minutes,
        exclude_foods=without or [],
    )
    if parse:
        text, parsed, _ = parse_query(query, config.model())
        filters = filters.model_copy(
            update={
                k: getattr(parsed, k) or getattr(filters, k) for k in SearchFilters.model_fields
            }
        )
        typer.echo(f"search text: {text!r}\nfilters: {filters.model_dump(exclude_defaults=True)}")

    embedder = openai_query_embedder(config.embed_model()) if mode != "fulltext" else None
    with db.connect(config.database_url()) as conn:
        result = run_search(conn, text, filters, mode=Mode(mode), limit=limit, embed_query=embedder)
        rows = conn.execute(
            "select id, title, total_minutes, kcal, diet_tags from recipes where id = any(%s)",
            (result.ids,),
        ).fetchall()
    by_id = {r[0]: r for r in rows}
    for rank, (rid, score) in enumerate(zip(result.ids, result.scores, strict=True), 1):
        _, title, minutes, kcal, diets = by_id[rid]
        typer.echo(
            f"{rank:>2}. {title}  [{minutes} min, {kcal:.0f} kcal]  {', '.join(diets)}"
            f"  ({rid}, {score:.4f})"
        )
    if not result.ids:
        typer.echo("no recipes match those filters")


@corpus_app.command("check")
def corpus_check() -> None:
    """Re-derive grams, nutrition, allergens and diets for every recipe and report drift."""
    from pantrio.corpus import check_recipe, load_briefs, load_corpus

    recipes = load_corpus()
    bad = 0
    for r in recipes:
        if problems := check_recipe(r):
            bad += 1
            typer.echo(f"{r.id}: {'; '.join(problems)}")
    briefs = len(load_briefs())
    typer.echo(f"{len(recipes)} of {briefs} briefs generated, {bad} with problems")
    if bad:
        raise typer.Exit(1)


if __name__ == "__main__":
    app()
