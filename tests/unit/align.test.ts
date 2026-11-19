// Tests for src/bio/align.ts: Biopython reference cases, exhaustive brute force on tiny inputs, and properties.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { alignGlobal, blosumScore, scoreAlignment, DEFAULT_ALIGN_OPTIONS } from '../../src/bio/align';
import type { Alignment } from '../../src/bio/align';
import { BLOSUM62, BLOSUM62_LETTERS } from '../../src/bio/blosum62';

interface RefCase {
  name: string;
  a: string;
  b: string;
  gapOpen: number;
  gapExtend: number;
  score: number;
  optimalCount: number;
  alignedA: string;
  alignedB: string;
}
const refs = JSON.parse(readFileSync('tests/fixtures/reference/align-refs.json', 'utf8')) as {
  biopython: string;
  cases: RefCase[];
};

/** Runs the aligner and fails the test if it refuses. */
function mustAlign(a: string, b: string, opts = {}): Alignment {
  const r = alignGlobal(a, b, opts);
  if (!r.ok) throw new Error(r.message);
  return r.alignment;
}

/** Exhaustive best score over every possible alignment (only for tiny inputs). */
function bruteForce(a: string, b: string, open: number, ext: number): number {
  let best = -Infinity;
  /** Walks every path; `gap` is the kind of gap currently open (0 none, 1 gap in B, 2 gap in A). */
  const walk = (i: number, j: number, gap: 0 | 1 | 2, score: number): void => {
    if (i === a.length && j === b.length) {
      best = Math.max(best, score);
      return;
    }
    if (i < a.length && j < b.length) walk(i + 1, j + 1, 0, score + blosumScore(a[i] ?? '', b[j] ?? ''));
    if (i < a.length) walk(i + 1, j, 1, score + (gap === 1 ? ext : open));
    if (j < b.length) walk(i, j + 1, 2, score + (gap === 2 ? ext : open));
  };
  walk(0, 0, 0, 0);
  return best;
}

const AA = 'ACDEFGHIKLMNPQRSTVWY';
const seqArb = (min: number, max: number): fc.Arbitrary<string> =>
  fc.array(fc.constantFrom(...AA.split('')), { minLength: min, maxLength: max }).map((x) => x.join(''));

describe('BLOSUM62 table', () => {
  it('is symmetric with the expected anchor values', () => {
    for (let i = 0; i < BLOSUM62.length; i++)
      for (let j = 0; j < BLOSUM62.length; j++) expect(BLOSUM62[i]?.[j]).toBe(BLOSUM62[j]?.[i]);
    expect(blosumScore('W', 'W')).toBe(11);
    expect(blosumScore('A', 'A')).toBe(4);
    expect(blosumScore('A', 'R')).toBe(-1);
    expect(blosumScore('C', 'C')).toBe(9);
    expect(BLOSUM62_LETTERS).toHaveLength(24);
  });
});

describe('alignGlobal vs Biopython reference', () => {
  it('has at least 30 reference cases', () => {
    expect(refs.cases.length).toBeGreaterThanOrEqual(30);
  });
  for (const c of refs.cases) {
    it(`matches score for: ${c.name}`, () => {
      const aln = mustAlign(c.a, c.b, { gapOpen: c.gapOpen, gapExtend: c.gapExtend });
      expect(aln.score).toBe(c.score);
      // The alignment we return must itself be consistent: strips back to the inputs, re-scores to the same value.
      expect(aln.alignedA.replace(/-/g, '')).toBe(c.a);
      expect(aln.alignedB.replace(/-/g, '')).toBe(c.b);
      expect(
        scoreAlignment(aln.alignedA, aln.alignedB, {
          ...DEFAULT_ALIGN_OPTIONS,
          gapOpen: c.gapOpen,
          gapExtend: c.gapExtend,
        }),
      ).toBe(c.score);
      // When Biopython found exactly one optimal alignment ours must be that alignment.
      if (c.optimalCount === 1) {
        expect(aln.alignedA).toBe(c.alignedA);
        expect(aln.alignedB).toBe(c.alignedB);
      }
    });
  }
  it('reference was made with a pinned Biopython', () => {
    expect(refs.biopython).toBe('1.86');
  });
});

describe('alignGlobal exhaustive check', () => {
  it('equals brute force on small random pairs', () => {
    fc.assert(
      fc.property(seqArb(1, 5), seqArb(1, 5), (a, b) => {
        expect(mustAlign(a, b).score).toBe(bruteForce(a, b, -11, -1));
      }),
      { numRuns: 300 },
    );
  });
  it('equals brute force with cheap gaps (gaps get used)', () => {
    fc.assert(
      fc.property(seqArb(1, 6), seqArb(1, 6), (a, b) => {
        expect(mustAlign(a, b, { gapOpen: -2, gapExtend: -1 }).score).toBe(bruteForce(a, b, -2, -1));
      }),
      { numRuns: 300 },
    );
  });
});

describe('alignGlobal properties', () => {
  it('is symmetric in score', () => {
    fc.assert(
      fc.property(seqArb(1, 60), seqArb(1, 60), (a, b) => {
        expect(mustAlign(a, b).score).toBe(mustAlign(b, a).score);
      }),
      { numRuns: 100 },
    );
  });
  it('returns an alignment that strips back to the inputs and re-scores to its score', () => {
    fc.assert(
      fc.property(seqArb(1, 80), seqArb(1, 80), (a, b) => {
        const r = mustAlign(a, b);
        expect(r.alignedA.replace(/-/g, '')).toBe(a);
        expect(r.alignedB.replace(/-/g, '')).toBe(b);
        expect(r.alignedA).toHaveLength(r.alignedB.length);
        expect(scoreAlignment(r.alignedA, r.alignedB)).toBe(r.score);
        for (let k = 0; k < r.alignedA.length; k++)
          expect(r.alignedA[k] === '-' && r.alignedB[k] === '-').toBe(false);
      }),
      { numRuns: 100 },
    );
  });
  it('aligns a sequence with itself as a gapless diagonal at 100% identity', () => {
    fc.assert(
      fc.property(seqArb(1, 100), (a) => {
        const r = mustAlign(a, a);
        expect(r.alignedA).toBe(a);
        expect(r.alignedB).toBe(a);
        expect(r.identity.overAligned).toBe(1);
        expect(r.stats.gapPositions).toBe(0);
      }),
      { numRuns: 50 },
    );
  });
  it('lists aligned residue pairs in strictly increasing order', () => {
    fc.assert(
      fc.property(seqArb(1, 80), seqArb(1, 80), (a, b) => {
        const { pairs } = mustAlign(a, b);
        for (let k = 1; k < pairs.length; k++) {
          expect(pairs[k]?.[0] ?? 0).toBeGreaterThan(pairs[k - 1]?.[0] ?? 0);
          expect(pairs[k]?.[1] ?? 0).toBeGreaterThan(pairs[k - 1]?.[1] ?? 0);
        }
        expect(pairs).toHaveLength(mustAlign(a, b).stats.alignedColumns);
      }),
      { numRuns: 60 },
    );
  });
  it('cannot score below the all-gaps alignment', () => {
    fc.assert(
      fc.property(seqArb(1, 40), seqArb(1, 40), (a, b) => {
        const worst = -11 + (a.length - 1) * -1 + (-11 + (b.length - 1) * -1);
        expect(mustAlign(a, b).score).toBeGreaterThanOrEqual(worst);
      }),
      { numRuns: 60 },
    );
  });
});

describe('alignGlobal statistics and limits', () => {
  it('reports three identity denominators for a known case', () => {
    const r = mustAlign('MKV', 'MKVLL');
    expect(r.stats.identities).toBe(3);
    expect(r.stats.alignedColumns).toBe(3);
    expect(r.stats.columns).toBe(5);
    expect(r.identity.overAligned).toBe(1);
    expect(r.identity.overColumns).toBeCloseTo(0.6);
    expect(r.identity.overShorter).toBe(1);
  });
  it('is case-insensitive and ignores whitespace', () => {
    expect(mustAlign('mk v', 'MKV').alignedA).toBe('MKV');
  });
  it('treats rare letters (U, O, J) as X rather than failing', () => {
    expect(alignGlobal('MKUV', 'MKXV').ok).toBe(true);
  });
  it('refuses empty input, bad characters and oversized pairs with a typed reason', () => {
    expect(alignGlobal('', 'MK')).toMatchObject({ ok: false, reason: 'empty_sequence' });
    expect(alignGlobal('MK1', 'MK')).toMatchObject({ ok: false, reason: 'bad_character' });
    expect(alignGlobal('M'.repeat(2001), 'M'.repeat(2001))).toMatchObject({ ok: false, reason: 'too_large' });
  });
  it('aligns a 1500 x 1500 pair within the cell limit', () => {
    const a = 'ACDEFGHIKLMNPQRSTVWY'.repeat(75);
    const r = mustAlign(a, a);
    expect(r.score).toBeGreaterThan(0);
  });
});
