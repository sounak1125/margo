/* Notices when an open document is changed on disk by another program.

   Watching the file itself does not survive the way most editors save -
   write a temp file, rename it over the original - because the watch follows
   the old inode, which is gone after the first save. Margo does the same
   thing itself (files.atomicWrite). So the watch is on the folder, filtered
   to the names of the open files, and every event is confirmed against the
   file's stat signature: an event only counts when the file really differs
   from what Margo last read or wrote. That also makes Margo's own saves
   silent - the caller brackets them with beginOwnWrite / endOwnWrite, which
   records the new signature once the write lands.

   fs.watch is not available everywhere (some network shares, exotic
   filesystems); those files fall back to fs.watchFile polling. */
const fs = require('fs');
const path = require('path');

const CASE_INSENSITIVE = process.platform === 'win32' || process.platform === 'darwin';
const norm = (p) => (CASE_INSENSITIVE ? p.toLowerCase() : p);

function signature(p) {
  try {
    const st = fs.statSync(p);
    if (!st.isFile()) return 'missing';
    return `${st.mtimeMs}:${st.size}:${st.ino}`;
  } catch {
    return 'missing';
  }
}

function createWatcher({ onChange, debounceMs = 250, pollMs = 2000 } = {}) {
  const files = new Map(); // key -> { path, sig, own, timer, poll }
  const dirWatchers = new Map(); // dirKey -> { watcher, count }

  function emit(entry) {
    const sig = signature(entry.path);
    if (sig === entry.sig) return;
    const wasMissing = entry.sig === 'missing';
    entry.sig = sig;
    if (sig === 'missing') {
      onChange && onChange({ path: entry.path, kind: 'deleted' });
    } else {
      onChange && onChange({ path: entry.path, kind: wasMissing ? 'created' : 'changed' });
    }
  }

  function schedule(entry) {
    if (entry.own > 0) { entry.pending = true; return; }
    clearTimeout(entry.timer);
    entry.timer = setTimeout(() => {
      entry.timer = null;
      if (entry.own > 0) { entry.pending = true; return; }
      emit(entry);
    }, debounceMs);
    if (entry.timer.unref) entry.timer.unref();
  }

  function startPolling(entry) {
    if (entry.poll) return;
    entry.poll = () => schedule(entry);
    fs.watchFile(entry.path, { interval: pollMs, persistent: false }, entry.poll);
  }

  function stopPolling(entry) {
    if (!entry.poll) return;
    fs.unwatchFile(entry.path, entry.poll);
    entry.poll = null;
  }

  function onDirEvent(dirKey, _event, filename) {
    for (const entry of files.values()) {
      if (entry.dirKey !== dirKey) continue;
      if (filename && norm(String(filename)) !== norm(path.basename(entry.path))) continue;
      schedule(entry);
    }
  }

  function attachDir(entry) {
    const dir = path.dirname(entry.path);
    const dirKey = norm(dir);
    entry.dirKey = dirKey;
    const existing = dirWatchers.get(dirKey);
    if (existing) {
      existing.count += 1;
      return true;
    }
    try {
      const watcher = fs.watch(dir, { persistent: false }, (ev, name) => onDirEvent(dirKey, ev, name));
      watcher.on('error', () => {
        // The folder went away or the watch broke: keep an eye on each file by
        // polling instead, and let the next check report what happened.
        try { watcher.close(); } catch {}
        dirWatchers.delete(dirKey);
        for (const e of files.values()) {
          if (e.dirKey === dirKey) { e.dirKey = null; startPolling(e); schedule(e); }
        }
      });
      dirWatchers.set(dirKey, { watcher, count: 1 });
      return true;
    } catch {
      entry.dirKey = null;
      return false;
    }
  }

  function detachDir(entry) {
    const w = entry.dirKey && dirWatchers.get(entry.dirKey);
    entry.dirKey = null;
    if (!w) return;
    w.count -= 1;
    if (w.count <= 0) {
      try { w.watcher.close(); } catch {}
      for (const [k, v] of dirWatchers) if (v === w) dirWatchers.delete(k);
    }
  }

  function watch(p) {
    if (typeof p !== 'string' || !path.isAbsolute(p)) return false;
    const k = norm(path.resolve(p));
    const existing = files.get(k);
    if (existing) {
      // Watching is idempotent; a repeat (the file was reopened) just takes
      // what is on disk now as the new baseline.
      existing.sig = signature(existing.path);
      return true;
    }
    const entry = { path: path.resolve(p), sig: signature(p), own: 0, pending: false, timer: null, poll: null, dirKey: null };
    files.set(k, entry);
    if (!attachDir(entry)) startPolling(entry);
    return true;
  }

  function unwatch(p) {
    if (typeof p !== 'string') return false;
    const k = norm(path.resolve(p));
    const entry = files.get(k);
    if (!entry) return false;
    clearTimeout(entry.timer);
    stopPolling(entry);
    detachDir(entry);
    files.delete(k);
    return true;
  }

  function entryFor(p) {
    if (typeof p !== 'string') return null;
    return files.get(norm(path.resolve(p))) || null;
  }

  function beginOwnWrite(p) {
    const e = entryFor(p);
    if (e) e.own += 1;
  }

  /* Margo just wrote the file (or tried to): whatever is on disk now is what
     the author has open, so it becomes the baseline and nothing is reported. */
  function endOwnWrite(p) {
    const e = entryFor(p);
    if (!e) return;
    e.own = Math.max(0, e.own - 1);
    if (e.own === 0) {
      e.sig = signature(e.path);
      e.pending = false;
    }
  }

  /* Re-reads the baseline (after the renderer reloaded the file itself). */
  function refresh(p) {
    const e = entryFor(p);
    if (e) e.sig = signature(e.path);
  }

  function isWatching(p) {
    return !!entryFor(p);
  }

  function closeAll() {
    for (const e of files.values()) { clearTimeout(e.timer); stopPolling(e); }
    files.clear();
    for (const w of dirWatchers.values()) { try { w.watcher.close(); } catch {} }
    dirWatchers.clear();
  }

  return { watch, unwatch, beginOwnWrite, endOwnWrite, refresh, isWatching, closeAll };
}

module.exports = { createWatcher, signature };
