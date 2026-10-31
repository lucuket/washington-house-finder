# Local performance and compatibility review — October 30, 2026

This report records the local review and verification completed before the
subsequent request to publish the improvements to GitHub Pages.

## Results

The main gains are lower startup transfer size and memory use, more resilient
browser startup, and a calmer research interface. All 4,225 source records and
135,596 photo URLs are preserved, including their order and every listing field.
`properties.json` and `data.js` have no content changes.

| Measurement | Starting build | Updated build |
| --- | ---: | ---: |
| Preferred listing JSON, uncompressed | 22.97 MB | 9.27 MB |
| Listing JSON with benchmark server gzip | 3.58 MB | 2.87 MB |
| Retained browser JS heap after collection | 31.99 MB | 23.70 MB |
| Listings available, fast local desktop | 191 ms | 194 ms |
| Listings available, 4× CPU slowdown | 802 ms | 816 ms |
| Listings available, 8 Mbps + 40 ms latency + 4× CPU | 4,510 ms | 3,946 ms |
| First results paint, same throttled profile | 4,767 ms | 4,300 ms |
| Warm full-payload FastAPI request | 40.8 ms | 27.3 ms |

The listing JSON is 60% smaller before compression, about 20% smaller with the
benchmark server's gzip, and the retained JS heap is about 26% smaller. Fast
local startup is essentially unchanged; there is no claim that every operation
became faster. Filtering/scoring/sorting remains around 3.4 ms for the full
snapshot in the existing Node benchmark, below the workspace's 10 ms target.

## Implemented changes

### Data loading and memory

- Added `compact_data.py` and a generated `properties.compact.json`. Each
  compressible gallery stores a shared URL prefix, suffix, and ordered middle
  parts. No image quality, URLs, descriptions, or metadata are removed.
- The browser decodes galleries only on their first use, then reuses the array.
  Off-screen homes retain the short representation until accessed.
- Retained original JSON, original offline JS bundle, full galleries, and all
  listing tools. A normal HTTP load fetches one listing representation.
- Added a cached compact backend endpoint with the same user-state overlay,
  read-only privacy rules, compression, invalidation, and ETag behavior as the
  existing full JSON endpoint. Cold backend response time was essentially
  unchanged: about 290 ms raw versus 293 ms compact in this run.
- Both CLI and backend refreshes rebuild both generated browser bundles.
  `build_data_js.py --check` and `validate_data.py` now detect compact drift.
- Slow optional broadband files no longer delay the listing pane. Coverage
  updates existing cards and drawer coverage without replacing a focused note.
  Bookmarked searches that depend on broadband wait for the required coverage.
- Cards are not rebuilt for hidden listing panes while using maps, analytics,
  Top Deals, or Odd Finds. Their next visible render applies the latest filters.
- Excluded local QA dependencies and downloaded test browsers from Docker's
  build context. These were already ignored by Git.

### Compatibility and request resilience

- Replaced direct `AbortSignal.timeout()` calls with an `AbortController`
  helper. The deadline covers JSON body consumption and every timer is cleared.
  The earlier loader could fail before its error handler on browsers missing
  `AbortSignal.timeout()`; MDN identifies this as a newer cross-browser API.
  Reference: [MDN AbortSignal.timeout](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal/timeout_static).
- Added older `MediaQueryList.addListener` support throughout theme, sidebar,
  divider, and dialog focus handling. Removed `Array.at()` requirements from
  startup and modal navigation. Missing `ResizeObserver` falls back to resize
  events; the map remains available.
- Gave large listing requests a 60-second deadline so a slow connection does
  not restart a progressing download after the previous 10-second limit.
- File previews load the complete offline bundle directly. This eliminates
  denied local JSON fetches that WebKit reported even when the fallback worked.
- Clipboard access falls back to showing the address when the API is absent.
- Copied the existing Leaflet 1.9.4 and MarkerCluster 1.5.3 distributions into
  `vendor/`, with upstream licenses. Leaflet's original JS/CSS integrity hashes
  were checked. Local backend routes serve only the explicitly allowed assets.
- Removed the external font stylesheet. Native UI and monospace font stacks
  render without downloading fonts. No new production library was introduced.

### UI clarity and accessibility

- Replaced the red-heavy palette with restrained blue and slate accents in
  light and dark modes; kept the compact workstation layout.
- Replaced four repeated metric pills with aligned, labeled price/sqft, lot,
  year, and HOA facts. Beds, baths, size, garage, payment, rating, and research
  actions remain visible. Missing specifications still read Unknown.
- Kept snapshot provenance and estimate assumptions visible in a quieter
  information strip. No fabricated signals or company branding were added.
- Suppressed duplicate notifications and limited the visible stack to three.
  Fixed dark-mode toast text contrast and retained error semantics.
- Removed the closed mobile sidebar's shadow so an off-screen panel no longer
  leaves a dark strip over the listing pane.
- Retained touch controls, keyboard navigation, focus containment, reduced
  motion, comparison, analytics, notes, saved searches, and CSV export.

## Verification

The starting suites passed 91 Python tests and 32 frontend tests. The final
suites pass **101 Python tests and 37 frontend tests**. New coverage verifies:

- Full-source equality after packing/unpacking, in both Python and JavaScript,
  including identical URLs, Unicode URLs, empty galleries, and mixed URLs.
- Lazy gallery expansion, memoization, malformed-format rejection, and source
  records remaining unchanged during research edits.
- Request cancellation, body-decoding deadlines, timer cleanup, and older
  media-query APIs.
- Compact endpoint privacy, ETag invalidation, served map assets, hidden-view
  rendering, and both refresh entry points rebuilding the compact payload.

The browser runner passed **15 workflow groups in each of Chromium, Firefox,
and WebKit** on Windows. It exercises filtering and sort controls, saved
research across reloads, note search, nested galleries, comparison, mortgage
assumptions, map/listing synchronization, hidden rendering, saved searches,
command palette, CSV download, denied storage, missing browser APIs, malformed
compact data, delayed optional coverage, and offline file previews.

Light and dark layouts were checked at **375, 768, 1280, and 1920 px** with no
document-wide horizontal overflow. Screenshots were visually inspected and the
mobile sidebar was verified fully off-screen after closing. The controlled
browser suites reported no unhandled app errors or failed local requests.

An additional real localhost FastAPI session used copied listing data and
separate research state. Browser edits reached the backend, and an explicitly
mocked refresh exercised the progress log and completion UI. It made no live
scraper/provider request. Real listing photos loaded successfully; this smoke
run recorded no page errors or failed network requests. The QA server was stopped.

`node --check app.js`, `git diff --check`, `python build_data_js.py --check`, and
`python validate_data.py` pass. Dataset validation retains **zero errors and
29 existing warnings** about missing photos/coordinates and coverage. Python QA
uses the existing `.qa-python` dependencies and reports the existing
Starlette/httpx deprecation warning.

## Measurement scope and remaining limits

Startup benchmarks used a 1280×900 Chromium viewport and the same real dataset.
The original app/CSS/HTML were frozen before edits. To isolate application and
payload costs, both builds used local copies of the same map libraries and
deterministic image responses; baseline font downloads were excluded. Thus the
timings do not estimate the additional benefit of avoiding CDN/font outages.

Results are medians of seven desktop runs, five CPU-throttled runs, and three
network-throttled runs per build, after one warmup. Browser caches were disabled
in fresh contexts. First paint uses two animation frames after the results
mutation, not a field Web Vital. Heap measurements follow explicit garbage
collection and exclude browser-process/native-image memory. Backend timings use
FastAPI TestClient, including HTTP handling and decompression, with seven warm
samples after two initial requests. They exclude Internet latency.

These are local headless engine tests, not physical iPhone/iPad or Android tests,
production Lighthouse/INP measurements, or a sustained multi-user load test.
Photos and basemap tiles still depend on external providers. Full offline file
previews retain the larger `data.js`; optional broadband JSON remains unavailable
where file-origin fetches are prohibited. The extra 9.27 MB generated artifact
is an intentional repository-size tradeoff for the lighter HTTP startup path.

Raw results and screenshots are in the ignored `qa-artifacts/performance-review/`
folder (`startup-benchmarks.json`, `backend-benchmarks.json`, and browser reports).
During the review itself, no deployment settings were activated and no public
site was changed. Publication was requested separately after the local preview.

## Reproducing checks

```powershell
python -m pytest -q
node --test tests/frontend_*.test.cjs
node --check app.js
python build_data_js.py --check
python validate_data.py
git diff --check

# Optional: with Playwright and its browsers installed
$env:WHS_BROWSER = 'chromium'  # also firefox or webkit
node tests/browser_qa.cjs
```

On this workstation the existing Python dependencies are in `.qa-python`; add
that directory to `PYTHONPATH` for the commands above, or use an environment with
`requirements.txt` installed. `WHS_PLAYWRIGHT` and `WHS_BROWSER_EXECUTABLE` may
select an existing browser-test runtime without changing the app's dependencies.
