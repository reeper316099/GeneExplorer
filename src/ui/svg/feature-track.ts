// Protein feature track: UniProt features drawn along the sequence (one lane per overlap), with an axis and an
// optional pLDDT confidence strip underneath. Every feature is keyboard-focusable and carries a text label.
import { plddtBand } from '../../bio/pdb';
import type { ProteinFeature } from '../../shared/domain';
import { fmt, s } from '../dom';
import { packRows } from './scale';

/** Display style per UniProt feature type: colour variable and a pattern so colour is never the only signal. */
export const FEATURE_STYLES: Record<
  string,
  { label: string; color: string; pattern: 'solid' | 'stripe' | 'dots' | 'cross' }
> = {
  Domain: { label: 'Domain', color: 'var(--cat-1)', pattern: 'solid' },
  Region: { label: 'Region', color: 'var(--cat-2)', pattern: 'stripe' },
  Repeat: { label: 'Repeat', color: 'var(--cat-3)', pattern: 'dots' },
  Transmembrane: { label: 'Transmembrane', color: 'var(--cat-6)', pattern: 'solid' },
  'Signal peptide': { label: 'Signal peptide', color: 'var(--cat-4)', pattern: 'solid' },
  'Zinc finger': { label: 'Zinc finger', color: 'var(--cat-5)', pattern: 'cross' },
  Motif: { label: 'Motif', color: 'var(--cat-7)', pattern: 'solid' },
  'Coiled coil': { label: 'Coiled coil', color: 'var(--cat-8)', pattern: 'stripe' },
  'Topological domain': { label: 'Topological domain', color: 'var(--cat-5)', pattern: 'stripe' },
  'DNA binding': { label: 'DNA binding', color: 'var(--cat-3)', pattern: 'cross' },
  Propeptide: { label: 'Propeptide', color: 'var(--cat-8)', pattern: 'dots' },
  'Transit peptide': { label: 'Transit peptide', color: 'var(--cat-4)', pattern: 'dots' },
};
const FALLBACK = { label: 'Other', color: 'var(--cat-8)', pattern: 'solid' as const };

export interface SelectedRange {
  start: number;
  end: number;
  label: string;
}

export interface TrackOptions {
  length: number;
  features: readonly ProteinFeature[];
  /** pLDDT per residue in order (index 0 = first residue of the model), or null when no model is loaded. */
  plddt: readonly number[] | null;
  /** Residue number of the first value in `plddt` (fragments of large proteins do not start at 1). */
  plddtStart?: number;
  onSelect: (range: SelectedRange) => void;
}

export interface FeatureTrack {
  el: SVGSVGElement;
  /** Highlights a range (or clears it with null). */
  setSelection: (range: SelectedRange | null) => void;
  /** Distinct feature types present, for the legend. */
  typesPresent: string[];
}

const PLDDT_VAR = {
  very_high: 'var(--plddt-very-high)',
  confident: 'var(--plddt-confident)',
  low: 'var(--plddt-low)',
  very_low: 'var(--plddt-very-low)',
} as const;

/** Builds the feature track SVG. */
export function featureTrack(o: TrackOptions): FeatureTrack {
  const W = 1000;
  const padL = 24;
  const padR = 24;
  const inner = W - padL - padR;
  const x = (res: number): number => padL + ((res - 1) / Math.max(1, o.length)) * inner;
  const feats = o.features.filter((f) => f.end >= 1 && f.start <= o.length);
  const rows = packRows(feats);
  const laneCount = (rows.length ? Math.max(...rows) : -1) + 1;
  const laneH = 24;
  const top = 26;
  const axisY = top + Math.max(1, laneCount) * laneH + 8;
  const stripY = axisY + 26;
  const H = stripY + (o.plddt ? 34 : 6) + 6;
  const svg = s('svg', {
    viewBox: `0 0 ${W} ${H}`,
    role: 'group',
    'aria-label': `Protein feature track, ${o.length} residues, ${feats.length} features`,
  });

  // Patterns (stripe, dots, cross) so feature types differ by texture as well as colour.
  const defs = s('defs');
  const mk = (id: string, draw: SVGElement[]): void => {
    defs.append(s('pattern', { id, width: 6, height: 6, patternUnits: 'userSpaceOnUse' }, ...draw));
  };
  mk('pat-stripe', [s('path', { d: 'M0,6 L6,0', stroke: 'rgba(0,0,0,0.55)', 'stroke-width': 1.4 })]);
  mk('pat-dots', [s('circle', { cx: 3, cy: 3, r: 1.2, fill: 'rgba(0,0,0,0.6)' })]);
  mk('pat-cross', [s('path', { d: 'M0,0 L6,6 M6,0 L0,6', stroke: 'rgba(0,0,0,0.5)', 'stroke-width': 1 })]);
  svg.append(defs);

  const selH = axisY - top + 10;
  const selRect = s('rect', {
    y: top - 6,
    height: selH,
    fill: 'var(--highlight)',
    opacity: 0.18,
    'pointer-events': 'none',
    visibility: 'hidden',
  });
  const selEdge = s('rect', {
    y: top - 6,
    height: selH,
    fill: 'none',
    stroke: 'var(--highlight)',
    'stroke-width': 2,
    'pointer-events': 'none',
    visibility: 'hidden',
  });
  svg.append(selRect, selEdge);

  const present = new Set<string>();
  feats.forEach((f, i) => {
    const st = FEATURE_STYLES[f.type] ?? FALLBACK;
    present.add(FEATURE_STYLES[f.type] ? f.type : 'Other');
    const x1 = x(Math.max(1, f.start));
    const w = Math.max(3, x(Math.min(o.length, f.end) + 1) - x1);
    const y = top + (rows[i] ?? 0) * laneH;
    const label = `${st.label}${f.description ? `: ${f.description}` : ''} (${f.start}-${f.end})`;
    const activate = (): void => o.onSelect({ start: f.start, end: f.end, label });
    const g = s(
      'g',
      { tabindex: 0, role: 'button', 'aria-label': label, style: 'cursor:pointer' },
      s('title', {}, label),
    );
    g.append(
      s('rect', {
        x: x1,
        y,
        width: w,
        height: 18,
        rx: 3,
        fill: st.color,
        stroke: 'var(--text)',
        'stroke-width': 0.7,
      }),
    );
    if (st.pattern !== 'solid')
      g.append(s('rect', { x: x1, y, width: w, height: 18, rx: 3, fill: `url(#pat-${st.pattern})` }));
    if (w > 46) {
      const text = f.description || st.label;
      const fits = text.length * 6 <= w - 8;
      g.append(
        s(
          'text',
          {
            x: x1 + 4,
            y: y + 13,
            'font-size': 11,
            fill: '#000',
            'paint-order': 'stroke',
            stroke: 'rgba(255,255,255,0.85)',
            'stroke-width': 2.5,
          },
          fits ? text : `${text.slice(0, Math.max(1, Math.floor((w - 8) / 6) - 1))}…`,
        ),
      );
    }
    g.addEventListener('click', activate);
    g.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        activate();
      }
    });
    svg.append(g);
  });

  // Axis with ticks.
  svg.append(s('line', { x1: padL, y1: axisY, x2: padL + inner, y2: axisY, stroke: 'var(--text-muted)' }));
  const step =
    [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000].find((n) => o.length / n <= 10) ?? 10000;
  for (let r = step; r <= o.length; r += step) {
    svg.append(s('line', { x1: x(r), y1: axisY, x2: x(r), y2: axisY + 4, stroke: 'var(--text-muted)' }));
    svg.append(
      s(
        'text',
        { x: x(r), y: axisY + 16, 'font-size': 11, fill: 'var(--text-muted)', 'text-anchor': 'middle' },
        fmt(r),
      ),
    );
  }

  // pLDDT strip: residues binned so very long proteins stay light; each bin shows its mean value.
  if (o.plddt) {
    const bins = Math.min(o.plddt.length, 400);
    const per = o.plddt.length / bins;
    const start = o.plddtStart ?? 1;
    for (let b = 0; b < bins; b++) {
      const from = Math.floor(b * per);
      const to = Math.max(from + 1, Math.floor((b + 1) * per));
      const vals = o.plddt.slice(from, to);
      const mean = vals.reduce((a, c) => a + c, 0) / vals.length;
      const r1 = start + from;
      svg.append(
        s(
          'rect',
          {
            x: x(r1),
            y: stripY,
            width: Math.max(1, x(start + to) - x(r1) + 0.4),
            height: 16,
            fill: PLDDT_VAR[plddtBand(mean)],
          },
          s('title', {}, `Residues ${r1}-${start + to - 1}: mean pLDDT ${mean.toFixed(1)}`),
        ),
      );
    }
    svg.append(
      s(
        'text',
        { x: padL, y: stripY + 30, 'font-size': 11, fill: 'var(--text-muted)' },
        'pLDDT confidence (AlphaFold model)',
      ),
    );
  }

  const setSelection = (range: SelectedRange | null): void => {
    if (!range) {
      selRect.setAttribute('visibility', 'hidden');
      selEdge.setAttribute('visibility', 'hidden');
      return;
    }
    const x1 = x(range.start);
    const w = Math.max(2, x(range.end + 1) - x1);
    for (const r of [selRect, selEdge]) {
      r.setAttribute('x', String(x1));
      r.setAttribute('width', String(w));
      r.setAttribute('visibility', 'visible');
    }
  };
  return { el: svg, setSelection, typesPresent: [...present] };
}
