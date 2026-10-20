"""Embedding text per recipe, batched OpenAI embedding calls and a content-hash cache.

A recipe is re-embedded only when its embedding text or the embedding model changes. Vectors
are cached twice: in `recipe_embeddings` (with the hash) and in a local JSONL file under
`.cache/`, so rebuilding the database does not pay for the same vectors again.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from pathlib import Path

import psycopg

from pantrila.foods import load_foods
from pantrila.schema import Recipe

CACHE_DIR = Path(__file__).resolve().parents[2] / ".cache" / "embeddings"
BATCH_SIZE = 128
# Seasoning, fats and water tell you little about what a dish is.
MINOR_AISLES = {"spices", "oils_condiments", "baking", "tap"}
KEY_INGREDIENTS = 10

EmbedFn = Callable[[Sequence[str]], tuple[list[list[float]], int]]


def embedding_text(recipe: Recipe) -> str:
    foods = load_foods()
    by_weight = sorted(recipe.ingredients, key=lambda i: -i.grams)
    key = [i for i in by_weight if foods[i.food].aisle not in MINOR_AISLES][:KEY_INGREDIENTS]
    names = list(dict.fromkeys(i.food.replace("_", " ") for i in key))
    lines = [
        recipe.title,
        recipe.summary,
        f"Cuisine: {recipe.cuisine.replace('_', ' ')}",
        f"Meal: {', '.join(m.value for m in recipe.meal_types)}",
        f"Key ingredients: {', '.join(names)}",
    ]
    if recipe.diet_tags:
        lines.append(f"Diet: {', '.join(d.value.replace('_', ' ') for d in recipe.diet_tags)}")
    lines.append(f"Ready in {recipe.total_minutes} minutes")
    return "\n".join(lines)


def content_hash(text: str, model: str) -> str:
    return hashlib.sha256(f"{model}\n{text}".encode()).hexdigest()


def openai_embedder(model: str, client=None) -> EmbedFn:
    from openai import OpenAI

    client = client or OpenAI()

    def embed(texts: Sequence[str]) -> tuple[list[list[float]], int]:
        resp = client.embeddings.create(model=model, input=list(texts))
        return [d.embedding for d in resp.data], resp.usage.total_tokens

    return embed


class FileCache:
    def __init__(self, model: str, cache_dir: Path = CACHE_DIR):
        self.path = cache_dir / f"{model}.jsonl"
        self.vectors: dict[str, list[float]] = {}
        if self.path.exists():
            for line in self.path.read_text().splitlines():
                row = json.loads(line)
                self.vectors[row["hash"]] = row["embedding"]

    def add(self, items: dict[str, list[float]]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.path.open("a") as fh:
            for h, vec in items.items():
                fh.write(json.dumps({"hash": h, "embedding": vec}) + "\n")
        self.vectors.update(items)


@dataclass
class IngestReport:
    recipes: int
    unchanged: int
    from_file_cache: int
    embedded: int
    tokens: int


def to_pgvector(vec: Sequence[float]) -> str:
    return "[" + ",".join(f"{x:.7g}" for x in vec) + "]"


def ingest(
    conn: psycopg.Connection,
    recipes: Sequence[Recipe],
    embed: EmbedFn,
    model: str,
    cache: FileCache | None = None,
) -> IngestReport:
    texts = {r.id: embedding_text(r) for r in recipes}
    hashes = {rid: content_hash(t, model) for rid, t in texts.items()}
    stored = dict(conn.execute("select recipe_id, content_hash from recipe_embeddings").fetchall())
    todo = [rid for rid in texts if stored.get(rid) != hashes[rid]]

    cache = cache or FileCache(model)
    vectors: dict[str, list[float]] = {}
    for rid in todo:
        if hashes[rid] in cache.vectors:
            vectors[rid] = cache.vectors[hashes[rid]]
    from_cache = len(vectors)

    missing = [rid for rid in todo if rid not in vectors]
    tokens = 0
    for start in range(0, len(missing), BATCH_SIZE):
        batch = missing[start : start + BATCH_SIZE]
        vecs, used = embed([texts[rid] for rid in batch])
        tokens += used
        fresh = dict(zip(batch, vecs, strict=True))
        cache.add({hashes[rid]: v for rid, v in fresh.items()})
        vectors.update(fresh)

    with conn.transaction(), conn.cursor() as cur:
        cur.executemany(
            "insert into recipe_embeddings (recipe_id, model, content_hash, embedding)"
            " values (%s, %s, %s, %s::vector)"
            " on conflict (recipe_id) do update set model = excluded.model,"
            " content_hash = excluded.content_hash, embedding = excluded.embedding",
            [(rid, model, hashes[rid], to_pgvector(vectors[rid])) for rid in todo],
        )
    return IngestReport(
        recipes=len(recipes),
        unchanged=len(recipes) - len(todo),
        from_file_cache=from_cache,
        embedded=len(missing),
        tokens=tokens,
    )
