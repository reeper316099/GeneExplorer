// Loads ortholog calls for one gene from each source SEPARATELY (never merged): NCBI Orthologs and OrthoDB. Each source
// has its own Loadable, so one failing or slow source never blocks the other.
import type { GeneApi } from '../api/client';
import type { OrthoDbGroupHit, OrthoDbGroupInfo } from '../api/parse';
import type { OrthologCall } from '../shared/domain';
import type { OrthoDbGroupId, TaxonId } from '../shared/ids';
import type { Loadable, Sourced } from '../shared/types';
import type { GeneView } from './gene-view';
import { buildRows } from './ortholog-table';
import type { OrthologRow } from './ortholog-table';

export interface SourceResult {
  rows: OrthologRow[];
  fetchedAt: number;
  /** True when lineages could not be fetched, so groups may read "Unclassified". */
  lineageMissing: boolean;
}

export interface OrthoDbResult extends SourceResult {
  groups: OrthoDbGroupHit[];
  selected: OrthoDbGroupId;
  info: Sourced<OrthoDbGroupInfo> | null;
}

export type SourceKey = 'ncbi' | 'orthodb';

/** Largest group loaded by default: bigger groups (several MB of JSON) are available but only on request. */
export const DEFAULT_MAX_GROUP_GENES = 1500;

/** Default OrthoDB group: the broadest group with at most DEFAULT_MAX_GROUP_GENES genes, else the smallest group offered. */
export function chooseDefaultGroup(groups: readonly OrthoDbGroupHit[]): OrthoDbGroupHit | null {
  if (groups.length === 0) return null;
  const fits = groups.filter((g) => (g.geneCount ?? Infinity) <= DEFAULT_MAX_GROUP_GENES);
  if (fits.length)
    return fits.reduce((best, g) => ((g.speciesCount ?? 0) > (best.speciesCount ?? 0) ? g : best));
  return groups.reduce((best, g) => ((g.geneCount ?? Infinity) < (best.geneCount ?? Infinity) ? g : best));
}

export class OrthologState {
  ncbi: Loadable<SourceResult> = { status: 'idle' };
  orthodb: Loadable<OrthoDbResult> = { status: 'idle' };
  private listeners = new Set<() => void>();

  /** Creates the state for a gene view; nothing is fetched until load() is called for a source. */
  constructor(
    private readonly view: GeneView,
    private readonly api: GeneApi,
    private readonly isCancelled: () => boolean,
  ) {}

  /** Registers a change listener; returns an unsubscribe function. */
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Notifies listeners unless the screen was left. */
  private emit(): void {
    if (!this.isCancelled()) for (const l of this.listeners) l();
  }

  /** Looks up lineages for the species in a call list; failures leave them unclassified instead of failing the source. */
  private async rowsFor(
    calls: readonly OrthologCall[],
  ): Promise<{ rows: OrthologRow[]; lineageMissing: boolean }> {
    const taxa = [...new Set(calls.map((c) => c.value.taxon.id))] as TaxonId[];
    const l = await this.api.getTaxaLineages(taxa);
    return { rows: buildRows(calls, l.ok ? l.value : new Map()), lineageMissing: !l.ok };
  }

  /** Loads one source (used by the first view of the tab and by each Retry button). */
  async load(source: SourceKey, group?: OrthoDbGroupId): Promise<void> {
    if (source === 'ncbi') await this.loadNcbi();
    else await this.loadOrthoDb(group);
  }

  /** NCBI Orthologs for the gene's NCBI Gene ID. */
  private async loadNcbi(): Promise<void> {
    const gene = this.view.gene;
    if (!gene) {
      this.ncbi = {
        status: 'empty',
        reason: 'NCBI orthologs are looked up by NCBI Gene ID, and no gene record is linked to this entry.',
      };
      return this.emit();
    }
    this.ncbi = { status: 'loading', startedAt: Date.now() };
    this.emit();
    const r = await this.api.getNcbiOrthologs(gene.value.geneId, []);
    if (this.isCancelled()) return;
    if (!r.ok) {
      this.ncbi = { status: 'error', error: r.error };
      return this.emit();
    }
    // NCBI lists the query gene itself for some species; it is not an ortholog of itself.
    const calls = r.value.filter((c) => c.value.geneId !== gene.value.geneId);
    const { rows, lineageMissing } = await this.rowsFor(calls);
    if (this.isCancelled()) return;
    this.ncbi = {
      status: 'ready',
      data: { rows, fetchedAt: r.value[0]?.fetchedAt ?? Date.now(), lineageMissing },
      fetchedAt: r.value[0]?.fetchedAt ?? Date.now(),
      fromCache: false,
    };
    this.emit();
  }

  /** OrthoDB groups for the protein's UniProt accession, then the members of one group. */
  private async loadOrthoDb(wanted?: OrthoDbGroupId): Promise<void> {
    const protein = this.view.protein;
    if (!protein) {
      this.orthodb = {
        status: 'empty',
        reason: 'OrthoDB is searched by UniProt accession, and no UniProt protein is linked to this entry.',
      };
      return this.emit();
    }
    this.orthodb = { status: 'loading', startedAt: Date.now() };
    this.emit();
    const s = await this.api.searchOrthoDb(protein.value.accession);
    if (this.isCancelled()) return;
    if (!s.ok) {
      this.orthodb = { status: 'error', error: s.error };
      return this.emit();
    }
    const groups = s.value.value;
    const chosen = groups.find((g) => g.id === wanted) ?? chooseDefaultGroup(groups);
    if (!chosen) {
      this.orthodb = {
        status: 'empty',
        reason: `OrthoDB has no orthologous group containing ${protein.value.accession}. That is not evidence the gene is unique to this species.`,
      };
      return this.emit();
    }
    const [info, members] = await Promise.all([
      this.api.getOrthoDbGroup(chosen.id),
      this.api.getOrthoDbOrthologs(chosen.id, []),
    ]);
    if (this.isCancelled()) return;
    if (!members.ok) {
      this.orthodb = { status: 'error', error: members.error };
      return this.emit();
    }
    // Drop the query protein's own species entry only when OrthoDB lists exactly it; keep other copies (paralogs in the group).
    const { rows, lineageMissing } = await this.rowsFor(members.value);
    if (this.isCancelled()) return;
    const at = members.value[0]?.fetchedAt ?? Date.now();
    this.orthodb = {
      status: 'ready',
      data: {
        rows,
        fetchedAt: at,
        lineageMissing,
        groups,
        selected: chosen.id,
        info: info.ok ? info.value : null,
      },
      fetchedAt: at,
      fromCache: false,
    };
    this.emit();
  }
}
