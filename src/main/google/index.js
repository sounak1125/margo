const fs = require('fs');
const path = require('path');
const { app, ipcMain, clipboard } = require('electron');

const NOT_CONFIGURED = 'Google sign-in is not configured. Add a Desktop OAuth client ID (see README).';

function normPath(p) {
  try { return path.resolve(String(p)).toLowerCase(); } catch { return String(p || '').toLowerCase(); }
}

function initialsOf(name, email) {
  const src = String(name || email || '').trim();
  if (!src) return 'G';
  const parts = src.split(/[\s@._-]+/).filter(Boolean);
  const a = (parts[0] || src)[0];
  const b = parts.length > 1 ? parts[1][0] : (parts[0][1] || '');
  return (a + b).toUpperCase();
}

function mapPath(userData) {
  return path.join(userData, 'drive-map.json');
}
function readMap(userData) {
  try {
    const j = JSON.parse(fs.readFileSync(mapPath(userData), 'utf8'));
    return j && typeof j === 'object' ? j : {};
  } catch { return {}; }
}
function writeMap(userData, obj) {
  try { fs.writeFileSync(mapPath(userData), JSON.stringify(obj, null, 2)); } catch {}
}

function pathForFileId(maps, fileId) {
  if (!fileId) return null;
  for (const [p, v] of Object.entries(maps)) {
    if (v && v.fileId === fileId) return p;
  }
  return null;
}

function remapPath(userData, fromPath, toPath, name) {
  if (!toPath) return;
  const maps = readMap(userData);
  const newKey = normPath(toPath);
  if (fromPath) {
    const oldKey = normPath(fromPath);
    if (oldKey !== newKey && maps[oldKey]) {
      maps[newKey] = {
        fileId: maps[oldKey].fileId,
        name: name || maps[oldKey].name
      };
      delete maps[oldKey];
      writeMap(userData, maps);
      return;
    }
  }
  if (name && maps[newKey]) {
    maps[newKey] = Object.assign({}, maps[newKey], { name });
    writeMap(userData, maps);
  }
}

function safeFileName(name) {
  const base = path.basename(String(name || 'Untitled')).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim();
  return base || 'Untitled';
}

function destForDownload(userData, fileId, name) {
  const maps = readMap(userData);
  const existing = pathForFileId(maps, fileId);
  if (existing) return existing;
  const dir = path.join(app.getPath('documents'), 'Margo');
  fs.mkdirSync(dir, { recursive: true });
  const safe = safeFileName(name);
  const ext = path.extname(safe);
  const stem = path.basename(safe, ext) || 'Untitled';
  let dest = path.join(dir, safe);
  let n = 1;
  while (fs.existsSync(dest)) {
    const mapped = maps[normPath(dest)];
    if (mapped && mapped.fileId === fileId) break;
    n += 1;
    dest = path.join(dir, stem + ' (' + n + ')' + ext);
  }
  return dest;
}

function stubStatus() {
  return { signedIn: false, configured: false, email: '', name: '', pictureDataUrl: null, initials: 'G' };
}

function attach({ disabled, userData }) {
  const getUserData = typeof userData === 'function' ? userData : () => userData;
  let pictureCache = null;
  let signInLock = null;

  const handlers = {
    'google:status': () => stubStatus(),
    'google:signIn': async () => ({ ok: false, error: 'Google sign-in is disabled in tests.' }),
    'google:signOut': async () => ({ ok: true }),
    'google:share': async () => ({ ok: false, error: 'Google Drive is disabled in tests.' }),
    'google:addPerson': async () => ({ ok: false, error: 'Google Drive is disabled in tests.' }),
    'google:setRole': async () => ({ ok: false, error: 'Google Drive is disabled in tests.' }),
    'google:removePerson': async () => ({ ok: false, error: 'Google Drive is disabled in tests.' }),
    'google:copyLink': async () => ({ ok: false, error: 'Google Drive is disabled in tests.' }),
    'google:list': async () => ({ ok: false, error: 'Google Drive is disabled in tests.' }),
    'google:open': async () => ({ ok: false, error: 'Google Drive is disabled in tests.' }),
    'google:push': async () => ({ ok: true, skipped: true })
  };

  if (disabled) {
    Object.keys(handlers).forEach((ch) => ipcMain.handle(ch, handlers[ch]));
    return;
  }

  const oauth = require('./oauth');
  const drive = require('./drive');
  let pictureAttempted = false;

  function statusFromStore(store, cfg) {
    if (!cfg) return stubStatus();
    if (!store) {
      return { signedIn: false, configured: true, email: '', name: '', pictureDataUrl: null, initials: 'G' };
    }
    return {
      signedIn: true,
      configured: true,
      email: store.email || '',
      name: store.name || '',
      pictureDataUrl: pictureCache,
      initials: initialsOf(store.name, store.email)
    };
  }

  async function status() {
    const cfg = oauth.loadClientConfig();
    const store = oauth.readStore(getUserData());
    if (store && store.pictureUrl && !pictureCache && !pictureAttempted) {
      pictureAttempted = true;
      pictureCache = await oauth.pictureDataUrl(store.pictureUrl);
    }
    return statusFromStore(store, cfg);
  }

  async function withToken() {
    const cfg = oauth.loadClientConfig();
    if (!cfg) throw new Error(NOT_CONFIGURED);
    const store = oauth.readStore(getUserData());
    if (!store) throw new Error('Sign in with Google first.');
    const token = await oauth.accessToken(cfg, store);
    return { cfg, store, token };
  }

  async function persistFolder(store, folderId) {
    if (store.folderId === folderId) return store;
    const next = Object.assign({}, store, { folderId });
    oauth.writeStore(getUserData(), next);
    return next;
  }

  ipcMain.handle('google:status', () => status());

  ipcMain.handle('google:signIn', async () => {
    const cfg = oauth.loadClientConfig();
    if (!cfg) return { ok: false, error: NOT_CONFIGURED };
    if (signInLock) return signInLock;
    signInLock = (async () => {
      try {
        const store = await oauth.signInWithBrowser(cfg);
        oauth.writeStore(getUserData(), store);
        pictureAttempted = true;
        pictureCache = await oauth.pictureDataUrl(store.pictureUrl);
        return { ok: true, status: statusFromStore(store, cfg) };
      } catch (err) {
        return { ok: false, error: err.message || String(err) };
      } finally {
        signInLock = null;
      }
    })();
    return signInLock;
  });

  ipcMain.handle('google:signOut', async () => {
    oauth.clearStore(getUserData());
    pictureCache = null;
    pictureAttempted = false;
    return { ok: true, status: await status() };
  });

  ipcMain.handle('google:share', async (_e, req) => {
    try {
      const filePath = req && req.path;
      const name = (req && req.name) || path.basename(filePath || 'Untitled');
      if (!filePath || !fs.existsSync(filePath)) return { ok: false, error: 'Save the file locally first.' };
      let { store, token } = await withToken();
      const folderId = await drive.ensureFolder(token, store.folderId);
      store = await persistFolder(store, folderId);
      const buf = fs.readFileSync(filePath);
      const mime = drive.mimeOf(filePath);
      const maps = readMap(getUserData());
      const key = normPath(filePath);
      let fileId = maps[key] && maps[key].fileId;
      if (fileId) {
        try {
          const existing = await drive.getFile(token, fileId);
          if (!existing || existing.trashed) fileId = null;
        } catch { fileId = null; }
      }
      let meta;
      if (fileId) meta = await drive.updateFile(token, fileId, { name, mime, buf });
      else {
        meta = await drive.createFile(token, { name, mime, buf, folderId });
        fileId = meta.id;
        maps[key] = { fileId, name };
        writeMap(getUserData(), maps);
      }
      const people = await drive.listPermissions(token, fileId);
      return {
        ok: true,
        fileId,
        name: meta.name || name,
        webViewLink: meta.webViewLink || '',
        people
      };
    } catch (err) {
      return { ok: false, error: err.message || String(err) };
    }
  });

  ipcMain.handle('google:addPerson', async (_e, req) => {
    try {
      const { token } = await withToken();
      const email = String((req && req.email) || '').trim();
      if (!email || !email.includes('@')) return { ok: false, error: 'Enter a Google email address.' };
      if (!req.fileId) return { ok: false, error: 'Missing Drive file.' };
      await drive.addPermission(token, req.fileId, email, req.role);
      const people = await drive.listPermissions(token, req.fileId);
      return { ok: true, people };
    } catch (err) {
      return { ok: false, error: err.message || String(err) };
    }
  });

  ipcMain.handle('google:setRole', async (_e, req) => {
    try {
      const { token } = await withToken();
      if (!req.fileId || !req.permissionId) return { ok: false, error: 'Missing permission.' };
      await drive.setPermissionRole(token, req.fileId, req.permissionId, req.role);
      const people = await drive.listPermissions(token, req.fileId);
      return { ok: true, people };
    } catch (err) {
      return { ok: false, error: err.message || String(err) };
    }
  });

  ipcMain.handle('google:removePerson', async (_e, req) => {
    try {
      const { token } = await withToken();
      if (!req.fileId || !req.permissionId) return { ok: false, error: 'Missing permission.' };
      await drive.removePermission(token, req.fileId, req.permissionId);
      const people = await drive.listPermissions(token, req.fileId);
      return { ok: true, people };
    } catch (err) {
      return { ok: false, error: err.message || String(err) };
    }
  });

  ipcMain.handle('google:copyLink', async (_e, link) => {
    const url = String(link || '').trim();
    if (!url) return { ok: false, error: 'No link yet.' };
    clipboard.writeText(url);
    return { ok: true };
  });

  ipcMain.handle('google:list', async () => {
    try {
      let { store, token } = await withToken();
      const folderId = await drive.ensureFolder(token, store.folderId);
      store = await persistFolder(store, folderId);
      const raw = await drive.listFolder(token, folderId);
      const maps = readMap(getUserData());
      const files = (raw || [])
        .filter((f) => f && f.id && drive.isOpenableName(f.name) && !(f.mimeType || '').startsWith('application/vnd.google-apps.'))
        .map((f) => ({
          id: f.id,
          name: f.name,
          modifiedTime: f.modifiedTime || '',
          localPath: pathForFileId(maps, f.id)
        }));
      return { ok: true, files };
    } catch (err) {
      return { ok: false, error: err.message || String(err) };
    }
  });

  ipcMain.handle('google:open', async (_e, req) => {
    try {
      const fileId = req && req.fileId;
      const name = (req && req.name) || 'Untitled';
      if (!fileId) return { ok: false, error: 'Missing Drive file.' };
      if (!drive.isOpenableName(name)) return { ok: false, error: 'Margo cannot open that file type.' };
      const { token } = await withToken();
      const buf = await drive.downloadFile(token, fileId);
      const dest = destForDownload(getUserData(), fileId, name);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, buf);
      const maps = readMap(getUserData());
      maps[normPath(dest)] = { fileId, name: path.basename(dest) };
      writeMap(getUserData(), maps);
      return { ok: true, path: dest };
    } catch (err) {
      return { ok: false, error: err.message || String(err) };
    }
  });

  ipcMain.handle('google:push', async (_e, req) => {
    try {
      const filePath = req && req.path;
      const name = (req && req.name) || path.basename(filePath || 'Untitled');
      if (req && req.fromPath && filePath) remapPath(getUserData(), req.fromPath, filePath, name);
      if (!filePath || !fs.existsSync(filePath)) return { ok: true, skipped: true };
      const cfg = oauth.loadClientConfig();
      const store = oauth.readStore(getUserData());
      if (!cfg || !store) return { ok: true, skipped: true };
      const maps = readMap(getUserData());
      const key = normPath(filePath);
      const fileId = maps[key] && maps[key].fileId;
      if (!fileId) return { ok: true, skipped: true };
      const token = await oauth.accessToken(cfg, store);
      let existing = null;
      try { existing = await drive.getFile(token, fileId); } catch { existing = null; }
      if (!existing || existing.trashed) {
        return { ok: false, error: 'Could not update Drive — use Share… to upload again.' };
      }
      const buf = fs.readFileSync(filePath);
      const mime = drive.mimeOf(filePath);
      await drive.updateFile(token, fileId, { name, mime, buf });
      maps[key] = { fileId, name };
      writeMap(getUserData(), maps);
      return { ok: true, pushed: true };
    } catch (err) {
      return { ok: false, error: err.message || String(err) };
    }
  });
}

module.exports = { attach };
