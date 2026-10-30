const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { performance } = require('node:perf_hooks');
const vm = require('node:vm');
const source = readFileSync(join(__dirname, '..', 'app.js'), 'utf8');
function fn(name) {
    const functions = [...source.matchAll(/^    (?:async )?function (\w+)\(/gm)];
    const index = functions.findIndex(match => match[1] === name);
    assert.ok(index >= 0, name);
    const start = functions[index].index;
    return source.slice(start, source.indexOf('\n    }', start) + 6);
}
function context(names, values = {}) {
    const ctx = vm.createContext({ Promise, Map, Set, performance, URLSearchParams, ...values });
    vm.runInContext(names.map(fn).join('\n'), ctx);
    return ctx;
}

test('bookmarked filters round-trip rating and price per sqft and reject malformed state', () => {
    const defaults = source.match(/const FILTER_DEFAULTS = Object.freeze\((\{[\s\S]*?\})\)/)[1];
    const ctx = context(['normalizeFilterState', 'syncStateToUrl', 'loadStateFromUrl'], {
        window: { location: { hash: '', pathname: '/' } }, activeView: 'grid',
        allProperties: [{ _cityLower: 'everett' }],
        syncFilterControls() {}, setViewMode(view) { ctx.activeView = view; },
        history: { replaceState(_, __, url) { ctx.window.location.hash = url.startsWith('#') ? url : ''; } }
    });
    vm.runInContext(`var FILTER_DEFAULTS = ${defaults}; var filterState = { ...FILTER_DEFAULTS };`, ctx);
    Object.assign(ctx.filterState, { maxPpsqft: 270, minRating: 4, city: 'everett', search: 'roof yard', sortBy: 'price_asc' });
    ctx.syncStateToUrl();
    const hash = ctx.window.location.hash;
    assert.match(hash, /maxPpsqft=270/);
    assert.match(hash, /minRating=4/);
    Object.assign(ctx.filterState, ctx.FILTER_DEFAULTS);
    ctx.loadStateFromUrl();
    assert.equal(ctx.filterState.maxPpsqft, 270);
    assert.equal(ctx.filterState.minRating, 4);
    assert.equal(ctx.filterState.search, 'roof yard');
    assert.equal(ctx.filterState.city, 'everett');
    const bad = ctx.normalizeFilterState({ minPrice: Infinity, maxPrice: -50, minRating: 100,
        city: 'does not exist', sortBy: 'invalid', maxPpsqft: 'oops', mapBoundsOnly: true });
    assert.ok(bad.minPrice < bad.maxPrice);
    assert.equal(bad.minRating, 5);
    assert.equal(bad.city, 'all');
    assert.equal(bad.sortBy, 'smart_score');
    assert.equal(bad.maxPpsqft, 500);
    assert.equal(bad.mapBoundsOnly, false);
});

test('note timers for different homes both sync and never report another home as saved', async () => {
    const properties = { a: { id: 'a' }, b: { id: 'b' } }, callbacks = new Map(), sent = [];
    let nextTimer = 0;
    const ctx = context(['saveDrawerNotesDebounced'], {
        selectedPropId: 'a', drawerNotesTextarea: { value: '  First note\n' }, drawerNoteStatus: {},
        getPropertyById: id => properties[id], persistUserData: () => true,
        API_WRITES_ENABLED: true, noteSaveTimers: new Map(),
        clearTimeout: id => callbacks.delete(id), setTimeout: callback => { callbacks.set(++nextTimer, callback); return nextTimer; },
        queueUserUpdate: async (id, update) => { sent.push([id, update.user_notes]); return true; }, applyFilters() {}
    });
    ctx.saveDrawerNotesDebounced();
    ctx.selectedPropId = 'b'; ctx.drawerNotesTextarea.value = 'Second note';
    ctx.saveDrawerNotesDebounced();
    assert.equal(callbacks.size, 2);
    await callbacks.get(1)();
    assert.equal(ctx.drawerNoteStatus.textContent, 'Saved locally; syncing…');
    await callbacks.get(2)();
    assert.equal(ctx.drawerNoteStatus.textContent, 'Saved to server');
    assert.deepEqual(sent, [['a', '  First note\n'], ['b', 'Second note']]);
});

test('server saves for one home are serialized, including after a failed request', async () => {
    const requests = [], completions = [];
    const ctx = context(['queueUserUpdate'], {
        API_WRITES_ENABLED: true, apiSaveQueues: new Map(), AbortSignal,
        showToast() {}, fetch: (_, options) => {
            requests.push(JSON.parse(options.body));
            return new Promise(resolve => completions.push(resolve));
        }
    });
    const first = ctx.queueUserUpdate('a', { rating: 1 });
    const second = ctx.queueUserUpdate('a', { rating: 5 });
    await Promise.resolve();
    assert.equal(requests.length, 1);
    completions[0]({ ok: false, status: 500 });
    assert.equal(await first, false);
    await Promise.resolve();
    assert.equal(requests.length, 2);
    completions[1]({ ok: true });
    assert.equal(await second, true);
    assert.deepEqual(requests, [{ rating: 1 }, { rating: 5 }]);
    assert.equal(ctx.apiSaveQueues.size, 0);
});

test('unavailable storage preserves research for the session and reports the failure', () => {
    let warnings = 0;
    const ctx = context(['getUserDataRegistry', 'persistUserData'], {
        STORAGE_USER_DATA_KEY: 'test', userDataCache: null, storageWarningShown: false,
        localStorage: { getItem: () => null, setItem() { throw new Error('quota'); } },
        showToast() { warnings++; }
    });
    assert.equal(ctx.persistUserData('a', { favorite: true }), false);
    ctx.persistUserData('a', { user_notes: 'Keep my note' });
    assert.equal(ctx.getUserDataRegistry().a.favorite, true);
    assert.equal(ctx.getUserDataRegistry().a.user_notes, 'Keep my note');
    assert.equal(warnings, 1);
});

test('mortgage calculations handle zero interest, all cash and invalid stored assumptions', () => {
    const ctx = context(['sanitizeMortgageAssumptions', 'calculateEstimatedMonthly'], {
        mortgageAssumptions: { downPct: 20, rate: 6, termYears: 30, taxRate: 1, insurance: 1200 }
    });
    assert.equal(ctx.calculateEstimatedMonthly(375000).pi, 1799);
    ctx.mortgageAssumptions.rate = 0;
    assert.equal(ctx.calculateEstimatedMonthly(375000).pi, 833);
    assert.equal(ctx.calculateEstimatedMonthly(375000, 0, 100).pi, 0);
    assert.equal(ctx.calculateEstimatedMonthly(0).total, 100);
    const bounded = ctx.sanitizeMortgageAssumptions({ downPct: 120, rate: -5, taxRate: Infinity, insurance: -20, termYears: 0 });
    assert.equal(bounded.downPct, 100); assert.equal(bounded.rate, 0);
    assert.equal(bounded.taxRate, 1.02); assert.equal(bounded.termYears, 30);
    assert.equal(bounded.insurance, 0);
});

test('unchanged map markers survive sorting and only changed pins are updated', () => {
    let created = 0, added = 0, removed = 0, iconUpdates = 0;
    const ctx = context(['updateMapMarkers'], {
        map: {}, markerInstances: {}, mapMarkerCount: { dataset: {} },
        document: { getElementById: () => ({ dataset: {} }) },
        markersLayer: { addLayers: markers => { added += markers.length; }, removeLayers: markers => { removed += markers.length; } },
        escapeHtml: value => value, highlightCard() {}, buildMarkerPopupHtml() {},
        L: { divIcon: data => data, marker: () => {
            created++;
            return { bindPopup() {}, on() {}, setLatLng() {}, setIcon() { iconUpdates++; } };
        } }
    });
    const a = { id: 'a', address: 'A', price: 400000, latitude: 47, longitude: -122 }, b = { ...a, id: 'b' };
    ctx.updateMapMarkers([a, b]);
    const original = ctx.markerInstances.a;
    ctx.updateMapMarkers([b, a]);
    assert.equal(created, 2); assert.equal(added, 2); assert.equal(removed, 0);
    assert.equal(ctx.markerInstances.a, original);
    a.favorite = true;
    ctx.updateMapMarkers([a]);
    assert.equal(created, 2); assert.equal(iconUpdates, 1); assert.equal(removed, 1);
    assert.match(ctx.mapMarkerCount.textContent, /1 mapped/);
});

test('existing cards are reused without rebuilding or moving unchanged DOM', () => {
    const a = { id: 'a' }, b = { id: 'b' };
    const cards = [a, b].map(p => ({ id: `card-${p.id}`, _listing: p, _renderKey: 'false:0:false:undefined:{}' }));
    let patched = 0;
    const ctx = context(['renderGalleryCards'], {
        cardsGrid: { dataset: {}, children: cards, querySelectorAll: () => cards, querySelector: () => null,
            classList: { remove() {} }, insertBefore() { throw new Error('unchanged card moved'); } },
        emptyStateNotice: { classList: { add() {} } }, mortgageAssumptions: {},
        filteredProperties: [a, b], currentCardLimit: 28,
        updateExistingCard() { patched++; },
        document: { createElement() { throw new Error('existing card rebuilt'); } }
    });
    ctx.renderGalleryCards(false);
    assert.equal(patched, 0);
    a.favorite = true;
    ctx.renderGalleryCards(false);
    assert.equal(patched, 1);
    assert.equal(ctx.cardsGrid.children[0], cards[0]);
});

test('Top Deals respects zero matches instead of falling back to all listings', () => {
    let evaluated = 0;
    const grid = { appendChild(node) { this.child = node; } };
    const ctx = context(['renderDealsView'], {
        currentDealCityFilter: 'all', filteredProperties: [], allProperties: [{ id: 'unmatched' }],
        dealsEvaluationGrid: grid, dealsTotalCount: {}, dealsAvgDiscount: {}, dealsAvgDollarSavings: {}, dealsTopCity: {},
        computeExecutiveDealEvaluation() { evaluated++; return { dealScore: 99 }; },
        document: { createElement: () => ({}) }
    });
    ctx.renderDealsView();
    assert.equal(evaluated, 0);
    assert.equal(ctx.dealsTotalCount.textContent, 0);
    assert.match(grid.child.textContent, /No homes match/);
});

test('market benchmark labels distinguish above, below, equal and unavailable', () => {
    const ctx = context(['benchmarkLabel']);
    assert.match(ctx.benchmarkLabel({ hasBenchmark: true, ppsqftPct: -12 }), /12% above/);
    assert.match(ctx.benchmarkLabel({ hasBenchmark: true, ppsqftPct: 12 }), /12% below/);
    assert.equal(ctx.benchmarkLabel({ hasBenchmark: true, ppsqftPct: 0 }), 'At median');
    assert.equal(ctx.benchmarkLabel({ hasBenchmark: false }), 'Benchmark unavailable');
});

test('clearing comparison updates retained checkboxes on every listing surface', () => {
    const checkboxes = ['a', 'b', 'a'].map(id => ({ dataset: { id }, checked: true }));
    const ctx = context(['syncComparisonControls'], {
        comparisonSet: new Set(['a', 'b']), document: { querySelectorAll: () => checkboxes }
    });
    ctx.comparisonSet.clear();
    ctx.syncComparisonControls();
    assert.ok(checkboxes.every(checkbox => !checkbox.checked));
    ctx.comparisonSet.add('a');
    ctx.syncComparisonControls();
    assert.deepEqual(checkboxes.map(checkbox => checkbox.checked), [true, false, true]);
});

test('photo thumbnails resize the CDN filename instead of relying on ignored query parameters', () => {
    const ctx = context(['thumbUrl']);
    assert.equal(ctx.thumbUrl('https://ap.rdcpix.com/abcod-w480_h360_x2.webp?w=600&q=75', 160),
        'https://ap.rdcpix.com/abcod-w160_h120_x1.webp?w=160&q=75');
    assert.equal(ctx.thumbUrl('https://other.example/photo.jpg', 160), 'https://other.example/photo.jpg');
});

test('drawer navigation follows the current sort after a rating moves the selected home', () => {
    const opened = [];
    const ctx = context(['stepDrawerProperty'], {
        filteredProperties: [{ id: 'c' }, { id: 'a' }, { id: 'b' }], selectedPropId: 'a',
        currentDrawerIndex: 0, openPropertyDrawer: id => opened.push(id), highlightCard() {}
    });
    ctx.stepDrawerProperty(1);
    assert.deepEqual(opened, ['b']);
    ctx.selectedPropId = 'excluded';
    ctx.stepDrawerProperty(1);
    assert.deepEqual(opened, ['b', 'c']);
});
