/* Accountability Club — data layer.
 * Everything lives in one flat record map so local state and cloud sync share
 * a single merge rule: last write wins, compared on `t` (epoch ms).
 *
 *   entry:<person>:<YYYY-MM-DD>  ->  { steps, weight, active, workout[], habits[], note }
 *   goals:<person>               ->  { steps, active, weight }
 *   club                         ->  { units }
 */
var Store = (function () {
  'use strict';

  var LS_DATA = 'ac.club.v1';
  var LS_PREFS = 'ac.prefs.v1';

  var PEOPLE = [
    { id: 'arvind',    name: 'Arvind',    color: '#ea580c', initials: 'AR' },
    { id: 'abhinandh', name: 'Abhinandh', color: '#0891b2', initials: 'AB' },
    { id: 'sai',       name: 'Sai',       color: '#8b5cf6', initials: 'SA' }
  ];

  var HABITS = [
    { id: 'move',  icon: '💪', label: 'Moved my body' },
    { id: 'water', icon: '💧', label: '3L water' },
    { id: 'sleep', icon: '😴', label: '7h+ sleep' },
    { id: 'food',  icon: '🥗', label: 'Ate clean' },
    { id: 'clear', icon: '🚫', label: 'No junk' }
  ];

  var WORKOUTS = ['Gym', 'Run', 'Walk', 'Cycle', 'Swim', 'Sports', 'Yoga', 'Home', 'Rest'];
  // Picking these clears the rest, and vice versa — "Rest + Gym" is not a day.
  var SOLO_WORKOUTS = ['Rest'];

  var DEFAULT_GOALS = { steps: 10000, active: 30, weight: null };
  var POINTS = { logged: 2, steps: 10, active: 10, weight: 5, habit: 3 };

  var data = { records: {} };
  // me is '' until someone says who they are — an unanswered question, not a
  // silent default that logs Abhinandh's run against Arvind.
  var prefs = { me: '', theme: 'dark', sync: { url: '', key: '', on: false, mode: '' }, lastPull: 0 };
  var listeners = [];

  /* ---------- dates ---------- */
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function iso(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function today() { return iso(new Date()); }
  function parse(s) { var p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function shift(dateStr, days) { var d = parse(dateStr); d.setDate(d.getDate() + days); return iso(d); }
  function daysBetween(a, b) { return Math.round((parse(b) - parse(a)) / 86400000); }
  function rangeBack(days, endStr) {
    var end = endStr || today(), out = [];
    for (var i = days - 1; i >= 0; i--) out.push(shift(end, -i));
    return out;
  }
  // Monday-based week start.
  function weekStart(dateStr) {
    var d = parse(dateStr || today());
    var dow = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - dow);
    return iso(d);
  }

  /* ---------- persistence ---------- */
  function readLS(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  }
  function writeLS(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch (e) { return false; }
  }

  function load() {
    var d = readLS(LS_DATA, null);
    if (d && d.records) data = d;
    var p = readLS(LS_PREFS, null);
    if (p) {
      prefs.me = p.me || prefs.me;
      prefs.theme = p.theme || prefs.theme;
      prefs.lastPull = p.lastPull || 0;
      if (p.sync) prefs.sync = {
        url: p.sync.url || '', key: p.sync.key || '', on: !!p.sync.on, mode: p.sync.mode || ''
      };
    }
  }
  function saveData() { writeLS(LS_DATA, data); }
  function savePrefs() { writeLS(LS_PREFS, prefs); }

  function emit() { listeners.forEach(function (fn) { fn(); }); }
  function onChange(fn) { listeners.push(fn); }

  /* ---------- record access ---------- */
  function get(key, fallback) {
    var r = data.records[key];
    return r && r.v !== undefined && r.v !== null ? r.v : fallback;
  }
  function set(key, value, stamp) {
    data.records[key] = { v: value, t: stamp || Date.now() };
    saveData();
  }
  function stampOf(key) { var r = data.records[key]; return r ? r.t || 0 : 0; }

  /* ---------- people ---------- */
  function people() { return PEOPLE.slice(); }
  function person(id) {
    for (var i = 0; i < PEOPLE.length; i++) if (PEOPLE[i].id === id) return PEOPLE[i];
    return PEOPLE[0];
  }
  /* Signing in writes to sessionStorage always, and to prefs only when you ask
   * to be remembered. So "stay signed in" off means this browser session and no
   * longer — close it and the login screen is back. */
  var SS_ME = 'ac.session.me';
  function sessionMe() {
    try { return sessionStorage.getItem(SS_ME) || ''; } catch (e) { return ''; }
  }
  function currentId() { return sessionMe() || prefs.me; }
  function me() { return person(currentId()); }
  function hasIdentity() { var id = currentId(); return !!id && knows(id); }

  function signIn(id, remember) {
    id = person(id).id;
    try { sessionStorage.setItem(SS_ME, id); } catch (e) {}
    prefs.me = remember ? id : '';
    savePrefs();
    emit();
  }
  // Forgets who you are on this device. It never touches the logged days —
  // those belong to the club, not to the browser.
  function signOut() {
    try { sessionStorage.removeItem(SS_ME); } catch (e) {}
    prefs.me = '';
    savePrefs();
    emit();
  }
  function isRemembered() { return !!prefs.me; }
  function knows(id) {
    for (var i = 0; i < PEOPLE.length; i++) if (PEOPLE[i].id === id) return true;
    return false;
  }

  /* ---------- entries ---------- */
  function entryKey(pid, date) { return 'entry:' + pid + ':' + date; }
  function blank() { return { steps: null, weight: null, active: null, workout: [], habits: [], note: '' }; }

  // Days logged before workouts became multi-select hold a plain string, and a
  // friend on a cached build may still send one. Normalise on the way in and
  // out, so both shapes are always safe to read.
  function workoutList(v) {
    if (Array.isArray(v)) return v.filter(function (w) { return typeof w === 'string' && w; });
    return typeof v === 'string' && v ? [v] : [];
  }

  function entry(pid, date) {
    var e = get(entryKey(pid, date), null);
    if (!e) return blank();
    return {
      steps: num(e.steps), weight: num(e.weight), active: num(e.active),
      workout: workoutList(e.workout), habits: e.habits || [], note: e.note || ''
    };
  }
  function saveEntry(pid, date, e) {
    var clean = {
      steps: num(e.steps), weight: num(e.weight), active: num(e.active),
      workout: workoutList(e.workout), habits: (e.habits || []).slice(), note: (e.note || '').trim()
    };
    // An emptied day becomes a tombstone (null), never a missing key: sync merges
    // on presence, so an outright delete would just be restored by the next pull
    // from whoever still had the row.
    if (isEmpty(clean)) set(entryKey(pid, date), null);
    else set(entryKey(pid, date), clean);
    saveData();
    // Deliberately no emit(): a save happens while someone is still typing, and
    // a full re-render would yank the caret out of the field under them. The
    // caller refreshes the derived widgets instead.
  }
  function clearEntry(pid, date) { set(entryKey(pid, date), null); saveData(); }

  function isEmpty(e) {
    return e.steps === null && e.weight === null && e.active === null &&
           !workoutList(e.workout).length && (!e.habits || !e.habits.length) && !e.note;
  }
  function isLogged(e) {
    return e.steps !== null || e.weight !== null || e.active !== null ||
           workoutList(e.workout).length > 0 || (e.habits && e.habits.length > 0);
  }
  function num(v) {
    if (v === '' || v === null || v === undefined) return null;
    var n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'));
    return isFinite(n) ? n : null;
  }

  /* ---------- goals ---------- */
  function goals(pid) {
    var g = get('goals:' + pid, null) || {};
    return {
      steps: g.steps || DEFAULT_GOALS.steps,
      active: g.active || DEFAULT_GOALS.active,
      weight: g.weight === undefined ? null : g.weight
    };
  }
  function saveGoals(pid, g) {
    set('goals:' + pid, { steps: num(g.steps) || DEFAULT_GOALS.steps, active: num(g.active) || DEFAULT_GOALS.active, weight: num(g.weight) });
    emit();
  }

  function units() { return (get('club', {}) || {}).units || 'kg'; }
  function setUnits(u) { var c = get('club', {}) || {}; c.units = u === 'lb' ? 'lb' : 'kg'; set('club', c); emit(); }

  /* ---------- derived ---------- */
  function score(pid, date) {
    var e = entry(pid, date);
    if (!isLogged(e)) return 0;
    var g = goals(pid), pts = POINTS.logged;
    if (e.steps !== null && e.steps >= g.steps) pts += POINTS.steps;
    if (e.active !== null && e.active >= g.active) pts += POINTS.active;
    if (e.weight !== null) pts += POINTS.weight;
    pts += (e.habits || []).length * POINTS.habit;
    return pts;
  }
  function maxDailyScore() {
    return POINTS.logged + POINTS.steps + POINTS.active + POINTS.weight + HABITS.length * POINTS.habit;
  }

  // Consecutive logged days ending today (or yesterday, so a streak survives
  // until the day is actually over).
  function streak(pid) {
    var cursor = today();
    if (!isLogged(entry(pid, cursor))) {
      cursor = shift(cursor, -1);
      if (!isLogged(entry(pid, cursor))) return 0;
    }
    var n = 0;
    while (isLogged(entry(pid, cursor)) && n < 3650) { n++; cursor = shift(cursor, -1); }
    return n;
  }

  function weekPoints(pid, anchor) {
    var start = weekStart(anchor), total = 0;
    for (var i = 0; i < 7; i++) total += score(pid, shift(start, i));
    return total;
  }
  function weekDaysLogged(pid, anchor) {
    var start = weekStart(anchor), n = 0;
    for (var i = 0; i < 7; i++) if (isLogged(entry(pid, shift(start, i)))) n++;
    return n;
  }
  function weekSteps(pid, anchor) {
    var start = weekStart(anchor), total = 0;
    for (var i = 0; i < 7; i++) { var s = entry(pid, shift(start, i)).steps; if (s !== null) total += s; }
    return total;
  }
  function consistency(pid, days) {
    var span = rangeBack(days), n = 0;
    span.forEach(function (d) { if (isLogged(entry(pid, d))) n++; });
    return Math.round((n / days) * 100);
  }

  // Most recent non-null value of a field, searching back `days` from today.
  function latest(pid, field, days) {
    var cursor = today();
    for (var i = 0; i < (days || 90); i++) {
      var v = entry(pid, cursor)[field];
      if (v !== null && v !== '' && v !== undefined) return { value: v, date: cursor };
      cursor = shift(cursor, -1);
    }
    return null;
  }

  function series(pid, field, dates) {
    return dates.map(function (d) {
      var v = entry(pid, d)[field];
      return { date: d, value: v === null || v === '' ? null : v };
    });
  }

  /* ---------- import / export ---------- */
  function exportJSON() {
    return JSON.stringify({ app: 'accountability-club', version: 1, exported: new Date().toISOString(), records: data.records }, null, 2);
  }
  function importJSON(text) {
    var parsed = JSON.parse(text);
    var incoming = parsed.records || parsed;
    if (typeof incoming !== 'object') throw new Error('No records found in that file.');
    var n = mergeRecords(incoming);
    saveData(); emit();
    return n;
  }

  // Shared merge: newer `t` wins, ties keep what we already have.
  function mergeRecords(incoming) {
    var changed = 0;
    Object.keys(incoming).forEach(function (k) {
      var rec = incoming[k];
      if (!rec || typeof rec !== 'object' || rec.v === undefined) return;
      var mine = data.records[k];
      if (!mine || (rec.t || 0) > (mine.t || 0)) { data.records[k] = { v: rec.v, t: rec.t || Date.now() }; changed++; }
    });
    return changed;
  }

  function resetAll() { data = { records: {} }; saveData(); emit(); }

  function stats() {
    var keys = Object.keys(data.records);
    var entries = keys.filter(function (k) {
      return k.indexOf('entry:') === 0 && data.records[k].v;   // tombstones are not days
    });
    return { entries: entries.length, records: keys.length };
  }

  load();

  return {
    PEOPLE: PEOPLE, HABITS: HABITS, WORKOUTS: WORKOUTS, SOLO_WORKOUTS: SOLO_WORKOUTS, POINTS: POINTS,
    prefs: prefs, savePrefs: savePrefs, records: function () { return data.records; },
    onChange: onChange, emit: emit,
    iso: iso, today: today, shift: shift, parse: parse, rangeBack: rangeBack,
    weekStart: weekStart, daysBetween: daysBetween,
    people: people, person: person, me: me,
    signIn: signIn, signOut: signOut, hasIdentity: hasIdentity,
    isRemembered: isRemembered, knows: knows,
    entry: entry, saveEntry: saveEntry, clearEntry: clearEntry, isLogged: isLogged, num: num,
    workoutList: workoutList,
    goals: goals, saveGoals: saveGoals, units: units, setUnits: setUnits,
    score: score, maxDailyScore: maxDailyScore, streak: streak,
    weekPoints: weekPoints, weekDaysLogged: weekDaysLogged, weekSteps: weekSteps,
    consistency: consistency, latest: latest, series: series,
    exportJSON: exportJSON, importJSON: importJSON, mergeRecords: mergeRecords,
    saveData: saveData, resetAll: resetAll, stats: stats, get: get, set: set, stampOf: stampOf
  };
})();

/* ---------------------------------------------------------------------------
 * Optional cloud sync (Supabase REST). Without it the app is happily offline
 * and single-device; with it the three of us see the same board.
 * ------------------------------------------------------------------------- */
var Sync = (function () {
  'use strict';

  function cfg() { return Store.prefs.sync; }
  // Cookie mode needs no key: the browser was unlocked once and carries an
  // HttpOnly cookie the page itself cannot read.
  function enabled() {
    var c = cfg();
    return !!(c.on && c.url && (c.key || c.mode === 'cookie'));
  }
  function base() { return cfg().url.replace(/\/+$/, '') + '/rest/v1/club_data'; }
  function headers(extra) {
    var c = cfg();
    var h = { 'Content-Type': 'application/json' };
    if (c.mode !== 'cookie') { h.apikey = c.key; h.Authorization = 'Bearer ' + c.key; }
    if (extra) Object.keys(extra).forEach(function (k) { h[k] = extra[k]; });
    return h;
  }
  function opts(extra) {
    return Object.assign({ credentials: 'same-origin' }, extra || {});
  }

  /* Hand the club passcode over once. The server answers with an HttpOnly
   * cookie, so from here on this device syncs with nothing typed and nothing
   * stored in the page. */
  function unlock(passcode) {
    return fetch(location.origin + '/rest/v1/unlock', opts({
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: passcode })
    })).then(function (r) {
      if (r.ok) { save(location.origin, '', true, 'cookie'); return true; }
      return r.json().catch(function () { return {}; }).then(function (j) {
        throw new Error(j.message || 'Could not unlock (' + r.status + ')');
      });
    });
  }

  // Served by a club server that has already let this browser in: configure
  // itself rather than making anyone paste a URL and a key.
  function adopt() {
    save(location.origin, '', true, 'cookie');
  }

  function pull() {
    if (!enabled()) return Promise.reject(new Error('Sync is off'));
    return fetch(base() + '?select=key,value,updated_ms', opts({ headers: headers() }))
      .then(check)
      .then(function (rows) {
        var incoming = {};
        rows.forEach(function (r) { incoming[r.key] = { v: r.value, t: r.updated_ms || 0 }; });
        var n = Store.mergeRecords(incoming);
        Store.saveData();
        Store.prefs.lastPull = Date.now();
        Store.savePrefs();
        Store.emit();
        return n;
      });
  }

  // The write itself, with no check on whether sync is switched on. Testing a
  // connection has to be possible before committing to it, so diagnose() uses
  // this directly; push() is the same thing behind the on/off gate.
  function sendRows() {
    var recs = Store.records();
    var rows = Object.keys(recs).map(function (k) {
      return { key: k, value: recs[k].v, updated_ms: recs[k].t || 0 };
    });
    if (!rows.length) return Promise.resolve(0);
    return fetch(base() + '?on_conflict=key', opts({
      method: 'POST',
      headers: headers({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
      body: JSON.stringify(rows)
    })).then(check).then(function () { return rows.length; });
  }

  function push() {
    if (!enabled()) return Promise.reject(new Error('Sync is off'));
    return sendRows();
  }

  // Pull first so we never clobber a friend's newer entry, then push the merge.
  function full() { return pull().then(function () { return push(); }); }

  function check(res) {
    if (!res.ok) {
      return res.text().then(function (t) {
        throw new Error('Sync failed (' + res.status + '): ' + (t || res.statusText).slice(0, 180));
      });
    }
    return res.status === 204 ? [] : res.json().catch(function () { return []; });
  }

  /* Answers "why isn't my data showing up" with something specific. Walks the
   * same path a real sync takes — reach the endpoint, read, write, read back —
   * and names the first thing that fails. */
  function diagnose() {
    var c = cfg();
    var steps = [];
    var done = function (ok, hint) { return { ok: ok, steps: steps, hint: hint }; };

    if (!c.url || !(c.key || c.mode === 'cookie')) {
      steps.push({ name: 'Configuration', ok: false,
        detail: 'No project URL or key saved yet — sync is off, so nothing is being sent anywhere.' });
      return Promise.resolve(done(false, 'Paste your Supabase project URL and anon public key above, then Turn on & sync.'));
    }
    steps.push({ name: 'Configuration', ok: true, detail: c.url });

    return fetch(base() + '?select=key&limit=1', opts({ headers: headers() }))
      .then(function (res) {
        if (res.status === 401 || res.status === 403) {
          steps.push({ name: 'Read', ok: false, detail: 'Rejected (' + res.status + ')' });
          throw { stop: true, hint: 'The server answered but refused the key. Check you copied the ' +
            'anon public key from Project Settings → API, not a different one.' };
        }
        if (res.status === 404) {
          steps.push({ name: 'Read', ok: false, detail: 'No club_data table (404)' });
          throw { stop: true, hint: 'Reached the server, but there is no club_data table on it. ' +
            'Run supabase/schema.sql in the SQL editor.' };
        }
        if (!res.ok) {
          steps.push({ name: 'Read', ok: false, detail: 'HTTP ' + res.status });
          throw { stop: true, hint: 'The server answered with an error. The full text is in the browser console.' };
        }
        steps.push({ name: 'Read', ok: true, detail: 'club_data is readable' });
        return sendRows();          // not push(): sync may not be switched on yet
      })
      .then(function (n) {
        steps.push({ name: 'Write', ok: true, detail: n + ' record' + (n === 1 ? '' : 's') + ' sent' });
        return fetch(base() + '?select=key', opts({ headers: headers() }));
      })
      .then(function (res) { return res.json(); })
      .then(function (rows) {
        steps.push({ name: 'Read back', ok: true, detail: rows.length + ' row' + (rows.length === 1 ? '' : 's') + ' on the server' });
        return done(true, rows.length ? '' : 'Connected, but the table is empty — log a day and it should appear.');
      })
      .catch(function (err) {
        if (err && err.stop) return done(false, err.hint);
        // fetch rejects rather than returning a status when the host cannot be
        // reached at all — the usual cause is not a Supabase URL.
        if (err instanceof TypeError) {
          steps.push({ name: 'Reach the server', ok: false, detail: 'No response' });
          return done(false, 'Could not reach that address at all. Three usual causes: the URL is wrong; ' +
            'the app was opened as a local file rather than from a web address, which browsers block; or it is ' +
            'not a Supabase REST endpoint. A plain Postgres connection string will never work here — the app ' +
            'speaks HTTP to Supabase, not the Postgres wire protocol.');
        }
        var msg = (err && err.message) || String(err);
        if (/401|403/.test(msg)) {
          steps.push({ name: 'Write', ok: false, detail: msg.slice(0, 120) });
          return done(false, 'Readable but not writable — the insert/update policies or the anon grants are ' +
            'missing. Re-running supabase/schema.sql fixes both.');
        }
        steps.push({ name: 'Write', ok: false, detail: msg.slice(0, 160) });
        return done(false, /^Sync failed \(/.test(msg)
          ? 'The server rejected the write; its own message is above.'
          : 'The write could not be completed. The detail above says why.');
      });
  }

  /* Is the site you are looking at also a club server? If so the shared board
   * needs no third party — same origin, and the database sits behind it. */
  var localProbe = null;
  function detectLocal() {
    if (location.protocol !== 'http:' && location.protocol !== 'https:') return Promise.resolve(null);
    // Asked on every Settings render, so answer it once per page load. On a
    // plain static host this is one expected 404, not seventeen.
    if (localProbe) return localProbe;
    localProbe = fetch(location.origin + '/rest/v1/health', { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { return j && j.club ? j : null; })
      .catch(function () { return null; });
    return localProbe;
  }

  function save(url, key, on, mode) {
    Store.prefs.sync = {
      url: (url || '').trim(), key: (key || '').trim(), on: !!on, mode: mode || ''
    };
    Store.savePrefs();
  }

  return { enabled: enabled, pull: pull, push: push, full: full, save: save, cfg: cfg,
           diagnose: diagnose, detectLocal: detectLocal, unlock: unlock, adopt: adopt };
})();
