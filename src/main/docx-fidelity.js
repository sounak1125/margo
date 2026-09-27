/* Margo — Word document fidelity passes.

   html-to-docx (export) and mammoth (import) each drop a good share of what a
   word processor needs to keep: highlights, the space between two formatted
   words, page breaks, paragraph spacing, quote/title/code styles, header
   rows, table borders, alt text, image sizes, checklists and horizontal
   rules. Rather than replace either library, the export side marks what it
   needs in the HTML with private-use "fence" characters that html-to-docx
   carries through untouched as run text, and a pass over the finished
   document.xml turns each fence into the WordprocessingML it stands for.
   The import side reads the same properties back out of the XML and matches
   them to mammoth's HTML by document order - and only when the counts agree,
   so the failure mode is losing a property, never putting it on the wrong
   element. */
const JSZip = require('jszip');

let domino = null;
function dom() {
  if (domino === null) {
    try { domino = require('@mixmark-io/domino'); } catch { domino = false; }
  }
  return domino || null;
}

/* ---------------- fences ---------------- */

const SPACE = '\uE005';
const TAB = '\uE006';
const HL_CLOSE = '\uE00F';
const HL_BASE = 0xE010;
const PARA_OPEN = '\uE030';
const PARA_CLOSE = '\uE031';
const ROW_HEADER = '\uE032';
const TABLE_OPEN = '\uE033';
const TABLE_CLOSE = '\uE034';
const FN_OPEN = '\uE035';
const FN_CLOSE = '\uE036';
const DIGIT_BASE = 0xE040;
const ANY_FENCE = /[\uE005\uE006\uE00F-\uE01F\uE030-\uE036\uE040-\uE04F]/g;

/* Word names nine of the highlight colours Margo offers; orange and custom
   colours travel as run shading instead. */
const WORD_HIGHLIGHTS = ['yellow', 'green', 'cyan', 'magenta', 'blue', 'red', 'darkYellow', 'darkMagenta', 'lightGray'];
const HL_CLASS_TO_WORD = {
  'hl-yellow': 'yellow',
  'hl-green': 'green',
  'hl-cyan': 'cyan',
  'hl-pink': 'magenta',
  'hl-blue': 'blue',
  'hl-red': 'red',
  'hl-darkyellow': 'darkYellow',
  'hl-purple': 'darkMagenta',
  'hl-gray': 'lightGray'
};
const TABLE_MODES = ['all', 'outer', 'none'];

function encodeNum(n) {
  return n.toString(16).split('').map((d) => String.fromCharCode(DIGIT_BASE + parseInt(d, 16))).join('');
}
function decodeNum(s) {
  return parseInt(s.split('').map((c) => (c.charCodeAt(0) - DIGIT_BASE).toString(16)).join(''), 16);
}

/* ---------------- units ---------------- */

function cssLengthToPt(v, basePt) {
  const m = /^(-?[\d.]+)(pt|px|em|rem|in|cm|mm)?$/i.exec(String(v || '').trim());
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n)) return null;
  switch ((m[2] || 'px').toLowerCase()) {
    case 'pt': return n;
    case 'px': return n * 0.75;
    case 'em': case 'rem': return n * (basePt || 11);
    case 'in': return n * 72;
    case 'cm': return n * 72 / 2.54;
    case 'mm': return n * 72 / 25.4;
    default: return null;
  }
}
const ptToTwips = (pt) => Math.max(0, Math.round(pt * 20));

function cssHex(v) {
  const s = String(v || '').trim().toLowerCase();
  let m = /^#([0-9a-f]{6})$/.exec(s);
  if (m) return m[1];
  m = /^#([0-9a-f]{3})$/.exec(s);
  if (m) return m[1].split('').map((c) => c + c).join('');
  m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)$/.exec(s);
  if (m) {
    if (m[4] != null && parseFloat(m[4]) === 0) return null;
    return [m[1], m[2], m[3]].map((x) => Math.min(255, +x).toString(16).padStart(2, '0')).join('');
  }
  return null;
}

/* ---------------- export: HTML preparation ---------------- */

const INLINE_TAGS = new Set(['A', 'ABBR', 'B', 'BDI', 'BDO', 'CITE', 'CODE', 'DFN', 'EM', 'FONT', 'I', 'IMG', 'KBD',
  'MARK', 'Q', 'S', 'SAMP', 'SMALL', 'SPAN', 'STRIKE', 'STRONG', 'SUB', 'SUP', 'TIME', 'U', 'VAR', 'DEL', 'INS']);
const BLOCK_TEXT = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'TD', 'TH', 'DIV', 'BLOCKQUOTE', 'PRE', 'FIGCAPTION']);
const CALLOUT_COLORS = {
  note: { fill: 'e8f0fe', border: '3b82f6' },
  tip: { fill: 'e7f8f1', border: '10b981' },
  warning: { fill: 'fef3e2', border: 'f59e0b' },
  quote: { fill: 'f1ecfd', border: '8b5cf6' }
};

function isInlineNode(n) {
  if (!n) return false;
  if (n.nodeType === 3) return /\S/.test(n.nodeValue);
  return n.nodeType === 1 && INLINE_TAGS.has(n.tagName);
}

function styleOf(el, prop) {
  try { return el.style ? el.style.getPropertyValue(prop) : ''; } catch { return ''; }
}

/* Where a fence goes inside a table cell: in the cell's first paragraph
   when it has one, so the fence does not become a paragraph of its own. */
function fenceHost(cell) {
  let el = cell;
  for (;;) {
    let first = el.firstChild;
    while (first && first.nodeType === 3 && !/\S/.test(first.nodeValue)) first = first.nextSibling;
    if (first && first.nodeType === 1 && /^(P|DIV|H[1-6])$/.test(first.tagName)) { el = first; continue; }
    return el;
  }
}

function prepareDocxHtml(html, opts) {
  const D = dom();
  const out = { html: String(html || ''), directives: [], alts: [], notes: [], ok: false };
  if (!D) return out;
  let doc;
  try {
    doc = D.createDocument('<!DOCTYPE html><html><head></head><body>' + out.html + '</body></html>');
  } catch {
    return out;
  }
  const body = doc.body;
  const directives = out.directives;
  const contentTw = (opts && opts.contentWidthTw) || 9360;
  const directiveFor = new Map();
  const dirOf = (el) => {
    let d = directiveFor.get(el);
    if (!d) { d = {}; directiveFor.set(el, d); }
    return d;
  };
  const q = (sel) => Array.from(body.querySelectorAll(sel));
  const moveKids = (from, to) => { while (from.firstChild) to.appendChild(from.firstChild); };

  /* html-to-docx knows <i>, <b>, <u>, <s> and <strong> but not their
     semantic twins, so every <em> mammoth or Markdown wrote lost its
     italics on the way out. */
  const RENAME = { EM: 'i', CITE: 'i', DFN: 'i', VAR: 'i', INS: 'u', DEL: 's' };
  q('em, cite, dfn, var, ins, del').forEach((el) => {
    const n = doc.createElement(RENAME[el.tagName]);
    Array.from(el.attributes || []).forEach((a) => n.setAttribute(a.name, a.value));
    moveKids(el, n);
    el.replaceWith(n);
  });
  q('code, kbd, samp').forEach((el) => {
    if (el.closest('pre')) return;
    const n = doc.createElement('span');
    n.setAttribute('style', 'font-family:Consolas' + (el.getAttribute('style') ? ';' + el.getAttribute('style') : ''));
    moveKids(el, n);
    el.replaceWith(n);
  });

  /* Footnotes: each reference becomes a fence the XML pass swaps for a real
     w:footnoteReference, and the notes block at the end of the document
     becomes word/footnotes.xml. */
  const noteText = new Map();
  q('.margo-footnotes li').forEach((li) => noteText.set(li.getAttribute('data-fn') || '', (li.textContent || '').replace(/\s+/g, ' ').trim()));
  q('sup.margo-fn-ref').forEach((ref) => {
    const idx = out.notes.length;
    out.notes.push(noteText.get(ref.getAttribute('data-fn') || '') || '');
    const span = doc.createElement('span');
    span.appendChild(doc.createTextNode(FN_OPEN + encodeNum(idx) + FN_CLOSE));
    ref.replaceWith(span);
  });
  q('.margo-footnotes').forEach((el) => el.remove());
  // The zero-width space Margo puts after a reference for the caret.
  if (out.notes.length) {
    const tw = doc.createTreeWalker(body, 4);
    let tn;
    while ((tn = tw.nextNode())) if (tn.nodeValue.indexOf('\u200b') >= 0) tn.nodeValue = tn.nodeValue.replace(/\u200b/g, '');
  }

  /* html-to-docx writes a font-family value into w:rFonts whole, so
     "'Times New Roman', serif" became a font of that name. Word gets the
     first family. */
  q('[style*="font-family"]').forEach((el) => {
    const ff = styleOf(el, 'font-family');
    const first = ff.split(',')[0].replace(/["']/g, '').trim();
    if (!first || /^(serif|sans-serif|monospace|system-ui|inherit)$/i.test(first)) el.style.removeProperty('font-family');
    else el.style.setProperty('font-family', first);
    if (!el.getAttribute('style')) el.removeAttribute('style');
  });

  // Page breaks: html-to-docx only knows its own marker.
  q('div[data-margo-page-break]').forEach((el) => {
    const pb = doc.createElement('div');
    pb.className = 'page-break';
    pb.setAttribute('style', 'page-break-after: always');
    el.replaceWith(pb);
  });

  // Figures become an aligned paragraph and an optional caption paragraph.
  q('figure').forEach((fig) => {
    const align = /align-left/.test(fig.className) ? 'left' : /align-right/.test(fig.className) ? 'right' : 'center';
    const frag = doc.createDocumentFragment();
    const p = doc.createElement('p');
    p.setAttribute('style', 'text-align:' + align);
    Array.from(fig.childNodes).forEach((n) => {
      if (n.nodeType === 1 && n.tagName === 'FIGCAPTION') return;
      p.appendChild(n);
    });
    frag.appendChild(p);
    const cap = fig.querySelector('figcaption');
    if (cap && cap.textContent.trim()) {
      const cp = doc.createElement('p');
      cp.setAttribute('style', 'text-align:' + align + ';font-size:9pt;font-style:italic');
      moveKids(cap, cp);
      frag.appendChild(cp);
    }
    fig.replaceWith(frag);
  });

  // Checklists travel as glyph paragraphs, which Word shows and Margo reads back.
  q('ul.margo-checklist').forEach((ul) => {
    const frag = doc.createDocumentFragment();
    Array.from(ul.children).forEach((li) => {
      if (li.tagName !== 'LI') return;
      const p = doc.createElement('p');
      const checked = /\bis-checked\b/.test(li.className || '');
      p.appendChild(doc.createTextNode(checked ? '\u2612 ' : '\u2610 '));
      const nested = [];
      Array.from(li.childNodes).forEach((n) => {
        if (n.nodeType === 1 && /^(UL|OL|TABLE)$/.test(n.tagName)) nested.push(n);
        else if (n.nodeType === 1 && /^(P|DIV)$/.test(n.tagName)) moveKids(n, p);
        else p.appendChild(n);
      });
      frag.appendChild(p);
      nested.forEach((n) => frag.appendChild(n));
    });
    ul.replaceWith(frag);
  });

  // Callout cards: shaded paragraphs with a coloured rule on the left.
  q('div.margo-callout').forEach((box) => {
    const type = box.getAttribute('data-callout-type') || 'note';
    const col = CALLOUT_COLORS[type] || CALLOUT_COLORS.note;
    const frag = doc.createDocumentFragment();
    const parts = Array.from(box.childNodes).filter((n) => n.nodeType === 1 || /\S/.test(n.nodeValue || ''));
    parts.forEach((n) => {
      const p = doc.createElement('p');
      if (n.nodeType === 1 && /margo-callout-title/.test(n.className || '')) {
        const b = doc.createElement('b');
        moveKids(n, b);
        p.appendChild(b);
      } else if (n.nodeType === 1 && /^(DIV|P)$/.test(n.tagName)) {
        moveKids(n, p);
      } else {
        p.appendChild(n);
      }
      Object.assign(dirOf(p), { shade: col.fill, borderLeft: col.border });
      frag.appendChild(p);
    });
    box.replaceWith(frag);
  });

  // Quotes become Quote-styled paragraphs (innermost first).
  q('blockquote').reverse().forEach((bq) => {
    const frag = doc.createDocumentFragment();
    let inline = null;
    const flush = () => { if (inline) { frag.appendChild(inline); inline = null; } };
    Array.from(bq.childNodes).forEach((n) => {
      if (n.nodeType === 1 && /^(P|H[1-6]|DIV)$/.test(n.tagName)) {
        flush();
        dirOf(n).style = 'Quote';
        frag.appendChild(n);
      } else if (n.nodeType === 1 && /^(UL|OL|TABLE|PRE)$/.test(n.tagName)) {
        flush();
        frag.appendChild(n);
      } else if (n.nodeType === 3 && !/\S/.test(n.nodeValue) && !inline) {
        // whitespace between blocks
      } else {
        if (!inline) { inline = doc.createElement('p'); dirOf(inline).style = 'Quote'; }
        inline.appendChild(n);
      }
    });
    flush();
    bq.replaceWith(frag);
  });

  // Code blocks: one Code-styled paragraph, lines kept.
  q('pre').forEach((pre) => {
    const p = doc.createElement('p');
    const span = doc.createElement('span');
    span.setAttribute('style', 'font-family:Consolas');
    const lines = (pre.textContent || '').replace(/\n$/, '').split('\n');
    lines.forEach((line, i) => {
      if (i) span.appendChild(doc.createElement('br'));
      span.appendChild(doc.createTextNode(line.replace(/^ +/, (s) => '\u00a0'.repeat(s.length)).replace(/\t/g, '\u00a0\u00a0\u00a0\u00a0') || '\u00a0'));
    });
    p.appendChild(span);
    dirOf(p).style = 'Code';
    pre.replaceWith(p);
  });

  // Horizontal rules: an empty paragraph with a bottom border.
  q('hr').forEach((hr) => {
    const p = doc.createElement('p');
    dirOf(p).borderBottom = 'a6a6a6';
    hr.replaceWith(p);
  });

  // Title / subtitle paragraph styles.
  q('.margo-title').forEach((el) => { dirOf(el).style = 'Title'; });
  q('.margo-subtitle').forEach((el) => { dirOf(el).style = 'Subtitle'; });

  // Table of contents entries: text, a dotted-leader tab, the page.
  q('.margo-toc-entry').forEach((p) => {
    const page = p.querySelector('.margo-toc-page');
    if (page) page.parentNode.insertBefore(doc.createTextNode(TAB), page);
    Object.assign(dirOf(p), { tabRight: contentTw });
  });

  // Paragraph spacing and first-line indent html-to-docx ignores.
  q('p, h1, h2, h3, h4, h5, h6, li').forEach((el) => {
    const before = cssLengthToPt(styleOf(el, 'margin-top'));
    const after = cssLengthToPt(styleOf(el, 'margin-bottom'));
    const first = cssLengthToPt(styleOf(el, 'text-indent'));
    if (before != null) dirOf(el).before = ptToTwips(before);
    if (after != null) dirOf(el).after = ptToTwips(after);
    if (first != null && first !== 0) dirOf(el).firstLine = Math.round(first * 20);
  });

  // Tables: header rows, border modes and column widths.
  q('table').forEach((table) => {
    const rows = Array.from(table.querySelectorAll('tr')).filter((tr) => tr.closest('table') === table);
    const thead = Array.from(table.children).find((c) => c.tagName === 'THEAD');
    const headRows = new Set(thead ? Array.from(thead.children) : []);
    if (thead) {
      let tbody = Array.from(table.children).find((c) => c.tagName === 'TBODY');
      if (!tbody) { tbody = doc.createElement('tbody'); table.appendChild(tbody); }
      Array.from(thead.children).reverse().forEach((tr) => tbody.insertBefore(tr, tbody.firstChild));
      thead.remove();
    }
    rows.forEach((tr, i) => {
      const cells = Array.from(tr.children).filter((c) => /^(TD|TH)$/.test(c.tagName));
      const isHead = headRows.has(tr) || (cells.length > 0 && cells.every((c) => c.tagName === 'TH'));
      if (isHead && cells[0]) { const at = fenceHost(cells[0]); at.insertBefore(doc.createTextNode(ROW_HEADER), at.firstChild); }
      if (i === 0) {
        const cg = Array.from(table.children).find((c) => c.tagName === 'COLGROUP');
        const cols = cg ? Array.from(cg.children) : [];
        let ci = 0;
        cells.forEach((c) => {
          const span = parseInt(c.getAttribute('colspan') || '1', 10) || 1;
          if (!styleOf(c, 'width') && span === 1 && cols[ci]) {
            const w = styleOf(cols[ci], 'width') || cols[ci].getAttribute('width');
            if (w) c.style.setProperty('width', /^\d+$/.test(w) ? w + 'px' : w);
          }
          ci += span;
        });
      }
    });
    /* html-to-docx throws on a cell width it cannot turn into twips (a
       percentage, an em) and the whole save fails; widths are made pixels
       of the page's text width here, and anything else is dropped. */
    const contentPx = contentTw / 15;
    table.querySelectorAll('td, th, col').forEach((c) => {
      if (c.closest('table') !== table) return;
      const w = styleOf(c, 'width') || c.getAttribute('width') || '';
      c.removeAttribute('width');
      if (!w) return;
      let px = null;
      if (/%$/.test(w)) px = parseFloat(w) / 100 * contentPx;
      else {
        const pt = cssLengthToPt(/^\d+(\.\d+)?$/.test(w) ? w + 'px' : w);
        if (pt != null) px = pt / 0.75;
      }
      if (px != null && px > 4 && Number.isFinite(px)) c.style.setProperty('width', Math.round(px) + 'px');
      else c.style.removeProperty('width');
      if (!c.getAttribute('style')) c.removeAttribute('style');
    });
    const tw = styleOf(table, 'width');
    if (tw && !/^(100%|\d+(\.\d+)?px)$/.test(tw)) table.style.setProperty('width', '100%');
    const mode = /\bmargo-tbl-none\b/.test(table.className || '') ? 'none'
      : /\bmargo-tbl-outer\b/.test(table.className || '') ? 'outer' : null;
    const first = table.querySelector('td, th');
    if (mode && first) { const at = fenceHost(first); at.insertBefore(doc.createTextNode(TABLE_OPEN + encodeNum(TABLE_MODES.indexOf(mode)) + TABLE_CLOSE), at.firstChild); }
  });

  // Highlights: Word colours by name, anything else as run shading.
  q('mark').forEach((m) => {
    const cls = (m.className || '').split(/\s+/).find((c) => HL_CLASS_TO_WORD[c]);
    const span = doc.createElement('span');
    if (cls) {
      const idx = WORD_HIGHLIGHTS.indexOf(HL_CLASS_TO_WORD[cls]);
      span.appendChild(doc.createTextNode(String.fromCharCode(HL_BASE + idx)));
      moveKids(m, span);
      span.appendChild(doc.createTextNode(HL_CLOSE));
    } else {
      const hex = cssHex(styleOf(m, 'background-color')) || (/hl-orange/.test(m.className || '') ? 'ffa500' : 'ffff00');
      span.setAttribute('style', 'background-color:#' + hex);
      moveKids(m, span);
    }
    m.replaceWith(span);
  });

  // Alt text, in document order, for the pass over the drawings.
  q('img').forEach((img) => out.alts.push(img.getAttribute('alt') || ''));

  // A space that sits alone between two formatted runs is dropped by
  // html-to-docx, so "bold italic" came out as "bolditalic".
  const walker = doc.createTreeWalker(body, 4 /* SHOW_TEXT */);
  const lonely = [];
  let t;
  while ((t = walker.nextNode())) {
    if (/\S/.test(t.nodeValue) || !t.nodeValue.length) continue;
    const parent = t.parentNode;
    if (!parent || parent.nodeType !== 1) continue;
    const parentInline = parent.nodeType === 1 && INLINE_TAGS.has(parent.tagName);
    const between = isInlineNode(t.previousSibling) || isInlineNode(t.nextSibling);
    const inTextBlock = parent.nodeType === 1 && BLOCK_TEXT.has(parent.tagName) && t.previousSibling && t.nextSibling;
    if (parentInline || (between && inTextBlock)) lonely.push(t);
  }
  lonely.forEach((n) => { n.nodeValue = SPACE; });

  // Finally, the paragraph directives themselves.
  directiveFor.forEach((d, el) => {
    if (!el.parentNode) return;
    const idx = directives.length;
    directives.push(d);
    const at = fenceHost(el);
    at.insertBefore(doc.createTextNode(PARA_OPEN + encodeNum(idx) + PARA_CLOSE), at.firstChild);
  });

  out.html = body.innerHTML;
  out.ok = true;
  return out;
}

/* ---------------- export: XML passes ---------------- */

const PPR_ORDER = ['pStyle', 'keepNext', 'keepLines', 'pageBreakBefore', 'framePr', 'widowControl', 'numPr',
  'suppressLineNumbers', 'pBdr', 'shd', 'tabs', 'suppressAutoHyphens', 'kinsoku', 'wordWrap', 'overflowPunct',
  'topLinePunct', 'autoSpaceDE', 'autoSpaceDN', 'bidi', 'adjustRightInd', 'snapToGrid', 'spacing', 'ind',
  'contextualSpacing', 'mirrorIndents', 'suppressOverlap', 'jc', 'textDirection', 'textAlignment',
  'textboxTightWrap', 'outlineLvl', 'divId', 'cnfStyle', 'rPr', 'sectPr', 'pPrChange'];
const RPR_ORDER = ['rStyle', 'rFonts', 'b', 'bCs', 'i', 'iCs', 'caps', 'smallCaps', 'strike', 'dstrike', 'outline',
  'shadow', 'emboss', 'imprint', 'noProof', 'snapToGrid', 'vanish', 'webHidden', 'color', 'spacing', 'w', 'kern',
  'position', 'sz', 'szCs', 'highlight', 'u', 'effect', 'bdr', 'shd', 'fitText', 'vertAlign', 'rtl', 'cs', 'em',
  'lang', 'eastAsianLayout', 'specVanish', 'oMath'];
const TCPR_ORDER = ['cnfStyle', 'tcW', 'gridSpan', 'hMerge', 'vMerge', 'tcBorders', 'shd', 'noWrap', 'tcMar',
  'textDirection', 'tcFitText', 'vAlign', 'hideMark'];
const TBLPR_ORDER = ['tblStyle', 'tblpPr', 'tblOverlap', 'bidiVisual', 'tblStyleRowBandSize', 'tblStyleColBandSize',
  'tblW', 'jc', 'tblCellSpacing', 'tblInd', 'tblBorders', 'shd', 'tblLayout', 'tblCellMar', 'tblLook',
  'tblCaption', 'tblDescription'];
const TRPR_ORDER = ['cnfStyle', 'divId', 'gridBefore', 'gridAfter', 'wBefore', 'wAfter', 'cantSplit', 'trHeight',
  'tblHeader', 'tblCellSpacing', 'jc', 'hidden'];

const CHILD_RE = /<w:([A-Za-z]+)\b(?:[^>]*?\/>|[^>]*>[\s\S]*?<\/w:\1>)/g;

/* Word validates property order strictly in places; html-to-docx does not
   write it in schema order, and every property added here has to land in
   the right slot anyway. Children that cannot be tokenized cleanly are left
   exactly as they were. */
function sortProps(inner, order) {
  const kids = [];
  let m;
  CHILD_RE.lastIndex = 0;
  while ((m = CHILD_RE.exec(inner))) kids.push({ name: m[1], xml: m[0] });
  if (inner.replace(/\s+/g, '') !== kids.map((k) => k.xml).join('').replace(/\s+/g, '')) return inner;
  const rank = (n) => { const i = order.indexOf(n); return i < 0 ? order.length : i; };
  return kids
    .map((k, i) => ({ ...k, i }))
    .sort((a, b) => rank(a.name) - rank(b.name) || a.i - b.i)
    .map((k) => k.xml)
    .join('');
}

function withProp(inner, name, xml, order) {
  const re = new RegExp('<w:' + name + '\\b(?:[^>]*?\\/>|[^>]*>[\\s\\S]*?<\\/w:' + name + '>)', 'g');
  return sortProps(inner.replace(re, '') + xml, order);
}

function mergeAttrs(inner, name, attrs, order) {
  const re = new RegExp('<w:' + name + '\\b([^>]*?)\\/>');
  const m = re.exec(inner);
  let existing = m ? m[1] : '';
  Object.keys(attrs).forEach((k) => {
    const a = new RegExp('\\s' + k.replace(':', '\\:') + '="[^"]*"');
    existing = existing.replace(a, '');
    existing += ` ${k}="${attrs[k]}"`;
  });
  const xml = `<w:${name}${existing}/>`;
  if (m) return inner.replace(re, xml);
  return sortProps(inner + xml, order);
}

function editPPr(pXml, fn) {
  const m = /<w:pPr>([\s\S]*?)<\/w:pPr>/.exec(pXml);
  if (m) return pXml.replace(m[0], '<w:pPr>' + fn(m[1]) + '</w:pPr>');
  if (/<w:pPr\/>/.test(pXml)) return pXml.replace('<w:pPr/>', '<w:pPr>' + fn('') + '</w:pPr>');
  return pXml.replace(/^(<w:p(?:\s[^>]*)?>)/, '$1<w:pPr>' + fn('') + '</w:pPr>');
}

function applyParaDirective(pXml, d) {
  return editPPr(pXml, (inner) => {
    let x = inner;
    if (d.style) x = withProp(x, 'pStyle', `<w:pStyle w:val="${d.style}"/>`, PPR_ORDER);
    if (d.before != null || d.after != null) {
      const attrs = {};
      if (d.before != null) attrs['w:before'] = d.before;
      if (d.after != null) attrs['w:after'] = d.after;
      x = mergeAttrs(x, 'spacing', attrs, PPR_ORDER);
    }
    if (d.firstLine != null) {
      x = mergeAttrs(x, 'ind', d.firstLine >= 0 ? { 'w:firstLine': d.firstLine } : { 'w:hanging': -d.firstLine }, PPR_ORDER);
    }
    if (d.shade) x = withProp(x, 'shd', `<w:shd w:val="clear" w:color="auto" w:fill="${d.shade}"/>`, PPR_ORDER);
    if (d.borderLeft || d.borderBottom) {
      const parts = [];
      if (d.borderLeft) parts.push(`<w:left w:val="single" w:sz="24" w:space="8" w:color="${d.borderLeft}"/>`);
      if (d.borderBottom) parts.push(`<w:bottom w:val="single" w:sz="6" w:space="1" w:color="${d.borderBottom}"/>`);
      x = withProp(x, 'pBdr', '<w:pBdr>' + parts.join('') + '</w:pBdr>', PPR_ORDER);
    }
    if (d.tabRight) {
      x = withProp(x, 'tabs', `<w:tabs><w:tab w:val="right" w:leader="dot" w:pos="${d.tabRight}"/></w:tabs>`, PPR_ORDER);
    }
    return x;
  });
}

function addRunProp(run, xml, name) {
  const m = /<w:rPr>([\s\S]*?)<\/w:rPr>/.exec(run);
  if (m) return run.replace(m[0], '<w:rPr>' + withProp(m[1], name, xml, RPR_ORDER) + '</w:rPr>');
  if (/<w:rPr\s*\/>/.test(run)) return run.replace(/<w:rPr\s*\/>/, '<w:rPr>' + xml + '</w:rPr>');
  return run.replace(/^(<w:r(?:\s[^>]*)?>)/, '$1<w:rPr>' + xml + '</w:rPr>');
}

function applyHighlightFences(xml) {
  let active = null;
  return xml.replace(/<w:r(?:\s[^>]*)?>[\s\S]*?<\/w:r>/g, (run) => {
    const text = (run.match(/<w:t\b[^>]*>([^<]*)<\/w:t>/g) || []).join('');
    let on = active;
    for (const ch of text) {
      const code = ch.charCodeAt(0);
      if (code >= HL_BASE && code < HL_BASE + WORD_HIGHLIGHTS.length) {
        active = WORD_HIGHLIGHTS[code - HL_BASE];
        if (!on) on = active;
      } else if (ch === HL_CLOSE) {
        active = null;
      }
    }
    if (!on || !/<w:t\b/.test(run)) return run;
    return addRunProp(run, `<w:highlight w:val="${on}"/>`, 'highlight');
  });
}

function applyFootnoteFences(xml) {
  if (xml.indexOf(FN_OPEN) < 0) return xml;
  const re = new RegExp(FN_OPEN + '([\\uE040-\\uE04F]+)' + FN_CLOSE);
  return xml.replace(/<w:r(?:\s[^>]*)?>[\s\S]*?<\/w:r>/g, (runXml) => {
    if (runXml.indexOf(FN_OPEN) < 0) return runXml;
    const rPr = (/<w:rPr>[\s\S]*?<\/w:rPr>|<w:rPr\/>/.exec(runXml) || [''])[0];
    const text = (/<w:t\b[^>]*>([^<]*)<\/w:t>/.exec(runXml) || [])[1] || '';
    const parts = [];
    let rest = text;
    let m;
    while ((m = re.exec(rest))) {
      const before = rest.slice(0, m.index);
      if (before) parts.push(`<w:r>${rPr}<w:t xml:space="preserve">${before}</w:t></w:r>`);
      const id = decodeNum(m[1]) + 1;
      parts.push(`<w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:footnoteReference w:id="${id}"/></w:r>`);
      rest = rest.slice(m.index + m[0].length);
    }
    if (rest) parts.push(`<w:r>${rPr}<w:t xml:space="preserve">${rest}</w:t></w:r>`);
    return parts.join('');
  });
}

function footnotesXml(notes) {
  const sepPr = '<w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr>';
  const body = notes.map((text, i) =>
    `<w:footnote w:id="${i + 1}"><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr>` +
    `<w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:footnoteRef/></w:r>` +
    `<w:r><w:rPr><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr><w:t xml:space="preserve"> ${xmlText(text)}</w:t></w:r></w:p></w:footnote>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:footnotes ${W_NS}>` +
    `<w:footnote w:type="separator" w:id="-1"><w:p>${sepPr}<w:r><w:separator/></w:r></w:p></w:footnote>` +
    `<w:footnote w:type="continuationSeparator" w:id="0"><w:p>${sepPr}<w:r><w:continuationSeparator/></w:r></w:p></w:footnote>` +
    body + '</w:footnotes>';
}

async function addFootnotesPart(zip, notes) {
  if (!notes || !notes.length) return;
  zip.file('word/footnotes.xml', footnotesXml(notes));
  const relsPath = 'word/_rels/document.xml.rels';
  const relsFile = zip.file(relsPath);
  if (relsFile) {
    let rels = await relsFile.async('string');
    if (!/relationships\/footnotes"/.test(rels)) {
      rels = rels.replace('</Relationships>',
        '<Relationship Id="rIdMargoFootnotes" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes" Target="footnotes.xml"/></Relationships>');
      zip.file(relsPath, rels);
    }
  }
  const ctFile = zip.file('[Content_Types].xml');
  if (ctFile) {
    let ct = await ctFile.async('string');
    if (!/footnotes\.xml/.test(ct)) {
      ct = ct.replace('</Types>', '<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/></Types>');
      zip.file('[Content_Types].xml', ct);
    }
  }
  const setFile = zip.file('word/settings.xml');
  if (setFile) {
    let st = await setFile.async('string');
    if (!/<w:footnotePr>/.test(st)) {
      const pr = '<w:footnotePr><w:footnote w:id="-1"/><w:footnote w:id="0"/></w:footnotePr>';
      st = /<w:decimalSymbol\b/.test(st) ? st.replace(/<w:decimalSymbol\b/, pr + '<w:decimalSymbol') : st.replace('</w:settings>', pr + '</w:settings>');
      zip.file('word/settings.xml', st);
    }
  }
}

function applyTabFences(xml) {
  if (xml.indexOf(TAB) < 0) return xml;
  return xml.replace(/<w:t\b([^>]*)>([^<]*)<\/w:t>/g, (m, attrs, text) => {
    if (text.indexOf(TAB) < 0) return m;
    return text.split(TAB).map((s) => `<w:t xml:space="preserve">${s}</w:t>`).join('<w:tab/>');
  });
}

function tableBounds(xml, from) {
  const start = xml.lastIndexOf('<w:tbl>', from);
  if (start < 0) return null;
  const re = /<w:tbl>|<\/w:tbl>/g;
  re.lastIndex = start;
  let depth = 0;
  let m;
  while ((m = re.exec(xml))) {
    depth += m[0] === '<w:tbl>' ? 1 : -1;
    if (depth === 0) return { start, end: m.index + m[0].length };
  }
  return null;
}

const NIL_BORDERS = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
  .map((s) => `<w:${s} w:val="nil"/>`).join('');
const SINGLE = (s, sz) => `<w:${s} w:val="single" w:sz="${sz}" w:space="0" w:color="000000"/>`;

function applyTableMode(tbl, mode) {
  let x = tbl;
  if (mode === 'none') {
    x = x.replace(/<w:tblBorders>[\s\S]*?<\/w:tblBorders>/, '<w:tblBorders>' + NIL_BORDERS + '</w:tblBorders>');
    x = x.replace(/<w:tcBorders>[\s\S]*?<\/w:tcBorders>|<w:tcBorders\/>/g, '<w:tcBorders>' + NIL_BORDERS.replace(/<w:inside[HV][^>]*>/g, '') + '</w:tcBorders>');
  } else if (mode === 'outer') {
    x = x.replace(/<w:tblBorders>[\s\S]*?<\/w:tblBorders>/,
      '<w:tblBorders>' + SINGLE('top', 4) + SINGLE('left', 4) + SINGLE('bottom', 4) + SINGLE('right', 4)
      + '<w:insideH w:val="nil"/><w:insideV w:val="nil"/></w:tblBorders>');
    x = x.replace(/<w:tcBorders>[\s\S]*?<\/w:tcBorders>|<w:tcBorders\/>/g, '');
  }
  return x;
}

function applyStructureFences(xml, directives) {
  let x = xml;
  // Paragraph directives.
  if (x.indexOf(PARA_OPEN) >= 0) {
    x = x.replace(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g, (p) => {
      const m = new RegExp(PARA_OPEN + '([\\uE040-\\uE04F]+)' + PARA_CLOSE).exec(p);
      if (!m) return p;
      const d = directives[decodeNum(m[1])];
      const clean = p.split(m[0]).join('');
      return d ? applyParaDirective(clean, d) : clean;
    });
  }
  // Header rows.
  if (x.indexOf(ROW_HEADER) >= 0) {
    x = x.replace(/<w:tr>[\s\S]*?<\/w:tr>/g, (tr) => {
      if (tr.indexOf(ROW_HEADER) < 0) return tr;
      let r = tr.split(ROW_HEADER).join('');
      if (/<w:trPr>/.test(r)) r = r.replace(/<w:trPr>([\s\S]*?)<\/w:trPr>/, (m0, inner) => '<w:trPr>' + withProp(inner, 'tblHeader', '<w:tblHeader/>', TRPR_ORDER) + '</w:trPr>');
      else if (/<w:trPr\/>/.test(r)) r = r.replace('<w:trPr/>', '<w:trPr><w:tblHeader/></w:trPr>');
      else r = r.replace('<w:tr>', '<w:tr><w:trPr><w:tblHeader/></w:trPr>');
      return r;
    });
  }
  // Table border modes.
  let guard = 0;
  let at;
  while ((at = x.indexOf(TABLE_OPEN)) >= 0 && guard++ < 500) {
    const close = x.indexOf(TABLE_CLOSE, at);
    const mode = close > at ? TABLE_MODES[decodeNum(x.slice(at + 1, close))] : null;
    const fence = x.slice(at, close > at ? close + 1 : at + 1);
    const b = tableBounds(x, at);
    x = x.slice(0, at) + x.slice(at + fence.length);
    if (b && mode) {
      const end = b.end - fence.length;
      x = x.slice(0, b.start) + applyTableMode(x.slice(b.start, end), mode) + x.slice(end);
    }
  }
  return x;
}

function tidyTables(xml) {
  let x = xml;
  // html-to-docx writes a tblGrid per row group (and one for a colgroup);
  // the schema allows one, straight after the table properties.
  x = x.replace(/(<\/w:tr>)\s*<w:tblGrid>[\s\S]*?<\/w:tblGrid>/g, '$1');
  x = x.replace(/(<w:tblGrid>[\s\S]*?<\/w:tblGrid>)(?:\s*<w:tblGrid>[\s\S]*?<\/w:tblGrid>)+/g, '$1');
  // A vertically merged continuation cell gets gridSpan 0, which is invalid.
  x = x.replace(/<w:gridSpan w:val="0"\/>/g, '');
  // Grid columns from the first row's cell widths, when it has them all.
  x = x.replace(/<w:tblGrid>([\s\S]*?)<\/w:tblGrid>(\s*<w:tr>[\s\S]*?<\/w:tr>)/g, (m, grid, firstRow) => {
    const cells = firstRow.match(/<w:tc>[\s\S]*?<\/w:tc>/g) || [];
    const widths = [];
    for (const c of cells) {
      const w = /<w:tcW w:w="(\d+)" w:type="dxa"\/>/.exec(c);
      const span = /<w:gridSpan w:val="(\d+)"\/>/.exec(c);
      if (!w || span) return m;
      widths.push(+w[1]);
    }
    const cols = grid.match(/<w:gridCol\b[^>]*\/>/g) || [];
    if (!widths.length || widths.length !== cols.length) return m;
    return '<w:tblGrid>' + widths.map((w) => `<w:gridCol w:w="${w}"/>`).join('') + '</w:tblGrid>' + firstRow;
  });
  // Schema order inside table, row and cell properties.
  x = x.replace(/<w:tblPr>([\s\S]*?)<\/w:tblPr>/g, (m, inner) => '<w:tblPr>' + sortProps(inner, TBLPR_ORDER) + '</w:tblPr>');
  x = x.replace(/<w:trPr>([\s\S]*?)<\/w:trPr>/g, (m, inner) => '<w:trPr>' + sortProps(inner, TRPR_ORDER) + '</w:trPr>');
  x = x.replace(/<w:tcPr>([\s\S]*?)<\/w:tcPr>/g, (m, inner) => '<w:tcPr>' + sortProps(inner, TCPR_ORDER) + '</w:tcPr>');
  return x;
}

function sortAllProps(xml) {
  return xml
    .replace(/<w:pPr>((?:(?!<w:pPr>)[\s\S])*?)<\/w:pPr>/g, (m, inner) => {
      // pPr may itself hold an rPr; sort only when it does not, to keep it simple.
      if (/<w:rPr>/.test(inner)) return m;
      return '<w:pPr>' + sortProps(inner, PPR_ORDER) + '</w:pPr>';
    })
    .replace(/<w:rPr>([\s\S]*?)<\/w:rPr>/g, (m, inner) => '<w:rPr>' + sortProps(inner, RPR_ORDER) + '</w:rPr>');
}

function applyAltText(xml, alts) {
  if (!alts || !alts.length) return xml;
  const docPrs = xml.match(/<wp:docPr\b[^>]*\/?>/g) || [];
  if (docPrs.length !== alts.length) return xml;
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  let i = 0;
  let x = xml.replace(/<wp:docPr\b([^>]*?)(\/?)>/g, (m, attrs, slash) => {
    const alt = alts[i++];
    if (!alt) return m;
    return `<wp:docPr${attrs.replace(/\sdescr="[^"]*"/, '')} descr="${esc(alt)}"${slash}>`;
  });
  i = 0;
  x = x.replace(/<pic:cNvPr\b([^>]*?)(\/?)>/g, (m, attrs, slash) => {
    const alt = alts[i++];
    if (!alt) return m;
    return `<pic:cNvPr${attrs.replace(/\sdescr="[^"]*"/, '')} descr="${esc(alt)}"${slash}>`;
  });
  return x;
}

const EXTRA_STYLES = {
  Title: '<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="10"/><w:qFormat/><w:pPr><w:spacing w:after="80"/><w:contextualSpacing/></w:pPr><w:rPr><w:sz w:val="56"/><w:szCs w:val="56"/><w:kern w:val="28"/></w:rPr></w:style>',
  Subtitle: '<w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="11"/><w:qFormat/><w:pPr><w:spacing w:after="160"/></w:pPr><w:rPr><w:color w:val="595959"/><w:sz w:val="30"/><w:szCs w:val="30"/></w:rPr></w:style>',
  Quote: '<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="29"/><w:qFormat/><w:pPr><w:pBdr><w:left w:val="single" w:sz="18" w:space="8" w:color="BFBFBF"/></w:pBdr><w:ind w:left="360"/></w:pPr><w:rPr><w:i/><w:color w:val="595959"/></w:rPr></w:style>',
  Code: '<w:style w:type="paragraph" w:styleId="Code"><w:name w:val="Code"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:shd w:val="clear" w:color="auto" w:fill="F2F2F0"/><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/><w:sz w:val="20"/></w:rPr></w:style>'
};

function addStyles(stylesXml) {
  let x = stylesXml;
  if (!/w:styleId="Normal"/.test(x)) {
    x = x.replace('</w:docDefaults>', '</w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>');
  }
  Object.keys(EXTRA_STYLES).forEach((id) => {
    if (!new RegExp('w:styleId="' + id + '"').test(x)) x = x.replace('</w:styles>', EXTRA_STYLES[id] + '</w:styles>');
  });
  return x;
}

/* Header and footer parts, written by hand: html-to-docx puts the page number
   straight after the footer text ("Confidential1") and writes both parts with
   a default namespace some readers reject. */
const W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
function xmlText(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
const HF_RPR = '<w:rPr><w:color w:val="808080"/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr>';
const run = (t) => `<w:r>${HF_RPR}<w:t xml:space="preserve">${xmlText(t)}</w:t></w:r>`;
const field = (instr) => `<w:fldSimple w:instr=" ${instr} "><w:r>${HF_RPR}<w:t>1</w:t></w:r></w:fldSimple>`;

function headerXml(text) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr ${W_NS}><w:p><w:pPr><w:spacing w:after="0"/></w:pPr>${text ? run(text) : ''}</w:p></w:hdr>`;
}

function footerXml(text, pageNumbers, contentTw) {
  const tabs = `<w:tabs><w:tab w:val="right" w:pos="${contentTw}"/></w:tabs>`;
  const num = pageNumbers ? `<w:r>${HF_RPR}<w:tab/></w:r>${run('Page ')}${field('PAGE')}${run(' of ')}${field('NUMPAGES')}` : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr ${W_NS}><w:p><w:pPr>${tabs}<w:spacing w:after="0"/></w:pPr>${text ? run(text) : ''}${num}</w:p></w:ftr>`;
}

/* Body-level tidying so a Margo file round-trips without growing:
   - html-to-docx opens every document with an empty paragraph and follows
     every table with one; now that blank lines survive import, each save
     would have added another;
   - a blank line (<p><br></p>) arrives as a paragraph holding a line break,
     which Word draws two lines tall;
   - the section properties are written first, and the schema wants them
     last. */
function tidyBody(xml) {
  let x = xml;
  const sect = /<w:body>\s*(<w:sectPr>[\s\S]*?<\/w:sectPr>)/.exec(x);
  if (sect) {
    // Header and footer references lead the section properties.
    const refs = sect[1].match(/<w:(?:header|footer)Reference\b[^>]*\/>/g) || [];
    const rest = sect[1].replace(/<w:(?:header|footer)Reference\b[^>]*\/>/g, '');
    const fixed = rest.replace(/^<w:sectPr>/, '<w:sectPr>' + refs.join(''));
    x = x.replace(sect[0], '<w:body>');
    x = x.replace(/<\/w:body>/, fixed + '</w:body>');
  }
  x = x.replace(/<w:body>\s*<w:p>\s*<w:pPr>\s*<w:spacing w:lineRule="auto"\/>\s*<\/w:pPr>\s*<w:r>\s*<w:rPr\/>\s*<w:t xml:space="preserve"\/>\s*<\/w:r>\s*<\/w:p>/, '<w:body>');
  x = x.replace(/(<\/w:tbl>)\s*<w:p>\s*(?:<w:pPr>(?:(?!<\/w:p>)[\s\S])*?<\/w:pPr>)?\s*(?:<w:r>\s*<w:rPr\/>\s*<\/w:r>\s*)?<\/w:p>(?=\s*<w:(?:p|tbl)\b)/g, '$1');
  x = x.replace(/(<w:p(?:\s[^>]*)?>(?:(?!<\/w:p>)[\s\S])*?)<w:r>\s*<w:rPr\/>\s*<w:br w:type="textWrapping"\/>\s*<\/w:r>(\s*<\/w:p>)/g, (m, head, tail) => {
    // Only when the break is all the paragraph holds.
    if (/<w:t\b[^>]*>[^<]+<\/w:t>|<w:drawing>|<w:tab\/>/.test(head)) return m;
    return head + tail;
  });
  return x;
}

async function finishDocx(buf, prep, opts) {
  const o = opts || {};
  try {
    const zip = await JSZip.loadAsync(buf);
    const docFile = zip.file('word/document.xml');
    if (!docFile) return buf;
    let xml = await docFile.async('string');
    if (typeof o.extraPass === 'function') xml = o.extraPass(xml);
    xml = applyHighlightFences(xml);
    xml = applyStructureFences(xml, (prep && prep.directives) || []);
    xml = applyTabFences(xml);
    xml = applyFootnoteFences(xml);
    xml = xml.split(SPACE).join(' ');
    xml = xml.replace(ANY_FENCE, '');
    xml = tidyTables(xml);
    xml = sortAllProps(xml);
    xml = applyAltText(xml, prep && prep.alts);
    xml = tidyBody(xml);
    zip.file('word/document.xml', xml);

    const styles = zip.file('word/styles.xml');
    if (styles) zip.file('word/styles.xml', addStyles(await styles.async('string')));
    await addFootnotesPart(zip, prep && prep.notes);

    const names = Object.keys(zip.files);
    names.filter((n) => /^word\/header\d*\.xml$/.test(n)).forEach((n) => zip.file(n, headerXml(o.headerText)));
    names.filter((n) => /^word\/footer\d*\.xml$/.test(n)).forEach((n) => zip.file(n, footerXml(o.footerText, !!o.pageNumbers, o.contentWidthTw || 9360)));

    return await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  } catch {
    return buf;
  }
}

/* ---------------- import ---------------- */

/* Picture sizes and table border modes, in document order. A drawing that is
   not a picture (a chart, a shape) is skipped by mammoth, so only pictures
   are counted. */
function readImportExtras(xml) {
  const images = [];
  const re = /<w:drawing>[\s\S]*?<\/w:drawing>|<w:pict>[\s\S]*?<\/w:pict>/g;
  let m;
  while ((m = re.exec(xml || ''))) {
    const block = m[0];
    if (block.startsWith('<w:drawing>')) {
      if (!/<a:blip\b/.test(block)) continue;
      const ext = /<wp:extent cx="(\d+)" cy="(\d+)"/.exec(block);
      images.push(ext ? { w: Math.round(+ext[1] / 9525), h: Math.round(+ext[2] / 9525) } : null);
    } else {
      if (!/<v:imagedata\b/.test(block)) continue;
      const st = /style="([^"]*)"/.exec(block);
      const w = st && /width:([\d.]+)pt/.exec(st[1]);
      const h = st && /height:([\d.]+)pt/.exec(st[1]);
      images.push(w && h ? { w: Math.round(+w[1] / 0.75), h: Math.round(+h[1] / 0.75) } : null);
    }
  }

  const tables = [];
  const colWidths = [];
  const tre = /<w:tbl>/g;
  while ((m = tre.exec(xml || ''))) {
    const b = tableBounds(xml, m.index + 1);
    const tbl = b ? xml.slice(b.start, b.end) : '';
    const tblPr = (/<w:tblPr>[\s\S]*?<\/w:tblPr>/.exec(tbl) || [''])[0];
    const tblB = (/<w:tblBorders>([\s\S]*?)<\/w:tblBorders>/.exec(tblPr) || [])[1];
    const cellB = tbl.match(/<w:tcBorders>[\s\S]*?<\/w:tcBorders>/g) || [];
    const isNil = (s) => /w:val="(nil|none)"/.test(s);
    const edges = (s) => (s.match(/<w:(top|left|bottom|right|insideH|insideV)\b[^>]*\/>/g) || []);
    const hasStyle = /<w:tblStyle\b/.test(tblPr);
    let mode = 'all';
    if (!hasStyle && tblB != null) {
      const tb = edges(tblB);
      const cellsNil = cellB.every((c) => edges(c).every(isNil));
      if (tb.length && tb.every(isNil) && cellsNil) mode = 'none';
      else if (/<w:insideH w:val="(nil|none)"/.test(tblB) && /<w:insideV w:val="(nil|none)"/.test(tblB)
        && !cellB.some((c) => edges(c).some((e) => !isNil(e)))) mode = 'outer';
    }
    tables.push(mode);
    const grid = (/<w:tblGrid>([\s\S]*?)<\/w:tblGrid>/.exec(tbl) || [])[1] || '';
    const cols = (grid.match(/<w:gridCol w:w="(\d+)"/g) || []).map((g) => +/(\d+)"/.exec(g)[1]);
    colWidths.push(cols);
  }
  return { images, tables, colWidths };
}

function postProcessImportedHtml(html, extras) {
  const D = dom();
  if (!D) return html;
  let doc;
  try {
    doc = D.createDocument('<!DOCTYPE html><html><head></head><body>' + html + '</body></html>');
  } catch {
    return html;
  }
  const body = doc.body;
  const ex = extras || {};

  const imgs = Array.from(body.querySelectorAll('img'));
  if (ex.images && ex.images.length === imgs.length) {
    imgs.forEach((img, i) => {
      const s = ex.images[i];
      if (!s || !(s.w > 0) || !(s.h > 0)) return;
      img.style.setProperty('width', s.w + 'px');
      img.style.setProperty('height', s.h + 'px');
    });
  }

  const tables = Array.from(body.querySelectorAll('table'));
  if (ex.tables && ex.tables.length === tables.length) {
    tables.forEach((t, i) => {
      if (ex.tables[i] === 'none') t.classList.add('margo-tbl-none');
      else if (ex.tables[i] === 'outer') t.classList.add('margo-tbl-outer');
      /* Column widths, as shares of the table, when they are not all equal
         (equal columns are what the page draws anyway). */
      const cols = (ex.colWidths && ex.colWidths[i]) || [];
      const sum = cols.reduce((a, b) => a + b, 0);
      const firstRow = t.querySelector('tr');
      const slots = firstRow ? Array.from(firstRow.children).reduce((n, c) => n + (parseInt(c.getAttribute('colspan') || '1', 10) || 1), 0) : 0;
      const uneven = cols.some((w) => Math.abs(w - cols[0]) > 20);
      if (sum > 0 && cols.length > 1 && cols.length === slots && uneven && !t.querySelector('colgroup')) {
        const cg = doc.createElement('colgroup');
        cols.forEach((w) => {
          const col = doc.createElement('col');
          col.setAttribute('style', 'width:' + (w * 100 / sum).toFixed(2) + '%');
          cg.appendChild(col);
        });
        t.insertBefore(cg, t.firstChild);
        if (!t.getAttribute('style')) t.setAttribute('style', 'width:100%');
      }
    });
  }

  // An empty paragraph with only a bottom rule is a horizontal line.
  Array.from(body.querySelectorAll('p')).forEach((p) => {
    if (!p.textContent.trim() && !p.querySelector('img') && /border-bottom/.test(p.getAttribute('style') || '')) {
      p.replaceWith(doc.createElement('hr'));
    }
  });

  /* Footnotes and endnotes: mammoth writes a bracketed link per reference
     and an ordered list of notes at the end; Margo keeps numbered
     references and a notes block it renumbers itself. */
  const noteItems = Array.from(body.querySelectorAll('li[id^="footnote-"], li[id^="endnote-"]'));
  const refs = Array.from(body.querySelectorAll('a[href^="#footnote-"], a[href^="#endnote-"]'))
    .filter((a) => !/-ref-/.test(a.getAttribute('href') || ''));
  if (refs.length) {
    const block = doc.createElement('div');
    block.className = 'margo-footnotes';
    const ol = doc.createElement('ol');
    block.appendChild(ol);
    const byId = new Map(noteItems.map((li) => [li.getAttribute('id'), li]));
    refs.forEach((a, i) => {
      const target = (a.getAttribute('href') || '').slice(1);
      const id = 'fnimp' + (i + 1);
      const sup = doc.createElement('sup');
      sup.className = 'margo-fn-ref';
      sup.setAttribute('data-fn', id);
      sup.textContent = String(i + 1);
      let host = a;
      while (host.parentNode && host.parentNode.tagName === 'SUP' && host.parentNode.childNodes.length === 1) host = host.parentNode;
      host.replaceWith(sup);
      const li = doc.createElement('li');
      li.setAttribute('data-fn', id);
      const src = byId.get(target);
      if (src) {
        src.querySelectorAll('a[href^="#footnote-ref-"], a[href^="#endnote-ref-"]').forEach((b) => b.remove());
        li.textContent = (src.textContent || '').replace(/\s+/g, ' ').trim();
      }
      if (!li.textContent) li.appendChild(doc.createElement('br'));
      ol.appendChild(li);
    });
    const lists = new Set(noteItems.map((li) => li.parentNode).filter(Boolean));
    lists.forEach((l) => l.remove());
    body.appendChild(block);
  }

  // Blank lines: mammoth writes them as <p></p>, which has no height.
  Array.from(body.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li')).forEach((el) => {
    if (!el.childNodes.length) el.appendChild(doc.createElement('br'));
  });

  // Glyph paragraphs back into a checklist.
  const BOX = /^\s*([\u2610\u2611\u2612])\s?/;
  let list = null;
  Array.from(body.children).forEach((el) => {
    const isItem = el.tagName === 'P' && BOX.test(el.textContent || '');
    if (!isItem) { list = null; return; }
    if (!list) {
      list = doc.createElement('ul');
      list.className = 'margo-checklist';
      el.parentNode.insertBefore(list, el);
    }
    const li = doc.createElement('li');
    const walker = doc.createTreeWalker(el, 4);
    let t;
    while ((t = walker.nextNode())) {
      if (!t.nodeValue.trim()) continue;
      const m = BOX.exec(t.nodeValue);
      if (m) {
        if (m[1] !== '\u2610') li.className = 'is-checked';
        t.nodeValue = t.nodeValue.slice(m[0].length);
      }
      break;
    }
    while (el.firstChild) li.appendChild(el.firstChild);
    if (!li.childNodes.length || !li.textContent.trim() && !li.querySelector('img')) li.appendChild(doc.createElement('br'));
    list.appendChild(li);
    el.remove();
  });

  return body.innerHTML;
}

/* Does a header or footer part carry a page number field? */
function hasPageField(xml) {
  return /w:instr="\s*PAGE\b/i.test(xml || '') || /<w:instrText[^>]*>\s*PAGE\b/i.test(xml || '');
}

/* Strip fields (their instructions and cached results) from a header or
   footer part before it is read for text. */
function stripFields(xml) {
  return String(xml || '')
    .replace(/<w:fldSimple\b[^>]*>[\s\S]*?<\/w:fldSimple>/g, '')
    .replace(/<w:fldChar w:fldCharType="begin"\/>[\s\S]*?<w:fldChar w:fldCharType="end"\/>/g, '')
    .replace(/<w:instrText\b[^>]*>[\s\S]*?<\/w:instrText>/g, '');
}

module.exports = {
  prepareDocxHtml,
  finishDocx,
  readImportExtras,
  postProcessImportedHtml,
  hasPageField,
  stripFields
};
