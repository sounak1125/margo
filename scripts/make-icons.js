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

function pagePath() {
  return 'M58 28h92l44 44v140a18 18 0 0 1-18 18H58a18 18 0 0 1-18-18V46a18 18 0 0 1 18-18z';
}

function fileTypeSvg(kind) {
  if (kind === 'md') {
    return `<?xml version="1.0" encoding="UTF-8"?>
<svg viewBox="0 0 256 256" xmlns="http://www.w3.org/2000/svg">
  <rect width="256" height="256" rx="52" fill="#F6C445"/>
  <path d="${pagePath()}" fill="#FFFDF6" stroke="#E2C56A" stroke-width="4"/>
  <path d="M150 28v44h44" fill="none" stroke="#E2C56A" stroke-width="4"/>
  <path d="M88 86h-14v84h18V128l16 28 16-28v42h18V86h-18l-16 32-16-32z" fill="#5A4300"/>
  <rect x="72" y="188" width="72" height="28" rx="8" fill="#5A4300"/>
  <text x="108" y="208" text-anchor="middle" fill="#FFFDF6" font-size="16" font-weight="800"
        font-family="Segoe UI, Arial, sans-serif">MD</text>
</svg>`;
  }
  if (kind === 'doc') {
    return `<?xml version="1.0" encoding="UTF-8"?>
<svg viewBox="0 0 256 256" xmlns="http://www.w3.org/2000/svg">
  <rect width="256" height="256" rx="52" fill="#2B579A"/>
  <path d="${pagePath()}" fill="#F7FAFF" stroke="#9BB6DE" stroke-width="4"/>
  <path d="M150 28v44h44" fill="none" stroke="#9BB6DE" stroke-width="4"/>
  <rect x="78" y="92" width="92" height="10" rx="5" fill="#2B579A"/>
  <rect x="78" y="114" width="78" height="10" rx="5" fill="#8AA6D4"/>
  <rect x="78" y="136" width="86" height="10" rx="5" fill="#8AA6D4"/>
  <rect x="78" y="158" width="64" height="10" rx="5" fill="#8AA6D4"/>
  <rect x="70" y="182" width="56" height="40" rx="10" fill="#2B579A"/>
  <text x="98" y="211" text-anchor="middle" fill="#FFFFFF" font-size="28" font-weight="800"
        font-family="Segoe UI, Arial, sans-serif">W</text>
</svg>`;
  }
  if (kind === 'sheet') {
    return `<?xml version="1.0" encoding="UTF-8"?>
<svg viewBox="0 0 256 256" xmlns="http://www.w3.org/2000/svg">
  <rect width="256" height="256" rx="52" fill="#217346"/>
  <path d="${pagePath()}" fill="#F4FBF7" stroke="#8FCBAB" stroke-width="4"/>
  <path d="M150 28v44h44" fill="none" stroke="#8FCBAB" stroke-width="4"/>
  <g transform="translate(70 88)">
    <rect width="116" height="92" rx="6" fill="#FFFFFF" stroke="#217346" stroke-width="3"/>
    <rect x="0" y="0" width="116" height="22" fill="#217346"/>
    <path d="M0 22h116M0 45h116M0 68h116M29 0v92M58 0v92M87 0v92" stroke="#D7EDE2" stroke-width="2"/>
    <path d="M0 22h116" stroke="#1A5C38" stroke-width="2"/>
  </g>
  <rect x="70" y="190" width="72" height="28" rx="8" fill="#145C38"/>
  <text x="106" y="210" text-anchor="middle" fill="#FFFFFF" font-size="16" font-weight="800"
        font-family="Segoe UI, Arial, sans-serif">XLS</text>
</svg>`;
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg viewBox="0 0 256 256" xmlns="http://www.w3.org/2000/svg">
  <rect width="256" height="256" rx="52" fill="#E0554A"/>
  <path d="${pagePath()}" fill="#FFF8F7" stroke="#E7A8A2" stroke-width="4"/>
  <path d="M150 28v44h44" fill="none" stroke="#E7A8A2" stroke-width="4"/>
  <rect x="78" y="96" width="92" height="10" rx="5" fill="#E7C0BC"/>
  <rect x="78" y="118" width="78" height="10" rx="5" fill="#E7C0BC"/>
  <rect x="78" y="140" width="86" height="10" rx="5" fill="#E7C0BC"/>
  <rect x="70" y="178" width="78" height="40" rx="10" fill="#B33830"/>
  <text x="109" y="206" text-anchor="middle" fill="#FFFFFF" font-size="18" font-weight="800"
        font-family="Segoe UI, Arial, sans-serif">PDF</text>
</svg>`;
}

const FILE_KINDS = [
  { name: 'md', aliases: ['md', 'markdown', 'txt'] },
  { name: 'doc', aliases: ['docx'] },
  { name: 'sheet', aliases: ['xlsx', 'csv'] },
  { name: 'pdf', aliases: ['pdf'] }
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
    const svg = fileTypeSvg(k.name);
    fs.writeFileSync(path.join(fileIconsDir, `${k.name}.svg`), svg);
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
