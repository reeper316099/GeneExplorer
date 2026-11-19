/// <reference types="vite/client" />
// The preload script exposes this object on window (see electron/preload.ts).
import type { GeneExplorerApi } from './shared/types';

declare global {
  interface Window {
    geneExplorer: GeneExplorerApi;
  }
}
