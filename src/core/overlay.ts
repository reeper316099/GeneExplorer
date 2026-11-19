// Structure overlay (Milestone C): pairs residues through the sequence alignment, keeps only positions confident (pLDDT at or
// above a threshold) in BOTH AlphaFold models, superimposes B onto A with the app's own Horn/Kabsch implementation, and reports
// RMSD with the counts it is based on. It refuses, with a reason, when the result would not mean anything.
import type { Alignment } from '../bio/align';
import { applyTransform, superpose } from '../bio/superpose';
import type { Superposition } from '../bio/superpose';
import type { Residue } from '../shared/domain';
import { toCsv } from './csv';

export const MIN_PAIRS = 10;
export const MIN_IDENTITY = 0.3;

export interface OverlayPair {
  /** 1-based residue numbers in A and B. */
  a: number;
  b: number;
  plddtA: number;
  plddtB: number;
  /** True when both residues met the pLDDT threshold, so the pair shaped the superposition. */
  used: boolean;
  /** Distance in Angstrom between the paired C-alpha atoms after superposition (all pairs, used or not). */
  distance: number;
}

export type OverlayResult =
  | {
      ok: true;
      superposition: Superposition;
      pairs: OverlayPair[];
      used: number;
      aligned: number;
      /** Aligned pairs where a residue is missing from a structure file (not counted as aligned). */
      withoutCoordinates: number;
      threshold: number;
      caveats: string[];
    }
  | {
      ok: false;
      reason: 'dissimilar' | 'too_few_confident' | 'no_alignment' | 'no_structure';
      message: string;
      identity: number | null;
      used: number;
      aligned: number;
    };

/** Builds the overlay for an alignment and two sets of C-alpha residues. */
export function buildOverlay(
  alignment: Alignment | null,
  residuesA: readonly Residue[],
  residuesB: readonly Residue[],
  threshold = 70,
): OverlayResult {
  if (!alignment)
    return {
      ok: false,
      reason: 'no_alignment',
      message: 'The sequences have not been aligned (or could not be), so residues cannot be paired.',
      identity: null,
      used: 0,
      aligned: 0,
    };
  if (residuesA.length === 0 || residuesB.length === 0)
    return {
      ok: false,
      reason: 'no_structure',
      message: 'Both proteins need an AlphaFold model.',
      identity: alignment.identity.overAligned,
      used: 0,
      aligned: 0,
    };
  const identity = alignment.identity.overAligned;
  if (identity === null || identity < MIN_IDENTITY) {
    return {
      ok: false,
      reason: 'dissimilar',
      message: `Sequence identity is ${identity === null ? 'not defined' : `${(identity * 100).toFixed(1)}%`}, below the ${MIN_IDENTITY * 100}% needed for residue pairing to be meaningful. Below that, an alignment of two proteins does not show they share a fold, so no superposition is made.`,
      identity,
      used: 0,
      aligned: alignment.stats.alignedColumns,
    };
  }
  const byA = new Map(residuesA.map((r) => [r.number, r]));
  const byB = new Map(residuesB.map((r) => [r.number, r]));
  const paired: { a: Residue; b: Residue }[] = [];
  for (const [i, j] of alignment.pairs) {
    const ra = byA.get(i + 1);
    const rb = byB.get(j + 1);
    if (ra && rb) paired.push({ a: ra, b: rb });
  }
  const withoutCoordinates = alignment.pairs.length - paired.length;
  const confident = paired.filter((p) => p.a.bfactor >= threshold && p.b.bfactor >= threshold);
  if (confident.length < MIN_PAIRS) {
    return {
      ok: false,
      reason: 'too_few_confident',
      message: `Only ${confident.length} of ${paired.length} aligned positions have pLDDT of at least ${threshold} in both models; at least ${MIN_PAIRS} are needed. Lower the threshold (low-confidence regions are often disordered) or compare a different pair.`,
      identity,
      used: confident.length,
      aligned: paired.length,
    };
  }
  const sp = superpose(
    confident.map((p) => p.b.ca),
    confident.map((p) => p.a.ca),
  );
  if (!sp.ok)
    return {
      ok: false,
      reason: 'too_few_confident',
      message: sp.message,
      identity,
      used: confident.length,
      aligned: paired.length,
    };
  const { rotation, translation } = sp.value;
  const usedSet = new Set(confident.map((p) => p.a.number));
  const pairs: OverlayPair[] = paired.map((p) => {
    const m = applyTransform(rotation, translation, p.b.ca);
    return {
      a: p.a.number,
      b: p.b.number,
      plddtA: p.a.bfactor,
      plddtB: p.b.bfactor,
      used: usedSet.has(p.a.number),
      distance: Math.hypot(m[0] - p.a.ca[0], m[1] - p.a.ca[1], m[2] - p.a.ca[2]),
    };
  });
  const caveats = [
    'RMSD depends on which residues are used: here only positions with pLDDT of at least ' +
      threshold +
      ' in both models.',
    'Flexible loops and low-confidence regions are left out on purpose, so the number describes the confident core, not the whole protein.',
    'This is a distance between two predictions, not an experimental measurement.',
  ];
  const lenA = residuesA.length;
  const lenB = residuesB.length;
  if (Math.max(lenA, lenB) / Math.min(lenA, lenB) > 1.5)
    caveats.push(
      `The proteins differ a lot in length (${lenA} vs ${lenB} residues); a single global RMSD can be misleading when only part of one protein matches the other.`,
    );
  if (identity < 0.4)
    caveats.push(
      `Sequence identity is only ${(identity * 100).toFixed(1)}%; with domain rearrangements a single global RMSD is misleading.`,
    );
  return {
    ok: true,
    superposition: sp.value,
    pairs,
    used: confident.length,
    aligned: paired.length,
    withoutCoordinates,
    threshold,
    caveats,
  };
}

/** The aligned-position list as CSV (one row per aligned pair with pLDDT, whether it was used, and the distance after superposition). */
export function overlayCsv(
  o: Extract<OverlayResult, { ok: true }>,
  info: { a: string; b: string; appVersion: string },
): string {
  return toCsv(
    [
      [
        'residue_A',
        'residue_B',
        'plddt_A',
        'plddt_B',
        'used_for_superposition',
        'distance_after_superposition_angstrom',
      ],
      ...o.pairs.map((p) => [
        p.a,
        p.b,
        p.plddtA,
        p.plddtB,
        p.used ? 'yes' : 'no',
        Number(p.distance.toFixed(3)),
      ]),
    ],
    [
      `Aligned residue pairs of ${info.a} (A) and ${info.b} (B); B superimposed onto A`,
      `RMSD ${o.superposition.rmsd.toFixed(2)} Angstrom over ${o.used} of ${o.aligned} aligned positions (pLDDT >= ${o.threshold} in both models)`,
      `Exported by GeneExplorer ${info.appVersion}. Predicted structures; not an experimental measurement; not for clinical use.`,
    ],
  );
}
