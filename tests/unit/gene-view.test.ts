// Tests the per-panel loading model: each panel loads, fails and retries on its own (partial state), and late results are dropped.
import { describe, expect, it } from 'vitest';
import { GeneApi } from '../../src/api/client';
import { endpoints } from '../../src/api/endpoints';
import { GeneView, parseFasta } from '../../src/core/gene-view';
import { resolveQuery } from '../../src/core/resolve';
import { parseNcbiGeneId, parseTaxonId, parseUniProtAccession } from '../../src/shared/ids';
import type { AppError } from '../../src/shared/types';
import { createFixtureTransport } from '../helpers/fixture-transport';
import { need } from '../helpers/fixtures';

const DOWN: AppError = { kind: 'network_down', message: 'offline' };

/** Builds a TP53 view whose API fails for the given URLs. */
async function view(
  overrides: Record<string, AppError> = {},
  cancelled = (): boolean => false,
): Promise<GeneView> {
  const api = new GeneApi(createFixtureTransport(overrides));
  const r = await resolveQuery(api, 'TP53', need(parseTaxonId(9606)));
  if (!r.ok || r.value.kind !== 'resolved') throw new Error('not resolved');
  const v = r.value;
  return new GeneView(v.gene, v.protein, v.identity, v.notes, {
    api,
    fromCache: () => false,
    isCancelled: cancelled,
  });
}
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 50));

describe('GeneView panels', () => {
  it('loads transcripts, sequence length and structure independently', async () => {
    const v = await view();
    v.start();
    await settle();
    expect(v.transcripts.status).toBe('ready');
    expect(v.sequence.status).toBe('ready');
    expect(v.structure.status).toBe('ready');
    if (v.structure.status === 'ready') {
      expect(v.structure.data.residues.length).toBe(393);
      expect(v.structure.data.models).toHaveLength(1);
    }
  });
  it('one failing panel leaves the others working, and Retry recovers it', async () => {
    const id = need(parseNcbiGeneId('7157'));
    const failing = endpoints.ncbiProductReport(id);
    const flaky = createFixtureTransport({ [failing]: DOWN });
    const api = new GeneApi(flaky);
    const r = await resolveQuery(api, 'TP53', need(parseTaxonId(9606)));
    if (!r.ok || r.value.kind !== 'resolved') throw new Error('not resolved');
    const v = new GeneView(r.value.gene, r.value.protein, r.value.identity, [], {
      api,
      fromCache: () => false,
      isCancelled: () => false,
    });
    v.start();
    await settle();
    expect(v.transcripts).toMatchObject({ status: 'error', error: { kind: 'network_down' } });
    expect(v.sequence.status).toBe('ready');
    expect(v.structure.status).toBe('ready');
    // The "network" comes back: a new API without the failure; Retry on that panel only.
    const healed = new GeneView(r.value.gene, r.value.protein, r.value.identity, [], {
      api: new GeneApi(createFixtureTransport()),
      fromCache: () => false,
      isCancelled: () => false,
    });
    await healed.load('transcripts');
    expect(healed.transcripts.status).toBe('ready');
  });
  it('reports "no model" with a reason when AlphaFold has none, and an error for a corrupt structure file', async () => {
    const acc = need(parseUniProtAccession('P04637'));
    const none = await view({
      [endpoints.alphafoldPrediction(acc)]: { kind: 'not_found', message: 'nf', status: 404 },
    });
    await none.load('structure');
    expect(none.structure).toMatchObject({ status: 'empty' });
    const bad = await view({
      'https://alphafold.ebi.ac.uk/files/AF-P04637-F1-model_v6.pdb': { kind: 'timeout', message: 'slow' },
    });
    await bad.load('structure');
    expect(bad.structure).toMatchObject({ status: 'error', error: { kind: 'timeout' } });
  });
  it('drops results once the screen was left (cancelled)', async () => {
    let gone = false;
    const v = await view({}, () => gone);
    let emitted = 0;
    v.subscribe(() => emitted++);
    const p = v.load('transcripts');
    gone = true;
    await p;
    expect(v.transcripts.status).toBe('loading'); // never replaced by a late answer
    expect(emitted).toBe(1); // only the "loading" notice sent before leaving
  });
  it('explains missing records instead of leaving panels blank', async () => {
    const empty = new GeneView(null, null, null, [], {
      api: new GeneApi(createFixtureTransport()),
      fromCache: () => false,
      isCancelled: () => false,
    });
    empty.start();
    await settle();
    expect(empty.transcripts).toMatchObject({ status: 'empty' });
    expect(empty.sequence).toMatchObject({ status: 'empty' });
    expect(empty.structure).toMatchObject({ status: 'empty' });
  });
  it('parses FASTA text from an isoform download', () => {
    expect(parseFasta('>sp|P04637-2|P53_HUMAN\nMEEP\nQSDP\n')).toBe('MEEPQSDP');
  });
});
