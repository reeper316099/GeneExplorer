// LIVE smoke test (manual, uses the network): for each test gene, resolves it through the app's own client and parsers and
// asks every source for its part, reporting PASS/FAIL, latency and schema drift (a response the zod schemas reject is "DRIFT").
// Run: npm run smoke:live   (writes scratch/smoke-live.json and prints a table)
import { promises as fs } from 'node:fs';
import { NetClient, NetError } from '../electron/net';
import { GeneApi } from '../src/api/client';
import type { Transport } from '../src/api/client';
import { resolveQuery } from '../src/core/resolve';
import { parseTaxonId } from '../src/shared/ids';
import type { AppError, IpcResult } from '../src/shared/types';

const client = new NetClient({ fetchImpl: fetch, cache: null, userAgent: 'GeneExplorer-smoke-test' });
interface Call {
  host: string;
  ms: number;
  ok: boolean;
  kind?: string;
}
let calls: Call[] = [];
let n = 0;
/** Times one request and records its host, latency and outcome. */
async function timed<T>(url: string, run: () => Promise<T>, ok: (v: T) => boolean): Promise<T> {
  const t = performance.now();
  const v = await run();
  calls.push({ host: new URL(url).hostname, ms: Math.round(performance.now() - t), ok: ok(v) });
  return v;
}
const err = (e: unknown): { ok: false; error: AppError } => ({
  ok: false,
  error: e instanceof NetError ? e.app : { kind: 'network_down', message: String(e) },
});
const transport: Transport = {
  fetchJson: (_id, spec) =>
    timed(
      spec.url,
      async (): Promise<IpcResult<{ data: unknown; meta: never }>> => {
        try {
          const r = await client.request(`sm-${++n}`, { url: spec.url, kind: 'json' });
          return { ok: true, value: { data: JSON.parse(r.text) as unknown, meta: r.meta as never } };
        } catch (e) {
          return err(e);
        }
      },
      (v) => v.ok,
    ),
  fetchText: (_id, spec) =>
    timed(
      spec.url,
      async () => {
        try {
          const r = await client.request(`sm-${++n}`, { url: spec.url, kind: 'text' });
          return { ok: true as const, value: { data: r.text, meta: r.meta } };
        } catch (e) {
          return err(e);
        }
      },
      (v) => v.ok,
    ),
};

const GENES: [string, number][] = [
  ['TP53', 9606],
  ['Trp53', 10090],
  ['tp53', 7955],
  ['lacZ', 511145],
  ['FLC', 3702],
  ['wg', 7227],
  ['CDC28', 559292],
  ['rbcL', 3702],
];

async function main(): Promise<void> {
  const api = new GeneApi(transport);
  const started = new Date();
  const rows: Record<string, string>[] = [];
  for (const [q, tax] of GENES) {
    calls = [];
    const row: Record<string, string> = { gene: `${q} (${tax})` };
    const r = await resolveQuery(api, q, parseTaxonId(tax) ?? undefined);
    const drift = (e: AppError): string => (e.kind === 'bad_response' ? 'DRIFT' : 'FAIL');
    if (!r.ok) {
      row['NCBI gene'] = drift(r.error);
      rows.push(row);
      continue;
    }
    const v = r.value;
    row['NCBI gene'] = v.kind === 'resolved' && v.gene ? 'PASS' : 'FAIL';
    row['UniProt'] = v.kind === 'resolved' && v.protein ? 'PASS' : 'FAIL';
    const gid = v.kind === 'resolved' ? v.gene?.value.geneId : undefined;
    const acc = v.kind === 'resolved' ? v.protein?.value.accession : undefined;
    if (gid) {
      const p = await api.getTranscripts(gid);
      row['NCBI product'] = p.ok ? 'PASS' : drift(p.error);
      const o = await api.getNcbiOrthologs(gid, [parseTaxonId(9606) ?? (1 as never)]);
      row['NCBI orthologs'] = o.ok ? 'PASS' : drift(o.error);
    }
    if (acc) {
      const a = await api.getAlphaFoldModels(acc);
      row['AlphaFold'] = a.ok ? (a.value.length ? 'PASS' : 'PASS (no model)') : drift(a.error);
      const d = await api.searchOrthoDb(acc);
      row['OrthoDB'] = d.ok ? (d.value.value.length ? 'PASS' : 'PASS (no group)') : drift(d.error);
    }
    const by = new Map<string, number[]>();
    for (const c of calls) by.set(c.host, [...(by.get(c.host) ?? []), c.ms]);
    row['latency ms (median per host)'] = [...by]
      .map(([h, ms]) => `${h.split('.')[0]}=${[...ms].sort((x, y) => x - y)[Math.floor(ms.length / 2)]}`)
      .join(' ');
    rows.push(row);
  }
  const cols = [
    'gene',
    'NCBI gene',
    'UniProt',
    'NCBI product',
    'NCBI orthologs',
    'AlphaFold',
    'OrthoDB',
    'latency ms (median per host)',
  ];
  console.log(
    `LIVE smoke test, started ${started.toString()} (network required; results are a snapshot of the services at this time)\n`,
  );
  console.log(`| ${cols.join(' | ')} |\n|${cols.map(() => '---').join('|')}|`);
  for (const r of rows) console.log(`| ${cols.map((c) => r[c] ?? '-').join(' | ')} |`);
  const all = rows.flatMap((r) => Object.values(r));
  const bad = all.filter((x) => x === 'FAIL' || x === 'DRIFT').length;
  console.log(
    `\n${bad === 0 ? 'ALL PASS' : `${bad} problem(s)`}; schema drift = a response the zod schemas rejected.`,
  );
  await fs.writeFile(
    'scratch/smoke-live.json',
    JSON.stringify({ started: started.toISOString(), rows }, null, 1),
  );
  process.exitCode = bad === 0 ? 0 : 1;
}
void main();
