// Field-by-field comparison table for two genes, GO overlap, and alignment views. Pure functions on loaded records.
import { blosumScore } from '../bio/align';
import type { GeneRecord, ProteinRecord, StructureRecord, Transcript } from '../shared/domain';
import type { Sourced } from '../shared/types';
import { toCsv } from './csv';

export type FieldStatus = 'same' | 'different' | 'missing_a' | 'missing_b' | 'not_comparable';

export interface CompareSubject {
  gene: GeneRecord | null;
  protein: ProteinRecord | null;
  transcript: Transcript | null;
  structure: StructureRecord | null;
}

export interface FieldRow {
  field: string;
  a: string | null;
  b: string | null;
  status: FieldStatus;
  /** Where each side's value came from (for the provenance hover). */
  provA: Pick<Sourced<unknown>, 'source' | 'recordId' | 'fetchedAt'> | null;
  provB: Pick<Sourced<unknown>, 'source' | 'recordId' | 'fetchedAt'> | null;
  note?: string;
}

/** Classifies a pair of optional display values. Both missing means the field cannot be compared. */
export function classify(
  a: string | null,
  b: string | null,
  same: (x: string, y: string) => boolean = (x, y) => x === y,
): FieldStatus {
  if (a === null && b === null) return 'not_comparable';
  if (a === null) return 'missing_a';
  if (b === null) return 'missing_b';
  return same(a, b) ? 'same' : 'different';
}

const ci = (x: string, y: string): boolean => x.toLowerCase() === y.toLowerCase();

/** Builds the comparison table rows for two subjects. */
export function compareFields(a: CompareSubject, b: CompareSubject): FieldRow[] {
  const rows: FieldRow[] = [];
  const add = (
    field: string,
    va: string | null,
    vb: string | null,
    provA: FieldRow['provA'],
    provB: FieldRow['provB'],
    opts: { same?: (x: string, y: string) => boolean; note?: string; force?: FieldStatus } = {},
  ): void => {
    rows.push({
      field,
      a: va,
      b: vb,
      status: opts.force ?? classify(va, vb, opts.same),
      provA: va === null ? null : provA,
      provB: vb === null ? null : provB,
      ...(opts.note ? { note: opts.note } : {}),
    });
  };
  const sym = (s: CompareSubject): string | null =>
    s.gene?.value.symbol ?? s.protein?.value.geneNames.primary ?? null;
  add('Gene symbol', sym(a), sym(b), a.gene ?? a.protein, b.gene ?? b.protein, {
    same: ci,
    note: 'Symbols follow different naming conventions in different species; a match or mismatch here says nothing about identity.',
  });
  add('Gene name', a.gene?.value.description || null, b.gene?.value.description || null, a.gene, b.gene, {
    same: ci,
  });
  add('Gene type', a.gene?.value.type ?? null, b.gene?.value.type ?? null, a.gene, b.gene);
  const chr = (s: CompareSubject): string | null =>
    s.gene && s.gene.value.chromosomes.length ? s.gene.value.chromosomes.join(', ') : null;
  add('Chromosome / sequence', chr(a), chr(b), a.gene, b.gene);
  const strand = (s: CompareSubject): string | null => s.gene?.value.locations[0]?.strand ?? null;
  add('Strand', strand(a), strand(b), a.gene, b.gene);
  const protOnlyMix =
    !!a.transcript && !!b.transcript && a.transcript.proteinOnly !== b.transcript.proteinOnly;
  const exons = (s: CompareSubject): string | null =>
    s.transcript && s.transcript.exons.length ? String(s.transcript.exons.length) : null;
  add('Exon count (displayed transcript)', exons(a), exons(b), a.gene, b.gene, {
    note: 'Each side uses its own default transcript; isoform choice changes this number.',
    ...(protOnlyMix ? { force: 'not_comparable' as const } : {}),
  });
  const tlen = (s: CompareSubject): string | null =>
    s.transcript?.length !== undefined ? String(s.transcript.length) : null;
  add(
    'Transcript length (nt)',
    tlen(a),
    tlen(b),
    a.gene,
    b.gene,
    protOnlyMix ? { force: 'not_comparable' } : {},
  );
  const plen = (s: CompareSubject): string | null =>
    s.protein ? String(s.protein.value.sequenceLength) : null;
  add('Protein length (aa)', plen(a), plen(b), a.protein, b.protein);
  const rev = (s: CompareSubject): string | null =>
    s.protein ? (s.protein.value.reviewed ? 'reviewed (curated)' : 'unreviewed (automatic)') : null;
  add('Review status (UniProt)', rev(a), rev(b), a.protein, b.protein);
  const doms = (s: CompareSubject): string | null =>
    s.protein ? String(s.protein.value.features.filter((f) => f.type === 'Domain').length) : null;
  add('Number of domains (UniProt)', doms(a), doms(b), a.protein, b.protein);
  const loc = (s: CompareSubject): string | null =>
    s.protein && s.protein.value.subcellularLocations.length
      ? [...s.protein.value.subcellularLocations].sort().join('; ')
      : null;
  add('Subcellular location (UniProt)', loc(a), loc(b), a.protein, b.protein);
  const pl = (s: CompareSubject): string | null =>
    s.structure ? s.structure.value.meanPlddt.toFixed(1) : null;
  add('Mean pLDDT (AlphaFold)', pl(a), pl(b), a.structure, b.structure, {
    same: (x, y) => x === y,
    note: 'A prediction-confidence score, not a measurement.',
  });
  return rows;
}

export const STATUS_LABEL: Record<FieldStatus, { icon: string; text: string }> = {
  same: { icon: '=', text: 'same' },
  different: { icon: '≠', text: 'different' },
  missing_a: { icon: '∅A', text: 'missing in A' },
  missing_b: { icon: '∅B', text: 'missing in B' },
  not_comparable: { icon: '–', text: 'not comparable' },
};

/** GO overlap between two proteins: shared, A-only and B-only terms plus the Jaccard index (null when both are empty). */
export function compareGo(
  a: ProteinRecord | null,
  b: ProteinRecord | null,
): {
  shared: { goId: string; name: string }[];
  onlyA: { goId: string; name: string }[];
  onlyB: { goId: string; name: string }[];
  jaccard: number | null;
} {
  const ga = new Map((a?.value.go ?? []).map((g) => [g.goId, g.name]));
  const gb = new Map((b?.value.go ?? []).map((g) => [g.goId, g.name]));
  const shared = [...ga].filter(([k]) => gb.has(k)).map(([goId, name]) => ({ goId, name }));
  const onlyA = [...ga].filter(([k]) => !gb.has(k)).map(([goId, name]) => ({ goId, name }));
  const onlyB = [...gb].filter(([k]) => !ga.has(k)).map(([goId, name]) => ({ goId, name }));
  const union = shared.length + onlyA.length + onlyB.length;
  return { shared, onlyA, onlyB, jaccard: union === 0 ? null : shared.length / union };
}

/** Comparison table as CSV with a provenance header. */
export function compareCsv(
  rows: readonly FieldRow[],
  info: { a: string; b: string; appVersion: string; fetchedAt: number },
): string {
  return toCsv(
    [
      ['field', `A: ${info.a}`, `B: ${info.b}`, 'status', 'source_A', 'source_B'],
      ...rows.map((r) => [
        r.field,
        r.a,
        r.b,
        STATUS_LABEL[r.status].text,
        r.provA ? `${r.provA.source} ${r.provA.recordId}` : '',
        r.provB ? `${r.provB.source} ${r.provB.recordId}` : '',
      ]),
    ],
    [
      `Comparison of ${info.a} (A) and ${info.b} (B)`,
      `Exported ${new Date(info.fetchedAt).toISOString()} by GeneExplorer ${info.appVersion}. Educational use only.`,
      'Differences may reflect real biology, annotation quality or isoform choice.',
    ],
  );
}

// ---------------------------------------------------------------- alignment views

/** For each residue of a gapped string, the alignment column it sits in (0-based). */
export function residueColumns(aligned: string): number[] {
  const out: number[] = [];
  for (let c = 0; c < aligned.length; c++) if (aligned.charAt(c) !== '-') out.push(c);
  return out;
}

/** Identity per window of columns (fraction of aligned non-gap columns that are identical; null if none are aligned). */
export function identityWindows(
  alignedA: string,
  alignedB: string,
  window = 30,
): { start: number; end: number; identity: number | null }[] {
  const out: { start: number; end: number; identity: number | null }[] = [];
  for (let s = 0; s < alignedA.length; s += window) {
    const e = Math.min(alignedA.length, s + window);
    let aligned = 0;
    let same = 0;
    for (let c = s; c < e; c++) {
      const x = alignedA.charAt(c);
      const y = alignedB.charAt(c);
      if (x === '-' || y === '-') continue;
      aligned++;
      if (x === y) same++;
    }
    out.push({ start: s, end: e, identity: aligned === 0 ? null : same / aligned });
  }
  return out;
}

export interface WrappedLine {
  /** 1-based residue number of the first residue on each line (null if the line holds only gaps for that sequence). */
  startA: number | null;
  startB: number | null;
  a: string;
  mid: string;
  b: string;
}

/** Wraps an alignment into blocks of three lines: sequence A, a match line (| identical, + similar, blank otherwise), sequence B. */
export function wrapAlignment(alignedA: string, alignedB: string, width = 60): WrappedLine[] {
  const lines: WrappedLine[] = [];
  let na = 0;
  let nb = 0;
  for (let s = 0; s < alignedA.length; s += width) {
    const a = alignedA.slice(s, s + width);
    const b = alignedB.slice(s, s + width);
    let mid = '';
    for (let i = 0; i < a.length; i++) {
      const x = a.charAt(i);
      const y = b.charAt(i);
      mid += x === '-' || y === '-' ? ' ' : x === y ? '|' : blosumScore(x, y) > 0 ? '+' : ' ';
    }
    const ca = a.replace(/-/g, '').length;
    const cb = b.replace(/-/g, '').length;
    lines.push({ startA: ca ? na + 1 : null, startB: cb ? nb + 1 : null, a, mid, b });
    na += ca;
    nb += cb;
  }
  return lines;
}

/** Aligned sequences as FASTA (gaps kept as '-'), with a header naming the records. */
export function alignmentFasta(
  a: { header: string; aligned: string },
  b: { header: string; aligned: string },
): string {
  const wrap = (s: string): string => (s.match(/.{1,60}/g) ?? []).join('\n');
  return `>${a.header}\n${wrap(a.aligned)}\n>${b.header}\n${wrap(b.aligned)}\n`;
}
