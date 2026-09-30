/* Drives two browser "devices" against a PostgREST stand-in backed by real
 * Postgres running schema.sql. */
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const mock = require('./mock-supabase.js');

const APP = process.env.BASE_URL || 'http://127.0.0.1:8123/index.html';
const PORT = 8555;
const API = 'http://127.0.0.1:' + PORT;
const KEY = 'test-anon-key';
const TODAY = (d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`)(new Date());

let fails = 0;
const ok = (c, m) => { console.log((c ? '  PASS  ' : '  FAIL  ') + m); if (!c) fails++; };

async function switchTo(page, who) {
  await page.click('.tab[data-view="settings"]');
  await page.waitForTimeout(120);
  await page.click(`[data-who="${who}"]`);
  await page.waitForTimeout(150);
  await page.click('.tab[data-view="today"]');
  await page.waitForTimeout(200);
}
let store;   // set once the mock is up

// Read a row the way the tests want to assert on it, whichever backend is used.
function rowValue(key) {
  const r = store.all().find(r => r.key === key);
  if (!r) return undefined;
  return r.value === null ? null : r.value;
}

async function device(browser, label, prefs) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on('pageerror', e => { console.log(`  [${label}] pageerror: ${e.message}`); fails++; });
  page.on('dialog', d => d.accept());
  await page.addInitScript(p => {
    localStorage.setItem('ac.prefs.v1', JSON.stringify(p));
  }, Object.assign({ me: 'arvind', theme: 'dark', sync: { url: API, key: KEY, on: true } }, prefs));
  await page.goto(APP);
  await page.waitForTimeout(900);          // let the load-time pull finish
  return page;
}

(async () => {
  const up = await mock.start(PORT, KEY);
  store = up.store;
  store.reset();
  console.log(`  (mock backed by ${mock.USE_PG ? 'Postgres + schema.sql' : 'memory'})\n`);
  const browser = await chromium.launch();

  // ---------- device A logs a day ----------
  const A = await device(browser, 'A', { me: 'arvind' });
  ok((await A.textContent('#syncStatus')).includes('Synced'), 'A reports Synced on load');

  await A.fill('#f_steps', '12500'); await A.locator('#f_steps').blur();
  await A.fill('#f_weight', '77.2'); await A.locator('#f_weight').blur();
  await A.click('[data-workout="Run"]');
  await A.waitForTimeout(2000);            // push is debounced 1.2s

  const row = rowValue(`entry:arvind:${TODAY}`);
  ok(row && row.steps === 12500, `A's day reached the server (got ${JSON.stringify(row && row.steps)})`);

  // ---------- device B sees it ----------
  const B = await device(browser, 'B', { me: 'sai' });
  await switchTo(B, 'arvind');
  ok(await B.inputValue('#f_steps') === '12500', "B pulled A's day");
  ok((await B.textContent('#todayCrew')).includes('12.5k'), "B's crew card shows A");

  // ---------- B clears it; A must not resurrect it ----------
  await B.click('#clearBtn');
  await B.waitForTimeout(2000);
  const tomb = rowValue(`entry:arvind:${TODAY}`);
  ok(tomb === null, `clearing wrote a tombstone, not a delete (got ${JSON.stringify(tomb)})`);

  await A.reload();
  await A.waitForTimeout(1200);
  ok(await A.inputValue('#f_steps') === '', 'A sees the day cleared — no resurrection');

  // ---------- last write wins ----------
  await A.fill('#f_steps', '8000'); await A.locator('#f_steps').blur();
  await A.waitForTimeout(2000);
  await B.reload();
  await B.waitForTimeout(1200);
  await switchTo(B, 'arvind');
  ok(await B.inputValue('#f_steps') === '8000', "B picks up A's newer value");

  // a stale write must not clobber the newer one
  store.upsert(JSON.stringify([{ key: `entry:arvind:${TODAY}`, value: { steps: 111 }, updated_ms: 1 }]));
  await A.reload();
  await A.waitForTimeout(1200);
  ok(await A.inputValue('#f_steps') === '8000', 'a stale remote row does not overwrite local');

  // ---------- goals and units sync too ----------
  await A.click('.tab[data-view="settings"]');
  await A.fill('#goal_arvind_steps', '13500');
  await A.locator('#goal_arvind_steps').blur();
  await A.waitForTimeout(2000);
  ok((rowValue('goals:arvind') || {}).steps === 13500, 'goal changes sync');

  // ---------- a bad key surfaces an error rather than failing silently ----------
  const C = await device(browser, 'C', { sync: { url: API, key: 'wrong-key', on: true } });
  ok((await C.textContent('#syncStatus')).includes('error'), 'a bad key shows a sync error');

  await browser.close();
  up.server.close();
  console.log('\n--- final table ---');
  store.all().sort((a, b) => a.key.localeCompare(b.key))
    .forEach(r => console.log('  ' + r.key + ' = ' + JSON.stringify(r.value)));
  console.log(fails ? `\n${fails} FAILING` : '\nAll sync checks passed.');
  process.exit(fails ? 1 : 0);
})();
