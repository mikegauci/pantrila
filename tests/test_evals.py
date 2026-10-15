import json

import pytest

from evals.metrics import percentile, recall_at_k, reciprocal_rank
from evals.retrieval_queries import OUT, SPECS, generate, render
from pantrio.corpus import load_briefs, load_corpus


def test_recall_at_k_is_capped_by_k():
    ranked = ["a", "b", "c", "d", "e", "f"]
    assert recall_at_k(ranked, {"a", "c"}, 5) == 1.0
    assert recall_at_k(ranked, {"a", "z"}, 5) == 0.5
    # 10 relevant, 5 of them in the top 5: perfect at k=5.
    assert recall_at_k(ranked[:5], set(ranked[:5]) | {str(i) for i in range(5)}, 5) == 1.0
    with pytest.raises(ValueError):
        recall_at_k(ranked, set(), 5)


def test_reciprocal_rank():
    assert reciprocal_rank(["x", "a"], {"a"}) == 0.5
    assert reciprocal_rank(["x"], {"a"}) == 0.0


def test_percentile_nearest_rank():
    values = list(range(1, 101))
    assert percentile(values, 50) == 50
    assert percentile(values, 95) == 95
    assert percentile([7.0], 95) == 7.0


def test_query_specs_cover_the_hard_cases():
    kinds = {s.kind for s in SPECS}
    assert {"negation", "allergen", "vague", "pantry"} <= kinds
    assert len(SPECS) >= 60
    assert len({s.id for s in SPECS}) == len(SPECS)


def test_committed_queries_match_generator():
    recipes = load_corpus()
    if not recipes:
        pytest.skip("corpus not generated yet")
    assert OUT.read_text() == render(generate(recipes, load_briefs()))


def test_committed_queries_never_label_filter_breakers_relevant():
    if not OUT.exists():
        pytest.skip("retrieval queries not generated yet")
    from pantrio.search import SearchFilters

    recipes = {r.id: r for r in load_corpus()}
    for q in json.loads(OUT.read_text()):
        f = SearchFilters.model_validate(q["filters"])
        assert q["relevant_ids"]
        assert all(not f.violations(recipes[rid]) for rid in q["relevant_ids"]), q["id"]
