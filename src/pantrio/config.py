"""Settings read from the environment. Secrets never have defaults."""

from __future__ import annotations

import functools
import logging
import os
import uuid
from dataclasses import dataclass

from dotenv import load_dotenv

load_dotenv()

DEFAULT_MODEL = "gpt-5.4-mini"
DEFAULT_EMBED_MODEL = "text-embedding-3-small"
EMBED_DIM = 1536


def _float(name: str) -> float | None:
    value = os.environ.get(name)
    return float(value) if value else None


@dataclass(frozen=True)
class Prices:
    """USD per million tokens. Unset prices make cost report as unknown, not zero."""

    input: float | None
    output: float | None
    embed: float | None

    def chat_cost(self, input_tokens: int, output_tokens: int) -> float | None:
        if self.input is None or self.output is None:
            return None
        return (input_tokens * self.input + output_tokens * self.output) / 1e6

    def embed_cost(self, tokens: int) -> float | None:
        return None if self.embed is None else tokens * self.embed / 1e6


def model() -> str:
    return os.environ.get("PANTRIO_MODEL") or DEFAULT_MODEL


def embed_model() -> str:
    return os.environ.get("PANTRIO_EMBED_MODEL") or DEFAULT_EMBED_MODEL


def prices() -> Prices:
    return Prices(
        input=_float("PANTRIO_PRICE_INPUT_PER_MTOK"),
        output=_float("PANTRIO_PRICE_OUTPUT_PER_MTOK"),
        embed=_float("PANTRIO_PRICE_EMBED_PER_MTOK"),
    )


def openai_client():
    """OpenAI client, wrapped for LangSmith tracing when LANGSMITH_TRACING is true."""
    from openai import OpenAI

    client = OpenAI()
    if tracing():
        from langsmith.wrappers import wrap_openai

        client = wrap_openai(client)
    return client


def tracing() -> bool:
    return os.environ.get("LANGSMITH_TRACING", "").lower() == "true"


def trace_config(name: str, source: str, run_id: uuid.UUID, **metadata) -> dict:
    """LangGraph run config: a root run named `plan` or `chat`, tagged with where it ran
    (`api`, `cli`, `eval`) so LangSmith dashboards can split live traffic from evals."""
    return {"run_name": name, "run_id": run_id, "tags": [source],
            "metadata": {"source": source, **metadata}}  # fmt: skip


@functools.cache
def _langsmith():
    from langsmith import Client

    client = Client()
    project = client.read_project(project_name=os.environ.get("LANGSMITH_PROJECT") or "default")
    return client, project.id


def log_feedback(run_id: uuid.UUID, scores: dict[str, float | None]) -> None:
    """Attach deterministic quality scores to a traced run (no-op with tracing off). The
    LangSmith dashboard charts them; a failure here never breaks the request."""
    if not tracing():
        return
    try:
        client, project_id = _langsmith()
        for key, score in scores.items():
            if score is not None:
                client.create_feedback(run_id, key, score=score, trace_id=run_id,
                                       session_id=project_id)  # fmt: skip
    except Exception:
        logging.getLogger(__name__).warning("could not log LangSmith feedback", exc_info=True)


def database_url() -> str:
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise SystemExit("DATABASE_URL is not set (see .env.example)")
    return url


def supabase_url() -> str:
    url = os.environ.get("SUPABASE_URL")
    if not url:
        raise SystemExit("SUPABASE_URL is not set (see .env.example)")
    return url


def cors_origins() -> list[str]:
    raw = os.environ.get("PANTRIO_CORS_ORIGINS") or "http://localhost:3000"
    return [o.strip().rstrip("/") for o in raw.split(",") if o.strip()]


@dataclass(frozen=True)
class Limits:
    """Daily caps that keep a public demo cheap. Days start at midnight UTC."""

    plans_per_user: int
    chats_per_user: int
    imports_per_user: int  # recipe imports from photos or links, and food estimates
    budget_usd: float  # all users together


def limits() -> Limits:
    return Limits(
        plans_per_user=int(os.environ.get("PANTRIO_DAILY_PLANS") or 5),
        chats_per_user=int(os.environ.get("PANTRIO_DAILY_CHATS") or 50),
        imports_per_user=int(os.environ.get("PANTRIO_DAILY_IMPORTS") or 20),
        budget_usd=float(os.environ.get("PANTRIO_DAILY_BUDGET_USD") or 2.0),
    )


def fmt_cost(usd: float | None) -> str:
    return "n/a (set PANTRIO_PRICE_*_PER_MTOK)" if usd is None else f"${usd:.4f}"
