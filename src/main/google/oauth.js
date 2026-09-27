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

/* The loopback server answers on a port any local program can find, so without
   this it would exchange whatever code arrived first. PKCE does not close that
   hole: it stops someone stealing our code, not someone feeding us theirs, and
   a code from the attacker's account would bind Margo to their Drive and push
   the author's documents there. RFC 8252 s8.9 asks for exactly this. */
function newState() {
  return crypto.randomBytes(32).toString('base64url');
}

function stateMatches(expected, got) {
  if (typeof got !== 'string' || got.length !== expected.length) return false;
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(got, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function tokenFile(userData) {
  return path.join(userData, 'google-auth.bin');
}

/* The store is encrypted with the OS keychain when there is one. A store
   written while there was none (a Linux session without a keyring) is plain
   JSON, and reading it once a keyring appears used to fail the decrypt and
   sign the author out; each form is recognised on its own now. */
function readStore(userData) {
  const f = tokenFile(userData);
  let buf;
  try { buf = fs.readFileSync(f); } catch { return null; }
  let json = null;
  const text = buf.toString('utf8');
  if (text.trimStart().startsWith('{')) {
    json = text;
  } else {
    try {
      if (safeStorage.isEncryptionAvailable()) json = safeStorage.decryptString(buf);
    } catch { json = null; }
  }
  if (!json) return null;
  try {
    const data = JSON.parse(json);
    return data && typeof data.refreshToken === 'string' && data.refreshToken ? data : null;
  } catch {
    return null;
  }
}

/* Owner-only and atomic: without a keychain the refresh token is stored in
   the clear, and it used to land world-readable (0644) - a long-lived key to
   the author's Drive for any other account on the machine. */
function writeStore(userData, data) {
  const payload = JSON.stringify(data);
  const buf = safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(payload)
    : Buffer.from(payload, 'utf8');
  const dest = tokenFile(userData);
  const tmp = dest + '.' + process.pid + '.tmp';
  try {
    fs.writeFileSync(tmp, buf, { mode: 0o600 });
    fs.renameSync(tmp, dest);
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch {}
    throw err;
  }
  try { fs.chmodSync(dest, 0o600); } catch {}
}

function clearStore(userData) {
  forgetTokenClient();
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

/* The consent page Margo is waiting on, so pressing Sign in again while one
   is open brings that page back instead of doing nothing for three minutes. */
let pendingAuthUrl = null;
let cancelPending = null;

function reopenPendingSignIn() {
  if (!pendingAuthUrl) return false;
  shell.openExternal(pendingAuthUrl).catch(() => {});
  return true;
}

function cancelSignIn() {
  if (cancelPending) cancelPending();
}

/* server.close() only stops new connections; a browser holding a keep-alive
   connection open kept the loopback port - and this process - listening
   until it gave up on its own. */
function shutdown(server) {
  try { server.close(); } catch {}
  try { if (typeof server.closeAllConnections === 'function') server.closeAllConnections(); } catch {}
}

async function signInWithBrowser(cfg) {
  const { verifier, challenge } = pkce();
  const state = newState();
  let client = null;
  let finishing = false;
  let settle;
  const done = new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      pendingAuthUrl = null;
      cancelPending = null;
      shutdown(server);
      reject(new Error('Sign-in timed out. Try again.'));
    }, AUTH_TIMEOUT_MS);
    settle = (err, store) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      pendingAuthUrl = null;
      cancelPending = null;
      // Let the "you can close this window" page finish sending first.
      setTimeout(() => shutdown(server), 100);
      if (err) reject(err);
      else resolve(store);
    };
  });
  // A rejection nobody awaits yet (the browser failed to open, say) must not
  // surface as an unhandled rejection; callers still get it from `done`.
  done.catch(() => {});

  const server = http.createServer((req, res) => {
    void (async () => {
      try {
        const u = new URL(req.url || '/', 'http://127.0.0.1');
        if (u.pathname !== '/' && u.pathname !== '') {
          res.writeHead(404, { Connection: 'close' });
          res.end();
          return;
        }
        if (req.method !== 'GET') {
          res.writeHead(405, { Connection: 'close' });
          res.end();
          return;
        }
        const code = u.searchParams.get('code');
        const err = u.searchParams.get('error');
        if (!code && !err) {
          res.writeHead(204, { Connection: 'close' });
          res.end();
          return;
        }
        /* Anything not carrying our own state is not the redirect we sent the
           author to. Answer it blandly and keep waiting for the real one, so a
           stray or planted request cannot finish or cancel this sign-in. */
        if (!stateMatches(state, u.searchParams.get('state'))) {
          sendPage(res, 'This sign-in link did not come from Margo. You can close this window.');
          return;
        }
        if (err) {
          sendPage(res, 'Sign-in was cancelled. You can close this window.');
          settle(new Error('Sign-in was cancelled.'));
          return;
        }
        if (finishing || !client) {
          res.writeHead(204, { Connection: 'close' });
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

  // Slow or idle connections cannot pin the server open.
  server.headersTimeout = 15000;
  server.requestTimeout = 15000;
  server.keepAliveTimeout = 1000;

  await new Promise((resolve, reject) => {
    server.once('error', (e) => {
      settle(e);
      reject(e);
    });
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  const redirectUri = 'http://127.0.0.1:' + port + '/';
  client = makeClient(cfg, redirectUri);
  const url = client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256'
  });
  pendingAuthUrl = url;
  cancelPending = () => settle(new Error('Sign-in was cancelled.'));
  try {
    await shell.openExternal(url);
  } catch (e) {
    // No browser could be opened: stop listening now rather than holding the
    // port (and the sign-in lock) for the full timeout.
    settle(new Error('Could not open your web browser to sign in.'));
  }
  return done;
}

/* google-auth-library hands back the access token it already holds until that
   token expires, but only from the same client - and a fresh one was built for
   every call, so every save, every Drive push and every listing spent a
   round trip to Google refreshing a token that was still perfectly good. The
   client is kept and reused; a different account or client id builds a new
   one, so signing out and back in cannot reuse the old credentials. */
let tokenClient = null;
let tokenClientKey = '';

function clientFor(cfg, store) {
  const key = cfg.client_id + '::' + store.refreshToken;
  if (!tokenClient || tokenClientKey !== key) {
    tokenClient = makeClient(cfg, 'http://127.0.0.1');
    tokenClient.setCredentials({ refresh_token: store.refreshToken });
    tokenClientKey = key;
  }
  return tokenClient;
}

function forgetTokenClient() {
  tokenClient = null;
  tokenClientKey = '';
}

/* A refresh token the author revoked (or Google expired - Testing-mode
   consent screens expire them after 7 days) fails every call with a bare
   "invalid_grant", while Margo kept showing them signed in. That is reported
   as its own error so the caller can sign the author out and say why. */
class SignInExpiredError extends Error {
  constructor() {
    super('Your Google sign-in has expired or was revoked. Sign in with Google again.');
    this.code = 'SIGNIN_EXPIRED';
  }
}

async function accessToken(cfg, store) {
  let tok;
  try {
    tok = await clientFor(cfg, store).getAccessToken();
  } catch (err) {
    const data = err && (err.response?.data || err.data);
    const code = (data && data.error) || (err && err.message) || '';
    if (/invalid_grant/i.test(String(code))) {
      forgetTokenClient();
      throw new SignInExpiredError();
    }
    throw new Error(oauthErrorMessage(err));
  }
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
  reopenPendingSignIn,
  cancelSignIn,
  accessToken,
  stateMatches,
  SignInExpiredError,
  pictureDataUrl
};
