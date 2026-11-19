// Side-by-side comparison model for two genes/proteins. It aligns the canonical sequences, maps annotated features
// through the alignment, optionally superposes the AlphaFold models, and collects honest caveats. It never claims
// orthology: that is reported only if a loaded ortholog call links the two records, and is labelled as inferred.
import { alignGlobal } from '../bio/align';
import type { AlignResult } from '../bio/align';
import { plddtBand } from '../bio/pdb';
import { superpose } from '../bio/superpose';
import type { Superposition, Vec3 } from '../bio/superpose';
import type { OrthologCall, ProteinFeature, ProteinRecord, Residue, StructureRecord } from '../shared/domain';

export interface CompareSide {
  protein: ProteinRecord;
  structure?: StructureRecord;
  /** C-alpha residues parsed from the AlphaFold PDB (pLDDT in bfactor). */
  residues?: readonly Residue[];
}

export interface MappedFeature {
  feature: ProteinFeature;
  /** Matching range in the other sequence, 1-based inclusive; null when no residue of the feature is aligned. */
  mapped: { start: number; end: number } | null;
  /** Fraction of the feature's residues that sit in aligned (non-gap) columns. */
  coverage: number;
}

export type StructureComparison =
  | {
      ok: true;
      superposition: Superposition;
      /** Aligned residue pairs that met the pLDDT cut-off and were used. */
      pairsUsed: number;
      pairsAligned: number;
      plddtCutoff: number;
    }
  | { ok: false; reason: string };

export type OrthologyStatement =
  { kind: 'reported'; calls: OrthologCall[]; text: string } | { kind: 'not_reported'; text: string };

export interface CompareModel {
  alignment: AlignResult;
  sameSpecies: boolean;
  orthology: OrthologyStatement;
  featuresOfA: MappedFeature[];
  featuresOfB: MappedFeature[];
  structure: StructureComparison;
  /** Plain-language cautions the UI must show next to the numbers. */
  warnings: string[];
}

export interface CompareOptions {
  /** Ortholog calls already loaded for either side (from NCBI or OrthoDB). */
  orthologCalls?: readonly OrthologCall[];
  /** Only residues with at least this pLDDT are used for superposition. Default 70. */
  plddtCutoff?: number;
  /** A finished alignment (for example from the worker); when absent the alignment is computed here. */
  alignment?: AlignResult;
}

/** Maps a feature range through aligned pairs (0-based residue indices) onto the other sequence. */
export function mapFeature(
  feature: ProteinFeature,
  pairs: readonly (readonly [number, number])[],
  from: 0 | 1,
): MappedFeature {
  const to = from === 0 ? 1 : 0;
  const hits = pairs.filter((p) => {
    const pos = (p[from] ?? 0) + 1;
    return pos >= feature.start && pos <= feature.end;
  });
  const length = feature.end - feature.start + 1;
  if (hits.length === 0) return { feature, mapped: null, coverage: 0 };
  const targets = hits.map((p) => (p[to] ?? 0) + 1);
  return {
    feature,
    mapped: { start: Math.min(...targets), end: Math.max(...targets) },
    coverage: hits.length / length,
  };
}

/** Builds the full comparison of two proteins. Pure: all inputs are already-loaded records. */
export function buildComparison(a: CompareSide, b: CompareSide, options: CompareOptions = {}): CompareModel {
  const cutoff = options.plddtCutoff ?? 70;
  const pa = a.protein.value;
  const pb = b.protein.value;
  const alignment = options.alignment ?? alignGlobal(pa.sequence, pb.sequence);
  const sameSpecies = pa.taxon.id === pb.taxon.id;
  const warnings: string[] = [];

  const reported = (options.orthologCalls ?? []).filter(
    (c) => c.value.uniprotAccession === pa.accession || c.value.uniprotAccession === pb.accession,
  );
  const orthology: OrthologyStatement =
    reported.length > 0
      ? {
          kind: 'reported',
          calls: reported,
          text: `${[...new Set(reported.map((c) => c.source))].join(' and ')} lists these as orthologs. Orthology is inferred from sequence similarity, not directly observed.`,
        }
      : {
          kind: 'not_reported',
          text: 'No ortholog call linking these two proteins was found in the loaded data. This page compares two sequences; it does not show they share an ancestor.',
        };

  if (!sameSpecies && orthology.kind === 'not_reported') {
    warnings.push('The two proteins come from different species and no loaded source calls them orthologs.');
  }
  for (const s of [a, b]) {
    const p = s.protein.value;
    if (!p.reviewed)
      warnings.push(
        `${p.accession} is unreviewed (UniProt TrEMBL): its annotation is automatic, not curated.`,
      );
    if (s.structure && s.structure.value.meanPlddt < 70) {
      warnings.push(
        `The AlphaFold model for ${p.accession} has low overall confidence (mean pLDDT ${s.structure.value.meanPlddt.toFixed(1)}).`,
      );
    }
    if (s.structure && s.structure.value.sequence !== p.sequence) {
      warnings.push(
        `The AlphaFold model for ${p.accession} was built from a different sequence than the current UniProt entry.`,
      );
    }
  }
  if (!alignment.ok) warnings.push(alignment.message);
  else if (
    alignment.alignment.identity.overAligned !== null &&
    alignment.alignment.identity.overAligned < 0.3
  ) {
    warnings.push(
      'Identity is below 30%: in this range sequence similarity alone cannot show that two proteins are related.',
    );
  }

  const pairs = alignment.ok ? alignment.alignment.pairs : [];
  const featuresOfA = pa.features.map((f) => mapFeature(f, pairs, 0));
  const featuresOfB = pb.features.map((f) => mapFeature(f, pairs, 1));

  let structure: StructureComparison = {
    ok: false,
    reason: 'No AlphaFold model loaded for one or both proteins.',
  };
  if (!alignment.ok)
    structure = { ok: false, reason: 'The sequences could not be aligned, so residues cannot be paired.' };
  else if (a.residues && b.residues) {
    const byNumA = new Map(a.residues.map((r) => [r.number, r]));
    const byNumB = new Map(b.residues.map((r) => [r.number, r]));
    const usedA: Vec3[] = [];
    const usedB: Vec3[] = [];
    for (const [i, j] of alignment.alignment.pairs) {
      const ra = byNumA.get(i + 1);
      const rb = byNumB.get(j + 1);
      if (ra && rb && ra.bfactor >= cutoff && rb.bfactor >= cutoff) {
        usedA.push(ra.ca);
        usedB.push(rb.ca);
      }
    }
    const sp = superpose(usedA, usedB);
    structure = sp.ok
      ? {
          ok: true,
          superposition: sp.value,
          pairsUsed: usedA.length,
          pairsAligned: pairs.length,
          plddtCutoff: cutoff,
        }
      : {
          ok: false,
          reason: `Not enough confident aligned residues to superpose (pLDDT >= ${cutoff}): ${sp.message}`,
        };
  }
  return { alignment, sameSpecies, orthology, featuresOfA, featuresOfB, structure, warnings };
}

/** Text for the standing AlphaFold caveat, with the model's own confidence band. */
export function structureNote(meanPlddt: number): string {
  const band = plddtBand(meanPlddt);
  const label = {
    very_high: 'very high confidence',
    confident: 'confident',
    low: 'low confidence',
    very_low: 'very low confidence',
  }[band];
  return `Computed prediction (AlphaFold), mean pLDDT ${meanPlddt.toFixed(1)} (${label}). Not an experimental structure and not for clinical use.`;
}
