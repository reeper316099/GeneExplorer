// Canonical isoform selection. UniProt's entry sequence IS the canonical isoform; other isoforms are listed separately
// and their sequences must be fetched on demand (switching isoforms is a user action, never automatic).
import type { IsoformInfo, ProteinRecord } from '../shared/domain';
import type { UniProtIsoformId } from '../shared/ids';

export interface CanonicalSelection {
  /** ID shown for the canonical form: the displayed isoform ID, or the accession when the entry lists no isoforms. */
  canonicalId: string;
  canonicalName: string;
  sequence: string;
  /** Other isoforms the user can switch to, in UniProt's order. */
  alternatives: IsoformInfo[];
  /** True when UniProt marks at least one isoform as having a sequence we can fetch. */
  hasSwitchableIsoforms: boolean;
}

/** Picks the canonical isoform (UniProt's displayed sequence) and lists the alternatives the user may switch to. */
export function selectCanonicalIsoform(protein: ProteinRecord): CanonicalSelection {
  const p = protein.value;
  const displayed = p.isoforms.find((i) => i.status === 'displayed');
  const alternatives = p.isoforms.filter((i) => i !== displayed && i.status !== 'not_described');
  return {
    canonicalId: displayed?.id ?? p.accession,
    canonicalName: displayed?.name ?? 'Canonical',
    sequence: p.sequence,
    alternatives,
    hasSwitchableIsoforms: alternatives.some((i) => i.status === 'described' || i.status === 'displayed'),
  };
}

/** URL path of the FASTA file for an isoform sequence on UniProt (fetched only when the user switches). */
export function isoformFastaPath(id: UniProtIsoformId): string {
  return `/uniprotkb/${id}.fasta`;
}
