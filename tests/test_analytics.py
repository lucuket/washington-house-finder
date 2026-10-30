import csv
import io

from analytics import (
    ListingFilter, apply_filters, compute_stats, listings_to_csv, price_per_sqft, sort_listings,
)
from conftest import make_listing


def ids(listings):
    return [p["id"] for p in listings]


def sample():
    return [
        make_listing(id="a", city="Spokane", price=300000, sqft=1500, hoa=0),
        make_listing(id="b", city="Tacoma", price=500000, sqft=2500, hoa=100, garage=3),
        make_listing(id="c", city="Spokane", price=450000, sqft=0, unknown_fields=["sqft", "hoa"], hoa=0),
        make_listing(id="d", city="Olympia", price=250000, sqft=1000, year_built=1950,
                     user_notes="Needs a new Roof", favorite=True, rating=4),
    ]


def test_city_filter_is_case_insensitive_and_all_means_everything():
    assert ids(apply_filters(sample(), ListingFilter(city="spokane"))) == ["a", "c"]
    assert len(apply_filters(sample(), ListingFilter(city="All"))) == 4


def test_numeric_range_filters():
    f = ListingFilter(min_price=300000, max_price=460000, min_sqft=1)
    assert ids(apply_filters(sample(), f)) == ["a"]  # c excluded: unknown sqft is 0


def test_hoa_cap_excludes_unknown_hoa():
    out = apply_filters(sample(), ListingFilter(max_hoa=50))
    assert "c" not in ids(out) and "a" in ids(out) and "b" not in ids(out)


def test_search_covers_notes_and_flags():
    assert ids(apply_filters(sample(), ListingFilter(search="  roof "))) == ["d"]
    assert ids(apply_filters(sample(), ListingFilter(favorites_only=True))) == ["d"]
    assert ids(apply_filters(sample(), ListingFilter(min_rating=4))) == ["d"]


def test_filters_do_not_mutate_input():
    data = sample()
    apply_filters(data, ListingFilter(city="Tacoma"))
    assert len(data) == 4


def test_price_per_sqft_none_when_unknown():
    assert price_per_sqft(make_listing(price=400000, sqft=2000)) == 200
    assert price_per_sqft(make_listing(unknown_fields=["sqft"], sqft=0)) is None


def test_sorting_puts_unknowns_last_in_both_directions():
    data = sample()
    assert ids(sort_listings(data, "price_per_sqft_asc"))[-1] == "c"
    assert ids(sort_listings(data, "sqft_desc"))[-1] == "c"
    assert ids(sort_listings(data, "price_desc")) == ["b", "c", "a", "d"]
    assert ids(sort_listings(data, "default")) == ["a", "b", "c", "d"]
    assert ids(sort_listings(data, "no_such_sort")) == ["a", "b", "c", "d"]


def test_stats_exclude_unknowns_and_handle_empty():
    stats = compute_stats(sample())
    assert stats["total_listings"] == 4
    assert stats["median_price"] == 375000
    assert stats["avg_sqft"] == 1666  # (1500+2500+1000)/3, unknown excluded
    assert stats["garage_distribution"]["3 Car"] == 1
    assert stats["year_built_distribution"]["Pre-1980"] == 1
    assert stats["favorites_count"] == 1 and stats["rated_count"] == 1

    empty = compute_stats([])
    assert empty["total_listings"] == 0 and empty["price_ranges"] == {}


def test_price_buckets_adapt_to_data_range():
    wide = compute_stats([make_listing(id=str(i), price=p) for i, p in enumerate((200000, 750000))])
    labels = list(wide["price_ranges"])
    assert labels[0].startswith("$200k") and sum(wide["price_ranges"].values()) == 2
    assert len(labels) <= 12


def test_csv_blanks_for_unknown_and_neutralizes_formulas():
    rows = [
        make_listing(id="x", address="=HYPERLINK(1)", unknown_fields=["sqft", "hoa"], sqft=0, hoa=0,
                     user_notes="line1\nline2"),
        make_listing(id="y", hoa=0, garage=0),
    ]
    parsed = list(csv.DictReader(io.StringIO(listings_to_csv(rows))))
    x, y = parsed
    assert x["Living SqFt"] == "" and x["HOA Monthly ($)"] == "" and x["Price/SqFt ($)"] == ""
    assert x["Address"].startswith("'=")
    assert x["User Notes"] == "line1 line2"
    assert y["HOA Monthly ($)"] == "0" and y["Garage Spaces"] == "0"  # reported zeros survive
    assert y["Price/SqFt ($)"] == "200.0"
    assert y["Lot Size (acres)"] == "0.184"


def test_search_matches_terms_across_fields_like_the_frontend():
    row = make_listing(address="100 Oak Street", city="Tacoma", user_notes="New roof")
    assert apply_filters([row], ListingFilter(search="tacoma roof oak")) == [row]
    assert apply_filters([row], ListingFilter(search="tacoma missing")) == []


def test_numeric_filters_do_not_accept_marked_unknown_values():
    row = make_listing(beds=4, sqft=1800, unknown_fields=["beds", "sqft"])
    assert apply_filters([row], ListingFilter(min_beds=3)) == []
    assert apply_filters([row], ListingFilter(max_sqft=2000)) == []


def test_csv_neutralizes_every_free_text_column():
    row = make_listing(id="=id", city="+City", state="@WA", zip="\t123", url="=url")
    result = next(csv.DictReader(io.StringIO(listings_to_csv([row]))))
    for field in ("Property ID", "City", "State", "Zip Code", "Listing URL"):
        assert result[field].startswith("'")
