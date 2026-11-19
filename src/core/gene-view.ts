// View-model for one gene page. It holds the resolved records plus one Loadable per slow panel, so every panel
// loads, fails and retries independently (a failed panel never blanks the rest of the page).
import type { GeneApi } from '../api/client';
import { parsePdbResidues } from '../bio/pdb';
import type {
  GeneRecord,
  ProteinRecord,
  Residue,
  SequenceInfo,
  StructureRecord,
  TranscriptSet,
} from '../shared/domain';
import type { AppError, Loadable } from '../shared/types';
import type { IdentityCheck } from './identity';

export interface StructureBundle {
  /** All AlphaFold fragments for the protein (usually one). */
  models: StructureRecord[];
  /** Index of the fragment shown. */
  selected: number;
  pdb: string;
  residues: Residue[];
}

export type PanelKey = 'transcripts' | 'sequence' | 'structure';

export interface GeneViewDeps {
  api: GeneApi;
  /** Reports whether the response for a URL came from the cache (for "loaded from cache" labels). */
  fromCache: (url: string | undefined) => boolean;
  /** True when the user has moved on; late results are dropped. */
  isCancelled: () => boolean;
  now?: () => number;
}

const err = (message: string): AppError => ({ kind: 'bad_response', message });

/** Pulls the residue letters out of a FASTA text. */
export function parseFasta(text: string): string | null {
  const lines = text.split('\n').filter((l) => l.length > 0);
  if (lines.length < 2 || !lines[0]?.startsWith('>')) return null;
  const seq = lines.slice(1).join('').replace(/\s+/g, '');
  return /^[A-Za-z*]+$/.test(seq) ? seq.toUpperCase() : null;
}

export class GeneView {
  transcripts: Loadable<TranscriptSet> = { status: 'idle' };
  sequence: Loadable<SequenceInfo | null> = { status: 'idle' };
  structure: Loadable<StructureBundle> = { status: 'idle' };
  private listeners = new Set<() => void>();

  /** Creates the view over already-resolved records; call start() to begin loading panels. */
  constructor(
    readonly gene: GeneRecord | null,
    readonly protein: ProteinRecord | null,
    readonly identity: IdentityCheck | null,
    readonly notes: readonly string[],
    private readonly deps: GeneViewDeps,
  ) {}

  /** Registers a change listener; returns an unsubscribe function. */
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Notifies listeners unless the view was cancelled. */
  private emit(): void {
    if (!this.deps.isCancelled()) for (const l of this.listeners) l();
  }

  /** Current time (injectable for tests). */
  private now(): number {
    return (this.deps.now ?? Date.now)();
  }

  /** Starts every panel load in parallel. */
  start(): void {
    void this.load('transcripts');
    void this.load('sequence');
    void this.load('structure');
  }

  /** (Re)loads one panel; used by start() and by each panel's Retry button. */
  async load(panel: PanelKey): Promise<void> {
    if (panel === 'transcripts') await this.loadTranscripts();
    else if (panel === 'sequence') await this.loadSequence();
    else await this.loadStructure(0);
  }

  /** Loads transcripts and exons for the gene. */
  private async loadTranscripts(): Promise<void> {
    if (!this.gene) {
      this.transcripts = { status: 'empty', reason: 'No NCBI gene record is linked to this entry.' };
      return this.emit();
    }
    this.transcripts = { status: 'loading', startedAt: this.now() };
    this.emit();
    const r = await this.deps.api.getTranscripts(this.gene.value.geneId);
    if (this.deps.isCancelled()) return;
    if (!r.ok) this.transcripts = { status: 'error', error: r.error };
    else if (r.value.value.transcripts.length === 0)
      this.transcripts = {
        status: 'empty',
        reason: 'NCBI lists no transcripts with exon coordinates for this gene.',
      };
    else
      this.transcripts = {
        status: 'ready',
        data: r.value,
        fetchedAt: r.value.fetchedAt,
        fromCache: this.deps.fromCache(r.value.url),
      };
    this.emit();
  }

  /** Loads the length of the sequence (chromosome, organelle, plasmid) the gene sits on. */
  private async loadSequence(): Promise<void> {
    const loc = this.gene?.value.locations[0];
    if (!this.gene || !loc) {
      this.sequence = { status: 'empty', reason: 'No genomic location is available for this gene.' };
      return this.emit();
    }
    if (!loc.assemblyAccession) {
      this.sequence = {
        status: 'empty',
        reason: 'Length not available: NCBI names no assembly for this location.',
      };
      return this.emit();
    }
    this.sequence = { status: 'loading', startedAt: this.now() };
    this.emit();
    const r = await this.deps.api.getSequenceInfo(
      loc.assemblyAccession,
      loc.sequenceName && loc.sequenceName !== 'ANONYMOUS' ? loc.sequenceName : null,
      loc.sequenceAccession,
    );
    if (this.deps.isCancelled()) return;
    if (!r.ok) this.sequence = { status: 'error', error: r.error };
    else if (!r.value)
      this.sequence = { status: 'empty', reason: 'Length not available: NCBI does not list this sequence.' };
    else this.sequence = { status: 'ready', data: r.value, fetchedAt: this.now(), fromCache: false };
    this.emit();
  }

  /** Loads the AlphaFold record(s) and the structure file for one fragment. */
  async loadStructure(index: number): Promise<void> {
    if (!this.protein) {
      this.structure = {
        status: 'empty',
        reason: 'No UniProt protein is linked to this entry, so no AlphaFold model can be looked up.',
      };
      return this.emit();
    }
    this.structure = { status: 'loading', startedAt: this.now() };
    this.emit();
    const list = await this.deps.api.getAlphaFoldModels(this.protein.value.accession);
    if (this.deps.isCancelled()) return;
    if (!list.ok) {
      this.structure = { status: 'error', error: list.error };
      return this.emit();
    }
    const model = list.value[index];
    if (!model) {
      this.structure = {
        status: 'empty',
        reason: `AlphaFold DB has no predicted model for ${this.protein.value.accession}. It does not cover every protein (very large proteins are a common gap).`,
      };
      return this.emit();
    }
    const file = await this.deps.api.getStructureFile(model.value.pdbUrl);
    if (this.deps.isCancelled()) return;
    if (!file.ok) {
      this.structure = { status: 'error', error: file.error };
      return this.emit();
    }
    const parsed = parsePdbResidues(file.value.data);
    if (!parsed.ok) {
      this.structure = {
        status: 'error',
        error: err(`The structure file could not be read: ${parsed.message}`),
      };
      return this.emit();
    }
    this.structure = {
      status: 'ready',
      data: { models: list.value, selected: index, pdb: file.value.data, residues: parsed.residues },
      fetchedAt: file.value.meta.fetchedAt,
      fromCache: file.value.meta.fromCache,
    };
    this.emit();
  }

  /** Fetches the sequence of another isoform (canonical sequence is already in the protein record). */
  async fetchIsoformSequence(
    isoformId: string,
  ): Promise<{ ok: true; sequence: string } | { ok: false; error: AppError }> {
    const r = await this.deps.api.getIsoformFasta(isoformId);
    if (!r.ok) return { ok: false, error: r.error };
    const seq = parseFasta(r.value.data);
    return seq
      ? { ok: true, sequence: seq }
      : { ok: false, error: err('The isoform file was not valid FASTA.') };
  }
}

/** Default transcript choice: MANE Select, then RefSeq Select, then longest spliced length, then first listed. The reason is shown. */
export function chooseTranscript(set: TranscriptSet): { index: number; reason: string } {
  const list = set.value.transcripts;
  const mane = list.findIndex((t) => t.selectCategory === 'MANE_SELECT');
  if (mane >= 0)
    return { index: mane, reason: 'MANE Select transcript (NCBI/EMBL-EBI joint reference choice)' };
  const rs = list.findIndex((t) => t.selectCategory === 'REFSEQ_SELECT');
  if (rs >= 0) return { index: rs, reason: 'RefSeq Select transcript (NCBI)' };
  let best = -1;
  let len = -1;
  list.forEach((t, i) => {
    if (t.exons.length > 0 && (t.length ?? 0) > len) {
      len = t.length ?? 0;
      best = i;
    }
  });
  if (best >= 0)
    return {
      index: best,
      reason: 'Longest transcript with exon data (no MANE or RefSeq Select label from NCBI for this gene)',
    };
  return { index: 0, reason: 'First transcript listed by NCBI (no selection label and no exon data)' };
}
