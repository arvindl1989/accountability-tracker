const { chromium } = require('playwright');
const seed = require('./seed.js');
let fails = 0;
const ok = (c, m) => { console.log((c ? '  PASS  ' : '  FAIL  ') + m); if (!c) fails++; };

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1180, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('console', m => {
    if (m.type() !== 'error') return;
    const from = (m.location() || {}).url || '';
    if (/\/rest\/v1\/health/.test(from)) return;   // expected probe on a static host
    errs.push(m.text());
  });
  await page.addInitScript(d => {
    if (!localStorage.getItem('ac.club.v1')) localStorage.setItem('ac.club.v1', JSON.stringify(d));
    if (!localStorage.getItem('ac.prefs.v1')) {
      localStorage.setItem('ac.prefs.v1', JSON.stringify({ me: 'arvind', theme: 'dark' }));
    }
    // capture the hand-off instead of actually opening WhatsApp
    window.__opened = [];
    const realOpen = window.open;
    window.open = (u) => { window.__opened.push(u); return { closed: false }; };
  }, seed());
  await page.goto(process.env.BASE_URL || 'http://127.0.0.1:8123/index.html');

  // nothing logged today yet -> should refuse rather than share an empty card
  await page.click('#shareDayBtn');
  await page.waitForTimeout(150);
  ok((await page.locator('.toast').allTextContents()).join(' ').includes('Log something first'),
     'refuses to share an empty day');
  ok(await page.evaluate(() => window.__opened.length) === 0, 'nothing handed off for an empty day');

  // log a day, then share it
  for (const [sel, val] of [['#f_steps','12500'],['#f_active','55'],['#f_weight','77.2'],['#f_note','Legs were heavy.']]) {
    await page.fill(sel, val); await page.locator(sel).blur();
  }
  await page.click('[data-workout="Run"]');
  await page.click('[data-workout="Gym"]');
  await page.click('[data-habit="water"]');
  await page.waitForTimeout(200);
  await page.click('#shareDayBtn');
  await page.waitForTimeout(200);

  const dayUrl = await page.evaluate(() => window.__opened[0]);
  ok(!!dayUrl && dayUrl.startsWith('https://wa.me/?text='), 'opens wa.me with pre-filled text');
  const dayText = decodeURIComponent(dayUrl.split('text=')[1]);
  console.log('\n--- day share ---\n' + dayText + '\n');
  ok(dayText.includes('*Arvind'), 'names the person in bold');
  ok(dayText.includes('12,500 steps ✅'), 'includes steps with the goal tick');
  ok(dayText.includes('55 active min ✅'), 'includes active minutes');
  ok(dayText.includes('77.2 kg'), 'includes weight in the right unit');
  ok(dayText.includes('🏋️ Run + Gym'), 'joins multiple workouts');
  ok(dayText.includes('1/5 habits'), 'includes the habit count');
  ok(dayText.includes('Legs were heavy.'), 'includes the note');
  ok(/\d+\/42 pts/.test(dayText), 'includes the points');

  // it must reflect what is on screen, even if not explicitly saved
  await page.fill('#f_steps', '999');
  await page.click('#shareDayBtn');
  await page.waitForTimeout(200);
  const t2 = decodeURIComponent((await page.evaluate(() => window.__opened[1])).split('text=')[1]);
  ok(t2.includes('999 steps') && !t2.includes('12,500'), 'shares unsaved on-screen edits');

  // week board
  await page.click('.tab[data-view="board"]');
  await page.waitForTimeout(200);
  await page.click('#shareWeekBtn');
  await page.waitForTimeout(200);
  const weekText = decodeURIComponent((await page.evaluate(() => window.__opened[2])).split('text=')[1]);
  console.log('--- board share ---\n' + weekText + '\n');
  ok(weekText.includes('🥇') && weekText.includes('🥈') && weekText.includes('🥉'), 'ranks all three with medals');
  ok(/Arvind|Abhinandh|Sai/.test(weekText), 'names people');
  ok(weekText.includes('steps between us'), 'includes a club total');
  ok(!weekText.includes('127.0.0.1') && !weekText.includes('localhost'), 'omits a localhost app link');

  // copy button
  await page.click('[data-copy="shareWeekBtn"]');
  await page.waitForTimeout(250);
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  ok(clip.includes('Accountability Club'), 'copy button puts the board on the clipboard');
  ok(await page.evaluate(() => window.__opened.length) === 3, 'copy does not also open WhatsApp');

  ok(errs.length === 0, 'no runtime errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await b.close();
  console.log(fails ? `\n${fails} FAILING` : '\nAll share checks passed.');
  process.exit(fails ? 1 : 0);
})();
