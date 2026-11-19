// Resolves what the user typed into linked records (NCBI gene + UniProt protein) through cross-references.
// Rules: an ID is looked up directly; a symbol needs a species and only an exact symbol match is auto-selected
// (alias matches are offered as choices, never silently used); gene and protein are linked by cross-reference only.
import type { GeneApi } from '../api/client';
import type { GeneRecord, InactiveEntry, ProteinRecord } from '../shared/domain';
import type { TaxonId } from '../shared/ids';
import type { IpcResult, Sourced } from '../shared/types';
import { checkIdentity } from './identity';
import type { IdentityCheck } from './identity';
import { classifyQuery } from './search';

export type Resolution =
  | {
      kind: 'resolved';
      gene: GeneRecord | null;
      protein: ProteinRecord | null;
      identity: IdentityCheck | null;
      notes: string[];
    }
  /** Several genes matched (aliases, paralogs): the user must pick one. */
  | { kind: 'ambiguous'; candidates: GeneRecord[]; message: string }
  /** The UniProt accession is obsolete: show what replaced it. */
  | { kind: 'inactive'; entry: Sourced<InactiveEntry> }
  | { kind: 'needs_species'; message: string }
  | { kind: 'unsupported'; message: string }
  | { kind: 'not_found'; message: string };

type R<T> = IpcResult<T>;

/** Loads the UniProt protein for a gene (first reviewed accession NCBI lists), if there is one. */
async function proteinForGene(
  api: GeneApi,
  gene: GeneRecord,
  notes: string[],
): Promise<R<ProteinRecord | null>> {
  const acc = gene.value.swissProtAccessions[0];
  if (!acc) {
    notes.push('NCBI lists no reviewed UniProt entry for this gene.');
    return { ok: true, value: null };
  }
  const p = await api.getUniProt(acc);
  if (!p.ok) return p;
  if (p.value.kind === 'inactive') {
    notes.push(`UniProt ${acc} is obsolete (${p.value.inactive.value.reason.toLowerCase()}).`);
    return { ok: true, value: null };
  }
  return { ok: true, value: p.value.record };
}

/** Links a gene and protein, fetching the gene taxon's lineage only when the taxa differ (e.g. strain vs species). */
async function link(api: GeneApi, gene: GeneRecord, protein: ProteinRecord): Promise<IdentityCheck> {
  let lineage: readonly TaxonId[] = [];
  if (gene.value.taxon.id !== protein.value.taxon.id) {
    const t = await api.getNcbiTaxon(gene.value.taxon.id);
    if (t.ok) lineage = t.value.lineageIds;
  }
  return checkIdentity(gene, protein, lineage);
}

/** Finishes resolution once a gene is chosen. */
async function fromGene(api: GeneApi, gene: GeneRecord, notes: string[]): Promise<R<Resolution>> {
  const p = await proteinForGene(api, gene, notes);
  if (!p.ok) return p;
  const identity = p.value ? await link(api, gene, p.value) : null;
  return { ok: true, value: { kind: 'resolved', gene, protein: p.value, identity, notes } };
}

/** Resolves a search-box string (plus an optional species) into records; network errors are returned, not thrown. */
export async function resolveQuery(api: GeneApi, input: string, taxon?: TaxonId): Promise<R<Resolution>> {
  const q = classifyQuery(input);
  const notes: string[] = [];
  switch (q.kind) {
    case 'empty':
      return {
        ok: true,
        value: { kind: 'unsupported', message: 'Type a gene symbol, a gene ID, or a UniProt accession.' },
      };
    case 'too_long':
      return {
        ok: true,
        value: { kind: 'unsupported', message: `Please keep the search under ${q.max} characters.` },
      };
    case 'uniprot':
    case 'uniprot_isoform': {
      const u = await api.getUniProt(q.accession);
      if (!u.ok)
        return u.error.kind === 'not_found'
          ? { ok: true, value: { kind: 'not_found', message: `UniProt has no entry ${q.accession}.` } }
          : u;
      if (u.value.kind === 'inactive')
        return { ok: true, value: { kind: 'inactive', entry: u.value.inactive } };
      const protein = u.value.record;
      if (q.kind === 'uniprot_isoform')
        notes.push(
          `Showing the canonical isoform of ${q.accession}; ${q.isoform} can be selected as an alternative.`,
        );
      const geneId = protein.value.ncbiGeneIds[0];
      if (!geneId) {
        notes.push('UniProt lists no NCBI Gene ID for this entry, so no gene record is shown.');
        return { ok: true, value: { kind: 'resolved', gene: null, protein, identity: null, notes } };
      }
      if (protein.value.ncbiGeneIds.length > 1)
        notes.push(
          `UniProt lists several Gene IDs (${protein.value.ncbiGeneIds.join(', ')}); showing the first.`,
        );
      const g = await api.getNcbiGene(geneId);
      if (!g.ok)
        return {
          ok: true,
          value: {
            kind: 'resolved',
            gene: null,
            protein,
            identity: null,
            notes: [...notes, `The NCBI gene record could not be loaded: ${g.error.message}`],
          },
        };
      const gene = g.value.genes[0] ?? null;
      const identity = gene ? await link(api, gene, protein) : null;
      return { ok: true, value: { kind: 'resolved', gene, protein, identity, notes } };
    }
    case 'ncbi_gene': {
      const g = await api.getNcbiGene(q.geneId);
      if (!g.ok)
        return g.error.kind === 'not_found'
          ? { ok: true, value: { kind: 'not_found', message: g.error.message } }
          : g;
      const gene = g.value.genes[0];
      return gene
        ? fromGene(api, gene, notes)
        : { ok: true, value: { kind: 'not_found', message: `NCBI has no gene ${q.geneId}.` } };
    }
    case 'refseq': {
      const g = await api.getNcbiGeneByAccession(q.accession);
      if (!g.ok)
        return g.error.kind === 'not_found'
          ? { ok: true, value: { kind: 'not_found', message: g.error.message } }
          : g;
      if (g.value.genes.length > 1)
        return {
          ok: true,
          value: {
            kind: 'ambiguous',
            candidates: g.value.genes,
            message: `${q.accession} matches several genes.`,
          },
        };
      const gene = g.value.genes[0];
      return gene
        ? fromGene(api, gene, notes)
        : { ok: true, value: { kind: 'not_found', message: `NCBI has no gene for ${q.accession}.` } };
    }
    case 'symbol': {
      if (!taxon)
        return {
          ok: true,
          value: {
            kind: 'needs_species',
            message: `"${q.symbol}" is a gene symbol; pick a species so we look up the right gene (symbols repeat across species).`,
          },
        };
      const g = await api.getNcbiGeneBySymbol(q.symbol, taxon);
      if (!g.ok)
        return g.error.kind === 'not_found'
          ? {
              ok: true,
              value: {
                kind: 'not_found',
                message: `NCBI has no gene with symbol ${q.symbol} in that species.`,
              },
            }
          : g;
      const exact = g.value.genes.filter((x) => x.value.symbol.toLowerCase() === q.symbol.toLowerCase());
      if (exact.length === 1 && exact[0]) {
        if (g.value.genes.length > 1)
          notes.push(
            `${g.value.genes.length - 1} other gene(s) matched only through an alias and were ignored.`,
          );
        return fromGene(api, exact[0], notes);
      }
      if (g.value.genes.length === 0)
        return {
          ok: true,
          value: { kind: 'not_found', message: `NCBI has no gene with symbol ${q.symbol} in that species.` },
        };
      return {
        ok: true,
        value: {
          kind: 'ambiguous',
          candidates: g.value.genes,
          message:
            exact.length === 0
              ? `No gene is officially named ${q.symbol}; these matched an alias. Pick the one you mean.`
              : `Several genes are named ${q.symbol}. Pick one.`,
        },
      };
    }
    case 'ensembl_gene':
    case 'hgnc':
    case 'orthodb_group':
      return {
        ok: true,
        value: {
          kind: 'unsupported',
          message:
            'This kind of ID is not searchable yet. Use a gene symbol with a species, an NCBI Gene ID, a UniProt accession or a RefSeq accession.',
        },
      };
    case 'free_text':
      return {
        ok: true,
        value: {
          kind: 'unsupported',
          message:
            'Name search is not available. Use a gene symbol with a species, an NCBI Gene ID, a UniProt accession or a RefSeq accession.',
        },
      };
  }
}
