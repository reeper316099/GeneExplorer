// Concrete AppCtx: wires the callbacks the controller supplies to bridge-backed helpers (save, copy, open link).
import type { AppCtx } from './ctx';

type Supplied = Pick<
  AppCtx,
  'appVersion' | 'openGene' | 'search' | 'prefs' | 'updatePrefs' | 'toast' | 'showSources'
>;

export class AppCtxImpl implements AppCtx {
  appVersion: string;
  openGene: AppCtx['openGene'];
  search: AppCtx['search'];
  prefs: AppCtx['prefs'];
  updatePrefs: AppCtx['updatePrefs'];
  toast: AppCtx['toast'];
  showSources: AppCtx['showSources'];

  /** Stores the supplied callbacks. */
  constructor(s: Supplied) {
    this.appVersion = s.appVersion;
    this.openGene = s.openGene;
    this.search = s.search;
    this.prefs = s.prefs;
    this.updatePrefs = s.updatePrefs;
    this.toast = s.toast;
    this.showSources = s.showSources;
  }

  /** Asks the main process to open an allowlisted https link in the system browser. */
  openExternal(url: string): void {
    void window.geneExplorer.openExternal(url).then((r) => {
      if (!r.ok) this.toast(`The link could not be opened: ${r.error.message}`);
    });
  }

  /** Saves a file through the native Save dialog. */
  async save(
    name: string,
    data: string,
    encoding: 'utf8' | 'base64',
    filter: { name: string; ext: string },
  ): Promise<void> {
    const r = await window.geneExplorer.saveFile({
      suggestedName: name,
      data,
      encoding,
      filters: [{ name: filter.name, extensions: [filter.ext] }],
    });
    if (!r.ok) this.toast(`Could not save: ${r.error.message}`);
    else this.toast(r.value.saved ? `Saved to ${r.value.path}` : 'Save cancelled.');
  }

  /** Copies text to the clipboard (with a fallback for restricted contexts) and confirms with a toast. */
  copy(text: string, what: string): void {
    const done = (): void => this.toast(`${what} copied to the clipboard.`);
    const fallback = (): void => {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.append(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      if (ok) done();
      else this.toast('Copy failed.');
    };
    if (navigator.clipboard) void navigator.clipboard.writeText(text).then(done, fallback);
    else fallback();
  }
}
