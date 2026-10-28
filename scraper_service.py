import asyncio
import hashlib
import json
import logging
import os
import re
from typing import Any, Callable, Dict, List, Optional
import pandas as pd

# Safe import for homeharvest
try:
    from homeharvest import scrape_property
except ImportError:
    scrape_property = None

logger = logging.getLogger(__name__)

def get_val(row: pd.Series, keys: List[str], default: Any = 0) -> Any:
    """Helper to safely extract candidate column values from pandas row"""
    for k in keys:
        if k in row and pd.notna(row[k]):
            return row[k]
    return default

def clean_property_row(row: pd.Series, criteria: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Validates and cleans a raw HomeHarvest DataFrame row against strict criteria"""
    try:
        # 0. Strict Active For-Sale Status Check (reject SOLD, PENDING, CONTINGENT, CLOSED, OFF-MARKET)
        status_keys = ['status', 'mls_status', 'listing_status', 'status_text']
        raw_status = str(get_val(row, status_keys, "FOR_SALE")).upper().strip()
        if raw_status in ["SOLD", "CLOSED", "OFF_MARKET", "PENDING", "CONTINGENT", "NOT_FOR_SALE"]:
            return None
        if "SOLD" in raw_status or "CLOSED" in raw_status or "PENDING" in raw_status:
            return None

        # Check MLS status sub-field
        if 'mls_status' in row and pd.notna(row['mls_status']):
            mls_val = str(row['mls_status']).strip().lower()
            if mls_val in ['sold', 'closed', 'pending', 'under contract', 'contingent', 'off market']:
                return None

        price_keys = ['list_price', 'price', 'list_price_min', 'price_min']
        sqft_keys = ['sqft', 'building_size', 'sqft_min']
        beds_keys = ['beds', 'bedrooms', 'beds_min']
        baths_keys = ['full_baths', 'baths', 'bathrooms', 'baths_full', 'baths_min']
        year_keys = ['year_built', 'year_built_min']
        lot_keys = ['lot_sqft', 'lot_size', 'lot_size_min']
        hoa_keys = ['hoa_fee', 'hoa', 'hoa_fees']
        garage_keys = ['garage', 'parking_garage', 'garage_spaces', 'parking_spaces']

        # 1. Price check
        price = float(get_val(row, price_keys, 0))
        if price < criteria.get('price_min', 0) or price > criteria.get('price_max', float('inf')):
            return None

        # 2. Sqft check
        sqft = float(get_val(row, sqft_keys, 0))
        if sqft < criteria.get('sqft_min', 0) or sqft > criteria.get('sqft_max', float('inf')):
            return None

        # 3. Beds check
        beds = int(get_val(row, beds_keys, 0))
        if beds < criteria.get('beds_min', 0):
            return None

        # 4. Baths check
        baths = float(get_val(row, baths_keys, 0.0))
        if baths < criteria.get('baths_min', 0.0):
            return None

        # 5. Year built check
        year = int(get_val(row, year_keys, 0))
        if year < criteria.get('year_built_min', 0):
            return None

        # 6. Lot size check
        lot = float(get_val(row, lot_keys, 0))
        if lot < criteria.get('lot_size_min', 0):
            return None

        # 7. HOA fee check
        hoa = get_val(row, hoa_keys, None)
        # Unknown HOA is not evidence of a zero fee or a qualifying fee.
        if hoa is None:
            return None
        try:
            hoa_amount = float(hoa)
        except (TypeError, ValueError):
            return None
        if hoa_amount > criteria.get('hoa_max', float('inf')):
            return None

        # 8. Garage check & NLP extraction
        garage = get_val(row, garage_keys, None)
        desc = ""
        if 'description' in row and pd.notna(row['description']):
            desc += str(row['description']).lower()
        if 'text' in row and pd.notna(row['text']):
            desc += str(row['text']).lower()

        garage_amount = None
        if garage is not None:
            try:
                garage_amount = float(garage)
            except (TypeError, ValueError):
                pass
        # Description phrases establish a lower bound, not an exact count.
        if garage_amount is None and re.search(r'\b(?:2\s*-?\s*car|two\s*car|double\s*garage)\b', desc):
            garage_amount = 2
        if garage_amount is None and re.search(r'\b(?:3\s*-?\s*car|three\s*car|triple\s*garage)\b', desc):
            garage_amount = 3
        if garage_amount is None or garage_amount < criteria.get('garage_min', 2):
            return None

        # 9. Strict Property Type & Style Check: Single-Family Traditional Houses ONLY
        property_style = str(get_val(row, ['style', 'property_type', 'prop_type'], '')).lower()
        full_text = f"{property_style} {desc} {str(get_val(row, ['address', 'formatted_address'], '')).lower()}"
        if re.search(r'(mobile|manufactured|modular|trailer|park model|chattel|townhome|townhouse|town home|town house|row home|row house|townhouses|condo|condominium|apartment|apt\b|duplex|triplex|fourplex|multi-family|multifamily)', full_text):
            return None

        # Resolve Photos
        photos: List[str] = []
        if 'primary_photo' in row and pd.notna(row['primary_photo']):
            photos.append(str(row['primary_photo']))

        for p_key in ['alt_photos', 'photos']:
            if p_key in row and (isinstance(row[p_key], list) or pd.notna(row[p_key])):
                val = row[p_key]
                if isinstance(val, list):
                    photos.extend([str(x) for x in val])
                elif isinstance(val, str):
                    try:
                        photos.extend(json.loads(val.replace("'", '"')))
                    except Exception:
                        photos.extend([p.strip() for p in val.split(',') if p.strip()])

        # Deduplicate photos
        seen_photos = set()
        clean_photos = []
        for p in photos:
            if p and p not in seen_photos and str(p).startswith("http"):
                seen_photos.add(p)
                clean_photos.append(p)

        # Extract address details
        full_address = ""
        if 'street' in row and pd.notna(row['street']):
            full_address += str(row['street'])
        elif 'address' in row and pd.notna(row['address']):
            full_address += str(row['address'])
        else:
            full_address = "Address Available On Request"

        city = str(row['city']).title() if 'city' in row and pd.notna(row['city']) else "Washington"
        state = str(row['state']) if 'state' in row and pd.notna(row['state']) else "WA"
        zip_code = str(row['zip_code']) if 'zip_code' in row and pd.notna(row['zip_code']) else ""
        url = str(row['property_url']) if 'property_url' in row and pd.notna(row['property_url']) else f"https://www.realtor.com"

        # Coordinates
        lat, lng = None, None
        if 'latitude' in row and pd.notna(row['latitude']) and 'longitude' in row and pd.notna(row['longitude']):
            try:
                lat = float(row['latitude'])
                lng = float(row['longitude'])
            except ValueError:
                pass

        # Unique stable ID
        id_hash = hashlib.md5(f"{full_address}_{city}_{price}".encode()).hexdigest()[:12]

        return {
            "id": f"prop_{id_hash}",
            "address": full_address,
            "city": city,
            "state": state,
            "zip": zip_code,
            "price": int(price),
            "beds": int(beds),
            "baths": float(baths),
            "sqft": int(sqft),
            "lot_sqft": int(lot),
            "year_built": int(year),
            "hoa": int(hoa_amount),
            "garage": int(garage_amount),
            "description": str(row['description']) if 'description' in row and pd.notna(row['description']) else "",
            "url": url,
            "photos": clean_photos,
            "latitude": lat,
            "longitude": lng,
            "favorite": False,
            "rating": 0,
            "user_notes": ""
        }
    except Exception as e:
        logger.error(f"Error processing row: {e}")
        return None

async def run_live_scraper(
    criteria: Dict[str, Any],
    log_callback: Callable[[str], None],
    progress_callback: Callable[[int, str], None]
) -> List[Dict[str, Any]]:
    """Query the configured source only when its operator has granted access.

    HomeHarvest controls its own internal requests and retries; this wrapper
    cannot guarantee a request rate or prevent a block.
    """
    if os.environ.get("REALTOR_SCRAPING_AUTHORIZED") != "yes":
        raise RuntimeError(
            "Live refresh disabled: Realtor.com requires express written permission "
            "for automated access. Use an authorized feed or set "
            "REALTOR_SCRAPING_AUTHORIZED=yes only after obtaining permission."
        )

    location = criteria.get("location", "Washington")
    target_locations = [location]
    if location.lower() in ["washington", "wa", "all"]:
        target_locations = ["Spokane, WA", "Olympia, WA", "Vancouver, WA", "Tacoma, WA", "Kennewick, WA", "Bellingham, WA"]

    all_dfs: List[pd.DataFrame] = []
    if scrape_property is not None:
        loop = asyncio.get_running_loop()
        for idx, loc in enumerate(target_locations):
            log_callback(f"[{idx + 1}/{len(target_locations)}] Querying listings for {loc}...")
            try:
                df = await loop.run_in_executor(
                    None,
                    lambda loc=loc: scrape_property(location=loc, listing_type="for_sale", past_days=30,
                                                    parallel=False, extra_property_data=False, limit=200),
                )
                if df is not None and not df.empty:
                    all_dfs.append(df)
                    log_callback(f"Found {len(df)} listings in {loc}.")
                else:
                    log_callback(f"No listings returned for {loc}.")
            except Exception as exc:
                # Stop all collection on any upstream failure, including rate limits,
                # access denials, or challenges. Never retry or rotate identity here.
                raise RuntimeError(f"Stopped refresh after upstream error for {loc}: {exc}") from exc
            progress_callback(15 + int(((idx + 1) / len(target_locations)) * 55),
                              f"Queried {idx + 1}/{len(target_locations)} markets.")
            if idx < len(target_locations) - 1:
                await asyncio.sleep(10)
    else:
        raise RuntimeError("HomeHarvest is not installed; existing listings were retained.")

    if not all_dfs:
        log_callback("Search completed. Maintained existing dataset continuity.")
        return []

    combined = pd.concat(all_dfs, ignore_index=True)
    if 'property_url' in combined.columns:
        combined = combined.drop_duplicates(subset=['property_url'])

    progress_callback(75, f"Filtering {len(combined)} total properties against custom constraints...")
    log_callback(f"Evaluating {len(combined)} properties against filters: ${criteria.get('price_min'):,}-${criteria.get('price_max'):,}, {criteria.get('sqft_min')}-{criteria.get('sqft_max')} sqft, Garage {criteria.get('garage_min')}+, Lot {criteria.get('lot_size_min')}+ sqft")

    matched_properties: List[Dict[str, Any]] = []
    for _, row in combined.iterrows():
        cleaned = clean_property_row(row, criteria)
        if cleaned:
            matched_properties.append(cleaned)
            log_callback(f"[MATCH] {cleaned['address']}, {cleaned['city']} | ${cleaned['price']:,} | {cleaned['garage']} Garage | {len(cleaned['photos'])} Photos")

    progress_callback(95, f"Finalizing results: {len(matched_properties)} matching listings.")
    log_callback(f"Completed! {len(matched_properties)} properties meet all criteria.")
    return matched_properties
