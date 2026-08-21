---
name: frontend-quality
description: >-
  Activate this skill for UI, UX, frontend feature development, responsive layout design, interaction polish, design system styling, and accessibility enhancements in the Washington property research workstation.
---

# Frontend Quality Skill

This skill guides the construction and refinement of high-performance, professional interfaces tailored for property research.

## Core Design Principles

### 1. High-Density Property Research Workstation
- Treat the application as a power-user research tool rather than a generic marketing landing page.
- Maximize useful screen real estate on desktop displays with multi-pane layouts (split view: filters, listings, interactive map, focused detail drawer).
- Ensure key data points ($/sqft, lot size, garage count, HOA fee, year built, estimated monthly cost, user rating) are scannable at a glance.

### 2. Eliminating Generic SaaS & AI Template Aesthetics
- **Prohibited**: Giant hero sections, floating glowing background orbs (`ambient-glow`), heavy glassmorphism blur filters, oversized bubbly cards, excessive pill tags, decorative low-utility metrics, and fabricated company branding.
- **Favored**: Crisp dividers, high-contrast typography, restrained color palette with deliberate accent roles, monospace numbers for tabular data, compact badges, and purpose-built information displays.

### 3. Seamless Map + Results Workflows
- Keep the Leaflet map and listing results tightly synchronized.
- Hovering/focusing a card highlights the map marker; clicking a marker focuses and scrolls to the card or opens the detail drawer.
- Add quick actions: "Search this map area", "Fit results", and "Reset Washington view".
- Clean, compact price pins that do not obscure neighboring pins or create visual chaos.

### 4. Focused Detail Experience
- Provide a side drawer or focused inspection workspace instead of awkward generic modals.
- Enable fast keyboard navigation (arrow keys for image gallery, `Esc` to dismiss, `F` to favorite, `C` to compare).
- Display transparent value signals (e.g. comparison against city median $/sqft) and similar homes computed from real listing attributes.

### 5. Responsive Design & Touch Targets
- Desktop: Dense, efficient, multi-column research workspace.
- Mobile/Tablet: Clean bottom navigation or top view toggle, collapsible filters, touch targets $\ge 44\text{px}$, zero horizontal overflow.

### 6. Accessibility & Motion
- Use semantic HTML elements (`<main>`, `<aside>`, `<header>`, `<article>`, `<section>`).
- Maintain visible focus indicators (`:focus-visible`) and accurate ARIA attributes for dialogs and interactive state changes.
- Ensure all transitions are snappy ($\le 150\text{ms}$) and respect `prefers-reduced-motion`.
