---
name: performance-loop
description: >-
  Activate this skill for frontend and backend performance optimization, interaction profiling, rendering bottlenecks, memory management, and latency reduction in the Washington property research application.
---

# Performance Optimization Loop Skill

This skill enforces a disciplined, iterative performance engineering cycle prioritizing real-world interaction speed and smooth frame rates.

## The Iterative Optimization Loop

Execute these phases systematically:

```
[Baseline] ➔ [Profile] ➔ [Identify Bottleneck] ➔ [Improve] ➔ [Test & Verify] ➔ [Measure Again] ➔ [Repeat]
```

1. **Baseline**: Capture initial performance metrics (load time, render duration, memory consumption, filter response time).
2. **Profile**: Trace interaction hot paths during listing filtering, sorting, map movements, drawer toggles, and image cycling.
3. **Identify Bottleneck**: Pinpoint the highest-impact source of latency or layout thrashing.
4. **Improve**: Apply targeted, minimal-overhead optimizations without breaking functionality or code clarity.
5. **Test & Verify**: Ensure no functional regressions occur.
6. **Measure Again**: Quantify the latency or frame-time delta.
7. **Repeat**: Continue until additional iterations yield only marginal gains.

## Specific Inspection Targets

- **DOM Rendering & Reconstruction**:
  - Avoid full DOM teardown and recreation when small updates suffice.
  - Use `DocumentFragment`, direct text updates, or virtualized/batched renders for large listing sets.
  - Eliminate layout thrashing (interleaved DOM reads and writes).

- **Filtering & Sorting Throughput**:
  - Ensure local dataset filtering executes in under $10\text{ms}$.
  - Memoize derived properties (e.g. $/sqft, city medians, monthly mortgage calculations).
  - Debounce search input appropriately ($150\text{ms}-200\text{ms}$) while keeping discrete filter clicks instant.

- **Map Marker Efficiency**:
  - Prevent full marker layer destruction on minor updates; update existing markers or batch operations.
  - Keep marker DOM lightweight and eliminate expensive shadow/blur filters on pins.

- **Image Loading & Decoding**:
  - Lazy-load off-screen property images (`loading="lazy"`).
  - Set explicit image dimensions / aspect ratios to guarantee $0\text{ CLS}$ (Cumulative Layout Shift).
  - Eagerly load or preload only active and immediate next gallery images.
  - Provide fast, graceful SVG fallback for broken image URLs.

- **Main Thread & Event Listeners**:
  - Employ event delegation on listings grids instead of attaching individual listeners to hundreds of sub-elements.
  - Keep main thread execution chunks $< 50\text{ms}$ to prevent frame drops.

- **CSS & Paint Cost**:
  - Eliminate heavy `backdrop-filter: blur()`, multi-layered `box-shadow`, and continuous canvas glows that stress the GPU.
  - Use `transform` and `opacity` for hardware-accelerated animations.

- **Network & Storage Efficiency**:
  - Avoid duplicate API requests; cache property data in memory.
  - Batch `localStorage` writes with debouncing during note editing.
