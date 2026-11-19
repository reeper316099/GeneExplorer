// Global protein alignment (Needleman-Wunsch with affine gaps, Gotoh 1982) scored with BLOSUM62. Written from scratch.
// Gap convention (same as Biopython's PairwiseAligner): a gap of length k costs open + (k - 1) * extend.
import { BLOSUM62, BLOSUM62_LETTERS } from './blosum62';

export interface AlignOptions {
  /** Score of the first gap position (negative). Default -11. */
  gapOpen: number;
  /** Score of each further gap position (negative). Default -1. */
  gapExtend: number;
  /** Refuse inputs whose DP table would exceed this many cells (memory guard). Default 4,000,000. */
  maxCells: number;
  /** Called about every 32 rows with the fraction done (0-1); lets a worker report progress. */
  onProgress?: (fraction: number) => void;
}

export const DEFAULT_ALIGN_OPTIONS: AlignOptions = { gapOpen: -11, gapExtend: -1, maxCells: 4_000_000 };

export interface AlignmentStats {
  /** Total alignment columns (matches, mismatches and gaps). */
  columns: number;
  /** Columns where neither sequence has a gap. */
  alignedColumns: number;
  identities: number;
  /** Aligned columns with a positive BLOSUM62 score (includes identities). */
  positives: number;
  /** Number of gap positions (both sequences). */
  gapPositions: number;
  /** Number of separate gap runs. */
  gapOpenings: number;
}

/** Identity under three denominators; the UI shows the first and explains the others in a tooltip. */
export interface IdentityViews {
  /** identities / aligned non-gap columns (headline). null when nothing is aligned. */
  overAligned: number | null;
  /** identities / total alignment columns (gaps count against identity). */
  overColumns: number | null;
  /** identities / length of the shorter sequence. */
  overShorter: number | null;
}

export interface Alignment {
  score: number;
  alignedA: string;
  alignedB: string;
  /** Pairs of 0-based residue indices (a, b) for every aligned non-gap column, in order. */
  pairs: readonly [number, number][];
  stats: AlignmentStats;
  identity: IdentityViews;
}

export type AlignResult =
  | { ok: true; alignment: Alignment }
  | { ok: false; reason: 'empty_sequence' | 'too_large' | 'bad_character'; message: string };

const NEG = -(1 << 29);
const STAR_INDEX = BLOSUM62_LETTERS.indexOf('X');

/** Maps an uppercase letter to its BLOSUM62 row index; U, O, J and other rare letters score as X. */
function letterIndex(ch: string): number {
  const i = BLOSUM62_LETTERS.indexOf(ch);
  return i >= 0 ? i : STAR_INDEX;
}

/** Upper-cases a sequence and checks it holds only letters (and '*' for stop). Returns null if it does not. */
export function normalizeSequence(seq: string): string | null {
  const s = seq.replace(/\s+/g, '').toUpperCase();
  return /^[A-Z*]*$/.test(s) ? s : null;
}

/** Returns the BLOSUM62 score for two residue letters. */
export function blosumScore(a: string, b: string): number {
  const row = BLOSUM62[letterIndex(a)];
  const v = row?.[letterIndex(b)];
  if (v === undefined) throw new Error('BLOSUM62 lookup out of range');
  return v;
}

/** Computes identity percentages (as fractions 0..1) under the three denominators. */
export function identityViews(stats: AlignmentStats, lenA: number, lenB: number): IdentityViews {
  const frac = (num: number, den: number): number | null => (den > 0 ? num / den : null);
  return {
    overAligned: frac(stats.identities, stats.alignedColumns),
    overColumns: frac(stats.identities, stats.columns),
    overShorter: frac(stats.identities, Math.min(lenA, lenB)),
  };
}

/** Re-scores a finished alignment from scratch (independent of the DP); used by tests to check optimality claims. */
export function scoreAlignment(
  alignedA: string,
  alignedB: string,
  opts: AlignOptions = DEFAULT_ALIGN_OPTIONS,
): number {
  let score = 0;
  let inGapA = false;
  let inGapB = false;
  for (let k = 0; k < alignedA.length; k++) {
    const a = alignedA.charAt(k);
    const b = alignedB.charAt(k);
    if (a === '-') {
      score += inGapA ? opts.gapExtend : opts.gapOpen;
      inGapA = true;
      inGapB = false;
    } else if (b === '-') {
      score += inGapB ? opts.gapExtend : opts.gapOpen;
      inGapB = true;
      inGapA = false;
    } else {
      score += blosumScore(a, b);
      inGapA = false;
      inGapB = false;
    }
  }
  return score;
}

/** Counts identities, positives and gaps for an alignment given as two equal-length gapped strings. */
export function alignmentStats(alignedA: string, alignedB: string): AlignmentStats {
  let alignedColumns = 0;
  let identities = 0;
  let positives = 0;
  let gapPositions = 0;
  let gapOpenings = 0;
  let prev: 'a' | 'b' | 'm' | null = null;
  for (let k = 0; k < alignedA.length; k++) {
    const a = alignedA.charAt(k);
    const b = alignedB.charAt(k);
    if (a === '-' || b === '-') {
      gapPositions++;
      const kind = a === '-' ? 'a' : 'b';
      if (prev !== kind) gapOpenings++;
      prev = kind;
    } else {
      alignedColumns++;
      if (a === b) identities++;
      if (blosumScore(a, b) > 0) positives++;
      prev = 'm';
    }
  }
  return { columns: alignedA.length, alignedColumns, identities, positives, gapPositions, gapOpenings };
}

/** Aligns two protein sequences globally. Ties are broken diagonal > gap-in-B (up) > gap-in-A (left). */
export function alignGlobal(seqA: string, seqB: string, options: Partial<AlignOptions> = {}): AlignResult {
  const opts: AlignOptions = { ...DEFAULT_ALIGN_OPTIONS, ...options };
  const a = normalizeSequence(seqA);
  const b = normalizeSequence(seqB);
  if (a === null || b === null) {
    return { ok: false, reason: 'bad_character', message: 'Sequences may contain letters only.' };
  }
  const m = a.length;
  const n = b.length;
  if (m === 0 || n === 0)
    return { ok: false, reason: 'empty_sequence', message: 'Cannot align an empty sequence.' };
  if (m * n > opts.maxCells) {
    return {
      ok: false,
      reason: 'too_large',
      message: `These sequences (${m} x ${n} residues) are too long to align inside the app (limit ${opts.maxCells.toLocaleString('en-US')} cells).`,
    };
  }
  const { gapOpen: go, gapExtend: ge } = opts;
  const w = n + 1;
  const size = (m + 1) * w;
  // M: last column is a residue pair. X: last column is a gap in B (consumes a residue of A). Y: gap in A.
  const M = new Int32Array(size).fill(NEG);
  const X = new Int32Array(size).fill(NEG);
  const Y = new Int32Array(size).fill(NEG);
  const ai = new Uint8Array(m);
  const bi = new Uint8Array(n);
  for (let i = 0; i < m; i++) ai[i] = letterIndex(a.charAt(i));
  for (let j = 0; j < n; j++) bi[j] = letterIndex(b.charAt(j));
  M[0] = 0;
  for (let j = 1; j <= n; j++) Y[j] = go + (j - 1) * ge;
  for (let i = 1; i <= m; i++) X[i * w] = go + (i - 1) * ge;

  for (let i = 1; i <= m; i++) {
    if (opts.onProgress && i % 32 === 0) opts.onProgress(i / m);
    const row = BLOSUM62[ai[i - 1] ?? 0];
    if (!row) throw new Error('BLOSUM62 row missing');
    for (let j = 1; j <= n; j++) {
      const k = i * w + j;
      const d = k - w - 1;
      const up = k - w;
      const left = k - 1;
      const s = row[bi[j - 1] ?? 0] ?? 0;
      M[k] = s + Math.max(M[d] ?? NEG, X[d] ?? NEG, Y[d] ?? NEG);
      X[k] = Math.max((M[up] ?? NEG) + go, (X[up] ?? NEG) + ge, (Y[up] ?? NEG) + go);
      Y[k] = Math.max((M[left] ?? NEG) + go, (Y[left] ?? NEG) + ge, (X[left] ?? NEG) + go);
    }
  }

  const end = m * w + n;
  const endM = M[end] ?? NEG;
  const endX = X[end] ?? NEG;
  const endY = Y[end] ?? NEG;
  const score = Math.max(endM, endX, endY);
  let state: 'M' | 'X' | 'Y' = endM === score ? 'M' : endX === score ? 'X' : 'Y';

  const outA: string[] = [];
  const outB: string[] = [];
  const pairs: [number, number][] = [];
  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    const k = i * w + j;
    if (state === 'M') {
      const s = blosumScore(a.charAt(i - 1), b.charAt(j - 1));
      const target = (M[k] ?? NEG) - s;
      outA.push(a.charAt(i - 1));
      outB.push(b.charAt(j - 1));
      pairs.push([i - 1, j - 1]);
      const d = k - w - 1;
      i--;
      j--;
      if (M[d] === target) state = 'M';
      else if (X[d] === target) state = 'X';
      else state = 'Y';
    } else if (state === 'X') {
      const target = X[k] ?? NEG;
      outA.push(a.charAt(i - 1));
      outB.push('-');
      const up = k - w;
      i--;
      if (i === 0 && j === 0) break;
      if (M[up] !== undefined && M[up] + go === target) state = 'M';
      else if (X[up] !== undefined && X[up] + ge === target) state = 'X';
      else state = 'Y';
    } else {
      const target = Y[k] ?? NEG;
      outA.push('-');
      outB.push(b.charAt(j - 1));
      const left = k - 1;
      j--;
      if (i === 0 && j === 0) break;
      if (M[left] !== undefined && M[left] + go === target) state = 'M';
      else if (Y[left] !== undefined && Y[left] + ge === target) state = 'Y';
      else state = 'X';
    }
  }
  const alignedA = outA.reverse().join('');
  const alignedB = outB.reverse().join('');
  pairs.reverse();
  const stats = alignmentStats(alignedA, alignedB);
  return {
    ok: true,
    alignment: { score, alignedA, alignedB, pairs, stats, identity: identityViews(stats, m, n) },
  };
}
