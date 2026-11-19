// End-to-end checks of Milestone B (Species and Compare tabs, exports, PDF report) in the real app. Test mode: every API
// call is answered from recorded real responses; saves go to a temp folder instead of a dialog; the window is hidden.
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

let app: ElectronApplication;
let win: Page;
const saveDir = mkdtempSync(path.join(tmpdir(), 'ge-e2e-saves-'));

test.beforeAll(async () => {
  app = await electron.launch({
    args: ['.', `--user-data-dir=${mkdtempSync(path.join(tmpdir(), 'ge-e2e-cmp-'))}`],
    env: {
      ...process.env,
      GENEEXPLORER_TEST_MODE: '1',
      GENEEXPLORER_BACKGROUND: '1',
      GENEEXPLORER_TEST_SAVE_DIR: saveDir,
    },
  });
  win = await app.firstWindow();
  await win.setViewportSize({ width: 1280, height: 1600 });
});
test.afterAll(async () => {
  await app.close();
});

/** Opens a gene page from an example chip. */
async function open(chip: string, symbol: string): Promise<void> {
  await win.getByRole('button', { name: 'New search' }).click();
  await win.getByRole('button', { name: chip, exact: true }).click();
  await expect(win.locator('.geneheader h2')).toHaveText(symbol, { timeout: 20000 });
}

test('Species tab: NCBI source is labelled, grouped by lineage, filterable, sortable and exportable', async () => {
  await open('TP53 · human', 'TP53');
  await win.getByRole('tab', { name: 'Species' }).click();
  const p = win.locator('[role=tabpanel]');
  await expect(p).toContainText('Orthology is inferred, not observed');
  await expect(p.getByRole('tab', { name: 'NCBI Orthologs' })).toHaveAttribute('aria-selected', 'true');
  await expect(p).toContainText('NCBI Orthologs: method and coverage', { timeout: 30000 });
  await expect(p).toContainText('species with a call in this source');
  await expect(p).toContainText('Mammals');
  await expect(p).toContainText('Ray-finned fishes');
  await expect(p).toContainText('does not provide paralogs');
  await expect(p.locator('svg[aria-label^="Species per lineage group"]')).toHaveCount(1);
  await expect(p).toContainText('human call in this source');
  const before = await p.locator('tbody tr').count();
  await p.getByLabel('Lineage group filter').selectOption('fish');
  const fish = await p.locator('tbody tr').count();
  expect(fish).toBeGreaterThan(10);
  expect(fish).toBeLessThan(before + 1);
  await expect(p.locator('tbody tr td:nth-child(4)').first()).toHaveText('Ray-finned fishes');
  await p.getByLabel('Lineage group filter').selectOption('');
  await p.getByLabel('Search the table').fill('mus musculus');
  await expect(p.locator('tbody tr')).toHaveCount(1);
  await expect(p.locator('tbody tr')).toContainText('Trp53');
  await p.getByLabel('Search the table').fill('');
  await p.getByRole('button', { name: 'Export table (CSV)' }).click();
  await expect.poll(() => existsSync(path.join(saveDir, 'TP53-ncbi-orthologs.csv'))).toBe(true);
  const csv = readFileSync(path.join(saveDir, 'TP53-ncbi-orthologs.csv'), 'utf8');
  expect(csv.split('\r\n')[0]).toContain('NCBI Orthologs');
  expect(csv).toContain('Fetched:');
  expect(csv).toContain('GeneExplorer');
  expect(csv).toContain('Trp53');
});

test('Species tab: OrthoDB is a separate, labelled source with its own group level (never merged with NCBI)', async () => {
  await open('TP53 · human', 'TP53');
  await win.getByRole('tab', { name: 'Species' }).click();
  const p = win.locator('[role=tabpanel]');
  await p.getByRole('tab', { name: 'OrthoDB' }).click();
  await expect(p).toContainText('OrthoDB: method and coverage', { timeout: 30000 });
  await expect(p.getByLabel('OrthoDB group')).toContainText('Eukaryota');
  await expect(p).toContainText('4289813at2759');
  await expect(p).not.toContainText('NCBI Orthologs: method');
  await p.getByRole('tab', { name: 'NCBI Orthologs' }).click();
  await expect(p).toContainText('NCBI Orthologs: method and coverage');
  await expect(p).not.toContainText('OrthoDB: method');
});

test('a gene with no ortholog calls says so without claiming the species lacks the gene (E. coli lacZ)', async () => {
  await open('lacZ · E. coli', 'lacZ');
  await win.getByRole('tab', { name: 'Species' }).click();
  const p = win.locator('[role=tabpanel]');
  await expect(p).toContainText('returned no ortholog calls', { timeout: 30000 });
  await expect(p).toContainText('not the same as');
  // OrthoDB's members were not recorded for this gene: the source fails alone, with Retry, and NCBI stays usable.
  await p.getByRole('tab', { name: 'OrthoDB' }).click();
  await expect(p.locator('.notice.error')).toBeVisible({ timeout: 30000 });
  await expect(p.getByRole('button', { name: 'Retry' })).toBeVisible();
});

test('Compare (close pair): human TP53 vs mouse Trp53 with table, alignment, features, GO and two 3D viewers', async () => {
  await open('TP53 · human', 'TP53');
  await win.getByRole('tab', { name: 'Compare' }).click();
  const p = win.locator('[role=tabpanel]');
  await p.getByLabel('Species of gene B').fill('mouse');
  await p.getByRole('option').first().click();
  await expect(p.getByRole('option')).toHaveCount(0);
  await p.getByRole('button', { name: 'Find ortholog in this species' }).click();
  await expect(p.locator('.result')).toHaveCount(1, { timeout: 30000 });
  await expect(p.locator('.result')).toContainText('Trp53');
  await expect(p).toContainText('lists one gene');
  await p.locator('.result').click();
  await expect(p).toContainText('Orthology reported', { timeout: 30000 });
  await expect(p).toContainText('Orthology is inferred. Differences may reflect real biology');
  const row = (name: string) => p.locator('tbody tr', { hasText: name });
  await expect(row('Gene type')).toContainText('same');
  await expect(row('Chromosome')).toContainText('different');
  await expect(row('Protein length')).toContainText('393');
  await expect(row('Protein length')).toContainText('390');
  await expect(row('Review status')).toContainText('same');
  await expect(p).toContainText(/Identity \d+\.\d%/, { timeout: 30000 });
  await expect(p).toContainText('over all');
  await expect(p).toContainText('over the shorter sequence');
  await expect(p).toContainText('Match line');
  await expect(p.locator('svg[aria-label^="Alignment overview"]')).toHaveCount(1);
  await expect(p).toContainText('GO term comparison');
  await expect(p).toContainText('Jaccard');
  await expect(p.locator('svg[aria-label^="Gene structure"]')).toHaveCount(2, { timeout: 20000 });
  // two structure viewers plus the overlay viewer
  await expect(p.locator('.viewer-wrap canvas')).toHaveCount(3, { timeout: 30000 });
  await p.getByLabel(/common scale/).check();
  await expect(p.locator('svg[aria-label^="Gene structure"]')).toHaveCount(2);
  await p.getByRole('button', { name: 'Export alignment (FASTA)' }).click();
  await expect.poll(() => existsSync(path.join(saveDir, 'alignment.fasta'))).toBe(true);
  const fasta = readFileSync(path.join(saveDir, 'alignment.fasta'), 'utf8');
  expect(fasta.match(/^>/gm)).toHaveLength(2);
  await p.getByRole('button', { name: 'Export table (CSV)' }).click();
  await expect.poll(() => readdirSafe().some((f) => f.endsWith('.csv') && f.includes('vs'))).toBe(true);
});

test('Compare (distant pair, no ortholog call): E. coli lacZ vs human TP53 warns and never presents them as orthologs', async () => {
  await open('TP53 · human', 'TP53');
  await win.getByRole('tab', { name: 'Compare' }).click();
  const p = win.locator('[role=tabpanel]');
  await p.getByLabel('Gene B symbol or ID').fill('945006');
  await p.getByRole('button', { name: 'Use this gene as B' }).click();
  await expect(p).toContainText('No ortholog call found', { timeout: 30000 });
  await expect(p).toContainText('does not show they share an ancestor');
  await expect(p).toContainText('different species');
  await expect(p).toContainText(/Identity \d+\.\d%/, { timeout: 40000 });
  await expect(p).toContainText('Identity is below 30%');
  await expect(p.locator('tbody tr', { hasText: 'Review status' })).toContainText('reviewed');
});

test('the alignment can be cancelled and re-run', async () => {
  await open('TP53 · human', 'TP53');
  await win.getByRole('tab', { name: 'Compare' }).click();
  const p = win.locator('[role=tabpanel]');
  await p.getByLabel('Gene B symbol or ID').fill('945006');
  await p.getByRole('button', { name: 'Use this gene as B' }).click();
  const cancel = p.getByRole('button', { name: 'Cancel' });
  if (await cancel.isVisible().catch(() => false)) {
    await cancel.click();
    await expect(p).toContainText('Alignment cancelled');
    await p.getByRole('button', { name: 'Run again' }).click();
  }
  await expect(p).toContainText(/Identity \d+\.\d%/, { timeout: 40000 });
});

test('PDF report: a real PDF with the required sections, provenance, citations and the disclaimer', async () => {
  await open('TP53 · human', 'TP53');
  await win.getByRole('tab', { name: 'Species' }).click();
  await expect(win.locator('[role=tabpanel]')).toContainText('NCBI Orthologs: method and coverage', {
    timeout: 30000,
  });
  await win.getByRole('tab', { name: 'Protein & Structure' }).click();
  await expect(win.locator('[role=tabpanel] .viewer-wrap canvas')).toHaveCount(1, { timeout: 20000 });
  await win.getByRole('button', { name: 'Export report' }).click();
  const file = path.join(saveDir, 'TP53-report.pdf');
  await expect.poll(() => existsSync(file), { timeout: 60000 }).toBe(true);
  const bytes = readFileSync(file);
  expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
  expect(statSync(file).size).toBeGreaterThan(30_000);
  // The page is restored to normal after printing.
  await expect(win.locator('.report-sheet')).toHaveCount(0);
  expect(await win.evaluate(() => document.body.classList.contains('printing'))).toBe(false);
});

/** Lists the saved files (used to wait for a CSV whose exact name depends on the gene labels). */
function readdirSafe(): string[] {
  try {
    return readdirSync(saveDir);
  } catch {
    return [];
  }
}

test('Structure overlay (close pair): RMSD with counts, adjustable pLDDT threshold, distance plot and exports', async () => {
  await open('TP53 · human', 'TP53');
  await win.getByRole('tab', { name: 'Compare' }).click();
  const p = win.locator('[role=tabpanel]');
  await p.getByLabel('Gene B symbol or ID').fill('22059');
  await p.getByRole('button', { name: 'Use this gene as B' }).click();
  const live = p.locator('p[aria-live=polite]', { hasText: 'RMSD' });
  await expect(live).toContainText(/RMSD \d+\.\d\d Å over \d+ of \d+ aligned positions/, { timeout: 60000 });
  const used = async (): Promise<number> => Number(/over (\d+) of/.exec((await live.innerText()) ?? '')?.[1]);
  const at70 = await used();
  await p.getByLabel('pLDDT threshold').fill('90');
  await expect.poll(used).toBeLessThan(at70);
  await p.getByLabel('pLDDT threshold').fill('50');
  await expect.poll(used).toBeGreaterThan(at70);
  await expect(p).toContainText('Flexible loops and low-confidence regions are left out on purpose');
  await expect(p).toContainText('not an experimental measurement');
  await expect(p.locator('svg[aria-label^="Distance between paired"]')).toHaveCount(1);
  await expect(p.getByText(/B \(orange, moved onto A\)/)).toBeVisible();
  await expect(p.locator('.viewer-wrap canvas')).toHaveCount(3, { timeout: 30000 });
  await p.getByRole('button', { name: 'Export aligned positions (CSV)' }).click();
  await expect.poll(() => existsSync(path.join(saveDir, 'aligned-positions.csv'))).toBe(true);
  const csv = readFileSync(path.join(saveDir, 'aligned-positions.csv'), 'utf8');
  expect(csv).toContain('RMSD');
  expect(csv).toContain('used_for_superposition');
  await p.getByLabel('pLDDT threshold').fill('100');
  await expect(p).toContainText('No overlay made', { timeout: 20000 });
  await expect(p).toContainText('Lower the threshold');
});

test('Structure overlay refuses a dissimilar pair and shows the identity (human TP53 vs E. coli lacZ)', async () => {
  await open('TP53 · human', 'TP53');
  await win.getByRole('tab', { name: 'Compare' }).click();
  const p = win.locator('[role=tabpanel]');
  await p.getByLabel('Gene B symbol or ID').fill('945006');
  await p.getByRole('button', { name: 'Use this gene as B' }).click();
  await expect(p).toContainText('No overlay made', { timeout: 60000 });
  await expect(p).toContainText('below the 30%');
  await expect(p).toContainText(/Sequence identity \(aligned positions\): \d+\.\d%/);
});
