const { chromium } = require('playwright');
const path = require('path');
const SD = process.env.SD;
const URL = process.env.BASE_URL || ('file://' + path.resolve('index.html'));
const TODAY = (d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`)(new Date());
let fails = 0;
const ok = (c, m) => { console.log((c ? '  PASS  ' : '  FAIL  ') + m); if (!c) fails++; };

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 900 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('dialog', d => d.accept());

  const seed = require('./seed.js');
  // seed once — addInitScript also runs on reload, which would wipe the test's own writes
  await page.addInitScript(d => {
    if (!localStorage.getItem('ac.club.v1')) localStorage.setItem('ac.club.v1', JSON.stringify(d));
  }, seed());
  await page.goto(URL);

  // --- log a day as Arvind ---
  for (const [sel, val] of [['#f_steps','12500'],['#f_active','55'],['#f_weight','77.2'],['#f_note','Felt strong.']]) {
    await page.fill(sel, val);
    await page.locator(sel).blur();
  }
  // the caret must survive a save — type, wait past the debounce, keep typing
  await page.click('#f_steps');
  await page.keyboard.type('9');
  await page.waitForTimeout(700);           // past the autosave debounce
  ok(await page.evaluate(() => document.activeElement && document.activeElement.id) === 'f_steps',
     'field keeps focus across an autosave');
  await page.keyboard.type('9');
  ok((await page.inputValue('#f_steps')).endsWith('99'), 'typing continues uninterrupted after an autosave');
  await page.fill('#f_steps', '12500');
  await page.locator('#f_steps').blur();
  await page.waitForTimeout(150);
  await page.click('[data-workout="Run"]');
  await page.click('[data-workout="Gym"]');
  await page.click('[data-habit="water"]');
  await page.click('[data-habit="sleep"]');
  await page.waitForTimeout(150);

  await page.waitForTimeout(150);
  let rec = await page.evaluate((t) => {
    const d = JSON.parse(localStorage.getItem('ac.club.v1'));
    return (d.records['entry:arvind:' + t] || {}).v || {};
  }, TODAY);
  ok(rec.steps === 12500 && rec.active === 55 && rec.weight === 77.2,
     'numbers persist to storage (got ' + JSON.stringify([rec.steps, rec.active, rec.weight]) + ')');
  ok(Array.isArray(rec.workout) && rec.workout.length === 2 &&
     rec.workout.indexOf('Run') !== -1 && rec.workout.indexOf('Gym') !== -1,
     'two workouts persist together (got ' + JSON.stringify(rec.workout) + ')');

  // picking Rest clears the rest, and picking another clears Rest
  await page.click('[data-workout="Rest"]');
  await page.waitForTimeout(150);
  let w = await page.evaluate(t => JSON.parse(localStorage.getItem('ac.club.v1')).records['entry:arvind:' + t].v.workout, TODAY);
  ok(w.length === 1 && w[0] === 'Rest', 'Rest replaces the others (got ' + JSON.stringify(w) + ')');
  await page.click('[data-workout="Gym"]');
  await page.waitForTimeout(150);
  w = await page.evaluate(t => JSON.parse(localStorage.getItem('ac.club.v1')).records['entry:arvind:' + t].v.workout, TODAY);
  ok(w.length === 1 && w[0] === 'Gym', 'a real workout clears Rest (got ' + JSON.stringify(w) + ')');
  ok(await page.locator('[data-workout="Gym"].on').count() === 1 &&
     await page.locator('[data-workout="Rest"].on').count() === 0, 'chip states match the data');

  // restore the pair the later assertions expect
  await page.click('[data-workout="Run"]');
  await page.waitForTimeout(200);
  ok(rec.habits.includes('water') && rec.habits.includes('sleep'), 'habit chips persist');
  ok(rec.note === 'Felt strong.', 'note persists');

  // score: 2 logged + 10 steps + 10 active + 5 weight + 2 habits*3 = 33
  ok((await page.textContent('#dayScore')).startsWith('33 /'), 'day score computes (33)');
  const streakText = await page.textContent('#heroStreak');
  const streakDays = (streakText.match(/(\d+)\s+days?\s+in a row/) || [])[1];
  ok(Number(streakDays) >= 1, 'logging today starts a streak (got "' + streakText.trim() + '")');

  // --- crew card reflects the entry without a reload ---
  const crew = await page.textContent('#todayCrew');
  ok(crew.includes('12.5k') && crew.includes('goal hit'), 'crew card updates live');

  // --- survives a reload ---
  await page.reload();
  const afterReload = await page.inputValue('#f_steps');
  ok(afterReload === '12500', 'survives reload (got "' + afterReload + '")');

  // --- switching person gives a clean slate, then switching back restores ---
  await page.click('[data-who="sai"]');
  await page.waitForTimeout(120);
  ok(await page.inputValue('#f_steps') === '', 'switching person clears the form');
  await page.fill('#f_steps', '8000');
  await page.locator('#f_steps').blur();
  await page.click('[data-who="arvind"]');
  await page.waitForTimeout(120);
  const back = await page.inputValue('#f_steps');
  ok(back === '12500', "switching back restores Arvind's day (got \"" + back + '")');

  // --- editing a past day ---
  const days = await page.$$('.daybtn:not(.is-sel)');
  await days[days.length - 1].click();
  await page.waitForTimeout(120);
  await page.fill('#f_steps', '4321');
  await page.locator('#f_steps').blur();
  await page.waitForTimeout(120);
  const edited = await page.evaluate(() => {
    const sel = document.querySelector('.daybtn.is-sel');
    return sel ? sel.dataset.date : null;
  });
  const past = await page.evaluate(d => JSON.parse(localStorage.getItem('ac.club.v1')).records['entry:arvind:' + d].v.steps, edited);
  ok(past === 4321, 'a past day saves against its own date');

  // --- a legacy record (workout as a plain string) still reads ---
  await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('ac.club.v1'));
    d.records['entry:sai:2026-01-15'] = { v: { steps: 5000, weight: null, active: null,
      workout: 'Cycle', habits: [], note: '' }, t: 1 };
    localStorage.setItem('ac.club.v1', JSON.stringify(d));
  });
  await page.reload();
  await page.click('[data-who="sai"]');
  await page.waitForTimeout(200);
  ok(await page.evaluate(() => Store.entry('sai', '2026-01-15').workout.join()) === 'Cycle',
     'a legacy string workout reads as a one-item list');
  ok(await page.evaluate(() => Store.isLogged(Store.entry('sai', '2026-01-15'))) === true,
     'a legacy record still counts as logged');
  ok(await page.evaluate(() => Store.isLogged(Store.entry('sai', '2026-01-14'))) === false,
     'an untouched day is still not logged');
  await page.click('[data-who="arvind"]');
  await page.waitForTimeout(150);

  // --- goals ---
  await page.click('.tab[data-view="settings"]');
  await page.fill('#goal_arvind_steps', '12000');
  await page.locator('#goal_arvind_steps').blur();
  await page.waitForTimeout(120);
  ok(await page.evaluate(() => JSON.parse(localStorage.getItem('ac.club.v1')).records['goals:arvind'].v.steps) === 12000,
     'goal edits persist');

  // --- units + theme ---
  await page.click('[data-units="lb"]');
  await page.waitForTimeout(120);
  ok((await page.textContent('body')).includes('Target lb'), 'unit switch propagates');
  await page.click('[data-units="kg"]');
  await page.click('#themeBtn');
  ok(await page.getAttribute('html', 'data-theme') === 'light', 'theme toggles');
  await page.click('#themeBtn');

  // --- trends: metric, range, legend, table ---
  await page.click('.tab[data-view="trends"]');
  await page.waitForTimeout(200);
  ok(await page.locator('.chart-wrap svg').count() === 2, 'both charts render');
  await page.click('[data-metric="active"]');
  await page.waitForTimeout(150);
  ok((await page.textContent('body')).includes('Daily active minutes'), 'metric toggle works');
  await page.click('[data-brange="14"]');
  await page.waitForTimeout(150);
  await page.click('.legend-item[data-series="sai"]');
  await page.waitForTimeout(150);
  ok(await page.locator('.legend-item[data-series="sai"].off').count() === 2,
     'legend hides a series across both charts');
  await page.click('[data-tmode="line,table"]');
  await page.waitForTimeout(150);
  ok(await page.locator('.dtable').count() === 1, 'table view renders');

  // --- hover tooltip on the bar chart ---
  await page.click('[data-tmode="line,chart"]');
  await page.waitForTimeout(200);
  const hit = page.locator('.chart-wrap[data-chart="bars"] .hit').first();
  if (await hit.count()) {
    await hit.hover({ force: true });
    await page.waitForTimeout(120);
    ok(await page.locator('.chart-wrap[data-chart="bars"] .tooltip:not([hidden])').count() === 1, 'hover tooltip appears');
  } else ok(false, 'bar chart produced hit targets');

  // --- board ---
  await page.click('.tab[data-view="board"]');
  await page.waitForTimeout(150);
  ok(await page.locator('.lb-row').count() === 3, 'leaderboard lists all three');
  const w0 = await page.locator('.lb-bar > i').first().evaluate(e => e.getBoundingClientRect().width);
  ok(w0 > 1, 'leaderboard bars have width (' + Math.round(w0) + 'px)');
  await page.click('[data-week="-1"]');
  await page.waitForTimeout(150);
  ok(await page.locator('.lb-row').count() === 3, 'previous week renders');

  // --- export produces valid JSON ---
  await page.click('.tab[data-view="settings"]');
  const dl = page.waitForEvent('download');
  await page.click('#exportBtn');
  const file = await (await dl).path();
  const parsed = JSON.parse(require('fs').readFileSync(file, 'utf8'));
  ok(parsed.app === 'accountability-club' && Object.keys(parsed.records).length > 0, 'export is valid JSON');

  ok(errs.length === 0, 'no runtime errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await browser.close();
  console.log(fails ? `\n${fails} FAILING` : '\nAll checks passed.');
  process.exit(fails ? 1 : 0);
})();
