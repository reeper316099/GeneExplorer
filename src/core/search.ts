// Decides what kind of thing the user typed into the search box, so the app knows which database to ask and how.
// A bare gene symbol is never treated as an identity by itself (it is ambiguous across species and aliases).
import {
  parseEnsemblGeneId,
  parseNcbiGeneId,
  parseOrthoDbGroupId,
  parseUniProtAccession,
  parseUniProtIsoformId,
} from '../shared/ids';
import type {
  EnsemblGeneId,
  NcbiGeneId,
  OrthoDbGroupId,
  UniProtAccession,
  UniProtIsoformId,
} from '../shared/ids';

export const MAX_QUERY_LENGTH = 100;

export type QueryKind =
  | { kind: 'empty' }
  | { kind: 'too_long'; max: number }
  | { kind: 'uniprot'; accession: UniProtAccession }
  | { kind: 'uniprot_isoform'; isoform: UniProtIsoformId; accession: UniProtAccession }
  | { kind: 'ncbi_gene'; geneId: NcbiGeneId }
  | { kind: 'ensembl_gene'; id: EnsemblGeneId }
  | { kind: 'refseq'; accession: string }
  | { kind: 'hgnc'; id: string }
  | { kind: 'orthodb_group'; id: OrthoDbGroupId }
  /** One token that looks like a gene symbol; needs a species to be meaningful. */
  | { kind: 'symbol'; symbol: string }
  /** Anything else (several words, punctuation): treated as a name search. */
  | { kind: 'free_text'; text: string };

const REFSEQ_RE = /^(?:NM|NR|XM|XR|NP|XP|WP|YP|NC|NG)_[0-9]+(?:\.[0-9]+)?$/i;
const SYMBOL_RE = /^[A-Za-z][A-Za-z0-9_.-]{0,29}$/;

/** Classifies user input. Pure; trims, normalizes Unicode and strips control characters first. */
export function classifyQuery(input: string): QueryKind {
  const text = input
    .normalize('NFKC')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length === 0) return { kind: 'empty' };
  if (text.length > MAX_QUERY_LENGTH) return { kind: 'too_long', max: MAX_QUERY_LENGTH };

  const prefixed = /^(?:GeneID|Gene ID|NCBI)\s*:\s*([0-9]+)$/i.exec(text);
  const geneIdText = prefixed?.[1] ?? text;
  const geneId = parseNcbiGeneId(geneIdText);
  if (geneId && (prefixed || /^[0-9]+$/.test(text))) return { kind: 'ncbi_gene', geneId };

  const hgnc = /^HGNC\s*:\s*([0-9]+)$/i.exec(text);
  if (hgnc?.[1]) return { kind: 'hgnc', id: `HGNC:${hgnc[1]}` };

  const orthodb = parseOrthoDbGroupId(text);
  if (orthodb) return { kind: 'orthodb_group', id: orthodb };

  const iso = parseUniProtIsoformId(text);
  if (iso) return { kind: 'uniprot_isoform', isoform: iso.id, accession: iso.accession };

  const acc = parseUniProtAccession(text);
  if (acc) return { kind: 'uniprot', accession: acc };

  const ens = parseEnsemblGeneId(text);
  if (ens) return { kind: 'ensembl_gene', id: ens };

  if (REFSEQ_RE.test(text)) return { kind: 'refseq', accession: text.toUpperCase() };

  if (SYMBOL_RE.test(text)) return { kind: 'symbol', symbol: text };
  return { kind: 'free_text', text };
}
