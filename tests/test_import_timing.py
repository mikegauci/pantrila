from datetime import UTC, datetime, timedelta

from pantrila.operations import reel_import_timing
from pantrila.records import UsageEvent


def event(kind, ms, at, ok=True):
    return UsageEvent(kind=kind, model="test", latency_ms=ms, created_at=at, ok=ok)


def test_video_estimate_matches_production_samples_and_ignores_caption_imports():
    now = datetime.now(UTC)
    events = [
        event("import", 103070, now),
        event("reel", 5473, now - timedelta(seconds=63)),
        event("import", 75140, now - timedelta(minutes=10)),
        event("reel", 5698, now - timedelta(minutes=10, seconds=48)),
        event("import", 5000, now - timedelta(minutes=5)),
        event("import", 200000, now - timedelta(minutes=3), ok=False),
    ]
    assert reel_import_timing(events) == (105, 2)


def test_no_samples_failed_reels_and_stale_samples_use_seed_estimate():
    now = datetime.now(UTC)
    assert reel_import_timing([]) == (105, 0)
    assert reel_import_timing(
        [
            event("import", 50000, now),
            event("reel", 5000, now - timedelta(seconds=20), ok=False),
            event("import", 80000, now - timedelta(days=31)),
            event("reel", 5000, now - timedelta(days=31, seconds=20)),
        ]
    ) == (105, 0)


def test_only_latest_five_video_samples_set_the_estimate():
    now = datetime.now(UTC)
    events = []
    for i in range(6):
        at = now - timedelta(minutes=i * 10)
        events += [
            event("import", 60000 if i < 5 else 300000, at),
            event("reel", 5000, at - timedelta(seconds=30)),
        ]
    assert reel_import_timing(events) == (70, 5)
