// Branded identifier types: a plain string can never be passed where a specific kind of ID is expected.
// Each parser validates the format and returns null for anything else, so a malformed ID cannot enter the app.
declare const brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [brand]: B };

export type UniProtAccession = Brand<string, 'UniProtAccession'>;
export type UniProtIsoformId = Brand<string, 'UniProtIsoformId'>;
export type NcbiGeneId = Brand<string, 'NcbiGeneId'>;
export type TaxonId = Brand<number, 'TaxonId'>;
export type OrthoDbGroupId = Brand<string, 'OrthoDbGroupId'>;
export type EnsemblGeneId = Brand<string, 'EnsemblGeneId'>;

// Official UniProt accession pattern (https://www.uniprot.org/help/accession_numbers).
const UNIPROT_RE = /^(?:[OPQ][0-9][A-Z0-9]{3}[0-9]|[A-NR-Z][0-9](?:[A-Z][A-Z0-9]{2}[0-9]){1,2})$/;

/** Validates a UniProtKB accession such as P04637 or A0A386NCW8 (case-insensitive input, upper-case output). */
export function parseUniProtAccession(s: string): UniProtAccession | null {
  const v = s.trim().toUpperCase();
  return UNIPROT_RE.test(v) ? (v as UniProtAccession) : null;
}

/** Validates an isoform ID such as P04637-2 and returns it with the base accession. */
export function parseUniProtIsoformId(
  s: string,
): { id: UniProtIsoformId; accession: UniProtAccession } | null {
  const m = /^([A-Z0-9]+)-([1-9][0-9]*)$/.exec(s.trim().toUpperCase());
  const acc = m?.[1] ? parseUniProtAccession(m[1]) : null;
  return m && acc ? { id: `${acc}-${m[2] ?? ''}` as UniProtIsoformId, accession: acc } : null;
}

/** Validates an NCBI Gene ID (a positive integer, kept as a string because NCBI returns it that way). */
export function parseNcbiGeneId(s: string): NcbiGeneId | null {
  const v = s.trim();
  return /^[1-9][0-9]{0,9}$/.test(v) ? (v as NcbiGeneId) : null;
}

/** Validates an NCBI Taxonomy ID (positive integer). */
export function parseTaxonId(n: number | string): TaxonId | null {
  const v = typeof n === 'string' ? (/^[0-9]+$/.test(n.trim()) ? Number(n.trim()) : NaN) : n;
  return Number.isSafeInteger(v) && v > 0 ? (v as TaxonId) : null;
}

/** Validates an OrthoDB group ID such as 742841at7742. */
export function parseOrthoDbGroupId(s: string): OrthoDbGroupId | null {
  const v = s.trim();
  return /^[0-9]+at[0-9]+$/.test(v) ? (v as OrthoDbGroupId) : null;
}

/** Validates an Ensembl gene ID (stable ID, optional version suffix is stripped). */
export function parseEnsemblGeneId(s: string): EnsemblGeneId | null {
  const m = /^((?:ENS[A-Z]{0,6})?G[0-9]{11})(?:\.[0-9]+)?$/.exec(s.trim().toUpperCase());
  return m?.[1] ? (m[1] as EnsemblGeneId) : null;
}
