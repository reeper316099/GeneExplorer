// About / Limitations page and the per-gene Sources drawer.
import type { GeneView } from '../../core/gene-view';
import type { AppInfo, CacheInfo } from '../../shared/types';
import { fmt, fmtTime, h, setChildren } from '../dom';
import { linkOut } from '../ctx';
import type { AppCtx } from '../ctx';

/** Builds the Sources drawer: every record behind the page, with database, record ID, fetch time and request URL. */
export function sourcesDrawer(ctx: AppCtx, view: GeneView, close: () => void): HTMLElement {
  const rows: { what: string; source: string; id: string; at: number; url?: string }[] = [];
  const add = (
    what: string,
    r: { source: string; recordId: string; fetchedAt: number; url?: string } | null | undefined,
  ): void => {
    if (r)
      rows.push({
        what,
        source: r.source,
        id: r.recordId,
        at: r.fetchedAt,
        ...(r.url ? { url: r.url } : {}),
      });
  };
  add('Gene record (names, type, location, summary, GO)', view.gene);
  add('Protein record (function, features, isoforms, GO)', view.protein);
  if (view.transcripts.status === 'ready') add('Transcripts and exons', view.transcripts.data);
  if (view.structure.status === 'ready')
    add('3D structure record', view.structure.data.models[view.structure.data.selected]);
  const table = h(
    'table',
    {},
    h(
      'thead',
      {},
      h(
        'tr',
        {},
        h('th', {}, 'What'),
        h('th', {}, 'Database'),
        h('th', {}, 'Record'),
        h('th', {}, 'Fetched'),
      ),
    ),
  );
  const tb = h('tbody');
  for (const r of rows) {
    tb.append(
      h(
        'tr',
        {},
        h('td', {}, r.what),
        h('td', {}, r.source),
        h('td', { class: 'mono' }, r.id),
        h('td', {}, fmtTime(r.at)),
      ),
    );
    if (r.url)
      tb.append(
        h(
          'tr',
          {},
          h('td', { colspan: 4, class: 'muted mono', style: 'font-size:12px;overflow-wrap:anywhere' }, r.url),
        ),
      );
  }
  table.append(tb);
  return h(
    'aside',
    { class: 'drawer', role: 'dialog', 'aria-label': 'Sources' },
    h(
      'div',
      { style: 'display:flex;align-items:center' },
      h('h2', { style: 'flex:1;margin:0' }, 'Sources'),
      h('button', { class: 'btn', type: 'button', onclick: close }, 'Close'),
    ),
    h(
      'p',
      { class: 'muted' },
      'Every fact on the page comes from one of these records. Hover a value (dotted underline) to see its own source. Records from different databases are linked only by cross-references and are never merged.',
    ),
    rows.length ? table : h('p', { class: 'muted' }, 'No records loaded yet.'),
    ctx ? null : null,
  );
}

/** Builds the About / Limitations page. */
export function aboutPage(ctx: AppCtx, info: AppInfo, view: GeneView | null): HTMLElement {
  const root = h('div', {}, h('h2', {}, 'About GeneExplorer and its limits'));
  root.append(
    h(
      'div',
      { class: 'card' },
      h('h3', {}, 'Educational use only'),
      h(
        'p',
        {},
        'GeneExplorer is an educational and research-exploration tool. It is not medical advice, not a diagnostic tool, and nothing in it should be used for clinical decisions.',
      ),
    ),
  );

  const meaning = h('div', { class: 'card' }, h('h3', {}, 'What the labels mean, and their limits'));
  meaning.append(
    h(
      'p',
      {},
      h('strong', {}, 'Annotation. '),
      'Reviewed (Swiss-Prot) UniProt entries are checked by curators. Unreviewed (TrEMBL) entries and GO terms with evidence IEA are produced automatically and can be wrong or incomplete. Annotation quality varies enormously between species.',
    ),
    h(
      'p',
      {},
      h('strong', {}, 'Identity. '),
      'Same symbol does not mean same gene. This app links an NCBI gene to a UniProt protein only through database cross-references and shows the evidence; it never matches on the symbol alone.',
    ),
    h(
      'p',
      {},
      h('strong', {}, 'Isoforms. '),
      "A gene can make several proteins. UniProt's canonical isoform is shown first and the others can be selected; the feature track and the 3D structure describe the canonical isoform.",
    ),
    h(
      'p',
      {},
      h('strong', {}, 'Predicted structures. '),
      "AlphaFold models are computational predictions, not experiments. pLDDT is the model's own per-residue confidence (above 90 very high, 70-90 confident, 50-70 low, below 50 very low); low-confidence regions are often disordered. Predictions are not validated for clinical use.",
    ),
    h(
      'p',
      {},
      h('strong', {}, 'Orthology (later milestones). '),
      'Orthology is inferred, different resources can disagree, and "no ortholog found in a source" does not mean the species lacks the gene.',
    ),
  );
  root.append(meaning);

  const v = view;
  const versions = h('div', { class: 'card' }, h('h3', {}, 'Data sources, versions and terms'));
  const t = h(
    'table',
    {},
    h(
      'thead',
      {},
      h(
        'tr',
        {},
        h('th', {}, 'Source'),
        h('th', {}, 'Used for'),
        h('th', {}, 'Version / date seen'),
        h('th', {}, 'Terms'),
      ),
    ),
  );
  const tb = h('tbody');
  const tr = (cells: (Node | string)[]): void => {
    tb.append(h('tr', {}, ...cells.map((c) => h('td', {}, c))));
  };
  tr([
    'UniProt (rest.uniprot.org)',
    'Protein names, function, features, isoforms, GO, cross-references',
    v?.protein
      ? `entry version ${v.protein.value.entryVersion}, annotation updated ${v.protein.value.lastAnnotationUpdate}`
      : 'open a gene to see',
    h('span', {}, 'CC BY 4.0 ', linkOut(ctx, 'licence', 'https://www.uniprot.org/help/license')),
  ]);
  tr([
    'NCBI Datasets (api.ncbi.nlm.nih.gov)',
    'Gene records, location, transcripts, exons',
    v?.gene?.value.annotationName
      ? `annotation release ${v.gene.value.annotationName}${v.gene.value.annotationDate ? ` (${v.gene.value.annotationDate})` : ''}`
      : 'open a gene to see',
    h(
      'span',
      {},
      'US government information is public domain; users must check the licence of linked material. ',
      linkOut(ctx, 'policies', 'https://www.ncbi.nlm.nih.gov/home/about/policies/'),
    ),
  ]);
  tr([
    'AlphaFold DB (alphafold.ebi.ac.uk)',
    '3D structure predictions and pLDDT',
    v?.structure.status === 'ready'
      ? `model v${v.structure.data.models[v.structure.data.selected]?.value.modelVersion ?? '?'}`
      : 'open a gene to see',
    h(
      'span',
      {},
      'CC BY 4.0, for academic and commercial use, as stated in the header of each model file; "theoretical modelling only". ',
      linkOut(ctx, 'AlphaFold DB', 'https://alphafold.ebi.ac.uk/'),
    ),
  ]);
  tr([
    'OrthoDB (data.orthodb.org)',
    'Orthologous groups and orthologs',
    'API v12',
    h('span', {}, 'CC BY 4.0 ', linkOut(ctx, 'OrthoDB', 'https://www.orthodb.org/')),
  ]);
  tr([
    'Ensembl (rest.ensembl.org)',
    'Not used: unreachable from the development network, so its data is not shown',
    '-',
    '-',
  ]);
  t.append(tb);
  versions.append(t);
  root.append(versions);

  root.append(
    h(
      'div',
      { class: 'card' },
      h('h3', {}, 'Please cite'),
      h(
        'ul',
        {},
        h(
          'li',
          {},
          'Jumper, J. et al. Highly accurate protein structure prediction with AlphaFold. Nature 596, 583-589 (2021).',
        ),
        h(
          'li',
          {},
          'Varadi, M. et al. AlphaFold Protein Structure Database in 2024: providing structure coverage for over 214 million protein sequences. Nucleic Acids Research 52, D368-D375 (2024).',
        ),
        h(
          'li',
          {},
          'The UniProt Consortium. UniProt: the Universal Protein Knowledgebase (see uniprot.org/help/publications for the current reference).',
        ),
        h(
          'li',
          {},
          'NCBI Gene and RefSeq (see ncbi.nlm.nih.gov/home/about/policies/ for how to cite NCBI resources).',
        ),
      ),
      h(
        'p',
        { class: 'muted' },
        '3D viewer: 3Dmol.js (BSD-3-Clause), Rego & Koes, Bioinformatics 31, 1322 (2015).',
      ),
    ),
  );

  const cache = h('div', { class: 'card' }, h('h3', {}, 'Cache and app'));
  const stats = h('p', {}, 'Reading cache size…');
  const clearBtn = h(
    'button',
    {
      class: 'btn',
      type: 'button',
      onclick: () => {
        if (clearBtn.dataset['armed'] !== '1') {
          clearBtn.dataset['armed'] = '1';
          clearBtn.textContent = 'Click again to confirm: delete all cached data';
          return;
        }
        clearBtn.dataset['armed'] = '0';
        clearBtn.textContent = 'Clear cache';
        void window.geneExplorer.clearCache().then((r) => {
          ctx.toast(r.ok ? 'Cache cleared.' : `Could not clear the cache: ${r.error.message}`);
          void refresh();
        });
      },
    },
    'Clear cache',
  );
  const refresh = async (): Promise<void> => {
    const c: CacheInfo = await window.geneExplorer.cacheInfo();
    setChildren(
      stats,
      `${fmt(c.stats.entries)} cached items, ${(c.stats.bytes / 1048576).toFixed(1)} MB of ${(c.stats.maxBytes / 1048576).toFixed(0)} MB. Cached items let genes you have viewed before open offline.`,
    );
  };
  void refresh();
  cache.append(
    stats,
    clearBtn,
    h(
      'p',
      { class: 'muted' },
      `${info.name} ${info.version} · Electron ${info.electron} · ${info.platform}. Network requests identify as "${info.userAgent}" and contain nothing personal.`,
    ),
  );
  root.append(cache);
  return root;
}
