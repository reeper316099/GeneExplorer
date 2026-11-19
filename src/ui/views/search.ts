// Home / search views: the search form (with species autocomplete and example chips), the grouped results list,
// and the disambiguation panel that makes the user choose explicitly.
import type { GeneApi } from '../../api/client';
import type { UniProtSearchHit } from '../../api/parse';
import type { GeneRecord, InactiveEntry, TaxonCandidate } from '../../shared/domain';
import type { Sourced } from '../../shared/types';
import { h, setChildren } from '../dom';
import { provTitle } from '../ctx';
import type { AppCtx, TaxonPick } from '../ctx';
import { friendlyError } from './panel';
import type { AppError } from '../../shared/types';

export type IdKind = 'auto' | 'symbol' | 'ncbi_gene' | 'uniprot' | 'ensembl' | 'refseq' | 'text';

export interface ExampleGene {
  label: string;
  query: string;
  taxon: TaxonPick | null;
  note: string;
}

// A deliberately diverse set (verified in the Phase 4 test-gene run): human, mouse, zebrafish, bacterium, plant, fly, yeast, organelle gene.
export const EXAMPLES: readonly ExampleGene[] = [
  {
    label: 'TP53 · human',
    query: 'TP53',
    taxon: { id: 9606, name: 'Homo sapiens' },
    note: 'well-curated human tumour suppressor',
  },
  {
    label: 'Trp53 · mouse',
    query: 'Trp53',
    taxon: { id: 10090, name: 'Mus musculus' },
    note: 'same gene, mouse naming style',
  },
  {
    label: 'tp53 · zebrafish',
    query: 'tp53',
    taxon: { id: 7955, name: 'Danio rerio' },
    note: 'same gene, zebrafish naming style',
  },
  {
    label: 'lacZ · E. coli',
    query: 'lacZ',
    taxon: { id: 511145, name: 'Escherichia coli str. K-12 substr. MG1655' },
    note: 'bacterial gene',
  },
  {
    label: 'FLC · Arabidopsis',
    query: 'FLC',
    taxon: { id: 3702, name: 'Arabidopsis thaliana' },
    note: 'plant gene',
  },
  {
    label: 'wg · fruit fly',
    query: 'wg',
    taxon: { id: 7227, name: 'Drosophila melanogaster' },
    note: 'Wingless, a developmental gene',
  },
  {
    label: 'CDC28 · yeast',
    query: 'CDC28',
    taxon: { id: 559292, name: 'Saccharomyces cerevisiae S288C' },
    note: 'cell-cycle kinase',
  },
  {
    label: 'rbcL · Arabidopsis',
    query: 'rbcL',
    taxon: { id: 3702, name: 'Arabidopsis thaliana' },
    note: 'chloroplast-encoded gene (not on a chromosome)',
  },
  {
    label: 'TTN · human',
    query: 'TTN',
    taxon: { id: 9606, name: 'Homo sapiens' },
    note: 'titin, the largest human protein (tests very long sequences)',
  },
  {
    label: 'COX1 · human',
    query: 'COX1',
    taxon: { id: 9606, name: 'Homo sapiens' },
    note: 'a symbol that is only an alias in human (disambiguation)',
  },
];

export interface SearchForm {
  el: HTMLElement;
  focus(): void;
  set(query: string, taxon: TaxonPick | null): void;
}

/** Builds the search form. `getApi` supplies the client used for species autocomplete. */
export function searchForm(
  ctx: AppCtx,
  getApi: () => GeneApi,
  initial: { query: string; taxon: TaxonPick | null },
): SearchForm {
  let taxon: TaxonPick | null = initial.taxon;
  const q = h('input', {
    type: 'text',
    class: 'q',
    placeholder: 'Gene symbol, name, or ID (NCBI, UniProt, Ensembl, RefSeq)',
    'aria-label': 'Search genes',
    value: initial.query,
  });
  const sp = h('input', {
    type: 'text',
    role: 'combobox',
    'aria-label': 'Species (optional)',
    'aria-expanded': 'false',
    'aria-autocomplete': 'list',
    'aria-controls': 'species-list',
    placeholder: 'Species (optional), e.g. zebrafish',
    autocomplete: 'off',
    value: taxon?.name ?? '',
  });
  const list = h('ul', { id: 'species-list', role: 'listbox', hidden: true });
  const combo = h('div', { class: 'combo' }, sp, list);
  const kind = h('select', { 'aria-label': 'Identifier type' });
  for (const [v, l] of [
    ['auto', 'Detect automatically'],
    ['symbol', 'Gene symbol'],
    ['ncbi_gene', 'NCBI Gene ID'],
    ['uniprot', 'UniProt accession'],
    ['ensembl', 'Ensembl gene ID'],
    ['refseq', 'RefSeq accession'],
    ['text', 'Name (free text)'],
  ] as const)
    kind.append(h('option', { value: v }, l));
  const advanced = h(
    'div',
    { hidden: true, style: 'margin-top:8px' },
    h('label', {}, 'Treat the search text as: ', kind),
  );
  const advBtn = h(
    'button',
    {
      class: 'btn',
      type: 'button',
      'aria-expanded': 'false',
      onclick: () => {
        const open = advanced.hasAttribute('hidden');
        advanced.toggleAttribute('hidden', !open);
        advBtn.setAttribute('aria-expanded', String(open));
      },
    },
    'Advanced',
  );
  const go = h('button', { class: 'btn primary', type: 'button', onclick: () => submit() }, 'Search');
  const form = h('div', { class: 'searchbox', role: 'search' }, q, combo, go, advBtn);

  let timer: ReturnType<typeof setTimeout> | undefined;
  let candidates: TaxonCandidate[] = [];
  let active = -1;
  const hideList = (): void => {
    list.setAttribute('hidden', '');
    sp.setAttribute('aria-expanded', 'false');
    active = -1;
  };
  const pick = (c: TaxonCandidate): void => {
    taxon = { id: c.id, name: c.scientificName };
    sp.value = `${c.scientificName}${c.commonName ? ` (${c.commonName})` : ''}`;
    hideList();
  };
  const drawList = (): void => {
    setChildren(list);
    candidates.forEach((c, i) =>
      list.append(
        h(
          'li',
          {
            role: 'option',
            id: `sp-${i}`,
            'aria-selected': String(i === active),
            onmousedown: (e: Event) => {
              e.preventDefault();
              pick(c);
            },
          },
          `${c.scientificName}${c.commonName ? ` (${c.commonName})` : ''} · taxon ${c.id}${c.rank ? ` · ${c.rank}` : ''}`,
        ),
      ),
    );
    list.toggleAttribute('hidden', candidates.length === 0);
    sp.setAttribute('aria-expanded', String(candidates.length > 0));
  };
  sp.addEventListener('input', () => {
    taxon = null;
    clearTimeout(timer);
    const text = sp.value.trim();
    if (text.length < 2) {
      candidates = [];
      return drawList();
    }
    timer = setTimeout(() => {
      void getApi()
        .searchTaxa(text)
        .then((r) => {
          if (!r.ok) {
            candidates = [];
            return drawList();
          }
          candidates = r.value.value
            .filter(
              (c) =>
                c.rank === 'species' ||
                c.rank === 'subspecies' ||
                c.rank === undefined ||
                (c.reviewedProteinCount ?? 0) > 0,
            )
            .slice(0, 8);
          active = -1;
          drawList();
        });
    }, 250);
  });
  sp.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (candidates.length === 0) return;
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + candidates.length) % candidates.length;
      drawList();
      sp.setAttribute('aria-activedescendant', `sp-${active}`);
    } else if (e.key === 'Enter' && active >= 0 && candidates[active] !== undefined) {
      e.preventDefault();
      pick(candidates[active] as TaxonCandidate);
    } else if (e.key === 'Escape') hideList();
    else if (e.key === 'Enter') submit();
  });
  sp.addEventListener('blur', () => setTimeout(hideList, 120));
  q.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submit();
  });

  /** Submits the search; a species typed but not picked from the list is looked up first so it is never ignored silently. */
  function submit(): void {
    const text = sp.value.trim();
    if (text && !taxon) {
      void getApi()
        .searchTaxa(text)
        .then((r) => {
          const c = r.ok
            ? r.value.value.find(
                (x) =>
                  x.scientificName.toLowerCase() === text.toLowerCase() ||
                  x.commonName?.toLowerCase() === text.toLowerCase(),
              )
            : undefined;
          if (c) pick(c);
          else {
            ctx.toast(
              `Choose a species from the list (or clear the species box). "${text}" was not matched exactly.`,
            );
            sp.focus();
            return;
          }
          run();
        });
      return;
    }
    run();
  }
  const run = (): void => ctx.search(forced(kind.value as IdKind, q.value), taxon);

  const root = h('div', {}, form, advanced);
  return {
    el: root,
    focus: () => {
      q.focus();
      q.select();
    },
    set: (query, t) => {
      q.value = query;
      taxon = t;
      sp.value = t?.name ?? '';
    },
  };
}

/** When the user forces an identifier type, rewrite the text so the classifier reads it that way. */
export function forced(kind: IdKind, text: string): string {
  const t = text.trim();
  if (kind === 'auto' || t === '') return t;
  if (kind === 'ncbi_gene') return /^\d+$/.test(t) ? t : `GeneID:${t.replace(/\D/g, '')}`;
  return t;
}

/** Example chips under the search box. */
export function exampleChips(ctx: AppCtx): HTMLElement {
  const box = h(
    'div',
    { class: 'card' },
    h('h3', {}, 'Try an example'),
    h(
      'p',
      { class: 'muted' },
      'A deliberately mixed set so you can see how different organisms look in the same app.',
    ),
  );
  for (const e of EXAMPLES)
    box.append(
      h(
        'button',
        { class: 'chip', type: 'button', title: e.note, onclick: () => ctx.search(e.query, e.taxon) },
        e.label,
      ),
    );
  return box;
}

export const WHY_ORDER =
  "UniProt lists reviewed (curated Swiss-Prot) entries first, then unreviewed (automatic TrEMBL) ones; inside each group the order is UniProt's own relevance ranking. Results are grouped by species in the order each species first appears. Nothing is hidden or re-ranked by this app.";

/** Renders a hit list grouped by species; AlphaFold availability badges fill in lazily for the first hits. */
export function hitList(
  ctx: AppCtx,
  getApi: () => GeneApi,
  hits: Sourced<UniProtSearchHit[]>,
  title: string,
): HTMLElement {
  const root = h(
    'div',
    {},
    h(
      'h2',
      {},
      title,
      ' ',
      h(
        'button',
        {
          class: 'chip',
          type: 'button',
          title: WHY_ORDER,
          'aria-label': 'Why this order?',
          onclick: () => ctx.toast(WHY_ORDER),
        },
        'Why this order?',
      ),
    ),
  );
  root.append(
    h(
      'p',
      { class: 'muted', title: provTitle(hits) },
      `${hits.value.length} result(s) from UniProt, fetched ${new Date(hits.fetchedAt).toLocaleTimeString()}. Pick the one you mean.`,
    ),
  );
  const groups = new Map<string, UniProtSearchHit[]>();
  for (const x of hits.value) {
    const key = `${x.organismName ?? 'Unknown organism'}${x.commonName ? ` (${x.commonName})` : ''}`;
    groups.set(key, [...(groups.get(key) ?? []), x]);
  }
  let lazy = 0;
  for (const [org, list] of groups) {
    root.append(h('div', { class: 'group-title' }, org));
    for (const x of list) {
      const af = h('span', { class: 'badge neutral' }, '3D model: checking…');
      const card = h(
        'button',
        {
          class: 'result',
          type: 'button',
          onclick: () => ctx.openGene({ kind: 'uniprot', id: x.accession }),
        },
        h(
          'div',
          {},
          h('strong', {}, x.primaryGeneName ?? x.entryName ?? x.accession),
          ' ',
          h('span', { class: 'muted' }, x.proteinName ?? 'name not available'),
        ),
        h(
          'div',
          {},
          h(
            'span',
            { class: `badge ${x.reviewed ? 'good' : 'warn'}` },
            x.reviewed ? 'UniProt reviewed' : 'UniProt unreviewed (automatic)',
          ),
          af,
        ),
        h('div', { class: 'muted mono' }, `${x.accession}${x.length ? ` · ${x.length} aa` : ''}`),
      );
      root.append(card);
      if (lazy++ < 8) {
        void getApi()
          .getAlphaFoldModels(x.accession)
          .then((r) => {
            af.textContent = r.ok
              ? r.value.length
                ? 'has AlphaFold model'
                : 'no AlphaFold model'
              : '3D model: unknown';
            af.className = `badge ${r.ok && r.value.length ? 'good' : 'neutral'}`;
          });
      } else {
        af.textContent = '3D model: not checked';
      }
    }
  }
  return root;
}

/** Renders gene candidates with the evidence for each and requires an explicit choice. */
export function candidatePanel(
  ctx: AppCtx,
  message: string,
  genes: GeneRecord[],
  query: string,
): HTMLElement {
  const root = h(
    'div',
    {},
    h('h2', {}, 'Which gene do you mean?'),
    h('div', { class: 'notice warn' }, message),
  );
  for (const g of genes) {
    const v = g.value;
    const exact = v.symbol.toLowerCase() === query.toLowerCase();
    root.append(
      h(
        'button',
        { class: 'result', type: 'button', onclick: () => ctx.openGene({ kind: 'ncbi_gene', id: v.geneId }) },
        h('div', {}, h('strong', {}, v.symbol), ' ', h('span', { class: 'muted' }, v.description)),
        h(
          'div',
          {},
          h(
            'span',
            { class: `badge ${exact ? 'good' : 'warn'}` },
            exact ? 'official symbol matches' : 'matched via alias or synonym',
          ),
        ),
        h(
          'div',
          { class: 'muted' },
          `${v.taxon.scientificName}${v.taxon.commonName ? ` (${v.taxon.commonName})` : ''} · NCBI Gene ${v.geneId} · ${v.type.replace(/_/g, ' ').toLowerCase()}${v.synonyms.length ? ` · also known as ${v.synonyms.slice(0, 4).join(', ')}` : ''}`,
        ),
        h(
          'div',
          { class: 'muted', title: provTitle(g) },
          `Evidence: NCBI Gene record ${v.geneId}${v.swissProtAccessions.length ? `, reviewed UniProt ${v.swissProtAccessions.join(', ')}` : ', no reviewed UniProt entry listed'}.`,
        ),
      ),
    );
  }
  return root;
}

/** Explains an obsolete UniProt accession and offers its replacements. */
export function inactivePanel(ctx: AppCtx, entry: Sourced<InactiveEntry>): HTMLElement {
  const e = entry.value;
  const root = h('div', {}, h('h2', {}, `${e.accession} is no longer an active UniProt entry`));
  const why = {
    DELETED: 'It was deleted',
    MERGED: 'It was merged into another entry',
    DEMERGED: 'It was split into several entries',
    UNKNOWN: 'UniProt marks it inactive',
  }[e.reason];
  root.append(
    h('div', { class: 'notice warn', title: provTitle(entry) }, `${why}${e.detail ? ` (${e.detail})` : ''}.`),
  );
  if (e.replacedBy.length) {
    root.append(h('p', {}, 'Replaced by: '));
    for (const r of e.replacedBy)
      root.append(
        h(
          'button',
          { class: 'chip', type: 'button', onclick: () => ctx.openGene({ kind: 'uniprot', id: r }) },
          r,
        ),
      );
  } else root.append(h('p', { class: 'muted' }, 'UniProt names no replacement entry.'));
  return root;
}

/** A friendly message box for search failures, with a retry button. */
export function failurePanel(error: AppError, retry: () => void): HTMLElement {
  return h(
    'div',
    {},
    h('div', { class: 'notice error' }, friendlyError(error)),
    h('button', { class: 'btn', type: 'button', onclick: retry }, 'Try again'),
  );
}
