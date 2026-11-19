// Protein & Structure tab: protein card, GO terms, feature track, 3D structure, and the sequence panel. The feature
// track, the 3D view and the sequence panel share one selection (click a feature, a residue or drag in the sequence).
import { plddtBand } from '../../bio/pdb';
import { structureNote } from '../../core/compare';
import { selectCanonicalIsoform } from '../../core/isoforms';
import type { GeneView } from '../../core/gene-view';
import type { GoAnnotation } from '../../shared/domain';
import { fmt, fmtTime, h, setChildren } from '../dom';
import { na, provTitle, withSource } from '../ctx';
import type { AppCtx, Scope } from '../ctx';
import { proteinHeader, toFasta } from '../exports';
import { FEATURE_STYLES, featureTrack } from '../svg/feature-track';
import type { FeatureTrack, SelectedRange } from '../svg/feature-track';
import { StructureViewer } from '../viewer3d';
import { renderLoadable } from './panel';

const ASPECTS: { key: GoAnnotation['aspect']; label: string }[] = [
  { key: 'molecular_function', label: 'Molecular function' },
  { key: 'biological_process', label: 'Biological process' },
  { key: 'cellular_component', label: 'Cellular component' },
];

/** Builds the Protein & Structure tab. */
export function proteinTab(ctx: AppCtx, view: GeneView, scope: Scope): HTMLElement {
  const root = h('div');
  const p = view.protein;
  if (!p) {
    root.append(
      h(
        'div',
        { class: 'notice info' },
        'No UniProt protein is linked to this entry, so there is no protein or structure information to show.',
      ),
    );
    return root;
  }
  const pv = p.value;
  const iso = selectCanonicalIsoform(p);
  let sequence = pv.sequence;
  let isoformId = iso.canonicalId;
  let selection: SelectedRange | null = null;
  let track: FeatureTrack | null = null;
  let viewer: StructureViewer | null = null;
  scope.add(() => viewer?.dispose());

  const setSelection = (range: SelectedRange | null): void => {
    selection = range;
    track?.setSelection(range);
    viewer?.highlight(range);
    drawSeq();
    status.textContent = range ? `Selected ${range.label}` : '';
  };
  const status = h('div', { class: 'muted', 'aria-live': 'polite', style: 'min-height:1.4em' });

  // ---- protein card
  const card = h('div', { class: 'card' }, h('h3', {}, 'Protein (UniProt)'));
  const dl = h('dl', { class: 'kv' });
  const row = (k: string, v: Node | string): void => {
    dl.append(h('dt', {}, k), h('dd', {}, v));
  };
  row(
    'Accession',
    h(
      'span',
      {},
      withSource(pv.accession, p),
      ' ',
      h(
        'span',
        { class: `badge ${pv.reviewed ? 'good' : 'warn'}` },
        pv.reviewed ? 'Reviewed (Swiss-Prot)' : 'Unreviewed (TrEMBL, automatic)',
      ),
    ),
  );
  row('Name', pv.proteinName ? withSource(pv.proteinName, p) : na());
  row('Length', withSource(`${fmt(pv.sequenceLength)} amino acids`, p));
  row('Protein evidence', withSource(pv.proteinExistence, p));
  row(
    'Annotation score',
    withSource(`${pv.annotationScore} of 5 (UniProt's measure of annotation completeness)`, p),
  );
  row(
    'Subcellular location',
    pv.subcellularLocations.length ? withSource(pv.subcellularLocations.join(', '), p) : na(),
  );
  const isoSel = h('select', {
    'aria-label': 'Isoform',
    onchange: (e: Event) => void switchIsoform((e.target as HTMLSelectElement).value),
  });
  isoSel.append(
    h('option', { value: iso.canonicalId }, `${iso.canonicalId} · ${iso.canonicalName} · canonical`),
  );
  for (const a of iso.alternatives)
    isoSel.append(h('option', { value: a.id }, `${a.id} · ${a.name} · ${a.status}`));
  row(
    'Isoform',
    iso.alternatives.length
      ? h(
          'span',
          {},
          isoSel,
          ' ',
          h('span', { class: 'muted' }, 'UniProt canonical isoform is shown by default.'),
        )
      : 'only the canonical sequence is listed by UniProt',
  );
  card.append(dl);
  const isoNote = h('div');
  card.append(isoNote);
  root.append(card);

  /** Switches the displayed isoform; non-canonical sequences are fetched on demand. */
  const switchIsoform = async (id: string): Promise<void> => {
    setChildren(isoNote);
    if (id === iso.canonicalId) {
      sequence = pv.sequence;
      isoformId = id;
      drawSeq();
      return;
    }
    isoNote.append(h('div', { class: 'skeleton', style: 'width:50%' }));
    const r = await view.fetchIsoformSequence(id);
    setChildren(isoNote);
    if (!r.ok) {
      isoNote.append(h('div', { class: 'notice error' }, `Could not load isoform ${id}: ${r.error.message}`));
      isoSel.value = iso.canonicalId;
      return;
    }
    sequence = r.sequence;
    isoformId = id;
    setSelection(null);
    isoNote.append(
      h(
        'div',
        { class: 'notice warn' },
        `Showing isoform ${id} (${fmt(r.sequence.length)} aa). The feature track and the 3D structure describe the canonical isoform only.`,
      ),
    );
  };

  // ---- GO terms
  const goCard = h('div', { class: 'card' }, h('h3', {}, 'GO terms (UniProt)'));
  const goFilter = h('input', {
    type: 'search',
    placeholder: 'Filter GO terms',
    'aria-label': 'Filter GO terms',
    style:
      'padding:6px 10px;border:1px solid var(--border);border-radius:8px;background:var(--surface);margin-bottom:8px',
  });
  const goBody = h('div', { style: 'max-height:300px;overflow:auto' });
  goCard.append(goFilter, goBody);
  root.append(goCard);
  const drawGo = (): void => {
    const q = goFilter.value.trim().toLowerCase();
    setChildren(goBody);
    if (pv.go.length === 0) {
      goBody.append(na('UniProt lists no GO terms for this protein.'));
      return;
    }
    const auto = pv.go.filter((x) => x.automatic).length;
    goBody.append(
      h(
        'p',
        { class: 'muted', title: provTitle(p) },
        `${pv.go.length} terms; ${auto} assigned automatically (evidence IEA). Showing ${q ? 'matches' : 'all'}.`,
      ),
    );
    for (const a of ASPECTS) {
      const terms = pv.go.filter(
        (x) =>
          x.aspect === a.key && (!q || x.name.toLowerCase().includes(q) || x.goId.toLowerCase().includes(q)),
      );
      if (terms.length === 0) continue;
      const ul = h('ul', { style: 'margin:4px 0 10px;padding-left:20px' });
      for (const t of terms)
        ul.append(
          h(
            'li',
            {},
            t.name,
            ' ',
            h('span', { class: 'mono muted' }, `${t.goId} · ${t.evidenceCode || 'no evidence code'}`),
            t.automatic ? h('span', { class: 'badge warn', style: 'margin-left:6px' }, 'automatic') : null,
          ),
        );
      goBody.append(h('strong', {}, `${a.label} (${terms.length})`), ul);
    }
  };
  goFilter.addEventListener('input', drawGo);
  drawGo();

  // ---- feature track
  const trackCard = h('div', { class: 'card track' }, h('h3', {}, 'Features along the sequence'));
  const trackBody = h('div');
  trackCard.append(trackBody, status);
  root.append(trackCard);
  const drawTrack = (): void => {
    setChildren(trackBody);
    if (pv.features.length === 0)
      trackBody.append(na('UniProt lists no domain, region or other features for this protein.'));
    const s = view.structure;
    const model = s.status === 'ready' ? s.data.models[s.data.selected] : undefined;
    const plddt = s.status === 'ready' ? s.data.residues.map((r) => r.bfactor) : null;
    track = featureTrack({
      length: pv.sequenceLength,
      features: pv.features,
      plddt,
      plddtStart: s.status === 'ready' ? (s.data.residues[0]?.number ?? 1) : 1,
      onSelect: (r) => setSelection(r),
    });
    trackBody.append(track.el);
    const legend = h('div', { class: 'legend' });
    for (const t of track.typesPresent) {
      const st = FEATURE_STYLES[t];
      legend.append(
        h(
          'span',
          {},
          h('i', { style: `background:${st?.color ?? 'var(--cat-8)'}` }),
          `${st?.label ?? 'Other'} (${st?.pattern ?? 'solid'})`,
        ),
      );
    }
    if (plddt) {
      for (const [c, l] of [
        ['var(--plddt-very-high)', '>90 very high'],
        ['var(--plddt-confident)', '70-90 confident'],
        ['var(--plddt-low)', '50-70 low'],
        ['var(--plddt-very-low)', '<50 very low'],
      ] as const) {
        legend.append(h('span', {}, h('i', { style: `background:${c}` }), `pLDDT ${l}`));
      }
    }
    trackBody.append(legend);
    trackBody.append(
      h(
        'p',
        { class: 'muted', title: provTitle(p) },
        `Features from UniProt ${pv.accession}${model ? `; confidence strip from AlphaFold model ${model.recordId}` : ''}. Click a feature (or press Enter on it) to highlight it in the sequence and the 3D view.`,
      ),
    );
    track.setSelection(selection);
  };

  // ---- 3D
  const structCard = h('div', { class: 'card' }, h('h3', {}, 'AlphaFold 3D structure (prediction)'));
  const structBody = h('div');
  structCard.append(structBody);
  root.append(structCard);
  let drawnStructure: unknown = null;
  const drawStructure = (): void => {
    const s = view.structure;
    if (drawnStructure === s) return;
    drawnStructure = s;
    viewer?.dispose();
    viewer = null;
    setChildren(
      structBody,
      renderLoadable(
        s,
        (data) => {
          const model = data.models[data.selected];
          const box = h('div');
          if (!model) return box;
          const m = model.value;
          const band = plddtBand(m.meanPlddt);
          box.append(
            h('div', { class: 'notice warn' }, structureNote(m.meanPlddt)),
            h(
              'p',
              { title: provTitle(model) },
              `Model ${model.recordId} · version v${m.modelVersion} · created ${m.createdDate.slice(0, 10)} · ${m.tool} · mean pLDDT ${m.meanPlddt.toFixed(1)} (${band.replace('_', ' ')}) · ${(m.fractions.veryHigh * 100).toFixed(0)}% of residues very high, ${(m.fractions.veryLow * 100).toFixed(0)}% very low. Low-confidence regions are often intrinsically disordered or unreliable.`,
            ),
          );
          if (m.sequence !== pv.sequence)
            box.append(
              h(
                'div',
                { class: 'notice warn' },
                'This model was built from a different sequence than the current UniProt entry (an older sequence version); positions may not match exactly.',
              ),
            );
          if (data.models.length > 1) {
            const sel = h('select', {
              'aria-label': 'AlphaFold fragment',
              onchange: (e: Event) => {
                void view.loadStructure(Number((e.target as HTMLSelectElement).value));
              },
            });
            data.models.forEach((x, i) => {
              const o = h(
                'option',
                { value: String(i) },
                `${x.recordId}${x.value.fragment ? ` · residues ${fmt(x.value.fragment.start)}-${fmt(x.value.fragment.end)}` : ''}`,
              );
              if (i === data.selected) o.selected = true;
              sel.append(o);
            });
            box.append(h('label', {}, 'Fragment (large protein, split into overlapping models): ', sel));
          }
          const wrap = h('div', { class: 'viewer-wrap' });
          const target = h('div', { class: 'v3d' });
          wrap.append(target);
          const msg = h('div');
          const btn = (label: string, fn: () => void, pressed?: boolean): HTMLButtonElement =>
            h(
              'button',
              {
                class: 'btn',
                type: 'button',
                onclick: fn,
                ...(pressed !== undefined ? { 'aria-pressed': String(pressed) } : {}),
              },
              label,
            );
          const colorBtn = btn(
            'Color: pLDDT',
            () => {
              const plain = colorBtn.getAttribute('aria-pressed') !== 'true';
              colorBtn.setAttribute('aria-pressed', String(plain));
              colorBtn.textContent = plain ? 'Color: plain' : 'Color: pLDDT';
              viewer?.setColorMode(plain ? 'plain' : 'plddt');
            },
            false,
          );
          const spinBtn = btn(
            'Spin',
            () => {
              const on = viewer?.toggleSpin() ?? false;
              spinBtn.setAttribute('aria-pressed', String(on));
            },
            false,
          );
          const controls = h(
            'div',
            { style: 'margin:8px 0;display:flex;gap:8px;flex-wrap:wrap' },
            colorBtn,
            btn('Reset view', () => viewer?.reset()),
            spinBtn,
            btn('Fullscreen', () => viewer?.fullscreen()),
            btn('Save PNG', () => {
              const b64 = viewer?.png();
              if (!b64) return ctx.toast('The 3D view is not ready to export yet.');
              void ctx.save(`${pv.accession}-alphafold.png`, b64, 'base64', {
                name: 'PNG image',
                ext: 'png',
              });
            }),
          );
          box.append(controls, wrap, msg);
          const v = new StructureViewer(target, {
            onResidueClick: (n) => setSelection({ start: n, end: n, label: `residue ${n}` }),
          });
          viewer = v;
          requestAnimationFrame(() => {
            v.load(data.pdb)
              .then(() => {
                if (selection) v.highlight(selection);
              })
              .catch((e: unknown) => {
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
          box.append(
            h(
              'p',
              { class: 'muted' },
              `Structure coordinates from AlphaFold DB (${model.recordId}). Hover a residue to see its pLDDT; click to select it.`,
            ),
          );
          return box;
        },
        () => void view.load('structure'),
        4,
      ),
    );
    drawTrack();
  };

  // ---- sequence
  const seqCard = h('div', { class: 'card' }, h('h3', {}, 'Sequence'));
  const seqBox = h('div', {
    class: 'seq',
    tabindex: 0,
    role: 'textbox',
    'aria-readonly': 'true',
    'aria-label': 'Protein sequence',
  });
  const seqTools = h('div', { style: 'margin-top:8px;display:flex;gap:8px;flex-wrap:wrap' });
  seqCard.append(seqBox, seqTools);
  root.append(seqCard);
  const fasta = (): string =>
    toFasta(proteinHeader(p, isoformId === iso.canonicalId ? undefined : isoformId), sequence);
  seqTools.append(
    h('button', { class: 'btn', type: 'button', onclick: () => ctx.copy(fasta(), 'FASTA') }, 'Copy FASTA'),
    h(
      'button',
      {
        class: 'btn',
        type: 'button',
        onclick: () => void ctx.save(`${isoformId}.fasta`, fasta(), 'utf8', { name: 'FASTA', ext: 'fasta' }),
      },
      'Export FASTA',
    ),
    h('button', { class: 'btn', type: 'button', onclick: () => setSelection(null) }, 'Clear selection'),
  );
  function drawSeq(): void {
    setChildren(seqBox);
    for (let i = 0; i < sequence.length; i += 10) {
      const start = i + 1;
      const chunk = sequence.slice(i, i + 10);
      const blk = h('span', {
        class: 'blk',
        'data-start': String(start),
        title: `residues ${start}-${start + chunk.length - 1}`,
      });
      const sel = selection && isoformId === iso.canonicalId ? selection : null;
      if (sel && sel.end >= start && sel.start <= start + chunk.length - 1) {
        const a = Math.max(sel.start, start) - start;
        const b = Math.min(sel.end, start + chunk.length - 1) - start + 1;
        blk.append(chunk.slice(0, a), h('span', { class: 'sel' }, chunk.slice(a, b)), chunk.slice(b));
      } else blk.append(chunk);
      seqBox.append(blk);
    }
  }
  // Native text selection by dragging, translated into a residue range.
  seqBox.addEventListener('mouseup', () => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.anchorNode || !sel.focusNode) return;
    const pos = (n: Node, off: number): number | null => {
      const el = (n.nodeType === Node.TEXT_NODE ? n.parentElement : (n as Element))?.closest('.blk');
      if (!el) return null;
      const base = Number(el.getAttribute('data-start'));
      let within = off;
      if (n.nodeType === Node.TEXT_NODE && n.parentElement?.classList.contains('sel')) {
        // text inside a highlighted run: add the length of preceding siblings
        let prev = n.parentElement.previousSibling;
        while (prev) {
          within += prev.textContent?.length ?? 0;
          prev = prev.previousSibling;
        }
      } else if (n.nodeType === Node.TEXT_NODE) {
        let prev = n.previousSibling;
        while (prev) {
          within += prev.textContent?.length ?? 0;
          prev = prev.previousSibling;
        }
      }
      return base + within;
    };
    const a = pos(sel.anchorNode, sel.anchorOffset);
    const b = pos(sel.focusNode, sel.focusOffset);
    sel.removeAllRanges();
    if (a === null || b === null || isoformId !== iso.canonicalId) return;
    const start = Math.max(1, Math.min(a, b));
    const end = Math.min(sequence.length, Math.max(a, b) - 1);
    if (end >= start) setSelection({ start, end, label: `residues ${start}-${end}` });
  });
  drawSeq();

  drawStructure();
  drawTrack();
  scope.add(
    view.subscribe(() => {
      drawStructure();
    }),
  );
  root.append(
    h('p', { class: 'muted' }, `Protein data from UniProt ${pv.accession}, fetched ${fmtTime(p.fetchedAt)}.`),
  );
  return root;
}
