// MANUAL live check: one small request per allowlisted host through the real NetClient. Prints PASS/FAIL, latency, bytes.
// Hits the real network. Run: npm run smoke:live
import { NetClient, NetError } from '../electron/net';

const CHECKS: { source: string; url: string; headers?: Record<string, string> }[] = [
  {
    source: 'UniProt',
    url: 'https://rest.uniprot.org/uniprotkb/search?query=gene_exact%3AlacZ%20AND%20organism_id%3A83333&fields=accession&size=1',
  },
  {
    source: 'NCBI Datasets',
    url: 'https://api.ncbi.nlm.nih.gov/datasets/v2/taxonomy/taxon_suggest/zebrafish',
  },
  { source: 'AlphaFold DB', url: 'https://alphafold.ebi.ac.uk/api/prediction/P00722' },
  { source: 'OrthoDB', url: 'https://data.orthodb.org/v12/group?id=9758603at2' },
  {
    source: 'Ensembl',
    url: 'https://rest.ensembl.org/info/ping',
    headers: { 'Content-Type': 'application/json' },
  },
];

async function main(): Promise<void> {
  const client = new NetClient({
    fetchImpl: fetch,
    cache: null,
    userAgent: 'GeneExplorer-live-smoke',
    maxRetries: 1,
  });
  console.log(`LIVE smoke test, ${new Date().toISOString()}`);
  let failed = 0;
  for (const c of CHECKS) {
    const t = Date.now();
    try {
      const r = await client.request(c.source, {
        url: c.url,
        kind: 'json',
        ...(c.headers ? { headers: c.headers } : {}),
      });
      console.log(`PASS ${c.source.padEnd(14)} ${String(Date.now() - t).padStart(5)} ms ${r.meta.bytes} B`);
    } catch (e) {
      failed++;
      console.log(
        `FAIL ${c.source.padEnd(14)} ${String(Date.now() - t).padStart(5)} ms ${e instanceof NetError ? `${e.app.kind}: ${e.app.message}` : String(e)}`,
      );
    }
  }
  process.exitCode = failed > 0 ? 1 : 0;
}

void main();
