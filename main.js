const { app, BrowserWindow, ipcMain, dialog, shell, nativeTheme, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const files = require('./src/main/files');
const recents = require('./src/main/recents');
const drafts = require('./src/main/drafts');

const SMOKE = process.env.MARGO_SMOKE === '1';
const DEBUG = process.env.MARGO_DEBUG === '1' || SMOKE;

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
  light: { bg: '#ffffff', fg: '#1d1d1f', bar: '#f7f7f5' },
  dark: { bg: '#171719', fg: '#ededef', bar: '#1c1c1f' },
  paper: { bg: '#f4efe6', fg: '#2a241c', bar: '#ebe4d8' },
  graphite: { bg: '#232326', fg: '#e8e8ea', bar: '#2a2a2e' },
  ink: { bg: '#141820', fg: '#e8ecf2', bar: '#181c24' }
};

let win = null;
let forceClose = false;
let pendingOpenPath = null;

const updater = require('./src/main/updater').attach({
  getWindow: () => win,
  allowClose: () => { forceClose = true; }
});

function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}
function readSettings() {
  try { return JSON.parse(fs.readFileSync(settingsPath(), 'utf8')); } catch { return {}; }
}
function writeSettings(patch) {
  const next = Object.assign(readSettings(), patch);
  try { fs.writeFileSync(settingsPath(), JSON.stringify(next, null, 2)); } catch {}
  return next;
}
function currentTheme() {
  const saved = readSettings().theme;
  if (saved && THEMES[saved]) return saved;
  return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
}

function supportedPathFromArgv(argv) {
  const exts = ['.md', '.markdown', '.txt', '.docx', '.xlsx', '.csv', '.pdf'];
  for (const raw of argv.slice(1)) {
    if (!raw || raw.startsWith('-') || raw === '.') continue;
    try {
      const p = path.resolve(raw);
      if (fs.existsSync(p) && exts.includes(path.extname(p).toLowerCase())) return p;
    } catch {}
  }
  return null;
}

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

function createWindow() {
  const theme = THEMES[currentTheme()];
  const icon = appIcon();
  win = new BrowserWindow({
    width: 1280,
    height: 850,
    minWidth: 940,
    minHeight: 600,
    title: 'Margo',
    icon,
    show: false,
    backgroundColor: theme.bg,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: theme.bar, symbolColor: theme.fg, height: 44 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true
    }
  });
  if (process.platform === 'win32') win.setIcon(icon);
  win.show();

  win.loadFile(path.join(__dirname, 'src', 'renderer', 'index.html'));

  win.on('close', (e) => {
    if (forceClose) return;
    e.preventDefault();
    if (win && !win.webContents.isDestroyed()) win.webContents.send('app:close-request');
  });
  win.on('closed', () => { win = null; });

  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.session.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(true);
  });
  win.webContents.session.setPermissionCheckHandler((_wc, permission) => {
    if (permission === 'local-fonts') return true;
    return true;
  });

  if (DEBUG) {
    win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
      if (SMOKE || level >= 2) {
        console.log(`[renderer:${level}] ${message} (${path.basename(String(sourceId || ''))}:${line})`);
      }
    });
  }

  win.webContents.once('did-finish-load', () => {
    if (SMOKE) {
      const smoke = require('./src/main/smoke');
      smoke.run(win).catch((err) => {
        console.error('SMOKE FATAL', err);
        app.exit(1);
      });
    } else {
      if (pendingOpenPath) {
        win.webContents.send('app:open-file', pendingOpenPath);
        pendingOpenPath = null;
      }
      updater.start();
    }
  });
}

// Smoke runs use isolated userData, so they may run alongside a real instance.
const gotLock = SMOKE ? true : app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
    const p = supportedPathFromArgv(argv);
    if (p) win.webContents.send('app:open-file', p);
  });

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    if (SMOKE) {
      try { drafts.clear(); } catch {}
    }
    pendingOpenPath = supportedPathFromArgv(process.argv);
    createWindow();
  });
}

app.on('window-all-closed', () => app.quit());

/* ---------------- IPC ---------------- */

require('./src/main/google').attach({
  disabled: SMOKE,
  userData: () => app.getPath('userData')
});

ipcMain.handle('dialog:open', async () => {
  const res = await dialog.showOpenDialog(win, {
    title: 'Open a file',
    properties: ['openFile'],
    filters: [
      { name: 'All supported', extensions: ['md', 'markdown', 'txt', 'docx', 'xlsx', 'csv', 'pdf'] },
      { name: 'Markdown', extensions: ['md', 'markdown', 'txt'] },
      { name: 'Word document', extensions: ['docx'] },
      { name: 'Excel workbook', extensions: ['xlsx'] },
      { name: 'CSV', extensions: ['csv'] },
      { name: 'PDF document', extensions: ['pdf'] },
      { name: 'All files', extensions: ['*'] }
    ]
  });
  if (res.canceled || !res.filePaths.length) return { canceled: true };
  return { canceled: false, path: res.filePaths[0] };
});

ipcMain.handle('file:open', async (_e, filePath) => {
  try {
    const doc = await files.openPath(filePath);
    recents.add(filePath, doc.kind);
    return { ok: true, doc };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
});

ipcMain.handle('file:peek', async (_e, filePath) => {
  try {
    const doc = await files.openPath(filePath);
    return { ok: true, doc };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
});

ipcMain.handle('file:save', async (_e, req) => {
  try {
    await files.save(req);
    recents.add(req.path, req.kind);
    return { ok: true, path: req.path };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
});

ipcMain.handle('file:save-as', async (_e, req) => {
  try {
    const filters = files.saveFilters(req.kind);
    const res = await dialog.showSaveDialog(win, {
      title: 'Save as',
      defaultPath: files.suggestSavePath(req, app.getPath('documents')),
      filters
    });
    if (res.canceled || !res.filePath) return { canceled: true };
    let target = res.filePath;
    if (!path.extname(target)) target += '.' + filters[0].extensions[0];
    await files.save({ kind: req.kind, path: target, data: req.data, thumbDataUrl: req.thumbDataUrl });
    recents.add(target, files.kindFromPath(target) || req.kind);
    return { canceled: false, ok: true, path: target };
  } catch (err) {
    return { canceled: false, ok: false, error: err.message || String(err) };
  }
});

/* ---------------- thumbnails ---------------- */

function thumbsDir() {
  const d = path.join(app.getPath('userData'), 'thumbs');
  fs.mkdirSync(d, { recursive: true });
  return d;
}
function thumbFile(filePath) {
  const h = crypto.createHash('sha1').update(String(filePath).toLowerCase()).digest('hex');
  return path.join(thumbsDir(), h + '.png');
}

ipcMain.handle('thumbs:set', (_e, { path: filePath, dataUrl }) => {
  try {
    const m = /^data:image\/(?:png|jpeg|jpg);base64,(.+)$/i.exec(dataUrl || '');
    if (!m || !filePath) return false;
    fs.writeFileSync(thumbFile(filePath), Buffer.from(m[1], 'base64'));
    return true;
  } catch { return false; }
});

ipcMain.handle('file:docx-thumb', async (_e, filePath) => {
  try {
    return { ok: true, dataUrl: await files.readDocxEmbeddedThumb(filePath) };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
});

ipcMain.handle('file:read-binary', async (_e, filePath) => {
  const stat = await fs.promises.stat(filePath);
  if (stat.size > 500 * 1024 * 1024) throw new Error('File is larger than 500 MB.');
  return fs.promises.readFile(filePath);
});

ipcMain.handle('image:save-as', async (_e, { dataUrl, suggestedName }) => {
  const m = /^data:image\/([a-zA-Z0-9+.-]+);base64,(.+)$/.exec(dataUrl || '');
  if (!m) return { ok: false, error: 'Bad image data' };
  const ext = m[1] === 'jpeg' ? 'jpg' : (m[1] === 'svg+xml' ? 'svg' : m[1]);
  const defaultFile = suggestedName || `image.${ext}`;
  const res = await dialog.showSaveDialog(win, {
    title: 'Save image',
    defaultPath: path.join(app.getPath('pictures'), defaultFile),
    filters: [
      { name: 'Image', extensions: [ext, 'png', 'jpg', 'jpeg', 'webp'] },
      { name: 'All files', extensions: ['*'] }
    ]
  });
  if (res.canceled || !res.filePath) return { canceled: true };
  await fs.promises.writeFile(res.filePath, Buffer.from(m[2], 'base64'));
  return { ok: true, path: res.filePath };
});

ipcMain.handle('images:export-folder', async (_e, { images }) => {
  if (!Array.isArray(images) || !images.length) return { ok: false, error: 'No images to export' };
  const res = await dialog.showOpenDialog(win, {
    title: 'Select Destination Folder for Extracted Images',
    properties: ['openDirectory', 'createDirectory']
  });
  if (res.canceled || !res.filePaths || !res.filePaths[0]) return { canceled: true };
  const targetDir = res.filePaths[0];
  let saved = 0;
  for (let i = 0; i < images.length; i++) {
    const im = images[i];
    const m = /^data:image\/([a-zA-Z0-9+.-]+);base64,(.+)$/.exec(im.dataUrl || '');
    if (!m) continue;
    const ext = m[1] === 'jpeg' ? 'jpg' : (m[1] === 'svg+xml' ? 'svg' : m[1]);
    const filename = im.name || `doc-image-${i + 1}.${ext}`;
    const filePath = path.join(targetDir, filename);
    await fs.promises.writeFile(filePath, Buffer.from(m[2], 'base64'));
    saved++;
  }
  return { ok: true, count: saved, folder: targetDir };
});

function hiddenPrintWindow(webPreferences) {
  return new BrowserWindow({
    show: false,
    parent: win || undefined,
    webPreferences: Object.assign({ sandbox: true }, webPreferences)
  });
}

async function withHtmlPrintWindow(html, fn) {
  const tmp = path.join(app.getPath('temp'), `margo-print-${Date.now()}.html`);
  fs.writeFileSync(tmp, html);
  const printWin = hiddenPrintWindow({ javascript: false });
  try {
    await printWin.loadFile(tmp);
    return await fn(printWin);
  } finally {
    printWin.destroy();
    try { fs.unlinkSync(tmp); } catch {}
  }
}

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
    title: (req.suggestedName || 'Document').replace(/\.[^.]+$/, '')
  });
}

/* Export any editable document as PDF via Chromium's print engine. */
ipcMain.handle('export:pdf', async (_e, req) => {
  try {
    let target = req.path || null;
    if (!target) {
      const base = (req.suggestedName || 'Untitled').replace(/\.[^.]+$/, '');
      const dir = req.currentPath ? path.dirname(req.currentPath) : app.getPath('documents');
      const res = await dialog.showSaveDialog(win, {
        title: 'Export as PDF',
        defaultPath: path.join(dir, base + '.pdf'),
        filters: [{ name: 'PDF document', extensions: ['pdf'] }]
      });
      if (res.canceled || !res.filePath) return { canceled: true };
      target = res.filePath;
    }
    await withHtmlPrintWindow(pdfExportHtml(req), async (printWin) => {
      const pdf = await printWin.webContents.printToPDF({ printBackground: true, pageSize: 'A4' });
      fs.writeFileSync(target, pdf);
    });
    recents.add(target, 'pdf');
    return { ok: true, path: target };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
});

ipcMain.handle('print:document', async (_e, req) => {
  if (SMOKE) return { ok: true, skipped: true };
  try {
    if (req && req.kind === 'pdf') {
      let filePath = req.path;
      let tmp = null;
      if ((!filePath || !fs.existsSync(filePath)) && req.data && req.data.base64) {
        tmp = path.join(app.getPath('temp'), `margo-print-${Date.now()}.pdf`);
        fs.writeFileSync(tmp, Buffer.from(req.data.base64, 'base64'));
        filePath = tmp;
      }
      if (!filePath || !fs.existsSync(filePath)) {
        return { ok: false, error: 'Save the PDF first, then print.' };
      }
      const printWin = hiddenPrintWindow();
      try {
        await printWin.loadFile(filePath);
        return await nativePrint(printWin);
      } finally {
        printWin.destroy();
        if (tmp) try { fs.unlinkSync(tmp); } catch {}
      }
    }
    return await withHtmlPrintWindow(pdfExportHtml(req || {}), (printWin) => nativePrint(printWin));
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
});

ipcMain.handle('app:quit', () => { if (win) win.close(); });
ipcMain.handle('app:version', () => app.getVersion());

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
ipcMain.handle('recents:remove', (_e, p) => recents.remove(p));

ipcMain.handle('drafts:put', (_e, draft) => drafts.put(draft));
ipcMain.handle('drafts:list', () => drafts.list());
ipcMain.handle('drafts:remove', (_e, id) => drafts.remove(id));
ipcMain.handle('drafts:clear', () => drafts.clear());

ipcMain.handle('theme:get', () => currentTheme());
ipcMain.handle('theme:set', (_e, theme) => {
  if (!THEMES[theme]) return currentTheme();
  writeSettings({ theme });
  const t = THEMES[theme];
  if (win) {
    try { win.setTitleBarOverlay({ color: t.bar, symbolColor: t.fg, height: 44 }); } catch {}
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

ipcMain.handle('app:sample-path', () => path.join(__dirname, 'samples', 'welcome.md'));

ipcMain.handle('win:title', (_e, title) => { if (win) win.setTitle(title); });

ipcMain.handle('app:close-now', () => {
  forceClose = true;
  if (win) win.close();
});

ipcMain.handle('shell:open-external', (_e, url) => {
  try {
    const u = new URL(url);
    if (u.protocol === 'https:' || u.protocol === 'http:' || u.protocol === 'mailto:') {
      shell.openExternal(url);
    }
  } catch {}
});

ipcMain.handle('smoke:capture', async (_e, fileName) => {
  if (!SMOKE || !win) return false;
  const dir = process.env.MARGO_SHOTS || path.join(app.getPath('userData'), 'shots');
  fs.mkdirSync(dir, { recursive: true });
  const img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(dir, fileName), img.toPNG());
  return true;
});

ipcMain.handle('smoke:report', (_e, results) => {
  if (!SMOKE) return;
  const smoke = require('./src/main/smoke');
  smoke.onRendererReport(results);
});
