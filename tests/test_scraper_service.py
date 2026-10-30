import asyncio
import sys
import types

import pytest

import scraper_service as svc
from datastore import has_metric
from models import SearchCriteria

CRITERIA = SearchCriteria().model_dump()


def good_row(**overrides):
    row = {
        "property_url": "https://www.realtor.com/realestateandhomes-detail/abc",
        "street": "100 Main St", "city": "spokane", "state": "WA", "zip_code": "99201",
        "list_price": 400000, "sqft": 1600, "beds": 3, "full_baths": 2, "half_baths": 1,
        "year_built": 1999, "lot_sqft": 8000, "hoa_fee": 0, "parking_garage": 2,
        "style": "SINGLE_FAMILY", "status": "FOR_SALE", "mls_status": "Active",
        "description": "Nice home.", "primary_photo": "https://img/1.jpg",
        "alt_photos": "https://img/2.jpg, https://img/1.jpg", "latitude": 47.6, "longitude": -117.4,
        "property_id": "123", "listing_id": "456",
    }
    row.update(overrides)
    return row


def evaluate(**overrides):
    return svc.evaluate_row(good_row(**overrides), CRITERIA, snapshot_date="2026-10-28")


def test_good_row_is_accepted_with_provenance_and_half_baths():
    listing, reason = evaluate()
    assert reason == "" and listing["city"] == "Spokane"
    assert listing["baths"] == 2.5
    assert listing["photos"] == ["https://img/1.jpg", "https://img/2.jpg"]
    assert listing["source"] == svc.SOURCE_LABEL and listing["snapshot_date"] == "2026-10-28"
    assert listing["unknown_fields"] == [] and has_metric(listing, "hoa")


@pytest.mark.parametrize("overrides, reason", [
    ({"status": "SOLD"}, "not_active"),
    ({"mls_status": "Under Contract"}, "not_active"),
    ({"list_price": 900000}, "price"),
    ({"sqft": 900}, "sqft"),
    ({"beds": 1}, "beds"),
    ({"full_baths": 0, "half_baths": 1}, "baths"),
    ({"year_built": 1950}, "year_built"),
    ({"lot_sqft": 1000}, "lot_size"),
    ({"hoa_fee": None}, "hoa_unknown"),
    ({"hoa_fee": 500}, "hoa"),
    ({"parking_garage": 1}, "garage"),
    ({"parking_garage": None}, "garage"),
    ({"style": "CONDOS"}, "property_type"),
    ({"street": "55 Oak Ave Unit 4"}, "property_type"),
    ({"description": "This is a manufactured home on a lot."}, "property_type"),
    ({"property_url": ""}, "missing_url"),
])
def test_rejection_reasons(overrides, reason):
    listing, got = evaluate(**overrides)
    assert listing is None and got == reason


def test_nan_values_are_treated_as_missing():
    assert evaluate(hoa_fee=float("nan"))[1] == "hoa_unknown"


def test_description_is_only_a_lower_bound_for_garage():
    listing, _ = evaluate(parking_garage=None, description="Attached 3-car garage with shop.")
    assert listing["garage"] == 3
    assert evaluate(parking_garage=None, description="Detached carport only.")[1] == "garage"
    assert svc.garage_from_text("double garage and a two car carport") == 2


def test_driveway_parking_is_not_garage_capacity():
    assert svc.garage_from_text("Room for three cars on the driveway, two-car carport") is None
    assert evaluate(parking_garage=None, parking_spaces=4,
                    description="Three-car driveway with covered carport")[1] == "garage"


def test_any_minimum_does_not_turn_missing_specs_into_reported_zeros():
    criteria = {**CRITERIA, "beds_min": 0, "baths_min": 0, "lot_size_min": 0, "year_built_min": 0}
    listing, reason = svc.evaluate_row(good_row(beds=None, full_baths=None, half_baths=None,
                                               lot_sqft=None, year_built=None), criteria)
    assert listing is not None, reason
    assert set(listing["unknown_fields"]) == {"beds", "baths", "lot_sqft", "year_built"}
    assert svc.evaluate_row(good_row(sqft=None), {**criteria, "sqft_min": 0})[1] == "sqft"


@pytest.mark.parametrize("values", [{"price_min": 600000, "price_max": 300000},
                                   {"sqft_min": 2000, "sqft_max": 1200}])
def test_search_criteria_reject_reversed_ranges(values):
    from pydantic import ValidationError
    with pytest.raises(ValidationError):
        SearchCriteria(**values)


def test_description_mentioning_condos_does_not_reject_a_house():
    listing, reason = evaluate(description="Quiet street, no condos or townhouses nearby.")
    assert listing is not None, reason


def test_clean_property_row_swallows_bad_rows():
    assert svc.clean_property_row(good_row(), CRITERIA)["id"].startswith("prop_")
    assert svc.clean_property_row({"list_price": object()}, CRITERIA) is None


def test_markets_resolution():
    assert svc.resolve_markets("washington") == svc.DEFAULT_MARKETS
    assert svc.resolve_markets("Tacoma, WA") == ["Tacoma, WA"]


def run(coro):
    return asyncio.run(coro)


def test_scraper_refuses_without_authorization(monkeypatch):
    monkeypatch.delenv(svc.AUTHORIZATION_ENV, raising=False)
    with pytest.raises(svc.ScrapeError, match="express written permission"):
        run(svc.run_live_scraper(CRITERIA, lambda m: None, lambda p, m: None))


@pytest.fixture
def fake_homeharvest(monkeypatch):
    pd = pytest.importorskip("pandas")
    monkeypatch.setenv(svc.AUTHORIZATION_ENV, "yes")
    calls = []

    def scrape_property(**kwargs):
        calls.append(kwargs)
        if kwargs["location"] == "Boom, WA":
            raise RuntimeError("403 Forbidden")
        return pd.DataFrame([good_row(), good_row(property_url="https://r/2", list_price=950000),
                             good_row(property_url="https://r/3", hoa_fee=None)])

    module = types.ModuleType("homeharvest")
    module.scrape_property = scrape_property
    monkeypatch.setitem(sys.modules, "homeharvest", module)
    return calls


def test_scraper_filters_dedupes_and_reports(fake_homeharvest):
    logs = []
    out = run(svc.run_live_scraper(CRITERIA, logs.append, lambda p, m: None,
                                   markets=["A, WA", "B, WA"], delay_seconds=0))
    assert len(out) == 1  # duplicate URL across markets collapsed, others rejected
    assert any("Rejected 2 listings" in line for line in logs)
    assert fake_homeharvest[0]["property_type"] == ["single_family"]
    assert fake_homeharvest[0]["price_max"] == CRITERIA["price_max"]


def test_scraper_stops_on_first_upstream_error(fake_homeharvest):
    with pytest.raises(svc.ScrapeError, match="Boom, WA"):
        run(svc.run_live_scraper(CRITERIA, lambda m: None, lambda p, m: None,
                                 markets=["Boom, WA", "A, WA"], delay_seconds=0))
    assert len(fake_homeharvest) == 1  # never moved on to the next market
