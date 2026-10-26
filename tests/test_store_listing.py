"""The store texts in docs/store-listing.md fit the stores' character limits."""

import re
from pathlib import Path

LISTING = Path(__file__).resolve().parents[1] / "docs" / "store-listing.md"
BLOCK = re.compile(r"^### ([^\n]+?) \(max (\d+)\)\n\n```text\n(.*?)\n```", re.MULTILINE | re.DOTALL)


def test_every_store_text_fits_its_limit():
    blocks = BLOCK.findall(LISTING.read_text())
    assert len(blocks) == 8
    for name, limit, text in blocks:
        assert len(text) <= int(limit), f"{name}: {len(text)} characters, the store allows {limit}"


def test_app_store_keywords_are_a_plain_comma_list():
    texts = {name: text for name, _, text in BLOCK.findall(LISTING.read_text())}
    keywords = texts["Keywords"]
    words = keywords.split(",")
    assert all(w == w.strip() and w for w in words)
    assert len(set(words)) == len(words)
