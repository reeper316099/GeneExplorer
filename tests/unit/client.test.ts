// Tests the API client and query resolver end to end over recorded real responses (no network).
import { describe, expect, it } from 'vitest';
import { GeneApi } from '../../src/api/client';
import { endpoints } from '../../src/api/endpoints';
import { resolveQuery } from '../../src/core/resolve';
import type { Resolution } from '../../src/core/resolve';
import { parseNcbiGeneId, parseTaxonId, parseUniProtAccession } from '../../src/shared/ids';
import { createFixtureTransport } from '../helpers/fixture-transport';
import { need } from '../helpers/fixtures';

const human = need(parseTaxonId(9606));
const ids = {
  tp53: need(parseNcbiGeneId('7157')),
  p53: need(parseUniProtAccession('P04637')),
  lacz: need(parseUniProtAccession('P00722')),
};

/** Unwraps a resolution or fails the test. */
async function resolve(input: string, taxon = human): Promise<Resolution> {
  const api = new GeneApi(createFixtureTransport());
  const r = await resolveQuery(api, input, taxon);
  if (!r.ok) throw new Error(`${r.error.kind}: ${r.error.message}`);
  return r.value;
}

describe('endpoint builders encode user text', () => {
  it('cannot be tricked into adding path segments, parameters or hosts', () => {
    const evil = '../../etc?x=1&y=2#z';
    expect(endpoints.ncbiGeneBySymbol(evil, human)).toBe(
      `https://api.ncbi.nlm.nih.gov/datasets/v2/gene/symbol/${encodeURIComponent(evil)}/taxon/9606`,
    );
    expect(endpoints.ncbiGeneBySymbol(evil, human)).not.toContain('?x=1');
    const q = new URL(endpoints.uniprotSearchSymbol('TP53" OR (gene:*)', human));
    expect(q.hostname).toBe('rest.uniprot.org');
    // Every character that could act as a query operator (quote, space, parenthesis, colon, star) is dropped.
    expect(q.searchParams.get('query')).toBe('gene_exact:TP53ORgene AND organism_id:9606');
    expect(new URL(endpoints.ncbiTaxonSuggest('a/b?c')).pathname).toBe(
      '/datasets/v2/taxonomy/taxon_suggest/a%2Fb%3Fc',
    );
  });
});

describe('GeneApi', () => {
  it('returns parsed records with provenance from each source', async () => {
    const api = new GeneApi(createFixtureTransport());
    const u = await api.getUniProt(ids.p53);
    expect(u.ok && u.value.kind === 'active' && u.value.record.url).toContain('rest.uniprot.org');
    const g = await api.getNcbiGene(ids.tp53);
    expect(g.ok && g.value.genes[0]?.fetchedAt).toBeGreaterThan(1_700_000_000_000);
  });
  it('turns an unrecorded URL into a typed error instead of throwing', async () => {
    const api = new GeneApi(createFixtureTransport());
    const r = await api.getUniProt(need(parseUniProtAccession('P69905'))); // never recorded
    expect(r.ok).toBe(false);
  });
  it('reports "no AlphaFold model" as ok(null) rather than an error', async () => {
    const t = createFixtureTransport({
      [endpoints.alphafoldPrediction(ids.p53)]: {
        kind: 'not_found',
        message: 'Not found.',
        status: 404,
      },
    });
    const r = await new GeneApi(t).getAlphaFold(ids.p53);
    expect(r).toEqual({ ok: true, value: null });
  });
  it('presents NCBI HTTP 400 for an unknown ID as not_found', async () => {
    const bad = parseNcbiGeneId('999999999');
    if (!bad) throw new Error('id');
    const t = createFixtureTransport({
      [endpoints.ncbiGeneById(bad)]: {
        kind: 'bad_response',
        status: 400,
        message: 'Unexpected HTTP status 400.',
      },
    });
    const r = await new GeneApi(t).getNcbiGene(bad);
    expect(!r.ok && r.error.kind).toBe('not_found');
    expect(!r.ok && r.error.message).toContain('discontinued');
  });
  it('reports a changed API shape as bad_response', async () => {
    const t = createFixtureTransport();
    const api = new GeneApi({
      ...t,
      fetchJson: async (id, spec) => {
        const r = await t.fetchJson(id, spec);
        return r.ok ? { ...r, value: { ...r.value, data: { unexpected: true } } } : r;
      },
    });
    const r = await api.getNcbiGene(ids.tp53);
    expect(r.ok).toBe(true); // NCBI shape is all-optional (a report-less answer is valid)
    const u = await api.getUniProt(ids.p53);
    expect(!u.ok && u.error.kind).toBe('bad_response');
  });
});

describe('resolveQuery', () => {
  it('resolves TP53 + human through the symbol, links gene and protein, and records confirmation', async () => {
    const r = await resolve('TP53');
    expect(r.kind).toBe('resolved');
    if (r.kind !== 'resolved') return;
    expect(r.gene?.value.geneId).toBe('7157');
    expect(r.protein?.value.accession).toBe('P04637');
    expect(r.identity?.status).toBe('confirmed');
  });
  it("resolves from a UniProt accession to the gene via UniProt's GeneID cross-reference", async () => {
    const r = await resolve('P04637');
    expect(r.kind === 'resolved' && r.gene?.value.symbol).toBe('TP53');
    expect(r.kind === 'resolved' && r.identity?.status).toBe('confirmed');
  });
  it('resolves from an NCBI Gene ID', async () => {
    const r = await resolve('GeneID:7157');
    expect(r.kind === 'resolved' && r.protein?.value.accession).toBe('P04637');
  });
  it('asks for a species when given only a symbol', async () => {
    const api = new GeneApi(createFixtureTransport());
    const r = await resolveQuery(api, 'TP53');
    expect(r.ok && r.value.kind).toBe('needs_species');
  });
  it('does not silently accept an alias-only match (COX1 -> PTGS1): the user must choose', async () => {
    const r = await resolve('COX1');
    expect(r.kind).toBe('ambiguous');
    if (r.kind !== 'ambiguous') return;
    expect(r.candidates.some((c) => c.value.symbol === 'PTGS1')).toBe(true);
    expect(r.message).toContain('alias');
  });
  it('reports an obsolete UniProt accession with its replacements', async () => {
    const api = new GeneApi(createFixtureTransport());
    const r = await resolveQuery(api, 'P0CG05', human);
    expect(r.ok && r.value.kind === 'inactive' && r.value.entry.value.replacedBy).toEqual([
      'P0DOY2',
      'P0DOY3',
    ]);
  });
  it('rejects empty, overlong and unsupported input with a message, not an exception', async () => {
    expect((await resolve('')).kind).toBe('unsupported');
    expect((await resolve('x'.repeat(200))).kind).toBe('unsupported');
    expect((await resolve('tumor protein p53')).kind).toBe('unsupported');
    expect((await resolve('ENSG00000141510')).kind).toBe('unsupported');
  });

  it("finds the protein of a bacterial gene through UniProt's GeneID cross-reference when NCBI lists none (lacZ)", async () => {
    const r = await resolve('lacZ', need(parseTaxonId(511145)));
    expect(r.kind).toBe('resolved');
    if (r.kind !== 'resolved') return;
    expect(r.gene?.value.symbol).toBe('lacZ');
    expect(r.protein?.value.accession).toBe('P00722');
    expect(r.notes.join(' ')).toContain('found through UniProt');
    // Linked by UniProt only (NCBI lists nothing), and UniProt uses the broader strain-level taxon.
    expect(r.identity?.status).toBe('one_way');
    expect(r.identity?.taxon).toBe('ancestor');
  });
});
