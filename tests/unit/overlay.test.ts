// Tests for the structure overlay: PDB transformation, pairing through the alignment, pLDDT filtering, refusal cases,
// and real AlphaFold models (human TP53 vs mouse Trp53).
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { parseUniProtEntry } from '../../src/api/parse';
import { alignGlobal } from '../../src/bio/align';
import type { Alignment } from '../../src/bio/align';
import { parsePdbResidues, transformPdb } from '../../src/bio/pdb';
import { applyTransform } from '../../src/bio/superpose';
import { buildOverlay, MIN_IDENTITY, overlayCsv } from '../../src/core/overlay';
import type { Residue } from '../../src/shared/domain';
import { fixtureJson, fixtureText, meta } from '../helpers/fixtures';

/** Aligns two sequences or fails the test. */
function align(a: string, b: string): Alignment {
  const r = alignGlobal(a, b);
  if (!r.ok) throw new Error(r.message);
  return r.alignment;
}
/** Reads CA residues from a PDB text or fails the test. */
function residues(pdb: string): Residue[] {
  const r = parsePdbResidues(pdb);
  if (!r.ok) throw new Error(r.message);
  return r.residues;
}
const ROT = [0, -1, 0, 1, 0, 0, 0, 0, 1]; // 90 degrees about z
const SHIFT: [number, number, number] = [12.5, -7.25, 3];

describe('transformPdb', () => {
  const pdb = fixtureText('alphafold-insulin-model.pdb');
  it('moves every atom rigidly and leaves all other columns untouched', () => {
    const moved = transformPdb(pdb, ROT, SHIFT);
    const a = residues(pdb);
    const b = residues(moved);
    expect(b).toHaveLength(a.length);
    a.forEach((r, i) => {
      const m = applyTransform(ROT, SHIFT, r.ca);
      expect(b[i]?.ca[0]).toBeCloseTo(m[0], 2);
      expect(b[i]?.ca[1]).toBeCloseTo(m[1], 2);
      expect(b[i]?.ca[2]).toBeCloseTo(m[2], 2);
      expect(b[i]?.bfactor).toBe(r.bfactor);
      expect(b[i]?.code).toBe(r.code);
    });
    const la = pdb.split('\n');
    const lb = moved.split('\n');
    expect(lb).toHaveLength(la.length);
    la.forEach((line, i) => {
      if (line.startsWith('ATOM'))
        expect((lb[i] ?? '').slice(0, 30) + (lb[i] ?? '').slice(54)).toBe(line.slice(0, 30) + line.slice(54));
      else expect(lb[i]).toBe(line);
    });
  });
  it('identity transform keeps coordinates (property)', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(
          ...pdb
            .split('\n')
            .filter((l) => l.startsWith('ATOM'))
            .slice(0, 50),
        ),
        (line) => {
          const out = transformPdb(line, [1, 0, 0, 0, 1, 0, 0, 0, 1], [0, 0, 0]);
          expect(Number(out.slice(30, 38))).toBeCloseTo(Number(line.slice(30, 38)), 3);
        },
      ),
    );
  });
});

describe('buildOverlay on a model and a rigidly moved copy', () => {
  const pdb = fixtureText('alphafold-insulin-model.pdb');
  const A = residues(pdb);
  const B = residues(transformPdb(pdb, ROT, SHIFT));
  const seq = A.map((r) => r.code).join('');
  const aln = align(seq, seq);
  it('finds RMSD ~ 0 using every aligned position', () => {
    const o = buildOverlay(aln, A, B, 0);
    if (!o.ok) throw new Error(o.message);
    expect(o.superposition.rmsd).toBeLessThan(0.01);
    expect(o.used).toBe(seq.length);
    expect(o.aligned).toBe(seq.length);
    expect(o.pairs.every((p) => p.distance < 0.02)).toBe(true);
  });
  it('uses only positions that are confident in BOTH models and reports the counts', () => {
    const lowB = B.map((r, i) => (i % 2 === 0 ? { ...r, bfactor: 10 } : r));
    const o = buildOverlay(aln, A, lowB, 30);
    const expected = A.filter((r, i) => r.bfactor >= 30 && lowB[i] && lowB[i].bfactor >= 30).length;
    if (!o.ok) throw new Error(o.message);
    expect(o.used).toBe(expected);
    expect(o.aligned).toBe(seq.length);
    expect(o.pairs.filter((p) => p.used)).toHaveLength(expected);
    expect(o.caveats.join(' ')).toContain('pLDDT of at least 30');
  });
  it('a higher threshold never uses more positions (property)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 99 }), (t) => {
        const lo = buildOverlay(aln, A, B, t);
        const hi = buildOverlay(aln, A, B, t + 1);
        if (lo.ok && hi.ok) expect(hi.used).toBeLessThanOrEqual(lo.used);
      }),
      { numRuns: 60 },
    );
  });
  it('refuses with a reason when too few positions are confident', () => {
    const o = buildOverlay(aln, A, B, 101);
    expect(o).toMatchObject({ ok: false, reason: 'too_few_confident', used: 0 });
    expect(!o.ok && o.message).toContain('Lower the threshold');
  });
  it('refuses dissimilar sequences and says the identity', () => {
    const w = align('W'.repeat(40), 'WGPDEKRNQ'.repeat(5).slice(0, 40));
    expect(w.identity.overAligned ?? 1).toBeLessThan(MIN_IDENTITY);
    const o = buildOverlay(w, A, B, 0);
    expect(o).toMatchObject({ ok: false, reason: 'dissimilar' });
    expect(!o.ok && o.message).toMatch(/identity is \d+\.\d%/i);
  });
  it('refuses without an alignment or without structures', () => {
    expect(buildOverlay(null, A, B)).toMatchObject({ ok: false, reason: 'no_alignment' });
    expect(buildOverlay(aln, [], B)).toMatchObject({ ok: false, reason: 'no_structure' });
  });
  it('writes the aligned-position CSV with the RMSD header', () => {
    const o = buildOverlay(aln, A, B, 0);
    if (!o.ok) throw new Error(o.message);
    const csv = overlayCsv(o, { a: 'A', b: 'B', appVersion: '1' });
    expect(csv).toContain('RMSD 0.00 Angstrom');
    expect(csv.trim().split('\r\n')).toHaveLength(3 + 1 + seq.length);
  });
});

describe('buildOverlay on real AlphaFold models (human TP53 vs mouse Trp53)', () => {
  const seqOf = (name: string): string => {
    const p = parseUniProtEntry(fixtureJson(name), meta());
    if (!p.ok || p.value.kind !== 'active') throw new Error('entry');
    return p.value.record.value.sequence;
  };
  const human = residues(fixtureText('alphafold-tp53-model.pdb'));
  const mouse = residues(fixtureText('alphafold-mouse-p53-model.pdb'));
  const aln = align(seqOf('uniprot-tp53-entry'), seqOf('uniprot-entry-mouse-p53'));
  it('superimposes the confident core with a small RMSD and honest counts', () => {
    const o = buildOverlay(aln, human, mouse, 70);
    if (!o.ok) throw new Error(o.message);
    expect(o.used).toBeGreaterThan(100);
    expect(o.used).toBeLessThan(o.aligned); // disordered regions are excluded
    expect(o.superposition.rmsd).toBeGreaterThan(0);
    expect(o.superposition.rmsd).toBeLessThan(3);
    expect(o.pairs.filter((p) => p.used).every((p) => p.plddtA >= 70 && p.plddtB >= 70)).toBe(true);
  });
  it('lowering the threshold adds positions and cannot make the fit use fewer', () => {
    const a = buildOverlay(aln, human, mouse, 90);
    const b = buildOverlay(aln, human, mouse, 50);
    if (!a.ok || !b.ok) throw new Error('overlay failed');
    expect(b.used).toBeGreaterThan(a.used);
  });
});
