"""Postgres access: connections, migrations and seeding the recipe tables. Plain SQL, no ORM."""

from __future__ import annotations

from collections.abc import Iterable
from pathlib import Path

import psycopg

from pantrio.schema import Recipe

MIGRATIONS_DIR = Path(__file__).resolve().parents[2] / "supabase" / "migrations"


def connect(url: str) -> psycopg.Connection:
    return psycopg.connect(url)


def migrate(conn: psycopg.Connection, migrations_dir: Path = MIGRATIONS_DIR) -> list[str]:
    """Apply migrations not yet recorded in `pantrio_migrations`, each in its own transaction."""
    with conn.transaction():
        conn.execute(
            "create table if not exists pantrio_migrations ("
            " version text primary key, applied_at timestamptz not null default now())"
        )
    applied = {row[0] for row in conn.execute("select version from pantrio_migrations")}
    ran = []
    for path in sorted(migrations_dir.glob("*.sql")):
        if path.stem in applied:
            continue
        with conn.transaction():
            conn.execute(path.read_text())
            conn.execute("insert into pantrio_migrations (version) values (%s)", (path.stem,))
        ran.append(path.stem)
    return ran


def ingredient_text(recipe: Recipe) -> str:
    return " ".join(i.food.replace("_", " ") for i in recipe.ingredients)


def seed(conn: psycopg.Connection, recipes: Iterable[Recipe]) -> int:
    """Make the recipe tables match the corpus: upsert every recipe, drop ones that are gone."""
    recipes = list(recipes)
    with conn.transaction(), conn.cursor() as cur:
        for r in recipes:
            n = r.nutrition
            cur.execute(
                """
                insert into recipes (id, title, summary, cuisine, meal_types, diet_tags,
                    allergens, total_minutes, servings, steps, kcal, protein_g, carbs_g, fat_g,
                    fibre_g, ingredient_text)
                values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                on conflict (id) do update set
                    title = excluded.title, summary = excluded.summary,
                    cuisine = excluded.cuisine, meal_types = excluded.meal_types,
                    diet_tags = excluded.diet_tags, allergens = excluded.allergens,
                    total_minutes = excluded.total_minutes, servings = excluded.servings,
                    steps = excluded.steps, kcal = excluded.kcal,
                    protein_g = excluded.protein_g, carbs_g = excluded.carbs_g,
                    fat_g = excluded.fat_g, fibre_g = excluded.fibre_g,
                    ingredient_text = excluded.ingredient_text
                """,
                (
                    r.id, r.title, r.summary, r.cuisine,
                    [m.value for m in r.meal_types], [d.value for d in r.diet_tags],
                    [a.value for a in r.allergens], r.total_minutes, r.servings, r.steps,
                    n.kcal, n.protein_g, n.carbs_g, n.fat_g, n.fibre_g, ingredient_text(r),
                ),
            )  # fmt: skip
            cur.execute("delete from recipe_ingredients where recipe_id = %s", (r.id,))
            cur.executemany(
                "insert into recipe_ingredients"
                " (recipe_id, position, name, food, quantity, unit, grams)"
                " values (%s, %s, %s, %s, %s, %s, %s)",
                [
                    (r.id, pos, i.name, i.food, i.quantity, i.unit.value, i.grams)
                    for pos, i in enumerate(r.ingredients)
                ],
            )
        cur.execute("delete from recipes where not (id = any(%s))", ([r.id for r in recipes],))
    return len(recipes)
