// ABUZ8 Playwright runner. Reads a JSON spec file (argv[2]); drives Chromium;
// prints a JSON result. Spec: { url, headless, actions:[{goto|click|fill|press|wait|screenshot}], extract, screenshot }
const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  let spec = {};
  try { spec = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')); } catch (e) { process.stdout.write(JSON.stringify({ ok: false, error: 'bad spec: ' + e.message })); return; }
  const out = { ok: true, steps: [] };
  let browser;
  // Prefer the system Edge/Chrome (every Windows has Edge) so no 700 MB Chromium
  // needs to be bundled; fall back to Playwright's own Chromium if present.
  async function launch() {
    const headless = spec.headless !== false;
    for (const channel of ['msedge', 'chrome']) {
      try { return await chromium.launch({ headless, channel }); } catch {}
    }
    return await chromium.launch({ headless });
  }
  try {
    browser = await launch();
    const page = await (await browser.newContext()).newPage();
    if (spec.url) { await page.goto(spec.url, { timeout: 35000, waitUntil: 'domcontentloaded' }); out.steps.push('goto ' + spec.url); }
    for (const a of (spec.actions || [])) {
      if (a.goto) { await page.goto(a.goto, { timeout: 35000, waitUntil: 'domcontentloaded' }); out.steps.push('goto ' + a.goto); }
      else if (a.click) { await page.click(a.click, { timeout: 12000 }); out.steps.push('click ' + a.click); }
      else if (a.fill) { await page.fill(a.fill[0], a.fill[1], { timeout: 12000 }); out.steps.push('fill ' + a.fill[0]); }
      else if (a.press) { await page.keyboard.press(a.press); out.steps.push('press ' + a.press); }
      else if (a.wait) { await page.waitForTimeout(Math.min(a.wait, 8000)); }
      else if (a.screenshot) { await page.screenshot({ path: a.screenshot, fullPage: !!a.full }); out.screenshot = a.screenshot; }
    }
    out.title = await page.title();
    out.finalUrl = page.url();
    if (spec.extract !== false) out.text = (await page.evaluate(() => document.body.innerText)).replace(/\n{3,}/g, '\n\n').slice(0, 5000);
    if (spec.screenshot) { await page.screenshot({ path: spec.screenshot }); out.screenshot = spec.screenshot; }
  } catch (e) { out.ok = false; out.error = e.message; }
  try { if (browser) await browser.close(); } catch {}
  process.stdout.write(JSON.stringify(out));
})();
