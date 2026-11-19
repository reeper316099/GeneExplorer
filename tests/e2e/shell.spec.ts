// End-to-end checks on the real Electron shell. Uses a DEV build with test mode, so every API call is answered from recorded fixtures.
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

let app: ElectronApplication;
let win: Page;

test.beforeAll(async () => {
  const userData = mkdtempSync(path.join(tmpdir(), 'ge-e2e-')); // fresh cache for every run
  app = await electron.launch({
    args: ['.', `--user-data-dir=${userData}`],
    env: { ...process.env, GENEEXPLORER_TEST_MODE: '1', GENEEXPLORER_BACKGROUND: '1' },
  });
  win = await app.firstWindow();
});

test.afterAll(async () => {
  await app.close();
});

test('runs in the background: the window is never shown', async () => {
  const visible = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible());
  expect(visible).toBe(false);
});

test('opens with the right title and hardened web preferences', async () => {
  expect(await win.title()).toBe('GeneExplorer');
  const prefs = await app.evaluate(({ BrowserWindow }) => {
    // getLastWebPreferences() exists at runtime but is missing from Electron's typings, so describe its shape here.
    const wc = BrowserWindow.getAllWindows()[0]?.webContents as
      | {
          getLastWebPreferences(): {
            contextIsolation?: boolean;
            nodeIntegration?: boolean;
            sandbox?: boolean;
          };
        }
      | undefined;
    const p = wc?.getLastWebPreferences();
    return {
      contextIsolation: p?.contextIsolation,
      nodeIntegration: p?.nodeIntegration,
      sandbox: p?.sandbox,
    };
  });
  expect(prefs).toEqual({ contextIsolation: true, nodeIntegration: false, sandbox: true });
});

test('renderer has no Node access and only the documented bridge functions', async () => {
  const r = await win.evaluate(() => ({
    require: typeof (window as unknown as { require?: unknown }).require,
    process: typeof (window as unknown as { process?: unknown }).process,
    keys: Object.keys(window.geneExplorer).sort(),
  }));
  expect(r.require).toBe('undefined');
  expect(r.process).toBe('undefined');
  expect(r.keys).toEqual([
    'cacheInfo',
    'cancel',
    'clearCache',
    'fetchJson',
    'fetchText',
    'getAppInfo',
    'onMenuCommand',
    'openExternal',
    'printPdf',
    'saveFile',
  ]);
});

test('renderer cannot make network requests itself (CSP connect-src)', async () => {
  const blocked = await win.evaluate(() =>
    fetch('https://example.com').then(
      () => false,
      () => true,
    ),
  );
  expect(blocked).toBe(true);
});

test('main process rejects non-allowlisted hosts, http, malformed input and evil external links', async () => {
  const r = await win.evaluate(async () => {
    const g = window.geneExplorer;
    const kind = <T>(x: { ok: true; value: T } | { ok: false; error: { kind: string } }) =>
      x.ok ? 'ALLOWED' : x.error.kind;
    return {
      host: kind(await g.fetchJson('a', { url: 'https://example.com/x' })),
      http: kind(await g.fetchJson('b', { url: 'http://rest.uniprot.org/x' })),
      malformed: kind(await g.fetchJson('c', { url: 5 as unknown as string })),
      external: kind(await g.openExternal('https://evil.example.com/')),
      fileUrl: kind(await g.openExternal('file:///etc/passwd')),
    };
  });
  expect(r).toEqual({
    host: 'blocked_host',
    http: 'blocked_host',
    malformed: 'invalid_request',
    external: 'blocked_host',
    fileUrl: 'blocked_host',
  });
});

test('app:// rejects path traversal and serves only the dist folder', async () => {
  const statuses = await win.evaluate(async () => {
    const get = (p: string) =>
      fetch(p).then(
        (r) => r.status,
        () => -1,
      );
    return [await get('/%2e%2e/%2e%2e/package.json'), await get('/..%2fpackage.json'), await get('/%00')];
  });
  for (const s of statuses) expect([403, 404, 400, -1]).toContain(s);
  expect(await win.evaluate(() => fetch('/package.json').then((r) => r.status))).toBe(404);
});

// Last on purpose: a blocked top-level navigation leaves Playwright waiting for the (cancelled) load.
test('window.open and navigation away from the app are blocked', async () => {
  const before = win.url();
  await win.evaluate(() => window.open('https://example.com'));
  await win.evaluate(() => {
    location.href = 'https://example.com';
  });
  await win.waitForTimeout(500);
  expect(win.url()).toBe(before);
  expect(app.windows()).toHaveLength(1);
});
