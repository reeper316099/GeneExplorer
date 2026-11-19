// Bottom status bar: network state (offline, waiting on Retry-After), where the last data came from, and cache size.
import type { FetchMeta } from '../shared/types';
import { ago, fmt, h, setChildren } from './dom';

export interface StatusBar {
  el: HTMLElement;
  noteFetch(meta: FetchMeta): void;
}

/** Creates the status bar and starts polling the main process for cache and network state. */
export function createStatusBar(): StatusBar {
  const left = h('span');
  const mid = h('span', { class: 'grow' });
  const right = h('span');
  const el = h('footer', { class: 'statusbar', role: 'status', 'aria-live': 'polite' }, left, mid, right);
  let last: FetchMeta | null = null;
  const paintMid = (): void => {
    if (!last) return setChildren(mid, 'Ready');
    const where = last.fromCache
      ? last.stale
        ? `Loaded from cache ${ago(last.fetchedAt)} (stale: the network was not available)`
        : `Loaded from cache ${ago(last.fetchedAt)}`
      : `Fetched live ${ago(last.fetchedAt)}`;
    setChildren(mid, where);
  };
  paintMid();
  const poll = async (): Promise<void> => {
    try {
      const i = await window.geneExplorer.cacheInfo();
      const w = i.status.waiting[0];
      setChildren(
        left,
        w
          ? `${w.reason}: retrying ${w.host} in ${Math.max(0, Math.ceil((w.retryAt - Date.now()) / 1000))} s`
          : i.status.offline
            ? 'Offline (cache only)'
            : 'Online',
      );
      setChildren(right, `Cache: ${fmt(i.stats.entries)} items, ${(i.stats.bytes / 1048576).toFixed(1)} MB`);
      paintMid();
    } catch {
      setChildren(left, 'Status unavailable');
    }
  };
  void poll();
  setInterval(() => void poll(), 1000);
  return {
    el,
    noteFetch: (m) => {
      last = m;
      paintMid();
    },
  };
}
