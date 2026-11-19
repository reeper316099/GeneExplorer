// Shared context handed to every view, plus small helpers for provenance and clipboard/link actions.
import type { GeneView } from '../core/gene-view';
import type { Sourced } from '../shared/types';
import { fmtTime, h } from './dom';
import type { Prefs, Target } from './prefs';

/** Collects cleanup callbacks (event subscriptions) for a screen so they are released when it is replaced. */
export class Scope {
  private fns: (() => void)[] = [];

  /** Registers a cleanup function. */
  add(fn: () => void): void {
    this.fns.push(fn);
  }

  /** Runs and clears all cleanup functions. */
  dispose(): void {
    for (const f of this.fns) f();
    this.fns = [];
  }
}

export interface TaxonPick {
  id: number;
  name: string;
}

export interface AppCtx {
  /** Opens the gene page for a target (re-resolved through its identifier). */
  openGene(target: Target): void;
  /** Runs a search from anywhere (example chips, recents). */
  search(query: string, taxon: TaxonPick | null): void;
  /** App version string, written into exports. */
  readonly appVersion: string;
  prefs(): Prefs;
  updatePrefs(fn: (p: Prefs) => Prefs): void;
  /** Opens a link in the system browser (main checks the allowlist). */
  openExternal(url: string): void;
  /** Saves a file through the native dialog and reports the outcome in a toast. */
  save(
    name: string,
    data: string,
    encoding: 'utf8' | 'base64',
    filter: { name: string; ext: string },
  ): Promise<void>;
  toast(message: string): void;
  /** Opens the sources drawer for the current gene. */
  showSources(view: GeneView): void;
  /** Copies text to the clipboard with a toast. */
  copy(text: string, what: string): void;
}

/** Text for the hover/tooltip that tells where a value came from. */
export function provTitle(rec: Pick<Sourced<unknown>, 'source' | 'recordId' | 'fetchedAt'>): string {
  return `Source: ${rec.source} · record ${rec.recordId} · fetched ${fmtTime(rec.fetchedAt)}`;
}

/** Wraps text in a span that shows its source on hover (and for assistive tech). */
export function withSource(
  text: string,
  rec: Pick<Sourced<unknown>, 'source' | 'recordId' | 'fetchedAt'>,
): HTMLElement {
  return h('span', { class: 'src', title: provTitle(rec), tabindex: 0 }, text);
}

/** Shows "not available" in a muted style for missing values. */
export function na(what = 'not available'): HTMLElement {
  return h('span', { class: 'muted' }, what);
}

/** A button-like chip that opens a link-out through the allowlisted bridge. */
export function linkOut(ctx: AppCtx, label: string, url: string): HTMLElement {
  return h(
    'button',
    {
      class: 'chip',
      type: 'button',
      title: `Open ${url} in your browser`,
      onclick: () => ctx.openExternal(url),
    },
    `${label} ↗`,
  );
}

/** A chip that copies its value when clicked. */
export function copyChip(
  ctx: AppCtx,
  label: string,
  value: string,
  rec?: Pick<Sourced<unknown>, 'source' | 'recordId' | 'fetchedAt'> | null,
): HTMLElement {
  return h(
    'button',
    {
      class: 'chip mono',
      type: 'button',
      title: `${rec ? `${provTitle(rec)}. ` : ''}Click to copy ${value}`,
      'aria-label': `${label} ${value}, click to copy`,
      onclick: () => ctx.copy(value, label),
    },
    `${label}: ${value}`,
  );
}
