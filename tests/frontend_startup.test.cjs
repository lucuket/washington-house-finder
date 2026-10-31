const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');
const source = readFileSync(join(__dirname, '..', 'app.js'), 'utf8');
function fn(name) {
    const start = source.indexOf(`function ${name}(`);
    assert.ok(start >= 0, name);
    const asyncStart = source.slice(start - 6, start) === 'async ' ? start - 6 : start;
    return source.slice(asyncStart, source.indexOf('\n    }', start) + 6);
}

test('compact startup expands galleries on first use and retains every source field/photo', () => {
    const ctx = vm.createContext({});
    vm.runInContext(fn('decodeListingPayload'), ctx);
    const packed = JSON.parse(readFileSync(join(__dirname, '..', 'properties.compact.json'), 'utf8'));
    const source = JSON.parse(readFileSync(join(__dirname, '..', 'properties.json'), 'utf8'));
    const decoded = ctx.decodeListingPayload(packed);
    const i = packed.listings.findIndex(p => Array.isArray(p.photos[2]));
    assert.equal(typeof Object.getOwnPropertyDescriptor(decoded[i], 'photos').get, 'function');
    const photos = decoded[i].photos;
    assert.equal(decoded[i].photos, photos, 'gallery expansion is memoized');
    assert.equal(Object.getOwnPropertyDescriptor(decoded[i], 'photos').get, undefined);
    assert.deepEqual(JSON.parse(JSON.stringify(decoded)), source);
    decoded[0].favorite = !source[0].favorite;
    assert.equal(packed.listings[0].favorite, source[0].favorite, 'research never mutates the source');
    assert.deepEqual(JSON.parse(JSON.stringify(ctx.decodeListingPayload(source))), source);
});

test('malformed compact data is rejected so the loader can try the legacy source', () => {
    const ctx = vm.createContext({});
    vm.runInContext(fn('decodeListingPayload'), ctx);
    for (const input of [null, {}, { format: 'future', listings: [] }, [null],
        { format: 'whs-photos-v1', listings: [{ id: 'a', photos: [null, 'suffix', ['part']] }] }]) {
        assert.throws(() => ctx.decodeListingPayload(input));
    }
});

test('JSON deadlines work without AbortSignal.timeout and clear timers after decoding/failure', async () => {
    for (const mode of ['ok', 'http-error', 'body-error', 'timeout']) {
        let deadline, cleared = 0, signal;
        const ctx = vm.createContext({ AbortController,
            setTimeout(fn) { deadline = fn; return 7; }, clearTimeout(id) { assert.equal(id, 7); cleared++; },
            fetch: async (_, options) => { signal = options.signal; return {
                ok: mode !== 'http-error', status: 503,
                json: async () => {
                    assert.equal(cleared, 0, 'deadline covers JSON body consumption');
                    if (mode === 'timeout') { deadline(); throw new Error('aborted'); }
                    if (mode === 'body-error') throw new Error('invalid JSON');
                    return { loaded: true };
                }
            }; }
        });
        vm.runInContext(fn('fetchJson'), ctx);
        if (mode === 'ok') assert.equal((await ctx.fetchJson('data')).loaded, true);
        else await assert.rejects(ctx.fetchJson('data'));
        assert.equal(cleared, 1);
        assert.equal(signal.aborted, mode === 'timeout');
    }
});

test('responsive listeners support modern and older Safari MediaQueryList APIs', () => {
    const ctx = vm.createContext({}); vm.runInContext(fn('listenMedia'), ctx);
    let modern = 0, legacy = 0;
    const listener = () => {};
    ctx.listenMedia({ addEventListener(type, fn) { assert.equal(type, 'change'); assert.equal(fn, listener); modern++; } }, listener);
    ctx.listenMedia({ addListener(fn) { assert.equal(fn, listener); legacy++; } }, listener);
    assert.equal(modern, 1); assert.equal(legacy, 1);
});
