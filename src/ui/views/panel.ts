// Renders a Loadable<T> as skeleton / empty note / error with Retry / content, so every panel behaves the same way.
import type { AppError, Loadable } from '../../shared/types';
import { h } from '../dom';

/** A friendly, specific message for each kind of failure. */
export function friendlyError(e: AppError): string {
  switch (e.kind) {
    case 'rate_limited':
      return `The ${e.host ?? 'server'} asked us to slow down${e.retryAfterMs ? ` (about ${Math.ceil(e.retryAfterMs / 1000)} s)` : ''}. Try again in a moment.`;
    case 'network_down':
      return 'No connection, and this item is not in the offline cache. Check your network or try again later.';
    case 'timeout':
      return 'The server took too long to answer.';
    case 'server_error':
      return `The data source had a problem${e.status ? ` (HTTP ${e.status})` : ''}. Try again later.`;
    case 'too_large':
      return 'The answer was larger than the app allows, so it was not loaded.';
    case 'not_found':
      return 'The data source has no record for this.';
    case 'cancelled':
      return 'The request was cancelled.';
    case 'bad_response':
      return `The data source answered in an unexpected format: ${e.message}`;
    default:
      return e.message;
  }
}

/** Builds the element for a loadable panel body. */
export function renderLoadable<T>(
  state: Loadable<T>,
  ready: (data: T, meta: { fetchedAt: number; fromCache: boolean }) => Node,
  retry: () => void,
  skeletonLines = 3,
): HTMLElement {
  const box = h('div', { 'aria-live': 'polite' });
  if (state.status === 'idle' || state.status === 'loading') {
    box.setAttribute('aria-busy', 'true');
    for (let i = 0; i < skeletonLines; i++)
      box.append(h('div', { class: 'skeleton', style: `width:${90 - i * 18}%` }));
  } else if (state.status === 'empty') {
    box.append(h('div', { class: 'notice info' }, state.reason));
  } else if (state.status === 'error') {
    box.append(
      h('div', { class: 'notice error' }, friendlyError(state.error)),
      h('button', { class: 'btn', type: 'button', onclick: retry }, 'Retry'),
    );
  } else {
    box.append(ready(state.data, { fetchedAt: state.fetchedAt, fromCache: state.fromCache }));
  }
  return box;
}
