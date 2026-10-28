"""Permission-gated live listing collection and row cleaning.

``run_live_scraper`` queries HomeHarvest (Realtor.com) market by market and
returns listings that satisfy the supplied criteria. It is disabled unless
``REALTOR_SCRAPING_AUTHORIZED=yes`` is set; see the README for why.

``pandas`` and ``homeharvest`` are imported lazily so the API server, the
validator, and the tests run without them. Row cleaning accepts any
mapping-like row (a ``pandas.Series`` or a plain ``dict``).
"""
from __future__ import annotations

import asyncio
import logging
import math
import os
import re
from collections import Counter
from datetime import date
from typing import Any, Callable, Dict, List, Mapping, Optional, Sequence, Tuple

from datastore import clean_photos, stable_listing_id, to_float, to_int
from models import SearchCriteria

logger = logging.getLogger(__name__)

AUTHORIZATION_ENV = "REALTOR_SCRAPING_AUTHORIZED"
SOURCE_LABEL = "Realtor.com via HomeHarvest"

# Markets queried when the location is the whole state.
DEFAULT_MARKETS = [
    "Spokane, WA", "Olympia, WA", "Vancouver, WA",
    "Tacoma, WA", "Kennewick, WA", "Bellingham, WA",
]
STATEWIDE_ALIASES = {"washington", "wa", "all"}

PAST_DAYS = 30
RESULT_LIMIT_PER_MARKET = 200
MARKET_DELAY_SECONDS = 10

INACTIVE_STATUSES = {
    "SOLD", "CLOSED", "OFF_MARKET", "PENDING", "CONTINGENT", "NOT_FOR_SALE",
    "UNDER CONTRACT", "OFF MARKET",
}
INACTIVE_STATUS_FRAGMENTS = ("SOLD", "CLOSED", "PENDING", "CONTINGENT", "UNDER CONTRACT")

# ``style`` / property-type text that is never a traditional single-family house.
NON_HOUSE_STYLE = re.compile(
    r"mobile|manufactured|modular|trailer|park model|chattel|townhome|townhouse|town home|"
    r"town house|row home|row house|condo|apartment|\bapt\b|duplex|triplex|fourplex|"
    r"multi-?family|co-?op\b",
    re.IGNORECASE,
)
# Narrower description check: only phrases that describe the dwelling itself.
NON_HOUSE_DESCRIPTION = re.compile(
    r"\b(?:this|the)\s+(?:is\s+an?\s+)?(?:mobile|manufactured|modular)\s+home\b|"
    r"\bpark model\b|\bchattel\b|\bduplex\b|\btriplex\b|\bfourplex\b",
    re.IGNORECASE,
)

_NUMBER_WORDS = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5}
_GARAGE_PHRASE = re.compile(
    r"\b(\d|one|two|three|four|five)[\s-]*car(?:[\s-]+(?:attached|detached|oversized|tandem))?"
    r"[\s-]+garage\b|\b(double|triple)\s+garage\b|\b(\d|one|two|three|four|five)[\s-]*car\b",
    re.IGNORECASE,
)


class ScrapeError(RuntimeError):
    """Raised when collection must stop; existing data is left untouched."""


def scraping_authorized() -> bool:
    return os.environ.get(AUTHORIZATION_ENV) == "yes"


def _is_missing(value: Any) -> bool:
    if value is None:
        return True
    if isinstance(value, float):
        return math.isnan(value)
    return type(value).__name__ in ("NAType", "NaTType")


def get_val(row: Mapping[str, Any], keys: Sequence[str], default: Any = 0) -> Any:
    """First non-missing value among candidate column names."""
    for key in keys:
        if key in row:
            value = row[key]
            if not _is_missing(value):
                return value
    return default


def garage_from_text(text: str) -> Optional[int]:
    """Lower bound on garage spaces implied by listing prose, if any."""
    best: Optional[int] = None
    for match in _GARAGE_PHRASE.finditer(text):
        token = next((g for g in match.groups() if g), "").lower()
        count = {"double": 2, "triple": 3}.get(token) or _NUMBER_WORDS.get(token) or (
            int(token) if token.isdigit() else None)
        if count:
            best = max(best or 0, count)
    return best


def _status_reject(row: Mapping[str, Any]) -> bool:
    for key in ("status", "mls_status", "listing_status", "status_text"):
        value = get_val(row, [key], None)
        if value is None:
            continue
        text = str(value).upper().strip()
        if text in INACTIVE_STATUSES or any(f in text for f in INACTIVE_STATUS_FRAGMENTS):
            return True
    return False


def _baths(row: Mapping[str, Any]) -> float:
    """Full baths plus half baths counted as 0.5 (falls back to a total column)."""
    full = get_val(row, ["full_baths", "baths_full"], None)
    if full is not None:
        half = get_val(row, ["half_baths", "baths_half"], 0)
        return to_float(full) + 0.5 * to_float(half)
    return to_float(get_val(row, ["baths", "bathrooms", "baths_min"], 0.0))


def evaluate_row(row: Mapping[str, Any], criteria: Mapping[str, Any],
                 snapshot_date: Optional[str] = None) -> Tuple[Optional[Dict[str, Any]], str]:
    """Validate a raw listing row against ``criteria``.

    Returns ``(listing, "")`` on a match or ``(None, reason)`` on rejection.
    Unknown HOA or garage values are rejected: absence of data is not evidence
    that a listing meets a cap or minimum.
    """
    if _status_reject(row):
        return None, "not_active"

    price = to_float(get_val(row, ["list_price", "price", "list_price_min", "price_min"], 0))
    if price <= 0 or not criteria.get("price_min", 0) <= price <= criteria.get("price_max", math.inf):
        return None, "price"

    sqft = to_float(get_val(row, ["sqft", "building_size", "sqft_min"], 0))
    if not criteria.get("sqft_min", 0) <= sqft <= criteria.get("sqft_max", math.inf):
        return None, "sqft"

    beds = to_int(get_val(row, ["beds", "bedrooms", "beds_min"], 0))
    if beds < criteria.get("beds_min", 0):
        return None, "beds"

    baths = _baths(row)
    if baths < criteria.get("baths_min", 0.0):
        return None, "baths"

    year = to_int(get_val(row, ["year_built", "year_built_min"], 0))
    if year < criteria.get("year_built_min", 0):
        return None, "year_built"

    lot = to_float(get_val(row, ["lot_sqft", "lot_size", "lot_size_min"], 0))
    if lot < criteria.get("lot_size_min", 0):
        return None, "lot_size"

    hoa_raw = get_val(row, ["hoa_fee", "hoa", "hoa_fees"], None)
    hoa = None if hoa_raw is None else to_float(hoa_raw, float("nan"))
    if hoa is None or math.isnan(hoa):
        return None, "hoa_unknown"
    if hoa > criteria.get("hoa_max", math.inf):
        return None, "hoa"

    description = str(get_val(row, ["description", "text"], ""))
    garage_raw = get_val(row, ["garage", "parking_garage", "garage_spaces", "parking_spaces"], None)
    garage = None if garage_raw is None else to_float(garage_raw, float("nan"))
    if garage is None or math.isnan(garage):
        # Description phrases establish a lower bound, not an exact count.
        garage = garage_from_text(description.lower())
    if garage is None or garage < criteria.get("garage_min", 2):
        return None, "garage"

    style = str(get_val(row, ["style", "property_type", "prop_type"], ""))
    street = str(get_val(row, ["street", "address", "formatted_address"], ""))
    if (NON_HOUSE_STYLE.search(style) or NON_HOUSE_DESCRIPTION.search(description)
            or re.search(r"\b(?:apt|unit|ste)\b|#\s*\w", street, re.IGNORECASE)):
        return None, "property_type"

    url = str(get_val(row, ["property_url"], "")).strip()
    if not url:
        return None, "missing_url"  # Cannot be linked back to its source.

    photos: List[str] = []
    primary = get_val(row, ["primary_photo"], None)
    if primary is not None:
        photos.append(str(primary))
    for key in ("alt_photos", "photos"):
        value = row[key] if key in row else None
        if isinstance(value, (list, tuple)) or (value is not None and not _is_missing(value)):
            photos.extend(clean_photos(value) if not isinstance(value, (list, tuple))
                          else [str(x) for x in value])

    address = str(get_val(row, ["street", "address"], "")) or "Address Available On Request"
    city = str(get_val(row, ["city"], "Washington")).title()
    price_int = int(price)

    lat = to_float(get_val(row, ["latitude"], None), float("nan"))
    lng = to_float(get_val(row, ["longitude"], None), float("nan"))
    has_coords = not (math.isnan(lat) or math.isnan(lng))

    listing: Dict[str, Any] = {
        "id": stable_listing_id(address, city, price_int),
        "address": address,
        "city": city,
        "state": str(get_val(row, ["state"], "WA")),
        "zip": str(get_val(row, ["zip_code"], "")),
        "price": price_int,
        "beds": beds,
        "baths": baths,
        "sqft": int(sqft),
        "lot_sqft": int(lot),
        "year_built": year,
        "hoa": int(hoa),
        "garage": int(garage),
        "unknown_fields": [],
        "description": description,
        "url": url,
        "photos": clean_photos(photos),
        "latitude": lat if has_coords else None,
        "longitude": lng if has_coords else None,
        "favorite": False,
        "rating": 0,
        "user_notes": "",
        "source": SOURCE_LABEL,
        "source_property_id": str(get_val(row, ["property_id"], "")),
        "source_listing_id": str(get_val(row, ["listing_id"], "")),
        "status": str(get_val(row, ["status"], "FOR_SALE")),
        "mls_status": str(get_val(row, ["mls_status"], "")),
        "snapshot_date": snapshot_date or date.today().isoformat(),
    }
    # Strict checks above guarantee every metric is reported, so
    # ``unknown_fields`` stays empty for scraped listings.
    return listing, ""


def clean_property_row(row: Mapping[str, Any], criteria: Mapping[str, Any]) -> Optional[Dict[str, Any]]:
    """Return the cleaned listing for ``row`` or ``None`` if it is rejected."""
    try:
        listing, _ = evaluate_row(row, criteria)
        return listing
    except Exception as exc:  # A single bad row must not abort a refresh.
        logger.warning("Skipping unprocessable row: %s", exc)
        return None


def resolve_markets(location: str) -> List[str]:
    location = (location or "Washington").strip()
    return list(DEFAULT_MARKETS) if location.lower() in STATEWIDE_ALIASES else [location]


async def run_live_scraper(
    criteria: Dict[str, Any],
    log_callback: Callable[[str], None],
    progress_callback: Callable[[int, str], None],
    markets: Optional[Sequence[str]] = None,
    delay_seconds: float = MARKET_DELAY_SECONDS,
) -> List[Dict[str, Any]]:
    """Query the configured source only when its operator has granted access.

    HomeHarvest controls its own internal requests and retries; this wrapper
    cannot guarantee a request rate or prevent a block. Collection stops on the
    first upstream error and never retries or rotates identity.
    """
    if not scraping_authorized():
        raise ScrapeError(
            "Live refresh disabled: Realtor.com requires express written permission "
            "for automated access. Use an authorized feed or set "
            f"{AUTHORIZATION_ENV}=yes only after obtaining permission."
        )
    try:
        import pandas as pd
        from homeharvest import scrape_property
    except ImportError as exc:
        raise ScrapeError(f"Scraper dependencies missing ({exc}); existing listings were retained.") from exc

    criteria = {**SearchCriteria().model_dump(), **criteria}
    targets = list(markets) if markets else resolve_markets(criteria["location"])
    loop = asyncio.get_running_loop()

    frames = []
    for idx, market in enumerate(targets):
        log_callback(f"[{idx + 1}/{len(targets)}] Querying listings for {market}...")
        try:
            frame = await loop.run_in_executor(
                None,
                lambda market=market: scrape_property(
                    location=market, listing_type="for_sale", property_type=["single_family"],
                    exclude_pending=True, past_days=PAST_DAYS, parallel=False,
                    extra_property_data=False, limit=RESULT_LIMIT_PER_MARKET,
                    price_min=criteria["price_min"], price_max=criteria["price_max"],
                    sqft_min=criteria["sqft_min"], sqft_max=criteria["sqft_max"],
                ),
            )
        except Exception as exc:
            # Stop all collection on any upstream failure, including rate limits,
            # access denials, or challenges.
            raise ScrapeError(f"Stopped refresh after upstream error for {market}: {exc}") from exc
        if frame is not None and not frame.empty:
            frames.append(frame)
            log_callback(f"Found {len(frame)} listings in {market}.")
        else:
            log_callback(f"No listings returned for {market}.")
        progress_callback(15 + int(((idx + 1) / len(targets)) * 55),
                          f"Queried {idx + 1}/{len(targets)} markets.")
        if idx < len(targets) - 1:
            await asyncio.sleep(delay_seconds)

    if not frames:
        log_callback("Search completed with no results; existing dataset retained.")
        return []

    combined = pd.concat(frames, ignore_index=True)
    if "property_url" in combined.columns:
        combined = combined.drop_duplicates(subset=["property_url"])

    progress_callback(75, f"Filtering {len(combined)} properties against criteria...")
    log_callback(
        f"Evaluating {len(combined)} properties: ${criteria['price_min']:,}-${criteria['price_max']:,}, "
        f"{criteria['sqft_min']}-{criteria['sqft_max']} sqft, garage {criteria['garage_min']}+, "
        f"lot {criteria['lot_size_min']}+ sqft, HOA <= ${criteria['hoa_max']}"
    )

    matched: List[Dict[str, Any]] = []
    rejected: Counter = Counter()
    today = date.today().isoformat()
    for row in combined.to_dict("records"):
        try:
            listing, reason = evaluate_row(row, criteria, snapshot_date=today)
        except Exception as exc:
            listing, reason = None, "error"
            logger.warning("Skipping unprocessable row: %s", exc)
        if listing:
            matched.append(listing)
            log_callback(f"[MATCH] {listing['address']}, {listing['city']} | ${listing['price']:,} | "
                         f"{listing['garage']} Garage | {len(listing['photos'])} Photos")
        else:
            rejected[reason] += 1

    if rejected:
        detail = ", ".join(f"{k}={v}" for k, v in rejected.most_common())
        log_callback(f"Rejected {sum(rejected.values())} listings ({detail}).")
    progress_callback(95, f"Finalizing results: {len(matched)} matching listings.")
    log_callback(f"Completed! {len(matched)} properties meet all criteria.")
    return matched
