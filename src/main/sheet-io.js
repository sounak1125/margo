/* Margo — spreadsheet files: .xlsx through ExcelJS, .csv by hand.

   The renderer's model per sheet:
     rows        string[][]  what each cell holds ("=SUM(A1:A3)" for a formula)
     styles      { "r,c": { font, face, size, bold, italic, underline, strike,
                   color, fill, borders:{t,r,b,l}, align, valign, wrap, numFmt } }
     colWidths / rowHeights   px
     merges      ["A1:B2", …]     freeze { rows, cols }
     condFormats / validations / charts / filter / hideGrid
     results     { "r,c": value } computed value of every formula (written as
                 the cached result so Excel and previewers show numbers)
     display     { "r,c": text }  what the grid shows, where that differs from
                 the raw text (used for CSV and PDF) */
const fsp = require('fs').promises;
const path = require('path');
const ExcelJS = require('exceljs');

const MARGO_META_SHEET = '__MargoMeta__';

/* ---------------- helpers ---------------- */

function colName(n) {
  let s = '';
  n += 1;
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}
function colIndex(str) {
  let c = 0;
  const s = String(str || '').toUpperCase();
  for (let i = 0; i < s.length; i++) c = c * 26 + (s.charCodeAt(i) - 64);
  return c - 1;
}
function parseRange(text) {
  const m = /^\$?([A-Za-z]{1,3})\$?(\d+)(?::\$?([A-Za-z]{1,3})\$?(\d+))?$/.exec(String(text || '').trim());
  if (!m) return null;
  const r1 = +m[2] - 1, c1 = colIndex(m[1]);
  const r2 = m[3] ? +m[4] - 1 : r1, c2 = m[3] ? colIndex(m[3]) : c1;
  return { r1: Math.min(r1, r2), c1: Math.min(c1, c2), r2: Math.max(r1, r2), c2: Math.max(c1, c2) };
}
function rangeText(rg) {
  if (!rg) return '';
  if (typeof rg === 'string') return rg;
  const a = colName(rg.c1) + (rg.r1 + 1);
  return rg.r1 === rg.r2 && rg.c1 === rg.c2 ? a : a + ':' + colName(rg.c2) + (rg.r2 + 1);
}
function sanitizeSheetName(name) {
  return String(name || '').replace(/[\\/?*[\]:]/g, ' ').trim().slice(0, 31);
}
function excelWidthToPx(w) { return Math.round(Number(w) * 7 + 5); }
function pxToExcelWidth(px) { return Math.max(1, Math.min(255, (Number(px) - 5) / 7)); }
const argb = (hex) => ({ argb: 'FF' + String(hex).replace('#', '').toUpperCase() });
const hexOf = (c) => (c && c.argb && /^[0-9a-f]{6,8}$/i.test(c.argb) ? '#' + c.argb.slice(-6).toLowerCase() : null);
function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/* Dates come out of ExcelJS as UTC instants; reading them with local-time
   getters moved every date a day back west of Greenwich. */
function formatDate(d) {
  const pad = (n) => String(n).padStart(2, '0');
  const date = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  if (d.getUTCHours() || d.getUTCMinutes() || d.getUTCSeconds()) {
    return `${date} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}${d.getUTCSeconds() ? ':' + pad(d.getUTCSeconds()) : ''}`;
  }
  return date;
}

function normalizeCell(v) {
  if (v === null || v === undefined) return '';
  const t = typeof v;
  if (t === 'string') return v;
  if (t === 'number') return String(v);
  if (t === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (v instanceof Date) return formatDate(v);
  if (t === 'object') {
    if ('formula' in v && v.formula) return '=' + v.formula;
    if ('sharedFormula' in v) {
      if (v.result !== undefined) return normalizeCell(v.result);
      return '';
    }
    if (Array.isArray(v.richText)) return v.richText.map((r) => r.text).join('');
    if ('error' in v) return String(v.error);
    if ('text' in v) return normalizeCell(v.text);
    if ('hyperlink' in v) return String(v.hyperlink);
  }
  return String(v);
}

/* ---------------- styles ---------------- */

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
    bold = !!st.bold || compact.includes('extrabold') || compact.includes('ultrabold') ||
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
    color: st.color ? argb(st.color) : undefined
  };
}

const EDGE_KEYS = { top: 't', right: 'r', bottom: 'b', left: 'l' };
function edgeWeight(style) {
  if (!style) return null;
  if (style === 'medium' || style === 'mediumDashed' || style === 'mediumDashDot' || style === 'mediumDashDotDot' || style === 'slantDashDot') return 'medium';
  if (style === 'thick' || style === 'double') return 'thick';
  return 'thin';
}

/* Borders come back per edge, plus the single "kind" older Margo files
   (and callers that only care whether a box is drawn) understand. */
function readBorders(border) {
  if (!border) return null;
  const out = {};
  Object.entries(EDGE_KEYS).forEach(([k, short]) => {
    const w = edgeWeight(border[k] && border[k].style);
    if (w) out[short] = w;
  });
  const keys = Object.keys(out);
  if (!keys.length) return null;
  const kind = keys.some((k) => out[k] !== 'thin') ? 'thick' : keys.length === 4 ? 'all' : 'outer';
  return { borders: out, kind };
}

function extractCellStyle(cell) {
  const s = {};
  if (cell.font) {
    const split = splitExcelFont(cell.font.name, !!cell.font.bold, !!cell.font.italic);
    if (cell.font.name && !/^calibri$/i.test(split.font)) s.font = split.font;
    else if (cell.font.name && split.face !== 'Regular' && split.face !== 'Bold' && split.face !== 'Italic' && split.face !== 'Bold Italic') s.font = split.font;
    if (split.face !== 'Regular') s.face = split.face;
    if (cell.font.size && cell.font.size !== 11) s.size = cell.font.size;
    const compact = split.face.toLowerCase().replace(/[_\s]+/g, '');
    if (cell.font.bold || compact.includes('extrabold') || compact.includes('ultrabold') ||
        compact.includes('black') || compact.includes('heavy') ||
        (compact.includes('bold') && !compact.includes('semibold') && !compact.includes('demibold'))) {
      s.bold = true;
    }
    if (cell.font.italic || /italic|oblique/i.test(split.face)) s.italic = true;
    if (cell.font.underline) s.underline = true;
    if (cell.font.strike) s.strike = true;
    const col = hexOf(cell.font.color);
    if (col && col !== '#000000') s.color = col;
  }
  if (cell.fill && cell.fill.type === 'pattern' && cell.fill.pattern && cell.fill.pattern !== 'none') {
    const col = hexOf(cell.fill.fgColor) || hexOf(cell.fill.bgColor);
    if (col) s.fill = col;
  }
  const b = readBorders(cell.border);
  if (b) { s.borders = b.borders; s.border = b.kind; }
  if (cell.alignment) {
    const h = cell.alignment.horizontal;
    if (h) s.align = h === 'centerContinuous' ? 'center' : h === 'justify' || h === 'distributed' || h === 'fill' ? 'left' : h;
    const v = cell.alignment.vertical;
    if (v && v !== 'bottom') s.valign = v === 'center' ? 'middle' : v === 'justify' || v === 'distributed' ? 'top' : v;
    if (cell.alignment.wrapText) s.wrap = true;
    if (cell.alignment.indent) s.indent = cell.alignment.indent;
  }
  if (cell.numFmt && cell.numFmt !== 'General') s.numFmt = cell.numFmt;
  return Object.keys(s).length ? s : null;
}

function applyModelCellStyle(cell, st) {
  if (!st) return;
  if (st.bold || st.italic || st.underline || st.strike || st.size || st.font || st.color || st.face) {
    cell.font = excelFontFromStyle(st);
  }
  if (st.fill && /^#[0-9a-f]{6}$/i.test(st.fill)) {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: argb(st.fill), bgColor: argb(st.fill) };
  }
  let edges = st.borders;
  if (!edges && st.border && st.border !== 'none') {
    const w = st.border === 'thick' ? 'medium' : 'thin';
    edges = { t: w, r: w, b: w, l: w };
  }
  if (edges && Object.keys(edges).length) {
    const border = {};
    Object.entries(EDGE_KEYS).forEach(([k, short]) => {
      if (edges[short]) border[k] = { style: edges[short] === 'thick' ? 'thick' : edges[short] === 'medium' ? 'medium' : 'thin', color: st.borderColor ? argb(st.borderColor) : undefined };
    });
    cell.border = border;
  }
  if (st.align || st.valign || st.wrap || st.indent) {
    cell.alignment = {
      horizontal: st.align || undefined,
      vertical: st.valign ? (st.valign === 'middle' ? 'middle' : st.valign) : undefined,
      wrapText: !!st.wrap,
      indent: st.indent || undefined
    };
  }
  const fmt = st.numFmt || legacyFormatCode(st.format, st.numDecimals);
  if (fmt) cell.numFmt = fmt;
}

/* The format model Margo wrote before it kept Excel format codes. */
function legacyFormatCode(format, decimals) {
  if (!format) return '';
  const d = decimals == null ? 2 : Math.max(0, Math.min(10, decimals | 0));
  const frac = d ? '.' + '0'.repeat(d) : '';
  switch (String(format).toLowerCase()) {
    case 'currency': case 'usd': return `"$"#,##0${frac}`;
    case 'eur': return `"€"#,##0${frac}`;
    case 'gbp': return `"£"#,##0${frac}`;
    case 'inr': return `"₹"#,##0${frac}`;
    case 'percent': case 'percentage': return `0${frac}%`;
    case 'number': case 'comma': return `#,##0${frac}`;
    case 'scientific': return `0${frac}E+00`;
    case 'date': return 'yyyy-mm-dd';
    case 'time': return 'h:mm:ss AM/PM';
    case 'text': return '@';
    default: return '';
  }
}

/* ---------------- values ---------------- */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/;

/* What a typed literal is in Excel's terms: a number (with the format the
   typing implied), a date, a boolean or text. */
function coerceLiteral(raw) {
  const s = String(raw);
  const t = s.trim();
  if (s[0] === "'") return { value: s.slice(1) };
  if (/^-?(0|[1-9]\d*)(\.\d+)?(e[-+]?\d+)?$/i.test(t)) {
    const n = Number(t);
    if (Number.isFinite(n) && Math.abs(n) < Number.MAX_SAFE_INTEGER) return { value: n };
  }
  let m = /^(-?)(\d+(?:\.\d+)?)%$/.exec(t);
  if (m) {
    const dec = (m[2].split('.')[1] || '').length;
    return { value: Number(m[1] + m[2]) / 100, numFmt: dec ? `0.${'0'.repeat(dec)}%` : '0%' };
  }
  m = /^(-?)\$(\d{1,3}(?:,\d{3})*|\d+)(\.\d+)?$/.exec(t);
  if (m) {
    const dec = m[3] ? m[3].length - 1 : 0;
    return { value: Number(m[1] + m[2].replace(/,/g, '') + (m[3] || '')), numFmt: `"$"#,##0${dec ? '.' + '0'.repeat(dec) : ''}` };
  }
  m = /^(-?)(\d{1,3}(?:,\d{3})+)(\.\d+)?$/.exec(t);
  if (m) {
    const dec = m[3] ? m[3].length - 1 : 0;
    return { value: Number(m[1] + m[2].replace(/,/g, '') + (m[3] || '')), numFmt: `#,##0${dec ? '.' + '0'.repeat(dec) : ''}` };
  }
  m = ISO_DATE.exec(t);
  if (m && +m[2] >= 1 && +m[2] <= 12 && +m[3] >= 1 && +m[3] <= 31) {
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)));
    return { value: d, numFmt: m[4] != null ? 'yyyy-mm-dd h:mm' : 'yyyy-mm-dd' };
  }
  if (/^(true|false)$/i.test(t)) return { value: /^true$/i.test(t) };
  return { value: s };
}
/* Kept for callers that only want the plain value. */
function coerceValue(v) { return coerceLiteral(v).value; }

const EXCEL_ERRORS = new Set(['#N/A', '#REF!', '#NAME?', '#DIV/0!', '#NULL!', '#VALUE!', '#NUM!']);
function formulaResult(res) {
  if (res === undefined || res === '') return undefined;
  if (res && typeof res === 'object' && res.error) {
    return EXCEL_ERRORS.has(res.error) ? { error: res.error } : { error: '#VALUE!' };
  }
  if (typeof res === 'number' || typeof res === 'boolean' || typeof res === 'string') return res;
  return undefined;
}

/* ---------------- xlsx: read ---------------- */

function readMargoMeta(wb) {
  const ws = wb.getWorksheet(MARGO_META_SHEET);
  if (!ws) return null;
  try {
    const raw = ws.getCell(1, 1).value;
    const text = raw == null ? '' : (typeof raw === 'object' && raw.text != null ? raw.text : String(raw));
    return JSON.parse(text);
  } catch {
    return null;
  }
}

const CF_OPS = { greaterThan: 'gt', lessThan: 'lt', greaterThanOrEqual: 'gte', lessThanOrEqual: 'lte', equal: 'eq', notEqual: 'neq', between: 'between' };
function cfStyleOf(style) {
  if (!style) return {};
  const out = {};
  const fill = style.fill && (hexOf(style.fill.bgColor) || hexOf(style.fill.fgColor));
  if (fill) out.fill = fill;
  if (style.font) {
    const c = hexOf(style.font.color);
    if (c) out.color = c;
    if (style.font.bold) out.bold = true;
  }
  return out;
}
function stripQuotes(f) {
  const s = String(f == null ? '' : f);
  return /^".*"$/.test(s) ? s.slice(1, -1).replace(/""/g, '"') : s;
}
/* Excel's own conditional formats, for workbooks Margo did not write. */
function readConditionalFormats(ws) {
  const out = [];
  (ws.conditionalFormattings || []).forEach((cf) => {
    const range = parseRange(String(cf.ref || '').split(/\s+/)[0]);
    if (!range) return;
    (cf.rules || []).forEach((rule) => {
      if (rule.type === 'cellIs' && CF_OPS[rule.operator]) {
        const f = rule.formulae || [];
        out.push({ range: rangeText(range), type: CF_OPS[rule.operator], v1: stripQuotes(f[0]), v2: f[1] != null ? stripQuotes(f[1]) : undefined, style: cfStyleOf(rule.style) });
      } else if (rule.type === 'containsText') {
        const op = rule.operator || 'containsText';
        if (op === 'containsBlanks') out.push({ range: rangeText(range), type: 'blank', style: cfStyleOf(rule.style) });
        else if (op === 'notContainsBlanks') out.push({ range: rangeText(range), type: 'notblank', style: cfStyleOf(rule.style) });
        else if (op === 'containsText') out.push({ range: rangeText(range), type: 'contains', v1: rule.text || '', style: cfStyleOf(rule.style) });
      } else if (rule.type === 'colorScale' && Array.isArray(rule.color) && rule.color.length >= 2) {
        const cols = rule.color.map(hexOf);
        const item = { range: rangeText(range), type: 'scale', minColor: cols[0] || '#f8696b', maxColor: cols[cols.length - 1] || '#63be7b' };
        if (cols.length >= 3 && cols[1]) item.midColor = cols[1];
        out.push(item);
      }
    });
  });
  return out;
}
function readValidations(ws) {
  const model = ws.dataValidations && ws.dataValidations.model;
  if (!model) return [];
  const groups = new Map();
  Object.entries(model).forEach(([addr, dv]) => {
    if (!dv) return;
    let rule = null;
    if (dv.type === 'list' && dv.formulae && dv.formulae[0] != null) {
      const f = String(dv.formulae[0]);
      if (/^".*"$/.test(f)) rule = { type: 'list', values: f.slice(1, -1).split(',').map((x) => x.trim()).filter(Boolean) };
      else rule = { type: 'list', source: '=' + f.replace(/^=/, '') };
    } else if ((dv.type === 'decimal' || dv.type === 'whole') && dv.operator === 'between') {
      rule = { type: 'number', min: dv.formulae && dv.formulae[0] != null ? String(dv.formulae[0]) : '', max: dv.formulae && dv.formulae[1] != null ? String(dv.formulae[1]) : '' };
    }
    if (!rule) return;
    rule.strict = dv.showErrorMessage !== false;
    const key = JSON.stringify(rule);
    const ranges = String(addr).split(/\s+/).map(parseRange).filter(Boolean);
    if (!groups.has(key)) groups.set(key, { rule, ranges: [] });
    groups.get(key).ranges.push(...ranges);
  });
  const out = [];
  groups.forEach(({ rule, ranges }) => {
    // collapse single cells in one column into runs
    ranges.sort((a, b) => a.c1 - b.c1 || a.r1 - b.r1);
    const merged = [];
    ranges.forEach((rg) => {
      const last = merged[merged.length - 1];
      if (last && last.c1 === rg.c1 && last.c2 === rg.c2 && rg.r1 === last.r2 + 1) last.r2 = rg.r2;
      else merged.push({ ...rg });
    });
    merged.forEach((rg) => out.push({ ...rule, range: rangeText(rg) }));
  });
  return out;
}

function workbookToModel(wb) {
  const meta = readMargoMeta(wb);
  const chartsBySheet = (meta && meta.chartsBySheet) || {};
  const extraBySheet = (meta && meta.sheets) || {};
  const sheets = [];
  wb.eachSheet((ws) => {
    if (ws.name === MARGO_META_SHEET) return;
    const rows = [];
    const styles = {};
    const colWidths = {};
    const rowHeights = {};
    (ws.columns || []).forEach((col, idx) => {
      if (!col) return;
      if (col.width) colWidths[idx] = excelWidthToPx(col.width);
    });
    ws.eachRow({ includeEmpty: true }, (row, rowNumber) => {
      // Excel keeps row height in points; the grid works in CSS pixels.
      if (row.height && row.customHeight !== false) rowHeights[rowNumber - 1] = Math.round(row.height * 96 / 72);
      const arr = [];
      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        let v;
        if (cell.type === ExcelJS.ValueType.Formula) {
          // Shared formulas come back translated to this cell by ExcelJS.
          let f = null;
          try { f = cell.formula; } catch { f = null; }
          v = f ? '=' + f : normalizeCell(cell.value);
        } else if (cell.type === ExcelJS.ValueType.Merge) {
          v = '';
        } else v = normalizeCell(cell.value);
        arr[colNumber - 1] = v;
        const st = extractCellStyle(cell);
        if (st) styles[`${rowNumber - 1},${colNumber - 1}`] = st;
      });
      for (let i = 0; i < arr.length; i++) if (arr[i] === undefined) arr[i] = '';
      rows[rowNumber - 1] = arr;
    });
    for (let i = 0; i < rows.length; i++) if (rows[i] === undefined) rows[i] = [];
    const merges = ((ws.model && ws.model.merges) || []).filter((m) => /:/.test(m));
    const view = (ws.views || [])[0] || {};
    const freeze = view.state === 'frozen' ? { rows: view.ySplit || 0, cols: view.xSplit || 0 } : { rows: 0, cols: 0 };
    const extra = extraBySheet[ws.name] || {};
    sheets.push({
      name: ws.name || `Sheet${sheets.length + 1}`,
      rows,
      styles,
      colWidths,
      rowHeights,
      charts: Array.isArray(chartsBySheet[ws.name]) ? chartsBySheet[ws.name] : [],
      merges,
      freeze,
      condFormats: Array.isArray(extra.condFormats) ? extra.condFormats : readConditionalFormats(ws),
      validations: Array.isArray(extra.validations) ? extra.validations : readValidations(ws),
      filter: extra.filter || null,
      hideGrid: extra.hideGrid != null ? !!extra.hideGrid : view.showGridLines === false
    });
  });
  if (!sheets.length) sheets.push({ name: 'Sheet1', rows: [], styles: {}, colWidths: {}, rowHeights: {}, charts: [] });
  return { sheets, active: 0 };
}

/* ---------------- xlsx: write ---------------- */

function writeMargoMeta(wb, sheets, names) {
  const chartsBySheet = {};
  const extra = {};
  sheets.forEach((sheet, i) => {
    const name = names[i];
    if (sheet.charts && sheet.charts.length) chartsBySheet[name] = sheet.charts;
    const e = {};
    if (sheet.condFormats && sheet.condFormats.length) e.condFormats = sheet.condFormats.map((c) => ({ ...c, range: rangeText(c.range) }));
    if (sheet.validations && sheet.validations.length) e.validations = sheet.validations.map((v) => ({ ...v, range: rangeText(v.range) }));
    if (sheet.filter) e.filter = sheet.filter;
    if (sheet.hideGrid) e.hideGrid = true;
    if (Object.keys(e).length) extra[name] = e;
  });
  if (!Object.keys(chartsBySheet).length && !Object.keys(extra).length) return;
  const ws = wb.addWorksheet(MARGO_META_SHEET);
  ws.state = 'veryHidden';
  ws.getCell(1, 1).value = JSON.stringify({ version: 2, chartsBySheet, sheets: extra });
}

function cfExcelStyle(style) {
  const out = {};
  if (style && style.fill) out.fill = { type: 'pattern', pattern: 'solid', bgColor: argb(style.fill), fgColor: argb(style.fill) };
  if (style && (style.color || style.bold)) out.font = { color: style.color ? argb(style.color) : undefined, bold: !!style.bold };
  return out;
}
const CF_TO_EXCEL = { gt: 'greaterThan', lt: 'lessThan', gte: 'greaterThanOrEqual', lte: 'lessThanOrEqual', eq: 'equal', neq: 'notEqual', between: 'between' };
function cfFormula(v) {
  const s = String(v == null ? '' : v);
  if (/^-?\d+(\.\d+)?$/.test(s.trim())) return s.trim();
  if (s.startsWith('=')) return s.slice(1);
  return '"' + s.replace(/"/g, '""') + '"';
}
function writeConditionalFormats(ws, list) {
  let priority = 1;
  (list || []).forEach((cf) => {
    const ref = rangeText(cf.range);
    if (!parseRange(ref)) return;
    let rule = null;
    if (CF_TO_EXCEL[cf.type]) {
      rule = { type: 'cellIs', operator: CF_TO_EXCEL[cf.type], formulae: cf.type === 'between' ? [cfFormula(cf.v1), cfFormula(cf.v2)] : [cfFormula(cf.v1)], style: cfExcelStyle(cf.style) };
    } else if (cf.type === 'contains') {
      const first = ref.split(':')[0];
      rule = { type: 'containsText', operator: 'containsText', text: String(cf.v1 || ''), formulae: [`NOT(ISERROR(SEARCH("${String(cf.v1 || '').replace(/"/g, '""')}",${first})))`], style: cfExcelStyle(cf.style) };
    } else if (cf.type === 'blank' || cf.type === 'notblank') {
      const first = ref.split(':')[0];
      rule = { type: 'containsText', operator: cf.type === 'blank' ? 'containsBlanks' : 'notContainsBlanks', formulae: [cf.type === 'blank' ? `LEN(TRIM(${first}))=0` : `LEN(TRIM(${first}))>0`], style: cfExcelStyle(cf.style) };
    } else if (cf.type === 'scale') {
      const colors = cf.midColor ? [cf.minColor, cf.midColor, cf.maxColor] : [cf.minColor, cf.maxColor];
      const cfvo = cf.midColor ? [{ type: 'min' }, { type: 'percentile', value: 50 }, { type: 'max' }] : [{ type: 'min' }, { type: 'max' }];
      rule = { type: 'colorScale', cfvo, color: colors.map((c) => argb(c || '#ffffff')) };
    }
    if (!rule) return;
    rule.priority = priority++;
    try { ws.addConditionalFormatting({ ref, rules: [rule] }); } catch { /* keep the save going */ }
  });
}
function writeValidations(ws, list) {
  (list || []).forEach((v) => {
    const rg = typeof v.range === 'string' ? parseRange(v.range) : v.range;
    if (!rg) return;
    let dv = null;
    if (v.type === 'list') {
      if (v.source) dv = { type: 'list', allowBlank: true, formulae: [String(v.source).replace(/^=/, '')] };
      else if (Array.isArray(v.values) && v.values.length) dv = { type: 'list', allowBlank: true, formulae: ['"' + v.values.join(',').replace(/"/g, '') + '"'] };
    } else if (v.type === 'number') {
      dv = { type: 'decimal', operator: 'between', allowBlank: true, formulae: [Number(v.min) || 0, v.max === '' || v.max == null ? 1e15 : Number(v.max)] };
    }
    if (!dv) return;
    dv.showErrorMessage = v.strict !== false;
    dv.errorStyle = v.strict !== false ? 'stop' : 'warning';
    // Excel stores validation per address; a very large block is clamped.
    const r2 = Math.min(rg.r2, rg.r1 + 5000);
    for (let r = rg.r1; r <= r2; r++) {
      for (let c = rg.c1; c <= rg.c2; c++) ws.getCell(r + 1, c + 1).dataValidation = { ...dv };
    }
  });
}

function modelToWorkbook(sheets) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Margo';
  wb.calcProperties = { fullCalcOnLoad: true };
  /* The hidden sheet Margo keeps its metadata on is added afterwards, so a
     workbook with a sheet of that name collided with it and the whole save
     threw. Claiming the name up front renames the author's sheet instead. */
  const used = new Set([MARGO_META_SHEET.toLowerCase()]);
  const names = [];
  sheets.forEach((sheet, i) => {
    const name = sanitizeSheetName(sheet.name) || `Sheet${i + 1}`;
    let unique = name, n = 2;
    while (used.has(unique.toLowerCase())) unique = `${name.slice(0, 28)} ${n++}`;
    used.add(unique.toLowerCase());
    names.push(unique);

    const ws = wb.addWorksheet(unique);
    const styles = sheet.styles || {};
    const results = sheet.results || {};

    (sheet.rows || []).forEach((row, r) => {
      (row || []).forEach((val, c) => {
        if (val === '' || val === null || val === undefined) return;
        const cell = ws.getCell(r + 1, c + 1);
        const sVal = String(val);
        const st = styles[`${r},${c}`];
        if (sVal.startsWith('=') && sVal.length > 1) {
          const result = formulaResult(results[`${r},${c}`]);
          cell.value = result === undefined ? { formula: sVal.slice(1) } : { formula: sVal.slice(1), result };
          applyModelCellStyle(cell, st);
        } else {
          const lit = coerceLiteral(val);
          cell.value = lit.value;
          applyModelCellStyle(cell, st);
          if (lit.numFmt && !(st && (st.numFmt || st.format))) cell.numFmt = lit.numFmt;
        }
      });
    });

    Object.keys(styles).forEach((key) => {
      const [rStr, cStr] = key.split(',');
      const r = parseInt(rStr, 10);
      const c = parseInt(cStr, 10);
      if (!(r >= 0 && c >= 0)) return;
      const row = (sheet.rows || [])[r];
      const val = row && row[c] !== undefined && row[c] !== null ? row[c] : '';
      if (val === '') applyModelCellStyle(ws.getCell(r + 1, c + 1), styles[key]);
    });

    Object.entries(sheet.rowHeights || {}).forEach(([r, px]) => {
      const row = ws.getRow(parseInt(r, 10) + 1);
      if (px) row.height = px * 72 / 96;
    });
    Object.entries(sheet.colWidths || {}).forEach(([c, px]) => {
      const colNum = parseInt(c, 10) + 1;
      if (px && colNum > 0) ws.getColumn(colNum).width = pxToExcelWidth(px);
    });

    const taken = [];
    (sheet.merges || []).forEach((m) => {
      const rg = typeof m === 'string' ? parseRange(m) : m;
      if (!rg || (rg.r1 === rg.r2 && rg.c1 === rg.c2)) return;
      if (taken.some((t) => rg.r1 <= t.r2 && t.r1 <= rg.r2 && rg.c1 <= t.c2 && t.c1 <= rg.c2)) return;
      taken.push(rg);
      try { ws.mergeCells(rg.r1 + 1, rg.c1 + 1, rg.r2 + 1, rg.c2 + 1); } catch { /* skip a bad merge */ }
    });

    const fr = sheet.freeze || {};
    const view = {};
    if (fr.rows || fr.cols) {
      Object.assign(view, { state: 'frozen', xSplit: fr.cols || 0, ySplit: fr.rows || 0, topLeftCell: colName(fr.cols || 0) + ((fr.rows || 0) + 1) });
    }
    if (sheet.hideGrid) view.showGridLines = false;
    if (Object.keys(view).length) ws.views = [view];

    if (sheet.filter && typeof sheet.filter.r === 'number') {
      const f = sheet.filter;
      ws.autoFilter = { from: { row: f.r + 1, column: f.c1 + 1 }, to: { row: f.r + 1, column: f.c2 + 1 } };
    }
    writeConditionalFormats(ws, sheet.condFormats);
    writeValidations(ws, sheet.validations);
  });
  writeMargoMeta(wb, sheets, names);
  return wb;
}

/* ---------------- csv ---------------- */

/* The delimiter is whichever of , ; tab | splits the first lines into the
   same number of fields most often — a European export uses ";". */
function detectDelimiter(text) {
  const sample = text.slice(0, 64 * 1024);
  const candidates = [',', ';', '\t', '|'];
  let best = ',', bestScore = -1;
  for (const d of candidates) {
    const counts = [];
    let q = false, n = 0;
    for (let i = 0; i < sample.length && counts.length < 20; i++) {
      const ch = sample[i];
      if (ch === '"') { if (q && sample[i + 1] === '"') { i++; continue; } q = !q; continue; }
      if (q) continue;
      if (ch === d) n++;
      else if (ch === '\n') { counts.push(n); n = 0; }
    }
    if (n) counts.push(n);
    if (!counts.length || !counts.some((c) => c > 0)) continue;
    const mode = counts.sort((a, b) => a - b)[Math.floor(counts.length / 2)];
    const agree = counts.filter((c) => c === mode).length;
    const score = mode > 0 ? agree * 100 + mode : 0;
    if (score > bestScore) { bestScore = score; best = d; }
  }
  return best;
}
function parseCsv(text, delim) {
  const rows = [];
  let row = [], field = '', q = false, i = 0, quotedField = false;
  const n = text.length;
  while (i < n) {
    const ch = text[i];
    if (q) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        q = false; i++; continue;
      }
      field += ch; i++; continue;
    }
    if (ch === '"' && field === '' && !quotedField) { q = true; quotedField = true; i++; continue; }
    if (ch === delim) { row.push(field); field = ''; quotedField = false; i++; continue; }
    if (ch === '\r' || ch === '\n') {
      row.push(field); field = ''; quotedField = false;
      rows.push(row); row = [];
      if (ch === '\r' && text[i + 1] === '\n') i++;
      i++;
      continue;
    }
    field += ch; i++;
  }
  if (field !== '' || row.length || quotedField) { row.push(field); rows.push(row); }
  return rows;
}
function decodeText(buf) {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return buf.slice(2).toString('utf16le');
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    const swapped = Buffer.from(buf.slice(2));
    swapped.swap16();
    return swapped.toString('utf16le');
  }
  let text = buf.toString('utf8');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  // Not UTF-8 at all (an old Windows export): fall back to Latin-1.
  if (text.includes('�')) text = buf.toString('latin1');
  return text;
}
async function readCsv(filePath) {
  const buf = await fsp.readFile(filePath);
  const text = decodeText(buf);
  const delim = path.extname(filePath).toLowerCase() === '.tsv' ? '\t' : detectDelimiter(text);
  const rows = parseCsv(text, delim);
  const name = sanitizeSheetName(path.basename(filePath, path.extname(filePath))) || 'Sheet1';
  return { sheets: [{ name, rows, styles: {}, colWidths: {}, rowHeights: {}, charts: [] }], active: 0 };
}
function csvText(sheet, delim) {
  const d = delim || ',';
  const rows = sheet.rows || [];
  const display = sheet.display || {};
  const results = sheet.results || {};
  const lines = rows.map((row, r) => (row || []).map((raw, c) => {
    const key = `${r},${c}`;
    let v = raw == null ? '' : String(raw);
    if (display[key] != null) v = String(display[key]);
    else if (v.startsWith('=')) {
      const res = results[key];
      v = res == null ? '' : typeof res === 'object' ? String(res.error || '') : typeof res === 'boolean' ? (res ? 'TRUE' : 'FALSE') : String(res);
    } else if (v[0] === "'") v = v.slice(1);
    return /["\r\n]/.test(v) || v.includes(d) || /^\s|\s$/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  }).join(d));
  return '﻿' + lines.join('\r\n') + (lines.length ? '\r\n' : '');
}

/* ---------------- open / save entry points ---------------- */

async function readXlsx(filePath) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  return workbookToModel(wb);
}
async function writeXlsx(tmpPath, data) {
  const sheets = data.sheets && data.sheets.length ? data.sheets : [{ name: 'Sheet1', rows: [] }];
  const wb = modelToWorkbook(sheets);
  await wb.xlsx.writeFile(tmpPath);
}
async function writeCsv(tmpPath, data) {
  const sheets = data.sheets && data.sheets.length ? data.sheets : [{ name: 'Sheet1', rows: [] }];
  const idx = Math.min(Math.max(data.active || 0, 0), sheets.length - 1);
  const delim = path.extname(tmpPath).toLowerCase() === '.tsv' ? '\t' : ',';
  await fsp.writeFile(tmpPath, csvText(sheets[idx], delim), 'utf8');
}

/* ---------------- PDF export body ---------------- */

function pdfBody(data) {
  const sheets = data.sheets && data.sheets.length ? data.sheets : [{ name: 'Sheet1', rows: [] }];
  const parts = sheets.map((sheet, i) => {
    const rows = sheet.rows || [];
    const styles = sheet.styles || {};
    const display = sheet.display || {};
    const results = sheet.results || {};
    const maxCols = rows.reduce((m, r) => Math.max(m, (r || []).length), 1);
    const covered = new Set();
    const spans = {};
    (sheet.merges || []).forEach((m) => {
      const rg = typeof m === 'string' ? parseRange(m) : m;
      if (!rg) return;
      spans[`${rg.r1},${rg.c1}`] = { rs: rg.r2 - rg.r1 + 1, cs: rg.c2 - rg.c1 + 1 };
      for (let r = rg.r1; r <= rg.r2; r++) for (let c = rg.c1; c <= rg.c2; c++) if (r !== rg.r1 || c !== rg.c1) covered.add(`${r},${c}`);
    });
    const cols = Array.from({ length: maxCols }, (_, c) => {
      const w = (sheet.colWidths || {})[c];
      return `<col style="width:${Math.round(w || 96)}px">`;
    }).join('');
    const body = rows.map((row, r) => '<tr>' + Array.from({ length: maxCols }, (_, c) => {
      const key = `${r},${c}`;
      if (covered.has(key)) return '';
      const raw = row && row[c] != null ? String(row[c]) : '';
      let text = display[key] != null ? String(display[key]) : raw;
      if (display[key] == null && raw.startsWith('=')) {
        const res = results[key];
        text = res == null ? '' : typeof res === 'object' ? String(res.error || '') : String(res);
      }
      const st = styles[key] || {};
      const numeric = /^[-+(]?[$€£₹]?[\d,]*\.?\d+%?\)?$/.test(text.trim()) && text.trim() !== '';
      let css = '';
      if (st.bold) css += 'font-weight:700;';
      if (st.italic) css += 'font-style:italic;';
      if (st.underline || st.strike) css += `text-decoration:${[st.underline ? 'underline' : '', st.strike ? 'line-through' : ''].join(' ').trim()};`;
      if (st.color) css += `color:${st.color};`;
      if (st.fill) css += `background:${st.fill};`;
      if (st.size) css += `font-size:${st.size * 0.85}pt;`;
      if (st.font) css += `font-family:'${String(st.font).replace(/'/g, '')}';`;
      css += `text-align:${st.align || (numeric ? 'right' : 'left')};`;
      if (st.valign) css += `vertical-align:${st.valign === 'middle' ? 'middle' : st.valign};`;
      if (st.wrap) css += 'white-space:pre-wrap;';
      const b = st.borders || (st.border && st.border !== 'none' ? { t: 'thin', r: 'thin', b: 'thin', l: 'thin' } : null);
      if (b) Object.entries({ t: 'top', r: 'right', b: 'bottom', l: 'left' }).forEach(([k, side]) => { if (b[k]) css += `border-${side}:${b[k] === 'thin' ? 1 : 2}px solid #333;`; });
      const sp = spans[key];
      return `<td${sp ? ` rowspan="${sp.rs}" colspan="${sp.cs}"` : ''} style="${css}">${escapeHtml(text)}</td>`;
    }).join('') + '</tr>').join('');
    return `${i > 0 ? '<div class="page-break"></div>' : ''}` +
      `<h2>${escapeHtml(sheet.name || 'Sheet' + (i + 1))}</h2>` +
      `<table class="sheet"><colgroup>${cols}</colgroup>${body || '<tr><td></td></tr>'}</table>`;
  });
  return `<style>
      table.sheet { border-collapse: collapse; table-layout: fixed; font-size: 10.5px; }
      table.sheet td { border: 1px solid #e0e0dc; padding: 3px 6px; white-space: nowrap; overflow: hidden; font-variant-numeric: tabular-nums; }
      .page-break { page-break-before: always; }
      h2 { font-size: 14px; margin: 4px 0 10px; }
    </style>` + parts.join('');
}

module.exports = {
  MARGO_META_SHEET,
  readXlsx,
  writeXlsx,
  readCsv,
  writeCsv,
  csvText,
  parseCsv,
  detectDelimiter,
  pdfBody,
  normalizeCell,
  modelToWorkbook,
  workbookToModel,
  coerceValue,
  sanitizeSheetName
};
