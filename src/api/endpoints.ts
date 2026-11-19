// URL builders for every request the app makes. Only these functions put text into a URL, and each one encodes it,
// so a user-typed query can never add a path segment, parameter or host.
import type { EnsemblGeneId, NcbiGeneId, OrthoDbGroupId, TaxonId, UniProtAccession } from '../shared/ids';

export const UNIPROT = 'https://rest.uniprot.org';
export const NCBI = 'https://api.ncbi.nlm.nih.gov/datasets/v2';
export const ALPHAFOLD = 'https://alphafold.ebi.ac.uk';
export const ORTHODB = 'https://data.orthodb.org/v12';

/** Fields requested from UniProt for a gene page; keeps big entries (TP53 849 KB) near 100 KB. */
export const UNIPROT_ENTRY_FIELDS =
  'accession,id,gene_names,gene_primary,protein_name,organism_name,organism_id,reviewed,annotation_score,length,sequence,cc_function,ft_domain,ft_region,go,xref_geneid,xref_refseq,xref_ensembl,xref_orthodb,xref_pdb,xref_alphafolddb,cc_subcellular_location,protein_existence,ft_repeat,ft_transmem,ft_signal,ft_zn_fing,ft_motif,ft_coiled,ft_topo_dom,ft_propep,ft_transit,ft_dna_bind,cc_alternative_products,lineage,sequence_version,version,date_modified';

/** Keeps only characters valid in a gene symbol, so nothing typed can add UniProt query operators or fields. */
function symbolValue(v: string): string {
  return v.replace(/[^A-Za-z0-9_.-]/g, '');
}

/** Keeps letters, digits, spaces, hyphens, dots and apostrophes for a free-text species search. */
function textValue(v: string): string {
  return v
    .replace(/[^\p{L}\p{N} '.-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export const endpoints = {
  uniprotEntry: (acc: UniProtAccession): string =>
    `${UNIPROT}/uniprotkb/${acc}.json?fields=${UNIPROT_ENTRY_FIELDS}`,
  uniprotSearchSymbol: (symbol: string, taxon: TaxonId): string =>
    `${UNIPROT}/uniprotkb/search?query=${encodeURIComponent(`gene_exact:${symbolValue(symbol)} AND organism_id:${taxon}`)}&fields=accession,id,gene_primary,reviewed,organism_id&size=10`,
  uniprotTaxonomySearch: (text: string): string =>
    `${UNIPROT}/taxonomy/search?query=${encodeURIComponent(textValue(text))}&size=10`,
  ncbiGeneById: (id: NcbiGeneId): string => `${NCBI}/gene/id/${id}`,
  ncbiGeneBySymbol: (symbol: string, taxon: TaxonId): string =>
    `${NCBI}/gene/symbol/${encodeURIComponent(symbol)}/taxon/${taxon}`,
  ncbiProductReport: (id: NcbiGeneId): string => `${NCBI}/gene/id/${id}/product_report`,
  /** Sequence reports of an assembly; `chromosome` narrows it (omit for small genomes such as bacteria). */
  ncbiSequenceReport: (assembly: string, chromosome: string | null): string =>
    `${NCBI}/genome/accession/${encodeURIComponent(assembly)}/sequence_reports${chromosome ? `?chromosomes=${encodeURIComponent(chromosome)}` : ''}`,
  uniprotSearchGeneId: (id: NcbiGeneId): string =>
    `${UNIPROT}/uniprotkb/search?query=${encodeURIComponent(`xref:geneid-${id}`)}&fields=accession,id,gene_primary,protein_name,organism_name,reviewed,organism_id,length&size=10`,
  uniprotSearchText: (text: string, taxon?: TaxonId): string =>
    `${UNIPROT}/uniprotkb/search?query=${encodeURIComponent(`${textValue(text)}${taxon ? ` AND organism_id:${taxon}` : ''}`)}&fields=accession,id,gene_primary,protein_name,organism_name,reviewed,organism_id,length&size=15`,
  uniprotSearchSymbolAny: (symbol: string): string =>
    `${UNIPROT}/uniprotkb/search?query=${encodeURIComponent(`gene_exact:${symbolValue(symbol)}`)}&fields=accession,id,gene_primary,protein_name,organism_name,reviewed,organism_id,length&size=25`,
  uniprotSearchEnsembl: (id: EnsemblGeneId): string =>
    `${UNIPROT}/uniprotkb/search?query=${encodeURIComponent(`xref:ensembl-${id}`)}&fields=accession,id,gene_primary,protein_name,organism_name,reviewed,organism_id,length&size=15`,
  uniprotIsoformFasta: (isoform: string): string =>
    `${UNIPROT}/uniprotkb/${encodeURIComponent(isoform)}.fasta`,
  ncbiGeneByAccession: (accession: string): string =>
    `${NCBI}/gene/accession/${encodeURIComponent(accession)}`,
  ncbiOrthologs: (id: NcbiGeneId, taxa: readonly TaxonId[]): string =>
    `${NCBI}/gene/id/${id}/orthologs${taxa.length ? `?${taxa.map((t) => `taxon_filter=${t}`).join('&')}` : ''}`,
  ncbiTaxon: (id: TaxonId): string => `${NCBI}/taxonomy/taxon/${id}`,
  /** Several taxonomy nodes in one request (comma-separated IDs), so a 700-species list costs ~7 calls, not 700. */
  ncbiTaxa: (ids: readonly TaxonId[]): string => `${NCBI}/taxonomy/taxon/${ids.join(',')}`,
  ncbiTaxonSuggest: (text: string): string => `${NCBI}/taxonomy/taxon_suggest/${encodeURIComponent(text)}`,
  alphafoldPrediction: (acc: UniProtAccession): string => `${ALPHAFOLD}/api/prediction/${acc}`,
  orthodbSearch: (acc: UniProtAccession, species?: TaxonId): string =>
    `${ORTHODB}/search?query=${acc}&limit=30${species ? `&species=${species}` : ''}`,
  orthodbGroup: (group: OrthoDbGroupId): string => `${ORTHODB}/group?id=${group}`,
  orthodbOrthologs: (group: OrthoDbGroupId, species: readonly TaxonId[]): string =>
    `${ORTHODB}/orthologs?id=${group}${species.length ? `&species=${species.join(',')}` : ''}`,
};
