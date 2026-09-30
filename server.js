/* Serves the app and its data from one process.
 *
 * The browser never sees the database. It calls the same two endpoints it would
 * call on Supabase — that shape is deliberate, so the front end is identical
 * whether the data lives here or there — and this process does the SQL using
 * DATABASE_URL, which stays server-side where a password belongs.
 *
 *   GET  /rest/v1/club_data   every record
 *   POST /rest/v1/club_data   upsert an array of records
 *   GET  /rest/v1/health      is this a club server, and is the database up
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');

const PORT = process.env.PORT || 8080;
const ROOT = __dirname;
const DB_URL = process.env.DATABASE_URL || '';
const CLUB_KEY = process.env.CLUB_KEY || '';

// Railway's private network needs no TLS; anything else almost certainly does.
const isLocal = /@(localhost|127\.0\.0\.1|\[?::1\]?)[:/]|\.railway\.internal/.test(DB_URL);
const pool = DB_URL
  ? new Pool({
      connectionString: DB_URL,
      ssl: isLocal ? false : { rejectUnauthorized: false },
      max: 4,
      idleTimeoutMillis: 30000,
      // Without this a connection to a host that drops packets hangs for
      // minutes instead of failing, and every query behind it hangs too.
      connectionTimeoutMillis: 8000
    })
  : null;

/* ------------------------------------------------------------------ schema */
async function migrate() {
  if (!pool) return;
  const sql = fs.readFileSync(path.join(ROOT, 'supabase', 'schema.sql'), 'utf8');
  await pool.query(sql);           // idempotent, and skips the anon grants here
  console.log('schema applied');
}

// A managed database is often not reachable in the first seconds of a
// container's life, so a single attempt at boot is a coin toss.
async function migrateWithRetry(attempts = 5) {
  for (let i = 1; i <= attempts; i++) {
    try { await migrate(); return true; }
    catch (e) {
      const last = i === attempts;
      console.warn(`schema attempt ${i}/${attempts} failed: ${e.message}` + (last ? '' : ' — retrying'));
      if (last) return false;
      await new Promise(r => setTimeout(r, i * 2000));
    }
  }
}

/* ------------------------------------------------------------------ static */
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json', '.md': 'text/markdown; charset=utf-8'
};
// Only these are web assets. Everything else in the repo stays private.
const PUBLIC = ['index.html', 'css', 'js', 'favicon.ico'];

function serveStatic(req, res, urlPath) {
  let rel = decodeURIComponent(urlPath).replace(/^\/+/, '');
  if (rel === '' || rel.endsWith('/')) rel += 'index.html';

  const full = path.resolve(ROOT, rel);
  const top = path.relative(ROOT, full).split(path.sep)[0];
  if (full !== ROOT && !full.startsWith(ROOT + path.sep)) return send(res, 403, 'text/plain', 'Forbidden');
  if (!PUBLIC.includes(top)) return send(res, 404, 'text/plain', 'Not found');

  fs.readFile(full, (err, body) => {
    if (err) return send(res, 404, 'text/plain', 'Not found');
    send(res, 200, TYPES[path.extname(full)] || 'application/octet-stream', body,
      { 'Cache-Control': 'no-cache' });
  });
}

function send(res, code, type, body, extra) {
  res.writeHead(code, Object.assign({ 'Content-Type': type }, extra || {}));
  res.end(body);
}
function json(res, code, obj) {
  send(res, code, 'application/json; charset=utf-8', JSON.stringify(obj), {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'apikey, authorization, content-type, prefer',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
  });
}

/* --------------------------------------------------------------- unlocking */
/* A browser should not have to carry the club key around in JavaScript. Enter
 * it once, get an HttpOnly cookie, and that device is authorised from then on.
 * The cookie holds a hash of the key, so it is useless for anything else and
 * cannot be read back out of the browser by script. */
const SESSION_COOKIE = 'club_session';
function clubToken() {
  return crypto.createHash('sha256').update('club-session:' + CLUB_KEY).digest('hex');
}
function cookies(req) {
  const out = {};
  String(req.headers.cookie || '').split(';').forEach(part => {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}
function sameSecret(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
function unlocked(req) {
  if (!CLUB_KEY) return false;
  const c = cookies(req)[SESSION_COOKIE];
  return !!c && sameSecret(c, clubToken());
}

/* --------------------------------------------------------------------- api */
function authorised(req) {
  if (!CLUB_KEY) return false;
  if (unlocked(req)) return true;                       // this browser, already let in
  const given = req.headers.apikey ||
    String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  return !!given && sameSecret(given, CLUB_KEY);        // anything else still needs the key
}

async function readAll(res) {
  const { rows } = await pool.query(
    'select key, value, updated_ms from public.club_data order by key');
  json(res, 200, rows.map(r => ({ key: r.key, value: r.value, updated_ms: Number(r.updated_ms) })));
}

async function upsert(res, body) {
  let rows;
  try { rows = JSON.parse(body); } catch (e) { return json(res, 400, { message: 'Body is not JSON' }); }
  if (!Array.isArray(rows)) return json(res, 400, { message: 'Expected an array of records' });
  if (!rows.length) return send(res, 204, 'text/plain', '');
  if (rows.length > 5000) return json(res, 413, { message: 'Too many records in one request' });

  // One statement, so a half-applied batch cannot happen; the table's own
  // constraints still reject anything malformed.
  try {
    await pool.query(
      `insert into public.club_data (key, value, updated_ms)
       select r.key, r.value, r.updated_ms
       from jsonb_to_recordset($1::jsonb) as r(key text, value jsonb, updated_ms bigint)
       on conflict (key) do update
         set value = excluded.value, updated_ms = excluded.updated_ms`,
      [JSON.stringify(rows)]);
    send(res, 204, 'text/plain', '');
  } catch (e) {
    json(res, 400, { message: String(e.message).split('\n')[0] });
  }
}

/* Unauthenticated callers get booleans only — enough to diagnose, nothing worth
 * knowing. The record count needs the key. */
// This is the platform's healthcheck path, so it must always answer quickly.
// A database that is merely slow must never make the container look dead.
function withTimeout(promise, ms, label) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(label)), ms); })
  ]);
}

async function checkHealth(trusted) {
  const out = { club: true, configured: !!pool, locked: !!CLUB_KEY, database: false, schema: false };
  if (!pool) { out.detail = 'No DATABASE_URL on this server.'; return out; }
  try {
    await withTimeout(pool.query('select 1'), 2500, 'the database did not answer within 2.5s');
    out.database = true;
  } catch (e) {
    out.detail = 'Cannot reach the database: ' + e.message;
    return out;
  }
  const { rows } = await withTimeout(
    pool.query("select to_regclass('public.club_data') is not null as ok"), 2500, 'timed out');
  out.schema = rows[0].ok;
  if (!out.schema) { out.detail = 'Connected, but club_data does not exist — the schema did not apply.'; return out; }
  if (trusted) {
    const c = await withTimeout(
      pool.query('select count(*)::int as n from public.club_data'), 2500, 'timed out');
    out.records = c.rows[0].n;
  }
  if (!out.locked) out.detail = 'No CLUB_KEY set, so the data API is switched off.';
  return out;
}

/* ------------------------------------------------------------------ server */
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;

  if (!p.startsWith('/rest/v1/')) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'text/plain', 'Method not allowed');
    return serveStatic(req, res, p);
  }

  if (req.method === 'OPTIONS') return json(res, 204, null);

  if (p === '/rest/v1/unlock' && req.method === 'POST') {
    if (!CLUB_KEY) return json(res, 503, { message: 'This server has no CLUB_KEY set.' });
    let body = '';
    req.on('data', c => { body += c; if (body.length > 4096) req.destroy(); });
    req.on('end', () => {
      let given = '';
      try { given = (JSON.parse(body) || {}).key || ''; } catch (e) {}
      if (!sameSecret(given, CLUB_KEY)) {
        // a small pause, so guessing is not free
        return setTimeout(() => json(res, 401, { message: 'That is not the club passcode.' }), 500);
      }
      const https = req.headers['x-forwarded-proto'] === 'https';
      res.setHeader('Set-Cookie', SESSION_COOKIE + '=' + clubToken() +
        '; HttpOnly; SameSite=Lax; Path=/; Max-Age=31536000' + (https ? '; Secure' : ''));
      json(res, 200, { unlocked: true });
    });
    return;
  }

  if (p === '/rest/v1/lock' && req.method === 'POST') {
    res.setHeader('Set-Cookie', SESSION_COOKIE + '=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
    return json(res, 200, { unlocked: false });
  }

  if (p === '/rest/v1/health') {
    // Actually asks the database, rather than reporting that a URL was set.
    // Open this in a browser to see exactly which part is not working.
    const isUnlocked = unlocked(req);
    return checkHealth(authorised(req))
      .then(function (h) { h.unlocked = isUnlocked; json(res, 200, h); })
      .catch(function (e) {
        json(res, 200, { club: true, database: false, unlocked: isUnlocked, detail: e.message });
      });
  }
  if (!pool) {
    return json(res, 503, { message: 'No DATABASE_URL is set on this server, so there is nowhere to store anything.' });
  }
  if (!CLUB_KEY) {
    return json(res, 503, { message: 'This server has no CLUB_KEY set, so its data API is switched off. Set one in the host environment and use it as the key in the app.' });
  }
  if (!authorised(req)) return json(res, 401, { message: 'Invalid API key' });
  if (p !== '/rest/v1/club_data') return json(res, 404, { message: 'No such table' });

  if (req.method === 'GET') {
    return readAll(res).catch(e => json(res, 500, { message: e.message }));
  }
  if (req.method === 'POST') {
    let body = '';
    req.on('data', c => {
      body += c;
      if (body.length > 4e6) { req.destroy(); }      // don't buffer the world
    });
    return req.on('end', () => upsert(res, body).catch(e => json(res, 500, { message: e.message })));
  }
  json(res, 405, { message: 'Method not allowed' });
});

// Printed once the database has been checked, because a deploy log is the first
// place anyone looks when the board is not syncing.
async function report() {
  const h = await checkHealth(true).catch(e => ({ detail: e.message }));
  const mark = ok => (ok ? '  ok  ' : ' FAIL ');
  console.log('---- accountability club ----');
  console.log(mark(h.configured) + 'DATABASE_URL is set');
  console.log(mark(h.database) + 'database reachable');
  console.log(mark(h.schema) + 'club_data table present' +
    (h.records === undefined ? '' : ` (${h.records} record${h.records === 1 ? '' : 's'})`));
  console.log(mark(h.locked) + 'CLUB_KEY is set');
  if (h.detail) console.log('      ' + h.detail);
  console.log(h.database && h.schema && h.locked
    ? '      shared board is ready'
    : '      shared board is OFF — see /rest/v1/health');
  console.log('-----------------------------');
}

function start() {
  // Listen FIRST. Nothing about the database may delay this: a host that drops
  // packets takes minutes to fail, and until the port is open the platform sees
  // a dead container and serves "Application failed to respond" — even though
  // the app itself is fine and only the shared board would have been affected.
  server.listen(PORT, () => {
    console.log(`listening on ${PORT}`);
    if (!pool) {
      console.warn('DATABASE_URL is not set — serving the app, but the data API is off.');
      return report();
    }
    migrateWithRetry().then(report);      // deliberately not awaited
  });
}

if (require.main === module) start();
module.exports = { server, start, pool };
