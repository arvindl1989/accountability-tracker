/* The Railway shape, end to end: the real server.js, a real Postgres, and two
 * browsers talking to it the way the three of you would. */
const { chromium } = require('playwright');
const { spawn, execFileSync } = require('child_process');
const http = require('http');
const path = require('path');

const PGHOST = process.env.PGHOST || '/tmp/acdb/sock';
const PGPORT = process.env.PGPORT || '55432';
const DB = 'servertest';
const KEY = 'club-key-under-test';
let fails = 0;
const ok = (c, m) => { console.log((c ? '  PASS  ' : '  FAIL  ') + m); if (!c) fails++; };
const psql = (args, db) => execFileSync('psql',
  ['-h', PGHOST, '-p', PGPORT, '-U', 'postgres', '-tA', '-q', ...(db ? ['-d', db] : []), ...args],
  { encoding: 'utf8' }).trim();

function waitFor(port, tries = 80) {
  return new Promise((resolve, reject) => {
    const go = n => {
      const req = http.get({ host: '127.0.0.1', port, path: '/rest/v1/health' },
        res => { res.resume(); res.statusCode === 200 ? resolve() : again(n); });
      req.on('error', () => again(n));
      req.setTimeout(400, () => { req.destroy(); again(n); });
    };
    const again = n => n <= 0 ? reject(new Error('server never came up')) : setTimeout(() => go(n - 1), 100);
    go(tries);
  });
}

(async () => {
  try { psql(['-c', `drop database if exists ${DB}`]); psql(['-c', `create database ${DB}`]); }
  catch (e) {
    console.log('  SKIP  no local Postgres — run ./tests/db-fresh.sh first');
    process.exit(0);
  }

  const PORT = 8402;
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: Object.assign({}, process.env, {
      PORT: String(PORT), CLUB_KEY: KEY,
      DATABASE_URL: `postgresql://postgres@localhost/${DB}?host=${PGHOST}&port=${PGPORT}`
    }),
    stdio: 'ignore'
  });
  const stop = () => { try { srv.kill(); } catch (e) {} };

  try {
    await waitFor(PORT);
    ok(true, 'server starts and answers /rest/v1/health');
    ok(psql(['-c', "select to_regclass('public.club_data')"], DB) === 'club_data',
       'it creates its own schema on first boot');

    const APP = `http://127.0.0.1:${PORT}/index.html`;
    const browser = await chromium.launch();

    const open = async (who) => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      page.on('pageerror', e => { console.log('  pageerror: ' + e.message); fails++; });
      page.on('dialog', d => d.accept());
      await page.addInitScript(([w, k]) => localStorage.setItem('ac.prefs.v1', JSON.stringify({
        me: w, theme: 'dark', sync: { url: location.origin, key: k, on: true }
      })), [who, KEY]);
      await page.goto(APP);
      await page.waitForTimeout(700);
      return { ctx, page };
    };

    // ---- the app is served by the same process that holds the data ----
    const A = await open('arvind');
    ok((await A.page.textContent('#syncStatus')).includes('Synced'), 'the app loads and reports Synced');

    await A.page.fill('#f_steps', '9100'); await A.page.locator('#f_steps').blur();
    await A.page.click('[data-workout="Run"]');
    await A.page.waitForTimeout(2200);

    const today = new Date();
    const key = `entry:arvind:${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
    ok(psql(['-c', `select value->>'steps' from public.club_data where key='${key}'`], DB) === '9100',
       'a logged day lands in Postgres through the server');

    // ---- a second person sees it ----
    const B = await open('sai');
    ok((await B.page.textContent('#todayCrew')).includes('9100'), "a second device sees the first one's day");

    // ---- Settings knows it is talking to its own server ----
    await B.page.click('.tab[data-view="settings"]');
    await B.page.waitForTimeout(900);
    const hint = await B.page.textContent('#serverHint');
    ok(/its own club server/.test(hint), 'Settings recognises the site as its own club server');
    ok(/database behind it/.test(hint), 'and reports the database is attached');

    await B.page.click('#syncTest');
    await B.page.waitForSelector('#syncReport .report-line');
    await B.page.waitForTimeout(900);
    const rep = await B.page.textContent('#syncReport');
    ok(/Read back/.test(rep) && !/✕/.test(rep), 'Test connection reports a clean round trip');

    // ---- the database is never exposed to the browser ----
    const leaked = await B.page.evaluate(async () => {
      const paths = ['/server.js', '/package.json', '/supabase/schema.sql', '/.env'];
      const out = [];
      for (const p of paths) { const r = await fetch(p); if (r.ok) out.push(p); }
      return out;
    });
    ok(leaked.length === 0, 'server source and config are not served to the browser' +
       (leaked.length ? ' (leaked: ' + leaked.join(', ') + ')' : ''));

    const src = await B.page.content();
    ok(!/postgresql:\/\//.test(src), 'no connection string appears in the page');

    await browser.close();
  } catch (e) {
    ok(false, 'unexpected failure: ' + e.message);
  } finally {
    stop();
  }

  console.log(fails ? `\n${fails} FAILING` : '\nAll server checks passed.');
  process.exit(fails ? 1 : 0);
})();
