/* Composes WhatsApp-ready summaries and hands them to the app.
 *
 * WhatsApp's own markup is used for emphasis: *bold*, _italic_. Everything goes
 * through wa.me, which opens the chat picker with the text pre-filled — no API,
 * no bot, no server. You pick the group and hit send. */
var Share = (function () {
  'use strict';

  function fmt(n) {
    if (n === null || n === undefined || n === '') return '';
    return Number(n).toLocaleString(undefined, { maximumFractionDigits: 1 });
  }
  function shortDate(d) {
    return Store.parse(d).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  }
  function plainDate(d) {   // no weekday — reads better inside a range
    return Store.parse(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  }
  function habitIcons(ids) {
    return Store.HABITS.filter(function (h) { return (ids || []).indexOf(h.id) !== -1; })
      .map(function (h) { return h.icon; }).join(' ');
  }
  // Only when the app is actually hosted somewhere the others can open.
  function appLink() {
    if (location.protocol !== 'http:' && location.protocol !== 'https:') return '';
    if (/^(localhost|127\.|0\.0\.0\.0)/.test(location.hostname)) return '';
    return location.origin + location.pathname.replace(/index\.html$/, '');
  }

  /* One person's day. */
  function dayText(pid, date) {
    var p = Store.person(pid);
    var e = Store.entry(pid, date);
    var g = Store.goals(pid);
    var u = Store.units();
    var lines = ['*' + p.name + ' · ' + shortDate(date) + '*'];

    if (e.steps !== null) lines.push('👟 ' + fmt(e.steps) + ' steps' + (e.steps >= g.steps ? ' ✅' : ''));
    if (e.active !== null) lines.push('⚡ ' + fmt(e.active) + ' active min' + (e.active >= g.active ? ' ✅' : ''));
    if (e.weight !== null) lines.push('⚖️ ' + fmt(e.weight) + ' ' + u);
    if (e.workout.length) lines.push('🏋️ ' + e.workout.join(' + '));
    if (e.habits && e.habits.length) {
      lines.push('✅ ' + e.habits.length + '/' + Store.HABITS.length + ' habits  ' + habitIcons(e.habits));
    }
    if (e.note) lines.push('_“' + e.note + '”_');

    var streak = Store.streak(pid);
    var score = Store.score(pid, date);
    var tail = [];
    if (streak) tail.push('🔥 ' + streak + '-day streak');
    if (score) tail.push(score + '/' + Store.maxDailyScore() + ' pts');
    if (tail.length) lines.push('', tail.join(' · '));

    return lines.join('\n');
  }

  /* The whole week's board. */
  function weekText(anchor, rows) {
    var start = Store.weekStart(anchor);
    var end = Store.shift(start, 6);
    var medals = ['🥇', '🥈', '🥉'];
    var lines = ['*🏆 Accountability Club*', '_week of ' + plainDate(start) + ' – ' + plainDate(end) + '_', ''];

    rows.forEach(function (r, i) {
      lines.push((medals[i] || (i + 1) + '.') + ' *' + r.name + '* · ' + r.points + ' pts');
      var bits = [r.days + '/7 days'];
      if (r.steps) bits.push(fmt(r.steps) + ' steps');
      if (r.streak) bits.push('🔥' + r.streak);
      lines.push('     ' + bits.join(' · '));
    });

    var clubSteps = rows.reduce(function (a, r) { return a + r.steps; }, 0);
    var clubDays = rows.reduce(function (a, r) { return a + r.days; }, 0);
    lines.push('', fmt(clubSteps) + ' steps between us, ' + clubDays + '/21 days logged.');

    var link = appLink();
    if (link) lines.push('', link);
    return lines.join('\n');
  }

  /* Hand off to WhatsApp. wa.me opens the app on a phone and WhatsApp Web on a
   * desktop; either way the person picks the chat, so nothing is sent silently. */
  function toWhatsApp(text) {
    var url = 'https://wa.me/?text=' + encodeURIComponent(text);
    var w = window.open(url, '_blank', 'noopener');
    if (!w) location.href = url;   // popup blocked — go directly
    return url;
  }

  function copy(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      try {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.cssText = 'position:fixed;top:-1000px;opacity:0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
        resolve();
      } catch (e) { reject(e); }
    });
  }

  return { dayText: dayText, weekText: weekText, toWhatsApp: toWhatsApp, copy: copy, appLink: appLink };
})();
