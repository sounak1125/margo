const crypto = require('crypto');
const path = require('path');

const DRIVE = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const MAX_OPEN_BYTES = 500 * 1024 * 1024;
const OPEN_EXTS = ['.md', '.markdown', '.txt', '.docx', '.xlsx', '.csv', '.pdf'];

function mimeOf(filePath) {
  const ext = path.extname(filePath || '').toLowerCase();
  if (ext === '.md' || ext === '.markdown') return 'text/markdown';
  if (ext === '.txt') return 'text/plain';
  if (ext === '.docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (ext === '.xlsx') return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (ext === '.csv') return 'text/csv';
  if (ext === '.pdf') return 'application/pdf';
  return 'application/octet-stream';
}

function isOpenableName(name) {
  return OPEN_EXTS.includes(path.extname(name || '').toLowerCase());
}

function roleLabel(role) {
  if (role === 'owner') return 'Owner';
  if (role === 'writer') return 'Editor';
  if (role === 'commenter') return 'Commenter';
  if (role === 'reader') return 'Viewer';
  return role || 'Viewer';
}

function apiRole(ui) {
  const r = String(ui || '').toLowerCase();
  if (r === 'editor' || r === 'writer') return 'writer';
  if (r === 'commenter') return 'commenter';
  return 'reader';
}

async function driveFetch(token, url, opts) {
  const headers = Object.assign({ Authorization: 'Bearer ' + token }, (opts && opts.headers) || {});
  const res = await fetch(url, Object.assign({}, opts, { headers }));
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  if (!res.ok) {
    const msg = (json && json.error && json.error.message) || text || ('HTTP ' + res.status);
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return json;
}

async function driveDownload(token, url) {
  const res = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
  if (!res.ok) {
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = null; }
    const msg = (json && json.error && json.error.message) || text || ('HTTP ' + res.status);
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  const len = Number(res.headers.get('content-length') || 0);
  if (len > MAX_OPEN_BYTES) throw new Error('File is larger than 500 MB — too big for Margo.');
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_OPEN_BYTES) throw new Error('File is larger than 500 MB — too big for Margo.');
  return buf;
}

function multipart(meta, buf, mime) {
  const boundary = 'margo_' + crypto.randomBytes(8).toString('hex');
  const head = Buffer.from(
    '--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' +
    JSON.stringify(meta) + '\r\n--' + boundary + '\r\nContent-Type: ' + mime + '\r\n\r\n'
  );
  const tail = Buffer.from('\r\n--' + boundary + '--');
  return {
    body: Buffer.concat([head, buf, tail]),
    contentType: 'multipart/related; boundary=' + boundary
  };
}

async function ensureFolder(token, existingId) {
  if (existingId) {
    try {
      const f = await driveFetch(token, DRIVE + '/files/' + encodeURIComponent(existingId) + '?fields=id,trashed');
      if (f && f.id && !f.trashed) return f.id;
    } catch {}
  }
  const q = encodeURIComponent("name='Margo' and mimeType='application/vnd.google-apps.folder' and trashed=false");
  const listed = await driveFetch(token, DRIVE + '/files?q=' + q + '&fields=files(id,name)&pageSize=5');
  if (listed.files && listed.files[0]) return listed.files[0].id;
  const created = await driveFetch(token, DRIVE + '/files?fields=id', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Margo', mimeType: 'application/vnd.google-apps.folder' })
  });
  return created.id;
}

async function getFile(token, fileId) {
  return driveFetch(
    token,
    DRIVE + '/files/' + encodeURIComponent(fileId) + '?fields=id,name,webViewLink,trashed'
  );
}

async function listFolder(token, folderId) {
  const q = encodeURIComponent("'" + folderId + "' in parents and trashed=false");
  const json = await driveFetch(
    token,
    DRIVE + '/files?q=' + q + '&fields=files(id,name,mimeType,modifiedTime,size)&pageSize=100&orderBy=modifiedTime desc'
  );
  return json.files || [];
}

async function downloadFile(token, fileId) {
  return driveDownload(token, DRIVE + '/files/' + encodeURIComponent(fileId) + '?alt=media');
}

async function createFile(token, { name, mime, buf, folderId }) {
  const pack = multipart({ name, mimeType: mime, parents: folderId ? [folderId] : undefined }, buf, mime);
  return driveFetch(token, UPLOAD + '/files?uploadType=multipart&fields=id,name,webViewLink', {
    method: 'POST',
    headers: { 'Content-Type': pack.contentType },
    body: pack.body
  });
}

async function updateFile(token, fileId, { name, mime, buf }) {
  const pack = multipart({ name, mimeType: mime }, buf, mime);
  return driveFetch(
    token,
    UPLOAD + '/files/' + encodeURIComponent(fileId) + '?uploadType=multipart&fields=id,name,webViewLink',
    {
      method: 'PATCH',
      headers: { 'Content-Type': pack.contentType },
      body: pack.body
    }
  );
}

function mapPermission(p) {
  return {
    id: p.id,
    email: p.emailAddress || '',
    displayName: p.displayName || p.emailAddress || 'Person',
    role: p.role,
    roleLabel: roleLabel(p.role),
    isOwner: p.role === 'owner'
  };
}

async function listPermissions(token, fileId) {
  const json = await driveFetch(
    token,
    DRIVE + '/files/' + encodeURIComponent(fileId) +
      '/permissions?fields=permissions(id,type,role,emailAddress,displayName)&pageSize=100'
  );
  return (json.permissions || []).map(mapPermission);
}

async function addPermission(token, fileId, email, role) {
  const api = apiRole(role);
  try {
    const created = await driveFetch(
      token,
      DRIVE + '/files/' + encodeURIComponent(fileId) +
        '/permissions?sendNotificationEmail=true&fields=id,type,role,emailAddress,displayName',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'user', role: api, emailAddress: email })
      }
    );
    return mapPermission(created);
  } catch (err) {
    if (err.status !== 409) throw err;
    const people = await listPermissions(token, fileId);
    const existing = people.find((p) => p.email.toLowerCase() === email.toLowerCase());
    if (!existing) throw err;
    return setPermissionRole(token, fileId, existing.id, api);
  }
}

async function setPermissionRole(token, fileId, permissionId, role) {
  const api = apiRole(role);
  const updated = await driveFetch(
    token,
    DRIVE + '/files/' + encodeURIComponent(fileId) + '/permissions/' + encodeURIComponent(permissionId) +
      '?fields=id,type,role,emailAddress,displayName',
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: api })
    }
  );
  return mapPermission(updated);
}

async function removePermission(token, fileId, permissionId) {
  await driveFetch(
    token,
    DRIVE + '/files/' + encodeURIComponent(fileId) + '/permissions/' + encodeURIComponent(permissionId),
    { method: 'DELETE' }
  );
  return true;
}

module.exports = {
  mimeOf,
  isOpenableName,
  apiRole,
  ensureFolder,
  getFile,
  listFolder,
  downloadFile,
  createFile,
  updateFile,
  listPermissions,
  addPermission,
  setPermissionRole,
  removePermission
};
