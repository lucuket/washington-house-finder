#!/usr/bin/env python3
"""Validate listing data integrity before committing or deploying.

    python validate_data.py            # exit 1 on any error

Checks properties.json structure and value sanity, the ``unknown_fields``
convention, coordinates, data.js synchronization, the snapshot summary, and
that index.html advertises the same snapshot date. Warnings never fail the run.
"""
import json
import os
import re
import sys
from datetime import date
from typing import Any, Dict, List, Tuple

from build_data_js import is_current
from datastore import (
    BASE_DIR, METRIC_FIELDS, PROPERTIES_FILE, WA_LAT_RANGE, WA_LNG_RANGE,
)

SNAPSHOT_FILE = os.path.join(BASE_DIR, "data", "listing_snapshot.json")
BROADBAND_FILE = os.path.join(BASE_DIR, "data", "fcc_wa_broadband_by_city.json")
INDEX_FILE = os.path.join(BASE_DIR, "index.html")

REQUIRED_TYPES: Dict[str, tuple] = {
    "id": (str,), "address": (str,), "city": (str,), "state": (str,), "zip": (str,),
    "price": (int,), "beds": (int,), "baths": (int, float), "sqft": (int,),
    "lot_sqft": (int,), "year_built": (int,), "hoa": (int,), "garage": (int,),
    "description": (str,), "url": (str,), "photos": (list,),
}


def _is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def check_listing(index: int, p: Any) -> Tuple[List[str], List[str]]:
    """Return (errors, warnings) for one listing record."""
    if not isinstance(p, dict):
        return [f"#{index}: record is not an object"], []
    label = f"#{index} {p.get('id', '?')}"
    errors: List[str] = []
    warnings: List[str] = []

    for field, types in REQUIRED_TYPES.items():
        if field not in p:
            errors.append(f"{label}: missing '{field}'")
        elif isinstance(p[field], bool) or not isinstance(p[field], types):
            errors.append(f"{label}: '{field}' has type {type(p[field]).__name__}")
    if errors:
        return errors, warnings

    if p["price"] <= 0:
        errors.append(f"{label}: non-positive price {p['price']}")
    if not re.match(r"https?://", p["url"]):
        errors.append(f"{label}: url is not http(s)")
    if not all(isinstance(u, str) and u.startswith(("http://", "https://")) for u in p["photos"]):
        errors.append(f"{label}: photos must be http(s) URL strings")
    if not p["photos"]:
        warnings.append(f"{label}: no photos")
    if p.get("rating", 0) not in range(0, 6):
        errors.append(f"{label}: rating outside 0-5")

    unknown = p.get("unknown_fields")
    if unknown is not None:
        if not isinstance(unknown, list) or not set(unknown) <= set(METRIC_FIELDS):
            errors.append(f"{label}: invalid unknown_fields {unknown!r}")
        else:
            for field in unknown:
                if p[field] != 0:
                    errors.append(f"{label}: '{field}' is flagged unknown but holds {p[field]}")

    lat, lng = p.get("latitude"), p.get("longitude")
    if (lat is None) != (lng is None):
        errors.append(f"{label}: latitude/longitude must be set together")
    elif lat is not None:
        if not (_is_number(lat) and _is_number(lng)
                and WA_LAT_RANGE[0] <= lat <= WA_LAT_RANGE[1]
                and WA_LNG_RANGE[0] <= lng <= WA_LNG_RANGE[1]):
            errors.append(f"{label}: coordinates ({lat}, {lng}) outside Washington")
    else:
        warnings.append(f"{label}: no coordinates (won't appear on the map)")
    return errors, warnings


def check_dataset(listings: List[Any]) -> Tuple[List[str], List[str]]:
    errors: List[str] = []
    warnings: List[str] = []
    seen_ids: Dict[str, int] = {}
    seen_urls: Dict[str, int] = {}
    for i, p in enumerate(listings):
        e, w = check_listing(i, p)
        errors += e
        warnings += w
        if isinstance(p, dict):
            if p.get("id") in seen_ids:
                errors.append(f"#{i}: duplicate id {p['id']} (also #{seen_ids[p['id']]})")
            seen_ids.setdefault(p.get("id"), i)
            if p.get("url") in seen_urls:
                errors.append(f"#{i}: duplicate url (also #{seen_urls[p['url']]})")
            seen_urls.setdefault(p.get("url"), i)
    return errors, warnings


def check_repository(listings: List[Any]) -> Tuple[List[str], List[str]]:
    """Cross-file consistency checks."""
    errors: List[str] = []
    warnings: List[str] = []

    if not is_current(listings):
        errors.append("data.js is out of date; run: python build_data_js.py")

    snapshot = None
    if os.path.exists(SNAPSHOT_FILE):
        with open(SNAPSHOT_FILE, "r", encoding="utf-8") as handle:
            snapshot = json.load(handle)
        if snapshot.get("listing_count") != len(listings):
            errors.append(f"listing_snapshot.json lists {snapshot.get('listing_count')} "
                          f"listings but properties.json has {len(listings)}")
        dates = {p.get("snapshot_date") for p in listings if isinstance(p, dict)}
        if dates != {snapshot.get("snapshot_date")}:
            warnings.append(f"listing snapshot_date values {sorted(map(str, dates))} differ "
                            f"from listing_snapshot.json ({snapshot.get('snapshot_date')})")
    else:
        warnings.append("data/listing_snapshot.json not found")

    if snapshot and os.path.exists(INDEX_FILE):
        with open(INDEX_FILE, "r", encoding="utf-8") as handle:
            html = handle.read()
        try:
            day = date.fromisoformat(snapshot["snapshot_date"])
        except (KeyError, ValueError):
            day = None
        if day:
            human = f"{day.strftime('%B')} {day.day}, {day.year}"
            if human not in html:
                errors.append(f"index.html does not mention the snapshot date '{human}'")
            stamp = day.strftime("%Y%m%d")
            stale = set(re.findall(r"\?v=(\d{8})", html)) - {stamp}
            if stale:
                errors.append(f"index.html cache-busting tokens {sorted(stale)} != {stamp}")

    if os.path.exists(BROADBAND_FILE):
        with open(BROADBAND_FILE, "r", encoding="utf-8") as handle:
            broadband = json.load(handle)
        missing = sorted({p["city"] for p in listings if isinstance(p, dict) and "city" in p
                          and p["city"].lower() not in broadband})
        if missing:
            warnings.append(f"no FCC broadband data for cities: {', '.join(missing)}")
    return errors, warnings


def main() -> int:
    try:
        with open(PROPERTIES_FILE, "r", encoding="utf-8") as handle:
            listings = json.load(handle)
    except (OSError, ValueError) as exc:
        print(f"ERROR: cannot read properties.json: {exc}", file=sys.stderr)
        return 1
    if not isinstance(listings, list):
        print("ERROR: properties.json must contain a JSON array", file=sys.stderr)
        return 1

    errors, warnings = check_dataset(listings)
    repo_errors, repo_warnings = check_repository(listings)
    errors += repo_errors
    warnings += repo_warnings

    for line in warnings[:20]:
        print(f"warning: {line}")
    if len(warnings) > 20:
        print(f"warning: ... and {len(warnings) - 20} more")
    for line in errors[:50]:
        print(f"ERROR: {line}", file=sys.stderr)
    if len(errors) > 50:
        print(f"ERROR: ... and {len(errors) - 50} more", file=sys.stderr)

    print(f"Checked {len(listings)} listings: {len(errors)} errors, {len(warnings)} warnings")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
