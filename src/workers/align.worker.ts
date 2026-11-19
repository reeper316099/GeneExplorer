// Runs the protein alignment off the UI thread so a long alignment never freezes the window. The UI can cancel by
// terminating the worker.
import { alignGlobal } from '../bio/align';
import type { AlignRequest, AlignResponse } from '../shared/worker-messages';

self.onmessage = (e: MessageEvent<AlignRequest>): void => {
  const post = (m: AlignResponse): void => self.postMessage(m);
  const result = alignGlobal(e.data.a, e.data.b, {
    onProgress: (fraction) => post({ type: 'progress', fraction }),
  });
  post({ type: 'done', result });
};
