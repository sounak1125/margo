/* Shared colour picker for docs and sheets: text, highlight, shading, fill.

   Every colour control in Margo used to carry its own short swatch list, so
   the same document could only ever be tinted from whichever fifteen colours
   that particular button happened to know about. This is one picker with one
   palette - the Google Docs grid, which is what a document written elsewhere
   was coloured from - plus the two escape hatches that grid cannot cover: a
   hex field for an exact brand colour, and the screen eyedropper for a colour
   the author can see but cannot name. */
(function () {
  /* The Google Docs / Sheets palette: a greyscale ramp, the saturated row the
     ramp cannot reach, then three tints and three shades of each hue. Read it
     as ten columns of one hue getting darker down the grid. */
  const PALETTE = [
    ['#000000', '#434343', '#666666', '#999999', '#b7b7b7', '#cccccc', '#d9d9d9', '#efefef', '#f3f3f3', '#ffffff'],
    ['#980000', '#ff0000', '#ff9900', '#ffff00', '#00ff00', '#00ffff', '#4a86e8', '#0000ff', '#9900ff', '#ff00ff'],
    ['#e6b8af', '#f4cccc', '#fce5cd', '#fff2cc', '#d9ead3', '#d0e0e3', '#c9daf8', '#cfe2f3', '#d9d2e9', '#ead1dc'],
    ['#dd7e6b', '#ea9999', '#f9cb9c', '#ffe599', '#b6d7a8', '#a2c4c9', '#a4c2f4', '#9fc5e8', '#b4a7d6', '#d5a6bd'],
    ['#cc4125', '#e06666', '#f6b26b', '#ffd966', '#93c47d', '#76a5af', '#6d9eeb', '#6fa8dc', '#8e7cc3', '#c27ba0'],
    ['#a61c00', '#cc0000', '#e69138', '#f1c232', '#6aa84f', '#45818e', '#3c78d8', '#3d85c6', '#674ea7', '#a64d79'],
    ['#85200c', '#990000', '#b45f06', '#bf9000', '#38761d', '#134f5c', '#1155cc', '#0b5394', '#351c75', '#741b47'],
    ['#5b0f00', '#660000', '#783f04', '#7f6000', '#274e13', '#0c343d', '#1c4587', '#073763', '#20124d', '#4c1130']
  ];

  const RECENTS_KEY = 'margo.recentColors';
  const RECENTS_MAX = 10;

  let openPop = null;

  function normalizeHex(value) {
    if (!value) return null;
    let v = String(value).trim().toLowerCase();
    if (v[0] !== '#') v = '#' + v;
    if (/^#[0-9a-f]{3}$/.test(v)) {
      return '#' + v[1] + v[1] + v[2] + v[2] + v[3] + v[3];
    }
    return /^#[0-9a-f]{6}$/.test(v) ? v : null;
  }

  /* Anything that arrives from the document is a computed style, so it is
     rgb() far more often than it is hex. */
  function toHex(value) {
    if (!value) return null;
    const direct = normalizeHex(value);
    if (direct) return direct;
    const m = String(value).match(/^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i);
    if (!m) return null;
    const hex = (n) => Number(n).toString(16).padStart(2, '0');
    return '#' + hex(m[1]) + hex(m[2]) + hex(m[3]);
  }

  /* Relative luminance, so a swatch can decide whether its own check mark and
     any text sitting on it should be black or white. */
  function luminance(hex) {
    const h = normalizeHex(hex);
    if (!h) return 1;
    const channel = (i) => {
      const c = parseInt(h.slice(1 + i * 2, 3 + i * 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
  }

  function contrastInk(hex) {
    return luminance(hex) > 0.45 ? '#000000' : '#ffffff';
  }

  function readRecents() {
    try {
      const raw = JSON.parse(localStorage.getItem(RECENTS_KEY) || '[]');
      return Array.isArray(raw) ? raw.map(normalizeHex).filter(Boolean).slice(0, RECENTS_MAX) : [];
    } catch {
      return [];
    }
  }

  function rememberRecent(hex) {
    const h = normalizeHex(hex);
    if (!h) return;
    const next = [h].concat(readRecents().filter((c) => c !== h)).slice(0, RECENTS_MAX);
    try { localStorage.setItem(RECENTS_KEY, JSON.stringify(next)); } catch { /* private mode */ }
  }

  function closeOpen() {
    if (!openPop) return;
    const { el, onDocMouseDown, onKeyDown, onReflow } = openPop;
    document.removeEventListener('mousedown', onDocMouseDown, true);
    document.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('resize', onReflow, true);
    window.removeEventListener('scroll', onReflow, true);
    el.remove();
    openPop = null;
  }

  /* Fixed positioning against the anchor's rect rather than a child of the
     button: the grid is far wider than a toolbar button, and a button nested
     inside a button is markup no browser agrees on. */
  function place(el, anchor) {
    const a = anchor.getBoundingClientRect();
    el.style.visibility = 'hidden';
    el.style.left = '0px';
    el.style.top = '0px';
    document.body.appendChild(el);
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const margin = 8;
    let left = a.left;
    if (left + w > window.innerWidth - margin) left = window.innerWidth - margin - w;
    if (left < margin) left = margin;
    let top = a.bottom + 4;
    if (top + h > window.innerHeight - margin) {
      const above = a.top - 4 - h;
      top = above >= margin ? above : Math.max(margin, window.innerHeight - margin - h);
    }
    el.style.left = Math.round(left) + 'px';
    el.style.top = Math.round(top) + 'px';
    el.style.visibility = '';
  }

  function makeSwatch(hex, current, onPick) {
    const sw = document.createElement('button');
    sw.type = 'button';
    sw.className = 'mc-swatch';
    sw.style.background = hex;
    sw.title = hex;
    sw.setAttribute('aria-label', hex);
    if (current && normalizeHex(current) === hex) {
      sw.classList.add('is-current');
      sw.style.setProperty('--mc-ink', contrastInk(hex));
    }
    sw.addEventListener('mousedown', (e) => e.preventDefault());
    sw.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      onPick(hex);
    });
    return sw;
  }

  const EYEDROPPER_SVG =
    '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" ' +
    'stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M11.2 1.8a1.9 1.9 0 0 1 2.7 2.7l-1.3 1.3-2.7-2.7 1.3-1.3Z"/>' +
    '<path d="M9.9 3.1 3.6 9.4a2 2 0 0 0-.5.9l-.6 2.2 2.2-.6a2 2 0 0 0 .9-.5l6.3-6.3"/>' +
    '</svg>';

  /* The screen eyedropper is a Chromium capability rather than something the
     page can polyfill, so the button only exists where the API does. */
  function eyedropperSupported() {
    return typeof window.EyeDropper === 'function';
  }

  function open(anchor, opts) {
    const o = opts || {};
    const wasOpenFor = openPop && openPop.anchor === anchor;
    closeOpen();
    if (wasOpenFor) return null;

    const current = toHex(o.value);
    const el = document.createElement('div');
    el.className = 'mc-pop';
    el.setAttribute('role', 'dialog');
    if (o.title) el.setAttribute('aria-label', o.title);

    const finish = (hex) => {
      closeOpen();
      if (hex) rememberRecent(hex);
      if (typeof o.onPick === 'function') o.onPick(hex);
    };

    if (o.title) {
      const head = document.createElement('div');
      head.className = 'mc-label';
      head.textContent = o.title;
      el.appendChild(head);
    }

    if (o.allowNone) {
      const none = document.createElement('button');
      none.type = 'button';
      none.className = 'mc-none';
      none.innerHTML = '<span class="mc-none-chip" aria-hidden="true"></span>'
        + '<span></span>';
      none.lastChild.textContent = o.noneLabel || 'None';
      none.addEventListener('mousedown', (e) => e.preventDefault());
      none.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        finish(null);
      });
      el.appendChild(none);
    }

    const grid = document.createElement('div');
    grid.className = 'mc-grid';
    PALETTE.forEach((row) => row.forEach((hex) => grid.appendChild(makeSwatch(hex, current, finish))));
    el.appendChild(grid);

    const customLabel = document.createElement('div');
    customLabel.className = 'mc-label';
    customLabel.textContent = 'Custom';
    el.appendChild(customLabel);

    const row = document.createElement('div');
    row.className = 'mc-row';
    readRecents().forEach((hex) => row.appendChild(makeSwatch(hex, current, finish)));

    const customBtn = document.createElement('button');
    customBtn.type = 'button';
    customBtn.className = 'mc-swatch mc-plus';
    customBtn.title = 'Custom colour';
    customBtn.setAttribute('aria-label', 'Custom colour');
    customBtn.textContent = '+';
    row.appendChild(customBtn);

    if (eyedropperSupported()) {
      const eyeBtn = document.createElement('button');
      eyeBtn.type = 'button';
      eyeBtn.className = 'mc-swatch mc-eyedrop';
      eyeBtn.title = 'Pick a colour from the screen';
      eyeBtn.setAttribute('aria-label', 'Pick a colour from the screen');
      eyeBtn.innerHTML = EYEDROPPER_SVG;
      eyeBtn.addEventListener('mousedown', (e) => e.preventDefault());
      eyeBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        /* The picker has to get out of the way before the overlay opens, or
           the only thing under the loupe is the picker itself. */
        el.style.visibility = 'hidden';
        try {
          const res = await new window.EyeDropper().open();
          finish(normalizeHex(res && res.sRGBHex));
        } catch {
          /* Escape during the pick: leave the document untouched. */
          closeOpen();
        }
      });
      row.appendChild(eyeBtn);
    }
    el.appendChild(row);

    const panel = document.createElement('div');
    panel.className = 'mc-custom hidden';
    const native = document.createElement('input');
    native.type = 'color';
    native.className = 'mc-native';
    native.value = current || '#000000';
    native.title = 'Colour wheel';
    const hexField = document.createElement('input');
    hexField.type = 'text';
    hexField.className = 'mc-hex';
    hexField.spellcheck = false;
    hexField.placeholder = '#RRGGBB';
    hexField.value = current || '';
    hexField.setAttribute('aria-label', 'Hex colour');
    const applyBtn = document.createElement('button');
    applyBtn.type = 'button';
    applyBtn.className = 'btn ghost mc-apply';
    applyBtn.textContent = 'Apply';

    const applyTyped = () => {
      const hex = normalizeHex(hexField.value);
      if (!hex) {
        hexField.classList.add('is-bad');
        hexField.focus();
        hexField.select();
        return;
      }
      finish(hex);
    };
    native.addEventListener('input', () => {
      hexField.value = native.value;
      hexField.classList.remove('is-bad');
    });
    hexField.addEventListener('input', () => {
      hexField.classList.remove('is-bad');
      const hex = normalizeHex(hexField.value);
      if (hex) native.value = hex;
    });
    hexField.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); applyTyped(); }
    });
    applyBtn.addEventListener('mousedown', (e) => e.preventDefault());
    applyBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      applyTyped();
    });
    panel.append(native, hexField, applyBtn);
    el.appendChild(panel);

    customBtn.addEventListener('mousedown', (e) => e.preventDefault());
    customBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      panel.classList.toggle('hidden');
      if (!panel.classList.contains('hidden')) {
        place(el, anchor);
        hexField.focus();
        hexField.select();
      }
    });

    const onDocMouseDown = (e) => { if (!el.contains(e.target) && !anchor.contains(e.target)) closeOpen(); };
    const onKeyDown = (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeOpen(); } };
    const onReflow = () => place(el, anchor);

    place(el, anchor);
    openPop = { el, anchor, onDocMouseDown, onKeyDown, onReflow };
    setTimeout(() => {
      if (!openPop || openPop.el !== el) return;
      document.addEventListener('mousedown', onDocMouseDown, true);
      document.addEventListener('keydown', onKeyDown, true);
      window.addEventListener('resize', onReflow, true);
      window.addEventListener('scroll', onReflow, true);
    }, 0);
    return el;
  }

  window.MargoColorPicker = {
    PALETTE,
    open,
    close: closeOpen,
    normalizeHex,
    toHex,
    contrastInk,
    eyedropperSupported,
    readRecents
  };
})();
