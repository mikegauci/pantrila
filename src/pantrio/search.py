"""Hybrid recipe retrieval: hard SQL filters, then pgvector and full-text candidates merged
with reciprocal rank fusion (RRF).

Filters (allergens, diets, time, meal, cuisine, excluded foods) are applied in SQL to both
candidate lists, so a recipe that breaks a filter can never be returned by any mode.
"""

from __future__ import annotations

import time
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from enum import StrEnum

import psycopg
from pydantic import BaseModel, Field

from pantrio.embeddings import to_pgvector
from pantrio.schema import Allergen, DietTag, MealType, Recipe

RRF_K = 60
CANDIDATES = 50
HNSW_EF_SEARCH = 200

QueryEmbedFn = Callable[[str], tuple[list[float], int]]


class Mode(StrEnum):
    VECTOR = "vector"
    FULLTEXT = "fulltext"
    HYBRID = "hybrid"


class SearchFilters(BaseModel):
    exclude_allergens: list[Allergen] = Field(
        default_factory=list, description="Allergens the recipe must not contain."
    )
    require_diets: list[DietTag] = Field(
        default_factory=list, description="Diet tags the recipe must have, all of them."
    )
    max_minutes: int | None = Field(default=None, description="Upper bound on total time.")
    meal_types: list[MealType] = Field(
        default_factory=list, description="Recipe must suit at least one of these meals."
    )
    cuisines: list[str] = Field(
        default_factory=list, description="Recipe must be one of these cuisines."
    )
    exclude_foods: list[str] = Field(
        default_factory=list,
        description="Food keys the recipe must not use, for asks like 'no mushrooms'.",
    )

    def violations(self, recipe: Recipe) -> list[str]:
        """Check a recipe in Python, independently of the SQL, for evals and tests."""
        out = []
        if bad := set(self.exclude_allergens) & set(recipe.allergens):
            out.append(f"contains {sorted(a.value for a in bad)}")
        if missing := set(self.require_diets) - set(recipe.diet_tags):
            out.append(f"not {sorted(d.value for d in missing)}")
        if self.max_minutes is not None and recipe.total_minutes > self.max_minutes:
            out.append(f"takes {recipe.total_minutes} min")
        if self.meal_types and not set(self.meal_types) & set(recipe.meal_types):
            out.append("wrong meal")
        if self.cuisines and recipe.cuisine not in self.cuisines:
            out.append("wrong cuisine")
        if bad := set(self.exclude_foods) & recipe.foods:
            out.append(f"uses {sorted(bad)}")
        return out


def filter_sql(f: SearchFilters, alias: str = "r") -> tuple[str, dict]:
    """WHERE clause (without the keyword) and named parameters for the hard filters."""
    clauses = ["true"]
    params: dict = {}
    if f.exclude_allergens:
        clauses.append(f"not ({alias}.allergens && %(exclude_allergens)s::text[])")
        params["exclude_allergens"] = [a.value for a in f.exclude_allergens]
    if f.require_diets:
        clauses.append(f"{alias}.diet_tags @> %(require_diets)s::text[]")
        params["require_diets"] = [d.value for d in f.require_diets]
    if f.max_minutes is not None:
        clauses.append(f"{alias}.total_minutes <= %(max_minutes)s")
        params["max_minutes"] = f.max_minutes
    if f.meal_types:
        clauses.append(f"{alias}.meal_types && %(meal_types)s::text[]")
        params["meal_types"] = [m.value for m in f.meal_types]
    if f.cuisines:
        clauses.append(f"{alias}.cuisine = any(%(cuisines)s::text[])")
        params["cuisines"] = list(f.cuisines)
    if f.exclude_foods:
        clauses.append(
            "not exists (select 1 from recipe_ingredients ri"
            f" where ri.recipe_id = {alias}.id and ri.food = any(%(exclude_foods)s::text[]))"
        )
        params["exclude_foods"] = list(f.exclude_foods)
    return " and ".join(clauses), params


def rrf_merge(rankings: Sequence[Sequence[str]], k: int = RRF_K) -> list[tuple[str, float]]:
    """Reciprocal rank fusion: score(d) = sum over lists of 1 / (k + rank), ranks from 1."""
    scores: dict[str, float] = {}
    for ranking in rankings:
        for rank, doc in enumerate(ranking, start=1):
            scores[doc] = scores.get(doc, 0.0) + 1.0 / (k + rank)
    return sorted(scores.items(), key=lambda kv: (-kv[1], kv[0]))


def vector_candidates(
    conn: psycopg.Connection, qvec: Sequence[float], f: SearchFilters, k: int = CANDIDATES
) -> list[str]:
    where, params = filter_sql(f)
    with conn.transaction():
        conn.execute(f"set local hnsw.ef_search = {HNSW_EF_SEARCH}")
        rows = conn.execute(
            f"""
            select r.id from recipes r join recipe_embeddings e on e.recipe_id = r.id
            where {where}
            order by e.embedding <=> %(qvec)s::vector, r.id
            limit %(k)s
            """,
            {**params, "qvec": to_pgvector(qvec), "k": k},
        ).fetchall()
    return [r[0] for r in rows]


def fulltext_candidates(
    conn: psycopg.Connection, query: str, f: SearchFilters, k: int = CANDIDATES
) -> list[str]:
    # plainto_tsquery ANDs every word; OR them instead so long asks still match partially,
    # and let ts_rank_cd reward recipes that match more of them.
    where, params = filter_sql(f)
    rows = conn.execute(
        f"""
        with q as (
            select nullif(replace(plainto_tsquery('english', %(query)s)::text, ' & ', ' | '),
                          '')::tsquery as tsq
        )
        select r.id from recipes r, q
        where q.tsq is not null and r.search_tsv @@ q.tsq and {where}
        order by ts_rank_cd(r.search_tsv, q.tsq) desc, r.id
        limit %(k)s
        """,
        {**params, "query": query, "k": k},
    ).fetchall()
    return [r[0] for r in rows]


@dataclass
class SearchResult:
    ids: list[str]
    scores: list[float]
    embed_tokens: int = 0
    timings_ms: dict[str, float] = field(default_factory=dict)


def search(
    conn: psycopg.Connection,
    query: str,
    filters: SearchFilters | None = None,
    *,
    mode: Mode = Mode.HYBRID,
    limit: int = 10,
    embed_query: QueryEmbedFn | None = None,
) -> SearchResult:
    f = filters or SearchFilters()
    timings: dict[str, float] = {}
    rankings: list[list[str]] = []
    tokens = 0

    if mode in (Mode.VECTOR, Mode.HYBRID):
        if embed_query is None:
            raise ValueError("vector and hybrid search need embed_query")
        t = time.perf_counter()
        qvec, tokens = embed_query(query)
        timings["embed"] = (time.perf_counter() - t) * 1000
        t = time.perf_counter()
        rankings.append(vector_candidates(conn, qvec, f))
        timings["vector"] = (time.perf_counter() - t) * 1000
    if mode in (Mode.FULLTEXT, Mode.HYBRID):
        t = time.perf_counter()
        rankings.append(fulltext_candidates(conn, query, f))
        timings["fulltext"] = (time.perf_counter() - t) * 1000

    if mode is Mode.HYBRID:
        merged = rrf_merge(rankings)[:limit]
    else:
        ranked = rankings[0][:limit]
        merged = [(doc, 1.0 / (RRF_K + rank)) for rank, doc in enumerate(ranked, start=1)]
    return SearchResult(
        ids=[d for d, _ in merged],
        scores=[s for _, s in merged],
        embed_tokens=tokens,
        timings_ms=timings,
    )


def openai_query_embedder(model: str, client=None) -> QueryEmbedFn:
    from pantrio.embeddings import openai_embedder

    embed = openai_embedder(model, client)

    def embed_query(text: str) -> tuple[list[float], int]:
        vecs, tokens = embed([text])
        return vecs[0], tokens

    return embed_query


# --- Optional LLM query parser -------------------------------------------------------------


class ParsedQuery(BaseModel):
    search_text: str = Field(
        description="What the person wants to eat, with constraints removed, e.g. "
        "'dinner with leftover rice'. Keep dish names, ingredients they have and moods."
    )
    exclude_allergens: list[Allergen] = Field(
        description="Allergens to exclude: stated allergies or 'X-free' asks that map to an EU "
        "allergen (dairy-free means milk, nut allergy means peanuts and tree_nuts)."
    )
    require_diets: list[DietTag] = Field(description="Diets stated explicitly. Do not guess.")
    max_minutes: int | None = Field(
        description="Time limit if stated; 'quick' means 30, 'under an hour' means 60."
    )
    meal_types: list[MealType] = Field(description="Meals named in the ask, if any.")
    exclude_foods: list[str] = Field(
        description="Pantrio food keys for ingredients the person says to avoid ('no "
        "mushrooms' gives ['mushroom', 'shiitake'])."
    )


PARSER_INSTRUCTIONS = (
    "Turn a recipe search into a search string plus hard filters. Only set a filter when the "
    "ask states it; leave lists empty and max_minutes null otherwise."
)


def parse_query(text: str, model: str, client=None) -> tuple[str, SearchFilters, dict]:
    """Returns (search_text, filters, usage). Unknown food keys are dropped, not trusted."""
    from openai import OpenAI

    from pantrio.foods import load_foods

    client = client or OpenAI()
    resp = client.responses.parse(
        model=model,
        instructions=PARSER_INSTRUCTIONS,
        input=text,
        text_format=ParsedQuery,
        reasoning={"effort": "low"},
        store=False,
    )
    p = resp.output_parsed
    known = load_foods()
    filters = SearchFilters(
        exclude_allergens=p.exclude_allergens,
        require_diets=p.require_diets,
        max_minutes=p.max_minutes,
        meal_types=p.meal_types,
        exclude_foods=[food for food in p.exclude_foods if food in known],
    )
    usage = {"input_tokens": resp.usage.input_tokens, "output_tokens": resp.usage.output_tokens}
    return p.search_text or text, filters, usage
