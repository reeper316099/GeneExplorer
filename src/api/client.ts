// Typed API client. It never touches the network itself: it calls an injected fetch function (the preload bridge in the
// app, a fixture server in tests), validates every response with zod, and returns records with provenance.
import type {
  GeneRecord,
  OrthologCall,
  ProteinRecord,
  StructureRecord,
  TaxonCandidate,
} from '../shared/domain';
import type { NcbiGeneId, OrthoDbGroupId, TaxonId, UniProtAccession } from '../shared/ids';
import type { FetchSpec, FetchedPayload, IpcResult, Priority, Sourced } from '../shared/types';
import { endpoints } from './endpoints';
import {
  parseAlphaFold,
  parseNcbiGenes,
  parseNcbiOrthologs,
  parseNcbiTaxon,
  parseNcbiTaxonSuggest,
  parseOrthoDbGroup,
  parseOrthoDbOrthologs,
  parseOrthoDbSearch,
  parseUniProtEntry,
  parseUniProtSearch,
  parseUniProtTaxonomy,
} from './parse';
import type {
  NcbiGenesParsed,
  OrthoDbGroupHit,
  OrthoDbGroupInfo,
  UniProtParsed,
  UniProtSearchHit,
} from './parse';

/** The two fetch functions the preload bridge exposes (request ID first, as in GeneExplorerApi). */
export interface Transport {
  fetchJson(requestId: string, spec: FetchSpec): Promise<IpcResult<FetchedPayload<unknown>>>;
  fetchText(requestId: string, spec: FetchSpec): Promise<IpcResult<FetchedPayload<string>>>;
}

export interface CallOptions {
  priority?: Priority;
  /** Request ID used for cancellation through the bridge; one is generated when omitted. */
  requestId?: string;
}

export class GeneApi {
  private counter = 0;

  /** Creates a client over a transport; `prefix` keeps request IDs unique per client. */
  constructor(
    private readonly transport: Transport,
    private readonly prefix = 'api',
  ) {}

  /** Makes a request ID that satisfies the bridge's ID rules. */
  private nextId(o?: CallOptions): string {
    return o?.requestId ?? `${this.prefix}-${++this.counter}`;
  }

  /** Fetches JSON and parses it; a validation failure becomes a bad_response error. */
  private async json<T>(
    url: string,
    o: CallOptions | undefined,
    parse: (raw: unknown, meta: FetchedPayload<unknown>['meta']) => IpcResult<T>,
  ): Promise<IpcResult<T>> {
    const r = await this.transport.fetchJson(this.nextId(o), { url, priority: o?.priority ?? 'user' });
    if (!r.ok) return r;
    return parse(r.value.data, r.value.meta);
  }

  /** NCBI answers HTTP 400 for IDs it does not know; present that as not_found with a helpful message. */
  private static ncbiNotFound<T>(r: IpcResult<T>, what: string): IpcResult<T> {
    if (
      !r.ok &&
      (r.error.kind === 'not_found' || (r.error.kind === 'bad_response' && r.error.status === 400))
    ) {
      return {
        ok: false,
        error: {
          ...r.error,
          kind: 'not_found',
          message: `NCBI does not recognise ${what}. It may be discontinued, merged or mistyped.`,
        },
      };
    }
    return r;
  }

  /** Looks up one UniProtKB entry (active, or inactive with replacements). */
  getUniProt(acc: UniProtAccession, o?: CallOptions): Promise<IpcResult<UniProtParsed>> {
    return this.json(endpoints.uniprotEntry(acc), o, (raw, m) => parseUniProtEntry(raw, m));
  }

  /** Searches UniProt by exact gene symbol within one taxon (reviewed entries come first). */
  searchUniProtSymbol(
    symbol: string,
    taxon: TaxonId,
    o?: CallOptions,
  ): Promise<IpcResult<Sourced<UniProtSearchHit[]>>> {
    return this.json(endpoints.uniprotSearchSymbol(symbol, taxon), o, (raw, m) => parseUniProtSearch(raw, m));
  }

  /** Looks up species by name (UniProt taxonomy). */
  searchTaxa(text: string, o?: CallOptions): Promise<IpcResult<Sourced<TaxonCandidate[]>>> {
    return this.json(endpoints.uniprotTaxonomySearch(text), o, (raw, m) => parseUniProtTaxonomy(raw, m));
  }

  /** Looks up species by name (NCBI autocomplete); an alternative source for the species picker. */
  suggestTaxaNcbi(text: string, o?: CallOptions): Promise<IpcResult<Sourced<TaxonCandidate[]>>> {
    return this.json(endpoints.ncbiTaxonSuggest(text), o, (raw, m) => parseNcbiTaxonSuggest(raw, m));
  }

  /** Looks up an NCBI gene by Gene ID. */
  async getNcbiGene(id: NcbiGeneId, o?: CallOptions): Promise<IpcResult<NcbiGenesParsed>> {
    return GeneApi.ncbiNotFound(
      await this.json(endpoints.ncbiGeneById(id), o, (raw, m) => parseNcbiGenes(raw, m)),
      `Gene ID ${id}`,
    );
  }

  /** Looks up NCBI genes by symbol in one species; may return alias matches, so callers must check the symbol. */
  async getNcbiGeneBySymbol(
    symbol: string,
    taxon: TaxonId,
    o?: CallOptions,
  ): Promise<IpcResult<NcbiGenesParsed>> {
    return GeneApi.ncbiNotFound(
      await this.json(endpoints.ncbiGeneBySymbol(symbol, taxon), o, (raw, m) => parseNcbiGenes(raw, m)),
      `symbol ${symbol} in taxon ${taxon}`,
    );
  }

  /** Looks up NCBI genes by RefSeq accession. */
  async getNcbiGeneByAccession(accession: string, o?: CallOptions): Promise<IpcResult<NcbiGenesParsed>> {
    return GeneApi.ncbiNotFound(
      await this.json(endpoints.ncbiGeneByAccession(accession), o, (raw, m) => parseNcbiGenes(raw, m)),
      `accession ${accession}`,
    );
  }

  /** Fetches NCBI ortholog calls for a gene, limited to the given species (payloads are large without a filter). */
  getNcbiOrthologs(
    id: NcbiGeneId,
    taxa: readonly TaxonId[],
    o?: CallOptions,
  ): Promise<IpcResult<OrthologCall[]>> {
    return this.json(endpoints.ncbiOrthologs(id, taxa), o, (raw, m) => parseNcbiOrthologs(raw, m));
  }

  /** Fetches an NCBI taxonomy node with its lineage IDs. */
  getNcbiTaxon(
    id: TaxonId,
    o?: CallOptions,
  ): Promise<IpcResult<ReturnType<typeof parseNcbiTaxon> extends IpcResult<infer V> ? V : never>> {
    return this.json(endpoints.ncbiTaxon(id), o, (raw) => parseNcbiTaxon(raw));
  }

  /** Fetches the AlphaFold model record; resolves to ok(null) when AlphaFold has no model (HTTP 404). */
  async getAlphaFold(acc: UniProtAccession, o?: CallOptions): Promise<IpcResult<StructureRecord | null>> {
    const r = await this.json(endpoints.alphafoldPrediction(acc), o, (raw, m) => parseAlphaFold(raw, acc, m));
    if (!r.ok && r.error.kind === 'not_found') return { ok: true, value: null };
    return r;
  }

  /** Downloads an AlphaFold structure file (PDB text); the URL must come from a StructureRecord. */
  async getStructureFile(url: string, o?: CallOptions): Promise<IpcResult<FetchedPayload<string>>> {
    return this.transport.fetchText(this.nextId(o), { url, priority: o?.priority ?? 'user' });
  }

  /** Searches OrthoDB for orthologous groups containing a UniProt accession. */
  searchOrthoDb(
    acc: UniProtAccession,
    species?: TaxonId,
    o?: CallOptions,
  ): Promise<IpcResult<Sourced<OrthoDbGroupHit[]>>> {
    return this.json(endpoints.orthodbSearch(acc, species), o, (raw, m) => parseOrthoDbSearch(raw, m));
  }

  /** Fetches details of one OrthoDB group (name, level, size, EC numbers, InterPro domains). */
  getOrthoDbGroup(group: OrthoDbGroupId, o?: CallOptions): Promise<IpcResult<Sourced<OrthoDbGroupInfo>>> {
    return this.json(endpoints.orthodbGroup(group), o, (raw, m) => parseOrthoDbGroup(raw, m));
  }

  /** Fetches the members of an OrthoDB group, limited to the given species (full groups can be 7 MB). */
  getOrthoDbOrthologs(
    group: OrthoDbGroupId,
    species: readonly TaxonId[],
    o?: CallOptions,
  ): Promise<IpcResult<OrthologCall[]>> {
    return this.json(endpoints.orthodbOrthologs(group, species), o, (raw, m) =>
      parseOrthoDbOrthologs(raw, group, m),
    );
  }
}

export type { GeneRecord, ProteinRecord };
