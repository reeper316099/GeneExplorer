// Renderer bootstrap. Phase 2 only has a "connection check" that asks the main process to call each allowlisted host.
import './styles/tokens.css';
import './styles/base.css';
import type { FetchSpec } from './shared/types';

interface Check {
  label: string;
  spec: FetchSpec;
}

// One small request per source (URLs verified in Phase 1).
const CHECKS: Check[] = [
  {
    label: 'UniProt',
    spec: {
      url: 'https://rest.uniprot.org/uniprotkb/search?query=gene_exact%3AlacZ%20AND%20organism_id%3A83333&fields=accession&size=1',
    },
  },
  {
    label: 'NCBI Datasets',
    spec: { url: 'https://api.ncbi.nlm.nih.gov/datasets/v2/taxonomy/taxon_suggest/zebrafish' },
  },
  { label: 'AlphaFold DB', spec: { url: 'https://alphafold.ebi.ac.uk/api/prediction/P00722' } },
  { label: 'OrthoDB', spec: { url: 'https://data.orthodb.org/v12/group?id=9758603at2' } },
  {
    label: 'Ensembl',
    spec: { url: 'https://rest.ensembl.org/info/ping', headers: { 'Content-Type': 'application/json' } },
  },
];

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text?: string,
  cls?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (cls) e.className = cls;
  return e;
}

/** Run one check through the typed IPC bridge and render the outcome (success/cache/error) in its table row. */
async function runCheck(check: Check, cell: HTMLElement): Promise<void> {
  cell.textContent = 'checking…';
  cell.className = '';
  const started = performance.now();
  const res = await window.geneExplorer.fetchJson(crypto.randomUUID(), check.spec);
  const ms = Math.round(performance.now() - started);
  if (res.ok) {
    const m = res.value.meta;
    cell.textContent = `OK, ${m.bytes} B, ${ms} ms${m.fromCache ? (m.stale ? ' (stale cache)' : ' (cache)') : ''}`;
    cell.className = 'ok';
  } else {
    cell.textContent = `${res.error.kind}: ${res.error.message}`;
    cell.className = 'bad';
  }
}

async function main(): Promise<void> {
  const app = document.getElementById('app');
  const status = document.getElementById('status');
  if (!app || !status) return;

  const info = await window.geneExplorer.getAppInfo();
  const card = el('section', undefined, 'card');
  card.append(el('h2', 'Connection check'));
  card.append(
    el(
      'p',
      `Requests go renderer → typed IPC → main-process net layer (allowlist, rate limit, cache). Client: ${info.userAgent}.`,
    ),
  );
  const table = el('table');
  const cells: { check: Check; cell: HTMLElement }[] = [];
  for (const check of CHECKS) {
    const row = table.insertRow();
    row.insertCell().textContent = check.label;
    const cell = row.insertCell();
    cells.push({ check, cell });
  }
  const button = el('button', 'Run check');
  button.addEventListener('click', () => {
    void Promise.all(cells.map(({ check, cell }) => runCheck(check, cell)));
  });
  card.append(table, button);
  app.append(card);

  // Status bar: poll cache/network state (cache size, offline, waiting on Retry-After).
  const refresh = async () => {
    const i = await window.geneExplorer.cacheInfo();
    const wait = i.status.waiting[0];
    status.textContent = wait
      ? `${wait.reason}: retrying ${wait.host} in ${Math.max(0, Math.ceil((wait.retryAt - Date.now()) / 1000))} s`
      : `${i.status.offline ? 'Offline (cache only) · ' : ''}Cache: ${i.stats.entries} items, ${(i.stats.bytes / 1048576).toFixed(1)} MB`;
  };
  void refresh();
  setInterval(() => void refresh(), 1000);

  window.geneExplorer.onMenuCommand((command) => {
    status.textContent = `Menu command: ${command}`;
  });
}

void main();
