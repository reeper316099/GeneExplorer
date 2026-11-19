// Shared types used by main, preload, renderer and workers, so every message boundary is checked on both sides.

/** Where a fact came from. Extended in Phase 3 with the orthology sources. */
export type SourceId = 'UniProt' | 'NCBI' | 'Ensembl' | 'AlphaFold' | 'OrthoDB' | 'App';

/** A value together with its provenance (database, record ID, fetch time in ms since epoch). */
export interface Sourced<T> {
  value: T;
  source: SourceId;
  recordId: string;
  fetchedAt: number;
  /** The exact request URL the value came from, when known (shown in the provenance popover). */
  url?: string;
}

/** Why a request failed. Typed so the UI can show a specific, friendly message for each. */
export type ErrorKind =
  | 'rate_limited'
  | 'not_found'
  | 'timeout'
  | 'blocked_host'
  | 'too_large'
  | 'network_down'
  | 'server_error'
  | 'bad_response'
  | 'cancelled'
  | 'invalid_request';

/** Error that crosses the IPC boundary; plain data only (no Error instances). */
export interface AppError {
  kind: ErrorKind;
  message: string;
  /** HTTP status when the failure came from a response (e.g. NCBI returns 400 for an unknown ID). */
  status?: number;
  host?: string;
  /** For rate_limited: how long the server asked us to wait. */
  retryAfterMs?: number;
}

/** Per-panel loading state (discriminated union, one per panel). */
export type Loadable<T> =
  | { status: 'idle' }
  | { status: 'loading'; startedAt: number }
  | { status: 'ready'; data: T; fetchedAt: number; fromCache: boolean }
  | { status: 'empty'; reason: string }
  | { status: 'error'; error: AppError };

/** Result wrapper for IPC calls: errors are returned as data, never thrown across the bridge. */
export type IpcResult<T> = { ok: true; value: T } | { ok: false; error: AppError };

export type Priority = 'user' | 'prefetch';
export type FetchKind = 'json' | 'text' | 'file';

/** What the renderer is allowed to ask for. Headers other than Accept/Content-Type are dropped by the net layer. */
export interface FetchSpec {
  url: string;
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  /** POST body (text, usually JSON). */
  body?: string;
  priority?: Priority;
}

/** Metadata that accompanies every fetched payload (feeds provenance and the status bar). */
export interface FetchMeta {
  url: string;
  fetchedAt: number;
  fromCache: boolean;
  /** true if the entry was past its TTL and served because the network was unavailable/offline mode. */
  stale: boolean;
  bytes: number;
}

export interface FetchedPayload<T> {
  data: T;
  meta: FetchMeta;
}

export interface CacheStats {
  entries: number;
  bytes: number;
  maxBytes: number;
  hits: number;
  misses: number;
  evictions: number;
  corruptDiscarded: number;
  oldestStoredAt: number | null;
}

/** Live network state for the status bar (polled through cacheInfo). */
export interface NetStatus {
  offline: boolean;
  /** Hosts currently waiting out a Retry-After/backoff, with the epoch-ms at which they retry. */
  waiting: { host: string; retryAt: number; reason: string }[];
  inFlight: number;
}

export interface CacheInfo {
  stats: CacheStats;
  status: NetStatus;
}

export interface AppInfo {
  name: string;
  version: string;
  electron: string;
  platform: string;
  userAgent: string;
}

export interface SaveFileSpec {
  suggestedName: string;
  /** File content: UTF-8 text, or base64 when `encoding` is 'base64' (used for PNG). */
  data: string;
  encoding: 'utf8' | 'base64';
  filters: { name: string; extensions: string[] }[];
}

export type SaveResult = { saved: true; path: string } | { saved: false };

/** Commands the main process (menu/shortcuts) sends to the renderer. */
export type MenuCommand =
  | 'focus-search'
  | 'tab-1'
  | 'tab-2'
  | 'tab-3'
  | 'tab-4'
  | 'tab-5'
  | 'export-report'
  | 'export-csv'
  | 'export-fasta'
  | 'export-png'
  | 'toggle-dark'
  | 'nav-back'
  | 'nav-forward'
  | 'show-about'
  | 'show-sources';

/** The only surface the preload script exposes to the renderer as `window.geneExplorer`. */
export interface GeneExplorerApi {
  fetchJson(requestId: string, spec: FetchSpec): Promise<IpcResult<FetchedPayload<unknown>>>;
  fetchText(requestId: string, spec: FetchSpec): Promise<IpcResult<FetchedPayload<string>>>;
  cancel(requestId: string): Promise<void>;
  cacheInfo(): Promise<CacheInfo>;
  clearCache(): Promise<IpcResult<CacheStats>>;
  saveFile(spec: SaveFileSpec): Promise<IpcResult<SaveResult>>;
  printPdf(suggestedName: string): Promise<IpcResult<SaveResult>>;
  openExternal(url: string): Promise<IpcResult<true>>;
  getAppInfo(): Promise<AppInfo>;
  /** Receive-only channel for menu/shortcut commands; returns an unsubscribe function. */
  onMenuCommand(handler: (command: MenuCommand) => void): () => void;
}

/** IPC channel names, shared so main and preload cannot drift apart. */
export const IPC = {
  fetchJson: 'net:fetchJson',
  fetchText: 'net:fetchText',
  cancel: 'net:cancel',
  cacheInfo: 'cache:info',
  clearCache: 'cache:clear',
  saveFile: 'file:save',
  printPdf: 'file:printPdf',
  openExternal: 'shell:openExternal',
  getAppInfo: 'app:info',
  menuCommand: 'menu:command',
} as const;
