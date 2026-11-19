// Tests the per-source ortholog loading (NCBI and OrthoDB kept apart) over recorded real responses.
import { describe, expect, it } from 'vitest';
import { GeneApi } from '../../src/api/client';
import { parseOrthoDbSearch } from '../../src/api/parse';
import { GeneView } from '../../src/core/gene-view';
import { chooseDefaultGroup, OrthologState } from '../../src/core/ortholog-state';
import { resolveQuery } from '../../src/core/resolve';
import { createFixtureTransport } from '../helpers/fixture-transport';
import { fixtureJson, meta } from '../helpers/fixtures';

/** Builds a gene view for a query through the fixture transport. */
async function viewFor(q: string, taxon?: number): Promise<{ view: GeneView; api: GeneApi }> {
  const api = new GeneApi(createFixtureTransport());
  const t = taxon === undefined ? undefined : (taxon as never);
  const r = await resolveQuery(api, q, t);
  if (!r.ok || r.value.kind !== 'resolved') throw new Error('not resolved');
  const v = r.value;
  return {
    api,
    view: new GeneView(v.gene, v.protein, v.identity, v.notes, {
      api,
      fromCache: () => false,
      isCancelled: () => false,
    }),
  };
}

describe('default OrthoDB group', () => {
  it('picks the broadest group that is small enough to load, else the smallest', () => {
    const hits = parseOrthoDbSearch(fixtureJson('orthodb-search-p04637'), meta());
    if (!hits.ok) throw new Error('parse');
    expect(chooseDefaultGroup(hits.value.value)?.id).toBe('4289813at2759'); // Eukaryota, 800 genes
    const big = [
      { id: 'a' as never, name: '', levelName: 'Eukaryota', geneCount: 6622, speciesCount: 2646 },
      { id: 'b' as never, name: '', levelName: 'Vertebrata', geneCount: 3069, speciesCount: 1152 },
      { id: 'c' as never, name: '', levelName: 'Tetrapoda', geneCount: 711, speciesCount: 404 },
    ];
    expect(chooseDefaultGroup(big)?.id).toBe('c');
    expect(chooseDefaultGroup(big.slice(0, 2))?.id).toBe('b');
    expect(chooseDefaultGroup([])).toBeNull();
  });
});

describe('OrthologState', () => {
  it('loads NCBI orthologs of TP53 with lineage groups, excluding the gene itself', async () => {
    const { view, api } = await viewFor('TP53', 9606);
    const st = new OrthologState(view, api, () => false);
    await st.load('ncbi');
    expect(st.ncbi.status).toBe('ready');
    if (st.ncbi.status !== 'ready') return;
    expect(st.ncbi.data.rows.length).toBeGreaterThan(600);
    expect(st.ncbi.data.rows.some((r) => r.call.value.geneId === '7157')).toBe(false);
    expect(st.ncbi.data.rows.every((r) => r.call.source === 'NCBI')).toBe(true);
    expect(st.ncbi.data.lineageMissing).toBe(false);
    expect(st.orthodb.status).toBe('idle'); // sources are independent
  });
  it('loads OrthoDB separately, with its own group, and labels every row as OrthoDB', async () => {
    const { view, api } = await viewFor('TP53', 9606);
    const st = new OrthologState(view, api, () => false);
    await st.load('orthodb');
    expect(st.orthodb.status).toBe('ready');
    if (st.orthodb.status !== 'ready') return;
    expect(st.orthodb.data.selected).toBe('4289813at2759');
    expect(st.orthodb.data.rows.every((r) => r.call.source === 'OrthoDB')).toBe(true);
    expect(st.orthodb.data.info?.value.levelName).toBe('Eukaryota');
    expect(st.ncbi.status).toBe('idle');
  });
  it('reports a gene with no NCBI ortholog calls as an empty list, not an error (lacZ)', async () => {
    const { view, api } = await viewFor('lacZ', 511145);
    const st = new OrthologState(view, api, () => false);
    await st.load('ncbi');
    expect(st.ncbi.status).toBe('ready');
    if (st.ncbi.status === 'ready') expect(st.ncbi.data.rows).toEqual([]);
  });
  it('turns a failed source into an error state without touching the other source', async () => {
    const { view, api } = await viewFor('TP53', 9606);
    const failing = new GeneApi({
      ...createFixtureTransport(),
      fetchJson: () => Promise.resolve({ ok: false, error: { kind: 'network_down', message: 'offline' } }),
      fetchText: () => Promise.resolve({ ok: false, error: { kind: 'network_down', message: 'offline' } }),
    });
    const st = new OrthologState(view, failing, () => false);
    await st.load('ncbi');
    expect(st.ncbi).toMatchObject({ status: 'error', error: { kind: 'network_down' } });
    expect(st.orthodb.status).toBe('idle');
    void api;
  });
});
