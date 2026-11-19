// A Transport that answers from recorded real responses (looked up by exact URL in tests/fixtures/api/index.json).
// Unknown URLs fail as not_found so a test can never silently depend on a request nobody recorded.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Transport } from '../../src/api/client';
import type { AppError, FetchSpec, IpcResult } from '../../src/shared/types';

interface IndexEntry {
  url: string;
  file: string;
  recordedAt: string;
}
const DIR = path.resolve('tests/fixtures/api');
const index = JSON.parse(readFileSync(path.join(DIR, 'index.json'), 'utf8')) as { entries: IndexEntry[] };
const byUrl = new Map(index.entries.map((e) => [e.url, e]));

export interface FixtureTransport extends Transport {
  /** URLs requested, in order. */
  requested: string[];
}

/** Creates the fixture transport; `overrides` maps a URL to a canned failure (e.g. NCBI's HTTP 400). */
export function createFixtureTransport(overrides: Record<string, AppError> = {}): FixtureTransport {
  const requested: string[] = [];
  /** Looks a URL up and returns its text, or an error result. */
  const load = (spec: FetchSpec): IpcResult<{ text: string; at: number; url: string }> => {
    requested.push(spec.url);
    const forced = overrides[spec.url];
    if (forced) return { ok: false, error: forced };
    const e = byUrl.get(spec.url);
    if (!e)
      return { ok: false, error: { kind: 'not_found', message: `No recorded fixture for ${spec.url}` } };
    return {
      ok: true,
      value: {
        text: readFileSync(path.join(DIR, e.file), 'utf8'),
        at: Date.parse(e.recordedAt),
        url: spec.url,
      },
    };
  };
  return {
    requested,
    fetchJson: (_id, spec) => {
      const r = load(spec);
      if (!r.ok) return Promise.resolve(r);
      const meta = {
        url: r.value.url,
        fetchedAt: r.value.at,
        fromCache: false,
        stale: false,
        bytes: r.value.text.length,
      };
      return Promise.resolve({ ok: true, value: { data: JSON.parse(r.value.text) as unknown, meta } });
    },
    fetchText: (_id, spec) => {
      const r = load(spec);
      if (!r.ok) return Promise.resolve(r);
      const meta = {
        url: r.value.url,
        fetchedAt: r.value.at,
        fromCache: false,
        stale: false,
        bytes: r.value.text.length,
      };
      return Promise.resolve({ ok: true, value: { data: r.value.text, meta } });
    },
  };
}
