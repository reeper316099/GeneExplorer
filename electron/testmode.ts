// Test mode: serve RECORDED fixtures instead of the network so e2e tests are deterministic.
// This file is only reachable behind `__TEST_MODE__`, which is false in production builds, so esbuild removes it entirely.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

const FixtureIndexSchema = z.object({
  entries: z.array(
    z.object({ method: z.enum(['GET', 'POST']), url: z.string(), status: z.number(), file: z.string() }),
  ),
});

/** Test mode is on only for an unpackaged app with the env flag set; a packaged app ignores the flag. */
export function isTestModeEnabled(env: Record<string, string | undefined>, isPackaged: boolean): boolean {
  return !isPackaged && env['GENEEXPLORER_TEST_MODE'] === '1';
}

export interface RateLimitSim {
  /** Requests whose URL contains this text are rate limited. */
  urlIncludes: string;
  /** How many times to answer 429 before answering normally. */
  times: number;
  /** Value of the Retry-After header (seconds). */
  retryAfter: string;
}

/** Reads the optional 429 simulation from GENEEXPLORER_TEST_RATELIMIT (JSON); ignores anything malformed. */
export function parseRateLimitSim(raw: string | undefined): RateLimitSim | null {
  if (!raw) return null;
  try {
    const v = z
      .object({
        urlIncludes: z.string().min(1),
        times: z.number().int().min(1).max(5),
        retryAfter: z.string().max(10),
      })
      .safeParse(JSON.parse(raw));
    return v.success ? v.data : null;
  } catch {
    return null;
  }
}

/** A fetch() replacement that answers from `<dir>/index.json`; unknown URLs fail like a network error. With `sim`, the first matching requests get HTTP 429 + Retry-After. */
export function createFixtureFetch(dir: string, sim: RateLimitSim | null = null): typeof fetch {
  let limited = 0;
  const load = async () =>
    FixtureIndexSchema.parse(JSON.parse(await fs.readFile(path.join(dir, 'index.json'), 'utf8')));
  return async (input, init) => {
    const index = await load();
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init?.method ?? 'GET').toUpperCase();
    if (sim && url.includes(sim.urlIncludes) && limited < sim.times) {
      limited++;
      return new Response('rate limited', { status: 429, headers: { 'retry-after': sim.retryAfter } });
    }
    const hit = index.entries.find((e) => e.url === url && e.method === method);
    if (!hit) throw new TypeError(`No fixture recorded for ${method} ${url}`);
    const body = await fs.readFile(path.join(dir, hit.file));
    return new Response(body, { status: hit.status, headers: { 'content-type': 'application/json' } });
  };
}
