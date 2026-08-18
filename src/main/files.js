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
  'strike => s'
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
  if (/^title$/i.test(s)) return 'h1';
  if (/^subtitle$/i.test(s)) return 'h2';
  if (/quote/i.test(s)) return 'blockquote';
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
  return css.join(';');
}

function runCss(r) {
  const css = [];
  if (r.font) css.push('font-family:' + String(r.font).replace(/[;"']/g, ''));
  if (r.fontSize) css.push('font-size:' + r.fontSize + 'pt');
  if (r.__margoColor) css.push('color:#' + r.__margoColor);
  return css.join(';');
}

/* Colour and line spacing are not in mammoth's model at all - its body reader
   never looks at w:color or w:spacing - so they are read straight from the
   XML and matched to the model by document order. If the counts disagree the
   correlation is abandoned, so the failure mode is losing colour, never
   painting text the wrong colour. */
function readDirectFormatting(xml) {
  const colors = [];
  const runRe = /<w:r(?:\s[^>]*)?>[\s\S]*?<\/w:r>/g;
  let m;
  while ((m = runRe.exec(xml))) {
    const c = /<w:color[^>]*w:val="([0-9A-Fa-f]{6})"/.exec(m[0]);
    colors.push(c && c[1].toLowerCase() !== 'auto' ? c[1] : null);
  }
  const lines = [];
  const shades = [];
  const paraRe = /<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g;
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
  }
  return { colors, lines, shades };
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
  let out = html;
  classCss.forEach((css, cls) => {
    const re = new RegExp(' class="' + cls + '"', 'g');
    out = out.replace(re, ' style="' + css + '"');
  });
  return out;
}

async function convertDocxHtml(filePath) {
  try {
    return await convertDocxHtmlInner(filePath);
  } catch (err) {
    /* A dangling relationship or malformed part makes mammoth throw while
       writing HTML. Losing the formatting pass, or worst case falling back
       to plain text, beats refusing to open the document at all. */
    try {
      const plain = await mammoth.convertToHtml({ path: filePath }, { styleMap: DOCX_STYLE_MAP });
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
    transformDocument: (doc) => { model = doc; return doc; }
  });
  if (!model) {
    const plain = await mammoth.convertToHtml({ path: filePath }, { styleMap: DOCX_STYLE_MAP });
    return plain.value || '';
  }

  let built;
  try {
    built = buildFormattingMap(model, direct);
  } catch {
    built = { styleMap: [], classCss: new Map(), runStyles: new Map(), paraStyles: new Map() };
  }
  if (!built.styleMap.length) {
    const plain = await mammoth.convertToHtml({ path: filePath }, { styleMap: DOCX_STYLE_MAP });
    return plain.value || '';
  }

  const result = await mammoth.convertToHtml({ path: filePath }, {
    styleMap: DOCX_STYLE_MAP.concat(built.styleMap),
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
  return null;
}

/* ---------------- open ---------------- */

async function openPath(filePath) {
  const stat = await fsp.stat(filePath);
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
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(filePath);
    return { kind: 'sheet', name, path: filePath, ...workbookToModel(wb) };
  }
  if (ext === '.csv') {
    const wb = new ExcelJS.Workbook();
    await wb.csv.readFile(filePath, { map: (v) => v });
    const model = workbookToModel(wb);
    model.sheets[0].name = sanitizeSheetName(path.basename(filePath, ext)) || 'Sheet1';
    return { kind: 'sheet', name, path: filePath, ...model };
  }
  if (ext === '.pdf') {
    // viewer loads the bytes itself via file:read-binary
    return { kind: 'pdf', name, path: filePath };
  }
  throw new Error(`Unsupported file type: ${ext || '(none)'}`);
}

function normalizeCell(v) {
  if (v === null || v === undefined) return '';
  const t = typeof v;
  if (t === 'string') return v;
  if (t === 'number') return String(v);
  if (t === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (v instanceof Date) return formatDate(v);
  if (t === 'object') {
    if ('formula' in v) {
      return '=' + v.formula;
    }
    if ('sharedFormula' in v) {
      return '=' + (v.sharedFormula || (v.result !== undefined ? v.result : ''));
    }
    if (Array.isArray(v.richText)) return v.richText.map((r) => r.text).join('');
    if ('error' in v) return String(v.error);
    if ('text' in v) return normalizeCell(v.text);
    if ('hyperlink' in v) return String(v.hyperlink);
  }
  return String(v);
}

const FONT_FACE_SUFFIXES = [
  'Thin Italic', 'Hairline Italic', 'ExtraLight Italic', 'UltraLight Italic', 'Light Italic',
  'Medium Italic', 'SemiBold Italic', 'DemiBold Italic', 'Bold Italic',
  'ExtraBold Italic', 'UltraBold Italic', 'Black Italic', 'Heavy Italic',
  'Extra Light', 'Ultra Light', 'Semi Bold', 'Demi Bold', 'Extra Bold', 'Ultra Bold',
  'Thin', 'Hairline', 'ExtraLight', 'UltraLight', 'Light',
  'Medium', 'SemiBold', 'DemiBold', 'ExtraBold', 'UltraBold',
  'Black', 'Heavy', 'Bold', 'Italic', 'Oblique', 'Regular'
];

function splitExcelFont(name, bold, italic) {
  const raw = String(name || '').trim();
  const fallback = bold && italic ? 'Bold Italic' : bold ? 'Bold' : italic ? 'Italic' : 'Regular';
  if (!raw) return { font: 'Calibri', face: fallback };
  const lower = raw.toLowerCase();
  for (const suf of FONT_FACE_SUFFIXES) {
    const token = ' ' + suf.toLowerCase();
    if (lower.endsWith(token) && raw.length > suf.length + 1) {
      return { font: raw.slice(0, raw.length - suf.length - 1).trim(), face: suf };
    }
  }
  return { font: raw, face: fallback };
}

function excelFontFromStyle(st) {
  const family = st.font || 'Calibri';
  const face = st.face || (st.bold && st.italic ? 'Bold Italic' : st.bold ? 'Bold' : st.italic ? 'Italic' : 'Regular');
  const compact = String(face).toLowerCase().replace(/[_\s]+/g, '');
  const italic = compact.includes('italic') || compact.includes('oblique') || !!st.italic;
  let bold = !!st.bold;
  if (st.face) {
    bold = compact.includes('extrabold') || compact.includes('ultrabold') ||
      compact.includes('black') || compact.includes('heavy') ||
      (compact.includes('bold') && !compact.includes('semibold') && !compact.includes('demibold'));
  }
  let name = family;
  const weightPart = String(face).replace(/\s*(italic|oblique)\s*/ig, ' ').trim();
  const weightCompact = weightPart.toLowerCase().replace(/[_\s]+/g, '');
  if (weightPart && !/^(regular|normal|bold)$/.test(weightCompact)) {
    name = `${family} ${weightPart}`.replace(/\s+/g, ' ').trim();
  }
  return {
    name,
    size: st.size || 11,
    bold,
    italic,
    underline: !!st.underline,
    strike: !!st.strike,
    color: st.color ? { argb: 'FF' + st.color.replace('#', '') } : undefined
  };
}

const THICK_BORDERS = ['medium', 'thick', 'double'];

/* Margo's grid carries a single border style per cell rather than one per
   edge, so the four Excel edges collapse to the nearest of what it can draw. */
function excelBorderKind(border) {
  if (!border) return null;
  const edges = ['top', 'right', 'bottom', 'left']
    .map((k) => border[k] && border[k].style)
    .filter(Boolean);
  if (!edges.length) return null;
  if (edges.some((style) => THICK_BORDERS.includes(style))) return 'thick';
  return edges.length === 4 ? 'all' : 'outer';
}

function extractCellStyle(cell) {
  const s = {};
  if (cell.font) {
    const split = splitExcelFont(cell.font.name, !!cell.font.bold, !!cell.font.italic);
    s.font = split.font;
    s.face = split.face;
    if (cell.font.size) s.size = cell.font.size;
    if (cell.font.bold) s.bold = true;
    else {
      const compact = split.face.toLowerCase().replace(/[_\s]+/g, '');
      if (compact.includes('extrabold') || compact.includes('ultrabold') ||
          compact.includes('black') || compact.includes('heavy') ||
          (compact.includes('bold') && !compact.includes('semibold') && !compact.includes('demibold'))) {
        s.bold = true;
      }
    }
    if (cell.font.italic || /italic|oblique/i.test(split.face)) s.italic = true;
    if (cell.font.underline) s.underline = true;
    if (cell.font.strike) s.strike = true;
    if (cell.font.color && cell.font.color.argb) {
      s.color = '#' + cell.font.color.argb.slice(-6);
    }
  }
  if (cell.fill && cell.fill.type === 'pattern' && cell.fill.fgColor && cell.fill.fgColor.argb) {
    s.fill = '#' + cell.fill.fgColor.argb.slice(-6);
  }
  const border = excelBorderKind(cell.border);
  if (border) s.border = border;
  if (cell.alignment) {
    if (cell.alignment.horizontal) s.align = cell.alignment.horizontal;
    if (cell.alignment.vertical) s.valign = cell.alignment.vertical;
    if (cell.alignment.wrapText) s.wrap = true;
  }
  if (cell.numFmt) {
    s.numFmt = cell.numFmt;
  }
  return Object.keys(s).length ? s : null;
}

function formatDate(d) {
  const pad = (n) => String(n).padStart(2, '0');
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  if (d.getHours() || d.getMinutes() || d.getSeconds()) {
    return `${date} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  return date;
}

function workbookToModel(wb) {
  const sheets = [];
  wb.eachSheet((ws) => {
    const rows = [];
    const styles = {};
    const colWidths = {};
    const rowHeights = {};
    ws.columns.forEach((col, idx) => {
      if (col && col.width) colWidths[idx] = col.width;
    });
    ws.eachRow({ includeEmpty: true }, (row, rowNumber) => {
      // Excel keeps row height in points; the grid works in CSS pixels.
      if (row.height) rowHeights[rowNumber - 1] = Math.round(row.height * 96 / 72);
      const arr = [];
      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        arr[colNumber - 1] = normalizeCell(cell.value);
        const st = extractCellStyle(cell);
        if (st) styles[`${rowNumber - 1},${colNumber - 1}`] = st;
      });
      for (let i = 0; i < arr.length; i++) if (arr[i] === undefined) arr[i] = '';
      rows[rowNumber - 1] = arr;
    });
    for (let i = 0; i < rows.length; i++) if (rows[i] === undefined) rows[i] = [];
    sheets.push({
      name: ws.name || `Sheet${sheets.length + 1}`,
      rows,
      styles,
      colWidths,
      rowHeights,
      charts: []
    });
  });
  if (!sheets.length) sheets.push({ name: 'Sheet1', rows: [], styles: {}, colWidths: {}, rowHeights: {}, charts: [] });
  return { sheets, active: 0 };
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
  return [
    { name: 'Excel workbook', extensions: ['xlsx'] },
    { name: 'CSV (active sheet)', extensions: ['csv'] }
  ];
}

function suggestSavePath(req, documentsDir) {
  const base = (req.suggestedName || 'Untitled').replace(/\.[^.]+$/, '');
  const dir = req.currentPath ? path.dirname(req.currentPath) : documentsDir;
  const defExt = req.kind === 'md' ? '.md' : req.kind === 'doc' ? '.docx' : req.kind === 'pdf' ? '.pdf' : '.xlsx';
  return path.join(dir, base + defExt);
}

async function save({ kind, path: target, data, thumbDataUrl }) {
  const ext = path.extname(target).toLowerCase();

  if (kind === 'md') {
    const md = data.markdown ?? '';
    if (MD_EXTS.includes(ext)) return fsp.writeFile(target, md, 'utf8');
    if (ext === '.docx') {
      let buf = await htmlToDocxBuffer(marked.parse(md), titleOf(target));
      buf = await maybeEmbedDocxThumb(buf, thumbDataUrl);
      return fsp.writeFile(target, buf);
    }
    if (ext === '.html') return fsp.writeFile(target, htmlDocument(marked.parse(md), titleOf(target)), 'utf8');
    throw new Error(`Can't save markdown as ${ext}`);
  }

  if (kind === 'doc') {
    const html = data.html ?? '<p></p>';
    if (ext === '.docx') {
      let buf = await htmlToDocxBuffer(html, titleOf(target), data.layout);
      buf = await maybeEmbedDocxThumb(buf, thumbDataUrl);
      buf = await maybeEmbedDocxNotes(buf, data.notes);
      buf = await maybeEmbedDocxLayout(buf, data.layout);
      return fsp.writeFile(target, buf);
    }
    if (MD_EXTS.includes(ext)) return fsp.writeFile(target, turndown.turndown(html), 'utf8');
    if (ext === '.html') return fsp.writeFile(target, htmlDocument(html, titleOf(target), data.layout), 'utf8');
    throw new Error(`Can't save document as ${ext}`);
  }

  if (kind === 'sheet') {
    const sheets = data.sheets && data.sheets.length ? data.sheets : [{ name: 'Sheet1', rows: [] }];
    if (ext === '.xlsx') {
      const wb = modelToWorkbook(sheets);
      return wb.xlsx.writeFile(target);
    }
    if (ext === '.csv') {
      const idx = Math.min(Math.max(data.active || 0, 0), sheets.length - 1);
      const wb = modelToWorkbook([sheets[idx]]);
      return wb.csv.writeFile(target);
    }
    throw new Error(`Can't save spreadsheet as ${ext}`);
  }

  if (kind === 'pdf') {
    if (ext === '.pdf') return fsp.writeFile(target, Buffer.from(data.base64, 'base64'));
    throw new Error(`Can't save PDF as ${ext}`);
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

async function restoreStrikethrough(docxBuf) {
  try {
    const zip = await JSZip.loadAsync(docxBuf);
    const file = zip.file('word/document.xml');
    if (!file) return docxBuf;
    const xml = await file.async('string');
    if (xml.indexOf(STRIKE_ON) < 0) return docxBuf;
    zip.file('word/document.xml', applyStrikeFences(xml));
    return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  } catch {
    return docxBuf;
  }
}

/* Page dimensions in twips, portrait-oriented: html-to-docx swaps width and
   height itself when the orientation is landscape. Without this every export
   came out US Letter no matter what the document actually was. */
const PAGE_TWIPS = {
  letter: { width: 12240, height: 15840 },
  a4: { width: 11906, height: 16838 },
  legal: { width: 12240, height: 20160 },
  executive: { width: 10440, height: 15120 }
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
  const htmlString =
    `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${escapeHtml(title || 'Document')}</title></head>` +
    `<body>${fenceStrikeText(bodyHtml)}</body></html>`;

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

  const docOpts = {
    title: title || 'Document',
    font: 'Calibri',
    fontSize: 22,
    table: { row: { cantSplit: true } },
    footer: !!(layout && (layout.footerText || layout.showPageNumbers)),
    pageNumber: !!(layout && layout.showPageNumbers),
    orientation,
    pageSize,
    margins
  };

  const headerHtml = (layout && layout.headerText)
    ? `<p style="text-align:right;font-size:9pt;color:#888;">${escapeHtml(layout.headerText)}</p>`
    : null;
  const footerHtml = (layout && layout.footerText)
    ? `<p style="text-align:center;font-size:9pt;color:#888;">${escapeHtml(layout.footerText)}</p>`
    : null;

  const buf = await HTMLtoDOCX(htmlString, headerHtml, docOpts, footerHtml);
  const withStrike = await restoreStrikethrough(Buffer.isBuffer(buf) ? buf : Buffer.from(buf));
  return Buffer.isBuffer(withStrike) ? withStrike : Buffer.from(withStrike);
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
  { id: 'executive', w: 7.25, h: 10.5 }
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
  return String(xml || '')
    .replace(/<w:tab[^>]*\/?>/g, ' ')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .split('\n').map((s) => s.trim()).filter(Boolean).join(' ')
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

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/* Full HTML document used for PDF export via printToPDF */
function htmlForPdfExport({ kind, data, title }) {
  if (kind === 'md') return htmlDocument(marked.parse(data.markdown ?? ''), title);
  if (kind === 'doc') return htmlDocument(data.html ?? '<p></p>', title, data.layout);
  if (kind === 'sheet') {
    const sheets = (data.sheets && data.sheets.length ? data.sheets : [{ name: 'Sheet1', rows: [] }]);
    const parts = sheets.map((sheet, i) => {
      const rows = (sheet.rows || []);
      const maxCols = rows.reduce((m, r) => Math.max(m, (r || []).length), 1);
      const body = rows.map((row) =>
        '<tr>' + Array.from({ length: maxCols }, (_, c) => {
          const v = row && row[c] != null ? String(row[c]) : '';
          const num = /^-?[\d,]*\.?\d+%?$/.test(v.trim()) && v.trim() !== '';
          return `<td${num ? ' class="num"' : ''}>${escapeHtml(v)}</td>`;
        }).join('') + '</tr>'
      ).join('');
      return `${i > 0 ? '<div class="page-break"></div>' : ''}` +
        `<h2>${escapeHtml(sheet.name || 'Sheet' + (i + 1))}</h2>` +
        `<table class="sheet">${body || '<tr><td></td></tr>'}</table>`;
    });
    return htmlDocument(
      `<style>
         table.sheet { border-collapse: collapse; width: 100%; font-size: 11px; }
         table.sheet td { border: 1px solid #d5d5d2; padding: 4px 8px; }
         table.sheet td.num { text-align: right; font-variant-numeric: tabular-nums; }
         table.sheet tr:first-child td { background: #f4f4f2; font-weight: 600; }
         .page-break { page-break-before: always; }
         h2 { font-size: 15px; margin: 4px 0 10px; }
       </style>` + parts.join(''),
      title
    );
  }
  throw new Error(`Can't export ${kind} as PDF`);
}

function sanitizeSheetName(name) {
  return String(name || '').replace(/[\\\/\?\*\[\]:]/g, ' ').trim().slice(0, 31);
}

function modelToWorkbook(sheets) {
  const wb = new ExcelJS.Workbook();
  const used = new Set();
  sheets.forEach((sheet, i) => {
    let name = sanitizeSheetName(sheet.name) || `Sheet${i + 1}`;
    let unique = name, n = 2;
    while (used.has(unique.toLowerCase())) unique = `${name.slice(0, 28)} ${n++}`;
    used.add(unique.toLowerCase());

    const ws = wb.addWorksheet(unique);
    const colWidths = { ...(sheet.colWidths || {}) };
    const styles = sheet.styles || {};

    (sheet.rows || []).forEach((row, r) => {
      (row || []).forEach((val, c) => {
        if (val === '' || val === null || val === undefined) return;
        const cell = ws.getCell(r + 1, c + 1);
        const sVal = String(val);
        if (sVal.startsWith('=')) {
          cell.value = { formula: sVal.slice(1) };
        } else {
          cell.value = coerceValue(val);
        }
        const len = sVal.length;
        if (!colWidths[c] || len > colWidths[c]) colWidths[c] = len;

        const st = styles[`${r},${c}`];
        if (st) {
          if (st.bold || st.italic || st.underline || st.strike || st.size || st.font || st.color || st.face) {
            cell.font = excelFontFromStyle(st);
          }
          if (st.fill && st.fill !== '#ffffff') {
            cell.fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: 'FF' + st.fill.replace('#', '') }
            };
          }
          if (st.align || st.valign || st.wrap) {
            cell.alignment = {
              horizontal: st.align || undefined,
              vertical: st.valign || undefined,
              wrapText: !!st.wrap
            };
          }
          if (st.numFmt) {
            cell.numFmt = st.numFmt;
          }
        }
      });
    });
    Object.entries(colWidths).forEach(([c, w]) => {
      const colNum = parseInt(c, 10) + 1;
      if (w) ws.getColumn(colNum).width = Math.min(Math.max(w + 2, 9), 42);
    });
  });
  return wb;
}

function coerceValue(v) {
  const s = String(v);
  if (/^-?(0|[1-9]\d*)(\.\d+)?$/.test(s.trim())) {
    const n = Number(s);
    if (Number.isFinite(n) && Math.abs(n) < Number.MAX_SAFE_INTEGER) return n;
  }
  return s;
}

module.exports = {
  kindFromPath,
  openPath,
  save,
  saveFilters,
  suggestSavePath,
  htmlToDocxBuffer,
  embedDocxThumbnail,
  maybeEmbedDocxThumb,
  readDocxNotes,
  embedDocxNotes,
  maybeEmbedDocxNotes,
  htmlForPdfExport,
  turndownHtml: (html) => turndown.turndown(html),
  markedParse: (md) => marked.parse(md)
};
