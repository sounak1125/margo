/* Margo — PowerPoint (.pptx) read/write for the presentation editor.

   Writing goes through pptxgenjs, so the package is one PowerPoint, Keynote
   and LibreOffice all open cleanly. Alongside the slides Margo stores its own
   deck model (customXml/margo-slides.json) together with a fingerprint of the
   slide XML it was written with. Reopening a file Margo wrote is then exact -
   themes, layouts, placeholders, list levels - and the moment anything else
   edits the slides the fingerprint stops matching and the file is read from
   its XML like any other presentation. Images are not duplicated into the
   JSON; they are picked back up from the slide parts by element id. */
const crypto = require('crypto');
const path = require('path');
const JSZip = require('jszip');
const { DOMParser } = require('@xmldom/xmldom');
const PptxGenJS = require('pptxgenjs');
const core = require('./slides-core');

const EMU_PER_PX = 9525;
const MARGO_PART = 'customXml/margo-slides.json';
const MARGO_CT = 'application/json';
const TEXT_MARGIN_PT = [core.PAD_X * 0.75, core.PAD_X * 0.75, core.PAD_Y * 0.75, core.PAD_Y * 0.75];

/* ============================ write ============================ */

const in_ = (px) => Math.round((Number(px) || 0) / 96 * 10000) / 10000;
const hex6 = (c) => (core.normHex(c) || '#000000').slice(1).toUpperCase();

function dataOf(src) {
  const m = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i.exec(String(src || ''));
  if (!m) return null;
  return `${m[1].toLowerCase()};base64,${m[2]}`;
}

function bulletFor(p) {
  if (p.list === 'number') return { type: 'number', indent: core.BULLET_INDENT_PT };
  if (p.list === 'bullet') {
    const ch = core.BULLET_CHARS[p.level || 0] || core.BULLET_CHARS[0];
    return { characterCode: ch.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0'), indent: core.BULLET_INDENT_PT };
  }
  return false;
}

function textItems(deck, slide, el) {
  const items = [];
  const paras = el.paragraphs && el.paragraphs.length ? el.paragraphs : [core.para('')];
  paras.forEach((p, pi) => {
    const pieces = [];
    (p.runs && p.runs.length ? p.runs : [{ text: '' }]).forEach((r) => {
      String(r.text || '').split('\n').forEach((t, k) => pieces.push({ r, text: t, soft: k > 0 }));
    });
    if (pieces.length > 1) {
      // Drop zero-length pieces that are not line breaks; they only add empty runs.
      for (let i = pieces.length - 1; i >= 0 && pieces.length > 1; i--) {
        if (!pieces[i].text && !pieces[i].soft) pieces.splice(i, 1);
      }
    }
    pieces.forEach((pc, ri) => {
      const st = core.runStyle(deck, slide, el, pc.r);
      const o = {
        fontFace: st.font,
        fontSize: st.size,
        color: hex6(st.color),
        bold: st.b,
        italic: st.i,
        align: p.align || 'left'
      };
      if (st.u) o.underline = { style: 'sng' };
      if (ri === 0) {
        o.bullet = bulletFor(p);
        if (p.list && p.level) o.indentLevel = p.level;
        if (pi > 0 && el.spacing) o.paraSpaceBefore = el.spacing;
      }
      if (pc.soft && ri > 0) o.softBreakBefore = true;
      if (ri === pieces.length - 1 && pi < paras.length - 1) o.breakLine = true;
      items.push({ text: pc.text, options: o });
    });
  });
  return items;
}

function baseOpts(el) {
  const o = { x: in_(el.x), y: in_(el.y), w: in_(Math.max(el.w, 0)), h: in_(Math.max(el.h, 0)), objectName: el.id };
  if (el.rot) o.rotate = Math.round(el.rot * 100) / 100;
  return o;
}

function addText(pptx, s, deck, slide, el) {
  if (core.isTextEmpty(el)) return;
  const d = core.textDefaults(deck, slide, el);
  const o = Object.assign(baseOpts(el), {
    margin: TEXT_MARGIN_PT,
    valign: el.valign === 'middle' ? 'middle' : el.valign === 'bottom' ? 'bottom' : 'top',
    fontFace: d.font,
    fontSize: d.size,
    color: hex6(d.color),
    wrap: true
  });
  const fill = core.resolveColor(deck, el.fill, slide);
  const stroke = core.resolveColor(deck, el.stroke, slide);
  if (fill) o.fill = { color: hex6(fill) };
  if (stroke && el.strokeWidth > 0) o.line = { color: hex6(stroke), width: el.strokeWidth * 0.75 };
  if (el.shape === 'roundRect') {
    o.shape = pptx.ShapeType.roundRect;
    o.rectRadius = in_(Math.min(el.w, el.h) * 0.12);
  } else if (el.shape === 'ellipse') o.shape = pptx.ShapeType.ellipse;
  s.addText(textItems(deck, slide, el), o);
}

function addShape(pptx, s, deck, slide, el) {
  const fill = core.resolveColor(deck, el.fill, slide);
  const stroke = core.resolveColor(deck, el.stroke, slide);
  const sw = Math.max(0, Number(el.strokeWidth) || 0);
  const o = baseOpts(el);
  if (el.shape === 'line' || el.shape === 'arrow') {
    o.line = { color: hex6(stroke || fill || '#000000'), width: Math.max(1, sw || 2) * 0.75 };
    if (el.shape === 'arrow') o.line.endArrowType = 'triangle';
    if (el.flipH) o.flipH = true;
    if (el.flipV) o.flipV = true;
    s.addShape(pptx.ShapeType.line, o);
    return;
  }
  if (fill) o.fill = { color: hex6(fill) };
  if (stroke && sw > 0) o.line = { color: hex6(stroke), width: sw * 0.75 };
  const types = {
    rect: pptx.ShapeType.rect,
    roundRect: pptx.ShapeType.roundRect,
    ellipse: pptx.ShapeType.ellipse,
    triangle: pptx.ShapeType.triangle,
    diamond: pptx.ShapeType.diamond
  };
  if (el.shape === 'roundRect') o.rectRadius = in_(Math.min(Number(el.radius) || 0, el.w / 2, el.h / 2));
  s.addShape(types[el.shape] || pptx.ShapeType.rect, o);
}

function addImage(s, el) {
  const data = dataOf(el.src);
  if (!data || el.w <= 0 || el.h <= 0) return;
  const o = Object.assign(baseOpts(el), { data });
  const c = core.imageCrop(el);
  if (c) {
    const fw = 1 - c.l - c.r;
    const fh = 1 - c.t - c.b;
    if (fw > 0.001 && fh > 0.001) {
      const iw = el.w / fw;
      const ih = el.h / fh;
      o.w = in_(iw);
      o.h = in_(ih);
      o.sizing = { type: 'crop', x: in_(c.l * iw), y: in_(c.t * ih), w: in_(el.w), h: in_(el.h) };
    }
  }
  s.addImage(o);
}

/* pptxgenjs writes an <a:pPr> for every run, so a paragraph with mixed
   formatting carries several - which the schema forbids and PowerPoint
   answers with a repair prompt. Only the first one is the paragraph's. */
function dedupeParagraphProps(xml) {
  return xml.replace(/<a:p>([\s\S]*?)<\/a:p>/g, (whole, inner) => {
    let seen = false;
    const fixed = inner.replace(/<a:pPr\b[^>]*\/>|<a:pPr\b[^>]*>[\s\S]*?<\/a:pPr>/g, (m) => {
      if (!seen) { seen = true; return m; }
      return '';
    });
    return '<a:p>' + fixed + '</a:p>';
  });
}

function slidePartNames(zip) {
  const re = /^ppt\/(slides|notesSlides)\/[^/]+\.xml$/;
  return Object.keys(zip.files).filter((n) => re.test(n)).sort();
}

async function fingerprint(zip) {
  const h = crypto.createHash('sha1');
  const pres = zip.file('ppt/presentation.xml');
  if (pres) h.update(await pres.async('string'));
  for (const name of slidePartNames(zip)) {
    h.update(name);
    h.update(await zip.file(name).async('string'));
  }
  return h.digest('hex');
}

function deckForJson(deck) {
  const d = core.clone(deck);
  d.slides.forEach((s) => {
    if (s.background && s.background.image) s.background = { image: '@xml' };
    s.elements.forEach((e) => { if (e.type === 'image' && e.src) e.src = '@xml'; });
  });
  return d;
}

async function writePptx(deckIn, title) {
  const deck = core.normalizeDeck(deckIn);
  const theme = core.themeOf(deck);
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: 'MARGO', width: in_(deck.size.w), height: in_(deck.size.h) });
  pptx.layout = 'MARGO';
  pptx.author = 'Margo';
  pptx.title = title || 'Presentation';
  pptx.theme = { headFontFace: theme.titleFont, bodyFontFace: theme.bodyFont };

  for (const slide of deck.slides) {
    const s = pptx.addSlide();
    const bg = core.slideBackground(deck, slide);
    const bgData = bg.image ? dataOf(bg.image) : null;
    s.background = bgData ? { data: bgData } : { color: hex6(bg.color) };
    for (const el of slide.elements) {
      if (el.type === 'text') addText(pptx, s, deck, slide, el);
      else if (el.type === 'shape') addShape(pptx, s, deck, slide, el);
      else if (el.type === 'image') addImage(s, el);
    }
    if (slide.notes && slide.notes.trim()) s.addNotes(slide.notes);
  }

  const raw = await pptx.write({ outputType: 'nodebuffer' });
  const zip = await JSZip.loadAsync(raw);
  for (const name of Object.keys(zip.files)) {
    if (!/^ppt\/slides\/slide\d+\.xml$/.test(name)) continue;
    zip.file(name, dedupeParagraphProps(await zip.file(name).async('string')));
  }
  const fp = await fingerprint(zip);
  zip.file(MARGO_PART, JSON.stringify({ version: 1, fingerprint: fp, deck: deckForJson(deck) }));
  let ct = await zip.file('[Content_Types].xml').async('string');
  if (!ct.includes(MARGO_PART)) {
    ct = ct.replace('</Types>', `<Override PartName="/${MARGO_PART}" ContentType="${MARGO_CT}"/></Types>`);
    zip.file('[Content_Types].xml', ct);
  }
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

/* ============================ read ============================ */

function parseXml(str) {
  const quiet = { warning() {}, error() {}, fatalError() {} };
  return new DOMParser({ errorHandler: quiet }).parseFromString(String(str || ''), 'text/xml');
}
function kids(n, name) {
  const out = [];
  if (!n || !n.childNodes) return out;
  for (let i = 0; i < n.childNodes.length; i++) {
    const c = n.childNodes[i];
    if (c.nodeType === 1 && (name == null || c.localName === name)) out.push(c);
  }
  return out;
}
function kid(n, name) {
  if (!n || !n.childNodes) return null;
  for (let i = 0; i < n.childNodes.length; i++) {
    const c = n.childNodes[i];
    if (c.nodeType === 1 && c.localName === name) return c;
  }
  return null;
}
function at(n, ...names) {
  let cur = n;
  for (const nm of names) { cur = kid(cur, nm); if (!cur) return null; }
  return cur;
}
function attr(n, name) {
  if (!n || !n.getAttribute) return null;
  const v = n.getAttribute(name);
  return v === '' && !n.hasAttribute(name) ? null : v;
}
function numAttr(n, name, d) {
  const v = attr(n, name);
  if (v == null || v === '') return d;
  const x = Number(v);
  return Number.isFinite(x) ? x : d;
}
function boolAttr(n, name) {
  const v = attr(n, name);
  if (v == null || v === '') return null;
  return v === '1' || v === 'true';
}

function resolveTarget(fromPart, target) {
  if (!target) return null;
  if (target.startsWith('/')) return target.slice(1);
  const dir = path.posix.dirname(fromPart);
  return path.posix.normalize(path.posix.join(dir, target));
}
async function readRels(zip, part) {
  const relsPath = path.posix.join(path.posix.dirname(part), '_rels', path.posix.basename(part) + '.rels');
  const f = zip.file(relsPath);
  const map = {};
  if (!f) return map;
  const doc = parseXml(await f.async('string'));
  kids(doc.documentElement, 'Relationship').forEach((r) => {
    const mode = attr(r, 'TargetMode');
    map[attr(r, 'Id')] = {
      type: String(attr(r, 'Type') || ''),
      target: mode === 'External' ? null : resolveTarget(part, attr(r, 'Target'))
    };
  });
  return map;
}
function relOfType(rels, suffix) {
  const k = Object.keys(rels).find((id) => rels[id].type.endsWith(suffix));
  return k ? rels[k] : null;
}

/* ---------- colours ---------- */
function hexToRgb(h) {
  const s = core.normHex(h) || '#000000';
  return [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
}
function rgbToHex(r, g, b) {
  const c = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return '#' + c(r) + c(g) + c(b);
}
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  return [h, s, l];
}
function hslToRgb(h, s, l) {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const hue = (p, q, t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [hue(p, q, h + 1 / 3) * 255, hue(p, q, h) * 255, hue(p, q, h - 1 / 3) * 255];
}
const PRESET_COLORS = { black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000', blue: '#0000ff', yellow: '#ffff00', gray: '#808080', grey: '#808080' };

/* A colour choice node (srgbClr, schemeClr, ...) with its modifiers applied. */
function colorFromChoice(node, env) {
  if (!node) return null;
  let base = null;
  const name = node.localName;
  if (name === 'srgbClr') base = core.normHex(attr(node, 'val'));
  else if (name === 'sysClr') base = core.normHex(attr(node, 'lastClr')) || (attr(node, 'val') === 'window' ? '#ffffff' : '#000000');
  else if (name === 'prstClr') base = PRESET_COLORS[String(attr(node, 'val') || '').toLowerCase()] || null;
  else if (name === 'schemeClr') base = env.scheme(attr(node, 'val'));
  else if (name === 'scrgbClr') {
    base = rgbToHex(numAttr(node, 'r', 0) / 100000 * 255, numAttr(node, 'g', 0) / 100000 * 255, numAttr(node, 'b', 0) / 100000 * 255);
  }
  if (!base) return null;
  let [r, g, b] = hexToRgb(base);
  for (const m of kids(node)) {
    const v = numAttr(m, 'val', 0) / 100000;
    if (m.localName === 'lumMod' || m.localName === 'lumOff') {
      const [h, s, l] = rgbToHsl(r, g, b);
      const nl = m.localName === 'lumMod' ? l * v : l + v;
      [r, g, b] = hslToRgb(h, s, Math.max(0, Math.min(1, nl)));
    } else if (m.localName === 'tint') {
      r = 255 - (255 - r) * v; g = 255 - (255 - g) * v; b = 255 - (255 - b) * v;
    } else if (m.localName === 'shade') {
      r *= v; g *= v; b *= v;
    }
  }
  return rgbToHex(r, g, b);
}
function colorFromFill(fillParent, env) {
  if (!fillParent) return undefined;
  if (kid(fillParent, 'noFill')) return null;
  const solid = kid(fillParent, 'solidFill');
  if (solid) return colorFromChoice(kids(solid)[0], env);
  const grad = kid(fillParent, 'gradFill');
  if (grad) {
    const gs = kids(at(grad, 'gsLst'), 'gs');
    if (gs.length) return colorFromChoice(kids(gs[Math.floor(gs.length / 2)])[0], env);
  }
  return undefined;
}

/* ---------- images ---------- */
const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', svg: 'image/svg+xml', webp: 'image/webp', tif: 'image/tiff', tiff: 'image/tiff' };
function imageSize(buf) {
  try {
    if (buf.length > 24 && buf[0] === 0x89 && buf[1] === 0x50) return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
    if (buf.length > 10 && buf[0] === 0x47 && buf[1] === 0x49) return { w: buf.readUInt16LE(6), h: buf.readUInt16LE(8) };
    if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
      let i = 2;
      while (i + 9 < buf.length) {
        if (buf[i] !== 0xff) { i++; continue; }
        const marker = buf[i + 1];
        const len = buf.readUInt16BE(i + 2);
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
          return { w: buf.readUInt16BE(i + 7), h: buf.readUInt16BE(i + 5) };
        }
        i += 2 + len;
      }
    }
  } catch {}
  return { w: 0, h: 0 };
}
async function mediaDataUrl(zip, target, cache) {
  if (!target) return null;
  if (cache.has(target)) return cache.get(target);
  const f = zip.file(target);
  let out = null;
  if (f) {
    const ext = path.posix.extname(target).slice(1).toLowerCase();
    const mime = MIME[ext];
    if (mime && mime !== 'image/tiff') {
      const buf = await f.async('nodebuffer');
      const size = imageSize(buf);
      out = { url: `data:${mime};base64,${buf.toString('base64')}`, w: size.w, h: size.h };
    }
  }
  cache.set(target, out);
  return out;
}

/* ---------- part cache (layouts, masters) ---------- */
async function loadPart(zip, part, env) {
  if (!part) return null;
  if (env.parts.has(part)) return env.parts.get(part);
  const f = zip.file(part);
  if (!f) { env.parts.set(part, null); return null; }
  const doc = parseXml(await f.async('string'));
  const rels = await readRels(zip, part);
  const root = doc.documentElement;
  const spTree = at(root, 'cSld', 'spTree');
  const phs = [];
  kids(spTree).forEach((n) => {
    const ph = placeholderOf(n);
    if (ph) phs.push({ node: n, type: ph.type, idx: ph.idx });
  });
  const info = { part, root, rels, phs, spTree };
  env.parts.set(part, info);
  return info;
}
function nvPrOf(n) {
  const nv = kid(n, 'nvSpPr') || kid(n, 'nvPicPr') || kid(n, 'nvGraphicFramePr') || kid(n, 'nvCxnSpPr') || kid(n, 'nvGrpSpPr');
  return nv ? kid(nv, 'nvPr') : null;
}
function cNvPrOf(n) {
  const nv = kid(n, 'nvSpPr') || kid(n, 'nvPicPr') || kid(n, 'nvGraphicFramePr') || kid(n, 'nvCxnSpPr') || kid(n, 'nvGrpSpPr');
  return nv ? kid(nv, 'cNvPr') : null;
}
function placeholderOf(n) {
  const ph = kid(nvPrOf(n), 'ph');
  if (!ph) return null;
  return { type: attr(ph, 'type') || 'obj', idx: attr(ph, 'idx') };
}
const TITLE_TYPES = ['title', 'ctrTitle'];
function findPh(info, ph, strictIdx) {
  if (!info || !ph) return null;
  if (ph.idx != null) {
    const byIdx = info.phs.find((p) => p.idx === ph.idx);
    if (byIdx) return byIdx.node;
    if (strictIdx) return null;
  }
  const byType = info.phs.find((p) => p.type === ph.type);
  if (byType) return byType.node;
  if (TITLE_TYPES.includes(ph.type)) {
    const t = info.phs.find((p) => TITLE_TYPES.includes(p.type));
    if (t) return t.node;
  }
  if (!TITLE_TYPES.includes(ph.type)) {
    const b = info.phs.find((p) => p.type === 'body') || info.phs.find((p) => p.type === 'obj');
    if (b) return b.node;
  }
  return null;
}

/* ---------- geometry ---------- */
function xfrmOf(n) {
  const spPr = kid(n, 'spPr') || kid(n, 'grpSpPr');
  let x = kid(spPr, 'xfrm');
  if (!x && n.localName === 'graphicFrame') x = kid(n, 'xfrm');
  if (!x) return null;
  const off = kid(x, 'off');
  const ext = kid(x, 'ext');
  if (!off || !ext) return null;
  return {
    x: numAttr(off, 'x', 0), y: numAttr(off, 'y', 0),
    w: numAttr(ext, 'cx', 0), h: numAttr(ext, 'cy', 0),
    rot: numAttr(x, 'rot', 0) / 60000,
    flipH: boolAttr(x, 'flipH') === true, flipV: boolAttr(x, 'flipV') === true,
    chOff: kid(x, 'chOff'), chExt: kid(x, 'chExt')
  };
}
function applyGroup(tf, g) {
  return {
    x: tf.ox + (g.x - tf.cx) * tf.sx,
    y: tf.oy + (g.y - tf.cy) * tf.sy,
    w: g.w * tf.sx,
    h: g.h * tf.sy
  };
}
const IDENTITY = { ox: 0, oy: 0, cx: 0, cy: 0, sx: 1, sy: 1 };

/* ---------- text ---------- */
function lvlChain(level, chainNodes) {
  const name = 'lvl' + (level + 1) + 'pPr';
  return chainNodes.map((ls) => kid(ls, name)).filter(Boolean);
}
function firstAttr(nodes, name) {
  for (const n of nodes) {
    const v = attr(n, name);
    if (v != null && v !== '') return v;
  }
  return null;
}
function firstDefRPr(nodes) {
  return nodes.map((n) => kid(n, 'defRPr')).filter(Boolean);
}
function typefaceOf(rPr, env) {
  const latin = kid(rPr, 'latin');
  const tf = latin ? attr(latin, 'typeface') : null;
  if (!tf) return null;
  if (tf === '+mj-lt') return env.majorFont;
  if (tf === '+mn-lt') return env.minorFont;
  if (tf.startsWith('+')) return env.minorFont;
  return tf;
}

function parseTextBody(txBody, chain, env) {
  /* chain = { lists: [lstStyle nodes in priority order], bodyPrs: [...], defaultBullets: bool } */
  const bodyPrs = chain.bodyPrs;
  let fontScale = 1;
  for (const bp of bodyPrs) {
    const na = kid(bp, 'normAutofit');
    if (na) { fontScale = numAttr(na, 'fontScale', 100000) / 100000; break; }
    if (kid(bp, 'noAutofit') || kid(bp, 'spAutoFit')) break;
  }
  const lists = [kid(txBody, 'lstStyle')].concat(chain.lists).filter(Boolean);
  const paragraphs = [];
  kids(txBody, 'p').forEach((p) => {
    const pPr = kid(p, 'pPr');
    const level = Math.max(0, Math.min(4, numAttr(pPr, 'lvl', 0)));
    const lv = [pPr].filter(Boolean).concat(lvlChain(level, lists));
    const algn = firstAttr(lv, 'algn');
    const align = algn === 'ctr' ? 'center' : algn === 'r' ? 'right' : algn === 'just' || algn === 'dist' ? 'justify' : 'left';
    let list = null;
    for (const n of lv) {
      if (kid(n, 'buNone')) { list = null; break; }
      if (kid(n, 'buAutoNum')) { list = 'number'; break; }
      if (kid(n, 'buChar') || kid(n, 'buBlip')) { list = 'bullet'; break; }
    }
    const defs = firstDefRPr(lv);
    const runs = [];
    const pushRun = (rPr, text) => {
      const src = [rPr].filter(Boolean).concat(defs);
      const sz = firstAttr(src, 'sz');
      const b = src.map((n) => boolAttr(n, 'b')).find((v) => v != null);
      const i = src.map((n) => boolAttr(n, 'i')).find((v) => v != null);
      const u = firstAttr(src, 'u');
      let color;
      for (const n of src) {
        const c = colorFromFill(n, env);
        if (c !== undefined) { color = c; break; }
      }
      let font = null;
      for (const n of src) { font = typefaceOf(n, env); if (font) break; }
      runs.push({
        text,
        b: !!b,
        i: !!i,
        u: !!u && u !== 'none',
        color: color || null,
        size: sz ? Math.round(Number(sz) / 100 * fontScale * 10) / 10 : Math.round(chain.defaultSize * fontScale * 10) / 10,
        font: font || chain.defaultFont
      });
    };
    kids(p).forEach((c) => {
      if (c.localName === 'r' || c.localName === 'fld') {
        const t = kid(c, 't');
        pushRun(kid(c, 'rPr'), t ? String(t.textContent || '') : '');
      } else if (c.localName === 'br') {
        // A line break belongs to the run it ends; its own rPr is rarely set.
        if (runs.length) runs[runs.length - 1].text += '\n';
        else pushRun(kid(c, 'rPr'), '\n');
      }
    });
    if (!runs.length) pushRun(kid(p, 'endParaRPr'), '');
    // merge neighbours with identical formatting
    const merged = [];
    runs.forEach((r) => {
      const prev = merged[merged.length - 1];
      if (prev && prev.b === r.b && prev.i === r.i && prev.u === r.u && prev.color === r.color && prev.size === r.size && prev.font === r.font) {
        prev.text += r.text;
      } else merged.push(Object.assign({}, r));
    });
    paragraphs.push({ align, list, level: list ? level : 0, runs: merged });
  });
  return paragraphs.length ? paragraphs : [core.para('')];
}

/* Most runs share the element's size, colour and font; keep those once on
   the element so the toolbar's element-level controls act on them. */
function hoistTextStyle(el) {
  const runs = [];
  el.paragraphs.forEach((p) => p.runs.forEach((r) => runs.push(r)));
  const content = runs.filter((r) => r.text.trim());
  const pick = (key) => {
    const counts = new Map();
    (content.length ? content : runs).forEach((r) => {
      const v = r[key];
      if (v == null) return;
      counts.set(v, (counts.get(v) || 0) + (r.text.length || 1));
    });
    let best = null, n = -1;
    counts.forEach((c, v) => { if (c > n) { n = c; best = v; } });
    return best;
  };
  el.size = pick('size');
  el.color = pick('color');
  el.font = pick('font');
  runs.forEach((r) => {
    if (!r.text) { delete r.size; delete r.color; delete r.font; }
    if (r.size === el.size) delete r.size;
    if (r.color === el.color || r.color == null) delete r.color;
    if (r.font === el.font || r.font == null) delete r.font;
    if (!r.b) delete r.b;
    if (!r.i) delete r.i;
    if (!r.u) delete r.u;
  });
}

/* ---------- elements ---------- */
const PRST_MAP = {
  rect: 'rect', roundRect: 'roundRect', ellipse: 'ellipse', triangle: 'triangle', diamond: 'diamond',
  line: 'line', straightConnector1: 'line', snip1Rect: 'rect', snip2SameRect: 'rect', round1Rect: 'roundRect',
  round2SameRect: 'roundRect', flowChartProcess: 'rect', flowChartAlternateProcess: 'roundRect',
  flowChartConnector: 'ellipse', flowChartDecision: 'diamond', frame: 'rect', plaque: 'roundRect'
};

function roleFor(ph) {
  if (!ph) return null;
  if (TITLE_TYPES.includes(ph.type)) return 'title';
  if (ph.type === 'subTitle') return 'subtitle';
  if (['body', 'obj'].includes(ph.type)) return 'body';
  return null;
}

async function parseSpTree(tree, tf, ctx, out) {
  for (const n of kids(tree)) {
    const name = n.localName;
    if (name === 'grpSp') {
      const g = xfrmOf(n);
      if (!g || !g.chOff || !g.chExt) { await parseSpTree(n, tf, ctx, out); continue; }
      const outer = applyGroup(tf, g);
      const chW = numAttr(g.chExt, 'cx', 0) || 1;
      const chH = numAttr(g.chExt, 'cy', 0) || 1;
      const inner = {
        ox: outer.x, oy: outer.y,
        cx: numAttr(g.chOff, 'x', 0), cy: numAttr(g.chOff, 'y', 0),
        sx: outer.w / chW, sy: outer.h / chH
      };
      await parseSpTree(n, inner, ctx, out);
    } else if (name === 'sp' || name === 'cxnSp') {
      const el = await parseShape(n, tf, ctx);
      if (el) out.push(el);
    } else if (name === 'pic') {
      const el = await parsePic(n, tf, ctx);
      if (el) out.push(el);
    } else if (name === 'AlternateContent') {
      const choice = kid(n, 'Fallback') || kid(n, 'Choice');
      if (choice) await parseSpTree(choice, tf, ctx, out);
    }
  }
}

function inheritChain(n, ctx) {
  const ph = placeholderOf(n);
  const nodes = [n];
  if (ph) {
    const l = findPh(ctx.layout, ph, false);
    if (l) nodes.push(l);
    const m = findPh(ctx.master, { type: ph.type, idx: null }, false);
    if (m) nodes.push(m);
  }
  return { ph, nodes };
}

function geometry(nodes, tf) {
  for (const n of nodes) {
    const g = xfrmOf(n);
    if (g) {
      const r = applyGroup(tf, g);
      return {
        x: r.x / EMU_PER_PX, y: r.y / EMU_PER_PX, w: r.w / EMU_PER_PX, h: r.h / EMU_PER_PX,
        rot: g.rot || 0, flipH: g.flipH, flipV: g.flipV
      };
    }
  }
  return null;
}

function styleRefColor(n, refName, env) {
  const style = kid(n, 'style');
  const ref = kid(style, refName);
  if (!ref || numAttr(ref, 'idx', 0) === 0) return undefined;
  return colorFromChoice(kids(ref)[0], env) || undefined;
}

async function parseShape(n, tf, ctx) {
  const env = ctx.env;
  const { ph, nodes } = inheritChain(n, ctx);
  const geo = geometry(nodes, tf);
  if (!geo) return null;
  const spPr = kid(n, 'spPr');
  const prstNode = kid(spPr, 'prstGeom');
  const prst = prstNode ? attr(prstNode, 'prst') : (kid(spPr, 'custGeom') ? 'custom' : 'rect');
  let fill = colorFromFill(spPr, env);
  if (fill === undefined) fill = styleRefColor(n, 'fillRef', env);
  const ln = kid(spPr, 'ln');
  let stroke;
  let strokeWidth = ln ? numAttr(ln, 'w', 9525) / EMU_PER_PX : 0;
  if (ln) stroke = colorFromFill(ln, env);
  if (stroke === undefined) stroke = styleRefColor(n, 'lnRef', env);
  if (stroke && !strokeWidth) strokeWidth = 1;

  const txBody = kid(n, 'txBody');
  const hasText = txBody && kids(txBody, 'p').some((p) => String(p.textContent || '').trim());
  const idName = attr(cNvPrOf(n), 'name') || '';

  if (hasText || (ph && txBody && !['pic', 'chart', 'tbl', 'dgm', 'media', 'clipArt', 'sldNum', 'dt', 'ftr', 'hdr'].includes(ph.type))) {
    if (ph && ['sldNum', 'dt', 'ftr', 'hdr'].includes(ph.type) && !hasText) return null;
    const lists = [];
    const bodyPrs = [kid(txBody, 'bodyPr')];
    nodes.slice(1).forEach((m) => {
      const tb = kid(m, 'txBody');
      if (tb) { lists.push(kid(tb, 'lstStyle')); bodyPrs.push(kid(tb, 'bodyPr')); }
    });
    let defaultSize = 18;
    let defaultFont = env.minorFont;
    if (ph) {
      const styleName = TITLE_TYPES.includes(ph.type) ? 'titleStyle'
        : ['body', 'obj', 'subTitle'].includes(ph.type) ? 'bodyStyle' : 'otherStyle';
      const txStyle = at(ctx.master && ctx.master.root, 'txStyles', styleName);
      if (txStyle) lists.push(txStyle);
      if (TITLE_TYPES.includes(ph.type)) { defaultSize = 44; defaultFont = env.majorFont; }
      else if (ph.type === 'subTitle') defaultSize = 24;
      else defaultSize = 24;
    } else if (env.defaultTextStyle) {
      lists.push(env.defaultTextStyle);
    }
    let paragraphs = parseTextBody(txBody, { lists: lists.filter(Boolean), bodyPrs: bodyPrs.filter(Boolean), defaultSize, defaultFont }, env);
    // A subtitle placeholder in PowerPoint's master uses body style (bullets) but lists no bullets itself
    if (ph && ph.type === 'subTitle') paragraphs = paragraphs.map((p) => Object.assign(p, { list: null, level: 0 }));
    const anchor = firstAttr(bodyPrs.filter(Boolean), 'anchor');
    const shape = PRST_MAP[prst] === 'roundRect' ? 'roundRect' : PRST_MAP[prst] === 'ellipse' ? 'ellipse' : 'rect';
    const el = core.textEl({
      id: core.uid('t'),
      x: geo.x, y: geo.y, w: geo.w, h: geo.h, rot: geo.rot,
      role: roleFor(ph),
      prompt: ph ? (roleFor(ph) === 'title' ? 'Click to add title' : 'Click to add text') : '',
      valign: anchor === 'ctr' ? 'middle' : anchor === 'b' ? 'bottom' : 'top',
      fill: fill || null,
      stroke: stroke || null,
      strokeWidth: stroke ? Math.round(strokeWidth * 100) / 100 : 0,
      shape,
      spacing: 0,
      paragraphs
    });
    hoistTextStyle(el);
    el.importedName = idName;
    return el;
  }

  if (prst === 'custom' && !fill && !stroke) return null;
  let shape = PRST_MAP[prst] || (fill || stroke ? 'rect' : null);
  if (!shape) return null;
  if (shape === 'line') {
    const tail = kid(ln, 'tailEnd');
    const head = kid(ln, 'headEnd');
    const tailArrow = tail && attr(tail, 'type') && attr(tail, 'type') !== 'none';
    const headArrow = head && attr(head, 'type') && attr(head, 'type') !== 'none';
    let flipH = geo.flipH, flipV = geo.flipV;
    if (headArrow && !tailArrow) { flipH = !flipH; flipV = !flipV; }
    return core.shapeEl({
      id: core.uid('s'), shape: tailArrow || headArrow ? 'arrow' : 'line',
      x: geo.x, y: geo.y, w: geo.w, h: geo.h, rot: geo.rot, flipH, flipV,
      fill: null, stroke: stroke || fill || '#000000', strokeWidth: Math.max(1, Math.round(strokeWidth * 100) / 100)
    });
  }
  let radius = 16;
  if (shape === 'roundRect') {
    const gd = kids(at(spPr, 'prstGeom', 'avLst'), 'gd')[0];
    const adj = gd ? Number(String(attr(gd, 'fmla') || '').replace(/^val\s*/, '')) : 16667;
    radius = Math.min(geo.w, geo.h) * (Number.isFinite(adj) ? adj : 16667) / 100000;
  }
  return core.shapeEl({
    id: core.uid('s'), shape, x: geo.x, y: geo.y, w: geo.w, h: geo.h, rot: geo.rot,
    fill: fill || null, stroke: stroke || null,
    strokeWidth: stroke ? Math.round(strokeWidth * 100) / 100 : 0,
    radius: Math.round(radius * 100) / 100
  });
}

async function parsePic(n, tf, ctx) {
  const { nodes } = inheritChain(n, ctx);
  const geo = geometry(nodes, tf);
  if (!geo) return null;
  const blipFill = kid(n, 'blipFill');
  const blip = kid(blipFill, 'blip');
  const rid = attr(blip, 'r:embed');
  const rel = rid ? ctx.rels[rid] : null;
  const media = rel ? await mediaDataUrl(ctx.zip, rel.target, ctx.env.media) : null;
  if (!media) return null;
  const sr = kid(blipFill, 'srcRect');
  let crop = null;
  if (sr) {
    const c = { l: numAttr(sr, 'l', 0) / 100000, t: numAttr(sr, 't', 0) / 100000, r: numAttr(sr, 'r', 0) / 100000, b: numAttr(sr, 'b', 0) / 100000 };
    if (c.l || c.t || c.r || c.b) crop = c;
  }
  return core.imageEl({
    id: attr(cNvPrOf(n), 'name') || core.uid('i'),
    src: media.url, nw: media.w, nh: media.h,
    x: geo.x, y: geo.y, w: geo.w, h: geo.h, rot: geo.rot,
    fit: 'stretch', crop
  });
}

async function parseBackground(cSld, rels, ctx) {
  const bg = kid(cSld, 'bg');
  if (!bg) return undefined;
  const bgPr = kid(bg, 'bgPr');
  if (bgPr) {
    const blip = at(bgPr, 'blipFill', 'blip');
    if (blip) {
      const rel = rels[attr(blip, 'r:embed')];
      const media = rel ? await mediaDataUrl(ctx.zip, rel.target, ctx.env.media) : null;
      if (media) return { image: media.url };
    }
    const c = colorFromFill(bgPr, ctx.env);
    if (c) return { color: c };
  }
  const ref = kid(bg, 'bgRef');
  if (ref) {
    const c = colorFromChoice(kids(ref)[0], ctx.env);
    if (c) return { color: c };
  }
  return undefined;
}

async function parseNotes(zip, slideRels, env) {
  const rel = relOfType(slideRels, '/notesSlide');
  if (!rel || !rel.target || !zip.file(rel.target)) return '';
  const doc = parseXml(await zip.file(rel.target).async('string'));
  const tree = at(doc.documentElement, 'cSld', 'spTree');
  const out = [];
  kids(tree, 'sp').forEach((sp) => {
    const ph = placeholderOf(sp);
    if (!ph || ph.type !== 'body') return;
    kids(kid(sp, 'txBody'), 'p').forEach((p) => {
      let line = '';
      kids(p).forEach((c) => {
        if (c.localName === 'r' || c.localName === 'fld') line += String((kid(c, 't') || {}).textContent || '');
        else if (c.localName === 'br') line += '\n';
      });
      out.push(line);
    });
  });
  void env;
  return out.join('\n').replace(/\s+$/, '');
}

async function parsePptxXml(zip) {
  const presPart = 'ppt/presentation.xml';
  const presFile = zip.file(presPart);
  if (!presFile) throw new Error('Not a PowerPoint presentation (ppt/presentation.xml is missing).');
  const pres = parseXml(await presFile.async('string')).documentElement;
  const presRels = await readRels(zip, presPart);
  const sz = kid(pres, 'sldSz');
  const size = {
    w: Math.round(numAttr(sz, 'cx', 12192000) / EMU_PER_PX),
    h: Math.round(numAttr(sz, 'cy', 6858000) / EMU_PER_PX)
  };

  const env = {
    parts: new Map(),
    media: new Map(),
    colors: {},
    clrMap: {},
    majorFont: 'Calibri',
    minorFont: 'Calibri',
    defaultTextStyle: kid(pres, 'defaultTextStyle'),
    scheme(name) {
      const mapped = this.clrMap[name] || ({ tx1: 'dk1', tx2: 'dk2', bg1: 'lt1', bg2: 'lt2' }[name]) || name;
      return this.colors[mapped] || this.colors[name] || null;
    }
  };

  // theme (colours + fonts) from the first master
  const masterRel = relOfType(presRels, '/slideMaster');
  const firstMaster = masterRel ? await loadPart(zip, masterRel.target, env) : null;
  let themeName = 'Imported';
  const themeRel = firstMaster ? relOfType(firstMaster.rels, '/theme') : relOfType(presRels, '/theme');
  if (themeRel && zip.file(themeRel.target)) {
    const th = parseXml(await zip.file(themeRel.target).async('string')).documentElement;
    themeName = attr(th, 'name') || themeName;
    const scheme = at(th, 'themeElements', 'clrScheme');
    kids(scheme).forEach((c) => {
      const v = colorFromChoice(kids(c)[0], { scheme: () => null });
      if (v) env.colors[c.localName] = v;
    });
    const fonts = at(th, 'themeElements', 'fontScheme');
    const major = at(fonts, 'majorFont', 'latin');
    const minor = at(fonts, 'minorFont', 'latin');
    if (major && attr(major, 'typeface')) env.majorFont = attr(major, 'typeface');
    if (minor && attr(minor, 'typeface')) env.minorFont = attr(minor, 'typeface');
  }
  const clrMapNode = firstMaster ? kid(firstMaster.root, 'clrMap') : null;
  if (clrMapNode) {
    ['bg1', 'tx1', 'bg2', 'tx2'].forEach((k) => { const v = attr(clrMapNode, k); if (v) env.clrMap[k] = v; });
  }

  const ids = kids(kid(pres, 'sldIdLst'), 'sldId');
  const slides = [];
  const images = new Map();
  const bgImages = [];
  for (const sid of ids) {
    const rel = presRels[attr(sid, 'r:id')];
    if (!rel || !rel.target || !zip.file(rel.target)) continue;
    const slidePart = rel.target;
    const doc = parseXml(await zip.file(slidePart).async('string'));
    const root = doc.documentElement;
    const rels = await readRels(zip, slidePart);
    const layoutRel = relOfType(rels, '/slideLayout');
    const layout = layoutRel ? await loadPart(zip, layoutRel.target, env) : null;
    const mRel = layout ? relOfType(layout.rels, '/slideMaster') : null;
    const master = mRel ? await loadPart(zip, mRel.target, env) : firstMaster;
    const ctx = { zip, env, rels, layout, master };
    const cSld = kid(root, 'cSld');

    let background = await parseBackground(cSld, rels, ctx);
    if (background === undefined && layout) background = await parseBackground(kid(layout.root, 'cSld'), layout.rels, { zip, env, rels: layout.rels });
    if (background === undefined && master) background = await parseBackground(kid(master.root, 'cSld'), master.rels, { zip, env, rels: master.rels });

    const elements = [];
    // Layout/master decorations that show through (shapes, pictures and
    // fixed text that are not placeholders)
    const showMaster = attr(root, 'showMasterSp') !== '0';
    const decoFrom = async (info, withMaster) => {
      if (!info || !info.spTree) return;
      const deco = [];
      const tree = { childNodes: kids(info.spTree).filter((n) => !placeholderOf(n)) };
      await parseSpTree(tree, IDENTITY, { zip, env, rels: info.rels, layout: null, master: withMaster }, deco);
      elements.push(...deco.filter((e) => e.type !== 'text' || !core.isTextEmpty(e)));
    };
    if (showMaster && layout && attr(layout.root, 'showMasterSp') !== '0') await decoFrom(master, null);
    if (showMaster) await decoFrom(layout, master);
    await parseSpTree(at(cSld, 'spTree'), IDENTITY, ctx, elements);

    // ids must be unique within the deck; keep an imported name where it is
    const seen = new Set();
    elements.forEach((e) => {
      if (!e.id || seen.has(e.id) || images.has(e.id)) e.id = core.uid(e.type[0]);
      seen.add(e.id);
      if (e.type === 'image') images.set(e.id, e.src);
      delete e.importedName;
    });

    const hasTitle = elements.some((e) => e.role === 'title');
    const hasBody = elements.filter((e) => e.role === 'body').length;
    const hasSub = elements.some((e) => e.role === 'subtitle');
    const layoutId = hasTitle ? (hasBody >= 2 ? 'two-content' : hasBody ? 'title-content' : hasSub ? 'title' : 'title-only') : 'blank';
    bgImages.push(background && background.image ? background.image : null);
    slides.push({
      id: core.uid('sl'),
      layout: layoutId,
      background: background || null,
      notes: await parseNotes(zip, rels, env),
      elements
    });
  }

  const c = env.colors;
  const customTheme = {
    name: themeName,
    bg: env.scheme('bg1') || '#ffffff',
    title: env.scheme('tx1') || '#000000',
    text: env.scheme('tx1') || '#000000',
    muted: env.scheme('tx2') || c.dk2 || '#595959',
    accent: c.accent1 || '#4472c4',
    accent2: c.accent2 || '#ed7d31',
    sectionBg: env.scheme('tx2') || c.dk2 || '#1f2937',
    sectionTitle: env.scheme('bg1') || '#ffffff',
    sectionText: env.scheme('bg2') || c.lt2 || '#e5e7eb',
    titleFont: env.majorFont,
    bodyFont: env.minorFont,
    titleBold: false
  };
  const deck = core.normalizeDeck({ version: 1, theme: 'custom', customTheme, size, slides });
  return { deck, images, bgImages };
}

async function readPptxBuffer(buf) {
  const zip = await JSZip.loadAsync(buf);
  const parsed = await parsePptxXml(zip);
  const meta = zip.file(MARGO_PART);
  if (meta) {
    try {
      const j = JSON.parse(await meta.async('string'));
      if (j && j.deck && j.fingerprint && j.fingerprint === await fingerprint(zip)) {
        const deck = core.normalizeDeck(j.deck);
        // Parsed slides line up one-to-one with the saved ones (same file, same order).
        deck.slides.forEach((s, i) => {
          if (s.background && s.background.image === '@xml') {
            s.background = parsed.bgImages[i] ? { image: parsed.bgImages[i] } : null;
          }
          s.elements = s.elements.filter((e) => {
            if (e.type !== 'image' || e.src !== '@xml') return true;
            e.src = parsed.images.get(e.id) || '';
            return !!e.src;
          });
        });
        return deck;
      }
    } catch {}
  }
  return parsed.deck;
}

async function readPptx(filePath) {
  const fs = require('fs');
  return readPptxBuffer(await fs.promises.readFile(filePath));
}

module.exports = {
  writePptx,
  readPptx,
  readPptxBuffer,
  exportHtml: (deck, title) => core.exportHtml(deck, title),
  normalizeDeck: core.normalizeDeck,
  newDeck: core.newDeck,
  _test: { MARGO_PART }
};
