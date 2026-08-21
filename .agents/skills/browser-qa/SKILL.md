---
name: browser-qa
description: >-
  Activate this skill when validating frontend changes, running end-to-end user experience checks, verifying responsiveness, and testing property research workflows in the browser.
---

# Browser QA & Verification Skill

This skill defines the rigorous quality assurance checklist required after every significant modification to the Washington property research application.

## QA Validation Protocol

When testing the rendered application, systematically verify every major workflow and interface state:

### 1. Core Workflow Verification
- **Initial Load**: Fast bootstrap, data loading spinner or skeleton, immediate map pin population, initial counts accurate.
- **Search & Filters**:
  - Keyword search matches address, city, ZIP, description, and user notes.
  - Dual price & sqft range sliders adjust bounds without crossing.
  - City dropdown, bedrooms, bathrooms, garage, HOA, and star rating filters filter correctly.
  - Active filter chips render accurately; individual chips and "Reset All" restore expected results.
- **Sorting**: Verify all sort modes (Price asc/desc, $/sqft asc, SqFt desc, Lot desc, Year Built desc, User Rating desc, Smart Score).
- **Map Interactions**:
  - Hovering a listing highlights the corresponding marker; clicking a marker highlights the listing or opens details.
  - Bounds fitting and "Search this map area" accurately filter the listing pane.
  - Marker pins remain clear and responsive without visual lag.
- **Property Details & Drawers**:
  - Drawer opens smoothly; photo carousel and thumbnail strip navigate cleanly.
  - Full specs, value signals, and similar homes calculate accurately.
- **User Actions & Persistence**:
  - Toggle favorite updates count, updates UI state, and persists.
  - Rating stars update instantly and save to database / local cache.
  - Personal notes auto-save without losing focus or dropping keystrokes.
- **Comparison Tool**:
  - Adding/removing properties updates compare dock (up to 4 slots).
  - Side-by-side matrix highlights best/worst metrics accurately and handles missing fields gracefully.
- **Mortgage Estimator**:
  - Sliders and numeric inputs dynamically update monthly payments and visual segment breakdown.
  - User custom assumptions (down payment %, interest rate) persist.
- **Analytics View**:
  - Metrics and distribution charts reflect the currently filtered subset.
- **Scraper UI**:
  - Scraper modal controls, progress indicator, and live log stream display properly without crashing or unhandled errors.

### 2. Technical & Layout Health Checks
- **Console & Network**:
  - 0 unhandled JavaScript exceptions or console warnings.
  - 0 failed network requests (404s, broken images, unhandled 500s).
- **Responsiveness & Viewports**:
  - Test at $375\text{px}$ (mobile), $768\text{px}$ (tablet), $1280\text{px}$ (laptop), and $1920\text{px}$ (desktop).
  - Ensure zero unwanted horizontal scrollbars or overlapping text elements.
- **Keyboard Navigation & Accessibility**:
  - `Ctrl+K` / `Cmd+K` command palette launches smoothly.
  - `Esc` closes active drawers/modals.
  - Tab navigation presents visible focus rings on all interactive elements.

## Defect Resolution Rule
Whenever QA reveals a bug, layout glitch, regression, or sluggish interaction:
1. Identify the root cause.
2. Repair the defect directly in the codebase.
3. Re-run the verification steps to confirm resolution before completing the task.
