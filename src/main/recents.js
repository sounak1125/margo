const { app } = require('electron');
const path = require('path');
const fs = require('fs');

const MAX = 12;

function storePath() {
  return path.join(app.getPath('userData'), 'recents.json');
}

function readAll() {
  try {
    const arr = JSON.parse(fs.readFileSync(storePath(), 'utf8'));
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function writeAll(arr) {
  try { fs.writeFileSync(storePath(), JSON.stringify(arr, null, 2)); } catch {}
}

function add(filePath, kind) {
  if (!filePath) return;
  const entry = {
    path: filePath,
    name: path.basename(filePath),
    ext: path.extname(filePath).toLowerCase().replace('.', ''),
    kind: kind || 'md',
    ts: Date.now()
  };
  const rest = readAll().filter((r) => r.path.toLowerCase() !== filePath.toLowerCase());
  writeAll([entry, ...rest].slice(0, MAX));
}

function list() {
  const arr = readAll().filter((r) => {
    try { return fs.existsSync(r.path); } catch { return false; }
  });
  writeAll(arr);
  return arr;
}

function remove(filePath) {
  writeAll(readAll().filter((r) => r.path.toLowerCase() !== String(filePath).toLowerCase()));
  return true;
}

function clear() {
  writeAll([]);
  return true;
}

module.exports = { add, list, remove, clear };
