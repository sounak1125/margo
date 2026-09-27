const { app } = require('electron');
const path = require('path');
const fs = require('fs');

const MAX = 12;
const SMOKE = process.env.MARGO_SMOKE === '1';
/* Windows and (by default) macOS file systems ignore case, so "Notes.md" and
   "notes.md" are one file there. On Linux they are two different files, and
   folding case made opening one silently evict the other from the list. */
const CASE_INSENSITIVE = process.platform === 'win32' || process.platform === 'darwin';

function sameKey(p) {
  const r = path.resolve(String(p));
  return CASE_INSENSITIVE ? r.toLowerCase() : r;
}

function storePath() {
  return path.join(app.getPath('userData'), 'recents.json');
}

/* Entries without a usable path are dropped here rather than downstream: add()
   and remove() compare r.path while filtering, so a single malformed entry
   used to throw out of the file:open handler and report a document that had
   opened perfectly well as having failed to open. */
function readAll() {
  try {
    const arr = JSON.parse(fs.readFileSync(storePath(), 'utf8'));
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((r) => r && typeof r.path === 'string' && r.path && path.isAbsolute(r.path))
      .map((r) => ({
        path: r.path,
        name: typeof r.name === 'string' ? r.name : path.basename(r.path),
        ext: typeof r.ext === 'string' ? r.ext : path.extname(r.path).toLowerCase().replace('.', ''),
        kind: typeof r.kind === 'string' ? r.kind : 'md',
        ts: Number(r.ts) || 0
      }));
  } catch {
    return [];
  }
}

/* Sibling temp file + rename, so a crash mid-write cannot leave a truncated
   recents.json (which read back as an empty library). */
function writeAll(arr) {
  const file = storePath();
  const tmp = file + '.' + process.pid + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify(arr, null, 2));
    fs.renameSync(tmp, file);
  } catch {
    try { fs.unlinkSync(tmp); } catch {}
  }
}

function add(filePath, kind) {
  if (typeof filePath !== 'string' || !filePath || !path.isAbsolute(filePath)) return;
  const resolved = path.resolve(filePath);
  const entry = {
    path: resolved,
    name: path.basename(resolved),
    ext: path.extname(resolved).toLowerCase().replace('.', ''),
    kind: kind || 'md',
    ts: Date.now()
  };
  const key = sameKey(resolved);
  const rest = readAll().filter((r) => sameKey(r.path) !== key);
  writeAll([entry, ...rest].slice(0, MAX));
  // The OS's own recent list: Windows jump list, macOS dock / Open Recent,
  // GNOME recent files. Not from tests, which would fill the author's list.
  if (!SMOKE) {
    try { app.addRecentDocument(resolved); } catch {}
  }
}

function list() {
  return readAll().filter((r) => {
    try { return fs.existsSync(r.path); } catch { return true; }
  });
}

function remove(filePath) {
  if (typeof filePath !== 'string' || !filePath) return false;
  const key = sameKey(filePath);
  writeAll(readAll().filter((r) => sameKey(r.path) !== key));
  return true;
}

function clear() {
  writeAll([]);
  if (!SMOKE) {
    try { app.clearRecentDocuments(); } catch {}
  }
  return true;
}

module.exports = { add, list, remove, clear, readAll };
