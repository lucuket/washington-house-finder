# Washington Home Search — Workspace Quality & Engineering Rules

## Application Identity
- **Context**: Personal property research application for evaluating Washington state homes.
- **Branding**: No `AEROESTATE` or fabricated real-estate company branding; keep branding understated and functional (*Washington Home Search*).

## Design & UI Principles
- **No Generic AI Templates**: Avoid giant hero headers, glowing floating backgrounds, glassmorphism, excessive gradients, oversized typography, identical card components, and decorative filler.
- **Workstation Feel**: Create a high-density, professional property research workstation (combining MLS utility, GIS map linkage, and quick financial comparison).
- **Information Density**: Make critical metrics ($/sqft, lot size, garage, HOA, year built, monthly payment estimate) immediately scannable without opening drawers.

## Performance Requirements
- **Instant Response**: Filter, sort, view toggles, drawer openings, and map synchronizations must execute smoothly without perceptible lag.
- **Lightweight Architecture**: Use clean vanilla web standards (HTML5, modern CSS custom properties, vanilla JS) and fast backend routines. Avoid heavy external frameworks and dependencies.
- **Image Performance**: Lazy-load off-screen photos, provide explicit aspect ratios, prevent layout shift, and supply clean fallback states.

## Data Integrity
- **Zero Fabrication**: Never invent school ratings, crime data, commute times, tax histories, or speculative estimates.
- **Transparent Computations**: Derived signals (such as $/sqft deltas vs. city median) must be computed directly from actual listing data.

## Maintainability & Preserving Capabilities
- Preserve all existing features: real property database, live scraper, Leaflet mapping, favorites, ratings, notes, side-by-side comparison, mortgage estimator, analytics, and CSV export.
- Inspect and benchmark before modifying.
- Test for regressions after every significant iteration.
- Ensure the codebase remains fully runnable.
