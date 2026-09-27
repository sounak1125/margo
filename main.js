const { app, BrowserWindow, ipcMain, dialog, shell, nativeTheme, Menu, nativeImage, screen, session } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const files = require('./src/main/files');
const recents = require('./src/main/recents');
const drafts = require('./src/main/drafts');
const access = require('./src/main/access');
const printing = require('./src/main/printing');
const windowState = require('./src/main/windowstate');
const { createWatcher } = require('./src/main/watcher');

const SMOKE = process.env.MARGO_SMOKE === '1';
const DEBUG = process.env.MARGO_DEBUG === '1' || SMOKE;
const IS_MAC = process.platform === 'darwin';

// Smoke runs use their own userData so tests never touch real settings/recents.
if (SMOKE) {
  app.setPath('userData', path.join(require('os').tmpdir(), 'margo-smoke-userdata'));
}

// Must run before requestSingleInstanceLock / any BrowserWindow. Unpackaged
// `npm start` uses a distinct ID so Windows does not reuse a pinned/installed
// Margo shortcut that still has the old icon.
if (process.platform === 'win32') {
  app.setAppUserModelId(app.isPackaged ? 'com.sounak.margo' : 'com.sounak.margo.dev');
}

const THEMES = {
  light: { bg: '#fafafa', fg: '#19191b', bar: '#f4f4f3' },
  dark: { bg: '#161618', fg: '#ededef', bar: '#1b1b1e' },
  paper: { bg: '#f4efe6', fg: '#2a241c', bar: '#ebe4d8' },
  graphite: { bg: '#222225', fg: '#e8e8ea', bar: '#27272b' },
  ink: { bg: '#141820', fg: '#e8ecf2', bar: '#181c24' }
};

/* Every permission used to be granted on request, which handed anything that
   ever got a foothold in the renderer a camera, a microphone and the author's
   location for the asking. Margo itself only needs two: the installed font list
   the font picker reads, and the clipboard the editors copy and paste through.
   Anything not named here is refused. */
const ALLOWED_PERMISSIONS = new Set([
  'local-fonts',
  'clipboard-read',
  'clipboard-sanitized-write'
]);

const WINDOW_DEFAULTS = { width: 1280, height: 850, minWidth: 940, minHeight: 600 };

let win = null;
let rendererReady = false;
let rendererAlive = true;
let forceClose = false;
let closeAskedAt = 0;
let closeAcked = false;
let closeStuck = false;
/* macOS keeps an app running with no windows, so Cmd+Q has to be told apart
   from closing the window: the quit is remembered while the renderer asks
   about unsaved work, and carried out once the window has really closed. */
let quitRequested = false;
let closeIsQuit = false;
let quitting = false;
/* Paths handed to Margo (command line, second launch, macOS open-file) before
   the renderer can take them. macOS may open several files at once. */
const pendingOpen = [];
const CLOSE_ACK_GRACE_MS = 10000;
const SHOW_FALLBACK_MS = 3000;

const updater = require('./src/main/updater').attach({
  getWindow: () => win
});

/* ---------------- settings ---------------- */

function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}
function readSettings() {
  try {
    const s = JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
    return s && typeof s === 'object' && !Array.isArray(s) ? s : {};
  } catch { return {}; }
}
/* Written to a sibling and renamed into place: a crash mid-write used to leave
   a truncated settings.json, which read back as {} and lost every setting. */
function writeSettings(patch) {
  const next = Object.assign(readSettings(), patch);
  const file = settingsPath();
  const tmp = file + '.' + process.pid + '.tmp';
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2));
    fs.renameSync(tmp, file);
  } catch {
    try { fs.unlinkSync(tmp); } catch {}
  }
  return next;
}
function currentTheme() {
  const saved = readSettings().theme;
  if (saved && THEMES[saved]) return saved;
  return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
}

/* ---------------- file access ---------------- */

access.init({
  file: path.join(app.getPath('userData'), 'known-files.json'),
  // Recents written by earlier versions were never granted; they came from
  // the author all the same.
  sources: [() => recents.readAll().map((r) => r.path)]
});

const watcher = createWatcher({
  onChange: (ev) => {
    if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) {
      win.webContents.send('file:changed-externally', ev);
    }
  }
});

/* Margo's own writes to a watched file are not "changed by another program". */
async function ownWrite(p, fn) {
  watcher.beginOwnWrite(p);
  try {
    return await fn();
  } finally {
    watcher.endOwnWrite(p);
  }
}

/* Every command-line argument that names a file Margo can open. On a second
   launch the arguments are relative to that launch's working directory, not
   this process's. */
function supportedPathsFromArgv(argv, cwd) {
  const out = [];
  for (const raw of (argv || []).slice(1)) {
    if (!raw || typeof raw !== 'string' || raw.startsWith('-') || raw === '.') continue;
    try {
      const p = path.resolve(cwd || process.cwd(), raw);
      if (!files.kindFromPath(p)) continue;
      if (fs.statSync(p).isFile()) out.push(p);
    } catch {}
  }
  return out;
}

function focusWindow() {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  if (!win.isVisible()) win.show();
  win.focus();
}

function openInWindow(p) {
  const granted = access.grant(p);
  if (!granted) return;
  if (win && rendererReady && !win.webContents.isDestroyed()) {
    focusWindow();
    win.webContents.send('app:open-file', granted);
    return;
  }
  pendingOpen.push(granted);
  if (app.isReady() && !win) createWindow();
}

function flushPendingOpen() {
  if (!win || !rendererReady) return;
  while (pendingOpen.length) win.webContents.send('app:open-file', pendingOpen.shift());
}

/* ---------------- external links ---------------- */

let lastExternalAt = 0;
function openExternalSafe(url, { throttle = false } = {}) {
  if (typeof url !== 'string' || url.length > 8192) return false;
  let u;
  try { u = new URL(url); } catch { return false; }
  const web = u.protocol === 'https:' || u.protocol === 'http:';
  if (!web && u.protocol !== 'mailto:') return false;
  if (web && !u.hostname) return false;
  // A page that navigates by itself (a meta refresh, a script) must not be
  // able to fire off browser tabs in a loop.
  const now = Date.now();
  if (throttle && now - lastExternalAt < 1000) return false;
  lastExternalAt = now;
  shell.openExternal(u.href).catch(() => {});
  return true;
}

/* Applied to every webContents Margo creates - the main window, the hidden
   print / export / thumbnail windows, and anything a future window adds:
   nothing navigates away from Margo's own page, no popups, no <webview>.
   Links the author clicks open in their browser instead. */
app.on('web-contents-created', (_e, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    openExternalSafe(url, { throttle: true });
    return { action: 'deny' };
  });
  contents.on('will-navigate', (e, url) => {
    e.preventDefault();
    if (win && contents === win.webContents) openExternalSafe(url, { throttle: true });
  });
  contents.on('will-redirect', (e) => {
    // Only the hidden windows load anything, and only local files.
    if (!(win && contents === win.webContents)) e.preventDefault();
  });
  contents.on('will-attach-webview', (e) => e.preventDefault());
});

/* ---------------- window ---------------- */

function appIcon() {
  const png = path.join(__dirname, 'assets', 'icon.png');
  const ico = path.join(__dirname, 'assets', 'icon.ico');
  if (process.platform === 'win32') {
    const fromPng = nativeImage.createFromPath(png);
    if (!fromPng.isEmpty()) return fromPng;
    if (fs.existsSync(ico)) {
      const fromIco = nativeImage.createFromPath(ico);
      if (!fromIco.isEmpty()) return fromIco;
    }
  }
  return png;
}

function windowChrome(theme) {
  // macOS draws its own traffic lights over a hidden title bar; Windows and
  // Linux get the window-controls overlay tinted to the theme.
  if (IS_MAC) return { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 14, y: 14 } };
  return { titleBarStyle: 'hidden', titleBarOverlay: { color: theme.bar, symbolColor: theme.fg, height: 44 } };
}

function createWindow() {
  const theme = THEMES[currentTheme()];
  const icon = appIcon();
  const placed = SMOKE
    ? { width: WINDOW_DEFAULTS.width, height: WINDOW_DEFAULTS.height, maximized: false }
    : windowState.sanitize(readSettings().windowState, screen.getAllDisplays(), WINDOW_DEFAULTS);
  const bounds = { width: placed.width, height: placed.height };
  if (placed.x != null && placed.y != null) { bounds.x = placed.x; bounds.y = placed.y; }

  rendererReady = false;
  rendererAlive = true;
  forceClose = false;
  win = new BrowserWindow(Object.assign(bounds, {
    minWidth: WINDOW_DEFAULTS.minWidth,
    minHeight: WINDOW_DEFAULTS.minHeight,
    title: 'Margo',
    icon,
    show: false,
    backgroundColor: theme.bg,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
      navigateOnDragDrop: false,
      spellcheck: true,
      /* Chromium throttles timers hard in a window it considers occluded, so an
         unattended smoke run whose window drifts behind another one stalls in
         its own waits and never reports. Real runs keep the throttling. */
      backgroundThrottling: !SMOKE
    }
  }, windowChrome(theme)));
  const thisWin = win;
  if (process.platform === 'win32') win.setIcon(icon);
  if (!SMOKE) windowState.track(win, (st) => writeSettings({ windowState: st }));

  /* Holding the window back until ready-to-show means the first thing on
     screen is the finished landing view rather than a white flash. A renderer
     that throws before its first paint never fires that event, which would
     leave Margo running with no window and nothing on screen to say so, so the
     wait is capped and the window comes up regardless once it expires. */
  let shown = false;
  const showWindow = () => {
    if (shown || thisWin.isDestroyed()) return;
    shown = true;
    clearTimeout(showFallback);
    if (placed.maximized) thisWin.maximize();
    thisWin.show();
    thisWin.focus();
  };
  const showFallback = setTimeout(showWindow, SHOW_FALLBACK_MS);
  win.once('ready-to-show', showWindow);

  win.loadFile(path.join(__dirname, 'src', 'renderer', 'index.html'));

  /* Closing is vetoed here and handed to the renderer so it can offer to save.
     That leaves the window at the renderer's mercy, so there are two ways out
     if the renderer never answers. A renderer that is gone has no unsaved work
     left to rescue, so the close simply proceeds. A renderer that is merely
     wedged still might, so the second attempt asks in a native dialog - one
     the stuck renderer cannot draw over or block - instead of deciding for the
     author. The ack keeps that dialog away from the normal path, where the
     renderer is alive and showing its own "Save changes?" prompt; a renderer
     that acks and then fails outright reports that too, so it reaches the same
     dialog without waiting out the grace period. */
  win.on('close', (e) => {
    if (forceClose || !rendererAlive) return;
    if (thisWin.webContents.isDestroyed()) return;
    e.preventDefault();
    closeIsQuit = quitRequested;
    quitRequested = false;

    const unanswered = closeAskedAt && !closeAcked && Date.now() - closeAskedAt > CLOSE_ACK_GRACE_MS;
    if (closeStuck || unanswered) {
      const choice = dialog.showMessageBoxSync(thisWin, {
        type: 'warning',
        buttons: ['Close anyway', 'Keep Margo open'],
        defaultId: 1,
        cancelId: 1,
        title: 'Margo will not close',
        message: 'Margo could not finish closing.',
        detail: 'It could not check your documents for unsaved changes. Closing now will lose anything that was never saved to disk.'
      });
      if (choice === 0) {
        forceClose = true;
        if (closeIsQuit) quitting = true;
        thisWin.close();
      } else {
        closeAskedAt = 0;
        closeStuck = false;
        updater.cancelInstall();
      }
      return;
    }

    closeAskedAt = Date.now();
    closeAcked = false;
    thisWin.webContents.send('app:close-request');
  });
  /* The thumbnail window is hidden but still a window, so leaving it open would
     hold window-all-closed back and keep Margo running with no UI. */
  win.on('closed', () => {
    clearTimeout(showFallback);
    if (win === thisWin) win = null;
    rendererReady = false;
    closeAskedAt = 0;
    closeAcked = false;
    closeStuck = false;
    watcher.closeAll();
    closeThumbWindow();
  });

  /* A dead renderer cannot answer app:close-request, and its unsaved work died
     with it (up to the last draft), so stop vetoing the close - and offer to
     bring it back, which restores those drafts, instead of leaving a blank
     window. */
  /* Spelling: the Word editor draws its own context menu, so the word under
     the pointer and Chromium's suggestions for it are handed to the page. */
  win.webContents.on('context-menu', (_e, params) => {
    if (!params || !params.isEditable || !params.misspelledWord) return;
    win.webContents.send('spell:context', {
      misspelledWord: params.misspelledWord,
      dictionarySuggestions: (params.dictionarySuggestions || []).slice(0, 8)
    });
  });

  win.webContents.on('render-process-gone', (_e, details) => {
    rendererAlive = false;
    rendererReady = false;
    const reason = (details && details.reason) || 'crashed';
    if (SMOKE) {
      console.error('SMOKE FATAL renderer gone: ' + reason);
      app.exit(1);
      return;
    }
    if (reason === 'clean-exit' || thisWin.isDestroyed()) return;
    dialog.showMessageBox(thisWin, {
      type: 'error',
      buttons: ['Reload Margo', 'Close'],
      defaultId: 0,
      cancelId: 1,
      title: 'Margo',
      message: 'Margo’s window stopped working.',
      detail: 'Reloading brings back your documents, including unsaved changes Margo had drafted.'
    }).then(({ response }) => {
      if (thisWin.isDestroyed()) return;
      if (response === 0) thisWin.webContents.reload();
      else thisWin.close();
    }).catch(() => {});
  });

  if (DEBUG) {
    win.webContents.on('console-message', (e, legacyLevel, legacyMessage, legacyLine, legacySource) => {
      // Electron 35+ puts these on the event; older builds pass them positionally.
      const levels = { verbose: 0, debug: 0, info: 1, warning: 2, error: 3 };
      const raw = e && e.level != null ? e.level : legacyLevel;
      const level = typeof raw === 'number' ? raw : (levels[raw] != null ? levels[raw] : 1);
      const message = e && e.message != null ? e.message : legacyMessage;
      const line = e && e.lineNumber != null ? e.lineNumber : legacyLine;
      const sourceId = e && e.sourceId != null ? e.sourceId : legacySource;
      if (SMOKE || level >= 2) {
        console.log(`[renderer:${level}] ${message} (${path.basename(String(sourceId || ''))}:${line})`);
      }
    });
  }

  let smokeStarted = false;
  win.webContents.on('did-finish-load', () => {
    rendererReady = true;
    rendererAlive = true;
    if (SMOKE) {
      if (smokeStarted) return;
      smokeStarted = true;
      const smoke = require('./src/main/smoke');
      smoke.run(thisWin).catch((err) => {
        console.error('SMOKE FATAL', err);
        app.exit(1);
      });
      return;
    }
    flushPendingOpen();
    updater.start();
  });
}

/* ---------------- menu ---------------- */

/* Windows and Linux use Margo's own in-window menu bar. macOS always has a
   menu bar at the top of the screen, and without one there is no Quit, no
   Hide, and - because text editing shortcuts are menu roles there - no
   Cmd+C / Cmd+V in any text field. Shortcuts the renderer handles itself
   (open, save, undo in documents...) are not claimed here: an unhandled key
   reaches the menu only after the page has seen it. */
function buildMenu() {
  if (!IS_MAC) {
    Menu.setApplicationMenu(null);
    return;
  }
  const template = [
    { role: 'appMenu' },
    {
      label: 'File',
      submenu: [
        {
          label: 'Open…',
          click: () => {
            if (!win) createWindow();
            pickAndOpen();
          }
        },
        { role: 'recentDocuments', submenu: [{ role: 'clearRecentDocuments' }] },
        { type: 'separator' },
        { role: 'close' }
      ]
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [{ role: 'togglefullscreen' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }]
    },
    { role: 'windowMenu' }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  app.setAboutPanelOptions({
    applicationName: 'Margo',
    applicationVersion: app.getVersion(),
    copyright: 'MIT License'
  });
}

async function pickAndOpen() {
  const res = await dialog.showOpenDialog(win || undefined, openDialogOptions());
  if (res.canceled || !res.filePaths.length) return;
  for (const p of res.filePaths) openInWindow(p);
}

function openDialogOptions() {
  return {
    title: 'Open a file',
    properties: ['openFile'],
    filters: [
      { name: 'All supported', extensions: ['md', 'markdown', 'txt', 'docx', 'xlsx', 'csv', 'pptx', 'pdf'] },
      { name: 'Markdown', extensions: ['md', 'markdown', 'txt'] },
      { name: 'Word document', extensions: ['docx'] },
      { name: 'Excel workbook', extensions: ['xlsx'] },
      { name: 'CSV', extensions: ['csv'] },
      { name: 'PowerPoint presentation', extensions: ['pptx'] },
      { name: 'PDF document', extensions: ['pdf'] },
      { name: 'All files', extensions: ['*'] }
    ]
  };
}

/* ---------------- app lifecycle ---------------- */

// macOS delivers files (Finder "Open With", dock drops, Open Recent) this way,
// possibly before the app is ready.
app.on('open-file', (e, p) => {
  e.preventDefault();
  openInWindow(p);
});

// Smoke runs use isolated userData, so they may run alongside a real instance.
const gotLock = SMOKE ? true : app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv, workingDirectory) => {
    const paths = supportedPathsFromArgv(argv, workingDirectory);
    if (!win && app.isReady()) createWindow();
    focusWindow();
    for (const p of paths) openInWindow(p);
  });

  app.whenReady().then(() => {
    buildMenu();
    const ses = session.defaultSession;
    ses.setPermissionRequestHandler((_wc, permission, callback) => {
      callback(ALLOWED_PERMISSIONS.has(permission));
    });
    ses.setPermissionCheckHandler((_wc, permission) => ALLOWED_PERMISSIONS.has(permission));
    /* No window may reach a network host through a UNC file: URL (see
       access.fileUrlAllowed). Margo's own files and its temp pages always
       load, even when Margo itself runs from a network share. */
    const { pathToFileURL } = require('url');
    const ownUrls = [__dirname, require('os').tmpdir()].map((d) => pathToFileURL(d + path.sep).href);
    ses.webRequest.onBeforeRequest({ urls: ['file://*/*'] }, (details, callback) => {
      const own = ownUrls.some((u) => details.url.startsWith(u));
      callback({ cancel: !own && !access.fileUrlAllowed(details.url) });
    });

    if (SMOKE) {
      try { drafts.clear(); } catch {}
      // A run that wedges before reporting must still end, and end red.
      const watchdogMs = Number(process.env.MARGO_SMOKE_WATCHDOG_MS) || 420000;
      setTimeout(() => {
        console.log(`SMOKE FATAL watchdog: no result after ${watchdogMs / 1000}s`);
        app.exit(3);
      }, watchdogMs);
    } else {
      // Drafts from before file access was tracked still point at the file
      // the author had open; recovering them must be able to save back there.
      try {
        for (const d of drafts.list()) if (d.path) access.grant(d.path, { persist: false });
      } catch {}
    }
    for (const p of supportedPathsFromArgv(process.argv)) pendingOpen.push(access.grant(p));
    createWindow();
  });

  app.on('activate', () => {
    if (!win && app.isReady()) createWindow();
  });
}

app.on('before-quit', () => { quitRequested = true; });

app.on('window-all-closed', () => {
  if (updater.takeInstallRequest()) {
    // quitAndInstall quits by itself once the installer is running; if it
    // could not start one, do not linger with no window.
    setTimeout(() => app.quit(), 8000);
    return;
  }
  if (!IS_MAC || quitting || SMOKE) app.quit();
});

app.on('will-quit', () => {
  access.flush();
  watcher.closeAll();
});

/* ---------------- IPC ---------------- */

require('./src/main/google').attach({
  disabled: SMOKE,
  userData: () => app.getPath('userData'),
  access,
  ownWrite
});

function errMsg(err) {
  return (err && err.message) || String(err || 'Unknown error');
}

function plainObject(v) {
  return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
}

/* The document kinds files.save understands are its business; this only keeps
   the value to something that can be a kind name. */
function kindName(v) {
  return typeof v === 'string' && /^[a-z][a-z0-9-]{0,23}$/.test(v) ? v : null;
}

function optString(v, max) {
  return typeof v === 'string' && v.length <= max ? v : null;
}

function safeBaseName(name, fallback) {
  const stem = path
    .basename(String(name || ''))
    .replace(/\.[^.]+$/, '')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 200);
  return stem || fallback;
}

function validSaveRequest(req) {
  const r = plainObject(req);
  if (!r) throw new Error('Bad save request.');
  const kind = kindName(r.kind);
  if (!kind) throw new Error('Unknown document kind.');
  const data = plainObject(r.data);
  if (!data) throw new Error('Nothing to save.');
  const thumbDataUrl = optString(r.thumbDataUrl, 20 * 1024 * 1024);
  // Only ever a name: it seeds the dialog's file name, never its folder.
  const name = optString(r.suggestedName, 1024);
  const suggestedName = name ? path.basename(name.replace(/[\\/]+$/, '').replace(/\\/g, '/')).replace(/[\x00-\x1f]/g, '') : null;
  return { kind, data, thumbDataUrl, path: r.path, currentPath: optString(r.currentPath, 4096), suggestedName };
}

ipcMain.handle('dialog:open', async () => {
  const res = await dialog.showOpenDialog(win, openDialogOptions());
  if (res.canceled || !res.filePaths.length) return { canceled: true };
  return { canceled: false, path: access.grant(res.filePaths[0]) };
});

ipcMain.handle('file:open', async (_e, filePath) => {
  try {
    const p = access.check(filePath, 'open');
    const doc = await files.openPath(p);
    recents.add(p, doc.kind);
    access.grant(p);
    watcher.watch(p);
    return { ok: true, doc };
  } catch (err) {
    return { ok: false, error: errMsg(err) };
  }
});

ipcMain.handle('file:peek', async (_e, filePath) => {
  try {
    const p = access.check(filePath, 'open');
    const doc = await files.openPath(p);
    return { ok: true, doc };
  } catch (err) {
    return { ok: false, error: errMsg(err) };
  }
});

ipcMain.handle('file:save', async (_e, req) => {
  try {
    const r = validSaveRequest(req);
    const target = access.check(r.path, 'save');
    await ownWrite(target, () => files.save({ kind: r.kind, path: target, data: r.data, thumbDataUrl: r.thumbDataUrl }));
    const savedKind = files.kindFromPath(target) || r.kind;
    recents.add(target, savedKind);
    if (savedKind === r.kind) watcher.watch(target);
    return { ok: true, path: target };
  } catch (err) {
    return { ok: false, error: errMsg(err) };
  }
});

ipcMain.handle('file:save-as', async (_e, req) => {
  try {
    const r = validSaveRequest(Object.assign({}, plainObject(req), { path: null }));
    const filters = files.saveFilters(r.kind);
    const res = await dialog.showSaveDialog(win, {
      title: 'Save as',
      defaultPath: files.suggestSavePath(r, app.getPath('documents')),
      filters
    });
    if (res.canceled || !res.filePath) return { canceled: true };
    let target = res.filePath;
    if (!path.extname(target)) target += '.' + filters[0].extensions[0];
    target = access.grant(target);
    if (!target) return { canceled: false, ok: false, error: 'That is not a valid file path.' };
    await ownWrite(target, () => files.save({ kind: r.kind, path: target, data: r.data, thumbDataUrl: r.thumbDataUrl }));
    const savedKind = files.kindFromPath(target) || r.kind;
    recents.add(target, savedKind);
    if (savedKind === r.kind) {
      // The document now lives at the new path; the old file is no longer
      // what the author has open.
      const from = access.normalize(r.currentPath);
      if (from && from !== target) watcher.unwatch(from);
      watcher.watch(target);
    }
    return { canceled: false, ok: true, path: target };
  } catch (err) {
    return { canceled: false, ok: false, error: errMsg(err) };
  }
});

/* Dropped files: preload asks for the path of a real File object the author
   dragged in (a page cannot forge one) and reports it here, synchronously so
   the grant is in place before the open request that follows it. */
ipcMain.on('file:grant-dropped', (e, p) => {
  e.returnValue = access.grant(p) || null;
});

/* Watching the files open in tabs: file:open and saves start a watch on their
   own; the renderer stops it when a tab closes, and can restart one (after
   restoring a draft, say). Changes arrive as 'file:changed-externally'. */
ipcMain.handle('file:watch', (_e, p) => {
  if (!access.isAllowed(p)) return false;
  return watcher.watch(access.normalize(p));
});
ipcMain.handle('file:unwatch', (_e, p) => {
  const n = access.normalize(p);
  return n ? watcher.unwatch(n) : false;
});

/* ---------------- thumbnails ---------------- */

function thumbsDir() {
  const d = path.join(app.getPath('userData'), 'thumbs');
  fs.mkdirSync(d, { recursive: true });
  return d;
}
/* Keyed by path, folded to lower case only where the file system ignores case
   (Windows keys stay what they always were); on Linux "Plan.md" and "plan.md"
   are different documents and used to share one thumbnail. */
function thumbFile(filePath) {
  const p = String(filePath);
  const k = process.platform === 'win32' || IS_MAC ? p.toLowerCase() : p;
  const h = crypto.createHash('sha1').update(k).digest('hex');
  return path.join(thumbsDir(), h + '.png');
}

/* Chromium taints a canvas the moment an SVG carrying a <foreignObject> is
   drawn into it, so the renderer cannot rasterize an HTML thumbnail itself:
   toDataURL throws and the thumbnail comes back null. Plain SVG is unaffected,
   which is why the sheet and PDF thumbnails were fine and only the document
   ones were missing. Painting the card in a window and capturing it avoids the
   canvas altogether. The window is reused because a freshly created one fails
   to load the next document, and javascript stays off - this is sanitized
   document HTML that only has to lay out. */
let thumbWin = null;

function thumbWindow(width, height) {
  if (thumbWin && !thumbWin.isDestroyed()) {
    thumbWin.setContentSize(width, height);
    return thumbWin;
  }
  thumbWin = new BrowserWindow({
    width,
    height,
    show: false,
    frame: false,
    webPreferences: {
      sandbox: true,
      javascript: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  thumbWin.on('closed', () => { thumbWin = null; });
  return thumbWin;
}

function closeThumbWindow() {
  if (thumbWin && !thumbWin.isDestroyed()) thumbWin.destroy();
  thumbWin = null;
}

/* That one reused window can only be showing one card at a time, so two
   requests in flight together raced over it: the second loadFile aborts the
   first, and whichever capturePage ran next returned the wrong card - saved
   against the first caller's file. The renderer has two callers that overlap
   easily, a save refreshing its own thumbnail and the library backfilling
   everything else, so requests take the window in turn. */
let thumbChain = Promise.resolve();

function queueThumbJob(job) {
  const result = thumbChain.then(job, job);
  thumbChain = result.then(() => {}, () => {});
  return result;
}

const clampDim = (v, def) => Math.min(2000, Math.max(1, Math.round(Number(v) || def)));

/* A hidden window has often not produced its first frame yet when loadFile
   resolves, and since Electron 38 capturePage then rejects (UnknownVizError)
   instead of waiting for one. A frame follows within a few tens of ms. */
async function captureHidden(w) {
  let lastErr = null;
  for (let attempt = 0; attempt < 30; attempt++) {
    if (w.isDestroyed()) break;
    try {
      const img = await w.capturePage();
      if (!img.isEmpty()) return img;
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  if (lastErr) throw lastErr;
  return nativeImage.createEmpty();
}

ipcMain.handle('thumbs:render-html', (_e, req) => queueThumbJob(async () => {
  const r = plainObject(req) || {};
  const width = clampDim(r.width, 440);
  const height = clampDim(r.height, 568);
  const html = typeof r.html === 'string' ? r.html : '';
  if (html.length > 50 * 1024 * 1024) return { ok: false, error: 'Thumbnail source is too large' };
  const tmp = printing.tempPath('margo-thumb', 'html');
  try {
    await fs.promises.writeFile(tmp, printing.injectCsp(html), { encoding: 'utf8', mode: 0o600 });
    const w = thumbWindow(width, height);
    await w.loadFile(tmp);
    let img = await captureHidden(w);
    if (img.isEmpty()) return { ok: false, error: 'Thumbnail came back blank' };
    /* capturePage hands back physical pixels, so on a scaled display the image
       would be larger than the card the caller asked for. */
    const size = img.getSize();
    if (size.width !== width || size.height !== height) img = img.resize({ width, height });
    return { ok: true, dataUrl: img.toDataURL() };
  } catch (err) {
    return { ok: false, error: errMsg(err) };
  } finally {
    try { await fs.promises.unlink(tmp); } catch {}
  }
}));

ipcMain.handle('thumbs:set', (_e, req) => {
  try {
    const r = plainObject(req) || {};
    const filePath = access.normalize(r.path);
    const dataUrl = optString(r.dataUrl, 20 * 1024 * 1024);
    const m = /^data:image\/(?:png|jpeg|jpg);base64,(.+)$/i.exec(dataUrl || '');
    if (!m || !filePath) return false;
    fs.writeFileSync(thumbFile(filePath), Buffer.from(m[1], 'base64'));
    return true;
  } catch { return false; }
});

ipcMain.handle('file:docx-thumb', async (_e, filePath) => {
  try {
    const p = access.check(filePath, 'open');
    return { ok: true, dataUrl: await files.readDocxEmbeddedThumb(p) };
  } catch (err) {
    return { ok: false, error: errMsg(err) };
  }
});

ipcMain.handle('file:read-binary', async (_e, filePath) => {
  const p = access.check(filePath, 'open');
  const stat = await fs.promises.stat(p);
  if (!stat.isFile()) throw new Error('That is not a file.');
  if (stat.size > 500 * 1024 * 1024) throw new Error('File is larger than 500 MB.');
  return fs.promises.readFile(p);
});

/* Callers pass a display name like "doc-image-3.png" whatever the image really
   is, so the extension is taken from the data URL instead: an image lifted out
   of a Word file is as likely to be a JPEG, and it used to be written as .png. */
function imageExt(mime) {
  const m = String(mime || '').toLowerCase();
  if (m === 'jpeg' || m === 'jpg') return 'jpg';
  if (m === 'svg+xml') return 'svg';
  return m.replace(/[^a-z0-9]/g, '') || 'png';
}

/* The renderer chooses these names, so one is a suggestion and never a path.
   Only the stem survives, stripped of separators, drive letters and leading
   dots, which keeps a crafted name from writing outside the chosen folder. */
function safeImageName(suggested, fallbackStem, mime) {
  return safeBaseName(suggested, fallbackStem) + '.' + imageExt(mime);
}

/* Exporting twice into the same folder used to write straight over the first
   export, and any file of the author's that happened to share a name went with
   it, silently - the count came back as though everything had been written.
   A name already taken gets a number instead, the way a browser download does.
   `taken` covers names claimed earlier in this same export, which are not on
   disk yet when the next one is chosen. */
function uniqueFilePath(dir, fileName, taken) {
  const ext = path.extname(fileName);
  const stem = path.basename(fileName, ext);
  let candidate = fileName;
  let n = 1;
  while (taken.has(candidate.toLowerCase()) || fs.existsSync(path.join(dir, candidate))) {
    n += 1;
    candidate = `${stem} (${n})${ext}`;
  }
  taken.add(candidate.toLowerCase());
  return path.join(dir, candidate);
}

const IMAGE_DATA_URL = /^data:image\/([a-zA-Z0-9+.-]+);base64,([A-Za-z0-9+/=\s]+)$/;
const MAX_IMAGE_DATA_URL = 150 * 1024 * 1024;

ipcMain.handle('image:save-as', async (_e, req) => {
  try {
    const r = plainObject(req) || {};
    const dataUrl = optString(r.dataUrl, MAX_IMAGE_DATA_URL);
    const m = IMAGE_DATA_URL.exec(dataUrl || '');
    if (!m) return { ok: false, error: 'Bad image data' };
    const ext = imageExt(m[1]);
    const defaultFile = safeImageName(r.suggestedName, 'image', m[1]);
    const res = await dialog.showSaveDialog(win, {
      title: 'Save image',
      defaultPath: path.join(app.getPath('pictures'), defaultFile),
      filters: [
        { name: 'Image', extensions: [ext, 'png', 'jpg', 'jpeg', 'webp'] },
        { name: 'All files', extensions: ['*'] }
      ]
    });
    if (res.canceled || !res.filePath) return { canceled: true };
    await files.atomicWrite(res.filePath, (tmp) => fs.promises.writeFile(tmp, Buffer.from(m[2], 'base64')));
    return { ok: true, path: res.filePath };
  } catch (err) {
    return { ok: false, error: errMsg(err) };
  }
});

ipcMain.handle('images:export-folder', async (_e, req) => {
  try {
    const images = plainObject(req) && req.images;
    if (!Array.isArray(images) || !images.length) return { ok: false, error: 'No images to export' };
    if (images.length > 5000) return { ok: false, error: 'Too many images to export at once' };
    const res = await dialog.showOpenDialog(win, {
      title: 'Select Destination Folder for Extracted Images',
      properties: ['openDirectory', 'createDirectory']
    });
    if (res.canceled || !res.filePaths || !res.filePaths[0]) return { canceled: true };
    const targetDir = res.filePaths[0];
    const taken = new Set();
    let saved = 0;
    for (let i = 0; i < images.length; i++) {
      const im = plainObject(images[i]) || {};
      const m = IMAGE_DATA_URL.exec(optString(im.dataUrl, MAX_IMAGE_DATA_URL) || '');
      if (!m) continue;
      const name = safeImageName(im.name, `doc-image-${i + 1}`, m[1]);
      /* safeImageName leaves nothing that could climb out, so this only ever
         fires if that changes. Skipping beats writing outside the folder. */
      if (path.dirname(path.resolve(path.join(targetDir, name))) !== path.resolve(targetDir)) continue;
      const filePath = uniqueFilePath(targetDir, name, taken);
      await fs.promises.writeFile(filePath, Buffer.from(m[2], 'base64'), { flag: 'wx' });
      saved++;
    }
    return { ok: true, count: saved, folder: targetDir };
  } catch (err) {
    return { ok: false, error: errMsg(err) };
  }
});

function nativePrint(printWin) {
  return new Promise((resolve) => {
    printWin.webContents.print({ printBackground: true }, (success, failureReason) => {
      if (success) resolve({ ok: true });
      else if (/cancel/i.test(String(failureReason || ''))) resolve({ canceled: true });
      else resolve({ ok: false, error: failureReason || 'Print failed' });
    });
  });
}

function pdfExportHtml(req) {
  return files.htmlForPdfExport({
    kind: req.kind,
    data: req.data,
    title: safeBaseName(req.suggestedName, 'Document')
  });
}

/* Export any editable document as PDF via Chromium's print engine.
   req: { kind, data, suggestedName, currentPath?, path?, page? } where page
   is { size: 'A4'|'Letter'|..., landscape: bool, margins: preset | inches |
   {top,right,bottom,left} } (see printing.normalizePageOptions). A Word
   document's own page setup is the default; everything else defaults to A4
   portrait with one-inch margins. */
ipcMain.handle('export:pdf', async (_e, req) => {
  try {
    const r = plainObject(req);
    if (!r) throw new Error('Bad export request.');
    const kind = kindName(r.kind);
    if (!kind) throw new Error('Unknown document kind.');
    const data = plainObject(r.data);
    if (!data) throw new Error('Nothing to export.');
    let target = null;
    if (r.path != null) {
      target = access.check(r.path, 'save');
    } else {
      const base = safeBaseName(r.suggestedName, 'Untitled');
      const current = access.normalize(r.currentPath);
      const dir = current ? path.dirname(current) : app.getPath('documents');
      const res = await dialog.showSaveDialog(win, {
        title: 'Export as PDF',
        defaultPath: path.join(dir, base + '.pdf'),
        filters: [{ name: 'PDF document', extensions: ['pdf'] }]
      });
      if (res.canceled || !res.filePath) return { canceled: true };
      target = res.filePath;
      if (!path.extname(target)) target += '.pdf';
      target = access.grant(target);
      if (!target) throw new Error('That is not a valid file path.');
    }
    const setup = printing.normalizePageOptions(r.page, kind, data);
    const pdf = await printing.htmlToPdf(pdfExportHtml({ kind, data, suggestedName: r.suggestedName }), setup, win);
    await ownWrite(target, () => files.atomicWrite(target, (tmp) => fs.promises.writeFile(tmp, pdf)));
    recents.add(target, 'pdf');
    return { ok: true, path: target, page: setup };
  } catch (err) {
    return { ok: false, error: errMsg(err) };
  }
});

ipcMain.handle('print:document', async (_e, req) => {
  if (SMOKE) return { ok: true, skipped: true };
  try {
    const r = plainObject(req) || {};
    if (r.kind === 'pdf') {
      let tmp = null;
      const data = plainObject(r.data);
      // The editor's current bytes carry unsaved page edits and annotations,
      // so they win over the copy on disk.
      const hasBytes = !!(data && typeof data.base64 === 'string' && data.base64);
      let filePath = !hasBytes && r.path != null ? access.check(r.path, 'open') : null;
      if (hasBytes) {
        tmp = printing.tempPath('margo-print', 'pdf');
        fs.writeFileSync(tmp, Buffer.from(data.base64, 'base64'), { mode: 0o600 });
        filePath = tmp;
      }
      if (!filePath || !fs.existsSync(filePath)) {
        return { ok: false, error: 'Save the PDF first, then print.' };
      }
      const printWin = printing.hiddenWindow(win, { javascript: true });
      try {
        await printWin.loadFile(filePath);
        return await nativePrint(printWin);
      } finally {
        printWin.destroy();
        if (tmp) try { fs.unlinkSync(tmp); } catch {}
      }
    }
    const kind = kindName(r.kind);
    const data = plainObject(r.data);
    if (!kind || !data) return { ok: false, error: 'Nothing to print.' };
    return await printing.withHtmlWindow(pdfExportHtml({ kind, data, suggestedName: r.suggestedName }), win, (printWin) => nativePrint(printWin));
  } catch (err) {
    return { ok: false, error: errMsg(err) };
  }
});

ipcMain.handle('app:quit', () => { if (win) win.close(); });
ipcMain.handle('app:version', () => app.getVersion());
ipcMain.handle('spell:replace', (e, word) => {
  if (typeof word === 'string' && word.length < 200) e.sender.replaceMisspelling(word);
});
ipcMain.handle('spell:add-word', (e, word) => {
  if (typeof word === 'string' && word.trim() && word.length < 100) {
    e.sender.session.addWordToSpellCheckerDictionary(word.trim());
  }
});

ipcMain.handle('recents:list', () => {
  return recents.list().map((r) => {
    let thumb = null;
    try {
      const f = thumbFile(r.path);
      if (fs.existsSync(f)) thumb = fs.readFileSync(f);
    } catch {}
    return { ...r, thumb };
  });
});
ipcMain.handle('recents:clear', () => recents.clear());
ipcMain.handle('recents:remove', (_e, p) => (typeof p === 'string' ? recents.remove(p) : false));

/* A draft may name the file it belongs to, and restoring it later lets the
   author save straight back there - so the path has to be one they gave
   Margo, or a draft would be a way to mint access to any file. */
ipcMain.handle('drafts:put', (_e, draft) => {
  const d = plainObject(draft);
  if (!d) return { ok: false, error: 'Invalid draft' };
  const p = d.path != null && access.isAllowed(d.path) ? access.normalize(d.path) : null;
  return drafts.put(Object.assign({}, d, { path: p }));
});
ipcMain.handle('drafts:list', () => drafts.list());
ipcMain.handle('drafts:remove', (_e, id) => drafts.remove(id));
ipcMain.handle('drafts:clear', () => drafts.clear());

ipcMain.handle('theme:get', () => currentTheme());
ipcMain.handle('theme:set', (_e, theme) => {
  if (typeof theme !== 'string' || !Object.prototype.hasOwnProperty.call(THEMES, theme)) return currentTheme();
  writeSettings({ theme });
  const t = THEMES[theme];
  if (win) {
    if (!IS_MAC) {
      try { win.setTitleBarOverlay({ color: t.bar, symbolColor: t.fg, height: 44 }); } catch {}
    }
    win.setBackgroundColor(t.bg);
  }
  return theme;
});

ipcMain.handle('settings:first-run', () => {
  if (SMOKE) return false;
  const s = readSettings();
  if (s.firstRunDone) return false;
  writeSettings({ firstRunDone: true });
  return true;
});

ipcMain.handle('app:sample-path', () => access.grant(path.join(__dirname, 'samples', 'welcome.md'), { persist: false }));

ipcMain.handle('win:title', (_e, title) => {
  if (win && typeof title === 'string') win.setTitle(title.slice(0, 300));
});

/* Sent the moment the renderer picks up app:close-request, before it does any
   work, so a slow "Save changes?" prompt is never mistaken for a hang. Sent
   again with false if the renderer then fails to see the close through, which
   is the one case an ack would otherwise hide from the escape hatch above. */
ipcMain.handle('app:close-ack', (_e, handled) => {
  if (handled === false) closeStuck = true;
  else closeAcked = true;
});

ipcMain.handle('app:close-now', () => {
  forceClose = true;
  if (closeIsQuit) quitting = true;
  if (win) win.close();
});

ipcMain.handle('shell:open-external', (_e, url) => openExternalSafe(url));

ipcMain.handle('smoke:capture', async (_e, fileName) => {
  if (!SMOKE || !win) return false;
  const name = path.basename(String(fileName || 'shot.png')).replace(/[^\w.-]/g, '_');
  if (!/\.png$/i.test(name)) return false;
  const dir = process.env.MARGO_SHOTS || path.join(app.getPath('userData'), 'shots');
  fs.mkdirSync(dir, { recursive: true });
  const img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(dir, name), img.toPNG());
  return true;
});

ipcMain.handle('smoke:report', (_e, results) => {
  if (!SMOKE) return;
  const smoke = require('./src/main/smoke');
  smoke.onRendererReport(results);
});

module.exports = { supportedPathsFromArgv, openExternalSafe };
