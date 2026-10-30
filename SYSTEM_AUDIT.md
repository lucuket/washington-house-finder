**Washington Home Search — system audit and improvement report**

October 30, 2026. Reviewed the existing implementation, measured the original build, implemented targeted improvements, and verified the updated workstation. The release targets the existing [GitHub Pages workstation](https://lucuket.github.io/washington-house-finder/). Pages serves the frontend and listing snapshots; Python backend changes are included in the repository for private or backend-enabled deployments.

The vanilla architecture is appropriate for this personal research tool. The main weaknesses were unnecessary DOM/map reconstruction, unreliable asynchronous saves, inconsistent search restoration, expensive repeated compression, and a few misleading result states. A framework migration would add cost without addressing those problems.

**System-by-system findings**

| System | Finding and resulting behavior | Verification / practical limit |
| --- | --- | --- |
| Listing database and normalization | Missing or invalid numeric specifications now retain explicit `unknown_fields`; a reported $0 HOA remains different from unknown HOA. Failed disk writes no longer leak an uncommitted change into a later save. | Dataset validation and normalization/persistence regression tests. The published listing snapshot was preserved. |
| Search, filters, sorting | Existing preindexed search and score caching are fast. API searches now match terms across fields like the frontend. Unknown values fail active numeric constraints. Invalid or reversed API ranges return 422. | Full-data frontend tests, API tests, combined-filter checks, reset and zero-results browser checks. |
| Listing rendering | Cards are reconciled by listing identity. Unchanged cards and photos survive refreshes; small changes update their controls directly. Loading more creates only the additional cards. Card events now use one delegated listener set. | DOM identity regression test; browser checks preserved the chosen photo and focused favorite button. |
| Leaflet map | Markers survive sorting and unchanged filters. Only additions, removals, changed coordinates/prices, or changed favorites update the layer. Added a visible mapped count, including homes without coordinates. Bounds filtering now has a removable chip. | Marker identity tests; split/full map, fit results, bounds controls, and map closure checked in the browser. Existing clustering, basemaps, region jumps, and resizing remain. |
| Photos and gallery | The CDN ignored width query changes: a supposed small thumbnail still decoded at 960 px. The filename now requests the actual size. Drawer/lightbox thumbnails lazy-load at 160 px; cards request 600 px. Lightbox navigation reuses its thumbnail strip. Added image dimensions, async decoding, keyboard access, and a lightbox fallback. | Browser confirmed the same thumbnails changed from 960×640 to 160×107. Full-size drawer/lightbox main images remain available. |
| Favorites, ratings, notes | Each home's pending note save has its own timer. API updates for a home are serialized. Local writes preserve whitespace and report failures; research remains in memory if browser storage is unavailable. Cross-tab research changes invalidate the local cache. | Two-home note persistence verified through reload and then restored. Tests cover independent timers, failed requests, request ordering, unavailable storage, and atomic server writes. |
| Saved searches and URLs | Rating and maximum $/sqft were omitted from bookmark URLs. Both now round-trip. Restoring searches synchronizes the visible controls, validates ranges/enums, and avoids restoring a map-bound filter without its geographic bounds. Hash changes restore the search. | Regression tests cover round-tripping and malformed state. Existing preset creation, loading, deletion, and command palette remain. |
| Comparison | Selections now survive reload, with invalid IDs removed and a four-home limit. Clearing the tray synchronizes retained checkboxes on every listing surface. Added the payment assumptions and unknown-HOA explanation to the matrix. | Mobile comparison, reload persistence, clearing, unknown metrics, and matrix values checked. A regression test guards checkbox synchronization. |
| Mortgage estimator | One calculation function supplies both calculator and listing estimates. Zero interest and all-cash scenarios work. Inputs and restored assumptions are bounded. Changing global assumptions refreshes cards, the drawer, deals, and an open comparison. Added a visible sidebar assumptions control. | Calculation tests plus browser recalculation/restoration. Tax, insurance, and interest are assumptions; PMI, maintenance, utilities, and closing costs are explicitly excluded. Price/HOA edits remain specific to the open calculation. |
| Smart Score and deal evaluation | Preserved adjustable weights and cached scores. Construction age no longer claims to assess condition. Above-median homes are labeled above median instead of “At median.” Removed the fabricated fallback median. Benchmark gaps are labeled as gaps, with sample context. | Label, score-cache, sort, and real-listing tests. These are ranking heuristics against this snapshot, not appraisals or predicted savings. |
| Top Deals and Odd Finds | Fixed the serious empty-state bug: Top Deals previously fell back to every home when filters matched none. It now displays an empty state. Preserved Odd Finds' narrow, description-backed evidence rules. | Empty-result regression and browser check; existing Odd Finds inclusion/exclusion tests pass. |
| Analytics and broadband | Filtered medians exclude unknown metrics. Existing charts remain responsive. Preserved the distinction between city coverage, neighborhood-cell reports, and unverified address service. The dataset notice now derives actual counts/dates and describes mixed snapshots accurately. | Analytics/API tests, broadband snapshot tests, and browser counts. No school, crime, commute, tax-history, or address-service claims were invented. |
| API and response delivery | Query/serialization work uses worker threads. Cached both serialized and compressed listing responses by store/version/deployment mode; ETags permit 304 revalidation. General gzip uses level 4. | Compression caching/invalidation tests, real-snapshot benchmarks, and a successful browser load from FastAPI. |
| Public hosting and private research | Render, Docker, and tunnel configurations now default to read-only. Public/read-only API list, detail, statistics, raw-data, and CSV responses omit personal notes, favorites, and ratings. Local private mode retains writes. | Tests cover every public read/export representation and writable-mode persistence. These backend settings apply when running Python; the GitHub Pages release remains static. No tunnel was launched. |
| Scraper and refresh | Removed generic parking-space/driveway language as evidence of garage capacity. “Any” minima preserve missing fields as unknown. The UI sends the selected minima, including year. Successful backend refreshes also rebuild the offline bundle without personal state. Error completion no longer produces a success toast. | Mocked scraper tests, range validation, concurrent-job checks, and bundle synchronization checks. No live provider scrape was run; the existing authorization gate remains. |
| Accessibility and responsive behavior | Background content becomes inert while a dialog is active. Nested Escape restores the underlying drawer and its trigger. Mortgage badges and thumbnails are keyboard operable. Filter/rating/favorite states have explicit pressed state; matched counts announce changes. Drawer navigation follows the current sort after a rating changes it. | Browser checks at 375, 768, 1280, and 1920 px, including light/dark states and nested focus. No document-wide horizontal overflow observed. Shared text contrast tests pass. |
| CSV and offline fallback | Preserved filtered exports, BOM handling, and unknown cells. Backend formula-injection protection now covers every free-text column. Static-first loading still downloads one listing source; optional broadband requests have timeouts and failed map loading has a usable message. | Browser CSV export completed; CSV/data.js tests and sync checks pass. The full fallback bundle remains available for file previews. |

**Measured performance**

Browser timings measure synchronous card construction/update and marker reconciliation, not complete interaction-to-paint latency. Original and updated builds used the same 4,225-record snapshot, a 1280 px viewport, the 115 Everett results, and a visible map. Sort/favorite values are medians of six actions; load-more values are medians of five actions. The original build was copied from the starting Git HEAD into an ignored QA directory, with the same timing probes.

| Operation | Original | Updated | Interpretation |
| --- | ---: | ---: | --- |
| Favorite change, 56 displayed cards | 33.40 ms | 0.95 ms | About 97% less card-update work |
| Map reconciliation during sort | 2.00 ms | 0.20 ms | About 90% less map-update work |
| Load from 28 to 56 cards | 27.70 ms | 17.50 ms | About 37% less rendering work |
| Sort between disjoint 28-card result slices | 12.00 ms | 11.95 ms | Essentially unchanged; both must create new cards |
| Filter/score/sort all records in Node, rendering stubbed | 3.98 ms | 4.09 ms | Already below the workspace's 10 ms target |

Backend measurements used FastAPI TestClient, the real snapshot, seven measured requests after two warmups, and read-only mode. They include in-process request handling and decompression, not Internet latency.

| Request | Original median | Updated median |
| --- | ---: | ---: |
| Full dataset, warm cache | 416.80 ms | 39.20 ms |
| Filtered Everett listings | 16.33 ms | 16.71 ms |
| Filtered market statistics, all records | 16.08 ms | 21.21 ms |
| Full CSV export | 78.80 ms | 62.31 ms |

ETag revalidation returned 304 with zero body bytes in 1.59 ms in the recorded sample. The statistics endpoint does modestly more work to remove private research in public mode; there is no claim that every endpoint became faster.

Raw samples are saved locally in `qa-artifacts/audit-browser-benchmarks.json` and `qa-artifacts/audit-backend-benchmarks.json`. Screenshots are in `qa-artifacts/audit-desktop-1920.jpg`, `qa-artifacts/audit-mobile-375.jpg`, and `qa-artifacts/audit-tablet-768.jpg`.

**Comparison with other products and standards**

Reviewed official published flows and interface guidance, rather than claiming authenticated end-to-end tests of those services.

| Reference | Relevant pattern | Decision here |
| --- | --- | --- |
| [Redfin search guidance](https://support.redfin.com/hc/en-us/articles/360001432632-Searching-for-Homes) | Connected map/results, geographic refinement, saved searches | Preserve the workstation's direct map controls and compact saved searches; make map restrictions and missing locations explicit. |
| [Zillow advanced search](https://www.zillow.com/learn/zillow-advanced-search/) | Monthly cost matters alongside asking price; assumptions affect affordability | Make common payment assumptions visible, editable, and consistent across comparison surfaces. No lender eligibility claims or invented current-rate feed. |
| [Realtor.com search personalization](https://www.realtor.com/homemade/how-to-personalize-your-home-search-on-realtor-com/) | Progressive detailed criteria; garage and parking are distinct | Preserve compact advanced filters and stop treating parking as garage capacity. |
| [WAI modal dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/) | Inert background, contained focus, Escape, return to trigger | Complete those behaviors for nested workstation dialogs. |
| [web.dev INP](https://web.dev/articles/inp) and [CLS](https://web.dev/articles/cls) | Measure interaction responsiveness and reserve image space | Reduce reconstruction and image work, add dimensions, and report measured scope honestly. The local timings are not field INP/CLS scores. |

The app already provides more useful at-a-glance research density than a marketing-style landing page. The improvements keep that direction: concise controls, visible assumptions, truthful empty states, and stable interaction context. No frontend framework or UI dependency was added.

**Verification and remaining limits**

The final suite contains **91 Python tests and 31 frontend tests**, compared with 73 and 19 at the start. `node --check app.js`, `git diff --check`, `python build_data_js.py --check`, and `python validate_data.py` pass. Validation reports zero errors and 29 existing warnings. Browser checks found no application console errors in the exercised final static and backend flows. Temporary favorite, comparison, note, and mortgage changes were restored.

The snapshot remains dated October 28, 2026 and is partial coverage, not a complete live MLS. Fourteen records lack map coordinates and fourteen lack photos; these gaps remain visible rather than being filled with invented values. Many garage and HOA specifications are also unreported. Broadband reports still require address verification.

The source JSON is 22.97 MB and contains 135,596 photo URLs. Compression caching and correct photo variants address immediate costs; a future staged gallery-data format could reduce cold download/parse costs further, but would require a separate data-format migration. No production Lighthouse, field Web Vitals, throttled mobile-network, or sustained multi-user load test was performed. External photo/tile availability remains outside this app's control.

After a future partial live refresh, review the provenance summary in `data/listing_snapshot.json` before publishing: that file describes the original acquisition. The UI now identifies mixed record dates and the backend keeps the listing/fallback files synchronized, but it does not claim that a partial query refreshed every retained home.

Run the local private app with `python app.py`. Public configurations intentionally use `WHS_READ_ONLY=1`; private deployments must deliberately select writable mode. The Python QA environment used the existing `.qa-python` dependencies and emits an existing Starlette/httpx deprecation warning.

```powershell
python -m pytest -q
node --test tests/frontend*.test.cjs
python build_data_js.py --check
python validate_data.py
node --check app.js
git diff --check
```
