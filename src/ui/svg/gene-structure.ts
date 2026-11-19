// Gene-structure diagram: exons as boxes on a genomic axis, introns as lines with strand arrows, plus a scale bar.
import type { Transcript } from '../../shared/domain';
import { fmt, s } from '../dom';
import { fmtBp, niceLength } from './scale';

export interface StructureStats {
  exonCount: number;
  /** Sum of exon lengths (1-based inclusive), i.e. the spliced length from the exon coordinates. */
  splicedLength: number;
  /** Genomic span from the first to the last base of the transcript. */
  span: number;
}

/** Computes the numbers shown under the diagram (exon count, spliced length, genomic span). */
export function structureStats(t: Transcript): StructureStats | null {
  if (t.exons.length === 0) return null;
  const begin = Math.min(...t.exons.map((e) => e.begin));
  const end = Math.max(...t.exons.map((e) => e.end));
  return {
    exonCount: t.exons.length,
    splicedLength: t.exons.reduce((sum, e) => sum + (e.end - e.begin + 1), 0),
    span: end - begin + 1,
  };
}

/** Draws the transcript's exon/intron structure (genomic coordinates increase left to right; arrows show the gene's strand). */
export function geneStructureSvg(t: Transcript): SVGSVGElement | null {
  const stats = structureStats(t);
  if (!stats) return null;
  const W = 1000;
  const padL = 20;
  const padR = 20;
  const H = 120;
  const begin = Math.min(...t.exons.map((e) => e.begin));
  const end = Math.max(...t.exons.map((e) => e.end));
  const scale = (W - padL - padR) / Math.max(1, end - begin + 1);
  const x = (pos: number): number => padL + (pos - begin) * scale;
  const mid = 46;
  const svg = s('svg', {
    viewBox: `0 0 ${W} ${H}`,
    role: 'img',
    'aria-label': `Gene structure of ${t.accession}: ${stats.exonCount} exons on the ${t.strand} strand`,
  });
  svg.append(s('title', {}, `Exon/intron structure of ${t.accession}`));
  const sorted = [...t.exons].sort((a, b) => a.begin - b.begin);
  // Introns: a line between consecutive exons with a chevron pointing in the strand direction.
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (!a || !b) continue;
    const x1 = x(a.end);
    const x2 = x(b.begin);
    svg.append(s('line', { x1, y1: mid, x2, y2: mid, stroke: 'var(--text-muted)', 'stroke-width': 1.5 }));
    if (x2 - x1 > 14) {
      const cx = (x1 + x2) / 2;
      const d = t.strand === 'plus' ? 1 : -1;
      svg.append(
        s('polyline', {
          points: `${cx - 3 * d},${mid - 5} ${cx + 3 * d},${mid} ${cx - 3 * d},${mid + 5}`,
          fill: 'none',
          stroke: 'var(--text-muted)',
          'stroke-width': 1.5,
        }),
      );
    }
  }
  for (const e of sorted) {
    const w = Math.max(2, (e.end - e.begin + 1) * scale);
    svg.append(
      s(
        'rect',
        {
          x: x(e.begin),
          y: mid - 14,
          width: w,
          height: 28,
          rx: 2,
          fill: 'var(--cat-1)',
          stroke: 'var(--text)',
          'stroke-width': 0.6,
        },
        s('title', {}, `Exon ${e.order}: ${fmt(e.begin)}-${fmt(e.end)} (${fmt(e.end - e.begin + 1)} bp)`),
      ),
    );
  }
  // Direction label so the arrows are not the only signal.
  svg.append(
    s(
      'text',
      { x: padL, y: 14, fill: 'var(--text-muted)', 'font-size': 13 },
      `${t.strand === 'plus' ? '5′ → 3′ (plus strand, left to right)' : '3′ ← 5′ (minus strand, right to left)'}`,
    ),
  );
  // Scale bar.
  const bar = niceLength((end - begin + 1) / 4);
  const by = 100;
  svg.append(
    s('line', { x1: padL, y1: by, x2: padL + bar * scale, y2: by, stroke: 'var(--text)', 'stroke-width': 2 }),
  );
  svg.append(
    s('text', { x: padL + bar * scale + 8, y: by + 4, fill: 'var(--text)', 'font-size': 13 }, fmtBp(bar)),
  );
  return svg;
}
