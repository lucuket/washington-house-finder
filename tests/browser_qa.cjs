/* Optional real-browser regression runner. No production dependencies.
 * WHS_PLAYWRIGHT: installed Playwright module; WHS_BROWSER_EXECUTABLE: browser.
 * Run: node tests/browser_qa.cjs
 */
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const { chromium, firefox, webkit } = require(process.env.WHS_PLAYWRIGHT || 'playwright');
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'qa-artifacts', 'performance-review');
const mime = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css', '.json':'application/json', '.svg':'image/svg+xml', '.png':'image/png' };
const errors = [], failedLocalRequests = [], checks = [];
let server, browser;
let listingCount;
const image = '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="375"><rect width="600" height="375" fill="#dce3e8"/></svg>';
async function ready(page) { await page.waitForFunction(count => document.querySelectorAll('.property-card').length > 0 && Number(document.querySelector('#total-count-badge').textContent) === count, listingCount); }
async function visible(page, selector) { await page.locator(selector).waitFor({state:'visible'}); }
async function hidden(page, selector) { await page.locator(selector).waitFor({state:'hidden'}); }
async function openPage(context, scenario, init) {
  const page = await context.newPage();
  page.on('pageerror', e => {errors.push({scenario, message:e.message});console.error('PAGE ERROR',scenario,e.message);});
  page.on('response', r => { if (r.url().startsWith('http://127.0.0.1:') && r.status() >= 400) failedLocalRequests.push({scenario,url:r.url(),status:r.status()}); });
  if (init) await page.addInitScript(init);
  return page;
}
async function check(name, run) { await run(); checks.push(name); console.log('PASS', name); }
(async () => {
  await fs.mkdir(out, {recursive:true});
  const listings = JSON.parse(await fs.readFile(path.join(root,'properties.json'),'utf8'));
  listingCount = listings.length;
  server = http.createServer(async (req,res) => {
    const name = decodeURIComponent(new URL(req.url,'http://localhost').pathname).replace(/^\//,'') || 'index.html';
    const file = path.resolve(root,name);
    if (!file.startsWith(root + path.sep)) { res.writeHead(403);res.end();return; }
    try { const body = await fs.readFile(file);res.writeHead(200, {'Content-Type':mime[path.extname(file)] || 'text/plain','Cache-Control':'no-store'});res.end(body); }
    catch { res.writeHead(404);res.end(); }
  });
  const port = Number(process.env.WHS_QA_PORT || 8018);
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${port}`;
  const engine = process.env.WHS_BROWSER || 'chromium';
  browser = await ({chromium,firefox,webkit})[engine].launch({headless:true, ...(process.env.WHS_BROWSER_EXECUTABLE ? {executablePath:process.env.WHS_BROWSER_EXECUTABLE} : {})});
  const context = await browser.newContext({viewport:{width:1280,height:900}});
  // Keep regression tests deterministic. A separate smoke run checks live images.
  await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, route => route.fulfill({status:200,contentType:'image/svg+xml',body:image}));
  const page = await openPage(context, 'workflows');
  await page.goto(base); await ready(page);
  await check('compact source loads once; no full JSON or offline bundle downloaded', async () => {
    assert.equal(await page.locator('.property-card').count(),28);
    const names=await page.evaluate(()=>performance.getEntriesByType('resource').map(r=>r.name));
    assert.equal(names.filter(n=>n.includes('properties.compact.json')).length,1);
    assert.ok(!names.some(n=>/\/(properties\.json|data\.js)(\?|$)/.test(n)));
    assert.ok(await page.evaluate(()=>typeof L.markerClusterGroup === 'function'));
  });
  await check('city filters, all sort controls, keyword search and reset', async () => {
    await page.selectOption('#city-select','everett');
    assert.equal(Number(await page.locator('#matched-count-badge').textContent()),listings.filter(p=>p.city.toLowerCase()==='everett').length);
    for(const value of await page.locator('#sort-dropdown option').evaluateAll(opts=>opts.map(o=>o.value))) await page.selectOption('#sort-dropdown',value);
    await page.fill('#search-input','no-such-address-performance-review');
    await visible(page,'#empty-state-notice');
    await page.click('#btn-empty-reset');await ready(page);
    assert.equal(Number(await page.locator('#matched-count-badge').textContent()),listingCount);
  });
  let id;
  await check('favorites, notes and ratings survive reload and remain searchable', async () => {
    id=(await page.locator('.property-card').first().getAttribute('id')).replace('card-','');
    await page.locator(`#card-${id} .card-favorite-btn`).click();
    await page.locator(`#card-${id} .card-view-drawer-btn`).click();
    await visible(page,'#property-detail-drawer');
    await page.fill('#drawer-notes-textarea','qa-performance-private-note');
    await page.locator('.star-picker-interactive [data-val="4"]').click();
    await page.keyboard.press('Escape');
    await page.reload();await ready(page);
    await page.fill('#search-input','qa-performance-private-note');
    await page.waitForFunction(()=>document.querySelectorAll('.property-card').length===1);
    assert.equal(await page.locator('.card-favorite-btn').getAttribute('aria-pressed'),'true');
    assert.equal(await page.locator('.card-star-rating .star[aria-pressed="true"]').getAttribute('data-rate'),'4');
    await page.click('#btn-reset-filters');
  });
  await check('gallery, nested lightbox, Escape and focused notes are stable', async () => {
    await page.locator('.card-view-drawer-btn').first().click();
    await page.click('#btn-drawer-img-next');
    assert.equal(await page.locator('#drawer-img-cur').textContent(),'2');
    await page.click('#btn-drawer-fullscreen');await visible(page,'#photo-lightbox-modal');
    await page.click('#btn-lightbox-next');
    await page.keyboard.press('Escape');await hidden(page,'#photo-lightbox-modal');
    await visible(page,'#property-detail-drawer');
    await page.keyboard.press('Escape');await hidden(page,'#property-detail-drawer');
  });
  await check('compare matrix, clearing comparison and global mortgage assumptions', async () => {
    await page.locator('.compare-check').nth(0).check();await page.locator('.compare-check').nth(1).check();
    await page.click('#btn-open-comparison-matrix');await visible(page,'#comparison-modal');
    assert.ok((await page.locator('#comparison-table-wrapper').textContent()).includes('Private Notes'));
    await page.keyboard.press('Escape');
    await page.click('#btn-compare-clear');
    assert.equal(await page.locator('.compare-check:checked').count(),0);
    await page.locator('.card-mortgage-badge').first().click();
    await page.fill('#calc-interest-rate','0');await page.fill('#calc-down-pct','100');
    assert.equal((await page.locator('#calc-val-pi').textContent()).trim(),'$0/mo');
    await page.keyboard.press('Escape');
    await page.reload();await ready(page);
    await page.locator('.card-mortgage-badge').first().click();
    assert.equal(await page.inputValue('#calc-interest-rate'),'0');
    await page.fill('#calc-interest-rate','6.65');await page.fill('#calc-down-pct','20');
    await page.keyboard.press('Escape');
  });
  await check('map/listing synchronization, bounds, all views and hidden gallery deferral', async () => {
    await page.click('#view-tab-split');await visible(page,'.leaflet-container');
    await page.selectOption('#city-select','everett');
    await page.click('#btn-map-fit-results');
    await page.locator('.property-card').first().hover();
    assert.ok(await page.locator('.leaflet-marker-icon').count()>0);
    await page.click('#view-tab-map');
    const before=await page.locator('#cards-grid').getAttribute('data-render-ms');
    await page.selectOption('#city-select','spokane');
    assert.equal(await page.locator('#cards-grid').getAttribute('data-render-ms'),before);
    await page.click('#view-tab-grid');
    assert.ok((await page.locator('.card-city-zip').first().textContent()).includes('Spokane'));
    for(const view of ['deals','analytics','odd','grid']) await page.click('#view-tab-'+view);
    await page.click('#btn-reset-filters');
  });
  await check('saved searches, command palette, keyboard focus and CSV export', async () => {
    await page.click('#btn-presets-menu');await visible(page,'#preset-dropdown-menu');
    await page.click('[data-preset="three-garage"]');
    assert.ok(Number(await page.locator('#matched-count-badge').textContent())<listingCount);
    await page.click('#btn-reset-filters');
    await page.keyboard.press('Control+k');await visible(page,'#cmd-palette-modal');
    await page.fill('#cmd-palette-input','Everett');
    assert.ok((await page.locator('#cmd-palette-results').textContent()).includes('Everett'));
    await page.keyboard.press('Escape');
    const download=page.waitForEvent('download');await page.click('#btn-export-csv');
    assert.ok((await download).suggestedFilename().endsWith('.csv'));
  });
  for(const width of [375,768,1280,1920]) await check(`responsive light/dark layout at ${width}px`, async () => {
    await page.setViewportSize({width,height:900});
    for(const theme of ['light','dark']) {
      await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      if(width<=768) {
        await page.click('#btn-mobile-filters');await visible(page,'#app-sidebar.mobile-open');await page.click('#btn-mobile-sidebar-close');
        await page.locator('#app-sidebar').evaluate(el=>Promise.all(el.getAnimations().map(a=>a.finished.catch(()=>{}))));
        assert.ok(await page.locator('#app-sidebar').evaluate(el=>el.getBoundingClientRect().right<=1));
        assert.equal(await page.locator('#app-sidebar').evaluate(el=>getComputedStyle(el).boxShadow),'none');
      }
      else await page.click('#view-tab-grid');
      await page.screenshot({path:path.join(out,`${engine}-${width}-${theme}.png`)});
    }
  });
  await check('legacy browser APIs and denied storage preserve core research', async () => {
    const legacy=await openPage(context,'legacy APIs',()=>{
      AbortSignal.timeout=undefined;
      Array.prototype.at=undefined;
      window.ResizeObserver=undefined;
      const native=window.matchMedia.bind(window);
      window.matchMedia=query=>{const media=native(query);media.addEventListener=undefined;return media;};
      Object.defineProperty(window,'localStorage',{get(){throw new DOMException('Storage denied','SecurityError');}});
      Object.defineProperty(navigator,'clipboard',{value:undefined,configurable:true});
    });
    await legacy.goto(base);
    await ready(legacy).catch(async error => { console.error('Legacy load status', await legacy.locator('#results-count-label').textContent()); throw error; });
    await legacy.locator('.card-view-drawer-btn').first().click();
    await legacy.click('#btn-copy-address');
    await legacy.fill('#drawer-notes-textarea','session note');
    await legacy.keyboard.press('Escape');
    await legacy.click('#view-tab-split');await visible(legacy,'.leaflet-container');
    await legacy.close();
  });
  await check('malformed compact payload falls back to the original JSON', async () => {
    const fallback=await openPage(context,'fallback');
    await fallback.route('**/properties.compact.json*',r=>r.fulfill({contentType:'application/json',body:'{"format":"unknown"}'}));
    await fallback.goto(base);await ready(fallback);await fallback.close();
  });
  await check('slow optional coverage never blocks listings or interrupts note editing', async () => {
    const delayed=await openPage(context,'delayed coverage');
    let release;
    const gate=new Promise(resolve=>release=resolve);
    await delayed.route('**/data/ispmap_top_deals.json',async route=>{await gate;await route.continue();});
    await delayed.goto(base);await ready(delayed);
    assert.ok((await delayed.locator('.card-broadband-block').first().textContent()).includes('Loading coverage'));
    await delayed.evaluate(()=>window.__firstCard=document.querySelector('.property-card'));
    await delayed.locator('.card-view-drawer-btn').first().click();
    await delayed.fill('#drawer-notes-textarea','qa-delayed-coverage-note');
    release();
    await delayed.waitForFunction(()=>!document.querySelector('.card-broadband-block').textContent.includes('Loading coverage'));
    assert.equal(await delayed.inputValue('#drawer-notes-textarea'),'qa-delayed-coverage-note');
    assert.equal(await delayed.evaluate(()=>document.activeElement.id),'drawer-notes-textarea');
    assert.ok(await delayed.evaluate(()=>window.__firstCard===document.querySelector('.property-card')));
    await delayed.close();
  });
  await check('file preview loads the complete offline bundle with external services blocked', async () => {
    const file=await openPage(context,'file preview');
    await file.goto('file:///'+path.join(root,'index.html').replace(/\\/g,'/'));await ready(file);
    await file.locator('.card-view-drawer-btn').first().click();await visible(file,'#property-detail-drawer');await file.close();
  });
  assert.deepEqual(errors,[],'unhandled application errors');
  assert.deepEqual(failedLocalRequests,[],'failed local requests');
  await fs.writeFile(path.join(out,`browser-${engine}.json`),JSON.stringify({engine,browserVersion:browser.version(),listingCount,checks,errors,failedLocalRequests},null,2));
  console.log(`${checks.length} browser checks passed in ${engine}`);
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();if(server)await new Promise(r=>server.close(r));});
