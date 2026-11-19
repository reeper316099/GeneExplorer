// Records the REAL responses behind one app request into tests/fixtures/api (merging into index.json), using the app's own client.
// Usage: node scripts/run-tool.mjs tools/record-gene.ts <kind> <arg> [taxonId]
//   kinds: symbol-any <SYMBOL> | ensembl <ENSG...> | refseq <NM_...> | text <free text> [taxon] | orthologs <geneId> <taxonId>
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { NetClient, NetError } from '../electron/net';
import { GeneApi } from '../src/api/client';
import type { Transport } from '../src/api/client';
import { parseEnsemblGeneId, parseNcbiGeneId, parseTaxonId } from '../src/shared/ids';
import type { AppError } from '../src/shared/types';

const OUT = path.resolve('tests/fixtures/api');
const client = new NetClient({ fetchImpl: fetch, cache: null, userAgent: 'GeneExplorer-fixture-recorder' });
interface Entry {
  name: string;
  method: 'GET';
  url: string;
  status: number;
  file: string;
  bytes: number;
  recordedAt: string;
  note: string;
  label: string;
}
const saved: Entry[] = [];
let k = 0;
const [kind = '', arg = '', extra] = process.argv.slice(2);
const slug = `${kind}-${arg}${extra ? `-${extra}` : ''}`.replace(/[^\w]+/g, '_').slice(0, 60);

/** Fetches through the NetClient and stores the answer as a fixture named after the request. */
async function rec(
  url: string,
  as: 'json' | 'text',
): Promise<{ ok: true; text: string } | { ok: false; error: AppError }> {
  try {
    const r = await client.request(`rg-${++k}`, { url, kind: as });
    const name = `${slug}-${k}`;
    const file = `${name}.${as === 'json' ? 'json' : 'txt'}`;
    await fs.writeFile(path.join(OUT, file), r.text);
    saved.push({
      name,
      method: 'GET',
      url,
      status: 200,
      file,
      bytes: r.meta.bytes,
      recordedAt: new Date(r.meta.fetchedAt).toISOString(),
      note: `recorded for ${kind} ${arg}`,
      label: 'REAL recorded response',
    });
    return { ok: true, text: r.text };
  } catch (e) {
    return { ok: false, error: e instanceof NetError ? e.app : { kind: 'network_down', message: String(e) } };
  }
}
const transport: Transport = {
  fetchJson: async (_i, spec) => {
    const r = await rec(spec.url, 'json');
    return r.ok
      ? {
          ok: true,
          value: {
            data: JSON.parse(r.text) as unknown,
            meta: {
              url: spec.url,
              fetchedAt: Date.now(),
              fromCache: false,
              stale: false,
              bytes: r.text.length,
            },
          },
        }
      : r;
  },
  fetchText: async (_i, spec) => {
    const r = await rec(spec.url, 'text');
    return r.ok
      ? {
          ok: true,
          value: {
            data: r.text,
            meta: {
              url: spec.url,
              fetchedAt: Date.now(),
              fromCache: false,
              stale: false,
              bytes: r.text.length,
            },
          },
        }
      : r;
  },
};

async function main(): Promise<void> {
  const api = new GeneApi(transport);
  if (kind === 'symbol-any') await api.searchUniProtSymbolAny(arg);
  else if (kind === 'ensembl')
    await api.searchUniProtEnsembl(
      parseEnsemblGeneId(arg) ??
        (() => {
          throw new Error('bad id');
        })(),
    );
  else if (kind === 'refseq') await api.getNcbiGeneByAccession(arg);
  else if (kind === 'text')
    await api.searchUniProtText(arg, extra ? (parseTaxonId(extra) ?? undefined) : undefined);
  else if (kind === 'orthologs')
    await api.getNcbiOrthologs(
      parseNcbiGeneId(arg) ??
        (() => {
          throw new Error('bad id');
        })(),
      extra ? [parseTaxonId(extra) ?? (1 as never)] : [],
    );
  else throw new Error('unknown kind');
  const idx = JSON.parse(await fs.readFile(path.join(OUT, 'index.json'), 'utf8')) as { entries: Entry[] };
  const urls = new Set(saved.map((s) => s.url));
  idx.entries = [...idx.entries.filter((e) => !urls.has(e.url)), ...saved];
  await fs.writeFile(path.join(OUT, 'index.json'), JSON.stringify(idx, null, 2));
  console.log(`recorded ${saved.length} fixture(s) for ${kind} ${arg}`);
}
void main();
