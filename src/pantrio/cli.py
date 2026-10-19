"""Command line: `pantrio db migrate|seed`, `ingest`, `search`, `plan`, `pantry`, `profile`,
`chat`, `corpus check`, `photos generate`."""

from __future__ import annotations

from typing import Annotated

import typer

from pantrio import config
from pantrio.schema import Allergen, DietTag, MealType, Unit

app = typer.Typer(no_args_is_help=True, add_completion=False)
db_app = typer.Typer(no_args_is_help=True, help="Database migrations and seed data.")
corpus_app = typer.Typer(no_args_is_help=True, help="Inspect the committed recipe corpus.")
pantry_app = typer.Typer(no_args_is_help=True, help="A user's pantry (foods at home).")
profile_app = typer.Typer(no_args_is_help=True, help="A user's saved profile.")
photos_app = typer.Typer(no_args_is_help=True, help="Generated recipe photos.")
app.add_typer(db_app, name="db")
app.add_typer(corpus_app, name="corpus")
app.add_typer(pantry_app, name="pantry")
app.add_typer(profile_app, name="profile")
app.add_typer(photos_app, name="photos")

User = Annotated[str, typer.Option("--user", envvar="PANTRIO_USER", help="user id")]


def load_profile_arg(profile: str):
    """A UserProfile from a JSON file or an eval profile id."""
    import json
    from pathlib import Path

    from pantrio.schema import UserProfile

    path = Path(profile)
    if path.exists():
        return UserProfile.model_validate_json(path.read_text())
    evals = Path(__file__).resolve().parents[2] / "evals" / "data" / "plan_profiles.json"
    by_id = {p["id"]: p["profile"] for p in json.loads(evals.read_text())}
    if profile not in by_id:
        raise typer.BadParameter(f"no file or eval profile called {profile!r}")
    return UserProfile.model_validate(by_id[profile])


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


@app.command()
def plan(
    profile: Annotated[
        str | None, typer.Argument(help="JSON file with a UserProfile, or an eval id")
    ] = None,
    user: Annotated[
        str | None, typer.Option(help="plan for this user's saved profile and pantry")
    ] = None,
    effort: Annotated[str, typer.Option(help="reasoning effort")] = "low",
    grocery: Annotated[bool, typer.Option(help="print the grocery list too")] = False,
    people: Annotated[int, typer.Option(help="people the grocery list feeds")] = 1,
) -> None:
    """Plan meals, e.g. pantrio plan vegan-high-protein (ids from evals/data/plan_profiles.json)
    or pantrio plan --user me --grocery."""
    from pantrio import db
    from pantrio.grocery import grocery_list, grocery_text
    from pantrio.pantry import DbKitchen, make_item
    from pantrio.planner import DbStore, Planner
    from pantrio.search import openai_query_embedder

    if (profile is None) == (user is None):
        raise typer.BadParameter("give a profile or --user, not both")
    with db.connect(config.database_url()) as conn:
        if user:
            kitchen = DbKitchen(conn, user)
            person, pantry = kitchen.profile(), kitchen.pantry()
        else:
            person = load_profile_arg(profile)
            pantry = [make_item(f) for f in person.pantry]
        store = DbStore(conn, openai_query_embedder(config.embed_model()))
        result = Planner(store, effort=effort).plan(person)
    for day, n in zip(result.plan.days, result.nutrition, strict=True):
        typer.echo(
            f"Day {day.day}  {n.kcal:.0f} kcal, protein {n.protein_g:.0f} g, "
            f"carbs {n.carbs_g:.0f} g, fat {n.fat_g:.0f} g"
        )
        for m in day.meals:
            r = result.recipes[m.recipe_id]
            typer.echo(f"  {m.meal_type:<9} {r.title} x{m.portions:g}  ({r.total_minutes} min)")
    typer.echo(f"\n{result.plan.notes}")
    for w in result.warnings:
        typer.echo(f"warning: {w}")
    u = result.usage
    typer.echo(
        f"\npantry use {result.pantry_use:.0%}, {result.repairs} repairs, "
        f"{u.llm_calls} LLM calls, {u.tool_calls} tool calls, "
        f"{u.input_tokens:,} + {u.output_tokens:,} tokens, cost {config.fmt_cost(u.cost())}, "
        f"{result.latency_ms / 1000:.1f}s"
    )
    if grocery:
        g = grocery_list(result.plan, result.recipes, pantry, people)
        typer.echo(f"\nGrocery list for {people}:\n{grocery_text(g)}")


@pantry_app.command("list")
def pantry_list(user: User = "local") -> None:
    """Show the pantry."""
    from pantrio import db
    from pantrio.pantry import DbKitchen, item_text

    with db.connect(config.database_url()) as conn:
        items = DbKitchen(conn, user).pantry()
    typer.echo("\n".join(item_text(i) for i in items) or "pantry is empty")


@pantry_app.command("add")
def pantry_add(
    food: str,
    quantity: Annotated[float | None, typer.Argument()] = None,
    unit: Annotated[Unit | None, typer.Argument()] = None,
    user: User = "local",
) -> None:
    """Add a food, e.g. pantrio pantry add eggs 6 piece (no amount means "some")."""
    from pantrio import db
    from pantrio.foods import UnitError
    from pantrio.pantry import DbKitchen, UnknownFood, item_text, make_item

    try:
        item = make_item(food, quantity, unit)
    except (UnknownFood, UnitError) as exc:
        raise typer.BadParameter(str(exc)) from exc
    with db.connect(config.database_url()) as conn:
        DbKitchen(conn, user).put(item)
    typer.echo(f"added {item_text(item)}")


@pantry_app.command("remove")
def pantry_remove(food: str, user: User = "local") -> None:
    """Remove a food."""
    from pantrio import db
    from pantrio.pantry import DbKitchen, UnknownFood, resolve_food

    try:
        key = resolve_food(food)
    except UnknownFood as exc:
        raise typer.BadParameter(str(exc)) from exc
    with db.connect(config.database_url()) as conn:
        removed = DbKitchen(conn, user).remove(key)
    typer.echo(f"removed {key}" if removed else f"{key} was not in the pantry")


@profile_app.command("set")
def profile_set(
    profile: Annotated[str, typer.Argument(help="JSON file with a UserProfile, or an eval id")],
    user: User = "local",
    with_pantry: Annotated[bool, typer.Option(help="also put its pantry foods in")] = False,
) -> None:
    """Save a profile (allergies, diets, targets...) for a user."""
    from pantrio import db
    from pantrio.pantry import DbKitchen, make_item

    person = load_profile_arg(profile)
    with db.connect(config.database_url()) as conn:
        kitchen = DbKitchen(conn, user)
        kitchen.save_profile(person)
        if with_pantry:
            for food in person.pantry:
                kitchen.put(make_item(food))
    typer.echo(f"saved profile for {user}")


@profile_app.command("show")
def profile_show(user: User = "local") -> None:
    """Print a user's profile as JSON."""
    from pantrio import db
    from pantrio.pantry import DbKitchen

    with db.connect(config.database_url()) as conn:
        typer.echo(DbKitchen(conn, user).profile().model_dump_json(indent=2))


@app.command()
def chat(
    user: User = "local",
    message: Annotated[str | None, typer.Option(help="ask once and exit")] = None,
    effort: Annotated[str, typer.Option(help="reasoning effort")] = "low",
) -> None:
    """Chat with the cooking assistant about recipes and the user's pantry."""
    from pantrio import db
    from pantrio.assistant import Assistant
    from pantrio.pantry import DbKitchen
    from pantrio.planner import DbStore
    from pantrio.search import openai_query_embedder

    with db.connect(config.database_url()) as conn:
        conn.autocommit = True
        store = DbStore(conn, openai_query_embedder(config.embed_model()))
        bot = Assistant(store, DbKitchen(conn, user), effort=effort)
        history: list[dict] = []
        while True:
            text = message or typer.prompt("you", prompt_suffix="> ")
            if text.strip().lower() in {"exit", "quit"}:
                return
            result = bot.reply(text, history)
            history = result.history
            u = result.usage
            typer.echo(f"\npantrio> {result.text}\n")
            typer.echo(
                f"[{', '.join(c.name for c in result.tool_calls) or 'no tools'}; "
                f"cost {config.fmt_cost(u.cost())}, {result.latency_ms / 1000:.1f}s]\n"
            )
            if message:
                return


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


@photos_app.command("generate")
def photos_generate(
    only: Annotated[list[str] | None, typer.Option("--only", help="recipe ids")] = None,
    limit: Annotated[int | None, typer.Option(help="at most this many recipes")] = None,
    force: Annotated[bool, typer.Option(help="regenerate even if unchanged")] = False,
    workers: Annotated[int, typer.Option(min=1, max=16, help="~20 images/min allowed")] = 4,
    dry_run: Annotated[
        bool, typer.Option("--dry-run", help="print one prompt, call nothing")
    ] = False,
) -> None:
    """Photograph corpus recipes whose prompt or image model changed (paid; ~$0.014 each).
    Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY; creates the public bucket if missing."""
    import statistics

    from pantrio import db, photos
    from pantrio.corpus import load_corpus

    recipes = load_corpus()
    if only:
        recipes = [r for r in recipes if r.id in set(only)]
    recipes = recipes[:limit] if limit else recipes
    if dry_run:
        typer.echo(photos.photo_prompt(photos.corpus_dish(recipes[0])))
        return
    store = photos.photo_store()
    if store is None:
        raise SystemExit("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set")
    if store.ensure_bucket():
        typer.echo(f"created public bucket {photos.BUCKET}")

    def done(rid: str, photo) -> None:
        typer.echo(f"  {'ok ' if photo else 'FAILED'} {rid}"
                   + (f"  {photo.latency_ms / 1000:.1f}s" if photo else ""))  # fmt: skip

    model = config.image_model()
    typer.echo(f"{len(recipes)} recipes, model {model}, {workers} at a time")
    with db.connect(config.database_url()) as conn:
        report = photos.photograph_corpus(conn, recipes, store, model=model, workers=workers,
                                          force=force, on_done=done)  # fmt: skip
    store.close()
    lat = sorted(report.latencies_ms)
    p50 = statistics.median(lat) / 1000 if lat else 0
    p95 = lat[min(len(lat) - 1, int(len(lat) * 0.95))] / 1000 if lat else 0
    cost = report.usage.cost()
    per = cost / report.generated if cost is not None and report.generated else None
    typer.echo(
        f"generated {report.generated}, unchanged {report.skipped}, failed {len(report.failed)}\n"
        f"tokens in {report.usage.input_tokens:,} out {report.usage.output_tokens:,}, "
        f"cost {config.fmt_cost(cost)} ({config.fmt_cost(per)} per photo), "
        f"p50 {p50:.1f}s / p95 {p95:.1f}s"
    )
    for line in report.failed:
        typer.echo(f"  {line}")
    if report.failed:
        raise typer.Exit(1)
