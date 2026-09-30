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

    // helpers used by several of the checks below
    const bootWith = (env, port) => new Promise(resolve => {
      const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
        env: Object.assign({}, process.env, { PORT: String(port) }, env), stdio: 'ignore'
      });
      waitFor(port).then(() => resolve(child)).catch(() => resolve(child));
    });
    const health = port => new Promise((resolve, reject) => {
      http.get({ host: '127.0.0.1', port, path: '/rest/v1/health' }, res => {
        let b = ''; res.on('data', c => b += c);
        res.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { reject(e); } });
      }).on('error', reject);
    });
    const DB_URL = `postgresql://postgres@localhost/${DB}?host=${PGHOST}&port=${PGPORT}`;


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

    // ---- the banner names whatever is actually wrong ----
    const bannerFor = async (port, prefs) => {
      const c = await browser.newContext();
      const pg = await c.newPage();
      await pg.addInitScript(p => localStorage.setItem('ac.prefs.v1', JSON.stringify(p)), prefs);
      await pg.goto(`http://127.0.0.1:${port}/index.html`);
      await pg.waitForTimeout(1500);
      const t = await pg.textContent('#syncBanner');
      await c.close();
      return t.trim();
    };

    const signedInNoSync = { me: 'arvind', theme: 'dark' };
    let b = await bannerFor(PORT, signedInNoSync);
    ok(/saved on this device only/i.test(b), 'sync off: the banner says data is device-only');
    ok(/switch the shared board on/i.test(b), 'and points at the fix');

    b = await bannerFor(PORT, { me: 'arvind', theme: 'dark',
      sync: { url: `http://127.0.0.1:${PORT}`, key: KEY, on: true } });
    ok(b === '', 'sync on and healthy: no banner at all');

    const noKeySrv = await bootWith({ CLUB_KEY: '', DATABASE_URL: DB_URL }, 8407);
    b = await bannerFor(8407, signedInNoSync);
    ok(/no club key/i.test(b) && /CLUB_KEY/.test(b),
       'server missing CLUB_KEY: the app says so without anyone reading a log');
    noKeySrv.kill();

    const noDbSrv = await bootWith({ CLUB_KEY: KEY, DATABASE_URL: '' }, 8408);
    b = await bannerFor(8408, signedInNoSync);
    ok(/can't reach its database|cannot reach its database/i.test(b),
       'server with no database: the app says that instead');
    noDbSrv.kill();

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

    // ---- health tells the truth about each way this is misconfigured ----

    const noDb = await bootWith({ CLUB_KEY: KEY, DATABASE_URL: '' }, 8403);
    let h = await health(8403);
    ok(h.configured === false && h.database === false, 'health reports a missing DATABASE_URL');
    ok(/No DATABASE_URL/.test(h.detail || ''), 'and says so in words');
    noDb.kill();

    const badDb = await bootWith({ CLUB_KEY: KEY, DATABASE_URL: 'postgresql://p:p@127.0.0.1:59998/x' }, 8404);
    h = await health(8404);
    ok(h.configured === true && h.database === false, 'health reports an unreachable database');
    ok(/Cannot reach the database/.test(h.detail || ''), 'and names the connection error');
    badDb.kill();

    const noKey = await bootWith({ CLUB_KEY: '', DATABASE_URL: DB_URL }, 8405);
    h = await health(8405);
    ok(h.database === true && h.schema === true && h.locked === false,
       'health reports a healthy database with no CLUB_KEY');
    ok(h.records === undefined, 'the record count is withheld without the key');
    noKey.kill();

    h = await health(PORT);
    ok(h.database && h.schema && h.locked, 'a correctly set up server reports all clear');

    // ---- an unreachable database must never stop the app being served ----
    // This is what "Application failed to respond" was: the port stayed shut
    // while a dead database was waited on.
    // spawned directly, and the wait is on the app itself — polling health first
    // would measure the health call rather than how soon the app is served
    const t0 = Date.now();
    const blackhole = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
      env: Object.assign({}, process.env, {
        PORT: '8406', CLUB_KEY: KEY, DATABASE_URL: 'postgresql://u:p@192.0.2.123:5432/db'
      }), stdio: 'ignore'
    });
    const page = await new Promise(resolve => {
      const tick = () => http.get({ host: '127.0.0.1', port: 8406, path: '/index.html' },
        res => { res.resume(); resolve({ code: res.statusCode, ms: Date.now() - t0 }); })
        .on('error', () => setTimeout(tick, 50));
      tick();
    });
    ok(page.code === 200, 'the app is served even when the database is unreachable');
    ok(page.ms < 5000, `and without waiting on it (served in ${page.ms}ms)`);

    const hStart = Date.now();
    h = await health(8406);
    const hMs = Date.now() - hStart;
    ok(h.database === false && /Cannot reach/.test(h.detail || ''),
       'health still names the database problem');
    ok(hMs < 6000, `health answers promptly rather than hanging (${hMs}ms)`);
    blackhole.kill();
  } catch (e) {
    ok(false, 'unexpected failure: ' + e.message);
  } finally {
    stop();
  }

  console.log(fails ? `\n${fails} FAILING` : '\nAll server checks passed.');
  process.exit(fails ? 1 : 0);
})();
