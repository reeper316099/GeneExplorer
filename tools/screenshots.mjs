/* global localStorage -- used inside page.evaluate, which runs in the app's renderer */
// Takes the Milestone A screenshots (light and dark) from the real app in a hidden window, answered from recorded fixtures.
// Needs a dev build first: node scripts/build.mjs --dev. Run: node tools/screenshots.mjs  (writes docs/screenshots/*.png)
import { _electron as electron } from '@playwright/test';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const OUT = 'docs/screenshots';
mkdirSync(OUT, { recursive: true });
const app = await electron.launch({
  args: ['.', `--user-data-dir=${mkdtempSync(path.join(tmpdir(), 'ge-shots-'))}`],
  env: { ...process.env, GENEEXPLORER_TEST_MODE: '1', GENEEXPLORER_BACKGROUND: '1' },
});
const page = await app.firstWindow();

/** Forces the theme through the app's own toggle state (stored preference), then reloads. */
async function setTheme(theme) {
  await page.evaluate((t) => {
    const raw = localStorage.getItem('geneexplorer.prefs.v1');
    const prefs = raw ? JSON.parse(raw) : { version: 1, theme: 'system', recents: [], favorites: [] };
    prefs.theme = t;
    localStorage.setItem('geneexplorer.prefs.v1', JSON.stringify(prefs));
  }, theme);
  await page.reload();
  await page.waitForSelector('.topbar');
}

for (const theme of ['light', 'dark']) {
  await setTheme(theme);
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.getByRole('button', { name: 'New search' }).click();
  await page.screenshot({ path: `${OUT}/${theme}-1-home.png` });

  await page.getByRole('button', { name: 'COX1 · human', exact: true }).click();
  await page.waitForSelector('.result');
  await page.screenshot({ path: `${OUT}/${theme}-2-disambiguation.png` });

  await page.getByRole('button', { name: 'New search' }).click();
  await page.setViewportSize({ width: 1280, height: 1500 });
  await page.getByRole('button', { name: 'TP53 · human', exact: true }).click();
  await page.waitForSelector('.geneheader');
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${OUT}/${theme}-3-overview.png` });
  await page.getByRole('tab', { name: 'Location' }).click();
  await page.waitForSelector('svg[aria-label*="Gene structure"]');
  await page.screenshot({ path: `${OUT}/${theme}-4-location.png` });
  await page.getByRole('tab', { name: 'Protein & Structure' }).click();
  await page.waitForSelector('.viewer-wrap canvas');
  await page.waitForTimeout(2500);
  await page.setViewportSize({ width: 1280, height: 2500 });
  await page.screenshot({ path: `${OUT}/${theme}-5-protein.png` });
  await page.getByRole('button', { name: 'About & limits' }).click();
  await page.setViewportSize({ width: 1280, height: 1400 });
  await page.screenshot({ path: `${OUT}/${theme}-6-about.png` });
}
// Minimum supported window size.
await setTheme('light');
await page.setViewportSize({ width: 1200, height: 760 });
await page.getByRole('button', { name: 'New search' }).click();
await page.getByRole('button', { name: 'TP53 · human', exact: true }).click();
await page.waitForSelector('.geneheader');
await page.waitForTimeout(2000);
await page.screenshot({ path: `${OUT}/light-7-min-size-1200x760.png` });
await app.close();
console.log('screenshots written to', OUT);
