import asyncio
import csv
import io
import json
import logging
import os
import sys
import threading
from typing import Any, Dict, List, Optional
import statistics

# Windows Proactor event loop policy
if sys.platform == "win32":
    try:
        asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
    except Exception:
        pass

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, StreamingResponse

from models import (
    FavoriteToggle,
    PropertyListing,
    PropertyNoteUpdate,
    ScrapeJobStatus,
    SearchCriteria,
)
from scraper_service import get_approx_coordinates, run_live_scraper

# Setup logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("washington-home-search")

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PROPERTIES_FILE = os.path.join(BASE_DIR, "properties.json")
INDEX_FILE = os.path.join(BASE_DIR, "index.html")

app = FastAPI(
    title="Washington Home Search API",
    description="REST API for Washington real estate discovery, mapping, comparison, and analysis.",
    version="2.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global in-memory property cache and thread safety lock
db_lock = threading.Lock()
properties_db: List[Dict[str, Any]] = []

# Global scraping status tracker
scraper_lock = threading.Lock()
scraper_state = ScrapeJobStatus()


def normalize_property(item: Dict[str, Any]) -> Dict[str, Any]:
    """Ensures each property dictionary adheres to strict model schema with ID & coordinates."""
    address = str(item.get("address", "Address Available On Request"))
    city = str(item.get("city", "Washington")).title()
    state = str(item.get("state", "WA"))
    zip_code = str(item.get("zip", ""))
    price = int(item.get("price", 0))

    prop_id = item.get("id")
    if not prop_id:
        import hashlib
        h = hashlib.md5(f"{address}_{city}_{price}".encode()).hexdigest()[:12]
        prop_id = f"prop_{h}"

    lat = item.get("latitude")
    lng = item.get("longitude")
    if lat is None or lng is None:
        lat, lng = get_approx_coordinates(city, address)

    # Clean photos list
    photos = item.get("photos", [])
    if isinstance(photos, str):
        try:
            photos = json.loads(photos.replace("'", '"'))
        except Exception:
            photos = [p.strip() for p in photos.split(",") if p.strip()]

    clean_photos = []
    seen = set()
    for p in photos:
        p_str = str(p).strip()
        if p_str and p_str not in seen and p_str.startswith("http"):
            seen.add(p_str)
            clean_photos.append(p_str)

    if not clean_photos:
        clean_photos = [
            "https://images.unsplash.com/photo-1570129477492-45c003edd2be?auto=format&fit=crop&w=1200&q=80",
            "https://images.unsplash.com/photo-1568605114967-8130f3a36994?auto=format&fit=crop&w=1200&q=80",
        ]

    return {
        "id": prop_id,
        "address": address,
        "city": city,
        "state": state,
        "zip": zip_code,
        "price": price,
        "beds": int(item.get("beds", 0)),
        "baths": float(item.get("baths", 0.0)),
        "sqft": int(item.get("sqft", 0)),
        "lot_sqft": int(item.get("lot_sqft", 0)),
        "year_built": int(item.get("year_built", 0)),
        "hoa": int(item.get("hoa", 0)),
        "garage": max(0, int(item.get("garage", 2))),
        "description": str(item.get("description", "Washington real estate listing")),
        "url": str(item.get("url", "https://www.realtor.com")),
        "photos": clean_photos,
        "latitude": lat,
        "longitude": lng,
        "favorite": bool(item.get("favorite", False)),
        "rating": int(item.get("rating", 0)),
        "user_notes": str(item.get("user_notes", "")),
    }


def load_properties_from_disk():
    """Loads and normalizes properties from properties.json."""
    global properties_db
    with db_lock:
        if os.path.exists(PROPERTIES_FILE):
            try:
                with open(PROPERTIES_FILE, "r", encoding="utf-8") as f:
                    raw_data = json.load(f)
                properties_db = [normalize_property(p) for p in raw_data if isinstance(p, dict)]
                logger.info(f"Loaded {len(properties_db)} properties from {PROPERTIES_FILE}")
            except Exception as e:
                logger.error(f"Failed to load properties.json: {e}")
                properties_db = []
        else:
            logger.warning(f"Properties file not found at {PROPERTIES_FILE}")
            properties_db = []


def save_properties_to_disk_unlocked():
    """Writes in-memory properties to properties.json (must be called within db_lock)."""
    try:
        with open(PROPERTIES_FILE, "w", encoding="utf-8") as f:
            json.dump(properties_db, f, indent=2)
        logger.info(f"Persisted {len(properties_db)} properties to {PROPERTIES_FILE}")
    except Exception as e:
        logger.error(f"Error saving to {PROPERTIES_FILE}: {e}")


def save_properties_to_disk():
    with db_lock:
        save_properties_to_disk_unlocked()


# Initialize database on module load
load_properties_from_disk()


# -----------------------------------------------------------------------------
# Static & HTML Routes
# -----------------------------------------------------------------------------

@app.get("/", response_class=HTMLResponse)
async def serve_root():
    if os.path.exists(INDEX_FILE):
        with open(INDEX_FILE, "r", encoding="utf-8") as f:
            return HTMLResponse(content=f.read())
    return HTMLResponse(content="<h1>Washington Home Search index.html not found!</h1>", status_code=404)


@app.get("/styles.css")
async def serve_styles():
    css_path = os.path.join(BASE_DIR, "styles.css")
    if os.path.exists(css_path):
        return FileResponse(css_path, media_type="text/css")
    raise HTTPException(status_code=404, detail="styles.css not found")


@app.get("/app.js")
async def serve_js():
    js_path = os.path.join(BASE_DIR, "app.js")
    if os.path.exists(js_path):
        return FileResponse(js_path, media_type="application/javascript")
    raise HTTPException(status_code=404, detail="app.js not found")


@app.get("/properties.json")
async def serve_raw_properties():
    with db_lock:
        return JSONResponse(properties_db)


# -----------------------------------------------------------------------------
# Property Search & Filter Endpoints
# -----------------------------------------------------------------------------

@app.get("/api/properties", response_model=List[PropertyListing])
async def get_properties(
    city: Optional[str] = None,
    min_price: Optional[int] = None,
    max_price: Optional[int] = None,
    min_beds: Optional[int] = None,
    min_baths: Optional[float] = None,
    min_sqft: Optional[int] = None,
    max_sqft: Optional[int] = None,
    min_lot: Optional[int] = None,
    min_garage: Optional[int] = None,
    min_year: Optional[int] = None,
    max_hoa: Optional[int] = None,
    min_rating: Optional[int] = None,
    favorites_only: bool = False,
    search: Optional[str] = None,
    sort_by: str = "default",
):
    """Returns filtered and sorted property listings with full metadata."""
    with db_lock:
        results = list(properties_db)

    # Filter by City
    if city and city.lower() != "all":
        target_city = city.strip().lower()
        results = [p for p in results if p["city"].lower() == target_city]

    # Filter by Price Range
    if min_price is not None:
        results = [p for p in results if p["price"] >= min_price]
    if max_price is not None:
        results = [p for p in results if p["price"] <= max_price]

    # Filter by Beds & Baths
    if min_beds is not None:
        results = [p for p in results if p["beds"] >= min_beds]
    if min_baths is not None:
        results = [p for p in results if p["baths"] >= min_baths]

    # Filter by Sqft Range
    if min_sqft is not None:
        results = [p for p in results if p["sqft"] >= min_sqft]
    if max_sqft is not None:
        results = [p for p in results if p["sqft"] <= max_sqft]

    # Filter by Lot Size
    if min_lot is not None:
        results = [p for p in results if p["lot_sqft"] >= min_lot]

    # Filter by Garage
    if min_garage is not None:
        results = [p for p in results if p["garage"] >= min_garage]

    # Filter by Year Built
    if min_year is not None:
        results = [p for p in results if p["year_built"] >= min_year]

    # Filter by HOA
    if max_hoa is not None:
        results = [p for p in results if p["hoa"] <= max_hoa]

    # Filter by Star Rating
    if min_rating is not None and min_rating > 0:
        results = [p for p in results if p["rating"] >= min_rating]

    # Filter by Favorites
    if favorites_only:
        results = [p for p in results if p.get("favorite", False)]

    # Keyword Search
    if search and search.strip():
        q = search.strip().lower()
        results = [
            p
            for p in results
            if q in p["address"].lower()
            or q in p["city"].lower()
            or q in p["zip"].lower()
            or q in p["description"].lower()
            or q in p.get("user_notes", "").lower()
        ]

    # Sorting
    if sort_by == "price_asc":
        results.sort(key=lambda x: x["price"])
    elif sort_by == "price_desc":
        results.sort(key=lambda x: x["price"], reverse=True)
    elif sort_by == "sqft_desc":
        results.sort(key=lambda x: x["sqft"], reverse=True)
    elif sort_by == "lot_desc":
        results.sort(key=lambda x: x["lot_sqft"], reverse=True)
    elif sort_by == "year_desc":
        results.sort(key=lambda x: x["year_built"], reverse=True)
    elif sort_by == "rating_desc":
        results.sort(key=lambda x: x["rating"], reverse=True)
    elif sort_by == "price_per_sqft_asc":
        results.sort(key=lambda x: (x["price"] / max(1, x["sqft"])))

    return results


@app.get("/api/properties/{property_id}", response_model=PropertyListing)
async def get_property_by_id(property_id: str):
    """Retrieve details for a single property by its ID."""
    with db_lock:
        for p in properties_db:
            if p["id"] == property_id:
                return p
    raise HTTPException(status_code=404, detail="Property listing not found")


@app.patch("/api/properties/{property_id}/note", response_model=PropertyListing)
async def update_property_note(property_id: str, note_data: PropertyNoteUpdate):
    """Updates user notes, star rating, and/or favorite status for a listing and persists to disk."""
    with db_lock:
        for p in properties_db:
            if p["id"] == property_id:
                if note_data.rating is not None:
                    p["rating"] = note_data.rating
                if note_data.user_notes is not None:
                    p["user_notes"] = note_data.user_notes
                if note_data.favorite is not None:
                    p["favorite"] = note_data.favorite
                
                save_properties_to_disk_unlocked()
                return p
                
    raise HTTPException(status_code=404, detail="Property not found")


@app.post("/api/properties/{property_id}/favorite", response_model=PropertyListing)
async def toggle_property_favorite(property_id: str, toggle_data: Optional[FavoriteToggle] = None):
    """Toggles or sets the favorite status of a property and persists to disk."""
    with db_lock:
        for p in properties_db:
            if p["id"] == property_id:
                if toggle_data is not None:
                    p["favorite"] = toggle_data.favorite
                else:
                    p["favorite"] = not p.get("favorite", False)
                
                save_properties_to_disk_unlocked()
                return p
                
    raise HTTPException(status_code=404, detail="Property not found")


# -----------------------------------------------------------------------------
# Analytics & Stats Endpoint (Supports live filtered queries)
# -----------------------------------------------------------------------------

@app.get("/api/stats")
async def get_properties_stats(
    city: Optional[str] = None,
    min_price: Optional[int] = None,
    max_price: Optional[int] = None,
    min_beds: Optional[int] = None,
    min_baths: Optional[float] = None,
    min_sqft: Optional[int] = None,
    max_sqft: Optional[int] = None,
    min_lot: Optional[int] = None,
    min_garage: Optional[int] = None,
    min_year: Optional[int] = None,
    max_hoa: Optional[int] = None,
    min_rating: Optional[int] = None,
    favorites_only: bool = False,
    search: Optional[str] = None,
):
    """Provides aggregated market analytics across all or filtered Washington listings."""
    listings = await get_properties(
        city=city,
        min_price=min_price,
        max_price=max_price,
        min_beds=min_beds,
        min_baths=min_baths,
        min_sqft=min_sqft,
        max_sqft=max_sqft,
        min_lot=min_lot,
        min_garage=min_garage,
        min_year=min_year,
        max_hoa=max_hoa,
        min_rating=min_rating,
        favorites_only=favorites_only,
        search=search,
    )

    total = len(listings)
    if total == 0:
        return {
            "total_listings": 0,
            "favorites_count": 0,
            "rated_count": 0,
            "avg_price": 0,
            "median_price": 0,
            "min_price": 0,
            "max_price": 0,
            "avg_sqft": 0,
            "median_sqft": 0,
            "avg_price_per_sqft": 0,
            "median_price_per_sqft": 0,
            "avg_lot_sqft": 0,
            "median_lot_sqft": 0,
            "city_counts": {},
            "price_ranges": {},
            "garage_distribution": {},
            "year_built_distribution": {},
        }

    prices = [p.price for p in listings]
    sqfts = [p.sqft for p in listings if p.sqft > 0]
    lots = [p.lot_sqft for p in listings if p.lot_sqft > 0]
    prices_per_sqft = [p.price / p.sqft for p in listings if p.sqft > 0]

    avg_price = int(statistics.mean(prices))
    median_price = int(statistics.median(prices))
    min_price = min(prices)
    max_price = max(prices)
    avg_sqft = int(statistics.mean(sqfts)) if sqfts else 0
    median_sqft = int(statistics.median(sqfts)) if sqfts else 0
    avg_lot_sqft = int(statistics.mean(lots)) if lots else 0
    median_lot_sqft = int(statistics.median(lots)) if lots else 0
    avg_ppsqft = int(statistics.mean(prices_per_sqft)) if prices_per_sqft else 0
    median_ppsqft = int(statistics.median(prices_per_sqft)) if prices_per_sqft else 0

    favorites_count = sum(1 for p in listings if p.favorite)
    rated_count = sum(1 for p in listings if p.rating > 0)

    # City counts
    city_counts: Dict[str, int] = {}
    for p in listings:
        c = p.city or "Other"
        city_counts[c] = city_counts.get(c, 0) + 1

    # Price bracket distribution
    price_ranges = {
        "< $375k": sum(1 for p in prices if p < 375000),
        "$375k - $400k": sum(1 for p in prices if 375000 <= p < 400000),
        "$400k - $425k": sum(1 for p in prices if 400000 <= p < 425000),
        "$425k - $450k": sum(1 for p in prices if 425000 <= p < 450000),
        "$450k - $475k": sum(1 for p in prices if 450000 <= p < 475000),
        "$475k+": sum(1 for p in prices if p >= 475000),
    }

    # Garage distribution
    garage_dist: Dict[str, int] = {}
    for p in listings:
        g = f"{p.garage} Car" if p.garage > 0 else "No Garage"
        garage_dist[g] = garage_dist.get(g, 0) + 1

    # Year built distribution
    year_dist = {
        "Pre-1980": sum(1 for p in listings if p.year_built < 1980 and p.year_built > 0),
        "1980 - 1999": sum(1 for p in listings if 1980 <= p.year_built < 2000),
        "2000 - 2015": sum(1 for p in listings if 2000 <= p.year_built < 2016),
        "2016+": sum(1 for p in listings if p.year_built >= 2016),
    }

    return {
        "total_listings": total,
        "favorites_count": favorites_count,
        "rated_count": rated_count,
        "avg_price": avg_price,
        "median_price": median_price,
        "min_price": min_price,
        "max_price": max_price,
        "avg_sqft": avg_sqft,
        "median_sqft": median_sqft,
        "avg_lot_sqft": avg_lot_sqft,
        "median_lot_sqft": median_lot_sqft,
        "avg_price_per_sqft": avg_ppsqft,
        "median_price_per_sqft": median_ppsqft,
        "city_counts": dict(sorted(city_counts.items(), key=lambda item: item[1], reverse=True)),
        "price_ranges": price_ranges,
        "garage_distribution": garage_dist,
        "year_built_distribution": year_dist,
    }


# -----------------------------------------------------------------------------
# CSV Export Endpoint
# -----------------------------------------------------------------------------

@app.get("/api/export/csv")
async def export_properties_csv(
    city: Optional[str] = None,
    min_price: Optional[int] = None,
    max_price: Optional[int] = None,
    min_beds: Optional[int] = None,
    min_baths: Optional[float] = None,
    min_sqft: Optional[int] = None,
    max_sqft: Optional[int] = None,
    min_lot: Optional[int] = None,
    min_garage: Optional[int] = None,
    min_year: Optional[int] = None,
    max_hoa: Optional[int] = None,
    min_rating: Optional[int] = None,
    favorites_only: bool = False,
    search: Optional[str] = None,
):
    """Exports matched listings to an Excel/Google Sheets compatible CSV file."""
    filtered_listings = await get_properties(
        city=city,
        min_price=min_price,
        max_price=max_price,
        min_beds=min_beds,
        min_baths=min_baths,
        min_sqft=min_sqft,
        max_sqft=max_sqft,
        min_lot=min_lot,
        min_garage=min_garage,
        min_year=min_year,
        max_hoa=max_hoa,
        min_rating=min_rating,
        favorites_only=favorites_only,
        search=search,
    )

    output = io.StringIO()
    writer = csv.writer(output, quoting=csv.QUOTE_MINIMAL)

    writer.writerow([
        "Property ID",
        "Address",
        "City",
        "State",
        "Zip Code",
        "Price ($)",
        "Bedrooms",
        "Bathrooms",
        "Living SqFt",
        "Lot Size (sqft)",
        "Lot Size (acres)",
        "Price/SqFt ($)",
        "Year Built",
        "HOA Monthly ($)",
        "Garage Spaces",
        "User Rating (0-5)",
        "Favorite",
        "User Notes",
        "Latitude",
        "Longitude",
        "Listing URL",
    ])

    for p in filtered_listings:
        ppsqft = round(p.price / max(1, p.sqft), 2)
        lot_acres = round(p.lot_sqft / 43560, 3)
        writer.writerow([
            p.id,
            p.address,
            p.city,
            p.state,
            p.zip,
            p.price,
            p.beds,
            p.baths,
            p.sqft,
            p.lot_sqft,
            lot_acres,
            ppsqft,
            p.year_built,
            p.hoa,
            p.garage,
            p.rating,
            "Yes" if p.favorite else "No",
            str(p.user_notes).replace("\n", " ").replace("\r", ""),
            p.latitude,
            p.longitude,
            p.url,
        ])

    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="washington_properties_export.csv"'},
    )


# -----------------------------------------------------------------------------
# Live Scraper Execution & Progress Tracking
# -----------------------------------------------------------------------------

def append_scraper_log(msg: str):
    logger.info(f"[Scraper] {msg}")
    with scraper_lock:
        scraper_state.logs.append(msg)
        scraper_state.message = msg
        if len(scraper_state.logs) > 200:
            scraper_state.logs = scraper_state.logs[-200:]


def update_scraper_progress(prog: int, message: str):
    with scraper_lock:
        scraper_state.progress = prog
        scraper_state.message = message


async def run_scraper_background(criteria_dict: Dict[str, Any]):
    """Background task running live HomeHarvest scraper and updating in-memory DB."""
    global properties_db
    with scraper_lock:
        scraper_state.is_active = True
        scraper_state.progress = 5
        scraper_state.message = "Initializing live scraper..."
        scraper_state.logs = []
        scraper_state.discovered_count = 0
        scraper_state.processed_count = 0
        scraper_state.matched_count = 0

    try:
        new_matched = await run_live_scraper(
            criteria=criteria_dict,
            log_callback=append_scraper_log,
            progress_callback=update_scraper_progress,
        )

        with scraper_lock:
            scraper_state.matched_count = len(new_matched)

        if new_matched:
            with db_lock:
                existing_map = {p["url"]: p for p in properties_db}
                for n in new_matched:
                    normalized = normalize_property(n)
                    if normalized["url"] in existing_map:
                        old = existing_map[normalized["url"]]
                        normalized["rating"] = old.get("rating", 0)
                        normalized["user_notes"] = old.get("user_notes", "")
                        normalized["favorite"] = old.get("favorite", False)
                        existing_map[normalized["url"]] = normalized
                    else:
                        existing_map[normalized["url"]] = normalized

                properties_db = list(existing_map.values())
                save_properties_to_disk_unlocked()

            append_scraper_log(f"Merged {len(new_matched)} listings into database. Total active: {len(properties_db)}")

        with scraper_lock:
            scraper_state.progress = 100
            scraper_state.message = f"Scan complete! {len(new_matched)} properties processed."
    except Exception as e:
        logger.error(f"Live scraper error: {e}")
        append_scraper_log(f"Error occurred during scraping: {e}")
        with scraper_lock:
            scraper_state.progress = 100
            scraper_state.message = f"Scraper error: {e}"
    finally:
        with scraper_lock:
            scraper_state.is_active = False


@app.post("/api/search")
async def start_search(criteria: SearchCriteria):
    """Starts live scraping job in background."""
    with scraper_lock:
        if scraper_state.is_active:
            raise HTTPException(status_code=400, detail="A scraping job is already running.")

    def run_worker():
        if sys.platform == "win32":
            asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            loop.run_until_complete(run_scraper_background(criteria.model_dump()))
        finally:
            loop.close()

    thread = threading.Thread(target=run_worker, daemon=True)
    thread.start()

    return {"status": "Live scraping job started successfully in background."}


@app.get("/api/status", response_model=ScrapeJobStatus)
async def get_scrape_status():
    """Returns current scraping job status and console logs."""
    with scraper_lock:
        return scraper_state


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    host = os.environ.get("HOST", "0.0.0.0")
    logger.info(f"Starting Washington Home Search server on {host}:{port}")
    uvicorn.run("app:app", host=host, port=port, reload=False)
