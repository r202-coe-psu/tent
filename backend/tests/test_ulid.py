"""ULID helper tests."""

from apiapp.utils.ulid import new_ulid


def test_new_ulid_is_26_crockford_chars():
    value = new_ulid()
    assert len(value) == 26
    assert all(c in "0123456789ABCDEFGHJKMNPQRSTVWXYZ" for c in value)


def test_new_ulid_unique():
    assert new_ulid() != new_ulid()
