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
        activeView: 'grid', galleryDirty: false, galleryNeedsReset: false, workspaceViewport: element(),
        filterState: { mapBoundsOnly: false }, mapBoundsFilterToggle: { checked: false },
        mapBoundsDebounceTimer: null, clearTimeout() {},
        filteredProperties: [{ id: 'a' }], mapMarkersDirty: true,
        map: null, initCalls: 0, filterCalls: 0, markerCalls: 0,
        requestAnimationFrame: fn => fn(), renderDealsView() {}, renderAnalytics() {}, renderOddFinds() {}, syncStateToUrl() {},
    });
    for (const [suffix, view] of Object.entries({ Split: 'split', Grid: 'grid', Map: 'map', Deals: 'deals', Analytics: 'analytics', Odd: 'odd' })) {
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
    ctx.setViewMode('odd');
    assert.equal(ctx.viewTabOdd.attributes['aria-selected'], 'true');
    assert.equal(ctx.mobNavOdd.classList.contains('active'), true);
    assert.equal(ctx.initCalls, 1);
    ctx.setViewMode('invalid');
    assert.equal(ctx.activeView, 'odd');
});

test('divider handles pointer drag, cancellation, bounds, keyboard, and mobile orientation', () => {
    const divider = element();
    const viewport = element();
    const media = { matches: false, addEventListener(name, fn) { this.change = fn; } };
    const ctx = vm.createContext({
        document: { getElementById: id => id === 'map-resize-handle' ? divider : element() },
        workspaceViewport: viewport, window: { matchMedia: () => media }, activeView: 'split', map: null,
        ResizeObserver: class { observe() {} }, requestAnimationFrame() {},
        listenMedia: (media, listener) => media.addEventListener('change', listener),
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

function oddContext() {
    const ctx = vm.createContext({ oddFindsCache: new Map() });
    vm.runInContext(appFunction('classifyOddFind') + appFunction('selectOddFinds'), ctx);
    return ctx;
}

test('Odd Finds identify actual unusual features and retain verbatim supporting evidence', () => {
    const ctx = oddContext();
    const listings = JSON.parse(readFileSync(join(__dirname, '..', 'properties.json'), 'utf8'));
    const expected = {
        prop_7934e284b2b9: 'shelter', prop_3aaa8825bddc: 'silo', prop_d9ed688d5408: 'church',
        prop_afbda4eafb6d: 'speakeasy', prop_00c088811b5e: 'hidden-room', prop_dfa6447b4b00: 'pool-room',
        prop_64b00e544b29: 'treehouse', prop_18f2c011ca0e: 'climbing', prop_691d0cb4a28f: 'a-frame',
        prop_42d20132e911: 'airstrip', prop_e552e9d5184b: 'island',
    };
    for (const [id, key] of Object.entries(expected)) {
        const property = listings.find(p => p.id === id);
        const feature = ctx.classifyOddFind(property);
        assert.equal(feature?.key, key, id);
        assert.ok(property.description.includes(feature.evidence), `Evidence must come from ${id}`);
    }
    const church = ctx.classifyOddFind(listings.find(p => p.id === 'prop_d9ed688d5408'));
    assert.match(church.note, /City approval/);
    const runway = ctx.classifyOddFind(listings.find(p => p.id === 'prop_42d20132e911'));
    assert.match(runway.label, /Community/);
});

test('Odd Finds reject community pools, nearby churches, landmarks, and treehouse metaphors', () => {
    const ctx = oddContext();
    const descriptions = [
        'Unique luxury home with incredible charm.',
        'The community lodge offers an indoor pool and climbing wall.',
        'Backs to a church-owned field.',
        'Enjoy views of the Capitol dome and Tacoma Dome.',
        'A deck where you feel like you are living in a treehouse.',
        'Welcome to The Treehouse Retreat, a hidden gem.',
        'Space for a potential indoor pool, a future treehouse, or an A-frame shed.',
        'Imagine building an A-frame home on the neighboring lot.',
    ];
    for (const description of descriptions) assert.equal(ctx.classifyOddFind({ description }), null, description);
    assert.equal(ctx.classifyOddFind({ city: 'Spokane', description: 'Take a private ferry to nearby Hat Island.' }), null);
});

test('Odd Finds respect supplied filtered order, cap repeats, and refresh cached descriptions', () => {
    const ctx = oddContext();
    const properties = Array.from({ length: 5 }, (_, i) => ({ id: `s${i}`, description: 'There is a bomb shelter downstairs.' }));
    const selection = ctx.selectOddFinds(properties);
    assert.equal(selection.length, 3);
    assert.deepEqual(Array.from(selection, x => x.property.id), ['s0', 's1', 's2']);
    assert.deepEqual(Array.from(ctx.selectOddFinds(properties.slice(3)), x => x.property.id), ['s3', 's4']);
    assert.equal(ctx.selectOddFinds([]).length, 0);
    properties[0].description = 'An ordinary house.';
    assert.equal(ctx.selectOddFinds(properties.slice(0, 1)).length, 0);
    properties[0].description = 'A hidden speakeasy lounge awaits.';
    assert.equal(ctx.selectOddFinds(properties.slice(0, 1))[0].feature.key, 'speakeasy');
});
