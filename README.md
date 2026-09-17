# Washington Home Search

Personal property-research workstation for Washington state homes.
Live site is a **static GitHub Pages deploy** — no server runs in production.

## How deployment works

1. The scraper (`scraper.py`, HomeHarvest) runs **locally only** — it cannot
   work on GitHub's servers. It writes `properties.json`.
2. `python3 build_data_js.py` regenerates `data.js` from `properties.json`
   (single source of truth — never edit `data.js` by hand).
3. Commit and `git push origin master`. Pages rebuilds automatically.

Full refresh workflow:

```bash
python scraper.py          # scrape locally -> properties.json
python3 build_data_js.py   # rebuild data.js (must match, verified below)
git add properties.json data.js
git commit -m "Refresh listings"
git push origin master
```

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
