---
name: data-pipeline
description: Activate this skill when refreshing, normalizing, validating, or testing the Washington property dataset, backend API routes, or static data.js bundle.
---

# Data Pipeline & Backend Verification Skill

Use this skill whenever modifying `properties.json`, `datastore.py`, `analytics.py`, `models.py`, `scraper_service.py`, `scraper.py`, `build_data_js.py`, or `app.py`.

## Core Architecture
- **`datastore.py` (`PropertyStore`)**: Thread-safe storage layer that separates publishable listing data (`properties.json`) from personal user state (`data/user_state.json` — favorites, ratings, private notes). Uses atomic temp-file writes (`atomic_write_text`) and enforces `unknown_fields` invariants.
- **`analytics.py`**: Pure, stateless filtering (`ListingFilter`, `apply_filters`), sorting (`sort_listings` with unknown-last ordering), market statistics (`compute_stats`), and CSV export (`listings_to_csv` with formula-injection protection).
- **`build_data_js.py`**: Generates `data.js` (`window. INITIAL_PROPERTIES`) for offline `file://` fallback. Supports `--check` to verify sync without writing.
- **`validate_data.py`**: Audits `properties.json`, `data.js`, `data/listing_snapshot.json`, and `index.html` for schema compliance, coordinate bounds, duplicate IDs/URLs, and `unknown_fields` consistency.

## Mandatory Verification Checklist
1. **Validate Dataset & Sync**:
   ```powershell
   python build_data_js.py --check
   python validate_data.py
   ```
2. **Run Automated Test Suite**:
   ```powershell
   python -m pytest -q
   ```
3. **Unknown Fields Invariant**:
   - Never fabricate missing MLS metrics (`beds`, `baths`, `garage`, `hoa`, `lot_sqft`, `year_built`).
   - Store unknown numeric values as `0` and include the field name in `unknown_fields`.
