// Live check: plays Teen Patti against bots on the production site.
import { chromium } from 'playwright';
import fs from 'node:fs';
const BASE = 'https://golf-game-two.vercel.app';
fs.mkdirSync('shots', { recursive: true });
const log = []; const note = (m) => { console.log(m); log.push(m); };
const browser = await chromium.launch();
let ok = false;
for (let attempt = 1; attempt <= 12 && !ok; attempt++) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => note(`[page error] ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') note(`[console error] ${m.text()}`); });
  try {
    await page.goto(BASE, { waitUntil: 'networkidle' });
    note(`attempt ${attempt}: title "${await page.title()}"`);
    await page.locator('#display-name').fill('Live check');
    await page.getByRole('button', { name: 'Create Game' }).click();
    await page.selectOption('#game-mode', 'teenpatti', { timeout: 10000 });
    await page.getByRole('group', { name: 'Stakes' }).getByRole('button', { name: /^Low/ }).click();
    const create = page.getByRole('button', { name: 'Create Game' });
    await create.waitFor(); await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent === 'Create Game' && !b.disabled), null, { timeout: 120000 });
    await create.click();
    await page.getByRole('heading', { name: 'Waiting for players' }).waitFor({ timeout: 30000 });
    const summary = await page.getByText(/^Teen Patti ·|^Golf ·|^Cabo ·/).first().textContent();
    note(`lobby: ${summary}`);
    if (!summary.startsWith('Teen Patti')) { note('server not updated yet; retrying in 45s'); await page.getByRole('button', { name: 'Leave room' }).first().click().catch(() => {}); await ctx.close(); await new Promise((r) => setTimeout(r, 45000)); continue; }
    for (let i = 0; i < 3; i++) { await page.getByRole('button', { name: '+ Add a bot' }).click(); await page.getByText(`Players (${i + 2}/8)`).waitFor(); }
    await page.getByRole('button', { name: 'Start game' }).click();
    const pack = page.getByRole('button', { name: 'Pack', exact: true });
    const accept = page.getByRole('button', { name: 'Accept side show' });
    const result = page.getByRole('heading', { name: /^Hand \d+ result$/ });
    let hands = 0, shotTurn = false;
    while (hands < 2) {
      const end = Date.now() + 120000; let state = null;
      while (!state && Date.now() < end) {
        if (await accept.isVisible().catch(() => false)) state = 'accept';
        else if (await result.first().isVisible().catch(() => false)) state = 'result';
        else if (await pack.isVisible().catch(() => false)) state = 'pack';
        else await page.waitForTimeout(150);
      }
      if (!state) throw new Error('stalled');
      if (state === 'accept') { await accept.click(); continue; }
      if (state === 'result') { hands++; await page.screenshot({ path: `shots/live-result-${hands}.png` }); note(`hand ${hands}: ${await page.locator('dialog').getByText(/won|split/).first().textContent().catch(() => '?')}`); await page.getByRole('button', { name: 'Next hand' }).click(); await result.first().waitFor({ state: 'hidden' }); continue; }
      if (!shotTurn) { shotTurn = true; await page.screenshot({ path: 'shots/live-turn.png' }); }
      const see = page.getByRole('button', { name: 'See cards' });
      if (await see.isVisible()) { await see.click(); await see.waitFor({ state: 'hidden' }); }
      const show = page.getByRole('button', { name: /^Show ·/ }); const chaal = page.getByRole('button', { name: /^Chaal \d/ });
      if (await show.isVisible()) await show.click(); else if (await chaal.isVisible()) await chaal.click(); else await pack.click();
      await page.waitForTimeout(200);
    }
    ok = true; note('LIVE TEEN PATTI OK');
  } catch (e) { note(`attempt ${attempt} failed: ${e.message.split('\n')[0]}`); await page.screenshot({ path: `shots/fail-${attempt}.png` }).catch(() => {}); }
  await ctx.close();
}
await browser.close();
fs.writeFileSync('shots/log.txt', log.join('\n'));
process.exit(0);
