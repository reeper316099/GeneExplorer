// Electron main process: window, menu, app:// protocol, security settings and the IPC handlers.
import { app, BrowserWindow, Menu, dialog, ipcMain, net, protocol, session, shell } from 'electron';
import type { IpcMainInvokeEvent, MenuItemConstructorOptions } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  FetchSpecSchema,
  RequestIdSchema,
  SaveFileSpecSchema,
  WindowStateSchema,
  type WindowState,
} from '../src/shared/schemas';
import { IPC, type AppError, type FetchKind, type IpcResult, type MenuCommand } from '../src/shared/types';
import { checkExternalUrl } from './external';
import { resolveAppPath } from './paths';
import { DiskCache } from './cache';
import { NetClient, NetError } from './net';

const APP_ORIGIN = 'app://gene';
const REPO_URL = 'https://github.com/reeper316099/GeneExplorer';
const MB = 1024 * 1024;

// Custom scheme must be registered before `ready` so module scripts, workers and fetch work from app://.
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

/** Content-Security-Policy applied to every app:// response: nothing remote, no eval, no inline scripts. */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "style-src-attr 'unsafe-inline'", // 3Dmol and SVG set style attributes; scripts stay locked down
  "img-src 'self' data: blob:",
  "connect-src 'self'", // the renderer makes NO network requests; data comes through IPC
  "worker-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

/** Dev/test builds only: run with no visible window and no Dock icon, so automated runs never steal focus. */
const RUN_IN_BACKGROUND = __TEST_MODE__ && process.env['GENEEXPLORER_BACKGROUND'] === '1';

let mainWindow: BrowserWindow | null = null;
let cache: DiskCache;
let netClient: NetClient;

/** Convert anything thrown into the plain AppError that crosses IPC. */
function toAppError(e: unknown): AppError {
  if (e instanceof NetError) return e.app;
  return { kind: 'bad_response', message: e instanceof Error ? e.message : 'Unexpected error.' };
}

/** Run a handler and return errors as data instead of throwing across the bridge. */
async function guard<T>(fn: () => Promise<T>): Promise<IpcResult<T>> {
  try {
    return { ok: true, value: await fn() };
  } catch (e) {
    return { ok: false, error: toAppError(e) };
  }
}

/** Only accept IPC from our own app:// page (not from any other frame or origin). */
function fromOurPage(event: IpcMainInvokeEvent): boolean {
  return event.senderFrame?.url.startsWith(`${APP_ORIGIN}/`) === true;
}

function invalid(message: string): IpcResult<never> {
  return { ok: false, error: { kind: 'invalid_request', message } };
}

function sendCommand(command: MenuCommand): void {
  mainWindow?.webContents.send(IPC.menuCommand, command);
}

/** Open an https URL in the system browser, only for allowlisted hostnames. */
async function openExternalChecked(raw: string): Promise<void> {
  await shell.openExternal(checkExternalUrl(raw).toString());
}

function registerIpc(): void {
  const doFetch = (kind: FetchKind) => async (event: IpcMainInvokeEvent, id: unknown, spec: unknown) => {
    if (!fromOurPage(event)) return invalid('Untrusted sender.');
    const parsedId = RequestIdSchema.safeParse(id);
    const parsedSpec = FetchSpecSchema.safeParse(spec);
    if (!parsedId.success || !parsedSpec.success) return invalid('Malformed fetch request.');
    const s = parsedSpec.data;
    return guard(async () => {
      const result = await netClient.request(parsedId.data, {
        url: s.url,
        kind,
        ...(s.method ? { method: s.method } : {}),
        ...(s.headers ? { headers: s.headers } : {}),
        ...(s.body !== undefined ? { body: s.body } : {}),
        ...(s.priority ? { priority: s.priority } : {}),
      });
      return {
        data: kind === 'json' ? (JSON.parse(result.text) as unknown) : result.text,
        meta: result.meta,
      };
    });
  };
  ipcMain.handle(IPC.fetchJson, doFetch('json'));
  ipcMain.handle(IPC.fetchText, doFetch('text'));

  ipcMain.handle(IPC.cancel, (event, id: unknown) => {
    const parsed = RequestIdSchema.safeParse(id);
    if (fromOurPage(event) && parsed.success) netClient.cancel(parsed.data);
  });
  ipcMain.handle(IPC.cacheInfo, (event) => {
    if (!fromOurPage(event)) return null;
    return { stats: cache.stats(), status: netClient.status() };
  });
  ipcMain.handle(IPC.clearCache, async (event) => {
    if (!fromOurPage(event)) return invalid('Untrusted sender.');
    return guard(async () => {
      await cache.clear();
      return cache.stats();
    });
  });
  ipcMain.handle(IPC.openExternal, async (event, url: unknown) => {
    if (!fromOurPage(event) || typeof url !== 'string') return invalid('Untrusted or malformed request.');
    return guard(async () => {
      await openExternalChecked(url);
      return true as const;
    });
  });
  ipcMain.handle(IPC.getAppInfo, () => ({
    name: app.getName(),
    version: app.getVersion(),
    electron: process.versions.electron,
    platform: process.platform,
    userAgent: userAgent(),
  }));
  ipcMain.handle(IPC.saveFile, async (event, spec: unknown) => {
    const parsed = SaveFileSpecSchema.safeParse(spec);
    if (!fromOurPage(event) || !parsed.success || !mainWindow) return invalid('Malformed save request.');
    const s = parsed.data;
    return guard(async () => {
      const target = await chooseSavePath(mainWindow as BrowserWindow, s.suggestedName, s.filters);
      if (!target) return { saved: false as const };
      await fs.writeFile(target, s.encoding === 'base64' ? Buffer.from(s.data, 'base64') : s.data);
      return { saved: true as const, path: target };
    });
  });
  ipcMain.handle(IPC.printPdf, async (event, name: unknown) => {
    if (!fromOurPage(event) || typeof name !== 'string' || !mainWindow) return invalid('Malformed request.');
    return guard(async () => {
      const win = mainWindow as BrowserWindow;
      const pdf = await win.webContents.printToPDF({ printBackground: true });
      const target = await chooseSavePath(win, name, [{ name: 'PDF', extensions: ['pdf'] }]);
      if (!target) return { saved: false as const };
      await fs.writeFile(target, pdf);
      return { saved: true as const, path: target };
    });
  });
}

/** Asks the user where to save (native dialog). In test builds only, GENEEXPLORER_TEST_SAVE_DIR skips the dialog so e2e tests can save. */
async function chooseSavePath(
  win: BrowserWindow,
  suggestedName: string,
  filters: { name: string; extensions: string[] }[],
): Promise<string | null> {
  const name = path.basename(suggestedName); // basename: the renderer cannot pick a directory
  if (__TEST_MODE__) {
    const dir = process.env['GENEEXPLORER_TEST_SAVE_DIR'];
    if (dir) return path.join(dir, name);
  }
  const pick = await dialog.showSaveDialog(win, { defaultPath: name, filters });
  return pick.canceled || !pick.filePath ? null : pick.filePath;
}

function userAgent(): string {
  return `GeneExplorer/${app.getVersion()}`; // generic client name + version only; never personal data
}

/** Serve ./dist over app://; any path that escapes the dist folder is rejected. */
function registerAppProtocol(): void {
  const root = path.join(app.getAppPath(), 'dist');
  protocol.handle('app', async (request) => {
    const url = new URL(request.url);
    if (url.hostname !== 'gene') return new Response('Not found', { status: 404 });
    const file = resolveAppPath(root, url.pathname);
    if (!file) return new Response('Forbidden', { status: 403 });
    try {
      const res = await net.fetch(pathToFileURL(file).toString());
      const headers = new Headers(res.headers);
      headers.set('Content-Security-Policy', CSP);
      headers.set('X-Content-Type-Options', 'nosniff');
      return new Response(res.body, { status: res.status, headers });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}

async function readWindowState(file: string): Promise<WindowState> {
  try {
    return WindowStateSchema.parse(JSON.parse(await fs.readFile(file, 'utf8')));
  } catch {
    return { width: 1360, height: 860 }; // missing or corrupt file: fall back to defaults
  }
}

async function createWindow(): Promise<void> {
  const stateFile = path.join(app.getPath('userData'), 'window-state.json');
  const state = await readWindowState(stateFile);
  const win = new BrowserWindow({
    width: state.width,
    height: state.height,
    ...(state.x !== undefined && state.y !== undefined ? { x: state.x, y: state.y } : {}),
    minWidth: 1200,
    minHeight: 760,
    title: 'GeneExplorer',
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      backgroundThrottling: !RUN_IN_BACKGROUND, // a hidden window must keep rendering for automated tests
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });
  mainWindow = win;
  if (state.maximized) win.maximize();
  if (!RUN_IN_BACKGROUND) win.once('ready-to-show', () => win.show());

  const saveState = () => {
    if (win.isDestroyed()) return;
    const b = win.getNormalBounds();
    void fs
      .writeFile(stateFile, JSON.stringify({ ...b, maximized: win.isMaximized() }))
      .catch(() => undefined);
  };
  win.on('close', saveState);

  // Block navigation away from the app, and new windows; allowlisted https links open in the system browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void openExternalChecked(url).catch(() => undefined);
    return { action: 'deny' };
  });
  const blockNav = (event: Electron.Event, url: string) => {
    if (!url.startsWith(`${APP_ORIGIN}/`)) {
      event.preventDefault();
      void openExternalChecked(url).catch(() => undefined);
    }
  };
  win.webContents.on('will-navigate', blockNav);
  win.webContents.on('will-redirect', blockNav);
  win.webContents.on('will-attach-webview', (event) => event.preventDefault());

  await win.loadURL(`${APP_ORIGIN}/index.html`);
}

function buildMenu(): Menu {
  const isMac = process.platform === 'darwin';
  const cmd = (label: string, command: MenuCommand, accelerator?: string): MenuItemConstructorOptions => ({
    label,
    ...(accelerator ? { accelerator } : {}),
    click: () => sendCommand(command),
  });
  const tabs = [1, 2, 3, 4, 5].map((n) => cmd(`Tab ${n}`, `tab-${n}` as MenuCommand, `CmdOrCtrl+${n}`));
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' as const }] : []),
    {
      label: 'File',
      submenu: [
        cmd('Export Report (PDF)', 'export-report', 'CmdOrCtrl+P'),
        cmd('Export Table (CSV)', 'export-csv'),
        cmd('Export Sequences (FASTA)', 'export-fasta'),
        cmd('Export Image (PNG)', 'export-png'),
        { type: 'separator' },
        cmd('Focus Search', 'focus-search', 'CmdOrCtrl+K'),
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        cmd('Toggle Dark Mode', 'toggle-dark', 'CmdOrCtrl+D'),
        {
          label: 'Work Offline (use cache only)',
          type: 'checkbox',
          checked: false,
          click: (item) => netClient.setOffline(item.checked),
        },
        { type: 'separator' },
        ...tabs,
        { type: 'separator' },
        cmd('Back', 'nav-back', 'Alt+Left'),
        cmd('Forward', 'nav-forward', 'Alt+Right'),
        { type: 'separator' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { role: 'resetZoom' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        cmd('About', 'show-about'),
        cmd('Data sources', 'show-sources'),
        {
          label: 'Clear cache…',
          click: () => void clearCacheWithConfirm(),
        },
        { type: 'separator' },
        { label: 'GitHub repository', click: () => void shell.openExternal(REPO_URL) },
        { label: 'Report an issue', click: () => void shell.openExternal(`${REPO_URL}/issues`) },
      ],
    },
  ];
  return Menu.buildFromTemplate(template);
}

/** Ask for confirmation, then delete every cached item. */
async function clearCacheWithConfirm(): Promise<void> {
  const stats = cache.stats();
  const choice = await dialog.showMessageBox({
    type: 'question',
    buttons: ['Clear cache', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    message: `Delete ${stats.entries} cached items (${(stats.bytes / MB).toFixed(1)} MB)?`,
    detail: 'Previously viewed genes will need the network again.',
  });
  if (choice.response === 0) await cache.clear();
}

async function start(): Promise<void> {
  if (RUN_IN_BACKGROUND) app.dock?.hide();
  cache = new DiskCache({
    dir: path.join(app.getPath('userData'), 'cache'),
    maxBytes: 500 * MB,
    maxEntryBytes: 50 * MB,
  });
  await cache.init();

  let fetchImpl: typeof fetch = (input, init) =>
    net.fetch(input instanceof Request ? input.url : String(input), init);
  if (__TEST_MODE__) {
    // Dead code in production builds (esbuild removes the whole branch and the testmode module).
    const testmode = await import('./testmode');
    if (testmode.isTestModeEnabled(process.env, app.isPackaged)) {
      fetchImpl = testmode.createFixtureFetch(
        path.join(app.getAppPath(), 'tests', 'fixtures', 'api'),
        testmode.parseRateLimitSim(process.env['GENEEXPLORER_TEST_RATELIMIT']),
      );
    }
  }
  netClient = new NetClient({ fetchImpl, cache, userAgent: userAgent() });

  // Deny every permission request (camera, geolocation, notifications, ...); the app needs none.
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);

  registerAppProtocol();
  registerIpc();
  Menu.setApplicationMenu(buildMenu());
  await createWindow();
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
  app.on('window-all-closed', () => app.quit());
  // Make sure the last preference change (theme, favorites) reaches disk even if the user quits right after making it.
  app.on('before-quit', () => session.defaultSession.flushStorageData());
  void app.whenReady().then(start);
}
