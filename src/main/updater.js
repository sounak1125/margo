const { app, ipcMain } = require('electron');

const START_DELAY_MS = 4000;
const NOTE_UNPACKAGED = 'Updates apply to the installed app only. Use the Windows installer from a GitHub Release — npm start cannot auto-update.';

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

function attach({ getWindow, allowClose }) {
  const enabled = app.isPackaged && process.env.MARGO_SMOKE !== '1';
  let lastStatus = baseStatus(enabled ? {} : {
    state: 'disabled',
    message: NOTE_UNPACKAGED
  });
  let autoUpdater = null;

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

  ipcMain.handle('updates:check', async () => {
    if (!enabled || !autoUpdater) {
      return send({ state: 'disabled', message: NOTE_UNPACKAGED });
    }
    try {
      send({ state: 'checking', error: null, message: 'Checking for updates…' });
      await autoUpdater.checkForUpdates();
      return lastStatus;
    } catch (err) {
      const message = (err && err.message) ? err.message : String(err);
      return send({ state: 'error', error: message, message });
    }
  });

  ipcMain.handle('updates:install', () => {
    if (!enabled || !autoUpdater) return lastStatus;
    if (allowClose) allowClose();
    autoUpdater.quitAndInstall(false, true);
    return lastStatus;
  });

  function start() {
    if (!enabled || !autoUpdater) return;
    setTimeout(() => {
      if (!app.isPackaged) return;
      autoUpdater.checkForUpdates().catch(() => {});
    }, START_DELAY_MS);
  }

  if (!enabled) return { start };

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
    const message = (err && err.message) ? err.message : String(err);
    send({ state: 'error', error: message, message });
  });

  return { start };
}

module.exports = { attach };
