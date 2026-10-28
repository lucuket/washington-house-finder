"""Refresh the local snapshot using the permission-gated live scraper."""
import asyncio
import json
import os
import tempfile

from scraper_service import run_live_scraper

CRITERIA = {
    "location": "Washington", "price_min": 350000, "price_max": 500000,
    "sqft_min": 1200, "sqft_max": 2000, "beds_min": 2, "baths_min": 1,
    "year_built_min": 1980, "lot_size_min": 6500, "hoa_max": 50, "garage_min": 2,
}

async def refresh():
    listings = await run_live_scraper(CRITERIA, print, lambda _pct, message: print(message))
    if not listings:
        raise RuntimeError("No matching listings; existing properties.json was not changed.")
    base = os.path.dirname(os.path.abspath(__file__))
    name = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=base, delete=False) as out:
            name = out.name
            json.dump(listings, out, ensure_ascii=False, indent=2)
        os.replace(name, os.path.join(base, "properties.json"))
    finally:
        if name and os.path.exists(name):
            os.unlink(name)
    print(f"Saved {len(listings)} listings. Run build_data_js.py to update the fallback.")

if __name__ == "__main__":
    asyncio.run(refresh())
