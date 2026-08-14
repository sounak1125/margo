/* Bake Desktop OAuth credentials into src/main/google-oauth.json before electron-builder.
   Env vars are used at pack time (GitHub Actions); the installed app reads the JSON, not CI env. */
const fs = require('fs');
const path = require('path');

const dest = path.join(__dirname, '..', 'src', 'main', 'google-oauth.json');
const envId = (process.env.MARGO_GOOGLE_CLIENT_ID || '').trim();
const envSecret = (process.env.MARGO_GOOGLE_CLIENT_SECRET || '').trim();

function realClientId(raw) {
  const src = (raw && (raw.installed || raw.web || raw)) || {};
  const id = String(src.client_id || '').trim();
  if (!id || id.includes('YOUR_CLIENT_ID')) return '';
  return id;
}

if (envId && envSecret) {
  fs.writeFileSync(
    dest,
    JSON.stringify({ client_id: envId, client_secret: envSecret }, null, 2) + '\n',
    'utf8'
  );
  console.log('Wrote src/main/google-oauth.json from MARGO_GOOGLE_CLIENT_*');
  process.exit(0);
}

try {
  const raw = JSON.parse(fs.readFileSync(dest, 'utf8'));
  if (realClientId(raw)) {
    console.log('Using existing src/main/google-oauth.json');
    process.exit(0);
  }
} catch {
  /* missing or invalid */
}

console.error(
  'Packaging Google OAuth: missing src/main/google-oauth.json and MARGO_GOOGLE_CLIENT_ID / MARGO_GOOGLE_CLIENT_SECRET.'
);
process.exit(1);
