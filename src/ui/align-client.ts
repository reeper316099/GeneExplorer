// Starts the alignment worker; returns a promise plus a cancel function (cancel terminates the worker).
import type { AlignResult } from '../bio/align';
import type { AlignRequest, AlignResponse } from '../shared/worker-messages';

export interface AlignJob {
  promise: Promise<AlignResult | null>;
  cancel: () => void;
}

/** Aligns two sequences in a worker. The promise resolves null when cancelled. */
export function runAlignment(a: string, b: string, onProgress: (fraction: number) => void): AlignJob {
  const worker = new Worker(new URL('../workers/align.worker.ts', import.meta.url), { type: 'module' });
  let finish: (r: AlignResult | null) => void = () => undefined;
  const promise = new Promise<AlignResult | null>((resolve) => {
    finish = resolve;
  });
  worker.onmessage = (e: MessageEvent<AlignResponse>): void => {
    if (e.data.type === 'progress') onProgress(e.data.fraction);
    else {
      worker.terminate();
      finish(e.data.result);
    }
  };
  worker.onerror = (): void => {
    worker.terminate();
    finish({ ok: false, reason: 'too_large', message: 'The alignment worker failed to run.' });
  };
  const req: AlignRequest = { a, b };
  worker.postMessage(req);
  return {
    promise,
    cancel: () => {
      worker.terminate();
      finish(null);
    },
  };
}
