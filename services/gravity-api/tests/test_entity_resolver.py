"""Entity-resolver tie-break: 'Block' must resolve to Block Inc, not H&R Block.

FinanceBench question about Block (formerly Square) was routing to H&R Block
(HRB) because both names reduce to content-tokens {block} after single-char
drop. The raw-token superset tie-break keeps 'H&R Block' → HRB while plain
'Block' → Block Inc.
"""

import asyncio

from app.core.entity_resolver import EntityResolver

_RAW = {
    "0": {"ticker": "XYZ", "cik_str": 1, "title": "Block, Inc."},
    "1": {"ticker": "HRB", "cik_str": 2, "title": "H&R Block Inc"},
    "2": {"ticker": "AAPL", "cik_str": 3, "title": "Apple Inc."},
    "3": {"ticker": "APLE", "cik_str": 4, "title": "Apple Hospitality REIT, Inc."},
}


def _resolver():
    return EntityResolver._from_raw(_RAW)


def test_block_resolves_to_block_inc():
    r = _resolver()
    assert asyncio.run(r.resolve("Block")).ticker == "XYZ"


def test_hr_block_still_resolves_to_hrb():
    r = _resolver()
    assert asyncio.run(r.resolve("H&R Block")).ticker == "HRB"


def test_exact_ticker_wins():
    r = _resolver()
    assert asyncio.run(r.resolve("HRB")).ticker == "HRB"


def test_apple_alias_not_hospitality():
    r = _resolver()
    assert asyncio.run(r.resolve("Apple")).ticker == "AAPL"
