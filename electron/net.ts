// THE ONLY network code in the app. Every request passes through NetClient, which enforces:
// https + host allowlist, header allowlist, per-host token-bucket rate limit and concurrency cap, priority queue,
// in-flight de-duplication, cancellation, timeouts, size caps, retry with backoff + Retry-After, and the disk cache.
import { API_HOSTS, ALLOWED_REQUEST_HEADERS, type HostPolicy } from './allowlist';
import { cacheKey, type CacheLike } from './cache';
import type { AppError, ErrorKind, FetchKind, FetchMeta, NetStatus, Priority } from '../src/shared/types';

/** Error thrown inside the net layer; carries the plain-data AppError that is sent over IPC. */
export class NetError extends Error {
  constructor(public readonly app: AppError) {
    super(app.message);
  }
}

function fail(kind: ErrorKind, message: string, extra: Partial<AppError> = {}): NetError {
  return new NetError({ kind, message, ...extra });
}

export interface NetRequest {
  url: string;
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
  priority?: Priority;
  kind: FetchKind;
  /** Skip the cache read (still writes the fresh result). */
  forceRefresh?: boolean;
}

export interface NetResult {
  text: string;
  meta: FetchMeta;
}

export interface NetDeps {
  fetchImpl: typeof fetch;
  cache: CacheLike | null;
  userAgent: string;
  now?: () => number;
  /** Resolves after ms, or rejects if the signal aborts. Injectable so tests can use a virtual clock. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  random?: () => number;
  hosts?: Readonly<Record<string, HostPolicy>>;
  maxRetries?: number;
  baseBackoffMs?: number;
  /** A Retry-After longer than this is not waited out; the request fails as rate_limited instead. */
  maxRetryAfterMs?: number;
  jsonTimeoutMs?: number;
  fileTimeoutMs?: number;
}

const defaultSleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('aborted'));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new Error('aborted'));
    });
  });

/** Parse a Retry-After header: delta-seconds or an HTTP date. Returns ms, or null if absent/unparseable. */
export function parseRetryAfter(value: string | null, nowMs: number): number | null {
  if (!value) return null;
  const secs = Number(value);
  if (Number.isFinite(secs) && secs >= 0) return Math.round(secs * 1000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, date - nowMs);
}

/** Validate a URL against the rules: https only, no credentials, no custom port, allowlisted host. */
export function validateUrl(raw: string, hosts: Readonly<Record<string, HostPolicy>> = API_HOSTS): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw fail('invalid_request', 'Not a valid URL.');
  }
  if (url.protocol !== 'https:')
    throw fail('blocked_host', 'Only https URLs are allowed.', { host: url.hostname });
  if (url.username || url.password)
    throw fail('blocked_host', 'URLs with credentials are not allowed.', { host: url.hostname });
  if (url.port && url.port !== '443')
    throw fail('blocked_host', 'Custom ports are not allowed.', { host: url.hostname });
  if (!Object.prototype.hasOwnProperty.call(hosts, url.hostname)) {
    throw fail('blocked_host', `Host ${url.hostname} is not on the allowlist.`, { host: url.hostname });
  }
  return url;
}

/** Keep only allowlisted request headers (lower-cased). */
export function sanitizeHeaders(headers: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers ?? {})) {
    if (ALLOWED_REQUEST_HEADERS.includes(k.toLowerCase())) out[k.toLowerCase()] = v;
  }
  return out;
}

interface Job {
  priority: Priority;
  seq: number;
  cancelled: boolean;
  start: () => void;
}

/** Token bucket + concurrency cap + two-level priority queue for ONE host. */
export class HostLimiter {
  private tokens: number;
  private lastRefill: number;
  private active = 0;
  private pumping = false;
  private seq = 0;
  private pausedUntil = 0;
  private readonly queue: Job[] = [];

  constructor(
    private readonly policy: HostPolicy,
    private readonly now: () => number,
    private readonly sleep: (ms: number) => Promise<void>,
  ) {
    this.tokens = policy.burst;
    this.lastRefill = now();
  }

  /** Run `task` when a token and a concurrency slot are available; user jobs go before prefetch jobs. */
  schedule<T>(priority: Priority, signal: AbortSignal, task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (signal.aborted) return reject(fail('cancelled', 'Request cancelled.'));
      const job: Job = {
        priority,
        seq: this.seq++,
        cancelled: false,
        start: () => {
          this.active++;
          task()
            .then(resolve, reject)
            .finally(() => {
              this.active--;
              void this.pump();
            });
        },
      };
      signal.addEventListener('abort', () => {
        job.cancelled = true;
        const i = this.queue.indexOf(job);
        if (i >= 0) this.queue.splice(i, 1);
        reject(fail('cancelled', 'Request cancelled.'));
      });
      this.queue.push(job);
      void this.pump();
    });
  }

  /** Server told us to back off (429/503 + Retry-After): nothing is sent to this host until then. */
  pauseFor(ms: number): void {
    this.pausedUntil = Math.max(this.pausedUntil, this.now() + ms);
  }

  private next(): Job | undefined {
    let best = -1;
    for (let i = 0; i < this.queue.length; i++) {
      const j = this.queue[i];
      const b = this.queue[best];
      if (!j) continue;
      if (
        !b ||
        (j.priority === 'user' && b.priority !== 'user') ||
        (j.priority === b.priority && j.seq < b.seq)
      )
        best = i;
    }
    return best >= 0 ? this.queue.splice(best, 1)[0] : undefined;
  }

  private async pump(): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (this.queue.length > 0 && this.active < this.policy.maxConcurrent) {
        const t = this.now();
        if (t < this.pausedUntil) {
          await this.sleep(this.pausedUntil - t);
          continue;
        }
        // Refill: tokens += elapsed_seconds * rate, capped at the burst size.
        this.tokens = Math.min(
          this.policy.burst,
          this.tokens + ((t - this.lastRefill) / 1000) * this.policy.ratePerSec,
        );
        this.lastRefill = t;
        if (this.tokens < 1) {
          await this.sleep(Math.ceil(((1 - this.tokens) / this.policy.ratePerSec) * 1000));
          continue;
        }
        const job = this.next();
        if (!job || job.cancelled) continue;
        this.tokens -= 1;
        job.start();
      }
    } finally {
      this.pumping = false;
    }
  }
}

interface InFlight {
  promise: Promise<NetResult>;
  controller: AbortController;
  subscribers: Set<string>;
}

interface Attempt {
  status: number;
  retryAfterMs: number | null;
  text: string;
}

export class NetClient {
  private readonly now: () => number;
  private readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  private readonly random: () => number;
  private readonly hosts: Readonly<Record<string, HostPolicy>>;
  private readonly limiters = new Map<string, HostLimiter>();
  private readonly inflight = new Map<string, InFlight>();
  private readonly cancelHooks = new Map<string, (e: NetError) => void>();
  private readonly waiting = new Map<number, { host: string; retryAt: number; reason: string }>();
  private waitSeq = 0;
  private offline = false;

  constructor(private readonly deps: NetDeps) {
    this.now = deps.now ?? Date.now;
    this.sleep = deps.sleep ?? defaultSleep;
    this.random = deps.random ?? Math.random;
    this.hosts = deps.hosts ?? API_HOSTS;
  }

  setOffline(value: boolean): void {
    this.offline = value;
  }

  status(): NetStatus {
    return { offline: this.offline, waiting: [...this.waiting.values()], inFlight: this.inflight.size };
  }

  /** Cancel one caller. The underlying request is aborted only when no other caller still wants it. */
  cancel(requestId: string): void {
    this.cancelHooks.get(requestId)?.(fail('cancelled', 'Request cancelled.'));
    for (const entry of this.inflight.values()) {
      if (entry.subscribers.delete(requestId) && entry.subscribers.size === 0) entry.controller.abort();
    }
  }

  private limiter(host: string, policy: HostPolicy): HostLimiter {
    let l = this.limiters.get(host);
    if (!l) {
      l = new HostLimiter(policy, this.now, (ms) => this.sleep(ms));
      this.limiters.set(host, l);
    }
    return l;
  }

  /** Main entry point: cache -> dedupe -> rate-limited fetch with retries -> cache write. */
  async request(requestId: string, req: NetRequest): Promise<NetResult> {
    const url = validateUrl(req.url, this.hosts);
    const method = req.method ?? 'GET';
    if (method === 'GET' && req.body !== undefined)
      throw fail('invalid_request', 'GET requests cannot have a body.');
    const policy = this.hosts[url.hostname];
    if (!policy) throw fail('blocked_host', 'Host is not on the allowlist.');
    const key = cacheKey(method, url.toString(), req.body);

    const cached = this.deps.cache && !req.forceRefresh ? await this.deps.cache.get(key) : null;
    if (cached?.fresh)
      return {
        text: cached.body,
        meta: this.meta(url.toString(), cached.storedAt, true, false, cached.body),
      };
    if (this.offline) {
      if (cached)
        return {
          text: cached.body,
          meta: this.meta(url.toString(), cached.storedAt, true, true, cached.body),
        };
      throw fail('network_down', 'Offline mode is on and this item is not in the cache.', {
        host: url.hostname,
      });
    }

    let entry = this.inflight.get(key);
    if (!entry) {
      const controller = new AbortController();
      const promise = this.execute(url, method, req, policy, controller.signal)
        .then(async (text) => {
          const ttl = policy.ttlMs;
          await this.deps.cache?.put(key, url.toString(), text, ttl).catch(() => false);
          return { text, meta: this.meta(url.toString(), this.now(), false, false, text) };
        })
        .finally(() => this.inflight.delete(key));
      entry = { promise, controller, subscribers: new Set() };
      this.inflight.set(key, entry);
    }
    entry.subscribers.add(requestId);

    const cancelled = new Promise<never>((_, reject) => this.cancelHooks.set(requestId, reject));
    cancelled.catch(() => undefined); // avoid an unhandled rejection when the request finishes first
    try {
      return await Promise.race([entry.promise, cancelled]);
    } catch (e) {
      const err = e instanceof NetError ? e : fail('network_down', 'Network request failed.');
      // Serve a stale cache entry instead of failing when the network (not the user) is the problem.
      if (cached && ['network_down', 'timeout', 'server_error', 'rate_limited'].includes(err.app.kind)) {
        return {
          text: cached.body,
          meta: this.meta(url.toString(), cached.storedAt, true, true, cached.body),
        };
      }
      throw err;
    } finally {
      this.cancelHooks.delete(requestId);
      entry.subscribers.delete(requestId);
    }
  }

  private meta(url: string, fetchedAt: number, fromCache: boolean, stale: boolean, text: string): FetchMeta {
    return { url, fetchedAt, fromCache, stale, bytes: Buffer.byteLength(text) };
  }

  /** Retry loop. Only idempotent requests (GET) are retried; each attempt takes a rate-limit token. */
  private async execute(
    url: URL,
    method: 'GET' | 'POST',
    req: NetRequest,
    policy: HostPolicy,
    signal: AbortSignal,
  ): Promise<string> {
    const limiter = this.limiter(url.hostname, policy);
    const maxRetries = method === 'GET' ? (this.deps.maxRetries ?? 3) : 0;
    const base = this.deps.baseBackoffMs ?? 500;
    const maxRetryAfter = this.deps.maxRetryAfterMs ?? 60_000;
    const priority = req.priority ?? 'user';

    for (let attempt = 0; ; attempt++) {
      let result: Attempt | NetError;
      try {
        result = await limiter.schedule(priority, signal, () => this.once(url, method, req, policy, signal));
      } catch (e) {
        if (e instanceof NetError && e.app.kind === 'cancelled') throw e;
        if (signal.aborted) throw fail('cancelled', 'Request cancelled.');
        if (!(e instanceof NetError))
          throw fail('network_down', 'Network request failed.', { host: url.hostname });
        result = e;
      }

      if (!(result instanceof NetError)) {
        const { status } = result;
        if (status >= 200 && status < 300) {
          if (req.kind === 'json') {
            try {
              JSON.parse(result.text);
            } catch {
              throw fail('bad_response', 'The server did not return valid JSON.', {
                status,
                host: url.hostname,
              });
            }
          }
          return result.text;
        }
        if (status === 404) throw fail('not_found', 'Not found.', { status, host: url.hostname });
        const retryable =
          status === 429 || status === 502 || status === 503 || status === 504 || status === 500;
        if (!retryable)
          throw fail('bad_response', `Unexpected HTTP status ${status}.`, { status, host: url.hostname });
        const kind: ErrorKind = status === 429 ? 'rate_limited' : 'server_error';
        if (attempt >= maxRetries) {
          throw fail(
            kind,
            status === 429 ? 'Rate limited by the server.' : `Server error (HTTP ${status}).`,
            {
              status,
              host: url.hostname,
              ...(result.retryAfterMs !== null ? { retryAfterMs: result.retryAfterMs } : {}),
            },
          );
        }
        if (result.retryAfterMs !== null && result.retryAfterMs > maxRetryAfter) {
          throw fail('rate_limited', 'The server asked us to wait too long; try again later.', {
            status,
            host: url.hostname,
            retryAfterMs: result.retryAfterMs,
          });
        }
        // Exponential backoff with jitter (base * 2^attempt * [0.5,1)), unless the server dictated a wait.
        const delay = result.retryAfterMs ?? Math.round(base * 2 ** attempt * (0.5 + this.random() / 2));
        if (status === 429 || result.retryAfterMs !== null) limiter.pauseFor(delay);
        await this.wait(url.hostname, delay, status === 429 ? 'rate limited' : 'server busy', signal);
        continue;
      }

      // Thrown NetError from `once`: timeout, too_large, bad redirect, network failure.
      const err = result;
      const retryable = err.app.kind === 'network_down' || err.app.kind === 'timeout';
      if (!retryable || attempt >= maxRetries) throw err;
      await this.wait(
        url.hostname,
        Math.round(base * 2 ** attempt * (0.5 + this.random() / 2)),
        'retrying',
        signal,
      );
    }
  }

  private async wait(host: string, ms: number, reason: string, signal: AbortSignal): Promise<void> {
    const id = this.waitSeq++;
    this.waiting.set(id, { host, retryAt: this.now() + ms, reason });
    try {
      await this.sleep(ms, signal);
    } catch {
      throw fail('cancelled', 'Request cancelled.');
    } finally {
      this.waiting.delete(id);
    }
  }

  /** One HTTP attempt: manual redirects (re-validated against the allowlist), timeout, streamed size cap. */
  private async once(
    url: URL,
    method: 'GET' | 'POST',
    req: NetRequest,
    policy: HostPolicy,
    outer: AbortSignal,
  ): Promise<Attempt> {
    const timeoutMs =
      req.kind === 'file' ? (this.deps.fileTimeoutMs ?? 60_000) : (this.deps.jsonTimeoutMs ?? 30_000);
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = AbortSignal.any([outer, timeout]);
    const cap = req.kind === 'file' ? policy.maxFileBytes : policy.maxJsonBytes;
    const headers = {
      accept: req.kind === 'json' ? 'application/json' : '*/*',
      ...sanitizeHeaders(req.headers),
      'user-agent': this.deps.userAgent, // always set by main; the renderer cannot override it
    };
    let current = url;
    try {
      for (let hop = 0; hop < 4; hop++) {
        const res = await this.deps.fetchImpl(current.toString(), {
          method,
          headers,
          ...(method === 'POST' && req.body !== undefined ? { body: req.body } : {}),
          redirect: 'manual',
          signal,
        });
        if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
          current = validateUrl(new URL(res.headers.get('location') ?? '', current).toString(), this.hosts);
          continue;
        }
        const retryAfterMs = parseRetryAfter(res.headers.get('retry-after'), this.now());
        const declared = Number(res.headers.get('content-length') ?? '0');
        if (declared > cap) {
          await res.body?.cancel();
          throw fail('too_large', `Response is larger than the ${cap} byte limit.`, { host: url.hostname });
        }
        return { status: res.status, retryAfterMs, text: await readCapped(res, cap, url.hostname) };
      }
      throw fail('bad_response', 'Too many redirects.', { host: url.hostname });
    } catch (e) {
      if (e instanceof NetError) throw e;
      if (outer.aborted) throw fail('cancelled', 'Request cancelled.');
      if (timeout.aborted)
        throw fail('timeout', 'The server took too long to respond.', { host: url.hostname });
      throw fail('network_down', 'Could not reach the server.', { host: url.hostname });
    }
  }
}

/** Read a response body as text while enforcing a byte cap (stops reading as soon as it is exceeded). */
async function readCapped(res: Response, cap: number, host: string): Promise<string> {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    // The stream type comes from undici's typings, which declare chunks as `any`; Response bodies always yield Uint8Array.
    const { done, value } = (await reader.read()) as { done: boolean; value: Uint8Array };
    if (done) break;
    total += value.byteLength;
    if (total > cap) {
      await reader.cancel();
      throw fail('too_large', `Response is larger than the ${cap} byte limit.`, { host });
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}
