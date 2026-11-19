// Application controller: shell layout, routing (with back/forward), the search flow, loading a gene, theme, toasts.
import type { UniProtSearchHit } from '../api/parse';
import { GeneView } from '../core/gene-view';
import { resolveQuery } from '../core/resolve';
import type { Resolution } from '../core/resolve';
import { classifyQuery } from '../core/search';
import { parseTaxonId } from '../shared/ids';
import type { TaxonId } from '../shared/ids';
import type { Sourced } from '../shared/types';
import type { FetchMeta, IpcResult, MenuCommand } from '../shared/types';
import { AppCtxImpl } from './app-ctx';
import type { TaxonPick } from './ctx';
import { clear, h, setChildren } from './dom';
import { addRecent, loadPrefs, savePrefs } from './prefs';
import type { Prefs, Target } from './prefs';
import { observeNet, Session } from './services';
import { createStatusBar } from './status-bar';
import { aboutPage, sourcesDrawer } from './views/about';
import { genePage } from './views/gene-page';
import { friendlyError } from './views/panel';
import type { GenePage } from './views/gene-page';
import {
  candidatePanel,
  exampleChips,
  failurePanel,
  hitList,
  inactivePanel,
  searchForm,
} from './views/search';

type Route =
  | { kind: 'home' }
  | { kind: 'search'; query: string; taxon: TaxonPick | null }
  | { kind: 'gene'; target: Target; tab: number }
  | { kind: 'about' };

/** Starts the app inside the given root element. */
export async function startApp(root: HTMLElement): Promise<void> {
  const loaded = loadPrefs();
  let prefs: Prefs = loaded.prefs;
  const info = await window.geneExplorer.getAppInfo();
  const metaByUrl = new Map<string, FetchMeta>();
  const status = createStatusBar();
  observeNet({
    onFetched: (m) => {
      metaByUrl.set(m.url, m);
      status.noteFetch(m);
    },
  });

  // ---- shell
  const back = h(
    'button',
    { type: 'button', 'aria-label': 'Back', title: 'Back (Alt+Left)', onclick: () => step(-1) },
    '←',
  );
  const fwd = h(
    'button',
    { type: 'button', 'aria-label': 'Forward', title: 'Forward (Alt+Right)', onclick: () => step(1) },
    '→',
  );
  const topQ = h('input', {
    type: 'search',
    'aria-label': 'Quick search',
    placeholder: 'Quick search (gene symbol or ID)',
    style:
      'flex:0 1 340px;padding:6px 10px;border-radius:8px;border:1px solid rgba(255,255,255,.4);background:rgba(255,255,255,.95);color:#12263f',
  });
  const aboutBtn = h('button', { type: 'button', onclick: () => go({ kind: 'about' }) }, 'About & limits');
  const themeBtn = h(
    'button',
    {
      type: 'button',
      'aria-label': 'Toggle dark mode',
      title: 'Toggle dark mode (Ctrl/Cmd+D)',
      onclick: () => toggleTheme(),
    },
    '◐',
  );
  const top = h(
    'header',
    { class: 'topbar' },
    back,
    fwd,
    h('h1', {}, 'GeneExplorer'),
    topQ,
    h('span', { class: 'grow' }),
    aboutBtn,
    themeBtn,
  );
  const rail = h('nav', { class: 'rail', 'aria-label': 'Recent and favorite genes' });
  const main = h('main', { id: 'main', tabindex: -1 });
  const toastBox = h('div', {
    role: 'status',
    'aria-live': 'polite',
    style: 'position:fixed;bottom:44px;left:50%;transform:translateX(-50%);z-index:100',
  });
  clear(root);
  root.append(top, rail, main, status.el, toastBox);

  // ---- theme
  const applyTheme = (): void => {
    if (prefs.theme === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', prefs.theme);
  };
  const isDark = (): boolean =>
    prefs.theme === 'system'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
      : prefs.theme === 'dark';
  const toggleTheme = (): void => updatePrefs((p) => ({ ...p, theme: isDark() ? 'light' : 'dark' }));
  const updatePrefs = (fn: (p: Prefs) => Prefs): void => {
    prefs = fn(prefs);
    if (!savePrefs(prefs))
      toast('Could not save your settings (storage unavailable); they will last until you close the app.');
    applyTheme();
    drawRail();
  };
  applyTheme();

  // ---- toasts
  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  const toast = (message: string): void => {
    setChildren(
      toastBox,
      h('div', { class: 'notice info', style: 'box-shadow:var(--shadow-hover);max-width:70vw' }, message),
    );
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => clear(toastBox), 4500);
  };
  if (loaded.recovered)
    toast(
      'Your saved recents and favorites could not be read, so they were reset (a copy of the old data was kept).',
    );

  // ---- routing
  const stack: Route[] = [];
  let pos = -1;
  let session: Session | null = null;
  let page: GenePage | null = null;
  let lastTaxon: TaxonPick | null = null;
  let lastQuery = '';
  let currentView: GeneView | null = null;
  let drawer: HTMLElement | null = null;

  const ctx = new AppCtxImpl({
    appVersion: info.version,
    newApi: () => {
      const s = new Session();
      return { api: s.api, cancel: () => s.cancel() };
    },
    loadGeneView: async (target) => {
      const s = new Session();
      const res = await resolveQuery(s.api, target.id);
      if (!res.ok) return { ok: false, message: friendlyError(res.error) };
      const v = res.value;
      if (v.kind !== 'resolved')
        return { ok: false, message: 'message' in v ? v.message : 'That gene could not be resolved.' };
      const view = new GeneView(v.gene, v.protein, v.identity, v.notes, {
        api: s.api,
        fromCache: (url) => (url ? metaByUrl.get(url)?.fromCache === true : false),
        isCancelled: () => s.isCancelled,
      });
      view.start();
      return { ok: true, view, cancel: () => s.cancel() };
    },
    openGene: (target) => go({ kind: 'gene', target, tab: 0 }),
    search: (query, taxon) => go({ kind: 'search', query, taxon }),
    prefs: () => prefs,
    updatePrefs,
    toast,
    showSources: (view) => {
      drawer?.remove();
      drawer = sourcesDrawer(ctx, view, () => {
        drawer?.remove();
        drawer = null;
      });
      root.append(drawer);
    },
  });

  /** Navigates to a route (pushing it on the history unless replaying). */
  function go(route: Route, push = true): void {
    if (push) {
      stack.splice(pos + 1);
      stack.push(route);
      pos = stack.length - 1;
    }
    back.toggleAttribute('disabled', pos <= 0);
    fwd.toggleAttribute('disabled', pos >= stack.length - 1);
    void render(route);
  }
  function step(d: -1 | 1): void {
    const np = pos + d;
    const r = stack[np];
    if (!r) return;
    pos = np;
    go(r, false);
  }

  /** Stops everything belonging to the previous screen. */
  function leave(): void {
    session?.cancel();
    session = null;
    page?.dispose();
    page = null;
    currentView = null;
    drawer?.remove();
    drawer = null;
  }

  const getApi = () => (session ??= new Session()).api;
  /** Branded taxon ID of the chosen species, if any. */
  const taxId = (t: TaxonPick | null): TaxonId | undefined =>
    t ? (parseTaxonId(t.id) ?? undefined) : undefined;

  async function render(route: Route): Promise<void> {
    leave();
    main.scrollTo({ top: 0 });
    if (route.kind === 'home') return renderHome();
    if (route.kind === 'about') {
      setChildren(main, aboutPage(ctx, info, currentView));
      return;
    }
    if (route.kind === 'search') return renderSearch(route.query, route.taxon);
    return renderGene(route.target, route.tab);
  }

  // ---- home
  let form = searchForm(ctx, getApi, { query: lastQuery, taxon: lastTaxon });
  function renderHome(notice?: Node): void {
    form = searchForm(ctx, getApi, { query: lastQuery, taxon: lastTaxon });
    setChildren(
      main,
      h('h2', {}, 'Pick any gene in any organism'),
      h(
        'p',
        { class: 'muted' },
        'See what it is, where it lives, what it looks like in 3D, with the source of every fact visible.',
      ),
      h('div', { class: 'card' }, form.el),
      notice ?? null,
      exampleChips(ctx),
      h(
        'div',
        { class: 'notice info' },
        'Educational use only. Predictions and annotations can be wrong; this is not medical advice.',
      ),
    );
    form.focus();
  }
  topQ.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && topQ.value.trim())
      go({ kind: 'search', query: topQ.value.trim(), taxon: lastTaxon });
  });

  // ---- search flow
  async function renderSearch(query: string, taxon: TaxonPick | null): Promise<void> {
    lastQuery = query;
    lastTaxon = taxon;
    topQ.value = query;
    const q = classifyQuery(query);
    if (q.kind === 'empty')
      return renderHome(
        h('div', { class: 'notice warn' }, 'Type a gene symbol, a gene or protein name, or an ID first.'),
      );
    if (q.kind === 'too_long')
      return renderHome(
        h('div', { class: 'notice warn' }, `Please keep the search under ${q.max} characters.`),
      );
    form = searchForm(ctx, getApi, { query, taxon });
    const results = h(
      'div',
      {},
      h('div', { class: 'skeleton' }),
      h('div', { class: 'skeleton', style: 'width:70%' }),
    );
    setChildren(main, h('div', { class: 'card' }, form.el), results);
    const s = new Session();
    session = s;
    const api = s.api;
    const retry = (): void => go({ kind: 'search', query, taxon }, false);
    /** Shows a hit list or an explanation. */
    const showHits = (r: IpcResult<Sourced<UniProtSearchHit[]>>, title: string): void => {
      if (s.isCancelled) return;
      if (!r.ok) return setChildren(results, failurePanel(r.error, retry));
      if (r.value.value.length === 0)
        return setChildren(
          results,
          h(
            'div',
            { class: 'notice info' },
            `No UniProt entries matched${taxon ? ` in ${taxon.name}` : ''}. Check the spelling, pick a different species, or try the NCBI Gene ID.`,
          ),
        );
      setChildren(results, hitList(ctx, getApi, r.value, title));
    };
    const show = (res: IpcResult<Resolution>): void => {
      if (s.isCancelled) return;
      if (!res.ok) return setChildren(results, failurePanel(res.error, retry));
      const v = res.value;
      if (v.kind === 'resolved') {
        const t: Target | null = v.gene
          ? { kind: 'ncbi_gene', id: v.gene.value.geneId }
          : v.protein
            ? { kind: 'uniprot', id: v.protein.value.accession }
            : null;
        if (t) {
          // A search that lands on exactly one gene replaces its own history entry, so Back returns to where the user was.
          const gene: Route = { kind: 'gene', target: t, tab: 0 };
          stack[pos] = gene;
          return void go(gene, false);
        }
      } else if (v.kind === 'ambiguous')
        setChildren(results, candidatePanel(ctx, v.message, v.candidates, query));
      else if (v.kind === 'inactive') setChildren(results, inactivePanel(ctx, v.entry));
      else
        setChildren(
          results,
          h('div', { class: v.kind === 'not_found' ? 'notice warn' : 'notice info' }, v.message),
        );
    };
    switch (q.kind) {
      case 'uniprot':
      case 'uniprot_isoform':
      case 'ncbi_gene':
      case 'refseq':
        return show(await resolveQuery(api, query, taxId(taxon)));
      case 'symbol':
        if (taxon) return show(await resolveQuery(api, query, taxId(taxon)));
        return showHits(
          await api.searchUniProtSymbolAny(q.symbol),
          `Genes named "${q.symbol}" in any species`,
        );
      case 'free_text':
        return showHits(await api.searchUniProtText(q.text, taxId(taxon)), `Matches for "${q.text}"`);
      case 'ensembl_gene':
        return showHits(await api.searchUniProtEnsembl(q.id), `UniProt entries cross-referencing ${q.id}`);
      default:
        return setChildren(
          results,
          h(
            'div',
            { class: 'notice info' },
            'This kind of ID is not searchable yet. Use a gene symbol, a gene or protein name, an NCBI Gene ID, a UniProt accession, an Ensembl gene ID or a RefSeq accession.',
          ),
        );
    }
  }

  // ---- gene page
  async function renderGene(target: Target, tab: number): Promise<void> {
    const s = new Session();
    session = s;
    setChildren(
      main,
      h(
        'div',
        { class: 'card' },
        h('div', { class: 'skeleton', style: 'width:30%;height:28px' }),
        h('div', { class: 'skeleton' }),
        h('div', { class: 'skeleton', style: 'width:60%' }),
      ),
    );
    const res = await resolveQuery(s.api, target.id);
    if (s.isCancelled) return;
    if (!res.ok)
      return setChildren(
        main,
        failurePanel(res.error, () => go({ kind: 'gene', target, tab }, false)),
      );
    const v = res.value;
    if (v.kind === 'inactive') return setChildren(main, inactivePanel(ctx, v.entry));
    if (v.kind === 'ambiguous')
      return setChildren(main, candidatePanel(ctx, v.message, v.candidates, target.id));
    if (v.kind !== 'resolved')
      return setChildren(main, h('div', { class: 'notice warn' }, 'message' in v ? v.message : 'Not found.'));
    const view = new GeneView(v.gene, v.protein, v.identity, v.notes, {
      api: s.api,
      fromCache: (url) => (url ? metaByUrl.get(url)?.fromCache === true : false),
      isCancelled: () => s.isCancelled,
    });
    currentView = view;
    page = genePage(ctx, view, tab);
    setChildren(main, page.el);
    view.start();
    const entry = page.entry;
    updatePrefs((p) => addRecent(p, entry));
    document.title = `${page.entry.label} · GeneExplorer`;
  }

  // ---- rail
  function drawRail(): void {
    const mk = (title: string, items: Prefs['recents']): HTMLElement => {
      const ul = h('ul');
      if (items.length === 0) ul.append(h('li', { class: 'muted', style: 'padding:6px 8px' }, 'Nothing yet'));
      for (const e of items)
        ul.append(
          h(
            'li',
            {},
            h(
              'button',
              { type: 'button', onclick: () => go({ kind: 'gene', target: e.target, tab: 0 }) },
              e.label,
              h('span', { class: 'sub' }, e.sub),
            ),
          ),
        );
      return h('section', {}, h('h2', {}, title), ul);
    };
    setChildren(
      rail,
      h(
        'button',
        { class: 'btn', type: 'button', style: 'width:100%', onclick: () => go({ kind: 'home' }) },
        'New search',
      ),
      mk('Favorites', prefs.favorites),
      mk('Recent', prefs.recents),
    );
  }
  drawRail();

  // ---- menu commands
  window.geneExplorer.onMenuCommand((c: MenuCommand) => {
    if (c === 'focus-search') {
      go({ kind: 'home' });
      form.focus();
    } else if (c === 'nav-back') step(-1);
    else if (c === 'nav-forward') step(1);
    else if (c === 'toggle-dark') toggleTheme();
    else if (c === 'export-report') void page?.exportReport();
    else if (c === 'tab-1' || c === 'tab-2' || c === 'tab-3' || c === 'tab-4' || c === 'tab-5')
      page?.selectTab(Number(c.slice(4)) - 1);
    else toast('That command is not available in this milestone yet.');
  });
  window.addEventListener('keydown', (e) => {
    if (e.altKey && e.key === 'ArrowLeft') step(-1);
    if (e.altKey && e.key === 'ArrowRight') step(1);
  });

  go({ kind: 'home' });
}
