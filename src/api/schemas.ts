// zod schemas for every external API response we read. Objects are "loose" (unknown extra fields are allowed, because the
// services add fields over time) but every field we rely on is required or explicitly optional, so a changed
// response shape is reported as bad_response instead of silently producing wrong data.
import { z } from 'zod';

const Evidence = z.looseObject({ evidenceCode: z.string().optional() });

// ---------- UniProt ----------

const Pos = z.looseObject({ value: z.number().optional(), modifier: z.string().optional() });
const Value = z.looseObject({ value: z.string() });

export const UniProtActiveSchema = z.looseObject({
  entryType: z.string(),
  primaryAccession: z.string(),
  uniProtkbId: z.string(),
  entryAudit: z.looseObject({
    lastAnnotationUpdateDate: z.string(),
    entryVersion: z.number(),
    sequenceVersion: z.number(),
  }),
  annotationScore: z.number(),
  organism: z.looseObject({
    scientificName: z.string(),
    commonName: z.string().optional(),
    taxonId: z.number(),
    lineage: z.array(z.string()).optional(),
  }),
  proteinExistence: z.string(),
  proteinDescription: z.looseObject({
    recommendedName: z.looseObject({ fullName: Value }).optional(),
    submissionNames: z.array(z.looseObject({ fullName: Value })).optional(),
    alternativeNames: z.array(z.looseObject({ fullName: Value })).optional(),
  }),
  genes: z
    .array(z.looseObject({ geneName: Value.optional(), synonyms: z.array(Value).optional() }))
    .optional(),
  comments: z
    .array(
      z.looseObject({
        commentType: z.string(),
        texts: z
          .array(z.looseObject({ value: z.string(), evidences: z.array(Evidence).optional() }))
          .optional(),
        isoforms: z
          .array(
            z.looseObject({
              name: Value,
              isoformIds: z.array(z.string()),
              isoformSequenceStatus: z.string(),
            }),
          )
          .optional(),
      }),
    )
    .optional(),
  features: z
    .array(
      z.looseObject({
        type: z.string(),
        description: z.string().optional(),
        location: z.looseObject({ start: Pos, end: Pos }),
      }),
    )
    .optional(),
  uniProtKBCrossReferences: z
    .array(
      z.looseObject({
        database: z.string(),
        id: z.string(),
        properties: z.array(z.looseObject({ key: z.string(), value: z.string() })).optional(),
        isoformId: z.string().optional(),
      }),
    )
    .optional(),
  sequence: z.looseObject({ value: z.string(), length: z.number() }),
});

export const UniProtInactiveSchema = z.looseObject({
  entryType: z.literal('Inactive'),
  primaryAccession: z.string(),
  inactiveReason: z.looseObject({
    inactiveReasonType: z.string(),
    deletedReason: z.string().optional(),
    mergeDemergeTo: z.array(z.string()).optional(),
  }),
});

export const UniProtSearchSchema = z.looseObject({
  results: z.array(
    z.looseObject({
      entryType: z.string(),
      primaryAccession: z.string(),
      uniProtkbId: z.string().optional(),
      organism: z.looseObject({ taxonId: z.number() }).optional(),
      genes: z.array(z.looseObject({ geneName: Value.optional() })).optional(),
    }),
  ),
});

export const UniProtTaxonomySearchSchema = z.looseObject({
  results: z.array(
    z.looseObject({
      scientificName: z.string(),
      commonName: z.string().optional(),
      taxonId: z.number(),
      rank: z.string().optional(),
      active: z.boolean().optional(),
      statistics: z.looseObject({ reviewedProteinCount: z.number().optional() }).optional(),
    }),
  ),
});

// ---------- NCBI Datasets ----------

const NcbiGene = z.looseObject({
  gene_id: z.string(),
  symbol: z.string(),
  description: z.string().optional(),
  tax_id: z.string(),
  taxname: z.string(),
  common_name: z.string().optional(),
  type: z.string(),
  chromosomes: z.array(z.string()).optional(),
  nomenclature_authority: z.looseObject({ authority: z.string(), identifier: z.string() }).optional(),
  swiss_prot_accessions: z.array(z.string()).optional(),
  ensembl_gene_ids: z.array(z.string()).optional(),
  synonyms: z.array(z.string()).optional(),
  annotations: z
    .array(
      z.looseObject({
        assembly_accession: z.string().optional(),
        assembly_name: z.string().optional(),
        genomic_locations: z
          .array(
            z.looseObject({
              genomic_accession_version: z.string(),
              sequence_name: z.string().optional(),
              genomic_range: z.looseObject({
                begin: z.string(),
                end: z.string(),
                orientation: z.string().optional(),
              }),
            }),
          )
          .optional(),
      }),
    )
    .optional(),
  summary: z.array(z.looseObject({ description: z.string().optional() })).optional(),
  gene_ontology: z
    .looseObject({
      molecular_functions: z
        .array(z.looseObject({ name: z.string(), go_id: z.string(), evidence_code: z.string() }))
        .optional(),
      biological_processes: z
        .array(z.looseObject({ name: z.string(), go_id: z.string(), evidence_code: z.string() }))
        .optional(),
      cellular_components: z
        .array(z.looseObject({ name: z.string(), go_id: z.string(), evidence_code: z.string() }))
        .optional(),
    })
    .optional(),
});

export const NcbiGeneReportsSchema = z.looseObject({
  reports: z.array(z.looseObject({ gene: NcbiGene })).optional(),
  total_count: z.number().optional(),
  messages: z
    .array(
      z.looseObject({
        warning: z
          .looseObject({ gene_warning_code: z.string().optional(), message: z.string().optional() })
          .optional(),
        error: z.looseObject({ message: z.string().optional() }).optional(),
      }),
    )
    .optional(),
});

export const NcbiTaxonNodeSchema = z.looseObject({
  taxonomy_nodes: z.array(
    z.looseObject({
      taxonomy: z.looseObject({
        tax_id: z.number(),
        organism_name: z.string(),
        genbank_common_name: z.string().optional(),
        rank: z.string().optional(),
        lineage: z.array(z.number()).optional(),
      }),
    }),
  ),
});

export const NcbiTaxonSuggestSchema = z.looseObject({
  sci_name_and_ids: z
    .array(
      z.looseObject({
        sci_name: z.string(),
        tax_id: z.string(),
        common_name: z.string().optional(),
        rank: z.string().optional(),
      }),
    )
    .optional(),
});

// ---------- AlphaFold DB ----------

export const AlphaFoldListSchema = z.array(
  z.looseObject({
    entryId: z.string(),
    uniprotAccession: z.string(),
    latestVersion: z.number(),
    modelCreatedDate: z.string(),
    globalMetricValue: z.number(),
    fractionPlddtVeryLow: z.number(),
    fractionPlddtLow: z.number(),
    fractionPlddtConfident: z.number(),
    fractionPlddtVeryHigh: z.number(),
    sequence: z.string(),
    pdbUrl: z.string(),
    cifUrl: z.string(),
    paeImageUrl: z.string().optional(),
    toolUsed: z.string(),
  }),
);

// ---------- OrthoDB ----------

export const OrthoDbSearchSchema = z.looseObject({
  data: z.array(z.string()),
  status: z.string().optional(),
  bigdata: z
    .array(
      z.looseObject({
        id: z.string(),
        name: z.string().optional(),
        level_name: z.string().optional(),
        gene_count: z.union([z.string(), z.number()]).optional(),
        present_in: z.union([z.string(), z.number()]).optional(),
      }),
    )
    .optional(),
});

export const OrthoDbOrthologsSchema = z.looseObject({
  status: z.string().optional(),
  data: z.array(
    z.looseObject({
      genes: z.array(
        z.looseObject({
          gene_id: z.looseObject({ id: z.string(), param: z.string().optional() }),
          description: z.string().optional(),
          aas: z.union([z.string(), z.number()]).optional(),
        }),
      ),
      organism: z.looseObject({ id: z.string(), name: z.string(), description: z.string().optional() }),
    }),
  ),
});

export const OrthoDbGroupSchema = z.looseObject({
  status: z.string().optional(),
  data: z.looseObject({
    id: z.string(),
    name: z.string().optional(),
    level_name: z.string().optional(),
    ECnumber: z.array(z.looseObject({ id: z.string(), description: z.string().optional() })).optional(),
    interpro_domains: z
      .array(
        z.looseObject({ id: z.string(), description: z.string().optional(), count: z.number().optional() }),
      )
      .optional(),
    phyletic_profile: z
      .looseObject({
        gene_count: z.number().optional(),
        species_count: z.number().optional(),
        present_in: z.number().optional(),
      })
      .optional(),
  }),
});
