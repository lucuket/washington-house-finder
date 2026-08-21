# Rule: house-finder-quality

## Purpose & Scope
This rule establishes permanent quality, design, and architecture requirements for the **Washington Home Search** personal property-research application.

## Core Directives
1. **Application Context & Identity**:
   - This is a personal Washington property research workstation, not a startup product or commercial SaaS landing page.
   - Completely remove any remaining `AEROESTATE` branding and never replace it with a fabricated company brand or marketing fluff.
   - Use understated, functional naming (e.g., *Washington Home Search* / *Property Explorer*).

2. **Design & Aesthetics**:
   - Avoid generic AI-generated layouts (e.g., giant hero headers, glowing backgrounds, glassmorphism, excessive gradients, oversized typography, meaningless decorative cards/metrics).
   - Deliver a distinctive, professional, high-density property-research interface inspired by professional GIS/financial workstations and top-tier real estate tools.
   - Prioritize scannability, clear visual hierarchy, and immediate information utility.

3. **Performance & Lightweight Architecture**:
   - Performance, responsiveness, and low latency are first-class requirements.
   - Every filter change, search query, sort action, view switch, and modal/drawer interaction must feel instantaneous.
   - Prefer lightweight vanilla web standards and clean Python solutions over unnecessary external libraries or heavy frameworks.

4. **Data Integrity (Strict Rule)**:
   - **Never fabricate data**: Do not generate placeholder school ratings, crime stats, commute times, tax histories, walk scores, or simulated valuations unless sourced from verified listing data.
   - All derived metrics (such as $/sqft deltas or lot percentiles) must be computed transparently from actual listing data and be fully explainable to the user.

5. **Workflow & Engineering Standards**:
   - Inspect and understand the existing architecture before refactoring.
   - Preserve existing useful features (filtering, map sync, favorites, notes, ratings, side-by-side comparison, mortgage calculator, analytics, CSV export, live scraper).
   - Test for regressions after every meaningful change.
   - Ensure the repository remains in a clean, runnable state at all times.
