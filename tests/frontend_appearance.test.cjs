// Run: node --test tests/frontend_*.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');
const source = readFileSync(join(__dirname, '..', 'app.js'), 'utf8');
function fn(name) {
    const functions = [...source.matchAll(/^    (?:async )?function (\w+)\(/gm)];
    const index = functions.findIndex(m => m[1] === name);
    assert.ok(index >= 0, name);
    return source.slice(functions[index].index, functions[index + 1]?.index);
}
function context(functions, globals) {
    const ctx = vm.createContext(globals);
    vm.runInContext(functions.map(fn).join('\n'), ctx);
    return ctx;
}

test('theme toggles immediately, sets native chrome and survives unavailable storage', () => {
    const attrs = {};
    const meta = {};
    const root = { dataset: { theme: 'light' } };
    const ctx = context(['applyTheme', 'toggleTheme'], {
        STORAGE_THEME_KEY: 'theme',
        localStorage: { setItem() { throw new Error('storage blocked'); } },
        document: { documentElement: root, getElementById: () => ({ setAttribute(k, v) { attrs[k] = v; } }),
            querySelector: () => ({ setAttribute(k, v) { meta[k] = v; } }) },
    });
    ctx.toggleTheme();
    assert.equal(root.dataset.theme, 'dark');
    assert.equal(attrs['aria-pressed'], 'true');
    assert.equal(meta.content, '#17212b');
    ctx.toggleTheme();
    assert.equal(root.dataset.theme, 'light');
    assert.equal(attrs['aria-pressed'], 'false');
});

test('first paint uses saved appearance or system preference, including restricted storage', () => {
    const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');
    const boot = html.match(/<script>([\s\S]*?)<\/script>/)[1];
    for (const [saved, system, expected] of [['light', true, 'light'], ['dark', false, 'dark'],
        [null, true, 'dark'], ['invalid', false, 'light'], ['blocked', true, 'dark']]) {
        const document = { documentElement: { dataset: {} } };
        vm.runInNewContext(boot, { document, matchMedia: () => ({ matches: system }),
            localStorage: { getItem() { if (saved === 'blocked') throw new Error(); return saved; } } });
        assert.equal(document.documentElement.dataset.theme, expected);
    }
});

test('static hosting never probes or advertises the scraper', async () => {
    const ctx = context(['detectBackendCapabilities'], {
        API_CANDIDATE: false, fetch() { assert.fail('static site must not probe the API'); },
    });
    await ctx.detectBackendCapabilities();
});

test('backend capability detection requires a writable, authorized, healthy server', async () => {
    for (const [health, expected] of [
        [{ status: 'ok', read_only: false, scraping_authorized: true }, true],
        [{ status: 'ok', read_only: true, scraping_authorized: true }, false],
        [{ status: 'ok', read_only: false, scraping_authorized: false }, false],
        [{ status: 'something-else', read_only: false, scraping_authorized: true }, false],
    ]) {
        let hidden = true;
        const ctx = context(['fetchJson', 'detectBackendCapabilities'], {
            API_CANDIDATE: true, API_WRITES_ENABLED: false, scraperAvailable: false,
            AbortSignal: { timeout: () => null },
            AbortController, setTimeout, clearTimeout,
            fetch: async () => ({ ok: true, json: async () => health }),
            document: { getElementById: () => ({ classList: { toggle: (_, value) => { hidden = value; } } }) },
        });
        await ctx.detectBackendCapabilities();
        assert.equal(ctx.scraperAvailable, expected);
        assert.equal(hidden, !expected);
        assert.equal(ctx.API_WRITES_ENABLED, health.status === 'ok' && !health.read_only);
    }
});

test('preset panel stays inside mobile, tablet, desktop and short viewports', () => {
    for (const [width, height, right, bottom] of [[375, 812, 370, 56], [768, 500, 600, 56],
        [1280, 900, 800, 56], [320, 160, 315, 140]]) {
        const panel = { style: {}, classList: { toggle() {} }, querySelector: () => ({ focus() {} }) };
        const attrs = {};
        const ctx = context(['setPresetMenuOpen'], {
            presetDropdownMenu: panel, window: { innerWidth: width, innerHeight: height },
            document: { getElementById: () => null }, btnSaveCurrentPreset: null,
            btnPresetsMenu: { setAttribute: (k, v) => { attrs[k] = v; },
                getBoundingClientRect: () => ({ right, bottom }), focus() {} },
        });
        ctx.setPresetMenuOpen(true);
        const left = parseFloat(panel.style.left), top = parseFloat(panel.style.top);
        assert.ok(left >= 8);
        assert.ok(left + Math.min(320, width - 16) <= width - 8);
        assert.ok(top + parseFloat(panel.style.maxHeight) <= height - 8);
        ctx.setPresetMenuOpen(false);
        assert.equal(attrs['aria-expanded'], 'false');
    }
});

test('rapid note editing across homes saves both local notes before the debounce fires', () => {
    const a = { id: 'a' }, b = { id: 'b' }, saved = {};
    const ctx = context(['saveDrawerNotesDebounced'], {
        selectedPropId: 'a', getPropertyById: id => id === 'a' ? a : b,
        drawerNotesTextarea: { value: 'First private note' }, drawerNoteStatus: {},
        persistUserData: (id, patch) => { saved[id] = patch; }, API_WRITES_ENABLED: false,
        noteSaveTimers: new Map(), clearTimeout() {}, setTimeout() { return 1; },
    });
    ctx.saveDrawerNotesDebounced();
    ctx.selectedPropId = 'b';
    ctx.drawerNotesTextarea.value = 'Second private note';
    ctx.saveDrawerNotesDebounced();
    assert.equal(saved.a.user_notes, 'First private note');
    assert.equal(saved.b.user_notes, 'Second private note');
    assert.ok(a._searchCorpus.includes('first private note'));
});

test('semantic text colors meet AA contrast on both primary and tinted surfaces', () => {
    const css = readFileSync(join(__dirname, '..', 'theme.css'), 'utf8');
    const sections = css.split(':root[data-theme="dark"]');
    const base = { '--bg-surface': '#ffffff', '--bg-page': '#f8fafc', '--bg-surface-secondary': '#f1f5f9',
        '--text-primary': '#0f172a', '--text-secondary': '#334155', '--brand-primary': '#24547a' };
    const tokens = section => Object.fromEntries([...section.matchAll(/(--[\w-]+):\s*(#[a-fA-F0-9]{6})/g)].map(m => [m[1], m[2]]));
    const light = { ...base, ...tokens(sections[0]) };
    const dark = { ...light, ...tokens(sections[1].slice(0, sections[1].indexOf('}'))) };
    const luminance = hex => hex.slice(1).match(/../g).map(c => parseInt(c, 16) / 255)
        .map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4)
        .reduce((sum, c, i) => sum + c * [.2126, .7152, .0722][i], 0);
    for (const theme of [light, dark]) {
        const pairs = ['positive', 'warning', 'info', 'negative', 'violet', 'odd'].map(c => [`--${c}-ink`, `--${c}-bg`]);
        for (const ink of ['--text-primary', '--text-secondary', '--text-muted', '--brand-primary']) {
            pairs.push([ink, '--bg-surface'], [ink, '--bg-surface-secondary']);
        }
        for (const [ink, bg] of pairs) {
            const a = luminance(theme[ink]), b = luminance(theme[bg]);
            const ratio = (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
            assert.ok(ratio >= 4.5, `${ink} on ${bg}: ${ratio.toFixed(2)}`);
        }
    }
});
