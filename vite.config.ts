// Vite builds only the renderer (src/ -> dist/). Main/preload are bundled by esbuild (scripts/build.mjs).
import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src',
  base: './',
  build: { outDir: '../dist', emptyOutDir: true, target: 'chrome140', sourcemap: true },
});
