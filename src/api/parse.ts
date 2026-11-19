// Turns validated API responses into unified domain records. Pure functions: no network, no clock (callers pass the
// fetch metadata), so they are fully unit-testable with recorded real responses.
import type { ZodType } from 'zod';
import type {
  CrossRef,
  GeneRecord,
  GenomicLocation,
  GoAnnotation,
  InactiveEntry,
  IsoformInfo,
  OrthologCall,
  ProteinFeature,
  ProteinRecord,
  StructureRecord,
  TaxonCandidate,
  TaxonInfo,
} from '../shared/domain';
import {
  parseEnsemblGeneId,
  parseNcbiGeneId,
  parseOrthoDbGroupId,
  parseTaxonId,
  parseUniProtAccession,
  parseUniProtIsoformId,
} from '../shared/ids';
import type { NcbiGeneId, OrthoDbGroupId, TaxonId, UniProtAccession } from '../shared/ids';
import type { FetchMeta, IpcResult, Sourced } from '../shared/types';
import {
  AlphaFoldListSchema,
  NcbiGeneReportsSchema,
  NcbiTaxonNodeSchema,
  NcbiTaxonSuggestSchema,
  OrthoDbGroupSchema,
  OrthoDbOrthologsSchema,
  OrthoDbSearchSchema,
  UniProtActiveSchema,
  UniProtInactiveSchema,
  UniProtSearchSchema,
  UniProtTaxonomySearchSchema,
} from './schemas';

/** Builds a bad_response failure. */
function bad<T>(message: string): IpcResult<T> {
  return { ok: false, error: { kind: 'bad_response', message } };
}

/** Validates unknown JSON against a schema; failure becomes a bad_response error naming the first problem. */
export function validate<T>(schema: ZodType<T>, raw: unknown, what: string): IpcResult<T> {
  const r = schema.safeParse(raw);
  if (r.success) return { ok: true, value: r.data };
  const first = r.error.issues[0];
  const where = first ? first.path.join('.') || '(root)' : '(unknown)';
  return bad(`${what} response did not match the expected shape at ${where}: ${first?.message ?? 'invalid'}`);
}

/** Wraps a value with its source, record ID, fetch time and request URL. */
function sourced<T>(value: T, source: Sourced<T>['source'], recordId: string, meta: FetchMeta): Sourced<T> {
  return { value, source, recordId, fetchedAt: meta.fetchedAt, url: meta.url };
}

/** True for evidence codes that mean "inferred electronically, not reviewed by a curator". */
function isAutomatic(evidenceCode: string): boolean {
  return evidenceCode.toUpperCase() === 'IEA';
}

// ---------------------------------------------------------------- UniProt

export type UniProtParsed =
  { kind: 'active'; record: ProteinRecord } | { kind: 'inactive'; inactive: Sourced<InactiveEntry> };

const ISOFORM_STATUS: Record<string, IsoformInfo['status']> = {
  Displayed: 'displayed',
  Described: 'described',
  External: 'external',
  'Not described': 'not_described',
};

/** Maps UniProt's "GoTerm" property prefix (F:/P:/C:) to a GO aspect. */
function goAspect(term: string): GoAnnotation['aspect'] | null {
  if (term.startsWith('F:')) return 'molecular_function';
  if (term.startsWith('P:')) return 'biological_process';
  if (term.startsWith('C:')) return 'cellular_component';
  return null;
}

/** Parses a UniProtKB entry (active or inactive/obsolete) into a domain record. */
export function parseUniProtEntry(raw: unknown, meta: FetchMeta): IpcResult<UniProtParsed> {
  if (typeof raw === 'object' && raw !== null && 'entryType' in raw && raw.entryType === 'Inactive') {
    const v = validate(UniProtInactiveSchema, raw, 'UniProt');
    if (!v.ok) return v;
    const acc = parseUniProtAccession(v.value.primaryAccession);
    if (!acc) return bad('UniProt returned an accession in an unknown format.');
    const t = v.value.inactiveReason.inactiveReasonType;
    const reason: InactiveEntry['reason'] =
      t === 'DELETED' || t === 'MERGED' || t === 'DEMERGED' ? t : 'UNKNOWN';
    const replacedBy = (v.value.inactiveReason.mergeDemergeTo ?? [])
      .map(parseUniProtAccession)
      .filter((x): x is UniProtAccession => x !== null);
    const entry: InactiveEntry = {
      accession: acc,
      reason,
      ...(v.value.inactiveReason.deletedReason ? { detail: v.value.inactiveReason.deletedReason } : {}),
      replacedBy,
    };
    return { ok: true, value: { kind: 'inactive', inactive: sourced(entry, 'UniProt', acc, meta) } };
  }
  const v = validate(UniProtActiveSchema, raw, 'UniProt');
  if (!v.ok) return v;
  const e = v.value;
  const acc = parseUniProtAccession(e.primaryAccession);
  if (!acc) return bad('UniProt returned an accession in an unknown format.');
  if (e.sequence.value.length !== e.sequence.length) {
    return bad('UniProt sequence length does not match its stated length.');
  }
  const taxId = parseTaxonId(e.organism.taxonId);
  if (!taxId) return bad('UniProt returned an invalid taxon ID.');

  const desc = e.proteinDescription;
  const proteinName =
    desc.recommendedName?.fullName.value ??
    desc.submissionNames?.[0]?.fullName.value ??
    desc.alternativeNames?.[0]?.fullName.value ??
    null;
  const primary = e.genes?.[0]?.geneName?.value;
  const synonyms = (e.genes ?? []).flatMap((g) => (g.synonyms ?? []).map((s) => s.value));

  const features: ProteinFeature[] = [];
  for (const f of e.features ?? []) {
    const start = f.location.start.value;
    const end = f.location.end.value;
    if (start !== undefined && end !== undefined) {
      features.push({ type: f.type, description: f.description ?? '', start, end });
    }
  }

  const isoforms: IsoformInfo[] = [];
  const alt = (e.comments ?? []).find((c) => c.commentType === 'ALTERNATIVE PRODUCTS');
  for (const iso of alt?.isoforms ?? []) {
    const parsedId = parseUniProtIsoformId(iso.isoformIds[0] ?? '');
    const status = ISOFORM_STATUS[iso.isoformSequenceStatus];
    if (parsedId && status) isoforms.push({ id: parsedId.id, name: iso.name.value, status });
  }

  const xrefs: CrossRef[] = [];
  const ncbiGeneIds: NcbiGeneId[] = [];
  const go: GoAnnotation[] = [];
  for (const x of e.uniProtKBCrossReferences ?? []) {
    xrefs.push({ database: x.database, id: x.id });
    if (x.database === 'GeneID') {
      const id = parseNcbiGeneId(x.id);
      if (id) ncbiGeneIds.push(id);
    } else if (x.database === 'GO') {
      const term = x.properties?.find((p) => p.key === 'GoTerm')?.value ?? '';
      const ev = (x.properties?.find((p) => p.key === 'GoEvidenceType')?.value ?? '').split(':')[0] ?? '';
      const aspect = goAspect(term);
      if (aspect)
        go.push({ goId: x.id, name: term.slice(2), aspect, evidenceCode: ev, automatic: isAutomatic(ev) });
    }
  }

  const fn = (e.comments ?? []).find((c) => c.commentType === 'FUNCTION')?.texts?.[0]?.value;
  const record = sourced(
    {
      accession: acc,
      entryName: e.uniProtkbId,
      reviewed: e.entryType.startsWith('UniProtKB reviewed'),
      proteinExistence: e.proteinExistence,
      annotationScore: e.annotationScore,
      proteinName,
      geneNames: { ...(primary ? { primary } : {}), synonyms },
      taxon: {
        id: taxId,
        scientificName: e.organism.scientificName,
        ...(e.organism.commonName ? { commonName: e.organism.commonName } : {}),
      },
      lineage: e.organism.lineage ?? [],
      sequence: e.sequence.value,
      sequenceLength: e.sequence.length,
      sequenceVersion: e.entryAudit.sequenceVersion,
      entryVersion: e.entryAudit.entryVersion,
      lastAnnotationUpdate: e.entryAudit.lastAnnotationUpdateDate,
      ...(fn ? { functionText: fn } : {}),
      features,
      isoforms,
      xrefs,
      ncbiGeneIds,
      go,
    },
    'UniProt',
    acc,
    meta,
  );
  return { ok: true, value: { kind: 'active', record } };
}

export interface UniProtSearchHit {
  accession: UniProtAccession;
  reviewed: boolean;
  entryName?: string;
  taxonId?: TaxonId;
  primaryGeneName?: string;
}

/** Parses a UniProt search result list (reviewed entries first, as UniProt orders them). */
export function parseUniProtSearch(raw: unknown, meta: FetchMeta): IpcResult<Sourced<UniProtSearchHit[]>> {
  const v = validate(UniProtSearchSchema, raw, 'UniProt search');
  if (!v.ok) return v;
  const hits: UniProtSearchHit[] = [];
  for (const r of v.value.results) {
    const acc = parseUniProtAccession(r.primaryAccession);
    if (!acc) continue;
    const taxonId = r.organism ? parseTaxonId(r.organism.taxonId) : null;
    const gene = r.genes?.[0]?.geneName?.value;
    hits.push({
      accession: acc,
      reviewed: r.entryType.startsWith('UniProtKB reviewed'),
      ...(r.uniProtkbId ? { entryName: r.uniProtkbId } : {}),
      ...(taxonId ? { taxonId } : {}),
      ...(gene ? { primaryGeneName: gene } : {}),
    });
  }
  return { ok: true, value: sourced(hits, 'UniProt', 'search', meta) };
}

/** Parses UniProt taxonomy search results into taxon candidates. */
export function parseUniProtTaxonomy(raw: unknown, meta: FetchMeta): IpcResult<Sourced<TaxonCandidate[]>> {
  const v = validate(UniProtTaxonomySearchSchema, raw, 'UniProt taxonomy');
  if (!v.ok) return v;
  const out: TaxonCandidate[] = [];
  for (const r of v.value.results) {
    const id = parseTaxonId(r.taxonId);
    if (!id || r.active === false) continue;
    out.push({
      id,
      scientificName: r.scientificName,
      ...(r.commonName ? { commonName: r.commonName } : {}),
      ...(r.rank ? { rank: r.rank } : {}),
      ...(r.statistics?.reviewedProteinCount !== undefined
        ? { reviewedProteinCount: r.statistics.reviewedProteinCount }
        : {}),
    });
  }
  return { ok: true, value: sourced(out, 'UniProt', 'taxonomy-search', meta) };
}

// ---------------------------------------------------------------- NCBI

export interface NcbiGenesParsed {
  genes: GeneRecord[];
  /** Messages NCBI attached (e.g. ABOVE_SPECIES_TAXON); shown to the user, never hidden. */
  warnings: string[];
}

/** Converts one NCBI gene object to a domain record; returns null if its IDs are malformed. */
function toGeneRecord(
  g: NonNullable<ReturnType<typeof NcbiGeneReportsSchema.parse>['reports']>[number]['gene'],
  meta: FetchMeta,
): GeneRecord | null {
  const geneId = parseNcbiGeneId(g.gene_id);
  const taxId = parseTaxonId(g.tax_id);
  if (!geneId || !taxId) return null;
  const locations: GenomicLocation[] = [];
  for (const a of g.annotations ?? []) {
    for (const loc of a.genomic_locations ?? []) {
      const begin = Number(loc.genomic_range.begin);
      const end = Number(loc.genomic_range.end);
      const strand = loc.genomic_range.orientation;
      if (!Number.isFinite(begin) || !Number.isFinite(end) || (strand !== 'plus' && strand !== 'minus'))
        continue;
      locations.push({
        assemblyAccession: a.assembly_accession ?? '',
        assemblyName: a.assembly_name ?? '',
        sequenceAccession: loc.genomic_accession_version,
        sequenceName: loc.sequence_name ?? '',
        begin: Math.min(begin, end),
        end: Math.max(begin, end),
        strand,
      });
    }
  }
  const go: GoAnnotation[] = [];
  const addGo = (
    list: { name: string; go_id: string; evidence_code: string }[] | undefined,
    aspect: GoAnnotation['aspect'],
  ): void => {
    for (const t of list ?? []) {
      go.push({
        goId: t.go_id,
        name: t.name,
        aspect,
        evidenceCode: t.evidence_code,
        automatic: isAutomatic(t.evidence_code),
      });
    }
  };
  addGo(g.gene_ontology?.molecular_functions, 'molecular_function');
  addGo(g.gene_ontology?.biological_processes, 'biological_process');
  addGo(g.gene_ontology?.cellular_components, 'cellular_component');
  const summary = g.summary?.[0]?.description;
  const taxon: TaxonInfo = {
    id: taxId,
    scientificName: g.taxname,
    ...(g.common_name ? { commonName: g.common_name } : {}),
  };
  return sourced(
    {
      geneId,
      symbol: g.symbol,
      description: g.description ?? '',
      taxon,
      type: g.type,
      chromosomes: g.chromosomes ?? [],
      locations,
      synonyms: g.synonyms ?? [],
      ...(g.nomenclature_authority
        ? {
            nomenclature: {
              authority: g.nomenclature_authority.authority,
              identifier: g.nomenclature_authority.identifier,
            },
          }
        : {}),
      swissProtAccessions: (g.swiss_prot_accessions ?? [])
        .map(parseUniProtAccession)
        .filter((x): x is UniProtAccession => x !== null),
      ensemblGeneIds: (g.ensembl_gene_ids ?? []).map(parseEnsemblGeneId).filter((x) => x !== null),
      ...(summary ? { summary } : {}),
      go,
    },
    'NCBI',
    geneId,
    meta,
  );
}

/** Parses an NCBI Datasets gene report list (by ID, symbol or accession). */
export function parseNcbiGenes(raw: unknown, meta: FetchMeta): IpcResult<NcbiGenesParsed> {
  const v = validate(NcbiGeneReportsSchema, raw, 'NCBI gene');
  if (!v.ok) return v;
  const genes: GeneRecord[] = [];
  for (const r of v.value.reports ?? []) {
    const rec = toGeneRecord(r.gene, meta);
    if (rec) genes.push(rec);
  }
  const warnings = (v.value.messages ?? []).flatMap((m) => {
    const t = m.warning?.message ?? m.error?.message;
    return t ? [t] : [];
  });
  return { ok: true, value: { genes, warnings } };
}

/** Parses NCBI ortholog reports (each report is one ortholog gene in another species). */
export function parseNcbiOrthologs(raw: unknown, meta: FetchMeta): IpcResult<OrthologCall[]> {
  const v = validate(NcbiGeneReportsSchema, raw, 'NCBI orthologs');
  if (!v.ok) return v;
  const calls: OrthologCall[] = [];
  for (const r of v.value.reports ?? []) {
    const rec = toGeneRecord(r.gene, meta);
    if (!rec) continue;
    const g = rec.value;
    calls.push(
      sourced(
        {
          geneId: g.geneId,
          symbol: g.symbol,
          description: g.description,
          taxon: g.taxon,
          method: 'NCBI Orthologs',
          ...(g.swissProtAccessions[0] ? { uniprotAccession: g.swissProtAccessions[0] } : {}),
        },
        'NCBI',
        g.geneId,
        meta,
      ),
    );
  }
  return { ok: true, value: calls };
}

/** Parses an NCBI taxonomy node lookup. */
export function parseNcbiTaxon(
  raw: unknown,
): IpcResult<{ taxon: TaxonInfo; lineageIds: TaxonId[]; rank?: string }> {
  const v = validate(NcbiTaxonNodeSchema, raw, 'NCBI taxonomy');
  if (!v.ok) return v;
  const t = v.value.taxonomy_nodes[0]?.taxonomy;
  const id = t ? parseTaxonId(t.tax_id) : null;
  if (!t || !id) return bad('NCBI returned no taxonomy node.');
  return {
    ok: true,
    value: {
      taxon: {
        id,
        scientificName: t.organism_name,
        ...(t.genbank_common_name ? { commonName: t.genbank_common_name } : {}),
      },
      lineageIds: (t.lineage ?? []).map(parseTaxonId).filter((x): x is TaxonId => x !== null),
      ...(t.rank ? { rank: t.rank } : {}),
    },
  };
}

/** Parses NCBI taxon autocomplete (taxon_suggest) results. */
export function parseNcbiTaxonSuggest(raw: unknown, meta: FetchMeta): IpcResult<Sourced<TaxonCandidate[]>> {
  const v = validate(NcbiTaxonSuggestSchema, raw, 'NCBI taxon suggest');
  if (!v.ok) return v;
  const out: TaxonCandidate[] = [];
  for (const r of v.value.sci_name_and_ids ?? []) {
    const id = parseTaxonId(r.tax_id);
    if (!id) continue;
    out.push({
      id,
      scientificName: r.sci_name,
      ...(r.common_name ? { commonName: r.common_name } : {}),
      ...(r.rank ? { rank: r.rank.toLowerCase() } : {}),
    });
  }
  return { ok: true, value: sourced(out, 'NCBI', 'taxon_suggest', meta) };
}

// ---------------------------------------------------------------- AlphaFold

/** Picks the AlphaFold model for an accession from the prediction list. Returns null when none matches. */
export function parseAlphaFold(
  raw: unknown,
  accession: UniProtAccession,
  meta: FetchMeta,
): IpcResult<StructureRecord | null> {
  const v = validate(AlphaFoldListSchema, raw, 'AlphaFold');
  if (!v.ok) return v;
  const p = v.value.find((x) => x.uniprotAccession === accession) ?? null;
  if (!p) return { ok: true, value: null };
  const acc = parseUniProtAccession(p.uniprotAccession);
  if (!acc) return bad('AlphaFold returned an accession in an unknown format.');
  return {
    ok: true,
    value: sourced(
      {
        entryId: p.entryId,
        uniprotAccession: acc,
        modelVersion: p.latestVersion,
        createdDate: p.modelCreatedDate,
        meanPlddt: p.globalMetricValue,
        fractions: {
          veryLow: p.fractionPlddtVeryLow,
          low: p.fractionPlddtLow,
          confident: p.fractionPlddtConfident,
          veryHigh: p.fractionPlddtVeryHigh,
        },
        sequence: p.sequence,
        pdbUrl: p.pdbUrl,
        cifUrl: p.cifUrl,
        ...(p.paeImageUrl ? { paeImageUrl: p.paeImageUrl } : {}),
        tool: p.toolUsed,
      },
      'AlphaFold',
      p.entryId,
      meta,
    ),
  };
}

// ---------------------------------------------------------------- OrthoDB

export interface OrthoDbGroupHit {
  id: OrthoDbGroupId;
  name: string;
  levelName: string;
  geneCount?: number;
  speciesCount?: number;
}

/** Converts a string or number to a finite number, or undefined. */
function num(x: string | number | undefined): number | undefined {
  if (x === undefined) return undefined;
  const n = typeof x === 'number' ? x : Number(x);
  return Number.isFinite(n) ? n : undefined;
}

/** Parses an OrthoDB search (query by UniProt accession or text) into candidate orthologous groups. */
export function parseOrthoDbSearch(raw: unknown, meta: FetchMeta): IpcResult<Sourced<OrthoDbGroupHit[]>> {
  const v = validate(OrthoDbSearchSchema, raw, 'OrthoDB search');
  if (!v.ok) return v;
  const hits: OrthoDbGroupHit[] = [];
  for (const b of v.value.bigdata ?? []) {
    const id = parseOrthoDbGroupId(b.id);
    if (!id) continue;
    const geneCount = num(b.gene_count);
    const speciesCount = num(b.present_in);
    hits.push({
      id,
      name: b.name ?? '',
      levelName: b.level_name ?? '',
      ...(geneCount !== undefined ? { geneCount } : {}),
      ...(speciesCount !== undefined ? { speciesCount } : {}),
    });
  }
  return { ok: true, value: sourced(hits, 'OrthoDB', 'search', meta) };
}

/** Parses OrthoDB group members (one entry per species). The OrthoDB gene label is kept as shown by OrthoDB. */
export function parseOrthoDbOrthologs(
  raw: unknown,
  group: OrthoDbGroupId,
  meta: FetchMeta,
): IpcResult<OrthologCall[]> {
  const v = validate(OrthoDbOrthologsSchema, raw, 'OrthoDB orthologs');
  if (!v.ok) return v;
  const calls: OrthologCall[] = [];
  for (const block of v.value.data) {
    // Organism IDs look like "10090_1": the taxon ID, then a genome-assembly counter.
    const taxId = parseTaxonId(block.organism.id.split('_')[0] ?? '');
    if (!taxId) continue;
    for (const g of block.genes) {
      const len = num(g.aas);
      calls.push(
        sourced(
          {
            symbol: g.gene_id.id,
            description: g.description ?? '',
            taxon: {
              id: taxId,
              scientificName: block.organism.name,
              ...(block.organism.description ? { commonName: block.organism.description } : {}),
            },
            method: `OrthoDB group ${group}`,
            groupId: group,
            ...(len !== undefined ? { proteinLength: len } : {}),
          },
          'OrthoDB',
          g.gene_id.param ?? g.gene_id.id,
          meta,
        ),
      );
    }
  }
  return { ok: true, value: calls };
}

export interface OrthoDbGroupInfo {
  id: OrthoDbGroupId;
  name: string;
  levelName: string;
  geneCount?: number;
  speciesCount?: number;
  /** Species in which the group has at least one member. */
  presentIn?: number;
  ecNumbers: { id: string; description: string }[];
  interpro: { id: string; description: string }[];
}

/** Parses OrthoDB group details (name, taxonomic level, size, EC numbers, InterPro domains). */
export function parseOrthoDbGroup(raw: unknown, meta: FetchMeta): IpcResult<Sourced<OrthoDbGroupInfo>> {
  const v = validate(OrthoDbGroupSchema, raw, 'OrthoDB group');
  if (!v.ok) return v;
  const d = v.value.data;
  const id = parseOrthoDbGroupId(d.id);
  if (!id) return bad('OrthoDB returned a group ID in an unknown format.');
  const pp = d.phyletic_profile;
  return {
    ok: true,
    value: sourced(
      {
        id,
        name: d.name ?? '',
        levelName: d.level_name ?? '',
        ...(pp?.gene_count !== undefined ? { geneCount: pp.gene_count } : {}),
        ...(pp?.species_count !== undefined ? { speciesCount: pp.species_count } : {}),
        ...(pp?.present_in !== undefined ? { presentIn: pp.present_in } : {}),
        ecNumbers: (d.ECnumber ?? []).map((e) => ({ id: e.id, description: e.description ?? '' })),
        interpro: (d.interpro_domains ?? []).map((e) => ({ id: e.id, description: e.description ?? '' })),
      },
      'OrthoDB',
      id,
      meta,
    ),
  };
}
