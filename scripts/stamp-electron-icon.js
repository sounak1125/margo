/* Stamp unpackaged electron.exe with assets/icon.ico so the Windows taskbar
   does not keep Electron's (or a stale) icon during `npm start`. */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function stampElectronIcon() {
  if (process.platform !== 'win32') return { skipped: true, reason: 'not-win32' };

  const icoPath = path.join(__dirname, '..', 'assets', 'icon.ico');
  if (!fs.existsSync(icoPath)) return { skipped: true, reason: 'no-ico' };

  let exePath;
  try {
    exePath = require('electron');
  } catch (e) {
    return { error: e.message || String(e) };
  }
  if (!exePath || !fs.existsSync(exePath)) {
    return { skipped: true, reason: 'no-electron' };
  }

  const ico = fs.readFileSync(icoPath);
  const digest = crypto.createHash('sha256').update(ico).digest('hex');
  const stampPath = path.join(path.dirname(exePath), '.margo-icon-stamp');
  try {
    if (fs.readFileSync(stampPath, 'utf8').trim() === digest) {
      return { skipped: true, reason: 'up-to-date' };
    }
  } catch {}

  let ResEdit;
  try {
    ResEdit = require('resedit');
  } catch (e) {
    return { error: 'resedit not available: ' + (e.message || String(e)) };
  }

  try {
    const exe = ResEdit.NtExecutable.from(fs.readFileSync(exePath));
    const res = ResEdit.NtExecutableResource.from(exe);
    const iconFile = ResEdit.Data.IconFile.from(ico);
    const icons = iconFile.icons.map((item) => item.data);
    const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
    const langs = groups.length ? [...new Set(groups.map((g) => g.lang))] : [1033];
    const ids = groups.length ? [...new Set(groups.map((g) => g.id))] : [1];
    for (const lang of langs) {
      for (const id of ids) {
        ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, id, lang, icons);
      }
    }
    res.outputResource(exe);
    fs.writeFileSync(exePath, Buffer.from(exe.generate()));
    fs.writeFileSync(stampPath, digest);
    return { ok: true };
  } catch (e) {
    return { error: e.message || String(e) };
  }
}

if (require.main === module) {
  const r = stampElectronIcon();
  if (r.error) {
    console.warn('stamp-electron-icon:', r.error);
  } else if (r.ok) {
    console.log('stamped electron.exe with assets/icon.ico');
  }
}

module.exports = { stampElectronIcon };
