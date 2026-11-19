// Groups ortholog species into broad clades for display. The clade list and its display order are an APP choice
// (not a database fact); the taxon IDs were each checked live against NCBI Taxonomy (name and rank) while building Phase 3.
import type { OrthologCall } from '../shared/domain';
import type { TaxonId } from '../shared/ids';

export interface CladeDef {
  key: string;
  label: string;
  /** NCBI Taxonomy ID that defines membership: a species belongs if this ID is in its lineage (or is the species). */
  taxId: number;
}

// Most specific first: the first clade whose ID appears in a lineage wins.
const SPECIFIC: readonly CladeDef[] = [
  { key: 'mammals', label: 'Mammals', taxId: 40674 }, // Mammalia
  { key: 'birds', label: 'Birds', taxId: 8782 }, // Aves
  { key: 'reptiles', label: 'Reptiles', taxId: 8457 }, // Sauropsida (birds are caught earlier)
  { key: 'amphibians', label: 'Amphibians', taxId: 8292 }, // Amphibia
  { key: 'fish', label: 'Ray-finned fishes', taxId: 7898 }, // Actinopterygii
  { key: 'vertebrates', label: 'Other vertebrates', taxId: 7742 }, // Vertebrata
  { key: 'insects', label: 'Insects', taxId: 50557 }, // Insecta
  { key: 'nematodes', label: 'Nematodes', taxId: 6231 }, // Nematoda
  { key: 'arthropods', label: 'Other arthropods', taxId: 6656 }, // Arthropoda
  { key: 'animals', label: 'Other animals', taxId: 33208 }, // Metazoa
  { key: 'fungi', label: 'Fungi', taxId: 4751 }, // Fungi
  { key: 'plants', label: 'Plants', taxId: 33090 }, // Viridiplantae
  { key: 'eukaryotes', label: 'Other eukaryotes', taxId: 2759 }, // Eukaryota
  { key: 'archaea', label: 'Archaea', taxId: 2157 }, // Archaea
  { key: 'bacteria', label: 'Bacteria', taxId: 2 }, // Bacteria
];
export const CLADES: readonly CladeDef[] = SPECIFIC;
export const UNCLASSIFIED: CladeDef = {
  key: 'unclassified',
  label: 'Unclassified (lineage not available)',
  taxId: 0,
};

/** Returns the most specific clade for a lineage (list of ancestor taxon IDs) plus the taxon itself. */
export function assignClade(taxon: TaxonId, lineage: readonly TaxonId[] | undefined): CladeDef {
  if (!lineage) return UNCLASSIFIED;
  const ids = new Set<number>([taxon, ...lineage]);
  return SPECIFIC.find((c) => ids.has(c.taxId)) ?? UNCLASSIFIED;
}

export interface CladeGroup {
  clade: CladeDef;
  calls: OrthologCall[];
}

/** Groups ortholog calls by clade in display order; species with unknown lineage go to "Unclassified" (never guessed). */
export function groupOrthologsByClade(
  calls: readonly OrthologCall[],
  lineageByTaxon: ReadonlyMap<TaxonId, readonly TaxonId[]>,
): CladeGroup[] {
  const buckets = new Map<string, CladeGroup>();
  for (const call of calls) {
    const clade = assignClade(call.value.taxon.id, lineageByTaxon.get(call.value.taxon.id));
    const g = buckets.get(clade.key) ?? { clade, calls: [] };
    g.calls.push(call);
    buckets.set(clade.key, g);
  }
  const order = [...SPECIFIC, UNCLASSIFIED];
  return order.flatMap((c) => {
    const g = buckets.get(c.key);
    if (!g) return [];
    g.calls.sort((a, b) => a.value.taxon.scientificName.localeCompare(b.value.taxon.scientificName));
    return [g];
  });
}
