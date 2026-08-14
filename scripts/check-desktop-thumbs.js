/* Verify desktop icon assets + DOCX thumbnail embed; optionally open a folder in Explorer. */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const files = require('../src/main/files');
const JSZip = require('jszip');

const root = path.join(__dirname, '..');
const kinds = ['md', 'doc', 'sheet', 'pdf'];

async function main() {
  const missing = kinds.filter((k) => !fs.existsSync(path.join(root, 'assets', 'file-icons', `${k}.ico`)));
  if (missing.length) {
    console.error('Missing file icons:', missing.join(', '), '— run npm run icons');
    process.exit(1);
  }
  console.log('OK file icons:', kinds.map((k) => `file-icons/${k}.ico`).join(', '));

  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const assocs = (pkg.build && pkg.build.fileAssociations) || [];
  if (assocs.length < 4) {
    console.error('fileAssociations incomplete in package.json');
    process.exit(1);
  }
  const badIcon = assocs.find((a) => a.icon && /\\assets\\|\.\/assets\//.test(a.icon));
  if (badIcon) {
    console.error('fileAssociation icon must be relative to buildResources (assets/), got:', badIcon.icon);
    process.exit(1);
  }
  if (!(pkg.build.nsis && pkg.build.nsis.perMachine)) {
    console.error('nsis.perMachine must be true for Windows file association icons');
    process.exit(1);
  }
  console.log('OK fileAssociations:', assocs.length, 'groups (perMachine)');

  const jpeg = Buffer.from(
    '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAGcP//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAQUCf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQMBAT8Bf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQIBAT8Bf//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEABj8Cf//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAT8hf//Z',
    'base64'
  );
  const base = await files.htmlToDocxBuffer('<p>Desktop thumb check</p>', 'Check');
  const out = await files.embedDocxThumbnail(base, jpeg, 'image/jpeg');
  const outDir = path.join(require('os').tmpdir(), 'margo-desktop-thumbs');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'preview-check.docx');
  fs.writeFileSync(outPath, out);

  const zip = await JSZip.loadAsync(out);
  if (!zip.file('docProps/thumbnail.jpeg')) {
    console.error('DOCX missing docProps/thumbnail.jpeg');
    process.exit(1);
  }
  console.log('OK DOCX thumbnail embedded at', outPath);

  if (process.argv.includes('--open') && process.platform === 'win32') {
    spawn('explorer.exe', [outDir], { detached: true, stdio: 'ignore' }).unref();
    console.log('Opened Explorer — use Large icons to inspect preview-check.docx');
  } else {
    console.log('Tip: node scripts/check-desktop-thumbs.js --open   # open folder in Explorer');
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
