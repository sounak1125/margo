/* Build app icons + per-type Explorer file icons from SVG (or AI master PNG). */
const fs = require('fs');
const path = require('path');
const { Resvg } = require('@resvg/resvg-js');
const pngToIco = require('png-to-ico');
const sharp = require('sharp');

const assets = path.join(__dirname, '..', 'assets');
const fileIconsDir = path.join(assets, 'file-icons');
const appSvg = fs.readFileSync(path.join(assets, 'icon.svg'), 'utf8');
const appAiPng = path.join(assets, 'icon-ai.png');

function renderSvgPng(svg, size) {
  const r = new Resvg(svg, { fitTo: { mode: 'width', value: size } });
  return r.render().asPng();
}

function luminance(r, g, b) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * AI / JPEG masters often flatten a rounded icon onto an opaque black
 * canvas (and may even be a JPEG saved as .png). Flood-fill that fill
 * from the four corners so the Windows .ico has real transparent corners.
 * Does not touch interior blacks (pencil tip, eyes) — those are not
 * connected to the corners.
 */
async function punchBlackCorners(srcPath) {
  const { data, info } = await sharp(srcPath).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;
  const n = w * h;
  const outside = new Uint8Array(n);
  const q = [];

  const isCornerBlack = (i) => {
    const o = i * 3;
    return data[o] < 12 && data[o + 1] < 12 && data[o + 2] < 12;
  };
  const tryPush = (x, y) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = y * w + x;
    if (outside[i] || !isCornerBlack(i)) return;
    outside[i] = 1;
    q.push(i);
  };

  tryPush(0, 0);
  tryPush(w - 1, 0);
  tryPush(0, h - 1);
  tryPush(w - 1, h - 1);
  for (let qi = 0; qi < q.length; qi++) {
    const i = q[qi];
    const x = i % w;
    const y = (i / w) | 0;
    tryPush(x - 1, y);
    tryPush(x + 1, y);
    tryPush(x, y - 1);
    tryPush(x, y + 1);
    tryPush(x - 1, y - 1);
    tryPush(x + 1, y - 1);
    tryPush(x - 1, y + 1);
    tryPush(x + 1, y + 1);
  }

  const out = Buffer.alloc(n * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const o = i * 3;
      const d = i * 4;
      out[d] = data[o];
      out[d + 1] = data[o + 1];
      out[d + 2] = data[o + 2];
      if (outside[i]) {
        out[d + 3] = 0;
        continue;
      }
      const lum = luminance(data[o], data[o + 1], data[o + 2]);
      if (lum < 28) {
        let near = false;
        for (let dy = -1; dy <= 1 && !near; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            if (outside[ny * w + nx]) near = true;
          }
        }
        if (near) {
          out[d + 3] = 0;
          continue;
        }
      }
      out[d + 3] = 255;
    }
  }

  return sharp(out, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
}

async function resizePng(src, size) {
  return sharp(src)
    .resize(size, size, { fit: 'cover', kernel: sharp.kernel.lanczos3 })
    .ensureAlpha()
    .png()
    .toBuffer();
}

function fileTypeSvg(accent, soft, label) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg viewBox="0 0 256 256" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="pg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff"/>
      <stop offset="1" stop-color="#f4f3ef"/>
    </linearGradient>
  </defs>
  <rect width="256" height="256" rx="48" fill="${soft}"/>
  <path d="M64 36h96l40 40v144a16 16 0 0 1-16 16H64a16 16 0 0 1-16-16V52a16 16 0 0 1 16-16z"
        fill="url(#pg)" stroke="#ddd9d0" stroke-width="4"/>
  <path d="M160 36v40h40" fill="none" stroke="#ddd9d0" stroke-width="4"/>
  <rect x="64" y="36" width="8" height="184" rx="4" fill="${accent}"/>
  <rect x="88" y="108" width="96" height="10" rx="5" fill="#d8d6cf"/>
  <rect x="88" y="132" width="80" height="10" rx="5" fill="#d8d6cf"/>
  <rect x="88" y="156" width="88" height="10" rx="5" fill="#d8d6cf"/>
  <rect x="88" y="188" width="52" height="28" rx="8" fill="${accent}"/>
  <text x="114" y="208" text-anchor="middle" fill="#1d1d1f" font-size="14" font-weight="700"
        font-family="Segoe UI, Arial, sans-serif">${label}</text>
</svg>`;
}

const FILE_KINDS = [
  { name: 'md', accent: '#f2b40a', soft: '#fdf1cf', label: 'MD', aliases: ['md', 'markdown', 'txt'] },
  { name: 'doc', accent: '#4c86e8', soft: '#dce8fb', label: 'DOC', aliases: ['docx'] },
  { name: 'sheet', accent: '#2f9463', soft: '#d8f0e4', label: 'XLS', aliases: ['xlsx', 'csv'] },
  { name: 'pdf', accent: '#e0554a', soft: '#f8ddd9', label: 'PDF', aliases: ['pdf'] }
];

(async () => {
  fs.mkdirSync(fileIconsDir, { recursive: true });

  // App icons — prefer Higgsfield master (icon-ai.png) when present
  const icoSizes = [256, 128, 64, 48, 32, 16];
  if (fs.existsSync(appAiPng)) {
    const master = await punchBlackCorners(appAiPng);
    const png512 = await resizePng(master, 512);
    fs.writeFileSync(path.join(assets, 'icon.png'), png512);
    const appIco = await pngToIco(await Promise.all(icoSizes.map((s) => resizePng(master, s))));
    fs.writeFileSync(path.join(assets, 'icon.ico'), appIco);
    console.log('icons written from icon-ai.png: icon.png (512), icon.ico (256..16)');
  } else {
    fs.writeFileSync(path.join(assets, 'icon.png'), renderSvgPng(appSvg, 512));
    const appIco = await pngToIco(icoSizes.map((s) => renderSvgPng(appSvg, s)));
    fs.writeFileSync(path.join(assets, 'icon.ico'), appIco);
    console.log('icons written from icon.svg: icon.png (512), icon.ico (256..16)');
  }

  // Per-type Explorer icons (paths used by electron-builder fileAssociations)
  for (const k of FILE_KINDS) {
    const svg = fileTypeSvg(k.accent, k.soft, k.label);
    const pngPath = path.join(fileIconsDir, `${k.name}.png`);
    fs.writeFileSync(pngPath, renderSvgPng(svg, 256));
    const ico = await pngToIco([256, 128, 64, 48, 32, 16].map((s) => renderSvgPng(svg, s)));
    fs.writeFileSync(path.join(fileIconsDir, `${k.name}.ico`), ico);
    // electron-builder also looks for `${ext}.ico` in buildResources
    for (const alias of k.aliases || []) {
      fs.writeFileSync(path.join(assets, `${alias}.ico`), ico);
      fs.writeFileSync(path.join(assets, `${alias}.png`), renderSvgPng(svg, 256));
    }
    console.log(`file icon written: file-icons/${k.name}.ico`);
  }

  try {
    const stamped = require('./stamp-electron-icon').stampElectronIcon();
    if (stamped && stamped.ok) console.log('stamped electron.exe with icon.ico');
    else if (stamped && stamped.error) console.warn('stamp-electron-icon:', stamped.error);
  } catch (e) {
    console.warn('stamp-electron-icon:', e.message || e);
  }
})().catch((e) => { console.error(e); process.exit(1); });
