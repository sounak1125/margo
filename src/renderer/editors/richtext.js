/* Margo — rich text editor for Word documents: real page geometry, a flowing
   multi-page layout engine, a grouped ribbon, and the document features a
   word processor is expected to have (styles, lists and checklists, tables,
   images, page breaks, headers and footers, a table of contents, footnotes,
   comments, find & replace). Everything here survives a .docx round trip
   where the format allows; see src/main/docx-fidelity.js for the other half. */
(function () {
  const ALLOWED_TAGS = [
    'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'sub', 'sup',
    'ul', 'ol', 'li', 'a', 'br', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'colgroup', 'col',
    'img', 'figure', 'figcaption', 'blockquote', 'code', 'pre', 'div', 'span', 'hr', 'font', 'mark'
  ];
  const ALLOWED_ATTR = [
    'href', 'src', 'alt', 'style', 'colspan', 'rowspan', 'face', 'color', 'class', 'align', 'valign', 'bgcolor',
    'data-margo-page-break', 'data-margo-note-id', 'data-callout-type', 'data-align', 'data-width', 'data-fn'
  ];
  const PAGE_BREAK_HTML = '<div data-margo-page-break style="page-break-before:always"></div>';
  const EMPTY_PAGE = '<p><br></p>';

  const FONTS = window.MargoFonts;
  const FONT_FAMILIES = FONTS.FAMILIES;
  const FONT_SIZES = FONTS.SIZES;
  const PICKER = window.MargoColorPicker;
  /* Word names its highlights rather than storing a colour, so a highlight
     that lands on one of those exact values keeps the matching class and
     round-trips as that name. Every other colour is inline background only,
     which is what Google Docs writes and what docx shading carries. */
  const WORD_HL_CLASS = {
    '#ffff00': 'hl-yellow',
    '#00ff00': 'hl-green',
    '#00ffff': 'hl-cyan',
    '#ff00ff': 'hl-pink',
    '#0000ff': 'hl-blue',
    '#ff0000': 'hl-red',
    '#ffa500': 'hl-orange',
    '#808000': 'hl-darkyellow',
    '#800080': 'hl-purple',
    '#c0c0c0': 'hl-gray'
  };
  const SYMBOL_CATEGORIES = [
    {
      title: 'Common & Punctuation',
      symbols: ['©', '®', '™', '°', '•', '—', '–', '¶', '§', '†', '‡', '…', '‰', '′', '″', '‹', '›', '«', '»', '№']
    },
    {
      title: 'Currency',
      symbols: ['$', '€', '£', '¥', '₹', '₩', '¢', '฿', '₽', '₿', '₺', '₴', '₱', '₲', '₵', '₢']
    },
    {
      title: 'Math & Science',
      symbols: ['±', '×', '÷', '=', '≠', '≈', '≤', '≥', '√', '∞', 'π', '∑', '∫', '∆', 'µ', 'Ω', '∂', '∏', '¬', '‰']
    },
    {
      title: 'Greek Letters',
      symbols: ['α', 'β', 'γ', 'δ', 'ε', 'ζ', 'η', 'θ', 'ι', 'κ', 'λ', 'μ', 'ν', 'ξ', 'π', 'ρ', 'σ', 'τ', 'φ', 'ψ', 'ω', 'Δ', 'Γ', 'Θ', 'Λ', 'Σ', 'Φ', 'Ψ', 'Ω']
    },
    {
      title: 'Arrows',
      symbols: ['←', '→', '↑', '↓', '↔', '↕', '↖', '↗', '↘', '↙', '⇐', '⇒', '⇑', '⇓', '⇔', '↺', '↻', '➔', '➜', '➤']
    },
    {
      title: 'Shapes',
      symbols: ['✓', '✔', '✕', '✖', '★', '☆', '✦', '✧', '♠', '♣', '♥', '♦', '☺', '☻', '♫', '♪', '⚡', '❄', '☀', '☁', '☕', '✉', '✂', '☐', '☒']
    }
  ];
  const TEMP_FONT_FACE = '__margo_face__';

  /* Paragraph styles, in gallery order. Title and Subtitle are paragraphs
     with a class rather than headings, so they stay out of the outline and
     the table of contents the way they do in Word. */
  const PARA_STYLES = [
    { id: 'p', label: 'Normal text', tag: 'p', key: 'Ctrl+Alt+0' },
    { id: 'title', label: 'Title', tag: 'p', cls: 'margo-title' },
    { id: 'subtitle', label: 'Subtitle', tag: 'p', cls: 'margo-subtitle' },
    { id: 'h1', label: 'Heading 1', tag: 'h1', key: 'Ctrl+Alt+1' },
    { id: 'h2', label: 'Heading 2', tag: 'h2', key: 'Ctrl+Alt+2' },
    { id: 'h3', label: 'Heading 3', tag: 'h3', key: 'Ctrl+Alt+3' },
    { id: 'h4', label: 'Heading 4', tag: 'h4', key: 'Ctrl+Alt+4' },
    { id: 'quote', label: 'Quote', tag: 'blockquote' },
    { id: 'code', label: 'Code', tag: 'pre' }
  ];
  const STYLE_CLASSES = ['margo-title', 'margo-subtitle'];

  // Page geometry, inches, portrait.
  const PAGE_SIZES = {
    letter: { w: 8.5, h: 11, label: 'Letter', hint: '8.5 × 11 in' },
    a4: { w: 8.27, h: 11.69, label: 'A4', hint: '210 × 297 mm' },
    legal: { w: 8.5, h: 14, label: 'Legal', hint: '8.5 × 14 in' },
    executive: { w: 7.25, h: 10.5, label: 'Executive', hint: '7.25 × 10.5 in' },
    a5: { w: 5.83, h: 8.27, label: 'A5', hint: '148 × 210 mm' }
  };
  // Word's presets and what Margo writes into the file (top, right, bottom, left).
  const MARGIN_PRESETS = {
    normal: { t: 1, r: 1, b: 1, l: 1, label: 'Normal', hint: '1 in all round' },
    narrow: { t: 0.5, r: 0.5, b: 0.5, l: 0.5, label: 'Narrow', hint: '0.5 in all round' },
    moderate: { t: 0.75, r: 0.75, b: 0.75, l: 0.75, label: 'Moderate', hint: '0.75 in all round' },
    wide: { t: 1, r: 2, b: 1, l: 2, label: 'Wide', hint: '1 in top and bottom, 2 in sides' }
  };
  const LINE_SPACINGS = ['1', '1.15', '1.5', '2', '2.5', '3'];
  const PARA_SPACINGS = [0, 6, 12, 18, 24];
  const INDENT_STEP_PT = 36;

  function sanitizeHtml(html) {
    return DOMPurify.sanitize(html || EMPTY_PAGE, { ALLOWED_TAGS, ALLOWED_ATTR });
  }

  function splitPages(html) {
    const wrap = document.createElement('div');
    wrap.innerHTML = sanitizeHtml(html);
    const parts = [];
    let bucket = [];
    const flush = () => {
      const d = document.createElement('div');
      bucket.forEach((n) => d.appendChild(n));
      parts.push(d.innerHTML || EMPTY_PAGE);
      bucket = [];
    };
    Array.from(wrap.childNodes).forEach((node) => {
      if (node.nodeType === 1 && node.hasAttribute('data-margo-page-break')) flush();
      else bucket.push(node);
    });
    flush();
    return parts.length ? parts : [EMPTY_PAGE];
  }

  function uid() {
    return 'n' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  }

  function cssEscape(s) {
    if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(s);
    return String(s).replace(/[^a-zA-Z0-9_-]/g, (c) => '\\' + c);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  function escapeRegExp(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  const BLOCK_TEXT_TAGS = new Set([
    'P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'UL', 'OL', 'TR', 'TD', 'TH',
    'TABLE', 'BLOCKQUOTE', 'PRE', 'SECTION', 'ARTICLE', 'HR', 'FIGURE', 'FIGCAPTION'
  ]);

  /* Layout-free stand-in for innerText. Reading innerText forces a synchronous
     reflow of the entire document, which is far too expensive to run on the
     typing path; this walks text nodes instead and only approximates the
     whitespace collapsing innerText does - close enough for word/char counts. */
  function collectText(node, out) {
    for (let n = node.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === 3) { out.push(n.nodeValue); continue; }
      if (n.nodeType !== 1) continue;
      const tag = n.tagName;
      if (tag === 'BR') { out.push('\n'); continue; }
      if (tag === 'SCRIPT' || tag === 'STYLE') continue;
      if (n.classList && (n.classList.contains('doc-img-overlay') || n.classList.contains('margo-toc'))) continue;
      collectText(n, out);
      if (BLOCK_TEXT_TAGS.has(tag)) out.push('\n');
    }
    return out;
  }

  function plainText(el) {
    if (!el) return '';
    return collectText(el, [])
      .join('')
      .replace(/[ \t ]+/g, ' ')
      .replace(/ *\n[ \n]*/g, '\n')
      .trim();
  }

  /* ---------- icons ----------
     The shell's MargoIcons carry the common set; these are the ones a word
     processor needs on top. Same grid and stroke as the shell's, and every
     one of them is drawn, not typed - letters in a toolbar change weight and
     width with the UI font. */
  const SVG = (d) =>
    `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const DI = {
    bold: SVG('<path d="M4.5 2.8h4.3a2.6 2.6 0 0 1 0 5.2H4.5zM4.5 8h5a2.6 2.6 0 0 1 0 5.2h-5z" stroke-width="1.9"/>'),
    italic: SVG('<path d="M7 2.8h5M4 13.2h5M9.6 2.8 6.4 13.2"/>'),
    underline: SVG('<path d="M4.5 2.5v5a3.5 3.5 0 0 0 7 0v-5M3.5 14h9"/>'),
    strike: SVG('<path d="M2.5 8h11M10.9 4.6c-.4-1.2-1.6-2-3-2-1.7 0-3 1-3 2.4 0 .8.4 1.5 1.4 2M5 11.2c.4 1.3 1.6 2.2 3.2 2.2 1.8 0 3.1-1 3.1-2.5 0-.6-.2-1.1-.6-1.5"/>'),
    subscript: SVG('<path d="m2.5 3.5 5.5 7M8 3.5l-5.5 7M11 11.2a1.3 1.3 0 1 1 2.4.7L11 14.5h2.8"/>'),
    superscript: SVG('<path d="m2.5 5.5 5.5 7M8 5.5l-5.5 7M11 3.2a1.3 1.3 0 1 1 2.4.7L11 6.5h2.8"/>'),
    grow: SVG('<path d="m2 13 3.6-9.5L9.2 13M3.3 9.8h4.6M11 6.5h4M13 4.5v4"/>'),
    shrink: SVG('<path d="m2 13 3.6-9.5L9.2 13M3.3 9.8h4.6M11 6.5h4"/>'),
    textColor: SVG('<path d="m4 11 4-8.5L12 11M5.5 8h5"/><path class="doc-swatch-bar" d="M2.5 14h11" stroke-width="2.4"/>'),
    highlight: SVG('<path d="m10 2.5 3.5 3.5-5.3 5.3H4.7V7.8z"/><path d="m8.4 4.1 3.5 3.5M4.7 11.3 3 13"/><path class="doc-swatch-bar" d="M2.5 14.6h11" stroke-width="2.2"/>'),
    clear: SVG('<path d="M3 3.5h8M7 3.5 5.2 12.5M9.5 9.5l4 4M13.5 9.5l-4 4"/>'),
    caseChange: SVG('<path d="m1.8 12.5 3-9 3 9M2.9 9.4h3.8M11.6 12.5a1.9 1.9 0 1 1 0-3.8 1.9 1.9 0 0 1 0 3.8zM13.5 7v5.5"/>'),
    painter: SVG('<rect x="2.5" y="2" width="9" height="4" rx="1"/><path d="M11.5 4h1.5v3.5H8v2.3"/><rect x="6.8" y="9.8" width="2.4" height="4.4" rx=".8"/>'),
    ul: SVG('<circle cx="3" cy="4" r=".6" fill="currentColor"/><circle cx="3" cy="8" r=".6" fill="currentColor"/><circle cx="3" cy="12" r=".6" fill="currentColor"/><path d="M6 4h8M6 8h8M6 12h8"/>'),
    ol: SVG('<path d="M2.4 2.8 3.4 2.2v3.5M2.3 9.4a1 1 0 0 1 1.9.4l-1.9 2.2h2M6.5 4h7.5M6.5 8h7.5M6.5 12h7.5"/>'),
    checklist: SVG('<rect x="1.8" y="2.3" width="3.8" height="3.8" rx="1"/><path d="m2.6 4.2.9.9 1.4-1.6"/><rect x="1.8" y="9.8" width="3.8" height="3.8" rx="1"/><path d="M8 4.2h6M8 11.7h6"/>'),
    indentInc: SVG('<path d="M2 3h12M7 6.5h7M7 10h7M2 13.5h12M2.2 6.3l2.4 1.9-2.4 1.9"/>'),
    indentDec: SVG('<path d="M2 3h12M7 6.5h7M7 10h7M2 13.5h12M4.6 6.3 2.2 8.2l2.4 1.9"/>'),
    alignLeft: SVG('<path d="M2 3.5h12M2 6.5h8M2 9.5h12M2 12.5h8"/>'),
    alignCenter: SVG('<path d="M2 3.5h12M4 6.5h8M2 9.5h12M4 12.5h8"/>'),
    alignRight: SVG('<path d="M2 3.5h12M6 6.5h8M2 9.5h12M6 12.5h8"/>'),
    alignJustify: SVG('<path d="M2 3.5h12M2 6.5h12M2 9.5h12M2 12.5h12"/>'),
    spacing: SVG('<path d="M7 3.5h7M7 8h7M7 12.5h7M3.5 2v12M2 3.5 3.5 2 5 3.5M2 12.5 3.5 14 5 12.5"/>'),
    styles: SVG('<path d="m1.8 12.5 3.2-9 3.2 9M3 9.3h4.3M10 12.5V5.8M10 5.8h3.4M10 9.1h2.8"/>'),
    chevron: SVG('<path d="m4.5 6.2 3.5 3.5 3.5-3.5"/>'),
    chevronUp: SVG('<path d="m4.5 9.8 3.5-3.5 3.5 3.5"/>'),
    check: SVG('<path d="m3.2 8.4 3 3 6.6-6.8"/>'),
    pageBreak: SVG('<path d="M3.5 6V2.5h9V6M3.5 10v3.5h9V10M1.5 8h2M6 8h4M12.5 8h2"/>'),
    blankPage: SVG('<path d="M3.5 1.8h6.2L12.5 4.6v9.6h-9z"/><path d="M9.5 1.8v3h3M8 7.4v4.4M5.8 9.6h4.4"/>'),
    table: SVG('<rect x="2" y="2.5" width="12" height="11" rx="1.5"/><path d="M2 6.3h12M2 10h12M6.2 6.3v7.2M9.8 6.3v7.2"/>'),
    image: SVG('<rect x="2" y="3" width="12" height="10" rx="1.8"/><circle cx="5.6" cy="6.4" r="1.1"/><path d="m3 11.5 3.2-3 2.3 2.2 2.5-2.7 2 2"/>'),
    link: SVG('<path d="M6.8 9.2a2.7 2.7 0 0 0 3.8 0l2.2-2.2a2.7 2.7 0 1 0-3.8-3.8l-.9.9M9.2 6.8a2.7 2.7 0 0 0-3.8 0L3.2 9a2.7 2.7 0 0 0 3.8 3.8l.9-.9"/>'),
    hr: SVG('<path d="M2 8h12"/><path d="M4 4.5h8M4 11.5h8" opacity=".35"/>'),
    symbol: SVG('<path d="M4 13.2h2.4V11A4.6 4.6 0 1 1 9.6 11v2.2H12"/>'),
    callout: SVG('<rect x="2" y="2.5" width="12" height="11" rx="1.8"/><path d="M4.7 2.5v11M7 6h4.5M7 9h3"/>'),
    date: SVG('<rect x="2.5" y="3.5" width="11" height="10" rx="1.5"/><path d="M2.5 7h11M5.5 2v3M10.5 2v3M5.5 9.8h1.5"/>'),
    header: SVG('<rect x="2.5" y="1.8" width="11" height="12.4" rx="1.2"/><path d="M4.6 4.3h6.8" stroke-width="2"/><path d="M4.6 7.5h6.8M4.6 10h4.5" opacity=".4"/>'),
    footer: SVG('<rect x="2.5" y="1.8" width="11" height="12.4" rx="1.2"/><path d="M4.6 11.7h6.8" stroke-width="2"/><path d="M4.6 4.5h6.8M4.6 7h4.5" opacity=".4"/>'),
    pageNumber: SVG('<path d="M3.5 1.8h6.2L12.5 4.6v9.6h-9z"/><path d="M7 8.3 8.2 7.6v4"/>'),
    pageSize: SVG('<path d="M3.5 1.8h6.2L12.5 4.6v9.6h-9z"/><path d="M9.5 1.8v3h3"/>'),
    orientation: SVG('<rect x="1.8" y="4.5" width="9.5" height="7" rx="1"/><path d="M5 4.5V2.8a1 1 0 0 1 1-1h7.2a1 1 0 0 1 1 1v8.5a1 1 0 0 1-1 1h-1.9" opacity=".45"/>'),
    margins: SVG('<rect x="2.5" y="1.8" width="11" height="12.4" rx="1.2"/><path d="M5.2 1.8v12.4M10.8 1.8v12.4M2.5 4.4h11M2.5 11.6h11" stroke-dasharray="1.3 1.4" opacity=".7"/>'),
    columns: SVG('<rect x="2" y="2.5" width="5" height="11" rx="1"/><rect x="9" y="2.5" width="5" height="11" rx="1"/>'),
    toc: SVG('<path d="M2.5 3.5h7M2.5 7h5M4.5 10.5h5M4.5 13.5h4"/><path d="M12.5 3.5h1M10.5 7h3M12 10.5h1.5M11 13.5h2.5" stroke-dasharray=".1 1.6"/>'),
    tocUpdate: SVG('<path d="M13.2 8A5.2 5.2 0 1 1 11.6 4.3"/><path d="M13.3 2.6v2.8h-2.8"/><path d="M5.5 7h4M5.5 9.5h3"/>'),
    footnote: SVG('<path d="M2.5 3.5h8M2.5 6.5h8M2.5 9.5h4"/><path d="M11.5 8.5 12.6 8v3.5" /><path d="M2.5 13.2h11" opacity=".45"/>'),
    comment: SVG('<path d="M13.5 9.5a1.8 1.8 0 0 1-1.8 1.8H6.2L3 13.5v-2.2H4.3a1.8 1.8 0 0 1-1.8-1.8v-5A1.8 1.8 0 0 1 4.3 2.7h7.4a1.8 1.8 0 0 1 1.8 1.8z"/>'),
    search: SVG('<circle cx="7" cy="7" r="4.5"/><path d="m13.5 13.5-3.2-3.2"/>'),
    replace: SVG('<path d="M3 7V4a1 1 0 0 1 1-1h7M9 1.5l2.5 1.5L9 4.5M13 9v3a1 1 0 0 1-1 1H5M7 14.5l-2.5-1.5L7 11.5"/>'),
    spellcheck: SVG('<path d="m2.5 10 2.6-7 2.6 7M3.5 7.6h3.2M9.5 11l2 2 3-4"/>'),
    stats: SVG('<path d="M3 13V8.5M7 13V4.5M11 13V6.5M14 13.5H2"/>'),
    imageStack: SVG('<rect x="5" y="2.5" width="8.5" height="8.5" rx="1.6"/><circle cx="7.9" cy="5.4" r=".9"/><path d="m5.6 9.8 2.5-2.4 1.8 1.7 1.9-2.1 1.7 1.7"/><path d="M11 13.5H4a1.5 1.5 0 0 1-1.5-1.5V5.2"/>'),
    outline: SVG('<path d="M2.5 4h2M6.5 4h7M2.5 8h2M6.5 8h7M2.5 12h2M6.5 12h7"/>'),
    printLayout: SVG('<path d="M3.5 1.8h6.2L12.5 4.6v9.6h-9z"/><path d="M5.5 8h5M5.5 10.5h5"/>'),
    readView: SVG('<path d="M2 8s2.5-4 6-4 6 4 6 4-2.5 4-6 4-6-4-6-4z"/><circle cx="8" cy="8" r="1.8"/>'),
    split: SVG('<rect x="2" y="2" width="12" height="12" rx="1.5"/><path d="M2 8h12"/>'),
    zoomIn: SVG('<circle cx="7" cy="7" r="4.5"/><path d="m13.5 13.5-3.2-3.2M7 5.2v3.6M5.2 7h3.6"/>'),
    zoomOut: SVG('<circle cx="7" cy="7" r="4.5"/><path d="m13.5 13.5-3.2-3.2M5.2 7h3.6"/>'),
    zoomReset: SVG('<path d="M2.5 6V3.5a1 1 0 0 1 1-1H6M10 2.5h2.5a1 1 0 0 1 1 1V6M13.5 10v2.5a1 1 0 0 1-1 1H10M6 13.5H3.5a1 1 0 0 1-1-1V10"/>'),
    focus: SVG('<path d="M2 5.5V2.5h3M14 5.5V2.5h-3M2 10.5v3h3M14 10.5v3h-3"/><circle cx="8" cy="8" r="1.6"/>'),
    rowAbove: SVG('<rect x="2" y="8" width="12" height="6" rx="1.2"/><path d="M2 11h12M8 1.8v4.4M5.8 4h4.4"/>'),
    rowBelow: SVG('<rect x="2" y="2" width="12" height="6" rx="1.2"/><path d="M2 5h12M8 9.8v4.4M5.8 12h4.4"/>'),
    colLeft: SVG('<rect x="8" y="2" width="6" height="12" rx="1.2"/><path d="M11 2v12M1.8 8h4.4M4 5.8v4.4"/>'),
    colRight: SVG('<rect x="2" y="2" width="6" height="12" rx="1.2"/><path d="M5 2v12M9.8 8h4.4M12 5.8v4.4"/>'),
    delRow: SVG('<rect x="2" y="5" width="12" height="6" rx="1.2"/><path d="m6 6.8 4 2.4M10 6.8 6 9.2" /><path d="M2 2.5h12M2 13.5h12" opacity=".4"/>'),
    delCol: SVG('<rect x="5" y="2" width="6" height="12" rx="1.2"/><path d="m6.8 6 2.4 4M9.2 6l-2.4 4"/><path d="M2.5 2v12M13.5 2v12" opacity=".4"/>'),
    delTable: SVG('<rect x="2" y="2.5" width="12" height="11" rx="1.5"/><path d="M2 6.3h12M6.2 6.3v7.2"/><path d="m9 8.8 3 3M12 8.8l-3 3"/>'),
    merge: SVG('<rect x="2" y="3.5" width="12" height="9" rx="1.2"/><path d="M4.6 8h2.2M9.2 8h2.2M5.6 6.6 7 8 5.6 9.4M10.4 6.6 9 8l1.4 1.4"/>'),
    splitCell: SVG('<rect x="2" y="3.5" width="12" height="9" rx="1.2"/><path d="M8 3.5v9M3.6 8h2.4M10 8h2.4M5 6.6 3.6 8 5 9.4M11 6.6 12.4 8 11 9.4"/>'),
    headerRow: SVG('<rect x="2" y="2.5" width="12" height="11" rx="1.5"/><path d="M2 6.3h12" /><path d="M2.6 4.4h10.8" stroke-width="2.6" opacity=".55"/><path d="M8 6.3v7.2"/>'),
    borderAll: SVG('<rect x="2.5" y="2.5" width="11" height="11" rx="1"/><path d="M2.5 8h11M8 2.5v11"/>'),
    borderOuter: SVG('<rect x="2.5" y="2.5" width="11" height="11" rx="1"/><path d="M2.5 8h11M8 2.5v11" stroke-dasharray="1.2 1.6" opacity=".5"/>'),
    borderNone: SVG('<rect x="2.5" y="2.5" width="11" height="11" rx="1" stroke-dasharray="1.2 1.6" opacity=".6"/><path d="M2.5 8h11M8 2.5v11" stroke-dasharray="1.2 1.6" opacity=".6"/>'),
    shading: SVG('<path d="m6.5 2 5.8 5.8-4.5 4.5a1.4 1.4 0 0 1-2 0L2.2 8.7a1.4 1.4 0 0 1 0-2z"/><path d="M13.6 10.5s1 1.3 1 2a1 1 0 0 1-2 0c0-.7 1-2 1-2z" fill="currentColor" stroke-width="1"/>'),
    valignTop: SVG('<path d="M2 2.5h12M8 5v8.5M5.5 7.5 8 5l2.5 2.5"/>'),
    valignMiddle: SVG('<path d="M2 8h12M8 1.8v3.8M8 10.4v3.8M6 4 8 5.6 10 4M6 12l2-1.6 2 1.6"/>'),
    valignBottom: SVG('<path d="M2 13.5h12M8 2.5V11M5.5 8.5 8 11l2.5-2.5"/>'),
    distribute: SVG('<rect x="2" y="3" width="12" height="10" rx="1.2"/><path d="M6 3v10M10 3v10M3.4 8h1.4M7.3 8h1.4M11.2 8h1.4"/>'),
    wrapInline: SVG('<rect x="5.5" y="5" width="5" height="4" rx=".8"/><path d="M2 11.8h12M2 3h12M2 7h2M12 7h2"/>'),
    wrapLeft: SVG('<rect x="2" y="3" width="6" height="5.5" rx=".8"/><path d="M10 3.5h4M10 6h4M10 8.5h4M2 11h12M2 13.5h8"/>'),
    wrapRight: SVG('<rect x="8" y="3" width="6" height="5.5" rx=".8"/><path d="M2 3.5h4M2 6h4M2 8.5h4M2 11h12M2 13.5h8"/>'),
    altText: SVG('<rect x="1.8" y="3" width="12.4" height="10" rx="1.8"/><path d="m4 11 1.9-5 1.9 5M4.6 9.5h2.6M10 6v5h2"/>'),
    resetSize: SVG('<path d="M3 6V3h3M13 10v3h-3M3 3l4 4M13 13l-4-4"/>'),
    trash: SVG('<path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.4a1 1 0 0 0 1 .9h3.8a1 1 0 0 0 1-.9l.6-8.4"/>'),
    close: SVG('<path d="m4 4 8 8M12 4l-8 8"/>'),
    matchCase: SVG('<path d="m1.5 12 2.8-8 2.8 8M2.5 9.4h3.6M10.6 12a1.9 1.9 0 1 1 0-3.8 1.9 1.9 0 0 1 0 3.8zM12.5 6.8V12"/>'),
    wholeWord: SVG('<path d="M2.5 5v6.5h11V5"/><path d="M5.5 9.3a1.3 1.3 0 1 1 0-2.6 1.3 1.3 0 0 1 0 2.6zM6.8 5.4v3.9M9.2 5.4v3.9M9.2 8a1.3 1.3 0 1 1 2.6 0 1.3 1.3 0 0 1-2.6 0z"/>'),
    regex: SVG('<path d="M10.5 2.5v6M8 4l5 3M13 4 8 7"/><rect x="2.5" y="10" width="3.5" height="3.5" rx=".6"/>'),
    undo: SVG('<path d="M3 6h7a3.5 3.5 0 0 1 0 7H6"/><path d="M5.5 3.5 3 6l2.5 2.5"/>'),
    redo: SVG('<path d="M13 6H6a3.5 3.5 0 0 0 0 7h4"/><path d="M10.5 3.5 13 6l-2.5 2.5"/>'),
    cut: SVG('<circle cx="4.2" cy="11.8" r="1.7"/><circle cx="11.8" cy="11.8" r="1.7"/><path d="M5.4 10.6 11.5 2.5M10.6 10.6 4.5 2.5"/>'),
    copy: SVG('<rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M10.5 5.5v-2a1.5 1.5 0 0 0-1.5-1.5H4a1.5 1.5 0 0 0-1.5 1.5V9A1.5 1.5 0 0 0 4 10.5h1.5"/>'),
    paste: SVG('<path d="M5.5 3.5H4A1.5 1.5 0 0 0 2.5 5v8A1.5 1.5 0 0 0 4 14.5h8A1.5 1.5 0 0 0 13.5 13V5A1.5 1.5 0 0 0 12 3.5h-1.5"/><rect x="5.5" y="1.5" width="5" height="3" rx="1"/>'),
    addWord: SVG('<path d="M2.5 3.5h8M2.5 6.5h6M2.5 9.5h4M11.5 9v5M9 11.5h5"/>'),
    openLink: SVG('<path d="M9 2.5h4.5V7M13.5 2.5 7.5 8.5M12 9.5v3a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3"/>')
  };
  /* Prefer the shell's drawing where one exists so the app speaks one icon
     language; fall back to the local set otherwise. */
  function icon(name, shellName) {
    const I = window.MargoIcons || {};
    return I[shellName || name] || DI[name] || '';
  }

  function create(ctx) {
    let pagesRoot = null;
    let scrollEl = null;
    let hostEl = null;
    let activePage = null;
    let savedRange = null;
    let lastRange = null;
    let destroyed = false;
    let selectDragging = false;
    let selectAnchor = null;
    let lastDragClientX = 0;
    let lastDragClientY = 0;
    let selectCrossLock = false;
    let selectCrossLockX = 0;
    let selectCrossLockY = 0;
    let crossPageRange = null;
    let crossPageNativeIdx = -1;
    let zoom = 1;
    const ZOOM_MIN = 0.4;
    const ZOOM_MAX = 2.5;
    let viewMode = 'print';
    let editorWrap = null;
    let splitGutter = null;
    let splitPreviewScroll = null;
    let splitPreviewRoot = null;
    let splitRatio = 0.55;
    const stateButtons = {};
    let styleBtn = null, familySelect = null, variantSelect = null, sizeSelect = null;
    let colorBar = null, hlBar = null;
    let alignBtns = {};
    let listBtns = {};
    let availableFonts = FONT_FAMILIES.slice();
    let fontFacesByFamily = new Map(
      FONT_FAMILIES.map((f) => [f, [{ style: 'Regular', fullName: f }]])
    );
    let tableTabBtn = null;
    let ribbonTabs = {};
    let ribbonPanels = {};
    let painterBtn = null;
    let spellBtn = null;
    let comments = [];
    let commentsRail = null;
    let commentsFab = null;
    let commentsBadge = null;
    let outlineRail = null;
    let findBar = null;
    let findInput = null;
    let replaceInput = null;
    let findCountEl = null;
    let findHits = [];
    let findIndex = -1;
    let findOpen = false;
    let findHighlighting = false;
    const findOpts = { matchCase: false, wholeWord: false, regex: false };
    let activeRibbonTab = 'home';
    const history = window.MargoHistory.create();
    let skipInputRecord = false;
    let lastPageCount = -1;
    let statesRaf = 0;
    let batchDepth = 0;
    let statusCache = { words: 0, chars: 0, pages: 1, page: 1 };
    let statusDirty = true;
    let spellEnabled = true;
    let painter = null;
    let imgOverlay = null;
    let selectedImg = null;

    const DEFAULT_LAYOUT = {
      size: 'letter',
      orientation: 'portrait',
      margins: 'normal',
      columns: 1,
      headerText: '',
      footerText: '',
      showPageNumbers: true,
      // Measured from the source file (inches). Present only for imported
      // documents whose geometry does not land exactly on a preset; the
      // menus still show the nearest preset name.
      pageIn: null,
      marginIn: null
    };
    let layout = { ...DEFAULT_LAYOUT };

    function getPageEl() {
      return activePage || (pagesRoot && pagesRoot.querySelector('.doc-page'));
    }
    function getPage() {
      const page = getPageEl();
      return page ? (page.querySelector('.doc-page-body') || page) : null;
    }

    function pageList() {
      return pagesRoot ? Array.from(pagesRoot.querySelectorAll(':scope > .doc-page')) : [];
    }

    function setActivePage(el) {
      if (el && el.classList && el.classList.contains('doc-page')) activePage = el;
    }

    function stripFindMarksFromClone(root) {
      root.querySelectorAll('mark.margo-find-hit').forEach((m) => {
        const parent = m.parentNode;
        if (!parent) return;
        while (m.firstChild) parent.insertBefore(m.firstChild, m);
        parent.removeChild(m);
      });
    }

    /* Editor-only state that must never reach the file: the find marks,
       the non-editable flag on generated blocks, the image selection. */
    function cleanClone(clone) {
      stripFindMarksFromClone(clone);
      clone.querySelectorAll('[contenteditable]').forEach((el) => el.removeAttribute('contenteditable'));
      clone.querySelectorAll('.doc-img-overlay').forEach((el) => el.remove());
      clone.querySelectorAll('img.is-selected').forEach((el) => el.classList.remove('is-selected'));
      clone.querySelectorAll('[class=""]').forEach((el) => el.removeAttribute('class'));
      normalizeFonts(clone);
    }

    function serializeDoc() {
      const pages = pageList();
      const bodyHtmls = pages.map((p) => {
        const src = p.querySelector('.doc-page-body') || p;
        const clone = src.cloneNode(true);
        if (src === p) {
          const h = clone.querySelector('.doc-page-header');
          if (h) h.remove();
          const f = clone.querySelector('.doc-page-footer');
          if (f) f.remove();
        }
        cleanClone(clone);
        return clone.innerHTML;
      });
      /* Only a page the document actually asked for gets a break in the saved
         HTML. Pages the flow created are joined seamlessly, so reopening or
         exporting does not freeze today's line wrapping into hard breaks. */
      let joined = bodyHtmls.reduce((acc, html, i) => {
        if (i === 0) return html;
        const explicit = pages[i].dataset.pageBreak !== 'auto';
        return acc + (explicit ? PAGE_BREAK_HTML : '') + html;
      }, '');
      /* Tables and paragraphs the flow had to break across pages are stitched
         back together, so saving never splits the author's table in two. */
      if (joined.indexOf('margo-continued') >= 0 || joined.indexOf('margoContinued') >= 0) {
        const tmp = document.createElement('div');
        tmp.innerHTML = joined;
        while (mergeContinued(tmp)) { /* repeat for runs of continuations */ }
        tmp.querySelectorAll('[data-margo-continued]').forEach((el) => {
          el.removeAttribute('data-margo-continued');
        });
        joined = tmp.innerHTML;
      }
      /* The stored field, the anchor attribute and the docx part all still say
         "note". Renaming them would strip the comments off every document
         Margo has already saved, and no reader ever sees them - so the rename
         stops here, and this is the one seam where the two words meet. */
      return {
        html: joined,
        notes: comments.map((n) => ({
          id: n.id,
          quote: n.quote,
          body: n.body,
          done: !!n.done,
          createdAt: n.createdAt
        })),
        layout: { ...layout }
      };
    }

    /* ---------- caret as a text offset ----------
       Undo rebuilds every page from the snapshot, so node references do not
       survive it. A character offset into the document's text does, which
       is what puts the caret back where the change was instead of at the
       top of page one. */
    function textOffsetOf(node, offset) {
      const bodies = pageBodies();
      const body = pageBodyOf(node);
      if (!body) return null;
      let total = 0;
      for (const b of bodies) {
        if (b === body) break;
        total += b.textContent.length;
      }
      try {
        const r = document.createRange();
        r.setStart(body, 0);
        r.setEnd(node, clampNodeOffset(node, offset));
        return total + r.toString().length;
      } catch {
        return total;
      }
    }

    function pointAtTextOffset(off) {
      const bodies = pageBodies();
      let left = Math.max(0, off || 0);
      for (let i = 0; i < bodies.length; i++) {
        const b = bodies[i];
        const len = b.textContent.length;
        if (left <= len || i === bodies.length - 1) {
          const walker = document.createTreeWalker(b, NodeFilter.SHOW_TEXT);
          let t;
          let last = null;
          while ((t = walker.nextNode())) {
            last = t;
            if (left <= t.nodeValue.length) return { node: t, offset: left };
            left -= t.nodeValue.length;
          }
          if (last) return { node: last, offset: last.nodeValue.length };
          return { node: b, offset: 0 };
        }
        left -= len;
      }
      return null;
    }

    function selectionOffsets() {
      const sel = window.getSelection();
      if (!sel || !sel.rangeCount) return null;
      const r = sel.getRangeAt(0);
      if (!pageBodyOf(r.startContainer)) return null;
      const start = textOffsetOf(r.startContainer, r.startOffset);
      const end = textOffsetOf(r.endContainer, r.endOffset);
      return start == null ? null : { start, end: end == null ? start : end };
    }

    function restoreSelectionOffsets(o) {
      if (!o) return false;
      const a = pointAtTextOffset(o.start);
      const b = pointAtTextOffset(o.end);
      if (!a) return false;
      try {
        const body = pageBodyOf(a.node);
        if (body) {
          body.focus({ preventScroll: true });
          setActivePage(body.closest('.doc-page'));
        }
        const r = document.createRange();
        r.setStart(a.node, clampNodeOffset(a.node, a.offset));
        if (b && pageBodyOf(b.node) === body) r.setEnd(b.node, clampNodeOffset(b.node, b.offset));
        else r.collapse(true);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(r);
        const el = a.node.nodeType === 1 ? a.node : a.node.parentElement;
        if (el && el.scrollIntoView) {
          const rect = el.getBoundingClientRect();
          const box = scrollEl ? scrollEl.getBoundingClientRect() : null;
          if (box && (rect.top < box.top || rect.bottom > box.bottom)) el.scrollIntoView({ block: 'center' });
        }
        return true;
      } catch {
        return false;
      }
    }

    function snapshot() {
      const snap = serializeDoc();
      snap.sel = selectionOffsets();
      return snap;
    }

    function restoreDoc(snap) {
      if (!pagesRoot || !snap) return;
      skipInputRecord = true;
      hideImageOverlay();
      comments = Array.isArray(snap.notes) ? snap.notes.map((n) => ({ ...n })) : [];
      layout = { ...DEFAULT_LAYOUT, ...(snap.layout || {}) };
      pagesRoot.innerHTML = '';
      splitPages(snap.html || EMPTY_PAGE).forEach((html, i) => {
        const el = makePageEl(html);
        el.dataset.pageBreak = i === 0 ? 'start' : 'explicit';
        pagesRoot.appendChild(el);
      });
      activePage = pagesRoot.querySelector('.doc-page');
      applyViewEditable();
      applyLayoutAttributes();
      hydrate();
      rehydrateCommentAnchors();
      updateCommentsBadge();
      renderCommentsRail();
      updateStatus();
      skipInputRecord = false;
      if (!restoreSelectionOffsets(snap.sel)) {
        const body = getPage();
        if (body) body.focus();
      }
      refreshStates();
      if (findOpen && findInput && findInput.value) runFind(findInput.value);
    }

    /* Keystrokes must stay cheap. updateStatus() reads the whole document and
       serializeDoc() deep-clones it, so both are deferred until the user pauses
       (or TYPING_MAX_MS of unbroken typing has elapsed) instead of running once
       per character. */
    const TYPING_IDLE_MS = 180;
    const TYPING_MAX_MS = 900;
    const TYPING_PAGINATE_IDLE_MS = 450;
    let typingTimer = 0;
    let typingSince = 0;

    function cancelTypingWork() {
      if (typingTimer) { clearTimeout(typingTimer); typingTimer = 0; }
      typingSince = 0;
    }

    function flushTypingWork() {
      if (!typingSince) { cancelTypingWork(); return; }
      cancelTypingWork();
      if (!pagesRoot || destroyed) return;
      // Pagination is expensive on image-heavy docs; defer until the user pauses
      // longer than the typing debounce. Undo snapshots skip the JSON round-trip
      // in history.js but still need serializeDoc().
      schedulePaginate(getPageEl(), TYPING_PAGINATE_IDLE_MS);
      renumberFootnotes();
      updateStatus();
      if (!skipInputRecord && !history.isApplying()) {
        history.record(snapshot(), { coalesce: true });
      }
      syncSplitPreview();
    }

    function scheduleTypingWork() {
      const now = Date.now();
      if (!typingSince) typingSince = now;
      else if (now - typingSince >= TYPING_MAX_MS) { flushTypingWork(); return; }
      if (typingTimer) clearTimeout(typingTimer);
      typingTimer = setTimeout(flushTypingWork, TYPING_IDLE_MS);
    }

    function scheduleRefreshStates() {
      if (statesRaf) return;
      statesRaf = requestAnimationFrame(() => { statesRaf = 0; if (!destroyed) refreshStates(); });
    }

    function recordNow() {
      cancelTypingWork();
      if (!pagesRoot || history.isApplying() || batchDepth > 0) return;
      history.record(snapshot());
    }

    /* The one thing every command does after it has changed the document. */
    function afterChange(opts) {
      if (batchDepth > 0) return;
      ctx.markDirty();
      refreshStates();
      updateStatus();
      recordNow();
      if (!opts || opts.paginate !== false) schedulePaginate(getPageEl());
      syncSplitPreview();
      if (selectedImg) positionImageOverlay();
    }

    /* Several DOM edits that the author sees as one action are recorded as
       one undo step. */
    function batch(fn) {
      batchDepth++;
      let result;
      try { result = fn(); }
      finally { batchDepth--; }
      if (batchDepth === 0) afterChange();
      return result;
    }

    function undo() {
      flushTypingWork();
      hideImageOverlay();
      if (history.undo(restoreDoc)) ctx.markDirty();
    }
    function redo() {
      flushTypingWork();
      hideImageOverlay();
      if (history.redo(restoreDoc)) ctx.markDirty();
    }

    /* ---------- selection ----------
       A toolbar control takes focus (a select, a picker, a modal) and the
       caret goes with it; every command used to act on whatever the browser
       had left behind, which after a dropdown was often nothing. The last
       selection inside the document is remembered as it moves, and each
       command puts it back before acting. */
    function rememberSelection() {
      const sel = window.getSelection();
      if (!sel || !sel.rangeCount) return;
      const r = sel.getRangeAt(0);
      if (pageBodyOf(r.startContainer) && pageBodyOf(r.endContainer)) lastRange = r.cloneRange();
    }

    function liveRange(r) {
      return r && r.startContainer && r.startContainer.isConnected && r.endContainer.isConnected
        && pageBodyOf(r.startContainer) ? r : null;
    }

    function ensureSelection() {
      const sel = window.getSelection();
      if (sel && sel.rangeCount) {
        const r = sel.getRangeAt(0);
        const body = pageBodyOf(r.startContainer);
        if (body) {
          if (document.activeElement !== body) {
            const keep = r.cloneRange();
            try { body.focus({ preventScroll: true }); } catch { body.focus(); }
            sel.removeAllRanges();
            sel.addRange(keep);
          }
          setActivePage(body.closest('.doc-page'));
          return sel.getRangeAt(0);
        }
      }
      const r = liveRange(savedRange) || liveRange(lastRange);
      if (r) {
        const body = pageBodyOf(r.startContainer);
        try { body.focus({ preventScroll: true }); } catch { body.focus(); }
        setActivePage(body.closest('.doc-page'));
        sel.removeAllRanges();
        sel.addRange(r.cloneRange());
        return sel.getRangeAt(0);
      }
      const body = getPage();
      if (body) {
        body.focus({ preventScroll: true });
        if (!sel.rangeCount || !pageBodyOf(sel.anchorNode)) {
          const c = document.createRange();
          c.selectNodeContents(body);
          c.collapse(true);
          sel.removeAllRanges();
          sel.addRange(c);
        }
        return sel.rangeCount ? sel.getRangeAt(0) : null;
      }
      return null;
    }

    function saveSelection() {
      const sel = window.getSelection();
      if (sel && sel.rangeCount && pageBodyOf(sel.getRangeAt(0).startContainer)) {
        savedRange = sel.getRangeAt(0).cloneRange();
      } else if (liveRange(lastRange)) {
        savedRange = lastRange.cloneRange();
      }
    }

    function restoreSelection() {
      const r = liveRange(savedRange) || liveRange(lastRange);
      if (!r) return;
      const body = pageBodyOf(r.startContainer);
      if (body && document.activeElement !== body) {
        try { body.focus({ preventScroll: true }); } catch { body.focus(); }
      }
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(r.cloneRange());
    }

    /* Run fn once per page the selection covers. Each page body is its own
       editing host, and execCommand never reaches past the one with focus,
       so formatting a selection that ran over a page break used to change
       only the first page of it. */
    function forEachSelectedSlice(fn) {
      const span = getCopySpan();
      if (span && span.startIdx !== span.endIdx) {
        for (let i = span.startIdx; i <= span.endIdx; i++) {
          const body = span.bodies[i];
          if (!body) continue;
          let r;
          try { r = slicePageRange(body, i, span); } catch { continue; }
          try { body.focus({ preventScroll: true }); } catch { body.focus(); }
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(r);
          fn(body, r);
        }
        clearCrossPageSelection();
        return;
      }
      const r = ensureSelection();
      const body = r ? pageBodyOf(r.startContainer) : getPage();
      if (body) fn(body, r);
    }

    function execRaw(cmd, value, withCss) {
      try { document.execCommand('styleWithCSS', false, !!withCss); } catch {}
      try { document.execCommand(cmd, false, value ?? null); } catch {}
      try { document.execCommand('styleWithCSS', false, false); } catch {}
    }

    function exec(cmd, value, withCss) {
      if (!getPage()) return;
      skipInputRecord = true;
      try {
        forEachSelectedSlice(() => execRaw(cmd, value, withCss));
      } finally {
        skipInputRecord = false;
      }
      afterChange();
    }

    /* A one-off insertion at the caret, never repeated per page. */
    function insertHtmlAtCaret(html) {
      ensureSelection();
      skipInputRecord = true;
      try { execRaw('insertHTML', html); }
      finally { skipInputRecord = false; }
      hydrate();
      afterChange();
    }

    function insertTextAtCaret(text) {
      ensureSelection();
      skipInputRecord = true;
      try { execRaw('insertText', text); }
      finally { skipInputRecord = false; }
      afterChange();
    }

    /* ---------- range helpers ---------- */
    const NON_TEXT_PARENTS = /^(TABLE|TBODY|THEAD|TFOOT|TR|UL|OL|COLGROUP)$/;

    function textPiecesInRange(range) {
      const out = [];
      if (!range || range.collapsed) return out;
      const root = range.commonAncestorContainer.nodeType === 1
        ? range.commonAncestorContainer : range.commonAncestorContainer.parentNode;
      if (range.commonAncestorContainer.nodeType === 3) {
        const t = range.commonAncestorContainer;
        if (range.endOffset > range.startOffset) out.push({ node: t, start: range.startOffset, end: range.endOffset });
        return out;
      }
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let t;
      while ((t = walker.nextNode())) {
        if (!range.intersectsNode(t)) continue;
        const parent = t.parentNode;
        if (!parent || NON_TEXT_PARENTS.test(parent.tagName)) continue;
        if (parent.closest && parent.closest('.doc-img-overlay')) continue;
        const start = t === range.startContainer ? range.startOffset : 0;
        const end = t === range.endContainer ? range.endOffset : t.nodeValue.length;
        if (end <= start) continue;
        // Whitespace between two blocks is markup, not text.
        if (!/\S/.test(t.nodeValue) && parent.classList && parent.classList.contains('doc-page-body')) continue;
        out.push({ node: t, start, end });
      }
      return out;
    }

    /* Wrap every text run the range covers in its own element. Wrapping the
       range whole (surroundContents, or extract-and-insert) put a <mark> or
       comment anchor around whole paragraphs when a selection crossed one,
       which is invalid markup and broke the paragraphs apart on save. */
    function wrapRange(range, make) {
      const pieces = textPiecesInRange(range);
      const made = [];
      pieces.forEach((p) => {
        let node = p.node;
        if (p.end < node.nodeValue.length) node.splitText(p.end);
        if (p.start > 0) node = node.splitText(p.start);
        const el = make();
        node.parentNode.insertBefore(el, node);
        el.appendChild(node);
        made.push(el);
      });
      if (made.length) {
        try {
          range.setStartBefore(made[0]);
          range.setEndAfter(made[made.length - 1]);
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(range);
        } catch {}
      }
      return made;
    }

    function unwrapEl(el) {
      const parent = el.parentNode;
      if (!parent) return;
      while (el.firstChild) parent.insertBefore(el.firstChild, el);
      parent.removeChild(el);
    }

    /* Take an inline wrapper (a highlight, a colour span) off the part of it
       the range covers and leave the rest of it where it was. */
    function unwrapInRange(range, selector) {
      if (!range || range.collapsed) return;
      const root = range.commonAncestorContainer.nodeType === 1
        ? range.commonAncestorContainer : range.commonAncestorContainer.parentNode;
      const els = [];
      const up = root.closest ? root.closest(selector) : null;
      if (up) els.push(up);
      root.querySelectorAll(selector).forEach((el) => { if (range.intersectsNode(el)) els.push(el); });
      els.forEach((el) => {
        if (!el.isConnected) return;
        const inner = document.createRange();
        inner.selectNodeContents(el);
        if (range.compareBoundaryPoints(Range.START_TO_START, inner) > 0) {
          const head = document.createRange();
          head.setStart(el, 0);
          head.setEnd(range.startContainer, range.startOffset);
          const clone = el.cloneNode(false);
          clone.appendChild(head.extractContents());
          if (clone.textContent) el.parentNode.insertBefore(clone, el);
        }
        if (range.compareBoundaryPoints(Range.END_TO_END, inner) < 0) {
          const tail = document.createRange();
          tail.setStart(range.endContainer, range.endOffset);
          tail.setEnd(el, el.childNodes.length);
          const clone = el.cloneNode(false);
          clone.appendChild(tail.extractContents());
          if (clone.textContent) el.parentNode.insertBefore(clone, el.nextSibling);
        }
        unwrapEl(el);
      });
    }

    function closestBlock(node, body) {
      let el = node && (node.nodeType === 1 ? node : node.parentElement);
      while (el && el !== body) {
        if (/^(P|H[1-6]|LI|BLOCKQUOTE|PRE)$/.test(el.tagName)) return el;
        if (el.tagName === 'DIV' && el.parentElement && /^(TD|TH)$/.test(el.parentElement.tagName)) return el;
        el = el.parentElement;
      }
      return null;
    }

    function blocksInRange(r) {
      if (!r) return [];
      const body = pageBodyOf(r.startContainer);
      if (!body) return [];
      if (r.collapsed) {
        const b = closestBlock(r.startContainer, body);
        return b ? [b] : [];
      }
      const hit = Array.from(body.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, blockquote, pre'))
        .filter((b) => r.intersectsNode(b) && !b.closest('.margo-toc'));
      const start = closestBlock(r.startContainer, body);
      if (start && !hit.includes(start)) hit.unshift(start);
      return hit.filter((b) => !hit.some((o) => o !== b && b.contains(o) && o.tagName !== 'LI'));
    }

    /* Blocks of the whole selection, across pages. */
    function selectedBlocks() {
      const out = [];
      const span = getCopySpan();
      if (span && span.startIdx !== span.endIdx) {
        for (let i = span.startIdx; i <= span.endIdx; i++) {
          const body = span.bodies[i];
          try { out.push(...blocksInRange(slicePageRange(body, i, span))); } catch {}
        }
        return out;
      }
      const r = ensureSelection();
      let blocks = blocksInRange(r);
      if (!blocks.length && r) {
        // Bare text straight in the page: give it a paragraph first.
        execRaw('formatBlock', '<p>');
        blocks = blocksInRange(window.getSelection().rangeCount ? window.getSelection().getRangeAt(0) : r);
      }
      return blocks;
    }

    /* ---------- character formatting ---------- */
    let pendingSize = null;
    let pendingFace = null;

    function replaceSizeMarkers(root, pt) {
      root.querySelectorAll('font[size="7"]').forEach((f) => {
        const span = document.createElement('span');
        span.style.fontSize = pt + 'pt';
        while (f.firstChild) span.appendChild(f.firstChild);
        f.replaceWith(span);
      });
    }

    function replaceFaceMarkers(root, face) {
      root.querySelectorAll(`font[face="${TEMP_FONT_FACE}"]`).forEach((f) => {
        const span = document.createElement('span');
        span.style.fontFamily = face.css;
        if (face.weight !== 400) span.style.fontWeight = String(face.weight);
        if (face.fontStyle !== 'normal') span.style.fontStyle = face.fontStyle;
        while (f.firstChild) span.appendChild(f.firstChild);
        f.replaceWith(span);
      });
    }

    /* A size or font chosen with nothing selected applies to what is typed
       next. execCommand parks it as a <font size=7> / placeholder face that
       only appears with the first keystroke, and the typed text used to
       stay in 72pt placeholder markup. */
    function fixPendingTypingStyles(body) {
      if (!body) return;
      if (body.querySelector('font[size="7"]')) replaceSizeMarkers(body, pendingSize || 11);
      if (body.querySelector(`font[face="${TEMP_FONT_FACE}"]`)) {
        replaceFaceMarkers(body, pendingFace || { css: 'Calibri', weight: 400, fontStyle: 'normal' });
      }
    }

    function setFontSize(pt) {
      if (!pt || !getPage()) return;
      const n = Math.max(1, Math.min(400, Number(pt)));
      skipInputRecord = true;
      try {
        forEachSelectedSlice((body, r) => {
          execRaw('fontSize', '7');
          if (r && r.collapsed) pendingSize = n;
          else replaceSizeMarkers(body, n);
        });
      } finally {
        skipInputRecord = false;
      }
      afterChange();
    }

    function currentFontPt() {
      const r = liveRange(lastRange);
      const node = r ? r.startContainer : null;
      const el = node && (node.nodeType === 1 ? node : node.parentElement);
      if (!el) return 11;
      return Math.round(parseFloat(getComputedStyle(el).fontSize) * 72 / 96 * 2) / 2;
    }

    function stepFontSize(dir) {
      const cur = currentFontPt();
      let next;
      if (dir > 0) next = FONT_SIZES.find((s) => s > cur) || Math.min(400, cur + 12);
      else next = [...FONT_SIZES].reverse().find((s) => s < cur) || Math.max(1, cur - 1);
      if (sizeSelect) sizeSelect.value = FONT_SIZES.includes(next) ? String(next) : '';
      setFontSize(next);
    }

    function applyFontFace(family, styleLabel) {
      if (!getPage() || !family) return;
      const faces = getFacesForFamily(family);
      const { weight, fontStyle } = FONTS.parseFontFaceStyle(styleLabel);
      const face = { css: FONTS.fontFamilyCss(family, styleLabel, faces), weight, fontStyle };
      skipInputRecord = true;
      try {
        forEachSelectedSlice((body, r) => {
          execRaw('fontName', TEMP_FONT_FACE);
          if (r && r.collapsed) pendingFace = face;
          else replaceFaceMarkers(body, face);
        });
      } finally {
        skipInputRecord = false;
      }
      afterChange();
    }

    function getFacesForFamily(family) {
      return FONTS.getFacesForFamily(family, fontFacesByFamily);
    }

    function fillVariantSelect(family, preferredStyle) {
      FONTS.fillVariantSelect(variantSelect, getFacesForFamily(family), preferredStyle);
    }

    function normalizeFonts(root) {
      root.querySelectorAll('font').forEach((f) => {
        const span = document.createElement('span');
        if (f.getAttribute('face') && f.getAttribute('face') !== TEMP_FONT_FACE) span.style.fontFamily = f.getAttribute('face');
        if (f.getAttribute('color')) span.style.color = f.getAttribute('color');
        while (f.firstChild) span.appendChild(f.firstChild);
        f.replaceWith(span);
      });
    }

    /* What the picker should show as already chosen. The computed style at the
       caret is the only thing that accounts for colour inherited from a parent
       span, which is how execCommand leaves it. */
    function currentInlineColor(prop) {
      const r = liveRange(savedRange) || liveRange(lastRange);
      const node = r ? r.startContainer : null;
      if (!node) return '';
      const el = node.nodeType === 1 ? node : node.parentElement;
      if (!el) return '';
      if (prop === 'backgroundColor') {
        const m = el.closest('mark:not(.margo-find-hit)');
        return m ? (m.style.backgroundColor || getComputedStyle(m).backgroundColor) : '';
      }
      return window.getComputedStyle(el)[prop] || '';
    }

    function applyTextColor(hex) {
      if (hex) {
        exec('foreColor', hex, true);
        setSwatch(colorBar, hex);
        return;
      }
      // Automatic: take the colour off rather than paint it black, so the
      // text follows the page in every theme.
      batch(() => forEachSelectedSlice((body, r) => {
        if (!r || r.collapsed) return;
        unwrapInRange(r, 'font[color]');
        textPiecesInRange(r).forEach((p) => {
          let el = p.node.parentElement;
          while (el && el !== body) {
            if (el.style && el.style.color) {
              el.style.removeProperty('color');
              if (!el.getAttribute('style')) el.removeAttribute('style');
              if (el.tagName === 'SPAN' && !el.attributes.length) unwrapEl(el);
            }
            el = el && el.parentElement;
          }
        });
      }));
      setSwatch(colorBar, '');
    }

    function applyTextHighlight(hexColor) {
      const hex = hexColor ? PICKER.normalizeHex(hexColor) : null;
      let changed = false;
      batch(() => forEachSelectedSlice((body, r) => {
        if (!r || r.collapsed) return;
        /* Re-highlighting over an existing mark would nest one inside the
           other and leave the old colour showing at the edges; clearing
           takes the mark off and leaves the bold, font and colour alone. */
        unwrapInRange(r, 'mark:not(.margo-find-hit)');
        changed = true;
        if (!hex) return;
        wrapRange(r, () => {
          const mark = document.createElement('mark');
          const wordClass = WORD_HL_CLASS[hex];
          if (wordClass) mark.className = wordClass;
          mark.style.backgroundColor = hex;
          return mark;
        });
      }));
      if (changed) setSwatch(hlBar, hex || '');
    }

    function setSwatch(bar, hex) {
      if (!bar) return;
      bar.style.stroke = hex || '';
    }

    function clearFormatting() {
      batch(() => forEachSelectedSlice((body, r) => {
        execRaw('removeFormat');
        const cur = window.getSelection().rangeCount ? window.getSelection().getRangeAt(0) : r;
        if (!cur || cur.collapsed) return;
        unwrapInRange(cur, 'mark:not(.margo-find-hit)');
        unwrapInRange(cur, 'span[style], font');
      }));
    }

    function transformTextCase(mode) {
      const map = (ch, prev, sentenceStart) => {
        if (mode === 'upper') return ch.toUpperCase();
        if (mode === 'lower') return ch.toLowerCase();
        if (mode === 'title') return /[\s\-(["'“‘/]/.test(prev) || prev === '' ? ch.toUpperCase() : ch.toLowerCase();
        if (mode === 'sentence') return sentenceStart ? ch.toUpperCase() : ch.toLowerCase();
        if (mode === 'toggle') return ch === ch.toUpperCase() ? ch.toLowerCase() : ch.toUpperCase();
        return ch;
      };
      batch(() => forEachSelectedSlice((body, r) => {
        if (!r || r.collapsed) return;
        /* Each text run is changed in place, so bold, colours and links
           survive; replacing the selection with plain text did not. */
        let prev = '';
        let sentenceStart = true;
        const pieces = textPiecesInRange(r);
        const first = pieces[0];
        const last = pieces[pieces.length - 1];
        const endOffset = last ? last.end : 0;
        pieces.forEach((p) => {
          const v = p.node.nodeValue;
          let out = '';
          for (const ch of v.slice(p.start, p.end)) {
            const isLetter = /\p{L}/u.test(ch);
            out += isLetter ? map(ch, prev, sentenceStart) : ch;
            if (isLetter) sentenceStart = false;
            else if (/[.!?]/.test(ch)) sentenceStart = true;
            prev = ch;
          }
          p.node.nodeValue = v.slice(0, p.start) + out + v.slice(p.end);
        });
        if (first && last) {
          try {
            const sel = window.getSelection();
            const nr = document.createRange();
            nr.setStart(first.node, first.start);
            nr.setEnd(last.node, Math.min(endOffset, last.node.nodeValue.length));
            sel.removeAllRanges();
            sel.addRange(nr);
          } catch {}
        }
      }));
    }

    /* ---------- format painter ---------- */
    function captureFormat() {
      const r = ensureSelection();
      if (!r) return null;
      const node = r.startContainer;
      const el = node.nodeType === 1 ? node : node.parentElement;
      const body = pageBodyOf(node);
      if (!el || !body) return null;
      const q = (c) => { try { return document.queryCommandState(c); } catch { return false; } };
      const within = (sel) => { const f = el.closest(sel); return f && body.contains(f) ? f : null; };
      const colorEl = within('[style*="color"]:not(mark), font[color]');
      const sizeEl = within('[style*="font-size"]');
      const faceEl = within('[style*="font-family"], font[face]');
      const mark = within('mark:not(.margo-find-hit)');
      const cs = getComputedStyle(el);
      return {
        bold: q('bold'), italic: q('italic'), underline: q('underline'), strikeThrough: q('strikeThrough'),
        subscript: q('subscript'), superscript: q('superscript'),
        color: colorEl ? (colorEl.style.color || colorEl.getAttribute('color')) : null,
        sizePt: sizeEl ? Math.round(parseFloat(cs.fontSize) * 72 / 96 * 2) / 2 : null,
        face: faceEl ? { css: faceEl.style.fontFamily || faceEl.getAttribute('face'), weight: parseInt(cs.fontWeight, 10) || 400, fontStyle: cs.fontStyle } : null,
        highlight: mark ? { cls: mark.className, bg: mark.style.backgroundColor } : null
      };
    }

    function applyCapturedFormat(fmt) {
      if (!fmt) return;
      batch(() => forEachSelectedSlice((body, r) => {
        if (!r || r.collapsed) return;
        execRaw('removeFormat');
        let cur = window.getSelection().getRangeAt(0);
        unwrapInRange(cur, 'mark:not(.margo-find-hit)');
        unwrapInRange(cur, 'span[style], font');
        ['bold', 'italic', 'underline', 'strikeThrough', 'subscript', 'superscript'].forEach((c) => {
          let on = false;
          try { on = document.queryCommandState(c); } catch {}
          if (!!fmt[c] !== on) execRaw(c);
        });
        if (fmt.color) execRaw('foreColor', fmt.color, true);
        if (fmt.sizePt) { execRaw('fontSize', '7'); replaceSizeMarkers(body, fmt.sizePt); }
        if (fmt.face && fmt.face.css) { execRaw('fontName', TEMP_FONT_FACE); replaceFaceMarkers(body, fmt.face); }
        if (fmt.highlight) {
          cur = window.getSelection().getRangeAt(0);
          wrapRange(cur, () => {
            const m = document.createElement('mark');
            if (fmt.highlight.cls) m.className = fmt.highlight.cls;
            if (fmt.highlight.bg) m.style.backgroundColor = fmt.highlight.bg;
            return m;
          });
        }
      }));
    }

    function togglePainter(sticky) {
      if (painter) { stopPainter(); return; }
      const fmt = captureFormat();
      if (!fmt) { ctx.toast('Put the cursor in the text whose formatting you want to copy'); return; }
      painter = { fmt, sticky: !!sticky };
      if (pagesRoot) pagesRoot.classList.add('is-painting');
      if (painterBtn) painterBtn.classList.add('active');
    }

    function stopPainter() {
      painter = null;
      if (pagesRoot) pagesRoot.classList.remove('is-painting');
      if (painterBtn) painterBtn.classList.remove('active');
    }

    function onPainterPointerUp() {
      if (!painter) return;
      setTimeout(() => {
        if (!painter || destroyed) return;
        const sel = window.getSelection();
        if (!sel.rangeCount) return;
        let r = sel.getRangeAt(0);
        if (!pageBodyOf(r.startContainer)) return;
        if (r.collapsed) {
          // A click paints the word under it, as in Word.
          try {
            sel.modify('move', 'backward', 'word');
            sel.modify('extend', 'forward', 'word');
          } catch {}
          r = sel.rangeCount ? sel.getRangeAt(0) : r;
          if (r.collapsed) return;
        }
        applyCapturedFormat(painter.fmt);
        if (!painter.sticky) stopPainter();
      }, 0);
    }

    /* ---------- paragraph formatting ---------- */
    function currentStyleId(block) {
      if (!block) return 'p';
      if (block.closest('blockquote')) return 'quote';
      if (block.closest('pre')) return 'code';
      const tag = block.tagName.toLowerCase();
      if (/^h[1-4]$/.test(tag)) return tag;
      if (block.classList.contains('margo-title')) return 'title';
      if (block.classList.contains('margo-subtitle')) return 'subtitle';
      return 'p';
    }

    function applyParagraphStyle(id) {
      const st = PARA_STYLES.find((s) => s.id === id) || PARA_STYLES[0];
      batch(() => forEachSelectedSlice(() => {
        const r0 = window.getSelection().rangeCount ? window.getSelection().getRangeAt(0) : null;
        const before = blocksInRange(r0);
        // Leaving a quote or a code block: unwrap first so formatBlock does not nest.
        before.forEach((b) => {
          const q = b.closest('blockquote, pre');
          if (q && st.tag !== q.tagName.toLowerCase()) execRaw('formatBlock', '<p>');
        });
        execRaw('formatBlock', '<' + st.tag + '>');
        const r1 = window.getSelection().rangeCount ? window.getSelection().getRangeAt(0) : null;
        const after = blocksInRange(r1);
        after.forEach((b) => {
          STYLE_CLASSES.forEach((c) => b.classList.remove(c));
          if (st.cls && b.tagName.toLowerCase() === st.tag) b.classList.add(st.cls);
          if (!b.getAttribute('class')) b.removeAttribute('class');
        });
      }));
    }

    function applyBlockStyle(fn) {
      batch(() => {
        const blocks = selectedBlocks();
        blocks.forEach(fn);
      });
    }

    function applyLineSpacing(value) {
      applyBlockStyle((b) => { b.style.lineHeight = String(value); });
    }

    function applyParagraphSpacing(which, pt) {
      applyBlockStyle((b) => {
        const prop = which === 'before' ? 'marginTop' : 'marginBottom';
        b.style[prop] = pt + 'pt';
      });
    }

    function blockMarginPt(b) {
      const v = b.style.marginLeft;
      if (!v) return 0;
      const n = parseFloat(v);
      if (/pt$/.test(v)) return n;
      if (/px$/.test(v)) return n * 0.75;
      if (/in$/.test(v)) return n * 72;
      if (/em$/.test(v)) return n * 11;
      return n || 0;
    }

    function indent(dir) {
      const blocks = selectedBlocks();
      if (!blocks.length) return;
      if (blocks.every((b) => b.tagName === 'LI')) {
        // Lists nest instead of shifting.
        exec(dir > 0 ? 'indent' : 'outdent');
        return;
      }
      /* Anything else moves by a half-inch step of left indent. Chromium's
         own indent wraps a paragraph in a <blockquote>, which Margo draws -
         and exports - as a quotation. */
      batch(() => blocks.forEach((b) => {
        const next = Math.max(0, blockMarginPt(b) + dir * INDENT_STEP_PT);
        if (next) b.style.marginLeft = next + 'pt';
        else b.style.removeProperty('margin-left');
        if (!b.getAttribute('style')) b.removeAttribute('style');
      }));
    }

    function currentList() {
      const r = liveRange(lastRange);
      const node = r ? r.startContainer : null;
      const el = node && (node.nodeType === 1 ? node : node.parentElement);
      const body = node && pageBodyOf(node);
      const li = el && el.closest('li');
      return li && body && body.contains(li) ? li.parentElement : null;
    }

    function listsInSelection() {
      const out = new Set();
      const sel = window.getSelection();
      const r = sel.rangeCount ? sel.getRangeAt(0) : null;
      if (!r) return [];
      const body = pageBodyOf(r.startContainer);
      if (!body) return [];
      const up = (n) => { const el = n.nodeType === 1 ? n : n.parentElement; const l = el && el.closest('ul, ol'); return l && body.contains(l) ? l : null; };
      [up(r.startContainer), up(r.endContainer)].forEach((l) => l && out.add(l));
      body.querySelectorAll('ul, ol').forEach((l) => { if (r.intersectsNode(l)) out.add(l); });
      return Array.from(out);
    }

    function toggleList(kind) {
      ensureSelection();
      const list = currentList();
      const isCheck = list && list.classList.contains('margo-checklist');
      batch(() => forEachSelectedSlice(() => {
        if (kind === 'check') {
          if (isCheck) {
            execRaw('insertUnorderedList');
            return;
          }
          if (!list || list.tagName !== 'UL') execRaw('insertUnorderedList');
          listsInSelection().forEach((l) => { if (l.tagName === 'UL') l.classList.add('margo-checklist'); });
          return;
        }
        if (kind === 'ul' && isCheck) {
          listsInSelection().forEach((l) => { l.classList.remove('margo-checklist'); if (!l.getAttribute('class')) l.removeAttribute('class'); });
          return;
        }
        execRaw(kind === 'ol' ? 'insertOrderedList' : 'insertUnorderedList');
      }));
    }

    function onChecklistPointerDown(e) {
      const li = e.target && e.target.closest && e.target.closest('ul.margo-checklist > li');
      if (!li || !pagesRoot.contains(li)) return false;
      const rect = li.getBoundingClientRect();
      if (e.clientX >= rect.left) return false;
      e.preventDefault();
      e.stopPropagation();
      li.classList.toggle('is-checked');
      if (!li.getAttribute('class')) li.removeAttribute('class');
      afterChange({ paginate: false });
      return true;
    }

    function align(where) {
      const cmd = { left: 'justifyLeft', center: 'justifyCenter', right: 'justifyRight', justify: 'justifyFull' }[where];
      if (cmd) exec(cmd);
    }

    function refreshStates() {
      if (!ctx.toolbar) return;
      const q = (c) => { try { return document.queryCommandState(c); } catch { return false; } };
      const sel = window.getSelection();
      const inDoc = !!(sel && sel.rangeCount && pageBodyOf(sel.getRangeAt(0).startContainer));
      for (const [cmd, b] of Object.entries(stateButtons)) {
        b.classList.toggle('active', inDoc && q(cmd));
      }
      const r = liveRange(lastRange);
      const body = r ? pageBodyOf(r.startContainer) : null;
      const block = r ? closestBlock(r.startContainer, body) : null;
      if (styleBtn) {
        const id = currentStyleId(block);
        const st = PARA_STYLES.find((s) => s.id === id) || PARA_STYLES[0];
        styleBtn.querySelector('.doc-style-name').textContent = st.label;
        styleBtn.dataset.style = id;
      }
      const alignNow = block ? (getComputedStyle(block).textAlign || 'left') : 'left';
      const alignKey = alignNow === 'start' ? 'left' : alignNow === 'end' ? 'right' : alignNow;
      Object.entries(alignBtns).forEach(([k, b]) => b.classList.toggle('active', !!block && k === alignKey));
      const list = currentList();
      const listKind = !list ? '' : list.classList.contains('margo-checklist') ? 'check' : list.tagName === 'OL' ? 'ol' : 'ul';
      Object.entries(listBtns).forEach(([k, b]) => b.classList.toggle('active', k === listKind));
      if (familySelect) {
        let f = '';
        try { f = (document.queryCommandValue('fontName') || '').replace(/["']/g, ''); } catch {}
        if (f === TEMP_FONT_FACE) f = '';
        const first = f.split(',')[0].trim();
        const match = availableFonts.find((n) => first.toLowerCase() === n.toLowerCase())
          || availableFonts.find((n) => f.toLowerCase().startsWith(n.toLowerCase()));
        if (match) familySelect.value = match;
        else if (availableFonts.includes('Calibri')) familySelect.value = 'Calibri';
      }
      if (variantSelect && familySelect) {
        let preferred = null;
        try {
          let node = r && r.startContainer;
          if (node && node.nodeType === 3) node = node.parentElement;
          if (node) {
            const cs = getComputedStyle(node);
            preferred = FONTS.matchFaceFromComputed(getFacesForFamily(familySelect.value), cs.fontWeight, cs.fontStyle);
          }
        } catch {}
        fillVariantSelect(familySelect.value, preferred);
      }
      if (sizeSelect) {
        const pt = r ? currentFontPt() : 11;
        const opt = Array.from(sizeSelect.options).find((o) => Number(o.value) === pt);
        if (!opt) {
          let extra = sizeSelect.querySelector('option[data-extra]');
          if (!extra) {
            extra = document.createElement('option');
            extra.dataset.extra = '1';
            sizeSelect.insertBefore(extra, sizeSelect.firstChild);
          }
          extra.value = String(pt);
          extra.textContent = String(pt);
          extra.hidden = true;
        }
        sizeSelect.value = String(pt);
      }
      if (colorBar) {
        const el = r && (r.startContainer.nodeType === 1 ? r.startContainer : r.startContainer.parentElement);
        const colored = el && el.closest('[style*="color"]:not(mark), font[color]');
        setSwatch(colorBar, colored && body && body.contains(colored) ? (colored.style.color || colored.getAttribute('color')) : '');
      }
      if (hlBar) {
        const el = r && (r.startContainer.nodeType === 1 ? r.startContainer : r.startContainer.parentElement);
        const m = el && el.closest('mark:not(.margo-find-hit)');
        setSwatch(hlBar, m ? (m.style.backgroundColor || getComputedStyle(m).backgroundColor) : '');
      }
      const inTable = !!selectionInTable();
      if (tableTabBtn) {
        tableTabBtn.classList.toggle('hidden', !inTable);
        if (!inTable && activeRibbonTab === 'table') showRibbonTab('home');
      }
      if (spellBtn) spellBtn.classList.toggle('active', spellEnabled);
      if (selectedImg && !selectedImg.isConnected) hideImageOverlay();
    }

    function selectionInTable() {
      if (!pagesRoot) return null;
      const sel = window.getSelection();
      let node = sel && sel.rangeCount && pageBodyOf(sel.anchorNode) ? sel.anchorNode : null;
      if (!node) { const r = liveRange(lastRange); node = r ? r.startContainer : null; }
      if (!node) return null;
      const el = node.nodeType === 1 ? node : node.parentElement;
      if (!el || !pagesRoot.contains(el)) return null;
      const cell = el.closest('td, th');
      if (!cell) return null;
      const table = cell.closest('table');
      if (!table || !pagesRoot.contains(table)) return null;
      const row = cell.parentElement;
      return { table, row, cell };
    }

    /* ---------- page geometry ---------- */
    const CSS_PX_PER_INCH = 96;

    function pageInches() {
      if (layout.pageIn && layout.pageIn.w > 0 && layout.pageIn.h > 0) {
        const w = Math.min(layout.pageIn.w, layout.pageIn.h);
        const h = Math.max(layout.pageIn.w, layout.pageIn.h);
        return layout.orientation === 'landscape' ? { w: h, h: w } : { w, h };
      }
      const p = PAGE_SIZES[layout.size] || PAGE_SIZES.letter;
      return layout.orientation === 'landscape' ? { w: p.h, h: p.w } : { w: p.w, h: p.h };
    }

    function marginInches() {
      if (layout.marginIn) {
        const m = layout.marginIn;
        return { t: m.top, r: m.right, b: m.bottom, l: m.left };
      }
      return MARGIN_PRESETS[layout.margins] || MARGIN_PRESETS.normal;
    }

    function updatePageHeadersAndFooters() {
      if (!pagesRoot) return;
      const pages = pageList();
      const total = pages.length;
      pages.forEach((page, idx) => {
        const header = page.querySelector('.doc-page-header');
        const footer = page.querySelector('.doc-page-footer');
        if (header) {
          header.innerHTML = `<span class="doc-hf-text">${escapeHtml(layout.headerText || '')}</span>`;
          header.classList.toggle('is-empty', !layout.headerText);
        }
        if (footer) {
          const pNum = layout.showPageNumbers ? `Page ${idx + 1} of ${total}` : '';
          footer.innerHTML = `<span class="doc-hf-text">${escapeHtml(layout.footerText || '')}</span><span class="doc-hf-num">${pNum}</span>`;
          footer.classList.toggle('is-empty', !layout.footerText && !pNum);
        }
      });
    }

    /* The page is drawn at its real size with its real margins, in CSS
       inches, so a line wraps where it will in Word and in the PDF. The
       header and footer sit in the margins the way they do on paper
       instead of taking space from the text. */
    function applyLayoutAttributes() {
      if (!pagesRoot) return;
      pagesRoot.dataset.size = layout.size || 'letter';
      pagesRoot.dataset.orientation = layout.orientation || 'portrait';
      pagesRoot.dataset.margins = layout.margins || 'normal';
      pagesRoot.dataset.columns = String(layout.columns || 1);
      const px = (inches) => (inches * CSS_PX_PER_INCH).toFixed(2) + 'px';
      const page = pageInches();
      const mar = marginInches();
      const s = pagesRoot.style;
      s.setProperty('--doc-page-w', px(page.w));
      s.setProperty('--doc-page-h', px(page.h));
      s.setProperty('--doc-pad-t', px(mar.t));
      s.setProperty('--doc-pad-r', px(mar.r));
      s.setProperty('--doc-pad-b', px(mar.b));
      s.setProperty('--doc-pad-l', px(mar.l));
      pagesRoot.dataset.exactPage = layout.pageIn ? '1' : '0';
      pagesRoot.dataset.exactMargins = layout.marginIn ? '1' : '0';
      updatePageHeadersAndFooters();
      // A different page box means the content has to be redistributed.
      schedulePaginate(pagesRoot.querySelector('.doc-page'));
    }

    function setLayout(patch) {
      Object.assign(layout, patch);
      applyLayoutAttributes();
      ctx.markDirty();
      updateStatus();
      recordNow();
    }

    function caretPageIndex() {
      const pages = pageList();
      const r = liveRange(lastRange);
      const page = r ? (pageBodyOf(r.startContainer) || {}).parentElement : activePage;
      const i = page ? pages.indexOf(page) : -1;
      return i >= 0 ? i + 1 : 1;
    }

    function updateStatus() {
      if (destroyed) return;
      const pages = pageList();
      const text = pages
        .map((p) => plainText(p.querySelector('.doc-page-body') || p))
        .join('\n');
      const words = (text.trim().match(/\S+/g) || []).length;
      const chars = text.replace(/\n/g, '').length;
      const n = pages.length;
      statusCache = { words, chars, pages: n, page: Math.min(caretPageIndex(), n) };
      const pagePart = n === 1 ? '1 page' : n + ' pages';
      const geom = `${(PAGE_SIZES[layout.size] || PAGE_SIZES.letter).label} · ${layout.orientation === 'landscape' ? 'Landscape' : 'Portrait'}`;
      statusDirty = false;
      // Word and character counts are the status bar's (commands.status());
      // this side carries what that line does not: the page setup.
      ctx.setStatus(`${pagePart} · ${geom}`, 'Word document');
      /* "Page N of M" only moves when pages are added or removed. Rewriting
         every header and footer on each status pass invalidated layout across
         the whole document, which forced the next measurement to reflow
         everything again. */
      if (pages.length !== lastPageCount) {
        lastPageCount = pages.length;
        updatePageHeadersAndFooters();
      }
      if (outlineRail && !outlineRail.classList.contains('hidden')) renderOutline();
    }

    function statusLine() {
      if (statusDirty) updateStatus();
      const s = statusCache;
      const page = Math.min(caretPageIndex(), s.pages || 1);
      return `${s.words.toLocaleString()} word${s.words === 1 ? '' : 's'} · ${s.chars.toLocaleString()} character${s.chars === 1 ? '' : 's'} · Page ${page} of ${s.pages}`;
    }

    function applyZoom(clientX, clientY) {
      if (!scrollEl || !pagesRoot) return;
      const prev = parseFloat(pagesRoot.style.zoom) || 1;
      const next = zoom;
      const rect = scrollEl.getBoundingClientRect();
      const mx = clientX != null ? clientX - rect.left : scrollEl.clientWidth / 2;
      const my = clientY != null ? clientY - rect.top : scrollEl.clientHeight / 2;
      pagesRoot.style.zoom = String(next);
      /* At zoom > 1 the container measures fewer CSS px, so the responsive
         max-width would shrink the page and re-wrap every line. Drop it while
         zoomed and let the scroll container pan instead. */
      pagesRoot.dataset.zoomed = next > 1 ? '1' : '0';
      if (prev !== next) {
        const ratio = next / prev;
        scrollEl.scrollLeft = (scrollEl.scrollLeft + mx) * ratio - mx;
        scrollEl.scrollTop = (scrollEl.scrollTop + my) * ratio - my;
      }
      updateStatus();
      if (ctx.status) ctx.status.setZoom(zoom, ZOOM_MIN, ZOOM_MAX);
      syncSplitPreview();
      if (crossPageRange && crossPageRange.start && crossPageRange.end) {
        rebuildCrossPageSelectionVisual();
      }
      if (selectedImg) positionImageOverlay();
    }

    function zoomBy(factor, clientX, clientY) {
      const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, +(zoom * factor).toFixed(4)));
      if (next === zoom) return;
      zoom = next;
      applyZoom(clientX, clientY);
    }

    function setZoomLevel(z, clientX, clientY) {
      const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, +z));
      if (next === zoom) return;
      zoom = next;
      applyZoom(clientX, clientY);
    }

    function applySplitRatio() {
      if (!editorWrap || viewMode !== 'split') return;
      editorWrap.style.setProperty('--doc-split-edit', (splitRatio * 100).toFixed(1) + '%');
    }

    function syncSplitPreview() {
      if (viewMode !== 'split' || !splitPreviewRoot || !pagesRoot) return;
      splitPreviewRoot.innerHTML = pagesRoot.innerHTML;
      splitPreviewRoot.className = pagesRoot.className + ' doc-pages-preview';
      Object.keys(pagesRoot.dataset).forEach((k) => {
        splitPreviewRoot.dataset[k] = pagesRoot.dataset[k];
      });
      splitPreviewRoot.style.cssText = pagesRoot.style.cssText;
      splitPreviewRoot.querySelectorAll('.doc-page-body').forEach((b) => {
        b.contentEditable = 'false';
      });
      splitPreviewRoot.querySelectorAll('.doc-img-overlay, mark.margo-find-hit').forEach((el) => {
        if (el.classList.contains('doc-img-overlay')) el.remove();
        else el.replaceWith(document.createTextNode(el.textContent));
      });
    }

    function applyViewEditable() {
      pageList().forEach((pg) => {
        const body = pg.querySelector('.doc-page-body') || pg;
        body.contentEditable = (viewMode === 'print' || viewMode === 'split') ? 'true' : 'false';
      });
    }

    function setViewMode(mode) {
      if (!['print', 'read', 'split'].includes(mode)) return;
      viewMode = mode;
      if (hostEl) hostEl.dataset.docView = mode;
      applyViewEditable();
      if (mode === 'read') hideImageOverlay();
      if (splitGutter) splitGutter.classList.toggle('hidden', mode !== 'split');
      if (splitPreviewScroll) splitPreviewScroll.classList.toggle('hidden', mode !== 'split');
      if (editorWrap) editorWrap.classList.toggle('doc-split-active', mode === 'split');
      if (mode === 'split') {
        applySplitRatio();
        syncSplitPreview();
      }
      if (ctx.status) ctx.status.setViewActive(mode);
      if (ribbonPanels.view) {
        ribbonPanels.view.querySelectorAll('[data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === mode));
      }
    }

    function wireSplitGutter() {
      if (!splitGutter || !editorWrap) return;
      splitGutter.addEventListener('pointerdown', (e) => {
        if (viewMode !== 'split') return;
        e.preventDefault();
        const startY = e.clientY;
        const startRatio = splitRatio;
        const wrapH = editorWrap.getBoundingClientRect().height || 1;
        const onMove = (ev) => {
          splitRatio = Math.min(0.85, Math.max(0.15, startRatio + (ev.clientY - startY) / wrapH));
          applySplitRatio();
        };
        const onUp = () => {
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
      });
    }

    function setupStatusChrome() {
      if (!ctx.status) return;
      ctx.status.setKind('Word document');
      ctx.status.showZoom(true);
      ctx.status.setZoom(zoom, ZOOM_MIN, ZOOM_MAX);
      ctx.status.setViewModes([
        { id: 'print', title: 'Print Layout', html: icon('printLayout') },
        { id: 'read', title: 'Read View', html: icon('readView') },
        { id: 'split', title: 'Split View', html: icon('split') }
      ]);
      ctx.status.setViewActive(viewMode);
      ctx.status.onView((m) => setViewMode(m));
      ctx.status.onZoom((z) => setZoomLevel(z));
    }

    function onCtrlWheel(e) {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1, e.clientX, e.clientY);
    }

    /* ---------- pagination ----------
       Word fills a page box and spills the remainder onto the next page.
       Margo's pages were fixed containers that simply grew, so a document
       without explicit breaks arrived as one very tall sheet. This measures
       each page against its usable box, pushes the overflow forward, and pulls
       content back when room opens up. Only pages this code created are
       reversible; a page that came from a real break is never merged away. */

    let paginating = false;
    let paginateTimer = 0;
    let composing = false;

    function currentZoom() {
      if (!pagesRoot) return zoom || 1;
      const z = parseFloat(pagesRoot.style.zoom);
      return z > 0 ? z : (zoom || 1);
    }

    function layoutRectHeight(rect) {
      const z = currentZoom();
      return rect.height / z;
    }

    function layoutHeight(el) {
      if (!el) return 0;
      return layoutRectHeight(el.getBoundingClientRect());
    }

    function rangeLayoutHeight(range) {
      return layoutRectHeight(range.getBoundingClientRect());
    }

    function outerHeight(el) {
      if (!el) return 0;
      const cs = getComputedStyle(el);
      if (cs.position === 'absolute' || cs.position === 'fixed') return 0;
      return el.offsetHeight + (parseFloat(cs.marginTop) || 0) + (parseFloat(cs.marginBottom) || 0);
    }

    function usableHeight(pageEl) {
      const cs = getComputedStyle(pageEl);
      // The page box is min-height; offsetHeight is whatever the overflow has
      // already stretched it to, which is exactly what we are correcting.
      const box = parseFloat(cs.minHeight) || 0;
      const padT = parseFloat(cs.paddingTop) || 0;
      const padB = parseFloat(cs.paddingBottom) || 0;
      // Header and footer live in the margins (absolutely placed), so they
      // cost the text nothing; outerHeight() reports 0 for them.
      return box - padT - padB
        - outerHeight(pageEl.querySelector('.doc-page-header'))
        - outerHeight(pageEl.querySelector('.doc-page-footer'));
    }

    function captureCaret() {
      const sel = document.getSelection();
      if (!sel || !sel.rangeCount || !pagesRoot) return null;
      const r = sel.getRangeAt(0);
      if (!pagesRoot.contains(r.startContainer)) return null;
      return { node: r.startContainer, offset: r.startOffset };
    }

    function restoreCaret(saved) {
      if (!saved || !saved.node || !saved.node.isConnected) return;
      if (isFindFieldFocused()) return;
      // Only follow the caret if the author is actually in the document; a
      // repaginate that finishes while they type in the ribbon must not
      // steal focus back.
      const ae = document.activeElement;
      if (ae && ae !== document.body && !(ae.classList && ae.classList.contains('doc-page-body'))) return;
      // Moving a node between pages keeps the node itself, so the captured
      // container is still the right anchor - but focus has to follow it into
      // whichever page body now owns it.
      const el = saved.node.nodeType === 1 ? saved.node : saved.node.parentElement;
      const page = el && el.closest ? el.closest('.doc-page') : null;
      const body = page ? page.querySelector('.doc-page-body') : null;
      try {
        if (body) {
          body.focus({ preventScroll: true });
          setActivePage(page);
        }
        const sel = document.getSelection();
        const range = document.createRange();
        const max = saved.node.nodeType === 3
          ? saved.node.nodeValue.length
          : saved.node.childNodes.length;
        range.setStart(saved.node, Math.min(saved.offset, max));
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
      } catch {}
    }

    function newAutoPage(afterPage) {
      const el = makePageEl(EMPTY_PAGE);
      el.dataset.pageBreak = 'auto';
      const body = el.querySelector('.doc-page-body');
      if (body) {
        body.innerHTML = '';
        body.contentEditable = viewMode === 'read' ? 'false' : 'true';
        body.spellcheck = spellEnabled;
      }
      afterPage.after(el);
      return el;
    }

    /* Word breaks a table across pages by row and a paragraph by line. Moving
       an oversized block whole instead leaves the rest of the page blank and
       lets the block itself overflow past the page edge. */

    const SPLITTABLE_TEXT = /^(P|H1|H2|H3|H4|H5|H6|BLOCKQUOTE|PRE|DIV)$/;

    function tableRows(table) {
      return Array.from(table.querySelectorAll(':scope > tbody > tr, :scope > tr'));
    }

    function tableBody(table) {
      let tb = table.querySelector(':scope > tbody');
      if (!tb) {
        tb = document.createElement('tbody');
        table.appendChild(tb);
      }
      return tb;
    }

    function splitTable(table, room) {
      const rows = tableRows(table);
      if (rows.length < 2) return null;
      // A merged cell spanning the cut cannot be split without losing it.
      const head = table.querySelector(':scope > thead');
      // Everything the table costs that is not a body row: borders, border
      // spacing, caption and any header that repeats on the continuation.
      const rowsTotal = rows.reduce((a, r) => a + outerHeight(r), 0);
      let used = Math.max(0, outerHeight(table) - rowsTotal);
      let cut = -1;
      for (let i = 0; i < rows.length; i++) {
        const h = outerHeight(rows[i]);
        if (used + h > room) { cut = i; break; }
        used += h;
      }
      // cut === 0 means not even the first row fits; the caller moves it whole.
      if (cut <= 0 || cut >= rows.length) return null;
      for (let i = 0; i < cut; i++) {
        const spans = Array.from(rows[i].children).some((c) => i + (parseInt(c.getAttribute('rowspan') || '1', 10) || 1) > cut);
        if (spans) return null;
      }

      const rest = table.cloneNode(false);
      rest.dataset.margoContinued = '1';
      table.querySelectorAll(':scope > colgroup').forEach((c) => rest.appendChild(c.cloneNode(true)));
      if (head) {
        const h = head.cloneNode(true);
        h.dataset.margoRepeat = '1';
        rest.appendChild(h);
      }
      const body = document.createElement('tbody');
      rest.appendChild(body);
      for (let i = cut; i < rows.length; i++) body.appendChild(rows[i]);
      table.after(rest);
      return rest;
    }

    function textNodesOf(el) {
      const out = [];
      const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walk.nextNode())) out.push(node);
      return out;
    }

    function splitTextBlock(el, room) {
      if (!SPLITTABLE_TEXT.test(el.tagName)) return null;
      // Anything with its own layout inside is kept whole, and so is a block
      // made of blocks: splitting one mid-child left the halves of that
      // child as two separate paragraphs when the pages were joined again.
      if (el.querySelector('table, img, ul, ol, p, div, h1, h2, h3, h4, h5, h6, blockquote, pre, li')) return null;
      if (el.isContentEditable === false || el.getAttribute('contenteditable') === 'false') return null;
      const nodes = textNodesOf(el);
      const total = nodes.reduce((a, t) => a + t.nodeValue.length, 0);
      if (total < 80) return null;

      const range = document.createRange();
      const overhead = Math.max(0, outerHeight(el) - layoutHeight(el));
      room -= overhead;
      if (room <= 24) return null;
      const heightTo = (chars) => {
        let left = chars;
        for (const t of nodes) {
          if (left <= t.nodeValue.length) {
            range.setStart(el, 0);
            range.setEnd(t, left);
            return rangeLayoutHeight(range);
          }
          left -= t.nodeValue.length;
        }
        return Infinity;
      };
      if (heightTo(total) <= room) return null;

      // Largest prefix that still fits, then back up to a word boundary.
      let lo = 0;
      let hi = total;
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        if (heightTo(mid) <= room) lo = mid; else hi = mid - 1;
      }
      if (lo < 40) return null;

      let cut = lo;
      let scan = 0;
      let cutNode = null;
      let cutOffset = 0;
      for (const t of nodes) {
        if (cut <= scan + t.nodeValue.length) {
          cutOffset = cut - scan;
          cutNode = t;
          break;
        }
        scan += t.nodeValue.length;
      }
      if (!cutNode) return null;
      const space = cutNode.nodeValue.lastIndexOf(' ', cutOffset);
      if (space > 0) cutOffset = space + 1;
      if (cutOffset <= 0 || cutOffset >= cutNode.nodeValue.length) {
        if (cutNode === nodes[nodes.length - 1] && cutOffset >= cutNode.nodeValue.length) return null;
      }

      const rest = el.cloneNode(false);
      rest.dataset.margoContinued = '1';
      const tail = document.createRange();
      tail.setStart(cutNode, Math.min(cutOffset, cutNode.nodeValue.length));
      tail.setEndAfter(el.lastChild);
      rest.appendChild(tail.extractContents());
      if (!rest.textContent.trim()) return null;
      el.after(rest);
      return rest;
    }

    function splitBlock(el, room) {
      if (!el || el.nodeType !== 1 || room <= 24) return null;
      try {
        return el.tagName === 'TABLE' ? splitTable(el, room) : splitTextBlock(el, room);
      } catch {
        return null;
      }
    }

    /* Undo a previous split so the next pass measures the real block. Without
       this the document would keep the split it happened to need earlier, and
       edits would drift it further apart. */
    function mergeContinued(body) {
      let merged = false;
      Array.from(body.children).forEach((el) => {
        if (!el.dataset || el.dataset.margoContinued !== '1') return;
        const prev = el.previousElementSibling;
        if (!prev || prev.tagName !== el.tagName) return;
        if (el.tagName === 'TABLE') {
          const target = tableBody(prev);
          tableRows(el).forEach((r) => target.appendChild(r));
        } else {
          while (el.firstChild) prev.appendChild(el.firstChild);
          prev.normalize();
        }
        el.remove();
        merged = true;
      });
      return merged;
    }

    function fitOversizedMedia(body, limit) {
      let changed = false;
      body.querySelectorAll('img').forEach((img) => {
        if (img.style.maxHeight && img.style.maxHeight !== 'none') return;
        const h = outerHeight(img);
        if (h > limit && limit > 0) {
          img.style.maxHeight = Math.floor(limit) + 'px';
          img.style.height = 'auto';
          img.style.width = 'auto';
          img.style.maxWidth = '100%';
          changed = true;
        }
      });
      return changed;
    }

    function repaginate(startPage) {
      if (!pagesRoot || paginating || composing || destroyed) return false;
      paginating = true;
      const caret = captureCaret();
      const splitTries = new Map();
      let changed = false;
      try {
        const all = pageList();
        if (!all.length) return false;
        // Content above the edit cannot have moved; start one page earlier so
        // deletions can still pull text back up.
        let i = Math.max(0, all.indexOf(startPage) - 1);
        if (i < 0) i = 0;
        let guard = 0;
        while (i < pageList().length && guard++ < 400) {
          const pages = pageList();
          const page = pages[i];
          const body = page.querySelector('.doc-page-body');
          if (!body) { i++; continue; }
          /* Multi-column pages are measured one column deep, not the whole
             page. Scaling the limit by the column count is what you would
             want, but a Range spanning a column break reports a rect across
             both columns, so the text splitter never converges and the reflow
             churns until the renderer stops responding. One column deep is
             conservative - a two-column page holds less than it could - but it
             never overflows and never loses content. */
          const columnHeight = usableHeight(page);
          const limit = columnHeight;
          if (limit <= 0) { i++; continue; }

          mergeContinued(body);
          if (fitOversizedMedia(body, columnHeight)) changed = true;
          let kids = Array.from(body.children);
          let used = 0;
          let spillAt = -1;
          let didSplit = false;
          for (let k = 0; k < kids.length; k++) {
            const h = outerHeight(kids[k]);
            if (used + h > limit) {
              // Break the block itself so the part that fits stays here.
              const rest = splitBlock(kids[k], limit - used);
              if (rest) {
                kids = Array.from(body.children);
                spillAt = kids.indexOf(rest);
                changed = true;
                didSplit = true;
                break;
              }
              // Never move the only block off a page, or nothing would ever fit
              // and the loop would push content forward forever.
              if (k > 0) { spillAt = k; break; }
            }
            used += h;
          }

          if (spillAt > 0) {
            const next = (page.nextElementSibling
              && page.nextElementSibling.classList.contains('doc-page')
              && page.nextElementSibling.dataset.pageBreak === 'auto')
              ? page.nextElementSibling
              : newAutoPage(page);
            const nextBody = next.querySelector('.doc-page-body');
            const moving = kids.slice(spillAt);
            for (let m = moving.length - 1; m >= 0; m--) {
              nextBody.insertBefore(moving[m], nextBody.firstChild);
            }
            changed = true;
            // After a split the rows that stayed behind re-flow, so measure
            // this page again rather than trusting the pre-split numbers.
            // Bounded by attempts so a block that cannot shrink cannot spin.
            if (didSplit && (splitTries.get(page) || 0) < 4) {
              splitTries.set(page, (splitTries.get(page) || 0) + 1);
            } else {
              i++;
            }
            continue;
          }

          // Room left over: pull back from the following page, but only if the
          // flow created it. An explicit break stays where the document put it.
          const next = page.nextElementSibling;
          if (next && next.classList.contains('doc-page') && next.dataset.pageBreak === 'auto') {
            const nextBody = next.querySelector('.doc-page-body');
            let room = limit - used;
            while (nextBody && nextBody.firstElementChild) {
              const first = nextBody.firstElementChild;
              const last = body.lastElementChild;
              // A block we split earlier rejoins its own head a row at a time,
              // so reclaimed space is filled instead of jumping a whole block.
              if (first.dataset && first.dataset.margoContinued === '1'
                  && last && last.tagName === first.tagName) {
                let moved = false;
                if (first.tagName === 'TABLE') {
                  const target = tableBody(last);
                  let rows = tableRows(first);
                  while (rows.length) {
                    const h = outerHeight(rows[0]);
                    if (h > room) break;
                    target.appendChild(rows.shift());
                    room -= h;
                    moved = true;
                    changed = true;
                  }
                }
                if (first.tagName === 'TABLE' && !tableRows(first).length) {
                  first.remove();
                  continue;
                }
                if (!moved) break;
                break;
              }
              const h = outerHeight(first);
              if (h > room) {
                // The next page opens with a block too big for the space left
                // here. Break it so the part that fits comes up, rather than
                // leaving this page half empty and the block overhanging.
                const rest = splitBlock(first, room);
                if (rest) {
                  body.appendChild(first);
                  changed = true;
                }
                break;
              }
              body.appendChild(first);
              room -= h;
              changed = true;
            }
            if (nextBody && !nextBody.children.length && pageList().length > 1) {
              if (activePage === next) activePage = page;
              next.remove();
              changed = true;
              continue; // same index: re-check against whatever follows now
            }
          }
          i++;
        }
      } finally {
        paginating = false;
      }
      if (changed) {
        restoreCaret(caret);
        lastPageCount = -1; // page count moved: headers and footers must catch up
        if (crossPageRange) rebuildCrossPageSelectionVisual();
        if (selectedImg) positionImageOverlay();
      }
      return changed;
    }

    function schedulePaginate(startPage, idleMs) {
      if (destroyed) return;
      if (paginateTimer) clearTimeout(paginateTimer);
      const from = startPage || getPageEl();
      const delay = idleMs != null ? idleMs : 90;
      paginateTimer = setTimeout(() => {
        paginateTimer = 0;
        if (repaginate(from)) updateStatus();
      }, delay);
    }

    function makePageEl(html) {
      const el = document.createElement('div');
      el.className = 'doc-page';

      const header = document.createElement('div');
      header.className = 'doc-page-header';
      header.contentEditable = 'false';
      header.title = 'Double-click to edit the header';

      const body = document.createElement('div');
      body.className = 'doc-page-body';
      body.contentEditable = viewMode === 'read' ? 'false' : 'true';
      body.spellcheck = spellEnabled;
      body.setAttribute('role', 'textbox');
      body.setAttribute('aria-multiline', 'true');
      body.setAttribute('aria-label', 'Document page');
      body.innerHTML = sanitizeHtml(html);

      const footer = document.createElement('div');
      footer.className = 'doc-page-footer';
      footer.contentEditable = 'false';
      footer.title = 'Double-click to edit the footer';

      el.appendChild(header);
      el.appendChild(body);
      el.appendChild(footer);
      body.querySelectorAll('img').forEach((img) => {
        // Not lazy: a page cannot be measured while its images still report
        // zero height, and deferred loading would reflow the document under
        // the reader as they scrolled into view. Mammoth inlines images as
        // data URIs, so there is no network cost to pay here.
        img.decoding = 'async';
        if (!img.complete) img.addEventListener('load', () => schedulePaginate(), { once: true });
      });
      return el;
    }

    /* Generated blocks (a table of contents) are not typed into. The flag
       is editor state, stripped again on save. */
    function hydrate() {
      if (!pagesRoot) return;
      pagesRoot.querySelectorAll('.margo-toc').forEach((el) => { el.contentEditable = 'false'; });
      pagesRoot.querySelectorAll('.margo-footnotes').forEach((el) => { el.contentEditable = 'false'; });
      pagesRoot.querySelectorAll('.margo-footnotes li').forEach((el) => { el.contentEditable = 'true'; });
      pagesRoot.querySelectorAll('sup.margo-fn-ref').forEach((el) => { el.contentEditable = 'false'; });
    }

    function addPage(html) {
      if (!pagesRoot) return null;
      const el = makePageEl(html || EMPTY_PAGE);
      el.dataset.pageBreak = 'explicit';
      pagesRoot.appendChild(el);
      setActivePage(el);
      ctx.markDirty();
      updateStatus();
      recordNow();
      setTimeout(() => {
        if (destroyed) return;
        const body = el.querySelector('.doc-page-body') || el;
        body.focus();
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 40);
      return el;
    }

    /* Page break at the caret: everything after it moves to a new page that
       starts with a real break, the way Ctrl+Enter works in Word. Adding a
       blank page at the end of the document was all Margo used to do. */
    function insertPageBreak() {
      const r = ensureSelection();
      const body = r ? pageBodyOf(r.startContainer) : null;
      if (!body) { addPage(); return; }
      const page = body.closest('.doc-page');
      if (!r.collapsed) {
        skipInputRecord = true;
        try { execRaw('delete'); } finally { skipInputRecord = false; }
      }
      const sel = window.getSelection();
      const at = sel.getRangeAt(0);
      const tail = document.createRange();
      tail.setStart(at.startContainer, at.startOffset);
      tail.setEnd(body, body.childNodes.length);
      // Split at the top-level block so the new page starts with a whole one.
      const frag = tail.extractContents();
      const el = makePageEl('');
      el.dataset.pageBreak = 'explicit';
      const newBody = el.querySelector('.doc-page-body');
      newBody.innerHTML = '';
      newBody.appendChild(frag);
      // The halves of a split paragraph: drop an empty leading shell.
      const firstBlock = newBody.firstElementChild;
      if (!newBody.textContent.trim() && !newBody.querySelector('img, table, hr')) newBody.innerHTML = EMPTY_PAGE;
      else if (firstBlock && !firstBlock.textContent && !firstBlock.querySelector('img, br, table')) firstBlock.innerHTML = '<br>';
      Array.from(body.children).forEach((c) => {
        if (/^(P|H[1-6]|LI)$/.test(c.tagName) && !c.textContent && !c.querySelector('img, br')) c.innerHTML = '<br>';
      });
      if (!body.childNodes.length || !body.textContent.trim() && !body.querySelector('img, table, hr')) body.innerHTML = body.innerHTML || EMPTY_PAGE;
      // Pages the flow continued this one onto now follow the new break.
      page.after(el);
      setActivePage(el);
      try {
        newBody.focus({ preventScroll: true });
        const c = document.createRange();
        c.selectNodeContents(newBody.firstElementChild || newBody);
        c.collapse(true);
        sel.removeAllRanges();
        sel.addRange(c);
      } catch {}
      afterChange();
      setTimeout(() => { if (!destroyed) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 40);
    }

    function caretAtBodyEdge(body, edge) {
      const sel = window.getSelection();
      if (!sel.rangeCount || !sel.isCollapsed) return false;
      const r = sel.getRangeAt(0);
      const probe = document.createRange();
      if (edge === 'start') {
        probe.setStart(body, 0);
        probe.setEnd(r.startContainer, r.startOffset);
      } else {
        probe.setStart(r.startContainer, r.startOffset);
        probe.setEnd(body, body.childNodes.length);
      }
      if (probe.toString().length) return false;
      const frag = probe.cloneContents();
      return !frag.querySelector || !frag.querySelector('img, table, hr');
    }

    /* Backspace at the very start of a page and Delete at the very end of
       one reach across the page edge. On a page that follows a real break
       that removes the break, which was otherwise impossible to do. */
    function mergeIntoPrevious(page) {
      const prev = page.previousElementSibling;
      if (!prev || !prev.classList.contains('doc-page')) return false;
      const body = page.querySelector('.doc-page-body');
      const prevBody = prev.querySelector('.doc-page-body');
      // Drop a trailing empty paragraph on the previous page and a leading
      // one here, so joining two pages does not leave a blank line.
      const lastPrev = prevBody.lastElementChild;
      const firstHere = body.firstElementChild;
      const isEmpty = (b) => b && /^(P|DIV)$/.test(b.tagName) && !b.textContent.trim() && !b.querySelector('img, table, hr');
      if (isEmpty(lastPrev) && prevBody.children.length > 1) lastPrev.remove();
      if (isEmpty(firstHere) && body.children.length > 1) firstHere.remove();
      const caretTarget = body.firstChild;
      while (body.firstChild) prevBody.appendChild(body.firstChild);
      // Pages the flow continued this one onto now continue the previous one.
      page.remove();
      setActivePage(prev);
      try {
        prevBody.focus({ preventScroll: true });
        const sel = window.getSelection();
        const c = document.createRange();
        if (caretTarget && caretTarget.parentNode === prevBody) {
          const first = caretTarget.nodeType === 3 ? caretTarget : (textNodesOf(caretTarget)[0] || caretTarget);
          c.setStart(first, 0);
        } else {
          c.selectNodeContents(prevBody);
          c.collapse(false);
        }
        c.collapse(true);
        sel.removeAllRanges();
        sel.addRange(c);
      } catch {}
      afterChange();
      return true;
    }

    function joinAcrossAutoBreak(upper, lower, cmd) {
      const first = lower.firstChild;
      if (!first) return;
      const probe = first.nodeType === 3 ? first : (textNodesOf(first)[0] || null);
      upper.appendChild(first);
      mergeContinued(upper);
      upper.focus({ preventScroll: true });
      const sel = window.getSelection();
      const c = document.createRange();
      if (cmd === 'delete' && probe && probe.isConnected) c.setStart(probe, 0);
      else if (cmd === 'delete') { c.selectNodeContents(first.nodeType === 1 ? first : upper); }
      else {
        // Delete at the end of a page: the caret stays where it was, at the
        // end of the text that was on this page.
        const old = sel.rangeCount ? sel.getRangeAt(0) : null;
        if (old) c.setStart(old.startContainer, old.startOffset);
        else { c.selectNodeContents(upper); }
      }
      c.collapse(true);
      sel.removeAllRanges();
      sel.addRange(c);
      skipInputRecord = true;
      try { execRaw(cmd); } finally { skipInputRecord = false; }
      if (!lower.childNodes.length) lower.innerHTML = '';
      afterChange();
    }

    function onPageEdgeKey(e) {
      if (e.key !== 'Backspace' && e.key !== 'Delete') return false;
      if (e.ctrlKey || e.metaKey || e.altKey) return false;
      const body = e.target && e.target.classList && e.target.classList.contains('doc-page-body') ? e.target : null;
      if (!body) return false;
      const page = body.closest('.doc-page');
      if (e.key === 'Backspace' && caretAtBodyEdge(body, 'start')) {
        const prev = page.previousElementSibling;
        if (!prev) return false;
        if (page.dataset.pageBreak === 'auto') {
          /* A page the flow made is one document with the page before it:
             bring the first block up to the join and let the browser do an
             ordinary backspace there. */
          e.preventDefault();
          joinAcrossAutoBreak(prev.querySelector('.doc-page-body'), body, 'delete');
          return true;
        }
        e.preventDefault();
        return mergeIntoPrevious(page);
      }
      if (e.key === 'Delete' && caretAtBodyEdge(body, 'end')) {
        const next = page.nextElementSibling;
        if (!next || !next.classList.contains('doc-page')) return false;
        e.preventDefault();
        if (next.dataset.pageBreak === 'auto') {
          joinAcrossAutoBreak(body, next.querySelector('.doc-page-body'), 'forwardDelete');
          return true;
        }
        return mergeIntoPrevious(next);
      }
      return false;
    }
    /* ---------- cross-page selection / clipboard ---------- */
    /* Each .doc-page-body is its own contenteditable, with non-editable
       headers/footers between them. Native selection cannot cross that
       boundary, so Copy only ever serialized the focused page. These helpers
       keep a range that spans page bodies and write all of it (text + images)
       to the clipboard. */

    function pageBodies() {
      return pageList().map((p) => p.querySelector('.doc-page-body')).filter(Boolean);
    }

    function pageBodyOf(node) {
      if (!node || !pagesRoot) return null;
      if (node.nodeType === 1 && node.classList && node.classList.contains('doc-page-body')
          && pagesRoot.contains(node)) {
        return node;
      }
      const el = node.nodeType === 1 ? node : node.parentElement;
      if (!el || !el.closest) return null;
      const body = el.closest('.doc-page-body');
      return body && pagesRoot.contains(body) ? body : null;
    }

    function clampNodeOffset(node, offset) {
      const max = node.nodeType === 3 ? (node.nodeValue || '').length : node.childNodes.length;
      return Math.max(0, Math.min(offset, max));
    }

    function pointIsBefore(a, b) {
      if (a.node === b.node) return a.offset <= b.offset;
      const pos = a.node.compareDocumentPosition(b.node);
      if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return true;
      if (pos & Node.DOCUMENT_POSITION_PRECEDING) return false;
      try {
        const probe = document.createRange();
        probe.setStart(a.node, clampNodeOffset(a.node, a.offset));
        probe.collapse(true);
        return probe.comparePoint(b.node, b.offset) >= 0;
      } catch {
        return true;
      }
    }

    function orderedPoints(a, b) {
      return pointIsBefore(a, b) ? { start: a, end: b } : { start: b, end: a };
    }

    function nearestPageAtY(y) {
      const pages = pageList();
      if (!pages.length) return null;
      let best = null;
      let bestDist = Infinity;
      for (const page of pages) {
        const r = page.getBoundingClientRect();
        if (y >= r.top && y <= r.bottom) return page;
        const dist = y < r.top ? r.top - y : y - r.bottom;
        if (dist < bestDist) {
          bestDist = dist;
          best = page;
        }
      }
      return best;
    }

    function caretInPageBody(x, y, opts) {
      const allowGap = !opts || opts.allowGap !== false;
      if (!pagesRoot) return null;
      const el = document.elementFromPoint(x, y);
      let page = null;
      if (el && el.closest) page = el.closest('.doc-page');
      if (!page || !pagesRoot.contains(page)) {
        if (!allowGap) return null;
        page = nearestPageAtY(y);
        if (!page) return null;
        const body = page.querySelector('.doc-page-body');
        if (!body) return null;
        const br = body.getBoundingClientRect();
        if (y < br.top + br.height / 2) return { node: body, offset: 0 };
        return { node: body, offset: body.childNodes.length };
      }
      const body = page.querySelector('.doc-page-body');
      if (!body) return null;

      let range = null;
      try {
        if (document.caretRangeFromPoint) range = document.caretRangeFromPoint(x, y);
        else if (document.caretPositionFromPoint) {
          const pos = document.caretPositionFromPoint(x, y);
          if (pos) {
            range = document.createRange();
            range.setStart(pos.offsetNode, pos.offset);
            range.collapse(true);
          }
        }
      } catch { range = null; }
      if (range && body.contains(range.startContainer)) {
        return { node: range.startContainer, offset: range.startOffset };
      }

      const header = page.querySelector('.doc-page-header');
      const footer = page.querySelector('.doc-page-footer');
      if (header && (header === el || header.contains(el))) return { node: body, offset: 0 };
      if (footer && (footer === el || footer.contains(el))) return { node: body, offset: body.childNodes.length };
      const br = body.getBoundingClientRect();
      if (y < br.top + br.height / 2) return { node: body, offset: 0 };
      return { node: body, offset: body.childNodes.length };
    }

    function spanFromPoints(anchor, focus) {
      if (!anchor || !focus || !anchor.node || !focus.node) return null;
      if (!anchor.node.isConnected || !focus.node.isConnected) return null;
      const ordered = orderedPoints(anchor, focus);
      const startBody = pageBodyOf(ordered.start.node);
      const endBody = pageBodyOf(ordered.end.node);
      if (!startBody || !endBody) return null;
      const bodies = pageBodies();
      const startIdx = bodies.indexOf(startBody);
      const endIdx = bodies.indexOf(endBody);
      if (startIdx < 0 || endIdx < 0) return null;
      const lo = Math.min(startIdx, endIdx);
      const hi = Math.max(startIdx, endIdx);
      return { start: ordered.start, end: ordered.end, startIdx: lo, endIdx: hi, bodies };
    }

    const CROSS_SEL_HIGHLIGHT = 'margo-cross-sel';

    function supportsCssHighlights() {
      return typeof CSS !== 'undefined' && CSS.highlights && typeof Highlight !== 'undefined';
    }

    function clearCrossPageHighlights() {
      if (!supportsCssHighlights()) return;
      try { CSS.highlights.delete(CROSS_SEL_HIGHLIGHT); } catch {}
    }

    function setNativePageSelection(span, nativeBodyIdx) {
      const body = span.bodies[nativeBodyIdx];
      if (!body) return false;
      if (document.activeElement !== body) {
        try { body.focus({ preventScroll: true }); } catch { body.focus(); }
      }
      try {
        const range = slicePageRange(body, nativeBodyIdx, span);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        return true;
      } catch {
        return false;
      }
    }

    function paintCrossPageHighlights(span, nativeBodyIdx) {
      clearCrossPageHighlights();
      if (!span || span.startIdx === span.endIdx || !supportsCssHighlights()) return;
      const ranges = [];
      for (let i = span.startIdx; i <= span.endIdx; i++) {
        if (i === nativeBodyIdx) continue;
        const body = span.bodies[i];
        if (!body) continue;
        try { ranges.push(slicePageRange(body, i, span)); } catch {}
      }
      if (!ranges.length) return;
      try { CSS.highlights.set(CROSS_SEL_HIGHLIGHT, new Highlight(...ranges)); } catch {}
    }

    function rebuildCrossPageSelectionVisual() {
      if (!crossPageRange || !crossPageRange.start || !crossPageRange.end) {
        clearCrossPageSelection();
        return;
      }
      const span = spanFromPoints(crossPageRange.start, crossPageRange.end);
      if (!span || span.startIdx === span.endIdx) {
        clearCrossPageSelection();
        return;
      }
      let nativeIdx = crossPageNativeIdx;
      if (nativeIdx < span.startIdx || nativeIdx > span.endIdx) nativeIdx = span.startIdx;
      crossPageNativeIdx = nativeIdx;
      setNativePageSelection(span, nativeIdx);
      paintCrossPageHighlights(span, nativeIdx);
    }

    function clearCrossPageSelection() {
      crossPageRange = null;
      crossPageNativeIdx = -1;
      clearCrossPageHighlights();
    }

    function applyCrossSelection(anchor, focus) {
      const span = spanFromPoints(anchor, focus);
      if (!span) return false;
      const startBody = pageBodyOf(span.start.node);
      const endBody = pageBodyOf(span.end.node);
      const multiPage = startBody !== endBody;
      if (multiPage) {
        crossPageRange = { start: span.start, end: span.end };
        const anchorBody = pageBodyOf(anchor.node);
        let nativeIdx = anchorBody ? span.bodies.indexOf(anchorBody) : -1;
        if (nativeIdx < span.startIdx || nativeIdx > span.endIdx) nativeIdx = span.startIdx;
        crossPageNativeIdx = nativeIdx;
        setNativePageSelection(span, nativeIdx);
        paintCrossPageHighlights(span, nativeIdx);
        return true;
      }
      crossPageRange = null;
      crossPageNativeIdx = -1;
      clearCrossPageHighlights();
      try {
        const range = document.createRange();
        range.setStart(span.start.node, clampNodeOffset(span.start.node, span.start.offset));
        range.setEnd(span.end.node, clampNodeOffset(span.end.node, span.end.offset));
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        return true;
      } catch {
        return false;
      }
    }

    function getCopySpan() {
      const fromStored = () => {
        if (!crossPageRange || !crossPageRange.start || !crossPageRange.end) return null;
        if (!crossPageRange.start.node || !crossPageRange.start.node.isConnected) return null;
        if (!crossPageRange.end.node || !crossPageRange.end.node.isConnected) return null;
        const startBody = pageBodyOf(crossPageRange.start.node);
        const endBody = pageBodyOf(crossPageRange.end.node);
        if (!startBody || !endBody) return null;
        const bodies = pageBodies();
        const startIdx = bodies.indexOf(startBody);
        const endIdx = bodies.indexOf(endBody);
        if (startIdx < 0 || endIdx < 0) return null;
        const lo = Math.min(startIdx, endIdx);
        const hi = Math.max(startIdx, endIdx);
        const ordered = orderedPoints(crossPageRange.start, crossPageRange.end);
        return { start: ordered.start, end: ordered.end, startIdx: lo, endIdx: hi, bodies };
      };

      const sel = window.getSelection();
      if (sel && sel.rangeCount && !sel.isCollapsed) {
        const r = sel.getRangeAt(0);
        const startBody = pageBodyOf(r.startContainer);
        const endBody = pageBodyOf(r.endContainer);
        if (startBody && endBody) {
          const bodies = pageBodies();
          const startIdx = bodies.indexOf(startBody);
          const endIdx = bodies.indexOf(endBody);
          if (startIdx >= 0 && endIdx >= 0 && startIdx !== endIdx) {
            const lo = Math.min(startIdx, endIdx);
            const hi = Math.max(startIdx, endIdx);
            return {
              start: { node: r.startContainer, offset: r.startOffset },
              end: { node: r.endContainer, offset: r.endOffset },
              startIdx: lo,
              endIdx: hi,
              bodies
            };
          }
        }
      }
      return fromStored();
    }

    function slicePageRange(body, i, span) {
      const r = document.createRange();
      if (i === span.startIdx) {
        r.setStart(span.start.node, clampNodeOffset(span.start.node, span.start.offset));
      } else {
        r.setStart(body, 0);
      }
      if (i === span.endIdx) {
        r.setEnd(span.end.node, clampNodeOffset(span.end.node, span.end.offset));
      } else {
        r.setEnd(body, body.childNodes.length);
      }
      return r;
    }

    function buildCopyPayload() {
      const span = getCopySpan();
      if (!span || span.startIdx === span.endIdx) return null;
      const wrap = document.createElement('div');
      for (let i = span.startIdx; i <= span.endIdx; i++) {
        const body = span.bodies[i];
        if (!body) continue;
        try {
          wrap.appendChild(slicePageRange(body, i, span).cloneContents());
        } catch {
          Array.from(body.cloneNode(true).childNodes).forEach((n) => wrap.appendChild(n));
        }
      }
      cleanClone(wrap);
      return { html: wrap.innerHTML, text: plainText(wrap) };
    }

    function writeClipboardFromEvent(e, payload) {
      e.preventDefault();
      e.clipboardData.setData('text/html', payload.html);
      e.clipboardData.setData('text/plain', payload.text);
    }

    function deleteCopySpan(span) {
      skipInputRecord = true;
      try {
        for (let i = span.endIdx; i >= span.startIdx; i--) {
          const body = span.bodies[i];
          if (!body) continue;
          try { slicePageRange(body, i, span).deleteContents(); } catch {}
          if (!body.childNodes.length) body.innerHTML = EMPTY_PAGE;
        }
      } finally {
        skipInputRecord = false;
      }
      crossPageRange = null;
      crossPageNativeIdx = -1;
      clearCrossPageHighlights();
      ctx.markDirty();
      recordNow();
      const startPage = span.bodies[span.startIdx] && span.bodies[span.startIdx].closest('.doc-page');
      schedulePaginate(startPage || getPageEl());
      updateStatus();
    }

    function selectAllDocument() {
      const bodies = pageBodies();
      if (!bodies.length) return;
      const first = bodies[0];
      const last = bodies[bodies.length - 1];
      const start = { node: first, offset: 0 };
      const end = { node: last, offset: last.childNodes.length };
      try { first.focus({ preventScroll: true }); } catch { first.focus(); }
      applyCrossSelection(start, end);
    }

    function maybeAutoScrollDrag(y) {
      if (!scrollEl) return false;
      const r = scrollEl.getBoundingClientRect();
      const edge = 32;
      const before = scrollEl.scrollTop;
      if (y < r.top + edge) scrollEl.scrollTop -= 12;
      else if (y > r.bottom - edge) scrollEl.scrollTop += 12;
      return scrollEl.scrollTop !== before;
    }

    function endSelectDrag() {
      selectDragging = false;
      selectAnchor = null;
      selectCrossLock = false;
    }

    function onSelectWheelLock(e) {
      if (e.ctrlKey || e.metaKey) return;
      if (!selectDragging) return;
      /* Trackpad/wheel moves pages under a still pointer. Freeze crossing
         pages until the mouse actually moves again. */
      selectCrossLock = true;
      selectCrossLockX = e.clientX;
      selectCrossLockY = e.clientY;
    }

    function onSelectPointerDown(e) {
      if (e.button !== 0 || !pagesRoot) return;
      if (e.target.closest && e.target.closest('button, input, textarea, .doc-find-bar, .doc-img-overlay, img, .margo-toc, sup.margo-fn-ref')) return;
      if (viewMode === 'read') return;
      const caret = caretInPageBody(e.clientX, e.clientY, { allowGap: false });
      const sel = window.getSelection();
      lastDragClientX = e.clientX;
      lastDragClientY = e.clientY;
      selectCrossLock = false;
      if (e.shiftKey && sel && sel.anchorNode && pageBodyOf(sel.anchorNode)) {
        e.preventDefault();
        selectAnchor = { node: sel.anchorNode, offset: sel.anchorOffset };
        if (caret) applyCrossSelection(selectAnchor, caret);
        selectDragging = true;
        return;
      }
      if (!caret) {
        endSelectDrag();
        clearCrossPageSelection();
        return;
      }
      e.preventDefault();
      selectAnchor = caret;
      clearCrossPageSelection();
      selectDragging = true;
      applyCrossSelection(selectAnchor, selectAnchor);
    }

    function onSelectPointerMove(e) {
      if (!selectDragging || !selectAnchor || !(e.buttons & 1)) return;
      if (!selectAnchor.node || !selectAnchor.node.isConnected) return;
      if (selectCrossLock) {
        const dist = Math.hypot(e.clientX - selectCrossLockX, e.clientY - selectCrossLockY);
        if (dist >= 16) selectCrossLock = false;
      }
      const moved = e.clientX !== lastDragClientX || e.clientY !== lastDragClientY;
      const scrolled = !selectCrossLock && maybeAutoScrollDrag(e.clientY);
      lastDragClientX = e.clientX;
      lastDragClientY = e.clientY;
      if (!moved && !scrolled) return;
      const allowGap = !selectCrossLock;
      const caret = caretInPageBody(e.clientX, e.clientY, { allowGap });
      if (!caret) return;
      const aBody = pageBodyOf(selectAnchor.node);
      const bBody = pageBodyOf(caret.node);
      if (!aBody || !bBody) return;
      if (selectCrossLock && aBody !== bBody) return;
      e.preventDefault();
      applyCrossSelection(selectAnchor, caret);
    }

    function onSelectPointerUp() {
      endSelectDrag();
    }

    function onSelectPointerCancel() {
      endSelectDrag();
    }

    function onPageCopy(e) {
      const payload = buildCopyPayload();
      if (!payload) return;
      writeClipboardFromEvent(e, payload);
    }

    function onPageCut(e) {
      const payload = buildCopyPayload();
      if (!payload) return;
      const span = getCopySpan();
      writeClipboardFromEvent(e, payload);
      if (span) deleteCopySpan(span);
    }

    function onPageKeydown(e) {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.key.toLowerCase() !== 'a') return;
      if (typeof isFindFieldFocused === 'function' && isFindFieldFocused()) return;
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      e.preventDefault();
      selectAllDocument();
    }

    function execClipboardCommand(name) {
      const payload = buildCopyPayload();
      if (!payload) {
        const page = getPage();
        if (page) page.focus();
        document.execCommand(name);
        return;
      }
      const handler = name === 'cut' ? onPageCut : onPageCopy;
      document.addEventListener(name, handler, true);
      try { document.execCommand(name); }
      finally { document.removeEventListener(name, handler, true); }
    }


    /* ---------- paste & drop ----------
       Pasted HTML is sanitised, then reduced to the formatting a document
       keeps: Word's mso- styles, class soup and <o:p> shells, web pages'
       16px system fonts and white backgrounds, Google Docs' wrapper <b>, and
       duplicate comment anchors copied from Margo itself are all dropped.
       Word's list paragraphs come back as real lists. */
    const PASTE_ATTR = ['href', 'src', 'alt', 'style', 'colspan', 'rowspan', 'class', 'data-callout-type', 'data-fn'];
    const KEEP_CLASS = /^(hl-[a-z]+|margo-(title|subtitle|checklist|callout(-[a-z]+)?|callout-title|toc(-[a-z0-9]+)?|tbl-(none|outer)|wrap-(left|right)|fn-ref|footnotes)|is-checked)$/;
    const GENERIC_FONTS = /^(serif|sans-serif|monospace|cursive|fantasy|system-ui|-apple-system|blinkmacsystemfont|ui-sans-serif|ui-serif|ui-monospace|inherit|initial)$/i;

    function colorIsNeutral(v) {
      const s = String(v || '').trim().toLowerCase();
      if (!s || s === 'inherit' || s === 'windowtext' || s === 'initial' || s === 'currentcolor' || s === 'transparent') return true;
      const m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)$/.exec(s);
      let rgb = null;
      if (m) {
        if (m[4] != null && parseFloat(m[4]) === 0) return true;
        rgb = [+m[1], +m[2], +m[3]];
      } else if (/^#[0-9a-f]{6}$/.test(s)) {
        rgb = [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
      } else if (/^#[0-9a-f]{3}$/.test(s)) {
        rgb = s.slice(1).split('').map((c) => parseInt(c + c, 16));
      } else if (s === 'black' || s === 'white') return true;
      if (!rgb) return false;
      const max = Math.max(...rgb);
      const min = Math.min(...rgb);
      // Near-black body text and near-white page backgrounds are the page's.
      return (max < 60 && max - min < 20) || (min > 235);
    }

    function filterStyle(el) {
      const st = el.style;
      if (!st || !el.getAttribute('style')) return;
      const tag = el.tagName;
      const keep = {};
      const isBlock = /^(P|H[1-6]|LI|DIV|BLOCKQUOTE|TD|TH)$/.test(tag);
      const fw = st.fontWeight;
      if (fw && (fw === 'bold' || parseInt(fw, 10) >= 600)) keep['font-weight'] = 'bold';
      else if (fw && (fw === 'normal' || parseInt(fw, 10) <= 400) && /^(B|STRONG)$/.test(tag)) keep['font-weight'] = 'normal';
      if (st.fontStyle === 'italic') keep['font-style'] = 'italic';
      const td = (st.textDecorationLine || st.textDecoration || '');
      if (/underline|line-through/.test(td)) keep['text-decoration'] = td.match(/underline|line-through/g).join(' ');
      if (/^(super|sub)$/.test(st.verticalAlign)) keep['vertical-align'] = st.verticalAlign;
      if (/^(TD|TH)$/.test(tag) && /^(top|middle|bottom)$/.test(st.verticalAlign)) keep['vertical-align'] = st.verticalAlign;
      if (st.color && !colorIsNeutral(st.color)) keep.color = st.color;
      if (st.backgroundColor && !colorIsNeutral(st.backgroundColor) && tag !== 'P' && tag !== 'DIV') keep['background-color'] = st.backgroundColor;
      if (st.fontFamily) {
        const first = st.fontFamily.split(',')[0].replace(/["']/g, '').trim();
        if (first && !GENERIC_FONTS.test(first) && availableFonts.some((f) => f.toLowerCase() === first.toLowerCase())) {
          keep['font-family'] = first;
        }
      }
      // Sizes in points come from word processors and mean something; pixel
      // sizes are a web page's and would make pasted text 12pt-plus.
      if (/^[\d.]+pt$/.test(st.fontSize || '') && Math.abs(parseFloat(st.fontSize) - 11) > 0.1) keep['font-size'] = st.fontSize;
      if (isBlock && /^(center|right|justify)$/.test(st.textAlign)) keep['text-align'] = st.textAlign;
      if (isBlock && tag !== 'TD' && tag !== 'TH' && /^[\d.]+(pt|in|cm)$/.test(st.marginLeft || '') && parseFloat(st.marginLeft) > 0 && tag !== 'LI') keep['margin-left'] = st.marginLeft;
      if (tag === 'IMG') {
        if (/^[\d.]+px$/.test(st.width || '')) keep.width = st.width;
        if (/^[\d.]+px$/.test(st.height || '')) keep.height = st.height;
      }
      el.removeAttribute('style');
      Object.keys(keep).forEach((k) => el.style.setProperty(k, keep[k]));
      if (!el.getAttribute('style')) el.removeAttribute('style');
    }

    function convertWordLists(root) {
      const items = Array.from(root.querySelectorAll('p[style*="mso-list"]'));
      items.forEach((p) => {
        if (!p.isConnected) return;
        const ignore = p.querySelector('[style*="mso-list:Ignore"], [style*="mso-list: Ignore"]');
        const glyph = ignore ? ignore.textContent.replace(/\s+/g, '') : '';
        if (ignore) ignore.remove();
        const ordered = /^(\d+|[a-z]|[ivxlc]+)[.)]$/i.test(glyph);
        const level = parseInt((/level(\d+)/.exec(p.getAttribute('style') || '') || [])[1] || '1', 10);
        const li = document.createElement('li');
        while (p.firstChild) li.appendChild(p.firstChild);
        let prev = p.previousElementSibling;
        let list = prev && /^(UL|OL)$/.test(prev.tagName) && prev.dataset.pasteList ? prev : null;
        if (!list) {
          list = document.createElement(ordered ? 'ol' : 'ul');
          list.dataset.pasteList = '1';
          p.before(list);
        }
        // Nest by level under the last item.
        let target = list;
        for (let lv = 1; lv < level; lv++) {
          const lastLi = target.lastElementChild;
          if (!lastLi) break;
          let sub = Array.from(lastLi.children).find((c) => /^(UL|OL)$/.test(c.tagName));
          if (!sub) { sub = document.createElement(ordered ? 'ol' : 'ul'); lastLi.appendChild(sub); }
          target = sub;
        }
        target.appendChild(li);
        p.remove();
      });
      root.querySelectorAll('[data-paste-list]').forEach((l) => l.removeAttribute('data-paste-list'));
    }

    function cleanPastedHtml(html) {
      const frag = DOMPurify.sanitize(String(html || ''), {
        ALLOWED_TAGS: ALLOWED_TAGS.filter((t) => t !== 'font'),
        ALLOWED_ATTR: PASTE_ATTR,
        RETURN_DOM_FRAGMENT: true
      });
      const root = document.createElement('div');
      root.appendChild(frag);
      convertWordLists(root);
      let dropped = 0;
      root.querySelectorAll('img').forEach((img) => {
        const src = img.getAttribute('src') || '';
        // Only embedded pictures can be shown and saved; a file:// or web
        // address is blocked by the app and would print as a broken image.
        if (!/^data:image\//i.test(src)) { img.remove(); dropped++; }
      });
      root.querySelectorAll('a').forEach((a) => {
        const href = a.getAttribute('href') || '';
        if (!/^(https?:|mailto:)/i.test(href)) a.removeAttribute('href');
      });
      root.querySelectorAll('.margo-note-anchor, [data-margo-note-id], mark.margo-find-hit').forEach(unwrapEl);
      root.querySelectorAll('*').forEach((el) => {
        const cls = (el.getAttribute('class') || '').split(/\s+/).filter((c) => KEEP_CLASS.test(c));
        if (cls.length) el.setAttribute('class', cls.join(' '));
        else el.removeAttribute('class');
        filterStyle(el);
        if (el.tagName === 'TABLE') el.style.width = '100%';
      });
      // Google Docs wraps a whole paste in <b style="font-weight:normal">.
      root.querySelectorAll('b, strong').forEach((b) => {
        if (b.style.fontWeight === 'normal') unwrapEl(b);
      });
      root.querySelectorAll('span').forEach((s) => { if (!s.attributes.length) unwrapEl(s); });
      // A div holding only inline content is a paragraph.
      root.querySelectorAll('div').forEach((d) => {
        if (d.classList.length || d.hasAttribute('data-callout-type')) return;
        if (d.querySelector('p, div, h1, h2, h3, h4, h5, h6, ul, ol, table, blockquote, pre')) { unwrapEl(d); return; }
        const p = document.createElement('p');
        if (d.getAttribute('style')) p.setAttribute('style', d.getAttribute('style'));
        while (d.firstChild) p.appendChild(d.firstChild);
        d.replaceWith(p);
      });
      root.querySelectorAll('h5, h6').forEach((h) => {
        const h4 = document.createElement('h4');
        while (h.firstChild) h4.appendChild(h.firstChild);
        h.replaceWith(h4);
      });
      if (dropped) ctx.toast(`${dropped} linked picture${dropped === 1 ? '' : 's'} could not be pasted`);
      return root.innerHTML;
    }

    function plainTextToHtml(text) {
      const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
      if (lines.length === 1) return null;
      return lines.map((l) => `<p>${l ? escapeHtml(l).replace(/\t/g, '&nbsp;&nbsp;&nbsp;&nbsp;') : '<br>'}</p>`).join('');
    }

    function onPaste(e) {
      if (viewMode === 'read') return;
      const body = pageBodyOf(e.target);
      if (!body) return;
      const dt = e.clipboardData;
      if (!dt) return;
      const html = dt.getData('text/html');
      const files = Array.from(dt.files || []).filter((f) => /^image\//.test(f.type));
      const span = getCopySpan();
      if (files.length && !html) {
        e.preventDefault();
        if (span && span.startIdx !== span.endIdx) deleteCopySpan(span);
        insertImageFiles(files);
        return;
      }
      let insert = null;
      if (html) insert = cleanPastedHtml(html);
      else {
        const text = dt.getData('text/plain');
        insert = text ? plainTextToHtml(text) : null;
        if (insert == null) {
          // One line of plain text: the browser's own insert keeps typing undo.
          if (span && span.startIdx !== span.endIdx) { e.preventDefault(); deleteCopySpan(span); insertTextAtCaret(text); }
          return;
        }
      }
      e.preventDefault();
      if (span && span.startIdx !== span.endIdx) deleteCopySpan(span);
      setActivePage(body.closest('.doc-page'));
      insertHtmlAtCaret(insert);
      body.querySelectorAll('img').forEach((img) => {
        if (!img.complete) img.addEventListener('load', () => schedulePaginate(), { once: true });
      });
    }

    let internalDrag = false;
    function onDragStart(e) {
      internalDrag = !!(pagesRoot && pagesRoot.contains(e.target));
    }
    function onDragEnd() { internalDrag = false; }

    function onDragOver(e) {
      if (viewMode === 'read' || internalDrag) return;
      const types = Array.from((e.dataTransfer && e.dataTransfer.types) || []);
      if (types.includes('Files') || types.includes('text/html')) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }
    }

    function placeCaretAtPoint(x, y) {
      const pt = caretInPageBody(x, y, { allowGap: true });
      if (!pt) return false;
      const body = pageBodyOf(pt.node);
      if (!body) return false;
      body.focus({ preventScroll: true });
      const sel = window.getSelection();
      const r = document.createRange();
      r.setStart(pt.node, clampNodeOffset(pt.node, pt.offset));
      r.collapse(true);
      sel.removeAllRanges();
      sel.addRange(r);
      setActivePage(body.closest('.doc-page'));
      return true;
    }

    function onDrop(e) {
      if (viewMode === 'read') return;
      if (internalDrag) { internalDrag = false; setTimeout(() => afterChange(), 0); return; }
      const dt = e.dataTransfer;
      if (!dt) return;
      const files = Array.from(dt.files || []).filter((f) => /^image\//.test(f.type));
      const html = dt.getData('text/html');
      if (!files.length && !html) return;
      e.preventDefault();
      if (!placeCaretAtPoint(e.clientX, e.clientY)) return;
      if (files.length) insertImageFiles(files);
      else insertHtmlAtCaret(cleanPastedHtml(html));
    }

    /* ---------- tables ---------- */
    const TABLE_PICKER_COLS = 10;
    const TABLE_PICKER_ROWS = 8;

    function buildTableHtml(rows, cols) {
      let html = '<table style="width:100%"><tbody>';
      for (let r = 0; r < rows; r++) {
        html += '<tr>';
        for (let c = 0; c < cols; c++) html += '<td><br></td>';
        html += '</tr>';
      }
      html += '</tbody></table><p><br></p>';
      return html;
    }

    function insertTableAt(rows, cols) {
      restoreSelection();
      insertHtmlAtCaret(buildTableHtml(rows, cols));
      // The caret lands after the new table; put it in the first cell.
      const sel = window.getSelection();
      const r = sel.rangeCount ? sel.getRangeAt(0) : null;
      const body = r ? pageBodyOf(r.startContainer) : null;
      if (!body) return;
      const block = closestBlock(r.startContainer, body);
      let t = block && block.previousElementSibling;
      if (!t || t.tagName !== 'TABLE') {
        const tables = Array.from(body.querySelectorAll('table'));
        t = tables.reverse().find((tb) => tb.compareDocumentPosition(r.startContainer) & Node.DOCUMENT_POSITION_FOLLOWING) || null;
      }
      const cell = t && t.querySelector('td, th');
      if (cell) placeCaretIn(cell);
    }

    function placeCaretIn(el, atEnd) {
      const body = pageBodyOf(el);
      if (!body) return;
      body.focus({ preventScroll: true });
      const sel = window.getSelection();
      const r = document.createRange();
      r.selectNodeContents(el);
      r.collapse(!atEnd);
      sel.removeAllRanges();
      sel.addRange(r);
      rememberSelection();
    }

    function openTableSizePicker(anchorBtn) {
      saveSelection();
      openPopover(anchorBtn, (pop, close) => {
        pop.classList.add('doc-table-pop');
        const grid = document.createElement('div');
        grid.className = 'table-size-grid';
        grid.style.gridTemplateColumns = `repeat(${TABLE_PICKER_COLS}, 1fr)`;
        const label = document.createElement('div');
        label.className = 'table-size-label';
        label.textContent = 'Insert table';
        const cells = [];
        const paint = (r, c) => {
          cells.forEach((cell) => {
            cell.classList.toggle('active', +cell.dataset.row <= r && +cell.dataset.col <= c);
          });
          label.textContent = r && c ? `${c} × ${r} table` : 'Insert table';
        };
        for (let r = 1; r <= TABLE_PICKER_ROWS; r++) {
          for (let c = 1; c <= TABLE_PICKER_COLS; c++) {
            const cell = document.createElement('button');
            cell.type = 'button';
            cell.className = 'table-size-cell';
            cell.dataset.row = String(r);
            cell.dataset.col = String(c);
            cell.setAttribute('aria-label', `${c} columns by ${r} rows`);
            cell.addEventListener('mouseenter', () => paint(r, c));
            cell.addEventListener('focus', () => paint(r, c));
            cell.addEventListener('click', (e) => {
              e.preventDefault();
              close();
              insertTableAt(r, c);
            });
            grid.appendChild(cell);
            cells.push(cell);
          }
        }
        grid.addEventListener('mouseleave', () => paint(0, 0));
        pop.appendChild(label);
        pop.appendChild(grid);
      });
    }

    /* A table as a grid of slots, with merged cells occupying every slot
       they cover. Every row and column operation reads this rather than
       counting <td>s, which is what lets them work on merged tables. */
    function tableGrid(table) {
      const rows = Array.from(table.querySelectorAll('tr')).filter((tr) => tr.closest('table') === table);
      const grid = rows.map(() => []);
      const info = new Map();
      rows.forEach((tr, r) => {
        let c = 0;
        Array.from(tr.children).forEach((cell) => {
          if (!/^(TD|TH)$/.test(cell.tagName)) return;
          while (grid[r][c]) c++;
          const rs = Math.max(1, parseInt(cell.getAttribute('rowspan') || '1', 10) || 1);
          const cs = Math.max(1, parseInt(cell.getAttribute('colspan') || '1', 10) || 1);
          info.set(cell, { r, c, rs: Math.min(rs, rows.length - r), cs });
          for (let dr = 0; dr < rs && r + dr < rows.length; dr++) {
            for (let dc = 0; dc < cs; dc++) grid[r + dr][c + dc] = cell;
          }
          c += cs;
        });
      });
      const cols = grid.reduce((m, row) => Math.max(m, row.length), 0);
      return { rows, grid, info, cols };
    }

    function setSpan(cell, attr, n) {
      if (n > 1) cell.setAttribute(attr, String(n));
      else cell.removeAttribute(attr);
    }

    function newCellLike(ref) {
      const cell = document.createElement(ref && ref.tagName === 'TH' ? 'th' : 'td');
      cell.innerHTML = '<br>';
      return cell;
    }

    function tableOp(fn) {
      const t = selectionInTable();
      if (!t) { ctx.toast('Put the cursor in a table first'); return; }
      batch(() => fn(t));
      refreshStates();
    }

    function insertRow(where) {
      tableOp(({ table, cell }) => {
        const g = tableGrid(table);
        const me = g.info.get(cell);
        const at = where === 'above' ? me.r : me.r + me.rs; // index the new row takes
        const tr = document.createElement('tr');
        const seen = new Set();
        for (let c = 0; c < g.cols; c++) {
          const ref = g.grid[Math.min(at, g.rows.length - 1)][c] || g.grid[Math.max(0, at - 1)][c];
          if (!ref || seen.has(ref)) continue;
          seen.add(ref);
          const inf = g.info.get(ref);
          const crossing = inf.r < at && inf.r + inf.rs > at;
          if (crossing) setSpan(ref, 'rowspan', inf.rs + 1);
          else {
            const nc = newCellLike(where === 'above' && at === 0 ? ref : null);
            setSpan(nc, 'colspan', inf.cs);
            tr.appendChild(nc);
          }
        }
        if (at >= g.rows.length) g.rows[g.rows.length - 1].after(tr);
        else g.rows[at].before(tr);
        placeCaretIn(tr.querySelector('td, th') || cell);
      });
    }

    function colWidthsPercent(table) {
      const cg = table.querySelector(':scope > colgroup');
      if (!cg) return null;
      const cols = Array.from(cg.children);
      const px = cols.map((c) => c.getBoundingClientRect().width || parseFloat(c.style.width) || 0);
      const sum = px.reduce((a, b) => a + b, 0) || 1;
      return { cg, cols, pct: px.map((w) => (w / sum) * 100) };
    }

    function applyColPercents(cg, pct) {
      Array.from(cg.children).forEach((c, i) => { c.style.width = pct[i].toFixed(2) + '%'; });
    }

    function insertCol(where) {
      tableOp(({ table, cell }) => {
        const g = tableGrid(table);
        const me = g.info.get(cell);
        const at = where === 'left' ? me.c : me.c + me.cs; // slot index the new column takes
        const seen = new Set();
        g.rows.forEach((tr, r) => {
          const ref = g.grid[r][Math.min(at, g.cols - 1)] || g.grid[r][at - 1];
          if (!ref || seen.has(ref)) return;
          seen.add(ref);
          const inf = g.info.get(ref);
          const crossing = inf.c < at && inf.c + inf.cs > at;
          if (crossing) { setSpan(ref, 'colspan', inf.cs + 1); return; }
          const nc = newCellLike(ref);
          setSpan(nc, 'rowspan', inf.rs);
          if (at >= g.cols || (where === 'right' && inf.c + inf.cs === at)) {
            // After the slot to the left of the boundary.
            const left = g.grid[r][at - 1];
            if (left && left.parentElement === tr) left.after(nc);
            else tr.appendChild(nc);
          } else {
            const right = g.grid[r][at];
            if (right && right.parentElement === tr && g.info.get(right).c === at) right.before(nc);
            else tr.appendChild(nc);
          }
        });
        const w = colWidthsPercent(table);
        if (w) {
          const col = document.createElement('col');
          const idx = Math.min(at, w.cols.length);
          if (idx >= w.cols.length) w.cg.appendChild(col); else w.cols[idx].before(col);
          const n = w.pct.length + 1;
          const pct = w.pct.map((p) => p * (n - 1) / n);
          pct.splice(idx, 0, 100 / n);
          applyColPercents(w.cg, pct);
        }
      });
    }

    function deleteRowOp() {
      tableOp(({ table, cell }) => {
        const g = tableGrid(table);
        const me = g.info.get(cell);
        const from = me.r;
        const to = me.r + me.rs - 1;
        if (from === 0 && to >= g.rows.length - 1) { deleteTableOp(table); return; }
        for (let r = to; r >= from; r--) {
          const tr = g.rows[r];
          const seen = new Set();
          for (let c = 0; c < g.cols; c++) {
            const x = g.grid[r][c];
            if (!x || seen.has(x)) continue;
            seen.add(x);
            const inf = g.info.get(x);
            if (inf.r < r) { setSpan(x, 'rowspan', inf.rs - 1); inf.rs--; continue; }
            if (inf.rs > 1 && g.rows[r + 1]) {
              // A merged cell starting here moves down to the next row.
              const nextTr = g.rows[r + 1];
              const after = Array.from(nextTr.children).find((k) => g.info.get(k) && g.info.get(k).c > inf.c);
              setSpan(x, 'rowspan', inf.rs - 1);
              if (after) after.before(x); else nextTr.appendChild(x);
              inf.r = r + 1; inf.rs--;
            }
          }
          tr.remove();
        }
        const next = g.rows[to + 1] || g.rows[from - 1];
        if (next && next.isConnected) placeCaretIn(next.querySelector('td, th'));
        tidyTable(table);
      });
    }

    function deleteColOp() {
      tableOp(({ table, cell }) => {
        const g = tableGrid(table);
        const me = g.info.get(cell);
        if (me.c === 0 && me.cs >= g.cols) { deleteTableOp(table); return; }
        for (let c = me.c + me.cs - 1; c >= me.c; c--) {
          const seen = new Set();
          g.rows.forEach((tr, r) => {
            const x = g.grid[r][c];
            if (!x || seen.has(x)) return;
            seen.add(x);
            const inf = g.info.get(x);
            if (inf.cs > 1) { inf.cs--; setSpan(x, 'colspan', inf.cs); }
            else x.remove();
          });
        }
        const w = colWidthsPercent(table);
        if (w) {
          const keep = w.pct.filter((_, i) => i < me.c || i >= me.c + me.cs);
          for (let i = me.c + me.cs - 1; i >= me.c; i--) if (w.cols[i]) w.cols[i].remove();
          const sum = keep.reduce((a, b) => a + b, 0) || 1;
          applyColPercents(w.cg, keep.map((p) => p * 100 / sum));
        }
        const any = table.querySelector('td, th');
        if (any) placeCaretIn(any);
        tidyTable(table);
      });
    }

    function deleteTableOp(table) {
      const t = table || (selectionInTable() || {}).table;
      if (!t) return;
      const run = () => {
        const next = t.nextElementSibling;
        const p = document.createElement('p');
        p.innerHTML = '<br>';
        if (!next || next.tagName !== 'P') t.after(p);
        const target = next && next.tagName === 'P' ? next : p;
        t.remove();
        placeCaretIn(target);
      };
      if (table) run(); else batch(run);
    }

    /* Rows left with no cells after a merge are removed, and the merged
       cells that covered them shrink to match. */
    function tidyTable(table) {
      Array.from(table.querySelectorAll('tr')).filter((tr) => tr.closest('table') === table).forEach((tr) => {
        if (tr.querySelector(':scope > td, :scope > th')) return;
        const g = tableGrid(table);
        const r = g.rows.indexOf(tr);
        const seen = new Set();
        (g.grid[r] || []).forEach((x) => {
          if (!x || seen.has(x)) return;
          seen.add(x);
          const inf = g.info.get(x);
          setSpan(x, 'rowspan', inf.rs - 1);
        });
        tr.remove();
      });
      ['thead', 'tbody'].forEach((sel) => {
        table.querySelectorAll(':scope > ' + sel).forEach((s) => { if (!s.children.length) s.remove(); });
      });
    }

    function selectedCells(table) {
      const sel = window.getSelection();
      const r = sel.rangeCount ? sel.getRangeAt(0) : liveRange(lastRange);
      if (!r) return [];
      const all = Array.from(table.querySelectorAll('td, th')).filter((c) => c.closest('table') === table);
      const hit = all.filter((c) => r.intersectsNode(c));
      return hit.length ? hit : [];
    }

    function mergeCells() {
      tableOp(({ table }) => {
        const cells = selectedCells(table);
        if (cells.length < 2) { ctx.toast('Select two or more cells to merge'); return; }
        const g = tableGrid(table);
        let r0 = Infinity, c0 = Infinity, r1 = -1, c1 = -1;
        cells.forEach((cell) => {
          const i = g.info.get(cell);
          r0 = Math.min(r0, i.r); c0 = Math.min(c0, i.c);
          r1 = Math.max(r1, i.r + i.rs - 1); c1 = Math.max(c1, i.c + i.cs - 1);
        });
        // Every cell inside the rectangle must lie wholly inside it.
        const inside = new Set();
        for (let r = r0; r <= r1; r++) {
          for (let c = c0; c <= c1; c++) {
            const x = g.grid[r][c];
            if (!x) continue;
            const i = g.info.get(x);
            if (i.r < r0 || i.c < c0 || i.r + i.rs - 1 > r1 || i.c + i.cs - 1 > c1) {
              ctx.toast('Those cells do not form a rectangle');
              return;
            }
            inside.add(x);
          }
        }
        const target = g.grid[r0][c0];
        inside.forEach((x) => {
          if (x === target) return;
          const hasContent = x.textContent.trim() || x.querySelector('img, table');
          if (hasContent) {
            const targetEmpty = !target.textContent.trim() && !target.querySelector('img, table');
            if (targetEmpty) target.innerHTML = '';
            else target.appendChild(document.createElement('br'));
            while (x.firstChild) target.appendChild(x.firstChild);
          }
          x.remove();
        });
        setSpan(target, 'rowspan', r1 - r0 + 1);
        setSpan(target, 'colspan', c1 - c0 + 1);
        tidyTable(table);
        placeCaretIn(target, true);
      });
    }

    function splitCellOp() {
      tableOp(({ table, cell }) => {
        const g = tableGrid(table);
        const me = g.info.get(cell);
        if (me.rs === 1 && me.cs === 1) { ctx.toast('Only merged cells can be split'); return; }
        for (let r = me.r; r < me.r + me.rs; r++) {
          const tr = g.rows[r];
          for (let c = me.c + me.cs - 1; c >= me.c; c--) {
            if (r === me.r && c === me.c) continue;
            const nc = newCellLike(cell);
            if (r === me.r) { cell.after(nc); continue; }
            const after = Array.from(tr.children).find((k) => g.info.get(k) && g.info.get(k).c > c);
            if (after) after.before(nc); else tr.appendChild(nc);
          }
        }
        cell.removeAttribute('rowspan');
        cell.removeAttribute('colspan');
      });
    }

    function renameCell(cell, tag) {
      if (cell.tagName.toLowerCase() === tag) return cell;
      const n = document.createElement(tag);
      Array.from(cell.attributes).forEach((a) => n.setAttribute(a.name, a.value));
      while (cell.firstChild) n.appendChild(cell.firstChild);
      cell.replaceWith(n);
      return n;
    }

    function toggleHeaderRow() {
      tableOp(({ table }) => {
        const thead = table.querySelector(':scope > thead');
        if (thead) {
          let tbody = table.querySelector(':scope > tbody');
          if (!tbody) { tbody = document.createElement('tbody'); table.appendChild(tbody); }
          Array.from(thead.children).reverse().forEach((tr) => {
            Array.from(tr.children).forEach((c) => renameCell(c, 'td'));
            tbody.insertBefore(tr, tbody.firstChild);
          });
          thead.remove();
          return;
        }
        const first = table.querySelector('tr');
        if (!first) return;
        const head = document.createElement('thead');
        table.insertBefore(head, table.querySelector(':scope > tbody') || first);
        head.appendChild(first);
        Array.from(first.children).forEach((c) => renameCell(c, 'th'));
      });
    }

    function setTableBorders(mode) {
      tableOp(({ table }) => {
        table.classList.remove('margo-tbl-none', 'margo-tbl-outer');
        if (mode === 'none') table.classList.add('margo-tbl-none');
        if (mode === 'outer') table.classList.add('margo-tbl-outer');
        if (!table.getAttribute('class')) table.removeAttribute('class');
      });
    }

    function targetCells() {
      const t = selectionInTable();
      if (!t) return [];
      const cells = selectedCells(t.table);
      return cells.length ? cells : [t.cell];
    }

    function setTableCellShading(color) {
      const cells = targetCells();
      if (!cells.length) return;
      batch(() => cells.forEach((c) => {
        c.style.backgroundColor = color || '';
        if (!c.getAttribute('style')) c.removeAttribute('style');
      }));
    }

    function setCellVAlign(v) {
      const cells = targetCells();
      if (!cells.length) return;
      batch(() => cells.forEach((c) => {
        c.style.verticalAlign = v;
      }));
    }

    function distributeColumns() {
      tableOp(({ table }) => {
        const g = tableGrid(table);
        let cg = table.querySelector(':scope > colgroup');
        if (!cg) { cg = document.createElement('colgroup'); table.insertBefore(cg, table.firstChild); }
        while (cg.children.length < g.cols) cg.appendChild(document.createElement('col'));
        while (cg.children.length > g.cols) cg.lastElementChild.remove();
        applyColPercents(cg, Array.from({ length: g.cols }, () => 100 / g.cols));
      });
    }

    /* Tab walks the cells; Tab in the last one adds a row, as in Word. */
    function tabInTable(back) {
      const t = selectionInTable();
      if (!t) return false;
      const cells = Array.from(t.table.querySelectorAll('td, th')).filter((c) => c.closest('table') === t.table);
      const i = cells.indexOf(t.cell);
      if (back) {
        if (i > 0) placeCaretIn(cells[i - 1], true);
        return true;
      }
      if (i < cells.length - 1) { placeCaretIn(cells[i + 1], true); return true; }
      const last = cells[cells.length - 1];
      const lastRow = last.parentElement;
      placeCaretIn(lastRow.lastElementChild, true);
      insertRow('below');
      return true;
    }

    /* ---------- table border resize ---------- */
    const TABLE_EDGE = 5;
    const MIN_COL_W = 32;
    const MIN_ROW_H = 24;
    let tableResize = null;

    function tableColumnCount(table) {
      return tableGrid(table).cols;
    }

    function ensureColgroup(table) {
      let cg = table.querySelector(':scope > colgroup');
      const n = tableColumnCount(table);
      if (!cg) {
        cg = document.createElement('colgroup');
        table.insertBefore(cg, table.firstChild);
      }
      while (cg.children.length < n) cg.appendChild(document.createElement('col'));
      while (cg.children.length > n) cg.lastElementChild.remove();
      return cg;
    }

    function cellColIndex(cell) {
      const table = cell.closest('table');
      const inf = tableGrid(table).info.get(cell);
      return inf ? inf.c + inf.cs - 1 : 0;
    }

    function hitTestTableResize(clientX, clientY) {
      if (!pagesRoot || viewMode === 'read') return null;
      const el = document.elementFromPoint(clientX, clientY);
      if (!el || !pagesRoot.contains(el)) return null;
      const cell = el.closest && el.closest('td, th');
      if (!cell || !pagesRoot.contains(cell)) return null;
      const table = cell.closest('table');
      if (!table || !pagesRoot.contains(table)) return null;

      const rect = cell.getBoundingClientRect();
      const z = currentZoom();
      const edge = TABLE_EDGE * Math.max(1, z);
      const nearRight = clientX >= rect.right - edge && clientX <= rect.right + edge;
      const nearBottom = clientY >= rect.bottom - edge && clientY <= rect.bottom + edge;

      if (nearRight) {
        const colIndex = cellColIndex(cell);
        const nCols = tableColumnCount(table);
        return { type: 'col', table, colIndex, isOuter: colIndex >= nCols - 1 };
      }
      if (nearBottom) {
        const rows = Array.from(table.querySelectorAll('tr'));
        const rowIndex = rows.indexOf(cell.parentElement);
        if (rowIndex < 0) return null;
        return { type: 'row', table, rowIndex, isOuter: rowIndex >= rows.length - 1, tr: rows[rowIndex] };
      }
      return null;
    }

    function onTableResizeHover(e) {
      if (tableResize || !pagesRoot || e.buttons) return;
      const hit = hitTestTableResize(e.clientX, e.clientY);
      if (hit) {
        pagesRoot.style.cursor = hit.type === 'col' ? 'col-resize' : 'row-resize';
      } else if (pagesRoot.style.cursor === 'col-resize' || pagesRoot.style.cursor === 'row-resize') {
        pagesRoot.style.cursor = '';
      }
    }

    function onTableResizeDown(e) {
      if (e.button !== 0 || !pagesRoot) return;
      if (onChecklistPointerDown(e)) return;
      const hit = hitTestTableResize(e.clientX, e.clientY);
      if (!hit) return;
      e.preventDefault();
      e.stopPropagation();

      const cg = ensureColgroup(hit.table);
      hit.table.classList.add('margo-table-resizing');
      const z = currentZoom();

      if (hit.type === 'col') {
        const col = cg.children[hit.colIndex];
        const next = cg.children[hit.colIndex + 1] || null;
        if (!col) return;
        // Freeze every column at its drawn width first, so moving one border
        // does not let the others redistribute under the pointer.
        Array.from(cg.children).forEach((c) => { c.style.width = (c.getBoundingClientRect().width / z).toFixed(1) + 'px'; });
        tableResize = {
          type: 'col',
          table: hit.table,
          isOuter: hit.isOuter || !next,
          col,
          next,
          startX: e.clientX,
          startW: col.getBoundingClientRect().width / z,
          startNextW: next ? next.getBoundingClientRect().width / z : 0
        };
      } else {
        const tr = hit.tr || hit.table.querySelectorAll('tr')[hit.rowIndex];
        if (!tr) return;
        tableResize = {
          type: 'row',
          table: hit.table,
          tr,
          startY: e.clientY,
          startH: tr.getBoundingClientRect().height / z
        };
      }

      const onMove = (ev) => {
        if (!tableResize) return;
        if (tableResize.type === 'col') {
          const dx = (ev.clientX - tableResize.startX) / z;
          if (tableResize.next) {
            // An inner border trades width with its neighbour; the table
            // keeps its width.
            const total = tableResize.startW + tableResize.startNextW;
            const w = Math.max(MIN_COL_W, Math.min(total - MIN_COL_W, tableResize.startW + dx));
            tableResize.col.style.width = Math.round(w) + 'px';
            tableResize.next.style.width = Math.round(total - w) + 'px';
          } else {
            const newW = Math.max(MIN_COL_W, tableResize.startW + dx);
            tableResize.col.style.width = Math.round(newW) + 'px';
          }
        } else {
          const dy = (ev.clientY - tableResize.startY) / z;
          const h = Math.max(MIN_ROW_H, Math.round(tableResize.startH + dy));
          tableResize.tr.style.height = h + 'px';
        }
      };

      const onUp = () => {
        const done = tableResize;
        tableResize = null;
        document.removeEventListener('pointermove', onMove, true);
        document.removeEventListener('pointerup', onUp, true);
        document.removeEventListener('pointercancel', onUp, true);
        if (pagesRoot) pagesRoot.style.cursor = '';
        if (done) {
          done.table.classList.remove('margo-table-resizing');
          if (done.type === 'col' && done.table.style.width === '100%') {
            // Keep a full-width table full width: widths become shares of it.
            const w = colWidthsPercent(done.table);
            if (w && !done.isOuter) applyColPercents(w.cg, w.pct);
          }
          afterChange();
        }
      };

      document.addEventListener('pointermove', onMove, true);
      document.addEventListener('pointerup', onUp, true);
      document.addEventListener('pointercancel', onUp, true);
    }

    /* ---------- images ---------- */
    const WORD_IMAGE_TYPES = /^image\/(png|jpe?g|gif)$/i;
    const MAX_IMAGE_PX = 2400;

    function readFileAsDataUrl(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
    }

    function loadImage(src) {
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('Not an image'));
        img.src = src;
      });
    }

    /* Word opens PNG, JPEG and GIF everywhere; WebP, AVIF, SVG and friends
       are converted to PNG on the way in, and very large photos are scaled
       down so one picture does not make the document tens of megabytes. */
    async function prepareImage(file) {
      let src = await readFileAsDataUrl(file);
      let img = await loadImage(src);
      let w = img.naturalWidth || 300;
      let h = img.naturalHeight || 200;
      const tooBig = w > MAX_IMAGE_PX || h > MAX_IMAGE_PX || file.size > 4 * 1024 * 1024;
      if (!WORD_IMAGE_TYPES.test(file.type) || (tooBig && !/gif/i.test(file.type))) {
        const scale = Math.min(1, MAX_IMAGE_PX / Math.max(w, h));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(w * scale));
        c.height = Math.max(1, Math.round(h * scale));
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        const jpeg = /jpe?g/i.test(file.type) || (tooBig && !/png/i.test(file.type));
        src = c.toDataURL(jpeg ? 'image/jpeg' : 'image/png', 0.9);
        w = c.width;
        h = c.height;
      }
      return { src, w, h, name: file.name || '' };
    }

    function contentWidthPx() {
      const body = getPage();
      if (!body) return 624;
      const cs = getComputedStyle(body);
      return Math.max(120, body.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0));
    }

    async function insertImageFiles(files) {
      const list = Array.from(files || []).filter((f) => /^image\//.test(f.type));
      if (!list.length) return;
      const maxW = contentWidthPx();
      const parts = [];
      for (const f of list) {
        try {
          const im = await prepareImage(f);
          const w = Math.min(im.w, maxW);
          const h = Math.round(im.h * (w / im.w));
          parts.push(`<img src="${im.src}" alt="" style="width:${Math.round(w)}px;height:${h}px">`);
        } catch {
          ctx.toast(`${f.name || 'That file'} could not be read as a picture`, 'error');
        }
      }
      if (!parts.length || destroyed) return;
      insertHtmlAtCaret(parts.join(''));
    }

    function insertImageFromDialog() {
      saveSelection();
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.multiple = true;
      input.addEventListener('change', () => {
        if (!input.files || !input.files.length) return;
        restoreSelection();
        insertImageFiles(input.files);
      });
      input.click();
    }

    function hideImageOverlay() {
      if (selectedImg) selectedImg.classList.remove('is-selected');
      selectedImg = null;
      if (imgOverlay) imgOverlay.remove();
      imgOverlay = null;
    }

    function imageAlign(img) {
      if (img.classList.contains('margo-wrap-left')) return 'wrap-left';
      if (img.classList.contains('margo-wrap-right')) return 'wrap-right';
      const block = img.closest('p, div, li, td, th, h1, h2, h3, h4');
      const a = block ? getComputedStyle(block).textAlign : 'left';
      return a === 'center' ? 'center' : (a === 'right' || a === 'end') ? 'right' : 'left';
    }

    function positionImageOverlay() {
      if (!selectedImg || !selectedImg.isConnected) { hideImageOverlay(); return; }
      const page = selectedImg.closest('.doc-page');
      if (!page) { hideImageOverlay(); return; }
      if (!imgOverlay) return;
      if (imgOverlay.parentElement !== page) page.appendChild(imgOverlay);
      const z = currentZoom();
      const pr = page.getBoundingClientRect();
      const ir = selectedImg.getBoundingClientRect();
      imgOverlay.style.left = ((ir.left - pr.left) / z) + 'px';
      imgOverlay.style.top = ((ir.top - pr.top) / z) + 'px';
      imgOverlay.style.width = (ir.width / z) + 'px';
      imgOverlay.style.height = (ir.height / z) + 'px';
      const size = imgOverlay.querySelector('.doc-img-size');
      if (size) size.textContent = `${Math.round(ir.width / z)} × ${Math.round(ir.height / z)}`;
      const al = imageAlign(selectedImg);
      imgOverlay.querySelectorAll('[data-img-align]').forEach((b) => b.classList.toggle('active', b.dataset.imgAlign === al));
      // Toolbar below the picture when there is no room above it.
      const bar = imgOverlay.querySelector('.doc-img-bar');
      if (bar) bar.classList.toggle('below', (ir.top - pr.top) / z < 44);
    }

    function setImageAlign(img, mode) {
      img.classList.remove('margo-wrap-left', 'margo-wrap-right');
      if (mode === 'wrap-left' || mode === 'wrap-right') {
        img.classList.add('margo-' + mode);
      } else {
        const block = img.closest('p, div, li, td, th, h1, h2, h3, h4');
        if (block && pageBodyOf(block) && !block.classList.contains('doc-page-body')) {
          block.style.textAlign = mode === 'left' ? '' : mode;
          if (!block.getAttribute('style')) block.removeAttribute('style');
        } else {
          // A picture straight in the page gets a paragraph of its own.
          const p = document.createElement('p');
          img.before(p);
          p.appendChild(img);
          if (mode !== 'left') p.style.textAlign = mode;
        }
      }
      if (!img.getAttribute('class')) img.removeAttribute('class');
    }

    async function editAltText(img) {
      const next = await ctx.inputModal('Alt text', 'Describe the picture for screen readers and exports…', img.getAttribute('alt') || '');
      if (next == null || !img.isConnected) return;
      img.setAttribute('alt', String(next).trim());
      afterChange({ paginate: false });
    }

    function resetImageSize(img) {
      const maxW = contentWidthPx();
      const nw = img.naturalWidth || img.width;
      const nh = img.naturalHeight || img.height;
      const w = Math.min(nw, maxW);
      img.style.width = Math.round(w) + 'px';
      img.style.height = Math.round(nh * (w / nw)) + 'px';
      img.style.removeProperty('max-height');
      img.style.removeProperty('max-width');
    }

    function selectImage(img) {
      if (!img || viewMode === 'read') return;
      if (selectedImg && selectedImg !== img) hideImageOverlay();
      selectedImg = img;
      img.classList.add('is-selected');
      const body = pageBodyOf(img);
      if (body) {
        try { body.focus({ preventScroll: true }); } catch {}
        const sel = window.getSelection();
        const r = document.createRange();
        r.selectNode(img);
        sel.removeAllRanges();
        sel.addRange(r);
        rememberSelection();
      }
      if (!imgOverlay) {
        imgOverlay = document.createElement('div');
        imgOverlay.className = 'doc-img-overlay';
        imgOverlay.contentEditable = 'false';
        const btn = (name, title, ic, fn, extra) => {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'doc-img-btn';
          b.title = title;
          b.setAttribute('aria-label', title);
          b.innerHTML = ic;
          if (extra) Object.assign(b.dataset, extra);
          b.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); });
          b.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (!selectedImg) return;
            fn(selectedImg);
          });
          return b;
        };
        const bar = document.createElement('div');
        bar.className = 'doc-img-bar';
        const sep = () => { const s = document.createElement('span'); s.className = 'doc-img-sep'; return s; };
        const doAlign = (mode) => (img2) => { setImageAlign(img2, mode); afterChange(); };
        bar.append(
          btn('left', 'In line, left', icon('alignLeft'), doAlign('left'), { imgAlign: 'left' }),
          btn('center', 'In line, centred', icon('alignCenter'), doAlign('center'), { imgAlign: 'center' }),
          btn('right', 'In line, right', icon('alignRight'), doAlign('right'), { imgAlign: 'right' }),
          sep(),
          btn('wl', 'Wrap text, picture on the left', DI.wrapLeft, doAlign('wrap-left'), { imgAlign: 'wrap-left' }),
          btn('wr', 'Wrap text, picture on the right', DI.wrapRight, doAlign('wrap-right'), { imgAlign: 'wrap-right' }),
          sep(),
          btn('alt', 'Alt text…', DI.altText, (im) => editAltText(im)),
          btn('reset', 'Reset size', DI.resetSize, (im) => { resetImageSize(im); afterChange(); }),
          btn('del', 'Delete picture', DI.trash, (im) => { hideImageOverlay(); im.remove(); afterChange(); })
        );
        const size = document.createElement('span');
        size.className = 'doc-img-size';
        imgOverlay.appendChild(bar);
        imgOverlay.appendChild(size);
        ['nw', 'ne', 'sw', 'se', 'e', 's'].forEach((h) => {
          const handle = document.createElement('span');
          handle.className = 'doc-img-handle h-' + h;
          handle.dataset.handle = h;
          handle.addEventListener('pointerdown', (e) => startImageResize(e, h));
          imgOverlay.appendChild(handle);
        });
      }
      positionImageOverlay();
    }

    function startImageResize(e, handle) {
      if (!selectedImg) return;
      e.preventDefault();
      e.stopPropagation();
      const img = selectedImg;
      const z = currentZoom();
      const r = img.getBoundingClientRect();
      const startW = r.width / z;
      const startH = r.height / z;
      const ratio = startH / (startW || 1);
      const maxW = contentWidthPx();
      const sx = e.clientX;
      const sy = e.clientY;
      const dirX = /w/.test(handle) ? -1 : 1;
      img.style.removeProperty('max-height');
      img.style.removeProperty('max-width');
      const move = (ev) => {
        const dx = (ev.clientX - sx) / z * dirX;
        const dy = (ev.clientY - sy) / z;
        let w = startW;
        let h = startH;
        if (handle === 's') h = Math.max(16, startH + dy);
        else if (handle === 'e') w = Math.max(16, Math.min(maxW, startW + dx));
        else {
          // Corners keep the proportions.
          w = Math.max(16, Math.min(maxW, startW + dx));
          h = w * ratio;
        }
        img.style.width = Math.round(w) + 'px';
        img.style.height = Math.round(h) + 'px';
        positionImageOverlay();
      };
      const up = () => {
        document.removeEventListener('pointermove', move, true);
        document.removeEventListener('pointerup', up, true);
        document.removeEventListener('pointercancel', up, true);
        afterChange();
      };
      document.addEventListener('pointermove', move, true);
      document.addEventListener('pointerup', up, true);
      document.addEventListener('pointercancel', up, true);
    }

    function onImagePointerDown(e) {
      const t = e.target;
      if (t && t.closest && t.closest('.doc-img-overlay')) return;
      if (t && t.tagName === 'IMG' && pagesRoot.contains(t) && viewMode !== 'read') {
        e.preventDefault();
        selectImage(t);
        return;
      }
      if (selectedImg) hideImageOverlay();
    }

    /* ---------- links ---------- */
    function normalizeUrl(raw) {
      const s = String(raw || '').trim();
      if (!s) return '';
      if (/^(https?:|mailto:|tel:)/i.test(s)) return s;
      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return 'mailto:' + s;
      if (/^[\w-]+(\.[\w-]+)+([/?#].*)?$/.test(s)) return 'https://' + s;
      return s;
    }

    function linkAtSelection() {
      const r = liveRange(lastRange);
      const el = r && (r.startContainer.nodeType === 1 ? r.startContainer : r.startContainer.parentElement);
      const a = el && el.closest('a[href]');
      return a && pagesRoot.contains(a) ? a : null;
    }

    async function insertLinkFromDialog() {
      saveSelection();
      const existing = linkAtSelection();
      const url = await ctx.inputModal(existing ? 'Edit link' : 'Insert link',
        'https://… — leave empty to remove the link', existing ? existing.getAttribute('href') : 'https://');
      if (url == null) return;
      restoreSelection();
      const href = normalizeUrl(url);
      if (existing && (!href || href === 'https://')) {
        batch(() => {
          const r = document.createRange();
          r.selectNodeContents(existing);
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(r);
          execRaw('unlink');
        });
        return;
      }
      if (!href || href === 'https://') return;
      if (existing) {
        existing.setAttribute('href', href);
        afterChange({ paginate: false });
        return;
      }
      const sel = window.getSelection();
      if (sel.rangeCount && sel.getRangeAt(0).collapsed) {
        insertHtmlAtCaret(`<a href="${escapeHtml(href)}">${escapeHtml(url.trim())}</a>&nbsp;`);
      } else {
        exec('createLink', href);
      }
    }

    function openLinkIfModified(e) {
      if (!(e.ctrlKey || e.metaKey)) return false;
      const a = e.target && e.target.closest && e.target.closest('a[href]');
      if (!a || !pagesRoot.contains(a)) return false;
      const href = a.getAttribute('href') || '';
      if (!/^(https?:|mailto:)/i.test(href)) return false;
      e.preventDefault();
      if (window.margo && window.margo.openExternal) window.margo.openExternal(href);
      return true;
    }

    /* ---------- inserts ---------- */
    const CALLOUTS = {
      note: 'Note',
      tip: 'Tip',
      warning: 'Important',
      quote: 'Key takeaway'
    };

    function insertCallout(type) {
      restoreSelection();
      insertHtmlAtCaret(
        `<div class="margo-callout margo-callout-${type}" data-callout-type="${type}">` +
        `<div class="margo-callout-title">${CALLOUTS[type] || 'Note'}</div><div><br></div></div><p><br></p>`
      );
    }

    function insertDate(format) {
      restoreSelection();
      const now = new Date();
      let str = now.toLocaleDateString();
      if (format === 'iso') str = now.toISOString().split('T')[0];
      else if (format === 'long') str = now.toLocaleDateString(undefined, { dateStyle: 'long' });
      else if (format === 'full') str = now.toLocaleDateString(undefined, { dateStyle: 'full' });
      else if (format === 'time') str = now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
      insertTextAtCaret(str);
    }

    function insertHorizontalRule() {
      insertHtmlAtCaret('<hr><p><br></p>');
    }

    /* ---------- Symbols Picker Modal ---------- */
    function openSymbolsPicker() {
      saveSelection();
      const wrap = document.createElement('div');
      wrap.className = 'doc-symbols-wrap';
      SYMBOL_CATEGORIES.forEach((cat) => {
        const title = document.createElement('div');
        title.className = 'doc-symbols-section-title';
        title.textContent = cat.title;
        wrap.appendChild(title);

        const grid = document.createElement('div');
        grid.className = 'doc-symbols-grid';
        cat.symbols.forEach((sym) => {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'doc-symbol-btn';
          btn.textContent = sym;
          btn.title = `Insert ${sym}`;
          /* Dismiss the modal through ctx so its promise resolves; the
             caret is put back from the saved selection before inserting. */
          btn.addEventListener('mousedown', (e) => e.preventDefault());
          btn.addEventListener('click', () => {
            ctx.closeModal(null);
            restoreSelection();
            insertTextAtCaret(sym);
          });
          grid.appendChild(btn);
        });
        wrap.appendChild(grid);
      });

      ctx.openModal('Insert Symbol', wrap, [{ label: 'Close', value: null }]);
    }

    /* ---------- Document Statistics Modal ---------- */
    function openStatsModal() {
      const pages = pageList();
      // The page bodies only: header and footer text ("Page 1 of 3") is not
      // part of what the author wrote.
      const fullText = pageBodies().map((b) => plainText(b)).join('\n');
      const words = (fullText.trim().match(/\S+/g) || []).length;
      const chars = fullText.replace(/\n/g, '').length;
      const charsNoSpace = fullText.replace(/\s+/g, '').length;
      const paragraphs = fullText.split(/\n+/).filter((p) => p.trim().length > 0).length;
      const readMin = Math.max(1, Math.ceil(words / 200));

      const wrap = document.createElement('div');
      wrap.innerHTML =
        `<div class="doc-stats-grid">` +
          `<div class="doc-stats-card"><span class="doc-stats-val">${pages.length}</span><span class="doc-stats-lbl">Pages</span></div>` +
          `<div class="doc-stats-card"><span class="doc-stats-val">${words.toLocaleString()}</span><span class="doc-stats-lbl">Words</span></div>` +
          `<div class="doc-stats-card"><span class="doc-stats-val">${chars.toLocaleString()}</span><span class="doc-stats-lbl">Characters (with spaces)</span></div>` +
          `<div class="doc-stats-card"><span class="doc-stats-val">${charsNoSpace.toLocaleString()}</span><span class="doc-stats-lbl">Characters (no spaces)</span></div>` +
          `<div class="doc-stats-card"><span class="doc-stats-val">${paragraphs.toLocaleString()}</span><span class="doc-stats-lbl">Paragraphs</span></div>` +
          `<div class="doc-stats-card"><span class="doc-stats-val">~${readMin} min</span><span class="doc-stats-lbl">Reading time</span></div>` +
        `</div>`;

      ctx.openModal('Word count', wrap, [{ label: 'OK', primary: true, value: true }]);
    }

    /* ---------- Outline Navigator Drawer ---------- */
    function docHeadings(levels) {
      if (!pagesRoot) return [];
      return Array.from(pagesRoot.querySelectorAll(levels || 'h1, h2, h3, h4'))
        .filter((h) => !h.closest('.margo-toc') && !h.closest('.doc-pages-preview') && pageBodyOf(h)
          && !(h.dataset && h.dataset.margoContinued === '1'));
    }

    function flashEl(el) {
      el.classList.add('doc-flash');
      setTimeout(() => el.classList.remove('doc-flash'), 1200);
    }

    function goToHeading(h) {
      const page = h.closest('.doc-page');
      if (page) setActivePage(page);
      h.scrollIntoView({ behavior: 'smooth', block: 'center' });
      placeCaretIn(h, true);
      flashEl(h);
    }

    function renderOutline() {
      if (!outlineRail) return;
      const list = outlineRail.querySelector('.doc-outline-list');
      list.innerHTML = '';
      if (!pagesRoot) return;
      const headings = docHeadings();
      if (!headings.length) {
        list.innerHTML = '<div class="doc-outline-empty">No headings yet. Use the Heading styles and your sections will show up here.</div>';
        return;
      }
      headings.forEach((h) => {
        const item = document.createElement('button');
        item.type = 'button';
        const tag = h.tagName.toLowerCase();
        item.className = `doc-outline-item ${tag}`;
        const title = (h.textContent || '').trim() || 'Untitled section';
        item.innerHTML = `<span class="doc-outline-text">${escapeHtml(title)}</span>`;
        item.title = title;
        item.addEventListener('click', () => goToHeading(h));
        list.appendChild(item);
      });
    }

    function toggleOutlineRail(force) {
      if (!outlineRail) return;
      const open = force != null ? force : outlineRail.classList.contains('hidden');
      outlineRail.classList.toggle('hidden', !open);
      if (open) renderOutline();
    }

    /* ---------- Focus Mode ---------- */
    function toggleFocusMode() {
      const isFocus = document.body.classList.toggle('margo-focus-mode');
      let exitBtn = document.querySelector('.doc-focus-exit');
      if (isFocus) {
        if (!exitBtn) {
          exitBtn = document.createElement('button');
          exitBtn.className = 'doc-focus-exit';
          exitBtn.textContent = 'Exit focus mode (Esc)';
          exitBtn.addEventListener('click', toggleFocusMode);
          document.body.appendChild(exitBtn);
        }
      } else if (exitBtn) {
        exitBtn.remove();
      }
    }

    /* ---------- table of contents ----------
       Built from Heading 1-3 with the page each heading is on, drawn with a
       dotted leader to the number, and exported to Word as right-aligned
       dot-leader tab stops. Update refreshes titles and page numbers. */
    function tocEntriesHtml() {
      const heads = docHeadings('h1, h2, h3');
      const pages = pageList();
      return heads.map((h) => {
        const level = +h.tagName.slice(1);
        const page = pages.indexOf(h.closest('.doc-page')) + 1;
        const text = (h.textContent || '').trim() || 'Untitled';
        return `<p class="margo-toc-entry margo-toc-l${level}"><span class="margo-toc-text">${escapeHtml(text)}</span><span class="margo-toc-page">${page}</span></p>`;
      }).join('');
    }

    function fillToc(toc) {
      toc.innerHTML = '<p class="margo-toc-title">Contents</p>' + (tocEntriesHtml() || '<p class="margo-toc-empty">Add Heading 1–3 paragraphs, then update the table.</p>');
      toc.contentEditable = 'false';
    }

    function insertToc() {
      if (!docHeadings('h1, h2, h3').length) {
        ctx.toast('Add some headings (Heading 1–3) first — the table of contents is built from them');
        return;
      }
      const existing = pagesRoot.querySelector('.margo-toc');
      if (existing) { updateToc(); return; }
      insertHtmlAtCaret('<div class="margo-toc"></div><p><br></p>');
      updateToc(true);
    }

    function updateToc(quiet) {
      const tocs = pagesRoot ? Array.from(pagesRoot.querySelectorAll('.margo-toc')) : [];
      if (!tocs.length) { if (!quiet) ctx.toast('There is no table of contents in this document yet'); return; }
      batch(() => {
        // Fill once, let the pages settle around it, then number from the
        // final layout: the table itself can push headings onto later pages.
        tocs.forEach(fillToc);
        cancelPaginate();
        repaginate(pageList()[0]);
        tocs.forEach((t) => { if (t.isConnected) fillToc(t); });
      });
      if (!quiet) ctx.toast('Table of contents updated');
    }

    function onTocClick(e) {
      const entry = e.target.closest && e.target.closest('.margo-toc-entry');
      if (!entry || !pagesRoot.contains(entry)) return false;
      const toc = entry.closest('.margo-toc');
      const idx = Array.from(toc.querySelectorAll('.margo-toc-entry')).indexOf(entry);
      const text = (entry.querySelector('.margo-toc-text') || entry).textContent.trim();
      const heads = docHeadings('h1, h2, h3');
      const target = (heads[idx] && heads[idx].textContent.trim() === text) ? heads[idx]
        : heads.find((h) => h.textContent.trim() === text);
      if (target) { e.preventDefault(); goToHeading(target); }
      return true;
    }

    /* ---------- footnotes ----------
       A reference is a numbered superscript in the text; the notes are kept
       in order in a Footnotes block at the end of the document, and saved
       to Word as real footnotes that Word prints at the foot of the page. */
    function footnotesBlock(create) {
      if (!pagesRoot) return null;
      let block = pagesRoot.querySelector('.margo-footnotes');
      if (!block && create) {
        const bodies = pageBodies();
        const last = bodies[bodies.length - 1];
        block = document.createElement('div');
        block.className = 'margo-footnotes';
        block.innerHTML = '<ol></ol>';
        last.appendChild(block);
        block.contentEditable = 'false';
      }
      return block;
    }

    function renumberFootnotes() {
      if (!pagesRoot) return;
      const refs = Array.from(pagesRoot.querySelectorAll('sup.margo-fn-ref')).filter((s) => pageBodyOf(s) && !s.closest('.margo-footnotes'));
      let block = footnotesBlock(false);
      if (!refs.length) {
        if (block) block.remove();
        return;
      }
      block = footnotesBlock(true);
      let ol = block.querySelector('ol');
      if (!ol) { ol = document.createElement('ol'); block.appendChild(ol); }
      const notes = new Map(Array.from(ol.children).map((li) => [li.getAttribute('data-fn'), li]));
      const used = new Set();
      refs.forEach((ref, i) => {
        let id = ref.getAttribute('data-fn');
        if (!id || used.has(id)) { id = 'fn' + uid(); ref.setAttribute('data-fn', id); }
        used.add(id);
        if (ref.textContent !== String(i + 1)) ref.textContent = String(i + 1);
        ref.contentEditable = 'false';
        let li = notes.get(id);
        if (!li) {
          li = document.createElement('li');
          li.setAttribute('data-fn', id);
          li.innerHTML = '<br>';
        }
        li.contentEditable = 'true';
        if (ol.children[i] !== li) ol.insertBefore(li, ol.children[i] || null);
      });
      Array.from(ol.children).forEach((li) => { if (!used.has(li.getAttribute('data-fn'))) li.remove(); });
      // The notes stay at the very end of the document.
      const bodies = pageBodies();
      const last = bodies[bodies.length - 1];
      if (last && (block.parentElement !== last || block !== last.lastElementChild)) last.appendChild(block);
    }

    function insertFootnote() {
      const r = ensureSelection();
      if (!r) return;
      const body = pageBodyOf(r.startContainer);
      if (!body || (r.startContainer.nodeType === 1 ? r.startContainer : r.startContainer.parentElement).closest('.margo-footnotes, .margo-toc')) {
        ctx.toast('Put the cursor in the text where the footnote belongs');
        return;
      }
      if (!r.collapsed) r.collapse(false);
      const id = 'fn' + uid();
      batch(() => {
        skipInputRecord = true;
        try { execRaw('insertHTML', `<sup class="margo-fn-ref" data-fn="${id}">0</sup>&#8203;`); }
        finally { skipInputRecord = false; }
        renumberFootnotes();
      });
      const li = pagesRoot.querySelector(`.margo-footnotes li[data-fn="${cssEscape(id)}"]`);
      if (li) {
        repaginate(pageList()[0]);
        li.scrollIntoView({ behavior: 'smooth', block: 'center' });
        placeCaretIn(li, true);
      }
    }

    function onFootnoteRefClick(e) {
      const ref = e.target.closest && e.target.closest('sup.margo-fn-ref');
      if (ref && pagesRoot.contains(ref)) {
        const li = pagesRoot.querySelector(`.margo-footnotes li[data-fn="${cssEscape(ref.getAttribute('data-fn') || '')}"]`);
        if (li) {
          e.preventDefault();
          li.scrollIntoView({ behavior: 'smooth', block: 'center' });
          placeCaretIn(li, true);
          flashEl(li);
        }
        return true;
      }
      return false;
    }

    /* ---------- header & footer ---------- */
    function openHeaderFooterEditor(anchor, focusField) {
      const before = { headerText: layout.headerText || '', footerText: layout.footerText || '', showPageNumbers: !!layout.showPageNumbers };
      const target = anchor && anchor.isConnected ? anchor : (ribbonTabs.insert || ctx.toolbar);
      openPopover(target, (pop, close) => {
        pop.classList.add('doc-hf-pop');
        pop.innerHTML =
          `<div class="doc-pop-title">Header &amp; footer</div>` +
          `<label class="doc-field"><span>Header</span><input type="text" class="doc-input" data-f="headerText" placeholder="Text at the top of every page"></label>` +
          `<label class="doc-field"><span>Footer</span><input type="text" class="doc-input" data-f="footerText" placeholder="Text at the bottom of every page"></label>` +
          `<label class="doc-check"><input type="checkbox" data-f="showPageNumbers"><span>Page numbers <em>Page 1 of N, bottom right</em></span></label>` +
          `<div class="doc-pop-actions"><button type="button" class="btn ghost" data-act="clear">Remove all</button><button type="button" class="btn primary" data-act="done">Done</button></div>`;
        const h = pop.querySelector('[data-f="headerText"]');
        const f = pop.querySelector('[data-f="footerText"]');
        const n = pop.querySelector('[data-f="showPageNumbers"]');
        h.value = before.headerText;
        f.value = before.footerText;
        n.checked = before.showPageNumbers;
        const live = () => {
          layout.headerText = h.value.trim();
          layout.footerText = f.value.trim();
          layout.showPageNumbers = n.checked;
          updatePageHeadersAndFooters();
        };
        [h, f].forEach((inp) => {
          inp.addEventListener('input', live);
          inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); close(); } });
        });
        n.addEventListener('change', live);
        pop.querySelector('[data-act="clear"]').addEventListener('click', () => {
          h.value = ''; f.value = ''; n.checked = false; live(); close();
        });
        pop.querySelector('[data-act="done"]').addEventListener('click', () => close());
        setTimeout(() => { const el = focusField === 'footer' ? f : h; el.focus(); el.select(); }, 20);
      }, {
        onClose: () => {
          const changed = before.headerText !== (layout.headerText || '') || before.footerText !== (layout.footerText || '')
            || before.showPageNumbers !== !!layout.showPageNumbers;
          if (changed) { ctx.markDirty(); recordNow(); }
          ensureSelection();
        }
      });
    }

    function togglePageNumbers() {
      setLayout({ showPageNumbers: !layout.showPageNumbers });
      ctx.toast(layout.showPageNumbers ? 'Page numbers on' : 'Page numbers off');
    }

    async function customMargins() {
      const m = marginInches();
      const wrap = document.createElement('div');
      wrap.className = 'doc-margins-form';
      wrap.innerHTML = ['Top', 'Bottom', 'Left', 'Right'].map((k) => {
        const key = k[0].toLowerCase();
        return `<label class="doc-field"><span>${k} (in)</span><input type="number" class="doc-input" step="0.05" min="0" max="4" data-m="${key}" value="${m[key]}"></label>`;
      }).join('');
      const ok = await ctx.openModal('Custom margins', wrap, [
        { label: 'Cancel', value: null },
        { label: 'Apply', primary: true, value: true }
      ]);
      if (!ok) return;
      const v = (k) => Math.max(0, Math.min(4, parseFloat(wrap.querySelector(`[data-m="${k}"]`).value) || 0));
      const next = { top: v('t'), right: v('r'), bottom: v('b'), left: v('l') };
      const page = pageInches();
      if (next.left + next.right > page.w - 1 || next.top + next.bottom > page.h - 1) {
        ctx.toast('Those margins leave no room for text', 'error');
        return;
      }
      const preset = Object.keys(MARGIN_PRESETS).find((k) => {
        const p = MARGIN_PRESETS[k];
        return p.t === next.top && p.r === next.right && p.b === next.bottom && p.l === next.left;
      });
      if (preset) setLayout({ margins: preset, marginIn: null, marginTw: null });
      else setLayout({ margins: 'custom', marginIn: next, marginTw: null });
    }
    async function extractDocumentImages() {
      if (!pagesRoot) return [];
      const found = [];
      const pages = pageList();
      for (let pIdx = 0; pIdx < pages.length; pIdx++) {
        const page = pages[pIdx];
        const imgs = Array.from(page.querySelectorAll('img'));
        for (let i = 0; i < imgs.length; i++) {
          const img = imgs[i];
          const src = img.getAttribute('src') || '';
          if (!src) continue;
          let dataUrl = src;
          let w = img.naturalWidth || img.width || 0;
          let h = img.naturalHeight || img.height || 0;
          if (!src.startsWith('data:image/')) {
            try {
              const c = document.createElement('canvas');
              c.width = w || 300;
              c.height = h || 200;
              const cx = c.getContext('2d');
              cx.drawImage(img, 0, 0);
              dataUrl = c.toDataURL('image/png');
            } catch {}
          }
          found.push({
            src,
            dataUrl,
            w: w || 300,
            h: h || 200,
            page: pIdx + 1,
            alt: img.alt || `image-${found.length + 1}`
          });
        }
      }
      return found;
    }

    async function showDocumentImagesPanel() {
      const images = await extractDocumentImages();
      if (!images.length) {
        ctx.toast('No embedded images found in this document');
        return;
      }

      const wrap = document.createElement('div');
      wrap.className = 'doc-images';

      const topbar = document.createElement('div');
      topbar.className = 'doc-images-topbar';
      const summary = document.createElement('span');
      summary.className = 'doc-images-summary';
      summary.textContent = `Found ${images.length} image${images.length === 1 ? '' : 's'} across pages`;

      const exportAllBtn = document.createElement('button');
      exportAllBtn.className = 'btn ghost';
      exportAllBtn.textContent = 'Export all to folder…';
      exportAllBtn.addEventListener('click', async () => {
        const res = await window.margo.exportImagesFolder({
          images: images.map((im, idx) => ({
            dataUrl: im.dataUrl,
            name: `doc-image-${idx + 1}.png`
          }))
        });
        if (res && res.ok) {
          ctx.toast(`Exported ${res.count} images to folder`);
        } else if (res && !res.canceled) {
          ctx.toast(res.error || 'Export failed', 'error');
        }
      });

      topbar.appendChild(summary);
      topbar.appendChild(exportAllBtn);
      wrap.appendChild(topbar);

      const grid = document.createElement('div');
      grid.className = 'doc-images-grid';

      images.forEach((im, idx) => {
        const item = document.createElement('div');
        item.className = 'doc-image-item';

        const preview = document.createElement('div');
        preview.className = 'doc-image-preview';
        const imgTag = document.createElement('img');
        imgTag.src = im.dataUrl;
        imgTag.alt = im.alt || `Image ${idx + 1}`;
        preview.appendChild(imgTag);

        const meta = document.createElement('div');
        meta.className = 'doc-image-meta';
        meta.textContent = `${im.w} × ${im.h} · Page ${im.page}`;

        const row = document.createElement('div');
        row.className = 'doc-image-actions';

        const copyBtn = document.createElement('button');
        copyBtn.className = 'btn ghost';
        copyBtn.textContent = 'Copy';
        copyBtn.addEventListener('click', () => {
          fetch(im.dataUrl)
            .then((res) => res.blob())
            .then(async (blob) => {
              try {
                await navigator.clipboard.write([new ClipboardItem({ [blob.type || 'image/png']: blob })]);
                ctx.toast(`Copied ${im.w} × ${im.h} image`);
              } catch {
                ctx.toast('Copy failed', 'error');
              }
            })
            .catch(() => ctx.toast('Copy failed', 'error'));
        });

        const saveBtn = document.createElement('button');
        saveBtn.className = 'btn ghost';
        saveBtn.textContent = 'Save…';
        saveBtn.addEventListener('click', async () => {
          const res = await window.margo.saveImage({
            dataUrl: im.dataUrl,
            suggestedName: `doc-image-${idx + 1}.png`
          });
          if (res && res.ok) ctx.toast('Image saved');
        });

        row.appendChild(copyBtn);
        row.appendChild(saveBtn);
        item.appendChild(preview);
        item.appendChild(meta);
        item.appendChild(row);
        grid.appendChild(item);
      });

      wrap.appendChild(grid);

      ctx.openModal('Images in this document', wrap, [
        { label: 'Close', primary: true, value: null }
      ], { wide: true });
    }

    function cancelPaginate() {
      if (paginateTimer) { clearTimeout(paginateTimer); paginateTimer = 0; }
    }

    /* ---------- find & replace ----------
       Matches are found in the text of each paragraph as a whole, so a word
       that runs across formatting ("Mar<b>go</b>") is still found, with
       match case, whole word and regular expression options. A match that
       spans several text runs is highlighted as several marks that belong
       to one hit. */
    function unwrapFindMarks() {
      if (!pagesRoot) return;
      const parents = new Set();
      pagesRoot.querySelectorAll('mark.margo-find-hit').forEach((m) => {
        const parent = m.parentNode;
        if (!parent) return;
        while (m.firstChild) parent.insertBefore(m.firstChild, m);
        m.remove();
        parents.add(parent);
      });
      parents.forEach((p) => { if (p.isConnected) p.normalize(); });
      findHits = [];
      findIndex = -1;
    }

    function updateFindCount() {
      if (!findCountEl) return;
      if (findBar) findBar.classList.remove('has-error');
      if (!findHits.length) findCountEl.textContent = findInput && findInput.value ? 'No results' : '';
      else findCountEl.textContent = `${findIndex + 1} / ${findHits.length}`;
      if (findBar) {
        const none = !findHits.length;
        findBar.querySelectorAll('.doc-find-prev, .doc-find-next, .doc-replace-btn, .doc-replace-all-btn').forEach((b) => { b.disabled = none; });
      }
    }

    function isFindFieldFocused() {
      const el = document.activeElement;
      return !!el && (el === findInput || el === replaceInput);
    }

    function withFindFocusPreserved(fn) {
      const el = document.activeElement;
      const keep = el === findInput || el === replaceInput;
      const start = keep ? el.selectionStart : 0;
      const end = keep ? el.selectionEnd : 0;
      fn();
      if (keep && el && el.isConnected) {
        el.focus();
        try { el.setSelectionRange(start, end); } catch {}
      }
    }

    function highlightFindCurrent(scroll) {
      findHits.forEach((hit, i) => hit.marks.forEach((m) => m.classList.toggle('margo-find-current', i === findIndex)));
      const cur = findHits[findIndex];
      if (cur && cur.marks[0] && scroll !== false) {
        const page = cur.marks[0].closest('.doc-page');
        if (page) setActivePage(page);
        cur.marks[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      updateFindCount();
    }

    function buildFindRegex(query) {
      if (!query) return null;
      let src = findOpts.regex ? query : escapeRegExp(query);
      if (findOpts.wholeWord) src = '(?<![\\p{L}\\p{N}_])(?:' + src + ')(?![\\p{L}\\p{N}_])';
      try {
        return new RegExp(src, 'gu' + (findOpts.matchCase ? '' : 'i'));
      } catch {
        return undefined;
      }
    }

    /* Text nodes grouped by the paragraph they belong to. */
    function findGroups() {
      const groups = [];
      let current = null;
      let currentBlock = null;
      pageBodies().forEach((body) => {
        const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT, {
          acceptNode(node) {
            if (!node.nodeValue) return NodeFilter.FILTER_REJECT;
            const p = node.parentElement;
            if (p && p.closest('.doc-img-overlay')) return NodeFilter.FILTER_REJECT;
            return NodeFilter.FILTER_ACCEPT;
          }
        });
        let n;
        while ((n = walker.nextNode())) {
          const block = closestBlock(n, body) || body;
          if (block !== currentBlock || !current) {
            current = { nodes: [], text: '' };
            groups.push(current);
            currentBlock = block;
          }
          current.nodes.push({ node: n, start: current.text.length });
          current.text += n.nodeValue;
        }
        currentBlock = null;
      });
      return groups;
    }

    function runFind(query, keepIndex) {
      withFindFocusPreserved(() => {
        findHighlighting = true;
        const prevIndex = findIndex;
        try {
          unwrapFindMarks();
          const q = query || '';
          if (!q || !pagesRoot) { updateFindCount(); return; }
          const re = buildFindRegex(q);
          if (re === undefined) {
            updateFindCount();
            if (findCountEl) findCountEl.textContent = 'Invalid pattern';
            if (findBar) findBar.classList.add('has-error');
            return;
          }
          const matches = [];
          findGroups().forEach((g) => {
            re.lastIndex = 0;
            let m;
            let guard = 0;
            while ((m = re.exec(g.text)) && guard++ < 5000) {
              if (!m[0].length) { re.lastIndex++; continue; }
              matches.push({ g, start: m.index, end: m.index + m[0].length, text: m[0] });
              if (matches.length > 5000) break;
            }
          });
          // Wrap from the last match backwards so earlier offsets stay valid.
          const hits = [];
          for (let i = matches.length - 1; i >= 0; i--) {
            const mt = matches[i];
            const marks = [];
            for (let k = mt.g.nodes.length - 1; k >= 0; k--) {
              const seg = mt.g.nodes[k];
              const node = seg.node;
              const segStart = seg.start;
              const segEnd = seg.start + node.nodeValue.length;
              const a = Math.max(mt.start, segStart);
              const b = Math.min(mt.end, segEnd);
              if (b <= a) continue;
              let target = node;
              if (b - segStart < target.nodeValue.length) target.splitText(b - segStart);
              if (a - segStart > 0) {
                target = target.splitText(a - segStart);
                // The head keeps the original node; later matches in this
                // group (earlier offsets) still address it correctly.
              }
              const mark = document.createElement('mark');
              mark.className = 'margo-find-hit';
              target.parentNode.insertBefore(mark, target);
              mark.appendChild(target);
              marks.unshift(mark);
            }
            if (marks.length) hits.unshift({ marks, text: mt.text });
          }
          findHits = hits;
          if (!hits.length) findIndex = -1;
          else if (keepIndex && prevIndex >= 0) findIndex = Math.min(prevIndex, hits.length - 1);
          else {
            // Start from the first match at or after the caret.
            findIndex = 0;
            const r = liveRange(lastRange);
            if (r) {
              const idx = hits.findIndex((h) => {
                try { return r.comparePoint(h.marks[0], 0) >= 0; } catch { return false; }
              });
              if (idx >= 0) findIndex = idx;
            }
          }
          highlightFindCurrent(!keepIndex);
        } finally {
          findHighlighting = false;
        }
      });
    }

    function findNext(dir) {
      if (!findHits.length) return;
      withFindFocusPreserved(() => {
        findIndex = (findIndex + dir + findHits.length) % findHits.length;
        highlightFindCurrent();
      });
    }

    function replacementFor(hit) {
      const repl = replaceInput ? replaceInput.value : '';
      if (!findOpts.regex) return repl;
      const re = buildFindRegex(findInput.value);
      if (!re) return repl;
      re.lastIndex = 0;
      return hit.text.replace(new RegExp(re.source, re.flags.replace('g', '')), repl);
    }

    /* The replaced match is taken out of the list and every other match
       stays where it was, so the position moves on to the next one instead
       of jumping back to the top, and a replacement that contains the
       search text is not found again straight away. */
    function replaceHit(hit) {
      const text = replacementFor(hit);
      const [first, ...rest] = hit.marks;
      const parent = first.parentNode;
      first.replaceWith(document.createTextNode(text));
      rest.forEach((m) => m.remove());
      if (parent) parent.normalize();
    }

    function replaceCurrent() {
      if (findIndex < 0 || !findHits[findIndex]) return;
      replaceHit(findHits[findIndex]);
      findHits.splice(findIndex, 1);
      if (!findHits.length) findIndex = -1;
      else if (findIndex >= findHits.length) findIndex = 0;
      afterChange();
      withFindFocusPreserved(() => highlightFindCurrent());
    }

    function replaceAll() {
      if (!findHits.length || !findInput.value) return;
      const n = findHits.length;
      findHighlighting = true;
      try {
        findHits.slice().reverse().forEach(replaceHit);
      } finally {
        findHighlighting = false;
      }
      findHits = [];
      findIndex = -1;
      afterChange();
      runFind(findInput.value);
      ctx.toast(`Replaced ${n} match${n === 1 ? '' : 'es'}`);
    }

    function closeFind() {
      findOpen = false;
      if (findBar) findBar.classList.add('hidden');
      unwrapFindMarks();
      updateFindCount();
      ensureSelection();
    }

    function openFind(withReplace) {
      if (!findBar) return;
      findOpen = true;
      findBar.classList.remove('hidden');
      findBar.classList.toggle('show-replace', !!withReplace || findBar.classList.contains('show-replace'));
      // Seed the field with a short selection, as every editor does.
      const r = liveRange(lastRange);
      const picked = r && !r.collapsed ? r.toString() : '';
      if (picked && picked.length < 80 && !/\n/.test(picked)) findInput.value = picked;
      setTimeout(() => {
        const target = withReplace && findInput.value ? replaceInput : findInput;
        if (target) { target.focus(); target.select(); }
      }, 30);
      if (findInput && findInput.value) runFind(findInput.value);
    }

    function ensureFindBar() {
      if (!hostEl || findBar) return;
      findBar = document.createElement('div');
      findBar.className = 'doc-find-bar hidden';
      findBar.setAttribute('role', 'search');
      const toggle = (key, title, ic) =>
        `<button type="button" class="doc-find-opt" data-opt="${key}" title="${title}" aria-pressed="false">${ic}</button>`;
      findBar.innerHTML =
        `<div class="doc-find-row">` +
          `<button type="button" class="doc-find-expand" title="Toggle replace (Ctrl+H)" aria-label="Toggle replace">${DI.chevron}</button>` +
          `<div class="doc-find-field">` +
            `<input type="search" class="doc-find-input" placeholder="Find" aria-label="Find" spellcheck="false">` +
            toggle('matchCase', 'Match case', DI.matchCase) +
            toggle('wholeWord', 'Whole word', DI.wholeWord) +
            toggle('regex', 'Regular expression', DI.regex) +
          `</div>` +
          `<span class="doc-find-count" aria-live="polite"></span>` +
          `<button type="button" class="icon-btn doc-find-prev" title="Previous match (Shift+Enter)" aria-label="Previous match">${DI.chevronUp}</button>` +
          `<button type="button" class="icon-btn doc-find-next" title="Next match (Enter)" aria-label="Next match">${DI.chevron}</button>` +
          `<button type="button" class="icon-btn doc-find-close" title="Close (Esc)" aria-label="Close find">${DI.close}</button>` +
        `</div>` +
        `<div class="doc-find-row doc-replace-row">` +
          `<div class="doc-find-field"><input type="text" class="doc-find-input doc-replace-input" placeholder="Replace" aria-label="Replace" spellcheck="false"></div>` +
          `<button type="button" class="btn ghost doc-replace-btn" title="Replace this match">Replace</button>` +
          `<button type="button" class="btn ghost doc-replace-all-btn" title="Replace every match">Replace all</button>` +
        `</div>`;
      hostEl.appendChild(findBar);
      findInput = findBar.querySelector('.doc-find-input');
      replaceInput = findBar.querySelector('.doc-replace-input');
      findCountEl = findBar.querySelector('.doc-find-count');
      findBar.querySelectorAll('button').forEach((b) => {
        if (!b.classList.contains('doc-find-opt')) b.addEventListener('mousedown', (e) => e.preventDefault());
      });
      findBar.querySelector('.doc-find-prev').addEventListener('click', () => findNext(-1));
      findBar.querySelector('.doc-find-next').addEventListener('click', () => findNext(1));
      findBar.querySelector('.doc-find-close').addEventListener('click', closeFind);
      findBar.querySelector('.doc-replace-btn').addEventListener('click', replaceCurrent);
      findBar.querySelector('.doc-replace-all-btn').addEventListener('click', replaceAll);
      findBar.querySelector('.doc-find-expand').addEventListener('click', () => {
        findBar.classList.toggle('show-replace');
      });
      findBar.querySelectorAll('.doc-find-opt').forEach((b) => {
        b.addEventListener('mousedown', (e) => e.preventDefault());
        b.addEventListener('click', () => {
          findOpts[b.dataset.opt] = !findOpts[b.dataset.opt];
          b.classList.toggle('active', findOpts[b.dataset.opt]);
          b.setAttribute('aria-pressed', String(findOpts[b.dataset.opt]));
          runFind(findInput.value);
        });
      });
      findInput.addEventListener('input', () => runFind(findInput.value));
      const keys = (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          if (e.target === replaceInput) {
            if (e.ctrlKey || e.metaKey) replaceAll(); else replaceCurrent();
          } else findNext(e.shiftKey ? -1 : 1);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          closeFind();
        }
      };
      findInput.addEventListener('keydown', keys);
      replaceInput.addEventListener('keydown', keys);
    }

    /* ---------- fonts ---------- */
    function fillFontSelect(list) {
      availableFonts = list;
      FONTS.fillFamilySelect(familySelect, list);
      fillVariantSelect(familySelect ? familySelect.value : '');
    }

    async function loadSystemFonts() {
      const catalog = await FONTS.loadSystemFonts();
      if (destroyed) return;
      fontFacesByFamily = catalog.facesByFamily;
      fillFontSelect(catalog.families);
      refreshStates();
    }

    /* ---------- sticky comments ---------- */
    function openCommentsCount() {
      return comments.filter((n) => !n.done).length;
    }

    function updateCommentsBadge() {
      if (!commentsBadge || !commentsFab) return;
      const n = openCommentsCount();
      commentsBadge.textContent = String(n);
      commentsBadge.classList.toggle('hidden', n === 0);
      commentsFab.classList.toggle('has-comments', comments.length > 0);
    }

    function findAnchors(id) {
      if (!pagesRoot) return [];
      return Array.from(pagesRoot.querySelectorAll(`[data-margo-note-id="${cssEscape(id)}"]`))
        .filter((el) => pageBodyOf(el));
    }

    function findAnchor(id) {
      return findAnchors(id)[0] || null;
    }

    function wrapFirstQuoteMatch(id, quote) {
      const q = (quote || '').trim();
      if (!q || !pagesRoot || findAnchor(id)) return false;
      const lower = q.toLowerCase();
      for (const g of findGroups()) {
        const idx = g.text.toLowerCase().indexOf(lower);
        if (idx === -1) continue;
        const r = document.createRange();
        let startSet = false;
        for (const seg of g.nodes) {
          const len = seg.node.nodeValue.length;
          if (!startSet && idx < seg.start + len) { r.setStart(seg.node, idx - seg.start); startSet = true; }
          if (startSet && idx + q.length <= seg.start + len) { r.setEnd(seg.node, idx + q.length - seg.start); break; }
        }
        if (!startSet) continue;
        wrapRange(r, () => {
          const span = document.createElement('span');
          span.className = 'margo-note-anchor';
          span.setAttribute('data-margo-note-id', id);
          return span;
        });
        window.getSelection().removeAllRanges();
        return true;
      }
      return false;
    }

    function rehydrateCommentAnchors() {
      comments.forEach((comment) => {
        if (!findAnchor(comment.id)) wrapFirstQuoteMatch(comment.id, comment.quote);
      });
      applyCommentAnchorStates();
    }

    /* A resolved comment should stop marking up the page. The state is read
       back off the records rather than stored on the anchor, so a document
       that arrives with its comments already resolved draws correctly on the
       first paint instead of after the first tick. */
    function applyCommentAnchorStates() {
      if (!pagesRoot) return;
      comments.forEach((comment) => {
        findAnchors(comment.id).forEach((el) => el.classList.toggle('is-resolved', !!comment.done));
      });
    }

    function flashAnchor(el) {
      if (!el) return;
      el.classList.add('margo-note-flash');
      setTimeout(() => el.classList.remove('margo-note-flash'), 1200);
    }

    function scrollToComment(id) {
      const el = findAnchor(id);
      if (!el) {
        ctx.toast('Comment anchor missing — text may have been deleted');
        return false;
      }
      const page = el.closest('.doc-page');
      if (page) setActivePage(page);
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      findAnchors(id).forEach(flashAnchor);
      return true;
    }

    function relTime(iso) {
      if (!iso) return '';
      const t = new Date(iso).getTime();
      if (!t) return '';
      const s = Math.round((Date.now() - t) / 1000);
      if (s < 60) return 'just now';
      if (s < 3600) return Math.floor(s / 60) + ' min ago';
      if (s < 86400) return Math.floor(s / 3600) + ' h ago';
      return new Date(t).toLocaleDateString();
    }

    function removeComment(comment) {
      findAnchors(comment.id).forEach((anchor) => {
        const parent = anchor.parentNode;
        unwrapEl(anchor);
        if (parent) parent.normalize();
      });
      comments = comments.filter((n) => n.id !== comment.id);
      ctx.markDirty();
      updateCommentsBadge();
      renderCommentsRail();
      recordNow();
    }

    function renderCommentsRail() {
      if (!commentsRail) return;
      const list = commentsRail.querySelector('.doc-comments-list');
      list.innerHTML = '';
      const count = commentsRail.querySelector('.doc-comments-count');
      if (count) count.textContent = comments.length ? String(openCommentsCount()) + ' open' : '';
      if (!comments.length) {
        list.innerHTML = '<div class="doc-comments-empty">No comments yet. Select some text and choose Add comment (Ctrl+Alt+M).</div>';
        return;
      }
      comments.forEach((comment) => {
        const card = document.createElement('div');
        card.className = 'doc-comment-card' + (comment.done ? ' done' : '') + (!findAnchor(comment.id) ? ' orphan' : '');
        card.dataset.commentId = comment.id;
        card.tabIndex = 0;
        const quote = (comment.quote || '').slice(0, 80);
        card.innerHTML =
          `<div class="doc-comment-quote">${escapeHtml(quote)}${(comment.quote || '').length > 80 ? '…' : ''}</div>` +
          `<div class="doc-comment-body">${escapeHtml(comment.body || '')}</div>` +
          `<div class="doc-comment-actions">` +
            `<label class="doc-comment-done"><input type="checkbox" ${comment.done ? 'checked' : ''}> Resolved</label>` +
            `<span class="doc-comment-time">${escapeHtml(relTime(comment.createdAt))}</span>` +
            `<button type="button" class="doc-comment-edit" title="Edit comment">Edit</button>` +
            `<button type="button" class="doc-comment-delete" title="Delete comment">Delete</button>` +
          `</div>`;
        card.addEventListener('click', (e) => {
          if (e.target.closest('input') || e.target.closest('button') || e.target.closest('label')) return;
          scrollToComment(comment.id);
        });
        card.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target === card) scrollToComment(comment.id); });
        card.querySelector('input').addEventListener('change', (e) => {
          comment.done = !!e.target.checked;
          card.classList.toggle('done', comment.done);
          applyCommentAnchorStates();
          ctx.markDirty();
          updateCommentsBadge();
          const c = commentsRail.querySelector('.doc-comments-count');
          if (c) c.textContent = String(openCommentsCount()) + ' open';
          recordNow();
        });
        card.querySelector('.doc-comment-edit').addEventListener('click', async (e) => {
          e.stopPropagation();
          const next = await ctx.inputModal('Edit comment', 'Write your comment…', comment.body || '');
          if (next == null || !String(next).trim()) return;
          comment.body = String(next).trim();
          ctx.markDirty();
          renderCommentsRail();
          recordNow();
        });
        card.querySelector('.doc-comment-delete').addEventListener('click', (e) => {
          e.stopPropagation();
          removeComment(comment);
        });
        list.appendChild(card);
      });
    }

    function toggleCommentsRail(force) {
      if (!commentsRail) return;
      const open = force != null ? force : commentsRail.classList.contains('hidden');
      commentsRail.classList.toggle('hidden', !open);
      if (hostEl) hostEl.classList.toggle('doc-comments-open', open);
      if (open) renderCommentsRail();
    }

    function wrapSelectionWithComment(id) {
      const sel = window.getSelection();
      if (!sel.rangeCount || sel.isCollapsed) return null;
      const range = sel.getRangeAt(0);
      if (!pageBodyOf(range.commonAncestorContainer) && !pageBodyOf(range.startContainer)) return null;
      const quote = range.toString();
      if (!quote.trim()) return null;
      const made = wrapRange(range, () => {
        const span = document.createElement('span');
        span.className = 'margo-note-anchor';
        span.setAttribute('data-margo-note-id', id);
        return span;
      });
      return made.length ? quote : null;
    }

    async function addComment() {
      saveSelection();
      const r = liveRange(savedRange);
      if (!r || r.collapsed || !r.toString().trim()) {
        ctx.toast('Select some text first');
        return;
      }
      const body = await ctx.inputModal('Add comment', 'Write your comment…', '');
      if (body == null || !String(body).trim()) return;
      restoreSelection();
      const id = uid();
      const quote = wrapSelectionWithComment(id);
      if (!quote) {
        ctx.toast('Could not attach a comment to that selection');
        return;
      }
      comments.push({
        id,
        quote: quote.trim(),
        body: String(body).trim(),
        done: false,
        createdAt: new Date().toISOString()
      });
      ctx.markDirty();
      updateCommentsBadge();
      toggleCommentsRail(true);
      renderCommentsRail();
      scrollToComment(id);
      recordNow();
    }

    /* ---------- popovers & menus ----------
       One floating layer at a time, placed under its button and kept on
       screen, dismissed by a click outside, Escape, or the window moving
       under it. Menus are keyboard-navigable. */
    let openPop = null;

    function closePopover() {
      if (openPop) openPop.close();
    }

    function placePopover(pop, anchor) {
      const r = anchor.getBoundingClientRect();
      const margin = 8;
      pop.style.left = '0px';
      pop.style.top = '0px';
      const w = pop.offsetWidth;
      const h = pop.offsetHeight;
      let left = r.left;
      let top = r.bottom + 6;
      if (left + w > window.innerWidth - margin) left = Math.max(margin, window.innerWidth - margin - w);
      if (top + h > window.innerHeight - margin && r.top - h - 6 > margin) top = r.top - h - 6;
      pop.style.left = Math.round(left) + 'px';
      pop.style.top = Math.round(Math.max(margin, top)) + 'px';
    }

    function openPopover(anchor, build, opts) {
      if (openPop && openPop.anchor === anchor) { closePopover(); return null; }
      closePopover();
      const pop = document.createElement('div');
      pop.className = 'doc-pop';
      pop.setAttribute('role', (opts && opts.role) || 'dialog');
      document.body.appendChild(pop);
      const state = { anchor, el: pop, close: null };
      const onDown = (e) => {
        if (pop.contains(e.target) || anchor.contains(e.target)) return;
        if (e.target.closest && e.target.closest('.mc-pop, #modal-backdrop')) return;
        state.close();
      };
      const onKey = (e) => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); state.close(); ensureSelection(); }
      };
      const onResize = () => state.close();
      state.close = () => {
        if (openPop !== state) return;
        openPop = null;
        document.removeEventListener('pointerdown', onDown, true);
        document.removeEventListener('keydown', onKey, true);
        window.removeEventListener('resize', onResize);
        if (scrollEl) scrollEl.removeEventListener('scroll', onResize);
        anchor.classList.remove('open');
        anchor.setAttribute('aria-expanded', 'false');
        pop.remove();
        if (opts && opts.onClose) opts.onClose();
      };
      openPop = state;
      anchor.classList.add('open');
      anchor.setAttribute('aria-expanded', 'true');
      build(pop, state.close);
      placePopover(pop, anchor);
      setTimeout(() => {
        if (openPop !== state) return;
        document.addEventListener('pointerdown', onDown, true);
        document.addEventListener('keydown', onKey, true);
        window.addEventListener('resize', onResize);
        if (scrollEl && !(opts && opts.keepOnScroll)) scrollEl.addEventListener('scroll', onResize, { passive: true });
      }, 0);
      return state;
    }

    /* items: { label, hint, icon, checked, action, sep, heading, disabled, html, cls } */
    function openMenu(anchor, items, opts) {
      return openPopover(anchor, (pop, close) => {
        pop.classList.add('doc-menu');
        if (opts && opts.cls) pop.classList.add(opts.cls);
        pop.setAttribute('role', 'menu');
        const rows = [];
        items.forEach((it) => {
          if (it.sep) { const s = document.createElement('div'); s.className = 'doc-menu-sep'; pop.appendChild(s); return; }
          if (it.heading) { const h = document.createElement('div'); h.className = 'doc-menu-heading'; h.textContent = it.heading; pop.appendChild(h); return; }
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'doc-menu-item' + (it.checked ? ' checked' : '') + (it.cls ? ' ' + it.cls : '');
          b.setAttribute('role', it.checked != null ? 'menuitemradio' : 'menuitem');
          if (it.checked != null) b.setAttribute('aria-checked', String(!!it.checked));
          b.disabled = !!it.disabled;
          const check = `<span class="doc-menu-check">${it.checked ? DI.check : ''}</span>`;
          const ic = it.icon ? `<span class="doc-menu-icon">${it.icon}</span>` : '';
          const label = it.html || `<span class="doc-menu-label">${escapeHtml(it.label)}</span>`;
          const hint = it.hint ? `<span class="doc-menu-hint">${escapeHtml(it.hint)}</span>` : '';
          b.innerHTML = (opts && opts.checks === false ? '' : check) + ic + label + hint;
          b.addEventListener('mousedown', (e) => e.preventDefault());
          b.addEventListener('click', () => {
            close();
            if (it.action) it.action();
          });
          pop.appendChild(b);
          rows.push(b);
        });
        pop.addEventListener('keydown', (e) => {
          const i = rows.indexOf(document.activeElement);
          if (e.key === 'ArrowDown') { e.preventDefault(); (rows[i + 1] || rows[0]).focus(); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); (rows[i - 1] || rows[rows.length - 1]).focus(); }
          else if (e.key === 'Home') { e.preventDefault(); rows[0].focus(); }
          else if (e.key === 'End') { e.preventDefault(); rows[rows.length - 1].focus(); }
        });
        if (opts && opts.focus) setTimeout(() => { const f = rows.find((r) => r.classList.contains('checked')) || rows[0]; if (f) f.focus(); }, 0);
      }, { role: 'menu', onClose: opts && opts.onClose });
    }

    /* ---------- right-click menu ---------- */
    /* The ribbon holds everything, but the things an author reaches for
       mid-sentence - a spelling fix, a link, a picture, a comment on what
       they just selected - are the ones worth having under the cursor. */
    let ctxMenuEl = null;
    let ctxMenuDismiss = null;
    let spellInfo = null;

    function closeContextMenu() {
      if (!ctxMenuEl) return;
      document.removeEventListener('mousedown', ctxMenuDismiss, true);
      document.removeEventListener('keydown', ctxMenuDismiss, true);
      window.removeEventListener('resize', closeContextMenu, true);
      ctxMenuEl.remove();
      ctxMenuEl = null;
      ctxMenuDismiss = null;
    }

    function hasTextSelection() {
      const r = liveRange(savedRange) || liveRange(lastRange);
      return !!(r && !r.collapsed && r.toString().trim());
    }

    async function pasteFromClipboard() {
      ensureSelection();
      restoreSelection();
      let html = '';
      let text = '';
      try {
        const items = await navigator.clipboard.read();
        for (const it of items) {
          if (it.types.includes('text/html')) html = await (await it.getType('text/html')).text();
          else if (it.types.includes('text/plain')) text = await (await it.getType('text/plain')).text();
          const img = it.types.find((t) => /^image\//.test(t));
          if (!html && !text && img) {
            const blob = await it.getType(img);
            await insertImageFiles([new File([blob], 'pasted', { type: img })]);
            return;
          }
        }
      } catch {
        try { text = await navigator.clipboard.readText(); } catch { /* denied or empty */ }
      }
      if (html) { insertHtmlAtCaret(cleanPastedHtml(html)); return; }
      if (!text) return;
      const asHtml = plainTextToHtml(text);
      if (asHtml) insertHtmlAtCaret(asHtml);
      else insertTextAtCaret(text);
    }

    function contextMenuItems() {
      const selected = hasTextSelection();
      const link = linkAtSelection();
      const I = window.MargoIcons || {};
      const items = [];
      if (spellInfo && spellInfo.word) {
        const sugg = (spellInfo.suggestions || []).slice(0, 5);
        if (sugg.length) {
          sugg.forEach((s) => items.push({ label: s, icon: DI.spellcheck, enabled: true, cls: 'is-suggestion', action: () => replaceMisspelling(s) }));
        } else {
          items.push({ label: 'No spelling suggestions', icon: DI.spellcheck, enabled: false });
        }
        items.push({ label: `Add “${spellInfo.word}” to dictionary`, icon: DI.addWord, enabled: true, action: () => addToDictionary(spellInfo.word) });
        items.push({ sep: true });
      }
      items.push(
        { label: 'Cut', icon: I.cut || DI.cut, accel: 'Ctrl+X', enabled: selected, action: () => execClipboardCommand('cut') },
        { label: 'Copy', icon: I.copy || DI.copy, accel: 'Ctrl+C', enabled: selected, action: () => execClipboardCommand('copy') },
        { label: 'Paste', icon: I.paste || DI.paste, accel: 'Ctrl+V', enabled: true, action: () => pasteFromClipboard() },
        { sep: true },
        { label: link ? 'Edit link…' : 'Insert link…', icon: I.link || DI.link, accel: 'Ctrl+K', enabled: true, action: () => insertLinkFromDialog() }
      );
      if (link) {
        items.push({ label: 'Open link', icon: DI.openLink, accel: 'Ctrl+Click', enabled: true,
          action: () => { const h = link.getAttribute('href') || ''; if (/^(https?:|mailto:)/i.test(h) && window.margo.openExternal) window.margo.openExternal(h); } });
      }
      items.push(
        { label: 'Insert image…', icon: I.image || DI.image, enabled: true, action: () => insertImageFromDialog() },
        { sep: true },
        /* Commenting needs something to attach to, so with nothing selected the
           row explains itself rather than silently doing nothing. */
        { label: 'Add comment', icon: I.comment || DI.comment, accel: 'Ctrl+Alt+M', enabled: selected, hint: selected ? '' : 'Select text first',
          action: () => addComment() }
      );
      if (selectionInTable()) {
        items.push(
          { sep: true },
          { label: 'Insert row below', icon: DI.rowBelow, enabled: true, action: () => insertRow('below') },
          { label: 'Insert column right', icon: DI.colRight, enabled: true, action: () => insertCol('right') },
          { label: 'Delete row', icon: DI.delRow, enabled: true, action: () => deleteRowOp() },
          { label: 'Merge cells', icon: DI.merge, enabled: true, action: () => mergeCells() }
        );
      }
      return items;
    }

    function replaceMisspelling(word) {
      restoreSelection();
      if (window.margo && window.margo.spell && window.margo.spell.replace) {
        window.margo.spell.replace(word);
        setTimeout(() => { if (!destroyed) afterChange({ paginate: false }); }, 30);
        return;
      }
      // Without the main-process hook, select the word at the caret and type over it.
      const sel = window.getSelection();
      if (sel.rangeCount && sel.getRangeAt(0).collapsed) {
        try { sel.modify('move', 'backward', 'word'); sel.modify('extend', 'forward', 'word'); } catch {}
      }
      insertTextAtCaret(word);
    }

    function addToDictionary(word) {
      if (window.margo && window.margo.spell && window.margo.spell.addWord) window.margo.spell.addWord(word);
      ctx.toast(`Added “${word}” to the dictionary`);
    }

    function openContextMenu(clientX, clientY) {
      closeContextMenu();
      closePopover();
      const items = contextMenuItems();
      const el = document.createElement('div');
      el.className = 'menu-drop doc-ctx-menu';
      el.setAttribute('role', 'menu');
      items.forEach((item) => {
        if (item.sep) {
          const sep = document.createElement('div');
          sep.className = 'menu-sep';
          el.appendChild(sep);
          return;
        }
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'menu-item' + (item.enabled ? '' : ' disabled') + (item.cls ? ' ' + item.cls : '');
        row.setAttribute('role', 'menuitem');
        const ic = document.createElement('span');
        ic.className = 'menu-icon';
        ic.setAttribute('aria-hidden', 'true');
        ic.innerHTML = item.icon || '';
        row.appendChild(ic);
        const label = document.createElement('span');
        label.className = 'menu-label';
        label.textContent = item.label;
        row.appendChild(label);
        const trail = document.createElement('span');
        trail.className = 'menu-accel';
        trail.textContent = item.hint || item.accel || '';
        row.appendChild(trail);
        row.addEventListener('mousedown', (e) => e.preventDefault());
        row.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (!item.enabled) return;
          closeContextMenu();
          item.action();
        });
        el.appendChild(row);
      });

      /* Measured before placing, so a right-click near the bottom or the right
         edge opens back towards the page instead of off it. */
      el.style.visibility = 'hidden';
      el.style.left = '0px';
      el.style.top = '0px';
      document.body.appendChild(el);
      const margin = 6;
      let left = clientX;
      let top = clientY;
      if (left + el.offsetWidth > window.innerWidth - margin) left = clientX - el.offsetWidth;
      if (top + el.offsetHeight > window.innerHeight - margin) top = clientY - el.offsetHeight;
      el.style.left = Math.max(margin, left) + 'px';
      el.style.top = Math.max(margin, top) + 'px';
      el.style.visibility = '';

      ctxMenuEl = el;
      ctxMenuDismiss = (e) => {
        if (e.type === 'keydown') { if (e.key === 'Escape') closeContextMenu(); return; }
        if (!el.contains(e.target)) closeContextMenu();
      };
      setTimeout(() => {
        if (ctxMenuEl !== el) return;
        document.addEventListener('mousedown', ctxMenuDismiss, true);
        document.addEventListener('keydown', ctxMenuDismiss, true);
        window.addEventListener('resize', closeContextMenu, true);
      }, 0);
      return el;
    }

    let ctxMenuPos = null;
    function onPageContextMenu(e) {
      if (!pageBodyOf(e.target) && !(e.target.closest && e.target.closest('.doc-page'))) return;
      e.preventDefault();
      /* The selection is what the menu acts on, so it is captured before the
         menu takes focus away from it. */
      saveSelection();
      spellInfo = null;
      ctxMenuPos = { x: e.clientX, y: e.clientY, at: Date.now() };
      openContextMenu(e.clientX, e.clientY);
    }

    /* The main process reports a misspelled word under the pointer a moment
       after the right-click; the open menu is rebuilt with the suggestions
       at the top. */
    function onSpellContext(info) {
      if (!isActiveTab() || !ctxMenuPos || Date.now() - ctxMenuPos.at > 1500) return;
      if (!info || !info.misspelledWord) return;
      spellInfo = { word: info.misspelledWord, suggestions: info.dictionarySuggestions || [] };
      openContextMenu(ctxMenuPos.x, ctxMenuPos.y);
    }

    let copiedFormat = null;

    /* ---------- spacing & style popovers ---------- */
    function currentBlock() {
      const r = liveRange(lastRange);
      return r ? closestBlock(r.startContainer, pageBodyOf(r.startContainer)) : null;
    }

    function openSpacingPopover(anchor) {
      saveSelection();
      const b = currentBlock();
      const lhRaw = b ? (b.style.lineHeight || '') : '';
      const lh = lhRaw && /^[\d.]+$/.test(lhRaw) ? String(parseFloat(lhRaw)) : '1.15';
      const pt = (v) => (v && /pt$/.test(v) ? Math.round(parseFloat(v)) : null);
      const before = b ? pt(b.style.marginTop) : null;
      const after = b ? pt(b.style.marginBottom) : null;
      openPopover(anchor, (pop, close) => {
        pop.classList.add('doc-spacing-pop');
        const h = (t) => { const d = document.createElement('div'); d.className = 'doc-menu-heading'; d.textContent = t; pop.appendChild(d); };
        h('Line spacing');
        LINE_SPACINGS.forEach((v) => {
          const item = document.createElement('button');
          item.type = 'button';
          item.className = 'doc-menu-item' + (v === lh ? ' checked' : '');
          item.innerHTML = `<span class="doc-menu-check">${v === lh ? DI.check : ''}</span><span class="doc-menu-label">${v === '1' ? 'Single' : v === '2' ? 'Double' : v}</span>`;
          item.addEventListener('mousedown', (e) => e.preventDefault());
          item.addEventListener('click', () => { close(); restoreSelection(); applyLineSpacing(v); });
          pop.appendChild(item);
        });
        const seg = (label, which, cur) => {
          h(label);
          const row = document.createElement('div');
          row.className = 'doc-seg';
          PARA_SPACINGS.forEach((v) => {
            const s = document.createElement('button');
            s.type = 'button';
            s.className = 'doc-seg-btn' + (cur === v ? ' active' : '');
            s.textContent = v + ' pt';
            s.title = `${label}: ${v} pt`;
            s.addEventListener('mousedown', (e) => e.preventDefault());
            s.addEventListener('click', () => {
              restoreSelection();
              applyParagraphSpacing(which, v);
              row.querySelectorAll('.doc-seg-btn').forEach((x) => x.classList.toggle('active', x === s));
            });
            row.appendChild(s);
          });
          pop.appendChild(row);
        };
        seg('Space before paragraph', 'before', before);
        seg('Space after paragraph', 'after', after);
      });
    }

    function openStyleGallery(anchor) {
      saveSelection();
      const cur = styleBtn ? styleBtn.dataset.style : 'p';
      openMenu(anchor, PARA_STYLES.map((st) => ({
        html: `<span class="doc-style-preview s-${st.id}">${escapeHtml(st.label)}</span>`,
        hint: st.key || '',
        checked: st.id === cur,
        action: () => { restoreSelection(); applyParagraphStyle(st.id); }
      })), { cls: 'doc-style-menu', focus: false });
    }

    function showRibbonTab(id) {
      if (!ribbonPanels[id]) return;
      activeRibbonTab = id;
      Object.entries(ribbonTabs).forEach(([k, b]) => {
        b.classList.toggle('active', k === id);
        b.setAttribute('aria-selected', String(k === id));
        b.tabIndex = k === id ? 0 : -1;
      });
      Object.entries(ribbonPanels).forEach(([k, p]) => p.classList.toggle('hidden', k !== id));
      closePopover();
    }

    /* ---------- the ribbon ---------- */
    function buildRibbon() {
      const tb = ctx.toolbar;
      tb.innerHTML = '';
      tb.className = 'toolbar doc-ribbon';
      const I = window.MargoIcons || {};
      Object.keys(stateButtons).forEach((k) => delete stateButtons[k]);
      alignBtns = {};
      listBtns = {};
      ribbonTabs = {};
      ribbonPanels = {};

      const tabsBar = document.createElement('div');
      tabsBar.className = 'doc-ribbon-tabs';
      tabsBar.setAttribute('role', 'tablist');
      tabsBar.setAttribute('aria-label', 'Ribbon');
      const panelsWrap = document.createElement('div');
      panelsWrap.className = 'doc-ribbon-panels';

      const TABS = [
        { id: 'home', label: 'Home' },
        { id: 'insert', label: 'Insert' },
        { id: 'layout', label: 'Layout' },
        { id: 'references', label: 'References' },
        { id: 'review', label: 'Review' },
        { id: 'view', label: 'View' },
        { id: 'table', label: 'Table', contextual: true }
      ];
      TABS.forEach((t) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'doc-ribbon-tab' + (t.contextual ? ' is-contextual hidden' : '');
        btn.textContent = t.label;
        btn.setAttribute('role', 'tab');
        btn.id = `doc-rtab-${t.id}-${Math.random().toString(36).slice(2, 7)}`;
        btn.addEventListener('mousedown', (e) => e.preventDefault());
        btn.addEventListener('click', () => showRibbonTab(t.id));
        btn.addEventListener('keydown', (e) => {
          if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
          const vis = TABS.filter((x) => !ribbonTabs[x.id].classList.contains('hidden'));
          const i = vis.findIndex((x) => x.id === t.id);
          const next = vis[(i + (e.key === 'ArrowRight' ? 1 : -1) + vis.length) % vis.length];
          showRibbonTab(next.id);
          ribbonTabs[next.id].focus();
        });
        tabsBar.appendChild(btn);
        ribbonTabs[t.id] = btn;
        const panel = document.createElement('div');
        panel.className = 'doc-ribbon-panel hidden';
        panel.setAttribute('role', 'tabpanel');
        panel.setAttribute('aria-labelledby', btn.id);
        panel.dataset.tab = t.id;
        panelsWrap.appendChild(panel);
        ribbonPanels[t.id] = panel;
      });
      tableTabBtn = ribbonTabs.table;
      tb.appendChild(tabsBar);
      tb.appendChild(panelsWrap);

      const group = (panel, label) => {
        if (panel.children.length) {
          const s = document.createElement('span');
          s.className = 'tb-sep doc-rsep';
          s.setAttribute('aria-hidden', 'true');
          panel.appendChild(s);
        }
        const g = document.createElement('div');
        g.className = 'doc-rgroup';
        g.setAttribute('role', 'group');
        g.setAttribute('aria-label', label);
        panel.appendChild(g);
        return g;
      };
      /* A button keeps the caret where it is (mousedown does not take focus)
         and carries its shortcut in the tooltip. */
      const btn = (parent, title, html, fn, o) => {
        const opts = o || {};
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'icon-btn' + (opts.label ? ' doc-rbtn-label' : '') + (opts.cls ? ' ' + opts.cls : '');
        b.title = opts.key ? `${title} (${opts.key})` : title;
        if (!opts.label) b.setAttribute('aria-label', title);
        b.innerHTML = html + (opts.label ? `<span class="doc-rbtn-text">${escapeHtml(opts.label)}</span>` : '') + (opts.menu ? `<span class="doc-rbtn-chev">${DI.chevron}</span>` : '');
        if (opts.menu) b.setAttribute('aria-haspopup', 'true');
        b.addEventListener('mousedown', (e) => { e.preventDefault(); saveSelection(); });
        b.addEventListener('click', (e) => fn(e, b));
        parent.appendChild(b);
        if (opts.state) stateButtons[opts.state] = b;
        return b;
      };
      const select = (parent, cls, title) => {
        const s = document.createElement('select');
        s.className = 'tb-select ' + cls;
        s.title = title;
        s.setAttribute('aria-label', title);
        s.addEventListener('mousedown', saveSelection);
        s.addEventListener('focus', saveSelection);
        parent.appendChild(s);
        return s;
      };

      /* ========== HOME ========== */
      const pHome = ribbonPanels.home;
      let g = group(pHome, 'History');
      btn(g, 'Undo', I.undo || DI.undo, () => undo(), { key: 'Ctrl+Z' });
      btn(g, 'Redo', I.redo || DI.redo, () => redo(), { key: 'Ctrl+Y' });
      painterBtn = btn(g, 'Format painter — click to copy formatting once, double-click to keep painting', DI.painter, () => togglePainter(false));
      painterBtn.addEventListener('dblclick', () => { stopPainter(); togglePainter(true); });

      g = group(pHome, 'Styles');
      styleBtn = document.createElement('button');
      styleBtn.type = 'button';
      styleBtn.className = 'doc-style-btn';
      styleBtn.title = 'Paragraph style';
      styleBtn.setAttribute('aria-haspopup', 'true');
      styleBtn.innerHTML = `<span class="doc-style-name">Normal text</span><span class="doc-rbtn-chev">${DI.chevron}</span>`;
      styleBtn.addEventListener('mousedown', (e) => { e.preventDefault(); saveSelection(); });
      styleBtn.addEventListener('click', () => openStyleGallery(styleBtn));
      g.appendChild(styleBtn);

      g = group(pHome, 'Font');
      familySelect = select(g, 'tb-font', 'Font');
      fillFontSelect(FONT_FAMILIES.slice());
      familySelect.addEventListener('change', () => {
        restoreSelection();
        fillVariantSelect(familySelect.value);
        applyFontFace(familySelect.value, variantSelect ? variantSelect.value : 'Regular');
      });
      variantSelect = select(g, 'tb-font-variant', 'Font style');
      fillVariantSelect(familySelect.value);
      variantSelect.addEventListener('change', () => {
        restoreSelection();
        applyFontFace(familySelect.value, variantSelect.value);
      });
      sizeSelect = select(g, 'tb-size', 'Font size (pt)');
      FONT_SIZES.forEach((s) => {
        const o = document.createElement('option');
        o.value = String(s);
        o.textContent = s;
        sizeSelect.appendChild(o);
      });
      sizeSelect.value = '11';
      sizeSelect.addEventListener('change', () => {
        restoreSelection();
        setFontSize(Number(sizeSelect.value));
      });
      btn(g, 'Increase font size', DI.grow, () => stepFontSize(1), { key: 'Ctrl+]' });
      btn(g, 'Decrease font size', DI.shrink, () => stepFontSize(-1), { key: 'Ctrl+[' });

      g = group(pHome, 'Character');
      btn(g, 'Bold', DI.bold, () => exec('bold'), { key: 'Ctrl+B', state: 'bold' });
      btn(g, 'Italic', DI.italic, () => exec('italic'), { key: 'Ctrl+I', state: 'italic' });
      btn(g, 'Underline', DI.underline, () => exec('underline'), { key: 'Ctrl+U', state: 'underline' });
      btn(g, 'Strikethrough', DI.strike, () => exec('strikeThrough'), { key: 'Ctrl+Shift+X', state: 'strikeThrough' });
      btn(g, 'Subscript', DI.subscript, () => exec('subscript'), { key: 'Ctrl+,', state: 'subscript' });
      btn(g, 'Superscript', DI.superscript, () => exec('superscript'), { key: 'Ctrl+.', state: 'superscript' });

      g = group(pHome, 'Colour');
      const colorBtn = btn(g, 'Text colour', DI.textColor, () => {
        PICKER.open(colorBtn, {
          title: 'Text colour',
          allowNone: true,
          noneLabel: 'Automatic',
          value: currentInlineColor('color'),
          onPick: (hex) => { restoreSelection(); applyTextColor(hex); }
        });
      }, { cls: 'tb-color' });
      colorBar = colorBtn.querySelector('.doc-swatch-bar');
      const hlBtn = btn(g, 'Highlight colour', DI.highlight, () => {
        PICKER.open(hlBtn, {
          title: 'Highlight colour',
          allowNone: true,
          noneLabel: 'No highlight',
          value: currentInlineColor('backgroundColor'),
          onPick: (hex) => { restoreSelection(); applyTextHighlight(hex); }
        });
      }, { cls: 'tb-hl' });
      hlBar = hlBtn.querySelector('.doc-swatch-bar');
      btn(g, 'Clear formatting', DI.clear, () => clearFormatting(), { key: 'Ctrl+\\' });
      const caseBtn = btn(g, 'Change case', DI.caseChange, () => {
        openMenu(caseBtn, [
          { label: 'Sentence case.', action: () => transformTextCase('sentence') },
          { label: 'lowercase', action: () => transformTextCase('lower') },
          { label: 'UPPERCASE', action: () => transformTextCase('upper') },
          { label: 'Capitalize Each Word', action: () => transformTextCase('title') },
          { label: 'tOGGLE cASE', action: () => transformTextCase('toggle') }
        ], { checks: false });
      }, { menu: true });

      g = group(pHome, 'Paragraph');
      listBtns.ul = btn(g, 'Bulleted list', DI.ul, () => toggleList('ul'), { key: 'Ctrl+Shift+8' });
      listBtns.ol = btn(g, 'Numbered list', DI.ol, () => toggleList('ol'), { key: 'Ctrl+Shift+7' });
      listBtns.check = btn(g, 'Checklist', DI.checklist, () => toggleList('check'), { key: 'Ctrl+Shift+9' });
      btn(g, 'Decrease indent', DI.indentDec, () => indent(-1), { key: 'Shift+Tab' });
      btn(g, 'Increase indent', DI.indentInc, () => indent(1), { key: 'Tab' });

      g = group(pHome, 'Alignment');
      alignBtns.left = btn(g, 'Align left', DI.alignLeft, () => align('left'), { key: 'Ctrl+L' });
      alignBtns.center = btn(g, 'Centre', DI.alignCenter, () => align('center'), { key: 'Ctrl+Shift+E' });
      alignBtns.right = btn(g, 'Align right', DI.alignRight, () => align('right'), { key: 'Ctrl+R' });
      alignBtns.justify = btn(g, 'Justify', DI.alignJustify, () => align('justify'), { key: 'Ctrl+J' });
      const spBtn = btn(g, 'Line & paragraph spacing', DI.spacing, () => openSpacingPopover(spBtn), { menu: true });


      /* ========== INSERT ========== */
      const pIns = ribbonPanels.insert;
      g = group(pIns, 'Pages');
      btn(g, 'Page break', DI.pageBreak, () => insertPageBreak(), { key: 'Ctrl+Enter', label: 'Page break' });
      btn(g, 'Blank page at the end', DI.blankPage, () => addPage(), { label: 'Blank page' });
      g = group(pIns, 'Tables');
      const tableBtn = btn(g, 'Insert table', DI.table, () => openTableSizePicker(tableBtn), { label: 'Table', menu: true });
      g = group(pIns, 'Illustrations');
      btn(g, 'Insert picture from a file', DI.image, () => insertImageFromDialog(), { label: 'Picture' });
      btn(g, 'Images in document', DI.imageStack, () => showDocumentImagesPanel());
      g = group(pIns, 'Links & comments');
      btn(g, 'Insert link', DI.link, () => insertLinkFromDialog(), { key: 'Ctrl+K' });
      btn(g, 'Add comment', icon('comment'), () => addComment());
      g = group(pIns, 'Text');
      btn(g, 'Horizontal line', DI.hr, () => insertHorizontalRule());
      btn(g, 'Symbol', DI.symbol, () => openSymbolsPicker());
      const calloutBtn = btn(g, 'Callout box', DI.callout, () => {
        openMenu(calloutBtn, Object.keys(CALLOUTS).map((k) => ({
          html: `<span class="doc-callout-swatch k-${k}"></span><span class="doc-menu-label">${CALLOUTS[k]}</span>`,
          action: () => insertCallout(k)
        })), { checks: false });
      }, { menu: true });
      const dateBtn = btn(g, 'Date & time', DI.date, () => {
        const now = new Date();
        openMenu(dateBtn, [
          { label: now.toLocaleDateString(), hint: 'Short', action: () => insertDate('short') },
          { label: now.toLocaleDateString(undefined, { dateStyle: 'long' }), hint: 'Long', action: () => insertDate('long') },
          { label: now.toLocaleDateString(undefined, { dateStyle: 'full' }), hint: 'Full', action: () => insertDate('full') },
          { label: now.toISOString().split('T')[0], hint: 'ISO', action: () => insertDate('iso') },
          { label: now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }), hint: 'Time', action: () => insertDate('time') }
        ], { checks: false });
      }, { menu: true });
      g = group(pIns, 'Header & footer');
      const hdrBtn = btn(g, 'Header', DI.header, () => openHeaderFooterEditor(hdrBtn, 'header'), { label: 'Header' });
      const ftrBtn = btn(g, 'Footer', DI.footer, () => openHeaderFooterEditor(ftrBtn, 'footer'), { label: 'Footer' });
      btn(g, 'Page numbers on or off', DI.pageNumber, () => togglePageNumbers(), { label: 'Page numbers' });

      /* ========== LAYOUT ========== */
      const pLay = ribbonPanels.layout;
      g = group(pLay, 'Page setup');
      const marBtn = btn(g, 'Margins', DI.margins, () => {
        openMenu(marBtn, Object.keys(MARGIN_PRESETS).map((k) => ({
          label: MARGIN_PRESETS[k].label,
          hint: MARGIN_PRESETS[k].hint,
          checked: !layout.marginIn && layout.margins === k,
          action: () => setLayout({ margins: k, marginIn: null, marginTw: null })
        })).concat([{ sep: true }, { label: 'Custom margins…', checked: !!layout.marginIn, action: () => customMargins() }]));
      }, { label: 'Margins', menu: true });
      const oriBtn = btn(g, 'Orientation', DI.orientation, () => {
        openMenu(oriBtn, ['portrait', 'landscape'].map((o) => ({
          label: o === 'portrait' ? 'Portrait' : 'Landscape',
          checked: (layout.orientation || 'portrait') === o,
          action: () => setLayout({ orientation: o })
        })));
      }, { label: 'Orientation', menu: true });
      const sizeBtn = btn(g, 'Paper size', DI.pageSize, () => {
        openMenu(sizeBtn, Object.keys(PAGE_SIZES).map((k) => ({
          label: PAGE_SIZES[k].label,
          hint: PAGE_SIZES[k].hint,
          checked: !layout.pageIn && layout.size === k,
          action: () => setLayout({ size: k, pageIn: null, pageTw: null })
        })));
      }, { label: 'Size', menu: true });
      const colBtn = btn(g, 'Columns', DI.columns, () => {
        openMenu(colBtn, [1, 2, 3].map((n) => ({
          label: n === 1 ? 'One' : n === 2 ? 'Two' : 'Three',
          checked: (layout.columns || 1) === n,
          action: () => setLayout({ columns: n })
        })));
      }, { label: 'Columns', menu: true });
      g = group(pLay, 'Paragraph');
      btn(g, 'Decrease indent', DI.indentDec, () => indent(-1));
      btn(g, 'Increase indent', DI.indentInc, () => indent(1));
      const spBtn2 = btn(g, 'Line & paragraph spacing', DI.spacing, () => openSpacingPopover(spBtn2), { menu: true });
      g = group(pLay, 'Breaks');
      btn(g, 'Page break', DI.pageBreak, () => insertPageBreak(), { key: 'Ctrl+Enter', label: 'Page break' });
      const hfBtn = btn(g, 'Header & footer', DI.header, () => openHeaderFooterEditor(hfBtn, 'header'), { label: 'Header & footer' });

      /* ========== REFERENCES ========== */
      const pRef = ribbonPanels.references;
      g = group(pRef, 'Table of contents');
      btn(g, 'Insert a table of contents built from the headings', DI.toc, () => insertToc(), { label: 'Table of contents' });
      btn(g, 'Update the table of contents', DI.tocUpdate, () => updateToc(), { label: 'Update table' });
      g = group(pRef, 'Footnotes');
      btn(g, 'Insert footnote', DI.footnote, () => insertFootnote(), { key: 'Ctrl+Alt+F', label: 'Footnote' });

      /* ========== REVIEW ========== */
      const pRev = ribbonPanels.review;
      g = group(pRev, 'Proofing');
      spellBtn = btn(g, 'Spell check', DI.spellcheck, () => setSpellcheck(!spellEnabled), { label: 'Spelling' });
      btn(g, 'Word count', DI.stats, () => openStatsModal(), { label: 'Word count' });
      g = group(pRev, 'Find');
      btn(g, 'Find & Replace', DI.replace, () => openFind(true), { key: 'Ctrl+F' });
      g = group(pRev, 'Comments');
      btn(g, 'Add comment', icon('comment'), () => addComment());
      btn(g, 'Toggle Comments panel', I.commentsPanel || DI.callout, () => toggleCommentsRail());
      g = group(pRev, 'Media');
      btn(g, 'Images in document', DI.imageStack, () => showDocumentImagesPanel());

      /* ========== VIEW ========== */
      const pView = ribbonPanels.view;
      g = group(pView, 'Views');
      btn(g, 'Print layout', DI.printLayout, () => setViewMode('print'), { label: 'Print', cls: 'active' }).dataset.view = 'print';
      btn(g, 'Read view', DI.readView, () => setViewMode('read'), { label: 'Read' }).dataset.view = 'read';
      btn(g, 'Split view', DI.split, () => setViewMode('split'), { label: 'Split' }).dataset.view = 'split';
      g = group(pView, 'Show');
      btn(g, 'Document outline', DI.outline, () => toggleOutlineRail(), { label: 'Outline' });
      btn(g, 'Focus mode (Esc to exit)', DI.focus, () => toggleFocusMode(), { label: 'Focus' });
      g = group(pView, 'Zoom');
      btn(g, 'Zoom out', DI.zoomOut, () => zoomBy(1 / 1.1), { key: 'Ctrl+-' });
      btn(g, 'Zoom in', DI.zoomIn, () => zoomBy(1.1), { key: 'Ctrl++' });
      btn(g, 'Zoom to 100%', DI.zoomReset, () => { zoom = 1; applyZoom(); }, { key: 'Ctrl+0' });

      /* ========== TABLE (contextual) ========== */
      const pTab = ribbonPanels.table;
      g = group(pTab, 'Rows & columns');
      btn(g, 'Insert row above', DI.rowAbove, () => insertRow('above'));
      btn(g, 'Insert row below', DI.rowBelow, () => insertRow('below'));
      btn(g, 'Insert column left', DI.colLeft, () => insertCol('left'));
      btn(g, 'Insert column right', DI.colRight, () => insertCol('right'));
      g = group(pTab, 'Delete');
      btn(g, 'Delete row', DI.delRow, () => deleteRowOp());
      btn(g, 'Delete column', DI.delCol, () => deleteColOp());
      btn(g, 'Delete table', DI.delTable, () => deleteTableOp());
      g = group(pTab, 'Merge');
      btn(g, 'Merge cells', DI.merge, () => mergeCells());
      btn(g, 'Split cell', DI.splitCell, () => splitCellOp());
      g = group(pTab, 'Style');
      btn(g, 'Header row', DI.headerRow, () => toggleHeaderRow());
      const bordersBtn = btn(g, 'Borders', DI.borderAll, () => {
        const t = selectionInTable();
        const cur = !t ? 'all' : t.table.classList.contains('margo-tbl-none') ? 'none' : t.table.classList.contains('margo-tbl-outer') ? 'outer' : 'all';
        openMenu(bordersBtn, [
          { label: 'All borders', icon: DI.borderAll, checked: cur === 'all', action: () => setTableBorders('all') },
          { label: 'Outside borders', icon: DI.borderOuter, checked: cur === 'outer', action: () => setTableBorders('outer') },
          { label: 'No borders', icon: DI.borderNone, checked: cur === 'none', action: () => setTableBorders('none') }
        ]);
      }, { menu: true });
      const shadeBtn = btn(g, 'Cell shading', DI.shading, () => {
        const t = selectionInTable();
        PICKER.open(shadeBtn, {
          title: 'Cell shading',
          allowNone: true,
          noneLabel: 'No fill',
          value: t ? t.cell.style.backgroundColor : '',
          onPick: (hex) => { restoreSelection(); setTableCellShading(hex || ''); }
        });
      });
      g = group(pTab, 'Alignment');
      btn(g, 'Align to top', DI.valignTop, () => setCellVAlign('top'));
      btn(g, 'Align to middle', DI.valignMiddle, () => setCellVAlign('middle'));
      btn(g, 'Align to bottom', DI.valignBottom, () => setCellVAlign('bottom'));
      btn(g, 'Distribute columns evenly', DI.distribute, () => distributeColumns());

      showRibbonTab(activeRibbonTab === 'table' ? 'home' : activeRibbonTab);
    }

    function setSpellcheck(on) {
      spellEnabled = !!on;
      pageBodies().forEach((b) => { b.spellcheck = spellEnabled; });
      if (spellBtn) spellBtn.classList.toggle('active', spellEnabled);
      ctx.toast(`Spell check ${spellEnabled ? 'on' : 'off'}`);
    }

    /* Every open Word document keeps its own listener on the document, so a
       key pressed once is delivered to all of them. Without this the tab in
       front and the ones behind it all acted on it: Ctrl+Enter appended a
       blank page to every open document, and because markDirty belongs to the
       active tab, the documents behind it were changed without even being
       marked unsaved - the extra pages just turned up in the file the next
       time they were saved. */
    function isActiveTab() {
      return !destroyed && (!ctx.isActive || ctx.isActive());
    }

    function modalOpen() {
      const bd = document.getElementById('modal-backdrop');
      return !!(bd && !bd.classList.contains('hidden'));
    }

    /* Window-level keys, scoped: only for the tab in front, never while a
       dialog is up, and only when focus is in this editor's pane or nowhere. */
    function onFindKeydown(e) {
      if (!isActiveTab() || modalOpen()) return;
      const pane = hostEl && (hostEl.closest('.tab-pane') || hostEl.parentElement);
      const t = e.target;
      const inPane = !t || t === document.body || (pane && pane.contains(t)) || (ctx.toolbar && ctx.toolbar.contains(t));
      if (!inPane) return;
      if (e.key === 'Escape') {
        if (painter) { e.preventDefault(); stopPainter(); return; }
        if (selectedImg) { hideImageOverlay(); }
        if (findOpen) {
          e.preventDefault();
          closeFind();
          return;
        }
        if (document.body.classList.contains('margo-focus-mode')) {
          e.preventDefault();
          toggleFocusMode();
        }
      }
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'h') {
        e.preventDefault();
        openFind(true);
      }
    }

    /* Keys typed in a page. */
    function onEditorKeydown(e) {
      if (viewMode === 'read') return;
      if (onPageEdgeKey(e)) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key;
      const lower = k.length === 1 ? k.toLowerCase() : k;
      const handled = () => { e.preventDefault(); e.stopPropagation(); };
      if (mod && k === 'Enter') { handled(); insertPageBreak(); return; }
      if (k === 'Tab' && !mod && !e.altKey) {
        handled();
        if (tabInTable(e.shiftKey)) return;
        if (currentList()) { exec(e.shiftKey ? 'outdent' : 'indent'); return; }
        if (e.shiftKey) { indent(-1); return; }
        insertTextAtCaret('    ');
        return;
      }
      if (k === 'Enter' && !mod && !e.shiftKey) {
        const list = currentList();
        if (list && list.classList.contains('margo-checklist')) {
          /* The browser copies the class onto the item Enter creates, so a
             new item came out already ticked. Whichever of the two items is
             the new one starts unticked; the old one keeps its state. */
          const caretLi = () => {
            const r = window.getSelection().rangeCount ? window.getSelection().getRangeAt(0) : null;
            const el = r && (r.startContainer.nodeType === 1 ? r.startContainer : r.startContainer.parentElement);
            return el && el.closest('li');
          };
          const orig = caretLi();
          const wasChecked = !!(orig && orig.classList.contains('is-checked'));
          setTimeout(() => {
            const now = caretLi();
            if (!now || !orig) return;
            if (now !== orig) {
              now.classList.remove('is-checked');
              orig.classList.toggle('is-checked', wasChecked);
            } else if (orig.previousElementSibling && orig.previousElementSibling.tagName === 'LI') {
              orig.previousElementSibling.classList.remove('is-checked');
            }
            [now, orig, orig.previousElementSibling].forEach((li) => { if (li && li.getAttribute('class') === '') li.removeAttribute('class'); });
          }, 0);
        }
        return;
      }
      if (k === 'Escape') {
        if (painter) { handled(); stopPainter(); return; }
        if (selectedImg) { hideImageOverlay(); return; }
      }
      if (!mod) return;
      if (e.altKey && !e.shiftKey) {
        if (/^[0-4]$/.test(k)) { handled(); applyParagraphStyle(k === '0' ? 'p' : 'h' + k); return; }
        if (lower === 'm') { handled(); addComment(); return; }
        if (lower === 'f') { handled(); insertFootnote(); return; }
        if (lower === 'c') { handled(); copiedFormat = captureFormat(); if (copiedFormat) ctx.toast('Formatting copied — Ctrl+Alt+V to paste it'); return; }
        if (lower === 'v') { handled(); if (copiedFormat) applyCapturedFormat(copiedFormat); return; }
        return;
      }
      if (e.shiftKey) {
        if (lower === 'v') {
          // Paste as plain text.
          handled();
          navigator.clipboard.readText().then((t) => {
            if (!t || destroyed) return;
            const asHtml = plainTextToHtml(t);
            if (asHtml) insertHtmlAtCaret(asHtml); else insertTextAtCaret(t);
          }).catch(() => {});
          return;
        }
        if (k === '>' || k === '.') { handled(); stepFontSize(1); return; }
        if (k === '<' || k === ',') { handled(); stepFontSize(-1); return; }
        if (k === '&' || e.code === 'Digit7') { handled(); toggleList('ol'); return; }
        if (k === '*' || e.code === 'Digit8') { handled(); toggleList('ul'); return; }
        if (k === '(' || e.code === 'Digit9') { handled(); toggleList('check'); return; }
        if (lower === 'x') { handled(); exec('strikeThrough'); return; }
        if (lower === 'e') { handled(); align('center'); return; }
        return;
      }
      if (lower === 'b') { handled(); exec('bold'); return; }
      if (lower === 'i') { handled(); exec('italic'); return; }
      if (lower === 'u') { handled(); exec('underline'); return; }
      if (lower === 'k') { handled(); insertLinkFromDialog(); return; }
      if (lower === 'l') { handled(); align('left'); return; }
      if (lower === 'r') { handled(); align('right'); return; }
      if (lower === 'j') { handled(); align('justify'); return; }
      if (k === ']') { handled(); stepFontSize(1); return; }
      if (k === '[') { handled(); stepFontSize(-1); return; }
      if (k === '\\' || k === ' ') { handled(); clearFormatting(); return; }
      if (k === '.') { handled(); exec('superscript'); return; }
      if (k === ',') { handled(); exec('subscript'); return; }
    }

    function onPagesClick(e) {
      if (openLinkIfModified(e)) return;
      if (onFootnoteRefClick(e)) return;
      onTocClick(e);
    }

    function onPagesDblClick(e) {
      const hf = e.target.closest && e.target.closest('.doc-page-header, .doc-page-footer');
      if (hf && pagesRoot.contains(hf) && viewMode !== 'read') {
        e.preventDefault();
        openHeaderFooterEditor(hf, hf.classList.contains('doc-page-footer') ? 'footer' : 'header');
      }
    }

    let unsubscribeSpell = null;

    return {
      kind: 'doc',
      mount(host, doc) {
        hostEl = host;
        buildRibbon();
        comments = Array.isArray(doc.notes) ? doc.notes.map((n) => ({ ...n })) : [];
        if (doc.layout && typeof doc.layout === 'object') {
          layout = { ...DEFAULT_LAYOUT, ...doc.layout };
        }
        const I = window.MargoIcons || {};

        host.innerHTML =
          `<aside class="doc-outline-rail hidden" aria-label="Document outline">` +
            `<div class="doc-rail-head">` +
              `<strong>Outline</strong>` +
              `<button type="button" class="icon-btn doc-outline-close" title="Close" aria-label="Close outline">${DI.close}</button>` +
            `</div>` +
            `<div class="doc-outline-list"></div>` +
          `</aside>` +
          `<div class="doc-editor-wrap">` +
            `<div class="doc-scroll doc-scroll-edit">` +
              `<div class="doc-pages"></div>` +
              `<div class="doc-fab-stack">` +
                `<button type="button" class="doc-comments-fab" title="Comments" aria-label="Open comments">` +
                  `<span class="doc-comments-fab-icon"></span>` +
                  `<span class="doc-comments-badge hidden">0</span>` +
                `</button>` +
                `<button type="button" class="doc-add-page" title="Add a blank page at the end" aria-label="Add page"></button>` +
              `</div>` +
            `</div>` +
            `<div class="doc-split-gutter hidden" aria-hidden="true"></div>` +
            `<div class="doc-scroll doc-scroll-preview hidden">` +
              `<div class="doc-pages doc-pages-preview"></div>` +
            `</div>` +
          `</div>` +
          `<aside class="doc-comments-rail hidden" aria-label="Comments">` +
            `<div class="doc-rail-head doc-comments-rail-head">` +
              `<strong>Comments</strong>` +
              `<span class="doc-comments-count"></span>` +
              `<button type="button" class="icon-btn doc-comments-rail-close" title="Close" aria-label="Close comments">${DI.close}</button>` +
            `</div>` +
            `<div class="doc-comments-list"></div>` +
          `</aside>`;

        scrollEl = host.querySelector('.doc-scroll-edit');
        editorWrap = host.querySelector('.doc-editor-wrap');
        pagesRoot = host.querySelector('.doc-pages:not(.doc-pages-preview)');
        splitGutter = host.querySelector('.doc-split-gutter');
        splitPreviewScroll = host.querySelector('.doc-scroll-preview');
        splitPreviewRoot = host.querySelector('.doc-pages-preview');
        commentsRail = host.querySelector('.doc-comments-rail');
        commentsFab = host.querySelector('.doc-comments-fab');
        commentsBadge = host.querySelector('.doc-comments-badge');
        outlineRail = host.querySelector('.doc-outline-rail');
        const addBtn = host.querySelector('.doc-add-page');
        addBtn.innerHTML = DI.blankPage;
        const fabIcon = host.querySelector('.doc-comments-fab-icon');
        if (fabIcon) fabIcon.innerHTML = I.comment || DI.comment;

        splitPages(doc.html || EMPTY_PAGE).forEach((html, i) => {
          const el = makePageEl(html);
          el.dataset.pageBreak = i === 0 ? 'start' : 'explicit';
          pagesRoot.appendChild(el);
        });
        activePage = pagesRoot.querySelector('.doc-page');

        applyLayoutAttributes();
        hydrate();

        try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch {}
        try { document.execCommand('styleWithCSS', false, false); } catch {}

        pagesRoot.addEventListener('input', (e) => {
          if (findHighlighting) return;
          const body = pageBodyOf(e.target);
          fixPendingTypingStyles(body);
          clearCrossPageSelection();
          ctx.markDirty();
          statusDirty = true;
          scheduleTypingWork();
          if (selectedImg) {
            if (!selectedImg.isConnected) hideImageOverlay();
            else positionImageOverlay();
          }
        });
        pagesRoot.addEventListener('compositionstart', () => { composing = true; });
        pagesRoot.addEventListener('compositionend', () => {
          composing = false;
          scheduleTypingWork();
        });
        pagesRoot.addEventListener('focusin', (e) => {
          const p = e.target.closest && e.target.closest('.doc-page');
          if (p) setActivePage(p);
        });
        pagesRoot.addEventListener('pointermove', onTableResizeHover);
        pagesRoot.addEventListener('pointerdown', onTableResizeDown, true);
        pagesRoot.addEventListener('pointerdown', onImagePointerDown, true);
        pagesRoot.addEventListener('pointerdown', onSelectPointerDown);
        pagesRoot.addEventListener('pointerup', onPainterPointerUp);
        pagesRoot.addEventListener('click', onPagesClick);
        pagesRoot.addEventListener('dblclick', onPagesDblClick);
        pagesRoot.addEventListener('copy', onPageCopy);
        pagesRoot.addEventListener('cut', onPageCut);
        pagesRoot.addEventListener('keydown', onPageKeydown);
        pagesRoot.addEventListener('keydown', onEditorKeydown);
        pagesRoot.addEventListener('contextmenu', onPageContextMenu);
        pagesRoot.addEventListener('paste', onPaste);
        pagesRoot.addEventListener('dragstart', onDragStart);
        pagesRoot.addEventListener('dragend', onDragEnd);
        pagesRoot.addEventListener('dragover', onDragOver);
        pagesRoot.addEventListener('drop', onDrop);
        document.addEventListener('pointermove', onSelectPointerMove, true);
        document.addEventListener('pointerup', onSelectPointerUp, true);
        document.addEventListener('pointercancel', onSelectPointerCancel, true);
        document.addEventListener('selectionchange', onSelChange);
        document.addEventListener('keydown', onFindKeydown, true);
        if (window.margo && window.margo.spell && typeof window.margo.spell.onContext === 'function') {
          unsubscribeSpell = window.margo.spell.onContext(onSpellContext);
        }

        addBtn.addEventListener('mousedown', (e) => e.preventDefault());
        addBtn.addEventListener('click', () => addPage());
        commentsFab.addEventListener('mousedown', (e) => e.preventDefault());
        commentsFab.addEventListener('click', () => {
          const open = commentsRail.classList.contains('hidden');
          toggleCommentsRail(open);
          if (!open) return;
          const target = comments.find((n) => !n.done) || comments[0];
          if (target) scrollToComment(target.id);
        });
        commentsRail.querySelector('.doc-comments-rail-close').addEventListener('click', () => toggleCommentsRail(false));
        outlineRail.querySelector('.doc-outline-close').addEventListener('click', () => toggleOutlineRail(false));
        scrollEl.addEventListener('wheel', onCtrlWheel, { passive: false });
        scrollEl.addEventListener('wheel', onSelectWheelLock, { passive: true });
        wireSplitGutter();
        setupStatusChrome();
        setViewMode('print');

        ensureFindBar();
        rehydrateCommentAnchors();
        updateCommentsBadge();
        loadSystemFonts();
        renumberFootnotes();
        updateStatus();
        refreshStates();
        history.seed(serializeDoc());
        setTimeout(() => {
          if (destroyed) return;
          const body = getPage();
          if (body && isActiveTab()) {
            body.focus();
            const sel = window.getSelection();
            if (!sel.rangeCount || !pageBodyOf(sel.anchorNode)) {
              const c = document.createRange();
              c.selectNodeContents(body);
              c.collapse(true);
              sel.removeAllRanges();
              sel.addRange(c);
            }
            rememberSelection();
          }
        }, 60);
        // Fonts and images settle a frame or two after mount; measuring before
        // that would paginate against the wrong heights.
        requestAnimationFrame(() => schedulePaginate(pagesRoot.querySelector('.doc-page')));
        if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => schedulePaginate(pagesRoot && pagesRoot.querySelector('.doc-page')));

        function onSelChange() {
          // Fires for every caret move in the window, so the tabs behind this
          // one bow out before walking any ancestors.
          if (!isActiveTab()) return;
          const sel = document.getSelection();
          const anchor = sel && sel.anchorNode;
          if (!anchor || !pagesRoot) return;
          const p = (anchor.nodeType === 1 ? anchor : anchor.parentElement);
          const page = p && p.closest && p.closest('.doc-page');
          if (page && pagesRoot.contains(page)) {
            setActivePage(page);
            rememberSelection();
            scheduleRefreshStates();
          }
        }

        this._cleanup = () => {
          destroyed = true;
          closeContextMenu();
          closePopover();
          try { if (PICKER && PICKER.close) PICKER.close(); } catch {}
          stopPainter();
          hideImageOverlay();
          cancelTypingWork();
          cancelPaginate();
          if (statesRaf) { cancelAnimationFrame(statesRaf); statesRaf = 0; }
          if (unsubscribeSpell) { try { unsubscribeSpell(); } catch {} unsubscribeSpell = null; }
          document.removeEventListener('selectionchange', onSelChange);
          document.removeEventListener('keydown', onFindKeydown, true);
          document.removeEventListener('pointermove', onSelectPointerMove, true);
          document.removeEventListener('pointerup', onSelectPointerUp, true);
          document.removeEventListener('pointercancel', onSelectPointerCancel, true);
          endSelectDrag();
          clearCrossPageSelection();
          if (pagesRoot) {
            pagesRoot.removeEventListener('pointermove', onTableResizeHover);
            pagesRoot.removeEventListener('pointerdown', onTableResizeDown, true);
            pagesRoot.removeEventListener('pointerdown', onImagePointerDown, true);
            pagesRoot.removeEventListener('pointerdown', onSelectPointerDown);
            pagesRoot.removeEventListener('pointerup', onPainterPointerUp);
            pagesRoot.removeEventListener('click', onPagesClick);
            pagesRoot.removeEventListener('dblclick', onPagesDblClick);
            pagesRoot.removeEventListener('copy', onPageCopy);
            pagesRoot.removeEventListener('cut', onPageCut);
            pagesRoot.removeEventListener('keydown', onPageKeydown);
            pagesRoot.removeEventListener('keydown', onEditorKeydown);
            pagesRoot.removeEventListener('contextmenu', onPageContextMenu);
            pagesRoot.removeEventListener('paste', onPaste);
            pagesRoot.removeEventListener('dragstart', onDragStart);
            pagesRoot.removeEventListener('dragend', onDragEnd);
            pagesRoot.removeEventListener('dragover', onDragOver);
            pagesRoot.removeEventListener('drop', onDrop);
            pagesRoot.style.cursor = '';
          }
          if (scrollEl) {
            scrollEl.removeEventListener('wheel', onCtrlWheel);
            scrollEl.removeEventListener('wheel', onSelectWheelLock);
          }
          if (document.body.classList.contains('margo-focus-mode')) toggleFocusMode();
          unwrapFindMarks();
        };
        this._test = {
          addPage: () => addPage(),
          openFind,
          addComment,
          openContextMenu: (x, y) => openContextMenu(x, y),
          closeContextMenu,
          openStats: openStatsModal,
          openSymbols: () => openSymbolsPicker(),
          selectAll: () => selectAllDocument(),
          copyPayload: () => buildCopyPayload(),
          currentZoom: () => currentZoom(),
          usableHeight: (pageEl) => usableHeight(pageEl || getPageEl()),
          layoutHeight: (el) => layoutHeight(el),
          flushTypingWork: () => flushTypingWork(),
          pageCount: () => pageList().length,
          paginateScheduled: () => !!paginateTimer,
          paginating: () => paginating,
          repaginateNow: () => { cancelPaginate(); return repaginate(pageList()[0]); },
          crossPageSpan: () => getCopySpan(),
          dragSelect: (fromBody, toBody) => {
            if (!fromBody || !toBody) return false;
            const start = { node: fromBody, offset: 0 };
            const end = { node: toBody, offset: toBody.childNodes.length };
            return applyCrossSelection(start, end);
          },
          crossPageHighlightActive: () => (
            supportsCssHighlights() && CSS.highlights.has(CROSS_SEL_HIGHLIGHT)
          ),
          overlayBoxCount: () => document.querySelectorAll('.doc-cross-sel-box').length,
          viewMode: () => viewMode,
          splitPreviewVisible: () => !!(splitPreviewScroll && !splitPreviewScroll.classList.contains('hidden')),
          pageBodiesEditable: () => pageList().every((pg) => {
            const b = pg.querySelector('.doc-page-body');
            return !b || b.contentEditable !== 'false';
          }),
          // feature hooks for the smoke suite
          applyStyle: (id) => applyParagraphStyle(id),
          lineSpacing: (v) => applyLineSpacing(v),
          paraSpacing: (which, pt) => applyParagraphSpacing(which, pt),
          indent: (dir) => indent(dir),
          toggleList: (k) => toggleList(k),
          highlight: (hex) => applyTextHighlight(hex),
          textColor: (hex) => applyTextColor(hex),
          clearFormatting: () => clearFormatting(),
          changeCase: (m) => transformTextCase(m),
          insertTable: (r, c) => insertTableAt(r, c),
          insertRow: (w) => insertRow(w),
          insertCol: (w) => insertCol(w),
          deleteRow: () => deleteRowOp(),
          deleteCol: () => deleteColOp(),
          mergeCells: () => mergeCells(),
          splitCell: () => splitCellOp(),
          headerRow: () => toggleHeaderRow(),
          borders: (m) => setTableBorders(m),
          pageBreak: () => insertPageBreak(),
          insertToc: () => insertToc(),
          updateToc: () => updateToc(true),
          insertFootnote: () => insertFootnote(),
          cleanPaste: (html) => cleanPastedHtml(html),
          paste: (html) => insertHtmlAtCaret(cleanPastedHtml(html)),
          capturePainter: () => togglePainter(false),
          applyFormat: (fmt) => applyCapturedFormat(fmt),
          captureFormat: () => captureFormat(),
          painterActive: () => !!painter,
          setLayout: (patch) => setLayout(patch),
          layout: () => ({ ...layout }),
          selectImage: (img) => selectImage(img),
          imageOverlay: () => imgOverlay,
          setFindOption: (k, v) => { findOpts[k] = !!v; },
          findHits: () => findHits.length,
          runFind: (q) => runFind(q),
          replaceAll: () => replaceAll(),
          setSpellcheck: (on) => setSpellcheck(on),
          spellcheckOn: () => spellEnabled,
          showTab: (id) => showRibbonTab(id),
          undo: () => undo(),
          redo: () => redo(),
          status: () => statusLine(),
          fontSize: (pt) => setFontSize(pt),
          contextItems: () => contextMenuItems().filter((i) => !i.sep).map((i) => i.label)
        };
      },
      getData() {
        return serializeDoc();
      },
      focus() {
        if (destroyed) return;
        if (!ensureSelection()) { const p = getPage(); if (p) p.focus(); }
      },
      destroy() { if (this._cleanup) this._cleanup(); },
      commands: {
        undo,
        redo,
        canUndo: () => history.canUndo(),
        canRedo: () => history.canRedo(),
        copy: () => execClipboardCommand('copy'),
        cut: () => execClipboardCommand('cut'),
        selectAll: () => selectAllDocument(),
        paste: (t) => {
          if (!t) { pasteFromClipboard(); return; }
          const asHtml = plainTextToHtml(t);
          if (asHtml) insertHtmlAtCaret(asHtml);
          else insertTextAtCaret(t);
        },
        addPage: () => addPage(),
        pageBreak: () => insertPageBreak(),
        find: () => openFind(false),
        replace: () => openFind(true),
        zoomIn: () => zoomBy(1.1),
        zoomOut: () => zoomBy(1 / 1.1),
        zoomReset: () => { zoom = 1; applyZoom(); },
        setZoom: (z) => setZoomLevel(z),
        getZoom: () => zoom,
        setViewMode: (m) => setViewMode(m),
        getViewMode: () => viewMode,
        outline: () => toggleOutlineRail(),
        stats: () => openStatsModal(),
        focusMode: () => toggleFocusMode(),
        extractImages: () => showDocumentImagesPanel(),
        insertTable: () => { const b = ribbonTabs.insert; showRibbonTab('insert'); const t = ribbonPanels.insert.querySelector('[title="Insert table"]'); if (t) openTableSizePicker(t); else if (b) b.click(); },
        insertImage: () => insertImageFromDialog(),
        insertLink: () => insertLinkFromDialog(),
        insertComment: () => addComment(),
        insertToc: () => insertToc(),
        insertFootnote: () => insertFootnote(),
        headerFooter: () => openHeaderFooterEditor(null, 'header'),
        spellcheck: (on) => setSpellcheck(on == null ? !spellEnabled : on),
        /* One line for the status bar: "1,204 words · 6,812 characters ·
           Page 2 of 5", counted from the page bodies only. */
        status: () => statusLine()
      }
    };
  }

  window.MargoEditors = window.MargoEditors || {};
  window.MargoEditors.doc = create;
})();
