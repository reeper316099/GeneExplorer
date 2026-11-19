// End-to-end checks of the Milestone A UI in the real Electron app (test mode: every API call is answered from recorded
// real responses; the window is hidden). Covers search, disambiguation, the three gene tabs, 3D, sources and states.
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

let app: ElectronApplication;
let win: Page;

test.beforeAll(async () => {
  const userData = mkdtempSync(path.join(tmpdir(), 'ge-e2e-gene-'));
  app = await electron.launch({
    args: ['.', `--user-data-dir=${userData}`],
    env: { ...process.env, GENEEXPLORER_TEST_MODE: '1', GENEEXPLORER_BACKGROUND: '1' },
  });
  win = await app.firstWindow();
  await win.setViewportSize({ width: 1280, height: 1400 });
});
test.afterAll(async () => {
  await app.close();
});

/** Opens a fresh home screen. */
async function home(): Promise<void> {
  await win.getByRole('button', { name: 'New search' }).click();
}
/** Opens the human TP53 page from its example chip. */
async function openTp53(): Promise<void> {
  await home();
  await win.getByRole('button', { name: 'TP53 · human', exact: true }).click();
  await expect(win.locator('.geneheader h2')).toHaveText('TP53', { timeout: 20000 });
}

test('home offers diverse examples: human, non-human, bacterial and plant', async () => {
  await home();
  for (const l of [
    'TP53 · human',
    'Trp53 · mouse',
    'tp53 · zebrafish',
    'lacZ · E. coli',
    'FLC · Arabidopsis',
    'rbcL · Arabidopsis',
  ])
    await expect(win.getByRole('button', { name: l, exact: true })).toBeVisible();
  await expect(win.getByText('Educational use only')).toBeVisible();
});

test('TP53: header, badges, identifiers and identity evidence come with sources', async () => {
  await openTp53();
  const head = win.locator('.geneheader');
  await expect(head).toContainText('tumor protein p53');
  await expect(head).toContainText('Homo sapiens');
  await expect(head).toContainText('UniProt reviewed (curated)');
  await expect(head).toContainText('Gene–protein link: confirmed');
  await expect(head).toContainText('NCBI Gene: 7157');
  await expect(head).toContainText('UniProt: P04637');
  const tip = await win.locator('[role=tabpanel] .src').first().getAttribute('title');
  expect(tip).toMatch(/Source: (NCBI|UniProt) · record .* · fetched /);
  await expect(win.locator('[role=tabpanel]')).toContainText('How the gene and protein records are linked');
  await expect(win.locator('[role=tabpanel]')).toContainText('never by gene symbol alone');
});

test('Sources drawer lists every record with database, ID and fetch time', async () => {
  await openTp53();
  await win.getByRole('button', { name: 'Sources', exact: true }).click();
  const drawer = win.locator('.drawer');
  await expect(drawer).toContainText('NCBI');
  await expect(drawer).toContainText('7157');
  await expect(drawer).toContainText('UniProt');
  await expect(drawer).toContainText('P04637');
  await drawer.getByRole('button', { name: 'Close' }).click();
  await expect(drawer).toHaveCount(0);
});

test('Location tab: coordinates, map location, chromosome map and MANE Select gene structure', async () => {
  await openTp53();
  await win.getByRole('tab', { name: 'Location' }).click();
  const p = win.locator('[role=tabpanel]');
  await expect(p).toContainText('7,668,421 – 7,687,490');
  await expect(p).toContainText('17p13.1');
  await expect(p).toContainText('minus (reverse)');
  await expect(p).toContainText('1-based, inclusive');
  await expect(p.locator('svg[aria-label*="Chromosome"]')).toHaveCount(1, { timeout: 15000 });
  await expect(p).toContainText('83,257,441 bp');
  await expect(p.locator('svg[aria-label*="Gene structure"]')).toHaveCount(1, { timeout: 15000 });
  await expect(p).toContainText('11 exons');
  await expect(p).toContainText('MANE Select');
  await p.getByText('Exon coordinates as a table').click();
  await expect(p.locator('table tbody tr')).toHaveCount(11);
});

test('Protein tab: UniProt card, features, pLDDT strip, 3D viewer and the standing prediction note', async () => {
  await openTp53();
  await win.getByRole('tab', { name: 'Protein & Structure' }).click();
  const p = win.locator('[role=tabpanel]');
  await expect(p).toContainText('P04637');
  await expect(p).toContainText('393 amino acids');
  await expect(p).toContainText('Reviewed (Swiss-Prot)');
  await expect(p.locator('select[aria-label=Isoform]')).toContainText('P04637-1 · 1 · canonical');
  await expect(p.locator('.track svg[aria-label*="feature track"]')).toHaveCount(1);
  await expect(p).toContainText('Computed prediction (AlphaFold)');
  await expect(p).toContainText('not for clinical use');
  await expect(p).toContainText('mean pLDDT 75.1');
  await expect(p.locator('.viewer-wrap canvas')).toHaveCount(1, { timeout: 20000 });
  await expect(p).toContainText('pLDDT >90 very high');
});

test('clicking a feature highlights its residues in the sequence panel and says what is selected', async () => {
  await openTp53();
  await win.getByRole('tab', { name: 'Protein & Structure' }).click();
  const p = win.locator('[role=tabpanel]');
  await p.locator('.track g[role=button]').first().click();
  await expect(p.locator('.seq .sel').first()).toBeVisible();
  await expect(p.locator('.track [aria-live]')).toContainText('Selected');
  await p.getByRole('button', { name: 'Clear selection' }).click();
  await expect(p.locator('.seq .sel')).toHaveCount(0);
});

test('GO terms can be filtered and show automatic annotation', async () => {
  await openTp53();
  await win.getByRole('tab', { name: 'Protein & Structure' }).click();
  const p = win.locator('[role=tabpanel]');
  await expect(p).toContainText('GO terms (UniProt)');
  await p.getByLabel('Filter GO terms').fill('chromatin');
  await expect(p).toContainText('chromatin binding');
  await expect(p).not.toContainText('14-3-3 protein binding');
});

test('tabs work with the keyboard (arrow keys move and select)', async () => {
  await openTp53();
  await win.getByRole('tab', { name: 'Overview' }).focus();
  await win.keyboard.press('ArrowRight');
  await expect(win.getByRole('tab', { name: 'Location' })).toHaveAttribute('aria-selected', 'true');
  await win.keyboard.press('ArrowRight');
  await expect(win.getByRole('tab', { name: 'Protein & Structure' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
});

test('an alias-only symbol (COX1 in human) shows a disambiguation list and never opens a gene by itself', async () => {
  await home();
  await win.getByRole('button', { name: 'COX1 · human', exact: true }).click();
  await expect(win.getByRole('heading', { name: 'Which gene do you mean?' })).toBeVisible({ timeout: 20000 });
  await expect(win.locator('.result')).toContainText('PTGS1');
  await expect(win.locator('.result')).toContainText('matched via alias');
  await expect(win.locator('.geneheader')).toHaveCount(0);
});

test('an obsolete UniProt accession is explained with its replacements', async () => {
  await home();
  await win.getByLabel('Search genes').fill('P0CG05');
  await win.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(win.getByRole('heading', { name: /P0CG05 is no longer an active UniProt entry/ })).toBeVisible(
    { timeout: 20000 },
  );
  await expect(win.locator('main')).toContainText('split into several entries');
  await expect(win.getByRole('button', { name: 'P0DOY2' })).toBeVisible();
});

test('a failed lookup shows a friendly error with Retry, and the app stays usable', async () => {
  await home();
  await win.getByRole('button', { name: 'Trp53 · mouse', exact: true }).click(); // no fixture recorded: behaves like no connection
  await expect(win.locator('.notice.error')).toContainText(/No connection|not in the offline cache/, {
    timeout: 20000,
  });
  await expect(win.getByRole('button', { name: 'Try again' })).toBeVisible();
  await home();
  await expect(win.getByText('Try an example')).toBeVisible();
});

test('favorites and recents persist across a reload, and dark mode is remembered', async () => {
  await openTp53();
  await win.getByRole('button', { name: 'Favorite' }).click();
  await expect(win.getByRole('button', { name: 'Favorite' })).toHaveAttribute('aria-pressed', 'true');
  await win.getByRole('button', { name: 'Toggle dark mode' }).click();
  const theme = await win.evaluate(() => document.documentElement.getAttribute('data-theme'));
  expect(['dark', 'light']).toContain(theme);
  await win.reload();
  await expect(win.locator('.rail')).toContainText('TP53');
  await expect(win.locator('.rail section').first()).toContainText('TP53');
  expect(await win.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe(theme);
});

test('back and forward navigation moves between screens', async () => {
  await openTp53();
  await win.getByRole('button', { name: 'Back' }).click();
  await expect(win.getByText('Pick any gene in any organism')).toBeVisible();
  await win.getByRole('button', { name: 'Forward' }).click();
  await expect(win.locator('.geneheader h2')).toHaveText('TP53');
});

test('About page shows sources, citations, limits and the cache control', async () => {
  await win.getByRole('button', { name: 'About & limits' }).click();
  const m = win.locator('main');
  await expect(m).toContainText('Educational use only');
  await expect(m).toContainText('Highly accurate protein structure prediction with AlphaFold');
  await expect(m).toContainText('not validated for clinical use');
  await expect(m).toContainText('CC BY 4.0');
  await expect(m.getByRole('button', { name: 'Clear cache' })).toBeVisible();
});

test('the status bar reports where data came from', async () => {
  await openTp53();
  await expect(win.locator('.statusbar')).toContainText(/Fetched live|Loaded from cache/);
});

test('a previously viewed gene opens again from the cache', async () => {
  await openTp53();
  await win.getByRole('button', { name: 'New search' }).click();
  await win.getByRole('button', { name: 'TP53 · human', exact: true }).click();
  await expect(win.locator('.geneheader h2')).toHaveText('TP53');
  await expect(win.locator('.statusbar')).toContainText('Loaded from cache');
});

test('offline mode: a gene viewed before still opens from the cache, an unseen one fails politely', async () => {
  await openTp53(); // fills the disk cache
  await expect(win.getByRole('tab', { name: 'Protein & Structure' })).toBeVisible();
  await win.waitForTimeout(3000); // let every panel finish so all its responses are cached
  await app.evaluate(({ Menu }) => {
    type Item = { label?: string; checked: boolean; click: () => void; submenu?: { items: Item[] } | null };
    const walk = (items: Item[]): Item | undefined => {
      for (const i of items) {
        if (i.label?.startsWith('Work Offline')) return i;
        const inner = i.submenu ? walk(i.submenu.items) : undefined;
        if (inner) return inner;
      }
      return undefined;
    };
    const item = walk((Menu.getApplicationMenu()?.items ?? []) as unknown as Item[]);
    if (!item) throw new Error('Work Offline menu item not found');
    // Electron toggles a checkbox item itself when click() runs, so do not set `checked` first.
    item.click();
  });
  const before = await win.evaluate(() => window.geneExplorer.cacheInfo());
  expect(before.status.offline).toBe(true);
  await home();
  await win.getByRole('button', { name: 'TP53 · human', exact: true }).click();
  await expect(win.locator('.geneheader h2')).toHaveText('TP53', { timeout: 20000 });
  await expect(win.locator('.statusbar')).toContainText('Offline (cache only)');
  await win.getByRole('tab', { name: 'Protein & Structure' }).click();
  await expect(win.locator('[role=tabpanel] .viewer-wrap canvas')).toHaveCount(1, { timeout: 20000 });
  const after = await win.evaluate(() => window.geneExplorer.cacheInfo());
  expect(after.stats.hits).toBeGreaterThan(before.stats.hits);
  await home();
  await win.getByRole('button', { name: 'Trp53 · mouse', exact: true }).click();
  await expect(win.locator('.notice.error')).toBeVisible({ timeout: 20000 });
});
