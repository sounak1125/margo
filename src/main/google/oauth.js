const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { shell, safeStorage } = require('electron');
const { OAuth2Client } = require('google-auth-library');

const SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/drive.file'
];

const AUTH_TIMEOUT_MS = 180000;

function configPath() {
  return path.join(__dirname, '..', 'google-oauth.json');
}

function loadClientConfig() {
  const envId = (process.env.MARGO_GOOGLE_CLIENT_ID || '').trim();
  if (envId) {
    return {
      client_id: envId,
      client_secret: (process.env.MARGO_GOOGLE_CLIENT_SECRET || '').trim()
    };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(configPath(), 'utf8'));
    const src = raw.installed || raw.web || raw;
    const id = String(src.client_id || '').trim();
    if (!id || id.includes('YOUR_CLIENT_ID')) return null;
    return { client_id: id, client_secret: String(src.client_secret || '').trim() };
  } catch {
    return null;
  }
}

function pkce() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

function tokenFile(userData) {
  return path.join(userData, 'google-auth.bin');
}

function readStore(userData) {
  const f = tokenFile(userData);
  if (!fs.existsSync(f)) return null;
  try {
    const buf = fs.readFileSync(f);
    let json;
    if (safeStorage.isEncryptionAvailable()) {
      json = safeStorage.decryptString(buf);
    } else {
      json = buf.toString('utf8');
    }
    const data = JSON.parse(json);
    return data && data.refreshToken ? data : null;
  } catch {
    return null;
  }
}

function writeStore(userData, data) {
  const payload = JSON.stringify(data);
  const buf = safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(payload)
    : Buffer.from(payload, 'utf8');
  fs.writeFileSync(tokenFile(userData), buf);
}

function clearStore(userData) {
  try { fs.unlinkSync(tokenFile(userData)); } catch {}
}

function makeClient(cfg, redirectUri) {
  return new OAuth2Client({
    clientId: cfg.client_id,
    clientSecret: cfg.client_secret || undefined,
    redirectUri
  });
}

function sendPage(res, text) {
  const html = '<!doctype html><title>Margo</title><p>' +
    String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</p>';
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', Connection: 'close' });
  res.end(html);
}

function oauthErrorMessage(err) {
  const data = err && (err.response?.data || err.data);
  const desc = data && (data.error_description || data.error);
  const msg = (desc || (err && err.message) || String(err || 'Sign-in failed')).trim();
  if (/invalid_client|client secret is invalid/i.test(msg)) {
    return 'Google rejected the OAuth client secret. Reset the secret in Google Cloud Console, save the new value in src/main/google-oauth.json, then try again.';
  }
  return msg;
}

async function fetchUserinfo(accessToken) {
  const res = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { Authorization: 'Bearer ' + accessToken },
    signal: AbortSignal.timeout(8000)
  });
  if (!res.ok) throw new Error('Could not read Google profile.');
  return res.json();
}

async function pictureDataUrl(url) {
  if (!url) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(1200) });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const mime = (res.headers.get('content-type') || 'image/jpeg').split(';')[0];
    return 'data:' + mime + ';base64,' + buf.toString('base64');
  } catch {
    return null;
  }
}

async function signInWithBrowser(cfg) {
  const { verifier, challenge } = pkce();
  let client = null;
  let finishing = false;
  let settle;
  const done = new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { server.close(); } catch {}
      reject(new Error('Sign-in timed out. Try again.'));
    }, AUTH_TIMEOUT_MS);
    settle = (err, store) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      setTimeout(() => { try { server.close(); } catch {} }, 100);
      if (err) reject(err);
      else resolve(store);
    };
  });

  const server = http.createServer((req, res) => {
    void (async () => {
      try {
        const u = new URL(req.url || '/', 'http://127.0.0.1');
        if (u.pathname !== '/' && u.pathname !== '') {
          res.writeHead(404);
          res.end();
          return;
        }
        const code = u.searchParams.get('code');
        const err = u.searchParams.get('error');
        if (!code && !err) {
          res.writeHead(204);
          res.end();
          return;
        }
        if (err) {
          sendPage(res, 'Sign-in was cancelled. You can close this window.');
          settle(new Error('Sign-in was cancelled.'));
          return;
        }
        if (finishing || !client) {
          res.writeHead(204);
          res.end();
          return;
        }
        finishing = true;
        const { tokens } = await client.getToken({ code, codeVerifier: verifier });
        if (!tokens.refresh_token) {
          throw new Error('Google did not return a refresh token. Try signing in again.');
        }
        let info = {};
        try {
          info = await fetchUserinfo(tokens.access_token);
        } catch { /* tokens still usable without profile */ }
        const store = {
          refreshToken: tokens.refresh_token,
          email: info.email || '',
          name: info.name || info.email || '',
          pictureUrl: info.picture || '',
          folderId: null
        };
        try {
          sendPage(res, 'Signed in. You can close this window and return to Margo.');
        } catch {}
        settle(null, store);
      } catch (e) {
        const msg = oauthErrorMessage(e);
        try {
          sendPage(res, 'Sign-in failed: ' + msg + ' Close this window and return to Margo.');
        } catch {}
        settle(new Error(msg));
      }
    })();
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  const redirectUri = 'http://127.0.0.1:' + port + '/';
  client = makeClient(cfg, redirectUri);
  const url = client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
    code_challenge: challenge,
    code_challenge_method: 'S256'
  });
  await shell.openExternal(url);
  return done;
}

async function accessToken(cfg, store) {
  const client = makeClient(cfg, 'http://127.0.0.1');
  client.setCredentials({ refresh_token: store.refreshToken });
  const tok = await client.getAccessToken();
  const token = typeof tok === 'string' ? tok : (tok && tok.token);
  if (!token) throw new Error('Could not refresh Google access token.');
  return token;
}

module.exports = {
  loadClientConfig,
  readStore,
  writeStore,
  clearStore,
  signInWithBrowser,
  accessToken,
  pictureDataUrl
};
