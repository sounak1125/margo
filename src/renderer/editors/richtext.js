/* Margo — professional rich text editor for Word documents (multi-page, Ribbon UI, layout engine) */
(function () {
  const ALLOWED_TAGS = [
    'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'sub', 'sup',
    'ul', 'ol', 'li', 'a', 'br', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'colgroup', 'col',
    'img', 'figure', 'figcaption', 'blockquote', 'code', 'pre', 'div', 'span', 'hr', 'font', 'mark'
  ];
  const ALLOWED_ATTR = [
    'href', 'src', 'alt', 'style', 'colspan', 'rowspan', 'face', 'color', 'class', 'align', 'valign', 'bgcolor',
    'data-margo-page-break', 'data-margo-note-id', 'data-callout-type', 'data-align', 'data-width'
  ];
  const PAGE_BREAK_HTML = '<div data-margo-page-break style="page-break-before:always"></div>';
  const EMPTY_PAGE = '<p><br></p>';

  const FONT_FAMILIES = [
    'Calibri', 'Arial', 'Times New Roman', 'Segoe UI', 'Georgia',
    'Verdana', 'Trebuchet MS', 'Garamond', 'Courier New', 'Consolas', 'Tahoma', 'Palatino Linotype'
  ];
  const FONT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 22, 24, 28, 32, 36, 48, 72];
  const INK_COLORS = [
    '#1d1d1f', '#4b5563', '#6b7280', '#9ca3af',
    '#b42318', '#dc2626', '#ea580c', '#d97706',
    '#16a34a', '#059669', '#0284c7', '#2563eb',
    '#4f46e5', '#7c3aed', '#c026d3', '#db2777'
  ];
  const HL_COLORS = [
    { name: 'Yellow', color: '#fef08a', class: 'hl-yellow' },
    { name: 'Green', color: '#bbf7d0', class: 'hl-green' },
    { name: 'Cyan', color: '#a5f3fc', class: 'hl-cyan' },
    { name: 'Pink', color: '#fbcfe8', class: 'hl-pink' },
    { name: 'Orange', color: '#fed7aa', class: 'hl-orange' },
    { name: 'Purple', color: '#e9d5ff', class: 'hl-purple' },
    { name: 'Red', color: '#fecaca', class: 'hl-red' }
  ];
  const SHADING_COLORS = [
    '#ffffff', '#f8fafc', '#f1f5f9', '#e2e8f0', '#cbd5e1',
    '#fef2f2', '#fee2e2', '#fef3c7', '#fde68a', '#ecfdf5',
    '#d1fae5', '#eff6ff', '#dbeafe', '#f5f3ff', '#ede9fe'
  ];
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
      title: 'Shapes & Emojis',
      symbols: ['✓', '✔', '✕', '✖', '★', '☆', '✦', '✧', '♠', '♣', '♥', '♦', '☺', '☻', '♫', '♪', '⚡', '❄', '☀', '☁', '☕', '✉', '✂', '🔒']
    }
  ];
  const TEMP_FONT_FACE = '__margo_face__';

  function parseFontFaceStyle(style) {
    const s = String(style || 'Regular').trim() || 'Regular';
    const lower = s.toLowerCase().replace(/[_\s]+/g, '');
    const italic = lower.includes('italic') || lower.includes('oblique');
    let weight = 400;
    if (lower.includes('thin') || lower.includes('hairline')) weight = 100;
    else if (lower.includes('extralight') || lower.includes('ultralight')) weight = 200;
    else if (lower.includes('light')) weight = 300;
    else if (lower.includes('medium')) weight = 500;
    else if (lower.includes('semibold') || lower.includes('demibold')) weight = 600;
    else if (lower.includes('extrabold') || lower.includes('ultrabold')) weight = 800;
    else if (lower.includes('black') || lower.includes('heavy')) weight = 900;
    else if (lower.includes('bold')) weight = 700;
    return { weight, fontStyle: italic ? 'italic' : 'normal', label: s };
  }

  function parseCssFontWeight(w) {
    if (w === 'bold') return 700;
    if (w === 'normal') return 400;
    const n = parseInt(w, 10);
    return Number.isFinite(n) ? n : 400;
  }

  function compareFontFaces(a, b) {
    const pa = parseFontFaceStyle(a.style);
    const pb = parseFontFaceStyle(b.style);
    const ka = pa.weight * 2 + (pa.fontStyle === 'italic' ? 1 : 0);
    const kb = pb.weight * 2 + (pb.fontStyle === 'italic' ? 1 : 0);
    return ka - kb || String(a.style).localeCompare(String(b.style));
  }

  function matchFaceFromComputed(faces, fontWeight, fontStyle) {
    const w = parseCssFontWeight(fontWeight);
    const italic = String(fontStyle || '').includes('italic') || String(fontStyle || '').includes('oblique');
    let best = faces[0] ? faces[0].style : 'Regular';
    let bestScore = Infinity;
    faces.forEach((face) => {
      const p = parseFontFaceStyle(face.style);
      const score = Math.abs(p.weight - w) + (p.fontStyle === (italic ? 'italic' : 'normal') ? 0 : 50);
      if (score < bestScore) {
        bestScore = score;
        best = face.style;
      }
    });
    return best;
  }

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

  function create(ctx) {
    let pagesRoot = null;
    let scrollEl = null;
    let hostEl = null;
    let activePage = null;
    let savedRange = null;
    let zoom = 1;
    const stateButtons = {};
    let blockSelect = null, familySelect = null, variantSelect = null, sizeSelect = null;
    let availableFonts = FONT_FAMILIES.slice();
    let fontFacesByFamily = new Map(
      FONT_FAMILIES.map((f) => [f, [{ style: 'Regular', fullName: f }]])
    );
    let tableBtns = {};
    let notes = [];
    let notesRail = null;
    let notesFab = null;
    let notesBadge = null;
    let outlineRail = null;
    let findBar = null;
    let findInput = null;
    let replaceInput = null;
    let findCountEl = null;
    let findHits = [];
    let findIndex = -1;
    let findOpen = false;
    let activeRibbonTab = 'home';

    // Layout configuration state
    let layout = {
      size: 'letter',
      orientation: 'portrait',
      margins: 'normal',
      columns: 1,
      headerText: '',
      footerText: '',
      showPageNumbers: true
    };

    function getPageEl() {
      return activePage || (pagesRoot && pagesRoot.querySelector('.doc-page'));
    }
    function getPage() {
      const page = getPageEl();
      return page ? (page.querySelector('.doc-page-body') || page) : null;
    }

    function pageList() {
      return pagesRoot ? Array.from(pagesRoot.querySelectorAll('.doc-page')) : [];
    }

    function setActivePage(el) {
      if (el && el.classList && el.classList.contains('doc-page')) activePage = el;
    }

    function exec(cmd, value, withCss) {
      const page = getPage();
      if (!page) return;
      page.focus();
      try { document.execCommand('styleWithCSS', false, !!withCss); } catch {}
      document.execCommand(cmd, false, value ?? null);
      try { document.execCommand('styleWithCSS', false, false); } catch {}
      ctx.markDirty();
      refreshStates();
      updateStatus();
    }

    function setFontSize(pt) {
      const page = getPage();
      if (!page) return;
      page.focus();
      try { document.execCommand('styleWithCSS', false, false); } catch {}
      document.execCommand('fontSize', false, '7');
      page.querySelectorAll('font[size="7"]').forEach((f) => {
        const span = document.createElement('span');
        span.style.fontSize = pt + 'pt';
        while (f.firstChild) span.appendChild(f.firstChild);
        f.replaceWith(span);
      });
      ctx.markDirty();
      refreshStates();
      updateStatus();
    }

    function stepFontSize(delta) {
      const cur = parseInt(sizeSelect ? sizeSelect.value : '11', 10) || 11;
      let next = cur + delta;
      if (next < 8) next = 8;
      if (next > 72) next = 72;
      if (sizeSelect) sizeSelect.value = String(next);
      setFontSize(next);
    }

    function applyFontFace(family, styleLabel) {
      const page = getPage();
      if (!page || !family) return;
      page.focus();
      const { weight, fontStyle } = parseFontFaceStyle(styleLabel);
      try { document.execCommand('styleWithCSS', false, false); } catch {}
      document.execCommand('fontName', false, TEMP_FONT_FACE);
      page.querySelectorAll(`font[face="${TEMP_FONT_FACE}"]`).forEach((f) => {
        const span = document.createElement('span');
        span.style.fontFamily = `"${family}"`;
        span.style.fontWeight = String(weight);
        span.style.fontStyle = fontStyle;
        while (f.firstChild) span.appendChild(f.firstChild);
        f.replaceWith(span);
      });
      ctx.markDirty();
      refreshStates();
    }

    function getFacesForFamily(family) {
      if (!family) return [{ style: 'Regular', fullName: 'Regular' }];
      if (fontFacesByFamily.has(family)) return fontFacesByFamily.get(family);
      const lower = family.toLowerCase();
      for (const [name, faces] of fontFacesByFamily) {
        if (name.toLowerCase() === lower) return faces;
      }
      return [{ style: 'Regular', fullName: family }];
    }

    function fillVariantSelect(family, preferredStyle) {
      if (!variantSelect) return;
      const faces = getFacesForFamily(family);
      const multi = faces.length > 1;
      const current = preferredStyle || variantSelect.value;
      variantSelect.innerHTML = '';
      faces.forEach((face) => {
        const o = document.createElement('option');
        o.value = face.style;
        o.textContent = face.style;
        variantSelect.appendChild(o);
      });
      const styles = faces.map((f) => f.style);
      let pick = null;
      if (current && styles.includes(current)) pick = current;
      else {
        pick = styles.find((s) => /^regular$/i.test(s) || /^normal$/i.test(s)) || styles[0] || 'Regular';
      }
      variantSelect.value = pick;
      variantSelect.disabled = !multi;
      variantSelect.title = multi ? 'Font style' : 'Font style (only one face installed)';
    }

    function normalizeFonts(root) {
      root.querySelectorAll('font').forEach((f) => {
        const span = document.createElement('span');
        if (f.getAttribute('face')) span.style.fontFamily = f.getAttribute('face');
        if (f.getAttribute('color')) span.style.color = f.getAttribute('color');
        while (f.firstChild) span.appendChild(f.firstChild);
        f.replaceWith(span);
      });
    }

    function saveSelection() {
      const page = getPage();
      const sel = window.getSelection();
      if (page && sel.rangeCount && page.contains(sel.anchorNode)) {
        savedRange = sel.getRangeAt(0).cloneRange();
      }
    }

    function restoreSelection() {
      if (!savedRange) return;
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(savedRange);
    }

    function applyTextHighlight(colorClass, hexColor) {
      restoreSelection();
      const sel = window.getSelection();
      if (!sel.rangeCount || sel.isCollapsed) return;
      const range = sel.getRangeAt(0);
      if (!colorClass || colorClass === 'none') {
        exec('removeFormat');
        return;
      }
      const mark = document.createElement('mark');
      mark.className = colorClass;
      mark.style.backgroundColor = hexColor;
      try {
        range.surroundContents(mark);
      } catch {
        const frag = range.extractContents();
        mark.appendChild(frag);
        range.insertNode(mark);
      }
      ctx.markDirty();
    }

    function applyLineSpacing(spacing) {
      const sel = window.getSelection();
      if (!sel || !sel.anchorNode) return;
      let node = sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement;
      const page = getPage();
      if (!page || !page.contains(node)) return;
      const block = node.closest('p, h1, h2, h3, h4, h5, h6, blockquote, li') || node;
      if (block) {
        block.style.lineHeight = String(spacing);
        ctx.markDirty();
      }
    }

    function transformTextCase(mode) {
      restoreSelection();
      const sel = window.getSelection();
      if (!sel.rangeCount || sel.isCollapsed) return;
      const str = sel.toString();
      let res = str;
      if (mode === 'upper') res = str.toUpperCase();
      else if (mode === 'lower') res = str.toLowerCase();
      else if (mode === 'title') {
        res = str.replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase());
      } else if (mode === 'sentence') {
        res = str.toLowerCase().replace(/(^\s*\w|[.!?]\s*\w)/g, (c) => c.toUpperCase());
      }
      exec('insertText', res);
    }

    function selectionInTable() {
      const sel = window.getSelection();
      if (!sel || !sel.anchorNode || !pagesRoot) return null;
      const el = sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement;
      if (!el || !pagesRoot.contains(el)) return null;
      const cell = el.closest('td, th');
      if (!cell) return null;
      const table = cell.closest('table');
      if (!table || !pagesRoot.contains(table)) return null;
      const row = cell.parentElement;
      return { table, row, cell };
    }

    function refreshStates() {
      for (const [cmd, b] of Object.entries(stateButtons)) {
        let on = false;
        try { on = document.queryCommandState(cmd); } catch {}
        b.classList.toggle('active', on);
      }
      if (blockSelect) {
        let v = '';
        try { v = (document.queryCommandValue('formatBlock') || '').toLowerCase(); } catch {}
        blockSelect.value = ['h1', 'h2', 'h3', 'blockquote', 'pre'].includes(v) ? v : 'p';
      }
      if (familySelect) {
        let f = '';
        try { f = (document.queryCommandValue('fontName') || '').replace(/["']/g, ''); } catch {}
        if (f === TEMP_FONT_FACE) f = '';
        const match = availableFonts.find((n) => f.toLowerCase().startsWith(n.toLowerCase()));
        if (match) familySelect.value = match;
        else if (availableFonts.includes('Calibri')) familySelect.value = 'Calibri';
      }
      if (variantSelect && familySelect) {
        let preferred = null;
        try {
          const page = getPage();
          const sel = window.getSelection();
          let node = sel && sel.anchorNode;
          if (node && node.nodeType === 3) node = node.parentElement;
          if (page && node && page.contains(node)) {
            const cs = getComputedStyle(node);
            preferred = matchFaceFromComputed(getFacesForFamily(familySelect.value), cs.fontWeight, cs.fontStyle);
          }
        } catch {}
        fillVariantSelect(familySelect.value, preferred);
      }
      if (sizeSelect) {
        let pt = 11;
        try {
          const page = getPage();
          const sel = window.getSelection();
          let node = sel.anchorNode;
          if (node && node.nodeType === 3) node = node.parentElement;
          if (page && node && page.contains(node)) {
            pt = Math.round(parseFloat(getComputedStyle(node).fontSize) * 72 / 96);
          }
        } catch {}
        sizeSelect.value = FONT_SIZES.includes(pt) ? String(pt) : '';
      }
      const inTable = !!selectionInTable();
      Object.values(tableBtns).forEach((b) => { if (b) b.disabled = !inTable; });
    }

    function updatePageHeadersAndFooters() {
      if (!pagesRoot) return;
      const pages = pageList();
      const total = pages.length;
      pages.forEach((page, idx) => {
        const header = page.querySelector('.doc-page-header');
        const footer = page.querySelector('.doc-page-footer');
        if (header) {
          header.innerHTML = `<span>${escapeHtml(layout.headerText || '')}</span>`;
        }
        if (footer) {
          const pNum = layout.showPageNumbers ? `Page ${idx + 1} of ${total}` : '';
          footer.innerHTML = `<span>${escapeHtml(layout.footerText || '')}</span><span>${pNum}</span>`;
        }
      });
    }

    function applyLayoutAttributes() {
      if (!pagesRoot) return;
      pagesRoot.dataset.size = layout.size || 'letter';
      pagesRoot.dataset.orientation = layout.orientation || 'portrait';
      pagesRoot.dataset.margins = layout.margins || 'normal';
      pagesRoot.dataset.columns = String(layout.columns || 1);
      updatePageHeadersAndFooters();
    }

    function updateStatus() {
      const pages = pageList();
      const text = pages.map((p) => p.innerText || '').join('\n');
      const words = (text.trim().match(/\S+/g) || []).length;
      const n = pages.length;
      const pagePart = n === 1 ? '1 page' : n + ' pages';
      const z = zoom !== 1 ? ` · ${Math.round(zoom * 100)}%` : '';
      const geom = `${(layout.size || 'letter').toUpperCase()} · ${layout.orientation === 'landscape' ? 'Landscape' : 'Portrait'}`;
      ctx.setStatus(
        `${pagePart} · ${words} word${words === 1 ? '' : 's'} · ${text.length} chars · ${geom}${z}`,
        'Word document'
      );
      updatePageHeadersAndFooters();
      if (outlineRail && !outlineRail.classList.contains('hidden')) renderOutline();
    }

    function applyZoom(clientX, clientY) {
      if (!scrollEl || !pagesRoot) return;
      const prev = parseFloat(pagesRoot.style.zoom) || 1;
      const next = zoom;
      const rect = scrollEl.getBoundingClientRect();
      const mx = clientX != null ? clientX - rect.left : scrollEl.clientWidth / 2;
      const my = clientY != null ? clientY - rect.top : scrollEl.clientHeight / 2;
      pagesRoot.style.zoom = String(next);
      if (prev !== next) {
        const ratio = next / prev;
        scrollEl.scrollLeft = (scrollEl.scrollLeft + mx) * ratio - mx;
        scrollEl.scrollTop = (scrollEl.scrollTop + my) * ratio - my;
      }
      updateStatus();
    }

    function zoomBy(factor, clientX, clientY) {
      const next = Math.min(2.5, Math.max(0.4, +(zoom * factor).toFixed(4)));
      if (next === zoom) return;
      zoom = next;
      applyZoom(clientX, clientY);
    }

    function onCtrlWheel(e) {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1, e.clientX, e.clientY);
    }

    function makePageEl(html) {
      const el = document.createElement('div');
      el.className = 'doc-page';

      const header = document.createElement('div');
      header.className = 'doc-page-header';
      header.contentEditable = 'false';

      const body = document.createElement('div');
      body.className = 'doc-page-body';
      body.contentEditable = 'true';
      body.spellcheck = true;
      body.innerHTML = sanitizeHtml(html);

      const footer = document.createElement('div');
      footer.className = 'doc-page-footer';
      footer.contentEditable = 'false';

      el.appendChild(header);
      el.appendChild(body);
      el.appendChild(footer);
      body.querySelectorAll('img').forEach((img) => {
        img.loading = 'lazy';
        img.decoding = 'async';
      });
      return el;
    }

    function addPage(html) {
      if (!pagesRoot) return null;
      const el = makePageEl(html || EMPTY_PAGE);
      pagesRoot.appendChild(el);
      setActivePage(el);
      ctx.markDirty();
      updateStatus();
      setTimeout(() => {
        const body = el.querySelector('.doc-page-body') || el;
        body.focus();
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 40);
      return el;
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
      exec('insertHTML', buildTableHtml(rows, cols));
    }

    function openTableSizePicker(anchorBtn) {
      const existing = anchorBtn.querySelector('.table-size-pop');
      if (existing) {
        if (existing._margoCleanup) existing._margoCleanup();
        else existing.remove();
        return;
      }
      saveSelection();
      const pop = document.createElement('div');
      pop.className = 'table-size-pop';
      const label = document.createElement('div');
      label.className = 'table-size-label';
      label.textContent = '1 × 1 table';
      const grid = document.createElement('div');
      grid.className = 'table-size-grid';
      grid.style.gridTemplateColumns = `repeat(${TABLE_PICKER_COLS}, 1fr)`;

      let selRows = 1;
      let selCols = 1;
      let dragging = false;
      const cells = [];

      function paint(r, c) {
        selRows = Math.max(1, Math.min(TABLE_PICKER_ROWS, r));
        selCols = Math.max(1, Math.min(TABLE_PICKER_COLS, c));
        cells.forEach((cell) => {
          const rr = Number(cell.dataset.row);
          const cc = Number(cell.dataset.col);
          cell.classList.toggle('active', rr <= selRows && cc <= selCols);
        });
        label.textContent = `${selRows} × ${selCols} table`;
      }

      function cleanup() {
        pop.remove();
        document.removeEventListener('mousedown', dismiss, true);
        document.removeEventListener('mouseup', endDrag, true);
      }
      function dismiss(e) {
        if (!pop.contains(e.target) && e.target !== anchorBtn && !anchorBtn.contains(e.target)) {
          cleanup();
        }
      }
      function endDrag() {
        dragging = false;
      }
      pop._margoCleanup = cleanup;

      for (let r = 1; r <= TABLE_PICKER_ROWS; r++) {
        for (let c = 1; c <= TABLE_PICKER_COLS; c++) {
          const cell = document.createElement('button');
          cell.type = 'button';
          cell.className = 'table-size-cell';
          cell.dataset.row = String(r);
          cell.dataset.col = String(c);
          cell.setAttribute('aria-label', `${r} by ${c}`);
          cell.addEventListener('mouseenter', () => paint(r, c));
          cell.addEventListener('mousedown', (e) => {
            e.preventDefault();
            e.stopPropagation();
            dragging = true;
            paint(r, c);
          });
          cell.addEventListener('mouseup', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const rows = selRows;
            const cols = selCols;
            cleanup();
            insertTableAt(rows, cols);
          });
          grid.appendChild(cell);
          cells.push(cell);
        }
      }

      paint(1, 1);
      pop.appendChild(grid);
      pop.appendChild(label);
      anchorBtn.appendChild(pop);

      setTimeout(() => {
        document.addEventListener('mousedown', dismiss, true);
        document.addEventListener('mouseup', endDrag, true);
      }, 0);
    }

    function addTableRow() {
      const ctxTbl = selectionInTable();
      if (!ctxTbl) return;
      const cols = ctxTbl.row.children.length;
      const tr = document.createElement('tr');
      for (let i = 0; i < cols; i++) {
        const td = document.createElement('td');
        td.innerHTML = '<br>';
        tr.appendChild(td);
      }
      ctxTbl.row.after(tr);
      ctx.markDirty();
      refreshStates();
    }

    function addTableCol() {
      const ctxTbl = selectionInTable();
      if (!ctxTbl) return;
      const idx = Array.from(ctxTbl.row.children).indexOf(ctxTbl.cell);
      ctxTbl.table.querySelectorAll('tr').forEach((tr) => {
        const cell = document.createElement(tr.children[idx] && tr.children[idx].tagName === 'TH' ? 'th' : 'td');
        cell.innerHTML = '<br>';
        if (tr.children[idx]) tr.children[idx].after(cell);
        else tr.appendChild(cell);
      });
      const cg = ctxTbl.table.querySelector(':scope > colgroup');
      if (cg) {
        const col = document.createElement('col');
        col.style.width = '80px';
        if (cg.children[idx]) cg.children[idx].after(col);
        else cg.appendChild(col);
      }
      ctx.markDirty();
      refreshStates();
    }

    function deleteTableRow() {
      const ctxTbl = selectionInTable();
      if (!ctxTbl) return;
      const body = ctxTbl.table.querySelector('tbody') || ctxTbl.table;
      if (body.querySelectorAll('tr').length <= 1) {
        ctxTbl.table.remove();
      } else {
        ctxTbl.row.remove();
      }
      ctx.markDirty();
      refreshStates();
    }

    function deleteTableCol() {
      const ctxTbl = selectionInTable();
      if (!ctxTbl) return;
      const idx = Array.from(ctxTbl.row.children).indexOf(ctxTbl.cell);
      const rows = ctxTbl.table.querySelectorAll('tr');
      if (rows[0] && rows[0].children.length <= 1) {
        ctxTbl.table.remove();
      } else {
        rows.forEach((tr) => {
          if (tr.children[idx]) tr.children[idx].remove();
        });
        const cg = ctxTbl.table.querySelector('colgroup');
        if (cg && cg.children[idx]) cg.children[idx].remove();
      }
      ctx.markDirty();
      refreshStates();
    }

    function setTableCellShading(color) {
      const ctxTbl = selectionInTable();
      if (!ctxTbl) return;
      ctxTbl.cell.style.backgroundColor = color || '';
      ctx.markDirty();
    }

    /* ---------- table border resize ---------- */
    const TABLE_EDGE = 5;
    const MIN_COL_W = 32;
    const MIN_ROW_H = 24;
    let tableResize = null;

    function tableColumnCount(table) {
      let max = 0;
      table.querySelectorAll('tr').forEach((tr) => {
        let n = 0;
        Array.from(tr.children).forEach((cell) => {
          if (cell.matches('td, th')) n += Number(cell.getAttribute('colspan') || 1);
        });
        if (n > max) max = n;
      });
      return max;
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
      const row = cell.parentElement;
      let idx = 0;
      for (const c of row.children) {
        if (!c.matches('td, th')) continue;
        if (c === cell) return idx + Number(c.getAttribute('colspan') || 1) - 1;
        idx += Number(c.getAttribute('colspan') || 1);
      }
      return idx;
    }

    function hitTestTableResize(clientX, clientY) {
      if (!pagesRoot) return null;
      const el = document.elementFromPoint(clientX, clientY);
      if (!el || !pagesRoot.contains(el)) return null;
      const cell = el.closest && el.closest('td, th');
      if (!cell || !pagesRoot.contains(cell)) return null;
      const table = cell.closest('table');
      if (!table || !pagesRoot.contains(table)) return null;

      const rect = cell.getBoundingClientRect();
      const nearRight = clientX >= rect.right - TABLE_EDGE && clientX <= rect.right + TABLE_EDGE;
      const nearBottom = clientY >= rect.bottom - TABLE_EDGE && clientY <= rect.bottom + TABLE_EDGE;

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
      if (tableResize || !pagesRoot) return;
      const hit = hitTestTableResize(e.clientX, e.clientY);
      if (hit) {
        pagesRoot.style.cursor = hit.type === 'col' ? 'col-resize' : 'row-resize';
      } else if (pagesRoot.style.cursor === 'col-resize' || pagesRoot.style.cursor === 'row-resize') {
        pagesRoot.style.cursor = '';
      }
    }

    function onTableResizeDown(e) {
      if (e.button !== 0 || !pagesRoot) return;
      const hit = hitTestTableResize(e.clientX, e.clientY);
      if (!hit) return;
      e.preventDefault();
      e.stopPropagation();

      const cg = ensureColgroup(hit.table);
      hit.table.classList.add('margo-table-resizing');

      if (hit.type === 'col') {
        const col = cg.children[hit.colIndex];
        const next = cg.children[hit.colIndex + 1] || null;
        if (!col) return;
        tableResize = {
          type: 'col',
          table: hit.table,
          isOuter: hit.isOuter || !next,
          col,
          next,
          startX: e.clientX,
          startW: col.getBoundingClientRect().width,
          startNextW: next ? next.getBoundingClientRect().width : 0,
          startTableW: hit.table.getBoundingClientRect().width
        };
      } else {
        const tr = hit.tr || hit.table.querySelectorAll('tr')[hit.rowIndex];
        if (!tr) return;
        tableResize = {
          type: 'row',
          table: hit.table,
          tr,
          startY: e.clientY,
          startH: tr.getBoundingClientRect().height
        };
      }

      const onMove = (ev) => {
        if (!tableResize) return;
        if (tableResize.type === 'col') {
          const dx = ev.clientX - tableResize.startX;
          const newW = Math.max(MIN_COL_W, tableResize.startW + dx);
          tableResize.col.style.width = Math.round(newW) + 'px';
        } else {
          const dy = ev.clientY - tableResize.startY;
          const h = Math.max(MIN_ROW_H, Math.round(tableResize.startH + dy));
          tableResize.tr.style.height = h + 'px';
        }
      };

      const onUp = () => {
        if (tableResize) {
          tableResize.table.classList.remove('margo-table-resizing');
          ctx.markDirty();
        }
        tableResize = null;
        document.removeEventListener('pointermove', onMove, true);
        document.removeEventListener('pointerup', onUp, true);
        if (pagesRoot) pagesRoot.style.cursor = '';
      };

      document.addEventListener('pointermove', onMove, true);
      document.addEventListener('pointerup', onUp, true);
    }

    /* ---------- Image Insertion, Extraction & Callouts ---------- */
    function insertImageFromDialog() {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.addEventListener('change', () => {
        const file = input.files && input.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
          const src = e.target.result;
          restoreSelection();
          const figure = document.createElement('figure');
          figure.className = 'margo-figure align-center';
          figure.innerHTML =
            `<img src="${src}" style="max-width:100%;"><figcaption contenteditable="true">Image caption</figcaption>`;
          exec('insertHTML', figure.outerHTML + '<p><br></p>');
        };
        reader.readAsDataURL(file);
      });
      input.click();
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
      exportAllBtn.textContent = '📁 Export All to Folder…';
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

    function insertCallout(type) {
      restoreSelection();
      const titles = { tip: '💡 Pro Tip', note: '📌 Note', warning: '⚠️ Important Warning', quote: '❝ Key Takeaway' };
      const callout = document.createElement('div');
      callout.className = `margo-callout margo-callout-${type}`;
      callout.setAttribute('data-callout-type', type);
      callout.innerHTML =
        `<div class="margo-callout-title" contenteditable="true">${titles[type] || 'Note'}</div>` +
        `<div contenteditable="true">Write callout content here…</div>`;
      exec('insertHTML', callout.outerHTML + '<p><br></p>');
    }

    function insertDate(format) {
      restoreSelection();
      const now = new Date();
      let str = now.toLocaleDateString();
      if (format === 'iso') str = now.toISOString().split('T')[0];
      else if (format === 'long') str = now.toLocaleDateString(undefined, { dateStyle: 'long' });
      else if (format === 'time') str = now.toLocaleTimeString();
      exec('insertText', str);
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
          btn.addEventListener('click', () => {
            ctx.modalBackdrop.classList.add('hidden');
            restoreSelection();
            exec('insertText', sym);
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
      const fullText = pages.map((p) => p.innerText || '').join('\n');
      const words = (fullText.trim().match(/\S+/g) || []).length;
      const chars = fullText.length;
      const charsNoSpace = fullText.replace(/\s+/g, '').length;
      const paragraphs = fullText.split(/\n+/).filter((p) => p.trim().length > 0).length;
      const readMin = Math.max(1, Math.ceil(words / 200));
      const speakMin = Math.max(1, Math.ceil(words / 130));

      const wrap = document.createElement('div');
      wrap.innerHTML =
        `<div class="doc-stats-grid">` +
          `<div class="doc-stats-card"><span class="doc-stats-val">${pages.length}</span><span class="doc-stats-lbl">Pages</span></div>` +
          `<div class="doc-stats-card"><span class="doc-stats-val">${words.toLocaleString()}</span><span class="doc-stats-lbl">Words</span></div>` +
          `<div class="doc-stats-card"><span class="doc-stats-val">${chars.toLocaleString()}</span><span class="doc-stats-lbl">Characters (with spaces)</span></div>` +
          `<div class="doc-stats-card"><span class="doc-stats-val">${charsNoSpace.toLocaleString()}</span><span class="doc-stats-lbl">Characters (no spaces)</span></div>` +
          `<div class="doc-stats-card"><span class="doc-stats-val">${paragraphs}</span><span class="doc-stats-lbl">Paragraphs</span></div>` +
          `<div class="doc-stats-card"><span class="doc-stats-val">~${readMin} min</span><span class="doc-stats-lbl">Reading Time</span></div>` +
        `</div>`;

      ctx.openModal('Document Statistics', wrap, [{ label: 'OK', primary: true, value: true }]);
    }

    /* ---------- Outline Navigator Drawer ---------- */
    function renderOutline() {
      if (!outlineRail) return;
      const list = outlineRail.querySelector('.doc-outline-list');
      list.innerHTML = '';
      if (!pagesRoot) return;
      const headings = Array.from(pagesRoot.querySelectorAll('h1, h2, h3'));
      if (!headings.length) {
        list.innerHTML = '<div class="doc-outline-empty">No headings found. Use Heading 1, Heading 2, or Heading 3 in your text to build an outline.</div>';
        return;
      }
      headings.forEach((h) => {
        const item = document.createElement('div');
        const tag = h.tagName.toLowerCase();
        item.className = `doc-outline-item ${tag}`;
        const title = (h.innerText || '').trim() || 'Untitled section';
        item.innerHTML = `<span class="doc-outline-tag">${tag.toUpperCase()}</span><span>${escapeHtml(title)}</span>`;
        item.addEventListener('click', () => {
          h.scrollIntoView({ behavior: 'smooth', block: 'center' });
          h.style.outline = '2px solid var(--accent)';
          setTimeout(() => { h.style.outline = ''; }, 1200);
        });
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
          exitBtn.textContent = 'Exit Focus Mode (Esc)';
          exitBtn.addEventListener('click', toggleFocusMode);
          document.body.appendChild(exitBtn);
        }
      } else if (exitBtn) {
        exitBtn.remove();
      }
    }

    /* ---------- find & replace ---------- */
    function unwrapFindMarks() {
      if (!pagesRoot) return;
      pagesRoot.querySelectorAll('mark.margo-find-hit').forEach((m) => {
        const parent = m.parentNode;
        while (m.firstChild) parent.insertBefore(m.firstChild, m);
        m.remove();
        parent.normalize();
      });
      findHits = [];
      findIndex = -1;
    }

    function updateFindCount() {
      if (!findCountEl) return;
      if (!findHits.length) findCountEl.textContent = findInput && findInput.value ? '0 matches' : '';
      else findCountEl.textContent = `${findIndex + 1} / ${findHits.length}`;
    }

    function highlightFindCurrent() {
      findHits.forEach((el, i) => el.classList.toggle('margo-find-current', i === findIndex));
      const cur = findHits[findIndex];
      if (cur) {
        const page = cur.closest('.doc-page');
        if (page) setActivePage(page);
        cur.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      updateFindCount();
    }

    function runFind(query) {
      unwrapFindMarks();
      const q = (query || '').trim();
      if (!q || !pagesRoot) {
        updateFindCount();
        return;
      }
      const lower = q.toLowerCase();
      const walker = document.createTreeWalker(pagesRoot, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
          if (node.parentElement && node.parentElement.closest('mark.margo-find-hit')) return NodeFilter.FILTER_REJECT;
          if (node.parentElement && node.parentElement.closest('.doc-page-header, .doc-page-footer')) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
      });
      const textNodes = [];
      let n;
      while ((n = walker.nextNode())) textNodes.push(n);

      textNodes.forEach((textNode) => {
        const text = textNode.nodeValue;
        const lowerText = text.toLowerCase();
        let start = 0;
        const parts = [];
        let idx;
        while ((idx = lowerText.indexOf(lower, start)) !== -1) {
          if (idx > start) parts.push(document.createTextNode(text.slice(start, idx)));
          const mark = document.createElement('mark');
          mark.className = 'margo-find-hit';
          mark.textContent = text.slice(idx, idx + q.length);
          parts.push(mark);
          findHits.push(mark);
          start = idx + q.length;
        }
        if (start === 0) return;
        if (start < text.length) parts.push(document.createTextNode(text.slice(start)));
        const parent = textNode.parentNode;
        parts.forEach((p) => parent.insertBefore(p, textNode));
        parent.removeChild(textNode);
      });

      findIndex = findHits.length ? 0 : -1;
      highlightFindCurrent();
    }

    function findNext(dir) {
      if (!findHits.length) return;
      findIndex = (findIndex + dir + findHits.length) % findHits.length;
      highlightFindCurrent();
    }

    function replaceCurrent() {
      if (findIndex < 0 || !findHits[findIndex]) return;
      const cur = findHits[findIndex];
      const repl = replaceInput ? replaceInput.value : '';
      const textNode = document.createTextNode(repl);
      cur.replaceWith(textNode);
      ctx.markDirty();
      runFind(findInput.value);
    }

    function replaceAll() {
      if (!findHits.length || !findInput.value) return;
      const repl = replaceInput ? replaceInput.value : '';
      findHits.forEach((hit) => {
        const textNode = document.createTextNode(repl);
        hit.replaceWith(textNode);
      });
      ctx.markDirty();
      unwrapFindMarks();
      runFind(findInput.value);
    }

    function closeFind() {
      findOpen = false;
      if (findBar) findBar.classList.add('hidden');
      unwrapFindMarks();
      updateFindCount();
    }

    function openFind() {
      if (!findBar) return;
      findOpen = true;
      findBar.classList.remove('hidden');
      setTimeout(() => { if (findInput) { findInput.focus(); findInput.select(); } }, 30);
      if (findInput && findInput.value) runFind(findInput.value);
    }

    function ensureFindBar() {
      if (!hostEl || findBar) return;
      findBar = document.createElement('div');
      findBar.className = 'doc-find-bar hidden';
      findBar.innerHTML =
        `<div class="doc-find-row">` +
          `<input type="search" class="doc-find-input" placeholder="Find in document…" aria-label="Find">` +
          `<span class="doc-find-count"></span>` +
          `<button type="button" class="icon-btn doc-find-prev" title="Previous (Shift+Enter)">▲</button>` +
          `<button type="button" class="icon-btn doc-find-next" title="Next (Enter)">▼</button>` +
          `<button type="button" class="icon-btn doc-find-close" title="Close (Esc)">${window.MargoIcons.close}</button>` +
        `</div>` +
        `<div class="doc-find-row">` +
          `<input type="text" class="doc-find-input doc-replace-input" placeholder="Replace with…" aria-label="Replace">` +
          `<button type="button" class="btn ghost doc-replace-btn" style="height:28px;padding:0 8px;font-size:11.5px;">Replace</button>` +
          `<button type="button" class="btn ghost doc-replace-all-btn" style="height:28px;padding:0 8px;font-size:11.5px;">All</button>` +
        `</div>`;
      hostEl.appendChild(findBar);
      findInput = findBar.querySelector('.doc-find-input');
      replaceInput = findBar.querySelector('.doc-replace-input');
      findCountEl = findBar.querySelector('.doc-find-count');
      findBar.querySelector('.doc-find-prev').addEventListener('click', () => findNext(-1));
      findBar.querySelector('.doc-find-next').addEventListener('click', () => findNext(1));
      findBar.querySelector('.doc-find-close').addEventListener('click', closeFind);
      findBar.querySelector('.doc-replace-btn').addEventListener('click', replaceCurrent);
      findBar.querySelector('.doc-replace-all-btn').addEventListener('click', replaceAll);
      findInput.addEventListener('input', () => runFind(findInput.value));
      findInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          findNext(e.shiftKey ? -1 : 1);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          closeFind();
        }
      });
    }

    /* ---------- fonts ---------- */
    function fillFontSelect(list) {
      if (!familySelect) return;
      const current = familySelect.value;
      availableFonts = list;
      familySelect.innerHTML = '';
      list.forEach((f) => {
        const o = document.createElement('option');
        o.value = f;
        o.textContent = f;
        o.style.fontFamily = `"${f}", sans-serif`;
        familySelect.appendChild(o);
      });
      if (list.includes(current)) familySelect.value = current;
      else if (list.includes('Calibri')) familySelect.value = 'Calibri';
      else if (list[0]) familySelect.value = list[0];
      fillVariantSelect(familySelect.value);
    }

    async function loadSystemFonts() {
      const faceMap = new Map();
      try {
        if (typeof window.queryLocalFonts === 'function') {
          const fonts = await window.queryLocalFonts();
          fonts.forEach((f) => {
            const family = (f.family || '').trim();
            if (!family) return;
            const key = family.toLowerCase();
            if (!faceMap.has(key)) faceMap.set(key, { name: family, styles: new Map() });
            const entry = faceMap.get(key);
            const style = ((f.style || 'Regular').trim() || 'Regular');
            const styleKey = style.toLowerCase();
            if (!entry.styles.has(styleKey)) {
              entry.styles.set(styleKey, { style, fullName: (f.fullName || style).trim() || style });
            }
          });
        }
      } catch {}

      fontFacesByFamily = new Map();
      const seen = new Set();
      const merged = [];

      FONT_FAMILIES.forEach((f) => {
        if (seen.has(f.toLowerCase())) return;
        seen.add(f.toLowerCase());
        merged.push(f);
        const api = faceMap.get(f.toLowerCase());
        if (api) fontFacesByFamily.set(f, Array.from(api.styles.values()).sort(compareFontFaces));
        else fontFacesByFamily.set(f, [{ style: 'Regular', fullName: f }]);
      });

      Array.from(faceMap.values())
        .sort((a, b) => a.name.localeCompare(b.name))
        .forEach((entry) => {
          if (seen.has(entry.name.toLowerCase())) return;
          seen.add(entry.name.toLowerCase());
          merged.push(entry.name);
          fontFacesByFamily.set(entry.name, Array.from(entry.styles.values()).sort(compareFontFaces));
        });

      fillFontSelect(merged);
    }

    /* ---------- sticky notes ---------- */
    function openNotesCount() {
      return notes.filter((n) => !n.done).length;
    }

    function updateNotesBadge() {
      if (!notesBadge || !notesFab) return;
      const n = openNotesCount();
      notesBadge.textContent = String(n);
      notesBadge.classList.toggle('hidden', n === 0);
      notesFab.classList.toggle('has-notes', notes.length > 0);
    }

    function findAnchor(id) {
      if (!pagesRoot) return null;
      return pagesRoot.querySelector(`[data-margo-note-id="${cssEscape(id)}"]`);
    }

    function wrapFirstQuoteMatch(id, quote) {
      const q = (quote || '').trim();
      if (!q || !pagesRoot || findAnchor(id)) return false;
      const lower = q.toLowerCase();
      const walker = document.createTreeWalker(pagesRoot, NodeFilter.SHOW_TEXT, null);
      let node;
      while ((node = walker.nextNode())) {
        if (node.parentElement && node.parentElement.closest('[data-margo-note-id]')) continue;
        const text = node.nodeValue || '';
        const idx = text.toLowerCase().indexOf(lower);
        if (idx === -1) continue;
        const range = document.createRange();
        range.setStart(node, idx);
        range.setEnd(node, idx + q.length);
        const span = document.createElement('span');
        span.className = 'margo-note-anchor';
        span.setAttribute('data-margo-note-id', id);
        try {
          range.surroundContents(span);
        } catch {
          const frag = range.extractContents();
          span.appendChild(frag);
          range.insertNode(span);
        }
        return true;
      }
      return false;
    }

    function rehydrateNoteAnchors() {
      notes.forEach((note) => {
        if (!findAnchor(note.id)) wrapFirstQuoteMatch(note.id, note.quote);
      });
    }

    function flashAnchor(el) {
      if (!el) return;
      el.classList.add('margo-note-flash');
      setTimeout(() => el.classList.remove('margo-note-flash'), 1200);
    }

    function scrollToNote(id) {
      const el = findAnchor(id);
      if (!el) {
        ctx.toast('Note anchor missing — text may have been deleted');
        return false;
      }
      const page = el.closest('.doc-page');
      if (page) setActivePage(page);
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      flashAnchor(el);
      return true;
    }

    function renderNotesRail() {
      if (!notesRail) return;
      const list = notesRail.querySelector('.doc-notes-list');
      list.innerHTML = '';
      if (!notes.length) {
        list.innerHTML = '<div class="doc-notes-empty">No notes yet. Select text and click Add note.</div>';
        return;
      }
      notes.forEach((note) => {
        const card = document.createElement('div');
        card.className = 'doc-note-card' + (note.done ? ' done' : '') + (!findAnchor(note.id) ? ' orphan' : '');
        card.dataset.noteId = note.id;
        const quote = (note.quote || '').slice(0, 80);
        card.innerHTML =
          `<div class="doc-note-quote">${escapeHtml(quote)}${quote.length >= 80 ? '…' : ''}</div>` +
          `<div class="doc-note-body">${escapeHtml(note.body || '')}</div>` +
          `<div class="doc-note-actions">` +
            `<label class="doc-note-done"><input type="checkbox" ${note.done ? 'checked' : ''}> Done</label>` +
            `<button type="button" class="doc-note-delete" title="Delete note">Delete</button>` +
          `</div>`;
        card.addEventListener('click', (e) => {
          if (e.target.closest('input') || e.target.closest('button') || e.target.closest('label')) return;
          scrollToNote(note.id);
        });
        card.querySelector('input').addEventListener('change', (e) => {
          note.done = !!e.target.checked;
          card.classList.toggle('done', note.done);
          ctx.markDirty();
          updateNotesBadge();
        });
        card.querySelector('.doc-note-delete').addEventListener('click', (e) => {
          e.stopPropagation();
          const anchor = findAnchor(note.id);
          if (anchor) {
            const parent = anchor.parentNode;
            while (anchor.firstChild) parent.insertBefore(anchor.firstChild, anchor);
            anchor.remove();
            parent.normalize();
          }
          notes = notes.filter((n) => n.id !== note.id);
          ctx.markDirty();
          updateNotesBadge();
          renderNotesRail();
        });
        list.appendChild(card);
      });
    }

    function toggleNotesRail(force) {
      if (!notesRail) return;
      const open = force != null ? force : notesRail.classList.contains('hidden');
      notesRail.classList.toggle('hidden', !open);
      if (open) renderNotesRail();
    }

    function wrapSelectionWithNote(id) {
      const sel = window.getSelection();
      if (!sel.rangeCount || sel.isCollapsed) return null;
      const range = sel.getRangeAt(0);
      const page = getPage();
      if (!page || !page.contains(range.commonAncestorContainer)) return null;
      const quote = range.toString();
      if (!quote.trim()) return null;
      const span = document.createElement('span');
      span.className = 'margo-note-anchor';
      span.setAttribute('data-margo-note-id', id);
      try {
        range.surroundContents(span);
      } catch {
        const frag = range.extractContents();
        span.appendChild(frag);
        range.insertNode(span);
      }
      sel.removeAllRanges();
      const r = document.createRange();
      r.selectNodeContents(span);
      sel.addRange(r);
      return quote;
    }

    async function addNote() {
      saveSelection();
      const sel = window.getSelection();
      if (!sel.rangeCount || sel.isCollapsed || !String(sel).trim()) {
        ctx.toast('Select some text first');
        return;
      }
      const body = await ctx.inputModal('Add note', 'Write your note…', '');
      if (body == null || !String(body).trim()) return;
      restoreSelection();
      const id = uid();
      const quote = wrapSelectionWithNote(id);
      if (!quote) {
        ctx.toast('Could not attach note to that selection');
        return;
      }
      notes.push({
        id,
        quote: quote.trim(),
        body: String(body).trim(),
        done: false,
        createdAt: new Date().toISOString()
      });
      ctx.markDirty();
      updateNotesBadge();
      toggleNotesRail(true);
      renderNotesRail();
      scrollToNote(id);
    }

    /* ---------- Ribbon Toolbar ---------- */
    function buildRibbon() {
      const tb = ctx.toolbar;
      tb.innerHTML = '';
      tb.className = 'toolbar doc-ribbon';
      const I = window.MargoIcons;
      tableBtns = {};

      const tabsBar = document.createElement('div');
      tabsBar.className = 'doc-ribbon-tabs';

      const panels = {};
      const TABS = [
        { id: 'home', label: 'Home' },
        { id: 'insert', label: 'Insert' },
        { id: 'layout', label: 'Layout' },
        { id: 'review', label: 'Review' },
        { id: 'view', label: 'View' }
      ];

      TABS.forEach((t) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `doc-ribbon-tab ${t.id === activeRibbonTab ? 'active' : ''}`;
        btn.textContent = t.label;
        btn.addEventListener('click', () => {
          activeRibbonTab = t.id;
          tabsBar.querySelectorAll('.doc-ribbon-tab').forEach((b) => b.classList.remove('active'));
          btn.classList.add('active');
          Object.entries(panels).forEach(([pid, panel]) => {
            panel.classList.toggle('hidden', pid !== t.id);
          });
        });
        tabsBar.appendChild(btn);

        const panel = document.createElement('div');
        panel.className = `doc-ribbon-panel ${t.id === activeRibbonTab ? '' : 'hidden'}`;
        panels[t.id] = panel;
      });

      tb.appendChild(tabsBar);
      Object.values(panels).forEach((p) => tb.appendChild(p));

      const makeBtn = (targetPanel, title, html, fn, stateCmd) => {
        const b = document.createElement('button');
        b.className = 'icon-btn';
        b.title = title;
        b.innerHTML = html;
        b.addEventListener('mousedown', (e) => e.preventDefault());
        b.addEventListener('click', fn);
        targetPanel.appendChild(b);
        if (stateCmd) stateButtons[stateCmd] = b;
        return b;
      };
      const makeSep = (targetPanel) => {
        const s = document.createElement('span');
        s.className = 'tb-sep';
        targetPanel.appendChild(s);
      };

      /* ========== 1. HOME TAB ========== */
      const pHome = panels.home;

      // Style Select (Heading/Body)
      blockSelect = document.createElement('select');
      blockSelect.className = 'tb-select';
      [
        ['p', 'Normal'],
        ['h1', 'Heading 1'],
        ['h2', 'Heading 2'],
        ['h3', 'Heading 3'],
        ['blockquote', 'Quote'],
        ['pre', 'Code Block']
      ].forEach(([v, label]) => {
        const o = document.createElement('option');
        o.value = v;
        o.textContent = label;
        blockSelect.appendChild(o);
      });
      blockSelect.addEventListener('change', () => exec('formatBlock', '<' + blockSelect.value + '>'));
      pHome.appendChild(blockSelect);

      // Font Family
      familySelect = document.createElement('select');
      familySelect.className = 'tb-select tb-font';
      fillFontSelect(FONT_FAMILIES.slice());
      familySelect.title = 'Font family';
      familySelect.addEventListener('mousedown', saveSelection);
      familySelect.addEventListener('change', () => {
        restoreSelection();
        fillVariantSelect(familySelect.value);
        applyFontFace(familySelect.value, variantSelect ? variantSelect.value : 'Regular');
      });
      pHome.appendChild(familySelect);

      // Font Variant / Style
      variantSelect = document.createElement('select');
      variantSelect.className = 'tb-select tb-font-variant';
      variantSelect.title = 'Font weight & style';
      fillVariantSelect(familySelect.value);
      variantSelect.addEventListener('mousedown', saveSelection);
      variantSelect.addEventListener('change', () => {
        restoreSelection();
        applyFontFace(familySelect.value, variantSelect.value);
      });
      pHome.appendChild(variantSelect);

      // Font Size
      sizeSelect = document.createElement('select');
      sizeSelect.className = 'tb-select tb-size';
      FONT_SIZES.forEach((s) => {
        const o = document.createElement('option');
        o.value = String(s);
        o.textContent = s;
        sizeSelect.appendChild(o);
      });
      sizeSelect.value = '11';
      sizeSelect.title = 'Font size (pt)';
      sizeSelect.addEventListener('mousedown', saveSelection);
      sizeSelect.addEventListener('change', () => {
        restoreSelection();
        setFontSize(Number(sizeSelect.value));
      });
      pHome.appendChild(sizeSelect);

      // Step Font Size
      makeBtn(pHome, 'Grow Font', '<span class="tb-glyph">A<sup>+</sup></span>', () => stepFontSize(1));
      makeBtn(pHome, 'Shrink Font', '<span class="tb-glyph">A<sup>−</sup></span>', () => stepFontSize(-1));

      makeSep(pHome);

      // B / I / U / S / Sub / Super
      makeBtn(pHome, 'Bold (Ctrl+B)', '<span class="tb-glyph">B</span>', () => exec('bold'), 'bold');
      makeBtn(pHome, 'Italic (Ctrl+I)', '<span class="tb-glyph i">I</span>', () => exec('italic'), 'italic');
      makeBtn(pHome, 'Underline (Ctrl+U)', '<span class="tb-glyph u">U</span>', () => exec('underline'), 'underline');
      makeBtn(pHome, 'Strikethrough', '<span class="tb-glyph s">S</span>', () => exec('strikeThrough'), 'strikeThrough');
      makeBtn(pHome, 'Subscript', I.subscript || '<span class="tb-glyph">X<sub>2</sub></span>', () => exec('subscript'), 'subscript');
      makeBtn(pHome, 'Superscript', I.superscript || '<span class="tb-glyph">X<sup>2</sup></span>', () => exec('superscript'), 'superscript');

      makeSep(pHome);

      // Text Color
      const colorBtn = document.createElement('button');
      colorBtn.className = 'icon-btn tb-color';
      colorBtn.title = 'Text color';
      colorBtn.innerHTML = '<span class="tb-glyph" style="border-bottom:3px solid #1d4ed8;line-height:1">A</span>';
      colorBtn.addEventListener('mousedown', (e) => { e.preventDefault(); saveSelection(); });
      colorBtn.addEventListener('click', () => {
        const pal = document.createElement('div');
        pal.className = 'color-pop';
        INK_COLORS.forEach((cVal) => {
          const sw = document.createElement('button');
          sw.className = 'color-swatch';
          sw.style.background = cVal;
          sw.title = cVal;
          sw.addEventListener('click', (e) => {
            e.stopPropagation();
            pal.remove();
            restoreSelection();
            exec('foreColor', cVal, true);
          });
          pal.appendChild(sw);
        });
        colorBtn.appendChild(pal);
        const dismiss = (e) => {
          if (!pal.contains(e.target)) { pal.remove(); document.removeEventListener('mousedown', dismiss, true); }
        };
        setTimeout(() => document.addEventListener('mousedown', dismiss, true), 0);
      });
      pHome.appendChild(colorBtn);

      // Text Highlight Color
      const hlBtn = document.createElement('button');
      hlBtn.className = 'icon-btn tb-hl';
      hlBtn.title = 'Highlight text';
      hlBtn.innerHTML = I.highlight || '<span class="tb-glyph" style="background:#fef08a;padding:0 2px">ab</span>';
      hlBtn.addEventListener('mousedown', (e) => { e.preventDefault(); saveSelection(); });
      hlBtn.addEventListener('click', () => {
        const pal = document.createElement('div');
        pal.className = 'color-pop';
        HL_COLORS.forEach((h) => {
          const sw = document.createElement('button');
          sw.className = 'color-swatch';
          sw.style.background = h.color;
          sw.title = h.name;
          sw.addEventListener('click', (e) => {
            e.stopPropagation();
            pal.remove();
            applyTextHighlight(h.class, h.color);
          });
          pal.appendChild(sw);
        });
        const clearSw = document.createElement('button');
        clearSw.className = 'color-swatch';
        clearSw.textContent = '✕';
        clearSw.title = 'No Highlight';
        clearSw.addEventListener('click', (e) => {
          e.stopPropagation();
          pal.remove();
          applyTextHighlight('none');
        });
        pal.appendChild(clearSw);
        hlBtn.appendChild(pal);
        const dismiss = (e) => {
          if (!pal.contains(e.target)) { pal.remove(); document.removeEventListener('mousedown', dismiss, true); }
        };
        setTimeout(() => document.addEventListener('mousedown', dismiss, true), 0);
      });
      pHome.appendChild(hlBtn);

      makeSep(pHome);

      // Alignment
      makeBtn(pHome, 'Align left', I.alignLeft, () => exec('justifyLeft'), 'justifyLeft');
      makeBtn(pHome, 'Align center', I.alignCenter, () => exec('justifyCenter'), 'justifyCenter');
      makeBtn(pHome, 'Align right', I.alignRight, () => exec('justifyRight'), 'justifyRight');
      makeBtn(pHome, 'Justify', I.alignJustify, () => exec('justifyFull'), 'justifyFull');

      makeSep(pHome);

      // Lists & Indent
      makeBtn(pHome, 'Bullet list', I.ul, () => exec('insertUnorderedList'), 'insertUnorderedList');
      makeBtn(pHome, 'Numbered list', I.ol, () => exec('insertOrderedList'), 'insertOrderedList');
      makeBtn(pHome, 'Decrease indent', I.indentDec, () => exec('outdent'));
      makeBtn(pHome, 'Increase indent', I.indentInc, () => exec('indent'));

      makeSep(pHome);

      // Line Spacing Dropdown
      const lineSpaceSelect = document.createElement('select');
      lineSpaceSelect.className = 'tb-select';
      lineSpaceSelect.title = 'Line spacing';
      [
        ['1.15', '1.15'],
        ['1.0', '1.0 (Single)'],
        ['1.5', '1.5 (1.5 lines)'],
        ['2.0', '2.0 (Double)'],
        ['2.5', '2.5'],
        ['3.0', '3.0']
      ].forEach(([val, lbl]) => {
        const opt = document.createElement('option');
        opt.value = val;
        opt.textContent = lbl;
        lineSpaceSelect.appendChild(opt);
      });
      lineSpaceSelect.value = '1.15';
      lineSpaceSelect.addEventListener('change', () => applyLineSpacing(lineSpaceSelect.value));
      pHome.appendChild(lineSpaceSelect);

      // Text Case Conversion
      const caseSelect = document.createElement('select');
      caseSelect.className = 'tb-select';
      caseSelect.title = 'Change case';
      [
        ['', 'Case ▾'],
        ['sentence', 'Sentence case'],
        ['lower', 'lowercase'],
        ['upper', 'UPPERCASE'],
        ['title', 'Title Case']
      ].forEach(([val, lbl]) => {
        const opt = document.createElement('option');
        opt.value = val;
        opt.textContent = lbl;
        caseSelect.appendChild(opt);
      });
      caseSelect.addEventListener('change', () => {
        if (caseSelect.value) {
          transformTextCase(caseSelect.value);
          caseSelect.value = '';
        }
      });
      pHome.appendChild(caseSelect);

      makeBtn(pHome, 'Clear formatting', I.clear, () => { exec('removeFormat'); exec('unlink'); });

      /* ========== 2. INSERT TAB ========== */
      const pInsert = panels.insert;

      makeBtn(pInsert, 'Page break (Ctrl+Enter)', I.pageBreak, () => addPage());

      makeSep(pInsert);

      const tableBtn = makeBtn(pInsert, 'Insert table', I.table, () => openTableSizePicker(tableBtn));
      tableBtns.addRow = makeBtn(pInsert, 'Add row', I.plusRow, () => addTableRow());
      tableBtns.addCol = makeBtn(pInsert, 'Add column', I.plusCol, () => addTableCol());
      tableBtns.delRow = makeBtn(pInsert, 'Delete row', '<span class="tb-glyph" style="font-size:11px">−R</span>', () => deleteTableRow());
      tableBtns.delCol = makeBtn(pInsert, 'Delete column', '<span class="tb-glyph" style="font-size:11px">−C</span>', () => deleteTableCol());

      // Table Shading
      const shadeBtn = document.createElement('button');
      shadeBtn.className = 'icon-btn';
      shadeBtn.title = 'Cell shading background';
      shadeBtn.innerHTML = I.shading || '🎨';
      shadeBtn.addEventListener('click', () => {
        const pal = document.createElement('div');
        pal.className = 'color-pop';
        SHADING_COLORS.forEach((cVal) => {
          const sw = document.createElement('button');
          sw.className = 'color-swatch';
          sw.style.background = cVal;
          sw.addEventListener('click', (e) => {
            e.stopPropagation();
            pal.remove();
            setTableCellShading(cVal);
          });
          pal.appendChild(sw);
        });
        shadeBtn.appendChild(pal);
        setTimeout(() => {
          const dismiss = (e) => { if (!pal.contains(e.target)) { pal.remove(); document.removeEventListener('mousedown', dismiss, true); } };
          document.addEventListener('mousedown', dismiss, true);
        }, 0);
      });
      pInsert.appendChild(shadeBtn);
      tableBtns.shade = shadeBtn;

      makeSep(pInsert);

      makeBtn(pInsert, 'Insert image', I.image, () => insertImageFromDialog());
      makeBtn(pInsert, 'Images in Document', I.image, () => showDocumentImagesPanel());
      makeBtn(pInsert, 'Insert link (Ctrl+K)', I.link, async () => {
        saveSelection();
        const url = await ctx.inputModal('Insert link', 'https://…', 'https://');
        if (url) { restoreSelection(); exec('createLink', url); }
      });
      makeBtn(pInsert, 'Horizontal line', I.hr, () => exec('insertHorizontalRule'));
      makeBtn(pInsert, 'Symbols & Characters', I.symbol, () => openSymbolsPicker());

      makeSep(pInsert);

      // Callouts dropdown
      const calloutSelect = document.createElement('select');
      calloutSelect.className = 'tb-select';
      calloutSelect.title = 'Insert Callout Card';
      [
        ['', 'Callout ▾'],
        ['note', '📌 Note'],
        ['tip', '💡 Pro Tip'],
        ['warning', '⚠️ Warning'],
        ['quote', '❝ Key Takeaway']
      ].forEach(([val, lbl]) => {
        const opt = document.createElement('option');
        opt.value = val;
        opt.textContent = lbl;
        calloutSelect.appendChild(opt);
      });
      calloutSelect.addEventListener('change', () => {
        if (calloutSelect.value) {
          insertCallout(calloutSelect.value);
          calloutSelect.value = '';
        }
      });
      pInsert.appendChild(calloutSelect);

      // Date / Time insertion
      const dateSelect = document.createElement('select');
      dateSelect.className = 'tb-select';
      dateSelect.title = 'Insert Date';
      [
        ['', 'Date ▾'],
        ['iso', 'YYYY-MM-DD'],
        ['long', 'Month DD, YYYY'],
        ['time', 'HH:MM:SS']
      ].forEach(([val, lbl]) => {
        const opt = document.createElement('option');
        opt.value = val;
        opt.textContent = lbl;
        dateSelect.appendChild(opt);
      });
      dateSelect.addEventListener('change', () => {
        if (dateSelect.value) {
          insertDate(dateSelect.value);
          dateSelect.value = '';
        }
      });
      pInsert.appendChild(dateSelect);

      /* ========== 3. LAYOUT TAB ========== */
      const pLayout = panels.layout;

      // Paper Size
      const sizeBtnSelect = document.createElement('select');
      sizeBtnSelect.className = 'tb-select';
      sizeBtnSelect.title = 'Paper size';
      [
        ['letter', 'Letter (8.5" × 11")'],
        ['a4', 'A4 (210 × 297 mm)'],
        ['legal', 'Legal (8.5" × 14")'],
        ['executive', 'Executive']
      ].forEach(([val, lbl]) => {
        const opt = document.createElement('option');
        opt.value = val;
        opt.textContent = lbl;
        sizeBtnSelect.appendChild(opt);
      });
      sizeBtnSelect.value = layout.size || 'letter';
      sizeBtnSelect.addEventListener('change', () => {
        layout.size = sizeBtnSelect.value;
        applyLayoutAttributes();
        ctx.markDirty();
        updateStatus();
      });
      pLayout.appendChild(sizeBtnSelect);

      // Orientation
      const orientSelect = document.createElement('select');
      orientSelect.className = 'tb-select';
      orientSelect.title = 'Orientation';
      [
        ['portrait', 'Portrait'],
        ['landscape', 'Landscape']
      ].forEach(([val, lbl]) => {
        const opt = document.createElement('option');
        opt.value = val;
        opt.textContent = lbl;
        orientSelect.appendChild(opt);
      });
      orientSelect.value = layout.orientation || 'portrait';
      orientSelect.addEventListener('change', () => {
        layout.orientation = orientSelect.value;
        applyLayoutAttributes();
        ctx.markDirty();
        updateStatus();
      });
      pLayout.appendChild(orientSelect);

      // Margins
      const marginSelect = document.createElement('select');
      marginSelect.className = 'tb-select';
      marginSelect.title = 'Margins';
      [
        ['normal', 'Normal (1")'],
        ['narrow', 'Narrow (0.5")'],
        ['moderate', 'Moderate (0.75")'],
        ['wide', 'Wide (1.5")']
      ].forEach(([val, lbl]) => {
        const opt = document.createElement('option');
        opt.value = val;
        opt.textContent = lbl;
        marginSelect.appendChild(opt);
      });
      marginSelect.value = layout.margins || 'normal';
      marginSelect.addEventListener('change', () => {
        layout.margins = marginSelect.value;
        applyLayoutAttributes();
        ctx.markDirty();
        updateStatus();
      });
      pLayout.appendChild(marginSelect);

      // Multi-column text flow
      const colSelect = document.createElement('select');
      colSelect.className = 'tb-select';
      colSelect.title = 'Columns';
      [
        ['1', '1 Column'],
        ['2', '2 Columns'],
        ['3', '3 Columns']
      ].forEach(([val, lbl]) => {
        const opt = document.createElement('option');
        opt.value = val;
        opt.textContent = lbl;
        colSelect.appendChild(opt);
      });
      colSelect.value = String(layout.columns || 1);
      colSelect.addEventListener('change', () => {
        layout.columns = parseInt(colSelect.value, 10) || 1;
        applyLayoutAttributes();
        ctx.markDirty();
        updateStatus();
      });
      pLayout.appendChild(colSelect);

      makeSep(pLayout);

      makeBtn(pLayout, 'Header Text', I.headerFooter || 'Header', async () => {
        const text = await ctx.inputModal('Header Text', 'Text displayed in the top margin of each page…', layout.headerText || '');
        if (text != null) {
          layout.headerText = text.trim();
          updatePageHeadersAndFooters();
          ctx.markDirty();
        }
      });
      makeBtn(pLayout, 'Footer Text', I.headerFooter || 'Footer', async () => {
        const text = await ctx.inputModal('Footer Text', 'Text displayed in the bottom margin of each page…', layout.footerText || '');
        if (text != null) {
          layout.footerText = text.trim();
          updatePageHeadersAndFooters();
          ctx.markDirty();
        }
      });

      /* ========== 4. REVIEW TAB ========== */
      const pReview = panels.review;

      makeBtn(pReview, 'Add note', I.note || I.quote, () => addNote());
      makeBtn(pReview, 'Toggle Notes panel', I.bell || I.note, () => toggleNotesRail());
      makeBtn(pReview, 'Find & Replace (Ctrl+F)', I.search || I.replace, () => openFind());

      makeSep(pReview);

      makeBtn(pReview, 'Images in Document', I.image || '🖼️', () => showDocumentImagesPanel());
      makeBtn(pReview, 'Document Statistics', I.stats || '📊', () => openStatsModal());
      makeBtn(pReview, 'Toggle Spellcheck', I.spellcheck || 'ABC', () => {
        const p = getPage();
        if (p) {
          const next = !p.spellcheck;
          pageList().forEach((pg) => {
            const body = pg.querySelector('.doc-page-body') || pg;
            body.spellcheck = next;
          });
          ctx.toast(`Spellcheck ${next ? 'enabled' : 'disabled'}`);
        }
      });

      /* ========== 5. VIEW TAB ========== */
      const pView = panels.view;

      makeBtn(pView, 'Document Outline', I.outline || '📑', () => toggleOutlineRail());

      makeSep(pView);

      makeBtn(pView, 'Zoom In (Ctrl++)', I.zoomIn, () => zoomBy(1.1));
      makeBtn(pView, 'Zoom Out (Ctrl+-)', I.zoomOut, () => zoomBy(1 / 1.1));
      makeBtn(pView, 'Zoom 100% (Ctrl+0)', I.fit, () => { zoom = 1; applyZoom(); });

      makeSep(pView);

      makeBtn(pView, 'Focus Mode (Esc to exit)', I.focus || '🔲', () => toggleFocusMode());
    }

    function onFindKeydown(e) {
      if (e.key === 'Escape') {
        if (findOpen) {
          e.preventDefault();
          closeFind();
        }
        if (document.body.classList.contains('margo-focus-mode')) {
          e.preventDefault();
          toggleFocusMode();
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        addPage();
      }
    }

    return {
      kind: 'doc',
      mount(host, doc) {
        buildRibbon();
        hostEl = host;
        notes = Array.isArray(doc.notes) ? doc.notes.map((n) => ({ ...n })) : [];
        if (doc.layout && typeof doc.layout === 'object') {
          layout = { ...layout, ...doc.layout };
        }

        host.innerHTML =
          `<aside class="doc-outline-rail hidden" aria-label="Document Outline">` +
            `<div class="doc-outline-head">` +
              `<span>Headings Outline</span>` +
              `<button type="button" class="icon-btn doc-outline-close" title="Close">${window.MargoIcons.close}</button>` +
            `</div>` +
            `<div class="doc-outline-list"></div>` +
          `</aside>` +
          `<div class="doc-scroll">` +
            `<div class="doc-pages"></div>` +
            `<div class="doc-fab-stack">` +
              `<button type="button" class="doc-notes-fab" title="Notes" aria-label="Open notes">` +
                `<span class="doc-notes-fab-icon"></span>` +
                `<span class="doc-notes-badge hidden">0</span>` +
              `</button>` +
              `<button type="button" class="doc-add-page" title="Add page" aria-label="Add page">+</button>` +
            `</div>` +
          `</div>` +
          `<aside class="doc-notes-rail hidden" aria-label="Notes">` +
            `<div class="doc-notes-rail-head">` +
              `<strong>Notes</strong>` +
              `<button type="button" class="icon-btn doc-notes-rail-close" title="Close">${window.MargoIcons.close}</button>` +
            `</div>` +
            `<div class="doc-notes-list"></div>` +
          `</aside>`;

        scrollEl = host.querySelector('.doc-scroll');
        pagesRoot = host.querySelector('.doc-pages');
        notesRail = host.querySelector('.doc-notes-rail');
        notesFab = host.querySelector('.doc-notes-fab');
        notesBadge = host.querySelector('.doc-notes-badge');
        outlineRail = host.querySelector('.doc-outline-rail');
        const addBtn = host.querySelector('.doc-add-page');
        const fabIcon = host.querySelector('.doc-notes-fab-icon');
        if (fabIcon) fabIcon.innerHTML = window.MargoIcons.bell || window.MargoIcons.note;

        splitPages(doc.html || EMPTY_PAGE).forEach((html) => {
          pagesRoot.appendChild(makePageEl(html));
        });
        activePage = pagesRoot.querySelector('.doc-page');

        applyLayoutAttributes();

        try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch {}
        try { document.execCommand('styleWithCSS', false, false); } catch {}

        pagesRoot.addEventListener('input', () => { ctx.markDirty(); updateStatus(); });
        pagesRoot.addEventListener('focusin', (e) => {
          const p = e.target.closest && e.target.closest('.doc-page');
          if (p) setActivePage(p);
        });
        pagesRoot.addEventListener('pointermove', onTableResizeHover);
        pagesRoot.addEventListener('pointerdown', onTableResizeDown, true);
        document.addEventListener('selectionchange', onSelChange);
        document.addEventListener('keydown', onFindKeydown, true);

        pagesRoot.addEventListener('paste', (e) => {
          const page = e.target.closest && e.target.closest('.doc-page');
          if (!page) return;
          const html = e.clipboardData.getData('text/html');
          if (!html) return;
          e.preventDefault();
          setActivePage(page);
          page.focus();
          const clean = DOMPurify.sanitize(html, {
            ALLOWED_TAGS,
            ALLOWED_ATTR: ['href', 'src', 'alt', 'colspan', 'rowspan', 'class', 'data-margo-note-id', 'style']
          });
          document.execCommand('insertHTML', false, clean);
          ctx.markDirty();
          updateStatus();
        });

        addBtn.addEventListener('mousedown', (e) => e.preventDefault());
        addBtn.addEventListener('click', () => addPage());
        notesFab.addEventListener('mousedown', (e) => e.preventDefault());
        notesFab.addEventListener('click', () => {
          toggleNotesRail(true);
          const target = notes.find((n) => !n.done) || notes[0];
          if (target) scrollToNote(target.id);
        });
        notesRail.querySelector('.doc-notes-rail-close').addEventListener('click', () => toggleNotesRail(false));
        outlineRail.querySelector('.doc-outline-close').addEventListener('click', () => toggleOutlineRail(false));
        scrollEl.addEventListener('wheel', onCtrlWheel, { passive: false });

        ensureFindBar();
        rehydrateNoteAnchors();
        updateNotesBadge();
        loadSystemFonts();
        updateStatus();
        refreshStates();
        setTimeout(() => { const body = getPage(); if (body) body.focus(); }, 60);

        function onSelChange() {
          const sel = document.getSelection();
          const anchor = sel && sel.anchorNode;
          if (!anchor || !pagesRoot) return;
          const p = (anchor.nodeType === 1 ? anchor : anchor.parentElement);
          const page = p && p.closest && p.closest('.doc-page');
          if (page && pagesRoot.contains(page)) {
            setActivePage(page);
            refreshStates();
          }
        }

        this._cleanup = () => {
          document.removeEventListener('selectionchange', onSelChange);
          document.removeEventListener('keydown', onFindKeydown, true);
          if (pagesRoot) {
            pagesRoot.removeEventListener('pointermove', onTableResizeHover);
            pagesRoot.removeEventListener('pointerdown', onTableResizeDown, true);
            pagesRoot.style.cursor = '';
          }
          if (scrollEl) scrollEl.removeEventListener('wheel', onCtrlWheel);
          if (document.body.classList.contains('margo-focus-mode')) toggleFocusMode();
          unwrapFindMarks();
        };
        this._test = { addPage: () => addPage(), openFind, addNote, openStats: openStatsModal };
      },
      getData() {
        unwrapFindMarks();
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
          normalizeFonts(clone);
          return clone.innerHTML;
        });
        return {
          html: bodyHtmls.join(PAGE_BREAK_HTML),
          notes: notes.map((n) => ({
            id: n.id,
            quote: n.quote,
            body: n.body,
            done: !!n.done,
            createdAt: n.createdAt
          })),
          layout: { ...layout }
        };
      },
      focus() { const p = getPage(); if (p) p.focus(); },
      destroy() { if (this._cleanup) this._cleanup(); },
      commands: {
        paste: (t) => {
          const page = getPage();
          if (!page) return;
          page.focus();
          if (t) document.execCommand('insertText', false, t);
        },
        addPage: () => addPage(),
        find: () => openFind(),
        zoomIn: () => zoomBy(1.1),
        zoomOut: () => zoomBy(1 / 1.1),
        zoomReset: () => { zoom = 1; applyZoom(); },
        outline: () => toggleOutlineRail(),
        stats: () => openStatsModal(),
        focusMode: () => toggleFocusMode(),
        extractImages: () => showDocumentImagesPanel()
      }
    };
  }

  window.MargoEditors = window.MargoEditors || {};
  window.MargoEditors.doc = create;
})();
