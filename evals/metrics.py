"""Retrieval metrics."""

from __future__ import annotations

import math
from collections.abc import Collection, Sequence


def normalized_recall_at_k(ranked: Sequence[str], relevant: Collection[str], k: int) -> float:
    """Share of relevant recipes found in the top k, capped so a perfect top k scores 1.

    Denominator is min(k, |relevant|). With 12 relevant recipes, normalized recall@5 asks
    "are all 5 results relevant?", not "did we find all 12 in 5 slots?".
    """
    if not relevant:
        raise ValueError("query has no relevant recipes")
    hits = len(set(ranked[:k]) & set(relevant))
    return hits / min(k, len(relevant))


def reciprocal_rank(ranked: Sequence[str], relevant: Collection[str]) -> float:
    for rank, doc in enumerate(ranked, start=1):
        if doc in relevant:
            return 1.0 / rank
    return 0.0


def percentile(values: Sequence[float], p: float) -> float:
    """Nearest-rank percentile (p in 0-100)."""
    if not values:
        return math.nan
    ordered = sorted(values)
    idx = max(0, math.ceil(p / 100 * len(ordered)) - 1)
    return ordered[idx]
