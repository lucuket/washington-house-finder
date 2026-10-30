"""Washington Home Search - local backend.

The public site is a static GitHub Pages deploy; this FastAPI app is the
local-development / private-tunnel backend. It serves the same static files
plus a small JSON API for filtering, analytics, CSV export, personal research
(favorites, ratings, notes), and the permission-gated live refresh.

Environment:
    HOST / PORT            Bind address (default 127.0.0.1:8000).
    WHS_READ_ONLY=1        Reject every write (notes, favorites, refresh); use
                           this whenever the server is exposed publicly.
    REALTOR_SCRAPING_AUTHORIZED=yes
                           Required for live refresh; see README.
"""
from __future__ import annotations

import asyncio
import gzip
import hashlib
import json
import logging
import os
import re
import threading
from contextlib import asynccontextmanager
from typing import Any, Dict, Optional

from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, Response

from analytics import ListingFilter, apply_filters, compute_stats, listings_to_csv, sort_listings
from build_data_js import render_data_js
from datastore import BASE_DIR, DATA_JS_FILE, USER_DEFAULTS, PropertyStore, atomic_write_text
from models import (
    FavoriteToggle,
    PropertyListing,
    PropertyNoteUpdate,
    ScrapeJobStatus,
    SearchCriteria,
)
from scraper_service import ScrapeError, run_live_scraper, scraping_authorized

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("washington-home-search")

APP_VERSION = "3.0.0"
INDEX_FILE = os.path.join(BASE_DIR, "index.html")

# Files the browser may request from the project root. Anything else is a 404,
# so listing data and source files are never exposed by accident.
STATIC_FILES: Dict[str, tuple] = {
    "/favicon.svg": ("favicon.svg", "image/svg+xml"),
    "/theme.css": ("theme.css", "text/css"),
    "/styles.css": ("styles.css", "text/css"),
    "/app.js": ("app.js", "application/javascript"),
    "/data.js": ("data.js", "application/javascript"),
    "/data/fcc_wa_broadband_by_city.json": (
        os.path.join("data", "fcc_wa_broadband_by_city.json"), "application/json"),
    "/data/ispmap_top_deals.json": (
        os.path.join("data", "ispmap_top_deals.json"), "application/json"),
    "/data/listing_snapshot.json": (
        os.path.join("data", "listing_snapshot.json"), "application/json"),
}


def read_only() -> bool:
    return os.environ.get("WHS_READ_ONLY") == "1"


def require_writable() -> None:
    if read_only():
        raise HTTPException(status_code=403, detail="Server is in read-only mode.")


def public_listing(listing: Dict[str, Any]) -> Dict[str, Any]:
    """Public/read-only deployments must not publish personal research."""
    return {**listing, **USER_DEFAULTS} if read_only() else listing


def query_listings():
    listings = store.all()
    return [{**listing, **USER_DEFAULTS} for listing in listings] if read_only() else listings


store = PropertyStore()


class ScrapeJobTracker:
    """Thread-safe progress and log state for the single live-refresh job."""

    MAX_LOGS = 200

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._state = ScrapeJobStatus()

    def try_start(self) -> bool:
        """Atomically claim the job slot; ``False`` if one is already running."""
        with self._lock:
            if self._state.is_active:
                return False
            self._state = ScrapeJobStatus(is_active=True, progress=5,
                                          message="Initializing live scraper...")
            return True

    def log(self, message: str) -> None:
        logger.info("[Scraper] %s", message)
        with self._lock:
            self._state.logs = (self._state.logs + [message])[-self.MAX_LOGS:]
            self._state.message = message

    def progress(self, percent: int, message: str) -> None:
        with self._lock:
            self._state.progress = percent
            self._state.message = message

    def finish(self, message: str, matched: Optional[int] = None) -> None:
        with self._lock:
            self._state.progress = 100
            self._state.message = message
            if matched is not None:
                self._state.matched_count = matched
            self._state.is_active = False

    def snapshot(self) -> ScrapeJobStatus:
        with self._lock:
            return self._state.model_copy(deep=True)


scrape_job = ScrapeJobTracker()
_background_tasks: set = set()
_properties_cache: Dict[str, Any] = {"key": None, "body": b"", "gzip_body": None, "etag": ""}
_properties_cache_lock = threading.Lock()


@asynccontextmanager
async def lifespan(_: FastAPI):
    store.load()
    yield


app = FastAPI(
    title="Washington Home Search API",
    description="REST API for Washington real estate discovery, mapping, comparison, and analysis.",
    version=APP_VERSION,
    lifespan=lifespan,
)

# The UI is served same-origin, so CORS only needs to admit other local ports
# (e.g. a static preview server) - never arbitrary websites.
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"https?://(localhost|127\.0\.0\.1)(:\d+)?",
    allow_methods=["GET", "POST", "PATCH"],
    allow_headers=["Content-Type"],
)
app.add_middleware(GZipMiddleware, minimum_size=1024, compresslevel=4)


# -----------------------------------------------------------------------------
# Static & raw data routes
# -----------------------------------------------------------------------------

@app.get("/", response_class=HTMLResponse, include_in_schema=False)
async def serve_root():
    if not os.path.exists(INDEX_FILE):
        return HTMLResponse("<h1>Washington Home Search: index.html not found</h1>", status_code=404)
    return FileResponse(INDEX_FILE, media_type="text/html")


def _static_route(url_path: str, relative: str, media_type: str) -> None:
    full_path = os.path.join(BASE_DIR, relative)

    async def handler():
        if not os.path.exists(full_path):
            raise HTTPException(status_code=404, detail=f"{relative} not found")
        return FileResponse(full_path, media_type=media_type)

    app.add_api_route(url_path, handler, methods=["GET"], include_in_schema=False,
                      name=f"static:{relative}")


for _url, (_relative, _type) in STATIC_FILES.items():
    _static_route(_url, _relative, _type)


@app.get("/properties.json", include_in_schema=False)
def serve_raw_properties(request: Request):
    """Full listing set including personal research, cached until data changes."""
    # Serialization runs in FastAPI's worker pool; the event loop stays free for
    # health/progress requests during large exports or initial dataset loading.
    accepts_gzip = any(
        part.split(";", 1)[0].strip().lower() == "gzip"
        and not re.search(r";\s*q=0(?:\.0*)?\s*(?:;|$)", part, re.I)
        for part in request.headers.get("accept-encoding", "").split(",")
    )
    with _properties_cache_lock:
        key = (id(store), store.version, read_only())
        if _properties_cache["key"] != key:
            body = json.dumps(query_listings(), ensure_ascii=False).encode("utf-8")
            _properties_cache.update(key=key, body=body, gzip_body=None,
                                     etag='W/"' + hashlib.sha256(body).hexdigest() + '"')
        body, etag = _properties_cache["body"], _properties_cache["etag"]
        headers = {"Cache-Control": "private, no-cache", "ETag": etag, "Vary": "Accept-Encoding"}
        if request.headers.get("if-none-match") == etag:
            return Response(status_code=304, headers=headers)
        if accepts_gzip:
            if _properties_cache["gzip_body"] is None:
                _properties_cache["gzip_body"] = gzip.compress(body, compresslevel=4, mtime=0)
            body = _properties_cache["gzip_body"]
            headers["Content-Encoding"] = "gzip"
    return Response(body, media_type="application/json", headers=headers)


@app.get("/api/health")
async def health():
    return {
        "status": "ok",
        "version": APP_VERSION,
        "listings": len(store),
        "read_only": read_only(),
        "scraping_authorized": scraping_authorized(),
    }


# -----------------------------------------------------------------------------
# Listing queries
# -----------------------------------------------------------------------------

def listing_filters(
    city: Optional[str] = None,
    min_price: Optional[int] = Query(default=None, ge=0),
    max_price: Optional[int] = Query(default=None, ge=0),
    min_beds: Optional[int] = Query(default=None, ge=0, le=20),
    min_baths: Optional[float] = Query(default=None, ge=0, le=20),
    min_sqft: Optional[int] = Query(default=None, ge=0),
    max_sqft: Optional[int] = Query(default=None, ge=0),
    min_lot: Optional[int] = Query(default=None, ge=0),
    min_garage: Optional[int] = Query(default=None, ge=0, le=20),
    min_year: Optional[int] = Query(default=None, ge=0, le=2100),
    max_hoa: Optional[int] = Query(default=None, ge=0),
    min_rating: Optional[int] = Query(default=None, ge=0, le=5),
    favorites_only: bool = False,
    search: Optional[str] = None,
) -> ListingFilter:
    """Query-string filters shared by listings, stats, and CSV export."""
    if min_price is not None and max_price is not None and min_price > max_price:
        raise HTTPException(status_code=422, detail="Minimum price must not exceed maximum price")
    if min_sqft is not None and max_sqft is not None and min_sqft > max_sqft:
        raise HTTPException(status_code=422, detail="Minimum living area must not exceed maximum living area")
    return ListingFilter(
        city=city, min_price=min_price, max_price=max_price, min_beds=min_beds,
        min_baths=min_baths, min_sqft=min_sqft, max_sqft=max_sqft, min_lot=min_lot,
        min_garage=min_garage, min_year=min_year, max_hoa=max_hoa, min_rating=min_rating,
        favorites_only=favorites_only, search=search,
    )


@app.get("/api/properties")
def get_properties(filters: ListingFilter = Depends(listing_filters), sort_by: str = "default"):
    """Filtered and sorted listings. Unknown specs keep their ``unknown_fields`` marker."""
    results = sort_listings(apply_filters(query_listings(), filters), sort_by)
    return JSONResponse(results)


@app.get("/api/properties/{property_id}", response_model=PropertyListing)
async def get_property_by_id(property_id: str):
    listing = store.get(property_id)
    if listing is None:
        raise HTTPException(status_code=404, detail="Property listing not found")
    return public_listing(listing)


@app.patch("/api/properties/{property_id}/note", response_model=PropertyListing,
           dependencies=[Depends(require_writable)])
async def update_property_note(property_id: str, note_data: PropertyNoteUpdate):
    """Update notes, rating, and/or favorite; persisted to ``data/user_state.json``."""
    updated = await asyncio.to_thread(
        store.update_user, property_id,
        rating=note_data.rating, user_notes=note_data.user_notes, favorite=note_data.favorite,
    )
    if updated is None:
        raise HTTPException(status_code=404, detail="Property not found")
    return updated


@app.post("/api/properties/{property_id}/favorite", response_model=PropertyListing,
          dependencies=[Depends(require_writable)])
async def toggle_property_favorite(property_id: str, toggle_data: Optional[FavoriteToggle] = None):
    """Set (or, with no body, toggle) the favorite flag."""
    updated = await asyncio.to_thread(
        store.toggle_favorite, property_id, toggle_data.favorite if toggle_data else None)
    if updated is None:
        raise HTTPException(status_code=404, detail="Property not found")
    return updated


@app.get("/api/stats")
def get_properties_stats(filters: ListingFilter = Depends(listing_filters)):
    """Market analytics across all or filtered listings (unknown specs excluded)."""
    return compute_stats(apply_filters(query_listings(), filters))


@app.get("/api/export/csv")
def export_properties_csv(filters: ListingFilter = Depends(listing_filters),
                                sort_by: str = "default"):
    """CSV of matched listings; unknown specifications export as blank cells."""
    listings = sort_listings(apply_filters(query_listings(), filters), sort_by)
    # UTF-8 BOM so Excel decodes non-ASCII text correctly.
    body = "\ufeff" + listings_to_csv(listings)
    return Response(
        body.encode("utf-8"), media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="washington_properties_export.csv"'},
    )


# -----------------------------------------------------------------------------
# Live refresh
# -----------------------------------------------------------------------------

async def run_scraper_job(criteria: Dict[str, Any]) -> None:
    """Collect listings, merge them into the store, and report progress."""
    try:
        collected = await run_live_scraper(
            criteria=criteria, log_callback=scrape_job.log, progress_callback=scrape_job.progress)
        merged = await asyncio.to_thread(store.merge, collected) if collected else None
        if merged:
            def rebuild_bundle():
                publishable = [{**listing, **USER_DEFAULTS} for listing in store.all()]
                atomic_write_text(DATA_JS_FILE, render_data_js(publishable))
            await asyncio.to_thread(rebuild_bundle)
            scrape_job.log(f"Merged {merged.total} listings ({merged.added} new, "
                           f"{merged.updated} updated). Total active: {len(store)}")
        scrape_job.finish(f"Scan complete! {len(collected)} properties processed.", len(collected))
    except ScrapeError as exc:
        logger.warning("Live refresh stopped: %s", exc)
        scrape_job.log(f"Error occurred during scraping: {exc}")
        scrape_job.finish(f"Scraper error: {exc}")
    except Exception as exc:  # Never leave the job slot claimed.
        logger.exception("Live scraper crashed")
        scrape_job.log(f"Error occurred during scraping: {exc}")
        scrape_job.finish(f"Scraper error: {exc}")


@app.post("/api/search", dependencies=[Depends(require_writable)])
async def start_search(criteria: SearchCriteria):
    """Start the live refresh job in the background."""
    if not scrape_job.try_start():
        raise HTTPException(status_code=409, detail="A scraping job is already running.")
    task = asyncio.create_task(run_scraper_job(criteria.model_dump()))
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)
    return {"status": "Live scraping job started successfully in background."}


@app.get("/api/status", response_model=ScrapeJobStatus)
async def get_scrape_status():
    """Current refresh job status and console logs."""
    return scrape_job.snapshot()


if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("PORT", 8000))
    host = os.environ.get("HOST", "127.0.0.1")
    logger.info("Starting Washington Home Search server on %s:%s%s", host, port,
                " (read-only)" if read_only() else "")
    uvicorn.run(app, host=host, port=port, reload=False)
