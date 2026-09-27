/* Margo — spreadsheet editor.

   Layout of this file:
     1. references, values, errors and dates
     2. number formats (Excel format codes)
     3. formula tokenizer, parser and reference rewriting
     4. the function library
     5. the calculation engine (lazy, cached per edit generation)
     6. the editor: a virtualised grid, ribbon, dialogs, clipboard, charts

   The grid only ever builds the cells that are on screen, so a sheet with a
   hundred thousand rows costs the same to scroll as one with ten. Every cell
   is stored as the text the author typed (a formula keeps its leading "="),
   and the engine turns that text into a typed value on demand. */
(function () {
  'use strict';

  /* ======================================================================
     1. References, values, errors, dates
     ====================================================================== */

  const MAX_ROWS = 1048576;
  const MAX_COLS = 16384;

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
  function cellName(r, c) { return colName(c) + (r + 1); }
  function rangeName(rg) {
    if (!rg) return '';
    const a = cellName(rg.r1, rg.c1);
    return rg.r1 === rg.r2 && rg.c1 === rg.c2 ? a : a + ':' + cellName(rg.r2, rg.c2);
  }
  /* "B3", "A1:C9", "$A$1:$B2" -> {r1,c1,r2,c2} (normalised), or null. */
  function parseA1Range(text) {
    const m = /^\s*\$?([A-Za-z]{1,3})\$?(\d{1,7})(?:\s*:\s*\$?([A-Za-z]{1,3})\$?(\d{1,7}))?\s*$/.exec(String(text || ''));
    if (!m) return null;
    const r1 = parseInt(m[2], 10) - 1, c1 = colIndex(m[1]);
    const r2 = m[3] ? parseInt(m[4], 10) - 1 : r1, c2 = m[3] ? colIndex(m[3]) : c1;
    if (r1 < 0 || r2 < 0) return null;
    return { r1: Math.min(r1, r2), c1: Math.min(c1, c2), r2: Math.max(r1, r2), c2: Math.max(c1, c2) };
  }
  const inRange = (rg, r, c) => r >= rg.r1 && r <= rg.r2 && c >= rg.c1 && c <= rg.c2;
  const rangesIntersect = (a, b) => a.r1 <= b.r2 && b.r1 <= a.r2 && a.c1 <= b.c2 && b.c1 <= a.c2;

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  class FErr {
    constructor(code) { this.code = code; }
    toString() { return this.code; }
  }
  const ERR = {
    DIV0: new FErr('#DIV/0!'),
    NA: new FErr('#N/A'),
    NAME: new FErr('#NAME?'),
    REF: new FErr('#REF!'),
    VALUE: new FErr('#VALUE!'),
    NUM: new FErr('#NUM!'),
    NULL: new FErr('#NULL!'),
    CIRC: new FErr('#CIRCULAR!'),
    ERROR: new FErr('#ERROR!')
  };
  const ERR_BY_CODE = {};
  Object.values(ERR).forEach((e) => { ERR_BY_CODE[e.code] = e; });
  const isErr = (v) => v instanceof FErr;

  /* Days since 1899-12-30: Excel's serial dates for everything after
     1 March 1900, which is every date anyone types. */
  const EPOCH = Date.UTC(1899, 11, 30);
  const DAY_MS = 86400000;
  function dateSerial(y, m, d) { return Math.round((Date.UTC(y, m - 1, d) - EPOCH) / DAY_MS); }
  function serialDate(serial) { return new Date(EPOCH + Math.round(serial * DAY_MS)); }
  function todaySerial() {
    const n = new Date();
    return dateSerial(n.getFullYear(), n.getMonth() + 1, n.getDate());
  }
  function nowSerial() {
    const n = new Date();
    return todaySerial() + (n.getHours() * 3600 + n.getMinutes() * 60 + n.getSeconds()) / 86400;
  }

  const NUM_RE = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/;
  const GROUPED_RE = /^[-+]?\d{1,3}(?:,\d{3})+(?:\.\d+)?$/;
  const ISO_DATE_RE = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/;
  const SLASH_DATE_RE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
  const TIME_RE = /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?$/;

  /* Text that reads as a number: "12", "-3.5e2", "1,234.5", "15%", "$9.99",
     "(42)" and ISO dates. Anything else is null. */
  function parseNumberText(text) {
    let s = String(text).trim();
    if (!s) return null;
    let neg = false;
    if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1).trim(); }
    let pct = false;
    if (s.endsWith('%')) { pct = true; s = s.slice(0, -1).trim(); }
    if (/^[-+]?[$€£₹¥]/.test(s)) s = s.replace(/^([-+]?)[$€£₹¥]\s*/, '$1');
    let n = null;
    if (NUM_RE.test(s)) n = Number(s);
    else if (GROUPED_RE.test(s)) n = Number(s.replace(/,/g, ''));
    else if (!pct) {
      let m = ISO_DATE_RE.exec(s);
      if (m) {
        const mo = +m[2], d = +m[3];
        if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
        n = dateSerial(+m[1], mo, d);
        if (m[4] != null) n += (+m[4] * 3600 + +m[5] * 60 + (+m[6] || 0)) / 86400;
      } else if ((m = TIME_RE.exec(s))) {
        let h = +m[1];
        if (m[4]) { const pm = /p/i.test(m[4]); if (h === 12) h = 0; if (pm) h += 12; }
        if (h > 23 || +m[2] > 59) return null;
        n = (h * 3600 + +m[2] * 60 + (+m[3] || 0)) / 86400;
      } else if ((m = SLASH_DATE_RE.exec(s))) {
        const mo = +m[1], d = +m[2];
        if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
        n = dateSerial(+m[3], mo, d);
      }
    }
    if (n == null || !Number.isFinite(n)) return null;
    if (pct) n /= 100;
    return neg ? -n : n;
  }

  /* The typed value behind what a cell holds (formulas excluded). */
  function parseLiteral(raw) {
    if (raw == null || raw === '') return null;
    const s = String(raw);
    if (s[0] === "'") return s.slice(1);
    const n = parseNumberText(s);
    if (n != null) return n;
    const u = s.trim().toUpperCase();
    if (u === 'TRUE') return true;
    if (u === 'FALSE') return false;
    if (ERR_BY_CODE[u]) return ERR_BY_CODE[u];
    return s;
  }

  /* General format: up to 10 significant digits, never fewer than the
     integer part needs, exponent for the very large and very small. */
  function formatGeneral(n) {
    if (!Number.isFinite(n)) return '#NUM!';
    if (n === 0) return '0';
    const a = Math.abs(n);
    if (a >= 1e15 || a < 1e-9) {
      const [m, e] = n.toExponential(5).split('e');
      const mant = String(Number(m));
      const exp = Number(e);
      return `${mant}E${exp < 0 ? '-' : '+'}${String(Math.abs(exp)).padStart(2, '0')}`;
    }
    const intDigits = Math.max(1, Math.floor(Math.log10(a)) + 1);
    const p = Math.min(15, Math.max(10, intDigits));
    return String(Number(n.toPrecision(p)));
  }

  /* ======================================================================
     2. Number formats
     ====================================================================== */

  const FORMAT_PRESETS = [
    { id: 'general', label: 'General', code: '' },
    { id: 'number', label: 'Number', code: '#,##0.00', sample: 1234.56 },
    { id: 'currency', label: 'Currency', code: '"$"#,##0.00', sample: 1234.56 },
    { id: 'eur', label: 'Euro', code: '"€"#,##0.00', sample: 1234.56 },
    { id: 'gbp', label: 'Pound', code: '"£"#,##0.00', sample: 1234.56 },
    { id: 'inr', label: 'Rupee', code: '"₹"#,##0.00', sample: 1234.56 },
    { id: 'accounting', label: 'Accounting', code: '_("$"* #,##0.00_);_("$"* (#,##0.00);_("$"* "-"??_);_(@_)', sample: -1234.5 },
    { id: 'percent', label: 'Percent', code: '0.00%', sample: 0.1234 },
    { id: 'scientific', label: 'Scientific', code: '0.00E+00', sample: 123456 },
    { id: 'date', label: 'Short date', code: 'yyyy-mm-dd', sample: 46000 },
    { id: 'longdate', label: 'Long date', code: 'dddd, mmmm d, yyyy', sample: 46000 },
    { id: 'time', label: 'Time', code: 'h:mm:ss AM/PM', sample: 0.6 },
    { id: 'datetime', label: 'Date & time', code: 'yyyy-mm-dd h:mm', sample: 46000.6 },
    { id: 'text', label: 'Plain text', code: '@' }
  ];

  /* The format model Margo wrote before format codes: a named preset plus a
     decimal count. Still read so older drafts keep their look. */
  function legacyFormatCode(format, decimals) {
    const d = decimals == null ? 2 : Math.max(0, Math.min(10, decimals | 0));
    const frac = d ? '.' + '0'.repeat(d) : '';
    switch (String(format || '').toLowerCase()) {
      case 'currency': case 'usd': return `"$"#,##0${frac}`;
      case 'eur': return `"€"#,##0${frac}`;
      case 'gbp': return `"£"#,##0${frac}`;
      case 'inr': return `"₹"#,##0${frac}`;
      case 'percent': case 'percentage': return `0${frac}%`;
      case 'number': case 'comma': return `#,##0${frac}`;
      case 'accounting': return `"$"#,##0${frac};("$"#,##0${frac})`;
      case 'scientific': return `0${frac}E+00`;
      case 'date': return 'yyyy-mm-dd';
      case 'time': return 'h:mm:ss AM/PM';
      case 'text': return '@';
      default: return '';
    }
  }

  function splitSections(code) {
    const out = [];
    let cur = '', q = false, br = false;
    for (let i = 0; i < code.length; i++) {
      const ch = code[i];
      if (ch === '"' && !br) q = !q;
      else if (!q && ch === '[') br = true;
      else if (!q && ch === ']') br = false;
      else if (!q && !br && ch === '\\') { cur += ch + (code[i + 1] || ''); i++; continue; }
      if (ch === ';' && !q && !br) { out.push(cur); cur = ''; continue; }
      cur += ch;
    }
    out.push(cur);
    return out;
  }

  const FMT_COLORS = { red: '#d32f2f', blue: '#1565c0', green: '#2e7d32', magenta: '#c2185b', cyan: '#00838f', yellow: '#b8860b', black: '', white: '#ffffff' };

  /* A section broken into literal text and the codes that take a value. */
  function lexSection(sec) {
    const toks = [];
    let color = null, cond = null;
    for (let i = 0; i < sec.length; i++) {
      const ch = sec[i];
      if (ch === '"') {
        let j = i + 1, t = '';
        while (j < sec.length && sec[j] !== '"') t += sec[j++];
        toks.push({ k: 'lit', v: t });
        i = j;
      } else if (ch === '\\') { toks.push({ k: 'lit', v: sec[i + 1] || '' }); i++; }
      else if (ch === '_') { toks.push({ k: 'lit', v: ' ' }); i++; }
      else if (ch === '*') { i++; }
      else if (ch === '[') {
        const j = sec.indexOf(']', i);
        const inner = sec.slice(i + 1, j < 0 ? sec.length : j);
        i = j < 0 ? sec.length : j;
        const low = inner.toLowerCase();
        if (FMT_COLORS[low] !== undefined) color = FMT_COLORS[low];
        else if (/^\$/.test(inner)) { const sym = inner.slice(1).split('-')[0]; if (sym) toks.push({ k: 'lit', v: sym }); }
        else if (/^[<>=]/.test(inner)) cond = inner;
        else if (/^(h+|m+|s+)$/i.test(inner)) toks.push({ k: 'elapsed', v: low });
      } else toks.push({ k: 'ch', v: ch });
    }
    return { toks, color, cond };
  }

  const DATE_CODE_RE = /[ymdhs]/i;
  function sectionIsDate(toks) {
    return toks.some((t) => (t.k === 'ch' && DATE_CODE_RE.test(t.v) && !/[eE]/.test(t.v)) || t.k === 'elapsed');
  }

  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  function formatDateSection(n, toks) {
    if (n < 0) return '#'.repeat(8);
    const d = serialDate(n);
    const secsTotal = Math.round((n - Math.floor(n)) * 86400);
    let H = Math.floor(secsTotal / 3600) % 24, Mi = Math.floor(secsTotal / 60) % 60, S = secsTotal % 60;
    if (secsTotal >= 86400) { H = 0; Mi = 0; S = 0; }
    // group consecutive letters into codes
    const codes = [];
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i];
      if (t.k === 'ch' && /[ymdhsYMDHS]/.test(t.v)) {
        let j = i, s = '';
        const low = t.v.toLowerCase();
        while (j < toks.length && toks[j].k === 'ch' && toks[j].v.toLowerCase() === low) { s += low; j++; }
        codes.push({ k: 'code', v: s });
        i = j - 1;
      } else if (t.k === 'ch' && /[aA]/.test(t.v)) {
        const rest = toks.slice(i, i + 5).map((x) => x.v).join('');
        if (/^am\/pm/i.test(rest)) { codes.push({ k: 'ampm', v: 'AM/PM' }); i += 4; }
        else if (/^a\/p/i.test(rest)) { codes.push({ k: 'ampm', v: 'A/P' }); i += 2; }
        else codes.push({ k: 'lit', v: t.v });
      } else if (t.k === 'elapsed') codes.push(t);
      else codes.push({ k: 'lit', v: t.v });
    }
    const hasAmPm = codes.some((c) => c.k === 'ampm');
    // m after h or before s means minutes
    codes.forEach((c, i) => {
      if (c.k !== 'code' || (c.v !== 'm' && c.v !== 'mm')) return;
      const prev = codes.slice(0, i).reverse().find((x) => x.k === 'code');
      const next = codes.slice(i + 1).find((x) => x.k === 'code');
      if ((prev && prev.v[0] === 'h') || (next && next.v[0] === 's')) c.min = true;
    });
    const pad = (x, w) => String(x).padStart(w, '0');
    let out = '';
    const y = d.getUTCFullYear(), mo = d.getUTCMonth(), day = d.getUTCDate(), wd = d.getUTCDay();
    for (const c of codes) {
      if (c.k === 'lit') { out += c.v; continue; }
      if (c.k === 'ampm') { const pm = H >= 12; out += c.v === 'A/P' ? (pm ? 'P' : 'A') : (pm ? 'PM' : 'AM'); continue; }
      if (c.k === 'elapsed') {
        if (c.v[0] === 'h') out += Math.floor(n * 24);
        else if (c.v[0] === 'm') out += Math.floor(n * 1440);
        else out += Math.round(n * 86400);
        continue;
      }
      const v = c.v;
      if (v[0] === 'y') out += v.length <= 2 ? pad(y % 100, 2) : String(y);
      else if (v[0] === 'm' && c.min) out += v.length === 1 ? Mi : pad(Mi, 2);
      else if (v[0] === 'm') {
        if (v.length === 1) out += mo + 1;
        else if (v.length === 2) out += pad(mo + 1, 2);
        else if (v.length === 3) out += MONTHS[mo].slice(0, 3);
        else if (v.length === 5) out += MONTHS[mo][0];
        else out += MONTHS[mo];
      } else if (v[0] === 'd') {
        if (v.length === 1) out += day;
        else if (v.length === 2) out += pad(day, 2);
        else if (v.length === 3) out += DAYS[wd].slice(0, 3);
        else out += DAYS[wd];
      } else if (v[0] === 'h') {
        let h = H;
        if (hasAmPm) { h = H % 12; if (h === 0) h = 12; }
        out += v.length === 1 ? h : pad(h, 2);
      } else if (v[0] === 's') out += v.length === 1 ? S : pad(S, 2);
    }
    return out;
  }

  function groupThousands(intStr) {
    return intStr.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function formatNumberSection(n, toks, keepSign) {
    // Locate the numeric picture: the digits, the point, grouping, %, E.
    const isPh = (t) => t.k === 'ch' && (t.v === '0' || t.v === '#' || t.v === '?');
    let first = -1, last = -1;
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i];
      if (t.k === 'ch' && /[eE]/.test(t.v) && toks[i + 1] && /[+-]/.test(toks[i + 1].v) && first >= 0) break;
      if (isPh(t) || (t.k === 'ch' && t.v === '.' && first >= 0)) { if (first < 0) first = i; last = i; }
    }
    let pct = 0;
    toks.forEach((t) => { if (t.k === 'ch' && t.v === '%') pct++; });
    let v = Math.abs(n) * Math.pow(100, pct);
    const neg = n < 0 && !keepSign;
    if (first < 0) {
      // No digits at all: pure literal section ("-" in accounting zero).
      return (neg ? '-' : '') + toks.map((t) => t.v).join('');
    }
    // Expand picture to include E+00 tail and trailing commas.
    let exp = null;
    for (let i = last + 1; i < toks.length; i++) {
      const t = toks[i];
      if (t.k === 'ch' && /[eE]/.test(t.v) && toks[i + 1] && /[+-]/.test(toks[i + 1].v)) {
        let j = i + 2, digits = 0;
        while (toks[j] && isPh(toks[j])) { digits++; j++; }
        exp = { sign: toks[i + 1].v, digits: Math.max(1, digits) };
        last = j - 1;
        break;
      }
      if (!(t.k === 'ch' && t.v === ',')) break;
      last = i;
    }
    const pic = toks.slice(first, last + 1).filter((t) => t.k === 'ch').map((t) => t.v).join('');
    const mantPic = exp ? pic.replace(/[eE][+-][0#?]*$/, '') : pic;
    let scale = 0;
    let body = mantPic;
    while (body.endsWith(',')) { scale++; body = body.slice(0, -1); }
    v /= Math.pow(1000, scale);
    const dot = body.indexOf('.');
    const intPic = dot >= 0 ? body.slice(0, dot) : body;
    const fracPic = dot >= 0 ? body.slice(dot + 1).replace(/[^0#?]/g, '') : '';
    const grouping = intPic.includes(',');
    const minInt = (intPic.match(/0/g) || []).length;
    let e = 0;
    if (exp) {
      if (v !== 0) {
        const intPh = Math.max(1, (intPic.match(/[0#?]/g) || []).length);
        e = Math.floor(Math.log10(v));
        e -= (((e % intPh) + intPh) % intPh);
        v /= Math.pow(10, e);
      }
    }
    const fd = fracPic.length;
    let fixed = v.toFixed(fd);
    if (exp && Number(fixed) >= 10 && v !== 0) { v /= 10; e += 1; fixed = v.toFixed(fd); }
    let [ip, fp = ''] = fixed.split('.');
    if (ip === '0' && minInt === 0) ip = '';
    ip = ip.padStart(minInt, '0');
    if (grouping) ip = groupThousands(ip);
    // trailing # in the fraction drop zeros; ? becomes a space
    if (fd) {
      const chars = fp.split('');
      for (let i = fd - 1; i >= 0; i--) {
        if (chars[i] !== '0') break;
        if (fracPic[i] === '#') chars[i] = '';
        else if (fracPic[i] === '?') chars[i] = ' ';
        else break;
      }
      fp = chars.join('');
    }
    let num = ip + (dot >= 0 ? '.' + fp : '');
    if (dot >= 0 && !fp) num = ip + (fracPic.length ? '.' : '');
    if (num.endsWith('.') && !fracPic.includes('0')) num = num.slice(0, -1);
    if (exp) {
      const es = Math.abs(e);
      num += 'E' + (e < 0 ? '-' : (exp.sign === '+' ? '+' : '')) + String(es).padStart(exp.digits, '0');
    }
    const prefix = toks.slice(0, first).map((t) => (t.k === 'elapsed' ? '' : t.v)).join('');
    const suffix = toks.slice(last + 1).map((t) => t.v).join('');
    return (neg ? '-' : '') + prefix + num + suffix;
  }

  const fmtCache = new Map();
  function compileFormat(code) {
    let f = fmtCache.get(code);
    if (f) return f;
    const secs = splitSections(code).map(lexSection);
    f = secs.map((s) => ({ ...s, date: sectionIsDate(s.toks), text: s.toks.some((t) => t.k === 'ch' && t.v === '@') }));
    fmtCache.set(code, f);
    return f;
  }

  /* value -> { text, color } for a cell with format code `code`. */
  function formatValue(value, code) {
    if (value == null) return { text: '' };
    if (isErr(value)) return { text: value.code };
    if (typeof value === 'boolean') return { text: value ? 'TRUE' : 'FALSE' };
    if (!code || /^general$/i.test(code)) {
      return { text: typeof value === 'number' ? formatGeneral(value) : String(value) };
    }
    const secs = compileFormat(code);
    if (typeof value === 'string') {
      const ts = secs.length >= 4 ? secs[3] : secs.find((s) => s.text);
      if (!ts) return { text: value };
      return { text: ts.toks.map((t) => (t.k === 'ch' && t.v === '@' ? value : t.v)).join(''), color: ts.color };
    }
    if (!Number.isFinite(value)) return { text: '#NUM!' };
    let sec = secs[0], keepSign = false;
    if (secs.length >= 2 && !secs[0].cond) {
      if (value < 0) { sec = secs[1]; keepSign = true; }
      else if (value === 0 && secs.length >= 3) sec = secs[2];
    } else if (secs[0].cond) {
      const m = /^([<>=]+)(-?[\d.]+)$/.exec(secs[0].cond);
      const pass = m && compareOp(m[1], value, Number(m[2]));
      sec = pass ? secs[0] : (secs[1] || secs[0]);
    }
    if (sec.text && !sec.date && !sec.toks.some((t) => t.k === 'ch' && /[0#?]/.test(t.v))) {
      return { text: formatGeneral(value) };
    }
    const text = sec.date
      ? formatDateSection(value, sec.toks)
      : formatNumberSection(keepSign ? Math.abs(value) : value, sec.toks, keepSign);
    return { text, color: sec.color || undefined };
  }
  function compareOp(op, a, b) {
    switch (op) {
      case '>': return a > b; case '<': return a < b; case '>=': return a >= b;
      case '<=': return a <= b; case '=': return a === b; case '<>': return a !== b;
      default: return false;
    }
  }

  /* Add or remove one decimal place, as Excel's .0 buttons do. */
  function stepFormatDecimals(code, delta, sample) {
    if (!code || /^general$/i.test(code)) {
      const cur = typeof sample === 'number' ? ((formatGeneral(sample).split('.')[1] || '').replace(/E.*$/, '').length) : 0;
      const d = Math.max(0, cur + delta);
      return d ? '0.' + '0'.repeat(d) : '0';
    }
    if (compileFormat(code).some((s) => s.date)) return code;
    return splitSections(code).map((sec) => {
      // find digit placeholders outside quotes
      let q = false, lastPh = -1, dot = -1, lastFrac = -1;
      for (let i = 0; i < sec.length; i++) {
        const ch = sec[i];
        if (ch === '"') { q = !q; continue; }
        if (q) continue;
        if (ch === '[') { const j = sec.indexOf(']', i); i = j < 0 ? sec.length : j; continue; }
        if (ch === '\\' || ch === '_' || ch === '*') { i++; continue; }
        if (/[eE]/.test(ch) && /[+-]/.test(sec[i + 1] || '')) break;
        if (ch === '.' && lastPh >= 0 && dot < 0) dot = i;
        if (/[0#?]/.test(ch)) { lastPh = i; if (dot >= 0) lastFrac = i; }
      }
      if (lastPh < 0) return sec;
      if (delta > 0) {
        if (dot >= 0) return sec.slice(0, (lastFrac >= 0 ? lastFrac : dot) + 1) + '0' + sec.slice((lastFrac >= 0 ? lastFrac : dot) + 1);
        return sec.slice(0, lastPh + 1) + '.0' + sec.slice(lastPh + 1);
      }
      if (dot < 0 || lastFrac < 0) return sec;
      if (lastFrac === dot + 1) return sec.slice(0, dot) + sec.slice(lastFrac + 1);
      return sec.slice(0, lastFrac) + sec.slice(lastFrac + 1);
    }).join(';');
  }

  function formatPresetOf(code) {
    if (!code) return 'general';
    const p = FORMAT_PRESETS.find((x) => x.code === code);
    if (p) return p.id;
    if (/%/.test(code)) return 'percent';
    if (/^"\$"#,##0/.test(code) || /^\$#,##0/.test(code)) return 'currency';
    if (/^"€"/.test(code)) return 'eur';
    if (/^"£"/.test(code)) return 'gbp';
    if (/^"₹"/.test(code)) return 'inr';
    if (/^#,##0(\.0+)?$/.test(code)) return 'number';
    if (/E\+/.test(code)) return 'scientific';
    return 'custom';
  }

  /* A formula whose outermost call makes a date is shown as one, as Excel
     formats the cell when such a formula is entered. */
  function impliedFormat(raw) {
    const m = /^=\s*([A-Za-z.]+)\s*\(/.exec(raw);
    if (!m) return '';
    const fn = m[1].toUpperCase();
    if (fn === 'NOW') return 'yyyy-mm-dd h:mm';
    if (fn === 'TIME') return 'h:mm AM/PM';
    if (['TODAY', 'DATE', 'EDATE', 'EOMONTH', 'DATEVALUE', 'WORKDAY'].includes(fn)) return 'yyyy-mm-dd';
    return '';
  }

  /* ======================================================================
     3. Formula tokenizer, parser, reference rewriting
     ====================================================================== */

  const SHEET_QUOTED_RE = /^'((?:[^']|'')+)'!/;
  const SHEET_PLAIN_RE = /^([A-Za-z_À-￿][\w.À-￿]*)!/;
  const CELL_RE = /^(\$?)([A-Za-z]{1,3})(\$?)([0-9]{1,7})(?![A-Za-z0-9_(])/;
  const COLRANGE_RE = /^(\$?)([A-Za-z]{1,3}):(\$?)([A-Za-z]{1,3})(?![A-Za-z0-9_(])/;
  const ROWRANGE_RE = /^(\$?)([0-9]{1,7}):(\$?)([0-9]{1,7})(?![0-9A-Za-z_.])/;
  const NUMBER_TOKEN_RE = /^(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?/;
  const NAME_TOKEN_RE = /^[A-Za-z_\\][A-Za-z0-9_.]*/;
  const ERROR_TOKEN_RE = /^#(?:DIV\/0!|N\/A|NAME\?|REF!|VALUE!|NUM!|NULL!|CIRCULAR!|ERROR!)/i;

  function quoteSheetName(name) {
    return /^[A-Za-z_][A-Za-z0-9_.]*$/.test(name) && !/^[A-Za-z]{1,3}[0-9]+$/.test(name)
      ? name : `'${String(name).replace(/'/g, "''")}'`;
  }

  function tokenize(src) {
    const toks = [];
    let i = 0;
    while (i < src.length) {
      const ch = src[i];
      if (/\s/.test(ch)) { i++; continue; }
      const start = i;
      if (ch === '"') {
        let j = i + 1, text = '';
        for (;;) {
          if (j >= src.length) throw new Error('unterminated text');
          if (src[j] === '"') { if (src[j + 1] === '"') { text += '"'; j += 2; continue; } break; }
          text += src[j++];
        }
        toks.push({ t: 'str', v: text, s: start, e: j + 1 });
        i = j + 1;
        continue;
      }
      if (ch === '#') {
        const m = ERROR_TOKEN_RE.exec(src.slice(i));
        if (!m) throw new Error('bad error literal');
        toks.push({ t: 'err', v: m[0].toUpperCase(), s: start, e: i + m[0].length });
        i += m[0].length;
        continue;
      }
      // optional sheet prefix before a reference
      const rest = src.slice(i);
      let sheet = null, plen = 0;
      const qm = SHEET_QUOTED_RE.exec(rest);
      const pm = !qm && SHEET_PLAIN_RE.exec(rest);
      if (qm) { sheet = qm[1].replace(/''/g, "'"); plen = qm[0].length; }
      else if (pm) { sheet = pm[1]; plen = pm[0].length; }
      const body = rest.slice(plen);
      let m;
      if ((m = COLRANGE_RE.exec(body))) {
        toks.push({ t: 'cols', sheet, c1: colIndex(m[2]), a1: !!m[1], c2: colIndex(m[4]), a2: !!m[3], s: start, e: i + plen + m[0].length });
        i += plen + m[0].length;
        continue;
      }
      if ((m = ROWRANGE_RE.exec(body)) && (sheet || !/[0-9.]/.test(src[i - 1] || ''))) {
        toks.push({ t: 'rows', sheet, r1: +m[2] - 1, a1: !!m[1], r2: +m[4] - 1, a2: !!m[3], s: start, e: i + plen + m[0].length });
        i += plen + m[0].length;
        continue;
      }
      if ((m = CELL_RE.exec(body))) {
        toks.push({ t: 'ref', sheet, c: colIndex(m[2]), ac: !!m[1], r: +m[4] - 1, ar: !!m[3], s: start, e: i + plen + m[0].length });
        i += plen + m[0].length;
        continue;
      }
      if (sheet) {
        // Sheet1!#REF! style leftovers
        const em = ERROR_TOKEN_RE.exec(body);
        if (em) { toks.push({ t: 'err', v: em[0].toUpperCase(), s: start, e: i + plen + em[0].length }); i += plen + em[0].length; continue; }
        throw new Error('bad reference');
      }
      if ((m = NUMBER_TOKEN_RE.exec(rest))) {
        toks.push({ t: 'num', v: Number(m[0]), s: start, e: i + m[0].length });
        i += m[0].length;
        continue;
      }
      if ((m = NAME_TOKEN_RE.exec(rest))) {
        toks.push({ t: 'name', v: m[0], s: start, e: i + m[0].length });
        i += m[0].length;
        continue;
      }
      const two = src.substr(i, 2);
      if (two === '<>' || two === '<=' || two === '>=') {
        toks.push({ t: 'op', v: two, s: start, e: i + 2 });
        i += 2;
        continue;
      }
      if ('+-*/^&=<>(),:%{};'.indexOf(ch) >= 0) {
        toks.push({ t: 'op', v: ch, s: start, e: i + 1 });
        i++;
        continue;
      }
      throw new Error('unexpected character ' + ch);
    }
    return toks;
  }

  /* Recursive descent in Excel's precedence order:
       comparison < & < + - < * / < ^ < % < unary minus < reference/range. */
  function parse(src) {
    const toks = tokenize(src);
    let p = 0;
    const peek = () => toks[p];
    const isOp = (v) => toks[p] && toks[p].t === 'op' && toks[p].v === v;
    const expect = (v) => { if (!isOp(v)) throw new Error('expected ' + v); p++; };

    function comparison() {
      let a = concat();
      while (isOp('=') || isOp('<>') || isOp('<') || isOp('>') || isOp('<=') || isOp('>=')) {
        const op = toks[p++].v;
        a = { k: 'bin', op, a, b: concat() };
      }
      return a;
    }
    function concat() {
      let a = additive();
      while (isOp('&')) { p++; a = { k: 'bin', op: '&', a, b: additive() }; }
      return a;
    }
    function additive() {
      let a = multiplicative();
      while (isOp('+') || isOp('-')) { const op = toks[p++].v; a = { k: 'bin', op, a, b: multiplicative() }; }
      return a;
    }
    function multiplicative() {
      let a = power();
      while (isOp('*') || isOp('/')) { const op = toks[p++].v; a = { k: 'bin', op, a, b: power() }; }
      return a;
    }
    function power() {
      let a = unary();
      while (isOp('^')) { p++; a = { k: 'bin', op: '^', a, b: unary() }; }
      return a;
    }
    function unary() {
      if (isOp('-')) { p++; return { k: 'neg', a: unary() }; }
      if (isOp('+')) { p++; return unary(); }
      return postfix();
    }
    function postfix() {
      let a = primary();
      while (isOp('%')) { p++; a = { k: 'pct', a }; }
      return a;
    }
    function args() {
      const list = [];
      expect('(');
      if (isOp(')')) { p++; return list; }
      for (;;) {
        if (isOp(',') || isOp(')')) list.push({ k: 'missing' });
        else list.push(comparison());
        if (isOp(',')) { p++; continue; }
        expect(')');
        return list;
      }
    }
    function arrayLit() {
      const rows = [[]];
      p++;
      for (;;) {
        let sign = 1;
        if (isOp('-')) { sign = -1; p++; }
        const t = peek();
        if (!t) throw new Error('unterminated array');
        if (t.t === 'num') rows[rows.length - 1].push(sign * t.v);
        else if (t.t === 'str') rows[rows.length - 1].push(t.v);
        else if (t.t === 'name' && /^(TRUE|FALSE)$/i.test(t.v)) rows[rows.length - 1].push(/^TRUE$/i.test(t.v));
        else if (t.t === 'err') rows[rows.length - 1].push(ERR_BY_CODE[t.v] || ERR.VALUE);
        else throw new Error('bad array item');
        p++;
        if (isOp(',')) { p++; continue; }
        if (isOp(';')) { p++; rows.push([]); continue; }
        expect('}');
        return { k: 'arr', rows };
      }
    }
    function primary() {
      const t = peek();
      if (!t) throw new Error('unexpected end');
      if (t.t === 'num') { p++; return { k: 'num', v: t.v }; }
      if (t.t === 'str') { p++; return { k: 'str', v: t.v }; }
      if (t.t === 'err') { p++; return { k: 'err', v: ERR_BY_CODE[t.v] || ERR.REF }; }
      if (t.t === 'ref') {
        p++;
        if (isOp(':') && toks[p + 1] && toks[p + 1].t === 'ref') {
          p++;
          const b = toks[p++];
          return { k: 'range', sheet: t.sheet || b.sheet, r1: t.r, c1: t.c, r2: b.r, c2: b.c };
        }
        return { k: 'ref', sheet: t.sheet, r: t.r, c: t.c };
      }
      if (t.t === 'cols') { p++; return { k: 'cols', sheet: t.sheet, c1: t.c1, c2: t.c2 }; }
      if (t.t === 'rows') { p++; return { k: 'rows', sheet: t.sheet, r1: t.r1, r2: t.r2 }; }
      if (t.t === 'name') {
        p++;
        if (isOp('(')) return { k: 'call', name: t.v.toUpperCase().replace(/^_XLFN\./, ''), args: args() };
        const u = t.v.toUpperCase();
        if (u === 'TRUE') return { k: 'bool', v: true };
        if (u === 'FALSE') return { k: 'bool', v: false };
        return { k: 'name', v: t.v };
      }
      if (isOp('(')) { p++; const e = comparison(); expect(')'); return e; }
      if (isOp('{')) return arrayLit();
      throw new Error('unexpected token');
    }
    const ast = comparison();
    if (p < toks.length) throw new Error('unexpected ' + toks[p].v);
    return ast;
  }

  function fmtRef(sheet, r, c, ar, ac) {
    return (sheet != null ? quoteSheetName(sheet) + '!' : '') + (ac ? '$' : '') + colName(c) + (ar ? '$' : '') + (r + 1);
  }

  /* Rewrites every reference in a formula through `map`, leaving the rest of
     the text exactly as typed. `map` gets one of
       { kind:'cell', sheet, r, c, ar, ac }
       { kind:'range', sheet, a:{r,c,ar,ac}, b:{r,c,ar,ac} }
       { kind:'cols', sheet, c1, c2, a1, a2 } / { kind:'rows', ... }
     and returns replacement text or null to keep it. */
  function rewriteFormula(formula, map) {
    if (typeof formula !== 'string' || formula[0] !== '=') return formula;
    let toks;
    try { toks = tokenize(formula.slice(1)); } catch { return formula; }
    const off = 1;
    let out = '', last = 0, changed = false;
    const put = (s, e, text) => {
      if (text == null) return;
      out += formula.slice(last, s + off) + text;
      last = e + off;
      changed = true;
    };
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i];
      if (t.t === 'ref') {
        const colon = toks[i + 1], b = toks[i + 2];
        if (colon && colon.t === 'op' && colon.v === ':' && b && b.t === 'ref' && !b.sheet) {
          put(t.s, b.e, map({ kind: 'range', sheet: t.sheet, a: { r: t.r, c: t.c, ar: t.ar, ac: t.ac }, b: { r: b.r, c: b.c, ar: b.ar, ac: b.ac } }));
          i += 2;
          continue;
        }
        put(t.s, t.e, map({ kind: 'cell', sheet: t.sheet, r: t.r, c: t.c, ar: t.ar, ac: t.ac }));
      } else if (t.t === 'cols') {
        put(t.s, t.e, map({ kind: 'cols', sheet: t.sheet, c1: t.c1, c2: t.c2, a1: t.a1, a2: t.a2 }));
      } else if (t.t === 'rows') {
        put(t.s, t.e, map({ kind: 'rows', sheet: t.sheet, r1: t.r1, r2: t.r2, a1: t.a1, a2: t.a2 }));
      }
    }
    if (!changed) return formula;
    return out + formula.slice(last);
  }

  /* Copying a formula moves its relative references with it. */
  function offsetFormula(formula, dr, dc) {
    if (!dr && !dc) return formula;
    return rewriteFormula(formula, (ref) => {
      const pre = ref.sheet != null ? quoteSheetName(ref.sheet) + '!' : '';
      const mv = (x) => ({ r: x.ar ? x.r : x.r + dr, c: x.ac ? x.c : x.c + dc, ar: x.ar, ac: x.ac });
      const bad = (x) => x.r < 0 || x.c < 0 || x.r >= MAX_ROWS || x.c >= MAX_COLS;
      if (ref.kind === 'cell') {
        const x = mv(ref);
        return bad(x) ? pre + '#REF!' : fmtRef(ref.sheet, x.r, x.c, x.ar, x.ac);
      }
      if (ref.kind === 'range') {
        const a = mv(ref.a), b = mv(ref.b);
        if (bad(a) || bad(b)) return pre + '#REF!';
        return fmtRef(ref.sheet, a.r, a.c, a.ar, a.ac) + ':' + fmtRef(null, b.r, b.c, b.ar, b.ac);
      }
      if (ref.kind === 'cols') {
        const c1 = ref.a1 ? ref.c1 : ref.c1 + dc, c2 = ref.a2 ? ref.c2 : ref.c2 + dc;
        if (c1 < 0 || c2 < 0) return pre + '#REF!';
        return pre + (ref.a1 ? '$' : '') + colName(c1) + ':' + (ref.a2 ? '$' : '') + colName(c2);
      }
      const r1 = ref.a1 ? ref.r1 : ref.r1 + dr, r2 = ref.a2 ? ref.r2 : ref.r2 + dr;
      if (r1 < 0 || r2 < 0) return pre + '#REF!';
      return pre + (ref.a1 ? '$' : '') + (r1 + 1) + ':' + (ref.a2 ? '$' : '') + (r2 + 1);
    });
  }

  /* Inserting or deleting rows/columns on `targetSheet` (by name). `own` is
     the sheet the formula lives on, which is what an unprefixed reference
     means. axis 'r' or 'c'; count > 0 inserts before `at`, count < 0 deletes
     -count starting at `at`. */
  function shiftFormula(formula, own, targetSheet, axis, at, count) {
    const same = (s) => String(s == null ? own : s).toLowerCase() === String(targetSheet).toLowerCase();
    const del = count < 0 ? -count : 0;
    const moveIdx = (i) => {
      if (count > 0) return i >= at ? i + count : i;
      if (i >= at + del) return i - del;
      if (i >= at) return null;
      return i;
    };
    const moveSpan = (lo, hi) => {
      if (count > 0) return [lo >= at ? lo + count : lo, hi >= at ? hi + count : hi];
      const nlo = lo >= at + del ? lo - del : (lo >= at ? at : lo);
      const nhi = hi >= at + del ? hi - del : (hi >= at ? at - 1 : hi);
      if (nhi < nlo) return null;
      return [nlo, nhi];
    };
    return rewriteFormula(formula, (ref) => {
      if (!same(ref.sheet)) return null;
      const pre = ref.sheet != null ? quoteSheetName(ref.sheet) + '!' : '';
      if (ref.kind === 'cell') {
        const idx = axis === 'r' ? ref.r : ref.c;
        const n = moveIdx(idx);
        if (n === idx) return null;
        if (n == null) return pre + '#REF!';
        return axis === 'r' ? fmtRef(ref.sheet, n, ref.c, ref.ar, ref.ac) : fmtRef(ref.sheet, ref.r, n, ref.ar, ref.ac);
      }
      if (ref.kind === 'range') {
        const lo = axis === 'r' ? Math.min(ref.a.r, ref.b.r) : Math.min(ref.a.c, ref.b.c);
        const hi = axis === 'r' ? Math.max(ref.a.r, ref.b.r) : Math.max(ref.a.c, ref.b.c);
        const span = moveSpan(lo, hi);
        if (!span) return pre + '#REF!';
        if (span[0] === lo && span[1] === hi) return null;
        const a = { ...ref.a }, b = { ...ref.b };
        const aLow = axis === 'r' ? a.r <= b.r : a.c <= b.c;
        const setA = aLow ? span[0] : span[1], setB = aLow ? span[1] : span[0];
        if (axis === 'r') { a.r = setA; b.r = setB; } else { a.c = setA; b.c = setB; }
        return fmtRef(ref.sheet, a.r, a.c, a.ar, a.ac) + ':' + fmtRef(null, b.r, b.c, b.ar, b.ac);
      }
      if (ref.kind === 'cols' && axis === 'c') {
        const span = moveSpan(ref.c1, ref.c2);
        if (!span) return pre + '#REF!';
        if (span[0] === ref.c1 && span[1] === ref.c2) return null;
        return pre + (ref.a1 ? '$' : '') + colName(span[0]) + ':' + (ref.a2 ? '$' : '') + colName(span[1]);
      }
      if (ref.kind === 'rows' && axis === 'r') {
        const span = moveSpan(ref.r1, ref.r2);
        if (!span) return pre + '#REF!';
        if (span[0] === ref.r1 && span[1] === ref.r2) return null;
        return pre + (ref.a1 ? '$' : '') + (span[0] + 1) + ':' + (ref.a2 ? '$' : '') + (span[1] + 1);
      }
      return null;
    });
  }

  /* A sheet renamed or removed: prefixes follow it, or turn into #REF!. */
  function renameSheetInFormula(formula, oldName, newName) {
    return rewriteFormula(formula, (ref) => {
      if (ref.sheet == null || ref.sheet.toLowerCase() !== String(oldName).toLowerCase()) return null;
      if (newName == null) return '#REF!';
      const pre = quoteSheetName(newName) + '!';
      if (ref.kind === 'cell') return pre + fmtRef(null, ref.r, ref.c, ref.ar, ref.ac);
      if (ref.kind === 'range') return pre + fmtRef(null, ref.a.r, ref.a.c, ref.a.ar, ref.a.ac) + ':' + fmtRef(null, ref.b.r, ref.b.c, ref.b.ar, ref.b.ac);
      if (ref.kind === 'cols') return pre + (ref.a1 ? '$' : '') + colName(ref.c1) + ':' + (ref.a2 ? '$' : '') + colName(ref.c2);
      return pre + (ref.a1 ? '$' : '') + (ref.r1 + 1) + ':' + (ref.a2 ? '$' : '') + (ref.r2 + 1);
    });
  }

  /* Cut and paste: references into the moved block follow it. */
  function moveRefsInFormula(formula, own, sheetName, src, dr, dc) {
    const same = (s) => String(s == null ? own : s).toLowerCase() === String(sheetName).toLowerCase();
    return rewriteFormula(formula, (ref) => {
      if (!same(ref.sheet)) return null;
      if (ref.kind === 'cell') {
        if (!inRange(src, ref.r, ref.c)) return null;
        return fmtRef(ref.sheet, ref.r + dr, ref.c + dc, ref.ar, ref.ac);
      }
      if (ref.kind === 'range') {
        if (!inRange(src, ref.a.r, ref.a.c) || !inRange(src, ref.b.r, ref.b.c)) return null;
        return fmtRef(ref.sheet, ref.a.r + dr, ref.a.c + dc, ref.a.ar, ref.a.ac) + ':' + fmtRef(null, ref.b.r + dr, ref.b.c + dc, ref.b.ar, ref.b.ac);
      }
      return null;
    });
  }

  /* The references in a formula being typed, for colouring them on the
     grid. Positions are into the full text including "=". */
  function formulaRefs(text) {
    if (typeof text !== 'string' || text[0] !== '=') return [];
    let toks;
    try { toks = tokenize(text.slice(1)); } catch {
      // Colour what can be read so far: tokenise up to the failure.
      toks = [];
      for (let n = text.length - 1; n > 1; n--) {
        try { toks = tokenize(text.slice(1, n)); break; } catch {}
      }
    }
    const out = [];
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i];
      if (t.t !== 'ref') continue;
      const colon = toks[i + 1], b = toks[i + 2];
      if (colon && colon.v === ':' && b && b.t === 'ref') {
        out.push({ sheet: t.sheet, r1: Math.min(t.r, b.r), c1: Math.min(t.c, b.c), r2: Math.max(t.r, b.r), c2: Math.max(t.c, b.c), s: t.s + 1, e: b.e + 1 });
        i += 2;
      } else out.push({ sheet: t.sheet, r1: t.r, c1: t.c, r2: t.r, c2: t.c, s: t.s + 1, e: t.e + 1 });
    }
    return out;
  }

  /* ======================================================================
     4. Function library
     ====================================================================== */

  /* A block of cells as a function argument; read through the engine. */
  class Rng {
    constructor(sheet, r1, c1, r2, c2) { this.sheet = sheet; this.r1 = r1; this.c1 = c1; this.r2 = r2; this.c2 = c2; }
    get rows() { return this.r2 - this.r1 + 1; }
    get cols() { return this.c2 - this.c1 + 1; }
  }
  /* An array constant or the result of arithmetic over ranges. */
  class Arr {
    constructor(rows) { this.m = rows; }
    get rows() { return this.m.length; }
    get cols() { return this.m[0] ? this.m[0].length : 0; }
  }
  const isMulti = (v) => v instanceof Rng || v instanceof Arr;

  function matrixOf(v, cx) {
    if (v instanceof Arr) return v.m;
    if (v instanceof Rng) {
      const out = [];
      for (let r = v.r1; r <= v.r2; r++) {
        const row = [];
        for (let c = v.c1; c <= v.c2; c++) row.push(cx.val(v.sheet, r, c));
        out.push(row);
      }
      return out;
    }
    return [[v]];
  }
  /* Visit each value of a range/array (or the one scalar). Stop on `false`. */
  function eachValue(v, cx, fn) {
    if (v instanceof Rng) {
      const lim = cx.usedBounds(v.sheet);
      const r2 = Math.min(v.r2, lim.r), c2 = Math.min(v.c2, lim.c);
      for (let r = v.r1; r <= r2; r++) {
        for (let c = v.c1; c <= c2; c++) if (fn(cx.val(v.sheet, r, c), true) === false) return;
      }
      // cells past the used area are blank; only COUNTBLANK-like callers care
      return;
    }
    if (v instanceof Arr) {
      for (const row of v.m) for (const x of row) if (fn(x, true) === false) return;
      return;
    }
    fn(v, false);
  }
  function flatValues(v, cx) {
    const out = [];
    eachValue(v, cx, (x) => { out.push(x); });
    return out;
  }
  /* Implicit intersection: a range used where one value is wanted. */
  function scalar(v, cx) {
    if (v instanceof Rng) {
      if (v.r1 === v.r2 && v.c1 === v.c2) return cx.val(v.sheet, v.r1, v.c1);
      if (v.c1 === v.c2 && cx.r >= v.r1 && cx.r <= v.r2 && v.sheet === cx.sheet) return cx.val(v.sheet, cx.r, v.c1);
      if (v.r1 === v.r2 && cx.c >= v.c1 && cx.c <= v.c2 && v.sheet === cx.sheet) return cx.val(v.sheet, v.r1, cx.c);
      return ERR.VALUE;
    }
    if (v instanceof Arr) return v.m[0] ? v.m[0][0] : ERR.VALUE;
    return v === undefined ? null : v;
  }
  function toNumber(v) {
    if (v == null) return 0;
    if (typeof v === 'number') return v;
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (isErr(v)) return v;
    const s = String(v);
    if (s.trim() === '') return 0;
    const n = parseNumberText(s);
    return n == null ? ERR.VALUE : n;
  }
  function toText(v) {
    if (v == null) return '';
    if (typeof v === 'number') return formatGeneral(v);
    if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
    if (isErr(v)) return v;
    return String(v);
  }
  function toBool(v) {
    if (v == null) return false;
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v !== 0;
    if (isErr(v)) return v;
    const u = String(v).trim().toUpperCase();
    if (u === 'TRUE') return true;
    if (u === 'FALSE') return false;
    const n = parseNumberText(v);
    return n == null ? ERR.VALUE : n !== 0;
  }
  const N = (v, cx) => toNumber(scalar(v, cx));
  const S = (v, cx) => toText(scalar(v, cx));
  const B = (v, cx) => toBool(scalar(v, cx));
  const isMissing = (v) => v === undefined || !!(v && (v.missing || v.k === 'missing'));

  /* Excel's ordering for comparisons: numbers < text < booleans, text
     compared without case. Blank meets the other side's type as 0 or "". */
  function typeRank(v) { return typeof v === 'number' ? 0 : typeof v === 'string' ? 1 : typeof v === 'boolean' ? 2 : 3; }
  function compareValues(a, b) {
    if (a == null && b == null) return 0;
    if (a == null) a = typeof b === 'string' ? '' : typeof b === 'boolean' ? false : 0;
    if (b == null) b = typeof a === 'string' ? '' : typeof a === 'boolean' ? false : 0;
    const ta = typeRank(a), tb = typeRank(b);
    if (ta !== tb) return ta < tb ? -1 : 1;
    if (ta === 1) {
      const x = a.toLowerCase(), y = b.toLowerCase();
      return x < y ? -1 : x > y ? 1 : 0;
    }
    if (ta === 2) return a === b ? 0 : (a ? 1 : -1);
    return a < b ? -1 : a > b ? 1 : 0;
  }

  /* Numbers for SUM-like functions: from ranges only real numbers count;
     typed arguments are coerced. Errors propagate. */
  function numbersOf(args, cx, opts) {
    const out = [];
    for (const a of args) {
      if (isMissing(a)) continue;
      if (isMulti(a)) {
        let err = null;
        eachValue(a, cx, (x) => {
          if (isErr(x)) { err = x; return false; }
          if (typeof x === 'number') out.push(x);
          else if (opts && opts.all && x != null) out.push(typeof x === 'boolean' ? (x ? 1 : 0) : 0);
          return undefined;
        });
        if (err) return err;
      } else {
        const n = toNumber(a);
        if (isErr(n)) return n;
        out.push(n);
      }
    }
    return out;
  }

  function wildcardRegex(pat) {
    let re = '';
    for (let i = 0; i < pat.length; i++) {
      const ch = pat[i];
      if (ch === '~' && i + 1 < pat.length) { re += pat[++i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); continue; }
      if (ch === '*') re += '[\\s\\S]*';
      else if (ch === '?') re += '[\\s\\S]';
      else re += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    return new RegExp('^' + re + '$', 'i');
  }

  /* COUNTIF-style criteria: 5, ">5", "<>x", "a*", "" ... */
  function makeCriterion(crit) {
    if (typeof crit === 'number' || typeof crit === 'boolean') return (v) => (typeof v === 'string' ? parseNumberText(v) === crit : v === crit);
    if (crit == null) return (v) => v == null || v === '';
    if (isErr(crit)) return (v) => v === crit;
    const s = String(crit);
    const m = /^(<=|>=|<>|<|>|=)?([\s\S]*)$/.exec(s);
    const op = m[1] || '=';
    const rhsText = m[2];
    const rhsNum = parseNumberText(rhsText);
    const rhsBool = /^(true|false)$/i.test(rhsText) ? /^true$/i.test(rhsText) : null;
    if (op === '=' || op === '<>') {
      let test;
      if (rhsText === '') test = (v) => v == null || v === '';
      else if (rhsNum != null) test = (v) => (typeof v === 'number' ? v === rhsNum : (typeof v === 'string' && parseNumberText(v) === rhsNum));
      else if (rhsBool != null) test = (v) => v === rhsBool;
      else if (/[*?~]/.test(rhsText)) { const re = wildcardRegex(rhsText); test = (v) => typeof v === 'string' && re.test(v); }
      else { const low = rhsText.toLowerCase(); test = (v) => typeof v === 'string' && v.toLowerCase() === low; }
      return op === '=' ? test : (v) => !test(v);
    }
    if (rhsNum != null) {
      return (v) => typeof v === 'number' && compareOp(op, v, rhsNum);
    }
    return (v) => typeof v === 'string' && compareOp(op, compareValues(v, rhsText), 0);
  }

  function criteriaMask(pairs, cx) {
    // pairs: [[range, criterion], ...] -> list of [r,c offsets] that match all
    const first = pairs[0][0];
    if (!(first instanceof Rng) && !(first instanceof Arr)) return ERR.VALUE;
    const rows = first.rows, cols = first.cols;
    const tests = pairs.map(([rg, cr]) => [rg, makeCriterion(scalar(cr, cx))]);
    for (const [rg] of tests) if (!isMulti(rg) || rg.rows !== rows || rg.cols !== cols) return ERR.VALUE;
    const hits = [];
    const mats = tests.map(([rg]) => (rg instanceof Rng ? null : rg.m));
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < cols; j++) {
        let ok = true;
        for (let k = 0; k < tests.length && ok; k++) {
          const rg = tests[k][0];
          const v = mats[k] ? mats[k][i][j] : cx.val(rg.sheet, rg.r1 + i, rg.c1 + j);
          ok = tests[k][1](v);
        }
        if (ok) hits.push([i, j]);
      }
    }
    return hits;
  }
  function valueAt(rg, i, j, cx) {
    if (rg instanceof Rng) return cx.val(rg.sheet, rg.r1 + i, rg.c1 + j);
    if (rg instanceof Arr) return rg.m[i] ? rg.m[i][j] : null;
    return rg;
  }
  /* Criteria ranges can run the length of a whole column; stop at the data. */
  function clampToUsed(rg, cx) {
    if (!(rg instanceof Rng)) return rg;
    const lim = cx.usedBounds(rg.sheet);
    return new Rng(rg.sheet, rg.r1, rg.c1, Math.max(rg.r1, Math.min(rg.r2, lim.r)), Math.max(rg.c1, Math.min(rg.c2, lim.c)));
  }
  function sameShapeClamp(base, other) {
    if (!(other instanceof Rng) || !(base instanceof Rng)) return other;
    return new Rng(other.sheet, other.r1, other.c1, other.r1 + base.rows - 1, other.c1 + base.cols - 1);
  }

  function roundTo(n, d) {
    const p = Math.pow(10, d);
    const x = Math.abs(n) * p;
    const r = Math.round(Number(x.toPrecision(15)));
    return Math.sign(n) * r / p;
  }
  function stats(list) {
    const n = list.length;
    const mean = list.reduce((a, b) => a + b, 0) / n;
    const ss = list.reduce((a, b) => a + (b - mean) * (b - mean), 0);
    return { n, mean, ss };
  }
  function lookupMatch(target, list, mode) {
    // mode 0 exact (wildcards for text), 1 largest <= (sorted asc), -1 smallest >= (sorted desc)
    if (mode === 0) {
      const re = typeof target === 'string' && /[*?~]/.test(target) ? wildcardRegex(target) : null;
      for (let i = 0; i < list.length; i++) {
        const v = list[i];
        if (re ? (typeof v === 'string' && re.test(v)) : (v != null && compareValues(v, target) === 0 && typeRank(v) === typeRank(target))) return i;
      }
      return -1;
    }
    let best = -1;
    for (let i = 0; i < list.length; i++) {
      const v = list[i];
      if (v == null || typeRank(v) !== typeRank(target)) continue;
      const c = compareValues(v, target);
      if (mode === 1) { if (c <= 0) best = i; else break; }
      else { if (c >= 0) best = i; else break; }
    }
    return best;
  }
  function vectorOf(v, cx) {
    if (v instanceof Rng) {
      const out = [];
      if (v.c1 === v.c2) for (let r = v.r1; r <= v.r2; r++) out.push(cx.val(v.sheet, r, v.c1));
      else if (v.r1 === v.r2) for (let c = v.c1; c <= v.c2; c++) out.push(cx.val(v.sheet, v.r1, c));
      else return null;
      return out;
    }
    if (v instanceof Arr) {
      if (v.rows === 1) return v.m[0].slice();
      if (v.cols === 1) return v.m.map((r) => r[0]);
      return null;
    }
    return [v];
  }
  function dateParts(v, cx) {
    const n = N(v, cx);
    if (isErr(n)) return n;
    if (n < 0) return ERR.NUM;
    const d = serialDate(Math.floor(n));
    return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), wd: d.getUTCDay(), n };
  }
  function firstErr(...vals) { for (const v of vals) if (isErr(v)) return v; return null; }
  function intArg(v, cx, def) {
    if (isMissing(v)) return def;
    const n = N(v, cx);
    return isErr(n) ? n : Math.trunc(n);
  }

  /* Each entry: fn(args, cx). Entries in LAZY get unevaluated nodes and pull
     them through cx.ev, so the branch IF does not take is never computed. */
  const LAZY = new Set(['IF', 'IFS', 'IFERROR', 'IFNA', 'SWITCH', 'CHOOSE', 'AND', 'OR']);

  const FN = {
    /* ---- math ---- */
    SUM: (a, cx) => { const l = numbersOf(a, cx); return isErr(l) ? l : l.reduce((x, y) => x + y, 0); },
    PRODUCT: (a, cx) => { const l = numbersOf(a, cx); return isErr(l) ? l : (l.length ? l.reduce((x, y) => x * y, 1) : 0); },
    SUMSQ: (a, cx) => { const l = numbersOf(a, cx); return isErr(l) ? l : l.reduce((x, y) => x + y * y, 0); },
    AVERAGE: (a, cx) => { const l = numbersOf(a, cx); if (isErr(l)) return l; return l.length ? l.reduce((x, y) => x + y, 0) / l.length : ERR.DIV0; },
    AVERAGEA: (a, cx) => { const l = numbersOf(a, cx, { all: true }); if (isErr(l)) return l; return l.length ? l.reduce((x, y) => x + y, 0) / l.length : ERR.DIV0; },
    MIN: (a, cx) => { const l = numbersOf(a, cx); if (isErr(l)) return l; return l.length ? Math.min(...l) : 0; },
    MAX: (a, cx) => { const l = numbersOf(a, cx); if (isErr(l)) return l; return l.length ? Math.max(...l) : 0; },
    COUNT: (a, cx) => {
      let n = 0;
      for (const x of a) {
        if (isMissing(x)) continue;
        if (isMulti(x)) eachValue(x, cx, (v) => { if (typeof v === 'number') n++; });
        else if (!isErr(toNumber(x)) && x != null) n++;
      }
      return n;
    },
    COUNTA: (a, cx) => {
      let n = 0;
      for (const x of a) {
        if (isMissing(x)) continue;
        if (isMulti(x)) eachValue(x, cx, (v) => { if (v != null && v !== '') n++; });
        else n++;
      }
      return n;
    },
    COUNTBLANK: (a, cx) => {
      const rg = a[0];
      if (!(rg instanceof Rng)) return ERR.VALUE;
      let n = 0;
      for (let r = rg.r1; r <= rg.r2; r++) for (let c = rg.c1; c <= rg.c2; c++) { const v = cx.val(rg.sheet, r, c); if (v == null || v === '') n++; }
      return n;
    },
    COUNTIF: (a, cx) => { const h = criteriaMask([[clampToUsed(a[0], cx), a[1]]], cx); return isErr(h) ? h : h.length; },
    COUNTIFS: (a, cx) => {
      if (a.length < 2 || a.length % 2) return ERR.VALUE;
      const base = clampToUsed(a[0], cx);
      const pairs = [];
      for (let i = 0; i < a.length; i += 2) pairs.push([i ? sameShapeClamp(base, a[i]) : base, a[i + 1]]);
      const h = criteriaMask(pairs, cx);
      return isErr(h) ? h : h.length;
    },
    SUMIF: (a, cx) => {
      const rg = clampToUsed(a[0], cx);
      const h = criteriaMask([[rg, a[1]]], cx);
      if (isErr(h)) return h;
      const sumRg = isMissing(a[2]) ? rg : sameShapeClamp(rg, a[2]);
      let s = 0;
      for (const [i, j] of h) { const v = valueAt(sumRg, i, j, cx); if (isErr(v)) return v; if (typeof v === 'number') s += v; }
      return s;
    },
    SUMIFS: (a, cx) => ifsAggregate(a, cx, 'sum'),
    AVERAGEIF: (a, cx) => {
      const rg = clampToUsed(a[0], cx);
      const h = criteriaMask([[rg, a[1]]], cx);
      if (isErr(h)) return h;
      const avgRg = isMissing(a[2]) ? rg : sameShapeClamp(rg, a[2]);
      let s = 0, n = 0;
      for (const [i, j] of h) { const v = valueAt(avgRg, i, j, cx); if (isErr(v)) return v; if (typeof v === 'number') { s += v; n++; } }
      return n ? s / n : ERR.DIV0;
    },
    AVERAGEIFS: (a, cx) => ifsAggregate(a, cx, 'avg'),
    MAXIFS: (a, cx) => ifsAggregate(a, cx, 'max'),
    MINIFS: (a, cx) => ifsAggregate(a, cx, 'min'),
    SUMPRODUCT: (a, cx) => {
      if (!a.length) return ERR.VALUE;
      const mats = a.map((x) => matrixOf(x, cx));
      const rows = mats[0].length, cols = mats[0][0] ? mats[0][0].length : 0;
      if (mats.some((m) => m.length !== rows || (m[0] ? m[0].length : 0) !== cols)) return ERR.VALUE;
      let s = 0;
      for (let i = 0; i < rows; i++) {
        for (let j = 0; j < cols; j++) {
          let p = 1;
          for (const m of mats) {
            const v = m[i][j];
            if (isErr(v)) return v;
            p *= typeof v === 'number' ? v : (typeof v === 'boolean' ? (v ? 1 : 0) : 0);
          }
          s += p;
        }
      }
      return s;
    },
    ROUND: (a, cx) => { const n = N(a[0], cx), d = intArg(a[1], cx, 0); return firstErr(n, d) || roundTo(n, d); },
    ROUNDUP: (a, cx) => {
      const n = N(a[0], cx), d = intArg(a[1], cx, 0);
      const e = firstErr(n, d); if (e) return e;
      const p = Math.pow(10, d);
      return Math.sign(n) * Math.ceil(Number((Math.abs(n) * p).toPrecision(15))) / p;
    },
    ROUNDDOWN: (a, cx) => {
      const n = N(a[0], cx), d = intArg(a[1], cx, 0);
      const e = firstErr(n, d); if (e) return e;
      const p = Math.pow(10, d);
      return Math.sign(n) * Math.floor(Number((Math.abs(n) * p).toPrecision(15))) / p;
    },
    TRUNC: (a, cx) => FN.ROUNDDOWN([a[0], isMissing(a[1]) ? 0 : a[1]], cx),
    MROUND: (a, cx) => { const n = N(a[0], cx), m = N(a[1], cx); const e = firstErr(n, m); if (e) return e; if (m === 0) return 0; if (Math.sign(n) * Math.sign(m) < 0) return ERR.NUM; return roundTo(Math.round(n / m) * m, 12); },
    CEILING: (a, cx) => { const n = N(a[0], cx), m = isMissing(a[1]) ? 1 : N(a[1], cx); const e = firstErr(n, m); if (e) return e; if (m === 0) return 0; return roundTo(Math.ceil(n / m) * m, 12); },
    FLOOR: (a, cx) => { const n = N(a[0], cx), m = isMissing(a[1]) ? 1 : N(a[1], cx); const e = firstErr(n, m); if (e) return e; if (m === 0) return ERR.DIV0; return roundTo(Math.floor(n / m) * m, 12); },
    INT: (a, cx) => { const n = N(a[0], cx); return isErr(n) ? n : Math.floor(n); },
    ABS: (a, cx) => { const n = N(a[0], cx); return isErr(n) ? n : Math.abs(n); },
    SIGN: (a, cx) => { const n = N(a[0], cx); return isErr(n) ? n : Math.sign(n); },
    SQRT: (a, cx) => { const n = N(a[0], cx); if (isErr(n)) return n; return n < 0 ? ERR.NUM : Math.sqrt(n); },
    POWER: (a, cx) => { const x = N(a[0], cx), y = N(a[1], cx); const e = firstErr(x, y); if (e) return e; const r = Math.pow(x, y); return Number.isFinite(r) ? r : ERR.NUM; },
    EXP: (a, cx) => { const n = N(a[0], cx); return isErr(n) ? n : Math.exp(n); },
    LN: (a, cx) => { const n = N(a[0], cx); if (isErr(n)) return n; return n <= 0 ? ERR.NUM : Math.log(n); },
    LOG10: (a, cx) => { const n = N(a[0], cx); if (isErr(n)) return n; return n <= 0 ? ERR.NUM : Math.log10(n); },
    LOG: (a, cx) => { const n = N(a[0], cx), b = isMissing(a[1]) ? 10 : N(a[1], cx); const e = firstErr(n, b); if (e) return e; return n <= 0 || b <= 0 || b === 1 ? ERR.NUM : Math.log(n) / Math.log(b); },
    MOD: (a, cx) => { const n = N(a[0], cx), d = N(a[1], cx); const e = firstErr(n, d); if (e) return e; if (d === 0) return ERR.DIV0; return roundTo(n - d * Math.floor(n / d), 12); },
    QUOTIENT: (a, cx) => { const n = N(a[0], cx), d = N(a[1], cx); const e = firstErr(n, d); if (e) return e; if (d === 0) return ERR.DIV0; return Math.trunc(n / d); },
    PI: () => Math.PI,
    RAND: () => Math.random(),
    RANDBETWEEN: (a, cx) => { const lo = N(a[0], cx), hi = N(a[1], cx); const e = firstErr(lo, hi); if (e) return e; const l = Math.ceil(lo), h = Math.floor(hi); if (h < l) return ERR.NUM; return l + Math.floor(Math.random() * (h - l + 1)); },
    EVEN: (a, cx) => { const n = N(a[0], cx); if (isErr(n)) return n; const c = Math.ceil(Math.abs(n) / 2) * 2; return n < 0 ? -c : c; },
    ODD: (a, cx) => { const n = N(a[0], cx); if (isErr(n)) return n; let c = Math.ceil(Math.abs(n)); if (c % 2 === 0) c += 1; return n < 0 ? -c : c; },
    FACT: (a, cx) => { const n = N(a[0], cx); if (isErr(n)) return n; if (n < 0) return ERR.NUM; let f = 1; for (let i = 2; i <= Math.floor(n); i++) f *= i; return f; },
    GCD: (a, cx) => { const l = numbersOf(a, cx); if (isErr(l)) return l; const g = (x, y) => (y ? g(y, x % y) : x); return l.map((x) => Math.floor(Math.abs(x))).reduce(g, 0); },
    LCM: (a, cx) => { const l = numbersOf(a, cx); if (isErr(l)) return l; const g = (x, y) => (y ? g(y, x % y) : x); return l.map((x) => Math.floor(Math.abs(x))).reduce((x, y) => (x && y ? x * y / g(x, y) : 0), 1); },
    SIN: (a, cx) => { const n = N(a[0], cx); return isErr(n) ? n : Math.sin(n); },
    COS: (a, cx) => { const n = N(a[0], cx); return isErr(n) ? n : Math.cos(n); },
    TAN: (a, cx) => { const n = N(a[0], cx); return isErr(n) ? n : Math.tan(n); },
    ASIN: (a, cx) => { const n = N(a[0], cx); if (isErr(n)) return n; return Math.abs(n) > 1 ? ERR.NUM : Math.asin(n); },
    ACOS: (a, cx) => { const n = N(a[0], cx); if (isErr(n)) return n; return Math.abs(n) > 1 ? ERR.NUM : Math.acos(n); },
    ATAN: (a, cx) => { const n = N(a[0], cx); return isErr(n) ? n : Math.atan(n); },
    ATAN2: (a, cx) => { const x = N(a[0], cx), y = N(a[1], cx); const e = firstErr(x, y); if (e) return e; if (x === 0 && y === 0) return ERR.DIV0; return Math.atan2(y, x); },
    DEGREES: (a, cx) => { const n = N(a[0], cx); return isErr(n) ? n : n * 180 / Math.PI; },
    RADIANS: (a, cx) => { const n = N(a[0], cx); return isErr(n) ? n : n * Math.PI / 180; },

    /* ---- statistics ---- */
    MEDIAN: (a, cx) => {
      const l = numbersOf(a, cx); if (isErr(l)) return l;
      if (!l.length) return ERR.NUM;
      l.sort((x, y) => x - y);
      const m = Math.floor(l.length / 2);
      return l.length % 2 ? l[m] : (l[m - 1] + l[m]) / 2;
    },
    MODE: (a, cx) => {
      const l = numbersOf(a, cx); if (isErr(l)) return l;
      const counts = new Map(); let best = null, bestN = 1;
      for (const x of l) { const k = (counts.get(x) || 0) + 1; counts.set(x, k); if (k > bestN) { bestN = k; best = x; } }
      return best == null ? ERR.NA : best;
    },
    STDEV: (a, cx) => { const l = numbersOf(a, cx); if (isErr(l)) return l; if (l.length < 2) return ERR.DIV0; const s = stats(l); return Math.sqrt(s.ss / (s.n - 1)); },
    STDEVP: (a, cx) => { const l = numbersOf(a, cx); if (isErr(l)) return l; if (!l.length) return ERR.DIV0; const s = stats(l); return Math.sqrt(s.ss / s.n); },
    VAR: (a, cx) => { const l = numbersOf(a, cx); if (isErr(l)) return l; if (l.length < 2) return ERR.DIV0; const s = stats(l); return s.ss / (s.n - 1); },
    VARP: (a, cx) => { const l = numbersOf(a, cx); if (isErr(l)) return l; if (!l.length) return ERR.DIV0; const s = stats(l); return s.ss / s.n; },
    LARGE: (a, cx) => { const l = numbersOf([a[0]], cx); if (isErr(l)) return l; const k = intArg(a[1], cx, 1); if (isErr(k)) return k; l.sort((x, y) => y - x); return k >= 1 && k <= l.length ? l[k - 1] : ERR.NUM; },
    SMALL: (a, cx) => { const l = numbersOf([a[0]], cx); if (isErr(l)) return l; const k = intArg(a[1], cx, 1); if (isErr(k)) return k; l.sort((x, y) => x - y); return k >= 1 && k <= l.length ? l[k - 1] : ERR.NUM; },
    RANK: (a, cx) => {
      const n = N(a[0], cx); if (isErr(n)) return n;
      const l = numbersOf([a[1]], cx); if (isErr(l)) return l;
      const asc = !isMissing(a[2]) && N(a[2], cx) !== 0;
      if (!l.includes(n)) return ERR.NA;
      return 1 + l.filter((x) => (asc ? x < n : x > n)).length;
    },
    PERCENTILE: (a, cx) => {
      const l = numbersOf([a[0]], cx); if (isErr(l)) return l;
      const k = N(a[1], cx); if (isErr(k)) return k;
      if (!l.length || k < 0 || k > 1) return ERR.NUM;
      l.sort((x, y) => x - y);
      const pos = (l.length - 1) * k, lo = Math.floor(pos);
      return lo + 1 < l.length ? l[lo] + (pos - lo) * (l[lo + 1] - l[lo]) : l[lo];
    },
    QUARTILE: (a, cx) => { const q = intArg(a[1], cx, 1); if (isErr(q)) return q; if (q < 0 || q > 4) return ERR.NUM; return FN.PERCENTILE([a[0], q / 4], cx); },
    CORREL: (a, cx) => {
      const x = flatValues(a[0], cx), y = flatValues(a[1], cx);
      if (x.length !== y.length) return ERR.NA;
      const px = [], py = [];
      x.forEach((v, i) => { if (typeof v === 'number' && typeof y[i] === 'number') { px.push(v); py.push(y[i]); } });
      if (px.length < 2) return ERR.DIV0;
      const mx = stats(px).mean, my = stats(py).mean;
      let sxy = 0, sxx = 0, syy = 0;
      px.forEach((v, i) => { sxy += (v - mx) * (py[i] - my); sxx += (v - mx) ** 2; syy += (py[i] - my) ** 2; });
      return sxx && syy ? sxy / Math.sqrt(sxx * syy) : ERR.DIV0;
    },
    SUBTOTAL: (a, cx) => {
      const k = intArg(a[0], cx, 9); if (isErr(k)) return k;
      const map = { 1: 'AVERAGE', 2: 'COUNT', 3: 'COUNTA', 4: 'MAX', 5: 'MIN', 6: 'PRODUCT', 7: 'STDEV', 8: 'STDEVP', 9: 'SUM', 10: 'VAR', 11: 'VARP' };
      const name = map[k % 100];
      return name ? FN[name](a.slice(1), cx) : ERR.VALUE;
    },

    /* ---- logic ---- */
    IF: (a, cx) => {
      const t = B(cx.ev(a[0]), cx);
      if (isErr(t)) return t;
      if (t) return isMissing(a[1]) ? 0 : cx.ev(a[1]);
      return a.length < 3 ? false : (isMissing(a[2]) ? 0 : cx.ev(a[2]));
    },
    IFS: (a, cx) => {
      for (let i = 0; i + 1 < a.length; i += 2) {
        const t = B(cx.ev(a[i]), cx);
        if (isErr(t)) return t;
        if (t) return cx.ev(a[i + 1]);
      }
      return ERR.NA;
    },
    IFERROR: (a, cx) => { const v = scalar(cx.ev(a[0]), cx); return isErr(v) ? cx.ev(a[1]) : v; },
    IFNA: (a, cx) => { const v = scalar(cx.ev(a[0]), cx); return v === ERR.NA ? cx.ev(a[1]) : v; },
    AND: (a, cx) => {
      let seen = false;
      for (const node of a) {
        const v = cx.ev(node);
        let res = true;
        if (isMulti(v)) eachValue(v, cx, (x) => { if (isErr(x)) { res = x; return false; } if (typeof x === 'number' || typeof x === 'boolean') { seen = true; if (!toBool(x)) { res = false; return false; } } return undefined; });
        else { const b = toBool(v); if (isErr(b)) return b; seen = true; res = b; }
        if (res !== true) return res;
      }
      return seen ? true : ERR.VALUE;
    },
    OR: (a, cx) => {
      let seen = false;
      for (const node of a) {
        const v = cx.ev(node);
        let res = false;
        if (isMulti(v)) eachValue(v, cx, (x) => { if (isErr(x)) { res = x; return false; } if (typeof x === 'number' || typeof x === 'boolean') { seen = true; if (toBool(x)) { res = true; return false; } } return undefined; });
        else { const b = toBool(v); if (isErr(b)) return b; seen = true; res = b; }
        if (res !== false) return res;
      }
      return seen ? false : ERR.VALUE;
    },
    NOT: (a, cx) => { const b = B(a[0], cx); return isErr(b) ? b : !b; },
    XOR: (a, cx) => {
      let n = 0;
      for (const x of a) {
        if (isMulti(x)) eachValue(x, cx, (v) => { if (typeof v === 'number' || typeof v === 'boolean') n += toBool(v) ? 1 : 0; });
        else { const b = toBool(x); if (isErr(b)) return b; n += b ? 1 : 0; }
      }
      return n % 2 === 1;
    },
    TRUE: () => true,
    FALSE: () => false,
    SWITCH: (a, cx) => {
      const v = scalar(cx.ev(a[0]), cx);
      if (isErr(v)) return v;
      let i = 1;
      for (; i + 1 < a.length; i += 2) {
        const w = scalar(cx.ev(a[i]), cx);
        if (compareValues(v, w) === 0 && typeRank(v) === typeRank(w)) return cx.ev(a[i + 1]);
      }
      return i < a.length ? cx.ev(a[i]) : ERR.NA;
    },
    CHOOSE: (a, cx) => {
      const k = N(cx.ev(a[0]), cx);
      if (isErr(k)) return k;
      const i = Math.trunc(k);
      return i >= 1 && i < a.length ? cx.ev(a[i]) : ERR.VALUE;
    },

    /* ---- information ---- */
    ISBLANK: (a, cx) => scalar(a[0], cx) == null,
    ISNUMBER: (a, cx) => typeof scalar(a[0], cx) === 'number',
    ISTEXT: (a, cx) => typeof scalar(a[0], cx) === 'string',
    ISNONTEXT: (a, cx) => typeof scalar(a[0], cx) !== 'string',
    ISLOGICAL: (a, cx) => typeof scalar(a[0], cx) === 'boolean',
    ISERROR: (a, cx) => isErr(scalar(a[0], cx)),
    ISERR: (a, cx) => { const v = scalar(a[0], cx); return isErr(v) && v !== ERR.NA; },
    ISNA: (a, cx) => scalar(a[0], cx) === ERR.NA,
    ISEVEN: (a, cx) => { const n = N(a[0], cx); return isErr(n) ? n : Math.trunc(n) % 2 === 0; },
    ISODD: (a, cx) => { const n = N(a[0], cx); return isErr(n) ? n : Math.abs(Math.trunc(n)) % 2 === 1; },
    NA: () => ERR.NA,
    N: (a, cx) => { const v = scalar(a[0], cx); return typeof v === 'number' ? v : typeof v === 'boolean' ? (v ? 1 : 0) : isErr(v) ? v : 0; },
    T: (a, cx) => { const v = scalar(a[0], cx); return typeof v === 'string' ? v : isErr(v) ? v : ''; },
    ROW: (a, cx) => (isMissing(a[0]) ? cx.r + 1 : (a[0] instanceof Rng ? a[0].r1 + 1 : ERR.VALUE)),
    COLUMN: (a, cx) => (isMissing(a[0]) ? cx.c + 1 : (a[0] instanceof Rng ? a[0].c1 + 1 : ERR.VALUE)),
    ROWS: (a) => (isMulti(a[0]) ? a[0].rows : 1),
    COLUMNS: (a) => (isMulti(a[0]) ? a[0].cols : 1),

    /* ---- lookup ---- */
    VLOOKUP: (a, cx) => tableLookup(a, cx, true),
    HLOOKUP: (a, cx) => tableLookup(a, cx, false),
    XLOOKUP: (a, cx) => {
      const target = scalar(a[0], cx);
      if (isErr(target)) return target;
      const look = vectorOf(a[1], cx);
      if (!look) return ERR.VALUE;
      const matchMode = intArg(a[4], cx, 0), searchMode = intArg(a[5], cx, 1);
      if (isErr(matchMode) || isErr(searchMode)) return ERR.VALUE;
      let idx = -1;
      const order = look.map((_, i) => i);
      if (searchMode === -1 || searchMode === -2) order.reverse();
      const re = matchMode === 2 && typeof target === 'string' ? wildcardRegex(target) : null;
      let bestDiff = null;
      for (const i of order) {
        const v = look[i];
        if (v == null) continue;
        if (re) { if (typeof v === 'string' && re.test(v)) { idx = i; break; } continue; }
        if (typeRank(v) === typeRank(target) && compareValues(v, target) === 0) { idx = i; break; }
        if ((matchMode === -1 || matchMode === 1) && typeRank(v) === typeRank(target)) {
          const cmp = compareValues(v, target);
          if ((matchMode === -1 && cmp < 0) || (matchMode === 1 && cmp > 0)) {
            if (bestDiff == null || compareValues(v, look[bestDiff]) * matchMode < 0) bestDiff = i;
          }
        }
      }
      if (idx < 0 && bestDiff != null) idx = bestDiff;
      if (idx < 0) return isMissing(a[3]) ? ERR.NA : a[3];
      const ret = a[2];
      if (ret instanceof Rng) {
        const vertical = a[1] instanceof Rng ? a[1].c1 === a[1].c2 : true;
        if (vertical) {
          if (ret.c1 === ret.c2) return cx.val(ret.sheet, ret.r1 + idx, ret.c1);
          return new Rng(ret.sheet, ret.r1 + idx, ret.c1, ret.r1 + idx, ret.c2);
        }
        if (ret.r1 === ret.r2) return cx.val(ret.sheet, ret.r1, ret.c1 + idx);
        return new Rng(ret.sheet, ret.r1, ret.c1 + idx, ret.r2, ret.c1 + idx);
      }
      const rv = vectorOf(ret, cx);
      return rv && idx < rv.length ? rv[idx] : ERR.VALUE;
    },
    INDEX: (a, cx) => {
      const src = a[0];
      let r = intArg(a[1], cx, 0), c = intArg(a[2], cx, 0);
      const e = firstErr(r, c); if (e) return e;
      if (src instanceof Rng) {
        if (src.rows === 1 && isMissing(a[2])) { c = r; r = 1; }
        if (r < 0 || c < 0 || r > src.rows || c > src.cols) return ERR.REF;
        if (r === 0 && c === 0) return src;
        if (r === 0) return new Rng(src.sheet, src.r1, src.c1 + c - 1, src.r2, src.c1 + c - 1);
        if (c === 0) { if (src.cols === 1) return cx.val(src.sheet, src.r1 + r - 1, src.c1); return new Rng(src.sheet, src.r1 + r - 1, src.c1, src.r1 + r - 1, src.c2); }
        return cx.val(src.sheet, src.r1 + r - 1, src.c1 + c - 1);
      }
      const m = matrixOf(src, cx);
      if (m.length === 1 && isMissing(a[2])) { c = r; r = 1; }
      if (!r) r = 1; if (!c) c = 1;
      return m[r - 1] && m[r - 1][c - 1] !== undefined ? m[r - 1][c - 1] : ERR.REF;
    },
    MATCH: (a, cx) => {
      const target = scalar(a[0], cx);
      if (isErr(target)) return target;
      const list = vectorOf(a[1], cx);
      if (!list) return ERR.NA;
      const mode = intArg(a[2], cx, 1);
      if (isErr(mode)) return mode;
      const i = lookupMatch(target, list, mode > 0 ? 1 : mode < 0 ? -1 : 0);
      return i < 0 ? ERR.NA : i + 1;
    },
    LOOKUP: (a, cx) => {
      const target = scalar(a[0], cx);
      const look = vectorOf(a[1], cx);
      if (!look) return ERR.NA;
      const i = lookupMatch(target, look, 1);
      if (i < 0) return ERR.NA;
      const res = isMissing(a[2]) ? look : vectorOf(a[2], cx);
      return res && res[i] !== undefined ? res[i] : ERR.NA;
    },

    /* ---- text ---- */
    CONCAT: (a, cx) => {
      let s = '';
      for (const x of a) {
        if (isMulti(x)) { let err = null; eachValue(x, cx, (v) => { if (isErr(v)) { err = v; return false; } s += toText(v); return undefined; }); if (err) return err; }
        else { const t = toText(x); if (isErr(t)) return t; s += t; }
      }
      return s;
    },
    CONCATENATE: (a, cx) => { let s = ''; for (const x of a) { const t = S(x, cx); if (isErr(t)) return t; s += t; } return s; },
    TEXTJOIN: (a, cx) => {
      const d = S(a[0], cx); if (isErr(d)) return d;
      const skip = B(a[1], cx); if (isErr(skip)) return skip;
      const parts = [];
      for (const x of a.slice(2)) {
        if (isMissing(x)) continue;
        let err = null;
        eachValue(x, cx, (v) => { if (isErr(v)) { err = v; return false; } const t = toText(v); if (!(skip && t === '')) parts.push(t); return undefined; });
        if (err) return err;
      }
      return parts.join(d);
    },
    LEFT: (a, cx) => { const s = S(a[0], cx), n = intArg(a[1], cx, 1); const e = firstErr(s, n); if (e) return e; return n < 0 ? ERR.VALUE : s.slice(0, n); },
    RIGHT: (a, cx) => { const s = S(a[0], cx), n = intArg(a[1], cx, 1); const e = firstErr(s, n); if (e) return e; return n < 0 ? ERR.VALUE : (n ? s.slice(-n) : ''); },
    MID: (a, cx) => { const s = S(a[0], cx), st = intArg(a[1], cx, 1), n = intArg(a[2], cx, 0); const e = firstErr(s, st, n); if (e) return e; if (st < 1 || n < 0) return ERR.VALUE; return s.substr(st - 1, n); },
    LEN: (a, cx) => { const s = S(a[0], cx); return isErr(s) ? s : s.length; },
    UPPER: (a, cx) => { const s = S(a[0], cx); return isErr(s) ? s : s.toUpperCase(); },
    LOWER: (a, cx) => { const s = S(a[0], cx); return isErr(s) ? s : s.toLowerCase(); },
    PROPER: (a, cx) => { const s = S(a[0], cx); return isErr(s) ? s : s.toLowerCase().replace(/(^|[^A-Za-zÀ-￿'])([A-Za-zÀ-￿])/g, (m, p, ch) => p + ch.toUpperCase()); },
    TRIM: (a, cx) => { const s = S(a[0], cx); return isErr(s) ? s : s.trim().replace(/ {2,}/g, ' '); },
    CLEAN: (a, cx) => { const s = S(a[0], cx); return isErr(s) ? s : s.replace(/[\x00-\x1f]/g, ''); },
    SUBSTITUTE: (a, cx) => {
      const s = S(a[0], cx), from = S(a[1], cx), to = S(a[2], cx);
      const e = firstErr(s, from, to); if (e) return e;
      if (!from) return s;
      if (isMissing(a[3])) return s.split(from).join(to);
      const k = intArg(a[3], cx, 1); if (isErr(k)) return k;
      let idx = -1;
      for (let i = 0; i < k; i++) { idx = s.indexOf(from, idx + 1); if (idx < 0) return s; }
      return s.slice(0, idx) + to + s.slice(idx + from.length);
    },
    REPLACE: (a, cx) => {
      const s = S(a[0], cx), st = intArg(a[1], cx, 1), n = intArg(a[2], cx, 0), t = S(a[3], cx);
      const e = firstErr(s, st, n, t); if (e) return e;
      if (st < 1 || n < 0) return ERR.VALUE;
      return s.slice(0, st - 1) + t + s.slice(st - 1 + n);
    },
    FIND: (a, cx) => {
      const f = S(a[0], cx), s = S(a[1], cx), st = intArg(a[2], cx, 1);
      const e = firstErr(f, s, st); if (e) return e;
      if (st < 1 || st > s.length + 1) return ERR.VALUE;
      const i = s.indexOf(f, st - 1);
      return i < 0 ? ERR.VALUE : i + 1;
    },
    SEARCH: (a, cx) => {
      const f = S(a[0], cx), s = S(a[1], cx), st = intArg(a[2], cx, 1);
      const e = firstErr(f, s, st); if (e) return e;
      if (st < 1 || st > s.length + 1) return ERR.VALUE;
      const re = wildcardRegex(f);
      for (let i = st - 1; i <= s.length; i++) {
        for (let j = i; j <= s.length; j++) if (re.test(s.slice(i, j))) return i + 1;
      }
      return ERR.VALUE;
    },
    REPT: (a, cx) => { const s = S(a[0], cx), n = intArg(a[1], cx, 0); const e = firstErr(s, n); if (e) return e; return n < 0 ? ERR.VALUE : s.repeat(Math.min(n, 32767)); },
    EXACT: (a, cx) => { const x = S(a[0], cx), y = S(a[1], cx); return firstErr(x, y) || x === y; },
    CHAR: (a, cx) => { const n = intArg(a[0], cx, 0); if (isErr(n)) return n; return n < 1 || n > 65535 ? ERR.VALUE : String.fromCharCode(n); },
    CODE: (a, cx) => { const s = S(a[0], cx); if (isErr(s)) return s; return s ? s.charCodeAt(0) : ERR.VALUE; },
    UNICHAR: (a, cx) => { const n = intArg(a[0], cx, 0); if (isErr(n)) return n; try { return String.fromCodePoint(n); } catch { return ERR.VALUE; } },
    TEXT: (a, cx) => {
      const v = scalar(a[0], cx), f = S(a[1], cx);
      const e = firstErr(v, f); if (e) return e;
      const n = typeof v === 'string' ? parseNumberText(v) : (typeof v === 'boolean' ? null : toNumber(v));
      if (n == null || isErr(n)) return toText(v);
      return formatValue(n, f).text;
    },
    VALUE: (a, cx) => {
      const v = scalar(a[0], cx);
      if (isErr(v) || typeof v === 'number') return v;
      if (v == null) return 0;
      const n = parseNumberText(String(v));
      return n == null ? ERR.VALUE : n;
    },
    NUMBERVALUE: (a, cx) => FN.VALUE(a, cx),
    FIXED: (a, cx) => {
      const n = N(a[0], cx), d = intArg(a[1], cx, 2);
      const e = firstErr(n, d); if (e) return e;
      const noCommas = !isMissing(a[2]) && B(a[2], cx) === true;
      const r = roundTo(n, d);
      const s = Math.abs(r).toFixed(Math.max(0, d));
      const [ip, fp] = s.split('.');
      return (r < 0 ? '-' : '') + (noCommas ? ip : groupThousands(ip)) + (fp ? '.' + fp : '');
    },
    DOLLAR: (a, cx) => {
      const n = N(a[0], cx), d = intArg(a[1], cx, 2);
      const e = firstErr(n, d); if (e) return e;
      return formatValue(n, `"$"#,##0${d > 0 ? '.' + '0'.repeat(d) : ''}`).text;
    },

    /* ---- dates ---- */
    TODAY: () => todaySerial(),
    NOW: () => nowSerial(),
    DATE: (a, cx) => {
      let y = intArg(a[0], cx, 1900); const m = intArg(a[1], cx, 1), d = intArg(a[2], cx, 1);
      const e = firstErr(y, m, d); if (e) return e;
      if (y < 1900) y += 1900;
      const s = dateSerial(y, m, d);
      return s < 0 ? ERR.NUM : s;
    },
    TIME: (a, cx) => {
      const h = intArg(a[0], cx, 0), m = intArg(a[1], cx, 0), s = intArg(a[2], cx, 0);
      const e = firstErr(h, m, s); if (e) return e;
      const t = (h * 3600 + m * 60 + s) / 86400;
      return t < 0 ? ERR.NUM : t - Math.floor(t);
    },
    DATEVALUE: (a, cx) => {
      const v = scalar(a[0], cx);
      if (typeof v === 'number') return Math.floor(v);
      const n = parseNumberText(String(v == null ? '' : v));
      return n == null ? ERR.VALUE : Math.floor(n);
    },
    YEAR: (a, cx) => { const p = dateParts(a[0], cx); return isErr(p) ? p : p.y; },
    MONTH: (a, cx) => { const p = dateParts(a[0], cx); return isErr(p) ? p : p.m; },
    DAY: (a, cx) => { const p = dateParts(a[0], cx); return isErr(p) ? p : p.d; },
    HOUR: (a, cx) => { const n = N(a[0], cx); return isErr(n) ? n : Math.floor(Math.round((n - Math.floor(n)) * 86400) / 3600) % 24; },
    MINUTE: (a, cx) => { const n = N(a[0], cx); return isErr(n) ? n : Math.floor(Math.round((n - Math.floor(n)) * 86400) / 60) % 60; },
    SECOND: (a, cx) => { const n = N(a[0], cx); return isErr(n) ? n : Math.round((n - Math.floor(n)) * 86400) % 60; },
    WEEKDAY: (a, cx) => {
      const p = dateParts(a[0], cx); if (isErr(p)) return p;
      const t = intArg(a[1], cx, 1); if (isErr(t)) return t;
      if (t === 1 || t === 17) return p.wd + 1;
      if (t === 2 || t === 11) return p.wd === 0 ? 7 : p.wd;
      if (t === 3) return p.wd === 0 ? 6 : p.wd - 1;
      if (t >= 12 && t <= 16) return ((p.wd - (t - 10) + 7) % 7) + 1;
      return ERR.NUM;
    },
    WEEKNUM: (a, cx) => {
      const p = dateParts(a[0], cx); if (isErr(p)) return p;
      const t = intArg(a[1], cx, 1); if (isErr(t)) return t;
      const start = dateSerial(p.y, 1, 1);
      const startWd = serialDate(start).getUTCDay();
      const offset = t === 2 || t === 11 ? (startWd + 6) % 7 : startWd;
      return Math.floor((Math.floor(p.n) - start + offset) / 7) + 1;
    },
    EDATE: (a, cx) => {
      const p = dateParts(a[0], cx); if (isErr(p)) return p;
      const k = intArg(a[1], cx, 0); if (isErr(k)) return k;
      const last = new Date(Date.UTC(p.y, p.m - 1 + k + 1, 0)).getUTCDate();
      return dateSerial(p.y, p.m + k, Math.min(p.d, last));
    },
    EOMONTH: (a, cx) => {
      const p = dateParts(a[0], cx); if (isErr(p)) return p;
      const k = intArg(a[1], cx, 0); if (isErr(k)) return k;
      return dateSerial(p.y, p.m + k + 1, 0);
    },
    DAYS: (a, cx) => { const x = N(a[0], cx), y = N(a[1], cx); return firstErr(x, y) || Math.floor(x) - Math.floor(y); },
    DATEDIF: (a, cx) => {
      const s = dateParts(a[0], cx), e = dateParts(a[1], cx);
      const er = firstErr(s, e); if (er) return er;
      const unit = String(S(a[2], cx)).toUpperCase();
      if (e.n < s.n) return ERR.NUM;
      let months = (e.y - s.y) * 12 + (e.m - s.m);
      if (e.d < s.d) months--;
      if (unit === 'D') return Math.floor(e.n) - Math.floor(s.n);
      if (unit === 'M') return months;
      if (unit === 'Y') return Math.floor(months / 12);
      if (unit === 'YM') return months % 12;
      if (unit === 'MD') { let d = e.d - s.d; if (d < 0) d += new Date(Date.UTC(e.y, e.m - 1, 0)).getUTCDate(); return d; }
      if (unit === 'YD') { const anniv = dateSerial(e.y, s.m, s.d); const n = Math.floor(e.n) - anniv; return n >= 0 ? n : Math.floor(e.n) - dateSerial(e.y - 1, s.m, s.d); }
      return ERR.NUM;
    },
    NETWORKDAYS: (a, cx) => {
      const s = N(a[0], cx), e = N(a[1], cx); const er = firstErr(s, e); if (er) return er;
      const hol = new Set(isMissing(a[2]) ? [] : flatValues(a[2], cx).filter((x) => typeof x === 'number').map(Math.floor));
      const lo = Math.floor(Math.min(s, e)), hi = Math.floor(Math.max(s, e));
      let n = 0;
      for (let d = lo; d <= hi; d++) { const wd = serialDate(d).getUTCDay(); if (wd !== 0 && wd !== 6 && !hol.has(d)) n++; }
      return s <= e ? n : -n;
    },
    WORKDAY: (a, cx) => {
      const s = N(a[0], cx), k = intArg(a[1], cx, 0); const er = firstErr(s, k); if (er) return er;
      const hol = new Set(isMissing(a[2]) ? [] : flatValues(a[2], cx).filter((x) => typeof x === 'number').map(Math.floor));
      let d = Math.floor(s), left = Math.abs(k); const step = k < 0 ? -1 : 1;
      while (left > 0) { d += step; const wd = serialDate(d).getUTCDay(); if (wd !== 0 && wd !== 6 && !hol.has(d)) left--; }
      return d;
    },

    /* ---- finance ---- */
    PMT: (a, cx) => {
      const rate = N(a[0], cx), nper = N(a[1], cx), pv = N(a[2], cx);
      const fv = isMissing(a[3]) ? 0 : N(a[3], cx), type = isMissing(a[4]) ? 0 : N(a[4], cx);
      const e = firstErr(rate, nper, pv, fv, type); if (e) return e;
      if (nper === 0) return ERR.NUM;
      if (rate === 0) return -(pv + fv) / nper;
      const f = Math.pow(1 + rate, nper);
      return -(rate * (pv * f + fv)) / ((1 + rate * (type ? 1 : 0)) * (f - 1));
    },
    FV: (a, cx) => {
      const rate = N(a[0], cx), nper = N(a[1], cx), pmt = N(a[2], cx);
      const pv = isMissing(a[3]) ? 0 : N(a[3], cx), type = isMissing(a[4]) ? 0 : N(a[4], cx);
      const e = firstErr(rate, nper, pmt, pv, type); if (e) return e;
      if (rate === 0) return -(pv + pmt * nper);
      const f = Math.pow(1 + rate, nper);
      return -(pv * f + pmt * (1 + rate * (type ? 1 : 0)) * (f - 1) / rate);
    },
    PV: (a, cx) => {
      const rate = N(a[0], cx), nper = N(a[1], cx), pmt = N(a[2], cx);
      const fv = isMissing(a[3]) ? 0 : N(a[3], cx), type = isMissing(a[4]) ? 0 : N(a[4], cx);
      const e = firstErr(rate, nper, pmt, fv, type); if (e) return e;
      if (rate === 0) return -(fv + pmt * nper);
      const f = Math.pow(1 + rate, nper);
      return -(fv + pmt * (1 + rate * (type ? 1 : 0)) * (f - 1) / rate) / f;
    },
    NPER: (a, cx) => {
      const rate = N(a[0], cx), pmt = N(a[1], cx), pv = N(a[2], cx);
      const fv = isMissing(a[3]) ? 0 : N(a[3], cx), type = isMissing(a[4]) ? 0 : N(a[4], cx);
      const e = firstErr(rate, pmt, pv, fv, type); if (e) return e;
      if (rate === 0) return pmt === 0 ? ERR.NUM : -(pv + fv) / pmt;
      const k = pmt * (1 + rate * (type ? 1 : 0)) / rate;
      const x = (k - fv) / (k + pv);
      return x <= 0 ? ERR.NUM : Math.log(x) / Math.log(1 + rate);
    },
    NPV: (a, cx) => {
      const rate = N(a[0], cx); if (isErr(rate)) return rate;
      const l = numbersOf(a.slice(1), cx); if (isErr(l)) return l;
      return l.reduce((s, v, i) => s + v / Math.pow(1 + rate, i + 1), 0);
    }
  };
  FN['STDEV.S'] = FN.STDEV;
  FN['STDEV.P'] = FN.STDEVP;
  FN['VAR.S'] = FN.VAR;
  FN['VAR.P'] = FN.VARP;
  FN['RANK.EQ'] = FN.RANK;
  FN['MODE.SNGL'] = FN.MODE;
  FN['PERCENTILE.INC'] = FN.PERCENTILE;
  FN['QUARTILE.INC'] = FN.QUARTILE;
  FN['CEILING.MATH'] = FN.CEILING;
  FN['FLOOR.MATH'] = FN.FLOOR;

  function ifsAggregate(a, cx, how) {
    const target = clampToUsed(a[0], cx);
    if (a.length < 3 || (a.length - 1) % 2) return ERR.VALUE;
    const pairs = [];
    for (let i = 1; i < a.length; i += 2) pairs.push([sameShapeClamp(target, a[i]), a[i + 1]]);
    const h = criteriaMask(pairs, cx);
    if (isErr(h)) return h;
    const vals = [];
    for (const [i, j] of h) { const v = valueAt(target, i, j, cx); if (isErr(v)) return v; if (typeof v === 'number') vals.push(v); }
    if (how === 'sum') return vals.reduce((x, y) => x + y, 0);
    if (how === 'avg') return vals.length ? vals.reduce((x, y) => x + y, 0) / vals.length : ERR.DIV0;
    if (how === 'max') return vals.length ? Math.max(...vals) : 0;
    return vals.length ? Math.min(...vals) : 0;
  }

  function tableLookup(a, cx, vertical) {
    const target = scalar(a[0], cx);
    if (isErr(target)) return target;
    const table = a[1];
    const k = intArg(a[2], cx, 1);
    if (isErr(k)) return k;
    const approx = isMissing(a[3]) ? true : B(a[3], cx);
    if (isErr(approx)) return approx;
    if (!isMulti(table)) return ERR.NA;
    const t = table instanceof Rng ? clampToUsed(table, cx) : table;
    const span = vertical ? table.cols : table.rows;
    if (k < 1) return ERR.VALUE;
    if (k > span) return ERR.REF;
    const n = vertical ? t.rows : t.cols;
    const keys = [];
    for (let i = 0; i < n; i++) keys.push(vertical ? valueAt(t, i, 0, cx) : valueAt(t, 0, i, cx));
    const i = lookupMatch(target, keys, approx ? 1 : 0);
    if (i < 0) return ERR.NA;
    return vertical ? valueAt(table, i, k - 1, cx) : valueAt(table, k - 1, i, cx);
  }

  /* ======================================================================
     5. Calculation engine
     ====================================================================== */

  /* host.sheets() -> the live sheet list ({name, rows}). Values are cached
     until invalidate(); every edit invalidates, so the cache never holds a
     stale result and needs no dependency graph. */
  function createEngine(host) {
    let cache = new Map();
    const inProgress = new Set();
    const astCache = new Map();
    const usedCache = new Map();

    function invalidate() { cache = new Map(); usedCache.clear(); }

    function sheetIndex(name, own) {
      if (name == null) return own;
      const low = String(name).toLowerCase();
      return host.sheets().findIndex((s) => String(s.name).toLowerCase() === low);
    }
    function rawAt(s, r, c) {
      const sh = host.sheets()[s];
      const row = sh && sh.rows[r];
      const v = row ? row[c] : undefined;
      return v == null ? '' : v;
    }
    function usedBounds(s) {
      let u = usedCache.get(s);
      if (u) return u;
      const sh = host.sheets()[s];
      let r = -1, c = -1;
      if (sh) {
        sh.rows.forEach((row, i) => {
          if (!row) return;
          for (let j = row.length - 1; j >= 0; j--) {
            if (row[j] !== '' && row[j] != null) { if (i > r) r = i; if (j > c) c = j; break; }
          }
        });
      }
      u = { r, c };
      usedCache.set(s, u);
      return u;
    }
    function astOf(src) {
      let a = astCache.get(src);
      if (a === undefined) {
        try { a = parse(src.slice(1)); } catch { a = null; }
        if (astCache.size > 20000) astCache.clear();
        astCache.set(src, a);
      }
      return a;
    }

    function val(s, r, c) {
      if (r < 0 || c < 0) return ERR.REF;
      const raw = rawAt(s, r, c);
      if (raw === '') return null;
      if (raw[0] !== '=' || raw.length === 1) return parseLiteral(raw);
      const key = s + ':' + r + ':' + c;
      if (cache.has(key)) return cache.get(key);
      if (inProgress.has(key)) return ERR.CIRC;
      inProgress.add(key);
      let v;
      try {
        v = evaluateText(raw, s, r, c);
      } catch (err) {
        inProgress.delete(key);
        if (err instanceof RangeError && inProgress.size === 0) {
          // A dependency chain deeper than the stack: warm the sheet top
          // down so each link is already cached, then try once more.
          warm(s, r);
          return val(s, r, c);
        }
        throw err;
      }
      inProgress.delete(key);
      cache.set(key, v);
      return v;
    }
    function warm(s, uptoR) {
      const sh = host.sheets()[s];
      for (let r = 0; r < Math.min(uptoR, sh.rows.length); r++) {
        const row = sh.rows[r];
        if (!row) continue;
        for (let c = 0; c < row.length; c++) {
          if (typeof row[c] === 'string' && row[c][0] === '=') {
            try { val(s, r, c); } catch { /* keep going */ }
          }
        }
      }
    }

    function evaluateText(raw, s, r, c) {
      const ast = astOf(raw);
      if (!ast) return ERR.ERROR;
      const cx = makeCx(s, r, c);
      let v = cx.ev(ast);
      v = scalar(v, cx);
      if (typeof v === 'number' && !Number.isFinite(v)) return ERR.NUM;
      if (v == null) return 0;
      if (v && v.missing) return 0;
      return v;
    }

    function makeCx(sheet, r, c) {
      const cx = {
        sheet, r, c, val, usedBounds,
        ev: (node) => evalNode(node, cx)
      };
      return cx;
    }

    function lift(a, b, fn, cx) {
      // elementwise over ranges/arrays; scalars broadcast
      const ma = isMulti(a) ? matrixOf(a, cx) : null;
      const mb = isMulti(b) ? matrixOf(b, cx) : null;
      if (!ma && !mb) return fn(a, b);
      const rows = Math.max(ma ? ma.length : 1, mb ? mb.length : 1);
      const cols = Math.max(ma ? ma[0].length : 1, mb ? mb[0].length : 1);
      const pick = (m, v, i, j) => {
        if (!m) return v;
        const rr = m.length === 1 ? 0 : i, cc = m[0].length === 1 ? 0 : j;
        return m[rr] && m[rr][cc] !== undefined ? m[rr][cc] : ERR.NA;
      };
      const out = [];
      for (let i = 0; i < rows; i++) {
        const row = [];
        for (let j = 0; j < cols; j++) row.push(fn(pick(ma, a, i, j), pick(mb, b, i, j)));
        out.push(row);
      }
      return new Arr(out);
    }

    function arith(op, x, y) {
      if (isErr(x)) return x;
      if (isErr(y)) return y;
      if (op === '&') {
        const a = toText(x), b = toText(y);
        return isErr(a) ? a : isErr(b) ? b : a + b;
      }
      if (op === '=' || op === '<>' || op === '<' || op === '>' || op === '<=' || op === '>=') {
        const cmp = compareValues(x, y);
        switch (op) {
          case '=': return cmp === 0;
          case '<>': return cmp !== 0;
          case '<': return cmp < 0;
          case '>': return cmp > 0;
          case '<=': return cmp <= 0;
          default: return cmp >= 0;
        }
      }
      const a = toNumber(x), b = toNumber(y);
      if (isErr(a)) return a;
      if (isErr(b)) return b;
      switch (op) {
        case '+': return a + b;
        case '-': return a - b;
        case '*': return a * b;
        case '/': return b === 0 ? ERR.DIV0 : a / b;
        case '^': {
          if (a === 0 && b === 0) return ERR.NUM;
          const p = Math.pow(a, b);
          return Number.isFinite(p) ? p : (a === 0 && b < 0 ? ERR.DIV0 : ERR.NUM);
        }
        default: return ERR.VALUE;
      }
    }

    function evalNode(node, cx) {
      switch (node.k) {
        case 'num': return node.v;
        case 'str': return node.v;
        case 'bool': return node.v;
        case 'err': return node.v;
        case 'missing': return { missing: true };
        case 'name': return ERR.NAME;
        case 'arr': return new Arr(node.rows);
        case 'ref': {
          const s = sheetIndex(node.sheet, cx.sheet);
          if (s < 0) return ERR.REF;
          return new Rng(s, node.r, node.c, node.r, node.c);
        }
        case 'range': {
          const s = sheetIndex(node.sheet, cx.sheet);
          if (s < 0) return ERR.REF;
          return new Rng(s, Math.min(node.r1, node.r2), Math.min(node.c1, node.c2), Math.max(node.r1, node.r2), Math.max(node.c1, node.c2));
        }
        case 'cols': {
          const s = sheetIndex(node.sheet, cx.sheet);
          if (s < 0) return ERR.REF;
          const u = usedBounds(s);
          return new Rng(s, 0, Math.min(node.c1, node.c2), Math.max(0, u.r), Math.max(node.c1, node.c2));
        }
        case 'rows': {
          const s = sheetIndex(node.sheet, cx.sheet);
          if (s < 0) return ERR.REF;
          const u = usedBounds(s);
          return new Rng(s, Math.min(node.r1, node.r2), 0, Math.max(node.r1, node.r2), Math.max(0, u.c));
        }
        case 'neg': {
          const v = cx.ev(node.a);
          if (isMulti(v)) return lift(v, 0, (x) => { const n = toNumber(x); return isErr(n) ? n : -n; }, cx);
          const n = toNumber(scalar(v, cx));
          return isErr(n) ? n : -n;
        }
        case 'pct': {
          const v = cx.ev(node.a);
          if (isMulti(v)) return lift(v, 0, (x) => { const n = toNumber(x); return isErr(n) ? n : n / 100; }, cx);
          const n = toNumber(scalar(v, cx));
          return isErr(n) ? n : n / 100;
        }
        case 'bin': {
          const a = cx.ev(node.a), b = cx.ev(node.b);
          if (isMulti(a) || isMulti(b)) {
            if (a instanceof Rng && b instanceof Rng && a.rows * a.cols === 1 && b.rows * b.cols === 1) {
              return arith(node.op, scalar(a, cx), scalar(b, cx));
            }
            return lift(a, b, (x, y) => arith(node.op, x, y), cx);
          }
          return arith(node.op, scalar(a, cx), scalar(b, cx));
        }
        case 'call': {
          const fn = FN[node.name];
          if (!fn) return ERR.NAME;
          if (LAZY.has(node.name)) return fn(node.args, cx);
          const args = node.args.map((n) => (n.k === 'missing' ? undefined : cx.ev(n)));
          const out = fn(args, cx);
          return out === undefined ? ERR.VALUE : out;
        }
        default: return ERR.ERROR;
      }
    }

    /* Evaluate text that is not in a cell (tests, validation). */
    function evaluate(text, s, r, c) {
      if (typeof text !== 'string' || text[0] !== '=') return parseLiteral(text);
      return evaluateText(text, s, r || 0, c || 0);
    }

    return { val, evaluate, invalidate, usedBounds, sheetIndex, rawAt };
  }


  /* ======================================================================
     6. The editor
     ====================================================================== */

  /* Icons: 16px, stroke 1.6, currentColor. Margo's shared set is used when it
     has the glyph; these fill in what a spreadsheet needs on top of it. */
  const SV = (d) =>
    `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const LOCAL_ICONS = {
    undo: SV('<path d="M3 6h7a3.5 3.5 0 0 1 0 7H6"/><path d="M5.5 3.5 3 6l2.5 2.5"/>'),
    redo: SV('<path d="M13 6H6a3.5 3.5 0 0 0 0 7h4"/><path d="M10.5 3.5 13 6l-2.5 2.5"/>'),
    cut: SV('<circle cx="4.2" cy="11.8" r="1.7"/><circle cx="11.8" cy="11.8" r="1.7"/><path d="M5.4 10.6 11.5 2.5M10.6 10.6 4.5 2.5"/>'),
    copy: SV('<rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M10.5 5.5v-2A1.5 1.5 0 0 0 9 2H4a1.5 1.5 0 0 0-1.5 1.5V9A1.5 1.5 0 0 0 4 10.5h1.5"/>'),
    paste: SV('<path d="M5.5 3H4a1.5 1.5 0 0 0-1.5 1.5v8A1.5 1.5 0 0 0 4 14h8a1.5 1.5 0 0 0 1.5-1.5v-8A1.5 1.5 0 0 0 12 3h-1.5"/><rect x="5.5" y="1.5" width="5" height="3" rx="1"/>'),
    painter: SV('<rect x="2.5" y="2" width="9" height="4" rx="1"/><path d="M11.5 4h1.5v3.5H7.5v2"/><rect x="6.3" y="9.5" width="2.4" height="4.5" rx="0.8"/>'),
    bold: SV('<path d="M4.5 2.5h4.2a2.8 2.8 0 0 1 0 5.6H4.5zM4.5 8.1h5a2.7 2.7 0 0 1 0 5.4h-5z" stroke-width="1.8"/>'),
    italic: SV('<path d="M7 2.5h5M4 13.5h5M9.5 2.5l-3 11"/>'),
    underline: SV('<path d="M4.5 2.5v5a3.5 3.5 0 0 0 7 0v-5M3.5 14h9"/>'),
    strike: SV('<path d="M2.5 8h11M11 4.5C10.5 3.3 9.4 2.5 8 2.5c-1.9 0-3 1-3 2.4 0 .8.4 1.5 1.2 2M5 11.5c.5 1.3 1.6 2 3 2 1.9 0 3-1 3-2.5"/>'),
    textColor: SV('<path d="M4.5 11 8 2.5l3.5 8.5M5.7 8h4.6"/>'),
    fillColor: SV('<path d="m6.5 2 6 6-4.5 4.5a1.4 1.4 0 0 1-2 0L2 8.5a1.4 1.4 0 0 1 0-2z"/><path d="M2.5 7.5h9M13.5 10.5s1 1.3 1 2a1 1 0 0 1-2 0c0-.7 1-2 1-2z"/>'),
    alignLeft: SV('<path d="M2.5 3.5h11M2.5 6.5h7M2.5 9.5h11M2.5 12.5h7"/>'),
    alignCenter: SV('<path d="M2.5 3.5h11M4.5 6.5h7M2.5 9.5h11M4.5 12.5h7"/>'),
    alignRight: SV('<path d="M2.5 3.5h11M6.5 6.5h7M2.5 9.5h11M6.5 12.5h7"/>'),
    valignTop: SV('<path d="M2.5 2.5h11M8 13.5V5.5M5.5 8 8 5.5 10.5 8"/>'),
    valignMiddle: SV('<path d="M2.5 8h11M8 1.5v4M6 3.5l2 2 2-2M8 14.5v-4M6 12.5l2-2 2 2"/>'),
    valignBottom: SV('<path d="M2.5 13.5h11M8 2.5v8M5.5 8 8 10.5 10.5 8"/>'),
    wrap: SV('<path d="M2.5 3.5h11M2.5 7.5h8.5a2.3 2.3 0 0 1 0 4.6H8.5M2.5 11.5h3M10 10.5l-1.5 1.6L10 13.7"/>'),
    merge: SV('<rect x="1.5" y="3" width="13" height="10" rx="1.5"/><path d="M4 8h3M5.5 6.5 7 8l-1.5 1.5M12 8H9M10.5 6.5 9 8l1.5 1.5"/>'),
    borders: SV('<rect x="2.5" y="2.5" width="11" height="11" rx="1" stroke-dasharray="1.6 1.9"/><path d="M2.5 13.5h11"/>'),
    borderAll: SV('<rect x="2.5" y="2.5" width="11" height="11" rx="1"/><path d="M2.5 8h11M8 2.5v11"/>'),
    borderOuter: SV('<rect x="2.5" y="2.5" width="11" height="11" rx="1"/><path d="M2.5 8h11M8 2.5v11" stroke-dasharray="1.2 1.8" stroke-width="1.2"/>'),
    borderTop: SV('<path d="M2.5 2.5h11"/><path d="M2.5 13.5h11M2.5 2.5v11M13.5 2.5v11M2.5 8h11M8 2.5v11" stroke-dasharray="1.2 1.8" stroke-width="1.2"/>'),
    borderBottom: SV('<path d="M2.5 13.5h11"/><path d="M2.5 2.5h11M2.5 2.5v11M13.5 2.5v11M2.5 8h11M8 2.5v11" stroke-dasharray="1.2 1.8" stroke-width="1.2"/>'),
    borderLeft: SV('<path d="M2.5 2.5v11"/><path d="M2.5 2.5h11M2.5 13.5h11M13.5 2.5v11M2.5 8h11M8 2.5v11" stroke-dasharray="1.2 1.8" stroke-width="1.2"/>'),
    borderRight: SV('<path d="M13.5 2.5v11"/><path d="M2.5 2.5h11M2.5 13.5h11M2.5 2.5v11M2.5 8h11M8 2.5v11" stroke-dasharray="1.2 1.8" stroke-width="1.2"/>'),
    borderThick: SV('<rect x="2.5" y="2.5" width="11" height="11" rx="1" stroke-width="2.6"/>'),
    borderNone: SV('<rect x="2.5" y="2.5" width="11" height="11" rx="1" stroke-dasharray="1.2 1.8" stroke-width="1.2"/><path d="m4 12 8-8"/>'),
    currency: SV('<path d="M8 1.8v12.4M11 4.3H6.8a2 2 0 0 0 0 4h2.4a2 2 0 0 1 0 4H5"/>'),
    percent: SV('<path d="M12.5 3.5 3.5 12.5"/><circle cx="4.8" cy="4.8" r="1.6"/><circle cx="11.2" cy="11.2" r="1.6"/>'),
    comma: SV('<path d="M2 11.5h1.2M5.5 5.5v6M8.5 5.5h2.5l-2.5 6M13 10.5l.2 1.2-.7 1.3"/>'),
    decInc: SV('<path d="M2 12h.6"/><rect x="4" y="5" width="3.2" height="7" rx="1.6"/><rect x="9" y="5" width="3.2" height="7" rx="1.6"/><path d="M13.3 2v3.2M11.7 3.6h3.2" stroke-width="1.3"/>'),
    decDec: SV('<path d="M2 12h.6"/><rect x="4" y="5" width="3.2" height="7" rx="1.6"/><rect x="9" y="5" width="3.2" height="7" rx="1.6"/><path d="M11.7 3.6h3.2" stroke-width="1.3"/>'),
    fontGrow: SV('<path d="M2 13 5.5 4 9 13M3.3 10h4.4M11.5 3v4M9.5 5h4"/>'),
    fontShrink: SV('<path d="M2 13 5.5 4 9 13M3.3 10h4.4M9.5 5h4"/>'),
    insert: SV('<rect x="2" y="2" width="12" height="12" rx="1.5"/><path d="M8 5v6M5 8h6"/>'),
    rowAbove: SV('<rect x="2" y="8.5" width="12" height="5" rx="1"/><path d="M8 1.8v4.6M5.7 4.1h4.6"/>'),
    rowBelow: SV('<rect x="2" y="2.5" width="12" height="5" rx="1"/><path d="M8 9.6v4.6M5.7 11.9h4.6"/>'),
    colLeft: SV('<rect x="8.5" y="2" width="5" height="12" rx="1"/><path d="M1.8 8h4.6M4.1 5.7v4.6"/>'),
    colRight: SV('<rect x="2.5" y="2" width="5" height="12" rx="1"/><path d="M9.6 8h4.6M11.9 5.7v4.6"/>'),
    deleteRow: SV('<rect x="2" y="5.5" width="12" height="5" rx="1"/><path d="m6 6.5 4 3M10 6.5l-4 3"/>'),
    deleteCol: SV('<rect x="5.5" y="2" width="5" height="12" rx="1"/><path d="m6.5 6 3 4M9.5 6l-3 4"/>'),
    trash: SV('<path d="M3 4.5h10M6.5 4.5V3a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1v1.5M4.5 4.5l.6 8.6a1 1 0 0 0 1 .9h3.8a1 1 0 0 0 1-.9l.6-8.6"/>'),
    eraser: SV('<path d="M9 2.8 13.2 7 7.7 12.5H4.9L2.8 10.4a1.2 1.2 0 0 1 0-1.7z"/><path d="M6.2 5.6 10.4 9.8M7.7 12.5H13.5"/>'),
    sigma: SV('<path d="M12.5 3.5h-9l4.5 4.5-4.5 4.5h9"/>'),
    fx: SV('<path d="M6.5 13.5c1.3 0 1.6-1 1.8-2.2l1-6.6c.2-1.2.6-2.2 1.9-2.2M5.5 6.5h5"/><path d="m10.5 9 3 4M13.5 9l-3 4" stroke-width="1.4"/>'),
    sortAsc: SV('<path d="M4 2.5v11M2 11.5l2 2 2-2M8.5 3h3l-3 4h3M8.5 13l1.5-4.5L11.5 13M9 11.7h2"/>'),
    sortDesc: SV('<path d="M4 2.5v11M2 11.5l2 2 2-2M8.5 9h3l-3 4h3M8.5 7l1.5-4.5L11.5 7M9 5.7h2"/>'),
    filter: SV('<path d="M2.5 3h11L9.2 8.3v4.4l-2.4 1V8.3z"/>'),
    filterClear: SV('<path d="M2.5 3h11L9.2 8.3v1.2M6.8 8.3v5.4l1.3-.6"/><path d="m10.8 10.8 3 3M13.8 10.8l-3 3"/>'),
    search: SV('<circle cx="7" cy="7" r="4.5"/><path d="m13.5 13.5-3.2-3.2"/>'),
    condFormat: SV('<rect x="2" y="2" width="12" height="12" rx="1.5"/><path d="M2 6h12M2 10h12M6 2v12"/><path d="M9 7.5h3.5v1.5H9z" fill="currentColor" stroke="none"/>'),
    validation: SV('<rect x="2" y="3" width="12" height="10" rx="1.5"/><path d="m9.5 7 1.5 1.5L12.5 7M4.5 8h3"/>'),
    chartColumn: SV('<path d="M2 13.5h12"/><rect x="3" y="7.5" width="2.5" height="6" rx="0.6"/><rect x="6.8" y="3.5" width="2.5" height="10" rx="0.6"/><rect x="10.6" y="9" width="2.5" height="4.5" rx="0.6"/>'),
    chartBar: SV('<path d="M2.5 2v12"/><rect x="2.5" y="3" width="6" height="2.5" rx="0.6"/><rect x="2.5" y="6.8" width="10" height="2.5" rx="0.6"/><rect x="2.5" y="10.6" width="4" height="2.5" rx="0.6"/>'),
    chartLine: SV('<path d="M2 13.5h12M2.5 11l3.5-4 3 2.5 4.5-6"/>'),
    chartArea: SV('<path d="M2 13.5h12"/><path d="M2.5 12.5V10l3.5-4 3 2.5 4.5-5v9z" fill="currentColor" fill-opacity="0.18"/>'),
    chartPie: SV('<path d="M8 2.2a5.8 5.8 0 1 0 5.8 5.8H8z"/><path d="M10 1.8a4.6 4.6 0 0 1 4.2 4.2H10z"/>'),
    freeze: SV('<rect x="2" y="2" width="12" height="12" rx="1.5"/><path d="M2 6h12M6 2v12" stroke-width="2"/>'),
    freezeRow: SV('<rect x="2" y="2" width="12" height="12" rx="1.5"/><path d="M2 6h12" stroke-width="2"/>'),
    freezeCol: SV('<rect x="2" y="2" width="12" height="12" rx="1.5"/><path d="M6 2v12" stroke-width="2"/>'),
    unfreeze: SV('<rect x="2" y="2" width="12" height="12" rx="1.5" stroke-dasharray="1.6 1.8"/>'),
    grid: SV('<rect x="2" y="2" width="12" height="12" rx="1.5"/><path d="M2 6h12M2 10h12M6 2v12M10 2v12"/>'),
    zoomIn: SV('<circle cx="7" cy="7" r="4.5"/><path d="m13.5 13.5-3.2-3.2M7 5.2v3.6M5.2 7h3.6"/>'),
    zoomOut: SV('<circle cx="7" cy="7" r="4.5"/><path d="m13.5 13.5-3.2-3.2M5.2 7h3.6"/>'),
    zoomReset: SV('<path d="M2.5 6V3.5a1 1 0 0 1 1-1H6M10 2.5h2.5a1 1 0 0 1 1 1V6M13.5 10v2.5a1 1 0 0 1-1 1H10M6 13.5H3.5a1 1 0 0 1-1-1V10"/>'),
    autofit: SV('<path d="M2.5 2v12M13.5 2v12M5 8h6M6.5 6.2 4.8 8l1.7 1.8M9.5 6.2 11.2 8l-1.7 1.8"/>'),
    showFormulas: SV('<rect x="2" y="2.5" width="12" height="11" rx="1.5"/><path d="M5 10.5c.8 0 1-.6 1.1-1.3l.6-3.4c.1-.7.4-1.3 1.2-1.3M4.8 7h3M9 7.5l2.5 3M11.5 7.5 9 10.5" stroke-width="1.3"/>'),
    calc: SV('<path d="M13 8a5 5 0 1 1-1.5-3.6"/><path d="M13.2 2.3v2.9h-2.9"/>'),
    home: SV('<path d="M2.5 7.5 8 3l5.5 4.5M4 6.3v7.2h8V6.3"/><path d="M6.7 13.5V10h2.6v3.5"/>'),
    chevronDown: SV('<path d="m4.5 6.5 3.5 3.5 3.5-3.5"/>'),
    plus: SV('<path d="M8 3v10M3 8h10"/>'),
    close: SV('<path d="m4 4 8 8M12 4l-8 8"/>'),
    more: SV('<circle cx="3.5" cy="8" r="0.6" fill="currentColor"/><circle cx="8" cy="8" r="0.6" fill="currentColor"/><circle cx="12.5" cy="8" r="0.6" fill="currentColor"/>'),
    date: SV('<rect x="2.5" y="3.5" width="11" height="10" rx="1.5"/><path d="M2.5 7h11M5.5 2v3M10.5 2v3"/>'),
    sheet: SV('<rect x="2" y="2.5" width="12" height="11" rx="1.5"/><path d="M2 6.5h12M6.5 6.5v7"/>'),
    duplicates: SV('<rect x="2" y="2" width="8" height="8" rx="1.2"/><rect x="6" y="6" width="8" height="8" rx="1.2"/><path d="m8.2 10 1.4 1.4L12 9"/>')
  };
  const ICON = (name) => LOCAL_ICONS[name] || (window.MargoIcons && window.MargoIcons[name]) || '';

  /* Categorical palette for charts (validated order; see sheet.css for the
     dark-surface steps). */
  const SERIES_VARS = ['--sheet-series-1', '--sheet-series-2', '--sheet-series-3', '--sheet-series-4',
    '--sheet-series-5', '--sheet-series-6', '--sheet-series-7', '--sheet-series-8'];
  const REF_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#b77f00', '#d55181', '#4a3aa7'];

  const FX_CATALOG = [
    ['SUM', 'Math', 'SUM(number1, [number2], …)', 'Adds numbers and ranges.'],
    ['AVERAGE', 'Stats', 'AVERAGE(number1, [number2], …)', 'Arithmetic mean of the numbers.'],
    ['COUNT', 'Stats', 'COUNT(value1, [value2], …)', 'Counts cells that contain numbers.'],
    ['COUNTA', 'Stats', 'COUNTA(value1, [value2], …)', 'Counts cells that are not empty.'],
    ['COUNTBLANK', 'Stats', 'COUNTBLANK(range)', 'Counts empty cells in a range.'],
    ['COUNTIF', 'Stats', 'COUNTIF(range, criterion)', 'Counts cells that meet a condition, e.g. ">10" or "a*".'],
    ['COUNTIFS', 'Stats', 'COUNTIFS(range1, criterion1, [range2, criterion2], …)', 'Counts rows that meet every condition.'],
    ['SUMIF', 'Math', 'SUMIF(range, criterion, [sum_range])', 'Adds the cells that meet a condition.'],
    ['SUMIFS', 'Math', 'SUMIFS(sum_range, range1, criterion1, …)', 'Adds cells that meet several conditions.'],
    ['AVERAGEIF', 'Stats', 'AVERAGEIF(range, criterion, [average_range])', 'Average of the cells that meet a condition.'],
    ['AVERAGEIFS', 'Stats', 'AVERAGEIFS(average_range, range1, criterion1, …)', 'Average of cells that meet several conditions.'],
    ['MAXIFS', 'Stats', 'MAXIFS(max_range, range1, criterion1, …)', 'Largest value that meets the conditions.'],
    ['MINIFS', 'Stats', 'MINIFS(min_range, range1, criterion1, …)', 'Smallest value that meets the conditions.'],
    ['MIN', 'Stats', 'MIN(number1, [number2], …)', 'Smallest number.'],
    ['MAX', 'Stats', 'MAX(number1, [number2], …)', 'Largest number.'],
    ['MEDIAN', 'Stats', 'MEDIAN(number1, [number2], …)', 'Middle value of the numbers.'],
    ['MODE', 'Stats', 'MODE(number1, [number2], …)', 'Most frequent number.'],
    ['STDEV', 'Stats', 'STDEV(number1, [number2], …)', 'Sample standard deviation.'],
    ['STDEVP', 'Stats', 'STDEVP(number1, [number2], …)', 'Population standard deviation.'],
    ['VAR', 'Stats', 'VAR(number1, [number2], …)', 'Sample variance.'],
    ['LARGE', 'Stats', 'LARGE(array, k)', 'The k-th largest value.'],
    ['SMALL', 'Stats', 'SMALL(array, k)', 'The k-th smallest value.'],
    ['RANK', 'Stats', 'RANK(number, ref, [order])', 'Rank of a number in a list.'],
    ['PERCENTILE', 'Stats', 'PERCENTILE(array, k)', 'The k-th percentile (0–1).'],
    ['QUARTILE', 'Stats', 'QUARTILE(array, quart)', 'Quartile 0–4 of the values.'],
    ['CORREL', 'Stats', 'CORREL(array1, array2)', 'Correlation coefficient of two ranges.'],
    ['SUMPRODUCT', 'Math', 'SUMPRODUCT(array1, [array2], …)', 'Sum of the products of matching items.'],
    ['PRODUCT', 'Math', 'PRODUCT(number1, [number2], …)', 'Multiplies the numbers.'],
    ['ROUND', 'Math', 'ROUND(number, num_digits)', 'Rounds to a number of digits.'],
    ['ROUNDUP', 'Math', 'ROUNDUP(number, num_digits)', 'Rounds away from zero.'],
    ['ROUNDDOWN', 'Math', 'ROUNDDOWN(number, num_digits)', 'Rounds toward zero.'],
    ['MROUND', 'Math', 'MROUND(number, multiple)', 'Rounds to the nearest multiple.'],
    ['CEILING', 'Math', 'CEILING(number, [significance])', 'Rounds up to a multiple.'],
    ['FLOOR', 'Math', 'FLOOR(number, [significance])', 'Rounds down to a multiple.'],
    ['TRUNC', 'Math', 'TRUNC(number, [num_digits])', 'Cuts off the decimals.'],
    ['INT', 'Math', 'INT(number)', 'Rounds down to an integer.'],
    ['ABS', 'Math', 'ABS(number)', 'Absolute value.'],
    ['SIGN', 'Math', 'SIGN(number)', '1, 0 or -1 by sign.'],
    ['SQRT', 'Math', 'SQRT(number)', 'Square root.'],
    ['POWER', 'Math', 'POWER(number, power)', 'A number raised to a power.'],
    ['EXP', 'Math', 'EXP(number)', 'e raised to a power.'],
    ['LN', 'Math', 'LN(number)', 'Natural logarithm.'],
    ['LOG', 'Math', 'LOG(number, [base])', 'Logarithm (base 10 by default).'],
    ['LOG10', 'Math', 'LOG10(number)', 'Base-10 logarithm.'],
    ['MOD', 'Math', 'MOD(number, divisor)', 'Remainder after division.'],
    ['QUOTIENT', 'Math', 'QUOTIENT(numerator, denominator)', 'Integer part of a division.'],
    ['PI', 'Math', 'PI()', 'The number π.'],
    ['RAND', 'Math', 'RAND()', 'Random number between 0 and 1.'],
    ['RANDBETWEEN', 'Math', 'RANDBETWEEN(bottom, top)', 'Random integer in a range.'],
    ['EVEN', 'Math', 'EVEN(number)', 'Rounds up to an even integer.'],
    ['ODD', 'Math', 'ODD(number)', 'Rounds up to an odd integer.'],
    ['FACT', 'Math', 'FACT(number)', 'Factorial.'],
    ['GCD', 'Math', 'GCD(number1, [number2], …)', 'Greatest common divisor.'],
    ['LCM', 'Math', 'LCM(number1, [number2], …)', 'Least common multiple.'],
    ['SIN', 'Math', 'SIN(angle)', 'Sine of an angle in radians.'],
    ['COS', 'Math', 'COS(angle)', 'Cosine of an angle in radians.'],
    ['TAN', 'Math', 'TAN(angle)', 'Tangent of an angle in radians.'],
    ['DEGREES', 'Math', 'DEGREES(angle)', 'Radians to degrees.'],
    ['RADIANS', 'Math', 'RADIANS(angle)', 'Degrees to radians.'],
    ['SUBTOTAL', 'Math', 'SUBTOTAL(function_num, ref1, …)', 'Aggregate by code (1 AVERAGE … 9 SUM …).'],
    ['IF', 'Logical', 'IF(logical_test, value_if_true, [value_if_false])', 'One value if a condition is TRUE, another if FALSE.'],
    ['IFS', 'Logical', 'IFS(test1, value1, [test2, value2], …)', 'Value of the first condition that is TRUE.'],
    ['IFERROR', 'Logical', 'IFERROR(value, value_if_error)', 'A fallback when a formula errors.'],
    ['IFNA', 'Logical', 'IFNA(value, value_if_na)', 'A fallback for #N/A.'],
    ['AND', 'Logical', 'AND(logical1, [logical2], …)', 'TRUE when every argument is TRUE.'],
    ['OR', 'Logical', 'OR(logical1, [logical2], …)', 'TRUE when any argument is TRUE.'],
    ['NOT', 'Logical', 'NOT(logical)', 'Reverses TRUE and FALSE.'],
    ['XOR', 'Logical', 'XOR(logical1, [logical2], …)', 'TRUE when an odd number are TRUE.'],
    ['SWITCH', 'Logical', 'SWITCH(expression, value1, result1, …, [default])', 'Picks a result by matching a value.'],
    ['CHOOSE', 'Lookup', 'CHOOSE(index, value1, [value2], …)', 'Picks a value by position.'],
    ['VLOOKUP', 'Lookup', 'VLOOKUP(lookup_value, table, col_index, [approximate])', 'Finds a value in the first column and returns one from the same row.'],
    ['HLOOKUP', 'Lookup', 'HLOOKUP(lookup_value, table, row_index, [approximate])', 'Finds a value in the first row and returns one from the same column.'],
    ['XLOOKUP', 'Lookup', 'XLOOKUP(lookup_value, lookup_array, return_array, [if_not_found], [match_mode], [search_mode])', 'Modern lookup in any direction.'],
    ['INDEX', 'Lookup', 'INDEX(array, row_num, [col_num])', 'Value at a row and column of a range.'],
    ['MATCH', 'Lookup', 'MATCH(lookup_value, lookup_array, [match_type])', 'Position of a value in a list.'],
    ['LOOKUP', 'Lookup', 'LOOKUP(lookup_value, lookup_vector, [result_vector])', 'Approximate lookup in a sorted list.'],
    ['ROW', 'Lookup', 'ROW([reference])', 'Row number of a reference.'],
    ['COLUMN', 'Lookup', 'COLUMN([reference])', 'Column number of a reference.'],
    ['ROWS', 'Lookup', 'ROWS(array)', 'Number of rows in a range.'],
    ['COLUMNS', 'Lookup', 'COLUMNS(array)', 'Number of columns in a range.'],
    ['CONCAT', 'Text', 'CONCAT(text1, [text2], …)', 'Joins text and ranges.'],
    ['CONCATENATE', 'Text', 'CONCATENATE(text1, [text2], …)', 'Joins text items.'],
    ['TEXTJOIN', 'Text', 'TEXTJOIN(delimiter, ignore_empty, text1, …)', 'Joins text with a delimiter.'],
    ['LEFT', 'Text', 'LEFT(text, [num_chars])', 'Characters from the start.'],
    ['RIGHT', 'Text', 'RIGHT(text, [num_chars])', 'Characters from the end.'],
    ['MID', 'Text', 'MID(text, start_num, num_chars)', 'Characters from the middle.'],
    ['LEN', 'Text', 'LEN(text)', 'Number of characters.'],
    ['UPPER', 'Text', 'UPPER(text)', 'Converts to upper case.'],
    ['LOWER', 'Text', 'LOWER(text)', 'Converts to lower case.'],
    ['PROPER', 'Text', 'PROPER(text)', 'Capitalises each word.'],
    ['TRIM', 'Text', 'TRIM(text)', 'Removes extra spaces.'],
    ['CLEAN', 'Text', 'CLEAN(text)', 'Removes non-printing characters.'],
    ['SUBSTITUTE', 'Text', 'SUBSTITUTE(text, old_text, new_text, [instance])', 'Replaces matching text.'],
    ['REPLACE', 'Text', 'REPLACE(text, start, num_chars, new_text)', 'Replaces characters by position.'],
    ['FIND', 'Text', 'FIND(find_text, within_text, [start])', 'Position of text (case-sensitive).'],
    ['SEARCH', 'Text', 'SEARCH(find_text, within_text, [start])', 'Position of text (wildcards, any case).'],
    ['REPT', 'Text', 'REPT(text, times)', 'Repeats text.'],
    ['EXACT', 'Text', 'EXACT(text1, text2)', 'TRUE when two texts are identical.'],
    ['TEXT', 'Text', 'TEXT(value, format_text)', 'Formats a number as text, e.g. "0.00" or "yyyy-mm-dd".'],
    ['VALUE', 'Text', 'VALUE(text)', 'Converts text to a number.'],
    ['FIXED', 'Text', 'FIXED(number, [decimals], [no_commas])', 'Number as text with fixed decimals.'],
    ['DOLLAR', 'Text', 'DOLLAR(number, [decimals])', 'Number as currency text.'],
    ['CHAR', 'Text', 'CHAR(number)', 'Character from a code.'],
    ['CODE', 'Text', 'CODE(text)', 'Code of the first character.'],
    ['TODAY', 'Date', 'TODAY()', "Today's date."],
    ['NOW', 'Date', 'NOW()', 'Current date and time.'],
    ['DATE', 'Date', 'DATE(year, month, day)', 'A date from its parts.'],
    ['TIME', 'Date', 'TIME(hour, minute, second)', 'A time from its parts.'],
    ['DATEVALUE', 'Date', 'DATEVALUE(date_text)', 'Converts date text to a date.'],
    ['YEAR', 'Date', 'YEAR(date)', 'Year of a date.'],
    ['MONTH', 'Date', 'MONTH(date)', 'Month of a date (1–12).'],
    ['DAY', 'Date', 'DAY(date)', 'Day of the month.'],
    ['HOUR', 'Date', 'HOUR(time)', 'Hour of a time.'],
    ['MINUTE', 'Date', 'MINUTE(time)', 'Minute of a time.'],
    ['SECOND', 'Date', 'SECOND(time)', 'Second of a time.'],
    ['WEEKDAY', 'Date', 'WEEKDAY(date, [return_type])', 'Day of the week (1 = Sunday).'],
    ['WEEKNUM', 'Date', 'WEEKNUM(date, [return_type])', 'Week number of the year.'],
    ['EDATE', 'Date', 'EDATE(start_date, months)', 'Date a number of months away.'],
    ['EOMONTH', 'Date', 'EOMONTH(start_date, months)', 'Last day of a month.'],
    ['DAYS', 'Date', 'DAYS(end_date, start_date)', 'Days between two dates.'],
    ['DATEDIF', 'Date', 'DATEDIF(start_date, end_date, unit)', 'Difference in "Y", "M", "D", "YM", "MD" or "YD".'],
    ['NETWORKDAYS', 'Date', 'NETWORKDAYS(start_date, end_date, [holidays])', 'Working days between two dates.'],
    ['WORKDAY', 'Date', 'WORKDAY(start_date, days, [holidays])', 'Date a number of working days away.'],
    ['ISBLANK', 'Info', 'ISBLANK(value)', 'TRUE when the cell is empty.'],
    ['ISNUMBER', 'Info', 'ISNUMBER(value)', 'TRUE for a number.'],
    ['ISTEXT', 'Info', 'ISTEXT(value)', 'TRUE for text.'],
    ['ISERROR', 'Info', 'ISERROR(value)', 'TRUE for any error.'],
    ['ISNA', 'Info', 'ISNA(value)', 'TRUE for #N/A.'],
    ['ISEVEN', 'Info', 'ISEVEN(number)', 'TRUE for an even number.'],
    ['ISODD', 'Info', 'ISODD(number)', 'TRUE for an odd number.'],
    ['NA', 'Info', 'NA()', 'The #N/A error.'],
    ['PMT', 'Financial', 'PMT(rate, nper, pv, [fv], [type])', 'Payment for a loan.'],
    ['FV', 'Financial', 'FV(rate, nper, pmt, [pv], [type])', 'Future value of an investment.'],
    ['PV', 'Financial', 'PV(rate, nper, pmt, [fv], [type])', 'Present value of an investment.'],
    ['NPER', 'Financial', 'NPER(rate, pmt, pv, [fv], [type])', 'Number of payment periods.'],
    ['NPV', 'Financial', 'NPV(rate, value1, [value2], …)', 'Net present value of cash flows.']
  ].map(([name, cat, syntax, desc]) => ({ name, cat, syntax, desc }));
  const POPULAR_FNS = ['SUM', 'IF', 'COUNT', 'AVERAGE', 'VLOOKUP', 'XLOOKUP', 'COUNTIF', 'SUMIF', 'MAX', 'MIN', 'ROUND', 'CONCAT', 'INDEX', 'MATCH', 'IFERROR', 'COUNTA', 'TODAY', 'TEXT', 'LEFT', 'AND', 'OR', 'SUMIFS', 'COUNTIFS', 'LEN', 'TRIM', 'DATE', 'NOW'];
  const FX_BY_NAME = new Map(FX_CATALOG.map((f) => [f.name, f]));
  const FX_CATEGORIES = ['Math', 'Stats', 'Logical', 'Lookup', 'Text', 'Date', 'Info', 'Financial'];

  const DEFAULT_COL_WIDTH = 96;
  const DEFAULT_ROW_HEIGHT = 24;
  const HEADER_W = 46;
  const HEADER_H = 24;
  const PT_PX = 1.2; // 11pt -> 13.2px, the grid's body size

  function normRange(a, b) {
    return { r1: Math.min(a.r, b.r), c1: Math.min(a.c, b.c), r2: Math.max(a.r, b.r), c2: Math.max(a.c, b.c) };
  }
  function toRangeObj(v) {
    if (!v) return null;
    if (typeof v === 'string') return parseA1Range(v);
    if (typeof v.r1 === 'number') return { r1: v.r1, c1: v.c1, r2: v.r2, c2: v.c2 };
    return null;
  }

  /* Whatever arrives (an .xlsx read, a draft, an older Margo file) comes out
     with every field the editor relies on. */
  function normalizeSheet(s, i) {
    const styles = {};
    Object.entries(s.styles || {}).forEach(([k, st]) => {
      if (!st || typeof st !== 'object') return;
      const out = { ...st };
      if (out.numFmt == null && out.format) {
        const code = legacyFormatCode(out.format, out.numDecimals);
        if (code) out.numFmt = code;
      }
      delete out.format;
      delete out.numDecimals;
      if (!out.borders && out.border) {
        const w = out.border === 'thick' ? 'medium' : 'thin';
        if (out.border === 'all' || out.border === 'outer' || out.border === 'thick') out.borders = { t: w, r: w, b: w, l: w };
      }
      delete out.border;
      if (Object.keys(out).length) styles[k] = out;
    });
    const freeze = s.freeze && (s.freeze.rows || s.freeze.cols)
      ? { rows: Math.max(0, s.freeze.rows | 0), cols: Math.max(0, s.freeze.cols | 0) } : { rows: 0, cols: 0 };
    return {
      name: String(s.name || `Sheet${i + 1}`),
      rows: (s.rows || []).map((r) => (r || []).map((v) => (v == null ? '' : typeof v === 'object' && v.formula ? '=' + v.formula : String(v)))),
      styles,
      colWidths: { ...(s.colWidths || {}) },
      rowHeights: { ...(s.rowHeights || {}) },
      charts: Array.isArray(s.charts) ? s.charts.map((c) => ({ ...c })) : [],
      merges: (s.merges || []).map(toRangeObj).filter((m) => m && (m.r1 !== m.r2 || m.c1 !== m.c2)),
      freeze,
      condFormats: Array.isArray(s.condFormats) ? s.condFormats.filter((c) => c && toRangeObj(c.range)).map((c) => ({ ...c, range: toRangeObj(c.range) })) : [],
      validations: Array.isArray(s.validations) ? s.validations.filter((v) => v && toRangeObj(v.range)).map((v) => ({ ...v, range: toRangeObj(v.range) })) : [],
      filter: s.filter && typeof s.filter.r === 'number' ? { r: s.filter.r, c1: s.filter.c1 | 0, c2: s.filter.c2 | 0, hidden: { ...(s.filter.hidden || {}) } } : null,
      hideGrid: !!s.hideGrid
    };
  }
  function blankSheet(name) {
    return normalizeSheet({ name }, 0);
  }

  function create(ctx) {
    const FONTS = window.MargoFonts;
    const PICKER = window.MargoColorPicker;
    let fontFacesByFamily = new Map((FONTS.FAMILIES || []).map((f) => [f, FONTS.defaultFaces(f)]));

    let model = null;                 // { sheets, active }
    const engine = createEngine({ sheets: () => model.sheets });
    let history = window.MargoHistory.create();
    let skipHistory = false;

    let sel = { r: 0, c: 0 };         // active cell / anchor
    let selEnd = null;                // moving corner of a range
    let zoom = 1;
    const ZOOM_MIN = 0.5, ZOOM_MAX = 2;
    let showFormulas = false;
    let recalcCount = 0;
    let destroyed = false;
    let activeRibbonTab = 'home';

    // DOM
    let hostEl, wrapEl, gridScroll, viewport, sizer, nameBox, formulaInput, fxBtn, tabsEl, editorEl;
    let quads = {}, hdrs = {}, chartLayer, acPop, sigPop;
    let fontSelect, variantSelect, sizeSelect, fmtSelect;
    const ribbonState = [];           // [{el, get: () => bool}] toggle buttons to sync
    let resizeObs = null;
    let rafId = 0;
    const cleanups = [];              // run on destroy

    const sheet = () => model.sheets[model.active];

    /* ---------------- raw cell access ---------------- */
    function getRaw(r, c, s) {
      const sh = model.sheets[s == null ? model.active : s];
      const row = sh && sh.rows[r];
      const v = row ? row[c] : undefined;
      return v == null ? '' : String(v);
    }
    function putRaw(sh, r, c, v) {
      const rows = sh.rows;
      if (v === '' || v == null) {
        if (!rows[r] || rows[r].length <= c) return;
        rows[r][c] = '';
        return;
      }
      while (rows.length <= r) rows.push([]);
      const row = rows[r] || (rows[r] = []);
      while (row.length < c) row.push('');
      row[c] = v;
    }
    const styleKey = (r, c) => r + ',' + c;
    function getStyle(r, c, s) {
      const sh = model.sheets[s == null ? model.active : s];
      return (sh.styles && sh.styles[styleKey(r, c)]) || null;
    }

    /* ---------------- merges ---------------- */
    let mergeIndex = null;            // Map "r,c" -> merge, per sheet version
    function mergesMap() {
      if (mergeIndex) return mergeIndex;
      mergeIndex = new Map();
      for (const m of sheet().merges) {
        for (let r = m.r1; r <= m.r2; r++) for (let c = m.c1; c <= m.c2; c++) mergeIndex.set(r + ',' + c, m);
      }
      return mergeIndex;
    }
    const mergeAt = (r, c) => mergesMap().get(r + ',' + c) || null;
    function expandForMerges(rg) {
      const out = { ...rg };
      const ms = sheet().merges;
      if (!ms.length) return out;
      let changed = true;
      while (changed) {
        changed = false;
        for (const m of ms) {
          if (rangesIntersect(m, out) && (m.r1 < out.r1 || m.c1 < out.c1 || m.r2 > out.r2 || m.c2 > out.c2)) {
            out.r1 = Math.min(out.r1, m.r1); out.c1 = Math.min(out.c1, m.c1);
            out.r2 = Math.max(out.r2, m.r2); out.c2 = Math.max(out.c2, m.c2);
            changed = true;
          }
        }
      }
      return out;
    }
    let fixedRange = null;            // a range the active cell is walking through (Enter/Tab)
    function selRange() {
      if (fixedRange) return expandForMerges(fixedRange);
      const base = selEnd ? normRange(sel, selEnd) : { r1: sel.r, c1: sel.c, r2: sel.r, c2: sel.c };
      return expandForMerges(base);
    }
    const isSingleCell = (rg) => {
      if (rg.r1 === rg.r2 && rg.c1 === rg.c2) return true;
      const m = mergeAt(rg.r1, rg.c1);
      return !!(m && m.r1 === rg.r1 && m.c1 === rg.c1 && m.r2 === rg.r2 && m.c2 === rg.c2);
    };

    /* ---------------- filter visibility ---------------- */
    let hiddenRowsCache = null;
    function hiddenRows() {
      if (hiddenRowsCache) return hiddenRowsCache;
      const set = new Set();
      const f = sheet().filter;
      if (f && f.hidden && Object.keys(f.hidden).length) {
        const last = filterEnd(f);
        for (let r = f.r + 1; r <= last; r++) {
          for (const [col, list] of Object.entries(f.hidden)) {
            if (!list || !list.length) continue;
            const key = filterKey(r, +col);
            if (list.includes(key)) { set.add(r); break; }
          }
        }
      }
      hiddenRowsCache = set;
      return set;
    }
    function filterKey(r, c) { return displayText(r, c).toLowerCase(); }
    /* A filter covers the block under its header row down to the first
       completely empty row, so rows added at the bottom join it. */
    function filterEnd(f) {
      const u = engine.usedBounds(model.active);
      let r = f.r + 1;
      const filled = (rr) => { for (let c = f.c1; c <= f.c2; c++) if (getRaw(rr, c) !== '') return true; return false; };
      while (r <= u.r && filled(r)) r++;
      return r - 1;
    }

    /* ---------------- layout ---------------- */
    let L = null;                     // { colPos, rowPos, nRows, nCols }
    let autoHeights = null;
    function invalidateLayout() { L = null; }
    function rebuildAutoHeights() {
      autoHeights = new Map();
      const sh = sheet();
      for (const [k, st] of Object.entries(sh.styles)) {
        if (!st) continue;
        const [r, c] = k.split(',').map(Number);
        let h = 0;
        if (st.size && st.size > 11) h = Math.round(st.size * PT_PX * 1.45 + 6);
        if (st.wrap) {
          const text = displayText(r, c);
          if (text) {
            const w = (sh.colWidths[c] != null ? sh.colWidths[c] : DEFAULT_COL_WIDTH) - 10;
            const font = cellFontCss(st, 1);
            let lines = 0;
            String(text).split('\n').forEach((part) => { lines += Math.max(1, Math.ceil(measureText(part, font) / Math.max(10, w))); });
            h = Math.max(h, Math.ceil(lines * (st.size || 11) * PT_PX * 1.3 + 8));
          }
        }
        if (h > (autoHeights.get(r) || 0)) autoHeights.set(r, h);
      }
    }
    function rowHeightRaw(r) {
      const sh = sheet();
      if (sh.rowHeights[r] != null) return sh.rowHeights[r];
      if (!autoHeights) rebuildAutoHeights();
      return Math.max(DEFAULT_ROW_HEIGHT, autoHeights.get(r) || 0);
    }
    function colWidthRaw(c) {
      const cw = sheet().colWidths;
      return cw[c] != null ? cw[c] : DEFAULT_COL_WIDTH;
    }
    let minRows = 200, minCols = 30;
    function ensureLayout() {
      if (L) return L;
      const u = engine.usedBounds(model.active);
      const sh = sheet();
      let extraR = 0, extraC = 0;
      sh.merges.forEach((m) => { extraR = Math.max(extraR, m.r2 + 1); extraC = Math.max(extraC, m.c2 + 1); });
      const nRows = Math.min(MAX_ROWS, Math.max(minRows, u.r + 60, extraR + 20, sel.r + 30, (selEnd ? selEnd.r : 0) + 30));
      const nCols = Math.min(MAX_COLS, Math.max(minCols, u.c + 12, extraC + 6, sel.c + 8, (selEnd ? selEnd.c : 0) + 8));
      const hidden = hiddenRows();
      const colPos = new Float64Array(nCols + 1);
      for (let c = 0; c < nCols; c++) colPos[c + 1] = colPos[c] + colWidthRaw(c) * zoom;
      const rowPos = new Float64Array(nRows + 1);
      for (let r = 0; r < nRows; r++) rowPos[r + 1] = rowPos[r] + (hidden.has(r) ? 0 : rowHeightRaw(r) * zoom);
      L = { colPos, rowPos, nRows, nCols };
      return L;
    }
    function bsearch(arr, n, p) {
      // largest i in [0, n-1] with arr[i] <= p
      let lo = 0, hi = n - 1;
      if (p <= 0) return 0;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (arr[mid] <= p) lo = mid; else hi = mid - 1;
      }
      return lo;
    }
    const HW = () => Math.round(HEADER_W * Math.max(0.8, zoom));
    const HH = () => Math.round(HEADER_H * Math.max(0.8, zoom));
    function frozen() {
      const f = sheet().freeze || { rows: 0, cols: 0 };
      const lay = ensureLayout();
      return { fr: Math.min(f.rows, lay.nRows - 1), fc: Math.min(f.cols, lay.nCols - 1) };
    }

    /* Screen (viewport) x of a column's left edge, and y of a row's top. */
    function screenX(c) {
      const lay = ensureLayout(), { fc } = frozen();
      const fw = lay.colPos[fc];
      return HW() + (c < fc ? lay.colPos[c] : fw + lay.colPos[c] - lay.colPos[fc] - gridScroll.scrollLeft);
    }
    function screenY(r) {
      const lay = ensureLayout(), { fr } = frozen();
      const fh = lay.rowPos[fr];
      return HH() + (r < fr ? lay.rowPos[r] : fh + lay.rowPos[r] - lay.rowPos[fr] - gridScroll.scrollTop);
    }
    function cellRect(r, c) {
      const lay = ensureLayout();
      const m = mergeAt(r, c);
      const r1 = m ? m.r1 : r, c1 = m ? m.c1 : c, r2 = m ? m.r2 : r, c2 = m ? m.c2 : c;
      const x = screenX(c1), y = screenY(r1);
      return { x, y, w: lay.colPos[c2 + 1] - lay.colPos[c1], h: lay.rowPos[r2 + 1] - lay.rowPos[r1] };
    }

    /* ---------------- display ---------------- */
    let dispCache = new Map();
    function recalc() {
      recalcCount++;
      engine.invalidate();
      dispCache = new Map();
      hiddenRowsCache = null;
      cfCache = new Map();
      autoHeights = null;
      invalidateLayout();
    }
    function numFmtOf(r, c, raw) {
      const st = getStyle(r, c);
      if (st && st.numFmt) return st.numFmt;
      return raw && raw[0] === '=' ? impliedFormat(raw) : '';
    }
    /* { text, kind, color } for what the cell shows. */
    function display(r, c) {
      const key = r + ',' + c;
      let d = dispCache.get(key);
      if (d) return d;
      const raw = getRaw(r, c);
      if (raw === '') { d = { text: '', kind: 'blank', value: null }; dispCache.set(key, d); return d; }
      if (showFormulas && raw[0] === '=') { d = { text: raw, kind: 'text', value: raw }; dispCache.set(key, d); return d; }
      let v;
      try { v = engine.val(model.active, r, c); } catch { v = ERR.ERROR; }
      const code = numFmtOf(r, c, raw);
      const isFormula = raw[0] === '=';
      let text, color;
      if (!isFormula && !code) {
        // A literal in General shows exactly what was typed ("$5", "15%", "1,234").
        text = raw[0] === "'" ? raw.slice(1) : raw;
      } else {
        const f = formatValue(v, code);
        text = f.text; color = f.color;
      }
      const kind = v == null ? 'blank' : isErr(v) ? 'err' : typeof v === 'number' ? 'num' : typeof v === 'boolean' ? 'bool' : 'text';
      d = { text, kind, color, value: v };
      dispCache.set(key, d);
      return d;
    }
    const displayText = (r, c) => display(r, c).text;

    /* Text measurement for autofit, overflow and ####. */
    const measureCanvas = document.createElement('canvas').getContext('2d');
    const measureCache = new Map();
    function measureText(text, font) {
      const key = font + '|' + text;
      let w = measureCache.get(key);
      if (w == null) {
        measureCanvas.font = font;
        w = measureCanvas.measureText(text).width;
        if (measureCache.size > 5000) measureCache.clear();
        measureCache.set(key, w);
      }
      return w;
    }
    function familyCss(st) {
      if (!st || !st.font) return 'var(--sheet-font, var(--font-ui))';
      const face = FONTS.inferFace(st);
      return FONTS.fontFamilyCss(st.font, face, FONTS.getFacesForFamily(st.font, fontFacesByFamily));
    }
    function cellFontCss(st, z) {
      const face = FONTS.parseFontFaceStyle(FONTS.inferFace(st || {}));
      const size = ((st && st.size) || 11) * PT_PX * (z == null ? zoom : z);
      const fam = st && st.font ? `"${st.font}", sans-serif` : 'system-ui, sans-serif';
      return `${face.fontStyle === 'italic' ? 'italic ' : ''}${face.weight} ${size}px ${fam}`;
    }

    /* ---------------- conditional formats ---------------- */
    let cfCache = new Map();
    function cfScale(rule, idx) {
      const key = 'scale' + idx;
      let s = cfCache.get(key);
      if (s) return s;
      let min = Infinity, max = -Infinity;
      const rg = rule.range;
      const u = engine.usedBounds(model.active);
      for (let r = rg.r1; r <= Math.min(rg.r2, u.r); r++) {
        for (let c = rg.c1; c <= Math.min(rg.c2, u.c); c++) {
          const v = display(r, c).value;
          if (typeof v === 'number') { if (v < min) min = v; if (v > max) max = v; }
        }
      }
      s = { min, max };
      cfCache.set(key, s);
      return s;
    }
    function mixHex(a, b, t) {
      const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
      const ch = (p, sh) => (p >> sh) & 255;
      const m = (sh) => Math.round(ch(pa, sh) + (ch(pb, sh) - ch(pa, sh)) * t);
      return '#' + [16, 8, 0].map((sh) => m(sh).toString(16).padStart(2, '0')).join('');
    }
    function cfStyleFor(r, c) {
      const rules = sheet().condFormats;
      if (!rules.length) return null;
      let out = null;
      for (let i = 0; i < rules.length; i++) {
        const rule = rules[i];
        if (!inRange(rule.range, r, c)) continue;
        const v = display(r, c).value;
        if (rule.type === 'scale') {
          if (typeof v !== 'number') continue;
          const { min, max } = cfScale(rule, i);
          const t = max > min ? (v - min) / (max - min) : 0.5;
          const lo = rule.minColor || '#f8696b', hi = rule.maxColor || '#63be7b', mid = rule.midColor;
          const fill = mid ? (t < 0.5 ? mixHex(lo, mid, t * 2) : mixHex(mid, hi, (t - 0.5) * 2)) : mixHex(lo, hi, t);
          out = { ...(out || {}), fill, color: '#1d1d1f' };
          continue;
        }
        if (cfMatches(rule, v)) out = { ...(out || {}), ...(rule.style || {}) };
      }
      return out;
    }
    function cfMatches(rule, v) {
      const n1 = parseNumberText(String(rule.v1 == null ? '' : rule.v1));
      const n2 = parseNumberText(String(rule.v2 == null ? '' : rule.v2));
      switch (rule.type) {
        case 'gt': return typeof v === 'number' && n1 != null && v > n1;
        case 'lt': return typeof v === 'number' && n1 != null && v < n1;
        case 'gte': return typeof v === 'number' && n1 != null && v >= n1;
        case 'lte': return typeof v === 'number' && n1 != null && v <= n1;
        case 'between': return typeof v === 'number' && n1 != null && n2 != null && v >= Math.min(n1, n2) && v <= Math.max(n1, n2);
        case 'eq': return v != null && compareValues(v, n1 != null ? n1 : String(rule.v1 || '')) === 0;
        case 'neq': return v != null && compareValues(v, n1 != null ? n1 : String(rule.v1 || '')) !== 0;
        case 'contains': return v != null && String(toText(v)).toLowerCase().includes(String(rule.v1 || '').toLowerCase());
        case 'blank': return v == null || v === '';
        case 'notblank': return v != null && v !== '';
        default: return false;
      }
    }

    /* ---------------- rendering ---------------- */
    function scheduleRender() {
      if (rafId || destroyed) return;
      rafId = requestAnimationFrame(() => { rafId = 0; renderNow(); });
    }

    const BORDER_W = { thin: 1, medium: 2, thick: 3, dashed: 1, dotted: 1, double: 3, hair: 1 };
    function borderShadows(b, color) {
      if (!b) return '';
      const col = color || 'var(--sheet-border-ink)';
      const parts = [];
      if (b.t) parts.push(`inset 0 ${BORDER_W[b.t] || 1}px 0 0 ${col}`);
      if (b.b) parts.push(`inset 0 -${BORDER_W[b.b] || 1}px 0 0 ${col}`);
      if (b.l) parts.push(`inset ${BORDER_W[b.l] || 1}px 0 0 0 ${col}`);
      if (b.r) parts.push(`inset -${BORDER_W[b.r] || 1}px 0 0 0 ${col}`);
      return parts.length ? `box-shadow:${parts.join(',')};` : '';
    }

    function cellHtml(r, c, x, y, w, h, nextCols) {
      const st = getStyle(r, c);
      const cf = cfStyleFor(r, c);
      const d = display(r, c);
      let css = `left:${x}px;top:${y}px;width:${w}px;height:${h}px;`;
      let cls = 'sc';
      const align = (st && st.align) || (d.kind === 'num' ? 'right' : (d.kind === 'bool' || d.kind === 'err') ? 'center' : 'left');
      if (align !== 'left') cls += ' a-' + (align === 'justify' ? 'left' : align === 'fill' ? 'left' : align);
      const va = (st && st.valign) || 'bottom';
      if (va !== 'bottom') cls += ' v-' + (va === 'center' ? 'middle' : va);
      if (d.kind === 'err') cls += ' err';
      const fill = (cf && cf.fill) || (st && st.fill);
      if (fill) css += `background:${fill};border-color:${fill};`;
      let color = (cf && cf.color) || d.color || (st && st.color);
      // A filled cell with automatic ink gets whichever ink reads on that fill,
      // so a pale header band stays legible in a dark theme.
      if (!color && fill && PICKER && PICKER.contrastInk) color = PICKER.contrastInk(fill);
      if (color) css += `color:${color};`;
      if (st) {
        if (st.font) css += `font-family:${familyCss(st).replace(/"/g, "'")};`;
        if (st.size) css += `font-size:${(st.size * PT_PX * zoom).toFixed(2)}px;`;
        const face = FONTS.parseFontFaceStyle(FONTS.inferFace(st));
        if (face.weight !== 400) css += `font-weight:${face.weight};`;
        if (face.fontStyle === 'italic') css += 'font-style:italic;';
        const deco = [st.underline ? 'underline' : '', st.strike ? 'line-through' : ''].filter(Boolean).join(' ');
        if (deco) css += `text-decoration:${deco};`;
        if (st.indent) css += `padding-left:${4 + st.indent * 10}px;`;
        css += borderShadows(st.borders, st.borderColor);
      }
      if (cf && cf.bold) css += 'font-weight:700;';
      if (cf && cf.italic) css += 'font-style:italic;';
      let text = d.text;
      const wrap = !!(st && st.wrap);
      if (wrap) cls += ' wrap';
      else if (text) {
        const font = cellFontCss(st);
        const tw = measureText(text, font);
        if (d.kind === 'num' && tw > w - 7 && !showFormulas) {
          const hw = measureText('#', font) || 7;
          text = '#'.repeat(Math.max(1, Math.floor((w - 7) / hw)));
        } else if (tw > w - 7 && align === 'left' && nextCols) {
          // Text runs on over empty neighbours, as it does in Excel.
          let extra = 0;
          for (const nc of nextCols) {
            if (tw <= w + extra - 7) break;
            if (getRaw(r, nc) !== '' || mergeAt(r, nc)) break;
            extra += ensureLayout().colPos[nc + 1] - ensureLayout().colPos[nc];
          }
          if (extra) {
            css = css.replace(`width:${w}px;`, `width:${w + extra}px;`);
            cls += ' ovf';
          }
        }
      }
      return `<div class="${cls}" style="${css}"><span>${escapeHtml(text)}</span></div>`;
    }

    function quadCells(rows, cols, ox, oy) {
      const lay = ensureLayout();
      const out = [];
      const drawnMerges = new Set();
      const colIdx = new Map(cols.map((c, i) => [c, i]));
      for (const r of rows) {
        const h = lay.rowPos[r + 1] - lay.rowPos[r];
        if (h <= 0) continue;
        const y = lay.rowPos[r] - oy;
        for (const c of cols) {
          const m = mergeAt(r, c);
          if (m) {
            if (drawnMerges.has(m)) continue;
            drawnMerges.add(m);
            const mx = lay.colPos[m.c1] - ox, my = lay.rowPos[m.r1] - oy;
            out.push(cellHtml(m.r1, m.c1, mx, my, lay.colPos[m.c2 + 1] - lay.colPos[m.c1], lay.rowPos[m.r2 + 1] - lay.rowPos[m.r1], null).replace('class="sc', 'class="sc merged'));
            continue;
          }
          const w = lay.colPos[c + 1] - lay.colPos[c];
          const i = colIdx.get(c);
          out.push(cellHtml(r, c, lay.colPos[c] - ox, y, w, h, cols.slice(i + 1, i + 12)));
        }
      }
      return out.join('');
    }

    function rectLocal(rg, ox, oy) {
      const lay = ensureLayout();
      const x = lay.colPos[rg.c1] - ox, y = lay.rowPos[rg.r1] - oy;
      return { x, y, w: lay.colPos[Math.min(rg.c2 + 1, lay.nCols)] - lay.colPos[rg.c1], h: lay.rowPos[Math.min(rg.r2 + 1, lay.nRows)] - lay.rowPos[rg.r1] };
    }

    function quadOverlay(q, ox, oy, isFrozenR, isFrozenC) {
      const out = [];
      const rg = selRange();
      const lay = ensureLayout();
      // formula reference highlights while typing
      if (editing && editing.text && editing.text[0] === '=') {
        formulaRefs(editing.text).forEach((ref, i) => {
          if (ref.sheet && engine.sheetIndex(ref.sheet, model.active) !== model.active) return;
          const rr = rectLocal({ r1: ref.r1, c1: ref.c1, r2: Math.min(ref.r2, lay.nRows - 1), c2: Math.min(ref.c2, lay.nCols - 1) }, ox, oy);
          const col = REF_COLORS[i % REF_COLORS.length];
          out.push(`<div class="sov-ref" style="left:${rr.x}px;top:${rr.y}px;width:${rr.w}px;height:${rr.h}px;border-color:${col};background:${col}14"></div>`);
        });
      }
      if (clip && clip.cut !== undefined && clip.sheet === model.active && marching) {
        const cr = rectLocal(clip.range, ox, oy);
        out.push(`<div class="sov-clip" style="left:${cr.x}px;top:${cr.y}px;width:${cr.w}px;height:${cr.h}px"></div>`);
      }
      findHits.forEach((h, i) => {
        if (h.s !== model.active) return;
        const hr = rectLocal({ r1: h.r, c1: h.c, r2: h.r, c2: h.c }, ox, oy);
        out.push(`<div class="sov-find${i === findIdx ? ' cur' : ''}" style="left:${hr.x}px;top:${hr.y}px;width:${hr.w}px;height:${hr.h}px"></div>`);
      });
      const sr = rectLocal(rg, ox, oy);
      const single = isSingleCell(rg);
      const ar = rectLocal(expandForMerges({ r1: sel.r, c1: sel.c, r2: sel.r, c2: sel.c }), ox, oy);
      if (!single) {
        // the range is tinted everywhere but the active cell, which stays clear
        const band = (x, y, w, h) => { if (w > 0 && h > 0) out.push(`<div class="sov-fill" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px"></div>`); };
        band(sr.x, sr.y, sr.w, ar.y - sr.y);
        band(sr.x, ar.y + ar.h, sr.w, sr.y + sr.h - ar.y - ar.h);
        band(sr.x, ar.y, ar.x - sr.x, ar.h);
        band(ar.x + ar.w, ar.y, sr.x + sr.w - ar.x - ar.w, ar.h);
        out.push(`<div class="sov-active" style="left:${ar.x}px;top:${ar.y}px;width:${ar.w}px;height:${ar.h}px"></div>`);
      }
      out.push(`<div class="sov-border${painter ? ' painter' : ''}" style="left:${sr.x - 1}px;top:${sr.y - 1}px;width:${sr.w + 1}px;height:${sr.h + 1}px"></div>`);
      if (fillDrag && fillDrag.target) {
        const fr2 = rectLocal(fillDrag.target, ox, oy);
        out.push(`<div class="sov-filltarget" style="left:${fr2.x - 1}px;top:${fr2.y - 1}px;width:${fr2.w + 1}px;height:${fr2.h + 1}px"></div>`);
      }
      const { fr, fc } = frozen();
      const inR = isFrozenR ? rg.r2 < fr : rg.r2 >= fr;
      const inC = isFrozenC ? rg.c2 < fc : rg.c2 >= fc;
      if (inR && inC && !editing) {
        out.push(`<div class="sov-handle" data-handle="1" style="left:${sr.x + sr.w - 4}px;top:${sr.y + sr.h - 4}px"></div>`);
      }
      // filter buttons on the header row
      const f = sheet().filter;
      if (f) {
        for (let c = f.c1; c <= f.c2; c++) {
          const cr = rectLocal({ r1: f.r, c1: c, r2: f.r, c2: c }, ox, oy);
          const on = f.hidden[c] && f.hidden[c].length;
          out.push(`<button type="button" class="sheet-fbtn${on ? ' on' : ''}" data-fcol="${c}" title="Filter column ${colName(c)}" style="left:${cr.x + cr.w - 20}px;top:${cr.y + Math.max(1, (cr.h - 18) / 2)}px">${ICON(on ? 'filter' : 'chevronDown')}</button>`);
        }
      }
      // list validation arrow on the active cell
      const v = validationAt(sel.r, sel.c);
      if (v && v.type === 'list' && !editing) {
        out.push(`<button type="button" class="sheet-vbtn" title="Choose from list (Alt+↓)" style="left:${ar.x + ar.w + 2}px;top:${ar.y + Math.max(0, (ar.h - 18) / 2)}px">${ICON('chevronDown')}</button>`);
      }
      return out.join('');
    }

    function visibleSpan(pos, n, from, to) {
      // indices whose [pos[i], pos[i+1]) intersects [from, to)
      const a = bsearch(pos, n, from);
      const b = bsearch(pos, n, to);
      const out = [];
      for (let i = a; i <= Math.min(b, n - 1); i++) out.push(i);
      return out;
    }

    function renderNow() {
      if (!gridScroll || destroyed || !model) return;
      const lay = ensureLayout();
      const vw = gridScroll.clientWidth, vh = gridScroll.clientHeight;
      if (!vw || !vh) return;
      const hw = HW(), hh = HH();
      viewport.style.width = vw + 'px';
      viewport.style.height = vh + 'px';
      viewport.style.setProperty('--sheet-fs', (11 * PT_PX * zoom).toFixed(2) + 'px');
      viewport.style.setProperty('--sheet-hfs', (11 * Math.max(0.85, zoom)).toFixed(2) + 'px');
      viewport.classList.toggle('no-grid', !!sheet().hideGrid);
      sizer.style.width = (hw + lay.colPos[lay.nCols]) + 'px';
      sizer.style.height = (hh + lay.rowPos[lay.nRows]) + 'px';
      const sx = gridScroll.scrollLeft, sy = gridScroll.scrollTop;
      const { fr, fc } = frozen();
      const fw = lay.colPos[fc], fh = lay.rowPos[fr];
      const mainW = Math.max(0, vw - hw - fw), mainH = Math.max(0, vh - hh - fh);
      const frozenCols = [], frozenRows = [];
      for (let c = 0; c < fc; c++) frozenCols.push(c);
      for (let r = 0; r < fr; r++) frozenRows.push(r);
      const scrollCols = visibleSpan(lay.colPos, lay.nCols, lay.colPos[fc] + sx, lay.colPos[fc] + sx + mainW).filter((c) => c >= fc);
      const scrollRows = visibleSpan(lay.rowPos, lay.nRows, lay.rowPos[fr] + sy, lay.rowPos[fr] + sy + mainH).filter((r) => r >= fr);

      const place = (el, l, t, w, h) => {
        el.style.left = l + 'px'; el.style.top = t + 'px';
        el.style.width = Math.max(0, w) + 'px'; el.style.height = Math.max(0, h) + 'px';
        el.hidden = w <= 0 || h <= 0;
      };
      place(quads.corner, hw, hh, fw, fh);
      place(quads.top, hw + fw, hh, mainW, fh);
      place(quads.left, hw, hh + fh, fw, mainH);
      place(quads.main, hw + fw, hh + fh, mainW, mainH);

      // Quadrant-local origins: frozen parts start at 0, scrolled parts are
      // shifted by the scroll offset past the frozen block.
      const oxMain = lay.colPos[fc] + sx, oyMain = lay.rowPos[fr] + sy;
      if (fr && fc) quads.corner.innerHTML = quadCells(frozenRows, frozenCols, 0, 0) + quadOverlay('corner', 0, 0, true, true);
      else quads.corner.innerHTML = '';
      quads.top.innerHTML = fr ? quadCells(frozenRows, scrollCols, oxMain, 0) + quadOverlay('top', oxMain, 0, true, false) : '';
      quads.left.innerHTML = fc ? quadCells(scrollRows, frozenCols, 0, oyMain) + quadOverlay('left', 0, oyMain, false, true) : '';
      quads.main.innerHTML = quadCells(scrollRows, scrollCols, oxMain, oyMain) + quadOverlay('main', oxMain, oyMain, false, false);

      // headers
      const rg = selRange();
      const fullCols = rg.r1 === 0 && rg.r2 >= lay.nRows - 1;
      const fullRows = rg.c1 === 0 && rg.c2 >= lay.nCols - 1;
      const colHdr = (cols, ox) => cols.map((c) => {
        const x = lay.colPos[c] - ox, w = lay.colPos[c + 1] - lay.colPos[c];
        const on = c >= rg.c1 && c <= rg.c2;
        return `<div class="shc${on ? (fullCols ? ' full' : ' hl') : ''}" style="left:${x}px;width:${w}px">${colName(c)}</div>`;
      }).join('');
      const rowHdr = (rows, oy) => rows.map((r) => {
        const y = lay.rowPos[r] - oy, h = lay.rowPos[r + 1] - lay.rowPos[r];
        if (h <= 0) return '';
        const on = r >= rg.r1 && r <= rg.r2;
        return `<div class="shr${on ? (fullRows ? ' full' : ' hl') : ''}${hiddenRows().has(r + 1) || hiddenRows().has(r - 1) ? ' near-hidden' : ''}" style="top:${y}px;height:${h}px">${r + 1}</div>`;
      }).join('');
      place(hdrs.corner, 0, 0, hw, hh);
      place(hdrs.colF, hw, 0, fw, hh);
      place(hdrs.colS, hw + fw, 0, mainW, hh);
      place(hdrs.rowF, 0, hh, hw, fh);
      place(hdrs.rowS, 0, hh + fh, hw, mainH);
      hdrs.colF.innerHTML = fc ? colHdr(frozenCols, 0) : '';
      hdrs.colS.innerHTML = colHdr(scrollCols, oxMain);
      hdrs.rowF.innerHTML = fr ? rowHdr(frozenRows, 0) : '';
      hdrs.rowS.innerHTML = rowHdr(scrollRows, oyMain);
      viewport.classList.toggle('has-freeze-r', fr > 0);
      viewport.classList.toggle('has-freeze-c', fc > 0);
      viewport.style.setProperty('--sheet-fw', (hw + fw) + 'px');
      viewport.style.setProperty('--sheet-fh', (hh + fh) + 'px');
      viewport.style.setProperty('--sheet-hw', hw + 'px');
      viewport.style.setProperty('--sheet-hh', hh + 'px');

      positionEditor();
      positionCharts();
    }

    /* ---------------- history & mutation ---------------- */
    function captureSheet() {
      return {
        sheets: model.sheets,
        active: model.active,
        sel: { r: sel.r, c: sel.c },
        selEnd: selEnd ? { r: selEnd.r, c: selEnd.c } : null
      };
    }
    function restoreSheet(snap) {
      if (!snap) return;
      skipHistory = true;
      model.sheets = snap.sheets.map((s, i) => normalizeSheet(s, i));
      model.active = Math.min(snap.active || 0, model.sheets.length - 1);
      sel = snap.sel ? { r: snap.sel.r, c: snap.sel.c } : { r: 0, c: 0 };
      selEnd = snap.selEnd ? { r: snap.selEnd.r, c: snap.selEnd.c } : null;
      sheetChanged();
      skipHistory = false;
      ctx.markDirty();
      focusGrid();
    }
    function recordSheet() {
      if (skipHistory || history.isApplying() || !model) return;
      history.record(captureSheet());
    }
    /* Every change to the workbook goes through here: one recalculation, one
       repaint and one undo step however many cells it touched. */
    let bulkDepth = 0;
    function mutate(fn, opts) {
      bulkDepth++;
      let result;
      try { result = fn(); } finally { bulkDepth--; }
      if (bulkDepth) return result;
      if (result === false) return result;
      mergeIndex = null;
      recalc();
      ctx.markDirty();
      if (!(opts && opts.noHistory)) recordSheet();
      renderNow();
      renderCharts();
      updateChrome();
      return result;
    }
    function sheetChanged() {
      mergeIndex = null;
      recalc();
      clip = null; marching = false;
      findHits = [];
      renderTabs();
      if (gridScroll) {
        renderNow();
        renderCharts();
        updateChrome();
      }
    }

    /* Upper-cases function names and references and closes any parentheses
       left open, the way a spreadsheet tidies a formula on entry. */
    function canonicalFormula(text) {
      if (text[0] !== '=') return text;
      let toks;
      let body = text.slice(1);
      let depth = 0, q = false;
      for (const ch of body) { if (ch === '"') q = !q; else if (!q && ch === '(') depth++; else if (!q && ch === ')') depth--; }
      if (depth > 0 && !q) body += ')'.repeat(depth);
      try { toks = tokenize(body); } catch { return '=' + body; }
      let out = '', last = 0;
      toks.forEach((t, i) => {
        const next = toks[i + 1];
        let rep = null;
        if (t.t === 'name' && next && next.t === 'op' && next.v === '(') rep = body.slice(t.s, t.e).toUpperCase();
        else if (t.t === 'name' && /^(true|false)$/i.test(t.v)) rep = t.v.toUpperCase();
        else if (t.t === 'ref' || t.t === 'cols') {
          const seg = body.slice(t.s, t.e);
          const bang = seg.lastIndexOf('!');
          rep = bang >= 0 ? seg.slice(0, bang + 1) + seg.slice(bang + 1).toUpperCase() : seg.toUpperCase();
        }
        if (rep != null) { out += body.slice(last, t.s) + rep; last = t.e; }
      });
      return '=' + out + body.slice(last);
    }
    function normalizeEntry(value) {
      let v = value == null ? '' : String(value);
      if (v[0] === '=' && v.length > 1) return canonicalFormula(v.trim());
      if (v.trim() === '') return '';
      return v.replace(/^\s+|\s+$/g, '');
    }
    function setCellValue(r, c, value, opts) {
      const m = mergeAt(r, c);
      if (m) { r = m.r1; c = m.c1; }
      const v = normalizeEntry(value);
      if (getRaw(r, c) === v) return false;
      putRaw(sheet(), r, c, v);
      return true;
    }

    /* ---------------- selection ---------------- */
    function growFor(r, c) {
      const lay = ensureLayout();
      let grew = false;
      if (r >= lay.nRows - 10) { minRows = Math.min(MAX_ROWS, r + 200); grew = true; }
      if (c >= lay.nCols - 4) { minCols = Math.min(MAX_COLS, c + 20); grew = true; }
      if (grew) invalidateLayout();
    }
    function clampCell(r, c) {
      return { r: Math.max(0, Math.min(MAX_ROWS - 1, r)), c: Math.max(0, Math.min(MAX_COLS - 1, c)) };
    }
    function select(r, c, scroll = true) {
      if (editing && !editing.pointing && !commitEdit({ move: false, keepFocus: true })) return;
      ({ r, c } = clampCell(r, c));
      const m = mergeAt(r, c);
      if (m) { r = m.r1; c = m.c1; }
      sel = { r, c };
      selEnd = null;
      fixedRange = null;
      growFor(r, c);
      if (scroll) scrollIntoView(r, c);
      afterSelection();
    }
    /* Enter and Tab walk the active cell through a selected block without
       losing the block, wrapping at its edges. */
    function moveWithinSelection(dr, dc) {
      const rg = selRange();
      let { r, c } = sel;
      if (dr) {
        r += dr;
        if (r > rg.r2) { r = rg.r1; c = c + 1 > rg.c2 ? rg.c1 : c + 1; }
        if (r < rg.r1) { r = rg.r2; c = c - 1 < rg.c1 ? rg.c2 : c - 1; }
      } else {
        c += dc;
        if (c > rg.c2) { c = rg.c1; r = r + 1 > rg.r2 ? rg.r1 : r + 1; }
        if (c < rg.c1) { c = rg.c2; r = r - 1 < rg.r1 ? rg.r2 : r - 1; }
      }
      const m = mergeAt(r, c);
      fixedRange = { r1: rg.r1, c1: rg.c1, r2: rg.r2, c2: rg.c2 };
      sel = m ? { r: m.r1, c: m.c1 } : { r, c };
      scrollIntoView(sel.r, sel.c);
      afterSelection();
    }
    function selectRange(r1, c1, r2, c2, scroll) {
      if (editing && !editing.pointing && !commitEdit({ move: false, keepFocus: true })) return;
      const a = clampCell(r1, c1), b = clampCell(r2, c2);
      sel = a;
      selEnd = (a.r === b.r && a.c === b.c) ? null : b;
      fixedRange = null;
      growFor(Math.max(a.r, b.r), Math.max(a.c, b.c));
      if (scroll) scrollIntoView(b.r, b.c);
      afterSelection();
    }
    function afterSelection() {
      renderNow();
      updateChrome();
    }
    function scrollIntoView(r, c) {
      if (!gridScroll) return;
      const lay = ensureLayout();
      const { fr, fc } = frozen();
      const vw = gridScroll.clientWidth - HW() - lay.colPos[fc];
      const vh = gridScroll.clientHeight - HH() - lay.rowPos[fr];
      if (r >= fr) {
        const top = lay.rowPos[r] - lay.rowPos[fr], bottom = lay.rowPos[r + 1] - lay.rowPos[fr];
        if (top < gridScroll.scrollTop) gridScroll.scrollTop = top;
        else if (bottom > gridScroll.scrollTop + vh) gridScroll.scrollTop = bottom - vh;
      }
      if (c >= fc) {
        const left = lay.colPos[c] - lay.colPos[fc], right = lay.colPos[c + 1] - lay.colPos[fc];
        if (left < gridScroll.scrollLeft) gridScroll.scrollLeft = left;
        else if (right > gridScroll.scrollLeft + vw) gridScroll.scrollLeft = Math.min(left, right - vw);
      }
    }
    function focusGrid() { if (gridScroll && !destroyed) gridScroll.focus({ preventScroll: true }); }

    /* Where a keyboard move lands, stepping over merged blocks. */
    function stepFrom(r, c, dr, dc) {
      const m = mergeAt(r, c);
      if (m) {
        if (dr > 0) r = m.r2; if (dr < 0) r = m.r1;
        if (dc > 0) c = m.c2; if (dc < 0) c = m.c1;
      }
      r += dr; c += dc;
      const hidden = hiddenRows();
      while (dr && hidden.has(r) && r > 0) r += dr;
      return clampCell(r, c);
    }
    /* Ctrl+arrow: the edge of the current block of data, or the next one. */
    function jumpFrom(r, c, dr, dc) {
      const filled = (rr, cc) => getRaw(rr, cc) !== '';
      const u = engine.usedBounds(model.active);
      const limR = Math.max(u.r + 1, ensureLayout().nRows - 1), limC = Math.max(u.c + 1, ensureLayout().nCols - 1);
      const inside = (rr, cc) => rr >= 0 && cc >= 0 && rr <= limR && cc <= limC;
      let nr = r + dr, nc = c + dc;
      if (!inside(nr, nc)) return { r, c };
      if (filled(r, c) && filled(nr, nc)) {
        while (inside(nr + dr, nc + dc) && filled(nr + dr, nc + dc)) { nr += dr; nc += dc; }
        return { r: nr, c: nc };
      }
      while (inside(nr, nc) && !filled(nr, nc)) {
        if (!inside(nr + dr, nc + dc)) return { r: nr, c: nc };
        nr += dr; nc += dc;
      }
      return { r: nr, c: nc };
    }

    /* ---------------- chrome: name box, formula bar, status ---------------- */
    function rangeLabel(rg) {
      if (isSingleCell(rg)) return cellName(sel.r, sel.c);
      const lay = ensureLayout();
      if (rg.r1 === 0 && rg.r2 >= lay.nRows - 1) return colName(rg.c1) + ':' + colName(rg.c2);
      if (rg.c1 === 0 && rg.c2 >= lay.nCols - 1) return (rg.r1 + 1) + ':' + (rg.r2 + 1);
      return rangeName(rg);
    }
    function statusText() {
      const rg = selRange();
      if (isSingleCell(rg)) return '';
      const u = engine.usedBounds(model.active);
      let sum = 0, nums = 0, count = 0, min = Infinity, max = -Infinity;
      const hidden = hiddenRows();
      for (let r = rg.r1; r <= Math.min(rg.r2, u.r); r++) {
        if (hidden.has(r)) continue;
        for (let c = rg.c1; c <= Math.min(rg.c2, u.c); c++) {
          if (getRaw(r, c) === '') continue;
          count++;
          const v = display(r, c).value;
          if (typeof v === 'number') { nums++; sum += v; if (v < min) min = v; if (v > max) max = v; }
        }
      }
      if (!count) return '';
      const f = (n) => formatGeneral(Number(n.toPrecision(12)));
      if (!nums) return `Count: ${count}`;
      return `Sum: ${f(sum)} · Average: ${f(sum / nums)} · Count: ${count}`;
    }
    function updateChrome() {
      if (!nameBox || destroyed) return;
      const rg = selRange();
      if (document.activeElement !== nameBox) nameBox.textContent = rangeLabel(rg);
      if (!editing && document.activeElement !== formulaInput) formulaInput.value = getRaw(sel.r, sel.c);
      const status = statusText();
      ctx.setStatus(rangeLabel(rg));
      syncRibbon();
      if (typeof ctx.onStatus === 'function') { try { ctx.onStatus(status); } catch {} }
    }

    /* ---------------- in-cell editing ---------------- */
    let editing = null;   // { r, c, text, source, mode, point }
    function beginEdit(text, opts) {
      const o = opts || {};
      if (editing) return;
      const m = mergeAt(sel.r, sel.c);
      const r = m ? m.r1 : sel.r, c = m ? m.c1 : sel.c;
      const initial = text == null ? getRaw(r, c) : text;
      editing = { r, c, text: initial, source: o.source || 'cell', mode: o.mode || (text == null ? 'edit' : 'enter'), point: null, original: getRaw(r, c) };
      editorEl.value = initial;
      formulaInput.value = initial;
      editorEl.hidden = false;
      applyEditorStyle();
      positionEditor();
      renderNow();
      if (editing.source === 'cell') {
        editorEl.focus({ preventScroll: true });
        const end = editorEl.value.length;
        editorEl.setSelectionRange(end, end);
      }
      updateAutocomplete();
    }
    function applyEditorStyle() {
      if (!editing) return;
      const st = getStyle(editing.r, editing.c) || {};
      const face = FONTS.parseFontFaceStyle(FONTS.inferFace(st));
      editorEl.style.fontFamily = st.font ? familyCss(st) : '';
      editorEl.style.fontSize = ((st.size || 11) * PT_PX * zoom).toFixed(2) + 'px';
      editorEl.style.fontWeight = String(face.weight);
      editorEl.style.fontStyle = face.fontStyle;
      editorEl.style.textAlign = st.align === 'center' || st.align === 'right' ? st.align : 'left';
      editorEl.style.color = st.color || '';
      editorEl.style.background = st.fill || '';
    }
    function positionEditor() {
      if (!editorEl || !editing) { if (editorEl) editorEl.hidden = true; return; }
      const rc = cellRect(editing.r, editing.c);
      const vw = gridScroll.clientWidth, vh = gridScroll.clientHeight;
      editorEl.style.left = rc.x + 'px';
      editorEl.style.top = rc.y + 'px';
      editorEl.style.minWidth = rc.w + 'px';
      editorEl.style.minHeight = rc.h + 'px';
      editorEl.style.maxWidth = Math.max(rc.w, vw - rc.x - 4) + 'px';
      editorEl.style.maxHeight = Math.max(rc.h, vh - rc.y - 4) + 'px';
      // grow to fit the longest line, then wrap at the edge of the grid
      const st = getStyle(editing.r, editing.c);
      const font = cellFontCss(st);
      const longest = editorEl.value.split('\n').reduce((m, line) => Math.max(m, measureText(line, font)), 0);
      editorEl.style.width = Math.min(Math.max(rc.w, longest + 18), Math.max(rc.w, vw - rc.x - 4)) + 'px';
      editorEl.style.height = '0px';
      editorEl.style.height = Math.max(rc.h, editorEl.scrollHeight) + 'px';
    }
    function editInput() { return editing && editing.source === 'bar' ? formulaInput : editorEl; }
    function syncEditText(from) {
      if (!editing) return;
      editing.text = from.value;
      if (from !== editorEl) editorEl.value = from.value;
      if (from !== formulaInput) formulaInput.value = from.value;
      editing.point = null;
      editing.pointing = false;
      positionEditor();
      renderNow();
      updateAutocomplete();
    }

    function validationAt(r, c) {
      const vs = sheet().validations;
      for (let i = vs.length - 1; i >= 0; i--) if (inRange(vs[i].range, r, c)) return vs[i];
      return null;
    }
    function validationList(v) {
      if (!v) return [];
      if (Array.isArray(v.values) && v.values.length) return v.values.map(String);
      if (v.source) {
        const res = engine.evaluate(v.source[0] === '=' ? v.source : '=' + v.source, model.active, 0, 0);
        const ctxv = { val: engine.val, usedBounds: engine.usedBounds, sheet: model.active, r: 0, c: 0 };
        if (res instanceof Rng || res instanceof Arr) return flatValues(res, ctxv).filter((x) => x != null && x !== '').map((x) => toText(x));
        const rg = parseA1Range(String(v.source).replace(/^=/, ''));
        if (rg) {
          const out = [];
          for (let r = rg.r1; r <= rg.r2; r++) for (let c = rg.c1; c <= rg.c2; c++) { const t = displayText(r, c); if (t) out.push(t); }
          return out;
        }
      }
      return [];
    }
    function passesValidation(r, c, value) {
      const v = validationAt(r, c);
      if (!v || value === '' || value[0] === '=') return true;
      if (v.type === 'list') {
        const list = validationList(v).map((x) => x.toLowerCase());
        return list.includes(String(value).toLowerCase());
      }
      if (v.type === 'number') {
        const n = parseNumberText(value);
        if (n == null) return false;
        if (v.min != null && v.min !== '' && n < Number(v.min)) return false;
        if (v.max != null && v.max !== '' && n > Number(v.max)) return false;
        return true;
      }
      return true;
    }

    /* opts.move: [dr, dc] to step after committing; opts.fillSelection. */
    function commitEdit(opts) {
      if (!editing) return true;
      const o = opts || {};
      const ed = editing;
      const value = ed.text;
      closeAutocomplete();
      if (value !== ed.original && !passesValidation(ed.r, ed.c, value)) {
        const v = validationAt(ed.r, ed.c);
        if (v && v.strict !== false) {
          if (o.force) { cancelEdit(); return false; }
          ctx.toast(v.message || `"${value}" is not an allowed value for ${cellName(ed.r, ed.c)} — pick from the list or press Esc.`, 'error');
          (ed.source === 'bar' ? formulaInput : editorEl).focus();
          return false;
        }
      }
      editing = null;
      editorEl.hidden = true;
      if (o.fillSelection && !isSingleCell(selRange())) {
        const rg = selRange();
        mutate(() => {
          const v = normalizeEntry(value);
          for (let r = rg.r1; r <= rg.r2; r++) {
            for (let c = rg.c1; c <= rg.c2; c++) {
              if (mergeAt(r, c) && !(mergeAt(r, c).r1 === r && mergeAt(r, c).c1 === c)) continue;
              putRaw(sheet(), r, c, v[0] === '=' ? offsetFormula(v, r - ed.r, c - ed.c) : v);
            }
          }
        });
      } else if (value !== ed.original) {
        mutate(() => setCellValue(ed.r, ed.c, value));
      } else {
        renderNow();
      }
      formulaInput.value = getRaw(sel.r, sel.c);
      if (o.move && !isSingleCell(selRange()) && !o.fillSelection) {
        moveWithinSelection(o.move[0], o.move[1]);
      } else if (o.move) {
        const n = stepFrom(ed.r, ed.c, o.move[0], o.move[1]);
        select(n.r, n.c);
      } else updateChrome();
      if (!o.keepFocus) focusGrid();
      return true;
    }
    function cancelEdit() {
      if (!editing) return;
      editing = null;
      editorEl.hidden = true;
      closeAutocomplete();
      formulaInput.value = getRaw(sel.r, sel.c);
      renderNow();
      focusGrid();
    }

    /* Point mode: while a formula is being typed, clicking or arrowing
       onto cells writes their reference into it. */
    function pointable() {
      if (!editing || editing.text[0] !== '=') return false;
      const inp = editInput();
      const caret = inp.selectionStart;
      if (editing.point && caret === editing.point.end) return true;
      if (inp.selectionEnd !== caret) return false;
      const before = editing.text.slice(0, caret).replace(/\s+$/, '');
      return /[=(,+\-*/^&<>:;%]$/.test(before);
    }
    function insertPointRef(r1, c1, r2, c2) {
      const inp = editInput();
      const own = model.active;
      const pre = editing.point ? editing.point.start : inp.selectionStart;
      const endOld = editing.point ? editing.point.end : inp.selectionStart;
      let ref = (r1 === r2 && c1 === c2) ? cellName(r1, c1) : rangeName(normRange({ r: r1, c: c1 }, { r: r2, c: c2 }));
      if (editing.sheetIdx != null && editing.sheetIdx !== own) ref = quoteSheetName(model.sheets[own].name) + '!' + ref;
      const text = editing.text.slice(0, pre) + ref + editing.text.slice(endOld);
      inp.value = text;
      editing.text = text;
      if (inp !== editorEl) editorEl.value = text; else formulaInput.value = text;
      const end = pre + ref.length;
      inp.setSelectionRange(end, end);
      editing.point = { start: pre, end, r: r1, c: c1, r2, c2 };
      editing.pointing = true;
      positionEditor();
      renderNow();
    }

    /* ---------------- autocomplete & signature help ---------------- */
    let acItems = [], acIndex = 0, acToken = null, acNavigated = false;
    function tokenBeforeCaret() {
      const inp = editInput();
      if (!editing || editing.text[0] !== '=') return null;
      const caret = inp.selectionStart;
      const before = editing.text.slice(0, caret);
      const m = /([A-Za-z][A-Za-z0-9.]*)$/.exec(before);
      if (!m) return null;
      const prev = before.slice(0, before.length - m[1].length);
      if (!/(^=|[=(,+\-*/^&<>:;\s])$/.test(prev)) return null;
      if (/^[A-Za-z]{1,3}\d+$/.test(m[1])) return null;
      // inside a string literal?
      if (((prev.match(/"/g) || []).length % 2) === 1) return null;
      return { text: m[1], start: caret - m[1].length, end: caret };
    }
    function callContext() {
      if (!editing || editing.text[0] !== '=') return null;
      const inp = editInput();
      const before = editing.text.slice(0, inp.selectionStart);
      const stack = [];
      let q = false;
      for (let i = 0; i < before.length; i++) {
        const ch = before[i];
        if (ch === '"') { q = !q; continue; }
        if (q) continue;
        if (ch === '(') {
          const m = /([A-Za-z][A-Za-z0-9.]*)\s*$/.exec(before.slice(0, i));
          stack.push({ name: m ? m[1].toUpperCase() : null, arg: 0 });
        } else if (ch === ')') stack.pop();
        else if (ch === ',' && stack.length) stack[stack.length - 1].arg++;
      }
      for (let i = stack.length - 1; i >= 0; i--) if (stack[i].name) return stack[i];
      return null;
    }
    function popAnchorRect() {
      if (!editing) return null;
      if (editing.source === 'bar') return formulaInput.getBoundingClientRect();
      return editorEl.getBoundingClientRect();
    }
    function updateAutocomplete() {
      const tok = tokenBeforeCaret();
      if (!tok || !acToken || tok.start !== acToken.start) { acIndex = 0; acNavigated = false; }
      acToken = tok;
      if (tok && tok.text.length >= 1) {
        const u = tok.text.toUpperCase();
        const names = new Set(FX_CATALOG.map((f) => f.name).concat(Object.keys(FN)));
        const rank = (n) => { const i = POPULAR_FNS.indexOf(n); return i < 0 ? 100 : i; };
        acItems = [...names].filter((n) => n.startsWith(u) && n !== u).sort((a, b) => rank(a) - rank(b) || a.length - b.length || a.localeCompare(b)).slice(0, 8);
      } else acItems = [];
      if (acIndex >= acItems.length) acIndex = 0;
      const rect = popAnchorRect();
      if (acItems.length && rect) {
        acPop.innerHTML = acItems.map((n, i) => {
          const f = FX_BY_NAME.get(n);
          return `<div class="sheet-ac-item${i === acIndex ? ' on' : ''}" data-name="${n}"><span class="sheet-ac-name">${n}</span><span class="sheet-ac-desc">${escapeHtml(f ? f.desc : '')}</span></div>`;
        }).join('');
        acPop.hidden = false;
        placePop(acPop, rect);
      } else acPop.hidden = true;
      const call = !acItems.length && callContext();
      const f = call && FX_BY_NAME.get(call.name);
      if (f && rect) {
        const m = /^([^(]*)\((.*)\)$/.exec(f.syntax);
        const parts = m ? m[2].split(/,\s*/) : [];
        const idx = Math.min(call.arg, parts.length - 1);
        const isVariadic = parts.length && /…/.test(parts[parts.length - 1]);
        const hi = call.arg >= parts.length && isVariadic ? parts.length - 2 : idx;
        sigPop.innerHTML = `<span class="sheet-sig-fn">${escapeHtml(m ? m[1] : f.name)}(</span>` +
          parts.map((p, i) => `<span class="${i === hi ? 'on' : ''}">${escapeHtml(p)}</span>`).join(', ') + ')' +
          `<div class="sheet-sig-desc">${escapeHtml(f.desc)}</div>`;
        sigPop.hidden = false;
        placePop(sigPop, rect);
      } else sigPop.hidden = true;
    }
    function placePop(pop, rect) {
      const hostRect = wrapEl.getBoundingClientRect();
      pop.style.left = Math.max(4, rect.left - hostRect.left) + 'px';
      pop.style.top = (rect.bottom - hostRect.top + 4) + 'px';
    }
    function closeAutocomplete() {
      acItems = [];
      if (acPop) acPop.hidden = true;
      if (sigPop) sigPop.hidden = true;
    }
    function acceptAutocomplete(name) {
      const tok = acToken;
      const inp = editInput();
      if (!tok || !editing) return;
      const pick = name || acItems[acIndex];
      const text = editing.text.slice(0, tok.start) + pick + '(' + editing.text.slice(tok.end);
      inp.value = text;
      const caret = tok.start + pick.length + 1;
      inp.setSelectionRange(caret, caret);
      syncEditText(inp);
    }

    function editorKeydown(e, inp) {
      const isBar = inp === formulaInput;
      if ((e.ctrlKey || e.metaKey) && ['z', 'y'].includes(e.key.toLowerCase())) {
        e.stopPropagation(); // native text undo inside the editor
        return;
      }
      if (!acPop.hidden && acItems.length) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          acIndex = (acIndex + (e.key === 'ArrowDown' ? 1 : -1) + acItems.length) % acItems.length;
          acNavigated = true;
          updateAutocomplete();
          return;
        }
        if (e.key === 'Tab' || (e.key === 'Enter' && !e.altKey && acNavigated)) {
          e.preventDefault();
          acceptAutocomplete();
          return;
        }
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeAutocomplete(); return; }
      }
      if (e.key === 'Enter' && e.altKey) {
        e.preventDefault();
        const s = inp.selectionStart, t = inp.value;
        inp.value = t.slice(0, s) + '\n' + t.slice(inp.selectionEnd);
        inp.setSelectionRange(s + 1, s + 1);
        syncEditText(inp);
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        if (!editing) { beginEdit(inp.value, { source: 'bar' }); }
        commitEdit({ move: e.ctrlKey ? null : [e.shiftKey ? -1 : 1, 0], fillSelection: e.ctrlKey });
        return;
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        if (!editing) beginEdit(inp.value, { source: isBar ? 'bar' : 'cell' });
        commitEdit({ move: [0, e.shiftKey ? -1 : 1] });
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        cancelEdit();
        return;
      }
      if (e.key === 'F2' && editing) {
        e.preventDefault();
        editing.mode = editing.mode === 'enter' ? 'edit' : 'enter';
        return;
      }
      const arrows = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
      if (arrows[e.key] && editing && editing.mode === 'enter' && !isBar) {
        const d = arrows[e.key];
        if (pointable()) {
          e.preventDefault();
          const p = editing.point || { r: editing.r, c: editing.c };
          if (e.shiftKey && editing.point) {
            const n = clampCell((editing.point.r2 != null ? editing.point.r2 : p.r) + d[0], (editing.point.c2 != null ? editing.point.c2 : p.c) + d[1]);
            insertPointRef(editing.point.r, editing.point.c, n.r, n.c);
          } else {
            const n = clampCell(p.r + d[0], p.c + d[1]);
            insertPointRef(n.r, n.c, n.r, n.c);
          }
          scrollIntoView(editing.point.r2, editing.point.c2);
          renderNow();
          return;
        }
        e.preventDefault();
        commitEdit({ move: d });
        return;
      }
      if (e.key === 'ArrowDown' && e.altKey && editing) {
        const v = validationAt(editing.r, editing.c);
        if (v && v.type === 'list') { e.preventDefault(); openValidationList(); }
      }
    }

    /* ---------------- styles ---------------- */
    function cellStyle() { return getStyle(sel.r, sel.c) || {}; }
    function forEachSelected(fn, rg) {
      const r0 = rg || selRange();
      const lay = ensureLayout();
      const r2 = Math.min(r0.r2, Math.max(lay.nRows - 1, engine.usedBounds(model.active).r));
      const c2 = Math.min(r0.c2, Math.max(lay.nCols - 1, engine.usedBounds(model.active).c));
      for (let r = r0.r1; r <= r2; r++) for (let c = r0.c1; c <= c2; c++) fn(r, c);
    }
    function patchStyle(r, c, patch) {
      const sh = sheet();
      const key = styleKey(r, c);
      const next = { ...(sh.styles[key] || {}) };
      Object.entries(patch).forEach(([k, v]) => {
        if (v === undefined || v === null || v === '' || v === false) delete next[k];
        else next[k] = v;
      });
      if (Object.keys(next).length) sh.styles[key] = next;
      else delete sh.styles[key];
    }
    function applyStyle(patch) {
      mutate(() => forEachSelected((r, c) => patchStyle(r, c, patch)));
    }
    function toggleStyle(flag) {
      const on = !cellStyle()[flag];
      applyStyle({ [flag]: on });
    }
    function applyFontFace(family, styleLabel) {
      applyStyle(FONTS.stylePatchFromFace(family, styleLabel || 'Regular'));
    }
    function toggleFaceFlag(kind) {
      const st = cellStyle();
      const family = st.font || (fontSelect && fontSelect.value) || 'Calibri';
      const faces = FONTS.getFacesForFamily(family, fontFacesByFamily);
      const parsed = FONTS.parseFontFaceStyle(FONTS.inferFace(st));
      let weight = parsed.weight, italic = parsed.fontStyle === 'italic';
      if (kind === 'bold') weight = weight >= 700 ? 400 : 700;
      if (kind === 'italic') italic = !italic;
      const face = FONTS.matchFaceFromComputed(faces, weight, italic ? 'italic' : 'normal');
      const patch = FONTS.stylePatchFromFace(family, face);
      // A face the font does not have still has to show as bold/italic.
      patch.bold = weight >= 700;
      patch.italic = italic;
      if (!st.font) delete patch.font;
      if (patch.face === 'Regular' || !faces.some((f) => f.style === patch.face)) {
        patch.face = weight >= 700 && italic ? 'Bold Italic' : weight >= 700 ? 'Bold' : italic ? 'Italic' : 'Regular';
      }
      applyStyle(patch);
    }
    function stepFontSize(delta) {
      const sizes = FONTS.SIZES;
      const cur = cellStyle().size || 11;
      let i = sizes.findIndex((s) => s >= cur);
      if (i < 0) i = sizes.length - 1;
      if (sizes[i] !== cur && delta < 0) i += 1;
      i = Math.max(0, Math.min(sizes.length - 1, i + delta));
      applyStyle({ size: sizes[i] });
    }
    function setNumFmt(code) { applyStyle({ numFmt: code || null }); }
    function stepDecimals(delta) {
      const st = cellStyle();
      const v = display(sel.r, sel.c).value;
      const code = stepFormatDecimals(st.numFmt || '', delta, typeof v === 'number' ? v : 0);
      setNumFmt(code);
    }
    /* Borders across a range: "outer" draws only the edges of the block. */
    function applyBorders(kind) {
      const rg = selRange();
      mutate(() => forEachSelected((r, c) => {
        const cur = { ...((getStyle(r, c) || {}).borders || {}) };
        const w = kind === 'thick' ? 'medium' : 'thin';
        const edge = { t: r === rg.r1, b: r === rg.r2, l: c === rg.c1, r: c === rg.c2 };
        let next = cur;
        switch (kind) {
          case 'all': next = { t: w, r: w, b: w, l: w }; break;
          case 'outer': case 'thick':
            ['t', 'r', 'b', 'l'].forEach((k) => { if (edge[k]) next[k] = w; });
            break;
          case 'top': if (edge.t) next.t = w; break;
          case 'bottom': if (edge.b) next.b = w; break;
          case 'left': if (edge.l) next.l = w; break;
          case 'right': if (edge.r) next.r = w; break;
          case 'none': next = {}; break;
          default: break;
        }
        const keys = Object.keys(next).filter((k) => next[k]);
        patchStyle(r, c, { borders: keys.length ? next : null });
      }));
    }
    function clearFormats() {
      mutate(() => forEachSelected((r, c) => { delete sheet().styles[styleKey(r, c)]; }));
    }
    function clearContents() {
      mutate(() => {
        let changed = false;
        forEachSelected((r, c) => { if (getRaw(r, c) !== '') { putRaw(sheet(), r, c, ''); changed = true; } });
        return changed;
      });
    }

    /* Format painter: copy the active cell's look onto the next selection. */
    let painter = null;
    function startPainter() {
      const src = selRange();
      painter = { pending: true, style: { ...(getStyle(src.r1, src.c1) || {}) } };
      renderNow();
      ctx.toast('Select the cells to paint the format onto');
      setTimeout(() => { if (painter) painter.pending = false; }, 0);
    }
    function applyPainter() {
      const p = painter;
      painter = null;
      mutate(() => forEachSelected((r, c) => {
        const key = styleKey(r, c);
        if (Object.keys(p.style).length) sheet().styles[key] = { ...p.style };
        else delete sheet().styles[key];
      }));
    }

    /* ---------------- merge ---------------- */
    function toggleMerge() {
      const rg = selRange();
      const sh = sheet();
      const existing = sh.merges.filter((m) => rangesIntersect(m, rg));
      if (existing.length) {
        mutate(() => { sh.merges = sh.merges.filter((m) => !rangesIntersect(m, rg)); });
        return;
      }
      if (isSingleCell(rg)) { ctx.toast('Select more than one cell to merge'); return; }
      let lost = 0;
      for (let r = rg.r1; r <= rg.r2; r++) for (let c = rg.c1; c <= rg.c2; c++) if ((r !== rg.r1 || c !== rg.c1) && getRaw(r, c) !== '') lost++;
      mutate(() => {
        for (let r = rg.r1; r <= rg.r2; r++) for (let c = rg.c1; c <= rg.c2; c++) if (r !== rg.r1 || c !== rg.c1) putRaw(sh, r, c, '');
        sh.merges.push({ ...rg });
        patchStyle(rg.r1, rg.c1, { align: 'center', valign: (getStyle(rg.r1, rg.c1) || {}).valign || 'middle' });
      });
      sel = { r: rg.r1, c: rg.c1 }; selEnd = null;
      renderNow();
      updateChrome();
      if (lost) ctx.toast(`Merged — kept the top-left value, cleared ${lost} other cell${lost > 1 ? 's' : ''}`);
    }

    /* ---------------- structure: insert / delete rows & columns ---------------- */
    function shiftIndexMap(obj, at, count) {
      const out = {};
      Object.entries(obj || {}).forEach(([k, v]) => {
        const i = +k;
        if (count > 0) out[i >= at ? i + count : i] = v;
        else if (i < at) out[i] = v;
        else if (i >= at - count) out[i + count] = v;
      });
      return out;
    }
    function shiftRange(rg, axis, at, count) {
      const lo = axis === 'r' ? rg.r1 : rg.c1, hi = axis === 'r' ? rg.r2 : rg.c2;
      let nlo, nhi;
      if (count > 0) { nlo = lo >= at ? lo + count : lo; nhi = hi >= at ? hi + count : hi; }
      else {
        const del = -count;
        nlo = lo >= at + del ? lo - del : (lo >= at ? at : lo);
        nhi = hi >= at + del ? hi - del : (hi >= at ? at - 1 : hi);
        if (nhi < nlo) return null;
      }
      return axis === 'r' ? { ...rg, r1: nlo, r2: nhi } : { ...rg, c1: nlo, c2: nhi };
    }
    function structural(axis, at, count) {
      const sh = sheet();
      const name = sh.name;
      mutate(() => {
        if (axis === 'r') {
          if (count > 0) { if (at < sh.rows.length) sh.rows.splice(at, 0, ...Array.from({ length: count }, () => [])); }
          else sh.rows.splice(at, -count);
          sh.rowHeights = shiftIndexMap(sh.rowHeights, at, count);
        } else {
          sh.rows.forEach((row) => {
            if (!row) return;
            if (count > 0) { if (at < row.length) row.splice(at, 0, ...Array(count).fill('')); }
            else row.splice(at, -count);
          });
          sh.colWidths = shiftIndexMap(sh.colWidths, at, count);
        }
        const styles = {};
        Object.entries(sh.styles).forEach(([k, st]) => {
          let [r, c] = k.split(',').map(Number);
          let i = axis === 'r' ? r : c;
          if (count > 0) { if (i >= at) i += count; }
          else if (i >= at - count) i += count;
          else if (i >= at) return;
          if (axis === 'r') r = i; else c = i;
          styles[styleKey(r, c)] = st;
        });
        sh.styles = styles;
        sh.merges = sh.merges.map((m) => shiftRange(m, axis, at, count)).filter((m) => m && (m.r1 !== m.r2 || m.c1 !== m.c2));
        sh.condFormats = sh.condFormats.map((cf) => { const rg = shiftRange(cf.range, axis, at, count); return rg ? { ...cf, range: rg } : null; }).filter(Boolean);
        sh.validations = sh.validations.map((v) => { const rg = shiftRange(v.range, axis, at, count); return rg ? { ...v, range: rg } : null; }).filter(Boolean);
        if (sh.filter) {
          const rg = shiftRange({ r1: sh.filter.r, c1: sh.filter.c1, r2: sh.filter.r, c2: sh.filter.c2 }, axis, at, count);
          if (!rg) sh.filter = null;
          else {
            const hidden = axis === 'c' ? shiftIndexMap(sh.filter.hidden, at, count) : sh.filter.hidden;
            sh.filter = { r: rg.r1, c1: rg.c1, c2: rg.c2, hidden };
          }
        }
        sh.charts.forEach((ch) => {
          const f = shiftFormula('=' + ch.range, name, name, axis, at, count);
          if (!/#REF!/.test(f)) ch.range = f.slice(1);
        });
        // every formula in the workbook that points at this sheet
        model.sheets.forEach((other) => {
          other.rows.forEach((row) => {
            if (!row) return;
            for (let c = 0; c < row.length; c++) {
              const v = row[c];
              if (typeof v === 'string' && v[0] === '=') row[c] = shiftFormula(v, other.name, name, axis, at, count);
            }
          });
          other.validations.forEach((v) => { if (v.source && other === sh) v.source = shiftFormula(v.source[0] === '=' ? v.source : '=' + v.source, other.name, name, axis, at, count); });
        });
      });
    }
    function insertRows(where) {
      const rg = selRange();
      const n = rg.r2 - rg.r1 + 1;
      const at = where === 'below' ? rg.r2 + 1 : rg.r1;
      structural('r', at, n);
      if (where !== 'below') { sel = { r: sel.r + n, c: sel.c }; if (selEnd) selEnd = { r: selEnd.r + n, c: selEnd.c }; }
      afterSelection();
    }
    function insertCols(where) {
      const rg = selRange();
      const n = rg.c2 - rg.c1 + 1;
      const at = where === 'right' ? rg.c2 + 1 : rg.c1;
      structural('c', at, n);
      if (where !== 'right') { sel = { r: sel.r, c: sel.c + n }; if (selEnd) selEnd = { r: selEnd.r, c: selEnd.c + n }; }
      afterSelection();
    }
    function deleteRows() {
      const rg = selRange();
      structural('r', rg.r1, -(rg.r2 - rg.r1 + 1));
      select(rg.r1, sel.c, false);
    }
    function deleteCols() {
      const rg = selRange();
      structural('c', rg.c1, -(rg.c2 - rg.c1 + 1));
      select(sel.r, rg.c1, false);
    }

    /* ---------------- regions, sort, filter ---------------- */
    function currentRegion(r, c) {
      const u = engine.usedBounds(model.active);
      const rg = { r1: r, c1: c, r2: r, c2: c };
      const any = (r1, c1, r2, c2) => {
        for (let rr = Math.max(0, r1); rr <= Math.min(r2, u.r); rr++) for (let cc = Math.max(0, c1); cc <= Math.min(c2, u.c); cc++) if (getRaw(rr, cc) !== '') return true;
        return false;
      };
      let grew = true;
      while (grew) {
        grew = false;
        if (rg.r1 > 0 && any(rg.r1 - 1, rg.c1 - 1, rg.r1 - 1, rg.c2 + 1)) { rg.r1--; grew = true; }
        if (rg.r2 < u.r && any(rg.r2 + 1, rg.c1 - 1, rg.r2 + 1, rg.c2 + 1)) { rg.r2++; grew = true; }
        if (rg.c1 > 0 && any(rg.r1, rg.c1 - 1, rg.r2, rg.c1 - 1)) { rg.c1--; grew = true; }
        if (rg.c2 < u.c && any(rg.r1, rg.c2 + 1, rg.r2, rg.c2 + 1)) { rg.c2++; grew = true; }
      }
      return rg;
    }
    function detectHeader(rg) {
      if (rg.r2 <= rg.r1) return false;
      let textCells = 0, numberCells = 0, bold = true;
      for (let c = rg.c1; c <= rg.c2; c++) {
        const v = display(rg.r1, c).value;
        if (v == null) continue;
        if (typeof v === 'string') textCells++; else numberCells++;
        if (!(getStyle(rg.r1, c) || {}).bold) bold = false;
      }
      if (!textCells || numberCells) return false;
      if (bold) return true;
      for (let c = rg.c1; c <= rg.c2; c++) {
        const v = display(rg.r1 + 1, c).value;
        if (typeof v === 'number') return true;
      }
      return false;
    }
    /* Rows move as whole records within the block: values, styles and
       heights; relative references travel with their row. */
    function sortRows(rg, col, asc) {
      const sh = sheet();
      if (sh.merges.some((m) => rangesIntersect(m, rg))) { ctx.toast('Unmerge cells before sorting this range', 'error'); return false; }
      const order = [];
      for (let r = rg.r1; r <= rg.r2; r++) order.push(r);
      const key = (r) => display(r, col).value;
      order.sort((a, b) => {
        const va = key(a), vb = key(b);
        if (va == null && vb == null) return a - b;
        if (va == null) return 1;
        if (vb == null) return -1;
        const cmp = compareValues(isErr(va) ? String(va.code) : va, isErr(vb) ? String(vb.code) : vb);
        return (asc ? cmp : -cmp) || a - b;
      });
      if (order.every((r, i) => r === rg.r1 + i)) return true;
      const snapshot = order.map((r) => {
        const cells = [], styles = [];
        for (let c = rg.c1; c <= rg.c2; c++) { cells.push(getRaw(r, c)); styles.push(getStyle(r, c)); }
        return { r, cells, styles, h: sh.rowHeights[r] };
      });
      snapshot.forEach((rec, i) => {
        const nr = rg.r1 + i;
        rec.cells.forEach((v, j) => {
          const c = rg.c1 + j;
          putRaw(sh, nr, c, v && v[0] === '=' ? offsetFormula(v, nr - rec.r, 0) : v);
          if (rec.styles[j]) sh.styles[styleKey(nr, c)] = rec.styles[j];
          else delete sh.styles[styleKey(nr, c)];
        });
        if (rg.c1 === 0 && rec.h != null) sh.rowHeights[nr] = rec.h;
      });
      return true;
    }
    function sortSelection(asc) {
      let rg = selRange();
      let header = false;
      const f = sheet().filter;
      if (isSingleCell(rg)) {
        if (f && sel.c >= f.c1 && sel.c <= f.c2) {
          rg = { r1: f.r + 1, c1: f.c1, r2: Math.max(f.r + 1, filterEnd(f)), c2: f.c2 };
        } else {
          rg = currentRegion(sel.r, sel.c);
          header = detectHeader(rg);
        }
      }
      if (header) rg = { ...rg, r1: rg.r1 + 1 };
      if (rg.r2 <= rg.r1) { ctx.toast('Nothing to sort here'); return; }
      const col = Math.max(rg.c1, Math.min(rg.c2, sel.c));
      const ok = mutate(() => sortRows(rg, col, asc));
      if (ok !== false) ctx.toast(`Sorted ${rangeName(rg)} by column ${colName(col)} ${asc ? 'A → Z' : 'Z → A'}${header ? ' (kept the header row)' : ''}`);
    }

    function toggleFilter() {
      const sh = sheet();
      if (sh.filter) {
        mutate(() => { sh.filter = null; });
        ctx.toast('Filter removed');
        return;
      }
      let rg = selRange();
      if (isSingleCell(rg)) rg = currentRegion(sel.r, sel.c);
      if (getRaw(rg.r1, rg.c1) === '' && rg.r1 === rg.r2) { ctx.toast('Select a table with a header row to filter'); return; }
      mutate(() => { sh.filter = { r: rg.r1, c1: rg.c1, c2: rg.c2, hidden: {} }; });
      ctx.toast(`Filter on ${rangeName({ r1: rg.r1, c1: rg.c1, r2: rg.r1, c2: rg.c2 })} — use the arrows in the header row`);
    }
    function clearFilters() {
      const f = sheet().filter;
      if (!f) return;
      mutate(() => { f.hidden = {}; });
    }

    /* ---------------- fill (handle drag, Ctrl+D / Ctrl+R) ---------------- */
    const SERIES_LISTS = [
      DAYS, DAYS.map((d) => d.slice(0, 3)), MONTHS, MONTHS.map((m) => m.slice(0, 3))
    ];
    function seriesFor(values) {
      // values: raw strings of the source line. Returns k -> raw.
      const n = values.length;
      const lits = values.map(parseLiteral);
      if (values.some((v) => v && v[0] === '=')) return null; // formulas handled by caller
      if (n && values.every((v, i) => typeof lits[i] === 'number' && !ISO_DATE_RE.test(String(v).trim()) && NUM_RE.test(String(v).trim()))) {
        if (n === 1) return (k) => values[k % 1 === 0 ? 0 : 0];
        const step = (lits[n - 1] - lits[0]) / (n - 1);
        return (k) => formatGeneral(Number((lits[0] + step * k).toPrecision(15)));
      }
      if (n && values.every((v) => ISO_DATE_RE.test(String(v).trim()))) {
        const serials = lits.map(Math.floor);
        const step = n === 1 ? 1 : (serials[n - 1] - serials[0]) / (n - 1);
        return (k) => {
          const d = serialDate(Math.round(serials[0] + step * k));
          return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
        };
      }
      for (const list of SERIES_LISTS) {
        const idx = values.map((v) => list.findIndex((x) => x.toLowerCase() === String(v).trim().toLowerCase()));
        if (n && idx.every((i) => i >= 0)) {
          const step = n === 1 ? 1 : (idx[n - 1] - idx[0]) / (n - 1);
          const upper = values[0] === values[0].toUpperCase(), lower = values[0] === values[0].toLowerCase();
          return (k) => {
            const i = ((Math.round(idx[0] + step * k) % list.length) + list.length) % list.length;
            const w = list[i];
            return upper ? w.toUpperCase() : lower ? w.toLowerCase() : w;
          };
        }
      }
      const tm = values.map((v) => /^(.*?)(\d+)$/.exec(String(v)));
      if (n && tm.every((m) => m && m[1] === tm[0][1] && m[1] !== '')) {
        const nums = tm.map((m) => +m[2]);
        const step = n === 1 ? 1 : (nums[n - 1] - nums[0]) / (n - 1);
        const width = tm[0][2].length;
        return (k) => {
          const x = Math.round(nums[0] + step * k);
          return tm[0][1] + (x < 0 ? String(x) : String(x).padStart(tm[0][2][0] === '0' ? width : 1, '0'));
        };
      }
      return null;
    }
    function fillRange(src, target, opts) {
      const vertical = target.c1 === src.c1 && target.c2 === src.c2;
      const sh = sheet();
      mutate(() => {
        const lines = vertical ? src.c2 - src.c1 + 1 : src.r2 - src.r1 + 1;
        const len = vertical ? src.r2 - src.r1 + 1 : src.c2 - src.c1 + 1;
        for (let li = 0; li < lines; li++) {
          const vals = [], styles = [];
          for (let k = 0; k < len; k++) {
            const r = vertical ? src.r1 + k : src.r1 + li, c = vertical ? src.c1 + li : src.c1 + k;
            vals.push(getRaw(r, c)); styles.push(getStyle(r, c));
          }
          const gen = opts && opts.copy ? null : seriesFor(vals);
          const from = vertical ? target.r1 : target.c1, to = vertical ? target.r2 : target.c2;
          const base = vertical ? src.r1 : src.c1;
          for (let p = from; p <= to; p++) {
            if (p >= base && p < base + len) continue;
            const k = p - base;
            const si = ((k % len) + len) % len;
            const r = vertical ? p : src.r1 + li, c = vertical ? src.c1 + li : p;
            const srcR = vertical ? base + si : r, srcC = vertical ? c : base + si;
            let v = vals[si];
            if (v && v[0] === '=') v = offsetFormula(v, r - srcR, c - srcC);
            else if (gen && vals.some((x) => x !== '')) v = gen(k);
            putRaw(sh, r, c, v);
            if (styles[si]) sh.styles[styleKey(r, c)] = { ...styles[si] };
            else delete sh.styles[styleKey(r, c)];
          }
        }
      });
    }
    function fillDown() {
      const rg = selRange();
      if (rg.r1 === rg.r2) { if (rg.r1 === 0) return; fillRange({ ...rg, r1: rg.r1 - 1, r2: rg.r1 - 1 }, { ...rg, r1: rg.r1 - 1 }, { copy: true }); return; }
      fillRange({ ...rg, r2: rg.r1 }, rg, { copy: true });
    }
    function fillRight() {
      const rg = selRange();
      if (rg.c1 === rg.c2) { if (rg.c1 === 0) return; fillRange({ ...rg, c1: rg.c1 - 1, c2: rg.c1 - 1 }, { ...rg, c1: rg.c1 - 1 }, { copy: true }); return; }
      fillRange({ ...rg, c2: rg.c1 }, rg, { copy: true });
    }
    /* Double-clicking the fill handle fills down as far as the data beside. */
    function autoFillDown() {
      const rg = selRange();
      const u = engine.usedBounds(model.active);
      let last = rg.r2;
      const probe = (c) => { let r = rg.r2; while (r + 1 <= u.r && getRaw(r + 1, c) !== '') r++; return r; };
      if (rg.c1 > 0) last = Math.max(last, probe(rg.c1 - 1));
      if (last === rg.r2) last = Math.max(last, probe(rg.c2 + 1));
      if (last > rg.r2) {
        fillRange(rg, { ...rg, r2: last });
        selectRange(rg.r1, rg.c1, last, rg.c2);
      }
    }

    /* ---------------- clipboard ---------------- */
    let clip = null, marching = false;
    const normNL = (t) => String(t || '').replace(/\r\n?/g, '\n').replace(/\n+$/, '');
    function tsvField(t) {
      return /[\t\n"]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
    }
    function clipBounds(rg) {
      const u = engine.usedBounds(model.active);
      return { r1: rg.r1, c1: rg.c1, r2: Math.min(rg.r2, Math.max(rg.r1, u.r)), c2: Math.min(rg.c2, Math.max(rg.c1, u.c)) };
    }
    function styleCss(st) {
      if (!st) return '';
      let css = '';
      if (st.bold) css += 'font-weight:bold;';
      if (st.italic) css += 'font-style:italic;';
      if (st.underline) css += 'text-decoration:underline;';
      if (st.color) css += `color:${st.color};`;
      if (st.fill) css += `background-color:${st.fill};`;
      if (st.align) css += `text-align:${st.align};`;
      if (st.size) css += `font-size:${st.size}pt;`;
      if (st.font) css += `font-family:'${st.font}';`;
      return css;
    }
    function copySelection(cut) {
      const rg = clipBounds(selRange());
      const cells = [], lines = [], htmlRows = [], rowIdx = [];
      const hidden = hiddenRows();
      for (let r = rg.r1; r <= rg.r2; r++) {
        const row = [], txt = [], html = [];
        const skip = hidden.has(r) && !cut;
        for (let c = rg.c1; c <= rg.c2; c++) {
          const raw = getRaw(r, c), st = getStyle(r, c);
          row.push({ raw, style: st ? { ...st } : null, value: display(r, c).value });
          const t = displayText(r, c);
          txt.push(tsvField(t));
          html.push(`<td style="${styleCss(st)}">${escapeHtml(t)}</td>`);
        }
        if (!skip) { cells.push(row); rowIdx.push(r); lines.push(txt.join('\t')); htmlRows.push(`<tr>${html.join('')}</tr>`); }
      }
      const text = lines.join('\n');
      const html = `<meta charset="utf-8"><table>${htmlRows.join('')}</table>`;
      clip = { sheet: model.active, range: rg, cells, rowIdx, text, cut: !!cut, merges: sheet().merges.filter((m) => m.r1 >= rg.r1 && m.r2 <= rg.r2 && m.c1 >= rg.c1 && m.c2 <= rg.c2).map((m) => ({ ...m })) };
      marching = true;
      writeClipboard(text, html);
      renderNow();
      if (cut) ctx.toast('Cut — paste where the cells should go');
    }
    function writeClipboard(text, html) {
      let done = false;
      const onCopy = (e) => {
        e.clipboardData.setData('text/plain', text);
        e.clipboardData.setData('text/html', html);
        e.preventDefault();
        done = true;
      };
      document.addEventListener('copy', onCopy, true);
      try { document.execCommand('copy'); } catch {}
      document.removeEventListener('copy', onCopy, true);
      if (done) return;
      try {
        navigator.clipboard.write([new ClipboardItem({
          'text/plain': new Blob([text], { type: 'text/plain' }),
          'text/html': new Blob([html], { type: 'text/html' })
        })]).catch(() => navigator.clipboard.writeText(text).catch(() => {}));
      } catch { try { navigator.clipboard.writeText(text).catch(() => {}); } catch {} }
    }
    async function pasteFromClipboard(opts) {
      let text = '', html = '';
      try {
        const items = await navigator.clipboard.read();
        for (const item of items) {
          if (!html && item.types.includes('text/html')) html = await (await item.getType('text/html')).text();
          if (!text && item.types.includes('text/plain')) text = await (await item.getType('text/plain')).text();
        }
      } catch {
        try { text = await navigator.clipboard.readText(); } catch {}
      }
      pasteData({ text, html }, opts);
    }
    function parseTsv(text) {
      const src = String(text).replace(/\r\n?/g, '\n').replace(/\n$/, '');
      const rows = [[]];
      let i = 0, field = '';
      while (i <= src.length) {
        const ch = src[i];
        if (field === '' && ch === '"' ) {
          // quoted field
          let j = i + 1, val = '';
          for (;;) {
            if (j >= src.length) break;
            if (src[j] === '"') { if (src[j + 1] === '"') { val += '"'; j += 2; continue; } j++; break; }
            val += src[j++];
          }
          if (j >= src.length || src[j] === '\t' || src[j] === '\n') { field = val; i = j; continue; }
          field = src.slice(i, j); i = j; continue;
        }
        if (ch === undefined) { rows[rows.length - 1].push(field); break; }
        if (ch === '\t') { rows[rows.length - 1].push(field); field = ''; i++; continue; }
        if (ch === '\n') { rows[rows.length - 1].push(field); rows.push([]); field = ''; i++; continue; }
        field += ch; i++;
      }
      return rows.map((r) => r.map((raw) => ({ raw })));
    }
    function parseHtmlTable(html) {
      let doc;
      try { doc = new DOMParser().parseFromString(html, 'text/html'); } catch { return null; }
      const table = doc.querySelector('table');
      if (!table) return null;
      const classCss = {};
      doc.querySelectorAll('style').forEach((s) => {
        String(s.textContent).replace(/\.([\w-]+)\s*\{([^}]*)\}/g, (m, cls, body) => { classCss[cls] = (classCss[cls] || '') + ';' + body; return m; });
      });
      const out = [];
      const occupied = {};
      Array.from(table.rows).forEach((tr, ri) => {
        out[ri] = out[ri] || [];
        let ci = 0;
        Array.from(tr.cells).forEach((td) => {
          while (occupied[ri + ',' + ci]) ci++;
          const cs = Math.max(1, td.colSpan || 1), rs = Math.max(1, td.rowSpan || 1);
          td.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
          let raw = td.textContent.replace(/ /g, ' ').replace(/^\s+|\s+$/g, '');
          const decl = String(td.className || '').split(/\s+/).map((c) => classCss[c] || '').join(';') + ';' + (td.getAttribute('style') || '');
          const get = (prop) => { const m = new RegExp('(?:^|;)\\s*' + prop + '\\s*:\\s*([^;]+)', 'ig'); let v = null, mm; while ((mm = m.exec(decl))) v = mm[1].trim(); return v; };
          const st = {};
          const fw = get('font-weight');
          if ((fw && (/bold/.test(fw) || +fw >= 600)) || td.querySelector('b,strong')) st.bold = true;
          if (/italic/.test(get('font-style') || '') || td.querySelector('i,em')) st.italic = true;
          if (/underline/.test(get('text-decoration') || '') || td.querySelector('u')) st.underline = true;
          const hex = (v) => (PICKER && PICKER.toHex ? PICKER.toHex(v) : null);
          const color = get('color'); if (color && hex(color) && hex(color) !== '#000000') st.color = hex(color);
          const bg = get('background-color') || get('background'); if (bg && hex(bg) && hex(bg) !== '#ffffff') st.fill = hex(bg);
          const ta = get('text-align'); if (ta && /^(left|center|right)$/.test(ta)) st.align = ta;
          // Google Sheets carries the typed value alongside the display text
          const gv = td.getAttribute('data-sheets-value');
          if (gv) { try { const j = JSON.parse(gv); if (j && j[3] != null) raw = String(j[3]); } catch {} }
          out[ri][ci] = { raw, style: Object.keys(st).length ? st : null };
          for (let dr = 0; dr < rs; dr++) for (let dc = 0; dc < cs; dc++) {
            if (dr || dc) { occupied[(ri + dr) + ',' + (ci + dc)] = true; (out[ri + dr] = out[ri + dr] || [])[ci + dc] = { raw: '' }; }
          }
          ci += cs;
        });
      });
      return out.map((row) => Array.from({ length: row.length }, (_, i) => row[i] || { raw: '' }));
    }
    function pasteData(data, opts) {
      const o = opts || {};
      if (editing) commitEdit({ keepFocus: true, force: true });
      const text = data.text || '';
      if (clip && (normNL(text) === normNL(clip.text) || (!text && !data.html))) {
        pasteInternal(o);
        return;
      }
      let matrix = null;
      let styled = false;
      if (data.html && /<table/i.test(data.html)) { matrix = parseHtmlTable(data.html); styled = !!matrix; }
      if (!matrix || !matrix.length) {
        styled = false;
        if (!text) return;
        matrix = parseTsv(text);
      }
      clip = null; marching = false;
      pasteMatrix(matrix, { valuesOnly: !!o.valuesOnly, styled });
    }
    function pasteTarget(h, w) {
      const rg = selRange();
      const th = rg.r2 - rg.r1 + 1, tw = rg.c2 - rg.c1 + 1;
      if (!isSingleCell(rg) && th % h === 0 && tw % w === 0) return { r1: rg.r1, c1: rg.c1, r2: rg.r2, c2: rg.c2 };
      return { r1: rg.r1, c1: rg.c1, r2: rg.r1 + h - 1, c2: rg.c1 + w - 1 };
    }
    function pasteMatrix(matrix, o) {
      const h = matrix.length, w = Math.max(1, ...matrix.map((r) => r.length));
      const tg = pasteTarget(h, w);
      const sh = sheet();
      mutate(() => {
        for (let r = tg.r1; r <= tg.r2; r++) {
          for (let c = tg.c1; c <= tg.c2; c++) {
            const cell = (matrix[(r - tg.r1) % h] || [])[(c - tg.c1) % w] || { raw: '' };
            putRaw(sh, r, c, normalizeEntry(cell.raw));
            // Formatted sources (HTML from a spreadsheet) bring their look;
            // plain text takes on the formatting already in the cells.
            if (!o.valuesOnly && o.styled) {
              if (cell.style) sh.styles[styleKey(r, c)] = { ...cell.style };
              else delete sh.styles[styleKey(r, c)];
            }
          }
        }
      });
      selectRange(tg.r1, tg.c1, tg.r2, tg.c2);
    }
    function pasteInternal(o) {
      const cp = clip;
      const h = cp.cells.length, w = cp.cells[0] ? cp.cells[0].length : 1;
      const tg = pasteTarget(h, w);
      const sh = sheet();
      const srcSheet = model.sheets[cp.sheet];
      if (!srcSheet) { clip = null; return; }
      const dr = tg.r1 - cp.range.r1, dc = tg.c1 - cp.range.c1;
      mutate(() => {
        if (cp.cut) {
          for (let r = cp.range.r1; r <= cp.range.r2; r++) for (let c = cp.range.c1; c <= cp.range.c2; c++) {
            putRaw(srcSheet, r, c, '');
            delete srcSheet.styles[styleKey(r, c)];
          }
          srcSheet.merges = srcSheet.merges.filter((m) => !(m.r1 >= cp.range.r1 && m.r2 <= cp.range.r2 && m.c1 >= cp.range.c1 && m.c2 <= cp.range.c2));
        }
        for (let r = tg.r1; r <= tg.r2; r++) {
          for (let c = tg.c1; c <= tg.c2; c++) {
            const cell = cp.cells[(r - tg.r1) % h][(c - tg.c1) % w];
            let v = cell.raw;
            if (o.valuesOnly) {
              const val = cell.value;
              v = val == null ? '' : isErr(val) ? val.code : typeof val === 'number' ? String(val) : typeof val === 'boolean' ? (val ? 'TRUE' : 'FALSE') : String(val);
            } else if (v && v[0] === '=' && !cp.cut) {
              const srcR = cp.rowIdx[(r - tg.r1) % h], srcC = cp.range.c1 + ((c - tg.c1) % w);
              v = offsetFormula(v, r - srcR, c - srcC);
            }
            putRaw(sh, r, c, v);
            if (!o.valuesOnly) {
              if (cell.style) sh.styles[styleKey(r, c)] = { ...cell.style };
              else delete sh.styles[styleKey(r, c)];
            }
          }
        }
        if (!o.valuesOnly) {
          cp.merges.forEach((m) => {
            const nm = { r1: m.r1 + dr, c1: m.c1 + dc, r2: m.r2 + dr, c2: m.c2 + dc };
            sh.merges = sh.merges.filter((x) => !rangesIntersect(x, nm));
            sh.merges.push(nm);
          });
        }
        if (cp.cut) {
          const srcName = srcSheet.name;
          model.sheets.forEach((other) => other.rows.forEach((row) => {
            if (!row) return;
            for (let c = 0; c < row.length; c++) {
              if (typeof row[c] === 'string' && row[c][0] === '=') {
                row[c] = moveRefsInFormula(row[c], other.name, srcName, cp.range, dr, dc);
                if (other !== sh && srcSheet !== sh) continue;
              }
            }
          }));
        }
      });
      if (cp.cut) { clip = null; marching = false; }
      selectRange(tg.r1, tg.c1, tg.r2, tg.c2);
    }

    /* ---------------- AutoSum ---------------- */
    function autoSum(fn) {
      const name = fn || 'SUM';
      const rg = selRange();
      if (!isSingleCell(rg)) {
        mutate(() => {
          const target = rg.r2 + 1;
          for (let c = rg.c1; c <= rg.c2; c++) putRaw(sheet(), target, c, `=${name}(${cellName(rg.r1, c)}:${cellName(rg.r2, c)})`);
        });
        return;
      }
      const r = sel.r, c = sel.c;
      const isNum = (rr, cc) => typeof display(rr, cc).value === 'number';
      let top = r - 1;
      while (top >= 0 && getRaw(top, c) === '' ) top--;
      if (top >= 0 && isNum(top, c)) {
        let start = top;
        while (start - 1 >= 0 && isNum(start - 1, c)) start--;
        mutate(() => setCellValue(r, c, `=${name}(${cellName(start, c)}:${cellName(r - 1, c)})`));
        return;
      }
      let left = c - 1;
      while (left >= 0 && getRaw(r, left) === '') left--;
      if (left >= 0 && isNum(r, left)) {
        let start = left;
        while (start - 1 >= 0 && isNum(r, start - 1)) start--;
        mutate(() => setCellValue(r, c, `=${name}(${cellName(r, start)}:${cellName(r, c - 1)})`));
        return;
      }
      beginEdit(`=${name}(`, { mode: 'enter' });
    }

    /* ---------------- popover menus ---------------- */
    let openMenuEl = null;
    function closeMenu() {
      if (!openMenuEl) return;
      const m = openMenuEl;
      openMenuEl = null;
      document.removeEventListener('mousedown', m.dismiss, true);
      document.removeEventListener('keydown', m.onKey, true);
      m.remove();
      if (m.anchor) m.anchor.classList.remove('open');
    }
    /* items: { label, icon, hint, action, checked, disabled } | { sep:true } | { head:'…' } */
    function openMenu(anchor, items, pos) {
      const wasFor = openMenuEl && openMenuEl.anchor === anchor && anchor;
      closeMenu();
      if (wasFor) return;
      const el = document.createElement('div');
      el.className = 'sheet-menu';
      el.setAttribute('role', 'menu');
      items.forEach((it) => {
        if (it.sep) { el.appendChild(Object.assign(document.createElement('div'), { className: 'sheet-menu-sep' })); return; }
        if (it.head) { el.appendChild(Object.assign(document.createElement('div'), { className: 'sheet-menu-head', textContent: it.head })); return; }
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'sheet-menu-item' + (it.checked ? ' checked' : '');
        b.setAttribute('role', 'menuitem');
        b.disabled = !!it.disabled;
        b.innerHTML = `<span class="sheet-menu-icon">${it.icon ? ICON(it.icon) : (it.checked ? '✓' : '')}</span><span class="sheet-menu-label">${escapeHtml(it.label)}</span>${it.hint ? `<span class="sheet-menu-hint">${escapeHtml(it.hint)}</span>` : ''}`;
        if (it.swatch) b.querySelector('.sheet-menu-icon').innerHTML = `<span class="sheet-swatch" style="background:${it.swatch}"></span>`;
        b.addEventListener('mousedown', (e) => e.preventDefault());
        b.addEventListener('click', () => { closeMenu(); if (it.action) it.action(); });
        el.appendChild(b);
      });
      document.body.appendChild(el);
      el.anchor = anchor || null;
      const vw = window.innerWidth, vh = window.innerHeight;
      const r = pos ? { left: pos.x, bottom: pos.y, top: pos.y } : anchor.getBoundingClientRect();
      const w = el.offsetWidth, h = el.offsetHeight;
      let left = r.left, top = r.bottom + 4;
      if (left + w > vw - 8) left = Math.max(8, vw - w - 8);
      if (top + h > vh - 8) top = Math.max(8, (pos ? pos.y : r.top) - h - 4);
      el.style.left = left + 'px';
      el.style.top = top + 'px';
      if (anchor) anchor.classList.add('open');
      el.dismiss = (e) => { if (!el.contains(e.target) && e.target !== anchor && !(anchor && anchor.contains(e.target))) closeMenu(); };
      el.onKey = (e) => {
        const btns = [...el.querySelectorAll('.sheet-menu-item:not(:disabled)')];
        const i = btns.indexOf(document.activeElement);
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeMenu(); focusGrid(); }
        else if (e.key === 'ArrowDown') { e.preventDefault(); (btns[i + 1] || btns[0]).focus(); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); (btns[i - 1] || btns[btns.length - 1]).focus(); }
      };
      setTimeout(() => {
        if (openMenuEl !== el) return;
        document.addEventListener('mousedown', el.dismiss, true);
        document.addEventListener('keydown', el.onKey, true);
      }, 0);
      openMenuEl = el;
      return el;
    }

    /* ---------------- find & replace ---------------- */
    let findHits = [], findIdx = 0;
    function openFindModal(withReplace) {
      const wrap = document.createElement('div');
      wrap.className = 'sheet-dialog sheet-find';
      wrap.innerHTML = `
        <label class="sheet-field"><span>Find</span><input class="sheet-fx-search" type="text" spellcheck="false" placeholder="Text, number or formula…"></label>
        <label class="sheet-field"><span>Replace with</span><input class="sheet-replace-input" type="text" spellcheck="false" placeholder="Leave empty to delete the match"></label>
        <div class="sheet-checks">
          <label><input type="checkbox" data-opt="case"> Match case</label>
          <label><input type="checkbox" data-opt="whole"> Entire cell</label>
          <label><input type="checkbox" data-opt="all"> All sheets</label>
        </div>
        <div class="sheet-find-status" aria-live="polite">Type to search this sheet</div>`;
      const input = wrap.querySelector('.sheet-fx-search');
      const repl = wrap.querySelector('.sheet-replace-input');
      const status = wrap.querySelector('.sheet-find-status');
      const opt = (k) => wrap.querySelector(`[data-opt="${k}"]`).checked;
      if (!withReplace) wrap.querySelector('.sheet-field:nth-child(2)').classList.add('collapsed');
      function matcher() {
        const q = input.value;
        if (!q) return null;
        const cs = opt('case'), whole = opt('whole');
        return (text) => {
          const a = cs ? text : text.toLowerCase(), b = cs ? q : q.toLowerCase();
          return whole ? a === b : a.includes(b);
        };
      }
      function search(keepIdx) {
        findHits = [];
        const m = matcher();
        if (!m) { status.textContent = 'Type to search this sheet'; findIdx = 0; renderNow(); return; }
        const sheetsToSearch = opt('all') ? model.sheets.map((_, i) => i) : [model.active];
        for (const s of sheetsToSearch) {
          const rows = model.sheets[s].rows;
          rows.forEach((row, r) => {
            (row || []).forEach((raw, c) => {
              if (raw == null || raw === '') return;
              const shown = s === model.active ? displayText(r, c) : String(raw);
              if (m(String(raw)) || m(shown)) findHits.push({ s, r, c });
            });
          });
        }
        if (!keepIdx) findIdx = 0;
        if (findIdx >= findHits.length) findIdx = 0;
        if (findHits.length) {
          status.textContent = `${findHits.length} match${findHits.length > 1 ? 'es' : ''} — ${findIdx + 1} of ${findHits.length}`;
          goHit();
        } else status.textContent = 'No matches';
        renderNow();
      }
      function goHit() {
        const h = findHits[findIdx];
        if (!h) return;
        if (h.s !== model.active) { model.active = h.s; sheetChanged(); }
        select(h.r, h.c);
        status.textContent = `${findHits.length} match${findHits.length > 1 ? 'es' : ''} — ${findIdx + 1} of ${findHits.length}`;
      }
      function step(dir) {
        if (!findHits.length) { search(); return; }
        findIdx = (findIdx + dir + findHits.length) % findHits.length;
        goHit();
        renderNow();
      }
      function replaceIn(raw) {
        const q = input.value, rep = repl.value;
        if (opt('whole')) return rep;
        const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), opt('case') ? 'g' : 'gi');
        return String(raw).replace(re, () => rep);
      }
      function replaceOne() {
        const h = findHits[findIdx];
        if (!h) { search(); return; }
        const sh = model.sheets[h.s];
        const raw = getRaw(h.r, h.c, h.s);
        const m = matcher();
        if (!m || !m(raw)) { step(1); return; }
        mutate(() => putRaw(sh, h.r, h.c, normalizeEntry(replaceIn(raw))));
        search(true);
      }
      function replaceAll() {
        const m = matcher();
        if (!m) return;
        let n = 0;
        mutate(() => {
          findHits.forEach((h) => {
            const raw = getRaw(h.r, h.c, h.s);
            if (!m(raw)) return;
            putRaw(model.sheets[h.s], h.r, h.c, normalizeEntry(replaceIn(raw)));
            n++;
          });
          return n > 0;
        });
        search();
        status.textContent = n ? `Replaced ${n} cell${n > 1 ? 's' : ''}` : 'Nothing to replace';
      }
      input.addEventListener('input', () => search());
      wrap.querySelectorAll('[data-opt]').forEach((cb) => cb.addEventListener('change', () => search()));
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); step(e.shiftKey ? -1 : 1); } });
      repl.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); replaceOne(); } });
      const actions = [
        { label: 'Close', value: null },
        { label: 'Replace all', keepOpen: true, value: () => { if (!withReplace) { withReplace = true; wrap.querySelector('.sheet-field.collapsed').classList.remove('collapsed'); repl.focus(); return; } replaceAll(); } },
        { label: 'Replace', keepOpen: true, value: () => { if (!withReplace) { withReplace = true; wrap.querySelector('.sheet-field.collapsed').classList.remove('collapsed'); repl.focus(); return; } replaceOne(); } },
        { label: 'Previous', keepOpen: true, value: () => step(-1) },
        { label: 'Next', primary: true, keepOpen: true, value: () => step(1) }
      ];
      ctx.openModal(withReplace ? 'Find and replace' : 'Find', wrap, actions).then(() => {
        findHits = [];
        findIdx = 0;
        renderNow();
        focusGrid();
      });
      setTimeout(() => { input.focus(); input.select(); }, 40);
    }

    /* ---------------- function wizard ---------------- */
    function openFunctionWizard(presetCat) {
      const wrap = document.createElement('div');
      wrap.className = 'sheet-dialog sheet-fx-modal';
      const search = Object.assign(document.createElement('input'), { type: 'search', className: 'sheet-fx-search', placeholder: 'Search functions — SUM, VLOOKUP, IF…' });
      const cats = document.createElement('div');
      cats.className = 'sheet-fx-cats';
      let activeCat = presetCat || 'All';
      ['All', ...FX_CATEGORIES].forEach((cat) => {
        const b = Object.assign(document.createElement('button'), { type: 'button', className: 'sheet-chip' + (cat === activeCat ? ' on' : ''), textContent: cat });
        b.addEventListener('click', () => { activeCat = cat; cats.querySelectorAll('.sheet-chip').forEach((x) => x.classList.toggle('on', x === b)); renderList(); });
        cats.appendChild(b);
      });
      const list = Object.assign(document.createElement('div'), { className: 'sheet-fx-list' });
      const desc = Object.assign(document.createElement('div'), { className: 'sheet-fx-desc' });
      let chosen = null;
      function choose(f, item) {
        chosen = f;
        list.querySelectorAll('.sheet-fx-item').forEach((x) => x.classList.toggle('on', x === item));
        desc.innerHTML = `<div class="sheet-fx-syntax">=${escapeHtml(f.syntax)}</div><div>${escapeHtml(f.desc)}</div>`;
      }
      function renderList() {
        list.innerHTML = '';
        const q = search.value.trim().toLowerCase();
        const items = FX_CATALOG.filter((f) => (activeCat === 'All' || f.cat === activeCat) && (!q || f.name.toLowerCase().includes(q) || f.desc.toLowerCase().includes(q)));
        items.forEach((f, i) => {
          const it = document.createElement('div');
          it.className = 'sheet-fx-item';
          it.innerHTML = `<span class="sheet-fx-item-name">${f.name}</span><span class="sheet-fx-item-desc">${escapeHtml(f.desc)}</span>`;
          it.addEventListener('click', () => choose(f, it));
          it.addEventListener('dblclick', () => { choose(f, it); insert(); ctx.closeModal(null); });
          list.appendChild(it);
          if (i === 0) choose(f, it);
        });
        if (!items.length) { chosen = null; desc.textContent = 'No function matches.'; }
      }
      function insert() {
        if (!chosen) return;
        const text = `=${chosen.name}(`;
        if (editing && editing.text[0] === '=') {
          const inp = editInput();
          const s = inp.selectionStart;
          inp.value = editing.text.slice(0, s) + chosen.name + '(' + editing.text.slice(inp.selectionEnd);
          syncEditText(inp);
          return;
        }
        select(sel.r, sel.c, false);
        beginEdit(text, { mode: 'edit' });
      }
      search.addEventListener('input', renderList);
      search.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); insert(); ctx.closeModal(null); } });
      wrap.append(search, cats, list, desc);
      renderList();
      ctx.openModal('Insert function', wrap, [
        { label: 'Cancel', value: null },
        { label: 'Insert', primary: true, value: () => insert() }
      ]);
      setTimeout(() => search.focus(), 40);
    }

    /* ---------------- conditional formatting ---------------- */
    const CF_STYLES = [
      { id: 'red', label: 'Light red fill, dark red text', style: { fill: '#ffc7ce', color: '#9c0006' } },
      { id: 'yellow', label: 'Yellow fill, dark yellow text', style: { fill: '#ffeb9c', color: '#9c5700' } },
      { id: 'green', label: 'Green fill, dark green text', style: { fill: '#c6efce', color: '#006100' } },
      { id: 'blue', label: 'Blue fill, dark blue text', style: { fill: '#dbe8fb', color: '#1c4587' } },
      { id: 'bold', label: 'Bold text', style: { bold: true } },
      { id: 'redtext', label: 'Red text', style: { color: '#c00000' } }
    ];
    const CF_TYPES = [
      ['gt', 'Greater than'], ['lt', 'Less than'], ['gte', 'Greater than or equal to'], ['lte', 'Less than or equal to'],
      ['between', 'Between'], ['eq', 'Equal to'], ['neq', 'Not equal to'], ['contains', 'Text contains'],
      ['blank', 'Is empty'], ['notblank', 'Is not empty'], ['scale', 'Colour scale']
    ];
    function openCondFormat() {
      const rg = selRange();
      const wrap = document.createElement('div');
      wrap.className = 'sheet-dialog';
      wrap.innerHTML = `
        <label class="sheet-field"><span>Apply to range</span><input data-k="range" type="text" value="${rangeName(rg)}" spellcheck="false"></label>
        <label class="sheet-field"><span>Format cells if…</span><select data-k="type">${CF_TYPES.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></label>
        <div class="sheet-row2">
          <label class="sheet-field" data-show="v1"><span>Value</span><input data-k="v1" type="text" placeholder="e.g. 100"></label>
          <label class="sheet-field" data-show="v2"><span>and</span><input data-k="v2" type="text" placeholder="e.g. 500"></label>
        </div>
        <label class="sheet-field" data-show="style"><span>Formatting style</span><select data-k="style">${CF_STYLES.map((s) => `<option value="${s.id}">${s.label}</option>`).join('')}</select></label>
        <div class="sheet-row2" data-show="scale">
          <label class="sheet-field"><span>Lowest</span><input data-k="minColor" type="color" value="#f8696b"></label>
          <label class="sheet-field"><span>Highest</span><input data-k="maxColor" type="color" value="#63be7b"></label>
        </div>
        <div class="sheet-cf-preview"><span>Preview</span><span class="sheet-cf-sample">123</span></div>
        <div class="sheet-cf-list"></div>`;
      const q = (k) => wrap.querySelector(`[data-k="${k}"]`);
      const typeSel = q('type');
      const sync = () => {
        const t = typeSel.value;
        wrap.querySelector('[data-show="v1"]').hidden = ['blank', 'notblank', 'scale'].includes(t);
        wrap.querySelector('[data-show="v2"]').hidden = t !== 'between';
        wrap.querySelector('[data-show="style"]').hidden = t === 'scale';
        wrap.querySelector('[data-show="scale"]').hidden = t !== 'scale';
        const sample = wrap.querySelector('.sheet-cf-sample');
        if (t === 'scale') { sample.style.background = `linear-gradient(90deg, ${q('minColor').value}, ${q('maxColor').value})`; sample.style.color = '#1d1d1f'; sample.style.fontWeight = ''; }
        else {
          const st = CF_STYLES.find((s) => s.id === q('style').value).style;
          sample.style.background = st.fill || 'transparent'; sample.style.color = st.color || ''; sample.style.fontWeight = st.bold ? '700' : '';
        }
      };
      wrap.querySelectorAll('select,input').forEach((el) => el.addEventListener('input', sync));
      const listEl = wrap.querySelector('.sheet-cf-list');
      const paintList = () => {
        const rules = sheet().condFormats;
        listEl.innerHTML = rules.length ? '<div class="sheet-cf-head">Rules on this sheet</div>' : '';
        rules.forEach((rule, i) => {
          const row = document.createElement('div');
          row.className = 'sheet-cf-rule';
          const label = (CF_TYPES.find(([v]) => v === rule.type) || [0, rule.type])[1];
          const sw = rule.type === 'scale' ? `linear-gradient(90deg, ${rule.minColor}, ${rule.maxColor})` : ((rule.style && rule.style.fill) || 'transparent');
          row.innerHTML = `<span class="sheet-swatch" style="background:${sw}"></span><span>${rangeName(rule.range)} · ${escapeHtml(label)}${rule.v1 != null && rule.v1 !== '' ? ' ' + escapeHtml(rule.v1) : ''}${rule.type === 'between' ? ' – ' + escapeHtml(rule.v2 || '') : ''}</span>`;
          const del = Object.assign(document.createElement('button'), { type: 'button', className: 'sheet-icon-btn', title: 'Delete rule', innerHTML: ICON('trash') });
          del.addEventListener('click', () => { mutate(() => { sheet().condFormats.splice(i, 1); }); paintList(); });
          row.appendChild(del);
          listEl.appendChild(row);
        });
      };
      sync();
      paintList();
      ctx.openModal('Conditional formatting', wrap, [
        { label: 'Close', value: null },
        {
          label: 'Add rule', primary: true, keepOpen: true, value: () => {
            const range = parseA1Range(q('range').value);
            if (!range) { ctx.toast('Enter a range like A1:C20', 'error'); return; }
            const t = typeSel.value;
            if (!['blank', 'notblank', 'scale'].includes(t) && q('v1').value.trim() === '') { ctx.toast('Enter a value for the rule', 'error'); return; }
            const rule = { range, type: t };
            if (t === 'scale') { rule.minColor = q('minColor').value; rule.maxColor = q('maxColor').value; }
            else {
              rule.v1 = q('v1').value.trim();
              if (t === 'between') rule.v2 = q('v2').value.trim();
              rule.style = { ...CF_STYLES.find((s) => s.id === q('style').value).style };
            }
            mutate(() => { sheet().condFormats.push(rule); });
            paintList();
            ctx.toast('Rule added');
          }
        }
      ]);
    }

    /* ---------------- data validation ---------------- */
    function openValidation() {
      const rg = selRange();
      const cur = validationAt(sel.r, sel.c);
      const wrap = document.createElement('div');
      wrap.className = 'sheet-dialog';
      wrap.innerHTML = `
        <label class="sheet-field"><span>Cells</span><input data-k="range" type="text" value="${cur ? rangeName(cur.range) : rangeName(rg)}" spellcheck="false"></label>
        <label class="sheet-field"><span>Allow</span><select data-k="type"><option value="list">List of items</option><option value="number">Number between</option></select></label>
        <label class="sheet-field" data-show="list"><span>Items (comma separated) or a range such as =$F$1:$F$5</span><input data-k="items" type="text" spellcheck="false" placeholder="Yes, No, Maybe"></label>
        <div class="sheet-row2" data-show="number">
          <label class="sheet-field"><span>Minimum</span><input data-k="min" type="text"></label>
          <label class="sheet-field"><span>Maximum</span><input data-k="max" type="text"></label>
        </div>
        <div class="sheet-checks"><label><input type="checkbox" data-k="strict" checked> Reject invalid entries</label></div>`;
      const q = (k) => wrap.querySelector(`[data-k="${k}"]`);
      if (cur) {
        q('type').value = cur.type;
        q('items').value = cur.source ? cur.source : (cur.values || []).join(', ');
        q('min').value = cur.min != null ? cur.min : '';
        q('max').value = cur.max != null ? cur.max : '';
        q('strict').checked = cur.strict !== false;
      }
      const sync = () => {
        wrap.querySelector('[data-show="list"]').hidden = q('type').value !== 'list';
        wrap.querySelector('[data-show="number"]').hidden = q('type').value !== 'number';
      };
      q('type').addEventListener('change', sync);
      sync();
      ctx.openModal('Data validation', wrap, [
        { label: 'Cancel', value: null },
        {
          label: 'Remove', value: () => {
            const range = parseA1Range(q('range').value) || rg;
            mutate(() => { sheet().validations = sheet().validations.filter((v) => !rangesIntersect(v.range, range)); });
          }
        },
        {
          label: 'Save', primary: true, value: () => {
            const range = parseA1Range(q('range').value);
            if (!range) { ctx.toast('Enter a range like A2:A50', 'error'); return; }
            const t = q('type').value;
            const rule = { range, type: t, strict: q('strict').checked };
            if (t === 'list') {
              const txt = q('items').value.trim();
              if (!txt) { ctx.toast('Add at least one item', 'error'); return; }
              if (txt[0] === '=' || /^\$?[A-Za-z]{1,3}\$?\d+:\$?[A-Za-z]{1,3}\$?\d+$/.test(txt)) rule.source = txt[0] === '=' ? txt : '=' + txt;
              else rule.values = txt.split(',').map((x) => x.trim()).filter(Boolean);
            } else { rule.min = q('min').value.trim(); rule.max = q('max').value.trim(); }
            mutate(() => {
              sheet().validations = sheet().validations.filter((v) => !rangesIntersect(v.range, range));
              sheet().validations.push(rule);
            });
            ctx.toast(t === 'list' ? 'Dropdown list added' : 'Number rule added');
          }
        }
      ]);
    }
    function openValidationList() {
      const v = validationAt(sel.r, sel.c);
      if (!v || v.type !== 'list') return;
      const items = validationList(v);
      const rc = cellRect(sel.r, sel.c);
      const vr = viewport.getBoundingClientRect();
      const cur = getRaw(sel.r, sel.c);
      openMenu(null, items.length ? items.map((it) => ({
        label: it, checked: it.toLowerCase() === cur.toLowerCase(),
        action: () => { if (editing) cancelEdit(); mutate(() => setCellValue(sel.r, sel.c, it)); focusGrid(); }
      })) : [{ label: 'The list is empty', disabled: true }], { x: vr.left + rc.x, y: vr.top + rc.y + rc.h });
    }

    /* ---------------- custom number format ---------------- */
    function openCustomFormat() {
      const wrap = document.createElement('div');
      wrap.className = 'sheet-dialog';
      const v = display(sel.r, sel.c).value;
      const sample = typeof v === 'number' ? v : 1234.5678;
      wrap.innerHTML = `
        <label class="sheet-field"><span>Format code</span><input data-k="code" type="text" spellcheck="false" value="${escapeHtml(cellStyle().numFmt || '#,##0.00')}"></label>
        <div class="sheet-fmt-presets">${['0', '0.00', '#,##0', '#,##0.00', '"$"#,##0.00', '0%', '0.0%', '0.00E+00', 'yyyy-mm-dd', 'd mmm yyyy', 'mmm yyyy', 'dddd', 'h:mm AM/PM', '[h]:mm', '#,##0.00;[Red]-#,##0.00', '@'].map((c) => `<button type="button" class="sheet-chip" data-code="${escapeHtml(c)}">${escapeHtml(c)}</button>`).join('')}</div>
        <div class="sheet-cf-preview"><span>Preview of ${escapeHtml(formatGeneral(sample))}</span><span class="sheet-fmt-sample"></span></div>`;
      const inp = wrap.querySelector('[data-k="code"]');
      const out = wrap.querySelector('.sheet-fmt-sample');
      const upd = () => { try { const f = formatValue(sample, inp.value); out.textContent = f.text; out.style.color = f.color || ''; } catch { out.textContent = '—'; } };
      inp.addEventListener('input', upd);
      wrap.querySelectorAll('[data-code]').forEach((b) => b.addEventListener('click', () => { inp.value = b.dataset.code; upd(); }));
      upd();
      ctx.openModal('Custom number format', wrap, [
        { label: 'Cancel', value: null },
        { label: 'Apply', primary: true, value: () => setNumFmt(inp.value.trim()) }
      ]);
      setTimeout(() => inp.focus(), 40);
    }

    /* ---------------- charts ---------------- */
    const chartEls = new Map();   // id -> { box, svgHost, sig }
    const SVGNS = 'http://www.w3.org/2000/svg';
    function chartData(ch) {
      const rg = parseA1Range(ch.range);
      if (!rg) return { labels: [], series: [] };
      const m = [];
      for (let r = rg.r1; r <= rg.r2; r++) {
        const row = [];
        for (let c = rg.c1; c <= rg.c2; c++) row.push(engine.val(model.active, r, c));
        m.push(row);
      }
      const rows = m.length, cols = m[0] ? m[0].length : 0;
      const byCols = rows >= cols;
      const at = (i, j) => (byCols ? m[i][j] : m[j][i]);   // i: point, j: series column
      const nPoints = byCols ? rows : cols, nSeries = byCols ? cols : rows;
      const nonNum = (v) => v == null || typeof v !== 'number';
      let hasHead = nPoints > 1, hasLabels = nSeries > 1;
      for (let j = 0; j < nSeries; j++) if (!nonNum(at(0, j))) hasHead = false;
      for (let i = hasHead ? 1 : 0; i < nPoints; i++) if (!nonNum(at(i, 0)) && at(i, 0) != null) hasLabels = false;
      if (hasLabels) {
        let anyText = false;
        for (let i = hasHead ? 1 : 0; i < nPoints; i++) if (typeof at(i, 0) === 'string') anyText = true;
        if (!anyText && nSeries > 1) {
          // a first column of numbers that looks like years still labels
          hasLabels = false;
        }
      }
      const p0 = hasHead ? 1 : 0, s0 = hasLabels ? 1 : 0;
      const labels = [];
      for (let i = p0; i < nPoints; i++) labels.push(hasLabels ? toText(at(i, 0)) : String(i - p0 + 1));
      const series = [];
      for (let j = s0; j < nSeries; j++) {
        const values = [];
        for (let i = p0; i < nPoints; i++) { const v = at(i, j); values.push(typeof v === 'number' ? v : null); }
        series.push({ name: hasHead ? toText(at(0, j)) || `Series ${j - s0 + 1}` : `Series ${j - s0 + 1}`, values });
      }
      return { labels, series };
    }
    function niceTicks(min, max, count) {
      if (min === max) { max = min + 1; min = Math.min(0, min); }
      const span = max - min;
      const step0 = Math.pow(10, Math.floor(Math.log10(span / count)));
      const err = (count * step0) / span;
      const step = step0 * (err <= 0.15 ? 10 : err <= 0.35 ? 5 : err <= 0.75 ? 2 : 1);
      const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
      const ticks = [];
      for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Number(v.toPrecision(12)));
      return { lo, hi, ticks };
    }
    function shortNum(v) {
      const a = Math.abs(v);
      if (a >= 1e9) return formatGeneral(Number((v / 1e9).toPrecision(3))) + 'B';
      if (a >= 1e6) return formatGeneral(Number((v / 1e6).toPrecision(3))) + 'M';
      if (a >= 1e4) return formatGeneral(Number((v / 1e3).toPrecision(3))) + 'K';
      return formatGeneral(Number(v.toPrecision(6)));
    }
    function svgEl(tag, attrs, text) {
      const el = document.createElementNS(SVGNS, tag);
      Object.entries(attrs || {}).forEach(([k, v]) => el.setAttribute(k, v));
      if (text != null) el.textContent = text;
      return el;
    }
    function buildChartSvg(ch, data, W, H) {
      const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, class: 'sheet-chart-svg', role: 'img', 'aria-label': ch.title || 'Chart' });
      const { labels, series } = data;
      const color = (i) => `var(${SERIES_VARS[i % SERIES_VARS.length]})`;
      if (!series.length || !labels.length) {
        svg.appendChild(svgEl('text', { x: W / 2, y: H / 2, 'text-anchor': 'middle', class: 'sheet-chart-empty' }, 'No numbers in ' + ch.range));
        return svg;
      }
      const legendH = series.length > 1 || ch.type === 'pie' ? 22 : 0;
      if (ch.type === 'pie') {
        const vals = series[0].values.map((v) => Math.max(0, v || 0));
        const total = vals.reduce((a, b) => a + b, 0) || 1;
        const cx = W / 2, cy = (H - legendH) / 2 + 4, R = Math.max(10, Math.min(W, H - legendH) / 2 - 18), r0 = R * 0.55;
        let a0 = -Math.PI / 2;
        vals.forEach((v, i) => {
          const ang = (v / total) * Math.PI * 2;
          if (ang <= 0) return;
          const a1 = a0 + ang;
          const large = ang > Math.PI ? 1 : 0;
          const p = (a, rad) => `${cx + rad * Math.cos(a)} ${cy + rad * Math.sin(a)}`;
          const d = ang >= Math.PI * 2 - 1e-6
            ? `M ${cx - R} ${cy} A ${R} ${R} 0 1 1 ${cx + R} ${cy} A ${R} ${R} 0 1 1 ${cx - R} ${cy} M ${cx - r0} ${cy} A ${r0} ${r0} 0 1 0 ${cx + r0} ${cy} A ${r0} ${r0} 0 1 0 ${cx - r0} ${cy} Z`
            : `M ${p(a0, R)} A ${R} ${R} 0 ${large} 1 ${p(a1, R)} L ${p(a1, r0)} A ${r0} ${r0} 0 ${large} 0 ${p(a0, r0)} Z`;
          svg.appendChild(svgEl('path', { d, fill: color(i), class: 'sheet-mark sheet-slice', 'data-tip': `${labels[i]}: ${formatGeneral(v)} (${Math.round((v / total) * 1000) / 10}%)` }));
          a0 = a1;
        });
        svg.appendChild(svgEl('text', { x: cx, y: cy + 5, 'text-anchor': 'middle', class: 'sheet-chart-total' }, shortNum(total)));
        drawLegend(svg, labels.map((l, i) => ({ name: l, color: color(i) })), W, H);
        return svg;
      }
      const all = series.flatMap((s) => s.values.filter((v) => v != null));
      const vmin = Math.min(0, ...all), vmax = Math.max(0, ...all);
      const { lo, hi, ticks } = niceTicks(vmin, vmax, 5);
      const horizontal = ch.type === 'bar';
      const tickW = Math.max(...ticks.map((t) => shortNum(t).length)) * 6.5 + 10;
      const padL = horizontal ? Math.min(110, Math.max(40, Math.max(...labels.map((l) => l.length)) * 6.2 + 12)) : tickW, padR = 14, padT = 12, padB = (horizontal ? 24 : 28) + legendH;
      const pw = W - padL - padR, ph = H - padT - padB;
      if (pw < 20 || ph < 20) return svg;
      const scale = (v) => (v - lo) / (hi - lo || 1);
      const g = svgEl('g');
      // gridlines and value axis
      ticks.forEach((t) => {
        if (horizontal) {
          const x = padL + scale(t) * pw;
          g.appendChild(svgEl('line', { x1: x, x2: x, y1: padT, y2: padT + ph, class: t === 0 ? 'sheet-chart-zero' : 'sheet-chart-grid' }));
          g.appendChild(svgEl('text', { x, y: padT + ph + 16, 'text-anchor': 'middle', class: 'sheet-chart-tick' }, shortNum(t)));
        } else {
          const y = padT + ph - scale(t) * ph;
          g.appendChild(svgEl('line', { x1: padL, x2: padL + pw, y1: y, y2: y, class: t === 0 ? 'sheet-chart-zero' : 'sheet-chart-grid' }));
          g.appendChild(svgEl('text', { x: padL - 8, y: y + 4, 'text-anchor': 'end', class: 'sheet-chart-tick' }, shortNum(t)));
        }
      });
      const n = labels.length;
      const band = (horizontal ? ph : pw) / n;
      const every = Math.max(1, Math.ceil(n / Math.max(1, Math.floor((horizontal ? ph : pw) / (horizontal ? 16 : 48)))));
      labels.forEach((l, i) => {
        if (i % every) return;
        const txt = l.length > 14 ? l.slice(0, 13) + '…' : l;
        if (horizontal) g.appendChild(svgEl('text', { x: padL - 8, y: padT + band * i + band / 2 + 4, 'text-anchor': 'end', class: 'sheet-chart-tick' }, txt));
        else g.appendChild(svgEl('text', { x: padL + band * i + band / 2, y: padT + ph + 17, 'text-anchor': 'middle', class: 'sheet-chart-tick' }, txt));
      });
      if (ch.type === 'line' || ch.type === 'area') {
        series.forEach((s, si) => {
          const pts = s.values.map((v, i) => (v == null ? null : [padL + band * i + band / 2, padT + ph - scale(v) * ph]));
          let d = '', started = false;
          pts.forEach((p) => { if (!p) { started = false; return; } d += (started ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1) + ' '; started = true; });
          if (ch.type === 'area') {
            const valid = pts.filter(Boolean);
            if (valid.length) {
              const base = padT + ph - scale(Math.max(lo, 0)) * ph;
              const ad = `M${valid[0][0]} ${base} ` + valid.map((p) => `L${p[0]} ${p[1]}`).join(' ') + ` L${valid[valid.length - 1][0]} ${base} Z`;
              g.appendChild(svgEl('path', { d: ad, fill: color(si), 'fill-opacity': '0.16', stroke: 'none' }));
            }
          }
          g.appendChild(svgEl('path', { d, fill: 'none', stroke: color(si), 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
          pts.forEach((p, i) => {
            if (!p) return;
            g.appendChild(svgEl('circle', { cx: p[0], cy: p[1], r: n > 40 ? 2 : 3.5, fill: color(si), class: 'sheet-mark sheet-dot', 'data-tip': `${labels[i]} · ${s.name}: ${formatGeneral(s.values[i])}` }));
          });
        });
      } else {
        const k = series.length;
        const inner = band * 0.72, bw = inner / k;
        series.forEach((s, si) => {
          s.values.forEach((v, i) => {
            if (v == null) return;
            const a = scale(Math.max(lo, Math.min(0, v))), b = scale(Math.max(0, v));
            const off = band * i + (band - inner) / 2 + bw * si + 1;
            const size = Math.max(1, bw - 2);
            let x, y, w, h;
            if (horizontal) { x = padL + a * pw; w = Math.max(1, (b - a) * pw); y = padT + off; h = size; }
            else { y = padT + ph - b * ph; h = Math.max(1, (b - a) * ph); x = padL + off; w = size; }
            const r = Math.min(4, (horizontal ? h : w) / 2);
            g.appendChild(svgEl('rect', { x, y, width: w, height: h, rx: r, fill: color(si), class: 'sheet-mark', 'data-tip': `${labels[i]} · ${s.name}: ${formatGeneral(v)}` }));
          });
        });
      }
      svg.appendChild(g);
      if (series.length > 1) drawLegend(svg, series.map((s, i) => ({ name: s.name, color: color(i) })), W, H);
      return svg;
    }
    function drawLegend(svg, items, W, H) {
      const g = svgEl('g', { class: 'sheet-chart-legend' });
      let x = 0;
      const shown = items.slice(0, 8);
      const widths = shown.map((it) => Math.min(120, it.name.length * 6.2) + 22);
      const total = widths.reduce((a, b) => a + b, 0);
      x = Math.max(8, (W - total) / 2);
      shown.forEach((it, i) => {
        g.appendChild(svgEl('rect', { x, y: H - 15, width: 10, height: 10, rx: 2, fill: it.color }));
        const label = it.name.length > 18 ? it.name.slice(0, 17) + '…' : it.name;
        g.appendChild(svgEl('text', { x: x + 14, y: H - 6, class: 'sheet-chart-tick' }, label));
        x += widths[i];
      });
      svg.appendChild(g);
    }
    function chartBox(ch) {
      const box = document.createElement('div');
      box.className = 'sheet-chart';
      box.innerHTML = `
        <div class="sheet-chart-head">
          <span class="sheet-chart-title"></span>
          <span class="sheet-chart-range"></span>
          <button type="button" class="sheet-icon-btn" data-act="type" title="Chart type">${ICON('chartColumn')}</button>
          <button type="button" class="sheet-icon-btn" data-act="range" title="Change data range">${ICON('grid')}</button>
          <button type="button" class="sheet-icon-btn" data-act="delete" title="Delete chart">${ICON('trash')}</button>
        </div>
        <div class="sheet-chart-body"></div>
        <div class="sheet-chart-tip" hidden></div>
        <div class="sheet-chart-resize" title="Resize"></div>`;
      const byId = () => sheet().charts.find((c) => c.id === ch.id);
      box.querySelector('.sheet-chart-title').addEventListener('dblclick', async () => {
        const c = byId(); if (!c) return;
        const t = await ctx.inputModal('Chart title', 'Title', c.title || '');
        if (t != null) mutate(() => { c.title = t.trim(); });
      });
      box.querySelector('[data-act="type"]').addEventListener('click', (e) => {
        const c = byId(); if (!c) return;
        openMenu(e.currentTarget, [['column', 'Column', 'chartColumn'], ['bar', 'Bar', 'chartBar'], ['line', 'Line', 'chartLine'], ['area', 'Area', 'chartArea'], ['pie', 'Doughnut', 'chartPie']].map(([t, l, ic]) => ({
          label: l, icon: ic, checked: c.type === t, action: () => mutate(() => { c.type = t; })
        })));
      });
      box.querySelector('[data-act="range"]').addEventListener('click', async () => {
        const c = byId(); if (!c) return;
        const t = await ctx.inputModal('Chart data range', 'e.g. A1:C12', c.range);
        if (t == null) return;
        const rg = parseA1Range(t);
        if (!rg) { ctx.toast('That is not a range like A1:C12', 'error'); return; }
        mutate(() => { c.range = rangeName(rg); });
      });
      box.querySelector('[data-act="delete"]').addEventListener('click', () => {
        mutate(() => { sheet().charts = sheet().charts.filter((c) => c.id !== ch.id); });
      });
      const tip = box.querySelector('.sheet-chart-tip');
      box.addEventListener('mousemove', (e) => {
        const mark = e.target.closest && e.target.closest('.sheet-mark');
        if (!mark) { tip.hidden = true; return; }
        tip.textContent = mark.getAttribute('data-tip');
        tip.hidden = false;
        const br = box.getBoundingClientRect();
        tip.style.left = Math.min(br.width - tip.offsetWidth - 4, e.clientX - br.left + 12) + 'px';
        tip.style.top = Math.max(30, e.clientY - br.top - 30) + 'px';
      });
      box.addEventListener('mouseleave', () => { tip.hidden = true; });
      const startDrag = (e, mode) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        const c = byId(); if (!c) return;
        const start = { x: e.clientX, y: e.clientY, cx: c.x || 0, cy: c.y || 0, w: c.width || 420, h: c.height || 280 };
        box.classList.add('dragging');
        const onMove = (ev) => {
          const dx = (ev.clientX - start.x) / zoom, dy = (ev.clientY - start.y) / zoom;
          if (mode === 'move') { c.x = Math.max(0, Math.round(start.cx + dx)); c.y = Math.max(0, Math.round(start.cy + dy)); }
          else { c.width = Math.max(220, Math.round(start.w + dx)); c.height = Math.max(160, Math.round(start.h + dy)); }
          positionCharts();
          if (mode !== 'move') { const el = chartEls.get(c.id); if (el) el.sig = null; renderCharts(); }
        };
        const onUp = () => {
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
          dragCleanup = null;
          box.classList.remove('dragging');
          ctx.markDirty();
          recordSheet();
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
        dragCleanup = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
      };
      box.querySelector('.sheet-chart-head').addEventListener('mousedown', (e) => { if (!e.target.closest('button')) startDrag(e, 'move'); });
      box.querySelector('.sheet-chart-resize').addEventListener('mousedown', (e) => startDrag(e, 'size'));
      box.addEventListener('mousedown', (e) => e.stopPropagation());
      return box;
    }
    let dragCleanup = null;
    function renderCharts() {
      if (!chartLayer) return;
      const charts = sheet().charts;
      const ids = new Set(charts.map((c) => c.id));
      for (const [id, el] of chartEls) if (!ids.has(id)) { el.box.remove(); chartEls.delete(id); }
      charts.forEach((ch) => {
        if (!ch.id) ch.id = 'c' + Math.random().toString(36).slice(2, 9);
        let el = chartEls.get(ch.id);
        if (!el) { el = { box: chartBox(ch), sig: null }; chartEls.set(ch.id, el); chartLayer.appendChild(el.box); }
        const data = chartData(ch);
        const W = ch.width || 420, H = (ch.height || 280) - 34;
        const sig = JSON.stringify([ch.type, ch.title, W, H, data]);
        el.box.querySelector('.sheet-chart-title').textContent = ch.title || 'Chart';
        el.box.querySelector('.sheet-chart-range').textContent = ch.range;
        el.box.querySelector('[data-act="type"]').innerHTML = ICON({ column: 'chartColumn', bar: 'chartBar', line: 'chartLine', area: 'chartArea', pie: 'chartPie' }[ch.type] || 'chartColumn');
        if (sig !== el.sig) {
          el.sig = sig;
          const body = el.box.querySelector('.sheet-chart-body');
          body.innerHTML = '';
          body.appendChild(buildChartSvg(ch, data, W, H));
        }
      });
      positionCharts();
    }
    function positionCharts() {
      if (!chartLayer || !model) return;
      chartLayer.style.left = HW() + 'px';
      chartLayer.style.top = HH() + 'px';
      chartLayer.style.right = '0px';
      chartLayer.style.bottom = '0px';
      // Charts sit on the scrolling part of the sheet, in unzoomed pixels.
      sheet().charts.forEach((ch) => {
        const el = chartEls.get(ch.id);
        if (!el) return;
        const x = (ch.x || 0) * zoom - gridScroll.scrollLeft;
        const y = (ch.y || 0) * zoom - gridScroll.scrollTop;
        el.box.style.transform = `translate(${x}px, ${y}px) scale(${zoom})`;
        el.box.style.width = (ch.width || 420) + 'px';
        el.box.style.height = (ch.height || 280) + 'px';
      });
    }
    function insertChart(type) {
      let rg = selRange();
      if (isSingleCell(rg)) rg = currentRegion(sel.r, sel.c);
      if (isSingleCell(rg) && getRaw(rg.r1, rg.c1) === '') { ctx.toast('Select the data to chart first', 'error'); return; }
      const lay = ensureLayout();
      const data = (() => { const tmp = { range: rangeName(rg) }; return chartData(tmp); })();
      const title = data.series.length === 1 && data.series[0].name && !/^Series /.test(data.series[0].name) ? data.series[0].name : 'Chart';
      // Land beside the data rather than over it: skip past every filled
      // column in the rows the chart will cover.
      let clearCol = rg.c2 + 1;
      const rowsCovered = Math.ceil(280 / 20);
      for (let r = rg.r1; r <= rg.r1 + rowsCovered; r++) {
        const row = sheet().rows[r];
        if (!row) continue;
        for (let c = row.length - 1; c >= clearCol; c--) {
          if (row[c] != null && row[c] !== '') { clearCol = c + 1; break; }
        }
      }
      clearCol = Math.min(clearCol, lay.nCols);
      const ch = {
        id: 'c' + Date.now().toString(36),
        type: type || 'column',
        title,
        range: rangeName(rg),
        x: Math.round(lay.colPos[clearCol] / zoom + 16),
        y: Math.round(lay.rowPos[rg.r1] / zoom),
        width: 420,
        height: 280
      };
      // step down past charts already sitting at that spot
      while (sheet().charts.some((o) => Math.abs((o.x || 0) - ch.x) < 24 && Math.abs((o.y || 0) - ch.y) < 24)) ch.y += 32;
      mutate(() => { sheet().charts.push(ch); });
      ctx.toast(`Chart added for ${ch.range} — drag it by the title, resize from the corner`);
    }

    /* ---------------- ribbon ---------------- */
    let fillBar = null, colorBar = null;
    let lastFill = '#fff2cc', lastColor = '#c00000';
    function buildRibbon() {
      const tb = ctx.toolbar;
      tb.innerHTML = '';
      tb.className = 'toolbar sheet-ribbon';
      ribbonState.length = 0;
      const tabsBar = document.createElement('div');
      tabsBar.className = 'sheet-ribbon-tabs';
      tabsBar.setAttribute('role', 'tablist');
      const panels = {};
      const TABS = [['home', 'Home'], ['insert', 'Insert'], ['formulas', 'Formulas'], ['data', 'Data'], ['view', 'View']];
      TABS.forEach(([id, label]) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'sheet-ribbon-tab' + (id === activeRibbonTab ? ' active' : '');
        b.textContent = label;
        b.setAttribute('role', 'tab');
        b.addEventListener('mousedown', (e) => e.preventDefault());
        b.addEventListener('click', () => {
          activeRibbonTab = id;
          tabsBar.querySelectorAll('.sheet-ribbon-tab').forEach((x) => x.classList.toggle('active', x === b));
          Object.entries(panels).forEach(([pid, p]) => p.classList.toggle('hidden', pid !== id));
        });
        tabsBar.appendChild(b);
        const p = document.createElement('div');
        p.className = 'sheet-ribbon-panel' + (id === activeRibbonTab ? '' : ' hidden');
        p.setAttribute('role', 'toolbar');
        p.addEventListener('wheel', (e) => {
          if (p.scrollWidth <= p.clientWidth || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
          p.scrollLeft += e.deltaY;
          e.preventDefault();
        }, { passive: false });
        panels[id] = p;
      });
      tb.appendChild(tabsBar);
      Object.values(panels).forEach((p) => tb.appendChild(p));

      const group = (panel) => { const g = document.createElement('div'); g.className = 'sheet-rgroup'; panel.appendChild(g); return g; };
      const btn = (g, icon, title, action, opts) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'sheet-rbtn' + (opts && opts.label ? ' with-label' : '') + (opts && opts.menu ? ' menu' : '');
        b.title = title;
        b.setAttribute('aria-label', title.replace(/\s*\(.*\)$/, ''));
        b.innerHTML = ICON(icon) + (opts && opts.label ? `<span>${escapeHtml(opts.label)}</span>` : '') + (opts && opts.menu ? `<span class="sheet-caret">${ICON('chevronDown')}</span>` : '');
        b.addEventListener('mousedown', (e) => e.preventDefault());
        b.addEventListener('click', (e) => action(e, b));
        g.appendChild(b);
        if (opts && opts.active) ribbonState.push({ el: b, get: opts.active });
        return b;
      };
      const select = (g, cls, title, options, onChange) => {
        const s = document.createElement('select');
        s.className = 'tb-select ' + cls;
        s.title = title;
        options.forEach(([v, l]) => s.appendChild(Object.assign(document.createElement('option'), { value: v, textContent: l })));
        s.addEventListener('change', () => { onChange(s.value); focusGrid(); });
        g.appendChild(s);
        return s;
      };

      /* ===== Home ===== */
      const H = panels.home;
      let g = group(H);
      btn(g, 'undo', 'Undo (Ctrl+Z)', () => undo());
      btn(g, 'redo', 'Redo (Ctrl+Y)', () => redo());
      g = group(H);
      btn(g, 'paste', 'Paste (Ctrl+V) — values only with Ctrl+Shift+V', () => pasteFromClipboard());
      btn(g, 'cut', 'Cut (Ctrl+X)', () => copySelection(true));
      btn(g, 'copy', 'Copy (Ctrl+C)', () => copySelection(false));
      btn(g, 'painter', 'Format painter — copy this look to other cells', () => startPainter(), { active: () => !!painter });

      g = group(H);
      fontSelect = document.createElement('select');
      fontSelect.className = 'tb-select tb-font';
      fontSelect.title = 'Font';
      FONTS.fillFamilySelect(fontSelect, (FONTS.FAMILIES || []).slice());
      fontSelect.addEventListener('change', () => {
        FONTS.fillVariantSelect(variantSelect, FONTS.getFacesForFamily(fontSelect.value, fontFacesByFamily));
        applyFontFace(fontSelect.value, variantSelect.value);
        focusGrid();
      });
      g.appendChild(fontSelect);
      variantSelect = document.createElement('select');
      variantSelect.className = 'tb-select tb-font-variant';
      variantSelect.title = 'Font style';
      FONTS.fillVariantSelect(variantSelect, FONTS.getFacesForFamily(fontSelect.value, fontFacesByFamily));
      variantSelect.addEventListener('change', () => { applyFontFace(fontSelect.value, variantSelect.value); focusGrid(); });
      g.appendChild(variantSelect);
      sizeSelect = select(g, 'tb-size', 'Font size', (FONTS.SIZES || [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 36]).map((s) => [String(s), String(s)]), (v) => applyStyle({ size: parseFloat(v) }));
      sizeSelect.value = '11';

      g = group(H);
      btn(g, 'bold', 'Bold (Ctrl+B)', () => toggleFaceFlag('bold'), { active: () => FONTS.parseFontFaceStyle(FONTS.inferFace(cellStyle())).weight >= 700 });
      btn(g, 'italic', 'Italic (Ctrl+I)', () => toggleFaceFlag('italic'), { active: () => FONTS.parseFontFaceStyle(FONTS.inferFace(cellStyle())).fontStyle === 'italic' });
      btn(g, 'underline', 'Underline (Ctrl+U)', () => toggleStyle('underline'), { active: () => !!cellStyle().underline });
      const colorBtn = btn(g, 'textColor', 'Text colour', () => applyStyle({ color: lastColor }));
      colorBar = Object.assign(document.createElement('span'), { className: 'sheet-colorbar' });
      colorBar.style.background = lastColor;
      colorBtn.appendChild(colorBar);
      btn(g, 'chevronDown', 'Choose text colour', (e, b) => PICKER.open(b, {
        title: 'Text colour', allowNone: true, noneLabel: 'Automatic', value: cellStyle().color,
        onPick: (hex) => { if (hex) { lastColor = hex; colorBar.style.background = hex; } applyStyle({ color: hex || null }); }
      })).classList.add('sheet-split');
      const fillBtn = btn(g, 'fillColor', 'Fill colour', () => applyStyle({ fill: lastFill }));
      fillBar = Object.assign(document.createElement('span'), { className: 'sheet-colorbar' });
      fillBar.style.background = lastFill;
      fillBtn.appendChild(fillBar);
      btn(g, 'chevronDown', 'Choose fill colour', (e, b) => PICKER.open(b, {
        title: 'Fill colour', allowNone: true, noneLabel: 'No fill', value: cellStyle().fill,
        onPick: (hex) => { if (hex) { lastFill = hex; fillBar.style.background = hex; } applyStyle({ fill: hex || null }); }
      })).classList.add('sheet-split');
      btn(g, 'borders', 'Borders', (e, b) => openMenu(b, [
        { label: 'All borders', icon: 'borderAll', action: () => applyBorders('all') },
        { label: 'Outside borders', icon: 'borderOuter', action: () => applyBorders('outer') },
        { label: 'Thick outside border', icon: 'borderThick', action: () => applyBorders('thick') },
        { sep: true },
        { label: 'Top border', icon: 'borderTop', action: () => applyBorders('top') },
        { label: 'Bottom border', icon: 'borderBottom', action: () => applyBorders('bottom') },
        { label: 'Left border', icon: 'borderLeft', action: () => applyBorders('left') },
        { label: 'Right border', icon: 'borderRight', action: () => applyBorders('right') },
        { sep: true },
        { label: 'No border', icon: 'borderNone', action: () => applyBorders('none') }
      ]), { menu: true });

      g = group(H);
      btn(g, 'alignLeft', 'Align left', () => applyStyle({ align: 'left' }), { active: () => cellStyle().align === 'left' });
      btn(g, 'alignCenter', 'Align centre', () => applyStyle({ align: 'center' }), { active: () => cellStyle().align === 'center' });
      btn(g, 'alignRight', 'Align right', () => applyStyle({ align: 'right' }), { active: () => cellStyle().align === 'right' });
      const vIcon = () => ({ top: 'valignTop', middle: 'valignMiddle', center: 'valignMiddle' }[cellStyle().valign] || 'valignBottom');
      const vBtn = btn(g, 'valignBottom', 'Vertical alignment', (e, b) => openMenu(b, [
        { label: 'Top', icon: 'valignTop', checked: cellStyle().valign === 'top', action: () => applyStyle({ valign: 'top' }) },
        { label: 'Middle', icon: 'valignMiddle', action: () => applyStyle({ valign: 'middle' }) },
        { label: 'Bottom', icon: 'valignBottom', action: () => applyStyle({ valign: 'bottom' }) }
      ]), { menu: true });
      ribbonState.push({ el: vBtn, get: () => { const ic = ICON(vIcon()); const cur = vBtn.firstElementChild; if (cur && cur.outerHTML !== ic) { const t = document.createElement('span'); t.innerHTML = ic; cur.replaceWith(t.firstElementChild); } return false; } });
      btn(g, 'wrap', 'Wrap text', () => toggleStyle('wrap'), { active: () => !!cellStyle().wrap });
      btn(g, 'merge', 'Merge & centre / unmerge', () => toggleMerge(), { active: () => !!mergeAt(sel.r, sel.c) });

      g = group(H);
      fmtSelect = select(g, 'tb-format', 'Number format', FORMAT_PRESETS.map((p) => [p.id, p.label]).concat([['custom', 'Custom…']]), (v) => {
        if (v === 'custom') { openCustomFormat(); return; }
        const p = FORMAT_PRESETS.find((x) => x.id === v);
        setNumFmt(p ? p.code : '');
      });
      btn(g, 'currency', 'Currency format', () => setNumFmt('"$"#,##0.00'));
      btn(g, 'percent', 'Percent format (Ctrl+Shift+5)', () => setNumFmt('0%'));
      btn(g, 'decInc', 'More decimal places', () => stepDecimals(1));
      btn(g, 'decDec', 'Fewer decimal places', () => stepDecimals(-1));

      g = group(H);
      btn(g, 'insert', 'Insert cells', (e, b) => openMenu(b, [
        { label: 'Insert row above', icon: 'rowAbove', action: () => insertRows('above') },
        { label: 'Insert row below', icon: 'rowBelow', action: () => insertRows('below') },
        { label: 'Insert column left', icon: 'colLeft', action: () => insertCols('left') },
        { label: 'Insert column right', icon: 'colRight', action: () => insertCols('right') },
        { sep: true },
        { label: 'Insert sheet', icon: 'sheet', action: () => addSheet() }
      ]), { menu: true });
      btn(g, 'trash', 'Delete or clear cells', (e, b) => openMenu(b, [
        { label: 'Delete rows', icon: 'deleteRow', action: () => deleteRows() },
        { label: 'Delete columns', icon: 'deleteCol', action: () => deleteCols() },
        { sep: true },
        { label: 'Delete sheet', icon: 'trash', disabled: model.sheets.length < 2, action: () => deleteSheet(model.active) },
        { sep: true },
        { label: 'Clear contents', icon: 'eraser', hint: 'Del', action: () => clearContents() },
        { label: 'Clear formats', action: () => clearFormats() },
        { label: 'Clear all', action: () => { mutate(() => { forEachSelected((r, c) => { putRaw(sheet(), r, c, ''); delete sheet().styles[styleKey(r, c)]; }); }); } }
      ]), { menu: true });

      g = group(H);
      btn(g, 'sigma', 'AutoSum (Alt+=)', (e, b) => openMenu(b, ['SUM', 'AVERAGE', 'COUNT', 'MAX', 'MIN'].map((f) => ({ label: f[0] + f.slice(1).toLowerCase(), action: () => autoSum(f) }))), { menu: true });
      btn(g, 'sortAsc', 'Sort', (e, b) => openMenu(b, [
        { label: 'Sort A → Z', icon: 'sortAsc', action: () => sortSelection(true) },
        { label: 'Sort Z → A', icon: 'sortDesc', action: () => sortSelection(false) }
      ]), { menu: true });
      btn(g, 'filter', 'Filter (Ctrl+Shift+L)', () => toggleFilter(), { active: () => !!sheet().filter });

      /* ===== Insert ===== */
      const I = panels.insert;
      g = group(I);
      btn(g, 'chartColumn', 'Column chart', () => insertChart('column'), { label: 'Column' });
      btn(g, 'chartBar', 'Bar chart', () => insertChart('bar'), { label: 'Bar' });
      btn(g, 'chartLine', 'Line chart', () => insertChart('line'), { label: 'Line' });
      btn(g, 'chartArea', 'Area chart', () => insertChart('area'), { label: 'Area' });
      btn(g, 'chartPie', 'Doughnut chart', () => insertChart('pie'), { label: 'Doughnut' });
      g = group(I);
      btn(g, 'rowAbove', 'Insert row above', () => insertRows('above'), { label: 'Row' });
      btn(g, 'colLeft', 'Insert column left', () => insertCols('left'), { label: 'Column' });
      btn(g, 'sheet', 'Insert sheet', () => addSheet(), { label: 'Sheet' });
      g = group(I);
      btn(g, 'fx', 'Insert function (Shift+F3)', () => openFunctionWizard(), { label: 'Function' });
      btn(g, 'date', "Insert today's date (Ctrl+;)", () => insertNow('date'), { label: 'Date' });
      btn(g, 'validation', 'Dropdown list', () => openValidation(), { label: 'Dropdown' });

      /* ===== Formulas ===== */
      const F = panels.formulas;
      g = group(F);
      btn(g, 'fx', 'Insert function (Shift+F3)', () => openFunctionWizard(), { label: 'Insert function' });
      btn(g, 'sigma', 'AutoSum', (e, b) => openMenu(b, ['SUM', 'AVERAGE', 'COUNT', 'MAX', 'MIN'].map((f) => ({ label: f[0] + f.slice(1).toLowerCase(), action: () => autoSum(f) }))), { label: 'AutoSum', menu: true });
      g = group(F);
      FX_CATEGORIES.forEach((cat) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'sheet-rbtn text menu';
        b.innerHTML = `<span>${cat}</span><span class="sheet-caret">${ICON('chevronDown')}</span>`;
        b.title = `${cat} functions`;
        b.addEventListener('mousedown', (e) => e.preventDefault());
        b.addEventListener('click', () => openMenu(b, FX_CATALOG.filter((f) => f.cat === cat).map((f) => ({ label: f.name, hint: f.desc.length > 38 ? f.desc.slice(0, 36) + '…' : f.desc, action: () => insertFunctionName(f.name) }))));
        g.appendChild(b);
      });
      g = group(F);
      btn(g, 'showFormulas', 'Show formulas (Ctrl+`)', () => toggleShowFormulas(), { label: 'Show formulas', active: () => showFormulas });
      btn(g, 'calc', 'Recalculate now (F9)', () => { recalc(); renderNow(); renderCharts(); ctx.toast('Recalculated'); }, { label: 'Calculate' });

      /* ===== Data ===== */
      const D = panels.data;
      g = group(D);
      btn(g, 'sortAsc', 'Sort A → Z', () => sortSelection(true), { label: 'Sort A→Z' });
      btn(g, 'sortDesc', 'Sort Z → A', () => sortSelection(false), { label: 'Sort Z→A' });
      g = group(D);
      btn(g, 'filter', 'Filter (Ctrl+Shift+L)', () => toggleFilter(), { label: 'Filter', active: () => !!sheet().filter });
      btn(g, 'filterClear', 'Show all rows', () => clearFilters(), { label: 'Clear filter' });
      g = group(D);
      btn(g, 'condFormat', 'Conditional formatting', () => openCondFormat(), { label: 'Conditional' });
      btn(g, 'validation', 'Data validation', () => openValidation(), { label: 'Validation' });
      btn(g, 'duplicates', 'Remove duplicate rows', () => removeDuplicates(), { label: 'Remove duplicates' });
      g = group(D);
      btn(g, 'search', 'Find (Ctrl+F)', () => openFindModal(false), { label: 'Find' });
      btn(g, 'eraser', 'Find and replace (Ctrl+H)', () => openFindModal(true), { label: 'Replace' });

      /* ===== View ===== */
      const V = panels.view;
      g = group(V);
      btn(g, 'freeze', 'Freeze panes', (e, b) => openMenu(b, [
        { label: 'Freeze top row', icon: 'freezeRow', action: () => setFreeze(1, 0) },
        { label: 'Freeze first column', icon: 'freezeCol', action: () => setFreeze(0, 1) },
        { label: `Freeze at ${cellName(sel.r, sel.c)}`, icon: 'freeze', hint: 'rows above, columns left', action: () => setFreeze(sel.r, sel.c) },
        { sep: true },
        { label: 'Unfreeze', icon: 'unfreeze', action: () => setFreeze(0, 0) }
      ]), { label: 'Freeze', menu: true, active: () => !!(sheet().freeze.rows || sheet().freeze.cols) });
      btn(g, 'grid', 'Show gridlines', () => mutate(() => { sheet().hideGrid = !sheet().hideGrid; }), { label: 'Gridlines', active: () => !sheet().hideGrid });
      btn(g, 'showFormulas', 'Show formulas (Ctrl+`)', () => toggleShowFormulas(), { label: 'Formulas', active: () => showFormulas });
      g = group(V);
      btn(g, 'zoomOut', 'Zoom out (Ctrl+-)', () => zoomBy(1 / 1.1));
      btn(g, 'zoomIn', 'Zoom in (Ctrl+=)', () => zoomBy(1.1));
      btn(g, 'zoomReset', 'Zoom to 100% (Ctrl+0)', () => setZoomLevel(1), { label: '100%' });
      g = group(V);
      btn(g, 'autofit', 'Autofit column width', () => autofitColumns(), { label: 'Autofit' });
    }

    function syncRibbon() {
      if (!fontSelect) return;
      const st = cellStyle();
      const family = st.font || 'Calibri';
      const names = [...fontSelect.options].map((o) => o.value);
      if (names.includes(family)) fontSelect.value = family;
      else if (names.includes('Calibri')) fontSelect.value = 'Calibri';
      FONTS.fillVariantSelect(variantSelect, FONTS.getFacesForFamily(fontSelect.value, fontFacesByFamily), FONTS.inferFace(st));
      const size = String(st.size || 11);
      if (![...sizeSelect.options].some((o) => o.value === size)) sizeSelect.appendChild(Object.assign(document.createElement('option'), { value: size, textContent: size }));
      sizeSelect.value = size;
      const preset = formatPresetOf(st.numFmt || '');
      fmtSelect.value = FORMAT_PRESETS.some((p) => p.id === preset) ? preset : 'custom';
      ribbonState.forEach(({ el, get }) => { let on = false; try { on = !!get(); } catch {} el.classList.toggle('on', on); el.setAttribute('aria-pressed', on ? 'true' : 'false'); });
    }

    function insertFunctionName(name) {
      if (editing && editing.text[0] === '=') {
        const inp = editInput();
        const s = inp.selectionStart;
        inp.value = editing.text.slice(0, s) + name + '(' + editing.text.slice(inp.selectionEnd);
        inp.setSelectionRange(s + name.length + 1, s + name.length + 1);
        syncEditText(inp);
        return;
      }
      beginEdit(`=${name}(`, { mode: 'edit' });
    }
    function insertNow(kind) {
      const n = new Date();
      const pad = (x) => String(x).padStart(2, '0');
      const text = kind === 'time' ? `${pad(n.getHours())}:${pad(n.getMinutes())}` : `${n.getFullYear()}-${pad(n.getMonth() + 1)}-${pad(n.getDate())}`;
      if (editing) {
        const inp = editInput(), s = inp.selectionStart;
        inp.value = editing.text.slice(0, s) + text + editing.text.slice(inp.selectionEnd);
        syncEditText(inp);
        return;
      }
      mutate(() => setCellValue(sel.r, sel.c, text));
    }
    function toggleShowFormulas() {
      showFormulas = !showFormulas;
      dispCache = new Map();
      renderNow();
      syncRibbon();
    }
    function setFreeze(rows, cols) {
      mutate(() => { sheet().freeze = { rows: Math.max(0, rows), cols: Math.max(0, cols) }; });
      if (rows || cols) { gridScroll.scrollTop = 0; gridScroll.scrollLeft = 0; }
      renderNow();
    }
    function removeDuplicates() {
      let rg = selRange();
      if (isSingleCell(rg)) rg = currentRegion(sel.r, sel.c);
      const header = detectHeader(rg);
      const start = header ? rg.r1 + 1 : rg.r1;
      const seen = new Set();
      const keep = [];
      for (let r = start; r <= rg.r2; r++) {
        const key = [];
        for (let c = rg.c1; c <= rg.c2; c++) key.push(displayText(r, c).toLowerCase());
        const k = key.join('\u0001');
        if (seen.has(k)) continue;
        seen.add(k);
        keep.push(r);
      }
      const removed = rg.r2 - start + 1 - keep.length;
      if (!removed) { ctx.toast('No duplicate rows found'); return; }
      mutate(() => {
        const sh = sheet();
        const data = keep.map((r) => {
          const cells = [], styles = [];
          for (let c = rg.c1; c <= rg.c2; c++) { cells.push(getRaw(r, c)); styles.push(getStyle(r, c)); }
          return { r, cells, styles };
        });
        for (let r = start; r <= rg.r2; r++) for (let c = rg.c1; c <= rg.c2; c++) { putRaw(sh, r, c, ''); delete sh.styles[styleKey(r, c)]; }
        data.forEach((rec, i) => rec.cells.forEach((v, j) => {
          const nr = start + i, c = rg.c1 + j;
          putRaw(sh, nr, c, v && v[0] === '=' ? offsetFormula(v, nr - rec.r, 0) : v);
          if (rec.styles[j]) sh.styles[styleKey(nr, c)] = rec.styles[j];
        }));
      });
      ctx.toast(`Removed ${removed} duplicate row${removed > 1 ? 's' : ''}; ${keep.length} unique left`);
    }
    function autofitColumns() {
      const rg = selRange();
      mutate(() => {
        for (let c = rg.c1; c <= rg.c2; c++) autofitColumn(c);
      });
    }
    function autofitColumn(c) {
      const u = engine.usedBounds(model.active);
      let max = 0;
      for (let r = 0; r <= u.r; r++) {
        const t = displayText(r, c);
        if (!t || mergeAt(r, c)) continue;
        const st = getStyle(r, c);
        if (st && st.wrap) continue;
        max = Math.max(max, measureText(t, cellFontCss(st, 1)));
      }
      sheet().colWidths[c] = Math.max(40, Math.min(640, Math.ceil(max + 16)));
    }

    /* ---------------- zoom ---------------- */
    function applyZoom() {
      measureCache.clear();
      invalidateLayout();
      renderNow();
      renderCharts();
      if (editing) { applyEditorStyle(); positionEditor(); }
      if (ctx.status) ctx.status.setZoom(zoom, ZOOM_MIN, ZOOM_MAX);
    }
    function zoomBy(f) { setZoomLevel(+(zoom * f).toFixed(4)); }
    function setZoomLevel(z) {
      const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, +z));
      if (next === zoom) return;
      const ratio = next / zoom;
      const st = gridScroll.scrollTop, sl = gridScroll.scrollLeft;
      zoom = next;
      applyZoom();
      gridScroll.scrollTop = st * ratio;
      gridScroll.scrollLeft = sl * ratio;
    }

    /* ---------------- sheets (tabs) ---------------- */
    function uniqueSheetName(base) {
      const names = new Set(model.sheets.map((s) => s.name.toLowerCase()));
      if (!names.has(base.toLowerCase())) return base;
      let i = 2;
      while (names.has(`${base} ${i}`.toLowerCase())) i++;
      return `${base} ${i}`;
    }
    function switchSheet(i) {
      if (i === model.active || i < 0 || i >= model.sheets.length) return;
      if (editing) commitEdit({ keepFocus: true, force: true });
      model.active = i;
      sel = { r: 0, c: 0 }; selEnd = null;
      gridScroll.scrollTop = 0; gridScroll.scrollLeft = 0;
      minRows = 200; minCols = 30;
      sheetChanged();
    }
    function addSheet() {
      let n = model.sheets.length + 1;
      while (model.sheets.some((s) => s.name.toLowerCase() === `sheet${n}`)) n++;
      mutate(() => {
        model.sheets.push(blankSheet(`Sheet${n}`));
        model.active = model.sheets.length - 1;
        sel = { r: 0, c: 0 }; selEnd = null;
      });
      renderTabs();
    }
    function renameSheet(i, name) {
      const clean = String(name || '').replace(/[\\/?*[\]:]/g, ' ').trim().slice(0, 31);
      if (!clean) return;
      const old = model.sheets[i].name;
      if (clean === old) return;
      if (model.sheets.some((s, j) => j !== i && s.name.toLowerCase() === clean.toLowerCase())) { ctx.toast('Another sheet already has that name', 'error'); return; }
      mutate(() => {
        model.sheets[i].name = clean;
        model.sheets.forEach((s) => s.rows.forEach((row) => {
          if (!row) return;
          for (let c = 0; c < row.length; c++) if (typeof row[c] === 'string' && row[c][0] === '=') row[c] = renameSheetInFormula(row[c], old, clean);
        }));
      });
      renderTabs();
    }
    function deleteSheet(i) {
      if (model.sheets.length < 2) return;
      const old = model.sheets[i].name;
      mutate(() => {
        model.sheets.splice(i, 1);
        model.sheets.forEach((s) => s.rows.forEach((row) => {
          if (!row) return;
          for (let c = 0; c < row.length; c++) if (typeof row[c] === 'string' && row[c][0] === '=') row[c] = renameSheetInFormula(row[c], old, null);
        }));
        if (model.active >= model.sheets.length) model.active = model.sheets.length - 1;
        else if (model.active > i) model.active--;
        sel = { r: 0, c: 0 }; selEnd = null;
      });
      renderTabs();
    }
    function duplicateSheet(i) {
      const copy = normalizeSheet(JSON.parse(JSON.stringify(model.sheets[i])), i);
      copy.name = uniqueSheetName(model.sheets[i].name + ' copy');
      copy.charts.forEach((c) => { c.id = 'c' + Math.random().toString(36).slice(2, 9); });
      mutate(() => { model.sheets.splice(i + 1, 0, copy); model.active = i + 1; });
      renderTabs();
    }
    function moveSheet(i, dir) {
      const j = i + dir;
      if (j < 0 || j >= model.sheets.length) return;
      mutate(() => {
        const [s] = model.sheets.splice(i, 1);
        model.sheets.splice(j, 0, s);
        if (model.active === i) model.active = j;
        else if (model.active === j) model.active = i;
      });
      renderTabs();
    }
    function renderTabs() {
      if (!tabsEl) return;
      tabsEl.innerHTML = '';
      const add = document.createElement('button');
      add.type = 'button';
      add.className = 'sheet-tab-add';
      add.title = 'Add sheet (Shift+F11)';
      add.innerHTML = ICON('plus');
      add.addEventListener('click', () => addSheet());
      tabsEl.appendChild(add);
      const list = document.createElement('div');
      list.className = 'sheet-tab-list';
      model.sheets.forEach((s, i) => {
        const tab = document.createElement('button');
        tab.type = 'button';
        tab.className = 'sheet-tab' + (i === model.active ? ' active' : '');
        tab.setAttribute('role', 'tab');
        tab.innerHTML = `<span class="sheet-tab-name">${escapeHtml(s.name)}</span><span class="sheet-tab-more" title="Sheet options">${ICON('chevronDown')}</span>`;
        tab.addEventListener('click', (e) => {
          if (e.target.closest('.sheet-tab-more')) { tabMenu(i, e.target.closest('.sheet-tab-more')); return; }
          switchSheet(i);
        });
        tab.addEventListener('dblclick', async () => {
          const name = await ctx.inputModal('Rename sheet', 'Sheet name', s.name);
          if (name != null) renameSheet(i, name);
        });
        tab.addEventListener('contextmenu', (e) => { e.preventDefault(); tabMenu(i, null, { x: e.clientX, y: e.clientY }); });
        list.appendChild(tab);
      });
      tabsEl.appendChild(list);
      const act = list.querySelector('.sheet-tab.active');
      if (act && act.scrollIntoView) act.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
    function tabMenu(i, anchor, pos) {
      openMenu(anchor, [
        { label: 'Rename…', action: async () => { const n = await ctx.inputModal('Rename sheet', 'Sheet name', model.sheets[i].name); if (n != null) renameSheet(i, n); } },
        { label: 'Duplicate', action: () => duplicateSheet(i) },
        { label: 'Move left', disabled: i === 0, action: () => moveSheet(i, -1) },
        { label: 'Move right', disabled: i === model.sheets.length - 1, action: () => moveSheet(i, 1) },
        { sep: true },
        { label: 'Delete', icon: 'trash', disabled: model.sheets.length < 2, action: () => deleteSheet(i) }
      ], pos);
    }

    /* ---------------- filter popover ---------------- */
    function openFilterMenu(col, anchor) {
      const f = sheet().filter;
      if (!f) return;
      closeMenu();
      const last = filterEnd(f);
      const counts = new Map();
      for (let r = f.r + 1; r <= last; r++) {
        const key = filterKey(r, col);
        if (!counts.has(key)) counts.set(key, displayText(r, col));
      }
      const values = [...counts.entries()].sort((a, b) => {
        if (a[0] === '') return 1; if (b[0] === '') return -1;
        const na = parseNumberText(a[1]), nb = parseNumberText(b[1]);
        if (na != null && nb != null) return na - nb;
        return a[1].localeCompare(b[1]);
      }).slice(0, 1000);
      const hidden = new Set(f.hidden[col] || []);
      const el = document.createElement('div');
      el.className = 'sheet-menu sheet-filter-pop';
      el.innerHTML = `
        <button type="button" class="sheet-menu-item" data-sort="1"><span class="sheet-menu-icon">${ICON('sortAsc')}</span><span class="sheet-menu-label">Sort A → Z</span></button>
        <button type="button" class="sheet-menu-item" data-sort="-1"><span class="sheet-menu-icon">${ICON('sortDesc')}</span><span class="sheet-menu-label">Sort Z → A</span></button>
        <div class="sheet-menu-sep"></div>
        <input type="search" class="sheet-filter-search" placeholder="Search values">
        <label class="sheet-filter-all"><input type="checkbox" data-all> <span>Select all</span></label>
        <div class="sheet-filter-list"></div>
        <div class="sheet-filter-actions"><button type="button" class="btn ghost" data-act="clear">Clear</button><button type="button" class="btn primary" data-act="ok">Apply</button></div>`;
      const listEl = el.querySelector('.sheet-filter-list');
      const allBox = el.querySelector('[data-all]');
      const paint = () => {
        const q = el.querySelector('.sheet-filter-search').value.trim().toLowerCase();
        listEl.innerHTML = '';
        values.forEach(([key, text]) => {
          if (q && !key.includes(q)) return;
          const lab = document.createElement('label');
          lab.innerHTML = `<input type="checkbox" ${hidden.has(key) ? '' : 'checked'}> <span>${escapeHtml(text === '' ? '(Blanks)' : text)}</span>`;
          lab.querySelector('input').addEventListener('change', (e) => { if (e.target.checked) hidden.delete(key); else hidden.add(key); syncAll(); });
          listEl.appendChild(lab);
        });
        syncAll();
      };
      const syncAll = () => { allBox.checked = hidden.size === 0; allBox.indeterminate = hidden.size > 0 && hidden.size < values.length; };
      allBox.addEventListener('change', () => { if (allBox.checked) hidden.clear(); else values.forEach(([k]) => hidden.add(k)); paint(); });
      el.querySelector('.sheet-filter-search').addEventListener('input', paint);
      el.querySelectorAll('[data-sort]').forEach((b) => b.addEventListener('click', () => {
        closeMenu();
        sel = { r: f.r + 1, c: col }; selEnd = null;
        sortSelection(b.dataset.sort === '1');
      }));
      el.querySelector('[data-act="clear"]').addEventListener('click', () => { closeMenu(); mutate(() => { delete f.hidden[col]; }); });
      el.querySelector('[data-act="ok"]').addEventListener('click', () => {
        closeMenu();
        mutate(() => { if (hidden.size) f.hidden[col] = [...hidden]; else delete f.hidden[col]; });
      });
      paint();
      document.body.appendChild(el);
      const r = anchor.getBoundingClientRect();
      el.style.left = Math.min(window.innerWidth - el.offsetWidth - 8, r.left) + 'px';
      el.style.top = Math.min(window.innerHeight - el.offsetHeight - 8, r.bottom + 4) + 'px';
      el.anchor = anchor;
      el.dismiss = (e) => { if (!el.contains(e.target)) closeMenu(); };
      el.onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeMenu(); focusGrid(); } };
      setTimeout(() => {
        if (openMenuEl !== el) return;
        document.addEventListener('mousedown', el.dismiss, true);
        document.addEventListener('keydown', el.onKey, true);
      }, 0);
      openMenuEl = el;
      el.querySelector('.sheet-filter-search').focus();
    }

    /* ---------------- context menu ---------------- */
    function contextMenu(e, zone) {
      const n = selRange();
      const rows = n.r2 - n.r1 + 1, cols = n.c2 - n.c1 + 1;
      const items = [
        { label: 'Cut', icon: 'cut', hint: 'Ctrl+X', action: () => copySelection(true) },
        { label: 'Copy', icon: 'copy', hint: 'Ctrl+C', action: () => copySelection(false) },
        { label: 'Paste', icon: 'paste', hint: 'Ctrl+V', action: () => pasteFromClipboard() },
        { label: 'Paste values only', hint: 'Ctrl+Shift+V', action: () => pasteFromClipboard({ valuesOnly: true }) },
        { sep: true }
      ];
      if (zone !== 'col') {
        items.push({ label: `Insert ${rows > 1 ? rows + ' rows' : 'row'} above`, icon: 'rowAbove', action: () => insertRows('above') });
        items.push({ label: `Insert ${rows > 1 ? rows + ' rows' : 'row'} below`, icon: 'rowBelow', action: () => insertRows('below') });
      }
      if (zone !== 'row') {
        items.push({ label: `Insert ${cols > 1 ? cols + ' columns' : 'column'} left`, icon: 'colLeft', action: () => insertCols('left') });
        items.push({ label: `Insert ${cols > 1 ? cols + ' columns' : 'column'} right`, icon: 'colRight', action: () => insertCols('right') });
      }
      items.push({ sep: true });
      if (zone !== 'col') items.push({ label: `Delete ${rows > 1 ? rows + ' rows' : 'row'}`, icon: 'deleteRow', action: () => deleteRows() });
      if (zone !== 'row') items.push({ label: `Delete ${cols > 1 ? cols + ' columns' : 'column'}`, icon: 'deleteCol', action: () => deleteCols() });
      items.push({ label: 'Clear contents', icon: 'eraser', hint: 'Del', action: () => clearContents() });
      items.push({ sep: true });
      if (zone === 'col') items.push({ label: 'Autofit width', icon: 'autofit', action: () => autofitColumns() });
      items.push({ label: 'Sort A → Z', icon: 'sortAsc', action: () => sortSelection(true) });
      items.push({ label: 'Sort Z → A', icon: 'sortDesc', action: () => sortSelection(false) });
      items.push({ label: mergeAt(sel.r, sel.c) ? 'Unmerge cells' : 'Merge cells', icon: 'merge', disabled: isSingleCell(n) && !mergeAt(sel.r, sel.c), action: () => toggleMerge() });
      items.push({ label: 'Conditional formatting…', icon: 'condFormat', action: () => openCondFormat() });
      items.push({ label: 'Dropdown list…', icon: 'validation', action: () => openValidation() });
      items.push({ label: 'Insert chart', icon: 'chartColumn', action: () => insertChart('column') });
      openMenu(null, items, { x: e.clientX, y: e.clientY });
    }

    /* ---------------- pointer ---------------- */
    function hitTest(clientX, clientY) {
      const vr = viewport.getBoundingClientRect();
      const x = clientX - vr.left, y = clientY - vr.top;
      const lay = ensureLayout();
      const { fr, fc } = frozen();
      const hw = HW(), hh = HH();
      const fw = lay.colPos[fc], fh = lay.rowPos[fr];
      const colAtX = (px) => {
        const local = px - hw;
        const p = local < fw ? local : lay.colPos[fc] + (local - fw) + gridScroll.scrollLeft;
        return Math.min(lay.nCols - 1, bsearch(lay.colPos, lay.nCols, p));
      };
      const rowAtY = (py) => {
        const local = py - hh;
        const p = local < fh ? local : lay.rowPos[fr] + (local - fh) + gridScroll.scrollTop;
        let r = Math.min(lay.nRows - 1, bsearch(lay.rowPos, lay.nRows, p));
        while (r > 0 && lay.rowPos[r + 1] - lay.rowPos[r] <= 0) r--;
        return r;
      };
      if (x < hw && y < hh) return { zone: 'corner', x, y };
      if (y < hh) {
        const c = colAtX(Math.max(hw, x));
        const left = screenX(c), right = left + (lay.colPos[c + 1] - lay.colPos[c]);
        if (Math.abs(x - right) <= 4) return { zone: 'colResize', c, x, y };
        if (Math.abs(x - left) <= 3 && c > 0) return { zone: 'colResize', c: c - 1, x, y };
        return { zone: 'col', c, x, y };
      }
      if (x < hw) {
        const r = rowAtY(Math.max(hh, y));
        const top = screenY(r), bottom = top + (lay.rowPos[r + 1] - lay.rowPos[r]);
        if (Math.abs(y - bottom) <= 3) return { zone: 'rowResize', r, x, y };
        if (Math.abs(y - top) <= 2 && r > 0) return { zone: 'rowResize', r: r - 1, x, y };
        return { zone: 'row', r, x, y };
      }
      return { zone: 'cell', r: rowAtY(y), c: colAtX(x), x, y };
    }

    let dragState = null;
    let autoScrollTimer = 0;
    function stopAutoScroll() { if (autoScrollTimer) { clearInterval(autoScrollTimer); autoScrollTimer = 0; } }
    function beginDrag(onMove, onUp) {
      let lastEvent = null;
      const move = (ev) => {
        lastEvent = ev;
        onMove(ev);
        const vr = viewport.getBoundingClientRect();
        const out = ev.clientY > vr.bottom - 6 || ev.clientY < vr.top + HH() || ev.clientX > vr.right - 6 || ev.clientX < vr.left + HW();
        if (out && !autoScrollTimer) {
          autoScrollTimer = setInterval(() => {
            if (!lastEvent) return;
            const r = viewport.getBoundingClientRect();
            const e2 = lastEvent;
            if (e2.clientY > r.bottom - 6) gridScroll.scrollTop += 24;
            else if (e2.clientY < r.top + HH()) gridScroll.scrollTop -= 24;
            if (e2.clientX > r.right - 6) gridScroll.scrollLeft += 30;
            else if (e2.clientX < r.left + HW()) gridScroll.scrollLeft -= 30;
            onMove(e2);
          }, 40);
        } else if (!out) stopAutoScroll();
      };
      const up = (ev) => {
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
        stopAutoScroll();
        dragCleanup = null;
        onUp(ev);
      };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
      dragCleanup = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); stopAutoScroll(); };
    }

    function onViewportMouseDown(e) {
      if (e.button === 2) {
        const h = hitTest(e.clientX, e.clientY);
        if (h.zone === 'cell' && !inRange(selRange(), h.r, h.c)) select(h.r, h.c, false);
        if (h.zone === 'col' && !(selRange().c1 <= h.c && h.c <= selRange().c2 && selRange().r1 === 0)) selectRange(0, h.c, ensureLayout().nRows - 1, h.c);
        if (h.zone === 'row' && !(selRange().r1 <= h.r && h.r <= selRange().r2 && selRange().c1 === 0)) selectRange(h.r, 0, h.r, ensureLayout().nCols - 1);
        return;
      }
      if (e.button !== 0) return;
      const fbtn = e.target.closest && e.target.closest('.sheet-fbtn');
      if (fbtn) { e.preventDefault(); openFilterMenu(+fbtn.dataset.fcol, fbtn); return; }
      const vbtn = e.target.closest && e.target.closest('.sheet-vbtn');
      if (vbtn) { e.preventDefault(); openValidationList(); return; }
      if (e.target === editorEl) return;
      const h = hitTest(e.clientX, e.clientY);
      const lay = ensureLayout();

      // pointing at cells while typing a formula
      if (editing && h.zone === 'cell' && pointable()) {
        e.preventDefault();
        const start = { r: h.r, c: h.c };
        insertPointRef(h.r, h.c, h.r, h.c);
        beginDrag((ev) => {
          const hh2 = hitTest(ev.clientX, ev.clientY);
          if (hh2.zone === 'cell') insertPointRef(start.r, start.c, hh2.r, hh2.c);
        }, () => { editInput().focus(); });
        return;
      }
      if (editing) { if (!commitEdit({ keepFocus: true })) { e.preventDefault(); return; } }
      e.preventDefault();
      focusGrid();

      if (h.zone === 'colResize' || h.zone === 'rowResize') {
        const isCol = h.zone === 'colResize';
        const idx = isCol ? h.c : h.r;
        const start = isCol ? e.clientX : e.clientY;
        const orig = isCol ? colWidthRaw(idx) : rowHeightRaw(idx);
        const targets = (() => {
          const rg = selRange();
          if (isCol && rg.r1 === 0 && rg.r2 >= lay.nRows - 1 && idx >= rg.c1 && idx <= rg.c2) return Array.from({ length: rg.c2 - rg.c1 + 1 }, (_, i) => rg.c1 + i);
          if (!isCol && rg.c1 === 0 && rg.c2 >= lay.nCols - 1 && idx >= rg.r1 && idx <= rg.r2) return Array.from({ length: rg.r2 - rg.r1 + 1 }, (_, i) => rg.r1 + i);
          return [idx];
        })();
        if (e.detail === 2) {
          if (isCol) mutate(() => targets.forEach((c) => autofitColumn(c)));
          else mutate(() => targets.forEach((r) => { delete sheet().rowHeights[r]; }));
          return;
        }
        viewport.classList.add(isCol ? 'resizing-col' : 'resizing-row');
        let moved = false;
        beginDrag((ev) => {
          moved = true;
          const d = ((isCol ? ev.clientX : ev.clientY) - start) / zoom;
          const size = Math.round(Math.max(isCol ? 24 : 12, Math.min(isCol ? 1200 : 600, orig + d)));
          targets.forEach((t) => { if (isCol) sheet().colWidths[t] = size; else sheet().rowHeights[t] = size; });
          invalidateLayout();
          renderNow();
          positionCharts();
        }, () => {
          viewport.classList.remove('resizing-col', 'resizing-row');
          if (moved) { autoHeights = null; invalidateLayout(); ctx.markDirty(); recordSheet(); renderNow(); }
        });
        return;
      }
      if (h.zone === 'corner') { selectRange(0, 0, lay.nRows - 1, lay.nCols - 1, false); return; }
      if (h.zone === 'col') {
        const anchorC = e.shiftKey ? sel.c : h.c;
        selectRange(0, anchorC, lay.nRows - 1, h.c, false);
        sel = { r: 0, c: anchorC };
        beginDrag((ev) => {
          const hh2 = hitTest(ev.clientX, Math.max(ev.clientY, viewport.getBoundingClientRect().top + HH() + 2));
          if (hh2.c != null) { selEnd = { r: ensureLayout().nRows - 1, c: hh2.c }; afterSelection(); }
        }, () => {});
        return;
      }
      if (h.zone === 'row') {
        const anchorR = e.shiftKey ? sel.r : h.r;
        selectRange(anchorR, 0, h.r, lay.nCols - 1, false);
        beginDrag((ev) => {
          const hh2 = hitTest(Math.max(ev.clientX, viewport.getBoundingClientRect().left + HW() + 2), ev.clientY);
          if (hh2.r != null) { selEnd = { r: hh2.r, c: ensureLayout().nCols - 1 }; afterSelection(); }
        }, () => {});
        return;
      }
      if (h.zone !== 'cell') return;

      // the fill handle
      const handle = e.target.closest && e.target.closest('.sov-handle');
      if (handle) {
        if (e.detail === 2) { autoFillDown(); return; }
        const src = selRange();
        fillDrag = { src, target: null };
        beginDrag((ev) => {
          const hh2 = hitTest(ev.clientX, ev.clientY);
          if (hh2.zone !== 'cell') return;
          const t = { ...src };
          const downBy = hh2.r - src.r2, upBy = src.r1 - hh2.r, rightBy = hh2.c - src.c2, leftBy = src.c1 - hh2.c;
          const vert = Math.max(downBy, upBy), horiz = Math.max(rightBy, leftBy);
          if (vert <= 0 && horiz <= 0) fillDrag.target = null;
          else if (vert >= horiz) { if (downBy > 0) t.r2 = hh2.r; else t.r1 = hh2.r; fillDrag.target = t; }
          else { if (rightBy > 0) t.c2 = hh2.c; else t.c1 = hh2.c; fillDrag.target = t; }
          renderNow();
        }, (ev) => {
          const t = fillDrag && fillDrag.target;
          fillDrag = null;
          if (t) {
            fillRange(src, t, { copy: ev && ev.ctrlKey });
            selectRange(t.r1, t.c1, t.r2, t.c2);
          } else renderNow();
        });
        return;
      }

      if (e.shiftKey) selectRange(sel.r, sel.c, h.r, h.c);
      else if (e.detail === 2) {
        select(h.r, h.c, false);
        beginEdit(null, { mode: 'edit' });
        return;
      } else select(h.r, h.c, false);
      const anchor = { r: sel.r, c: sel.c };
      beginDrag((ev) => {
        const hh2 = hitTest(ev.clientX, ev.clientY);
        if (hh2.zone === 'cell' || hh2.zone === 'col' || hh2.zone === 'row') {
          const r = hh2.r != null ? hh2.r : sel.r, c = hh2.c != null ? hh2.c : sel.c;
          if (!selEnd || selEnd.r !== r || selEnd.c !== c) {
            sel = anchor;
            selEnd = (r === anchor.r && c === anchor.c) ? null : { r, c };
            growFor(r, c);
            afterSelection();
          }
        }
      }, () => {
        if (painter && !painter.pending) applyPainter();
      });
    }
    let fillDrag = null;

    function onViewportMouseMove(e) {
      if (dragCleanup) return;
      const h = hitTest(e.clientX, e.clientY);
      let cursor = '';
      if (h.zone === 'colResize') cursor = 'col-resize';
      else if (h.zone === 'rowResize') cursor = 'row-resize';
      else if (h.zone === 'col') cursor = 's-resize';
      else if (h.zone === 'row') cursor = 'e-resize';
      else if (h.zone === 'cell' && editing && pointable()) cursor = 'copy';
      viewport.style.cursor = cursor;
    }

    /* ---------------- keyboard ---------------- */
    function onGridKeydown(e) {
      if (e.target !== gridScroll) return;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key;
      const low = key.length === 1 ? key.toLowerCase() : key;
      const lay = ensureLayout();
      const move = (dr, dc) => {
        e.preventDefault();
        if (mod) {
          const from = e.shiftKey && selEnd ? selEnd : sel;
          const to = jumpFrom(from.r, from.c, dr, dc);
          if (e.shiftKey) selectRange(sel.r, sel.c, to.r, to.c, true);
          else select(to.r, to.c);
          return;
        }
        if (e.shiftKey) {
          const from = selEnd || sel;
          const to = stepFrom(from.r, from.c, dr, dc);
          selectRange(sel.r, sel.c, to.r, to.c, true);
        } else {
          const to = stepFrom(sel.r, sel.c, dr, dc);
          select(to.r, to.c);
        }
      };
      switch (key) {
        case 'ArrowUp': return move(-1, 0);
        case 'ArrowDown':
          if (e.altKey) { const v = validationAt(sel.r, sel.c); if (v && v.type === 'list') { e.preventDefault(); openValidationList(); return; } }
          return move(1, 0);
        case 'ArrowLeft': return move(0, -1);
        case 'ArrowRight': return move(0, 1);
        case 'PageDown': case 'PageUp': {
          e.preventDefault();
          const rows = Math.max(1, Math.floor(gridScroll.clientHeight / (DEFAULT_ROW_HEIGHT * zoom)) - 1);
          const d = key === 'PageDown' ? rows : -rows;
          if (e.altKey) { const t = Math.max(0, sel.c + (d > 0 ? 8 : -8)); select(sel.r, t); return; }
          gridScroll.scrollTop += d * DEFAULT_ROW_HEIGHT * zoom;
          if (e.shiftKey) selectRange(sel.r, sel.c, Math.max(0, (selEnd || sel).r + d), (selEnd || sel).c, true);
          else select(Math.max(0, sel.r + d), sel.c);
          return;
        }
        case 'Home':
          e.preventDefault();
          if (mod) select(0, 0); else if (e.shiftKey) selectRange(sel.r, sel.c, (selEnd || sel).r, 0, true); else select(sel.r, 0);
          return;
        case 'End':
          if (mod) { e.preventDefault(); const u = engine.usedBounds(model.active); select(Math.max(0, u.r), Math.max(0, u.c)); }
          return;
        case 'Enter': {
          e.preventDefault();
          if (!isSingleCell(selRange())) { moveWithinSelection(e.shiftKey ? -1 : 1, 0); return; }
          const to = stepFrom(sel.r, sel.c, e.shiftKey ? -1 : 1, 0);
          select(to.r, to.c);
          return;
        }
        case 'Tab': {
          e.preventDefault();
          if (!isSingleCell(selRange())) { moveWithinSelection(0, e.shiftKey ? -1 : 1); return; }
          const to = stepFrom(sel.r, sel.c, 0, e.shiftKey ? -1 : 1);
          select(to.r, to.c);
          return;
        }
        case 'F2': e.preventDefault(); beginEdit(null, { mode: 'edit' }); return;
        case 'F9': e.preventDefault(); recalc(); renderNow(); renderCharts(); return;
        case 'F11': if (e.shiftKey) { e.preventDefault(); addSheet(); } return;
        case 'F3': if (e.shiftKey) { e.preventDefault(); openFunctionWizard(); } return;
        case 'Delete': case 'Backspace':
          e.preventDefault();
          if (key === 'Backspace' && isSingleCell(selRange())) { clearContents(); beginEdit('', { mode: 'enter' }); return; }
          clearContents();
          return;
        case 'Escape':
          if (clip || marching || painter) { e.preventDefault(); marching = false; painter = null; renderNow(); syncRibbon(); }
          return;
        case 'ContextMenu': {
          e.preventDefault();
          const rc = cellRect(sel.r, sel.c), vr = viewport.getBoundingClientRect();
          contextMenu({ clientX: vr.left + rc.x + rc.w / 2, clientY: vr.top + rc.y + rc.h }, 'cell');
          return;
        }
        default: break;
      }
      if (mod) {
        if (e.shiftKey && low === 'l') { e.preventDefault(); toggleFilter(); return; }
        if (e.shiftKey && (low === 'v')) { e.preventDefault(); pasteFromClipboard({ valuesOnly: true }); return; }
        if (e.shiftKey && (key === '%' || e.code === 'Digit5')) { e.preventDefault(); setNumFmt('0%'); return; }
        if (e.shiftKey && (key === '$' || e.code === 'Digit4')) { e.preventDefault(); setNumFmt('"$"#,##0.00'); return; }
        if (e.shiftKey && (key === '!' || e.code === 'Digit1')) { e.preventDefault(); setNumFmt('#,##0.00'); return; }
        if (e.shiftKey && (key === '~' || e.code === 'Backquote')) { e.preventDefault(); setNumFmt(''); return; }
        if (e.shiftKey && (key === '+' || key === '=')) { e.preventDefault(); insertRows('above'); return; }
        if (e.shiftKey) {
          // Ctrl+Shift+Space / arrows handled above
          if (key === ' ') { e.preventDefault(); selectRange(0, 0, lay.nRows - 1, lay.nCols - 1); }
          return;
        }
        switch (low) {
          case 'c': e.preventDefault(); copySelection(false); return;
          case 'x': e.preventDefault(); copySelection(true); return;
          case 'v': e.preventDefault(); pasteFromClipboard(); return;
          case 'a': e.preventDefault(); selectRange(0, 0, lay.nRows - 1, lay.nCols - 1); return;
          case 'b': e.preventDefault(); toggleFaceFlag('bold'); return;
          case 'i': e.preventDefault(); toggleFaceFlag('italic'); return;
          case 'u': e.preventDefault(); toggleStyle('underline'); return;
          case '5': e.preventDefault(); toggleStyle('strike'); return;
          case 'd': e.preventDefault(); fillDown(); return;
          case 'r': e.preventDefault(); fillRight(); return;
          case 'h': e.preventDefault(); openFindModal(true); return;
          case ';': e.preventDefault(); insertNow('date'); return;
          case '`': e.preventDefault(); toggleShowFormulas(); return;
          case '-': if (e.altKey) return; break;
          case ' ': e.preventDefault(); selectRange(0, sel.c, lay.nRows - 1, (selEnd || sel).c); return;
          case 'enter': break;
          default: break;
        }
        return;
      }
      if (e.altKey && (key === '=' )) { e.preventDefault(); autoSum('SUM'); return; }
      if (e.shiftKey && key === ' ') { e.preventDefault(); selectRange(sel.r, 0, (selEnd || sel).r, lay.nCols - 1); return; }
      if (key.length === 1 && !e.altKey && !e.metaKey) {
        e.preventDefault();
        beginEdit(key, { mode: 'enter' });
      }
    }

    /* ---------------- undo / redo ---------------- */
    function undo() {
      if (editing) { cancelEdit(); return; }
      history.undo(restoreSheet);
    }
    function redo() {
      if (editing) commitEdit({ keepFocus: true, force: true });
      history.redo(restoreSheet);
    }

    /* ---------------- mount ---------------- */
    function buildDom(host) {
      hostEl = host;
      host.innerHTML = `
        <div class="sheet-wrap">
          <div class="sheet-bar">
            <button type="button" class="sheet-home-btn" title="Back to home">${ICON('home')}</button>
            <div class="sheet-namebox" contenteditable="plaintext-only" spellcheck="false" role="textbox" aria-label="Name box — type a cell or range and press Enter" title="Go to a cell or range (type B12 or A1:D20, then Enter)">A1</div>
            <span class="sheet-bar-sep"></span>
            <button type="button" class="sheet-fx-btn" title="Insert function (Shift+F3)">${ICON('fx')}</button>
            <textarea class="sheet-formula" rows="1" spellcheck="false" aria-label="Formula bar" placeholder="Type a value or a formula such as =SUM(A1:A10)"></textarea>
          </div>
          <div class="sheet-grid-scroll" tabindex="0" role="grid" aria-label="Spreadsheet grid">
            <div class="sheet-viewport">
              <div class="sheet-quad q-main"></div>
              <div class="sheet-quad q-left"></div>
              <div class="sheet-quad q-top"></div>
              <div class="sheet-quad q-corner"></div>
              <div class="sheet-hdr h-col-s"></div>
              <div class="sheet-hdr h-col-f"></div>
              <div class="sheet-hdr h-row-s"></div>
              <div class="sheet-hdr h-row-f"></div>
              <div class="sheet-hdr h-corner" title="Select all (Ctrl+A)"></div>
              <div class="sheet-freeze-line fl-r"></div>
              <div class="sheet-freeze-line fl-c"></div>
              <div class="sheet-charts"></div>
              <textarea class="sheet-editor" spellcheck="false" hidden aria-label="Cell editor"></textarea>
            </div>
            <div class="sheet-sizer"></div>
          </div>
          <div class="sheet-tabs" role="tablist"></div>
          <div class="sheet-ac" hidden role="listbox"></div>
          <div class="sheet-sig" hidden></div>
        </div>`;
      wrapEl = host.querySelector('.sheet-wrap');
      nameBox = host.querySelector('.sheet-namebox');
      fxBtn = host.querySelector('.sheet-fx-btn');
      formulaInput = host.querySelector('.sheet-formula');
      gridScroll = host.querySelector('.sheet-grid-scroll');
      viewport = host.querySelector('.sheet-viewport');
      sizer = host.querySelector('.sheet-sizer');
      tabsEl = host.querySelector('.sheet-tabs');
      editorEl = host.querySelector('.sheet-editor');
      chartLayer = host.querySelector('.sheet-charts');
      acPop = host.querySelector('.sheet-ac');
      sigPop = host.querySelector('.sheet-sig');
      quads = { main: host.querySelector('.q-main'), left: host.querySelector('.q-left'), top: host.querySelector('.q-top'), corner: host.querySelector('.q-corner') };
      hdrs = { colS: host.querySelector('.h-col-s'), colF: host.querySelector('.h-col-f'), rowS: host.querySelector('.h-row-s'), rowF: host.querySelector('.h-row-f'), corner: host.querySelector('.h-corner') };
    }

    function wire() {
      host('.sheet-home-btn').addEventListener('click', () => { const el = document.getElementById('btn-home'); if (el) el.click(); });
      viewport.addEventListener('mousedown', onViewportMouseDown);
      viewport.addEventListener('mousemove', onViewportMouseMove);
      viewport.addEventListener('contextmenu', (e) => {
        if (e.target.closest('.sheet-chart') || e.target === editorEl) return;
        e.preventDefault();
        const h = hitTest(e.clientX, e.clientY);
        contextMenu(e, h.zone === 'col' ? 'col' : h.zone === 'row' ? 'row' : 'cell');
      });
      gridScroll.addEventListener('keydown', onGridKeydown);
      gridScroll.addEventListener('scroll', () => {
        const lay = ensureLayout();
        const nearBottom = gridScroll.scrollHeight - gridScroll.scrollTop - gridScroll.clientHeight < 300;
        const nearRight = gridScroll.scrollWidth - gridScroll.scrollLeft - gridScroll.clientWidth < 300;
        if (nearBottom && lay.nRows < MAX_ROWS) { minRows = Math.min(MAX_ROWS, lay.nRows + 200); invalidateLayout(); }
        if (nearRight && lay.nCols < MAX_COLS) { minCols = Math.min(MAX_COLS, lay.nCols + 10); invalidateLayout(); }
        closeAutocomplete();
        scheduleRender();
      }, { passive: true });
      gridScroll.addEventListener('wheel', (e) => {
        if (!(e.ctrlKey || e.metaKey)) return;
        e.preventDefault();
        zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1);
      }, { passive: false });
      gridScroll.addEventListener('dblclick', (e) => { if (e.target.closest('.sheet-chart')) e.stopPropagation(); });

      editorEl.addEventListener('input', () => syncEditText(editorEl));
      editorEl.addEventListener('keydown', (e) => editorKeydown(e, editorEl));
      editorEl.addEventListener('click', () => { if (editing) { editing.mode = 'edit'; updateAutocomplete(); } });
      editorEl.addEventListener('blur', () => {
        // leaving for somewhere other than the formula bar or a popup commits
        setTimeout(() => {
          if (!editing || destroyed) return;
          const a = document.activeElement;
          if (a === editorEl || a === formulaInput || (a && a.closest && (a.closest('.sheet-ac') || a.closest('#modal-backdrop') || a.closest('.sheet-menu') || a.closest('.sheet-ribbon')))) return;
          if (a === gridScroll) return;
          commitEdit({ keepFocus: true });
        }, 0);
      });

      formulaInput.addEventListener('focus', () => {
        if (!editing) {
          beginEdit(null, { source: 'bar', mode: 'edit' });
        } else if (editing.source !== 'bar') {
          editing.source = 'bar';
        }
      });
      formulaInput.addEventListener('input', () => {
        if (!editing) beginEdit(formulaInput.value, { source: 'bar', mode: 'edit' });
        syncEditText(formulaInput);
      });
      formulaInput.addEventListener('keydown', (e) => editorKeydown(e, formulaInput));
      formulaInput.addEventListener('click', () => updateAutocomplete());
      formulaInput.addEventListener('keyup', (e) => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) updateAutocomplete(); });
      formulaInput.addEventListener('blur', () => {
        setTimeout(() => {
          if (!editing || destroyed || editing.source !== 'bar') return;
          const a = document.activeElement;
          if (a === formulaInput || (a && a.closest && (a.closest('#modal-backdrop') || a.closest('.sheet-menu') || a.closest('.sheet-ribbon')))) return;
          commitEdit({ keepFocus: a === gridScroll ? false : true });
        }, 0);
      });
      acPop.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const it = e.target.closest('.sheet-ac-item');
        if (it) acceptAutocomplete(it.dataset.name);
      });

      nameBox.addEventListener('focus', () => {
        const range = document.createRange();
        range.selectNodeContents(nameBox);
        const s = window.getSelection(); s.removeAllRanges(); s.addRange(range);
      });
      nameBox.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const txt = nameBox.textContent.trim();
          let target = txt, sheetIdx = model.active;
          const bang = txt.lastIndexOf('!');
          if (bang > 0) {
            const idx = engine.sheetIndex(txt.slice(0, bang).replace(/^'|'$/g, ''), model.active);
            if (idx >= 0) sheetIdx = idx;
            target = txt.slice(bang + 1);
          }
          const rg = parseA1Range(target);
          if (!rg) { ctx.toast(`"${txt}" isn't a cell or range`, 'error'); nameBox.textContent = rangeLabel(selRange()); focusGrid(); return; }
          if (sheetIdx !== model.active) switchSheet(sheetIdx);
          selectRange(rg.r1, rg.c1, rg.r2, rg.c2, true);
          scrollIntoView(rg.r1, rg.c1);
          focusGrid();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          nameBox.textContent = rangeLabel(selRange());
          focusGrid();
        }
        e.stopPropagation();
      });
      nameBox.addEventListener('blur', () => { nameBox.textContent = rangeLabel(selRange()); });
      fxBtn.addEventListener('click', () => openFunctionWizard());

      if (window.ResizeObserver) {
        resizeObs = new ResizeObserver(() => { scheduleRender(); });
        resizeObs.observe(gridScroll);
      }
      const onWinResize = () => scheduleRender();
      window.addEventListener('resize', onWinResize);
      cleanups.push(() => window.removeEventListener('resize', onWinResize));
    }
    function host(sel2) { return hostEl.querySelector(sel2); }

    async function loadSystemFonts() {
      try {
        const catalog = await FONTS.loadSystemFonts();
        if (destroyed) return;
        fontFacesByFamily = catalog.facesByFamily;
        FONTS.fillFamilySelect(fontSelect, catalog.families);
        measureCache.clear();
        syncRibbon();
        renderNow();
      } catch {}
    }

    /* ---------------- data out ---------------- */
    function resultOf(v) {
      if (v == null) return '';
      if (isErr(v)) return { error: v.code };
      return v;
    }
    let dataMemo = null;
    function getData() {
      if (editing) commitEdit({ keepFocus: true, force: true });
      // Nothing changed since the last call (a draft save right after a
      // thumbnail, say): the computed half is still good.
      const memo = dataMemo && dataMemo.gen === recalcCount && dataMemo.sheets === model.sheets ? dataMemo : null;
      const out = model.sheets.map((sh, s) => {
        if (memo && memo.parts[s] && memo.parts[s].src === sh) return { ...memo.parts[s].data, name: sh.name, styles: sh.styles, colWidths: sh.colWidths, rowHeights: sh.rowHeights, charts: sh.charts, freeze: sh.freeze, filter: sh.filter, merges: sh.merges.map(rangeName), condFormats: sh.condFormats.map((c) => ({ ...c, range: rangeName(c.range) })), validations: sh.validations.map((v) => ({ ...v, range: rangeName(v.range) })), hideGrid: sh.hideGrid || undefined };
        const rows = sh.rows.map((row) => {
          const r = (row || []).map((v) => (v == null ? '' : v));
          while (r.length && r[r.length - 1] === '') r.pop();
          return r;
        });
        while (rows.length && rows[rows.length - 1].length === 0) rows.pop();
        const results = {}, display = {};
        rows.forEach((row, r) => row.forEach((raw, c) => {
          if (raw === '') return;
          const isF = raw[0] === '=';
          let v;
          try { v = engine.val(s, r, c); } catch { v = ERR.ERROR; }
          if (isF) results[r + ',' + c] = resultOf(v);
          const st = sh.styles[r + ',' + c];
          const code = (st && st.numFmt) || (isF ? impliedFormat(raw) : '');
          if (isF || code) {
            const text = (!isF && !code) ? raw : formatValue(v, code).text;
            if (text !== raw) display[r + ',' + c] = text;
          }
        }));
        return {
          name: sh.name,
          rows,
          styles: sh.styles,
          colWidths: sh.colWidths,
          rowHeights: sh.rowHeights,
          charts: sh.charts,
          merges: sh.merges.map(rangeName),
          freeze: sh.freeze,
          condFormats: sh.condFormats.map((c) => ({ ...c, range: rangeName(c.range) })),
          validations: sh.validations.map((v) => ({ ...v, range: rangeName(v.range) })),
          filter: sh.filter,
          hideGrid: sh.hideGrid || undefined,
          results,
          display
        };
      });
      dataMemo = { gen: recalcCount, sheets: model.sheets, parts: out.map((d, i) => ({ src: model.sheets[i], data: { rows: d.rows, results: d.results, display: d.display } })) };
      return { sheets: out, active: model.active };
    }

    const api = {
      kind: 'sheet',
      mount(hostNode, doc) {
        const src = doc && doc.sheets && doc.sheets.length ? doc.sheets : [{ name: 'Sheet1' }];
        model = {
          sheets: src.map((s, i) => normalizeSheet(s, i)),
          active: Math.max(0, Math.min((doc && doc.active) || 0, src.length - 1))
        };
        /* Every undo step is a full snapshot, so a very large workbook keeps
           fewer of them rather than holding hundreds of megabytes. */
        const cellCount = model.sheets.reduce((n, sh) => n + sh.rows.reduce((m, row) => m + (row ? row.length : 0), 0), 0);
        history = window.MargoHistory.create({ limit: Math.max(12, Math.min(80, Math.floor(3e6 / Math.max(1, cellCount)))) });
        buildRibbon();
        buildDom(hostNode);
        wire();
        if (ctx.status) {
          ctx.status.setKind('Spreadsheet');
          ctx.status.showZoom(true);
          ctx.status.setZoom(zoom, ZOOM_MIN, ZOOM_MAX);
          ctx.status.onZoom((z) => setZoomLevel(z));
        }
        recalc();
        renderTabs();
        renderNow();
        renderCharts();
        updateChrome();
        history.seed(captureSheet());
        loadSystemFonts();
        requestAnimationFrame(() => { renderNow(); focusGrid(); });
        setTimeout(() => { renderNow(); focusGrid(); }, 60);
      },
      getData,
      focus() { focusGrid(); },
      destroy() {
        destroyed = true;
        closeMenu();
        closeAutocomplete();
        try { PICKER.close(); } catch {}
        if (dragCleanup) dragCleanup();
        stopAutoScroll();
        if (rafId) cancelAnimationFrame(rafId);
        if (resizeObs) resizeObs.disconnect();
        cleanups.forEach((fn) => { try { fn(); } catch {} });
        chartEls.clear();
      },
      commands: {
        undo,
        redo,
        canUndo: () => history.canUndo(),
        canRedo: () => history.canRedo(),
        copy: () => copySelection(false),
        cut: () => copySelection(true),
        paste: (t) => { if (t == null) { pasteFromClipboard(); return; } pasteData({ text: String(t) }); },
        pasteValues: () => pasteFromClipboard({ valuesOnly: true }),
        find: () => openFindModal(false),
        replace: () => openFindModal(true),
        zoomIn: () => zoomBy(1.1),
        zoomOut: () => zoomBy(1 / 1.1),
        zoomReset: () => setZoomLevel(1),
        setZoom: (z) => setZoomLevel(z),
        insertChart,
        insertFx: () => openFunctionWizard(),
        sortAsc: () => sortSelection(true),
        sortDesc: () => sortSelection(false),
        toggleFilter,
        conditionalFormat: openCondFormat,
        dataValidation: openValidation,
        freezeTopRow: () => setFreeze(1, 0),
        freezeFirstColumn: () => setFreeze(0, 1),
        unfreeze: () => setFreeze(0, 0),
        insertRowAbove: () => insertRows('above'),
        insertColumnLeft: () => insertCols('left'),
        deleteRows,
        deleteColumns: deleteCols,
        mergeCells: toggleMerge,
        increaseFontSize: () => stepFontSize(1),
        decreaseFontSize: () => stepFontSize(-1),
        setColWidth: (w) => mutate(() => { sheet().colWidths[sel.c] = Math.max(24, Math.min(1200, w)); }),
        setRowHeight: (h) => mutate(() => { sheet().rowHeights[sel.r] = Math.max(12, Math.min(600, h)); }),
        status: () => statusText()
      },
      /* test hooks */
      _test: {
        setCell: (r, c, v) => { mutate(() => { putRaw(sheet(), r, c, normalizeEntry(v)); }); },
        getCell: (r, c) => getRaw(r, c),
        getFormatted: (r, c) => displayText(r, c),
        getValue: (r, c) => { const v = display(r, c).value; return isErr(v) ? v.code : v; },
        getStyle: (r, c) => getStyle(r, c),
        setColWidth: (c, w) => mutate(() => { sheet().colWidths[c] = w; }),
        getColWidth: (c) => colWidthRaw(c),
        setRowHeight: (r, h) => mutate(() => { sheet().rowHeights[r] = h; }),
        getRowHeight: (r) => rowHeightRaw(r),
        setFontSize: (size) => applyStyle({ size }),
        applyStyle: (patch) => applyStyle(patch),
        setNumFmt: (code) => setNumFmt(code),
        addSheet: () => addSheet(),
        switchSheet: (i) => switchSheet(i),
        renameSheet: (i, n) => renameSheet(i, n),
        evalFormula: (expr, r, c) => { const v = scalar(engine.evaluate(expr, model.active, r || 0, c || 0), { val: engine.val, usedBounds: engine.usedBounds, sheet: model.active, r: r || 0, c: c || 0 }); return isErr(v) ? v.code : v; },
        select: (r, c) => select(r, c),
        selectRange: (r1, c1, r2, c2) => selectRange(r1, c1, r2, c2),
        recalcCount: () => recalcCount,
        autoSum: (fn) => autoSum(fn),
        sortRange: (asc) => sortSelection(asc),
        sortRangeCells: (startR, endR, col, asc) => { selectRange(startR, col, endR, col); sortSelection(asc); },
        insertRows: (where) => insertRows(where),
        insertCols: (where) => insertCols(where),
        deleteRows: () => deleteRows(),
        deleteCols: () => deleteCols(),
        fill: (src, target) => fillRange(parseA1Range(src), parseA1Range(target)),
        merge: () => toggleMerge(),
        mergeAt: (r, c) => mergeAt(r, c),
        freeze: (r, c) => setFreeze(r, c),
        copy: (cut) => copySelection(!!cut),
        pasteInternal: (valuesOnly) => { if (clip) pasteInternal({ valuesOnly: !!valuesOnly }); },
        pasteHtml: (html) => pasteData({ html, text: '' }),
        addCondFormat: (rule) => mutate(() => { sheet().condFormats.push({ ...rule, range: toRangeObj(rule.range) }); }),
        cellCss: (r, c) => cfStyleFor(r, c),
        addValidation: (rule) => mutate(() => { sheet().validations.push({ ...rule, range: toRangeObj(rule.range) }); }),
        typeInto: (r, c, text) => { select(r, c); beginEdit(text, { mode: 'enter' }); const ok = commitEdit({ keepFocus: true }); if (!ok) cancelEdit(); return ok; },
        undo: () => undo(),
        redo: () => redo(),
        status: () => statusText(),
        insertChart: (t) => insertChart(t),
        chartCount: () => sheet().charts.length,
        renderedCells: () => viewport.querySelectorAll('.sc').length,
        toggleFilter: () => toggleFilter(),
        setFilterHidden: (col, values) => mutate(() => { if (sheet().filter) sheet().filter.hidden[col] = values; }),
        rowHidden: (r) => hiddenRows().has(r),
        autocomplete: (text) => { select(sel.r, sel.c); beginEdit(text, { mode: 'enter' }); updateAutocomplete(); const items = acItems.slice(); cancelEdit(); return items; },
        engine: () => engine,
        replaceRows: (rows) => mutate(() => { sheet().rows = rows; }, { noHistory: true })
      }
    };
    return api;
  }

  window.MargoEditors = window.MargoEditors || {};
  window.MargoEditors.sheet = create;
  window.MargoSheetEngine = {
    colName, colIndex, parseA1Range, parseLiteral, parseNumberText, formatGeneral, formatValue,
    stepFormatDecimals, legacyFormatCode, tokenize, parse, offsetFormula, shiftFormula,
    renameSheetInFormula, moveRefsInFormula, formulaRefs, createEngine, FN, dateSerial, ERR
  };
})();
