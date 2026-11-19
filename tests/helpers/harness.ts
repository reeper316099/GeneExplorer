// Test harness: a NetClient wired to a scripted fake server and a VIRTUAL clock (sleep advances time instantly).
import { NetClient, type NetDeps } from '../../electron/net';
import type { HostPolicy } from '../../electron/allowlist';
import type { CacheLike } from '../../electron/cache';

export interface FakeReply {
  status?: number;
  body?: string;
  headers?: Record<string, string>;
  /** Reject like a dropped connection. */
  throws?: boolean;
  /** Stream this many bytes (ignores body) without a content-length header. */
  streamBytes?: number;
}

export interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  at: number;
  signal: AbortSignal | null | undefined;
}

export const TEST_HOST = 'rest.uniprot.org';
export const URL1 = `https://${TEST_HOST}/uniprotkb/P04637.json`;

export function policy(over: Partial<HostPolicy> = {}): HostPolicy {
  return {
    ratePerSec: 2,
    burst: 2,
    maxJsonBytes: 1000,
    maxFileBytes: 5000,
    ttlMs: 1000,
    maxConcurrent: 10,
    ...over,
  };
}

export function makeClient(
  reply: (call: Call, n: number) => FakeReply | Promise<FakeReply>,
  opts: { policy?: HostPolicy; cache?: CacheLike | null; extra?: Partial<NetDeps> } = {},
) {
  let t = 1_000_000;
  const calls: Call[] = [];
  const sleeps: number[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries((init?.headers ?? {}) as Record<string, string>)) headers[k] = v;
    const call: Call = {
      url: typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
      method: init?.method ?? 'GET',
      headers,
      at: t,
      signal: init?.signal,
    };
    calls.push(call);
    const r = await reply(call, calls.length);
    if (r.throws) throw new TypeError('fetch failed');
    if (r.streamBytes !== undefined) {
      const chunk = new Uint8Array(100).fill(97);
      let sent = 0;
      const total = r.streamBytes;
      const body = new ReadableStream<Uint8Array>({
        pull(c) {
          if (sent >= total) return c.close();
          c.enqueue(chunk);
          sent += chunk.length;
        },
      });
      return new Response(body, { status: r.status ?? 200 });
    }
    return new Response(r.body ?? '{}', { status: r.status ?? 200, headers: r.headers ?? {} });
  };
  const client = new NetClient({
    fetchImpl,
    cache: opts.cache ?? null,
    userAgent: 'GeneExplorer/test',
    now: () => t,
    sleep: (ms) => {
      sleeps.push(ms);
      t += ms;
      return Promise.resolve();
    },
    random: () => 1,
    hosts: { [TEST_HOST]: opts.policy ?? policy(), 'alphafold.ebi.ac.uk': policy() },
    baseBackoffMs: 500,
    ...opts.extra,
  });
  return { client, calls, sleeps, now: () => t, advance: (ms: number) => (t += ms) };
}

/** In-memory CacheLike with a controllable clock, for net-layer tests that don't need the disk. */
export function memoryCache(now: () => number) {
  const m = new Map<string, { body: string; storedAt: number; ttlMs: number }>();
  const cache: CacheLike = {
    get: (k) => {
      const e = m.get(k);
      return Promise.resolve(
        e ? { body: e.body, storedAt: e.storedAt, fresh: now() - e.storedAt < e.ttlMs } : null,
      );
    },
    put: (k, _u, body, ttlMs) => {
      m.set(k, { body, storedAt: now(), ttlMs });
      return Promise.resolve(true);
    },
  };
  return { cache, map: m };
}
