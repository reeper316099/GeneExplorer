// Bundle a TypeScript tool script with esbuild into scratch/ and run it with Node (no extra runner dependency).
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const entry = process.argv[2];
if (!entry) {
  console.error('usage: run-tool.mjs <tools/script.ts> [args]');
  process.exit(2);
}
const out = path.join('scratch', 'tools-build', path.basename(entry, '.ts') + '.cjs');
await build({
  entryPoints: [entry],
  outfile: out,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  define: { __TEST_MODE__: 'false' },
  logLevel: 'warning',
});
const r = spawnSync(process.execPath, [out, ...process.argv.slice(3)], { stdio: 'inherit' });
process.exit(r.status ?? 1);
