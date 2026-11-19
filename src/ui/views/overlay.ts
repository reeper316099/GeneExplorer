// Structure overlay card: both AlphaFold models in one viewer (B superimposed onto A on confident aligned residues), the RMSD
// with the counts it rests on, an adjustable pLDDT threshold with a live count, and a per-residue distance plot.
import type { Alignment } from '../../bio/align';
import { transformPdb } from '../../bio/pdb';
import { buildOverlay, overlayCsv } from '../../core/overlay';
import type { OverlayResult } from '../../core/overlay';
import type { GeneView } from '../../core/gene-view';
import type { AppCtx, Scope } from '../ctx';
import { fmt, h, s, setChildren } from '../dom';
import { OVERLAY_COLOR_A, OVERLAY_COLOR_B, OverlayViewer } from '../viewer3d';

/** Distance plot along the alignment: one bar per aligned pair; used pairs are solid, left-out pairs are pale. */
export function distancePlotSvg(o: Extract<OverlayResult, { ok: true }>): SVGSVGElement {
  const W = 1000;
  const H = 150;
  const padL = 40;
  const inner = W - padL - 12;
  const cap = Math.max(5, Math.min(30, Math.max(...o.pairs.map((p) => p.distance))));
  const y = (d: number): number => 120 - (Math.min(d, cap) / cap) * 100;
  const svg = s('svg', {
    viewBox: `0 0 ${W} ${H}`,
    role: 'img',
    'aria-label': `Distance between paired C-alpha atoms after superposition, ${o.pairs.length} aligned positions, RMSD ${o.superposition.rmsd.toFixed(2)} angstrom`,
  });
  svg.append(
    s('rect', {
      x: padL,
      y: 20,
      width: inner,
      height: 100,
      fill: 'var(--surface-2)',
      stroke: 'var(--border)',
    }),
  );
  const bw = Math.max(1, inner / o.pairs.length);
  o.pairs.forEach((p, i) => {
    svg.append(
      s(
        'rect',
        {
          x: padL + (i / o.pairs.length) * inner,
          y: y(p.distance),
          width: Math.max(1, bw - 0.3),
          height: 120 - y(p.distance),
          fill: p.used ? 'var(--cat-1)' : 'var(--text-muted)',
          opacity: p.used ? 1 : 0.45,
        },
        s(
          'title',
          {},
          `A${p.a} / B${p.b}: ${p.distance.toFixed(2)} Å, pLDDT ${p.plddtA.toFixed(0)} / ${p.plddtB.toFixed(0)}, ${p.used ? 'used in the fit' : 'left out (low confidence)'}`,
        ),
      ),
    );
  });
  svg.append(
    s('line', {
      x1: padL,
      y1: y(o.superposition.rmsd),
      x2: padL + inner,
      y2: y(o.superposition.rmsd),
      stroke: 'var(--highlight)',
      'stroke-dasharray': '5 4',
      'stroke-width': 1.5,
    }),
    s(
      'text',
      {
        x: padL + inner,
        y: y(o.superposition.rmsd) - 4,
        'text-anchor': 'end',
        'font-size': 12,
        fill: 'var(--highlight)',
      },
      `RMSD ${o.superposition.rmsd.toFixed(2)} Å`,
    ),
    s(
      'text',
      { x: padL - 6, y: 28, 'text-anchor': 'end', 'font-size': 11, fill: 'var(--text-muted)' },
      `${cap.toFixed(0)} Å`,
    ),
    s('text', { x: padL - 6, y: 120, 'text-anchor': 'end', 'font-size': 11, fill: 'var(--text-muted)' }, '0'),
    s(
      'text',
      { x: padL, y: 140, 'font-size': 12, fill: 'var(--text-muted)' },
      'Aligned positions in order (solid = used in the fit, pale = left out because pLDDT was below the threshold in A or B; bars are capped at the top of the plot)',
    ),
  );
  return svg;
}

/** Builds the overlay card for two loaded genes and an alignment between their proteins. */
export function overlayCard(
  ctx: AppCtx,
  a: GeneView,
  b: GeneView,
  labelA: string,
  labelB: string,
  alignment: Alignment | null,
  scope: Scope,
): HTMLElement {
  const card = h('div', { class: 'card' }, h('h3', {}, 'Structure overlay'));
  const sa = a.structure;
  const sb = b.structure;
  if (sa.status !== 'ready' || sb.status !== 'ready') {
    card.append(
      h(
        'div',
        { class: 'notice info' },
        'The overlay needs an AlphaFold model for both proteins; it appears once both are loaded (or says why one is missing in the structure panel above).',
      ),
    );
    return card;
  }
  const dataA = sa.data;
  const dataB = sb.data;
  let threshold = 70;
  let viewer: OverlayViewer | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  scope.add(() => {
    clearTimeout(timer);
    viewer?.dispose();
  });
  const live = h('p', { 'aria-live': 'polite' });
  const slider = h('input', {
    type: 'range',
    min: 0,
    max: 100,
    step: 5,
    value: 70,
    'aria-label': 'pLDDT threshold',
    style: 'width:260px',
    oninput: (e: Event) => {
      threshold = Number((e.target as HTMLInputElement).value);
      clearTimeout(timer);
      timer = setTimeout(draw, 120);
    },
  });
  const body = h('div');
  card.append(
    h(
      'p',
      { class: 'muted' },
      'B is rotated and shifted onto A using only residues that the sequence alignment pairs up AND that both AlphaFold models place with pLDDT at or above the threshold (Horn/Kabsch method implemented in this app and checked against Biopython).',
    ),
    h('label', {}, 'pLDDT threshold: ', slider, ' ', h('strong', {}, h('span', { id: 'thr' }, '70'))),
    live,
    body,
  );

  /** Recomputes the overlay for the current threshold and redraws. */
  function draw(): void {
    const thrEl = card.querySelector('#thr');
    if (thrEl) thrEl.textContent = String(threshold);
    const o = buildOverlay(alignment, dataA.residues, dataB.residues, threshold);
    if (!o.ok) {
      viewer?.dispose();
      viewer = null;
      setChildren(live, `${fmt(o.used)} of ${fmt(o.aligned)} aligned positions meet the threshold.`);
      setChildren(
        body,
        h('div', { class: 'notice warn' }, h('strong', {}, 'No overlay made. '), o.message),
        o.identity !== null
          ? h('p', {}, `Sequence identity (aligned positions): ${(o.identity * 100).toFixed(1)}%.`)
          : null,
      );
      return;
    }
    setChildren(
      live,
      h('strong', {}, `RMSD ${o.superposition.rmsd.toFixed(2)} Å`),
      ` over ${fmt(o.used)} of ${fmt(o.aligned)} aligned positions (${((o.used / o.aligned) * 100).toFixed(0)}%), pLDDT ≥ ${o.threshold} in both models.`,
    );
    const moved = transformPdb(dataB.pdb, o.superposition.rotation, o.superposition.translation);
    const wrap = h('div', { class: 'viewer-wrap', style: 'height:420px' });
    const target = h('div', { class: 'v3d' });
    wrap.append(target);
    const legend = h(
      'p',
      { class: 'legend' },
      h('span', {}, h('i', { style: `background:${OVERLAY_COLOR_A}` }), `A (blue): ${labelA}`),
      h(
        'span',
        {},
        h('i', { style: `background:${OVERLAY_COLOR_B}` }),
        `B (orange, moved onto A): ${labelB}`,
      ),
    );
    const msg = h('div');
    setChildren(
      body,
      h('div', { class: 'notice warn' }, ...o.caveats.flatMap((c, i) => [i ? ' ' : '', c])),
      legend,
      wrap,
      msg,
      h(
        'div',
        { style: 'margin:8px 0;display:flex;gap:8px;flex-wrap:wrap' },
        h('button', { class: 'btn', type: 'button', onclick: () => viewer?.reset() }, 'Reset view'),
        h(
          'button',
          {
            class: 'btn',
            type: 'button',
            onclick: () => {
              const b64 = viewer?.png();
              if (!b64) return ctx.toast('The overlay is not ready to export yet.');
              void ctx.save('structure-overlay.png', b64, 'base64', { name: 'PNG image', ext: 'png' });
            },
          },
          'Save overlay PNG',
        ),
        h(
          'button',
          {
            class: 'btn',
            type: 'button',
            onclick: () =>
              void ctx.save(
                'aligned-positions.csv',
                overlayCsv(o, { a: labelA, b: labelB, appVersion: ctx.appVersion }),
                'utf8',
                { name: 'CSV', ext: 'csv' },
              ),
          },
          'Export aligned positions (CSV)',
        ),
      ),
      h('h4', {}, 'Distance per aligned position'),
      distancePlotSvg(o),
      h(
        'p',
        { class: 'muted' },
        `${fmt(o.withoutCoordinates)} aligned positions had no coordinates in one of the files and are not counted. Both structures are AlphaFold predictions; RMSD between predictions is a comparison of models, not of real molecules.`,
      ),
    );
    requestAnimationFrame(() => {
      viewer?.dispose();
      const v = new OverlayViewer(target);
      viewer = v;
      v.load(dataA.pdb, moved).catch((e: unknown) => {
        wrap.style.display = 'none';
        msg.append(
          h(
            'div',
            { class: 'notice error' },
            e instanceof Error ? e.message : 'The 3D view could not be started.',
          ),
        );
      });
    });
  }
  draw();
  return card;
}
