// Ortholog table for ONE source: rows grouped by lineage, sortable and filterable. Sources are never merged here;
// callers build one table per source and show each under its own label.
import type { OrthologCall } from '../shared/domain';
import type { TaxonId } from '../shared/ids';
import { toCsv } from './csv';
import { assignClade } from './lineage';
import type { CladeDef } from './lineage';

export interface OrthologRow {
  call: OrthologCall;
  clade: CladeDef;
}

export type SortKey = 'species' | 'symbol' | 'clade' | 'taxon';

/** Attaches a lineage group to every call (unknown lineage becomes "Unclassified", never guessed). */
export function buildRows(
  calls: readonly OrthologCall[],
  lineages: ReadonlyMap<TaxonId, readonly TaxonId[]>,
): OrthologRow[] {
  return calls.map((call) => ({
    call,
    clade: assignClade(call.value.taxon.id, lineages.get(call.value.taxon.id)),
  }));
}

export interface RowFilter {
  clade?: string;
  text?: string;
}

/** Keeps rows in the chosen lineage group and/or whose species, common name, symbol or description contain the text. */
export function filterRows(rows: readonly OrthologRow[], f: RowFilter): OrthologRow[] {
  const q = f.text?.trim().toLowerCase();
  return rows.filter((r) => {
    if (f.clade && r.clade.key !== f.clade) return false;
    if (!q) return true;
    const v = r.call.value;
    return [
      v.taxon.scientificName,
      v.taxon.commonName ?? '',
      v.symbol,
      v.description,
      String(v.taxon.id),
    ].some((s) => s.toLowerCase().includes(q));
  });
}

/** Sorts rows (stable, deterministic: ties fall back to species name). */
export function sortRows(rows: readonly OrthologRow[], key: SortKey, dir: 1 | -1 = 1): OrthologRow[] {
  const val = (r: OrthologRow): string | number => {
    const v = r.call.value;
    return key === 'species'
      ? v.taxon.scientificName.toLowerCase()
      : key === 'symbol'
        ? v.symbol.toLowerCase()
        : key === 'taxon'
          ? v.taxon.id
          : r.clade.label;
  };
  return [...rows].sort((a, b) => {
    const x = val(a);
    const y = val(b);
    const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y));
    return c !== 0
      ? c * dir
      : a.call.value.taxon.scientificName.localeCompare(b.call.value.taxon.scientificName);
  });
}

export interface CladeCount {
  clade: CladeDef;
  species: number;
  genes: number;
}

/** Counts species and genes per lineage group (a species with several genes counts once under "species"). */
export function cladeCounts(rows: readonly OrthologRow[]): CladeCount[] {
  const by = new Map<string, { clade: CladeDef; taxa: Set<number>; genes: number }>();
  for (const r of rows) {
    const e = by.get(r.clade.key) ?? { clade: r.clade, taxa: new Set<number>(), genes: 0 };
    e.taxa.add(r.call.value.taxon.id);
    e.genes++;
    by.set(r.clade.key, e);
  }
  return [...by.values()]
    .map((e) => ({ clade: e.clade, species: e.taxa.size, genes: e.genes }))
    .sort((a, b) => b.species - a.species);
}

export interface SourceSummary {
  species: number;
  genes: number;
  cladeCount: number;
  /** Whether this source lists a human gene (taxon 9606). */
  hasHuman: boolean;
  /** Species with more than one gene (one-to-many calls). */
  multiCopySpecies: number;
}

/** Headline numbers for a source's summary cards. */
export function summarize(rows: readonly OrthologRow[]): SourceSummary {
  const perTaxon = new Map<number, number>();
  for (const r of rows) perTaxon.set(r.call.value.taxon.id, (perTaxon.get(r.call.value.taxon.id) ?? 0) + 1);
  return {
    species: perTaxon.size,
    genes: rows.length,
    cladeCount: new Set(rows.map((r) => r.clade.key)).size,
    hasHuman: perTaxon.has(9606),
    multiCopySpecies: [...perTaxon.values()].filter((n) => n > 1).length,
  };
}

/** Ortholog table as CSV with a header block naming source, method, fetch date and app version. */
export function orthologCsv(
  rows: readonly OrthologRow[],
  info: { source: string; method: string; query: string; fetchedAt: number; appVersion: string },
): string {
  const first = [
    [
      'species',
      'common_name',
      'taxon_id',
      'lineage_group',
      'gene_symbol_or_label',
      'gene_id',
      'description',
      'method',
      'source_record',
    ],
  ];
  const body = rows.map((r) => {
    const v = r.call.value;
    return [
      v.taxon.scientificName,
      v.taxon.commonName ?? '',
      v.taxon.id,
      r.clade.label,
      v.symbol,
      v.geneId ?? '',
      v.description,
      v.method,
      r.call.recordId,
    ];
  });
  return toCsv(
    [...first, ...body],
    [
      `Ortholog calls from ${info.source} (inferred, not observed). Method: ${info.method}`,
      `Query: ${info.query}`,
      `Fetched: ${new Date(info.fetchedAt).toISOString()}`,
      `Exported by GeneExplorer ${info.appVersion}. Educational use only. Absence from this list does not mean the species lacks the gene.`,
      'Identity percentage and orthology type (1:1, 1:many) are not provided by this source.',
    ],
  );
}

/** Describes what a source returned, from the data itself (no unverified claims about coverage). */
export function coverageStatement(rows: readonly OrthologRow[]): string {
  if (rows.length === 0) return 'This source returned no ortholog calls for this gene.';
  const s = summarize(rows);
  const groups = cladeCounts(rows)
    .slice(0, 6)
    .map((c) => `${c.clade.label} (${c.species})`)
    .join(', ');
  return `In this source: ${s.species} species in ${s.cladeCount} lineage group${s.cladeCount === 1 ? '' : 's'}: ${groups}. Species not listed here may still carry the gene; this source simply made no call for them.`;
}
