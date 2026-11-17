# Washington Home Search — Workspace Quality & Engineering Rules

## Application Identity
- **Context**: Personal property research application for evaluating Washington state homes.
- **Branding.** Remove any remaining `AEROESTATE` branding. Use understated, functional naming such as *Washington Home Search*. Avoid fabricated real-estate company branding and marketing copy.

## Design & UI Principles
- **No Generic AI Templates**: Avoid giant hero headers, glowing floating backgrounds, glassmorphism, excessive gradients, oversized typography, identical card components, and decorative filler.
- **Workstation Feel**: Create a high-density, professional property research workstation (combining MLS utility, GIS map linkage, and quick financial comparison).
- **Information Density.** Use a clear visual hierarchy. Make critical metrics ($/sqft, lot size, garage, HOA, year built, monthly payment estimate) immediately scannable without opening drawers.

## Performance Requirements
- **Instant Response.** Search, filtering, sorting, view toggles, modal and drawer interactions, and map synchronization must run smoothly without perceptible lag.
- **Lightweight Architecture**: Use clean vanilla web standards (HTML5, modern CSS custom properties, vanilla JS) and fast backend routines. Avoid heavy external frameworks and dependencies.
- **Image Performance**: Lazy-load off-screen photos, provide explicit aspect ratios, prevent layout shift, and supply clean fallback states.

## Data Integrity
- **Zero Fabrication.** Never invent school ratings, crime data, commute times, tax histories, walk scores, or valuations.
- **Transparent Computations.** Derive signals such as $/sqft deltas vs. city median and lot percentiles from verified listing data. Make the calculations explainable to the user.

## Maintainability & Preserving Capabilities
- Preserve all existing features: real property database, live scraper, Leaflet mapping, favorites, ratings, notes, side-by-side comparison, mortgage estimator, analytics, and CSV export.
- Inspect and benchmark before modifying.
- Test for regressions after every significant iteration.
- Keep the repository clean and fully runnable.
