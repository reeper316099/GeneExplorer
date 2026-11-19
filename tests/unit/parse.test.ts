// Parser tests against REAL recorded API responses (tests/fixtures/api) plus hand-made malformed input.
import { describe, expect, it } from 'vitest';
import {
  parseAlphaFold,
  parseNcbiGenes,
  parseNcbiOrthologs,
  parseNcbiTaxon,
  parseNcbiTaxonSuggest,
  parseOrthoDbGroup,
  parseOrthoDbOrthologs,
  parseOrthoDbSearch,
  parseUniProtEntry,
  parseUniProtSearch,
  parseUniProtTaxonomy,
} from '../../src/api/parse';
import { parseOrthoDbGroupId, parseUniProtAccession } from '../../src/shared/ids';
import { fixtureJson, meta } from '../helpers/fixtures';

/** Unwraps an ok result or fails the test with the error message. */
function ok<T>(r: { ok: true; value: T } | { ok: false; error: { message: string } }): T {
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
}
const acc = (s: string) => {
  const a = parseUniProtAccession(s);
  if (!a) throw new Error('bad test accession');
  return a;
};

describe('UniProt entry', () => {
  const parsed = ok(
    parseUniProtEntry(
      fixtureJson('uniprot-tp53-entry'),
      meta('https://rest.uniprot.org/uniprotkb/P04637.json'),
    ),
  );
  it('parses the human TP53 entry with provenance', () => {
    expect(parsed.kind).toBe('active');
    if (parsed.kind !== 'active') return;
    const p = parsed.record;
    expect(p.source).toBe('UniProt');
    expect(p.recordId).toBe('P04637');
    expect(p.fetchedAt).toBe(1_700_000_000_000);
    expect(p.url).toContain('P04637');
    expect(p.value.reviewed).toBe(true);
    expect(p.value.geneNames.primary).toBe('TP53');
    expect(p.value.taxon.id).toBe(9606);
    expect(p.value.sequenceLength).toBe(393);
    expect(p.value.sequence).toHaveLength(393);
    expect(p.value.proteinName).toBe('Cellular tumor antigen p53');
  });
  it('reads isoforms, features, cross-references and GO', () => {
    if (parsed.kind !== 'active') throw new Error('expected active');
    const v = parsed.record.value;
    expect(v.isoforms.length).toBeGreaterThanOrEqual(9);
    expect(v.isoforms.filter((i) => i.status === 'displayed')).toHaveLength(1);
    expect(v.isoforms.find((i) => i.status === 'displayed')?.id).toBe('P04637-1');
    expect(v.features.length).toBeGreaterThan(5);
    expect(v.features.every((f) => f.start >= 1 && f.end >= f.start && f.end <= 393)).toBe(true);
    expect(v.ncbiGeneIds).toContain('7157');
    expect(v.xrefs.some((x) => x.database === 'AlphaFoldDB' && x.id === 'P04637')).toBe(true);
    expect(v.functionText?.length ?? 0).toBeGreaterThan(50);
    expect(v.go.length).toBeGreaterThan(0);
    for (const g of v.go) expect(g.goId).toMatch(/^GO:\d{7}$/);
  });
  it('maps inactive entries to a reason and replacements', () => {
    const deleted = ok(parseUniProtEntry(fixtureJson('uniprot-obsolete-deleted'), meta()));
    expect(deleted.kind === 'inactive' && deleted.inactive.value.reason).toBe('DELETED');
    expect(deleted.kind === 'inactive' && deleted.inactive.value.detail).toBe(
      'Not part of a reference proteome',
    );
    const demerged = ok(parseUniProtEntry(fixtureJson('uniprot-obsolete-demerged'), meta()));
    expect(demerged.kind === 'inactive' && demerged.inactive.value.replacedBy).toEqual(['P0DOY2', 'P0DOY3']);
  });
  it('rejects a response whose shape changed instead of guessing', () => {
    const r = parseUniProtEntry(
      { entryType: 'UniProtKB reviewed (Swiss-Prot)', primaryAccession: 'P04637' },
      meta(),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('bad_response');
  });
  it('rejects a sequence whose length disagrees with its stated length', () => {
    const raw = structuredClone(fixtureJson('uniprot-tp53-entry')) as { sequence: { length: number } };
    raw.sequence.length = 5;
    expect(parseUniProtEntry(raw, meta()).ok).toBe(false);
  });
});

describe('UniProt search and taxonomy', () => {
  it('keeps reviewed and unreviewed hits distinguishable', () => {
    const hits = ok(parseUniProtSearch(fixtureJson('uniprot-tp53-search'), meta())).value;
    expect(hits[0]).toMatchObject({
      accession: 'P04637',
      reviewed: true,
      primaryGeneName: 'TP53',
      taxonId: 9606,
    });
    expect(hits.some((h) => !h.reviewed)).toBe(true);
  });
  it('parses taxonomy candidates', () => {
    const c = ok(parseUniProtTaxonomy(fixtureJson('uniprot-taxonomy-zebrafish'), meta())).value;
    expect(c.length).toBeGreaterThan(0);
    expect(c.every((x) => x.id > 0 && x.scientificName.length > 0)).toBe(true);
  });
});

describe('NCBI', () => {
  it('parses the human TP53 gene report', () => {
    const { genes, warnings } = ok(parseNcbiGenes(fixtureJson('ncbi-gene-human-tp53'), meta()));
    expect(warnings).toEqual([]);
    expect(genes).toHaveLength(1);
    const g = genes[0];
    expect(g?.source).toBe('NCBI');
    expect(g?.recordId).toBe('7157');
    expect(g?.value.symbol).toBe('TP53');
    expect(g?.value.taxon).toMatchObject({ id: 9606, scientificName: 'Homo sapiens' });
    expect(g?.value.swissProtAccessions).toEqual(['P04637']);
    expect(g?.value.locations[0]).toMatchObject({
      sequenceAccession: 'NC_000017.11',
      strand: 'minus',
      begin: 7668421,
      end: 7687490,
    });
    expect(g?.value.nomenclature).toEqual({ authority: 'HGNC', identifier: 'HGNC:11998' });
    expect(g?.value.go.length).toBeGreaterThan(0);
  });
  it('surfaces the strain-level taxon warning and returns no genes', () => {
    const { genes, warnings } = ok(parseNcbiGenes(fixtureJson('ncbi-gene-ecoli-strain-warning'), meta()));
    expect(genes).toEqual([]);
    expect(warnings[0]).toContain('83333');
  });
  it('parses a bacterial gene with a locus tag-style record (lacZ)', () => {
    const { genes } = ok(parseNcbiGenes(fixtureJson('ncbi-gene-ecoli-lacz'), meta()));
    expect(genes[0]?.value).toMatchObject({ symbol: 'lacZ', geneId: '945006' });
    expect(genes[0]?.value.taxon.id).toBe(511145);
  });
  it('parses orthologs as calls tagged with their source and method', () => {
    const calls = ok(parseNcbiOrthologs(fixtureJson('ncbi-orthologs-tp53'), meta()));
    expect(calls.map((c) => c.value.taxon.id).sort((a, b) => a - b)).toEqual([7955, 10090]);
    for (const c of calls) {
      expect(c.source).toBe('NCBI');
      expect(c.value.method).toBe('NCBI Orthologs');
    }
    expect(calls.find((c) => c.value.taxon.id === 10090)?.value.uniprotAccession).toBe('P02340');
  });
  it('parses taxonomy node and suggestions', () => {
    const t = ok(parseNcbiTaxon(fixtureJson('ncbi-taxon-human')));
    expect(t.taxon).toMatchObject({ id: 9606, scientificName: 'Homo sapiens' });
    expect(t.lineageIds).toContain(40674);
    const s = ok(parseNcbiTaxonSuggest(fixtureJson('ncbi-taxon-suggest-zebrafish'), meta())).value;
    expect(s.find((x) => x.id === 7955)?.commonName).toBe('zebrafish');
  });
});

describe('AlphaFold', () => {
  it('parses the TP53 model record', () => {
    const r = ok(parseAlphaFold(fixtureJson('alphafold-tp53'), acc('P04637'), meta()));
    expect(r?.source).toBe('AlphaFold');
    expect(r?.recordId).toBe('AF-P04637-F1');
    expect(r?.value.modelVersion).toBeGreaterThanOrEqual(4);
    expect(r?.value.meanPlddt).toBeGreaterThan(0);
    expect(r?.value.pdbUrl).toMatch(/^https:\/\/alphafold\.ebi\.ac\.uk\/files\//);
    const f = r?.value.fractions;
    expect((f?.veryLow ?? 0) + (f?.low ?? 0) + (f?.confident ?? 0) + (f?.veryHigh ?? 0)).toBeCloseTo(1, 2);
  });
  it('returns null when no model matches the requested accession', () => {
    expect(ok(parseAlphaFold(fixtureJson('alphafold-lacz'), acc('P04637'), meta()))).toBeNull();
  });
});

describe('OrthoDB', () => {
  it('parses search hits and group members', () => {
    const hits = ok(parseOrthoDbSearch(fixtureJson('orthodb-search-tp53'), meta())).value;
    expect(hits[0]).toMatchObject({ id: '742841at7742', levelName: 'Vertebrata' });
    const gid = parseOrthoDbGroupId('742841at7742');
    if (!gid) throw new Error('id');
    const calls = ok(parseOrthoDbOrthologs(fixtureJson('orthodb-orthologs-tp53'), gid, meta()));
    expect(calls.length).toBeGreaterThan(2);
    const taxa = new Set<number>(calls.map((c) => c.value.taxon.id));
    expect(taxa.has(10090) && taxa.has(9606) && taxa.has(7955)).toBe(true);
    for (const c of calls) {
      expect(c.source).toBe('OrthoDB');
      expect(c.value.method).toContain('742841at7742');
      expect(c.value.geneId).toBeUndefined();
    }
  });
  it('parses group details for the bacterial lacZ group', () => {
    const g = ok(parseOrthoDbGroup(fixtureJson('orthodb-group-bacterial'), meta()));
    expect(g.source).toBe('OrthoDB');
    expect(g.recordId).toBe('9758603at2');
    expect(g.value).toMatchObject({
      levelName: 'Bacteria',
      geneCount: 6437,
      speciesCount: 17551,
      presentIn: 3616,
    });
    expect(g.value.ecNumbers[0]?.id).toBe('3.2.1.23');
    expect(g.value.interpro.length).toBeGreaterThan(2);
  });
});
