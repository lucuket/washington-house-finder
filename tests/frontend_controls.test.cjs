// Run with: node --test tests/frontend_controls.test.cjs
// Exercise the vanilla app's functions without a browser or external packages.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');
const source = readFileSync(join(__dirname, '..', 'app.js'), 'utf8');

function appFunction(name) {
    const start = source.indexOf(`    function ${name}(`);
    assert.ok(start >= 0, `Missing app function: ${name}`);
    const end = source.indexOf('\n    function ', start + 1);
    return source.slice(start, end < 0 ? undefined : end);
}

function element(view) {
    const classes = new Set();
    return {
        dataset: { view }, attributes: {}, listeners: {}, properties: {},
        classList: {
            add: value => classes.add(value), remove: value => classes.delete(value),
            toggle: (value, enabled) => enabled ? classes.add(value) : classes.delete(value),
            contains: value => classes.has(value),
        },
        setAttribute(name, value) { this.attributes[name] = value; },
        addEventListener(name, fn) { this.listeners[name] = fn; },
        style: { setProperty(name, value) { this[name] = value; } },
        focus() {}, setPointerCapture() {},
        getBoundingClientRect: () => ({ left: 100, top: 50, width: 1000, height: 600 }),
    };
}

test('years have no grouping while quantities retain grouping and unknowns stay unknown', () => {
    const ctx = vm.createContext({});
    vm.runInContext(appFunction('hasListingMetric') + appFunction('listingMetric'), ctx);
    assert.equal(ctx.listingMetric({ year_built: 1957 }, 'year_built'), '1957');
    assert.equal(ctx.listingMetric({ year_built: 1951 }, 'year_built'), '1951');
    assert.equal(ctx.listingMetric({ sqft: 1957 }, 'sqft', ' sqft'), '1,957 sqft');
    assert.equal(ctx.listingMetric({ year_built: 0 }, 'year_built'), 'Unknown');
    assert.equal(ctx.listingMetric({ year_built: 1957, unknown_fields: ['year_built'] }, 'year_built'), 'Unknown');
});

test('map opens on demand, flushes deferred markers, and closing clears its bounds filter', () => {
    const ctx = vm.createContext({
        activeView: 'grid', workspaceViewport: element(),
        filterState: { mapBoundsOnly: false }, mapBoundsFilterToggle: { checked: false },
        mapBoundsDebounceTimer: null, clearTimeout() {},
        filteredProperties: [{ id: 'a' }], mapMarkersDirty: true,
        map: null, initCalls: 0, filterCalls: 0, markerCalls: 0,
        requestAnimationFrame: fn => fn(), renderDealsView() {}, renderAnalytics() {}, syncStateToUrl() {},
    });
    for (const [suffix, view] of Object.entries({ Split: 'split', Grid: 'grid', Map: 'map', Deals: 'deals', Analytics: 'analytics' })) {
        ctx[`viewTab${suffix}`] = element(view);
        ctx[`mobNav${suffix}`] = element(view);
    }
    vm.runInContext(`
        function initMap() { if (!map) { initCalls++; map = { invalidateSize() {} }; } }
        function applyFilters() { filterCalls++; }
        function updateMapMarkers() { markerCalls++; }
        ${appFunction('isMapVisible')}
        ${appFunction('setViewMode')}
    `, ctx);
    ctx.setViewMode('grid');
    assert.equal(ctx.initCalls, 0);
    ctx.setViewMode('split');
    assert.equal(ctx.initCalls, 1);
    assert.equal(ctx.markerCalls, 1);
    assert.equal(ctx.mapMarkersDirty, false);
    assert.equal(ctx.viewTabSplit.attributes['aria-selected'], 'true');
    ctx.setViewMode('map');
    assert.equal(ctx.initCalls, 1);
    assert.equal(ctx.markerCalls, 1);
    ctx.filterState.mapBoundsOnly = ctx.mapBoundsFilterToggle.checked = true;
    ctx.setViewMode('grid');
    assert.equal(ctx.filterState.mapBoundsOnly, false);
    assert.equal(ctx.mapBoundsFilterToggle.checked, false);
    assert.equal(ctx.filterCalls, 1);
    assert.equal(ctx.workspaceViewport.className, 'workspace-viewport view-grid');
    ctx.setViewMode('invalid');
    assert.equal(ctx.activeView, 'grid');
});

test('divider handles pointer drag, cancellation, bounds, keyboard, and mobile orientation', () => {
    const divider = element();
    const viewport = element();
    const media = { matches: false, addEventListener(name, fn) { this.change = fn; } };
    const ctx = vm.createContext({
        document: { getElementById: id => id === 'map-resize-handle' ? divider : element() },
        workspaceViewport: viewport, window: { matchMedia: () => media }, activeView: 'split', map: null,
        ResizeObserver: class { observe() {} }, requestAnimationFrame() {},
    });
    vm.runInContext(appFunction('setupMapResize'), ctx);
    ctx.setupMapResize();
    const event = { button: 0, pointerId: 1, clientX: 800, clientY: 350, preventDefault() {} };
    divider.listeners.pointerdown(event);
    divider.listeners.pointermove(event);
    assert.equal(viewport.style['--listing-share'], '70%');
    assert.equal(divider.attributes['aria-valuetext'], 'Listings 70%, map 30%');
    divider.listeners.pointermove({ ...event, clientX: 2000 });
    assert.equal(viewport.style['--listing-share'], '75%');
    divider.listeners.pointercancel();
    divider.listeners.pointermove({ ...event, clientX: 100 });
    assert.equal(viewport.style['--listing-share'], '75%');
    assert.equal(viewport.classList.contains('resizing-map'), false);
    divider.listeners.keydown({ key: 'Home', preventDefault() {} });
    assert.equal(viewport.style['--listing-share'], '30%');
    divider.listeners.keydown({ key: 'ArrowRight', preventDefault() {} });
    assert.equal(viewport.style['--listing-share'], '35%');
    media.matches = true;
    media.change();
    assert.equal(divider.attributes['aria-orientation'], 'horizontal');
    divider.listeners.keydown({ key: 'ArrowDown', preventDefault() {} });
    assert.equal(viewport.style['--listing-share'], '40%');
    divider.listeners.pointerdown(event);
    divider.listeners.pointermove(event);
    assert.equal(viewport.style['--listing-share'], '50%');
    divider.listeners.pointerup();
    assert.equal(viewport.classList.contains('resizing-map'), false);
});
