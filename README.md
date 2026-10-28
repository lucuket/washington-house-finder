# Washington Home Search

Personal property-research workstation for Washington state homes.
Live site is a **static GitHub Pages deploy** — no server runs in production.

## Data refresh and deployment

The site is a static GitHub Pages deploy; no live scraper runs there. The
existing listing snapshot is historical and must not be assumed current.
Realtor.com's [terms](https://www.realtor.com/terms-of-service/) and
[robots.txt](https://www.realtor.com/robots.txt) require express written
permission for automated collection. Use a data feed licensed for the intended
use and publication, then update `properties.json` and run
`python build_data_js.py` to regenerate the local-preview fallback. Deploy
both files together, and update the snapshot date in `index.html` to reflect
the date of the new data.

The legacy HomeHarvest scraper is disabled unless
`REALTOR_SCRAPING_AUTHORIZED=yes` is set after obtaining express written
permission. Even then, HomeHarvest controls its own requests and retries; the
wrapper cannot guarantee a request rate or prevent a block. Stop after access
errors or challenges. A failed refresh leaves the existing data unchanged.

## File layout

| File(s) | Role |
|---|---|
| `index.html`, `styles.css`, `app.js` | Production site (Pages serves these) |
| `properties.json` | Listing database — source of truth, fetched async |
| `data.js` | Generated fallback bundle for `file://` previews — do not hand-edit |
| `build_data_js.py` | Regenerates `data.js` from `properties.json` |
| `app.py`, `models.py`, `scraper_service.py` | Local-dev backend only (`start_online.bat`: FastAPI + Cloudflare tunnel). Never runs on Pages |
| `scraper.py` | Local-only MLS scraper |
| `Dockerfile`, `render.yaml`, `Procfile`, `requirements.txt` | Backend deploy leftovers — unused by the Pages site, kept for local use |
| `data/fcc_wa_broadband_by_city.json` | Derived broadband reference (192 KB, tracked) |
| `data/fcc/*.csv`, `data/fcc/*.zip` | Raw FCC source files (~9 MB) — local only, **not tracked** (re-download from the FCC BDC if needed) |
| `wa-boundary.js` | Unused legacy geometry — nothing references it |

## Browser data loading order (`app.js`)

1. `fetch('properties.json')` — primary, async, non-blocking
2. `window.WASHINGTON_PROPERTIES` from `data.js` — fallback (file preview)
3. `/api/*` — local backend only; on Pages these calls fail silently and
   favorites/notes persist to `localStorage` instead
