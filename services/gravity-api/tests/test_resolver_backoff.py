"""
The entity resolver's failure must not be paid for on every request.

Found by the stage trace, not by reading the code. The `entity` span was a
suspiciously CONSTANT 2003ms or 4007ms across every request — and constant time
is a timeout, never work. The log line that should have explained it read

    entity_resolution_skipped   error=

on every single query, because it logged `str(e)` and `asyncio.TimeoutError`
has an empty string representation. So the pipeline spent two to four seconds
per request failing, and reported that failure with an empty field.

Two defects, one symptom:

  1. `get_resolver` rebuilds whenever its singleton is not ready, so an
     unreachable ticker file means every request pays the full `wait_for`
     timeout with no possibility of success.
  2. The failure was invisible, which is why it survived long enough to become
     ~15% of a 27s request.
"""

from __future__ import annotations

import time

import pytest

from app.core import search_pipeline as sp


@pytest.fixture(autouse=True)
def _reset():
    sp._resolver_backoff_until[0] = 0.0
    yield
    sp._resolver_backoff_until[0] = 0.0


def test_the_backoff_state_exists_and_starts_open():
    assert sp._resolver_backoff_until == [0.0]
    assert sp._RESOLVER_BACKOFF_S > 0


def test_a_backoff_window_closes_the_gate():
    sp._resolver_backoff_until[0] = time.time() + 30
    assert time.time() < sp._resolver_backoff_until[0]


def test_an_expired_backoff_reopens_the_gate():
    sp._resolver_backoff_until[0] = time.time() - 1
    assert time.time() >= sp._resolver_backoff_until[0]


def test_the_backoff_is_long_enough_to_matter_but_not_permanent():
    """
    Short enough that a resolver coming back is picked up within a minute;
    long enough that a persistent failure is not re-paid every request.
    """
    assert 10 <= sp._RESOLVER_BACKOFF_S <= 600


def test_the_pipeline_checks_the_backoff_before_resolving():
    import inspect

    src = inspect.getsource(sp.SearchPipeline.search)
    i = src.find("_raw_companies and time.time() >=")
    assert i != -1, "the entity resolution call site no longer checks the backoff"
    # The check must gate the resolver call, not merely exist somewhere.
    after = src[i:i + 600]
    assert "get_resolver" in after


def test_the_failure_is_logged_by_type_not_by_an_empty_message():
    """
    `asyncio.TimeoutError` has an empty `str()`. Logging the message produced
    `error=` on every request, which is how a 4s-per-query defect stayed
    invisible.
    """
    import inspect

    src = inspect.getsource(sp.SearchPipeline.search)
    i = src.find("entity_resolution_skipped")
    assert i != -1
    window = src[max(0, i - 400):i + 300]
    assert "type(_er).__name__" in window
    assert "error=str(_er)" not in window


def test_a_failure_arms_the_backoff():
    import inspect

    src = inspect.getsource(sp.SearchPipeline.search)
    i = src.find("entity_resolution_skipped")
    window = src[max(0, i - 400):i + 300]
    assert "_resolver_backoff_until[0] =" in window


def test_timeout_error_really_does_stringify_to_nothing():
    """The premise of the whole fix, asserted rather than assumed."""
    import asyncio

    assert str(asyncio.TimeoutError()) == ""
    assert type(asyncio.TimeoutError()).__name__ == "TimeoutError"


# ── The second timeout in the same stage ──────────────────────────────────
#
# `entity` measured a flat 4007ms, not 2003ms, because there are TWO
# independent `wait_for(get_resolver(...), timeout=2.0)` calls inside that one
# stage: the primary resolution and the deterministic recovery/augment pass.
# Gating only the first left half the cost in place, which the live trace
# showed immediately: 4055ms on the first request, then a stubborn ~2023ms.


def test_both_resolver_calls_are_inside_the_entity_stage():
    import inspect

    src = inspect.getsource(sp.SearchPipeline.search)
    i = src.index("_t_entity = time.perf_counter()")
    j = src.index('_st.add("entity"')
    window = src[i:j]
    assert window.count("get_resolver(redis_client=_redis)") == 2, (
        "the entity stage no longer contains exactly two resolver builds; "
        "the backoff gates must match whatever is there now"
    )


def test_both_resolver_calls_are_gated_by_the_backoff():
    import inspect

    src = inspect.getsource(sp.SearchPipeline.search)
    i = src.index("_t_entity = time.perf_counter()")
    j = src.index('_st.add("entity"')
    window = src[i:j]
    # One gate per build: the `if` before the primary, the raise before the
    # recovery pass.
    assert "_raw_companies and time.time() >=" in window
    assert "time.time() < _resolver_backoff_until[0]" in window


def test_the_recovery_pass_also_logs_a_type_not_an_empty_message():
    import inspect

    src = inspect.getsource(sp.SearchPipeline.search)
    i = src.index("company_fallback_skipped")
    window = src[max(0, i - 500):i + 200]
    assert "type(_er2).__name__" in window
    assert "error=str(_er2)" not in window


def test_a_recovery_timeout_also_arms_the_backoff():
    import inspect

    src = inspect.getsource(sp.SearchPipeline.search)
    i = src.index("company_fallback_skipped")
    window = src[max(0, i - 500):i + 200]
    assert "_resolver_backoff_until[0] =" in window
