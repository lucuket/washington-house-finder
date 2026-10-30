import json
import os

import pytest

from datastore import (
    PropertyStore, atomic_write_text, has_metric, normalize_property, stable_listing_id,
    to_float, to_int, write_listings,
)
from conftest import make_listing


def test_coercion_never_raises():
    assert to_int("1,250") == 1250
    assert to_int(None) == 0
    assert to_int("abc", 7) == 7
    assert to_int(float("nan")) == 0
    assert to_float("$1,234.5") == 1234.5
    assert to_float(True) == 0.0
    assert to_float(float("inf")) == 0.0


def test_has_metric_respects_unknown_fields():
    known_zero = make_listing(hoa=0, unknown_fields=[])
    unknown = make_listing(hoa=0, unknown_fields=["hoa"])
    legacy = make_listing(hoa=0)
    del legacy["unknown_fields"]
    assert has_metric(known_zero, "hoa")
    assert not has_metric(unknown, "hoa")
    assert not has_metric(legacy, "hoa")  # legacy records: zero means unknown
    assert not has_metric(make_listing(sqft=float("nan")), "sqft")


def test_normalize_handles_malformed_values():
    p = normalize_property({"address": None, "price": "bad", "beds": None, "baths": "2.5",
                            "rating": 99, "photos": "['http://a/1.jpg', 'ftp://x']",
                            "latitude": 10, "longitude": -117.0})
    assert p["address"] == "Address Available On Request"
    assert p["price"] == 0 and p["beds"] == 0 and p["baths"] == 2.5
    assert p["rating"] == 5
    assert p["photos"] == ["http://a/1.jpg"]
    assert p["latitude"] is None and p["longitude"] is None  # outside WA -> dropped as a pair
    assert p["id"] == stable_listing_id("Address Available On Request", "Washington", 0)


def test_normalize_is_lossless_for_valid_listing():
    original = make_listing(source="x", snapshot_date="2026-10-28")
    assert normalize_property(original) == original


def test_normalize_rejects_non_mapping():
    with pytest.raises(ValueError):
        normalize_property("nope")


def test_atomic_write_leaves_no_temp_files(tmp_path):
    target = tmp_path / "out.json"
    atomic_write_text(str(target), "{}")
    atomic_write_text(str(target), '{"a":1}')
    assert target.read_text() == '{"a":1}'
    assert [p.name for p in tmp_path.iterdir()] == ["out.json"]


def test_load_skips_bad_records_and_keeps_good(make_store):
    store = make_store([make_listing(), "garbage", 5, make_listing(id="prop_b", url="https://x/2")])
    assert len(store) == 2


def test_missing_file_is_not_created_or_wiped(tmp_path):
    props = tmp_path / "properties.json"
    store = PropertyStore(str(props), str(tmp_path / "user_state.json"))
    assert store.load() == 0
    assert not props.exists()


def test_corrupt_file_is_not_overwritten(tmp_path):
    props = tmp_path / "properties.json"
    props.write_text("{not json", encoding="utf-8")
    store = PropertyStore(str(props), str(tmp_path / "user_state.json"))
    assert store.load() == 0
    assert props.read_text() == "{not json"


def test_user_updates_touch_only_user_state(make_store):
    store = make_store([make_listing()])
    before = open(store.properties_file, "rb").read()
    updated = store.update_user("prop_test0001", rating=4, user_notes="great yard", favorite=True)
    assert updated["rating"] == 4 and updated["favorite"] is True
    assert open(store.properties_file, "rb").read() == before
    saved = json.load(open(store.user_state_file, encoding="utf-8"))
    assert saved["prop_test0001"] == {"favorite": True, "rating": 4, "user_notes": "great yard"}

    # A fresh store sees the persisted research.
    again = PropertyStore(store.properties_file, store.user_state_file)
    again.load()
    assert again.get("prop_test0001")["user_notes"] == "great yard"


def test_unfavoriting_overrides_legacy_value(make_store):
    store = make_store([make_listing(favorite=True)])  # legacy: baked into properties.json
    assert store.get("prop_test0001")["favorite"] is True
    store.toggle_favorite("prop_test0001")
    again = PropertyStore(store.properties_file, store.user_state_file)
    again.load()
    assert again.get("prop_test0001")["favorite"] is False


def test_legacy_research_migrates_to_user_state(make_store):
    store = make_store([make_listing(rating=3, user_notes="legacy note")])
    assert os.path.exists(store.user_state_file)
    saved = json.load(open(store.user_state_file, encoding="utf-8"))
    assert saved["prop_test0001"]["rating"] == 3


def test_update_unknown_id_returns_none(make_store):
    assert make_store([make_listing()]).update_user("nope", rating=1) is None


def test_merge_preserves_ids_and_research_and_retains_absent(make_store):
    a = make_listing(id="prop_a", url="https://x/a", price=300000)
    b = make_listing(id="prop_b", url="https://x/b")
    store = make_store([a, b])
    store.update_user("prop_a", rating=5, favorite=True, user_notes="keep me")

    result = store.merge([
        make_listing(id="prop_new_id_ignored", url="https://x/a", price=290000),  # price drop
        make_listing(id="prop_c", url="https://x/c"),
        make_listing(id="prop_nourl", url=""),
    ])
    assert (result.added, result.updated) == (1, 1)

    merged = store.get("prop_a")
    assert merged["price"] == 290000 and merged["rating"] == 5 and merged["user_notes"] == "keep me"
    assert store.get("prop_b") is not None  # not returned by the scrape, retained
    assert store.get("prop_c") is not None
    assert store.get("prop_nourl") is None and store.get("prop_new_id_ignored") is None

    on_disk = json.load(open(store.properties_file, encoding="utf-8"))
    assert len(on_disk) == 3
    assert all(p["favorite"] is False and p["user_notes"] == "" for p in on_disk)  # publishable


def test_merge_with_nothing_does_not_write(make_store):
    store = make_store([make_listing()])
    before = os.path.getmtime(store.properties_file)
    assert store.merge([]).total == 0
    assert os.path.getmtime(store.properties_file) == before


def test_version_increments_on_change(make_store):
    store = make_store([make_listing()])
    v = store.version
    store.update_user("prop_test0001", rating=1)
    assert store.version == v + 1


def test_write_listings_resets_research(tmp_path):
    path = tmp_path / "p.json"
    write_listings([make_listing(rating=4, favorite=True, user_notes="private")], str(path))
    saved = json.loads(path.read_text(encoding="utf-8"))[0]
    assert (saved["rating"], saved["favorite"], saved["user_notes"]) == (0, False, "")


def test_normalization_marks_missing_invalid_and_legacy_zero_metrics_unknown():
    row = normalize_property({"address": "100 Main", "hoa": 0, "garage": -2,
                              "beds": "invalid", "sqft": 0, "unknown_fields": []})
    assert row["hoa"] == 0 and has_metric(row, "hoa")
    for field in ("beds", "baths", "garage", "sqft", "lot_sqft", "year_built"):
        assert row[field] == 0 and not has_metric(row, field)
    legacy = normalize_property({"hoa": 0, "garage": 0})
    assert not has_metric(legacy, "hoa") and not has_metric(legacy, "garage")


def test_failed_user_write_does_not_leak_into_later_saves(make_store, monkeypatch):
    import datastore
    store = make_store([make_listing(id="a"), make_listing(id="b")])
    version = store.version
    original = datastore.atomic_write_text
    def fail(*args, **kwargs):
        raise OSError("disk unavailable")
    monkeypatch.setattr(datastore, "atomic_write_text", fail)
    with pytest.raises(OSError):
        store.update_user("a", user_notes="should not be committed")
    assert store.version == version and store.get("a")["user_notes"] == ""
    monkeypatch.setattr(datastore, "atomic_write_text", original)
    store.update_user("b", rating=4)
    state = json.load(open(store.user_state_file, encoding="utf-8"))
    assert "a" not in state
