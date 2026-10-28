# Washington Home Search — Property Research Workstation

A high-density residential property research workstation for analyzing, filtering, mapping, and comparing single-family listings across Washington State.

## Live Deployment
- **GitHub Pages (Static Workstation)**: `https://lucuket.github.io/washington-house-finder/`

## Architecture Overview

### Frontend Workstation (Static-First)
- **[`index.html`](index.html)**: Semantic workstation shell with split cards/map view, full-bleed GIS map, top value deals evaluation view, reactive analytics dashboard, side-by-side comparison matrix, and mortgage calculator.
- **[`app.js`](app.js)**: Vanilla JavaScript client engine with O(1) property lookup (`Map`), lazy Leaflet popup binding, `unknown_fields`-aware filtering/scoring, FCC broadband city coverage integration, URL hash state sync, and local persistence (`localStorage`).
- **[`styles.css`](styles.css)**: High-density workstation design system using CSS custom properties without external UI frameworks or glassmorphism.
- **[`properties.json`](properties.json)** & **[`data.js`](data.js)**: Primary JSON dataset (4,225 Washington listings) and generated `window.INITIAL_PROPERTIES` fallback bundle for offline `file://` usage.
- **[`data/fcc_wa_broadband_by_city.json`](data/fcc_wa_broadband_by_city.json)**: Derived FCC Broadband Data Collection (BDC) city-level fiber and cable coverage summary.

### Modular Python Backend & Data Pipeline
- **[`app.py`](app.py)**: FastAPI backend with lifespan-managed `PropertyStore`, GZip compression, localhost-only CORS, whitelisted static asset serving, read-only deployment guard (`WHS_READ_ONLY=1`), and non-blocking user-state persistence.
- **[`datastore.py`](datastore.py)**: Thread-safe `PropertyStore` separating publishable listing data (`properties.json`) from personal research state (`data/user_state.json`), with atomic file writes, WA coordinate bounds checking, and URL-based merge deduplication.
- **[`analytics.py`](analytics.py)**: Pure filtering (`ListingFilter`, `apply_filters`), sorting (`sort_listings` with unknown-metric-last ordering), market statistics (`compute_stats`), and CSV export (`listings_to_csv` with spreadsheet formula-injection protection).
- **[`models.py`](models.py)**: Pydantic v2 schemas for `PropertyListing`, `SearchCriteria`, `PropertyNoteUpdate`, and `ScrapeStatus`.
- **[`scraper_service.py`](scraper_service.py)** & **[`scraper.py`](scraper.py)**: Permission-gated CLI and service (`REALTOR_SCRAPING_AUTHORIZED=yes`) that merges refreshed listings into `PropertyStore` without overwriting saved IDs or user notes/ratings.
- **[`build_data_js.py`](build_data_js.py)**: Atomic generator for `data.js` with `--check` verification mode.
- **[`validate_data.py`](validate_data.py)**: Dataset & static bundle integrity validator (`--strict`, `--json`).
- **[`tests/`](tests/)**: Automated `pytest` suite (71 tests) covering datastore, analytics, API routes, scraper normalization, and live dataset integrity.

## Common Commands

```powershell
# Run the local FastAPI workstation server (http://127.0.0.1:8000)
python app.py

# Validate dataset, unknown_fields invariants, and data.js synchronization
python validate_data.py
python build_data_js.py --check

# Run the automated test suite
python -m pytest -q
```

## Neighborhood broadband snapshot

`data/ispmap_top_deals.json` contains ISPMap residential provider data for the
24 default Top Deals and 532 North Sound listings in the October 28, 2026
snapshot: Everett, Marysville, Lake Stevens, Lynnwood, Snohomish, Bothell,
Edmonds, and Hat Island. The data was retrieved October 28, 2026 with the
user's stated permission; the source reported FCC data as of December 31,
2025. Results describe an H3 resolution-8 cell around a listing: providers and
speeds can be reported elsewhere in that cell. Confirm service at the address
with the FCC and provider. One Marysville listing has no coordinates in the
listing data; its cell comes from ISPMap's address search and the map position
is not independently verified. Entries are shown only while listing ID,
address, ZIP, and coordinates match the snapshot. The city broadband filter
still filters city coverage, not address or neighborhood service.
