const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { execFileSync } = require('node:child_process');
const { performance } = require('node:perf_hooks');
const vm = require('node:vm');
const source = readFileSync(join(__dirname, '..', 'app.js'), 'utf8');
const listings = JSON.parse(readFileSync(join(__dirname, '..', 'properties.json'), 'utf8'));
function fn(text, name) {
    const functions = [...text.matchAll(/^    (?:async )?function (\w+)\(/gm)];
    const index = functions.findIndex(m => m[1] === name);
    assert.ok(index >= 0, name);
    return text.slice(functions[index].index, functions[index + 1]?.index);
}
function context(text = source) {
    const noop = () => {};
    const ctx = vm.createContext({ performance, allProperties: listings.map(p => ({ ...p,
        _cityLower: p.city.toLowerCase(), _ppsqft: Math.round(p.price / Math.max(1, p.sqft)),
        _searchCorpus: `${p.address} ${p.city} ${p.zip} ${p.description} ${p.user_notes || ''}`.toLowerCase(),
    })), filteredProperties: [], cityMedians: {}, marketMedians: {},
    scoreWeights: { ppsqft: 30, sqft: 15, lot: 15, garage: 10, year: 10, hoa: 10, rating: 10 },
    updateDualRangeTracks: noop, renderGalleryCards: noop, renderActiveFilterTags: noop,
    updateHeaderAndMarketStats: noop, renderDealsView: noop, renderOddFinds: noop, syncStateToUrl: noop,
    isMapVisible: () => false, mapMarkersDirty: false, map: null, activeView: 'grid', galleryDirty: false, galleryNeedsReset: false,
    getRegionalBroadbandDetails: () => ({ hasFiber: false, hasGigabit: false }),
    });
    const defaults = text.match(/const FILTER_DEFAULTS = Object.freeze\((\{[\s\S]*?\})\)/)[1];
    vm.runInContext(`const FILTER_DEFAULTS = ${defaults}; var filterState = { ...FILTER_DEFAULTS };`, ctx);
    vm.runInContext(['hasListingMetric', 'computeMarketMedians', 'computeSmartScore', 'applyFilters', 'sortFilteredProperties']
        .map(name => fn(text, name)).join('\n'), ctx);
    ctx.computeMarketMedians();
    return ctx;
}

test('all listing sorts preserve their order and all listings remain available', () => {
    const ctx = context();
    for (const [mode, field, direction] of [['price_asc', 'price', 1], ['price_desc', 'price', -1],
        ['sqft_desc', 'sqft', -1], ['lot_desc', 'lot_sqft', -1], ['year_desc', 'year_built', -1],
        ['rating_desc', 'rating', -1], ['price_per_sqft_asc', '_ppsqft', 1]]) {
        ctx.filterState.sortBy = mode;
        ctx.applyFilters();
        assert.equal(ctx.filteredProperties.length, 4225);
        const values = ctx.filteredProperties.map(p => p[field] || 0);
        for (let i = 1; i < values.length; i++) assert.ok((values[i] - values[i - 1]) * direction >= 0, mode);
    }
});

test('combined filters reject unknown metrics and match the real listing fields', () => {
    const ctx = context();
    Object.assign(ctx.filterState, { city: 'everett', minBeds: 3, maxPrice: 650000, maxHoa: 25, minYear: 1960 });
    ctx.applyFilters();
    const expected = listings.filter(p => p.city === 'Everett' && p.beds >= 3 && p.price <= 650000
        && !p.unknown_fields.includes('hoa') && p.hoa <= 25 && p.year_built >= 1960);
    assert.deepEqual(Array.from(ctx.filteredProperties, p => p.id).sort(), expected.map(p => p.id).sort());
    assert.ok(expected.length > 0);
});

test('map-area filtering excludes listings whose position cannot be verified', () => {
    const ctx = context();
    ctx.filterState.mapBoundsOnly = true;
    ctx.map = { getBounds: () => ({ contains: () => true }) };
    ctx.applyFilters();
    assert.ok(ctx.filteredProperties.length < listings.length);
    assert.ok(ctx.filteredProperties.every(p => p.latitude && p.longitude));
});

test('search covers notes and descriptions and reset restores the dataset', () => {
    const ctx = context();
    ctx.allProperties[0]._searchCorpus += ' qa-private-marker';
    ctx.filterState.search = 'qa-private-marker';
    ctx.applyFilters();
    assert.equal(ctx.filteredProperties.length, 1);
    ctx.filterState.search = 'nonexistent-address-qa';
    ctx.applyFilters();
    assert.equal(ctx.filteredProperties.length, 0);
    ctx.filterState.search = '';
    ctx.applyFilters();
    assert.equal(ctx.filteredProperties.length, 4225);
});

test('filtering hidden listing views defers cards until they become visible', () => {
    const ctx = context(); let renders = 0;
    ctx.renderGalleryCards = () => renders++;
    ctx.activeView = 'analytics';
    ctx.applyFilters();
    assert.equal(renders, 0);
    assert.equal(ctx.galleryDirty, true);
    assert.equal(ctx.galleryNeedsReset, true);
    ctx.activeView = 'grid';
    ctx.applyFilters();
    assert.equal(renders, 1);
    assert.equal(ctx.galleryDirty, false);
});

test('score cache invalidates when rating or score weights change', () => {
    const ctx = context();
    ctx.applyFilters();
    const p = ctx.allProperties[0], original = p._score;
    ctx.applyFilters();
    assert.equal(p._score, original);
    p.rating = 5;
    ctx.applyFilters();
    assert.notEqual(p._score, original);
    const rated = p._score;
    ctx.scoreWeights.rating = 100;
    ctx.applyFilters();
    assert.notEqual(p._score, rated);
    assert.deepEqual(p._score, ctx.computeSmartScore(p));
});

test('record baseline and current filtering/scoring/sorting throughput', t => {
    const baseline = execFileSync('git', ['show', 'HEAD:app.js'], { encoding: 'utf8', maxBuffer: 1000000 });
    const measure = text => {
        const ctx = context(text);
        vm.runInContext(`var durations = []; for (var i = 0; i < 30; i++) {
            var start = performance.now(); applyFilters();
            if (i >= 10) durations.push(performance.now() - start);
        } durations.sort((a,b) => a-b);`, ctx);
        return ctx.durations[Math.floor(ctx.durations.length / 2)].toFixed(2);
    };
    t.diagnostic(`4,225 listings, median of 20 warmed runs, rendering stubbed: baseline ${measure(baseline)}ms; current ${measure(source)}ms`);
});
