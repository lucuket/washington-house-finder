"""Integrity checks against the real shipped dataset."""
import json

import pytest

import validate_data
from build_data_js import is_current
from datastore import PROPERTIES_FILE, normalize_property
from conftest import make_listing


@pytest.fixture(scope="module")
def listings():
    with open(PROPERTIES_FILE, encoding="utf-8") as handle:
        return json.load(handle)


def test_dataset_has_no_errors(listings):
    errors, _ = validate_data.check_dataset(listings)
    assert errors == []


def test_repository_consistency(listings):
    errors, _ = validate_data.check_repository(listings)
    assert errors == []


def test_data_js_matches_properties_json(listings):
    assert is_current(listings)


def test_normalization_is_lossless_on_real_data(listings):
    """The API layer must never alter published listing data."""
    for p in listings:
        assert normalize_property(p) == p, p["id"]


# -- validator unit tests ------------------------------------------------------

def test_validator_flags_problems():
    bad = [
        make_listing(id="dup"),
        make_listing(id="dup", url="https://x/other"),
        make_listing(id="u", url="https://x/u", unknown_fields=["hoa"], hoa=25),
        make_listing(id="c", url="https://x/c", latitude=10.0, longitude=-117.0),
        make_listing(id="h", url="https://x/h", latitude=47.0, longitude=None),
        make_listing(id="p", url="ftp://x/p", price=0),
        "not an object",
    ]
    errors, _ = validate_data.check_dataset(bad)
    text = "\n".join(errors)
    for needle in ("duplicate id dup", "flagged unknown", "outside Washington",
                   "set together", "non-positive price", "not http(s)", "not an object"):
        assert needle in text, needle


def test_validator_accepts_clean_listing():
    errors, warnings = validate_data.check_dataset([make_listing()])
    assert errors == [] and warnings == []
