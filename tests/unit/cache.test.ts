// Disk cache: TTL, integrity checks, LRU eviction, size caps, restart behaviour, stats.
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DiskCache, cacheKey } from '../../electron/cache';

let dir: string;
let t: number;
const make = (maxBytes = 1_000_000, maxEntryBytes = 500_000) =>
  new DiskCache({ dir, maxBytes, maxEntryBytes, now: () => t });

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ge-cache-'));
  t = 1_000_000;
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('DiskCache', () => {
  it('stores and returns an entry, fresh until its TTL passes', async () => {
    const c = make();
    await c.init();
    const k = cacheKey('GET', 'https://x/y');
    expect(await c.put(k, 'https://x/y', '{"a":1}', 1000)).toBe(true);
    expect(await c.get(k)).toEqual({ body: '{"a":1}', storedAt: 1_000_000, fresh: true });
    t += 1001;
    expect(await c.get(k)).toMatchObject({ body: '{"a":1}', fresh: false }); // stale but still returned (offline mode needs it)
  });

  it('keys differ by method, URL and body', () => {
    const keys = new Set([
      cacheKey('GET', 'u'),
      cacheKey('POST', 'u'),
      cacheKey('POST', 'u', 'a'),
      cacheKey('POST', 'u', 'b'),
      cacheKey('GET', 'v'),
    ]);
    expect(keys.size).toBe(5);
  });

  it('discards a corrupted entry (tampered body) instead of crashing', async () => {
    const c = make();
    await c.init();
    const k = cacheKey('GET', 'u');
    await c.put(k, 'u', 'hello', 1000);
    const file = path.join(dir, `${k}.json`);
    const entry = JSON.parse(await fs.readFile(file, 'utf8')) as Record<string, unknown>;
    entry['body'] = 'tampered';
    await fs.writeFile(file, JSON.stringify(entry));
    expect(await c.get(k)).toBeNull();
    expect(c.stats().corruptDiscarded).toBe(1);
    await expect(fs.access(file)).rejects.toThrow(); // file removed
  });

  it('discards garbage and schema-invalid files', async () => {
    const c = make();
    await c.init();
    const k1 = cacheKey('GET', '1');
    const k2 = cacheKey('GET', '2');
    await c.put(k1, '1', 'a', 1000);
    await c.put(k2, '2', 'b', 1000);
    await fs.writeFile(path.join(dir, `${k1}.json`), '{not json');
    await fs.writeFile(path.join(dir, `${k2}.json`), JSON.stringify({ key: k2, body: 5 }));
    expect(await c.get(k1)).toBeNull();
    expect(await c.get(k2)).toBeNull();
    expect(c.stats()).toMatchObject({ corruptDiscarded: 2, entries: 0 });
  });

  it('evicts the least recently used entry when over the size cap', async () => {
    const c = make(1500); // each entry file is ~ 400-500 bytes
    await c.init();
    const [a, b, d] = ['a', 'b', 'd'].map((n) => cacheKey('GET', n)) as [string, string, string];
    const body = 'x'.repeat(300);
    await c.put(a, 'a', body, 1e9);
    t += 10;
    await c.put(b, 'b', body, 1e9);
    t += 10;
    await c.get(a); // touch a so b is now the least recently used
    t += 10;
    await c.put(d, 'd', body, 1e9);
    expect(await c.get(b)).toBeNull();
    expect(await c.get(a)).not.toBeNull();
    expect(await c.get(d)).not.toBeNull();
    expect(c.stats().evictions).toBeGreaterThanOrEqual(1);
    expect(c.stats().bytes).toBeLessThanOrEqual(1500);
  });

  it('refuses entries larger than the per-entry cap', async () => {
    const c = make(1_000_000, 100);
    await c.init();
    expect(await c.put(cacheKey('GET', 'big'), 'big', 'x'.repeat(500), 1000)).toBe(false);
    expect(c.stats().entries).toBe(0);
  });

  it('survives a restart: entries are re-indexed from disk and leftover .tmp files are removed', async () => {
    const c1 = make();
    await c1.init();
    const k = cacheKey('GET', 'u');
    await c1.put(k, 'u', 'persisted', 1000);
    await fs.writeFile(path.join(dir, 'junk.tmp'), 'half written');
    const c2 = make();
    await c2.init();
    expect(c2.stats().entries).toBe(1);
    expect((await c2.get(k))?.body).toBe('persisted');
    await expect(fs.access(path.join(dir, 'junk.tmp'))).rejects.toThrow();
  });

  it('counts hits and misses and can be cleared', async () => {
    const c = make();
    await c.init();
    const k = cacheKey('GET', 'u');
    await c.get(k);
    await c.put(k, 'u', 'v', 1000);
    await c.get(k);
    expect(c.stats()).toMatchObject({ hits: 1, misses: 1, entries: 1 });
    await c.clear();
    expect(c.stats()).toMatchObject({ entries: 0, bytes: 0 });
    expect(await fs.readdir(dir)).toHaveLength(0);
  });
});
