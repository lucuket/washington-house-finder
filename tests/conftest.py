"""Shared test fixtures: project root on sys.path and a sample-listing factory."""
import os
import sys

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from datastore import PropertyStore  # noqa: E402


def make_listing(**overrides):
    """A complete, valid listing record; override any field."""
    base = {
        "id": "prop_test0001",
        "address": "100 Main St",
        "city": "Spokane",
        "state": "WA",
        "zip": "99201",
        "price": 400000,
        "beds": 3,
        "baths": 2,
        "sqft": 2000,
        "lot_sqft": 8000,
        "year_built": 1999,
        "hoa": 0,
        "garage": 2,
        "unknown_fields": [],
        "description": "A tidy house.",
        "url": "https://www.realtor.com/realestateandhomes-detail/test-1",
        "photos": ["https://example.com/a.jpg"],
        "latitude": 47.65,
        "longitude": -117.42,
        "favorite": False,
        "rating": 0,
        "user_notes": "",
    }
    base.update(overrides)
    return base


@pytest.fixture
def listing_factory():
    return make_listing


@pytest.fixture
def make_store(tmp_path):
    """Build a PropertyStore backed by temp files seeded with ``records``."""
    import json

    def _make(records):
        props = tmp_path / "properties.json"
        props.write_text(json.dumps(records), encoding="utf-8")
        store = PropertyStore(str(props), str(tmp_path / "data" / "user_state.json"))
        store.load()
        return store

    return _make
