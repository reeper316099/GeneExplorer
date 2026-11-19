// Compare tab: gene A (the current page) against a gene B chosen explicitly. Shows a field-by-field table, the protein
// alignment (computed in a worker), feature and gene-structure layouts, GO overlap and two synchronized 3D viewers.
import type { GeneApi } from '../../api/client';
import { resolveQuery } from '../../core/resolve';
import { buildComparison, structureNote } from '../../core/compare';
import type { CompareModel } from '../../core/compare';
import {
  alignmentFasta,
  compareCsv,
  compareFields,
  compareGo,
  STATUS_LABEL,
  wrapAlignment,
} from '../../core/compare-table';
import type { CompareSubject } from '../../core/compare-table';
import { chooseTranscript } from '../../core/gene-view';
import type { GeneView } from '../../core/gene-view';
import type { AlignResult } from '../../bio/align';
import type { GeneRecord, OrthologCall, TaxonCandidate, Transcript } from '../../shared/domain';
import { parseTaxonId } from '../../shared/ids';
import { runAlignment } from '../align-client';
import type { AlignJob } from '../align-client';
import type { AppCtx, Scope } from '../ctx';
import { provTitle } from '../ctx';
import { fmt, h, setChildren } from '../dom';
import { proteinHeader } from '../exports';
import type { Target } from '../prefs';
import { alignmentOverviewSvg } from '../svg/alignment-overview';
import { geneStructureSvg, structureStats } from '../svg/gene-structure';
import { StructureViewer } from '../viewer3d';
import { friendlyError, renderLoadable } from './panel';

/** Holds the chosen gene B across tab switches so returning to the tab does not reload it. */
export class CompareHub {
  pending: { target: Target; label: string } | null = null;
  b: { view: GeneView; cancel: () => void; label: string } | null = null;
  alignment: { key: string; result: AlignResult } | null = null;
  private listeners = new Set<() => void>();

  /** Registers a listener for newly requested genes. */
  onRequest(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Asks the compare tab to load a gene as B. */
  request(target: Target, label: string): void {
    this.pending = { target, label };
    for (const l of this.listeners) l();
  }

  /** Cancels everything B was loading. */
  dispose(): void {
    this.b?.cancel();
    this.b = null;
  }
}

const GENE_LABEL = (g: GeneRecord): string => `${g.value.symbol} (${g.value.taxon.scientificName})`;

/** Builds the Compare tab. */
export function compareTab(ctx: AppCtx, a: GeneView, scope: Scope, hub: CompareHub): HTMLElement {
  const root = h('div');
  const { api, cancel } = ctx.newApi();
  let alive = true;
  let job: AlignJob | null = null;
  let viewers: StructureViewer[] = [];
  let unsubB: (() => void) | null = null;
  scope.add(() => {
    alive = false;
    cancel();
    job?.cancel();
    unsubB?.();
    for (const v of viewers) v.dispose();
  });

  if (!a.protein && !a.gene) {
    root.append(
      h('div', { class: 'notice info' }, 'Nothing is loaded for this entry, so there is nothing to compare.'),
    );
    return root;
  }
  const labelA = (a.gene ? GENE_LABEL(a.gene) : a.protein?.value.accession) ?? 'Gene A';

  // ---------------------------------------------------------------- pickers
  const picker = h('div', { class: 'card' });
  const chooser = h('div');
  const body = h('div');
  root.append(picker, body);
  /** Draws the A/B header and the chooser. */
  const drawPicker = (): void => {
    setChildren(
      picker,
      h('h3', {}, 'Choose the two genes'),
      h(
        'p',
        {},
        h('strong', {}, 'A: '),
        labelA,
        h('span', { class: 'muted' }, ' (the gene you are looking at)'),
      ),
      h(
        'p',
        {},
        h('strong', {}, 'B: '),
        hub.b ? hub.b.label : h('span', { class: 'muted' }, 'not chosen yet'),
        hub.b
          ? h(
              'button',
              {
                class: 'chip',
                type: 'button',
                onclick: () => {
                  hub.dispose();
                  hub.alignment = null;
                  drawPicker();
                  drawBody();
                },
              },
              'Change',
            )
          : null,
      ),
      hub.b ? null : chooser,
    );
  };
  const species = speciesBox(api);
  const msg = h('div');
  /** Finds the ortholog(s) of gene A in a species through NCBI Orthologs and asks for an explicit choice. */
  const findOrtholog = async (): Promise<void> => {
    const taxon = species.value();
    if (!a.gene)
      return setChildren(
        msg,
        h(
          'div',
          { class: 'notice warn' },
          'NCBI orthologs are looked up by NCBI Gene ID and gene A has none.',
        ),
      );
    if (!taxon)
      return setChildren(msg, h('div', { class: 'notice warn' }, 'Pick a species from the list first.'));
    setChildren(msg, h('div', { class: 'skeleton' }));
    const r = await api.getNcbiOrthologs(a.gene.value.geneId, [taxon.id]);
    if (!alive) return;
    if (!r.ok)
      return setChildren(
        msg,
        h('div', { class: 'notice error' }, friendlyError(r.error)),
        h('button', { class: 'btn', type: 'button', onclick: () => void findOrtholog() }, 'Retry'),
      );
    const calls = r.value.filter((c) => c.value.geneId !== a.gene?.value.geneId);
    if (calls.length === 0) {
      return setChildren(
        msg,
        h(
          'div',
          { class: 'notice warn' },
          `NCBI Orthologs lists no ortholog of ${a.gene.value.symbol} in ${taxon.scientificName}. That is not the same as the species lacking the gene. You can still choose any gene below to compare, but it will not be presented as an ortholog.`,
        ),
      );
    }
    const note =
      calls.length > 1
        ? `NCBI lists ${calls.length} genes in ${taxon.scientificName} (a one-to-many relationship, for example after a gene duplication). Choose the one you want; none is picked for you.`
        : `NCBI lists one gene in ${taxon.scientificName}. It is shown for you to confirm.`;
    setChildren(msg, h('div', { class: 'notice info' }, note), ...calls.map((c) => candidate(c)));
  };
  /** One candidate button for an ortholog call. */
  const candidate = (c: OrthologCall): HTMLElement =>
    h(
      'button',
      {
        class: 'result',
        type: 'button',
        onclick: () =>
          void setB(
            { kind: 'ncbi_gene', id: c.value.geneId ?? '' },
            `${c.value.symbol} (${c.value.taxon.scientificName})`,
          ),
      },
      h('div', {}, h('strong', {}, c.value.symbol), ' ', h('span', { class: 'muted' }, c.value.description)),
      h(
        'div',
        { class: 'muted', title: provTitle(c) },
        `${c.value.taxon.scientificName} · NCBI Gene ${c.value.geneId} · call by ${c.source} (${c.value.method})`,
      ),
    );
  const symbolIn = h('input', {
    type: 'text',
    placeholder: 'Gene symbol or NCBI Gene ID',
    'aria-label': 'Gene B symbol or ID',
  });
  /** Resolves any gene by symbol (+species) or ID for gene B. */
  const findAny = async (): Promise<void> => {
    const q = symbolIn.value.trim();
    if (!q) return;
    const tx = species.value();
    setChildren(msg, h('div', { class: 'skeleton' }));
    const r = await resolveQuery(api, q, tx ? (parseTaxonId(tx.id) ?? undefined) : undefined);
    if (!alive) return;
    if (!r.ok) return setChildren(msg, h('div', { class: 'notice error' }, friendlyError(r.error)));
    const v = r.value;
    if (v.kind === 'resolved') {
      const t: Target | null = v.gene
        ? { kind: 'ncbi_gene', id: v.gene.value.geneId }
        : v.protein
          ? { kind: 'uniprot', id: v.protein.value.accession }
          : null;
      if (t) return void setB(t, v.gene ? GENE_LABEL(v.gene) : (v.protein?.value.accession ?? q));
    }
    if (v.kind === 'ambiguous') {
      return setChildren(
        msg,
        h('div', { class: 'notice warn' }, v.message),
        ...v.candidates.map((g) =>
          h(
            'button',
            {
              class: 'result',
              type: 'button',
              onclick: () => void setB({ kind: 'ncbi_gene', id: g.value.geneId }, GENE_LABEL(g)),
            },
            h('strong', {}, g.value.symbol),
            ' ',
            h(
              'span',
              { class: 'muted' },
              `${g.value.description} · ${g.value.taxon.scientificName} · NCBI Gene ${g.value.geneId}`,
            ),
          ),
        ),
      );
    }
    setChildren(
      msg,
      h(
        'div',
        { class: 'notice warn' },
        'message' in v ? v.message : 'That gene could not be found. Pick a species or use an ID.',
      ),
    );
  };
  chooser.append(
    h(
      'div',
      { style: 'display:flex;gap:8px;flex-wrap:wrap;align-items:flex-start' },
      species.el,
      h(
        'button',
        { class: 'btn primary', type: 'button', onclick: () => void findOrtholog() },
        'Find ortholog in this species',
      ),
    ),
    h(
      'p',
      { class: 'muted' },
      'Or choose any gene (it will not be presented as an ortholog unless a source says so):',
    ),
    h(
      'div',
      { style: 'display:flex;gap:8px;flex-wrap:wrap' },
      symbolIn,
      h('button', { class: 'btn', type: 'button', onclick: () => void findAny() }, 'Use this gene as B'),
    ),
    msg,
  );

  /** Loads gene B as a full view and switches to the comparison. */
  async function setB(target: Target, label: string): Promise<void> {
    setChildren(msg, h('div', { class: 'skeleton' }));
    hub.dispose();
    hub.alignment = null;
    const r = await ctx.loadGeneView(target);
    if (!alive) {
      if (r.ok) r.cancel();
      return;
    }
    if (!r.ok) return setChildren(msg, h('div', { class: 'notice error' }, r.message));
    hub.b = { view: r.view, cancel: r.cancel, label };
    unsubB?.();
    unsubB = r.view.subscribe(() => drawBody());
    drawPicker();
    drawBody();
  }

  // ---------------------------------------------------------------- body
  const subject = (v: GeneView): CompareSubject => {
    const tr = v.transcripts.status === 'ready' ? v.transcripts.data : null;
    const t: Transcript | null = tr ? (tr.value.transcripts[chooseTranscript(tr).index] ?? null) : null;
    const st =
      v.structure.status === 'ready' ? (v.structure.data.models[v.structure.data.selected] ?? null) : null;
    return { gene: v.gene, protein: v.protein, transcript: t, structure: st };
  };
  let orthologCalls: OrthologCall[] = [];
  let orthologsFor = '';
  let structureKey = '';
  const structureBox = h('div');
  let commonScale = false;

  /** Redraws the whole comparison for the current A and B. */
  function drawBody(): void {
    const b = hub.b;
    if (!b) return setChildren(body);
    const A = subject(a);
    const B = subject(b.view);
    const sections: Node[] = [];
    sections.push(
      h(
        'div',
        { class: 'notice info' },
        'Orthology is inferred. Differences may reflect real biology, annotation quality, or isoform choice.',
      ),
    );

    // Ortholog statement needs NCBI calls for B's species; fetched once per pair.
    const bTax = b.view.gene?.value.taxon.id ?? b.view.protein?.value.taxon.id;
    const key = `${a.gene?.value.geneId}|${bTax}`;
    if (a.gene && bTax !== undefined && orthologsFor !== key) {
      orthologsFor = key;
      void api.getNcbiOrthologs(a.gene.value.geneId, [bTax]).then((r) => {
        if (!alive) return;
        orthologCalls = r.ok ? r.value : [];
        drawBody();
      });
    }
    const aln = hub.alignment && hub.alignment.key === alignKey() ? hub.alignment.result : undefined;
    const model: CompareModel | null =
      a.protein && b.view.protein
        ? buildComparison(
            { protein: a.protein },
            { protein: b.view.protein },
            { orthologCalls, ...(aln ? { alignment: aln } : {}) },
          )
        : null;

    if (model) {
      sections.push(
        h(
          'div',
          { class: `notice ${model.orthology.kind === 'reported' ? 'info' : 'warn'}` },
          h(
            'strong',
            {},
            model.orthology.kind === 'reported' ? 'Orthology reported. ' : 'No ortholog call found. ',
          ),
          model.orthology.text,
        ),
      );
      for (const w of model.warnings) sections.push(h('div', { class: 'notice warn' }, w));
    }

    // Field table
    const rows = compareFields(A, B);
    const table = h(
      'table',
      {},
      h(
        'thead',
        {},
        h(
          'tr',
          {},
          h('th', {}, 'Field'),
          h('th', {}, `A: ${labelA}`),
          h('th', {}, `B: ${b.label}`),
          h('th', {}, 'Status'),
        ),
      ),
    );
    const tb = h('tbody');
    for (const r of rows) {
      const st = STATUS_LABEL[r.status];
      tb.append(
        h(
          'tr',
          {},
          h('td', {}, r.field, r.note ? h('div', { class: 'muted', style: 'font-size:12px' }, r.note) : null),
          h(
            'td',
            { title: r.provA ? provTitle(r.provA) : 'not available' },
            r.a ?? h('span', { class: 'muted' }, 'not available'),
          ),
          h(
            'td',
            { title: r.provB ? provTitle(r.provB) : 'not available' },
            r.b ?? h('span', { class: 'muted' }, 'not available'),
          ),
          h(
            'td',
            {},
            h('span', { 'aria-hidden': 'true', style: 'font-weight:700;margin-right:6px' }, st.icon),
            st.text,
          ),
        ),
      );
    }
    table.append(tb);
    sections.push(
      h(
        'div',
        { class: 'card' },
        h('h3', {}, 'Comparison table'),
        table,
        h(
          'p',
          { class: 'muted' },
          'Hover a value to see its source. Status: = same, ≠ different, ∅A / ∅B missing on one side, – not comparable.',
        ),
        h(
          'button',
          {
            class: 'btn',
            type: 'button',
            onclick: () =>
              void ctx.save(
                `${labelA}-vs-${b.label}.csv`.replace(/[^\w.-]+/g, '_'),
                compareCsv(rows, {
                  a: labelA,
                  b: b.label,
                  appVersion: ctx.appVersion,
                  fetchedAt: Date.now(),
                }),
                'utf8',
                { name: 'CSV', ext: 'csv' },
              ),
          },
          'Export table (CSV)',
        ),
      ),
    );

    // Alignment, domains
    const alignBox = h('div', { class: 'card' }, h('h3', {}, 'Protein alignment'));
    sections.push(alignBox);
    drawAlignment(alignBox, model, aln);

    // Gene structure stacked
    sections.push(structureCard(A.transcript, B.transcript, b.label));

    // GO
    const go = compareGo(a.protein, b.view.protein);
    const list = (title: string, items: { goId: string; name: string }[]): HTMLElement =>
      h(
        'div',
        {},
        h('strong', {}, `${title} (${items.length})`),
        h(
          'ul',
          { style: 'max-height:200px;overflow:auto;margin:4px 0;padding-left:18px' },
          ...items.map((i) => h('li', {}, i.name, ' ', h('span', { class: 'mono muted' }, i.goId))),
        ),
      );
    sections.push(
      h(
        'div',
        { class: 'card' },
        h('h3', {}, 'GO term comparison'),
        h(
          'p',
          {},
          go.jaccard === null
            ? 'No GO terms on either side.'
            : `Overlap (Jaccard index) ${go.jaccard.toFixed(2)}: ${go.shared.length} shared of ${go.shared.length + go.onlyA.length + go.onlyB.length} distinct terms.`,
        ),
        h(
          'p',
          { class: 'muted' },
          'Annotation depth differs a lot between species: a term missing on one side often means "not annotated", not "absent". Terms come from UniProt for each protein.',
        ),
        h(
          'div',
          { style: 'display:grid;grid-template-columns:repeat(3,1fr);gap:14px' },
          list('Shared', go.shared),
          list('A only', go.onlyA),
          list('B only', go.onlyB),
        ),
      ),
    );

    // Structures
    sections.push(structureBox);
    setChildren(body, ...sections);
    drawStructures(b);
    function structureCard(ta: Transcript | null, tb2: Transcript | null, bLabel: string): HTMLElement {
      const card = h('div', { class: 'card diagram' }, h('h3', {}, 'Gene structure'));
      const toggle = h(
        'label',
        {},
        h('input', {
          type: 'checkbox',
          ...(commonScale ? { checked: true } : {}),
          onchange: (e: Event) => {
            commonScale = (e.target as HTMLInputElement).checked;
            drawBody();
          },
        }),
        ' Draw both on one common scale (bp per pixel); off = each gene fills the width',
      );
      card.append(toggle);
      const sa = ta ? structureStats(ta) : null;
      const sb = tb2 ? structureStats(tb2) : null;
      const span = Math.max(sa?.span ?? 0, sb?.span ?? 0);
      for (const [lab, t, st] of [
        [`A: ${labelA}`, ta, sa],
        [`B: ${bLabel}`, tb2, sb],
      ] as const) {
        const svg = t ? geneStructureSvg(t, commonScale ? span : undefined) : null;
        card.append(
          h('h4', { style: 'margin:10px 0 2px' }, lab),
          svg ?? h('p', { class: 'muted' }, 'Gene structure not available (not loaded or no exon data).'),
          st
            ? h(
                'p',
                {},
                `${st.exonCount} exons · spliced length ${fmt(st.splicedLength)} bp · genomic span ${fmt(st.span)} bp · transcript ${t?.accession ?? ''}`,
              )
            : '',
        );
      }
      return card;
    }
  }

  /** Key identifying the current sequence pair (so a stored alignment is reused only for the same pair). */
  function alignKey(): string {
    return `${a.protein?.value.accession}|${hub.b?.view.protein?.value.accession}`;
  }

  /** Runs (or shows) the alignment and the views built on it. */
  function drawAlignment(box: HTMLElement, model: CompareModel | null, aln: AlignResult | undefined): void {
    const pa = a.protein?.value;
    const pb = hub.b?.view.protein?.value;
    if (!pa || !pb) {
      box.append(h('div', { class: 'notice info' }, 'Both genes need a UniProt protein to be aligned.'));
      return;
    }
    box.append(
      h(
        'p',
        { class: 'muted' },
        'No loaded source supplies a pairwise alignment for this pair, so the app computed one with its own global aligner (Needleman-Wunsch, affine gaps, BLOSUM62; checked against Biopython) on the canonical sequences.',
      ),
    );
    if (!aln) {
      const prog = h('progress', { max: 1, value: 0, style: 'width:300px' });
      const status = h('span', { class: 'muted' }, ' aligning…');
      const stop = h(
        'button',
        {
          class: 'btn',
          type: 'button',
          onclick: () => {
            job?.cancel();
            setChildren(
              box,
              h('h3', {}, 'Protein alignment'),
              h('div', { class: 'notice info' }, 'Alignment cancelled.'),
              h(
                'button',
                {
                  class: 'btn',
                  type: 'button',
                  onclick: () => {
                    hub.alignment = null;
                    drawBody();
                  },
                },
                'Run again',
              ),
            );
          },
        },
        'Cancel',
      );
      box.append(h('div', {}, prog, status, ' ', stop));
      if (!job) {
        const k = alignKey();
        job = runAlignment(pa.sequence, pb.sequence, (f) => {
          prog.value = f;
        });
        void job.promise.then((res) => {
          job = null;
          if (!alive || res === null) return;
          hub.alignment = { key: k, result: res };
          drawBody();
        });
      }
      return;
    }
    if (!aln.ok) {
      box.append(h('div', { class: 'notice warn' }, aln.message));
      return;
    }
    const al = aln.alignment;
    const idv = al.identity;
    const pct = (x: number | null): string => (x === null ? 'n/a' : `${(x * 100).toFixed(1)}%`);
    box.append(
      h(
        'p',
        {},
        h('strong', {}, `Identity ${pct(idv.overAligned)}`),
        ` (${fmt(al.stats.identities)} identical of ${fmt(al.stats.alignedColumns)} aligned positions). Similarity ${pct(al.stats.alignedColumns ? al.stats.positives / al.stats.alignedColumns : null)} (${fmt(al.stats.positives)} positions with a positive BLOSUM62 score). Score ${al.score}.`,
      ),
      h(
        'p',
        { class: 'muted' },
        `Other denominators: ${pct(idv.overColumns)} over all ${fmt(al.stats.columns)} alignment columns (gaps count against identity); ${pct(idv.overShorter)} over the shorter sequence. ${fmt(al.stats.gapPositions)} gap positions in ${fmt(al.stats.gapOpenings)} gaps. Where several alignments score equally, which one is shown is arbitrary.`,
      ),
    );
    if (model?.warnings.length === 0 && idv.overAligned !== null && idv.overAligned < 0.3)
      box.append(
        h('div', { class: 'notice warn' }, 'Identity is low; treat the alignment below with caution.'),
      );
    box.append(
      alignmentOverviewSvg({
        alignedA: al.alignedA,
        alignedB: al.alignedB,
        featuresA: pa.features,
        featuresB: pb.features,
        labelA,
        labelB: hub.b?.label ?? 'B',
      }),
    );
    const legend = h(
      'p',
      { class: 'muted' },
      'Match line: | identical residue, + similar (positive BLOSUM62), blank = different or gap. Residue letters are always shown; shading is only an extra cue.',
    );
    const wrap = h('div', {
      class: 'seq',
      style: 'max-height:340px;user-select:text',
      tabindex: 0,
      role: 'region',
      'aria-label': 'Wrapped protein alignment',
    });
    const lines = wrapAlignment(al.alignedA, al.alignedB, 60);
    for (const l of lines) {
      const mk = (txt: string, other: string, n: number | null): HTMLElement => {
        const row = h(
          'div',
          { style: 'white-space:pre' },
          h('span', { class: 'muted' }, `${String(n ?? '').padStart(6, ' ')} `),
        );
        for (let i = 0; i < txt.length; i++)
          row.append(
            h(
              'span',
              {
                ...(txt[i] === other[i] && txt[i] !== '-' ? { style: 'background:var(--highlight-bg)' } : {}),
              },
              txt.charAt(i),
            ),
          );
        return row;
      };
      wrap.append(
        mk(l.a, l.b, l.startA),
        h('div', { style: 'white-space:pre' }, `       ${l.mid}`),
        mk(l.b, l.a, l.startB),
        h('div', {}, ' '),
      );
    }
    const ha = proteinHeader(a.protein);
    const hb = proteinHeader(hub.b?.view.protein as NonNullable<GeneView['protein']>);
    box.append(
      legend,
      wrap,
      h(
        'button',
        {
          class: 'btn',
          type: 'button',
          onclick: () =>
            void ctx.save(
              'alignment.fasta',
              alignmentFasta({ header: ha, aligned: al.alignedA }, { header: hb, aligned: al.alignedB }),
              'utf8',
              { name: 'FASTA', ext: 'fasta' },
            ),
        },
        'Export alignment (FASTA)',
      ),
    );
  }

  /** Draws the two 3D viewers (rebuilt only when either structure state changes). */
  function drawStructures(b: NonNullable<typeof hub.b>): void {
    const sa = a.structure;
    const sb = b.view.structure;
    const k = `${sa.status}:${sb.status}:${sa.status === 'ready' ? sa.data.selected : ''}:${sb.status === 'ready' ? sb.data.selected : ''}`;
    if (k === structureKey && structureBox.childNodes.length > 0) {
      body.append(structureBox);
      return;
    }
    structureKey = k;
    for (const v of viewers) v.dispose();
    viewers = [];
    const card = h('div', { class: 'card' }, h('h3', {}, 'AlphaFold structures (predictions)'));
    const cols = h('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:14px' });
    let sync = true;
    let busy = false;
    const lanes: { title: string; state: typeof sa }[] = [
      { title: `A: ${labelA}`, state: sa },
      { title: `B: ${b.label}`, state: sb },
    ];
    const made: (StructureViewer | null)[] = [];
    lanes.forEach((lane, idx) => {
      const col = h('div', {}, h('h4', { style: 'margin:0 0 4px' }, lane.title));
      cols.append(col);
      col.append(
        renderLoadable(
          lane.state,
          (data) => {
            const m = data.models[data.selected];
            const box = h('div');
            if (!m) return box;
            box.append(h('p', { title: provTitle(m) }, structureNote(m.value.meanPlddt)));
            const wrap = h('div', { class: 'viewer-wrap', style: 'height:340px' });
            const target = h('div', { class: 'v3d' });
            wrap.append(target);
            box.append(wrap);
            const v = new StructureViewer(target, { onResidueClick: () => undefined });
            viewers.push(v);
            made[idx] = v;
            requestAnimationFrame(() => {
              v.load(data.pdb)
                .then(() =>
                  v.onViewChange((view) => {
                    if (!sync || busy) return;
                    busy = true;
                    made[1 - idx]?.syncRotationFrom(view);
                    busy = false;
                  }),
                )
                .catch((e: unknown) =>
                  wrap.replaceWith(
                    h('div', { class: 'notice error' }, e instanceof Error ? e.message : '3D view failed.'),
                  ),
                );
            });
            return box;
          },
          () => void (idx === 0 ? a.load('structure') : b.view.load('structure')),
          3,
        ),
      );
    });
    const syncBox = h(
      'label',
      {},
      h('input', {
        type: 'checkbox',
        checked: true,
        onchange: (e: Event) => {
          sync = (e.target as HTMLInputElement).checked;
        },
      }),
      ' Rotate both together',
    );
    const png = h(
      'button',
      { class: 'btn', type: 'button', onclick: () => void sideBySidePng() },
      'Save side-by-side PNG',
    );
    card.append(
      h(
        'div',
        { style: 'display:flex;gap:14px;align-items:center;margin-bottom:8px;flex-wrap:wrap' },
        syncBox,
        png,
      ),
      cols,
      h(
        'p',
        { class: 'muted' },
        'Both structures are AlphaFold predictions coloured by pLDDT (blue above 90, light blue 70-90, yellow 50-70, orange below 50). They are drawn separately, not superimposed (the overlay is a later milestone).',
      ),
    );
    setChildren(structureBox, card);
    body.append(structureBox);
    /** Combines both viewer images into one labelled PNG. */
    async function sideBySidePng(): Promise<void> {
      const imgs = made.map((v) => v?.png() ?? null);
      if (imgs.some((i) => i === null)) return ctx.toast('Both 3D views must be loaded before saving.');
      const load = (b64: string): Promise<HTMLImageElement> =>
        new Promise((res, rej) => {
          const i = new Image();
          i.onload = () => res(i);
          i.onerror = () => rej(new Error('image'));
          i.src = `data:image/png;base64,${b64}`;
        });
      const [ia, ib] = await Promise.all(imgs.map((x) => load(x as string)));
      if (!ia || !ib) return;
      const c = document.createElement('canvas');
      c.width = ia.width + ib.width;
      c.height = Math.max(ia.height, ib.height) + 40;
      const g = c.getContext('2d');
      if (!g) return;
      g.fillStyle = '#fff';
      g.fillRect(0, 0, c.width, c.height);
      g.drawImage(ia, 0, 40);
      g.drawImage(ib, ia.width, 40);
      g.fillStyle = '#000';
      g.font = '20px sans-serif';
      g.fillText(`A: ${labelA}`, 10, 26);
      g.fillText(`B: ${b.label}`, ia.width + 10, 26);
      await ctx.save(
        'structures-side-by-side.png',
        c.toDataURL('image/png').replace(/^data:image\/png;base64,/, ''),
        'base64',
        { name: 'PNG image', ext: 'png' },
      );
    }
  }

  // ---------------------------------------------------------------- start
  drawPicker();
  drawBody();
  scope.add(
    hub.onRequest(() => {
      if (hub.pending) {
        const p = hub.pending;
        hub.pending = null;
        void setB(p.target, p.label);
      }
    }),
  );
  if (hub.pending) {
    const p = hub.pending;
    hub.pending = null;
    void setB(p.target, p.label);
  } else if (hub.b) {
    unsubB = hub.b.view.subscribe(() => drawBody());
  }
  return root;
}

interface SpeciesBox {
  el: HTMLElement;
  value(): TaxonCandidate | null;
}

/** A small species autocomplete (UniProt taxonomy search); the chosen species is explicit, never guessed. */
function speciesBox(api: GeneApi): SpeciesBox {
  let chosen: TaxonCandidate | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const input = h('input', {
    type: 'text',
    'aria-label': 'Species of gene B',
    placeholder: 'Species, e.g. mouse',
    autocomplete: 'off',
  });
  const list = h('ul', { role: 'listbox', hidden: true });
  const el = h('div', { class: 'combo' }, input, list);
  input.addEventListener('input', () => {
    chosen = null;
    clearTimeout(timer);
    const t = input.value.trim();
    if (t.length < 2) return list.setAttribute('hidden', '');
    timer = setTimeout(() => {
      void api.searchTaxa(t).then((r) => {
        setChildren(list);
        if (!r.ok) return list.setAttribute('hidden', '');
        for (const c of r.value.value
          .filter((x) => x.rank === 'species' || x.rank === 'subspecies' || x.rank === undefined)
          .slice(0, 8)) {
          list.append(
            h(
              'li',
              {
                role: 'option',
                onmousedown: (e: Event) => {
                  e.preventDefault();
                  chosen = c;
                  input.value = `${c.scientificName}${c.commonName ? ` (${c.commonName})` : ''}`;
                  list.setAttribute('hidden', '');
                },
              },
              `${c.scientificName}${c.commonName ? ` (${c.commonName})` : ''} · taxon ${c.id}`,
            ),
          );
        }
        list.toggleAttribute('hidden', list.childNodes.length === 0);
      });
    }, 250);
  });
  input.addEventListener('blur', () => setTimeout(() => list.setAttribute('hidden', ''), 150));
  return { el, value: () => chosen };
}
