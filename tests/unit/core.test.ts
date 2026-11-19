// Tests for search classification, identity checks, isoform selection, lineage grouping, PDB reading and comparison.
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  parseAlphaFold,
  parseNcbiGenes,
  parseNcbiOrthologs,
  parseNcbiTaxon,
  parseUniProtEntry,
} from '../../src/api/parse';
import { parsePdbResidues, plddtBand } from '../../src/bio/pdb';
import { buildComparison, mapFeature, structureNote } from '../../src/core/compare';
import { checkIdentity } from '../../src/core/identity';
import { selectCanonicalIsoform } from '../../src/core/isoforms';
import { assignClade, groupOrthologsByClade, CLADES } from '../../src/core/lineage';
import { classifyQuery } from '../../src/core/search';
import type {
  GeneRecord,
  OrthologCall,
  ProteinRecord,
  Residue,
  StructureRecord,
} from '../../src/shared/domain';
import { parseTaxonId, parseUniProtAccession, parseNcbiGeneId } from '../../src/shared/ids';
import type { TaxonId } from '../../src/shared/ids';
import { fixtureJson, fixtureText, meta } from '../helpers/fixtures';

/** Unwraps an ok result or fails the test. */
function ok<T>(r: { ok: true; value: T } | { ok: false; error: { message: string } }): T {
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
}
const tax = (n: number): TaxonId => {
  const t = parseTaxonId(n);
  if (!t) throw new Error('taxon');
  return t;
};
/** Loads the TP53 protein record from the recorded UniProt entry. */
function tp53Protein(): ProteinRecord {
  const p = ok(parseUniProtEntry(fixtureJson('uniprot-tp53-entry'), meta()));
  if (p.kind !== 'active') throw new Error('expected active');
  return p.record;
}
/** Loads the human TP53 gene record from the recorded NCBI report. */
function tp53Gene(): GeneRecord {
  const g = ok(parseNcbiGenes(fixtureJson('ncbi-gene-human-tp53'), meta())).genes[0];
  if (!g) throw new Error('no gene');
  return g;
}

describe('classifyQuery', () => {
  const cases: [string, string][] = [
    ['', 'empty'],
    ['   ', 'empty'],
    ['P04637', 'uniprot'],
    ['p04637', 'uniprot'],
    ['A0A386NCW8', 'uniprot'],
    ['P04637-2', 'uniprot_isoform'],
    ['7157', 'ncbi_gene'],
    ['GeneID: 7157', 'ncbi_gene'],
    ['NCBI:7157', 'ncbi_gene'],
    ['ENSG00000141510', 'ensembl_gene'],
    ['ENSG00000141510.20', 'ensembl_gene'],
    ['NM_000546.6', 'refseq'],
    ['np_000537.3', 'refseq'],
    ['HGNC:11998', 'hgnc'],
    ['742841at7742', 'orthodb_group'],
    ['TP53', 'symbol'],
    ['lacZ', 'symbol'],
    ['HLA-A', 'symbol'],
    ['tumor protein p53', 'free_text'],
    ['p53 (human)', 'free_text'],
  ];
  for (const [input, kind] of cases) {
    it(`classifies ${JSON.stringify(input)} as ${kind}`, () => {
      expect(classifyQuery(input).kind).toBe(kind);
    });
  }
  it('rejects overlong input and strips control characters', () => {
    expect(classifyQuery('A'.repeat(101)).kind).toBe('too_long');
    expect(classifyQuery('TP53\u0000\n')).toEqual({ kind: 'symbol', symbol: 'TP53' });
  });
  it('never throws on arbitrary strings and always returns a known kind', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 150 }), (s) => typeof classifyQuery(s).kind === 'string'),
      { numRuns: 500 },
    );
  });
  it('treats a bare symbol as a symbol, never as an identity', () => {
    expect(classifyQuery('TP53').kind).not.toBe('uniprot');
    expect(classifyQuery('TP53').kind).not.toBe('ncbi_gene');
  });
});

describe('checkIdentity', () => {
  it('confirms human TP53 when NCBI and UniProt point at each other', () => {
    const r = checkIdentity(tp53Gene(), tp53Protein());
    expect(r.status).toBe('confirmed');
    expect(r.taxon).toBe('same');
    expect(r.evidence).toHaveLength(2);
  });
  it('is one_way when only one side lists the other', () => {
    const p = tp53Protein();
    const noXref = { ...p, value: { ...p.value, ncbiGeneIds: [] } };
    expect(checkIdentity(tp53Gene(), noXref).status).toBe('one_way');
  });
  it('is unconfirmed (not confirmed) when only the symbol would match', () => {
    const g = tp53Gene();
    const p = tp53Protein();
    const gNo = { ...g, value: { ...g.value, swissProtAccessions: [] } };
    const pNo = { ...p, value: { ...p.value, ncbiGeneIds: [] } };
    const r = checkIdentity(gNo, pNo);
    expect(r.status).toBe('unconfirmed');
    expect(r.evidence.join(' ')).toContain('may only share a name');
  });
  it('flags a conflict when the cross-references name different records', () => {
    const g = tp53Gene();
    const p = tp53Protein();
    const other = parseUniProtAccession('P02340');
    const otherId = parseNcbiGeneId('22059');
    if (!other || !otherId) throw new Error('ids');
    const r = checkIdentity(
      { ...g, value: { ...g.value, swissProtAccessions: [other] } },
      { ...p, value: { ...p.value, ncbiGeneIds: [otherId] } },
    );
    expect(r.status).toBe('conflict');
  });
  it('recognises a broader UniProt taxon (E. coli strain K-12 vs substrain) as ancestor, and other organisms as different', () => {
    const g = tp53Gene();
    const p = tp53Protein();
    const gEcoli = {
      ...g,
      value: {
        ...g.value,
        taxon: { id: tax(511145), scientificName: 'Escherichia coli str. K-12 substr. MG1655' },
      },
    };
    const pEcoli = {
      ...p,
      value: { ...p.value, taxon: { id: tax(83333), scientificName: 'Escherichia coli (strain K12)' } },
    };
    expect(checkIdentity(gEcoli, pEcoli, [tax(83333), tax(562)]).taxon).toBe('ancestor');
    expect(checkIdentity(gEcoli, pEcoli, []).taxon).toBe('different');
  });
});

describe('selectCanonicalIsoform', () => {
  it('picks the displayed isoform and lists alternatives', () => {
    const s = selectCanonicalIsoform(tp53Protein());
    expect(s.canonicalId).toBe('P04637-1');
    expect(s.sequence).toHaveLength(393);
    expect(s.alternatives.length).toBeGreaterThanOrEqual(8);
    expect(s.alternatives.some((i) => i.id === 'P04637-1')).toBe(false);
    expect(s.hasSwitchableIsoforms).toBe(true);
  });
  it('falls back to the accession when the entry lists no isoforms', () => {
    const p = tp53Protein();
    const s = selectCanonicalIsoform({ ...p, value: { ...p.value, isoforms: [] } });
    expect(s.canonicalId).toBe('P04637');
    expect(s.alternatives).toEqual([]);
    expect(s.hasSwitchableIsoforms).toBe(false);
  });
});

describe('lineage grouping', () => {
  const human = ok(parseNcbiTaxon(fixtureJson('ncbi-taxon-human')));
  it('places human in Mammals using the real NCBI lineage', () => {
    expect(assignClade(human.taxon.id, human.lineageIds).key).toBe('mammals');
  });
  it('uses the most specific clade (bird beats reptile beats vertebrate)', () => {
    expect(assignClade(tax(9031), [tax(7742), tax(8457), tax(8782)]).key).toBe('birds');
    expect(assignClade(tax(8524), [tax(7742), tax(8457)]).key).toBe('reptiles');
    expect(assignClade(tax(7955), [tax(7742), tax(7898)]).key).toBe('fish');
    expect(assignClade(tax(10090), [tax(7742)]).key).toBe('vertebrates');
  });
  it('never guesses: unknown lineage is unclassified', () => {
    expect(assignClade(tax(12345), undefined).key).toBe('unclassified');
    expect(assignClade(tax(12345), [tax(1)]).key).toBe('unclassified');
  });
  it('defines each clade key and taxon ID once', () => {
    expect(new Set(CLADES.map((c) => c.key)).size).toBe(CLADES.length);
    expect(new Set(CLADES.map((c) => c.taxId)).size).toBe(CLADES.length);
  });
  it('groups real NCBI orthologs by clade in display order and keeps unknowns apart', () => {
    const calls = ok(parseNcbiOrthologs(fixtureJson('ncbi-orthologs-tp53'), meta()));
    const lineages = new Map<TaxonId, readonly TaxonId[]>([
      [tax(10090), [tax(7742), tax(40674)]],
      [tax(7955), [tax(7742), tax(7898)]],
    ]);
    const g = groupOrthologsByClade(calls, lineages);
    expect(g.map((x) => x.clade.key)).toEqual(['mammals', 'fish']);
    const none = groupOrthologsByClade(calls, new Map());
    expect(none.map((x) => x.clade.key)).toEqual(['unclassified']);
    expect(none[0]?.calls).toHaveLength(2);
  });
});

describe('PDB reading (AlphaFold insulin model)', () => {
  const pdb = fixtureText('alphafold-insulin-model.pdb');
  const af = ok(
    parseAlphaFold(fixtureJson('alphafold-insulin'), parseUniProtAccession('P01308') as never, meta()),
  );
  it('reads one C-alpha per residue and pLDDT from the B-factor column', () => {
    const r = parsePdbResidues(pdb);
    if (!r.ok) throw new Error(r.message);
    expect(r.residues.length).toBe(af?.value.sequence.length);
    expect(r.residues.map((x) => x.code).join('')).toBe(af?.value.sequence);
    // The mean B-factor must agree with the mean pLDDT AlphaFold reports for the same model (verified in Phase 1 for TP53).
    expect(r.meanBfactor).toBeCloseTo(af?.value.meanPlddt ?? NaN, 0);
    expect(r.residues.every((x) => x.bfactor >= 0 && x.bfactor <= 100)).toBe(true);
  });
  it('fails clearly on malformed or empty files', () => {
    expect(parsePdbResidues('')).toMatchObject({ ok: false });
    expect(
      parsePdbResidues('ATOM      1  CA  ALA A   1      xx.xxx  10.000  10.000  1.00 90.00           C'),
    ).toMatchObject({ ok: false });
  });
  it('bands pLDDT with AlphaFold cut-offs', () => {
    expect([95, 90, 80, 70, 60, 50, 10].map(plddtBand)).toEqual([
      'very_high',
      'confident',
      'confident',
      'low',
      'low',
      'very_low',
      'very_low',
    ]);
  });
});

describe('buildComparison', () => {
  const protein = tp53Protein();
  const insulin = ok(
    parseAlphaFold(fixtureJson('alphafold-insulin'), parseUniProtAccession('P01308') as never, meta()),
  ) as StructureRecord;
  const parsed = parsePdbResidues(fixtureText('alphafold-insulin-model.pdb'));
  if (!parsed.ok) throw new Error('pdb');
  const residues = parsed.residues;

  /** Builds a protein record from TP53 with a different sequence, features and accession (a stand-in second protein). */
  const variant = (sequence: string): ProteinRecord => ({
    ...protein,
    value: {
      ...protein.value,
      sequence,
      sequenceLength: sequence.length,
      features: [{ type: 'Domain', description: 'test', start: 3, end: 6 }],
    },
  });

  it('compares a protein with a mutated copy: identity, feature mapping, and RMSD ~0 for a rigidly moved model', () => {
    const seq = insulin.value.sequence;
    const a = { ...variant(seq), value: { ...variant(seq).value, reviewed: true } };
    const mutated = seq.slice(0, 20) + 'W' + seq.slice(21);
    const b = variant(mutated);
    // Second model = the same coordinates rotated 90 degrees about z and shifted (a rigid motion).
    const moved: Residue[] = residues.map((r) => ({
      ...r,
      ca: [-r.ca[1] + 5, r.ca[0] - 7, r.ca[2] + 3] as const,
    }));
    const m = buildComparison(
      { protein: a, structure: insulin, residues },
      { protein: b, structure: insulin, residues: moved },
      { plddtCutoff: 0 },
    );
    expect(m.alignment.ok && m.alignment.alignment.stats.identities).toBe(seq.length - 1);
    expect(m.sameSpecies).toBe(true);
    expect(m.featuresOfA[0]?.mapped).toEqual({ start: 3, end: 6 });
    expect(m.featuresOfA[0]?.coverage).toBe(1);
    expect(m.structure.ok && m.structure.superposition.rmsd).toBeLessThan(1e-6);
    expect(m.structure.ok && m.structure.pairsUsed).toBe(seq.length);
  });
  it('does not claim orthology unless a loaded call links the two proteins', () => {
    const a = variant('MKTAYIAKQRQISFVKSHFSRQ');
    const other = parseUniProtAccession('P02340');
    if (!other) throw new Error('acc');
    const b = {
      ...variant('MKTAYIAKQRQISFVKSHFSRQ'),
      value: {
        ...variant('MKTAYIAKQRQISFVKSHFSRQ').value,
        accession: other,
        taxon: { id: tax(10090), scientificName: 'Mus musculus' },
      },
    };
    const none = buildComparison({ protein: a }, { protein: b });
    expect(none.orthology.kind).toBe('not_reported');
    expect(none.sameSpecies).toBe(false);
    expect(none.warnings.join(' ')).toContain('different species');
    const call: OrthologCall = {
      value: {
        symbol: 'Trp53',
        description: '',
        taxon: { id: tax(10090), scientificName: 'Mus musculus' },
        method: 'NCBI Orthologs',
        uniprotAccession: other,
      },
      source: 'NCBI',
      recordId: '22059',
      fetchedAt: 1,
    };
    const linked = buildComparison({ protein: a }, { protein: b }, { orthologCalls: [call] });
    expect(linked.orthology.kind).toBe('reported');
    expect(linked.orthology.text).toContain('inferred');
  });
  it('warns about low identity, unreviewed entries, outdated models and too-long sequences', () => {
    const a = variant('MKTAYIAKQRQISFVKSHFSRQ');
    const b = {
      ...variant('GGGGPPPPDDDDEEEEWWWWHH'),
      value: { ...variant('GGGGPPPPDDDDEEEEWWWWHH').value, reviewed: false },
    };
    const m = buildComparison(
      { protein: a, structure: { ...insulin, value: { ...insulin.value, meanPlddt: 55 } } },
      { protein: b },
    );
    const text = m.warnings.join(' ');
    expect(text).toContain('below 30%');
    expect(text).toContain('unreviewed');
    expect(text).toContain('low overall confidence');
    expect(text).toContain('different sequence');
    const huge = buildComparison(
      { protein: variant('M'.repeat(2500)) },
      { protein: variant('M'.repeat(2500)) },
    );
    expect(huge.alignment.ok).toBe(false);
    expect(huge.structure.ok).toBe(false);
  });
  it('reports why superposition was not done when a model is missing or confidence is too low', () => {
    const a = variant(insulin.value.sequence);
    expect(buildComparison({ protein: a }, { protein: a }).structure).toMatchObject({ ok: false });
    const low: Residue[] = residues.map((r) => ({ ...r, bfactor: 40 }));
    const m = buildComparison({ protein: a, residues: low }, { protein: a, residues: low });
    expect(m.structure.ok).toBe(false);
  });
  it('maps a feature across a gap and reports partial coverage', () => {
    const pairs: [number, number][] = [
      [0, 0],
      [1, 1],
      [4, 2],
      [5, 3],
    ]; // positions 3-4 of A (indices 2,3) sit in a gap; feature 2-5 covers aligned positions 2 and 5 only
    const mf = mapFeature({ type: 'Region', description: '', start: 2, end: 5 }, pairs, 0);
    expect(mf.coverage).toBe(0.5);
    expect(mf.mapped).toEqual({ start: 2, end: 3 });
    expect(mapFeature({ type: 'Region', description: '', start: 3, end: 4 }, pairs, 0).mapped).toBeNull();
  });
  it('writes the standing prediction note with the confidence band', () => {
    expect(structureNote(95)).toContain('very high');
    expect(structureNote(95)).toContain('not for clinical use');
  });
});
