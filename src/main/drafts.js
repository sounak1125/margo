const { app } = require('electron');
const path = require('path');
const fs = require('fs');

const MAX_BYTES = 25 * 1024 * 1024;
const KINDS = new Set(['md', 'doc', 'sheet', 'pdf']);
const ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;

function draftsDir() {
  return path.join(app.getPath('userData'), 'drafts');
}

function ensureDir() {
  const dir = draftsDir();
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function fileFor(id) {
  if (!ID_RE.test(id)) return null;
  return path.join(ensureDir(), id + '.json');
}

function put(raw) {
  try {
    if (!raw || !ID_RE.test(raw.id) || !KINDS.has(raw.kind) || !raw.data || typeof raw.data !== 'object') {
      return { ok: false, error: 'Invalid draft' };
    }
    const draft = {
      id: raw.id,
      kind: raw.kind,
      name: String(raw.name || 'Untitled').slice(0, 240),
      path: raw.path ? String(raw.path) : null,
      updatedAt: Number(raw.updatedAt) || Date.now(),
      data: raw.data
    };
    const json = JSON.stringify(draft);
    if (Buffer.byteLength(json, 'utf8') > MAX_BYTES) {
      return { ok: false, error: 'Draft too large' };
    }
    const dest = fileFor(draft.id);
    const tmp = dest + '.tmp';
    fs.writeFileSync(tmp, json);
    try { fs.unlinkSync(dest); } catch {}
    fs.renameSync(tmp, dest);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
}

function list() {
  let names = [];
  try { names = fs.readdirSync(ensureDir()); } catch { return []; }
  const out = [];
  for (const name of names) {
    if (!name.endsWith('.json') || name.endsWith('.tmp.json')) continue;
    const fp = path.join(draftsDir(), name);
    try {
      const draft = JSON.parse(fs.readFileSync(fp, 'utf8'));
      if (!draft || !ID_RE.test(draft.id) || !KINDS.has(draft.kind) || !draft.data || typeof draft.data !== 'object') continue;
      out.push(draft);
    } catch {}
  }
  out.sort((a, b) => (a.updatedAt || 0) - (b.updatedAt || 0));
  return out;
}

function remove(id) {
  const fp = fileFor(id);
  if (!fp) return false;
  try { fs.unlinkSync(fp); } catch {}
  try { fs.unlinkSync(fp + '.tmp'); } catch {}
  return true;
}

function clear() {
  let names = [];
  try { names = fs.readdirSync(ensureDir()); } catch { return true; }
  for (const name of names) {
    try { fs.unlinkSync(path.join(draftsDir(), name)); } catch {}
  }
  return true;
}

module.exports = { put, list, remove, clear };
