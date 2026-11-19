// How the net layer uses the cache: hits, TTL expiry, stale-on-failure, and offline mode.
import { describe, expect, it } from 'vitest';
import { URL1, makeClient, memoryCache, policy } from '../helpers/harness';

function setup(reply: Parameters<typeof makeClient>[0]) {
  let clock = () => 0;
  const holder = makeClient(reply, {
    policy: policy({ ttlMs: 1000, ratePerSec: 1000, burst: 1000 }),
    cache: { get: (k) => mem.cache.get(k), put: (k, u, b, t) => mem.cache.put(k, u, b, t) },
    extra: { maxRetries: 0 },
  });
  clock = holder.now;
  const mem = memoryCache(() => clock());
  return { ...holder, mem };
}

describe('cache behaviour in the net layer', () => {
  it('serves a repeat request from the cache without touching the network', async () => {
    const h = setup(() => ({ body: '{"v":1}' }));
    const first = await h.client.request('1', { url: URL1, kind: 'json' });
    const second = await h.client.request('2', { url: URL1, kind: 'json' });
    expect(h.calls).toHaveLength(1);
    expect(first.meta.fromCache).toBe(false);
    expect(second.meta).toMatchObject({ fromCache: true, stale: false });
  });

  it('refetches after the TTL expires', async () => {
    let n = 0;
    const h = setup(() => ({ body: `{"v":${++n}}` }));
    await h.client.request('1', { url: URL1, kind: 'json' });
    h.advance(1001);
    const r = await h.client.request('2', { url: URL1, kind: 'json' });
    expect(h.calls).toHaveLength(2);
    expect(r.text).toBe('{"v":2}');
  });

  it('forceRefresh bypasses a fresh cache entry', async () => {
    const h = setup(() => ({ body: '{}' }));
    await h.client.request('1', { url: URL1, kind: 'json' });
    await h.client.request('2', { url: URL1, kind: 'json', forceRefresh: true });
    expect(h.calls).toHaveLength(2);
  });

  it('serves a stale entry (flagged stale) when the network is down', async () => {
    let down = false;
    const h = setup(() => (down ? { throws: true } : { body: '{"v":1}' }));
    await h.client.request('1', { url: URL1, kind: 'json' });
    h.advance(5000);
    down = true;
    const r = await h.client.request('2', { url: URL1, kind: 'json' });
    expect(r.text).toBe('{"v":1}');
    expect(r.meta).toMatchObject({ fromCache: true, stale: true });
  });

  it('does not hide a 404 behind a stale entry', async () => {
    let gone = false;
    const h = setup(() => (gone ? { status: 404 } : { body: '{}' }));
    await h.client.request('1', { url: URL1, kind: 'json' });
    h.advance(5000);
    gone = true;
    await expect(h.client.request('2', { url: URL1, kind: 'json' })).rejects.toMatchObject({
      app: { kind: 'not_found' },
    });
  });

  it('offline mode serves stale entries and never calls the network', async () => {
    const h = setup(() => ({ body: '{"v":1}' }));
    await h.client.request('1', { url: URL1, kind: 'json' });
    h.advance(5000);
    h.client.setOffline(true);
    const r = await h.client.request('2', { url: URL1, kind: 'json' });
    expect(r.meta.stale).toBe(true);
    expect(h.calls).toHaveLength(1);
    expect(h.client.status().offline).toBe(true);
  });

  it('offline mode gives a friendly network_down error for an uncached item', async () => {
    const h = setup(() => ({ body: '{}' }));
    h.client.setOffline(true);
    await expect(h.client.request('1', { url: `${URL1}?other=1`, kind: 'json' })).rejects.toMatchObject({
      app: { kind: 'network_down' },
    });
    expect(h.calls).toHaveLength(0);
  });
});
