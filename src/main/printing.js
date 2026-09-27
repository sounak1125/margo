/* Hidden-window rendering shared by Export as PDF, Print and the document
   thumbnails: page geometry for PDF export, and the lock-down every one of
   those windows gets.

   The HTML these windows load is the author's document, and a Markdown file
   may carry any raw HTML it likes. JavaScript is already off in them, but an
   <iframe src="file:///..."> or <object> still renders - so opening a
   malicious .md and exporting it would quietly paste a local file of the
   author's into a PDF they then send to someone. Every document gets a
   Content-Security-Policy that allows images, inline styles and local fonts
   and nothing else: no frames, objects, scripts, fetches or remote styles. */
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const DOC_CSP = [
  "default-src 'none'",
  'img-src data: blob: file: https: http:',
  "style-src 'unsafe-inline' data: file:",
  'font-src data: file:',
  'media-src data: blob:'
].join('; ');

function injectCsp(html) {
  const meta = `<meta http-equiv="Content-Security-Policy" content="${DOC_CSP}">`;
  const src = String(html == null ? '' : html);
  const m = /<head(\s[^>]*)?>/i.exec(src);
  if (m) return src.slice(0, m.index + m[0].length) + meta + src.slice(m.index + m[0].length);
  // No <head>: the parser puts a leading meta into the implied head.
  return meta + src;
}

/* ---------------- page options ---------------- */

// Portrait dimensions, inches.
const PAGE_SIZES = {
  a3: { w: 11.69, h: 16.54 },
  a4: { w: 8.27, h: 11.69 },
  a5: { w: 5.83, h: 8.27 },
  letter: { w: 8.5, h: 11 },
  legal: { w: 8.5, h: 14 },
  tabloid: { w: 11, h: 17 },
  executive: { w: 7.25, h: 10.5 }
};

const MARGIN_PRESETS = {
  none: 0,
  narrow: 0.5,
  moderate: 0.75,
  normal: 1,
  default: 1,
  wide: 2
};

function clampInches(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.min(4, Math.max(0, n));
}

function marginsFrom(m) {
  if (m == null) return null;
  if (typeof m === 'string') {
    const side = MARGIN_PRESETS[m.toLowerCase()];
    return side == null ? null : { top: side, right: side, bottom: side, left: side };
  }
  if (typeof m === 'number') {
    const side = clampInches(m);
    return side == null ? null : { top: side, right: side, bottom: side, left: side };
  }
  if (typeof m === 'object') {
    const out = {};
    for (const k of ['top', 'right', 'bottom', 'left']) {
      const v = clampInches(m[k]);
      if (v == null) return null;
      out[k] = v;
    }
    return out;
  }
  return null;
}

/* Defaults a document carries itself: a Word document's own page setup, or
   A4 portrait with one-inch margins for everything else (what Margo has
   always exported). */
function documentDefaults(kind, data) {
  const out = { size: 'a4', landscape: false, margins: marginsFrom('normal') };
  const layout = kind === 'doc' && data && data.layout;
  if (layout && typeof layout === 'object') {
    if (typeof layout.size === 'string' && PAGE_SIZES[layout.size.toLowerCase()]) out.size = layout.size.toLowerCase();
    else if (layout.pageIn && Number(layout.pageIn.w) > 0 && Number(layout.pageIn.h) > 0) {
      out.size = { w: Math.min(Number(layout.pageIn.w), Number(layout.pageIn.h)), h: Math.max(Number(layout.pageIn.w), Number(layout.pageIn.h)) };
    }
    if (layout.orientation === 'landscape') out.landscape = true;
    out.margins = marginsFrom(layout.marginIn) || marginsFrom(layout.margins) || out.margins;
  }
  return out;
}

/* Accepts the renderer's `page` option and returns a complete, validated page
   setup: { width, height } in inches (orientation applied), margins in
   inches, and the name for display.
     page.size       'A4' | 'Letter' | 'Legal' | 'A3' | 'A5' | 'Tabloid' | 'Executive'
                     or { width, height } in inches
     page.landscape  boolean (or page.orientation: 'landscape' | 'portrait')
     page.margins    'none' | 'narrow' | 'moderate' | 'normal' | 'wide',
                     a number of inches, or { top, right, bottom, left } in inches */
function normalizePageOptions(page, kind, data) {
  const base = documentDefaults(kind, data);
  const p = page && typeof page === 'object' ? page : {};

  let size = base.size;
  if (typeof p.size === 'string' && PAGE_SIZES[p.size.toLowerCase()]) size = p.size.toLowerCase();
  else if (p.size && typeof p.size === 'object') {
    const w = clampInches(p.size.width);
    const h = clampInches(p.size.height);
    if (w && h && w >= 1 && h >= 1) size = { w: Math.min(w, h), h: Math.max(w, h) };
  }

  let landscape = base.landscape;
  if (typeof p.landscape === 'boolean') landscape = p.landscape;
  else if (p.orientation === 'landscape' || p.orientation === 'portrait') landscape = p.orientation === 'landscape';

  const margins = marginsFrom(p.margins) || base.margins;
  const dims = typeof size === 'string' ? PAGE_SIZES[size] : size;
  let width = landscape ? dims.h : dims.w;
  let height = landscape ? dims.w : dims.h;
  width = +width.toFixed(3);
  height = +height.toFixed(3);

  // Margins that leave no printable area are a mistake, not a request.
  if (margins.left + margins.right > width - 1 || margins.top + margins.bottom > height - 1) {
    const side = MARGIN_PRESETS.normal;
    Object.assign(margins, { top: side, right: side, bottom: side, left: side });
  }

  return {
    name: typeof size === 'string' ? size : 'custom',
    width,
    height,
    landscape,
    margins
  };
}

/* Appended after the document's own styles so it wins the cascade; the PDF is
   then printed with preferCSSPageSize, so page size and margins are exactly
   this whatever the document's own @page said. */
function pageCss(setup) {
  const m = setup.margins;
  return `<style>@page { size: ${setup.width}in ${setup.height}in; margin: ${m.top}in ${m.right}in ${m.bottom}in ${m.left}in; }</style>`;
}

function withPageCss(html, setup) {
  const src = String(html || '');
  const css = pageCss(setup);
  const i = src.search(/<\/head>/i);
  if (i >= 0) return src.slice(0, i) + css + src.slice(i);
  return css + src;
}

function printToPdfOptions(setup) {
  return {
    printBackground: true,
    preferCSSPageSize: true,
    landscape: false, // the size is already oriented
    pageSize: { width: setup.width, height: setup.height },
    margins: {
      top: setup.margins.top,
      right: setup.margins.right,
      bottom: setup.margins.bottom,
      left: setup.margins.left
    }
  };
}

/* ---------------- hidden windows ---------------- */

/* Scratch files main writes for a window to load. Date.now() alone gave two
   exports or prints started in the same millisecond the same path, and the
   first one to finish deleted the file the second was still loading. */
let tmpSeq = 0;
function tempPath(prefix, ext) {
  return path.join(app.getPath('temp'), `${prefix}-${process.pid}-${tmpSeq++}.${ext}`);
}

function hiddenWindow(parent, webPreferences) {
  return new BrowserWindow({
    show: false,
    parent: parent && !parent.isDestroyed() ? parent : undefined,
    webPreferences: Object.assign({
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      javascript: false,
      webSecurity: true
    }, webPreferences)
  });
}

async function withHtmlWindow(html, parent, fn) {
  const tmp = tempPath('margo-print', 'html');
  await fs.promises.writeFile(tmp, injectCsp(html), { encoding: 'utf8', mode: 0o600 });
  const w = hiddenWindow(parent);
  try {
    await w.loadFile(tmp);
    return await fn(w);
  } finally {
    if (!w.isDestroyed()) w.destroy();
    try { await fs.promises.unlink(tmp); } catch {}
  }
}

/* Renders a full HTML document to PDF bytes with the given page setup. */
async function htmlToPdf(html, setup, parent) {
  return withHtmlWindow(withPageCss(html, setup), parent, (w) => w.webContents.printToPDF(printToPdfOptions(setup)));
}

module.exports = {
  DOC_CSP,
  PAGE_SIZES,
  injectCsp,
  normalizePageOptions,
  withPageCss,
  printToPdfOptions,
  tempPath,
  hiddenWindow,
  withHtmlWindow,
  htmlToPdf
};
