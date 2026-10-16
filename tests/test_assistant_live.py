"""Paid gate: real model, real hybrid search. Fails if the assistant cites a recipe that breaks
the person's hard rules or does not exist.

uv run pytest -m live -s tests/test_assistant_live.py   # needs DATABASE_URL, OPENAI_API_KEY
"""

import os

import pytest

from evals.chat_cases import load_cases

pytestmark = pytest.mark.live

GATE = ["nut-allergy-satay", "fish-allergy-salmon", "unsafe-swap", "use-my-pantry"]


@pytest.mark.parametrize("cid", GATE)
def test_assistant_never_cites_an_unsafe_or_made_up_recipe(cid):
    if not (os.environ.get("OPENAI_API_KEY") and os.environ.get("DATABASE_URL")):
        pytest.skip("needs OPENAI_API_KEY and DATABASE_URL")
    from evals.run_assistant import run_one
    from pantrio import config

    case = next(c for c in load_cases() if c["id"] == cid)
    row = run_one(case, config.model(), "low")
    assert row["ok"], row.get("error")
    assert row["unsafe_cites"] == [] and row["made_up_cites"] == [], row["reply"]
