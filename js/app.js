/* Accountability Club — views and interaction. */
(function () {
  'use strict';

  var view = document.getElementById('view');
  var ui = {
    tab: 'today',
    date: Store.today(),
    weekAnchor: Store.today(),
    barRange: 7,
    barMetric: 'steps',
    lineRange: 30,
    hiddenSeries: [],
    tableMode: { bars: false, line: false },
    dirty: false,
    needUnlock: false
  };
  var draft = null;
  var pendingCharts = {};

  var WA_ICON = '<svg class="wa-icon" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">' +
    '<path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91C21.96 6.45 17.5 2 12.04 2zm0 18.15h-.01a8.2 8.2 0 0 1-4.19-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.22 8.22 0 0 1-1.26-4.38c0-4.54 3.7-8.23 8.25-8.23 2.2 0 4.27.86 5.83 2.42a8.19 8.19 0 0 1 2.41 5.82c0 4.54-3.7 8.23-8.24 8.23zm4.52-6.16c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.13-.16.24-.64.8-.78.97-.14.16-.29.18-.54.06-.25-.13-1.05-.39-1.99-1.23-.74-.66-1.23-1.47-1.38-1.72-.14-.25-.01-.38.11-.5.11-.11.25-.29.37-.43.13-.15.17-.25.25-.41.08-.17.04-.31-.02-.43-.06-.12-.56-1.35-.76-1.84-.2-.48-.4-.42-.56-.43h-.47c-.17 0-.43.06-.66.31-.22.25-.86.85-.86 2.07 0 1.22.89 2.4 1.01 2.56.12.17 1.75 2.67 4.23 3.74.59.26 1.05.41 1.41.52.59.19 1.13.16 1.56.1.48-.07 1.47-.6 1.67-1.18.21-.58.21-1.08.15-1.18-.06-.11-.22-.17-.47-.29z"/></svg>';

  /* ------------------------------------------------------------- helpers */
  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
  }
  function fmt(n) {
    if (n === null || n === undefined || n === '') return '—';
    return Number(n).toLocaleString(undefined, { maximumFractionDigits: 1 });
  }
  function el(id) { return document.getElementById(id); }
  function toast(msg) {
    var host = el('toastHost');
    var t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    host.appendChild(t);
    setTimeout(function () { t.remove(); }, 2600);
  }
  function prettyDate(d) {
    var date = Store.parse(d), today = Store.today();
    if (d === today) return 'Today, ' + date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
    if (d === Store.shift(today, -1)) return 'Yesterday, ' + date.toLocaleDateString(undefined, { month: 'long', day: 'numeric' });
    return date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  }
  function unitLabel() { return Store.units(); }
  function activeSeriesIds() {
    return Store.people().map(function (p) { return p.id; })
      .filter(function (id) { return ui.hiddenSeries.indexOf(id) === -1; });
  }
  function visiblePeople() {
    return Store.people().filter(function (p) { return ui.hiddenSeries.indexOf(p.id) === -1; });
  }

  /* ------------------------------------------------------------ chrome */
  function applyTheme() {
    document.documentElement.setAttribute('data-theme', Store.prefs.theme);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', Store.prefs.theme === 'light' ? '#f5f7fa' : '#0b0f14');
  }
  function applyMe() {
    document.documentElement.style.setProperty('--me-color', Store.me().color);
  }
  function renderWhoami() {
    var chip = el('whoChip');
    if (!Store.hasIdentity()) { chip.hidden = true; return; }
    var me = Store.me();
    chip.hidden = false;
    chip.style.setProperty('--who', me.color);
    chip.innerHTML = '<span class="avatar">' + esc(me.initials) + '</span>' +
      '<span class="whochip-name">' + esc(me.name) + '</span>';
  }

  /* Nobody gets to the app without saying who they are. A wrong answer here
   * files someone else's run against you, so it is asked before anything else
   * renders. */
  function viewLogin() {
    if (ui.needUnlock) {
      return '<section class="login">' +
        '<span class="login-mark" aria-hidden="true">' +
          '<svg viewBox="0 0 100 100"><rect width="100" height="100" rx="24"/>' +
          '<path d="M28 62 L44 44 L56 54 L74 32" fill="none" stroke-width="9" ' +
          'stroke-linecap="round" stroke-linejoin="round"/></svg></span>' +
        '<h1>Enter the club passcode</h1>' +
        '<p>Once per device. After this the app just syncs — nothing else to set up.</p>' +
        '<div class="field"><input id="passcode" type="password" autocomplete="current-password" ' +
          'placeholder="Club passcode" aria-label="Club passcode"></div>' +
        '<div class="btn-row" style="margin-top:14px">' +
          '<button class="btn btn-primary" id="unlockBtn" style="flex:1">Unlock</button>' +
        '</div>' +
        '<p id="unlockError" class="unlock-error" hidden></p>' +
      '</section>';
    }
    return '<section class="login">' +
      '<span class="login-mark" aria-hidden="true">' +
        '<svg viewBox="0 0 100 100"><rect width="100" height="100" rx="24"/>' +
        '<path d="M28 62 L44 44 L56 54 L74 32" fill="none" stroke-width="9" ' +
        'stroke-linecap="round" stroke-linejoin="round"/></svg></span>' +
      '<h1>Select who you are to record your data</h1>' +
      '<p>Steps, weight, workouts and habits are all filed against whoever you pick.</p>' +
      '<div class="login-people">' + Store.people().map(function (p) {
        return '<button class="login-person" style="--pc:' + p.color + '" data-who="' + p.id + '">' +
          '<span class="avatar">' + esc(p.initials) + '</span>' +
          '<span class="login-name">' + esc(p.name) + '</span>' +
          '<span class="login-go" aria-hidden="true">→</span></button>';
      }).join('') + '</div>' +
      '<label class="login-remember">' +
        '<input type="checkbox" id="rememberMe" checked> Stay signed in on this device' +
      '</label>' +
    '</section>';
  }
  function renderSyncStatus(state, text) {
    var pill = el('syncStatus');
    pill.className = 'sync-pill' + (state ? ' ' + state : '');
    pill.textContent = text || (Sync.enabled() ? 'Cloud sync on' : 'Saved on this device');
  }

  /* ============================================================ TODAY */
  function viewToday() {
    var me = Store.me();
    var d = ui.date;
    var e = draft || Store.entry(me.id, d);
    var g = Store.goals(me.id);
    var stk = Store.streak(me.id);

    return '' +
      '<section class="hero">' +
        '<div class="hero-top">' +
          '<div>' +
            '<h1>' + esc(heroTitle(me, d)) + '</h1>' +
            '<div class="date">' + esc(heroSub(me, d)) + '</div>' +
          '</div>' +
          '<div class="hero-streak" id="heroStreak">' + streakHTML(stk) + '</div>' +
        '</div>' +
        '<div id="heroNudge">' + nudgeHTML() + '</div>' +
      '</section>' +

      '<div id="syncBanner"></div>' +

      '<div class="datestrip" id="dateStrip">' + dateStripHTML() + '</div>' +

      '<section class="card">' +
        '<div class="card-head"><h2>Log the day</h2><span class="sub" id="saveHint">Saves as you type</span></div>' +
        '<div class="fields">' +
          field('steps', 'Steps', 'number', e.steps, g.steps ? 'goal ' + fmt(g.steps) : '', '0') +
          field('active', 'Active minutes', 'number', e.active, g.active ? 'goal ' + g.active + ' min' : '', '0') +
          field('weight', 'Weight (' + unitLabel() + ')', 'number', e.weight, g.weight ? 'target ' + g.weight : '', '0.0') +
          '<div class="field wide">' +
            '<label>Workouts <span class="hint">· pick as many as you did</span></label>' +
            '<div class="chips" id="workoutChips">' + Store.WORKOUTS.map(function (w) {
              var on = e.workout.indexOf(w) !== -1;
              return '<button class="chip pick' + (on ? ' on' : '') + '" data-workout="' + esc(w) + '" ' +
                'aria-pressed="' + on + '">' + esc(w) + '</button>';
            }).join('') + '</div>' +
          '</div>' +
          '<div class="field wide">' +
            '<label>Habits <span class="hint">· ' + Store.POINTS.habit + ' pts each</span></label>' +
            '<div class="chips" id="habitChips">' + Store.HABITS.map(function (h) {
              var on = (e.habits || []).indexOf(h.id) !== -1;
              return '<button class="chip' + (on ? ' on' : '') + '" data-habit="' + h.id + '">' + h.icon + ' ' + esc(h.label) + '</button>';
            }).join('') + '</div>' +
          '</div>' +
          '<div class="field wide">' +
            '<label for="f_note">Note <span class="hint">· how did it feel?</span></label>' +
            '<textarea id="f_note" placeholder="Legs were heavy but got it done.">' + esc(e.note || '') + '</textarea>' +
          '</div>' +
        '</div>' +
        '<div class="btn-row">' +
          '<button class="btn btn-primary" id="saveBtn">Save day</button>' +
          '<button class="btn btn-ghost" id="clearBtn">Clear</button>' +
          waButton('shareDayBtn', 'Share day') +
          '<span class="spacer"></span>' +
          '<span class="saved-note" id="dayScore">' + dayScoreText(me.id, d) + '</span>' +
        '</div>' +
      '</section>' +

      '<section class="card" id="todayMeters">' + metersHTML() + '</section>' +

      '<div class="section-title"><h2>The crew</h2><span>' + esc(prettyDate(d).split(',')[0]) + '</span></div>' +
      '<div class="grid grid-3" id="todayCrew">' + crewHTML() + '</div>';
  }

  function field(key, label, type, value, hint, ph) {
    return '<div class="field">' +
      '<label for="f_' + key + '">' + esc(label) + (hint ? ' <span class="hint">· ' + esc(hint) + '</span>' : '') + '</label>' +
      '<input id="f_' + key + '" data-f="' + key + '" type="' + type + '" inputmode="decimal" step="any" min="0" ' +
      'placeholder="' + esc(ph || '') + '" value="' + (value === null || value === undefined ? '' : esc(value)) + '">' +
      '</div>';
  }

  function greeting() {
    var h = new Date().getHours();
    return h < 12 ? 'Morning' : h < 17 ? 'Afternoon' : 'Evening';
  }
  function isToday(d) { return d === Store.today(); }

  // A time-of-day greeting makes no sense while you are filling in last Tuesday,
  // so the hero follows the day on screen rather than the clock.
  function heroTitle(me, d) {
    if (isToday(d)) return greeting() + ', ' + me.name;
    var label = prettyDate(d);
    return label.indexOf('Yesterday') === 0 ? 'Yesterday' : label.split(',')[0];
  }
  function heroSub(me, d) {
    if (isToday(d)) return prettyDate(d);
    return Store.parse(d).toLocaleDateString(undefined, { day: 'numeric', month: 'long' }) +
      ' · catching up as ' + me.name;
  }
  function streakHTML(n) {
    if (!n) return '<span>🌱</span><span>Start a streak today</span>';
    return '<span>🔥</span><span><b>' + n + '</b> day' + (n === 1 ? '' : 's') + ' in a row</span>';
  }
  function dayScoreText(pid, d) {
    var s = Store.score(pid, d);
    return s ? s + ' / ' + Store.maxDailyScore() + ' points for this day' : 'Nothing logged for this day yet';
  }

  function nudgeHTML() {
    var me = Store.me(), today = Store.today();

    // Looking at another day: say something about THAT day. Telling someone
    // "you logged today" while they are editing last Tuesday is just wrong.
    if (ui.date !== today) {
      var past = Store.entry(me.id, ui.date);
      var when = Charts.dayLabel(ui.date);
      if (!Store.isLogged(past)) {
        return nudge('Nothing here yet.', 'Fill in ' + when + ' and it still counts towards the board.');
      }
      var bits = [];
      if (past.steps !== null) bits.push(fmt(past.steps) + ' steps');
      if (past.active !== null) bits.push(past.active + ' active min');
      if (past.weight !== null) bits.push(fmt(past.weight) + ' ' + unitLabel());
      if (past.workout.length) bits.push(past.workout.join(' + '));
      return nudge(when + ' is logged.',
        (bits.length ? bits.join(' · ') + ' · ' : '') + Store.score(me.id, ui.date) + ' points.');
    }

    var mine = Store.entry(me.id, today);
    if (!Store.isLogged(mine)) {
      return nudge('Two minutes.', 'Log today before you forget — a blank day breaks the streak.');
    }
    var missing = Store.people().filter(function (p) {
      return p.id !== me.id && !Store.isLogged(Store.entry(p.id, today));
    });
    if (missing.length) {
      var names = missing.map(function (p) { return p.name; }).join(' and ');
      return nudge('Your turn, ' + names + '.', 'You logged today. ' + names + ' ' + (missing.length > 1 ? "haven't" : "hasn't") + ' — go poke them.');
    }
    var board = ranking(Store.today());
    if (board[0].id === me.id && board.length > 1) {
      var lead = board[0].points - board[1].points;
      return nudge('Top of the board.', lead > 0 ? 'You lead by ' + lead + ' points. Hold it.' : "Dead level at the top — today decides it.");
    }
    var gap = board[0].points - board.filter(function (r) { return r.id === me.id; })[0].points;
    return nudge('All three logged today.', gap > 0 ? 'You are ' + gap + ' points behind ' + esc(Store.person(board[0].id).name) + '. Catchable.' : 'Everyone showed up. Good week.');
  }
  function nudge(title, body) {
    return '<div class="nudge"><span>⚡</span><span><b>' + esc(title) + '</b> ' + esc(body) + '</span></div>';
  }

  function dateStripHTML() {
    var me = Store.me(), today = Store.today();
    return Store.rangeBack(14, today).map(function (d) {
      var date = Store.parse(d);
      var logged = Store.isLogged(Store.entry(me.id, d));
      return '<button class="daybtn' + (logged ? ' has' : '') + (d === ui.date ? ' is-sel' : '') + '" data-date="' + d + '">' +
        '<span class="dow">' + esc(date.toLocaleDateString(undefined, { weekday: 'short' })) + '</span>' +
        '<span class="dnum">' + date.getDate() + '</span>' +
        '<span class="dot"></span></button>';
    }).join('');
  }

  function metersHTML() {
    var me = Store.me(), g = Store.goals(me.id);
    var e = draft || Store.entry(me.id, ui.date);
    var rows = [
      meterRow('Steps', e.steps, g.steps, fmt(e.steps) + ' / ' + fmt(g.steps), me.color),
      meterRow('Active', e.active, g.active, fmt(e.active) + ' / ' + g.active + ' min', me.color)
    ];
    if (g.weight && e.weight !== null) {
      var diff = e.weight - g.weight;
      rows.push('<div class="meter-row"><span class="ml">Target</span>' +
        '<span class="meter"><i style="--mc:' + me.color + ';width:100%"></i></span>' +
        '<span class="mv">' + (diff > 0 ? fmt(diff) + ' ' + unitLabel() + ' to go' : 'target hit 🎉') + '</span></div>');
    }
    return '<div class="card-head"><h2>Goals for this day</h2><span class="sub">Edit targets in Settings</span></div>' + rows.join('');
  }
  function meterRow(label, value, goal, text, color) {
    var pct = goal ? Math.min(100, Math.round(((value || 0) / goal) * 100)) : 0;
    return '<div class="meter-row"><span class="ml">' + esc(label) + '</span>' +
      '<span class="meter"><i style="--mc:' + color + ';width:' + pct + '%"></i></span>' +
      '<span class="mv">' + esc(text) + '</span></div>';
  }

  function crewHTML() {
    var d = ui.date, me = Store.me();
    return Store.people().map(function (p) {
      var e = (p.id === me.id && draft) ? draft : Store.entry(p.id, d);
      var logged = Store.isLogged(e);
      var g = Store.goals(p.id);
      var stk = Store.streak(p.id);
      var hit = (e.steps !== null && e.steps >= g.steps) || (e.active !== null && e.active >= g.active);
      return '<article class="person-card' + (logged ? '' : ' dim') + '" style="--pc:' + p.color + '">' +
        '<div class="pc-head">' +
          '<span class="avatar">' + esc(p.initials) + '</span>' +
          '<span><span class="pc-name">' + esc(p.name) + '</span>' +
          '<span class="pc-sub">' + (stk ? '🔥 ' + stk + ' day streak' : 'no streak yet') + '</span></span>' +
          '<span class="pc-flag ' + (logged ? 'flag-done' : 'flag-miss') + '">' +
            (logged ? (hit ? 'goal hit' : 'logged') : 'not logged') + '</span>' +
        '</div>' +
        '<div class="pc-stats">' +
          '<div class="pc-stat"><b>' + (e.steps === null ? '—' : Charts.compact(e.steps)) + '</b><span>steps</span></div>' +
          '<div class="pc-stat"><b>' + (e.active === null ? '—' : e.active) + '</b><span>min</span></div>' +
          '<div class="pc-stat"><b>' + (e.weight === null ? '—' : fmt(e.weight)) + '</b><span>' + esc(unitLabel()) + '</span></div>' +
        '</div>' +
        (e.workout.length || (e.habits && e.habits.length)
          ? '<div class="pc-habits">' +
              e.workout.map(function (w) { return '<span class="hbadge on">' + esc(w) + '</span>'; }).join('') +
              Store.HABITS.map(function (h) {
                var on = (e.habits || []).indexOf(h.id) !== -1;
                return on ? '<span class="hbadge on" title="' + esc(h.label) + '">' + h.icon + '</span>' : '';
              }).join('') +
            '</div>'
          : '') +
        (e.note ? '<div class="pc-note">' + esc(e.note) + '</div>' : '') +
        '</article>';
    }).join('');
  }

  /* ============================================================= BOARD */
  function ranking(anchor) {
    return Store.people().map(function (p) {
      return {
        id: p.id, name: p.name, color: p.color, initials: p.initials,
        points: Store.weekPoints(p.id, anchor),
        days: Store.weekDaysLogged(p.id, anchor),
        steps: Store.weekSteps(p.id, anchor),
        streak: Store.streak(p.id)
      };
    }).sort(function (a, b) { return b.points - a.points || b.steps - a.steps; });
  }

  function viewBoard() {
    var anchor = ui.weekAnchor;
    var start = Store.weekStart(anchor);
    var end = Store.shift(start, 6);
    var rows = ranking(anchor);
    var top = Math.max(1, rows[0].points);
    var isThisWeek = start === Store.weekStart(Store.today());

    var clubSteps = rows.reduce(function (a, r) { return a + r.steps; }, 0);
    var clubDays = rows.reduce(function (a, r) { return a + r.days; }, 0);
    var best = rows.slice().sort(function (a, b) { return b.streak - a.streak; })[0];
    var me = Store.me();
    var wNow = Store.latest(me.id, 'weight', 14);
    var wThen = weightAgo(me.id, 30);
    var wDelta = wNow && wThen ? wNow.value - wThen : null;

    return '' +
      '<div class="section-title">' +
        '<h2>Week of ' + esc(Charts.dayLabel(start)) + ' – ' + esc(Charts.dayLabel(end)) + '</h2>' +
        '<span class="chart-controls">' +
          '<button class="btn btn-ghost" data-week="-1" style="padding:6px 12px">‹ Prev</button>' +
          '<button class="btn btn-ghost" data-week="1" style="padding:6px 12px"' + (isThisWeek ? ' disabled' : '') + '>Next ›</button>' +
        '</span>' +
      '</div>' +

      '<div class="tiles">' +
        tile(Charts.compact(clubSteps), 'Club steps', 'this week') +
        tile(clubDays + ' / 21', 'Days logged', clubDays >= 18 ? 'strong week' : 'keep filling them in') +
        tile('🔥 ' + best.streak, 'Longest streak', best.streak ? best.name : 'nobody yet') +
        tile(wDelta === null ? '—' : (wDelta > 0 ? '+' : '') + fmt(Math.round(wDelta * 10) / 10),
             'Your 30d weight', weightDeltaNote(wDelta), weightDeltaClass(wDelta, wNow)) +
      '</div>' +

      '<section class="card">' +
        '<div class="card-head"><h2>Leaderboard</h2>' +
          '<span class="sub">' +
          Store.POINTS.logged + ' to log · ' + Store.POINTS.steps + ' step goal · ' + Store.POINTS.active +
          ' active goal · ' + Store.POINTS.weight + ' weigh-in · ' + Store.POINTS.habit + ' per habit</span>' +
          waButton('shareWeekBtn', 'Share the board') + '</div>' +
        '<div class="lb">' + rows.map(function (r, i) {
          var medal = ['🥇', '🥈', '🥉'][i] || (i + 1);
          return '<div class="lb-row' + (i === 0 && r.points > 0 ? ' lead' : '') + '" style="--pc:' + r.color + '">' +
            '<span class="lb-rank">' + medal + '</span>' +
            '<span class="avatar">' + esc(r.initials) + '</span>' +
            '<span class="lb-main">' +
              '<span class="lb-name">' + esc(r.name) + (r.streak ? ' <span class="hbadge">🔥 ' + r.streak + '</span>' : '') + '</span>' +
              '<span class="lb-bar"><i style="width:' + Math.round((r.points / top) * 100) + '%"></i></span>' +
              '<span class="lb-meta">' + r.days + '/7 days · ' + fmt(r.steps) + ' steps</span>' +
            '</span>' +
            '<span class="lb-pts">' + r.points + '<small>PTS</small></span>' +
          '</div>';
        }).join('') + '</div>' +
      '</section>' +

      '<section class="card">' +
        '<div class="card-head"><h2>Show-up grid</h2><span class="sub">Last 4 weeks · darker means a bigger day</span></div>' +
        gridHTML() +
      '</section>' +

      '<section class="card">' +
        '<div class="card-head"><h2>Consistency</h2><span class="sub">Days logged in the last 30</span></div>' +
        Store.people().map(function (p) {
          var pct = Store.consistency(p.id, 30);
          return meterRow(p.name, pct, 100, pct + '%', p.color);
        }).join('') +
      '</section>';
  }

  function waButton(id, label) {
    return '<span class="wa-pair">' +
      '<button class="btn btn-wa" id="' + id + '">' + WA_ICON + esc(label) + '</button>' +
      '<button class="btn btn-ghost btn-copy" data-copy="' + id + '" title="Copy the text instead" ' +
      'aria-label="Copy ' + esc(label) + ' text">⧉</button></span>';
  }

  // Composes the text for whichever share button was pressed.
  function shareTextFor(id) {
    if (id === 'shareWeekBtn') return Share.weekText(ui.weekAnchor, ranking(ui.weekAnchor));
    return Share.dayText(Store.me().id, ui.date);
  }

  function handleShare(id, copyOnly) {
    if (id === 'shareDayBtn') {
      readInputs();
      commit(false);                      // share what's on screen, not a stale save
      if (!Store.isLogged(Store.entry(Store.me().id, ui.date))) {
        toast('Log something first');
        return;
      }
    }
    var text = shareTextFor(id);
    if (copyOnly) {
      Share.copy(text).then(function () { toast('Copied — paste it anywhere'); })
        .catch(function () { toast('Could not copy'); });
      return;
    }
    Share.toWhatsApp(text);
  }

  /* One link each. Open yours and the app knows you without anybody picking
   * from a list — handy on a new phone, or after a browser clears its storage. */
  function personalLink(pid) {
    if (location.protocol !== 'http:' && location.protocol !== 'https:') return '';
    return location.origin + location.pathname.replace(/index\.html$/, '') + '?me=' + pid;
  }
  function personalLinks() {
    if (!personalLink('arvind')) {
      return '<p class="sd" style="margin:14px 0 0">Personal links appear once the app is ' +
        'served from a URL rather than opened as a local file.</p>';
    }
    return '<div class="linkrows">' +
      '<p class="sd" style="margin:0 0 10px">Send each other these. Opening your own link ' +
      'sets you on that device — worth adding yours to your home screen.</p>' +
      Store.people().map(function (p) {
        return '<div class="linkrow"><span class="legend-swatch" style="background:' + p.color + '"></span>' +
          '<code>?me=' + esc(p.id) + '</code>' +
          '<button class="btn btn-ghost btn-copy" data-copylink="' + p.id + '" ' +
          'aria-label="Copy ' + esc(p.name) + '\'s link">⧉</button></div>';
      }).join('') + '</div>';
  }

  function goalInput(pid, key, label, value, step, ph) {
    var id = 'goal_' + pid + '_' + key;
    return '<span class="mini"><label for="' + id + '">' + esc(label) + '</label>' +
      '<input id="' + id + '" type="number" data-goal="' + pid + ':' + key + '" min="0" step="' + step +
      '" placeholder="' + esc(ph) + '" value="' + (value === null || value === undefined ? '' : value) + '"></span>';
  }

  function tile(value, label, delta, cls) {
    return '<div class="tile"><div class="tv">' + esc(value) + '</div><div class="tl">' + esc(label) + '</div>' +
      (delta ? '<div class="td ' + (cls || 'flat') + '">' + esc(delta) + '</div>' : '') + '</div>';
  }

  // Down is not automatically good — someone here might be bulking. Only call
  // a direction positive when it moves toward a target the person actually set.
  function weightDeltaNote(delta) {
    if (delta === null) return 'log a weight to see this';
    if (Math.round(delta * 10) === 0) return 'holding steady';
    return unitLabel() + ' over 30 days';
  }
  function weightDeltaClass(delta, current) {
    var target = Store.goals(Store.me().id).weight;
    if (delta === null || !target || !current) return 'flat';
    var before = current.value - delta;
    return Math.abs(current.value - target) < Math.abs(before - target) ? 'up' : 'down';
  }

  function weightAgo(pid, days) {
    // Nearest logged weight at or before `days` ago, searching back two weeks.
    var cursor = Store.shift(Store.today(), -days);
    for (var i = 0; i < 14; i++) {
      var w = Store.entry(pid, cursor).weight;
      if (w !== null) return w;
      cursor = Store.shift(cursor, -1);
    }
    return null;
  }

  function gridHTML() {
    var days = Store.rangeBack(28);
    var max = Store.maxDailyScore();
    return '<div class="sgrid">' + Store.people().map(function (p) {
      return '<div class="sgrid-row">' +
        '<span class="sgrid-name">' + esc(p.name) + '</span>' +
        '<span class="sgrid-cells">' + days.map(function (d) {
          var s = Store.score(p.id, d);
          var strength = s === 0 ? 0 : Math.max(0.25, Math.min(1, s / max));
          var style = s === 0
            ? 'background:var(--bg-elev-2)'
            : 'background:color-mix(in srgb,' + p.color + ' ' + Math.round(strength * 100) + '%,var(--bg-elev-2))';
          return '<i class="sgrid-cell" style="' + style + '" title="' + esc(Charts.dayLabel(d) + ' · ' + s + ' pts') + '"></i>';
        }).join('') + '</span>' +
      '</div>';
    }).join('') + '</div>' +
    '<div class="sgrid-legend"><span>4 weeks ago</span><span>today</span></div>';
  }

  /* ============================================================ TRENDS */
  function viewTrends() {
    pendingCharts = {};
    var barDates = Store.rangeBack(ui.barRange);
    var lineDates = Store.rangeBack(ui.lineRange);
    var people = visiblePeople();
    var allPeople = Store.people();

    var barSeries = people.map(function (p) {
      return { id: p.id, name: p.name, color: p.color,
        values: barDates.map(function (d) { return Store.entry(p.id, d)[ui.barMetric]; }) };
    });
    var lineSeries = people.map(function (p) {
      return { id: p.id, name: p.name, color: p.color, points: Store.series(p.id, 'weight', lineDates) };
    });

    var goal = Store.goals(Store.me().id)[ui.barMetric];
    var barUnit = ui.barMetric === 'steps' ? '' : ' min';

    return '' +
      '<section class="card">' +
        '<div class="card-head">' +
          '<h2>Daily ' + (ui.barMetric === 'steps' ? 'steps' : 'active minutes') + '</h2>' +
          '<span class="chart-controls">' +
            '<span class="view-toggle">' +
              '<button data-metric="steps"' + (ui.barMetric === 'steps' ? ' class="on"' : '') + '>Steps</button>' +
              '<button data-metric="active"' + (ui.barMetric === 'active' ? ' class="on"' : '') + '>Active min</button>' +
            '</span>' +
            '<span class="range-pick">' +
              '<button data-brange="7"' + (ui.barRange === 7 ? ' class="on"' : '') + '>7d</button>' +
              '<button data-brange="14"' + (ui.barRange === 14 ? ' class="on"' : '') + '>14d</button>' +
            '</span>' +
            '<span class="view-toggle">' +
              '<button data-tmode="bars,chart"' + (!ui.tableMode.bars ? ' class="on"' : '') + '>Chart</button>' +
              '<button data-tmode="bars,table"' + (ui.tableMode.bars ? ' class="on"' : '') + '>Table</button>' +
            '</span>' +
          '</span>' +
        '</div>' +
        (ui.tableMode.bars
          ? Charts.table(barDates, barSeries, barUnit)
          : chartSlot('bars', 'bars', {
              dates: barDates, series: barSeries, goal: goal, unit: barUnit,
              goalLabel: 'your goal · ' + Charts.compact(goal),
              label: 'Daily ' + ui.barMetric + ' per person'
            })) +
        Charts.legend(allPeople.map(function (p) { return { id: p.id, name: p.name, color: p.color }; }), activeSeriesIds()) +
      '</section>' +

      '<section class="card">' +
        '<div class="card-head">' +
          '<h2>Weight trend (' + esc(unitLabel()) + ')</h2>' +
          '<span class="chart-controls">' +
            '<span class="range-pick">' +
              '<button data-lrange="30"' + (ui.lineRange === 30 ? ' class="on"' : '') + '>30d</button>' +
              '<button data-lrange="90"' + (ui.lineRange === 90 ? ' class="on"' : '') + '>90d</button>' +
              '<button data-lrange="365"' + (ui.lineRange === 365 ? ' class="on"' : '') + '>1y</button>' +
            '</span>' +
            '<span class="view-toggle">' +
              '<button data-tmode="line,chart"' + (!ui.tableMode.line ? ' class="on"' : '') + '>Chart</button>' +
              '<button data-tmode="line,table"' + (ui.tableMode.line ? ' class="on"' : '') + '>Table</button>' +
            '</span>' +
          '</span>' +
        '</div>' +
        (ui.tableMode.line
          ? Charts.table(lineDates, lineSeries, ' ' + unitLabel())
          : chartSlot('weight', 'line', {
              dates: lineDates, series: lineSeries, unit: ' ' + unitLabel(),
              label: 'Weight over the last ' + ui.lineRange + ' days'
            })) +
        Charts.legend(allPeople.map(function (p) { return { id: p.id, name: p.name, color: p.color }; }), activeSeriesIds()) +
      '</section>' +

      '<section class="card">' +
        '<div class="card-head"><h2>Personal bests</h2><span class="sub">All time</span></div>' +
        '<div class="tiles">' + Store.people().map(function (p) {
          var b = bestDay(p.id);
          return tile(b ? Charts.compact(b.steps) : '—', p.name + ' · best steps', b ? Charts.dayLabel(b.date) : 'no data yet');
        }).join('') +
        tile(String(totalLogged()), 'Days logged', 'across the club') +
        '</div>' +
      '</section>';
  }

  /* Charts are drawn after layout so one SVG unit equals one CSS pixel —
   * a scaled viewBox would blow the labels up on desktop and shrink them to
   * nothing on a phone. */
  function chartSlot(id, type, opts) {
    pendingCharts[id] = { type: type, opts: opts };
    return '<div class="chart-wrap" data-chart="' + id + '"></div>';
  }
  function drawCharts() {
    Object.keys(pendingCharts).forEach(function (id) {
      var wrap = view.querySelector('.chart-wrap[data-chart="' + id + '"]');
      if (!wrap) return;
      var spec = pendingCharts[id];
      spec.opts.width = Math.floor(wrap.clientWidth) || 720;
      wrap.innerHTML = Charts[spec.type](spec.opts);
      wrap.dataset.wired = '';
      Charts.attach(wrap);
    });
  }

  function bestDay(pid) {
    var recs = Store.records(), best = null;
    Object.keys(recs).forEach(function (k) {
      if (k.indexOf('entry:' + pid + ':') !== 0) return;
      var v = recs[k].v;
      if (v && v.steps && (!best || v.steps > best.steps)) best = { steps: v.steps, date: k.split(':')[2] };
    });
    return best;
  }
  function totalLogged() {
    var recs = Store.records(), n = 0;
    Object.keys(recs).forEach(function (k) {
      if (k.indexOf('entry:') === 0 && recs[k].v) n++;         // skip tombstones
    });
    return n;
  }

  /* ========================================================== SETTINGS */
  function viewSettings() {
    var s = Sync.cfg();
    var st = Store.stats();
    var me = Store.me();
    return '' +
      '<section class="card">' +
        '<div class="card-head"><h2>You</h2><span class="sub">Everything you log is filed against this</span></div>' +
        '<div class="signed-in" style="--pc:' + me.color + '">' +
          '<span class="avatar">' + esc(me.initials) + '</span>' +
          '<span class="signed-who"><b>' + esc(me.name) + '</b>' +
            '<span class="sd">' + (Store.isRemembered()
              ? 'Signed in on this device'
              : 'Signed in for this session only') + '</span></span>' +
          '<button class="btn btn-ghost" id="signOutBtn">Sign out</button>' +
        '</div>' +
        '<p class="sd" style="margin:12px 0 0">Signing out only forgets who you are here. ' +
        'Every logged day stays exactly where it is.</p>' +
        personalLinks() +
      '</section>' +

      '<section class="card">' +
        '<div class="card-head"><h2>Your goals</h2><span class="sub">Each of us sets our own</span></div>' +
        Store.people().map(function (p) {
          var g = Store.goals(p.id);
          return '<div class="set-row">' +
            '<div><div class="sl"><span class="legend-swatch" style="display:inline-block;background:' + p.color +
              ';vertical-align:0"></span> ' + esc(p.name) + '</div>' +
              '<div class="sd">Daily steps, daily active minutes, and an optional target weight.</div></div>' +
            '<div class="sc">' +
              goalInput(p.id, 'steps', 'Steps', g.steps, 500, '') +
              goalInput(p.id, 'active', 'Active min', g.active, 5, '') +
              goalInput(p.id, 'weight', 'Target ' + unitLabel(), g.weight, 0.5, 'optional') +
            '</div></div>';
        }).join('') +
      '</section>' +

      '<section class="card">' +
        '<div class="card-head"><h2>Preferences</h2></div>' +
        '<div class="set-row"><div><div class="sl">Weight units</div><div class="sd">Shared by everyone so the board compares like for like.</div></div>' +
          '<div class="sc"><span class="view-toggle">' +
            '<button data-units="kg"' + (Store.units() === 'kg' ? ' class="on"' : '') + '>kg</button>' +
            '<button data-units="lb"' + (Store.units() === 'lb' ? ' class="on"' : '') + '>lb</button>' +
          '</span></div></div>' +
        '<div class="set-row"><div><div class="sl">Theme</div><div class="sd">Dark by default. Light works too.</div></div>' +
          '<div class="sc"><span class="view-toggle">' +
            '<button data-set-theme="dark"' + (Store.prefs.theme === 'dark' ? ' class="on"' : '') + '>Dark</button>' +
            '<button data-set-theme="light"' + (Store.prefs.theme === 'light' ? ' class="on"' : '') + '>Light</button>' +
          '</span></div></div>' +
      '</section>' +

      '<section class="card">' +
        '<div class="card-head"><h2>Shared board (optional)</h2><span class="sub">' +
          (Sync.enabled() ? 'On' : 'Off') + '</span></div>' +
        '<p class="sd" style="margin:0 0 14px;color:var(--text-dim);font-size:13.5px">' +
          'Without this the app is yours alone on this device — which is fine. Point all three of us at the same ' +
          'server and the board becomes shared. That can be this site itself, if it is running with a database ' +
          'behind it, or a Supabase project. Setup steps are in the README.</p>' +
        '<div class="fields">' +
          '<div class="field wide"><label for="syncUrl">Server URL</label>' +
            '<input id="syncUrl" type="text" placeholder="https://your-app.up.railway.app" value="' + esc(s.url) + '"></div>' +
          '<div class="field wide"><label for="syncKey">Key</label>' +
            '<input id="syncKey" type="text" placeholder="eyJhbGciOi..." value="' + esc(s.key) + '"></div>' +
        '</div>' +
        '<div class="btn-row">' +
          '<button class="btn btn-primary" id="syncSave">' + (s.on ? 'Save & sync now' : 'Turn on & sync') + '</button>' +
          '<button class="btn btn-ghost" id="syncTest">Test connection</button>' +
          (s.on ? '<button class="btn btn-ghost" id="syncOff">Turn off</button>' : '') +
          '<span class="spacer"></span>' +
          '<span class="saved-note">' + (Store.prefs.lastPull ? 'Last synced ' + new Date(Store.prefs.lastPull).toLocaleString() : 'Never synced') + '</span>' +
        '</div>' +
        '<div id="serverHint"></div>' +
        '<div id="syncReport"></div>' +
      '</section>' +

      '<section class="card">' +
        '<div class="card-head"><h2>Your data</h2><span class="sub">' + st.entries + ' logged days on this device</span></div>' +
        '<div class="set-row"><div><div class="sl">Backup</div><div class="sd">Download every record as JSON, or merge a file a friend sent you.</div></div>' +
          '<div class="sc"><button class="btn btn-ghost" id="exportBtn">Export</button>' +
          '<button class="btn btn-ghost" id="importBtn">Import</button>' +
          '<input type="file" id="importFile" accept="application/json,.json" hidden></div></div>' +
        '<div class="set-row"><div><div class="sl">Erase everything</div><div class="sd">Wipes local records. If sync is on, the cloud copy stays until someone pushes over it.</div></div>' +
          '<div class="sc"><button class="btn btn-danger" id="resetBtn">Erase</button></div></div>' +
      '</section>';
  }

  /* =========================================================== render */
  function render() {
    applyTheme();
    applyMe();
    renderWhoami();
    renderSyncStatus();
    var known = Store.hasIdentity() && !ui.needUnlock;
    document.getElementById('tabs').hidden = !known;
    document.documentElement.classList.toggle('is-signed-out', !known);
    if (!known) {
      view.innerHTML = viewLogin();
      var pc = el('passcode');
      if (pc) pc.focus();
      return;
    }
    document.querySelectorAll('.tab').forEach(function (t) {
      t.classList.toggle('is-active', t.dataset.view === ui.tab);
    });
    view.innerHTML = ui.tab === 'today' ? viewToday()
      : ui.tab === 'board' ? viewBoard()
      : ui.tab === 'trends' ? viewTrends()
      : viewSettings();
    drawCharts();
    scrollStripToSelection();
    if (ui.tab === 'settings') offerLocalServer();
    if (ui.tab === 'today') showSyncBanner();
    window.scrollTo({ top: 0, behavior: 'instant' in document.body.style ? 'instant' : 'auto' });
  }

  // The strip runs two weeks back; on a narrow screen the selected day would
  // otherwise sit off to the right, out of sight.
  function scrollStripToSelection() {
    var strip = el('dateStrip');
    if (!strip) return;
    var sel = strip.querySelector('.is-sel');
    if (!sel) return;
    strip.scrollLeft = Math.max(0, sel.offsetLeft - strip.clientWidth + sel.offsetWidth + 8);
  }

  function refreshToday() {
    if (ui.tab !== 'today') return;
    var crew = el('todayCrew'); if (crew) crew.innerHTML = crewHTML();
    var meters = el('todayMeters'); if (meters) meters.innerHTML = metersHTML();
    var strip = el('dateStrip'); if (strip) { strip.innerHTML = dateStripHTML(); scrollStripToSelection(); }
    var hs = el('heroStreak'); if (hs) hs.innerHTML = streakHTML(Store.streak(Store.me().id));
    var hn = el('heroNudge'); if (hn) hn.innerHTML = nudgeHTML();
    var ds = el('dayScore'); if (ds) ds.textContent = dayScoreText(Store.me().id, ui.date);
  }

  /* =========================================================== drafts */
  function ensureDraft() {
    if (!draft) draft = Store.entry(Store.me().id, ui.date);
    return draft;
  }
  function commit(loud) {
    if (!draft) return;
    Store.saveEntry(Store.me().id, ui.date, draft);
    draft = null;
    refreshToday();
    if (loud) toast('Saved · ' + Charts.dayLabel(ui.date));
    if (Sync.enabled()) queuePush();
  }

  var pushTimer = null;
  function queuePush() {
    clearTimeout(pushTimer);
    pushTimer = setTimeout(function () {
      Sync.push().then(function () { renderSyncStatus('ok', 'Synced'); })
        .catch(function (err) {
          renderSyncStatus('err', 'Sync error — open Settings and Test connection');
          console.warn(err);
        });
    }, 1200);
  }

  /* =========================================================== events */
  document.getElementById('tabs').addEventListener('click', function (ev) {
    var t = ev.target.closest('.tab');
    if (!t) return;
    commit(false);
    ui.tab = t.dataset.view;
    render();
  });

  document.getElementById('whoChip').addEventListener('click', function () {
    commit(false);
    ui.tab = 'settings';
    render();
  });

  document.getElementById('themeBtn').addEventListener('click', function () {
    Store.prefs.theme = Store.prefs.theme === 'dark' ? 'light' : 'dark';
    Store.savePrefs();
    render();
  });

  view.addEventListener('click', function (ev) {
    var t = ev.target;
    var hit = function (sel) { return t.closest(sel); };
    var n;

    if ((n = hit('[data-who]'))) {
      commit(false);
      var remember = !el('rememberMe') || el('rememberMe').checked;
      Store.signIn(n.dataset.who, remember);      // emits, so render() follows
      ui.tab = 'today';
      render();
      toast('Hello, ' + Store.me().name);
      return;
    }
    if (hit('#signOutBtn')) {
      commit(false);
      Store.signOut();                            // emits; lands on the login screen
      return;
    }
    if ((n = hit('[data-copylink]'))) {
      Share.copy(personalLink(n.dataset.copylink))
        .then(function () { toast('Link copied'); })
        .catch(function () { toast('Could not copy'); });
      return;
    }

    if ((n = hit('[data-date]'))) { commit(false); ui.date = n.dataset.date; render(); return; }

    if ((n = hit('[data-habit]'))) {
      var e = ensureDraft();
      e.habits = e.habits || [];
      var id = n.dataset.habit, i = e.habits.indexOf(id);
      if (i === -1) e.habits.push(id); else e.habits.splice(i, 1);
      n.classList.toggle('on');
      commit(false); return;
    }

    if ((n = hit('[data-workout]'))) {
      var d2 = ensureDraft();
      d2.workout = Store.workoutList(d2.workout);
      var w = n.dataset.workout;
      var at = d2.workout.indexOf(w);

      if (at !== -1) {
        d2.workout.splice(at, 1);
      } else if (Store.SOLO_WORKOUTS.indexOf(w) !== -1) {
        d2.workout = [w];                                  // Rest replaces everything
      } else {
        d2.workout = d2.workout.filter(function (x) {       // and anything else clears Rest
          return Store.SOLO_WORKOUTS.indexOf(x) === -1;
        }).concat(w);
      }

      view.querySelectorAll('[data-workout]').forEach(function (c) {
        var on = d2.workout.indexOf(c.dataset.workout) !== -1;
        c.classList.toggle('on', on);
        c.setAttribute('aria-pressed', on);
      });
      commit(false); return;
    }

    if ((n = hit('[data-copy]'))) { handleShare(n.dataset.copy, true); return; }
    if ((n = hit('#shareDayBtn, #shareWeekBtn'))) { handleShare(n.id, false); return; }

    if (hit('#saveBtn')) { readInputs(); commit(true); return; }
    if (hit('#clearBtn')) {
      if (confirm('Clear everything logged for ' + Charts.dayLabel(ui.date) + '?')) {
        draft = null; Store.clearEntry(Store.me().id, ui.date);
        if (Sync.enabled()) queuePush();
        toast('Cleared'); render();
      }
      return;
    }

    if ((n = hit('[data-week]'))) { ui.weekAnchor = Store.shift(ui.weekAnchor, 7 * parseInt(n.dataset.week, 10)); render(); return; }
    if ((n = hit('[data-metric]'))) { ui.barMetric = n.dataset.metric; render(); return; }
    if ((n = hit('[data-brange]'))) { ui.barRange = parseInt(n.dataset.brange, 10); render(); return; }
    if ((n = hit('[data-lrange]'))) { ui.lineRange = parseInt(n.dataset.lrange, 10); render(); return; }
    if ((n = hit('[data-tmode]'))) {
      var parts = n.dataset.tmode.split(',');
      ui.tableMode[parts[0]] = parts[1] === 'table';
      render(); return;
    }
    if ((n = hit('[data-series]'))) {
      var sid = n.dataset.series, k = ui.hiddenSeries.indexOf(sid);
      if (k === -1) {
        if (ui.hiddenSeries.length >= Store.people().length - 1) { toast('Keep at least one person on the chart'); return; }
        ui.hiddenSeries.push(sid);
      } else ui.hiddenSeries.splice(k, 1);
      render(); return;
    }

    if ((n = hit('[data-units]'))) { Store.setUnits(n.dataset.units); if (Sync.enabled()) queuePush(); render(); return; }
    if ((n = hit('[data-set-theme]'))) { Store.prefs.theme = n.dataset.setTheme; Store.savePrefs(); render(); return; }

    if (hit('#syncSave')) { saveSync(); return; }
    if (hit('#syncTest')) { runDiagnostic(); return; }
    if (hit('#unlockBtn')) {
      var pc = el('passcode'), err = el('unlockError');
      var btn = n || document.getElementById('unlockBtn');
      btn.disabled = true;
      err.hidden = true;
      Sync.unlock(pc.value).then(function () {
        ui.needUnlock = false;
        toast('Unlocked — this device is set up');
        render();
        backgroundPull();
      }).catch(function (e) {
        btn.disabled = false;
        err.textContent = e.message;
        err.hidden = false;
        pc.select();
      });
      return;
    }
    if (hit('#bannerGo')) { ui.tab = 'settings'; render(); return; }
    if (hit('#useLocal')) {
      el('syncUrl').value = location.origin;
      el('syncKey').focus();
      toast('Now paste the club key');
      return;
    }
    if (hit('#syncOff')) {
      // keep the mode, or the next load would treat this device as unconfigured
      Sync.save(el('syncUrl').value, el('syncKey').value, false, Sync.cfg().mode);
      toast('Sync off');
      render();
      return;
    }
    if (hit('#exportBtn')) { doExport(); return; }
    if (hit('#importBtn')) { el('importFile').click(); return; }
    if (hit('#resetBtn')) {
      if (confirm('Erase all local records? This cannot be undone.')) { Store.resetAll(); toast('Erased'); render(); }
      return;
    }
  });

  // "Saves as you type" for real — debounced, and safe now that a save no
  // longer re-renders the form.
  var typeTimer = null;
  view.addEventListener('input', function (ev) {
    var t = ev.target;
    if (!t.matches('[data-f]') && t.id !== 'f_note') return;
    clearTimeout(typeTimer);
    typeTimer = setTimeout(function () { readInputs(); commit(false); }, 500);
  });

  view.addEventListener('change', function (ev) {
    var t = ev.target;
    if (t.matches('[data-f]') || t.id === 'f_note') { clearTimeout(typeTimer); readInputs(); commit(false); return; }
    if (t.matches('[data-goal]')) {
      var parts = t.dataset.goal.split(':');
      var g = Store.goals(parts[0]);
      g[parts[1]] = t.value === '' ? null : Store.num(t.value);
      Store.saveGoals(parts[0], g);
      if (Sync.enabled()) queuePush();
      toast('Goal updated');
      return;
    }
    if (t.id === 'importFile' && t.files && t.files[0]) {
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var n = Store.importJSON(String(reader.result));
          toast('Merged ' + n + ' record' + (n === 1 ? '' : 's'));
          render();
        } catch (err) { alert('Could not read that file: ' + err.message); }
      };
      reader.readAsText(t.files[0]);
    }
  });

  function readInputs() {
    var e = ensureDraft();
    ['steps', 'active', 'weight'].forEach(function (k) {
      var input = el('f_' + k);
      if (input) e[k] = input.value === '' ? null : Store.num(input.value);
    });
    var note = el('f_note');
    if (note) e.note = note.value;
  }

  function saveSync() {
    var url = el('syncUrl').value.trim(), key = el('syncKey').value.trim();
    if (!url || !key) { alert('Both the project URL and the anon key are needed.'); return; }
    Sync.save(url, key, true);
    renderSyncStatus('', 'Syncing…');
    Sync.full().then(function () {
      renderSyncStatus('ok', 'Synced');
      toast('Shared board is live');
      render();
    }).catch(function (err) {
      renderSyncStatus('err', 'Sync error');
      alert(err.message);
    });
  }

  /* Silence is the worst answer to "why isn't my data saved". If the site is its
   * own club server, it already knows what is wrong; say so on the screen the
   * person is actually looking at, rather than only in Settings. */
  /* The site is its own club server, so there is nothing to configure — either
   * this browser is already let in, or it needs the passcode once. */
  function considerLocalServer() {
    return Sync.detectLocal().then(function (info) {
      if (!info || !info.database) return;
      if (info.unlocked) {
        // Adopt only when this device has never been set up. Re-adopting merely
        // because sync is off would mean Turn off never survived a reload.
        if (Sync.cfg().mode !== 'cookie') { Sync.adopt(); backgroundPull(); }
        ui.needUnlock = false;
      } else if (info.locked && !Sync.enabled()) {
        ui.needUnlock = true;
      }
    });
  }

  function showSyncBanner() {
    Sync.detectLocal().then(function (info) {
      var box = el('syncBanner');
      if (!box || !info) return;                 // not a club server: nothing to add

      var msg = null, cta = true;
      if (!info.database) {
        msg = 'This site can\'t reach its database, so nothing is being stored beyond ' +
              'this device. ' + (info.configured ? 'The database is unreachable.' : 'No database is attached to it.');
        cta = false;
      } else if (!info.locked) {
        msg = 'This site has a database but no club key, so its shared board is switched ' +
              'off. Whoever runs it needs to set CLUB_KEY.';
        cta = false;
      } else if (!Sync.enabled()) {
        msg = 'Your days are saved on this device only. This site can share them with ' +
              'everyone — switch the shared board on.';
      } else {
        return;                                   // configured and healthy
      }

      box.innerHTML = '<div class="banner">' +
        '<span class="banner-mark" aria-hidden="true">!</span>' +
        '<span class="banner-text">' + esc(msg) + '</span>' +
        (cta ? '<button class="btn btn-primary" id="bannerGo">Set it up</button>' : '') +
      '</div>';
    });
  }

  /* When the app is served by its own club server, say so and offer it in one
   * tap — there is nothing to sign up for in that case. */
  function offerLocalServer() {
    Sync.detectLocal().then(function (info) {
      var box = el('serverHint');
      if (!box || !info) return;
      var already = (Sync.cfg().url || '').replace(/\/+$/, '') === location.origin;
      box.innerHTML = '<div class="report report-ok">' +
        '<p class="report-line"><span class="report-mark">✓</span>' +
        '<b>This site</b><span>is its own club server' +
        (info.database ? ', with a database behind it' : ', but no database is attached to it') +
        (info.locked ? '' : ' and no key set, so its data API is off') + '.</span></p>' +
        (already ? '' : '<p style="margin:11px 0 0"><button class="btn btn-ghost" id="useLocal">' +
          'Use this server</button></p>') +
      '</div>';
    });
  }

  function runDiagnostic() {
    var box = el('syncReport');
    var url = el('syncUrl'), key = el('syncKey');
    // test what is on screen, so you can check a key before committing to it
    if (url && key) Sync.save(url.value, key.value, Sync.cfg().on);
    box.innerHTML = '<div class="report"><p class="report-line">Testing…</p></div>';

    Sync.diagnose().then(function (r) {
      box.innerHTML = '<div class="report' + (r.ok ? ' report-ok' : ' report-bad') + '">' +
        r.steps.map(function (st) {
          return '<p class="report-line"><span class="report-mark">' + (st.ok ? '✓' : '✕') + '</span>' +
            '<b>' + esc(st.name) + '</b><span>' + esc(st.detail) + '</span></p>';
        }).join('') +
        (r.hint ? '<p class="report-hint">' + esc(r.hint) + '</p>' : '') +
      '</div>';
      renderSyncStatus(r.ok ? 'ok' : 'err', r.ok ? 'Synced' : 'Sync error');
    });
  }

  function doExport() {
    var blob = new Blob([Store.exportJSON()], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'accountability-club-' + Store.today() + '.json';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    toast('Exported');
  }

  /* ============================================================= boot */

  /* ?me=<id> identifies whoever opened the link, then the query is stripped:
   * a URL copied out of the address bar afterwards should not hand your
   * identity to whoever you send it to. localStorage carries it from here. */
  function adoptIdentityFromUrl() {
    var m = /[?&]me=([a-z0-9_-]+)/i.exec(location.search);
    if (m && Store.knows(m[1].toLowerCase())) Store.signIn(m[1].toLowerCase(), true);
    if (m && location.search && window.history && history.replaceState) {
      history.replaceState(null, '', location.pathname + location.hash);
    }
  }
  adoptIdentityFromUrl();

  Store.onChange(function () { render(); });

  // Pull on load and when the tab regains focus, so the board is never stale.
  function backgroundPull() {
    if (!Sync.enabled()) return;
    renderSyncStatus('', 'Syncing…');
    Sync.pull()
      .then(function () { renderSyncStatus('ok', 'Synced'); })
      .catch(function (err) {
        renderSyncStatus('err', 'Sync error — open Settings and Test connection');
        console.warn(err);
      });
  }
  var resizeTimer = null;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () { if (ui.tab === 'trends') drawCharts(); }, 150);
  });

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) backgroundPull();
  });
  window.addEventListener('beforeunload', function () { commit(false); });

  render();
  backgroundPull();

  // Ask the server what it is, then paint again: a device that still needs the
  // club passcode should land on that rather than on the person picker, and one
  // already let in should configure itself with nothing typed.
  considerLocalServer().then(render);
})();
