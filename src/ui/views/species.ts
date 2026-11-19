// "Which species have this gene" tab. Each orthology source (NCBI Orthologs, OrthoDB) has its own section with its
// own coverage statement; sources are never merged into one list.
import type { GeneView } from '../../core/gene-view';
import type { OrthologState } from '../../core/ortholog-state';
import type { OrthoDbResult, SourceKey, SourceResult } from '../../core/ortholog-state';
import {
  cladeCounts,
  coverageStatement,
  filterRows,
  orthologCsv,
  sortRows,
  summarize,
} from '../../core/ortholog-table';
import type { OrthologRow, SortKey } from '../../core/ortholog-table';
import { fmt, fmtTime, h, s, setChildren } from '../dom';
import type { AppCtx, Scope } from '../ctx';
import type { Target } from '../prefs';
import { renderLoadable } from './panel';

/** Lets the Species tab hand a gene to the Compare tab. */
export interface CompareController {
  request(target: Target, label: string): void;
}

const CHART_COLORS = [
  'var(--cat-1)',
  'var(--cat-2)',
  'var(--cat-3)',
  'var(--cat-4)',
  'var(--cat-5)',
  'var(--cat-6)',
  'var(--cat-7)',
  'var(--cat-8)',
];
const PAGE = 150;

/** Horizontal bar chart of species per lineage group; every bar carries its label and count as text. */
export function lineageChartSvg(rows: readonly OrthologRow[]): SVGSVGElement {
  const counts = cladeCounts(rows);
  const W = 1000;
  const rowH = 26;
  const labelW = 260;
  const max = Math.max(1, ...counts.map((c) => c.species));
  const svg = s('svg', {
    viewBox: `0 0 ${W} ${counts.length * rowH + 8}`,
    role: 'img',
    'aria-label': `Species per lineage group: ${counts.map((c) => `${c.clade.label} ${c.species}`).join(', ')}`,
  });
  counts.forEach((c, i) => {
    const y = 4 + i * rowH;
    const w = Math.max(2, ((W - labelW - 90) * c.species) / max);
    svg.append(
      s(
        'text',
        { x: labelW - 8, y: y + 17, 'text-anchor': 'end', 'font-size': 14, fill: 'var(--text)' },
        c.clade.label,
      ),
      s(
        'rect',
        {
          x: labelW,
          y,
          width: w,
          height: 20,
          rx: 3,
          fill: CHART_COLORS[i % CHART_COLORS.length] ?? 'var(--cat-8)',
          stroke: 'var(--text)',
          'stroke-width': 0.6,
        },
        s('title', {}, `${c.clade.label}: ${c.species} species, ${c.genes} genes`),
      ),
      s(
        'text',
        { x: labelW + w + 6, y: y + 16, 'font-size': 13, fill: 'var(--text)' },
        `${c.species} species${c.genes !== c.species ? ` · ${c.genes} genes` : ''}`,
      ),
    );
  });
  return svg;
}

/** Builds the Species tab. */
export function speciesTab(
  ctx: AppCtx,
  view: GeneView,
  scope: Scope,
  compare: CompareController,
  state: OrthologState,
): HTMLElement {
  const root = h('div');
  let source: SourceKey = 'ncbi';
  const filter: { clade: string; text: string; sort: SortKey; dir: 1 | -1; shown: number } = {
    clade: '',
    text: '',
    sort: 'clade',
    dir: 1,
    shown: PAGE,
  };
  const symbol = view.gene?.value.symbol ?? view.protein?.value.geneNames.primary ?? 'this gene';
  const isHuman = (view.gene?.value.taxon.id ?? view.protein?.value.taxon.id) === 9606;

  root.append(
    h(
      'div',
      { class: 'notice info' },
      'Orthology is inferred, not observed. Different resources use different methods and can disagree, so each source is shown separately and labelled. "No ortholog found in a source" is not the same as "this species does not have the gene".',
    ),
  );
  const tabs = h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Orthology source' });
  const body = h('div');
  root.append(tabs, body);
  const labels: Record<SourceKey, string> = { ncbi: 'NCBI Orthologs', orthodb: 'OrthoDB' };
  const buttons = (Object.keys(labels) as SourceKey[]).map((k) =>
    h('button', { role: 'tab', type: 'button', 'aria-selected': 'false', onclick: () => pick(k) }, labels[k]),
  );
  tabs.append(...buttons);

  /** Switches source and starts loading it the first time it is shown. */
  function pick(k: SourceKey): void {
    source = k;
    filter.clade = '';
    filter.text = '';
    filter.shown = PAGE;
    buttons.forEach((b, i) =>
      b.setAttribute('aria-selected', String((Object.keys(labels)[i] as SourceKey) === k)),
    );
    const st = k === 'ncbi' ? state.ncbi : state.orthodb;
    if (st.status === 'idle') void state.load(k);
    draw();
  }

  /** Redraws the section for the current source. */
  function draw(): void {
    if (source === 'ncbi') {
      setChildren(
        body,
        renderLoadable(
          state.ncbi,
          (d) =>
            section(
              d,
              'NCBI Orthologs',
              'Computed by NCBI (see "Orthologs" on the NCBI Gene page). The Datasets API returns the gene reports of the orthologs only; it gives no identity percentage and no 1:1 / 1:many type.',
              `NCBI Gene ${view.gene?.value.geneId ?? ''}`,
            ),
          () => void state.load('ncbi'),
          4,
        ),
      );
    } else {
      setChildren(
        body,
        renderLoadable(
          state.orthodb,
          (d) =>
            section(
              d,
              'OrthoDB',
              `OrthoDB (v12) groups genes from many genomes that descend from a single gene in the last common ancestor of the chosen taxonomic level (${d.info?.value.levelName || 'unknown level'}). It gives no identity percentage and no 1:1 / 1:many type through its API.`,
              `UniProt ${view.protein?.value.accession ?? ''}`,
              d,
            ),
          () => void state.load('orthodb'),
          4,
        ),
      );
    }
  }

  /** Builds one source's section from its loaded rows. */
  function section(
    d: SourceResult,
    name: string,
    method: string,
    query: string,
    odb?: OrthoDbResult,
  ): HTMLElement {
    const box = h('div');
    const all = d.rows;
    const sum = summarize(all);
    box.append(
      h(
        'div',
        { class: 'card' },
        h('h3', {}, `${name}: method and coverage`),
        h('p', {}, method),
        h('p', { class: 'muted' }, `Queried by ${query}. Data fetched ${fmtTime(d.fetchedAt)}.`),
        h('p', {}, coverageStatement(all)),
        d.lineageMissing
          ? h(
              'div',
              { class: 'notice warn' },
              'Lineage information could not be loaded, so some species may appear under "Unclassified".',
            )
          : null,
      ),
    );
    if (odb) {
      const sel = h('select', {
        'aria-label': 'OrthoDB group',
        onchange: (e: Event) => void state.load('orthodb', (e.target as HTMLSelectElement).value as never),
      });
      for (const g of odb.groups) {
        const o = h(
          'option',
          { value: g.id },
          `${g.levelName || 'level?'} · ${g.id} · ${g.geneCount ?? '?'} genes in ${g.speciesCount ?? '?'} species${(g.geneCount ?? 0) > 1500 ? ' · large download' : ''}`,
        );
        if (g.id === odb.selected) o.selected = true;
        sel.append(o);
      }
      box.append(
        h(
          'div',
          { class: 'card' },
          h('label', {}, 'Taxonomic level of the OrthoDB group: ', sel),
          h(
            'p',
            { class: 'muted' },
            'OrthoDB offers one group per taxonomic level. We load the broadest group of at most 1,500 genes by default (very large groups are several MB); pick another to compare. Different levels can contain different species.',
          ),
          odb.info
            ? h(
                'p',
                { class: 'muted' },
                `Group ${odb.info.value.id}: "${odb.info.value.name || 'unnamed'}", ${fmt(odb.info.value.geneCount ?? 0)} genes in ${fmt(odb.info.value.speciesCount ?? 0)} species.`,
              )
            : null,
        ),
      );
    }
    const cards = h('div', {
      style: 'display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px',
    });
    const card = (big: string, small: string, tip?: string): HTMLElement =>
      h(
        'div',
        { class: 'card', style: 'margin:0', ...(tip ? { title: tip } : {}) },
        h('div', { style: 'font-size:26px;font-weight:700' }, big),
        h('div', { class: 'muted' }, small),
      );
    cards.append(
      card(fmt(sum.species), 'species with a call in this source'),
      card(String(sum.cladeCount), 'lineage groups'),
      card(fmt(sum.multiCopySpecies), 'species with several genes (1:many)'),
      card(
        isHuman ? 'this gene' : sum.hasHuman ? 'yes' : 'no',
        'human call in this source',
        sum.hasHuman || isHuman ? undefined : 'Absence in this source is not absence in the genome.',
      ),
    );
    box.append(cards);
    if (!isHuman && !sum.hasHuman && all.length > 0)
      box.append(
        h(
          'div',
          { class: 'notice info' },
          'This source lists no human gene for this protein. That is not evidence that humans lack it: the source may not cover it, or may have placed human genes in a different group.',
        ),
      );
    if (all.length === 0) {
      box.append(
        h(
          'div',
          { class: 'notice warn' },
          `${name} returned no ortholog calls for ${symbol}. This is not the same as "no other species have this gene": plants, fungi and bacteria are often outside this source's coverage. Try the other source tab.`,
        ),
      );
      return box;
    }
    box.append(
      h('div', { class: 'card diagram' }, h('h3', {}, 'Species per lineage group'), lineageChartSvg(all)),
    );

    // Filters
    const controls = h('div', { class: 'card' });
    const clade = h(
      'select',
      {
        'aria-label': 'Lineage group filter',
        onchange: (e: Event) => {
          filter.clade = (e.target as HTMLSelectElement).value;
          filter.shown = PAGE;
          drawTable();
        },
      },
      h('option', { value: '' }, 'All lineage groups'),
    );
    for (const c of cladeCounts(all))
      clade.append(h('option', { value: c.clade.key }, `${c.clade.label} (${c.species})`));
    const text = h('input', {
      type: 'search',
      placeholder: 'Search species, symbol, description',
      'aria-label': 'Search the table',
      style: 'min-width:260px',
      oninput: (e: Event) => {
        filter.text = (e.target as HTMLInputElement).value;
        filter.shown = PAGE;
        drawTable();
      },
    });
    const sort = h('select', {
      'aria-label': 'Sort by',
      onchange: (e: Event) => {
        filter.sort = (e.target as HTMLSelectElement).value as SortKey;
        drawTable();
      },
    });
    for (const [v, l] of [
      ['clade', 'Lineage group'],
      ['species', 'Species name'],
      ['symbol', 'Gene symbol'],
      ['taxon', 'Taxon ID'],
    ] as const)
      sort.append(h('option', { value: v }, `Sort: ${l}`));
    const dirBtn = h(
      'button',
      {
        class: 'btn',
        type: 'button',
        'aria-label': 'Reverse sort order',
        onclick: () => {
          filter.dir = filter.dir === 1 ? -1 : 1;
          drawTable();
        },
      },
      '⇅',
    );
    const exportBtn = h(
      'button',
      {
        class: 'btn',
        type: 'button',
        onclick: () => {
          const rows = visible();
          const info = {
            source: name,
            method: rows[0]?.call.value.method ?? name,
            query: `${symbol} (${query})`,
            fetchedAt: d.fetchedAt,
            appVersion: ctx.appVersion,
          };
          void ctx.save(`${symbol}-${source}-orthologs.csv`, orthologCsv(rows, info), 'utf8', {
            name: 'CSV',
            ext: 'csv',
          });
        },
      },
      'Export table (CSV)',
    );
    controls.append(
      h(
        'div',
        { style: 'display:flex;gap:10px;flex-wrap:wrap;align-items:center' },
        clade,
        text,
        sort,
        dirBtn,
        exportBtn,
      ),
    );
    box.append(controls);
    const tableBox = h('div', { class: 'card' });
    box.append(tableBox);
    box.append(
      h(
        'div',
        { class: 'card' },
        h('h3', {}, 'Paralogs'),
        h(
          'p',
          { class: 'muted' },
          `${name} data loaded here lists orthologs only; it does not provide paralogs (same-species relatives), so none are shown. Separate sources would be needed.`,
        ),
      ),
    );

    /** Rows after filter and sort. */
    function visible(): OrthologRow[] {
      return sortRows(filterRows(all, { clade: filter.clade, text: filter.text }), filter.sort, filter.dir);
    }
    /** Redraws only the table (keeps the focused search box). */
    function drawTable(): void {
      const rows = visible();
      const shown = rows.slice(0, filter.shown);
      const table = h(
        'table',
        {},
        h(
          'thead',
          {},
          h(
            'tr',
            {},
            h('th', {}, 'Species'),
            h('th', {}, 'Taxon'),
            h('th', {}, 'Gene (as the source labels it)'),
            h('th', {}, 'Lineage group'),
            h('th', { title: 'Not provided by this source' }, 'Orthology type'),
            h('th', { title: 'Not provided by this source' }, 'Identity'),
            h('th', {}, 'Actions'),
          ),
        ),
      );
      const tb = h('tbody');
      for (const r of shown) {
        const v = r.call.value;
        const acts = h('td');
        if (v.geneId) {
          const t: Target = { kind: 'ncbi_gene', id: v.geneId };
          acts.append(
            h('button', { class: 'chip', type: 'button', onclick: () => ctx.openGene(t) }, 'Open gene'),
            h(
              'button',
              {
                class: 'chip',
                type: 'button',
                onclick: () => compare.request(t, `${v.symbol} (${v.taxon.scientificName})`),
              },
              'Compare',
            ),
          );
        } else {
          acts.append(
            h(
              'button',
              {
                class: 'chip',
                type: 'button',
                title:
                  'This source gives no NCBI Gene ID for the row, so the symbol is searched in that species; you will be asked to choose if it is ambiguous.',
                onclick: () => ctx.search(v.symbol, { id: v.taxon.id, name: v.taxon.scientificName }),
              },
              'Search symbol in species',
            ),
          );
        }
        tb.append(
          h(
            'tr',
            {},
            h(
              'td',
              {},
              v.taxon.scientificName,
              v.taxon.commonName ? h('span', { class: 'muted' }, ` (${v.taxon.commonName})`) : null,
            ),
            h('td', { class: 'mono' }, String(v.taxon.id)),
            h(
              'td',
              {},
              h('strong', {}, v.symbol),
              v.description ? h('span', { class: 'muted' }, ` ${v.description}`) : null,
              h('div', { class: 'muted', style: 'font-size:12px' }, `${r.call.source} ${r.call.recordId}`),
            ),
            h('td', {}, r.clade.label),
            h('td', { class: 'muted' }, '–'),
            h('td', { class: 'muted' }, '–'),
            acts,
          ),
        );
      }
      table.append(tb);
      const more =
        rows.length > shown.length
          ? h(
              'button',
              {
                class: 'btn',
                type: 'button',
                onclick: () => {
                  filter.shown += PAGE * 2;
                  drawTable();
                },
              },
              `Show more (${fmt(rows.length - shown.length)} hidden)`,
            )
          : null;
      setChildren(
        tableBox,
        h(
          'p',
          { class: 'muted', 'aria-live': 'polite' },
          `Showing ${fmt(shown.length)} of ${fmt(rows.length)} rows (${fmt(all.length)} in this source). "–" means this source does not provide the value; we never estimate it.`,
        ),
        table,
        more,
      );
    }
    drawTable();
    return box;
  }

  scope.add(state.subscribe(draw));
  pick('ncbi');
  return root;
}
