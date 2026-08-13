"""
PL-5 / R6 / R7 — the matrix as data.

What these guard: a row that points at nothing (sold but unimplemented), a row with
a hole in one column (a customer sees a blank cell), a caller reading a quota off a
flag (an unlimited ceiling by accident), and an admin override that invents a
capability nothing enforces.
"""

import os

import pytest

from app.billing import capabilities as caps
from app.billing.tiers import sold_tiers


class TestTheMatrixIsWholeAndReal:
    def test_every_source_path_resolves(self):
        # §3 rule 6 made mechanical: sell only what someone can point at.
        orphans = [f"{c.key} -> {c.source}" for c in caps.CAPABILITIES
                   if not c.source_exists()]
        assert orphans == []

    def test_source_paths_resolve_from_any_working_directory(self):
        # They are repo-relative strings, and the API does not run from the repo
        # root. Anchoring to cwd would make this pass under pytest and fail in prod.
        os.chdir(os.path.dirname(os.path.abspath(__file__)))
        assert caps.capability("sso_saml").source_exists()

    def test_every_capability_defines_all_four_tiers(self):
        assert caps.validate() == []

    def test_the_tier_ids_match_the_tier_vocabulary(self):
        # If tiers.py renames a tier, this fails rather than the matrix silently
        # growing a column nothing reads.
        assert caps.SOLD_TIER_IDS == tuple(t.id for t in sold_tiers())

    def test_matrix_is_dense(self):
        m = caps.matrix()
        assert set(m) == set(caps.SOLD_TIER_IDS)
        assert all(len(v) == len(caps.CAPABILITIES) for v in m.values())

    def test_keys_are_unique(self):
        keys = [c.key for c in caps.CAPABILITIES]
        assert len(keys) == len(set(keys))

    def test_labels_are_unique(self):
        labels = [c.label for c in caps.CAPABILITIES]
        assert len(labels) == len(set(labels))


class TestReadingValues:
    def test_a_quota_reads_as_a_number(self):
        assert caps.limit_for("qa_searches_per_day", "free") == 10
        assert caps.limit_for("qa_searches_per_day", "professional") == 2_000

    def test_unlimited_reads_as_none(self):
        assert caps.limit_for("qa_searches_per_day", "institutional") is None

    def test_a_flag_is_not_a_quota(self):
        # Returning None here would hand the caller an unlimited ceiling.
        with pytest.raises(TypeError):
            caps.limit_for("sso_saml", "free")

    def test_a_categorical_row_is_not_a_quota(self):
        with pytest.raises(TypeError):
            caps.limit_for("history_retention", "free")

    def test_allows_reads_flags_and_zero_limits(self):
        assert caps.allows("sso_saml", "institutional") is True
        assert caps.allows("sso_saml", "free") is False
        assert caps.allows("scheduled_grids", "free") is False
        assert caps.allows("scheduled_grids", "analyst") is True

    def test_unknown_capability_raises_rather_than_defaulting(self):
        with pytest.raises(KeyError):
            caps.capability("teleportation")

    def test_unknown_tier_raises(self):
        with pytest.raises(KeyError):
            caps.value_for("sso_saml", "platinum")


class TestEnforcementIsDeclaredHonestly:
    def test_every_row_declares_where_it_is_enforced(self):
        assert all(c.enforcement in (caps.SERVER, caps.CLIENT) for c in caps.CAPABILITIES)

    def test_the_client_enforced_set_is_visible_not_hidden(self):
        # This number is a fact about how much of the matrix is actually defensible.
        # It is asserted so that moving a row server-side is a deliberate, visible
        # change rather than something that quietly drifts.
        assert len(caps.client_enforced()) == 14
        assert len(caps.CAPABILITIES) == 25

    def test_the_watchlist_ceiling_is_not_claimed_as_server_enforced(self):
        # It lives in localStorage under hub_watchlist_<market>.
        assert caps.capability("watchlist_symbols").enforcement == caps.CLIENT

    def test_rate_limited_rows_are_server_enforced(self):
        for key in ("qa_searches_per_day", "requests_per_minute", "hermes_asks_per_day"):
            assert caps.capability(key).enforcement == caps.SERVER


class TestAdminOverrideValidation:
    def test_a_good_override_is_accepted(self):
        assert caps.validate_override(
            {"api_keys": {"free": 0, "analyst": 2, "professional": 10, "institutional": 50}}
        ) == []

    def test_an_invented_capability_is_rejected(self):
        problems = caps.validate_override(
            {"teleportation": {"free": 1, "analyst": 1, "professional": 1, "institutional": 1}})
        assert any("unknown capability" in p for p in problems)

    def test_a_missing_tier_is_rejected(self):
        problems = caps.validate_override({"api_keys": {"free": 0, "analyst": 2}})
        assert any("missing tier 'professional'" in p for p in problems)
        assert any("missing tier 'institutional'" in p for p in problems)

    def test_an_unknown_tier_is_rejected(self):
        problems = caps.validate_override(
            {"api_keys": {"free": 0, "analyst": 2, "professional": 10,
                          "institutional": 50, "platinum": 99}})
        assert any("unknown tier 'platinum'" in p for p in problems)

    def test_a_non_object_is_rejected(self):
        assert caps.validate_override(["nope"]) != []
