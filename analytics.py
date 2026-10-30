"""Pure query helpers: filtering, sorting, market statistics, and CSV export.

Nothing here touches disk or the web framework, so every function is directly
unit-testable. Derived values are computed only from reported listing data;
unknown specifications (see :func:`datastore.has_metric`) are excluded from
averages and exported as blanks rather than treated as real zeros.
"""
from __future__ import annotations

import csv
import io
import statistics
from dataclasses import dataclass
from typing import Any, Callable, Dict, Iterable, List, Optional

from datastore import has_metric

SQFT_PER_ACRE = 43560

Listing = Dict[str, Any]


@dataclass
class ListingFilter:
    """All supported listing filters; ``None`` / ``False`` means "no constraint"."""
    city: Optional[str] = None
    min_price: Optional[int] = None
    max_price: Optional[int] = None
    min_beds: Optional[int] = None
    min_baths: Optional[float] = None
    min_sqft: Optional[int] = None
    max_sqft: Optional[int] = None
    min_lot: Optional[int] = None
    min_garage: Optional[int] = None
    min_year: Optional[int] = None
    max_hoa: Optional[int] = None
    min_rating: Optional[int] = None
    favorites_only: bool = False
    search: Optional[str] = None


def _at_least(listing: Listing, field: str, minimum: Optional[float]) -> bool:
    return minimum is None or (minimum <= 0 or has_metric(listing, field)) and listing[field] >= minimum


def _at_most(listing: Listing, field: str, maximum: Optional[float]) -> bool:
    return maximum is None or (field == "price" or has_metric(listing, field)) and listing[field] <= maximum


def matches(listing: Listing, f: ListingFilter, *, city: Optional[str], query: Optional[str]) -> bool:
    if city is not None and listing["city"].lower() != city:
        return False
    if not (_at_least(listing, "price", f.min_price) and _at_most(listing, "price", f.max_price)):
        return False
    if not (_at_least(listing, "beds", f.min_beds) and _at_least(listing, "baths", f.min_baths)):
        return False
    if not (_at_least(listing, "sqft", f.min_sqft) and _at_most(listing, "sqft", f.max_sqft)):
        return False
    if not (_at_least(listing, "lot_sqft", f.min_lot) and _at_least(listing, "garage", f.min_garage)
            and _at_least(listing, "year_built", f.min_year)):
        return False
    # Unknown HOA is not evidence of a qualifying fee, so it fails a cap.
    if f.max_hoa is not None and (not has_metric(listing, "hoa") or listing["hoa"] > f.max_hoa):
        return False
    if f.min_rating and listing["rating"] < f.min_rating:
        return False
    if f.favorites_only and not listing.get("favorite"):
        return False
    if query:
        corpus = " ".join(str(listing.get(field, "")) for field in
                          ("address", "city", "zip", "description", "user_notes")).lower()
        if not all(term in corpus for term in query.split()):
            return False
    return True


def apply_filters(listings: Iterable[Listing], f: ListingFilter) -> List[Listing]:
    """Return listings satisfying every active filter (input order preserved)."""
    city = f.city.strip().lower() if f.city and f.city.strip().lower() != "all" else None
    query = f.search.strip().lower() if f.search and f.search.strip() else None
    return [p for p in listings if matches(p, f, city=city, query=query)]


def price_per_sqft(listing: Listing) -> Optional[float]:
    """Price per square foot, or ``None`` when size or price is unknown."""
    if has_metric(listing, "sqft") and listing["price"] > 0:
        return listing["price"] / listing["sqft"]
    return None


def _unknown_last(key: Callable[[Listing], Optional[float]], descending: bool) -> Callable[[Listing], tuple]:
    """Sort key that places listings with an unknown value after known ones."""
    def wrapped(listing: Listing) -> tuple:
        value = key(listing)
        if value is None:
            return (1, 0.0)
        return (0, -value if descending else value)
    return wrapped


def _metric(field: str) -> Callable[[Listing], Optional[float]]:
    return lambda p: p[field] if has_metric(p, field) else None


SORTERS: Dict[str, Callable[[Listing], tuple]] = {
    "price_asc": _unknown_last(lambda p: p["price"], False),
    "price_desc": _unknown_last(lambda p: p["price"], True),
    "sqft_desc": _unknown_last(_metric("sqft"), True),
    "lot_desc": _unknown_last(_metric("lot_sqft"), True),
    "year_desc": _unknown_last(_metric("year_built"), True),
    "rating_desc": _unknown_last(lambda p: p["rating"], True),
    "price_per_sqft_asc": _unknown_last(price_per_sqft, False),
}


def sort_listings(listings: List[Listing], sort_by: str = "default") -> List[Listing]:
    """Sort a copy of ``listings``; unknown ``sort_by`` keeps source order."""
    key = SORTERS.get(sort_by)
    return sorted(listings, key=key) if key else list(listings)


def _round_stat(fn: Callable[[List[float]], float], values: List[float]) -> int:
    return int(fn(values)) if values else 0


def _price_buckets(prices: List[int]) -> Dict[str, int]:
    """Histogram whose edges adapt to the data instead of assuming a range."""
    if not prices:
        return {}
    step = 50_000
    lo = (min(prices) // step) * step
    while (max(prices) - lo) // step + 1 > 12:
        step *= 2
        lo = (min(prices) // step) * step
    buckets: Dict[str, int] = {}
    edge = lo
    while edge <= max(prices):
        count = sum(1 for p in prices if edge <= p < edge + step)
        buckets[f"${edge // 1000}k - ${(edge + step) // 1000}k"] = count
        edge += step
    return buckets


def compute_stats(listings: List[Listing]) -> Dict[str, Any]:
    """Aggregate market analytics over ``listings`` (already filtered)."""
    total = len(listings)
    prices = [p["price"] for p in listings]
    sqfts = [p["sqft"] for p in listings if has_metric(p, "sqft")]
    lots = [p["lot_sqft"] for p in listings if has_metric(p, "lot_sqft")]
    ppsf = [v for v in map(price_per_sqft, listings) if v is not None]

    city_counts: Dict[str, int] = {}
    for p in listings:
        name = p.get("city") or "Other"
        city_counts[name] = city_counts.get(name, 0) + 1

    garage_dist: Dict[str, int] = {}
    for p in listings:
        if not has_metric(p, "garage"):
            label = "Unknown"
        else:
            label = f"{p['garage']} Car" if p["garage"] > 0 else "No Garage"
        garage_dist[label] = garage_dist.get(label, 0) + 1

    years = [p["year_built"] for p in listings if has_metric(p, "year_built")]
    year_dist = {
        "Pre-1980": sum(1 for y in years if y < 1980),
        "1980 - 1999": sum(1 for y in years if 1980 <= y < 2000),
        "2000 - 2015": sum(1 for y in years if 2000 <= y < 2016),
        "2016+": sum(1 for y in years if y >= 2016),
        "Unknown": total - len(years),
    }

    return {
        "total_listings": total,
        "favorites_count": sum(1 for p in listings if p.get("favorite")),
        "rated_count": sum(1 for p in listings if p.get("rating", 0) > 0),
        "avg_price": _round_stat(statistics.mean, prices),
        "median_price": _round_stat(statistics.median, prices),
        "min_price": min(prices) if prices else 0,
        "max_price": max(prices) if prices else 0,
        "avg_sqft": _round_stat(statistics.mean, sqfts),
        "median_sqft": _round_stat(statistics.median, sqfts),
        "avg_lot_sqft": _round_stat(statistics.mean, lots),
        "median_lot_sqft": _round_stat(statistics.median, lots),
        "avg_price_per_sqft": _round_stat(statistics.mean, ppsf),
        "median_price_per_sqft": _round_stat(statistics.median, ppsf),
        "city_counts": dict(sorted(city_counts.items(), key=lambda kv: kv[1], reverse=True)),
        "price_ranges": _price_buckets(prices),
        "garage_distribution": garage_dist,
        "year_built_distribution": year_dist,
    }


CSV_COLUMNS = [
    "Property ID", "Address", "City", "State", "Zip Code", "Price ($)", "Bedrooms",
    "Bathrooms", "Living SqFt", "Lot Size (sqft)", "Lot Size (acres)", "Price/SqFt ($)",
    "Year Built", "HOA Monthly ($)", "Garage Spaces", "User Rating (0-5)", "Favorite",
    "User Notes", "Latitude", "Longitude", "Listing URL",
]


def _csv_cell(listing: Listing, field: str) -> Any:
    """Reported value, or blank when the listing marks the field unknown."""
    return listing[field] if has_metric(listing, field) else ""


def _csv_safe(value: Any) -> Any:
    """Neutralize spreadsheet formula injection in free-text cells."""
    if isinstance(value, str) and value[:1] in ("=", "+", "-", "@", "\t", "\r"):
        return "'" + value
    return value


def listings_to_csv(listings: Iterable[Listing]) -> str:
    """Excel / Google Sheets compatible CSV; unknown specs export as blanks."""
    out = io.StringIO()
    writer = csv.writer(out, quoting=csv.QUOTE_MINIMAL, lineterminator="\r\n")
    writer.writerow(CSV_COLUMNS)
    for p in listings:
        ppsf = price_per_sqft(p)
        lot = p["lot_sqft"] if has_metric(p, "lot_sqft") else None
        writer.writerow([
            _csv_safe(p["id"]), _csv_safe(p["address"]), _csv_safe(p["city"]),
            _csv_safe(p["state"]), _csv_safe(p["zip"]), p["price"],
            _csv_cell(p, "beds"), _csv_cell(p, "baths"), _csv_cell(p, "sqft"),
            _csv_cell(p, "lot_sqft"),
            round(lot / SQFT_PER_ACRE, 3) if lot is not None else "",
            round(ppsf, 2) if ppsf is not None else "",
            _csv_cell(p, "year_built"), _csv_cell(p, "hoa"), _csv_cell(p, "garage"),
            p["rating"], "Yes" if p.get("favorite") else "No",
            _csv_safe(str(p.get("user_notes", "")).replace("\r", "").replace("\n", " ")),
            "" if p.get("latitude") is None else p["latitude"],
            "" if p.get("longitude") is None else p["longitude"],
            _csv_safe(p["url"]),
        ])
    return out.getvalue()
