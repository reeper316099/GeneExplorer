// Persistent on-disk cache: one JSON file per request, TTL per entry, total size cap with LRU eviction,
// integrity check on every read (corrupt files are deleted, never thrown).
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { CacheEntrySchema } from '../src/shared/schemas';
import type { CacheStats } from '../src/shared/types';

/** What the net layer needs from a cache (lets tests inject an in-memory fake). */
export interface CacheLike {
  get(key: string): Promise<CacheHit | null>;
  put(key: string, url: string, body: string, ttlMs: number): Promise<boolean>;
}

export interface CacheHit {
  body: string;
  storedAt: number;
  /** false when the entry is past its TTL (still returned so offline mode can use it). */
  fresh: boolean;
}

interface IndexItem {
  bytes: number;
  storedAt: number;
  lastAccess: number;
}

export interface DiskCacheOptions {
  dir: string;
  /** Total size cap in bytes; least-recently-used entries are evicted beyond it. */
  maxBytes: number;
  /** Single entries larger than this are not cached at all. */
  maxEntryBytes: number;
  now?: () => number;
}

/** Cache key: SHA-256 over method, URL and body, so POSTs with different bodies never collide. */
export function cacheKey(method: string, url: string, body?: string): string {
  return createHash('sha256')
    .update(`${method} ${url}\n${body ?? ''}`)
    .digest('hex');
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

export class DiskCache implements CacheLike {
  private readonly index = new Map<string, IndexItem>();
  private totalBytes = 0;
  private hits = 0;
  private misses = 0;
  private evictions = 0;
  private corrupt = 0;
  private readonly now: () => number;

  constructor(private readonly opts: DiskCacheOptions) {
    this.now = opts.now ?? Date.now;
  }

  /** Scan the cache directory once at startup; sizes/mtimes come from stat (no file bodies are read). */
  async init(): Promise<void> {
    await fs.mkdir(this.opts.dir, { recursive: true });
    this.index.clear();
    this.totalBytes = 0;
    for (const name of await fs.readdir(this.opts.dir)) {
      if (name.endsWith('.tmp')) {
        await fs.rm(path.join(this.opts.dir, name), { force: true });
        continue;
      }
      if (!name.endsWith('.json')) continue;
      const stat = await fs.stat(path.join(this.opts.dir, name)).catch(() => null);
      if (!stat) continue;
      // Only restart-time LRU info we have is the write time (mtime); in-memory access times take over afterwards.
      this.index.set(name.slice(0, -5), {
        bytes: stat.size,
        storedAt: stat.mtimeMs,
        lastAccess: stat.mtimeMs,
      });
      this.totalBytes += stat.size;
    }
  }

  private file(key: string): string {
    return path.join(this.opts.dir, `${key}.json`);
  }

  private drop(key: string): void {
    const item = this.index.get(key);
    if (item) {
      this.totalBytes -= item.bytes;
      this.index.delete(key);
    }
  }

  async get(key: string): Promise<CacheHit | null> {
    const item = this.index.get(key);
    if (!item) {
      this.misses++;
      return null;
    }
    try {
      const raw = await fs.readFile(this.file(key), 'utf8');
      const entry = CacheEntrySchema.parse(JSON.parse(raw));
      if (
        entry.key !== key ||
        sha256(entry.body) !== entry.bodyHash ||
        Buffer.byteLength(entry.body) !== entry.bytes
      ) {
        throw new Error('integrity check failed');
      }
      item.lastAccess = this.now();
      this.hits++;
      return { body: entry.body, storedAt: entry.storedAt, fresh: this.now() - entry.storedAt < entry.ttlMs };
    } catch {
      // Corrupt, truncated or schema-mismatched file: discard it and behave as a miss.
      this.corrupt++;
      this.misses++;
      this.drop(key);
      await fs.rm(this.file(key), { force: true });
      return null;
    }
  }

  async put(key: string, url: string, body: string, ttlMs: number): Promise<boolean> {
    const bytes = Buffer.byteLength(body);
    if (bytes > this.opts.maxEntryBytes) return false;
    const storedAt = this.now();
    const json = JSON.stringify({ key, url, storedAt, ttlMs, bytes, bodyHash: sha256(body), body });
    const tmp = `${this.file(key)}.tmp`;
    await fs.writeFile(tmp, json); // write-then-rename so a crash never leaves a half-written entry
    await fs.rename(tmp, this.file(key));
    this.drop(key);
    const size = Buffer.byteLength(json);
    this.index.set(key, { bytes: size, storedAt, lastAccess: storedAt });
    this.totalBytes += size;
    await this.evict(key);
    return true;
  }

  /** Remove least-recently-used entries until under the cap (never the entry just written). */
  private async evict(keep: string): Promise<void> {
    while (this.totalBytes > this.opts.maxBytes) {
      let oldestKey: string | null = null;
      let oldest = Infinity;
      for (const [k, v] of this.index) {
        if (k !== keep && v.lastAccess < oldest) {
          oldest = v.lastAccess;
          oldestKey = k;
        }
      }
      if (oldestKey === null) return;
      this.drop(oldestKey);
      this.evictions++;
      await fs.rm(this.file(oldestKey), { force: true });
    }
  }

  async clear(): Promise<void> {
    for (const key of [...this.index.keys()]) await fs.rm(this.file(key), { force: true });
    this.index.clear();
    this.totalBytes = 0;
  }

  stats(): CacheStats {
    let oldest: number | null = null;
    for (const v of this.index.values()) if (oldest === null || v.storedAt < oldest) oldest = v.storedAt;
    return {
      entries: this.index.size,
      bytes: this.totalBytes,
      maxBytes: this.opts.maxBytes,
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
      corruptDiscarded: this.corrupt,
      oldestStoredAt: oldest,
    };
  }
}
