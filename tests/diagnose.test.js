/* The Test connection button has to name the real problem, not just say "error".
 * Each case below is a way the shared board actually fails in the wild. */
const { chromium } = require('playwright');
const http = require('http');
const seed = require('./seed.js');

const APP = process.env.BASE_URL || 'http://127.0.0.1:8123/index.html';
const KEY = 'right-key';
let fails = 0;
const ok = (c, m) => { console.log((c ? '  PASS  ' : '  FAIL  ') + m); if (!c) fails++; };

// A server that can be told to misbehave in a specific way.
function stub(mode) {
  const rows = [];
  const srv = http.createServer((req, res) => {
    const head = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' };
    if (req.method === 'OPTIONS') { res.writeHead(204, head); return res.end(); }
    if (mode === 'badkey' || req.headers.apikey !== KEY) { res.writeHead(401, head); return res.end('{}'); }
    if (mode === 'notable') { res.writeHead(404, head); return res.end('{}'); }
    if (req.method === 'POST') {
      if (mode === 'readonly') { res.writeHead(403, head); return res.end('{"message":"403 denied"}'); }
      let b = ''; req.on('data', c => b += c);
      return req.on('end', () => { JSON.parse(b).forEach(r => rows.push(r)); res.writeHead(204, head); res.end(); });
    }
    res.writeHead(200, head); res.end(JSON.stringify(rows));
  });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r({ srv, port: srv.address().port })));
}

async function report(browser, { url, key, on }) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on('pageerror', e => { console.log('  pageerror: ' + e.message); fails++; });
  await page.addInitScript(([d, u, k, o]) => {
    localStorage.setItem('ac.club.v1', JSON.stringify(d));
    localStorage.setItem('ac.prefs.v1', JSON.stringify({
      me: 'arvind', theme: 'dark', sync: { url: u, key: k, on: o }
    }));
  }, [seed(), url, key, on === undefined ? !!url : on]);
  await page.goto(APP);
  await page.click('.tab[data-view="settings"]');
  await page.waitForTimeout(250);
  await page.click('#syncTest');
  await page.waitForSelector('#syncReport .report-line', { timeout: 8000 });
  await page.waitForTimeout(600);
  const text = await page.textContent('#syncReport');
  await ctx.close();
  return text;
}

(async () => {
  const browser = await chromium.launch();

  // nothing configured at all — the commonest reason data "isn't captured"
  let t = await report(browser, { url: '', key: '' });
  ok(/sync is off/i.test(t), 'unconfigured: says sync is off and nothing is being sent');
  ok(/Turn on & sync/i.test(t), 'unconfigured: says what to do about it');

  // pointed at something that is not a REST endpoint (e.g. a raw Postgres host)
  t = await report(browser, { url: 'http://127.0.0.1:1/nope', key: KEY });
  ok(/Could not reach/i.test(t), 'unreachable: says it could not reach the address');
  ok(/wire protocol/i.test(t), 'unreachable: warns a plain Postgres string will never work');

  let s = await stub('badkey');
  t = await report(browser, { url: `http://127.0.0.1:${s.port}`, key: 'wrong' });
  s.srv.close();
  ok(/refused the key/i.test(t), 'bad key: says the key was refused');
  ok(/anon public key/i.test(t), 'bad key: names the right key to copy');

  s = await stub('notable');
  t = await report(browser, { url: `http://127.0.0.1:${s.port}`, key: KEY });
  s.srv.close();
  ok(/no club_data table/i.test(t), 'missing table: names the missing table');
  ok(/schema\.sql/i.test(t), 'missing table: points at the schema file');

  s = await stub('readonly');
  t = await report(browser, { url: `http://127.0.0.1:${s.port}`, key: KEY });
  s.srv.close();
  ok(/not writable|Readable but not writable/i.test(t), 'no write grant: says it can read but not write');

  s = await stub('ok');
  t = await report(browser, { url: `http://127.0.0.1:${s.port}`, key: KEY });
  s.srv.close();
  ok(/Read back/.test(t) && /row/.test(t), 'working: confirms rows landed on the server');
  ok(!/✕/.test(t), 'working: reports no failures');

  // Testing a connection is what you do BEFORE turning sync on, so it must not
  // require sync to already be on.
  s = await stub('ok');
  t = await report(browser, { url: `http://127.0.0.1:${s.port}`, key: KEY, on: false });
  s.srv.close();
  ok(!/Sync is off/.test(t), 'a test with sync switched off does not report "Sync is off"');
  ok(/Read back/.test(t) && !/✕/.test(t),
     'it completes the whole round trip with sync still off');

  await browser.close();
  console.log(fails ? `\n${fails} FAILING` : '\nAll diagnostic checks passed.');
  process.exit(fails ? 1 : 0);
})();
