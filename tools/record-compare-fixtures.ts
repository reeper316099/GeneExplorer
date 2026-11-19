// Records the REAL responses the Species and Compare views need (human TP53 orthologs, lineages, OrthoDB groups, mouse Trp53,
// E. coli lacZ) into tests/fixtures/api, merging into index.json. URLs are built with the app's own endpoint builders so the
// recordings match exactly what the app asks for. Run: node scripts/run-tool.mjs tools/record-compare-fixtures.ts
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { NetClient, NetError } from '../electron/net';
import { endpoints } from '../src/api/endpoints';
import { parseNcbiOrthologs } from '../src/api/parse';
import { parseNcbiGeneId, parseOrthoDbGroupId, parseTaxonId, parseUniProtAccession } from '../src/shared/ids';
import type { TaxonId } from '../src/shared/ids';

const OUT = path.resolve('tests/fixtures/api');
const need = <T>(v: T | null): T => {
  if (v === null) throw new Error('bad id');
  return v;
};

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

async function main(): Promise<void> {
  const client = new NetClient({ fetchImpl: fetch, cache: null, userAgent: 'GeneExplorer-fixture-recorder' });
  const index = JSON.parse(await fs.readFile(path.join(OUT, 'index.json'), 'utf8')) as {
    entries: Entry[];
  } & Record<string, unknown>;
  const put = async (
    name: string,
    url: string,
    note: string,
    kind: 'json' | 'text' = 'json',
    ext = 'json',
  ): Promise<string | null> => {
    try {
      const r = await client.request(name, { url, kind });
      const file = `${name}.${ext}`;
      await fs.writeFile(path.join(OUT, file), r.text);
      index.entries = index.entries.filter((e) => e.name !== name);
      index.entries.push({
        name,
        method: 'GET',
        url,
        status: 200,
        file,
        bytes: r.meta.bytes,
        recordedAt: new Date(r.meta.fetchedAt).toISOString(),
        note,
        label: 'REAL recorded response',
      });
      console.log(`recorded ${name} (${r.meta.bytes} B)`);
      return r.text;
    } catch (e) {
      console.log(`FAILED ${name}: ${e instanceof NetError ? `${e.app.kind} ${e.app.message}` : String(e)}`);
      return null;
    }
  };

  const tp53 = need(parseNcbiGeneId('7157'));
  const orth = await put(
    'ncbi-orthologs-tp53-all',
    endpoints.ncbiOrthologs(tp53, []),
    'All NCBI orthologs of human TP53',
  );
  if (orth) {
    const calls = parseNcbiOrthologs(JSON.parse(orth), {
      url: '',
      fetchedAt: 0,
      fromCache: false,
      stale: false,
      bytes: 0,
    });
    if (calls.ok) {
      // Same steps as the app: drop the query gene itself, then sort the unique taxon IDs.
      const others = calls.value.filter((c) => c.value.geneId !== tp53);
      const ids = ([...new Set(others.map((c) => c.value.taxon.id))] as TaxonId[]).sort((a, b) => a - b);
      for (let i = 0, n = 0; i < ids.length; i += 100, n++)
        await put(
          `ncbi-taxa-tp53-batch${n}`,
          endpoints.ncbiTaxa(ids.slice(i, i + 100)),
          'Lineages of TP53 ortholog species',
        );
    }
  }
  const p53 = need(parseUniProtAccession('P04637'));
  const search = await put(
    'orthodb-search-p04637',
    endpoints.orthodbSearch(p53),
    'OrthoDB groups containing human TP53',
  );
  const group = need(parseOrthoDbGroupId('4289813at2759'));
  if (search) {
    await put('orthodb-group-tp53', endpoints.orthodbGroup(group), 'OrthoDB group details');
    await put(
      'orthodb-orthologs-tp53-all',
      endpoints.orthodbOrthologs(group, []),
      'All members of the Eukaryota TP53 group',
    );
  }
  // Mouse Trp53 (close pair) and E. coli lacZ (no ortholog in NCBI beyond itself).
  const mouse = need(parseNcbiGeneId('22059'));
  await put('ncbi-gene-mouse-trp53', endpoints.ncbiGeneById(mouse), 'Mouse Trp53 gene report');
  await put('ncbi-product-mouse-trp53', endpoints.ncbiProductReport(mouse), 'Mouse Trp53 transcripts');
  await put(
    'ncbi-seqreport-mouse-chr11',
    endpoints.ncbiSequenceReport('GCF_000001635.27', '11'),
    'Mouse chromosome 11 length',
  );
  const m = need(parseUniProtAccession('P02340'));
  await put('uniprot-entry-mouse-p53', endpoints.uniprotEntry(m), 'Mouse p53 UniProt entry');
  await put('alphafold-mouse-p53', endpoints.alphafoldPrediction(m), 'AlphaFold prediction list, mouse p53');
  await put(
    'alphafold-mouse-p53-model',
    'https://alphafold.ebi.ac.uk/files/AF-P02340-F1-model_v6.pdb',
    'AlphaFold model, mouse p53',
    'text',
    'pdb',
  );
  const mouseTaxon = need(parseTaxonId(10090));
  await put(
    'ncbi-orthologs-tp53-mouse',
    endpoints.ncbiOrthologs(tp53, [mouseTaxon]),
    'NCBI orthologs of TP53 filtered to mouse',
  );
  await put(
    'ncbi-taxon-suggest-mouse',
    endpoints.ncbiTaxonSuggest('mouse'),
    'Species autocomplete for "mouse"',
  );
  const lacz = need(parseNcbiGeneId('945006'));
  await put(
    'orthodb-search-o03042',
    endpoints.orthodbSearch(need(parseUniProtAccession('O03042'))),
    'OrthoDB search with no group (rbcL): data and bigdata are null',
  );
  await put(
    'alphafold-lacz-model',
    'https://alphafold.ebi.ac.uk/files/AF-P00722-F1-model_v6.pdb',
    'AlphaFold model, E. coli lacZ',
    'text',
    'pdb',
  );
  await put('ncbi-gene-id-lacz', endpoints.ncbiGeneById(lacz), 'E. coli lacZ gene report by ID');
  await put('ncbi-orthologs-lacz', endpoints.ncbiOrthologs(lacz, []), 'NCBI orthologs of E. coli lacZ');
  await put(
    'orthodb-search-p00722',
    endpoints.orthodbSearch(need(parseUniProtAccession('P00722'))),
    'OrthoDB groups containing lacZ',
  );
  need(parseTaxonId(9606));
  await fs.writeFile(path.join(OUT, 'index.json'), JSON.stringify(index, null, 2));
}
void main();
