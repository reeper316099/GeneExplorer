// Tests for the Species view (ortholog tables per source) and the comparison logic, on real recorded responses plus
// hand-built cases for every field status.
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  parseNcbiOrthologs,
  parseNcbiTaxa,
  parseOrthoDbOrthologs,
  parseUniProtEntry,
  parseNcbiGenes,
} from '../../src/api/parse';
import { alignGlobal } from '../../src/bio/align';
import { csvCell, toCsv } from '../../src/core/csv';
import {
  classify,
  compareCsv,
  compareFields,
  compareGo,
  alignmentFasta,
  identityWindows,
  residueColumns,
  wrapAlignment,
} from '../../src/core/compare-table';
import type { CompareSubject } from '../../src/core/compare-table';
import {
  buildRows,
  cladeCounts,
  coverageStatement,
  filterRows,
  orthologCsv,
  sortRows,
  summarize,
} from '../../src/core/ortholog-table';
import type { ProteinRecord } from '../../src/shared/domain';
import { parseOrthoDbGroupId } from '../../src/shared/ids';
import type { TaxonId } from '../../src/shared/ids';
import { fixtureJson, meta, need } from '../helpers/fixtures';

/** Unwraps an ok result or fails the test. */
function ok<T>(r: { ok: true; value: T } | { ok: false; error: { message: string } }): T {
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
}

/** Lineage map from the recorded batch taxonomy answers. */
function lineages(): Map<TaxonId, readonly TaxonId[]> {
  const m = new Map<TaxonId, readonly TaxonId[]>();
  for (let i = 0; i < 7; i++)
    for (const [k, v] of ok(parseNcbiTaxa(fixtureJson(`ncbi-taxa-tp53-batch${i}`)))) m.set(k, v.lineageIds);
  return m;
}

describe('batch taxonomy lineages', () => {
  it('covers every species in the TP53 ortholog list', () => {
    // The app drops the query gene itself (human TP53) before looking up lineages, so the tests do the same.
    const calls = ok(parseNcbiOrthologs(fixtureJson('ncbi-orthologs-tp53-all'), meta())).filter(
      (c) => c.value.geneId !== '7157',
    );
    const l = lineages();
    expect(calls.length).toBeGreaterThan(600);
    const missing = calls.filter((c) => !l.has(c.value.taxon.id));
    expect(missing).toEqual([]);
  });
});

describe('NCBI ortholog table (human TP53)', () => {
  // The app drops the query gene itself (human TP53) before looking up lineages, so the tests do the same.
  const calls = ok(parseNcbiOrthologs(fixtureJson('ncbi-orthologs-tp53-all'), meta())).filter(
    (c) => c.value.geneId !== '7157',
  );
  const rows = buildRows(calls, lineages());
  it('groups species into lineage groups and finds no unclassified species', () => {
    expect(rows.every((r) => r.clade.key !== 'unclassified')).toBe(true);
    const counts = cladeCounts(rows);
    expect(counts.map((c) => c.clade.key)).toContain('mammals');
    expect(counts.map((c) => c.clade.key)).toContain('fish');
    expect(counts.reduce((a, c) => a + c.genes, 0)).toBe(rows.length);
  });
  it('summarises the source honestly: this list is vertebrates only', () => {
    const s = summarize(rows);
    expect(s.species).toBeGreaterThan(500);
    expect(
      rows.every((r) =>
        ['mammals', 'birds', 'reptiles', 'amphibians', 'fish', 'vertebrates'].includes(r.clade.key),
      ),
    ).toBe(true);
    expect(coverageStatement(rows)).toContain('Species not listed here may still carry the gene');
    expect(coverageStatement([])).toContain('no ortholog calls');
  });
  it('filters by lineage group and text, and sorts deterministically both ways', () => {
    const fish = filterRows(rows, { clade: 'fish' });
    expect(fish.length).toBeGreaterThan(10);
    expect(fish.every((r) => r.clade.key === 'fish')).toBe(true);
    const mouse = filterRows(rows, { text: 'mus musculus' });
    expect(mouse.some((r) => r.call.value.taxon.id === 10090)).toBe(true);
    const asc = sortRows(rows, 'species').map((r) => r.call.value.taxon.scientificName.toLowerCase());
    const desc = sortRows(rows, 'species', -1).map((r) => r.call.value.taxon.scientificName.toLowerCase());
    for (let i = 1; i < asc.length; i++)
      expect((asc[i - 1] ?? '').localeCompare(asc[i] ?? '')).toBeLessThanOrEqual(0);
    for (let i = 1; i < desc.length; i++)
      expect((desc[i - 1] ?? '').localeCompare(desc[i] ?? '')).toBeGreaterThanOrEqual(0);
    const byTaxon = sortRows(rows, 'taxon').map((r) => r.call.value.taxon.id);
    for (let i = 1; i < byTaxon.length; i++) expect(byTaxon[i - 1] ?? 0).toBeLessThanOrEqual(byTaxon[i] ?? 0);
  });
  it('exports a CSV with a provenance header and one line per row', () => {
    const csv = orthologCsv(rows.slice(0, 3), {
      source: 'NCBI Orthologs',
      method: 'NCBI Orthologs',
      query: 'TP53 (NCBI Gene 7157)',
      fetchedAt: 1_700_000_000_000,
      appVersion: '9.9.9',
    });
    const lines = csv.trim().split('\r\n');
    expect(lines[0]).toContain('NCBI Orthologs');
    expect(csv).toContain('GeneExplorer 9.9.9');
    expect(csv).toContain('not provided by this source');
    expect(lines.filter((l) => !l.startsWith('#'))).toHaveLength(4);
  });
});

describe('OrthoDB ortholog table', () => {
  it('parses all members of the recorded Eukaryota group and keeps them labelled as OrthoDB', () => {
    const g = need(parseOrthoDbGroupId('4289813at2759'));
    const calls = ok(parseOrthoDbOrthologs(fixtureJson('orthodb-orthologs-tp53-all'), g, meta()));
    expect(calls.length).toBeGreaterThan(200);
    expect(calls.every((c) => c.source === 'OrthoDB' && c.value.method.includes('4289813at2759'))).toBe(true);
  });
});

describe('CSV safety', () => {
  it('quotes commas, quotes and newlines, and defuses spreadsheet formulas', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('=HYPERLINK("x")')).toBe('"\'=HYPERLINK(""x"")"');
    expect(csvCell('+1')).toBe("'+1");
    expect(csvCell(-5)).toBe('-5');
    expect(csvCell(null)).toBe('');
  });
  it('never lets a cell start with a formula character (property)', () => {
    fc.assert(fc.property(fc.string(), (s) => !/^[=+\-@\t\r]/.test(csvCell(s).replace(/^"/, ''))));
    expect(toCsv([['a']], ['x\ny'])).toBe('# x y\r\na\r\n');
  });
});

describe('comparison table statuses', () => {
  it('classifies same / different / missing-in-A / missing-in-B / not comparable', () => {
    expect(classify('1', '1')).toBe('same');
    expect(classify('1', '2')).toBe('different');
    expect(classify(null, '2')).toBe('missing_a');
    expect(classify('1', null)).toBe('missing_b');
    expect(classify(null, null)).toBe('not_comparable');
  });
  const prot = (id: string): ProteinRecord => {
    const p = ok(parseUniProtEntry(fixtureJson(id), meta()));
    if (p.kind !== 'active') throw new Error('inactive');
    return p.record;
  };
  const human = ok(parseNcbiGenes(fixtureJson('ncbi-gene-human-tp53'), meta())).genes[0] ?? null;
  const mouse = ok(parseNcbiGenes(fixtureJson('ncbi-gene-mouse-trp53'), meta())).genes[0] ?? null;
  const A: CompareSubject = {
    gene: human,
    protein: prot('uniprot-tp53-entry'),
    transcript: null,
    structure: null,
  };
  const B: CompareSubject = {
    gene: mouse,
    protein: prot('uniprot-entry-mouse-p53'),
    transcript: null,
    structure: null,
  };
  it('compares human TP53 with mouse Trp53 field by field with provenance', () => {
    const rows = compareFields(A, B);
    const f = (name: string) => rows.find((r) => r.field.startsWith(name));
    expect(f('Gene symbol')).toMatchObject({ a: 'TP53', b: 'Trp53', status: 'different' }); // Trp53 vs TP53: a naming-convention difference, reported as different
    expect(f('Gene type')?.status).toBe('same');
    expect(f('Chromosome')).toMatchObject({ a: '17', b: '11', status: 'different' });
    expect(f('Strand')?.status).toBe('different');
    expect(f('Protein length')).toMatchObject({ a: '393', b: '390', status: 'different' });
    expect(f('Review status')?.status).toBe('same');
    expect(f('Exon count')?.status).toBe('not_comparable'); // no transcript loaded on either side
    expect(f('Mean pLDDT')?.status).toBe('not_comparable');
    expect(f('Protein length')?.provA).toMatchObject({ source: 'UniProt', recordId: 'P04637' });
    expect(f('Exon count')?.provA).toBeNull();
  });
  it('reports one-sided data as missing on the right side', () => {
    const rows = compareFields(A, { gene: null, protein: null, transcript: null, structure: null });
    expect(rows.find((r) => r.field.startsWith('Protein length'))?.status).toBe('missing_b');
    expect(rows.find((r) => r.field.startsWith('Gene type'))?.status).toBe('missing_b');
    expect(
      compareFields({ ...A, protein: null, gene: null }, B).find((r) => r.field.startsWith('Gene type'))
        ?.status,
    ).toBe('missing_a');
  });
  it('writes a comparison CSV with provenance columns', () => {
    const csv = compareCsv(compareFields(A, B), {
      a: 'TP53 (human)',
      b: 'Trp53 (mouse)',
      appVersion: '1',
      fetchedAt: 0,
    });
    expect(csv).toContain('source_A');
    expect(csv).toContain('UniProt P04637');
    expect(csv).toContain('Differences may reflect real biology');
  });
  it('computes GO overlap (Jaccard) and handles empty sets', () => {
    const go = compareGo(A.protein, B.protein);
    expect(go.shared.length).toBeGreaterThan(5);
    expect(go.jaccard).toBeCloseTo(
      go.shared.length / (go.shared.length + go.onlyA.length + go.onlyB.length),
      10,
    );
    expect(go.jaccard).toBeGreaterThan(0);
    expect(compareGo(null, null).jaccard).toBeNull();
    const none = compareGo(A.protein, {
      ...(A.protein as ProteinRecord),
      value: { ...(A.protein as ProteinRecord).value, go: [] },
    });
    expect(none.jaccard).toBe(0);
  });
});

describe('alignment views', () => {
  const aln = ok(
    alignGlobal('MKTAYIAKQRQISFVKSHFSRQ', 'MKTAYIAQRQISFSHFSRQLL').ok
      ? {
          ok: true as const,
          value: (
            alignGlobal('MKTAYIAKQRQISFVKSHFSRQ', 'MKTAYIAQRQISFSHFSRQLL') as {
              ok: true;
              alignment: { alignedA: string; alignedB: string };
            }
          ).alignment,
        }
      : { ok: false as const, error: { message: 'align failed' } },
  );
  it('wraps into three-line blocks with numbering that matches the sequences', () => {
    const lines = wrapAlignment(aln.alignedA, aln.alignedB, 10);
    expect(lines.map((l) => l.a).join('')).toBe(aln.alignedA);
    expect(lines.map((l) => l.b).join('')).toBe(aln.alignedB);
    expect(lines.every((l) => l.mid.length === l.a.length)).toBe(true);
    expect(lines[0]?.startA).toBe(1);
    expect(lines[1]?.startA).toBe(11 - (aln.alignedA.slice(0, 10).match(/-/g)?.length ?? 0));
    for (const l of lines)
      for (let i = 0; i < l.mid.length; i++) if (l.mid[i] === '|') expect(l.a[i]).toBe(l.b[i]);
  });
  it('maps residues to columns and computes windowed identity', () => {
    expect(residueColumns('A-BC')).toEqual([0, 2, 3]);
    const w = identityWindows('AAAA----', 'AAGG----', 4);
    expect(w).toEqual([
      { start: 0, end: 4, identity: 0.5 },
      { start: 4, end: 8, identity: null },
    ]);
    fc.assert(
      fc.property(fc.stringMatching(/^[A-Z]{1,60}$/), (s) =>
        identityWindows(s, s, 7).every((x) => x.identity === 1),
      ),
    );
  });
  it('writes aligned FASTA with both records', () => {
    expect(alignmentFasta({ header: 'A', aligned: 'MK-V' }, { header: 'B', aligned: 'MKLV' })).toBe(
      '>A\nMK-V\n>B\nMKLV\n',
    );
  });
  it('reports progress while aligning and finishes at the same score', () => {
    const seen: number[] = [];
    const a = 'ACDEFGHIKLMNPQRSTVWY'.repeat(10);
    const withProgress = alignGlobal(a, a.split('').reverse().join(''), { onProgress: (f) => seen.push(f) });
    const without = alignGlobal(a, a.split('').reverse().join(''));
    expect(seen.length).toBeGreaterThan(3);
    expect(seen.every((f, i) => f > 0 && f <= 1 && (i === 0 || f >= (seen[i - 1] ?? 0)))).toBe(true);
    expect(withProgress.ok && without.ok && withProgress.alignment.score === without.alignment.score).toBe(
      true,
    );
  });
});
