"""Settings read from the environment. Secrets never have defaults."""

from __future__ import annotations

import os
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


def database_url() -> str:
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise SystemExit("DATABASE_URL is not set (see .env.example)")
    return url


def fmt_cost(usd: float | None) -> str:
    return "n/a (set PANTRIO_PRICE_*_PER_MTOK)" if usd is None else f"${usd:.4f}"
