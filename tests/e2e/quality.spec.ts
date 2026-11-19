// Cross-cutting quality checks in the real app (test mode, fixtures, hidden window): clean console, every identifier type,
// exports through the native-dialog path, rate-limit handling and dark mode across restarts.
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const saveDir = mkdtempSync(path.join(tmpdir(), 'ge-e2e-q-saves-'));
const userData = mkdtempSync(path.join(tmpdir(), 'ge-e2e-q-'));

/** Launches the app in test mode with extra environment. */
async function launch(
  dir: string,
  env: Record<string, string> = {},
): Promise<{ app: ElectronApplication; win: Page }> {
  const app = await electron.launch({
    args: ['.', `--user-data-dir=${dir}`],
    env: {
      ...process.env,
      GENEEXPLORER_TEST_MODE: '1',
      GENEEXPLORER_BACKGROUND: '1',
      GENEEXPLORER_TEST_SAVE_DIR: saveDir,
      ...env,
    },
  });
  const win = await app.firstWindow();
  await win.setViewportSize({ width: 1280, height: 1600 });
  return { app, win };
}

test.describe.serial('main flows', () => {
  let app: ElectronApplication;
  let win: Page;
  const problems: string[] = [];
  test.beforeAll(async () => {
    ({ app, win } = await launch(userData));
    win.on('console', (m) => {
      if (m.type() === 'error') problems.push(`console.error: ${m.text()}`);
    });
    win.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  });
  test.afterAll(async () => {
    await app.close();
  });

  /** Runs a search from the home form. */
  async function search(q: string): Promise<void> {
    await win.getByRole('button', { name: 'New search' }).click();
    await win.getByLabel('Search genes').fill(q);
    await win.getByRole('button', { name: 'Search', exact: true }).click();
  }

  test('launches with the right title', async () => {
    expect(await win.title()).toBe('GeneExplorer');
  });

  test('every identifier type works: UniProt accession, NCBI Gene ID, RefSeq accession', async () => {
    for (const q of ['P04637', '7157', 'GeneID: 7157', 'NM_000546.6']) {
      await search(q);
      await expect(win.locator('.geneheader h2')).toHaveText('TP53', { timeout: 20000 });
      await expect(win.locator('.geneheader')).toContainText('NCBI Gene: 7157');
    }
  });

  test('a symbol without a species lists matches across species and requires an explicit choice', async () => {
    await search('TP53');
    await expect(win.getByRole('heading', { name: /Genes named "TP53" in any species/ })).toBeVisible({
      timeout: 20000,
    });
    await expect(win.locator('.result').first()).toContainText('UniProt');
    await expect(win.locator('.geneheader')).toHaveCount(0); // nothing opened by itself
    await win.getByRole('button', { name: 'Why this order?' }).click();
    await expect(win.getByText(/reviewed \(curated Swiss-Prot\) entries first/)).toBeVisible();
    await win.locator('.result', { hasText: 'P04637' }).click();
    await expect(win.locator('.geneheader h2')).toHaveText('TP53', { timeout: 20000 });
  });

  test('an Ensembl gene ID and a free-text name give match lists', async () => {
    await search('ENSG00000141510');
    await expect(win.getByRole('heading', { name: /cross-referencing ENSG00000141510/ })).toBeVisible({
      timeout: 20000,
    });
    await expect(win.locator('.result').first()).toBeVisible();
    await search('tumor protein p53');
    await expect(win.getByRole('heading', { name: /Matches for "tumor protein p53"/ })).toBeVisible({
      timeout: 20000,
    });
  });

  test('exports go through the save path: JSON, FASTA, structure PNG, diagram PNG', async () => {
    await win.getByRole('button', { name: 'New search' }).click();
    await win.getByRole('button', { name: 'TP53 · human', exact: true }).click();
    await expect(win.locator('.geneheader h2')).toHaveText('TP53', { timeout: 20000 });
    await win.getByRole('button', { name: 'Export JSON' }).click();
    await expect.poll(() => existsSync(path.join(saveDir, 'TP53-record.json'))).toBe(true);
    const rec = JSON.parse(readFileSync(path.join(saveDir, 'TP53-record.json'), 'utf8')) as {
      gene: { source: string; recordId: string };
      protein: { recordId: string };
    };
    expect(rec.gene).toMatchObject({ source: 'NCBI', recordId: '7157' });
    expect(rec.protein.recordId).toBe('P04637');
    await win.getByRole('tab', { name: 'Protein & Structure' }).click();
    const p = win.locator('[role=tabpanel]');
    await p.getByRole('button', { name: 'Export FASTA' }).click();
    await expect.poll(() => existsSync(path.join(saveDir, 'P04637-1.fasta'))).toBe(true);
    const fa = readFileSync(path.join(saveDir, 'P04637-1.fasta'), 'utf8');
    expect(fa.startsWith('>P04637|P53_HUMAN')).toBe(true);
    expect(fa.replace(/^>.*\n/, '').replace(/\n/g, '')).toHaveLength(393);
    await expect(p.locator('.viewer-wrap canvas')).toHaveCount(1, { timeout: 20000 });
    await win.waitForTimeout(1500);
    await p.getByRole('button', { name: 'Save PNG' }).click();
    await expect.poll(() => existsSync(path.join(saveDir, 'P04637-alphafold.png'))).toBe(true);
    expect(readFileSync(path.join(saveDir, 'P04637-alphafold.png')).subarray(1, 4).toString()).toBe('PNG');
    await win.getByRole('tab', { name: 'Location' }).click();
    await win.locator('[role=tabpanel]').getByRole('button', { name: 'Save diagram as PNG' }).click();
    await expect.poll(() => existsSync(path.join(saveDir, 'TP53-NM_000546.6-structure.png'))).toBe(true);
  });

  test('the console stayed clean (no errors, no unhandled rejections) through all of the above', () => {
    expect(problems).toEqual([]);
  });
});

test('a 429 with Retry-After is respected and shown in the status bar, then the gene loads', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ge-e2e-429-'));
  const { app, win } = await launch(dir, {
    GENEEXPLORER_TEST_RATELIMIT: JSON.stringify({ urlIncludes: 'P04637.json', times: 1, retryAfter: '4' }),
  });
  try {
    await win.getByRole('button', { name: 'TP53 · human', exact: true }).click();
    await expect(win.locator('.statusbar')).toContainText(
      /rate limited.*retrying rest\.uniprot\.org in \d+ s/i,
      { timeout: 15000 },
    );
    await expect(win.locator('.geneheader h2')).toHaveText('TP53', { timeout: 30000 });
  } finally {
    await app.close();
  }
});

test('dark mode persists across app restarts', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ge-e2e-dark-'));
  const first = await launch(dir);
  await first.win.getByRole('button', { name: 'Toggle dark mode' }).click();
  const theme = await first.win.evaluate(() => document.documentElement.getAttribute('data-theme'));
  expect(theme === 'dark' || theme === 'light').toBe(true);
  // Quit the way a user does (graceful), so Chromium flushes its storage; Playwright's close() can kill the process first.
  await first.win.waitForTimeout(1000);
  const exited = new Promise((r) => first.app.process().once('exit', r));
  await first.app.evaluate(({ app }) => app.quit());
  await exited; // wait for the real process exit so the single-instance lock and storage are released
  const second = await launch(dir);
  try {
    expect(await second.win.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe(theme);
  } finally {
    await second.app.close();
  }
});
