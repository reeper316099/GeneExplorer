// Production build: renderer with Vite, main + preload with esbuild. Test-mode code is compiled out (__TEST_MODE__ = false).
import { build as viteBuild } from 'vite';
import { build as esbuild } from 'esbuild';
import { pathToFileURL } from 'node:url';

export async function buildElectron({ dev = false, watch = false, onEnd } = {}) {
  const common = {
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    bundle: true,
    external: ['electron'],
    sourcemap: true,
    define: { __TEST_MODE__: dev ? 'true' : 'false' },
    // minifySyntax makes esbuild delete the dead `if (__TEST_MODE__)` branch in production builds.
    minifySyntax: !dev,
  };
  const entries = { main: 'electron/main.ts', preload: 'electron/preload.ts' };
  const plugins = onEnd ? [{ name: 'end', setup: (b) => b.onEnd(() => onEnd()) }] : [];
  const opts = Object.entries(entries).map(([name, entry]) => ({
    ...common,
    entryPoints: [entry],
    outfile: `dist-electron/${name}.cjs`,
    plugins,
  }));
  if (!watch) return Promise.all(opts.map((o) => esbuild(o)));
  const { context } = await import('esbuild');
  const ctxs = await Promise.all(opts.map((o) => context(o)));
  await Promise.all(ctxs.map((c) => c.watch()));
  return ctxs;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await viteBuild({ configFile: 'vite.config.ts', logLevel: 'warn' });
  const dev = process.argv.includes('--dev'); // --dev keeps test-mode code (used only by e2e tests)
  await buildElectron({ dev });
  console.log(
    `build ok${dev ? ' (DEV: test mode included)' : ''}: dist/ (renderer), dist-electron/ (main, preload)`,
  );
}
