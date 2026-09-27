const { app, ipcMain } = require('electron');

const START_DELAY_MS = 4000;
const NOTE_UNPACKAGED = 'Updates apply to the installed app only. Install Margo from a GitHub Release — npm start cannot auto-update.';
const NOTE_MANUAL = 'This build updates by hand: download the latest Margo from GitHub Releases.';

/* electron-updater can only replace what it installed: the Windows NSIS
   installer and the Linux AppImage. An unsigned macOS build, a .deb from the
   package manager or a portable copy would fail every check with an error the
   author can do nothing about, so those builds say how to update instead. */
function supportedHere() {
  if (process.platform === 'win32') return true;
  if (process.platform === 'linux') return !!process.env.APPIMAGE;
  return false;
}

function baseStatus(extra) {
  return Object.assign({
    state: 'idle',
    currentVersion: app.getVersion(),
    version: null,
    percent: null,
    error: null,
    message: null,
    packaged: app.isPackaged
  }, extra);
}

function attach({ getWindow }) {
  const enabled = app.isPackaged && process.env.MARGO_SMOKE !== '1' && supportedHere();
  const disabledNote = app.isPackaged ? NOTE_MANUAL : NOTE_UNPACKAGED;
  let lastStatus = baseStatus(enabled ? {} : {
    state: 'disabled',
    message: disabledNote
  });
  let autoUpdater = null;
  let installRequested = false;
  let checking = null;

  function send(extra) {
    lastStatus = baseStatus(Object.assign({}, lastStatus, extra, {
      currentVersion: app.getVersion(),
      packaged: app.isPackaged
    }));
    const win = getWindow();
    if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) {
      win.webContents.send('app:update-status', lastStatus);
    }
    return lastStatus;
  }

  ipcMain.handle('updates:status', () => lastStatus);

  /* One check at a time: a second click while the first is still talking to
     GitHub used to start a parallel download of the same update. A check
     while an update is downloading or already downloaded has nothing to add. */
  function check() {
    if (checking) return checking;
    if (lastStatus.state === 'downloading' || lastStatus.state === 'downloaded') return Promise.resolve(lastStatus);
    checking = (async () => {
      try {
        send({ state: 'checking', error: null, message: 'Checking for updates…' });
        await autoUpdater.checkForUpdates();
        return lastStatus;
      } catch (err) {
        return send({ state: 'error', error: friendlyError(err), message: friendlyError(err) });
      } finally {
        checking = null;
      }
    })();
    return checking;
  }

  ipcMain.handle('updates:check', async () => {
    if (!enabled || !autoUpdater) {
      return send({ state: 'disabled', message: disabledNote });
    }
    return check();
  });

  /* Installing used to force the window shut and call quitAndInstall
     straight away - past the "Save changes?" prompt, so anything unsaved was
     gone - and it did so even when nothing had been downloaded, leaving the
     window unable to veto a close for the rest of the session. Now it only
     acts on a downloaded update, and closes the window the normal way: the
     renderer asks about unsaved work, and once the window has really closed
     main calls takeInstallRequest() and the update installs and relaunches.
     If the author cancels the close, cancelInstall() drops the request. */
  ipcMain.handle('updates:install', () => {
    if (!enabled || !autoUpdater || lastStatus.state !== 'downloaded') return lastStatus;
    installRequested = true;
    const win = getWindow();
    if (win && !win.isDestroyed()) win.close();
    else takeInstallRequest();
    return lastStatus;
  });

  function takeInstallRequest() {
    if (!installRequested || !autoUpdater) return false;
    installRequested = false;
    try {
      autoUpdater.quitAndInstall(false, true);
      return true;
    } catch (err) {
      send({ state: 'error', error: friendlyError(err), message: friendlyError(err) });
      return false;
    }
  }

  function cancelInstall() {
    installRequested = false;
  }

  function start() {
    if (!enabled || !autoUpdater) return;
    if (started) return;
    started = true;
    const t = setTimeout(() => { check().catch(() => {}); }, START_DELAY_MS);
    if (t.unref) t.unref();
  }
  let started = false;

  const api = { start, takeInstallRequest, cancelInstall };
  if (!enabled) return api;

  autoUpdater = require('electron-updater').autoUpdater;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    send({ state: 'checking', error: null, message: 'Checking for updates…' });
  });
  autoUpdater.on('update-available', (info) => {
    const version = info && info.version ? info.version : null;
    send({
      state: 'available',
      version,
      error: null,
      message: version ? `Update ${version} available` : 'Update available'
    });
  });
  autoUpdater.on('update-not-available', (info) => {
    send({
      state: 'not-available',
      version: info && info.version ? info.version : app.getVersion(),
      error: null,
      message: 'Up to date'
    });
  });
  autoUpdater.on('download-progress', (p) => {
    const percent = Math.round((p && p.percent) || 0);
    send({
      state: 'downloading',
      percent,
      error: null,
      message: `Downloading ${percent}%`
    });
  });
  autoUpdater.on('update-downloaded', (info) => {
    const version = info && info.version ? info.version : null;
    send({
      state: 'downloaded',
      version,
      percent: 100,
      error: null,
      message: 'Ready to restart'
    });
  });
  autoUpdater.on('error', (err) => {
    const message = friendlyError(err);
    send({ state: 'error', error: message, message });
  });

  return api;
}

/* electron-updater errors carry whole HTTP responses and stack traces; the
   settings panel has one line. Offline is by far the most common case. */
function friendlyError(err) {
  const raw = (err && err.message) ? err.message : String(err || 'Update failed');
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ERR_INTERNET_DISCONNECTED|net::ERR_/i.test(raw)) {
    return 'Could not reach the update server. Check your connection and try again.';
  }
  if (/404|latest(-mac|-linux)?\.yml/i.test(raw)) {
    return 'No update information was found for this platform.';
  }
  const first = raw.split('\n')[0].trim();
  return first.length > 240 ? first.slice(0, 237) + '…' : first;
}

module.exports = { attach, friendlyError, supportedHere };
