/* Which files the renderer may read or write.

   Every file IPC used to take whatever path the renderer sent, so anything
   that ever ran script in the window - a crafted document slipping past the
   sanitizer, a compromised dependency - could read ~/.ssh, upload it to Drive,
   or overwrite any file the user can write. The renderer never needs that:
   every path it legitimately handles came from the author, through one of

     - an Open / Save As / Export dialog (main grants the chosen path),
     - the command line, a second launch, or macOS open-file (main grants it),
     - a drag and drop (preload grants the path of the real File object),
     - the recents list or crash-recovery drafts (granted when first used),
     - a Google Drive download Margo itself wrote,
     - the bundled welcome sample.

   So main keeps the set of paths the author has handed Margo, and every file
   IPC checks against it. Grants persist (capped, most recent first) so a
   document reopened from the library or a restored session in a later launch
   keeps working. The smoke suite additionally grants its own scratch folders. */
const path = require('path');
const fs = require('fs');

const MAX_KNOWN = 2000;
const CASE_INSENSITIVE = process.platform === 'win32' || process.platform === 'darwin';

let storeFile = null;
let known = null; // Map<key, resolvedPath>, oldest first
const session = new Map();
const dirs = [];
const extraSources = [];
let saveTimer = null;

function key(p) {
  return CASE_INSENSITIVE ? p.toLowerCase() : p;
}

/* Returns the absolute, normalized form of a renderer-supplied path, or null
   when it is not a usable local path at all. */
function normalize(p) {
  if (typeof p !== 'string') return null;
  if (!p || p.length > 4096 || p.includes('\0')) return null;
  if (!path.isAbsolute(p)) return null;
  // UNC / device namespaces (\\?\, \\.\) are never something a dialog hands back.
  if (process.platform === 'win32' && /^\\\\[?.]\\/.test(p)) return null;
  return path.resolve(p);
}

function load() {
  if (known) return known;
  known = new Map();
  if (!storeFile) return known;
  try {
    const arr = JSON.parse(fs.readFileSync(storeFile, 'utf8'));
    if (Array.isArray(arr)) {
      for (const raw of arr.slice(-MAX_KNOWN)) {
        const p = normalize(raw);
        if (p) known.set(key(p), p);
      }
    }
  } catch {}
  return known;
}

function persistSoon() {
  if (!storeFile) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 500);
  if (saveTimer.unref) saveTimer.unref();
}

function flush() {
  clearTimeout(saveTimer);
  saveTimer = null;
  if (!storeFile || !known) return;
  const tmp = storeFile + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify([...known.values()]), { mode: 0o600 });
    fs.renameSync(tmp, storeFile);
  } catch {
    try { fs.unlinkSync(tmp); } catch {}
  }
}

/* `file` is where grants persist between launches; `sources` are extra
   lists (recents, drafts) consulted lazily so entries written by older
   versions keep working. */
function init({ file, sources } = {}) {
  storeFile = file || null;
  known = null;
  if (Array.isArray(sources)) extraSources.push(...sources);
}

function grant(p, { persist = true } = {}) {
  const n = normalize(p);
  if (!n) return null;
  const k = key(n);
  session.set(k, n);
  if (persist) {
    const m = load();
    m.delete(k);
    m.set(k, n);
    while (m.size > MAX_KNOWN) m.delete(m.keys().next().value);
    persistSoon();
  }
  return n;
}

function grantDir(dir) {
  const n = normalize(dir);
  if (n) dirs.push(key(n.endsWith(path.sep) ? n : n + path.sep));
  return n;
}

function revoke(p) {
  const n = normalize(p);
  if (!n) return;
  const k = key(n);
  session.delete(k);
  if (load().delete(k)) persistSoon();
}

function inGrantedDir(k) {
  return dirs.some((d) => k.startsWith(d));
}

function fromSources(k) {
  for (const src of extraSources) {
    let list = [];
    try { list = src() || []; } catch { continue; }
    for (const raw of list) {
      const n = normalize(raw);
      if (n && key(n) === k) return true;
    }
  }
  return false;
}

function isAllowed(p) {
  const n = normalize(p);
  if (!n) return false;
  const k = key(n);
  if (session.has(k) || load().has(k) || inGrantedDir(k)) return true;
  if (fromSources(k)) {
    session.set(k, n);
    return true;
  }
  return false;
}

/* The one call every file IPC makes: the resolved path, or a thrown error the
   handler reports like any other failure. */
function check(p, what = 'open') {
  const n = normalize(p);
  if (!n) throw new Error('That is not a valid file path.');
  if (!isAllowed(n)) {
    throw new Error(`Margo can only ${what} files you chose. Use File → Open to pick it.`);
  }
  return n;
}

/* Whether any path the author handed Margo lives on this UNC host
   (\\host\share\...). Only Windows paths can; elsewhere this is always false. */
function grantedHost(host) {
  const prefix = '\\\\' + String(host).toLowerCase() + '\\';
  const on = (k) => k.toLowerCase().startsWith(prefix);
  for (const k of session.keys()) if (on(k)) return true;
  for (const k of load().keys()) if (on(k)) return true;
  return dirs.some(on);
}

/* Whether Chromium may load a file: URL (main applies this to every request
   any Margo window makes). On Windows a file: URL that names a host -
   file://host/share/x, or file:////host/..., or either spelled with
   backslashes or %5C - is a UNC path, and merely loading one makes Windows
   sign in to that host over SMB or WebDAV with the author's credentials,
   handing their NTLM hash to whoever runs it. A document asks for one with
   nothing more than <img src="\\host\x.png">: sanitizers keep it as a
   relative URL, it resolves against the page to file://host/x.png, and the
   page's CSP 'self' lets it through. So a remote host is only reachable when
   the author opened a file on it themselves - a note on a network share still
   shows the pictures next to it. */
function fileUrlAllowed(url) {
  let u;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol !== 'file:') return true;
  let p = u.pathname;
  try { p = decodeURIComponent(p); } catch {}
  p = p.replace(/\\/g, '/');
  let host = u.hostname && u.hostname.toLowerCase() !== 'localhost' ? u.hostname : '';
  if (!host) {
    const m = /^\/{2,}([^/]*)/.exec(p);
    if (m) host = m[1] || '.';
  }
  if (host) return grantedHost(host);
  // \??\UNC\host\... is the NT spelling of a UNC path; no Windows file name has a '?'.
  if (process.platform === 'win32' && p.includes('?')) return false;
  return true;
}

module.exports = { init, grant, grantDir, revoke, isAllowed, check, normalize, flush, fileUrlAllowed };
