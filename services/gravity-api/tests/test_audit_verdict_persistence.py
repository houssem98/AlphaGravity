"""Verification verdicts survive into the audit record (roadmap Phase 11).

Two defects motivated these tests, and both were in the artifact a compliance
reviewer would actually read months after a bad answer:

*Citations were never persisted.* `ResponseContext.citations` defaulted to an
empty list and the pipeline's only call site never set it — so the one thing an
audit most needs to reconstruct, which source was cited for what and whether it
checked out, was the one thing not written down.

*The record asserted providers nobody observed.* `RetrievalContext` defaulted
`vector_store` to "qdrant", `embedding_model` to "voyage-finance-2" and
`reranker` to "cohere-rerank-v3.5", and the caller never overrode them. Every
record in the system therefore named three providers regardless of which the
deployment had configured or reached.
"""

import json

import pytest

from app.core.search_pipeline import audit_answer_state
from compliance.audit_log import (
    AuditEvent,
    CitationRecord,
    QueryContext,
    ResponseContext,
    RetrievalContext,
    RetrievedChunk,
)


# ── The schema no longer asserts unobserved providers ────────────────────
class TestRetrievalContextDefaults:
    def test_provider_fields_default_to_unknown_not_to_a_provider_name(self):
        r = RetrievalContext()
        assert r.vector_store == ""
        assert r.embedding_model == ""
        assert r.reranker == ""

    def test_no_default_names_a_real_product(self):
        blob = json.dumps(RetrievalContext().__dict__)
        for name in ("qdrant", "voyage", "cohere", "elasticsearch", "neo4j"):
            assert name not in blob.lower(), f"default record still asserts {name}"

    def test_a_failed_channel_is_recorded_apart_from_a_used_one(self):
        r = RetrievalContext(
            channels_used=["dense_pg"],
            channels_failed={"bm25_es": "ConnectionError"},
            degraded=True,
        )
        assert r.channels_used == ["dense_pg"]
        assert r.channels_failed == {"bm25_es": "ConnectionError"}
        assert r.degraded is True

    def test_a_healthy_run_is_not_marked_degraded(self):
        assert RetrievalContext(channels_used=["dense_pg"]).degraded is False


# ── Verdicts are part of the persisted citation ──────────────────────────
class TestCitationRecord:
    def test_a_citation_carries_its_verdict_and_reasons(self):
        c = CitationRecord(
            chunk_id="c1", char_span=[0, 42], source_uri="https://sec.gov/x",
            confidence=1.0, verification_status="verified",
            verification_reasons=["numeric_grounded_in_source"],
            citation_number=1,
        )
        assert c.verification_status == "verified"
        assert c.verification_reasons == ["numeric_grounded_in_source"]
        assert c.citation_number == 1

    def test_the_default_verdict_is_not_verified(self):
        """A record written without a verdict must not read as verified."""
        c = CitationRecord(chunk_id="c", char_span=[0, 0], source_uri="", confidence=0.0)
        assert c.verification_status == "not_verifiable"
        assert c.verification_reasons == []

    def test_two_records_do_not_share_a_reasons_list(self):
        a = CitationRecord(chunk_id="a", char_span=[0, 0], source_uri="", confidence=0.0)
        b = CitationRecord(chunk_id="b", char_span=[0, 0], source_uri="", confidence=0.0)
        a.verification_reasons.append("x")
        assert b.verification_reasons == []


# ── The answer's own state is derived from evidence, not self-report ─────
class TestAuditAnswerState:
    def test_no_citations_is_answered(self):
        assert audit_answer_state([]) == "ANSWERED"

    def test_all_verified_is_answered(self):
        assert audit_answer_state([{"verification_status": "verified"}]) == "ANSWERED"

    def test_one_conflicting_citation_outranks_the_rest(self):
        state = audit_answer_state([
            {"verification_status": "verified"},
            {"verification_status": "verified"},
            {"verification_status": "conflicting"},
        ])
        assert state == "CONFLICTING_EVIDENCE"

    def test_nothing_but_unsupported_evidence_is_unsupported(self):
        assert audit_answer_state([
            {"verification_status": "unsupported"},
            {"verification_status": "not_verifiable"},
        ]) == "UNSUPPORTED"

    def test_a_partially_supported_citation_keeps_the_answer_answered(self):
        assert audit_answer_state([
            {"verification_status": "partially_supported"},
        ]) == "ANSWERED"

    def test_the_state_ignores_the_models_confidence_word(self):
        """Whatever the model claimed, the state comes from the verdicts."""
        cites = [{"verification_status": "conflicting", "confidence": "HIGH"}]
        assert audit_answer_state(cites) == "CONFLICTING_EVIDENCE"


# ── A whole record round-trips with the verdicts intact ──────────────────
class TestAuditEventRoundTrip:
    @pytest.fixture
    def event(self):
        return AuditEvent(
            trace_id="t-1",
            query=QueryContext(raw="What was NVIDIA revenue in FY2025?"),
            retrieval=RetrievalContext(
                top_k=3,
                retrieved_chunks=[
                    RetrievedChunk(doc_id="d1", chunk_id="c1", score=0.9,
                                   source_uri="https://sec.gov/x"),
                ],
                channels_used=["dense_pg"],
                channels_failed={"bm25_es": "ConnectionError"},
                degraded=True,
            ),
            response=ResponseContext(
                raw="Revenue was $130,497 million.",
                answer_state="CONFLICTING_EVIDENCE",
                confidence_label="MEDIUM",
                citations=[
                    CitationRecord(chunk_id="c1", char_span=[0, 10],
                                   source_uri="https://sec.gov/x", confidence=1.0,
                                   verification_status="verified",
                                   verification_reasons=["numeric_grounded_in_source"],
                                   citation_number=1),
                    CitationRecord(chunk_id="c2", char_span=[0, 0],
                                   source_uri="", confidence=0.0,
                                   verification_status="conflicting",
                                   verification_reasons=["period_mismatch"],
                                   citation_number=2),
                ],
            ),
        )

    def test_the_record_is_json_serialisable_with_its_verdicts(self, event):
        from dataclasses import asdict
        blob = json.dumps(asdict(event), default=str)
        assert "numeric_grounded_in_source" in blob
        assert "period_mismatch" in blob
        assert "CONFLICTING_EVIDENCE" in blob

    def test_a_reviewer_can_tell_which_citation_failed_and_why(self, event):
        bad = [c for c in event.response.citations
               if c.verification_status != "verified"]
        assert len(bad) == 1
        assert bad[0].citation_number == 2
        assert bad[0].verification_reasons == ["period_mismatch"]

    def test_the_record_says_the_run_was_degraded_and_names_the_failure(self, event):
        assert event.retrieval.degraded is True
        assert "bm25_es" in event.retrieval.channels_failed
        assert "bm25_es" not in event.retrieval.channels_used

    def test_the_record_never_asserts_a_provider_it_did_not_observe(self, event):
        from dataclasses import asdict
        blob = json.dumps(asdict(event), default=str).lower()
        for name in ("qdrant", "voyage", "cohere"):
            assert name not in blob, f"record asserts {name} without observing it"
