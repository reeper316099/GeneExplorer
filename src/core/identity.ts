// Gene <-> protein identity. Two records are linked ONLY through database cross-references (NCBI lists the UniProt
// accession, and/or UniProt lists the NCBI Gene ID). A matching symbol alone is never accepted as identity.
import type { GeneRecord, ProteinRecord } from '../shared/domain';
import type { TaxonId } from '../shared/ids';

export type IdentityStatus =
  /** NCBI and UniProt each point at the other. */
  | 'confirmed'
  /** Only one database points at the other (NCBI only lists reviewed UniProt entries, so this is normal for TrEMBL). */
  | 'one_way'
  /** Neither database links them: they might merely share a symbol. Must be shown as unconfirmed. */
  | 'unconfirmed'
  /** Cross-references exist but point to different records. */
  | 'conflict';

export interface IdentityCheck {
  status: IdentityStatus;
  /** Human-readable reasons, each naming the database that said it (shown in the UI). */
  evidence: string[];
  /** same = identical taxon IDs; ancestor = UniProt uses a broader taxon (e.g. E. coli K-12 strain vs substrain); different = other organisms. */
  taxon: 'same' | 'ancestor' | 'different';
}

/** Compares an NCBI gene with a UniProt protein using cross-references only. */
export function checkIdentity(
  gene: GeneRecord,
  protein: ProteinRecord,
  geneTaxonLineage: readonly TaxonId[] = [],
): IdentityCheck {
  const g = gene.value;
  const p = protein.value;
  const ncbiPointsToUniProt = g.swissProtAccessions.includes(p.accession);
  const uniprotPointsToNcbi = p.ncbiGeneIds.includes(g.geneId);
  const evidence: string[] = [];
  if (ncbiPointsToUniProt) evidence.push(`NCBI Gene ${g.geneId} lists UniProt ${p.accession}.`);
  if (uniprotPointsToNcbi) evidence.push(`UniProt ${p.accession} lists NCBI GeneID ${g.geneId}.`);

  let status: IdentityStatus;
  if (ncbiPointsToUniProt && uniprotPointsToNcbi) status = 'confirmed';
  else if (ncbiPointsToUniProt || uniprotPointsToNcbi) status = 'one_way';
  else {
    const uniprotNamesOther = p.ncbiGeneIds.length > 0;
    const ncbiNamesOther = g.swissProtAccessions.length > 0;
    if (uniprotNamesOther)
      evidence.push(`UniProt ${p.accession} lists NCBI GeneID ${p.ncbiGeneIds.join(', ')}, not ${g.geneId}.`);
    if (ncbiNamesOther)
      evidence.push(
        `NCBI Gene ${g.geneId} lists UniProt ${g.swissProtAccessions.join(', ')}, not ${p.accession}.`,
      );
    status = uniprotNamesOther || ncbiNamesOther ? 'conflict' : 'unconfirmed';
    if (status === 'unconfirmed')
      evidence.push('Neither database links these two records; they may only share a name.');
  }

  const taxon: IdentityCheck['taxon'] =
    g.taxon.id === p.taxon.id ? 'same' : geneTaxonLineage.includes(p.taxon.id) ? 'ancestor' : 'different';
  return { status, evidence, taxon };
}
