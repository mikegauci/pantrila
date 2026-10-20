"""Paid gate: real model, real hybrid search. Fails on any hard constraint violation.

uv run pytest -m live -s tests/test_planner_live.py   # needs DATABASE_URL, OPENAI_API_KEY
"""

import os

import pytest

from evals.plan_profiles import load_profiles
from pantrila.constraints import check_plan, hard_violations

pytestmark = pytest.mark.live

GATE = ["vegan-high-protein", "seafood-sesame-soy-allergy", "picky-eater"]


@pytest.mark.parametrize("pid", GATE)
def test_planner_never_returns_a_hard_violation(pid):
    if not (os.environ.get("OPENAI_API_KEY") and os.environ.get("DATABASE_URL")):
        pytest.skip("needs OPENAI_API_KEY and DATABASE_URL")
    from pantrila import config, db
    from pantrila.planner import DbStore, Planner
    from pantrila.search import openai_query_embedder

    profile = dict(load_profiles())[pid]
    with db.connect(config.database_url()) as conn:
        store = DbStore(conn, openai_query_embedder(config.embed_model()))
        result = Planner(store).plan(profile)
    assert hard_violations(check_plan(result.plan, profile, result.recipes)) == []
    print(f"{pid}: {len(result.warnings)} warnings, {result.repairs} repairs, "
          f"{result.latency_ms / 1000:.1f}s")  # fmt: skip
