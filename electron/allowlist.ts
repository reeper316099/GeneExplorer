// The only hostnames the app may call (net layer) or open in the system browser (openExternal).
// Per-host limits are deliberately BELOW each source's published/observed limit (see docs/PHASE1-REPORT.md).

export interface HostPolicy {
  /** Sustained requests per second (token refill rate). */
  ratePerSec: number;
  /** Max burst size (bucket capacity). */
  burst: number;
  /** Cap on a JSON/text response in bytes. */
  maxJsonBytes: number;
  /** Cap on a structure-file response in bytes. */
  maxFileBytes: number;
  /** Default cache TTL for this host in ms. */
  ttlMs: number;
  /** Max simultaneous requests to this host. */
  maxConcurrent: number;
}

const DAY = 24 * 60 * 60 * 1000;

export const API_HOSTS: Readonly<Record<string, HostPolicy>> = {
  // UniProt: no published numeric limit found; be conservative.
  'rest.uniprot.org': {
    ratePerSec: 5,
    burst: 5,
    maxJsonBytes: 25_000_000,
    maxFileBytes: 25_000_000,
    ttlMs: 7 * DAY,
    maxConcurrent: 4,
  },
  // NCBI Datasets: 5 req/s without a key (x-ratelimit-limit header observed), so use 3.
  'api.ncbi.nlm.nih.gov': {
    ratePerSec: 3,
    burst: 3,
    maxJsonBytes: 25_000_000,
    maxFileBytes: 25_000_000,
    ttlMs: 7 * DAY,
    maxConcurrent: 3,
  },
  // Ensembl publishes ~15 req/s and 55,000/hour; use 8/s. (Unreachable from the dev network in Phase 1.)
  'rest.ensembl.org': {
    ratePerSec: 8,
    burst: 8,
    maxJsonBytes: 25_000_000,
    maxFileBytes: 25_000_000,
    ttlMs: 7 * DAY,
    maxConcurrent: 4,
  },
  // AlphaFold: needs a User-Agent; structure files are fetched from the same host.
  'alphafold.ebi.ac.uk': {
    ratePerSec: 5,
    burst: 5,
    maxJsonBytes: 25_000_000,
    maxFileBytes: 50_000_000,
    ttlMs: 30 * DAY,
    maxConcurrent: 4,
  },
  // OrthoDB: some calls take ~5 s and payloads reach 7 MB; stay gentle.
  'data.orthodb.org': {
    ratePerSec: 2,
    burst: 2,
    maxJsonBytes: 25_000_000,
    maxFileBytes: 25_000_000,
    ttlMs: 14 * DAY,
    maxConcurrent: 2,
  },
};

/** Hosts openExternal may open (https only). Link-outs to database pages plus the project repo. */
export const EXTERNAL_HOSTS: readonly string[] = [
  'www.ncbi.nlm.nih.gov',
  'www.uniprot.org',
  'rest.uniprot.org',
  'alphafold.ebi.ac.uk',
  'www.ensembl.org',
  'www.orthodb.org',
  'github.com',
  'creativecommons.org',
  'www.clinicalgenome.org',
  'gnomad.broadinstitute.org',
  'doi.org',
];

/** Request headers the renderer may set; everything else is dropped (User-Agent is set by main only). */
export const ALLOWED_REQUEST_HEADERS: readonly string[] = ['accept', 'content-type'];

export function isApiHost(hostname: string): boolean {
  return Object.prototype.hasOwnProperty.call(API_HOSTS, hostname);
}

export function isExternalHost(hostname: string): boolean {
  return EXTERNAL_HOSTS.includes(hostname);
}
