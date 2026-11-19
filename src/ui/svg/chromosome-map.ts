// Chromosome (or organelle/plasmid) map: a bar with a marker at the gene's position, only when the length is known.
import { fmt, s } from '../dom';

export interface MapInput {
  name: string;
  length: number;
  begin: number;
  end: number;
  moleculeType: string;
}

/** Draws the map; the caller shows "length not available" text instead when no length is known. */
export function chromosomeMapSvg(m: MapInput): SVGSVGElement {
  const W = 1000;
  const padL = 20;
  const barW = W - 40;
  const x = (pos: number): number => padL + (Math.min(Math.max(pos, 0), m.length) / m.length) * barW;
  const gx = x(m.begin);
  const gw = Math.max(4, x(m.end) - x(m.begin));
  const svg = s('svg', {
    viewBox: `0 0 ${W} 90`,
    role: 'img',
    'aria-label': `${m.moleculeType} ${m.name}, ${fmt(m.length)} bp; gene at ${fmt(m.begin)} to ${fmt(m.end)}`,
  });
  svg.append(
    s('rect', {
      x: padL,
      y: 36,
      width: barW,
      height: 20,
      rx: 10,
      fill: 'var(--surface-2)',
      stroke: 'var(--text-muted)',
    }),
  );
  svg.append(
    s(
      'rect',
      { x: gx - 1, y: 30, width: gw + 2, height: 32, rx: 2, fill: 'var(--highlight)' },
      s('title', {}, `Gene: ${fmt(m.begin)}-${fmt(m.end)}`),
    ),
  );
  svg.append(
    s(
      'text',
      { x: padL, y: 18, fill: 'var(--text)', 'font-size': 14 },
      `${m.moleculeType} ${m.name} (${fmt(m.length)} bp)`,
    ),
  );
  svg.append(s('text', { x: padL, y: 80, fill: 'var(--text-muted)', 'font-size': 12 }, '1'));
  svg.append(
    s(
      'text',
      { x: padL + barW, y: 80, fill: 'var(--text-muted)', 'font-size': 12, 'text-anchor': 'end' },
      fmt(m.length),
    ),
  );
  svg.append(
    s(
      'text',
      {
        x: Math.min(Math.max(gx, 80), W - 120),
        y: 80,
        fill: 'var(--highlight)',
        'font-size': 12,
        'text-anchor': 'middle',
        'font-weight': 700,
      },
      'gene',
    ),
  );
  return svg;
}
