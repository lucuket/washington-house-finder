# UI review — October 29, 2026

This report records local validation before publication. Deployment status is tracked by the repository's GitHub Pages build and deployment workflow.

## Design research

Reviewed three home-search products through their own published interface examples and guidance:

- [Redfin: searching for homes](https://support.redfin.com/hc/en-us/articles/360001432632-Searching-for-Homes) and [saved searches](https://support.redfin.com/hc/en-us/articles/360001432532-How-to-Create-a-Saved-Search): keep saved searches close to results and preserve clear map navigation. Applied a bounded saved-search panel, explicit Fit results / Reset WA actions, and keyboard navigation.
- [Zillow: advanced home-search tools](https://www.zillow.com/learn/zillow-advanced-search/): keep price, monthly costs, and detailed criteria available during research. Preserved the visible listing metrics and completed the calculator and detail-panel styling.
- [Realtor.com: personalizing a search](https://www.realtor.com/homemade/how-to-personalize-your-home-search-on-realtor-com/): progressive filters and detailed property criteria. Kept advanced criteria compact and made active filter chips and saved searches available on mobile.

The implementation remains vanilla HTML, CSS, and JavaScript. No frontend dependencies were added.

## Fixes and polish

- The presets markup had no matching positioning styles. The panel now anchors within the viewport, scrolls within the available height, handles long names, and supports Escape and arrow-key navigation. Creating a search uses a themed inline form; the previous browser prompt was unsupported in the in-app browser.
- Added system-aware light/dark appearance with a persistent choice, first-paint initialization, cross-tab synchronization, native form-control colors, and a mobile-accessible toggle. Shared tokens cover listings, map chrome, street/topographic tiles, popups, drawers, comparison, broadband panels, analytics, scoring, calculator, and notifications. Satellite imagery and property photographs retain their colors.
- Simplified crowded header controls, restored missing styles for drawer notes/specifications/mortgage breakdown and the comparison tray, and added two-column tablet listings. Mobile filter panels are inert while closed and return focus to their trigger. Dialogs trap keyboard focus and dismiss the top layer first.
- Saved notes locally on every edit so switching homes cannot cancel another home's pending local save. Clicking the selected rating clears it.
- Excluded homes without coordinates from map-area searches. Closing the map clears its bounds filter. Reset WA now resets to Washington; Fit results has its own action.
- Reduced decorative treatment in Top Deals and labeled the city-median comparison as a benchmark gap rather than an appraisal.
- Added an SVG house favicon, including local-backend asset routing.
- Preserved the live scraper backend. The button and command appear only after a healthy backend confirms it is writable and scraping is authorized. GitHub Pages offers no scraper action.

## Verification

**73 Python tests passed**, covering API routes, static assets, data integrity, datastore persistence, analytics, broadband snapshots, and the scraper service. Scraper tests use fixtures/mocks; no live provider scrape was launched.

**19 frontend tests passed**, covering existing map/divider/Odd Finds behavior plus appearance initialization, unavailable storage, capability gating, panel bounds, rapid notes switching, all listing sorts, combined filters, map-coordinate handling, score-cache invalidation, and AA text contrast for shared neutral and semantic color pairs in both themes.

Browser verification included:

- Initial load and 4,225-listing count; keyword search, city/bed/bath/garage/year criteria, range-slider crossing protection, active chips, reset, and empty-state recovery.
- Price sorting, analytics updates, Top Deals, Odd Finds, shortlist filtering, and density switching.
- List/map/full-map switching, regional navigation, street/satellite/topographic basemaps, marker popups, bounds filtering, map closure, and fit/reset controls. Divider pointer and keyboard behavior is also covered by existing automated tests.
- Drawer photo navigation, fullscreen photo navigation, nested Escape dismissal, property specifications, broadband details, and similar-home display.
- Notes, rating, favorites, and appearance persistence across reload; temporary test research values were restored.
- Comparison selection, tray placement above mobile navigation, matrix values, unknown metrics, and clearing selections.
- Mortgage input recalculation, zero-interest calculation, and restoration of the original interest assumption.
- Saved-search creation, selection, deletion, keyboard dismissal, and command-palette Ctrl+K navigation. CSV export completed successfully.
- Layouts at 375, 768, 1280, and 1920 pixels, with both light and dark states exercised. No unwanted document-wide horizontal overflow was observed.

The browser exposed the original unsupported `prompt()` error during testing; that path was replaced and the saved-search workflow re-tested successfully. No further application exceptions were observed in the final workflows.

`node --check app.js`, `git diff --check`, and `python build_data_js.py --check` passed. The data validator reports **0 errors and 29 pre-existing warnings** for missing coordinates/photos. Listing and broadband datasets were not changed. The isolated test environment emits a Starlette/httpx deprecation warning.

## Performance measurement

The frontend benchmark runs the baseline and updated filter/scoring/sort code against the same 4,225 records in Node, with rendering stubbed. Median of 20 warmed runs after 10 warmups:

| Pipeline | Baseline | Updated |
| --- | ---: | ---: |
| Filter, score, and sort all listings | 15.99 ms | 3.61 ms |

Scores now recompute when score weights, personal rating, the year, or the loaded snapshot changes. This benchmark measures the JavaScript data pipeline, not browser rendering or network loading.

## Re-run

```powershell
python -m pytest
node --test tests/frontend_*.test.cjs
python validate_data.py
python build_data_js.py --check
```

For static preview: `python -m http.server 8010 --bind 127.0.0.1`.
For the optional backend, install `requirements.txt` and run `python app.py`.
