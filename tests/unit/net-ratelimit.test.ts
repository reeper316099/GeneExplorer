// Rate limiter (token bucket), priority queue, de-duplication and cancellation.
import { describe, expect, it } from 'vitest';
import { URL1, makeClient, policy } from '../helpers/harness';

describe('per-host token bucket', () => {
  it('lets a burst through, then spaces requests at the configured rate', async () => {
    const { client, calls } = makeClient(() => ({ body: '{}' }), {
      policy: policy({ ratePerSec: 2, burst: 2 }),
    });
    const urls = [1, 2, 3, 4, 5, 6].map((i) => `${URL1}?n=${i}`);
    await Promise.all(urls.map((u, i) => client.request(`r${i}`, { url: u, kind: 'json' })));
    const t0 = calls[0]?.at ?? 0;
    // burst of 2 at t=0, then one token every 500 ms (2 req/s)
    expect(calls.map((c) => c.at - t0)).toEqual([0, 0, 500, 1000, 1500, 2000]);
  });

  it('sends user-priority requests before queued prefetch requests', async () => {
    const { client, calls } = makeClient(() => ({ body: '{}' }), {
      policy: policy({ ratePerSec: 1, burst: 1 }),
    });
    const order = ['first', 'prefetchA', 'prefetchB', 'user'];
    const reqs = [
      client.request('1', { url: `${URL1}?q=first`, kind: 'json' }),
      client.request('2', { url: `${URL1}?q=prefetchA`, kind: 'json', priority: 'prefetch' }),
      client.request('3', { url: `${URL1}?q=prefetchB`, kind: 'json', priority: 'prefetch' }),
      client.request('4', { url: `${URL1}?q=user`, kind: 'json', priority: 'user' }),
    ];
    await Promise.all(reqs);
    const sent = calls.map((c) => c.url.split('q=')[1]);
    expect(sent).toEqual(['first', 'user', 'prefetchA', 'prefetchB']);
    expect(order).toHaveLength(4);
  });

  it('respects the per-host concurrency cap', async () => {
    let active = 0;
    let peak = 0;
    const { client } = makeClient(
      async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 5));
        active--;
        return { body: '{}' };
      },
      { policy: policy({ ratePerSec: 1000, burst: 1000, maxConcurrent: 2 }) },
    );
    await Promise.all(
      [1, 2, 3, 4, 5].map((i) => client.request(`c${i}`, { url: `${URL1}?n=${i}`, kind: 'json' })),
    );
    expect(peak).toBe(2);
  });
});

describe('in-flight de-duplication', () => {
  it('shares one network call between identical simultaneous requests', async () => {
    const { client, calls } = makeClient(() => ({ body: '{"a":1}' }));
    const [a, b] = await Promise.all([
      client.request('a', { url: URL1, kind: 'json' }),
      client.request('b', { url: URL1, kind: 'json' }),
    ]);
    expect(calls).toHaveLength(1);
    expect(a.text).toBe(b.text);
  });

  it('does not de-duplicate POSTs with different bodies', async () => {
    const { client, calls } = makeClient(() => ({ body: '{}' }));
    await Promise.all([
      client.request('a', { url: URL1, method: 'POST', body: '{"x":1}', kind: 'json' }),
      client.request('b', { url: URL1, method: 'POST', body: '{"x":2}', kind: 'json' }),
    ]);
    expect(calls).toHaveLength(2);
  });
});

describe('cancellation', () => {
  it('cancelling one of two subscribers leaves the shared request running for the other', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    const { client, calls } = makeClient(async () => {
      await gate;
      return { body: '{"ok":true}' };
    });
    const a = client.request('a', { url: URL1, kind: 'json' });
    const b = client.request('b', { url: URL1, kind: 'json' });
    await new Promise((r) => setTimeout(r, 5));
    client.cancel('a');
    release();
    await expect(a).rejects.toMatchObject({ app: { kind: 'cancelled' } });
    await expect(b).resolves.toMatchObject({ text: '{"ok":true}' });
    expect(calls[0]?.signal?.aborted).toBe(false);
  });

  it('aborts the network request when every subscriber has cancelled', async () => {
    const { client, calls } = makeClient(
      (call) =>
        new Promise((_, reject) =>
          call.signal?.addEventListener('abort', () => reject(new Error('aborted'))),
        ),
    );
    const a = client.request('a', { url: URL1, kind: 'json' });
    await new Promise((r) => setTimeout(r, 5));
    client.cancel('a');
    await expect(a).rejects.toMatchObject({ app: { kind: 'cancelled' } });
    expect(calls[0]?.signal?.aborted).toBe(true);
  });

  it('a cancelled request still queued behind the limiter never reaches the network', async () => {
    const { client, calls } = makeClient(() => ({ body: '{}' }), {
      policy: policy({ ratePerSec: 1, burst: 1 }),
    });
    const first = client.request('1', { url: `${URL1}?n=1`, kind: 'json' });
    const second = client.request('2', { url: `${URL1}?n=2`, kind: 'json' });
    client.cancel('2');
    await first;
    await expect(second).rejects.toMatchObject({ app: { kind: 'cancelled' } });
    expect(calls).toHaveLength(1);
  });
});
