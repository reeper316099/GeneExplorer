// Test-mode safety: the flag only works in an unpackaged app, fixtures are served offline, and production bundles contain none of it.
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { createFixtureFetch, isTestModeEnabled } from '../../electron/testmode';

describe('isTestModeEnabled', () => {
  it('is off unless the flag is set AND the app is not packaged', () => {
    expect(isTestModeEnabled({ GENEEXPLORER_TEST_MODE: '1' }, false)).toBe(true);
    expect(isTestModeEnabled({ GENEEXPLORER_TEST_MODE: '1' }, true)).toBe(false); // packaged app ignores the flag
    expect(isTestModeEnabled({}, false)).toBe(false);
    expect(isTestModeEnabled({ GENEEXPLORER_TEST_MODE: 'true' }, false)).toBe(false);
  });
});

describe('production bundle', () => {
  const bundle = async (testMode: boolean) => {
    const r = await build({
      entryPoints: ['electron/main.ts'],
      bundle: true,
      write: false,
      platform: 'node',
      format: 'cjs',
      external: ['electron'],
      define: { __TEST_MODE__: String(testMode) },
      minifySyntax: !testMode,
      logLevel: 'silent',
    });
    return r.outputFiles[0]?.text ?? '';
  };

  it('has no test-mode code at all when built for production', async () => {
    const out = await bundle(false);
    for (const marker of ['GENEEXPLORER_TEST_MODE', 'createFixtureFetch', 'No fixture recorded'])
      expect(out.includes(marker), marker).toBe(false);
  });

  it('includes it in dev builds (so the check above is meaningful)', async () => {
    expect((await bundle(true)).includes('GENEEXPLORER_TEST_MODE')).toBe(true);
  });
});

describe('fixture fetch', () => {
  const dir = path.resolve('tests/fixtures/api');
  it('answers a recorded URL from disk and fails like a network error for an unknown one', async () => {
    const f = createFixtureFetch(dir);
    const idx = JSON.parse(
      await (await import('node:fs/promises')).readFile(path.join(dir, 'index.json'), 'utf8'),
    ) as { entries: { url: string }[] };
    const first = idx.entries[0];
    expect(first).toBeDefined();
    const res = await f(first?.url ?? '');
    expect(res.status).toBe(200);
    await expect(f('https://rest.uniprot.org/never-recorded')).rejects.toThrow(/No fixture recorded/);
  });
});
