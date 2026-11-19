// Records REAL API responses for a small labelled request list into tests/fixtures/api/ (+ index.json with URL and date).
// Uses the same NetClient as the app, so rate limits and the allowlist apply. Run: npm run fixtures:record
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { NetClient, NetError } from '../electron/net';

const OUT = path.resolve('tests/fixtures/api');
const U = 'https://rest.uniprot.org';
const N = 'https://api.ncbi.nlm.nih.gov/datasets/v2';

interface Item {
  name: string;
  url: string;
  note: string;
  kind?: 'json' | 'text';
  ext?: string;
}

// UniProt fields requested for a gene page (keeps the TP53 entry ~100 KB instead of ~850 KB).
const UP_FIELDS =
  'accession,id,gene_names,gene_primary,protein_name,organism_name,organism_id,reviewed,annotation_score,length,sequence,cc_function,ft_domain,ft_region,go,xref_geneid,xref_refseq,xref_ensembl,xref_orthodb,xref_pdb,xref_alphafolddb,cc_subcellular_location,protein_existence,cc_alternative_products,lineage,sequence_version,version,date_modified';

// Kept small on purpose (large responses such as TP53 orthologs are 1.3 MB); expand as phases need more.
const ITEMS: Item[] = [
  {
    name: 'uniprot-lacz-search',
    url: `${U}/uniprotkb/search?query=gene_exact%3AlacZ%20AND%20organism_id%3A83333&fields=accession&size=1`,
    note: 'E. coli lacZ, UniProt search',
  },
  {
    name: 'uniprot-obsolete-deleted',
    url: `${U}/uniprotkb/Z9Z9Z9.json?fields=${UP_FIELDS}`,
    note: 'Deleted accession: HTTP 200 with entryType Inactive',
  },
  {
    name: 'uniprot-obsolete-demerged',
    url: `${U}/uniprotkb/P0CG05.json?fields=${UP_FIELDS}`,
    note: 'Demerged accession (-> P0DOY2, P0DOY3)',
  },
  {
    name: 'uniprot-taxonomy-zebrafish',
    url: `${U}/taxonomy/search?query=zebrafish&size=3`,
    note: 'Taxonomy search',
  },
  {
    name: 'ncbi-taxon-suggest-zebrafish',
    url: `${N}/taxonomy/taxon_suggest/zebrafish`,
    note: 'NCBI taxonomy autocomplete',
  },
  {
    name: 'ncbi-gene-ecoli-lacz',
    url: `${N}/gene/symbol/lacZ/taxon/511145`,
    note: 'E. coli K-12 lacZ gene report',
  },
  {
    name: 'ncbi-gene-arabidopsis-rbcl',
    url: `${N}/gene/symbol/rbcL/taxon/3702`,
    note: 'Plastid-encoded gene report',
  },
  {
    name: 'ncbi-gene-ecoli-strain-warning',
    url: `${N}/gene/symbol/lacZ/taxon/83333`,
    note: 'Strain-level taxon: warning, no reports',
  },
  {
    name: 'alphafold-lacz',
    url: 'https://alphafold.ebi.ac.uk/api/prediction/P00722',
    note: 'AlphaFold prediction list for lacZ',
  },
  {
    name: 'orthodb-group-bacterial',
    url: 'https://data.orthodb.org/v12/group?id=9758603at2',
    note: 'OrthoDB bacterial group containing lacZ',
  },
  {
    name: 'uniprot-tp53-entry',
    url: `${U}/uniprotkb/P04637.json?fields=${UP_FIELDS}`,
    note: 'Human TP53 entry (trimmed fields)',
  },
  {
    name: 'uniprot-tp53-search',
    url: `${U}/uniprotkb/search?query=gene_exact%3ATP53%20AND%20organism_id%3A9606&fields=accession,id,gene_primary,reviewed,organism_id&size=5`,
    note: 'UniProt symbol search: reviewed and unreviewed hits',
  },
  { name: 'ncbi-gene-human-tp53', url: `${N}/gene/id/7157`, note: 'Human TP53 gene report' },
  {
    name: 'ncbi-orthologs-tp53',
    url: `${N}/gene/id/7157/orthologs?taxon_filter=7955&taxon_filter=10090`,
    note: 'NCBI orthologs of TP53 in mouse and zebrafish',
  },
  { name: 'ncbi-taxon-human', url: `${N}/taxonomy/taxon/9606`, note: 'NCBI taxonomy node for human' },
  {
    name: 'alphafold-tp53',
    url: 'https://alphafold.ebi.ac.uk/api/prediction/P04637',
    note: 'AlphaFold prediction list for TP53',
  },
  {
    name: 'alphafold-insulin',
    url: 'https://alphafold.ebi.ac.uk/api/prediction/P01308',
    note: 'AlphaFold prediction list for insulin (small)',
  },
  {
    name: 'alphafold-insulin-model',
    url: 'https://alphafold.ebi.ac.uk/files/AF-P01308-F1-model_v6.pdb',
    note: 'AlphaFold PDB model for insulin (pLDDT in B-factor)',
    kind: 'text',
    ext: 'pdb',
  },
  {
    name: 'orthodb-search-tp53',
    url: 'https://data.orthodb.org/v12/search?query=P04637&level=7742&species=9606&limit=3',
    note: 'OrthoDB search by UniProt accession',
  },
  {
    name: 'ncbi-gene-symbol-tp53',
    url: `${N}/gene/symbol/TP53/taxon/9606`,
    note: 'NCBI symbol lookup, exact match',
  },
  {
    name: 'ncbi-gene-symbol-cox1-alias',
    url: `${N}/gene/symbol/COX1/taxon/9606`,
    note: 'NCBI symbol lookup that only matches via an alias (COX1 -> PTGS1)',
  },
  {
    name: 'uniprot-search-tp53-human',
    url: `${U}/uniprotkb/search?query=${encodeURIComponent('gene_exact:TP53 AND organism_id:9606')}&fields=accession,id,gene_primary,reviewed,organism_id&size=10`,
    note: 'UniProt symbol search exactly as the app builds it',
  },
  {
    name: 'orthodb-orthologs-tp53',
    url: 'https://data.orthodb.org/v12/orthologs?id=742841at7742&species=9606,10090,7955',
    note: 'OrthoDB orthologs of TP53 group, species-filtered',
  },
];

async function main(): Promise<void> {
  // `--only a,b` re-records just those fixtures and keeps the rest of index.json as it was.
  const onlyArg = process.argv.find((a) => a.startsWith('--only='));
  const only = onlyArg ? new Set(onlyArg.slice(7).split(',')) : null;
  const items = only ? ITEMS.filter((i) => only.has(i.name)) : ITEMS;
  const client = new NetClient({ fetchImpl: fetch, cache: null, userAgent: 'GeneExplorer-fixture-recorder' });
  await fs.mkdir(OUT, { recursive: true });
  const entries: Record<string, unknown>[] = [];
  for (const item of items) {
    try {
      const r = await client.request(item.name, { url: item.url, kind: item.kind ?? 'json' });
      const file = `${item.name}.${item.ext ?? 'json'}`;
      await fs.writeFile(path.join(OUT, file), r.text);
      entries.push({
        name: item.name,
        method: 'GET',
        url: item.url,
        status: 200,
        file,
        bytes: r.meta.bytes,
        recordedAt: new Date(r.meta.fetchedAt).toISOString(),
        note: item.note,
        label: 'REAL recorded response',
      });
      console.log(`recorded ${item.name} (${r.meta.bytes} B)`);
    } catch (e) {
      console.log(
        `FAILED   ${item.name}: ${e instanceof NetError ? `${e.app.kind} ${e.app.message}` : String(e)}`,
      );
    }
  }
  if (only) {
    const old = JSON.parse(await fs.readFile(path.join(OUT, 'index.json'), 'utf8')) as {
      entries: { name: string }[];
    };
    const keep = old.entries.filter((e) => !only.has(e.name));
    entries.unshift(...keep);
  }
  await fs.writeFile(
    path.join(OUT, 'index.json'),
    JSON.stringify(
      {
        tool: 'tools/record-fixtures.ts',
        note: 'Real API responses recorded from the live services; not edited by hand.',
        entries,
      },
      null,
      2,
    ),
  );
  console.log(`${entries.length} fixtures in index (${items.length} recorded now) at ${OUT}`);
}

void main();
