"""Tests for the worker ULID helper."""

from worker.ulid import _CROCKFORD, new_ulid


def test_new_ulid_shape_and_alphabet():
    value = new_ulid()
    assert len(value) == 26
    assert set(value) <= set(_CROCKFORD)


def test_new_ulid_time_prefix_sorts_by_time():
    earlier = new_ulid(seed_time_ms=1_000)
    later = new_ulid(seed_time_ms=2_000)
    assert earlier[:10] < later[:10]
    assert new_ulid(seed_time_ms=0)[:10] == "0" * 10


def test_new_ulid_is_unique():
    assert len({new_ulid() for _ in range(100)}) == 100
