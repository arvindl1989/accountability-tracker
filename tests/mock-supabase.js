/* A stand-in for Supabase's REST layer, implementing just what js/store.js calls.
 *
 * By default it keeps rows in memory, so the sync tests run anywhere. Set
 * SYNC_TEST_PG=1 (with a Postgres reachable via PGHOST/PGPORT and supabase/
 * schema.sql applied) to back it with the real table instead — that is how the
 * schema's constraints get exercised by real client payloads.
 */
const http = require('http');
const { execFileSync } = require('child_process');

const USE_PG = process.env.SYNC_TEST_PG === '1';
const PGHOST = process.env.PGHOST || '/home/user/pgs';
const PGPORT = process.env.PGPORT || '55432';

function psql(sql, vars = {}) {
  const args = ['-h', PGHOST, '-p', PGPORT, '-U', 'postgres', '-tA', '-q', '-v', 'ON_ERROR_STOP=1'];
  for (const [k, v] of Object.entries(vars)) args.push('-v', `${k}=${v}`);
  return execFileSync('psql', args, { input: sql, encoding: 'utf8' });   // stdin: -c skips :'var'
}

function createStore() {
  if (USE_PG) {
    return {
      all: () => JSON.parse(psql(`set role anon; select coalesce(jsonb_agg(jsonb_build_object(
             'key', key, 'value', value, 'updated_ms', updated_ms)), '[]'::jsonb) from public.club_data;`).trim()),
      upsert: body => psql(`set role anon;
             insert into public.club_data (key, value, updated_ms)
             select r.key, r.value, r.updated_ms
             from jsonb_to_recordset(:'payload'::jsonb) as r(key text, value jsonb, updated_ms bigint)
             on conflict (key) do update
               set value = excluded.value, updated_ms = excluded.updated_ms;`, { payload: body }),
      reset: () => psql('truncate public.club_data;')
    };
  }
  const rows = new Map();
  return {
    all: () => [...rows.values()],
    upsert: body => {
      for (const r of JSON.parse(body)) {
        if (typeof r.key !== 'string') throw new Error('bad row');
        // mirror the schema's key-shape constraint
        if (!/^club$|^goals:[a-z0-9_-]{1,32}$|^entry:[a-z0-9_-]{1,32}:\d{4}-\d{2}-\d{2}$/.test(r.key)) {
          throw new Error('violates check constraint "club_data_key_shape"');
        }
        // Number(), never |0 — epoch ms overflows a 32-bit int and wrecks the merge clock.
        rows.set(r.key, { key: r.key, value: r.value === undefined ? null : r.value, updated_ms: Number(r.updated_ms) || 0 });
      }
    },
    reset: () => rows.clear()
  };
}

function start(port, apiKey) {
  const store = createStore();
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const send = (code, body) => {
      res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' });
      res.end(body === undefined ? '' : JSON.stringify(body));
    };

    if (req.method === 'OPTIONS') return send(204);
    if (req.headers.apikey !== apiKey || req.headers.authorization !== 'Bearer ' + apiKey) {
      return send(401, { message: 'Invalid API key' });
    }
    if (!url.pathname.startsWith('/rest/v1/club_data')) return send(404, { message: 'no such table' });

    if (req.method === 'GET') return send(200, store.all());

    if (req.method === 'POST') {
      let body = '';
      req.on('data', c => (body += c));
      req.on('end', () => {
        try { JSON.parse(body); store.upsert(body); send(204); }
        catch (e) {
          const msg = String(e.stderr || e.message).split('\n').filter(Boolean).slice(0, 2).join(' ');
          send(400, { message: msg });
        }
      });
      return;
    }
    send(405, { message: 'method not allowed' });
  });

  return new Promise(resolve => server.listen(port, '127.0.0.1', () => resolve({ server, store })));
}

module.exports = { start, USE_PG };
