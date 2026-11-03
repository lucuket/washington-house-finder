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
    vm.runInContext(['hasListingMetric', 'listingMetric', 'listingHoa', 'computeMarketMedians', 'calculateValueSignals', 'computeExecutiveDealEvaluation', 'computeSmartScore', 'applyFilters', 'sortFilteredProperties']
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

test('deal evaluation and value signals memoize and invalidate on metric changes', () => {
    const ctx = context();
    const p = { ...ctx.allProperties[0] };
    const firstEval = ctx.computeExecutiveDealEvaluation(p);
    const secondEval = ctx.computeExecutiveDealEvaluation(p);
    assert.equal(firstEval, secondEval, 'unchanged listing reuses cached deal evaluation object');
    const firstSignals = ctx.calculateValueSignals(p);
    const secondSignals = ctx.calculateValueSignals(p);
    assert.equal(firstSignals, secondSignals, 'unchanged listing reuses cached value signals array');
    p.price = Math.round(p.price * 0.75);
    const updatedEval = ctx.computeExecutiveDealEvaluation(p);
    const updatedSignals = ctx.calculateValueSignals(p);
    assert.notEqual(updatedEval, firstEval, 'price change invalidates cached deal evaluation');
    assert.notEqual(updatedSignals, firstSignals, 'price change invalidates cached value signals');
});

test('deal caches refresh when benchmarks or metric verification change', () => {
    const ctx = context();
    const p = { ...ctx.allProperties[0], unknown_fields: [] };
    const first = ctx.computeExecutiveDealEvaluation(p);
    const signals = ctx.calculateValueSignals(p);
    ctx.cityMedians[p.city].ppsqft += 100;
    const benchmarkChanged = ctx.computeExecutiveDealEvaluation(p);
    assert.notEqual(benchmarkChanged, first);
    assert.notEqual(ctx.calculateValueSignals(p), signals);
    ctx.cityMedians[p.city].count += 1;
    const countChanged = ctx.computeExecutiveDealEvaluation(p);
    assert.notEqual(countChanged, benchmarkChanged);
    assert.match(countChanged.narrative, new RegExp(`${ctx.cityMedians[p.city].count} listings`));
    p.unknown_fields.push('sqft');
    const unverified = ctx.computeExecutiveDealEvaluation(p);
    assert.notEqual(unverified, countChanged);
    assert.equal(unverified.hasBenchmark, false);
    assert.equal(unverified.factors.space.desc, 'Unknown SqFt');
});

test('unverified metrics never produce deal advantages or positive value signals', () => {
    const ctx = context();
    for (const sqft of [0, 3000]) {
        const p = { ...ctx.allProperties[0], sqft, lot_sqft: 43560, garage: 3, hoa: 25, year_built: 2025,
            unknown_fields: ['sqft', 'lot_sqft', 'garage', 'hoa', 'year_built'] };
        const evaluation = ctx.computeExecutiveDealEvaluation(p);
        assert.equal(evaluation.hasBenchmark, false);
        assert.equal(evaluation.ppsqft, null);
        assert.equal(evaluation.estDollarSavings, 0);
        assert.equal(evaluation.factors.price.desc, 'Benchmark unavailable');
        for (const factor of Object.values(evaluation.factors)) assert.equal(factor.score, 50);
        assert.equal(ctx.calculateValueSignals(p).length, 0);
    }
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

test('record baseline and memoized deal evaluation throughput', t => {
    const baseline = execFileSync('git', ['show', 'HEAD:app.js'], { encoding: 'utf8', maxBuffer: 1000000 });
    const measure = text => {
        const ctx = context(text);
        vm.runInContext(`var durations = []; for (var i = 0; i < 30; i++) {
            var start = performance.now();
            for (var p of allProperties) { computeExecutiveDealEvaluation(p); calculateValueSignals(p); }
            if (i >= 10) durations.push(performance.now() - start);
        } durations.sort((a,b) => a-b);`, ctx);
        return ctx.durations[Math.floor(ctx.durations.length / 2)].toFixed(2);
    };
    t.diagnostic(`4,225 listings, median of 20 warmed runs, no DOM: baseline ${measure(baseline)}ms; current ${measure(source)}ms`);
});
