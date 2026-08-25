"""Shared test fixtures for Gravity Search."""
import json
import pytest
from dataclasses import dataclass
from typing import AsyncIterator

from app.config import Settings
from app.llm.base import BaseLLMClient, LLMConfig, LLMMessage, LLMResponse, ModelProvider


# ── Fixtures ────────────────────────────────────────────────────────────


@pytest.fixture
def test_settings():
    return Settings(app_env="development", log_level="WARNING")


@pytest.fixture
def local_corpus_channel_enabled(monkeypatch):
    """
    Run under the configuration in which the verified-hit bypass exists.

    `evidence_gate.channels_after_gate` only drops `edgar` when the channel that
    would read the verified row is actually running, and `structured_facts_enabled`
    is off by default for a stated pre-existing reason. A test asserting "a
    verified hit costs zero SEC requests" without this is asserting a claim the
    default deployment does not make.
    """
    from app.config import settings

    monkeypatch.setattr(settings, "structured_facts_enabled", True, raising=False)
    return True


@pytest.fixture
def sample_query():
    return "What was Apple's revenue in Q4 2025?"


@pytest.fixture
def sample_passages():
    from app.core.retrieval.fusion import RetrievalResult
    return [
        RetrievalResult(chunk_id="c1", document_id="d1",
            text="Apple reported total net revenue of $124.3 billion for Q4 2025.",
            score=0.95, document_title="AAPL 10-K FY2025", section="Item 7 - MD&A",
            filing_date="2025-10-30", ticker="AAPL"),
        RetrievalResult(chunk_id="c2", document_id="d2",
            text="Services revenue was $25.3 billion, up 14% year-over-year.",
            score=0.88, document_title="AAPL Q4 2025 Earnings Transcript",
            section="Prepared Remarks", filing_date="2025-10-30", ticker="AAPL"),
    ]


# ── Mock LLM Client ────────────────────────────────────────────────────


class MockLLMClient(BaseLLMClient):
    """LLM client that returns pre-configured responses. No real API calls."""

    provider = ModelProvider.GOOGLE
    model_id = "mock-model"

    def __init__(self, responses: list[str] | None = None, model_id: str = "mock-model"):
        self.model_id = model_id
        self._responses = list(responses or ["Mock response"])
        self._call_count = 0
        self.last_messages: list[LLMMessage] = []

    async def generate(
        self,
        messages: list[LLMMessage],
        config: LLMConfig | None = None,
    ) -> LLMResponse:
        self.last_messages = messages
        content = self._responses[min(self._call_count, len(self._responses) - 1)]
        self._call_count += 1
        return LLMResponse(
            content=content,
            model=self.model_id,
            input_tokens=100,
            output_tokens=50,
            latency_ms=10.0,
            cost_usd=0.001,
        )

    async def generate_stream(
        self,
        messages: list[LLMMessage],
        config: LLMConfig | None = None,
    ) -> AsyncIterator[str]:
        content = self._responses[min(self._call_count, len(self._responses) - 1)]
        self._call_count += 1
        for word in content.split():
            yield word + " "


@pytest.fixture
def mock_llm():
    """Basic mock LLM returning a simple string."""
    return MockLLMClient(["Mock response"])


@pytest.fixture
def mock_llm_json():
    """Mock LLM returning valid JSON for query understanding."""
    return MockLLMClient([json.dumps({
        "intent": "multi_hop",
        "complexity": "complex",
        "entities": {
            "companies": ["AAPL"],
            "people": [],
            "dates": ["Q4 2025"],
            "metrics": ["revenue"],
            "themes": [],
        },
        "expanded_terms": {
            "original": ["Apple", "revenue", "Q4", "2025"],
            "synonyms": ["net sales", "top line"],
            "concepts": ["financial performance"],
        },
        "filters": {"date_range": {"from": "2025-10-01", "to": "2025-12-31"}},
        "retrieval_channels": ["dense", "bm25", "structured"],
    })])


def pytest_configure(config):
    """
    Register the `live` marker.

    `tests/live/` talks to sec.gov over real sockets. It is opt-in via
    GRAVITY_LIVE_SEC=1 and skips otherwise, so the deterministic suite never
    depends on SEC availability:

        DETERMINISTIC CI   pytest tests
        LIVE AUTHORITY     GRAVITY_LIVE_SEC=1 pytest tests/live -v
    """
    config.addinivalue_line(
        "markers", "live: hits real external infrastructure (sec.gov); opt-in"
    )
