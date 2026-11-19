// Retry with exponential backoff, Retry-After handling, typed errors, timeouts and size caps.
import { describe, expect, it } from 'vitest';
import { parseRetryAfter } from '../../electron/net';
import { URL1, makeClient, policy } from '../helpers/harness';

describe('retry and backoff', () => {
  it('retries a 503 with exponential backoff and then succeeds', async () => {
    const { client, calls, sleeps } = makeClient(
      (_c, n) => (n < 3 ? { status: 503 } : { body: '{"ok":1}' }),
      {
        policy: policy({ ratePerSec: 1000, burst: 1000 }),
      },
    );
    const r = await client.request('x', { url: URL1, kind: 'json' });
    expect(r.text).toBe('{"ok":1}');
    expect(calls).toHaveLength(3);
    // random() = 1 -> delay = base * 2^attempt: 500 ms then 1000 ms
    expect(sleeps).toEqual([500, 1000]);
  });

  it('honours Retry-After on a 429 and pauses the host for that long', async () => {
    const { client, calls, sleeps } = makeClient((_c, n) =>
      n === 1 ? { status: 429, headers: { 'retry-after': '3' } } : { body: '{}' },
    );
    await client.request('x', { url: URL1, kind: 'json' });
    expect(calls).toHaveLength(2);
    expect(sleeps).toContain(3000);
    expect((calls[1]?.at ?? 0) - (calls[0]?.at ?? 0)).toBeGreaterThanOrEqual(3000);
  });

  it('exposes the wait in status() so the status bar can show "retrying in N s"', async () => {
    let seen: { host: string; reason: string }[] = [];
    const h = makeClient(
      (_c, n) => (n === 1 ? { status: 429, headers: { 'retry-after': '4' } } : { body: '{}' }),
      {
        extra: {
          sleep: (ms) => {
            if (ms === 4000) seen = h.client.status().waiting;
            h.advance(ms); // keep the virtual clock moving, otherwise the host pause never ends
            return Promise.resolve();
          },
        },
      },
    );
    await h.client.request('x', { url: URL1, kind: 'json' });
    expect(seen[0]).toMatchObject({ host: 'rest.uniprot.org', reason: 'rate limited' });
  });

  it('gives up with rate_limited after the retry budget is spent', async () => {
    const { client, calls } = makeClient(() => ({ status: 429, headers: { 'retry-after': '1' } }), {
      extra: { maxRetries: 2 },
    });
    await expect(client.request('x', { url: URL1, kind: 'json' })).rejects.toMatchObject({
      app: { kind: 'rate_limited', retryAfterMs: 1000 },
    });
    expect(calls).toHaveLength(3);
  });

  it('does not wait out an absurdly long Retry-After', async () => {
    const { client, calls } = makeClient(() => ({ status: 429, headers: { 'retry-after': '600' } }));
    await expect(client.request('x', { url: URL1, kind: 'json' })).rejects.toMatchObject({
      app: { kind: 'rate_limited' },
    });
    expect(calls).toHaveLength(1);
  });

  it('retries network failures, then reports network_down', async () => {
    const { client, calls } = makeClient(() => ({ throws: true }), { extra: { maxRetries: 2 } });
    await expect(client.request('x', { url: URL1, kind: 'json' })).rejects.toMatchObject({
      app: { kind: 'network_down' },
    });
    expect(calls).toHaveLength(3);
  });

  it('never retries POST (not idempotent)', async () => {
    const { client, calls } = makeClient(() => ({ status: 503 }));
    await expect(
      client.request('x', { url: URL1, method: 'POST', body: '{}', kind: 'json' }),
    ).rejects.toMatchObject({ app: { kind: 'server_error' } });
    expect(calls).toHaveLength(1);
  });
});

describe('typed errors', () => {
  it('maps 404 to not_found without retrying', async () => {
    const { client, calls } = makeClient(() => ({ status: 404 }));
    await expect(client.request('x', { url: URL1, kind: 'json' })).rejects.toMatchObject({
      app: { kind: 'not_found', status: 404 },
    });
    expect(calls).toHaveLength(1);
  });

  it('keeps the HTTP status on other 4xx (NCBI answers 400 for an unknown gene ID)', async () => {
    const { client } = makeClient(() => ({ status: 400, body: '{"error":"Bad Request"}' }));
    await expect(client.request('x', { url: URL1, kind: 'json' })).rejects.toMatchObject({
      app: { kind: 'bad_response', status: 400 },
    });
  });

  it('reports invalid JSON as bad_response and does not cache it', async () => {
    const stored: string[] = [];
    const { client } = makeClient(() => ({ body: '<html>oops</html>' }), {
      cache: {
        get: () => Promise.resolve(null),
        put: (_k, _u, b) => (stored.push(b), Promise.resolve(true)),
      },
    });
    await expect(client.request('x', { url: URL1, kind: 'json' })).rejects.toMatchObject({
      app: { kind: 'bad_response' },
    });
    expect(stored).toHaveLength(0);
  });

  it('times out slow servers', async () => {
    const { client } = makeClient(
      (call) =>
        new Promise((_, rej) => call.signal?.addEventListener('abort', () => rej(new Error('aborted')))),
      { extra: { jsonTimeoutMs: 30, maxRetries: 0 } },
    );
    await expect(client.request('x', { url: URL1, kind: 'json' })).rejects.toMatchObject({
      app: { kind: 'timeout' },
    });
  });
});

describe('size caps', () => {
  it('rejects by declared content-length before reading the body', async () => {
    const { client } = makeClient(() => ({ body: '{}', headers: { 'content-length': '999999' } }));
    await expect(client.request('x', { url: URL1, kind: 'json' })).rejects.toMatchObject({
      app: { kind: 'too_large' },
    });
  });

  it('stops a streamed body that exceeds the cap even with no content-length', async () => {
    const { client } = makeClient(() => ({ streamBytes: 100_000 }));
    await expect(client.request('x', { url: URL1, kind: 'json' })).rejects.toMatchObject({
      app: { kind: 'too_large' },
    });
  });

  it('uses the larger cap for structure files than for JSON', async () => {
    const { client } = makeClient(() => ({ body: 'A'.repeat(3000) }));
    await expect(client.request('x', { url: URL1, kind: 'json' })).rejects.toMatchObject({
      app: { kind: 'too_large' },
    });
    const ok = await client.request('y', { url: 'https://alphafold.ebi.ac.uk/files/x.pdb', kind: 'file' });
    expect(ok.text).toHaveLength(3000);
  });
});

describe('parseRetryAfter', () => {
  it('parses seconds, HTTP dates and garbage', () => {
    expect(parseRetryAfter('5', 0)).toBe(5000);
    expect(parseRetryAfter(new Date(10_000).toUTCString(), 4_000)).toBe(6000);
    expect(parseRetryAfter('soon', 0)).toBeNull();
    expect(parseRetryAfter(null, 0)).toBeNull();
  });
});
