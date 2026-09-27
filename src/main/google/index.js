const fs = require('fs');
const path = require('path');
const { app, ipcMain, clipboard } = require('electron');
const { atomicWrite } = require('../files');

const NOT_CONFIGURED = 'Google sign-in is not configured. Add a Desktop OAuth client ID (see README).';

/* Map keys fold case only where the file system does. Folding everywhere
   meant that on Linux the "existing local copy" handed back for a Drive file
   was the lower-cased key - a path that does not exist - and the next Open
   from Drive wrote the download into a freshly created lower-case folder. */
const CASE_INSENSITIVE = process.platform === 'win32' || process.platform === 'darwin';
function normPath(p) {
  let r;
  try { r = path.resolve(String(p)); } catch { r = String(p || ''); }
  return CASE_INSENSITIVE ? r.toLowerCase() : r;
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
  const dest = mapPath(userData);
  const tmp = dest + '.' + process.pid + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
    fs.renameSync(tmp, dest);
  } catch {
    try { fs.unlinkSync(tmp); } catch {}
  }
}

/* Entries remember the path as it was written (`path`); older entries only
   have the key, which is the real path everywhere but on a case-folding
   platform, where the file system does not mind. */
function pathForFileId(maps, fileId) {
  if (!fileId) return null;
  for (const [p, v] of Object.entries(maps)) {
    if (v && v.fileId === fileId) return (typeof v.path === 'string' && v.path) || p;
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
        name: name || maps[oldKey].name,
        path: path.resolve(toPath)
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

const EMAIL_RE = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$/;

function attach({ disabled, userData, access, ownWrite }) {
  const getUserData = typeof userData === 'function' ? userData : () => userData;
  /* Paths come from the renderer, so they go through the same check as every
     other file IPC: Share and the save-time push read the file and upload it,
     and without this any page script could ship any file of the author's to
     their Drive and share it out. */
  const checkPath = (p, what) => (access ? access.check(p, what) : path.resolve(String(p)));
  const allowed = (p) => (access ? access.isAllowed(p) : true);
  const guardWrite = ownWrite || ((_p, fn) => fn());
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

  /* A revoked or expired refresh token signs the author out, so the UI stops
     claiming a Drive connection that cannot work. */
  async function tokenFor(cfg, store) {
    try {
      return await oauth.accessToken(cfg, store);
    } catch (err) {
      if (err && err.code === 'SIGNIN_EXPIRED') {
        oauth.clearStore(getUserData());
        pictureCache = null;
        pictureAttempted = false;
      }
      throw err;
    }
  }

  async function withToken() {
    const cfg = oauth.loadClientConfig();
    if (!cfg) throw new Error(NOT_CONFIGURED);
    const store = oauth.readStore(getUserData());
    if (!store) throw new Error('Sign in with Google first.');
    const token = await tokenFor(cfg, store);
    return { cfg, store, token };
  }

  function failure(err) {
    const out = { ok: false, error: (err && err.message) || String(err) };
    if (err && err.code === 'SIGNIN_EXPIRED') out.signedOut = true;
    return out;
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
    if (signInLock) {
      // Already waiting on the browser: bring the consent page back.
      oauth.reopenPendingSignIn();
      return signInLock;
    }
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
    oauth.cancelSignIn();
    oauth.clearStore(getUserData());
    pictureCache = null;
    pictureAttempted = false;
    return { ok: true, status: await status() };
  });

  ipcMain.handle('google:share', async (_e, req) => {
    try {
      if (!req || !req.path) return { ok: false, error: 'Save the file locally first.' };
      const filePath = checkPath(req.path, 'share');
      const name = safeFileName((typeof req.name === 'string' && req.name) || path.basename(filePath));
      if (!fs.existsSync(filePath)) return { ok: false, error: 'Save the file locally first.' };
      let { store, token } = await withToken();
      const folderId = await drive.ensureFolder(token, store.folderId);
      store = await persistFolder(store, folderId);
      const buf = await fs.promises.readFile(filePath);
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
        maps[key] = { fileId, name, path: filePath };
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
      return failure(err);
    }
  });

  ipcMain.handle('google:addPerson', async (_e, req) => {
    try {
      const email = String((req && req.email) || '').trim();
      if (!email || email.length > 320 || !EMAIL_RE.test(email)) return { ok: false, error: 'Enter a Google email address.' };
      if (!drive.isDriveId(req.fileId)) return { ok: false, error: 'Missing Drive file.' };
      const { token } = await withToken();
      await drive.addPermission(token, req.fileId, email, req.role);
      const people = await drive.listPermissions(token, req.fileId);
      return { ok: true, people };
    } catch (err) {
      return failure(err);
    }
  });

  ipcMain.handle('google:setRole', async (_e, req) => {
    try {
      if (!req || !drive.isDriveId(req.fileId) || !drive.isDriveId(req.permissionId)) return { ok: false, error: 'Missing permission.' };
      const { token } = await withToken();
      await drive.setPermissionRole(token, req.fileId, req.permissionId, req.role);
      const people = await drive.listPermissions(token, req.fileId);
      return { ok: true, people };
    } catch (err) {
      return failure(err);
    }
  });

  ipcMain.handle('google:removePerson', async (_e, req) => {
    try {
      if (!req || !drive.isDriveId(req.fileId) || !drive.isDriveId(req.permissionId)) return { ok: false, error: 'Missing permission.' };
      const { token } = await withToken();
      await drive.removePermission(token, req.fileId, req.permissionId);
      const people = await drive.listPermissions(token, req.fileId);
      return { ok: true, people };
    } catch (err) {
      return failure(err);
    }
  });

  ipcMain.handle('google:copyLink', async (_e, link) => {
    const url = String(link || '').trim();
    if (!url) return { ok: false, error: 'No link yet.' };
    let u = null;
    try { u = new URL(url); } catch {}
    if (!u || u.protocol !== 'https:') return { ok: false, error: 'That is not a Drive link.' };
    clipboard.writeText(u.href);
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
      return failure(err);
    }
  });

  ipcMain.handle('google:open', async (_e, req) => {
    try {
      const fileId = req && req.fileId;
      if (!drive.isDriveId(fileId)) return { ok: false, error: 'Missing Drive file.' };
      const { token } = await withToken();
      /* The name comes from Drive, not the renderer: it decides where the
         copy is written and what Margo opens it as. */
      const meta = await drive.getFile(token, fileId);
      if (!meta || meta.trashed) return { ok: false, error: 'That file is no longer on Drive.' };
      const name = meta.name || (req && req.name) || 'Untitled';
      if (!drive.isOpenableName(name)) return { ok: false, error: 'Margo cannot open that file type.' };
      const buf = await drive.downloadFile(token, fileId);
      const dest = destForDownload(getUserData(), fileId, name);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      // Atomic, so a dropped download cannot leave half a document behind in
      // place of the local copy.
      await guardWrite(dest, () => atomicWrite(dest, (tmp) => fs.promises.writeFile(tmp, buf)));
      const maps = readMap(getUserData());
      maps[normPath(dest)] = { fileId, name: path.basename(dest), path: dest };
      writeMap(getUserData(), maps);
      const granted = access ? access.grant(dest) : dest;
      return { ok: true, path: granted || dest };
    } catch (err) {
      return failure(err);
    }
  });

  ipcMain.handle('google:push', async (_e, req) => {
    try {
      if (!req || typeof req.path !== 'string' || !allowed(req.path)) return { ok: true, skipped: true };
      const filePath = checkPath(req.path, 'share');
      const name = safeFileName((typeof req.name === 'string' && req.name) || path.basename(filePath));
      // Carrying a Drive link over to a new path is only for a Save As of a
      // file the author had open - never a way to point it at another file.
      if (typeof req.fromPath === 'string' && allowed(req.fromPath)) remapPath(getUserData(), req.fromPath, filePath, name);
      if (!fs.existsSync(filePath)) return { ok: true, skipped: true };
      const cfg = oauth.loadClientConfig();
      const store = oauth.readStore(getUserData());
      if (!cfg || !store) return { ok: true, skipped: true };
      const maps = readMap(getUserData());
      const key = normPath(filePath);
      const fileId = maps[key] && maps[key].fileId;
      if (!fileId) return { ok: true, skipped: true };
      const token = await tokenFor(cfg, store);
      let existing = null;
      try {
        existing = await drive.getFile(token, fileId);
      } catch (err) {
        if (err.status === 404) {
          delete maps[key];
          writeMap(getUserData(), maps);
          return { ok: true, skipped: true };
        }
        throw err;
      }
      if (!existing || existing.trashed) {
        delete maps[key];
        writeMap(getUserData(), maps);
        return { ok: true, skipped: true };
      }
      const buf = await fs.promises.readFile(filePath);
      const mime = drive.mimeOf(filePath);
      await drive.updateFile(token, fileId, { name, mime, buf });
      maps[key] = { fileId, name, path: filePath };
      writeMap(getUserData(), maps);
      return { ok: true, pushed: true };
    } catch (err) {
      return failure(err);
    }
  });
}

module.exports = { attach, normPath, pathForFileId, safeFileName };
