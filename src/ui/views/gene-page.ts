// Gene page: header (identity, badges, favorite, sources) plus the tab strip and the active tab.
import type { GeneView } from '../../core/gene-view';
import { h, setChildren } from '../dom';
import { copyChip, Scope } from '../ctx';
import type { AppCtx } from '../ctx';
import { unifiedRecordJson } from '../exports';
import { entryKey } from '../prefs';
import type { PrefEntry, Target } from '../prefs';
import { locationTab } from './location';
import { overviewTab } from './overview';
import { proteinTab } from './protein';

export const TABS = ['Overview', 'Location', 'Protein & Structure'] as const;

export interface GenePage {
  el: HTMLElement;
  /** Switches to tab index 0-2. */
  selectTab(i: number): void;
  dispose(): void;
  /** The entry that identifies this gene in recents/favorites. */
  entry: PrefEntry;
}

/** Picks the identifier used to reopen this gene later (NCBI Gene ID preferred, else UniProt). */
export function targetOf(view: GeneView): Target | null {
  if (view.gene) return { kind: 'ncbi_gene', id: view.gene.value.geneId };
  if (view.protein) return { kind: 'uniprot', id: view.protein.value.accession };
  return null;
}

/** Builds the gene page for a view model. */
export function genePage(ctx: AppCtx, view: GeneView, initialTab = 0): GenePage {
  const g = view.gene?.value;
  const p = view.protein?.value;
  const symbol = g?.symbol ?? p?.geneNames.primary ?? p?.accession ?? 'Unknown gene';
  const full = g?.description || p?.proteinName || 'name not available';
  const taxon = g?.taxon ?? p?.taxon;
  const target = targetOf(view) ?? { kind: 'uniprot', id: 'unknown' };
  const entry: PrefEntry = {
    target,
    label: symbol,
    sub: `${full} · ${taxon?.scientificName ?? 'unknown organism'}`.slice(0, 160),
    at: Date.now(),
  };
  const root = h('div');
  const scope = new Scope();

  const star = h(
    'button',
    {
      class: 'star',
      type: 'button',
      'aria-label': 'Favorite',
      'aria-pressed': 'false',
      title: 'Add to favorites',
    },
    '★',
  );
  const syncStar = (): void => {
    const on = ctx.prefs().favorites.some((f) => entryKey(f.target) === entryKey(target));
    star.setAttribute('aria-pressed', String(on));
    star.title = on ? 'Remove from favorites' : 'Add to favorites';
  };
  star.addEventListener('click', () => {
    ctx.updatePrefs((pr) => {
      const has = pr.favorites.some((f) => entryKey(f.target) === entryKey(target));
      return {
        ...pr,
        favorites: has
          ? pr.favorites.filter((f) => entryKey(f.target) !== entryKey(target))
          : [{ ...entry, at: Date.now() }, ...pr.favorites].slice(0, 200),
      };
    });
    syncStar();
  });
  syncStar();

  const lineage = p?.lineage.length ? p.lineage : [];
  const crumbs = h(
    'div',
    { class: 'crumbs', 'aria-label': 'Lineage' },
    [...lineage, taxon?.scientificName ?? ''].filter(Boolean).join(' › '),
  );
  const head = h('div', { class: 'card geneheader' });
  head.append(
    h(
      'div',
      { style: 'display:flex;align-items:center;gap:10px' },
      h('h2', {}, symbol),
      star,
      h('span', { class: 'grow', style: 'flex:1' }),
      h(
        'button',
        {
          class: 'btn',
          type: 'button',
          title: 'Save the unified record (every fact with its source) as JSON',
          onclick: () =>
            void ctx.save(`${symbol}-record.json`, unifiedRecordJson(view, ctx.appVersion), 'utf8', {
              name: 'JSON',
              ext: 'json',
            }),
        },
        'Export JSON',
      ),
      ' ',
      h('button', { class: 'btn', type: 'button', onclick: () => ctx.showSources(view) }, 'Sources'),
    ),
    h('div', { class: 'name' }, full),
    h(
      'div',
      {},
      taxon ? h('strong', {}, taxon.scientificName) : null,
      taxon?.commonName ? ` (${taxon.commonName})` : '',
      taxon ? ` · taxon ${taxon.id}` : '',
    ),
    crumbs,
  );
  const badges = h('div', { style: 'margin-top:6px' });
  if (g)
    badges.append(
      h(
        'span',
        { class: 'badge neutral', title: 'NCBI Gene record found' },
        `NCBI Gene · ${g.type.replace(/_/g, ' ').toLowerCase()}`,
      ),
    );
  if (p)
    badges.append(
      h(
        'span',
        { class: `badge ${p.reviewed ? 'good' : 'warn'}` },
        p.reviewed ? 'UniProt reviewed (curated)' : 'UniProt unreviewed (automatic annotation)',
      ),
    );
  if (view.identity)
    badges.append(
      h(
        'span',
        {
          class: `badge ${view.identity.status === 'confirmed' ? 'good' : 'warn'}`,
          title: view.identity.evidence.join(' '),
        },
        `Gene–protein link: ${view.identity.status.replace('_', ' ')}`,
      ),
    );
  head.append(badges);
  const chips = h('div', { style: 'margin-top:6px' });
  if (g) chips.append(copyChip(ctx, 'NCBI Gene', g.geneId, view.gene));
  if (p) chips.append(copyChip(ctx, 'UniProt', p.accession, view.protein));
  for (const e of g?.ensemblGeneIds.slice(0, 1) ?? []) chips.append(copyChip(ctx, 'Ensembl', e, view.gene));
  head.append(chips);
  root.append(head);

  const tablist = h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Gene sections' });
  const panel = h('div', { role: 'tabpanel', tabindex: 0 });
  root.append(tablist, panel);
  let index = initialTab;
  const buttons = TABS.map((name, i) =>
    h(
      'button',
      {
        role: 'tab',
        type: 'button',
        id: `tab-${i}`,
        'aria-selected': 'false',
        tabindex: -1,
        onclick: () => selectTab(i),
        onkeydown: (e: Event) => {
          const k = (e as KeyboardEvent).key;
          if (k === 'ArrowRight' || k === 'ArrowLeft') {
            e.preventDefault();
            selectTab((i + (k === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length, true);
          }
        },
      },
      name,
    ),
  );
  tablist.append(...buttons);
  let tabScope = new Scope();
  function selectTab(i: number, focus = false): void {
    index = i;
    tabScope.dispose();
    tabScope = new Scope();
    buttons.forEach((b, j) => {
      b.setAttribute('aria-selected', String(i === j));
      b.tabIndex = i === j ? 0 : -1;
    });
    panel.setAttribute('aria-labelledby', `tab-${i}`);
    setChildren(
      panel,
      i === 0
        ? overviewTab(ctx, view)
        : i === 1
          ? locationTab(ctx, view, tabScope)
          : proteinTab(ctx, view, tabScope),
    );
    if (focus) buttons[i]?.focus();
  }
  selectTab(index);
  return {
    el: root,
    selectTab: (i) => selectTab(i),
    dispose: () => {
      tabScope.dispose();
      scope.dispose();
    },
    entry,
  };
}
