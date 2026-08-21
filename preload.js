const { contextBridge, ipcRenderer, webUtils } = require('electron');

function on(channel, cb) {
  const listener = (_e, ...args) => cb(...args);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('margo', {
  pickOpen: () => ipcRenderer.invoke('dialog:open'),
  openPath: (p) => ipcRenderer.invoke('file:open', p),
  peekPath: (p) => ipcRenderer.invoke('file:peek', p),
  readBinary: (p) => ipcRenderer.invoke('file:read-binary', p),
  save: (req) => ipcRenderer.invoke('file:save', req),
  saveAs: (req) => ipcRenderer.invoke('file:save-as', req),
  saveImage: (req) => ipcRenderer.invoke('image:save-as', req),
  exportImagesFolder: (req) => ipcRenderer.invoke('images:export-folder', req),
  exportPdf: (req) => ipcRenderer.invoke('export:pdf', req),
  print: (req) => ipcRenderer.invoke('print:document', req),
  quit: () => ipcRenderer.invoke('app:quit'),
  version: () => ipcRenderer.invoke('app:version'),
  setThumb: (p, dataUrl) => ipcRenderer.invoke('thumbs:set', { path: p, dataUrl }),
  renderHtmlThumb: (req) => ipcRenderer.invoke('thumbs:render-html', req),
  readDocxThumb: (p) => ipcRenderer.invoke('file:docx-thumb', p),

  recents: {
    list: () => ipcRenderer.invoke('recents:list'),
    clear: () => ipcRenderer.invoke('recents:clear'),
    remove: (p) => ipcRenderer.invoke('recents:remove', p)
  },

  drafts: {
    put: (draft) => ipcRenderer.invoke('drafts:put', draft),
    list: () => ipcRenderer.invoke('drafts:list'),
    remove: (id) => ipcRenderer.invoke('drafts:remove', id),
    clear: () => ipcRenderer.invoke('drafts:clear')
  },

  theme: {
    get: () => ipcRenderer.invoke('theme:get'),
    set: (t) => ipcRenderer.invoke('theme:set', t)
  },

  firstRun: () => ipcRenderer.invoke('settings:first-run'),
  samplePath: () => ipcRenderer.invoke('app:sample-path'),
  isSmoke: () => process.env.MARGO_SMOKE === '1',

  setTitle: (t) => ipcRenderer.invoke('win:title', t),
  closeAck: (handled) => ipcRenderer.invoke('app:close-ack', handled),
  closeNow: () => ipcRenderer.invoke('app:close-now'),
  openExternal: (url) => ipcRenderer.invoke('shell:open-external', url),

  pathForFile: (file) => {
    try { return webUtils.getPathForFile(file); } catch { return null; }
  },

  updates: {
    status: () => ipcRenderer.invoke('updates:status'),
    check: () => ipcRenderer.invoke('updates:check'),
    install: () => ipcRenderer.invoke('updates:install'),
    onStatus: (cb) => on('app:update-status', cb)
  },

  google: {
    status: () => ipcRenderer.invoke('google:status'),
    signIn: () => ipcRenderer.invoke('google:signIn'),
    signOut: () => ipcRenderer.invoke('google:signOut'),
    share: (req) => ipcRenderer.invoke('google:share', req),
    addPerson: (req) => ipcRenderer.invoke('google:addPerson', req),
    setRole: (req) => ipcRenderer.invoke('google:setRole', req),
    removePerson: (req) => ipcRenderer.invoke('google:removePerson', req),
    copyLink: (link) => ipcRenderer.invoke('google:copyLink', link),
    list: () => ipcRenderer.invoke('google:list'),
    openFromDrive: (req) => ipcRenderer.invoke('google:open', req),
    push: (req) => ipcRenderer.invoke('google:push', req)
  },

  onCloseRequest: (cb) => on('app:close-request', cb),
  onOpenFile: (cb) => on('app:open-file', cb),
  onSmokeRun: (cb) => on('smoke:run', cb),

  smoke: {
    capture: (fileName) => ipcRenderer.invoke('smoke:capture', fileName),
    report: (results) => ipcRenderer.invoke('smoke:report', results)
  }
});
