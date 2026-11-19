// Unified domain records. Each source is parsed into its own record; records from different databases are never merged
// into one (they are only linked by cross-references), so every fact keeps its own source via Sourced<T>.
import type {
  EnsemblGeneId,
  NcbiGeneId,
  OrthoDbGroupId,
  TaxonId,
  UniProtAccession,
  UniProtIsoformId,
} from './ids';
import type { Sourced } from './types';

export interface TaxonInfo {
  id: TaxonId;
  scientificName: string;
  commonName?: string;
}

export interface GenomicLocation {
  assemblyAccession: string;
  assemblyName: string;
  /** e.g. NC_000017.11 */
  sequenceAccession: string;
  /** e.g. "17" */
  sequenceName: string;
  /** 1-based, inclusive. */
  begin: number;
  end: number;
  strand: 'plus' | 'minus';
}

export interface GoAnnotation {
  goId: string;
  name: string;
  aspect: 'molecular_function' | 'biological_process' | 'cellular_component';
  evidenceCode: string;
  /** IEA = inferred electronically (automatic, not curated). */
  automatic: boolean;
}

/** One gene as described by NCBI Gene. */
export interface GeneData {
  geneId: NcbiGeneId;
  symbol: string;
  description: string;
  taxon: TaxonInfo;
  type: string;
  chromosomes: string[];
  locations: GenomicLocation[];
  synonyms: string[];
  nomenclature?: { authority: string; identifier: string };
  swissProtAccessions: UniProtAccession[];
  ensemblGeneIds: EnsemblGeneId[];
  summary?: string;
  go: GoAnnotation[];
}
export type GeneRecord = Sourced<GeneData>;

export interface ProteinFeature {
  type: string;
  description: string;
  /** 1-based inclusive range in the canonical isoform. */
  start: number;
  end: number;
}

export interface IsoformInfo {
  id: UniProtIsoformId;
  name: string;
  /** 'Displayed' = the canonical sequence shown by UniProt; others are 'Described' (sequence not in this record). */
  status: 'displayed' | 'described' | 'external' | 'not_described';
}

export interface CrossRef {
  database: string;
  id: string;
}

/** One UniProtKB entry (active). */
export interface ProteinData {
  accession: UniProtAccession;
  entryName: string;
  reviewed: boolean;
  /** 1 (protein level) .. 5 (uncertain), as UniProt reports it. */
  proteinExistence: string;
  annotationScore: number;
  /** Recommended (or submitted) protein name; null when the entry has none. */
  proteinName: string | null;
  geneNames: { primary?: string; synonyms: string[] };
  taxon: TaxonInfo;
  lineage: string[];
  sequence: string;
  sequenceLength: number;
  sequenceVersion: number;
  entryVersion: number;
  lastAnnotationUpdate: string;
  functionText?: string;
  features: ProteinFeature[];
  isoforms: IsoformInfo[];
  xrefs: CrossRef[];
  /** NCBI Gene IDs UniProt cross-references (used for identity checks, never symbol alone). */
  ncbiGeneIds: NcbiGeneId[];
  go: GoAnnotation[];
}
export type ProteinRecord = Sourced<ProteinData>;

/** An inactive (obsolete) UniProt accession and what replaced it, if anything. */
export interface InactiveEntry {
  accession: UniProtAccession;
  reason: 'DELETED' | 'MERGED' | 'DEMERGED' | 'UNKNOWN';
  detail?: string;
  replacedBy: UniProtAccession[];
}

export interface StructureData {
  entryId: string;
  uniprotAccession: UniProtAccession;
  modelVersion: number;
  createdDate: string;
  /** Mean pLDDT over the whole model (0-100). */
  meanPlddt: number;
  fractions: { veryLow: number; low: number; confident: number; veryHigh: number };
  sequence: string;
  pdbUrl: string;
  cifUrl: string;
  paeImageUrl?: string;
  tool: string;
}
export type StructureRecord = Sourced<StructureData>;

export type OrthologSourceKind = 'NCBI' | 'OrthoDB';

/** One ortholog call. These are inferences; the call keeps the method and source so the UI can say so. */
export interface OrthologData {
  geneId?: NcbiGeneId;
  symbol: string;
  description: string;
  taxon: TaxonInfo;
  /** How the source describes the relationship, e.g. 'NCBI Ortholog' or 'OrthoDB group 742841at7742'. */
  method: string;
  groupId?: OrthoDbGroupId;
  proteinLength?: number;
  uniprotAccession?: UniProtAccession;
}
export type OrthologCall = Sourced<OrthologData>;

export interface TaxonCandidate {
  id: TaxonId;
  scientificName: string;
  commonName?: string;
  rank?: string;
  /** Number of proteins UniProt knows for it; helps rank candidates. */
  reviewedProteinCount?: number;
}

export interface Residue {
  chain: string;
  number: number;
  /** One-letter amino-acid code ('X' for unknown/modified). */
  code: string;
  ca: readonly [number, number, number];
  /** B-factor column; for AlphaFold models this is pLDDT (0-100). */
  bfactor: number;
}
