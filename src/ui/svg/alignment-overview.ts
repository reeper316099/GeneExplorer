// Alignment overview: protein A's features on top, a windowed identity plot in the middle, protein B's features below,
// all on one shared alignment-column axis, with domain boundaries drawn through all three.
import { identityWindows, residueColumns } from '../../core/compare-table';
import type { ProteinFeature } from '../../shared/domain';
import { s } from '../dom';
import { FEATURE_STYLES } from './feature-track';
import { packRows } from './scale';

export interface OverviewInput {
  alignedA: string;
  alignedB: string;
  featuresA: readonly ProteinFeature[];
  featuresB: readonly ProteinFeature[];
  labelA: string;
  labelB: string;
  window?: number;
}

/** Draws the alignment overview as an SVG. */
export function alignmentOverviewSvg(o: OverviewInput): SVGSVGElement {
  const W = 1000;
  const padL = 24;
  const inner = W - 48;
  const cols = Math.max(1, o.alignedA.length);
  const x = (c: number): number => padL + (c / cols) * inner;
  const colsA = residueColumns(o.alignedA);
  const colsB = residueColumns(o.alignedB);
  const place = (f: ProteinFeature, map: number[]): { start: number; end: number } | null => {
    const a = map[f.start - 1];
    const b = map[f.end - 1];
    return a === undefined || b === undefined ? null : { start: a, end: b };
  };
  const laneH = 22;
  const lanes = (
    feats: readonly ProteinFeature[],
    map: number[],
  ): { f: ProteinFeature; start: number; end: number; row: number }[] => {
    const placed = feats.flatMap((f) => {
      const p = place(f, map);
      return p ? [{ f, ...p }] : [];
    });
    const rows = packRows(placed);
    return placed.map((p, i) => ({ ...p, row: rows[i] ?? 0 }));
  };
  const la = lanes(o.featuresA, colsA);
  const lb = lanes(o.featuresB, colsB);
  const rowsA = (la.length ? Math.max(...la.map((l) => l.row)) : 0) + 1;
  const rowsB = (lb.length ? Math.max(...lb.map((l) => l.row)) : 0) + 1;
  const topY = 22;
  const plotY = topY + rowsA * laneH + 22;
  const plotH = 70;
  const botY = plotY + plotH + 22;
  const H = botY + rowsB * laneH + 22;
  const svg = s('svg', {
    viewBox: `0 0 ${W} ${H}`,
    role: 'img',
    'aria-label': `Alignment overview of ${o.labelA} and ${o.labelB}: features, windowed identity`,
  });

  svg.append(
    s('text', { x: padL, y: 14, 'font-size': 13, fill: 'var(--text)', 'font-weight': 700 }, `A: ${o.labelA}`),
  );
  const drawLane = (items: typeof la, y0: number): void => {
    for (const it of items) {
      const st = FEATURE_STYLES[it.f.type];
      const w = Math.max(2, x(it.end + 1) - x(it.start));
      const label = `${st?.label ?? it.f.type}${it.f.description ? `: ${it.f.description}` : ''} (${it.f.start}-${it.f.end})`;
      svg.append(
        s(
          'rect',
          {
            x: x(it.start),
            y: y0 + it.row * laneH,
            width: w,
            height: 16,
            rx: 3,
            fill: st?.color ?? 'var(--cat-8)',
            stroke: 'var(--text)',
            'stroke-width': 0.6,
          },
          s('title', {}, label),
        ),
      );
      if (w > 50)
        svg.append(
          s(
            'text',
            {
              x: x(it.start) + 3,
              y: y0 + it.row * laneH + 12,
              'font-size': 10,
              fill: '#000',
              'paint-order': 'stroke',
              stroke: 'rgba(255,255,255,0.85)',
              'stroke-width': 2.2,
            },
            (it.f.description || st?.label || it.f.type).slice(0, Math.floor(w / 6)),
          ),
        );
    }
  };
  drawLane(la, topY);
  // Domain boundaries through the identity plot, so a drop in identity can be read against the domain layout.
  for (const it of [...la, ...lb].filter((i) => i.f.type === 'Domain')) {
    for (const c of [it.start, it.end + 1])
      svg.append(
        s('line', {
          x1: x(c),
          y1: topY,
          x2: x(c),
          y2: botY + rowsB * laneH,
          stroke: 'var(--text-muted)',
          'stroke-dasharray': '3 4',
          'stroke-width': 0.8,
        }),
      );
  }
  // Identity plot.
  svg.append(
    s('rect', {
      x: padL,
      y: plotY,
      width: inner,
      height: plotH,
      fill: 'var(--surface-2)',
      stroke: 'var(--border)',
    }),
    s(
      'text',
      { x: padL, y: plotY - 6, 'font-size': 12, fill: 'var(--text-muted)' },
      'Identity per window of aligned columns (100% at the top; gaps and unaligned windows leave a gap)',
    ),
  );
  for (const w of identityWindows(o.alignedA, o.alignedB, o.window ?? 30)) {
    if (w.identity === null) continue;
    const bh = Math.max(1, w.identity * plotH);
    svg.append(
      s(
        'rect',
        {
          x: x(w.start),
          y: plotY + plotH - bh,
          width: Math.max(1, x(w.end) - x(w.start) - 0.5),
          height: bh,
          fill: 'var(--cat-1)',
        },
        s('title', {}, `Columns ${w.start + 1}-${w.end}: ${(w.identity * 100).toFixed(0)}% identical`),
      ),
    );
  }
  svg.append(
    s(
      'text',
      { x: padL, y: botY - 6, 'font-size': 13, fill: 'var(--text)', 'font-weight': 700 },
      `B: ${o.labelB}`,
    ),
  );
  drawLane(lb, botY);
  svg.append(
    s(
      'text',
      { x: padL + inner, y: H - 4, 'text-anchor': 'end', 'font-size': 11, fill: 'var(--text-muted)' },
      `${cols} alignment columns`,
    ),
  );
  return svg;
}
