/* Dependency-free SVG charts: a multi-series line and a grouped bar chart.
 * Both render to a string; call Charts.attach(wrapEl) afterwards to wire the
 * crosshair/tooltip layer. Text always uses ink tokens — never the series
 * colour — so identity is carried by the mark beside it. */
var Charts = (function () {
  'use strict';

  var INK = 'var(--text)', DIM = 'var(--text-dim)', FAINT = 'var(--text-faint)';
  var GRID = 'var(--line-soft)', AXIS = 'var(--line)', SURFACE = 'var(--bg-elev)';

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function round(n, d) { var f = Math.pow(10, d || 0); return Math.round(n * f) / f; }

  // Human tick values: 1/2/2.5/5 × 10^n.
  function niceStep(raw) {
    var mag = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10));
    var norm = raw / mag;
    var step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
    return step * mag;
  }
  function scale(min, max, count) {
    if (!isFinite(min) || !isFinite(max)) { min = 0; max = 1; }
    if (min === max) { min -= Math.abs(min || 1) * 0.1; max += Math.abs(max || 1) * 0.1; }
    var step = niceStep((max - min) / Math.max(1, count));
    var lo = Math.floor(min / step) * step;
    var hi = Math.ceil(max / step) * step;
    var ticks = [];
    for (var v = lo; v <= hi + step * 0.001; v += step) ticks.push(round(v, 6));
    return { lo: lo, hi: hi, ticks: ticks };
  }

  function dayLabel(dateStr) {
    var d = Store.parse(dateStr);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  function dowLabel(dateStr) {
    return Store.parse(dateStr).toLocaleDateString(undefined, { weekday: 'short' });
  }
  function compact(n) {
    if (n === null || n === undefined) return '—';
    if (Math.abs(n) >= 10000) return round(n / 1000, 1) + 'k';
    return String(round(n, 1));
  }

  /* ------------------------------------------------------------------ line */
  /* series: [{ id, name, color, points:[{date, value}] }] — nulls are skipped
   * and the line bridges the gap, because weight is logged irregularly and a
   * dotted confetti of segments reads worse than a continuous trend. */
  function line(opts) {
    var dates = opts.dates, series = opts.series || [];
    var W = Math.max(300, opts.width || 720);
    var H = opts.height || (W < 480 ? 210 : 250);
    var roomy = W >= 480;                 // direct labels need elbow room
    var padL = 44, padR = roomy ? 84 : 14, padT = 16, padB = 28;
    var plotW = W - padL - padR, plotH = H - padT - padB;

    var vals = [];
    series.forEach(function (s) {
      s.points.forEach(function (p) { if (p.value !== null && p.value !== undefined) vals.push(p.value); });
    });
    if (!vals.length) return empty('Nothing logged yet for this stretch.');

    var sc = scale(Math.min.apply(null, vals), Math.max.apply(null, vals), 4);
    var x = function (i) { return padL + (dates.length < 2 ? plotW / 2 : (i / (dates.length - 1)) * plotW); };
    var y = function (v) { return padT + plotH - ((v - sc.lo) / (sc.hi - sc.lo)) * plotH; };

    var svg = ['<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(opts.label || 'Line chart') + '">'];

    sc.ticks.forEach(function (t) {
      svg.push('<line x1="' + padL + '" x2="' + (padL + plotW) + '" y1="' + round(y(t), 1) + '" y2="' + round(y(t), 1) +
        '" stroke="' + GRID + '" stroke-width="1"/>');
      svg.push('<text x="' + (padL - 9) + '" y="' + round(y(t) + 4, 1) + '" text-anchor="end" font-size="11" fill="' + FAINT + '">' +
        esc(compact(t)) + '</text>');
    });

    var everyX = Math.max(1, Math.ceil(dates.length / (roomy ? 6 : 3)));
    dates.forEach(function (d, i) {
      if (i % everyX !== 0 && i !== dates.length - 1) return;
      // Pin the end labels inward so they never bleed past the plot.
      var anchor = i === 0 ? 'start' : (i === dates.length - 1 && !roomy) ? 'end' : 'middle';
      svg.push('<text x="' + round(x(i), 1) + '" y="' + (H - 8) + '" text-anchor="' + anchor +
        '" font-size="11" fill="' + FAINT + '">' + esc(dayLabel(d)) + '</text>');
    });

    var ends = [];
    series.forEach(function (s) {
      var pts = [];
      s.points.forEach(function (p, i) { if (p.value !== null && p.value !== undefined) pts.push({ i: i, v: p.value }); });
      if (!pts.length) return;
      var d = pts.map(function (p, k) { return (k ? 'L' : 'M') + round(x(p.i), 1) + ' ' + round(y(p.v), 1); }).join(' ');
      svg.push('<path d="' + d + '" fill="none" stroke="' + s.color + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>');
      pts.forEach(function (p) {
        svg.push('<circle cx="' + round(x(p.i), 1) + '" cy="' + round(y(p.v), 1) + '" r="4" fill="' + s.color +
          '" stroke="' + SURFACE + '" stroke-width="2"/>');
      });
      var last = pts[pts.length - 1];
      ends.push({ name: s.name, color: s.color, y: y(last.v), v: last.v });
    });

    // Direct labels at the line ends, nudged apart so they never overlap.
    // Too narrow for them? The legend below the chart carries identity instead.
    if (!roomy) ends.length = 0;
    ends.sort(function (a, b) { return a.y - b.y; });
    for (var k = 1; k < ends.length; k++) {
      if (ends[k].y - ends[k - 1].y < 15) ends[k].y = ends[k - 1].y + 15;
    }
    ends.forEach(function (e) {
      var ly = Math.max(padT + 6, Math.min(H - padB, e.y));
      svg.push('<circle cx="' + (padL + plotW + 12) + '" cy="' + round(ly - 3.5, 1) + '" r="3.5" fill="' + e.color + '"/>');
      svg.push('<text x="' + (padL + plotW + 21) + '" y="' + round(ly, 1) + '" font-size="11.5" font-weight="600" fill="' + DIM + '">' +
        esc(e.name) + '</text>');
    });

    // Invisible column targets drive the crosshair + tooltip.
    var colW = dates.length > 1 ? plotW / (dates.length - 1) : plotW;
    dates.forEach(function (d, i) {
      var rows = series.map(function (s) {
        var p = s.points[i];
        if (!p || p.value === null || p.value === undefined) return '';
        return '<span class="tt-row"><i style="background:' + s.color + '"></i>' + esc(s.name) +
          '<b>' + esc(compact(p.value)) + (opts.unit || '') + '</b></span>';
      }).join('');
      if (!rows) return;
      svg.push('<rect class="hit" x="' + round(x(i) - colW / 2, 1) + '" y="' + padT + '" width="' + round(colW, 1) +
        '" height="' + plotH + '" fill="transparent" data-cx="' + round(x(i), 1) + '" data-top="' + padT +
        '" data-bot="' + (padT + plotH) + '" data-tip="' + esc('<span class="tt-h">' + dayLabel(d) + '</span>' + rows) + '"/>');
    });

    svg.push('<line class="crosshair" x1="0" x2="0" y1="0" y2="0" stroke="' + AXIS + '" stroke-width="1" stroke-dasharray="3 3" opacity="0"/>');
    svg.push('</svg>');
    return svg.join('');
  }

  /* ------------------------------------------------------- grouped columns */
  function bars(opts) {
    var dates = opts.dates, series = opts.series || [];
    var W = Math.max(300, opts.width || 720);
    var H = opts.height || (W < 480 ? 200 : 230);
    var padL = 44, padR = 14, padT = 16, padB = 34;
    var plotW = W - padL - padR, plotH = H - padT - padB;

    var vals = [];
    series.forEach(function (s) {
      s.values.forEach(function (v) { if (v !== null && v !== undefined) vals.push(v); });
    });
    if (opts.goal) vals.push(opts.goal);
    if (!vals.filter(function (v) { return v > 0; }).length) return empty('Log a day or two and this fills in.');

    var sc = scale(0, Math.max.apply(null, vals), 4);
    var y = function (v) { return padT + plotH - ((v - sc.lo) / (sc.hi - sc.lo)) * plotH; };
    var band = plotW / dates.length;
    var groupW = Math.min(band * 0.78, 60);
    var gap = 2;
    var barW = Math.max(3, (groupW - gap * (series.length - 1)) / series.length);

    var svg = ['<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(opts.label || 'Bar chart') + '">'];

    sc.ticks.forEach(function (t) {
      svg.push('<line x1="' + padL + '" x2="' + (padL + plotW) + '" y1="' + round(y(t), 1) + '" y2="' + round(y(t), 1) +
        '" stroke="' + GRID + '" stroke-width="1"/>');
      svg.push('<text x="' + (padL - 9) + '" y="' + round(y(t) + 4, 1) + '" text-anchor="end" font-size="11" fill="' + FAINT + '">' +
        esc(compact(t)) + '</text>');
    });

    var labelEvery = band < 34 ? 2 : 1;
    dates.forEach(function (d, i) {
      var cx = padL + band * i + band / 2;
      var groupX = cx - groupW / 2;
      if (i % labelEvery === 0 || i === dates.length - 1) {
        svg.push('<text x="' + round(cx, 1) + '" y="' + (H - 18) + '" text-anchor="middle" font-size="11" fill="' + FAINT + '">' +
          esc(dowLabel(d)) + '</text>');
        svg.push('<text x="' + round(cx, 1) + '" y="' + (H - 5) + '" text-anchor="middle" font-size="10" fill="' + FAINT + '" opacity=".75">' +
          esc(Store.parse(d).getDate()) + '</text>');
      }

      series.forEach(function (s, j) {
        var v = s.values[i];
        if (v === null || v === undefined || v <= 0) return;
        var bx = groupX + j * (barW + gap);
        var by = y(v), bh = Math.max(2, padT + plotH - by), r = Math.min(4, barW / 2, bh);
        svg.push('<path d="' + roundedTop(bx, by, barW, bh, r) + '" fill="' + s.color + '"/>');
        svg.push('<rect class="hit" x="' + round(bx - 1, 1) + '" y="' + padT + '" width="' + round(barW + 2, 1) +
          '" height="' + plotH + '" fill="transparent" data-tip="' +
          esc('<span class="tt-h">' + dayLabel(d) + '</span><span class="tt-row"><i style="background:' + s.color + '"></i>' +
              s.name + '<b>' + compact(v) + (opts.unit || '') + '</b></span>') + '"/>');
      });
    });

    if (opts.goal) {
      var gy = round(y(opts.goal), 1);
      svg.push('<line x1="' + padL + '" x2="' + (padL + plotW) + '" y1="' + gy + '" y2="' + gy +
        '" stroke="' + DIM + '" stroke-width="1.5" stroke-dasharray="5 4" opacity=".75"/>');
      // Halo the label in the surface colour so it stays readable over a bar.
      svg.push('<text x="' + (padL + plotW - 2) + '" y="' + (gy - 6) + '" text-anchor="end" font-size="10.5" font-weight="700" ' +
        'fill="' + DIM + '" stroke="' + SURFACE + '" stroke-width="3.5" paint-order="stroke" stroke-linejoin="round">' +
        esc(opts.goalLabel || ('goal ' + compact(opts.goal))) + '</text>');
    }

    svg.push('<line x1="' + padL + '" x2="' + (padL + plotW) + '" y1="' + (padT + plotH) + '" y2="' + (padT + plotH) +
      '" stroke="' + AXIS + '" stroke-width="1"/>');
    svg.push('</svg>');
    return svg.join('');
  }

  function roundedTop(x, y, w, h, r) {
    return 'M' + round(x, 1) + ' ' + round(y + h, 1) +
           ' V' + round(y + r, 1) +
           ' Q' + round(x, 1) + ' ' + round(y, 1) + ' ' + round(x + r, 1) + ' ' + round(y, 1) +
           ' H' + round(x + w - r, 1) +
           ' Q' + round(x + w, 1) + ' ' + round(y, 1) + ' ' + round(x + w, 1) + ' ' + round(y + r, 1) +
           ' V' + round(y + h, 1) + ' Z';
  }

  function empty(msg) {
    return '<div class="empty">' + esc(msg) + '</div>';
  }

  function legend(series, activeIds) {
    return '<div class="legend">' + series.map(function (s) {
      var off = activeIds && activeIds.indexOf(s.id) === -1 ? ' off' : '';
      return '<span class="legend-item' + off + '" data-series="' + esc(s.id) + '" role="button" tabindex="0">' +
        '<i class="legend-swatch" style="background:' + s.color + '"></i>' + esc(s.name) + '</span>';
    }).join('') + '</div>';
  }

  /* A table view always exists alongside the chart — the accessibility
   * fallback, and honestly the quickest way to settle an argument. */
  function table(dates, series, unit) {
    var head = '<tr><th>Date</th>' + series.map(function (s) {
      return '<th><i class="legend-swatch" style="background:' + s.color + '"></i>' + esc(s.name) + '</th>';
    }).join('') + '</tr>';
    var rows = dates.map(function (d, i) {
      var cells = series.map(function (s) {
        var v = s.values ? s.values[i] : (s.points[i] || {}).value;
        return '<td>' + (v === null || v === undefined ? '<span class="na">—</span>' : esc(compact(v) + (unit || ''))) + '</td>';
      }).join('');
      return '<tr><td class="dt">' + esc(dayLabel(d)) + '</td>' + cells + '</tr>';
    }).reverse().join('');
    return '<div class="table-wrap"><table class="dtable"><thead>' + head + '</thead><tbody>' + rows + '</tbody></table></div>';
  }

  /* Delegated hover layer: one tooltip node per chart wrapper. */
  function attach(wrap) {
    var svg = wrap.querySelector('svg');
    if (!svg || wrap.dataset.wired === '1') return;
    wrap.dataset.wired = '1';
    var tip = document.createElement('div');
    tip.className = 'tooltip';
    tip.hidden = true;
    wrap.appendChild(tip);
    var cross = svg.querySelector('.crosshair');

    function hide() {
      tip.hidden = true;
      if (cross) cross.setAttribute('opacity', '0');
    }

    svg.addEventListener('mousemove', function (ev) {
      var hit = ev.target.classList && ev.target.classList.contains('hit') ? ev.target : null;
      if (!hit) return hide();
      tip.innerHTML = hit.getAttribute('data-tip');
      tip.hidden = false;
      var box = wrap.getBoundingClientRect();
      var tw = tip.offsetWidth;
      var left = ev.clientX - box.left + 14;
      if (left + tw > box.width - 4) left = ev.clientX - box.left - tw - 14;
      tip.style.left = Math.max(4, left) + 'px';
      tip.style.top = Math.max(4, ev.clientY - box.top - 12) + 'px';
      if (cross && hit.hasAttribute('data-cx')) {
        cross.setAttribute('x1', hit.getAttribute('data-cx'));
        cross.setAttribute('x2', hit.getAttribute('data-cx'));
        cross.setAttribute('y1', hit.getAttribute('data-top'));
        cross.setAttribute('y2', hit.getAttribute('data-bot'));
        cross.setAttribute('opacity', '1');
      }
    });
    svg.addEventListener('mouseleave', hide);
    svg.addEventListener('touchstart', function () { hide(); }, { passive: true });
  }

  return { line: line, bars: bars, legend: legend, table: table, attach: attach, compact: compact, dayLabel: dayLabel };
})();
