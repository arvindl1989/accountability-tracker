/* First-run identity: the setup screen, ?me= links, and the fact that being
 * someone is sticky rather than something you re-pick. */
const { chromium } = require('playwright');
const seed = require('./seed.js');

const APP = process.env.BASE_URL || 'http://127.0.0.1:8123/index.html';
let fails = 0;
const ok = (c, m) => { console.log((c ? '  PASS  ' : '  FAIL  ') + m); if (!c) fails++; };

async function fresh(browser, url) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on('pageerror', e => { console.log('  pageerror: ' + e.message); fails++; });
  await page.addInitScript(d => {
    if (!localStorage.getItem('ac.club.v1')) localStorage.setItem('ac.club.v1', JSON.stringify(d));
  }, seed());
  await page.goto(url || APP);
  await page.waitForTimeout(350);
  return { ctx, page };
}

(async () => {
  const browser = await chromium.launch();

  // ---------- a brand-new device asks who you are ----------
  let { ctx, page } = await fresh(browser);
  ok(await page.locator('.setup').count() === 1, 'a new device shows the setup screen');
  ok(await page.locator('#tabs').isHidden(), 'tabs are hidden until you say who you are');
  ok(await page.locator('#whoChip').isHidden(), 'the identity chip is hidden too');
  ok(await page.locator('.setup-person').count() === 3, 'all three are offered');
  ok(await page.locator('#f_steps').count() === 0, 'nothing is loggable before choosing');

  await page.click('.setup-person[data-who="abhinandh"]');
  await page.waitForTimeout(300);
  ok(await page.locator('.setup').count() === 0, 'choosing dismisses the setup screen');
  ok((await page.textContent('#whoChip')).includes('Abhinandh'), 'the chip names you');
  ok((await page.textContent('.hero')).includes('Abhinandh'), 'the greeting is yours');
  ok(await page.evaluate(() => JSON.parse(localStorage.getItem('ac.prefs.v1')).me) === 'abhinandh',
     'the choice is persisted');

  // ---------- and it sticks ----------
  await page.reload();
  await page.waitForTimeout(350);
  ok(await page.locator('.setup').count() === 0, 'a returning visit does not ask again');
  ok((await page.textContent('#whoChip')).includes('Abhinandh'), 'you are still you after a reload');
  await ctx.close();

  // ---------- a personal link identifies you with no picking ----------
  ({ ctx, page } = await fresh(browser, APP + '?me=sai'));
  ok(await page.locator('.setup').count() === 0, '?me= skips the setup screen');
  ok((await page.textContent('#whoChip')).includes('Sai'), '?me= sets the right person');
  ok(!page.url().includes('me='), 'the query is stripped so a copied URL is not your identity');
  ok(await page.evaluate(() => JSON.parse(localStorage.getItem('ac.prefs.v1')).me) === 'sai',
     '?me= persists, so the link is only needed once');
  await ctx.close();

  // ---------- a bogus link does not silently pick someone ----------
  ({ ctx, page } = await fresh(browser, APP + '?me=nobody'));
  ok(await page.locator('.setup').count() === 1, 'an unknown ?me= falls back to asking');
  await ctx.close();

  // ---------- the chip routes to Settings; switching is deliberate ----------
  ({ ctx, page } = await fresh(browser, APP + '?me=arvind'));
  ok(await page.locator('[data-who]').count() === 0, 'no switcher sits in the top bar');
  await page.click('#whoChip');
  await page.waitForTimeout(250);
  ok(await page.locator('.tab[data-view="settings"].is-active').count() === 1, 'the chip opens Settings');
  ok(await page.locator('.who-opt[data-who="arvind"].is-me').count() === 1, 'Settings marks who you are');

  await page.click('.who-opt[data-who="sai"]');
  await page.waitForTimeout(250);
  ok((await page.textContent('#whoChip')).includes('Sai'), 'switching from Settings works');

  // ---------- the links are offered, and copy the right thing ----------
  ok(await page.locator('[data-copylink]').count() === 3, 'a link is offered for each person');
  await ctx.close();

  const ctx2 = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
  const p2 = await ctx2.newPage();
  await p2.addInitScript(() => localStorage.setItem('ac.prefs.v1', JSON.stringify({ me: 'arvind' })));
  await p2.goto(APP);
  await p2.click('.tab[data-view="settings"]');
  await p2.waitForTimeout(200);
  await p2.click('[data-copylink="abhinandh"]');
  await p2.waitForTimeout(250);
  const copied = await p2.evaluate(() => navigator.clipboard.readText());
  ok(copied.endsWith('?me=abhinandh'), `the copied link targets that person (got ${copied})`);
  ok(!copied.includes('index.html?'), 'the link points at the app root');
  await ctx2.close();

  await browser.close();
  console.log(fails ? `\n${fails} FAILING` : '\nAll identity checks passed.');
  process.exit(fails ? 1 : 0);
})();
