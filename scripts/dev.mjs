// Dev: rebuild on change (esbuild watch for main/preload, Vite watch for the renderer) and restart Electron after each rebuild.
// This is rebuild + restart, not true HMR.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { build as viteBuild } from 'vite';
import { buildElectron } from './build.mjs';

const electronBin = createRequire(import.meta.url)('electron');
let child = null;
let timer = null;

function restart() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    if (child) {
      child.removeAllListeners('exit');
      child.kill();
    }
    child = spawn(electronBin, ['.'], { stdio: 'inherit', env: { ...process.env, GENEEXPLORER_DEV: '1' } });
    child.on('exit', () => process.exit(0));
  }, 300);
}

await viteBuild({ configFile: 'vite.config.ts', logLevel: 'warn', build: { watch: {} } }).then((w) =>
  w.on?.('event', (e) => e.code === 'END' && restart()),
);
await buildElectron({ dev: true, watch: true, onEnd: restart });
