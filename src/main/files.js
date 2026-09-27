const path = require('path');
const fs = require('fs');
const fsp = fs.promises;

const { marked } = require('marked');
const mammoth = require('mammoth');
const HTMLtoDOCX = require('html-to-docx');
const TurndownService = require('turndown');
const { gfm } = require('turndown-plugin-gfm');
const ExcelJS = require('exceljs');
const JSZip = require('jszip');
const fidelity = require('./docx-fidelity');
const slides = require('./slides');
const sheetIo = require('./sheet-io');

marked.setOptions({ gfm: true });

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
  emDelimiter: '*'
});
turndown.use(gfm);

/* Mammoth drops page breaks unless the style map claims them: htmlPathForBreak
   falls through to htmlPaths.empty for breakType "page". hr is one of mammoth's
   void tags, so an empty mapped hr survives the empty-element pass; a div would
   not. We swap it for Margo's own marker once the HTML is out. */
/* Underline has no default target in mammoth (findHtmlPathForRunProperty is
   called without one), so it is dropped unless the map claims it. */
/* Word offers sixteen highlight values and Margo draws nine, so the rest land
   on the nearest it can render. Without these entries mammoth drops the
   highlight completely: findHtmlPath returns nothing for an unmapped colour. */
const HIGHLIGHT_MAP = {
  yellow: 'yellow', green: 'green', cyan: 'cyan', magenta: 'pink', red: 'red',
  blue: 'blue', darkYellow: 'darkyellow', darkGreen: 'green', darkCyan: 'cyan',
  darkMagenta: 'purple', darkBlue: 'blue', darkRed: 'red',
  darkGray: 'gray', lightGray: 'gray', black: 'gray', white: 'gray'
};

const DOCX_STYLE_MAP = [
  "br[type='page'] => hr.margo-page-break",
  'u => u',
  'strike => s',
  // Paragraph styles Margo writes (and Word ships) that have a Margo shape.
  "p[style-name='Title'] => p.margo-title:fresh",
  "p[style-name='Subtitle'] => p.margo-subtitle:fresh",
  "p[style-name='Quote'] => blockquote > p:fresh",
  "p[style-name='Intense Quote'] => blockquote > p:fresh",
  "p[style-name='Code'] => pre:fresh",
  "p[style-name='heading 4'] => h4:fresh"
].concat(
  Object.keys(HIGHLIGHT_MAP).map(
    (word) => "highlight[color='" + word + "'] => mark.hl-" + HIGHLIGHT_MAP[word]
  )
);

/* Mammoth's model carries the run font, run size, paragraph alignment and
   paragraph indent, but its HTML converter ignores all four, which is why an
   imported document arrived as undifferentiated Calibri. Its converter is
   still the best thing available for numbering, nested lists, tables, images
   and hyperlinks, so rather than replace it we give each distinct combination
   of formatting a synthetic style name, generate map entries that carry it
   into a class, and turn those classes into inline styles afterwards. */

function walkModel(node, visit) {
  if (!node) return;
  visit(node);
  const kids = node.children;
  if (kids && kids.length) for (const c of kids) walkModel(c, visit);
}

function paragraphTag(styleName) {
  const s = String(styleName || '').trim();
  const m = /^heading\s*([1-6])$/i.exec(s);
  if (m) return 'h' + m[1];
  if (/^title$/i.test(s)) return 'p.margo-title';
  if (/^subtitle$/i.test(s)) return 'p.margo-subtitle';
  if (/quote/i.test(s)) return 'blockquote > p';
  if (/^code$/i.test(s)) return 'pre';
  return 'p';
}

function twipsToPt(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n / 20 : null;
}

function paragraphCss(p) {
  const css = [];
  if (p.alignment && /^(left|right|center|justify|both)$/i.test(p.alignment)) {
    css.push('text-align:' + (p.alignment.toLowerCase() === 'both' ? 'justify' : p.alignment.toLowerCase()));
  }
  const ind = p.indent || {};
  const startPt = twipsToPt(ind.start);
  const endPt = twipsToPt(ind.end);
  const firstPt = twipsToPt(ind.firstLine);
  const hangPt = twipsToPt(ind.hanging);
  if (startPt) css.push('margin-left:' + startPt.toFixed(1) + 'pt');
  if (endPt) css.push('margin-right:' + endPt.toFixed(1) + 'pt');
  if (firstPt) css.push('text-indent:' + firstPt.toFixed(1) + 'pt');
  else if (hangPt) css.push('text-indent:-' + hangPt.toFixed(1) + 'pt');
  if (p.__margoLine) css.push('line-height:' + p.__margoLine);
  if (p.__margoShade) css.push('background-color:#' + p.__margoShade);
  if (p.__margoBefore != null) css.push('margin-top:' + p.__margoBefore + 'pt');
  if (p.__margoAfter != null) css.push('margin-bottom:' + p.__margoAfter + 'pt');
  if (p.__margoRule) css.push('border-bottom:1px solid #' + p.__margoRule);
  return css.join(';');
}

function runCss(r) {
  const css = [];
  if (r.font) css.push('font-family:' + String(r.font).replace(/[;"']/g, ''));
  if (r.fontSize) css.push('font-size:' + r.fontSize + 'pt');
  if (r.__margoColor) css.push('color:#' + r.__margoColor);
  if (r.__margoShade) css.push('background-color:#' + r.__margoShade);
  return css.join(';');
}

/* Colour and line spacing are not in mammoth's model at all - its body reader
   never looks at w:color or w:spacing - so they are read straight from the
   XML and matched to the model by document order. If the counts disagree the
   correlation is abandoned, so the failure mode is losing colour, never
   painting text the wrong colour. */
function readDirectFormatting(xml) {
  const colors = [];
  // Self-closing <w:r/> and <w:p/> count too: mammoth's model has them, and
  // one uncounted empty paragraph abandoned every correlation below.
  const runRe = /<w:r(?:\s[^>]*?)?\/>|<w:r(?:\s[^>]*)?>[\s\S]*?<\/w:r>/g;
  let m;
  const runShades = [];
  while ((m = runRe.exec(xml))) {
    const c = /<w:color[^>]*w:val="([0-9A-Fa-f]{6})"/.exec(m[0]);
    colors.push(c && c[1].toLowerCase() !== 'auto' ? c[1] : null);
    /* Character shading is how a highlight colour Word has no name for
       travels; a named highlight is mammoth's and is left to it. */
    const rPr = /<w:rPr>[\s\S]*?<\/w:rPr>/.exec(m[0]);
    const rs = rPr && !/<w:highlight\b/.test(rPr[0]) ? /<w:shd[^>]*w:fill="([0-9A-Fa-f]{6})"/.exec(rPr[0]) : null;
    runShades.push(rs && rs[1].toLowerCase() !== 'ffffff' ? rs[1] : null);
  }
  const befores = [];
  const afters = [];
  const rules = [];
  const lines = [];
  const shades = [];
  const paraRe = /<w:p(?:\s[^>]*?)?\/>|<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g;
  while ((m = paraRe.exec(xml))) {
    const s = /<w:spacing[^>]*w:line="(\d+)"[^>]*\/?>/.exec(m[0]);
    const rule = /<w:spacing[^>]*w:lineRule="([a-z]+)"/i.exec(m[0]);
    if (s && (!rule || rule[1].toLowerCase() === 'auto')) {
      const mult = parseInt(s[1], 10) / 240;
      lines.push(mult > 0.4 && mult < 5 ? mult.toFixed(2) : null);
    } else {
      lines.push(null);
    }
    /* Paragraph shading lives in pPr. A run-level w:shd is character shading
       and would paint the whole paragraph if it were picked up here. */
    const props = /<w:pPr>[\s\S]*?<\/w:pPr>/.exec(m[0]);
    const shd = props ? /<w:shd[^>]*w:fill="([0-9A-Fa-f]{6})"/.exec(props[0]) : null;
    shades.push(shd && shd[1].toLowerCase() !== 'ffffff' ? shd[1] : null);
    /* Space before and after a paragraph, and a bottom rule (how a
       horizontal line is written). Autospacing is left to the reader. */
    const sp = props ? /<w:spacing\b[^>]*\/>/.exec(props[0]) : null;
    const b = sp && !/w:beforeAutospacing="(1|true)"/.test(sp[0]) ? /w:before="(\d+)"/.exec(sp[0]) : null;
    const a = sp && !/w:afterAutospacing="(1|true)"/.test(sp[0]) ? /w:after="(\d+)"/.exec(sp[0]) : null;
    befores.push(b ? +(parseInt(b[1], 10) / 20).toFixed(1) : null);
    afters.push(a ? +(parseInt(a[1], 10) / 20).toFixed(1) : null);
    const pBdr = props ? /<w:pBdr>[\s\S]*?<\/w:pBdr>/.exec(props[0]) : null;
    const bottom = pBdr ? /<w:bottom\b[^>]*\/>/.exec(pBdr[0]) : null;
    const ruled = bottom && !/w:val="(nil|none)"/.test(bottom[0]);
    const ruleColor = ruled ? /w:color="([0-9A-Fa-f]{6})"/.exec(bottom[0]) : null;
    rules.push(ruled ? (ruleColor ? ruleColor[1] : 'a6a6a6') : null);
  }
  return { colors, lines, shades, runShades, befores, afters, rules };
}

function collectFormatting(doc, direct) {
  const runs = [];
  const paras = [];
  walkModel(doc, (node) => {
    if (node.type === 'run') runs.push(node);
    else if (node.type === 'paragraph') paras.push(node);
  });
  if (direct.colors.length === runs.length) {
    runs.forEach((r, i) => { if (direct.colors[i]) r.__margoColor = direct.colors[i]; });
    if (direct.runShades) runs.forEach((r, i) => { if (direct.runShades[i]) r.__margoShade = direct.runShades[i]; });
  }
  if (direct.befores && direct.befores.length === paras.length) {
    paras.forEach((p, i) => {
      if (direct.befores[i] != null) p.__margoBefore = direct.befores[i];
      if (direct.afters[i] != null) p.__margoAfter = direct.afters[i];
      if (direct.rules[i]) p.__margoRule = direct.rules[i];
    });
  }
  if (direct.lines.length === paras.length) {
    paras.forEach((p, i) => { if (direct.lines[i]) p.__margoLine = direct.lines[i]; });
  }
  if (direct.shades && direct.shades.length === paras.length) {
    paras.forEach((p, i) => { if (direct.shades[i]) p.__margoShade = direct.shades[i]; });
  }
  return { runs, paras };
}

function buildFormattingMap(doc, direct) {
  const { runs, paras } = collectFormatting(doc, direct);
  const runStyles = new Map();
  const paraStyles = new Map();

  runs.forEach((r) => {
    const css = runCss(r);
    if (!css) return;
    if (!runStyles.has(css)) runStyles.set(css, 'MargoRun' + (runStyles.size + 1));
  });
  paras.forEach((p) => {
    // List paragraphs are matched by mammoth on their numbering, and a custom
    // style-name entry would win over that and destroy the nesting.
    if (p.numbering) return;
    const css = paragraphCss(p);
    if (!css) return;
    const key = paragraphTag(p.styleName) + '|' + css;
    if (!paraStyles.has(key)) paraStyles.set(key, 'MargoPara' + (paraStyles.size + 1));
  });

  const styleMap = [];
  const classCss = new Map();
  runStyles.forEach((name, css) => {
    const cls = name.toLowerCase();
    styleMap.push("r[style-name='" + name + "'] => span." + cls);
    classCss.set(cls, css);
  });
  paraStyles.forEach((name, key) => {
    const cut = key.indexOf('|');
    const tag = key.slice(0, cut);
    const cls = name.toLowerCase();
    styleMap.push("p[style-name='" + name + "'] => " + tag + '.' + cls + ':fresh');
    classCss.set(cls, key.slice(cut + 1));
  });
  return { styleMap, classCss, runStyles, paraStyles };
}

function applyFormattingNames(doc, direct, built) {
  collectFormatting(doc, direct);
  walkModel(doc, (node) => {
    if (node.type === 'run') {
      const css = runCss(node);
      if (!css) return;
      const name = built.runStyles.get(css);
      // A run styled "Strong" loses its default mapping once renamed, so fold
      // the weight in rather than dropping it.
      if (name) {
        if (/^strong$/i.test(node.styleName || '')) node.isBold = true;
        node.styleName = name;
      }
    } else if (node.type === 'paragraph') {
      if (node.numbering) return;
      const css = paragraphCss(node);
      if (!css) return;
      const name = built.paraStyles.get(paragraphTag(node.styleName) + '|' + css);
      if (name) node.styleName = name;
    }
  });
}

function inlineFormattingClasses(html, classCss) {
  if (!classCss || !classCss.size) return html;
  /* A synthetic class can share its attribute with a real one
     ("margo-title margopara3"), so each class list is taken apart. */
  return html.replace(/ class="([^"]*)"/g, (m, list) => {
    const keep = [];
    const css = [];
    list.split(/\s+/).filter(Boolean).forEach((c) => {
      if (classCss.has(c)) css.push(classCss.get(c));
      else keep.push(c);
    });
    if (!css.length) return m;
    return (keep.length ? ' class="' + keep.join(' ') + '"' : '') + ' style="' + css.join(';') + '"';
  });
}

async function convertDocxHtml(filePath) {
  const html = await convertDocxHtmlBase(filePath);
  /* Picture sizes, table borders, rules and checklists mammoth does not
     carry, matched back to its output by document order. */
  try {
    const zip = await JSZip.loadAsync(await fsp.readFile(filePath));
    const docFile = zip.file('word/document.xml');
    const xml = docFile ? await docFile.async('string') : '';
    // Page breaks first: the DOM pass would split <p><hr></p> apart.
    return fidelity.postProcessImportedHtml(restorePageBreaks(html), fidelity.readImportExtras(xml));
  } catch {
    return html;
  }
}

async function convertDocxHtmlBase(filePath) {
  try {
    return await convertDocxHtmlInner(filePath);
  } catch (err) {
    /* A dangling relationship or malformed part makes mammoth throw while
       writing HTML. Losing the formatting pass, or worst case falling back
       to plain text, beats refusing to open the document at all. */
    try {
      const plain = await mammoth.convertToHtml({ path: filePath }, { styleMap: DOCX_STYLE_MAP, ignoreEmptyParagraphs: false });
      return plain.value || '';
    } catch {
      const raw = await mammoth.extractRawText({ path: filePath }).catch(() => null);
      if (raw && raw.value) {
        return raw.value.split(/\r?\n/).filter(Boolean)
          .map((line) => '<p>' + escapeHtml(line) + '</p>').join('');
      }
      throw err;
    }
  }
}

async function convertDocxHtmlInner(filePath) {
  const zip = await JSZip.loadAsync(await fsp.readFile(filePath));
  const docFile = zip.file('word/document.xml');
  const xml = docFile ? await docFile.async('string') : '';
  const direct = readDirectFormatting(xml);

  // First conversion only to get at the document model; mammoth exposes it
  // through transformDocument and nowhere else.
  let model = null;
  await mammoth.convertToHtml({ path: filePath }, {
    styleMap: DOCX_STYLE_MAP,
    ignoreEmptyParagraphs: false,
    transformDocument: (doc) => { model = doc; return doc; }
  });
  if (!model) {
    const plain = await mammoth.convertToHtml({ path: filePath }, { styleMap: DOCX_STYLE_MAP, ignoreEmptyParagraphs: false });
    return plain.value || '';
  }

  let built;
  try {
    built = buildFormattingMap(model, direct);
  } catch {
    built = { styleMap: [], classCss: new Map(), runStyles: new Map(), paraStyles: new Map() };
  }
  if (!built.styleMap.length) {
    const plain = await mammoth.convertToHtml({ path: filePath }, { styleMap: DOCX_STYLE_MAP, ignoreEmptyParagraphs: false });
    return plain.value || '';
  }

  /* Empty paragraphs are the author's blank lines; mammoth drops them by
     default, so every blank line vanished on the first round trip. */
  const result = await mammoth.convertToHtml({ path: filePath }, {
    styleMap: DOCX_STYLE_MAP.concat(built.styleMap),
    ignoreEmptyParagraphs: false,
    transformDocument: (doc) => { applyFormattingNames(doc, direct, built); return doc; }
  });
  return inlineFormattingClasses(result.value || '', built.classCss);
}
const MARGO_PAGE_BREAK = '<div data-margo-page-break style="page-break-before:always"></div>';

const MAPPED_BREAK = '<hr[^>]*class="[^"]*margo-page-break[^"]*"[^>]*\\/?>';

function restorePageBreaks(html) {
  return String(html || '')
    // A break in its own Word paragraph arrives as <p><hr/></p>. Replacing
    // just the hr would leave the marker nested, and splitPages() only
    // inspects top-level nodes, so the page would never split. Take the
    // wrapping paragraph with it.
    .replace(new RegExp('<p[^>]*>\\s*(?:' + MAPPED_BREAK + ')\\s*</p>', 'gi'), MARGO_PAGE_BREAK)
    .replace(new RegExp(MAPPED_BREAK, 'gi'), MARGO_PAGE_BREAK);
}

const MD_EXTS = ['.md', '.markdown', '.txt'];
const MAX_OPEN_BYTES = 500 * 1024 * 1024;

function kindFromPath(p) {
  const ext = path.extname(p).toLowerCase();
  if (MD_EXTS.includes(ext)) return 'md';
  if (ext === '.docx') return 'doc';
  if (ext === '.xlsx' || ext === '.csv') return 'sheet';
  if (ext === '.pdf') return 'pdf';
  if (ext === '.pptx') return 'slides';
  return null;
}

/* ---------------- open ---------------- */

async function openPath(filePath) {
  const stat = await fsp.stat(filePath);
  if (!stat.isFile()) throw new Error('That is not a file Margo can open.');
  if (stat.size > MAX_OPEN_BYTES) throw new Error('File is larger than 500 MB — too big for Margo.');
  const ext = path.extname(filePath).toLowerCase();
  const name = path.basename(filePath);

  if (MD_EXTS.includes(ext)) {
    const markdown = await fsp.readFile(filePath, 'utf8');
    return { kind: 'md', name, path: filePath, markdown };
  }
  if (ext === '.docx') {
    const converted = await convertDocxHtml(filePath);
    const html = restorePageBreaks(converted.trim()) || '<p></p>';
    const notes = await readDocxNotes(filePath);
    // A file Margo saved carries its exact layout; anything else we read from
    // the Word section properties.
    const layout = (await readDocxLayout(filePath)) || (await readDocxSectionLayout(filePath));
    return { kind: 'doc', name, path: filePath, html, notes, layout };
  }
  if (ext === '.xlsx') {
    return { kind: 'sheet', name, path: filePath, ...(await sheetIo.readXlsx(filePath)) };
  }
  if (ext === '.csv') {
    return { kind: 'sheet', name, path: filePath, ...(await sheetIo.readCsv(filePath)) };
  }
  if (ext === '.pdf') {
    // viewer loads the bytes itself via file:read-binary
    return { kind: 'pdf', name, path: filePath };
  }
  if (ext === '.pptx') {
    const deck = await slides.readPptx(filePath);
    return { kind: 'slides', name, path: filePath, deck };
  }
  throw new Error(`Unsupported file type: ${ext || '(none)'}`);
}

/* ---------------- save ---------------- */

function saveFilters(kind) {
  if (kind === 'md') {
    return [
      { name: 'Markdown', extensions: ['md'] },
      { name: 'Word document', extensions: ['docx'] },
      { name: 'HTML', extensions: ['html'] },
      { name: 'Plain text', extensions: ['txt'] }
    ];
  }
  if (kind === 'doc') {
    return [
      { name: 'Word document', extensions: ['docx'] },
      { name: 'Markdown', extensions: ['md'] },
      { name: 'HTML', extensions: ['html'] }
    ];
  }
  if (kind === 'pdf') {
    return [{ name: 'PDF document', extensions: ['pdf'] }];
  }
  if (kind === 'slides') {
    return [{ name: 'PowerPoint presentation', extensions: ['pptx'] }];
  }
  return [
    { name: 'Excel workbook', extensions: ['xlsx'] },
    { name: 'CSV (active sheet)', extensions: ['csv'] }
  ];
}

function suggestSavePath(req, documentsDir) {
  const base = (req.suggestedName || 'Untitled').replace(/\.[^.]+$/, '');
  const dir = req.currentPath ? path.dirname(req.currentPath) : documentsDir;
  const defExt = req.kind === 'md' ? '.md' : req.kind === 'doc' ? '.docx' : req.kind === 'pdf' ? '.pdf' : req.kind === 'slides' ? '.pptx' : '.xlsx';
  return path.join(dir, base + defExt);
}

/* Writing straight over the target truncates it first, so a write that dies
   half way - full disk, removable drive pulled, antivirus lock, power cut -
   leaves the author holding a truncated file where their document used to be.
   Every save goes to a sibling temp file and is renamed into place instead:
   rename is atomic, so the target is either the old document or the new one,
   never a half-written one. The temp file is a sibling so the rename stays on
   one volume; across volumes it would degrade to a copy and lose atomicity.
   If the target is locked the rename throws and the original survives, which
   is what the caller reports to the author. */
let tmpCounter = 0;
/* Three more things a plain write-then-rename got wrong:
   - a symlinked document had its link replaced by a regular file, so the
     real file never changed; the write now goes to the link's target;
   - the replacement took default permissions, so a private (0600) file came
     back readable by everyone after one save; the old mode is carried over;
   - the data was renamed into place before it reached the disk, so a power
     cut shortly after a save could leave an empty file; it is fsynced first.
   On Windows an antivirus or indexer holding the file briefly makes the
   rename fail with EPERM/EBUSY, so that is retried a few times first. */
async function resolveWriteTarget(target) {
  try {
    const st = await fsp.lstat(target);
    if (st.isSymbolicLink()) return await fsp.realpath(target);
  } catch {}
  return target;
}

async function renameWithRetry(from, to) {
  const delays = process.platform === 'win32' ? [50, 150, 400] : [];
  for (let i = 0; ; i++) {
    try {
      return await fsp.rename(from, to);
    } catch (err) {
      if (i >= delays.length || !['EPERM', 'EBUSY', 'EACCES'].includes(err.code)) throw err;
      await new Promise((r) => setTimeout(r, delays[i]));
    }
  }
}

async function atomicWrite(target, write) {
  const dest = await resolveWriteTarget(target);
  const dir = path.dirname(dest);
  const tmp = path.join(
    dir,
    '.' + path.basename(dest) + '.margo-' + process.pid + '-' + (tmpCounter++) + '.tmp'
  );
  let mode = null;
  try { mode = (await fsp.stat(dest)).mode & 0o7777; } catch {}
  try {
    await write(tmp);
    if (mode != null && process.platform !== 'win32') {
      try { await fsp.chmod(tmp, mode); } catch {}
    }
    try {
      const fh = await fsp.open(tmp, 'r+');
      try { await fh.sync(); } finally { await fh.close(); }
    } catch {}
    await renameWithRetry(tmp, dest);
  } catch (err) {
    try { await fsp.unlink(tmp); } catch {}
    throw err;
  }
}

async function save({ kind, path: target, data, thumbDataUrl }) {
  const ext = path.extname(target).toLowerCase();

  if (kind === 'md') {
    const md = data.markdown ?? '';
    if (MD_EXTS.includes(ext)) return atomicWrite(target, (tmp) => fsp.writeFile(tmp, md, 'utf8'));
    if (ext === '.docx') {
      let buf = await htmlToDocxBuffer(markdownBody(data), titleOf(target));
      buf = await maybeEmbedDocxThumb(buf, thumbDataUrl);
      return atomicWrite(target, (tmp) => fsp.writeFile(tmp, buf));
    }
    if (ext === '.html') {
      const html = htmlDocument(markdownBody(data), titleOf(target));
      return atomicWrite(target, (tmp) => fsp.writeFile(tmp, html, 'utf8'));
    }
    throw new Error(`Can't save markdown as ${ext}`);
  }

  if (kind === 'doc') {
    const html = data.html ?? '<p></p>';
    if (ext === '.docx') {
      let buf = await htmlToDocxBuffer(html, titleOf(target), data.layout);
      buf = await maybeEmbedDocxThumb(buf, thumbDataUrl);
      buf = await maybeEmbedDocxNotes(buf, data.notes);
      buf = await maybeEmbedDocxLayout(buf, data.layout);
      return atomicWrite(target, (tmp) => fsp.writeFile(tmp, buf));
    }
    if (MD_EXTS.includes(ext)) {
      const md = turndown.turndown(html);
      return atomicWrite(target, (tmp) => fsp.writeFile(tmp, md, 'utf8'));
    }
    if (ext === '.html') {
      const out = docHtmlDocument(html, titleOf(target), data.layout);
      return atomicWrite(target, (tmp) => fsp.writeFile(tmp, out, 'utf8'));
    }
    throw new Error(`Can't save document as ${ext}`);
  }

  if (kind === 'sheet') {
    const sheets = data.sheets && data.sheets.length ? data.sheets : [{ name: 'Sheet1', rows: [] }];
    if (ext === '.xlsx') {
      return atomicWrite(target, (tmp) => sheetIo.writeXlsx(tmp, { ...data, sheets }));
    }
    if (ext === '.csv') {
      return atomicWrite(target, (tmp) => sheetIo.writeCsv(tmp, { ...data, sheets }));
    }
    throw new Error(`Can't save spreadsheet as ${ext}`);
  }

  if (kind === 'pdf') {
    if (ext === '.pdf') {
      const buf = Buffer.from(data.base64, 'base64');
      return atomicWrite(target, (tmp) => fsp.writeFile(tmp, buf));
    }
    throw new Error(`Can't save PDF as ${ext}`);
  }

  if (kind === 'slides') {
    if (ext === '.pptx') {
      const buf = await slides.writePptx(data.deck, titleOf(target));
      return atomicWrite(target, (tmp) => fsp.writeFile(tmp, buf));
    }
    throw new Error(`Can't save a presentation as ${ext}`);
  }

  throw new Error(`Unknown document kind: ${kind}`);
}

function titleOf(p) {
  return path.basename(p, path.extname(p));
}

/* html-to-docx 1.8.0 writes an empty w:rPr for <s>, <strike>, <del> and
   text-decoration:line-through alike, so strikethrough never reached the file.
   The text is fenced with private-use characters before conversion, and the
   runs between the fences get w:strike once the document is built. Fencing the
   text rather than matching elements afterwards keeps it correct when other
   formatting nests inside the struck span and splits it across several runs. */
const STRIKE_ON = '\uE000';
const STRIKE_OFF = '\uE001';

function fenceStrikeText(html) {
  return String(html || '').replace(
    /<(s|strike|del)(\s[^>]*)?>([\s\S]*?)<\/\1>/gi,
    (m, tag, attrs, inner) => '<' + tag + (attrs || '') + '>' + STRIKE_ON + inner + STRIKE_OFF + '</' + tag + '>'
  );
}

function applyStrikeFences(xml) {
  let inside = false;
  const out = xml.replace(/<w:r(?:\s[^>]*)?>[\s\S]*?<\/w:r>/g, (run) => {
    const opens = run.indexOf(STRIKE_ON) >= 0;
    const closes = run.indexOf(STRIKE_OFF) >= 0;
    const struck = inside || opens;
    if (opens && !closes) inside = true;
    if (closes) inside = false;

    let r = run.split(STRIKE_ON).join('').split(STRIKE_OFF).join('');
    if (!struck) return r;
    if (/<w:rPr\s*\/>/.test(r)) {
      return r.replace(/<w:rPr\s*\/>/, '<w:rPr><w:strike w:val="true"/></w:rPr>');
    }
    if (/<w:rPr(?:\s[^>]*)?>/.test(r)) {
      return r.replace(/<w:rPr(?:\s[^>]*)?>/, (m) => m + '<w:strike w:val="true"/>');
    }
    return r.replace(/^(<w:r(?:\s[^>]*)?>)/, '$1<w:rPr><w:strike w:val="true"/></w:rPr>');
  });
  // Any fence that survived (text outside a run) must not reach the reader.
  return out.split(STRIKE_ON).join('').split(STRIKE_OFF).join('');
}

/* Page dimensions in twips, portrait-oriented: html-to-docx swaps width and
   height itself when the orientation is landscape. Without this every export
   came out US Letter no matter what the document actually was. */
const PAGE_TWIPS = {
  letter: { width: 12240, height: 15840 },
  a4: { width: 11906, height: 16838 },
  legal: { width: 12240, height: 20160 },
  executive: { width: 10440, height: 15120 },
  a5: { width: 8391, height: 11906 }
};

function docxPageSize(layout) {
  const exact = layout && layout.pageTw;
  if (exact && exact.w > 0 && exact.h > 0) {
    return exact.w > exact.h
      ? { width: exact.h, height: exact.w }
      : { width: exact.w, height: exact.h };
  }
  const measured = layout && layout.pageIn;
  if (measured && measured.w > 0 && measured.h > 0) {
    const w = Math.round(measured.w * TWIPS_PER_INCH);
    const h = Math.round(measured.h * TWIPS_PER_INCH);
    return w > h ? { width: h, height: w } : { width: w, height: h };
  }
  return PAGE_TWIPS[(layout && layout.size) || 'letter'] || PAGE_TWIPS.letter;
}

async function htmlToDocxBuffer(bodyHtml, title, layout = {}) {
  layout = layout || {};
  const marginPresets = {
    normal: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
    narrow: { top: 720, right: 720, bottom: 720, left: 720 },
    moderate: { top: 1080, right: 1080, bottom: 1080, left: 1080 },
    wide: { top: 1440, right: 2880, bottom: 1440, left: 2880 }
  };
  const twips = (inches) => Math.round(inches * TWIPS_PER_INCH);
  const exactMargins = layout && layout.marginTw;
  const measured = layout && layout.marginIn;
  const base = exactMargins
    ? { ...exactMargins }
    : measured
      ? {
        top: twips(measured.top), right: twips(measured.right),
        bottom: twips(measured.bottom), left: twips(measured.left)
      }
      : (layout && marginPresets[layout.margins]) || marginPresets.normal;
  // html-to-docx writes these straight into pgMar, and undefined keys reach the
  // XML as the literal string "undefined".
  const margins = { ...base, header: 720, footer: 720, gutter: 0 };
  const orientation = (layout && layout.orientation === 'landscape') ? 'landscape' : 'portrait';
  const pageSize = docxPageSize(layout);
  const contentWidthTw = Math.max(1440,
    (orientation === 'landscape' ? pageSize.height : pageSize.width) - margins.left - margins.right);

  /* Highlights, spacing, styles, header rows, borders, rules and the space
     between two formatted words are fenced here and written into the XML
     once html-to-docx is done (see docx-fidelity.js). */
  const prep = fidelity.prepareDocxHtml(bodyHtml, { contentWidthTw });
  const htmlString =
    `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${escapeHtml(title || 'Document')}</title></head>` +
    `<body>${fenceStrikeText(prep.html)}</body></html>`;

  const hasHeader = !!layout.headerText;
  const hasFooter = !!(layout.footerText || layout.showPageNumbers);
  const docOpts = {
    title: title || 'Document',
    font: 'Calibri',
    fontSize: 22,
    table: { row: { cantSplit: true } },
    // Without header: true html-to-docx drops the header altogether.
    header: hasHeader,
    footer: hasFooter,
    pageNumber: false,
    orientation,
    pageSize,
    margins
  };

  // Placeholders: the parts are rewritten whole by finishDocx.
  const headerHtml = hasHeader ? '<p>header</p>' : null;
  const footerHtml = hasFooter ? '<p>footer</p>' : null;

  let buf;
  try {
    buf = await HTMLtoDOCX(htmlString, headerHtml, docOpts, footerHtml);
  } catch (err) {
    /* html-to-docx throws on markup it cannot model (odd table geometry,
       exotic CSS). Losing some formatting beats refusing to save: retry
       with the styling taken off tables and cells. */
    const safe = htmlString
      .replace(/<(table|td|th|col|colgroup|tr)\b([^>]*?)\sstyle="[^"]*"/gi, '<$1$2')
      .replace(/<colgroup\b[\s\S]*?<\/colgroup>/gi, '');
    buf = await HTMLtoDOCX(safe, headerHtml, docOpts, footerHtml);
  }
  const done = await fidelity.finishDocx(Buffer.isBuffer(buf) ? buf : Buffer.from(buf), prep, {
    extraPass: (xml) => (xml.indexOf(STRIKE_ON) >= 0 ? applyStrikeFences(xml) : xml),
    headerText: layout.headerText || '',
    footerText: layout.footerText || '',
    pageNumbers: !!layout.showPageNumbers,
    contentWidthTw
  });
  return Buffer.isBuffer(done) ? done : Buffer.from(done);
}

function parseThumbDataUrl(dataUrl) {
  if (!dataUrl || typeof dataUrl !== 'string') return null;
  const m = /^data:(image\/(?:png|jpeg|jpg));base64,(.+)$/i.exec(dataUrl);
  if (!m) return null;
  const mime = m[1].toLowerCase() === 'image/jpg' ? 'image/jpeg' : m[1].toLowerCase();
  return { mime, buf: Buffer.from(m[2], 'base64') };
}

/* Embed first-page preview so Windows/Office can show a desktop thumbnail. */
async function embedDocxThumbnail(docxBuf, imageBuf, mime) {
  const isPng = mime === 'image/png';
  const ext = isPng ? 'png' : 'jpeg';
  const part = `docProps/thumbnail.${ext}`;
  const zip = await JSZip.loadAsync(docxBuf);
  zip.file(part, imageBuf);

  let ct = await zip.file('[Content_Types].xml').async('string');
  const override = `<Override PartName="/${part}" ContentType="${mime}"/>`;
  if (!ct.includes(`thumbnail.${ext}`)) {
    if (!new RegExp(`Extension="${ext}"`, 'i').test(ct)) {
      ct = ct.replace('<Types', `<Types`);
      ct = ct.replace(
        /<Types[^>]*>/,
        (open) => `${open}<Default Extension="${ext}" ContentType="${mime}"/>`
      );
    }
    ct = ct.replace('</Types>', `${override}</Types>`);
    zip.file('[Content_Types].xml', ct);
  }

  const relsPath = '_rels/.rels';
  let rels = await zip.file(relsPath).async('string');
  const thumbType = 'http://schemas.openxmlformats.org/package/2006/relationships/metadata/thumbnail';
  if (!rels.includes(thumbType) && !rels.includes('thumbnail.')) {
    const ids = [...rels.matchAll(/Id="(rId\d+)"/g)].map((x) => Number(x[1].slice(3)));
    const next = (ids.length ? Math.max(...ids) : 0) + 1;
    const rel =
      `<Relationship Id="rId${next}" Type="${thumbType}" Target="docProps/thumbnail.${ext}"/>`;
    rels = rels.replace('</Relationships>', `${rel}</Relationships>`);
    zip.file(relsPath, rels);
  }

  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

async function maybeEmbedDocxThumb(docxBuf, thumbDataUrl) {
  const parsed = parseThumbDataUrl(thumbDataUrl);
  if (!parsed || parsed.buf.length < 200) return docxBuf;
  try {
    return await embedDocxThumbnail(docxBuf, parsed.buf, parsed.mime);
  } catch {
    return docxBuf;
  }
}

async function readDocxEmbeddedThumb(filePath) {
  try {
    const zip = await JSZip.loadAsync(await fsp.readFile(filePath));
    const jpeg = zip.file('docProps/thumbnail.jpeg');
    const png = zip.file('docProps/thumbnail.png');
    const part = jpeg || png;
    if (!part) return null;
    const buf = await part.async('nodebuffer');
    if (!buf || buf.length < 200) return null;
    const mime = jpeg ? 'image/jpeg' : 'image/png';
    return `data:${mime};base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}

const MARGO_NOTES_PART = 'customXml/margo-notes.json';
const MARGO_NOTES_CT = 'application/json';

async function readDocxNotes(filePath) {
  try {
    const buf = await fsp.readFile(filePath);
    const zip = await JSZip.loadAsync(buf);
    const file = zip.file(MARGO_NOTES_PART);
    if (!file) return [];
    const raw = JSON.parse(await file.async('string'));
    if (!raw || !Array.isArray(raw.notes)) return [];
    return raw.notes.filter((n) => n && typeof n.id === 'string').map((n) => ({
      id: n.id,
      quote: String(n.quote || ''),
      body: String(n.body || ''),
      done: !!n.done,
      createdAt: n.createdAt || null
    }));
  } catch {
    return [];
  }
}

async function embedDocxNotes(docxBuf, notes) {
  const list = Array.isArray(notes) ? notes : [];
  const zip = await JSZip.loadAsync(docxBuf);
  const payload = JSON.stringify({ version: 1, notes: list }, null, 0);
  zip.file(MARGO_NOTES_PART, payload);

  let ct = await zip.file('[Content_Types].xml').async('string');
  if (!ct.includes(MARGO_NOTES_PART)) {
    const override = `<Override PartName="/${MARGO_NOTES_PART}" ContentType="${MARGO_NOTES_CT}"/>`;
    ct = ct.replace('</Types>', `${override}</Types>`);
    zip.file('[Content_Types].xml', ct);
  }

  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

async function maybeEmbedDocxNotes(docxBuf, notes) {
  try {
    return await embedDocxNotes(docxBuf, notes);
  } catch {
    return docxBuf;
  }
}

const MARGO_LAYOUT_PART = 'customXml/margo-layout.json';
const MARGO_LAYOUT_CT = 'application/json';

/* Word stores page geometry in twentieths of a point (twips). Margo's dropdowns
   only carry presets, so we report the nearest preset for the UI and keep the
   measured values alongside so pages can render at their true size. */
const TWIPS_PER_INCH = 1440;
const PAGE_SIZES = [
  { id: 'letter', w: 8.5, h: 11 },
  { id: 'a4', w: 8.27, h: 11.69 },
  { id: 'legal', w: 8.5, h: 14 },
  { id: 'executive', w: 7.25, h: 10.5 },
  { id: 'a5', w: 5.83, h: 8.27 }
];
// Word's own margin presets, matched by name so the dropdown reflects what the
// author picked in Word.
const MARGIN_PRESETS = [
  { id: 'narrow', side: 0.5 },
  { id: 'moderate', side: 0.75 },
  { id: 'normal', side: 1 },
  { id: 'wide', side: 2 }
];

function attrOf(tagXml, name) {
  const m = tagXml && tagXml.match(new RegExp(name.replace(':', '\\:') + '="([^"]*)"'));
  return m ? m[1] : null;
}

function nearestPageSize(wIn, hIn) {
  const longEdge = Math.max(wIn, hIn);
  const shortEdge = Math.min(wIn, hIn);
  let best = null;
  for (const s of PAGE_SIZES) {
    const d = Math.abs(s.w - shortEdge) + Math.abs(s.h - longEdge);
    if (!best || d < best.d) best = { id: s.id, d };
  }
  return best && best.d < 0.6 ? best.id : 'letter';
}

function nearestMargins(sideIn) {
  let best = null;
  for (const m of MARGIN_PRESETS) {
    const d = Math.abs(m.side - sideIn);
    if (!best || d < best.d) best = { id: m.id, d };
  }
  return best ? best.id : 'normal';
}

/* Reduce a header or footer part to its text. Margo shows one header and one
   footer, so the first part of each kind is what it can carry; Word may also
   define separate first-page and even-page variants. */
function textFromWordPart(xml) {
  /* Fields go first: a page number's instruction and cached result are not
     header text, and "Page {PAGE} of {NUMPAGES}" would otherwise surface as
     a footer reading "Page 1 of 1" forever. The words around a page number
     are dropped with it. */
  return fidelity.stripFields(xml)
    .replace(/<w:tab[^>]*\/?>/g, ' ')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .split('\n').map((s) => s.trim().replace(/\s*\bPage\s*(of)?\s*$/i, '').trim()).filter(Boolean).join(' ')
    .trim();
}

async function readDocxHeaderFooter(zip) {
  const out = {};
  const pick = async (prefix) => {
    const names = Object.keys(zip.files)
      .filter((f) => new RegExp('^word/' + prefix + '\\d*\\.xml$').test(f))
      .sort();
    for (const name of names) {
      const text = textFromWordPart(await zip.file(name).async('string'));
      // A part holding only a page number is not worth surfacing as text.
      if (text && !/^[0-9\s]*$/.test(text)) return text;
    }
    return '';
  };
  const header = await pick('header');
  const footer = await pick('footer');
  if (header) out.headerText = header;
  if (footer) out.footerText = footer;
  /* Page numbers are shown only when the document has them; a Word file
     without any used to gain "Page 1 of N" on its first save in Margo. */
  let numbered = false;
  for (const name of Object.keys(zip.files).filter((f) => /^word\/(header|footer)\d*\.xml$/.test(f))) {
    if (fidelity.hasPageField(await zip.file(name).async('string'))) { numbered = true; break; }
  }
  out.showPageNumbers = numbered;
  return out;
}

async function readDocxSectionLayout(filePath) {
  try {
    const buf = await fsp.readFile(filePath);
    const zip = await JSZip.loadAsync(buf);
    const docFile = zip.file('word/document.xml');
    if (!docFile) return null;
    const xml = await docFile.async('string');

    /* Margo carries one layout for the whole document. Take the first
       section rather than the body default, so a document that changes
       geometry part way through opens at the size its first pages use. */
    const sections = xml.match(/<w:sectPr[\s\S]*?<\/w:sectPr>/g);
    const sect = sections && sections.length ? sections[0] : null;
    if (!sect) return null;

    const pgSz = (sect.match(/<w:pgSz[^>]*\/?>/) || [])[0];
    const pgMar = (sect.match(/<w:pgMar[^>]*\/?>/) || [])[0];
    if (!pgSz && !pgMar) return null;

    const layout = {};

    if (pgSz) {
      const wTw = parseFloat(attrOf(pgSz, 'w:w'));
      const hTw = parseFloat(attrOf(pgSz, 'w:h'));
      const orient = (attrOf(pgSz, 'w:orient') || '').toLowerCase();
      if (wTw > 0 && hTw > 0) {
        const wIn = wTw / TWIPS_PER_INCH;
        const hIn = hTw / TWIPS_PER_INCH;
        layout.size = nearestPageSize(wIn, hIn);
        layout.orientation = orient === 'landscape' || wIn > hIn ? 'landscape' : 'portrait';
        layout.pageIn = { w: +wIn.toFixed(3), h: +hIn.toFixed(3) };
        layout.pageTw = { w: Math.round(wTw), h: Math.round(hTw) };
      }
    }

    if (pgMar) {
      const toIn = (v) => {
        const n = parseFloat(v);
        return Number.isFinite(n) ? Math.max(0, n) / TWIPS_PER_INCH : null;
      };
      const top = toIn(attrOf(pgMar, 'w:top'));
      const right = toIn(attrOf(pgMar, 'w:right'));
      const bottom = toIn(attrOf(pgMar, 'w:bottom'));
      const left = toIn(attrOf(pgMar, 'w:left'));
      if ([top, right, bottom, left].every((v) => v != null)) {
        layout.margins = nearestMargins((left + right) / 2);
        layout.marginIn = {
          top: +top.toFixed(3),
          right: +right.toFixed(3),
          bottom: +bottom.toFixed(3),
          left: +left.toFixed(3)
        };
        layout.marginTw = {
          top: Math.round(parseFloat(attrOf(pgMar, 'w:top'))),
          right: Math.round(parseFloat(attrOf(pgMar, 'w:right'))),
          bottom: Math.round(parseFloat(attrOf(pgMar, 'w:bottom'))),
          left: Math.round(parseFloat(attrOf(pgMar, 'w:left')))
        };
      }
    }

    Object.assign(layout, await readDocxHeaderFooter(zip));
    return Object.keys(layout).length ? layout : null;
  } catch {
    return null;
  }
}

async function readDocxLayout(filePath) {
  try {
    const buf = await fsp.readFile(filePath);
    const zip = await JSZip.loadAsync(buf);
    const file = zip.file(MARGO_LAYOUT_PART);
    if (!file) return null;
    return JSON.parse(await file.async('string'));
  } catch {
    return null;
  }
}

async function embedDocxLayout(docxBuf, layout) {
  if (!layout) return docxBuf;
  const zip = await JSZip.loadAsync(docxBuf);
  const payload = JSON.stringify(layout, null, 0);
  zip.file(MARGO_LAYOUT_PART, payload);

  let ct = await zip.file('[Content_Types].xml').async('string');
  if (!ct.includes(MARGO_LAYOUT_PART)) {
    const override = `<Override PartName="/${MARGO_LAYOUT_PART}" ContentType="${MARGO_LAYOUT_CT}"/>`;
    ct = ct.replace('</Types>', `${override}</Types>`);
    zip.file('[Content_Types].xml', ct);
  }

  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

async function maybeEmbedDocxLayout(docxBuf, layout) {
  try {
    return await embedDocxLayout(docxBuf, layout);
  } catch {
    return docxBuf;
  }
}

function htmlDocument(bodyHtml, title, layout = {}) {
  const isLandscape = layout && layout.orientation === 'landscape';
  const cols = layout && layout.columns > 1 ? `column-count: ${layout.columns}; column-gap: 32px;` : '';
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>${escapeHtml(title || 'Document')}</title>
<style>
  @page { size: ${layout && layout.size === 'a4' ? 'A4' : 'letter'} ${isLandscape ? 'landscape' : 'portrait'}; margin: 1in; }
  body { max-width: ${isLandscape ? '1000px' : '760px'}; margin: 40px auto; padding: 0 24px;
         font-family: Calibri, -apple-system, "Segoe UI", sans-serif; line-height: 1.6; color: #1b1b1f; ${cols} }
  code, pre { font-family: Consolas, monospace; background: #f4f2ee; border-radius: 6px; }
  code { padding: 2px 5px; } pre { padding: 14px; overflow: auto; } pre code { padding: 0; background: none; }
  table { border-collapse: collapse; width: 100%; margin: 1em 0; } td, th { border: 1px solid #ddd; padding: 6px 10px; }
  blockquote { border-left: 3px solid #f2b40a; margin-left: 0; padding-left: 16px; color: #6f6d68; }
  img { max-width: 100%; border-radius: 4px; }
  .page-break { page-break-before: always; }
  mark { background: #fef08a; padding: 0 2px; border-radius: 2px; }
</style>
</head>
<body>
${bodyHtml}
</body>
</html>`;
}

/* A Word document exported to PDF, printed or saved as HTML: the page
   geometry, header, footer and page numbers it has in Margo, and the same
   content styles as the page in the editor (css/doc.css), so what prints is
   what was on screen. Header and footer use CSS page-margin boxes. */
const DOC_PAGE_IN = { letter: [8.5, 11], a4: [8.27, 11.69], legal: [8.5, 14], executive: [7.25, 10.5], a5: [5.83, 8.27] };
const DOC_MARGIN_IN = {
  normal: [1, 1, 1, 1], narrow: [0.5, 0.5, 0.5, 0.5], moderate: [0.75, 0.75, 0.75, 0.75], wide: [1, 2, 1, 2]
};

function cssString(s) {
  return '"' + String(s || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n]+/g, ' ') + '"';
}

function docHtmlDocument(bodyHtml, title, layout = {}) {
  const L = layout || {};
  const land = L.orientation === 'landscape';
  let [w, h] = DOC_PAGE_IN[L.size] || DOC_PAGE_IN.letter;
  if (L.pageIn && L.pageIn.w > 0 && L.pageIn.h > 0) { w = Math.min(L.pageIn.w, L.pageIn.h); h = Math.max(L.pageIn.w, L.pageIn.h); }
  if (land) [w, h] = [h, w];
  let [mt, mr, mb, ml] = DOC_MARGIN_IN[L.margins] || DOC_MARGIN_IN.normal;
  if (L.marginIn) ({ top: mt, right: mr, bottom: mb, left: ml } = L.marginIn);
  const box = 'font-family: Calibri, Carlito, sans-serif; font-size: 8.5pt; color: #8a8a8a;';
  const marginBoxes =
    (L.headerText ? `@top-left { content: ${cssString(L.headerText)}; ${box} vertical-align: bottom; padding-bottom: 12pt; }` : '') +
    (L.footerText ? `@bottom-left { content: ${cssString(L.footerText)}; ${box} vertical-align: top; padding-top: 12pt; }` : '') +
    (L.showPageNumbers ? `@bottom-right { content: "Page " counter(page) " of " counter(pages); ${box} vertical-align: top; padding-top: 12pt; }` : '');
  const cols = L.columns > 1 ? `column-count: ${L.columns}; column-gap: 0.4in;` : '';
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>${escapeHtml(title || 'Document')}</title>
<style>
  @page { size: ${w}in ${h}in; margin: ${mt}in ${mr}in ${mb}in ${ml}in; ${marginBoxes} }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { font-family: Calibri, Carlito, "Segoe UI", sans-serif; font-size: 11pt; line-height: 1.55; color: #1b1b1f; margin: 0; ${cols} }
  @media screen { body { max-width: ${(w - ml - mr).toFixed(2)}in; margin: 0.6in auto; padding: 0 24px; } }
  p { margin: 0 0 0.5em; }
  h1, h2, h3, h4 { font-weight: 700; letter-spacing: -0.01em; margin: 1.15em 0 0.4em; break-after: avoid; }
  h1 { font-size: 1.75em; } h2 { font-size: 1.4em; } h3 { font-size: 1.18em; } h4 { font-size: 1.05em; }
  .margo-title { font-size: 2.4em; font-weight: 600; letter-spacing: -0.02em; line-height: 1.15; margin: 0 0 0.2em; }
  .margo-subtitle { font-size: 1.35em; color: #6b6b70; margin: 0 0 0.9em; }
  ul, ol { padding-left: 1.7em; margin: 0 0 0.65em; } li { margin: 0.18em 0; }
  ul.margo-checklist { list-style: none; padding-left: 1.7em; }
  ul.margo-checklist > li { position: relative; }
  ul.margo-checklist > li::before { content: "\\2610"; position: absolute; left: -1.45em; }
  ul.margo-checklist > li.is-checked::before { content: "\\2612"; }
  ul.margo-checklist > li.is-checked { color: #8a8a8a; text-decoration: line-through; }
  a { color: #1a5fb4; }
  blockquote { border-left: 3px solid #c9c9c4; margin: 0.65em 0; padding-left: 15px; color: #5c5c61; font-style: italic; }
  pre, code { font-family: Consolas, "Cascadia Code", monospace; font-size: 0.9em; background: #f2f2f0; border-radius: 4px; }
  pre { padding: 10px 12px; white-space: pre-wrap; margin: 0 0 0.65em; } code { padding: 0.1em 0.35em; } pre code { background: none; padding: 0; }
  table { border-collapse: collapse; width: 100%; margin: 0.75em 0; table-layout: fixed; }
  td, th { border: 1px solid #b9b9b4; padding: 5px 11px; vertical-align: top; overflow-wrap: break-word; }
  th { font-weight: 700; background: #f4f4f2; text-align: left; }
  thead { display: table-header-group; } tr { break-inside: avoid; }
  table.margo-tbl-none td, table.margo-tbl-none th { border-color: transparent; }
  table.margo-tbl-outer { border: 1px solid #b9b9b4; } table.margo-tbl-outer td, table.margo-tbl-outer th { border-color: transparent; }
  img { max-width: 100%; } img.margo-wrap-left { float: left; margin: 4px 14px 8px 0; } img.margo-wrap-right { float: right; margin: 4px 0 8px 14px; }
  hr { border: none; border-top: 1px solid #b9b9b4; margin: 1.2em 0; }
  sub, sup { font-size: 75%; line-height: 0; position: relative; vertical-align: baseline; } sup { top: -0.5em; } sub { bottom: -0.25em; }
  div[data-margo-page-break], .page-break { break-before: page; }
  mark { background: #fef08a; color: inherit; }
  mark.hl-yellow { background: #ffff00; } mark.hl-green { background: #00ff00; } mark.hl-cyan { background: #00ffff; }
  mark.hl-pink { background: #ff00ff; } mark.hl-orange { background: #ffa500; } mark.hl-red { background: #ff0000; }
  mark.hl-gray { background: #c0c0c0; } mark.hl-blue { background: #0000ff; color: #fff; }
  mark.hl-purple { background: #800080; color: #fff; } mark.hl-darkyellow { background: #808000; color: #fff; }
  .margo-callout { margin: 1em 0; padding: 10px 14px; border-left: 4px solid #3b82f6; background: #e8f0fe; border-radius: 4px; }
  .margo-callout-tip { border-left-color: #10b981; background: #e7f8f1; }
  .margo-callout-warning { border-left-color: #f59e0b; background: #fef3e2; }
  .margo-callout-quote { border-left-color: #8b5cf6; background: #f1ecfd; font-style: italic; }
  .margo-callout-title { font-weight: 700; }
  .margo-toc { margin: 0 0 1em; }
  .margo-toc-title { font-size: 1.35em; font-weight: 700; margin-bottom: 0.4em; }
  .margo-toc-entry { display: flex; align-items: baseline; gap: 6px; margin: 0 0 0.25em; }
  .margo-toc-entry .margo-toc-text { flex: none; max-width: 85%; }
  .margo-toc-entry::after { content: ""; order: 1; flex: 1; border-bottom: 1px dotted #9a9a9a; transform: translateY(-0.3em); }
  .margo-toc-entry .margo-toc-page { order: 2; flex: none; }
  .margo-toc-l2 { padding-left: 1.5em; } .margo-toc-l3 { padding-left: 3em; } .margo-toc-l4 { padding-left: 4.5em; }
  .margo-footnotes { margin-top: 2em; padding-top: 0.6em; border-top: 1px solid #c9c9c4; font-size: 0.88em; }
  .margo-footnotes ol { padding-left: 1.5em; }
  .margo-note-anchor { background: none; }
</style>
</head>
<body>
${bodyHtml}
</body>
</html>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/* Full HTML document used for PDF export via printToPDF */
/* The markdown editor sends its own sanitised rendering (footnotes, task
   boxes, pictures resolved against the note's folder); anything else - a
   caller with only the text - falls back to marked. */
function markdownBody(data) {
  const d = data || {};
  if (typeof d.html === 'string' && d.html.trim()) return d.html;
  return marked.parse(d.markdown ?? '');
}

function htmlForPdfExport({ kind, data, title }) {
  if (kind === 'md') return htmlDocument(markdownBody(data), title);
  if (kind === 'slides') return slides.exportHtml(data.deck, title);
  if (kind === 'doc') return docHtmlDocument(data.html ?? '<p></p>', title, data.layout);
  if (kind === 'sheet') return htmlDocument(sheetIo.pdfBody(data), title);
  throw new Error(`Can't export ${kind} as PDF`);
}

module.exports = {
  kindFromPath,
  openPath,
  save,
  atomicWrite,
  saveFilters,
  suggestSavePath,
  htmlToDocxBuffer,
  embedDocxThumbnail,
  maybeEmbedDocxThumb,
  readDocxEmbeddedThumb,
  readDocxNotes,
  embedDocxNotes,
  maybeEmbedDocxNotes,
  htmlForPdfExport,
  turndownHtml: (html) => turndown.turndown(html),
  markedParse: (md) => marked.parse(md),
  normalizeCell: sheetIo.normalizeCell,
  modelToWorkbook: sheetIo.modelToWorkbook,
  workbookToModel: sheetIo.workbookToModel
};
