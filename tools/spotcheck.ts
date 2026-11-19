// Collects the facts the app shows for the test genes (through the app's own API client, parsers and selection rules, over the
// live network) so tools/spotcheck.py can compare them with an independent look at other endpoints. Writes JSON.
import { promises as fs } from 'node:fs';
import { NetClient, NetError } from '../electron/net';
import { GeneApi } from '../src/api/client';
import type { Transport } from '../src/api/client';
import { GeneView, chooseTranscript } from '../src/core/gene-view';
import { resolveQuery } from '../src/core/resolve';
import { parseTaxonId } from '../src/shared/ids';
import type { AppError } from '../src/shared/types';

const client = new NetClient({ fetchImpl: fetch, cache: null, userAgent: 'GeneExplorer-spotcheck' });
let n = 0;
/** Maps NetClient errors to the app's IpcResult shape. */
const fail = (e: unknown): { ok: false; error: AppError } => ({
  ok: false,
  error: e instanceof NetError ? e.app : { kind: 'network_down', message: String(e) },
});
const transport: Transport = {
  fetchJson: async (_id, spec) => {
    try {
      const r = await client.request(`sc-${++n}`, { url: spec.url, kind: 'json' });
      return { ok: true, value: { data: JSON.parse(r.text) as unknown, meta: r.meta } };
    } catch (e) {
      return fail(e);
    }
  },
  fetchText: async (_id, spec) => {
    try {
      const r = await client.request(`sc-${++n}`, { url: spec.url, kind: 'text' });
      return { ok: true, value: { data: r.text, meta: r.meta } };
    } catch (e) {
      return fail(e);
    }
  },
};

// [query, taxon, ortholog species to ask NCBI about]
const GENES: [string, number, number | null][] = [
  ['TP53', 9606, 10090],
  ['CDK1', 9606, 10090],
  ['Trp53', 10090, 9606],
  ['tp53', 7955, 9606],
  ['lacZ', 511145, 9606],
  ['FLC', 3702, 9606],
  ['wg', 7227, 9606],
  ['CDC28', 559292, 9606],
  ['rbcL', 3702, 9606],
];

async function main(): Promise<void> {
  const api = new GeneApi(transport);
  const out = [];
  for (const [q, tax, orthTax] of GENES) {
    const t0 = performance.now();
    const taxon = parseTaxonId(tax);
    const r = await resolveQuery(api, q, taxon ?? undefined);
    if (!r.ok || r.value.kind !== 'resolved') {
      out.push({ query: q, taxon: tax, error: r.ok ? r.value.kind : r.error.message });
      continue;
    }
    const v = r.value;
    const view = new GeneView(v.gene, v.protein, v.identity, v.notes, {
      api,
      fromCache: () => false,
      isCancelled: () => false,
    });
    view.start();
    await new Promise((res) => setTimeout(res, 100));
    // Wait for panels (poll).
    for (
      let i = 0;
      i < 200 &&
      (view.structure.status === 'loading' ||
        view.transcripts.status === 'loading' ||
        view.structure.status === 'idle');
      i++
    )
      await new Promise((res) => setTimeout(res, 100));
    const g = v.gene?.value;
    const loc = g?.locations[0];
    const tr = view.transcripts.status === 'ready' ? view.transcripts.data : null;
    const t = tr ? tr.value.transcripts[chooseTranscript(tr).index] : undefined;
    const st = view.structure.status === 'ready' ? view.structure.data.models[0] : undefined;
    let ortholog: { geneId?: string; symbol: string; taxon: number; nomenclatureId?: string } | null = null;
    if (v.gene && orthTax) {
      const o = await api.getNcbiOrthologs(v.gene.value.geneId, [parseTaxonId(orthTax) ?? (1 as never)]);
      const c = o.ok ? o.value.find((x) => x.value.geneId !== v.gene?.value.geneId) : undefined;
      let nomen: string | undefined;
      if (c?.value.geneId) {
        const og = await api.getNcbiGene(c.value.geneId);
        nomen = og.ok ? og.value.genes[0]?.value.nomenclature?.identifier : undefined;
      }
      ortholog = c
        ? {
            symbol: c.value.symbol,
            taxon: c.value.taxon.id,
            ...(c.value.geneId ? { geneId: c.value.geneId } : {}),
            ...(nomen ? { nomenclatureId: nomen } : {}),
          }
        : null;
    }
    out.push({
      query: q,
      taxon: tax,
      orthologTaxon: orthTax,
      symbol: g?.symbol,
      name: g?.description,
      geneId: g?.geneId,
      nomenclatureId: g?.nomenclature?.identifier,
      organism: g?.taxon.scientificName,
      chromosome: g?.chromosomes.join(','),
      sequence: loc?.sequenceAccession,
      begin: loc?.begin,
      end: loc?.end,
      strand: loc?.strand,
      transcript: t?.accession,
      proteinOnly: t?.proteinOnly,
      exonsDisplayed: t?.exons.length,
      accession: v.protein?.value.accession,
      proteinLength: v.protein?.value.sequenceLength,
      meanPlddt: st?.value.meanPlddt,
      ortholog,
      appMs: Math.round(performance.now() - t0),
    });
  }
  await fs.writeFile(
    'scratch/spotcheck-app.json',
    JSON.stringify({ at: new Date().toISOString(), genes: out }, null, 1),
  );
  console.log(`app facts for ${out.length} genes written`);
}
void main();
