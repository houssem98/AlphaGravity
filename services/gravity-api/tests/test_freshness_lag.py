"""P2-c freshness SLA: verify the publish->index lag parser."""
from datetime import datetime, timezone, timedelta

from app.ingestion.sources.sec_edgar import _freshness_lag_seconds


def test_recent_publish_small_lag():
    ten_min_ago = (datetime.now(timezone.utc) - timedelta(minutes=10)).isoformat()
    lag = _freshness_lag_seconds(ten_min_ago)
    assert lag is not None and 590 < lag < 610  # ~600s, within 1h SLA
    assert lag < 3600


def test_old_publish_breaches_sla():
    two_hours_ago = (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat()
    lag = _freshness_lag_seconds(two_hours_ago)
    assert lag is not None and lag > 3600  # breaches SLA


def test_naive_timestamp_assumed_utc():
    # EDGAR Atom sometimes lacks tz; parser must not crash
    naive = (datetime.now(timezone.utc) - timedelta(minutes=5)).replace(tzinfo=None).isoformat()
    lag = _freshness_lag_seconds(naive)
    assert lag is not None and lag < 3600


def test_unparseable_returns_none():
    assert _freshness_lag_seconds("") is None
    assert _freshness_lag_seconds("not-a-date") is None


if __name__ == "__main__":
    test_recent_publish_small_lag()
    test_old_publish_breaches_sla()
    test_naive_timestamp_assumed_utc()
    test_unparseable_returns_none()
    print("all freshness-lag tests passed")
