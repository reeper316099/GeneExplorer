// The renderer's gateway to data: an API client over the preload bridge, with per-session cancellation so results
// the user no longer needs (they searched again, opened another gene) stop costing server requests.
import { GeneApi } from '../api/client';
import type { Transport } from '../api/client';
import type { FetchMeta } from '../shared/types';

export interface NetObserver {
  /** Called after each successful fetch with its metadata (feeds the status bar). */
  onFetched(meta: FetchMeta): void;
}

let observer: NetObserver | null = null;
let sessionCounter = 0;

/** Registers the single observer for fetch metadata. */
export function observeNet(o: NetObserver): void {
  observer = o;
}

/** One unit of related work (a search, a gene load). cancel() aborts everything it still has in flight. */
export class Session {
  readonly api: GeneApi;
  private readonly active = new Set<string>();
  private cancelled = false;

  /** Creates a session whose requests are tracked so they can be cancelled together. */
  constructor() {
    const bridge = window.geneExplorer;
    const track = async <T>(id: string, run: () => Promise<T>): Promise<T> => {
      this.active.add(id);
      try {
        return await run();
      } finally {
        this.active.delete(id);
      }
    };
    const transport: Transport = {
      fetchJson: async (id, spec) => {
        const r = await track(id, () => bridge.fetchJson(id, spec));
        if (r.ok) observer?.onFetched(r.value.meta);
        return r;
      },
      fetchText: async (id, spec) => {
        const r = await track(id, () => bridge.fetchText(id, spec));
        if (r.ok) observer?.onFetched(r.value.meta);
        return r;
      },
    };
    this.api = new GeneApi(transport, `s${++sessionCounter}`);
  }

  /** True once cancel() was called; callers drop late results. */
  get isCancelled(): boolean {
    return this.cancelled;
  }

  /** Cancels all in-flight requests of this session. */
  cancel(): void {
    this.cancelled = true;
    for (const id of this.active) void window.geneExplorer.cancel(id);
    this.active.clear();
  }
}
