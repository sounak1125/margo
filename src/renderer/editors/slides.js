/* Margo — presentation editor (slides).
   Deck model, static rendering and themes live in src/main/slides-core.js,
   shared with the main process that writes .pptx and exports PDF. This file
   is the interactive part: slide rail, 16:9 canvas with selection, handles,
   snapping and in-place rich text, inspector, speaker notes and the
   full-screen slideshow. */
(function () {
  const C = window.MargoSlidesCore;
  if (!C) return;

  const SV = (d) =>
    `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const IC = {
    newSlide: SV('<rect x="1.8" y="3.2" width="9.4" height="7.6" rx="1.3"/><path d="M13.2 8.8v4.4M11 11h4.4"/>'),
    chevron: SV('<path d="m4.5 6.5 3.5 3.5 3.5-3.5"/>'),
    textBox: SV('<path d="M3.5 4.5V3h9v1.5M8 3v10M6.2 13h3.6"/>'),
    shapes: SV('<rect x="1.8" y="7.2" width="7" height="7" rx="1.2"/><circle cx="10.6" cy="5.4" r="3.6"/>'),
    rect: SV('<rect x="2.5" y="3.5" width="11" height="9" rx="0.6"/>'),
    roundRect: SV('<rect x="2.5" y="3.5" width="11" height="9" rx="2.6"/>'),
    ellipse: SV('<ellipse cx="8" cy="8" rx="5.6" ry="4.6"/>'),
    triangle: SV('<path d="M8 2.8 13.8 13H2.2z"/>'),
    diamond: SV('<path d="M8 2 14 8l-6 6-6-6z"/>'),
    line: SV('<path d="M3 13 13 3"/>'),
    arrow: SV('<path d="M3 13 12.6 3.4M7.6 3.2h5.2v5.2"/>'),
    image: SV('<rect x="2" y="3" width="12" height="10" rx="1.8"/><circle cx="5.6" cy="6.4" r="1.1"/><path d="m3 11.5 3.2-3 2.3 2.2 2.5-2.7 2 2"/>'),
    bold: SV('<path d="M4.5 2.8h4.3a2.6 2.6 0 0 1 0 5.2H4.5zM4.5 8h5a2.6 2.6 0 0 1 0 5.2h-5z" stroke-width="1.9"/>'),
    italic: SV('<path d="M7 2.8h5M4 13.2h5M9.6 2.8 6.4 13.2"/>'),
    underline: SV('<path d="M4.5 2.5v5a3.5 3.5 0 0 0 7 0v-5M3.5 14h9"/>'),
    textColor: SV('<path d="m4 11 4-8.5 4 8.5M5.4 8h5.2"/>'),
    fill: SV('<path d="m7.2 2.2 5.6 5.6-4.6 4.6a1.4 1.4 0 0 1-2 0L2.6 8.8a1.4 1.4 0 0 1 0-2z"/><path d="M13.6 10.6s1 1.3 1 2a1 1 0 0 1-2 0c0-.7 1-2 1-2z"/>'),
    stroke: SV('<rect x="2.5" y="2.5" width="11" height="11" rx="2" stroke-dasharray="2.2 1.8"/>'),
    sizeUp: SV('<path d="M2 13 5.5 4 9 13M3.3 10h4.4M11 6.5h4M13 4.5v4"/>'),
    sizeDown: SV('<path d="M2 13 5.5 4 9 13M3.3 10h4.4M11 6.5h4"/>'),
    front: SV('<rect x="5" y="5" width="8.5" height="8.5" rx="1.2" fill="currentColor" fill-opacity=".18"/><path d="M3 10.5H2.5v-8h8V3"/>'),
    back: SV('<rect x="2.5" y="2.5" width="8.5" height="8.5" rx="1.2"/><path d="M13.5 6v7.5H6" /><path d="M11 5.5h2.5v2" stroke-opacity=".5"/>'),
    forward: SV('<rect x="5" y="5" width="8.5" height="8.5" rx="1.2"/><path d="M11 5V2.5H2.5V11H5"/>'),
    backward: SV('<rect x="2.5" y="2.5" width="8.5" height="8.5" rx="1.2"/><path d="M5 11v2.5h8.5V5H11"/>'),
    arrange: SV('<rect x="2" y="2" width="7.5" height="7.5" rx="1.2"/><rect x="6.5" y="6.5" width="7.5" height="7.5" rx="1.2" fill="currentColor" fill-opacity=".18"/>'),
    play: SV('<path d="M5 3.2v9.6L12.8 8z" fill="currentColor" fill-opacity=".15"/>'),
    notes: SV('<rect x="2" y="2.5" width="12" height="11" rx="1.6"/><path d="M2 9.5h12M4.5 11.5h5"/>'),
    inspector: SV('<rect x="2" y="2.5" width="12" height="11" rx="1.6"/><path d="M10 2.5v11M11.8 5.5h.6M11.8 7.8h.6"/>'),
    duplicate: SV('<rect x="5" y="5" width="8.5" height="8.5" rx="1.4"/><path d="M11 5V3.8A1.3 1.3 0 0 0 9.7 2.5H3.8a1.3 1.3 0 0 0-1.3 1.3v5.9A1.3 1.3 0 0 0 3.8 11H5"/>'),
    trash: SV('<path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.4a1.2 1.2 0 0 0 1.2 1.1h3.4a1.2 1.2 0 0 0 1.2-1.1l.6-8.4"/>'),
    theme: SV('<path d="M8 2a6 6 0 1 0 0 12c.9 0 1.4-.6 1.4-1.3 0-.8-.6-1-.6-1.8 0-.7.6-1.2 1.3-1.2H12a2 2 0 0 0 2-2A5.8 5.8 0 0 0 8 2z"/><circle cx="5" cy="7" r=".8" fill="currentColor"/><circle cx="7.5" cy="4.8" r=".8" fill="currentColor"/><circle cx="10.6" cy="5.4" r=".8" fill="currentColor"/>'),
    layout: SV('<rect x="2" y="2.5" width="12" height="11" rx="1.4"/><path d="M2 6h12M7 6v7.5"/>'),
    alignLeft: SV('<path d="M2.5 3.5h11M2.5 6.5h7M2.5 9.5h11M2.5 12.5h7"/>'),
    alignCenter: SV('<path d="M2.5 3.5h11M4.5 6.5h7M2.5 9.5h11M4.5 12.5h7"/>'),
    alignRight: SV('<path d="M2.5 3.5h11M6.5 6.5h7M2.5 9.5h11M6.5 12.5h7"/>'),
    alignJustify: SV('<path d="M2.5 3.5h11M2.5 6.5h11M2.5 9.5h11M2.5 12.5h11"/>'),
    bullets: SV('<circle cx="3" cy="4" r=".9" fill="currentColor" stroke="none"/><circle cx="3" cy="8" r=".9" fill="currentColor" stroke="none"/><circle cx="3" cy="12" r=".9" fill="currentColor" stroke="none"/><path d="M6.5 4h7M6.5 8h7M6.5 12h7"/>'),
    numbers: SV('<path d="M2.4 3.2 3.4 2.6v3.6M2.4 9.4c.2-.6.7-.9 1.2-.9.6 0 1 .4 1 .9 0 .9-2.2 1.5-2.2 2.9h2.3M7 4h6.5M7 8h6.5M7 12h6.5"/>'),
    indent: SV('<path d="M6.5 4h7M6.5 8h7M6.5 12h7M2.2 6l2.2 2-2.2 2"/>'),
    outdent: SV('<path d="M6.5 4h7M6.5 8h7M6.5 12h7M4.4 6 2.2 8l2.2 2"/>'),
    vTop: SV('<path d="M2.5 2.5h11M8 13V5.5M5.5 8 8 5.5 10.5 8"/>'),
    vMid: SV('<path d="M2.5 8h11M8 1.8v3.4M6.3 3.7 8 5.3l1.7-1.6M8 14.2v-3.4M6.3 12.3 8 10.7l1.7 1.6"/>'),
    vBottom: SV('<path d="M2.5 13.5h11M8 3v7.5M5.5 8 8 10.5 10.5 8"/>'),
    aLeft: SV('<path d="M2.5 2v12"/><rect x="4.5" y="4" width="8" height="3" rx=".8"/><rect x="4.5" y="9" width="5" height="3" rx=".8"/>'),
    aCenterH: SV('<path d="M8 2v12"/><rect x="3.5" y="4" width="9" height="3" rx=".8"/><rect x="5" y="9" width="6" height="3" rx=".8"/>'),
    aRight: SV('<path d="M13.5 2v12"/><rect x="3.5" y="4" width="8" height="3" rx=".8"/><rect x="6.5" y="9" width="5" height="3" rx=".8"/>'),
    aTop: SV('<path d="M2 2.5h12"/><rect x="4" y="4.5" width="3" height="8" rx=".8"/><rect x="9" y="4.5" width="3" height="5" rx=".8"/>'),
    aMiddle: SV('<path d="M2 8h12"/><rect x="4" y="3.5" width="3" height="9" rx=".8"/><rect x="9" y="5" width="3" height="6" rx=".8"/>'),
    aBottom: SV('<path d="M2 13.5h12"/><rect x="4" y="3.5" width="3" height="8" rx=".8"/><rect x="9" y="6.5" width="3" height="5" rx=".8"/>'),
    distH: SV('<path d="M2 2.5v11M14 2.5v11"/><rect x="6" y="4.5" width="4" height="7" rx=".8"/>'),
    distV: SV('<path d="M2.5 2h11M2.5 14h11"/><rect x="4.5" y="6" width="7" height="4" rx=".8"/>'),
    prev: SV('<path d="m10 3.5-4.5 4.5 4.5 4.5"/>'),
    next: SV('<path d="m6 3.5 4.5 4.5L6 12.5"/>'),
    close: SV('<path d="m4 4 8 8M12 4l-8 8"/>'),
    plus: SV('<path d="M8 3v10M3 8h10"/>'),
    grid: SV('<rect x="2" y="2" width="5" height="5" rx="1"/><rect x="9" y="2" width="5" height="5" rx="1"/><rect x="2" y="9" width="5" height="5" rx="1"/><rect x="9" y="9" width="5" height="5" rx="1"/>'),
    undo: SV('<path d="M3 6h7a3.5 3.5 0 0 1 0 7H6"/><path d="M5.5 3.5 3 6l2.5 2.5"/>'),
    redo: SV('<path d="M13 6H6a3.5 3.5 0 0 0 0 7h4"/><path d="M10.5 3.5 13 6l-2.5 2.5"/>')
  };

  const FONT_SIZES = [10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 44, 48, 54, 60, 66, 72, 80, 96];
  const SNAP_PX = 6;          // screen pixels
  const NOTES_KEY = 'margo.slides.notesOpen';
  const INSPECTOR_KEY = 'margo.slides.inspectorOpen';
  const CLIP_PREFIX = 'margo-slides:';
  let styleInjected = false;
  /* One clipboard for every open deck, so elements copy between tabs. */
  const clip = { elements: null, text: '' };

  function injectCoreCss() {
    if (styleInjected) return;
    styleInjected = true;
    const st = document.createElement('style');
    st.id = 'margo-slides-core-css';
    st.textContent = C.SLIDE_CSS;
    document.head.appendChild(st);
  }

  function lsGet(key, def) {
    try { const v = localStorage.getItem(key); return v == null ? def : v === '1'; } catch { return def; }
  }
  function lsSet(key, v) { try { localStorage.setItem(key, v ? '1' : '0'); } catch {} }

  function h(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function r2(n) { return Math.round(n * 100) / 100; }
  function isTypingTarget(t) {
    if (!t || !t.closest) return false;
    if (t.closest('input, textarea, select')) return true;
    if (t.isContentEditable) return true;
    return false;
  }
  function cssColorToHex(v) {
    if (!v) return null;
    const P = window.MargoColorPicker;
    if (P && P.toHex) return P.toHex(v);
    return C.normHex(v);
  }

  /* ---------------- popover menus ---------------- */
  let openPopEl = null;
  function closePop() {
    if (!openPopEl) return;
    const p = openPopEl;
    openPopEl = null;
    if (p.cleanup) p.cleanup();
    p.remove();
  }
  function openPop(anchor, build, opts) {
    closePop();
    const pop = h('div', 'sl-pop' + (opts && opts.className ? ' ' + opts.className : ''));
    pop.setAttribute('role', 'menu');
    build(pop);
    document.body.appendChild(pop);
    const place = () => {
      const r = anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : anchor;
      const pw = pop.offsetWidth, ph = pop.offsetHeight;
      let x = r.left, y = r.bottom + 6;
      if (opts && opts.at) { x = opts.at.x; y = opts.at.y; }
      if (x + pw > window.innerWidth - 8) x = Math.max(8, window.innerWidth - pw - 8);
      if (y + ph > window.innerHeight - 8) y = Math.max(8, (opts && opts.at ? opts.at.y : r.top - 6) - ph);
      pop.style.left = x + 'px';
      pop.style.top = y + 'px';
    };
    place();
    const onDown = (e) => { if (!pop.contains(e.target) && !(anchor.contains && anchor.contains(e.target))) closePop(); };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); closePop(); } };
    setTimeout(() => {
      if (openPopEl !== pop) return;
      document.addEventListener('mousedown', onDown, true);
      document.addEventListener('keydown', onKey, true);
      window.addEventListener('resize', closePop);
    }, 0);
    pop.cleanup = () => {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', closePop);
    };
    openPopEl = pop;
    return pop;
  }
  function menuItem(pop, label, icon, fn, opts) {
    const b = h('button', 'sl-pop-item' + (opts && opts.checked ? ' checked' : ''));
    b.type = 'button';
    b.innerHTML = (icon ? `<span class="sl-pop-ic">${icon}</span>` : '<span class="sl-pop-ic"></span>') +
      `<span class="sl-pop-label">${C.escapeHtml(label)}</span>` +
      (opts && opts.accel ? `<span class="sl-pop-accel">${C.escapeHtml(opts.accel)}</span>` : '');
    if (opts && opts.disabled) b.disabled = true;
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('click', () => { closePop(); fn(); });
    pop.appendChild(b);
    return b;
  }
  function menuSep(pop) { pop.appendChild(h('div', 'sl-pop-sep')); }

  /* Mini diagrams for the layout picker. */
  function layoutIcon(id) {
    const box = (x, y, w, hh, cls) => `<rect x="${x}" y="${y}" width="${w}" height="${hh}" rx="1.5" class="${cls || ''}"/>`;
    const parts = {
      title: box(10, 20, 44, 9, 'lt') + box(18, 33, 28, 4),
      'title-content': box(6, 5, 52, 7, 'lt') + box(6, 15, 52, 20),
      'two-content': box(6, 5, 52, 7, 'lt') + box(6, 15, 25, 20) + box(33, 15, 25, 20),
      section: box(6, 17, 52, 9, 'lt') + box(6, 29, 36, 4),
      'title-only': box(6, 5, 52, 7, 'lt'),
      'image-caption': box(6, 8, 20, 7, 'lt') + box(6, 18, 20, 14) + box(30, 6, 28, 28, 'im'),
      blank: ''
    };
    return `<svg class="sl-layout-ic" viewBox="0 0 64 40" aria-hidden="true"><rect x=".5" y=".5" width="63" height="39" rx="3" class="bg${id === 'section' ? ' dark' : ''}"/>${parts[id] || ''}</svg>`;
  }

  function themeSwatch(t) {
    return `<span class="sl-theme-card" style="background:${t.bg}">` +
      `<span class="sl-theme-aa" style="color:${t.title};font-family:${C.escapeHtml(C.fontCss(t.titleFont))};font-weight:${t.titleBold ? 700 : 400}">Aa</span>` +
      `<span class="sl-theme-dots"><i style="background:${t.accent}"></i><i style="background:${t.accent2}"></i><i style="background:${t.text}"></i></span>` +
      `</span>`;
  }

  /* ---------------- image helpers ---------------- */
  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result || ''));
      fr.onerror = () => reject(fr.error || new Error('Could not read image'));
      fr.readAsDataURL(file);
    });
  }
  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Not a readable image'));
      img.src = src;
    });
  }
  /* PowerPoint reads PNG, JPEG and GIF everywhere; anything else (SVG, WebP,
     BMP) is rasterized to PNG, and very large pictures are brought down to a
     size a slide can use so the deck stays a reasonable file. */
  async function normalizeImage(dataUrl) {
    const img = await loadImage(dataUrl);
    let w = img.naturalWidth || img.width || 0;
    let hh = img.naturalHeight || img.height || 0;
    if (!w || !hh) { w = 800; hh = 600; }
    const mime = (/^data:([^;,]+)/.exec(dataUrl) || [])[1] || '';
    const MAX = 2560;
    const keep = /^image\/(png|jpeg|gif)$/i.test(mime) && Math.max(w, hh) <= MAX;
    if (keep) return { src: dataUrl, nw: w, nh: hh };
    const scale = Math.min(1, MAX / Math.max(w, hh));
    const cw = Math.max(1, Math.round(w * scale));
    const ch = Math.max(1, Math.round(hh * scale));
    const c = document.createElement('canvas');
    c.width = cw; c.height = ch;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0, cw, ch);
    const out = /jpe?g/i.test(mime) ? c.toDataURL('image/jpeg', 0.9) : c.toDataURL('image/png');
    return { src: out, nw: cw, nh: ch };
  }
  function pickImageFile() {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/png,image/jpeg,image/gif,image/webp,image/svg+xml,image/bmp';
      input.style.display = 'none';
      document.body.appendChild(input);
      input.addEventListener('change', () => {
        const f = input.files && input.files[0];
        input.remove();
        resolve(f || null);
      });
      input.click();
      // If the dialog is dismissed there is no change event; the input is tiny and detached on the next pick.
      setTimeout(() => { if (input.isConnected && !input.files.length) input.remove(); }, 120000);
    });
  }

  /* ================================================================= */
  function create(ctx) {
    let deck = null;
    let cur = 0;
    let sel = [];
    let editingId = null;
    let k = 1;
    let zoomMode = 'fit';
    let hostEl = null;
    let notesOpen = lsGet(NOTES_KEY, true);
    let inspectorOpen = lsGet(INSPECTOR_KEY, true);
    let focusArea = 'stage';
    let thumbTimer = null;
    const pendingThumbs = new Set();
    let resizeObs = null;
    let show = null;
    let destroyed = false;
    let findState = { q: '', slide: 0, el: -1 };
    const history = window.MargoHistory.create({ limit: 120, coalesceMs: 600 });
    const imgStore = new Map();   // dataUrl -> key
    const imgByKey = new Map();   // key -> dataUrl
    const E = {};                 // DOM references

    const W = () => deck.size.w;
    const H = () => deck.size.h;
    const slide = () => deck.slides[cur];
    const elById = (id) => slide().elements.find((e) => e.id === id) || null;
    const selected = () => sel.map(elById).filter(Boolean);

    /* ---------- history (images interned so snapshots stay small) ---------- */
    function internSrc(v) {
      if (typeof v !== 'string' || !v.startsWith('data:') || v.length < 256) return v;
      let key = imgStore.get(v);
      if (!key) {
        key = '@img' + imgStore.size;
        imgStore.set(v, key);
        imgByKey.set(key, v);
      }
      return key;
    }
    function snapshot() {
      return JSON.stringify({ deck, cur, sel }, (k2, v) => ((k2 === 'src' || k2 === 'image') ? internSrc(v) : v));
    }
    function restoreSnap(str) {
      const s = JSON.parse(str, (k2, v) => ((k2 === 'src' || k2 === 'image') && typeof v === 'string' && imgByKey.has(v) ? imgByKey.get(v) : v));
      editingId = null;
      deck = s.deck;
      cur = clamp(s.cur || 0, 0, deck.slides.length - 1);
      sel = (s.sel || []).filter((id) => elById(id));
      ctx.markDirty();
      renderAll();
    }
    function record(coalesce) {
      history.record(snapshot(), coalesce ? { coalesce: true } : undefined);
    }
    /* Every model change goes through here: repaint what changed, mark the
       document dirty, and push an undo step. */
    function commit(opts) {
      const o = opts || {};
      ctx.markDirty();
      if (o.rail) renderRail(); else queueThumb(cur);
      if (!o.keepStage) renderStage();
      renderSelection();
      if (!o.keepInspector) renderInspector();
      syncToolbar();
      updateStatus();
      if (!o.noHistory) record(!!o.coalesce);
    }

    /* ---------- layout / scale ---------- */
    function fitScale() {
      const vp = E.viewport;
      if (!vp) return 1;
      const pad = 40;
      const vw = Math.max(50, vp.clientWidth - pad * 2);
      const vh = Math.max(50, vp.clientHeight - pad * 2);
      return Math.max(0.05, Math.min(vw / W(), vh / H()));
    }
    function applyScale() {
      if (!E.viewport) return;
      k = zoomMode === 'fit' ? fitScale() : zoomMode;
      E.stageBox.style.width = Math.round(W() * k) + 'px';
      E.stageBox.style.height = Math.round(H() * k) + 'px';
      E.stage.style.width = W() + 'px';
      E.stage.style.height = H() + 'px';
      E.stage.style.transform = `scale(${k})`;
      E.viewport.classList.toggle('is-zoomed', zoomMode !== 'fit' && (W() * k > E.viewport.clientWidth - 20 || H() * k > E.viewport.clientHeight - 20));
      renderSelection();
      if (ctx.status) ctx.status.setZoom(r2(k), 0.1, 3);
    }
    function setZoom(z) {
      zoomMode = clamp(+z || 1, 0.1, 3);
      applyScale();
    }
    function zoomBy(f) { setZoom((zoomMode === 'fit' ? k : zoomMode) * f); }
    function zoomFit() { zoomMode = 'fit'; applyScale(); }

    function toSlide(e) {
      const r = E.stageBox.getBoundingClientRect();
      return { x: (e.clientX - r.left) / k, y: (e.clientY - r.top) / k };
    }

    /* ---------- status ---------- */
    function statusText() {
      return `Slide ${cur + 1} of ${deck.slides.length}`;
    }
    function updateStatus() {
      if (!ctx.status) return;
      const n = selected().length;
      ctx.status.setLeft(statusText() + (n > 1 ? ` · ${n} objects selected` : ''));
    }

    /* ---------- rendering ---------- */
    function renderAll() {
      renderRail();
      renderStage();
      renderSelection();
      renderInspector();
      renderNotes();
      syncToolbar();
      updateStatus();
    }

    function thumbHtml(i) {
      const s = deck.slides[i];
      const tw = E.rail ? 168 : 168;
      const sc = tw / W();
      return `<div class="sl-thumb-scale" style="transform:scale(${sc});width:${W()}px;height:${H()}px">${C.slideHtml(deck, s, { editor: false })}</div>`;
    }
    function renderRail() {
      if (!E.railList) return;
      const tw = 168;
      const th = Math.round(tw * H() / W());
      E.railList.innerHTML = '';
      deck.slides.forEach((s, i) => {
        const item = h('div', 'sl-thumb' + (i === cur ? ' active' : ''));
        item.dataset.index = String(i);
        item.setAttribute('role', 'option');
        item.setAttribute('aria-selected', i === cur ? 'true' : 'false');
        const title = C.slideTitle(s);
        item.title = `Slide ${i + 1}${title ? ' — ' + title : ''}`;
        item.innerHTML =
          `<span class="sl-thumb-num">${i + 1}</span>` +
          `<div class="sl-thumb-frame" style="width:${tw}px;height:${th}px">${thumbHtml(i)}</div>` +
          (s.notes && s.notes.trim() ? '<span class="sl-thumb-notes" title="Has speaker notes"></span>' : '');
        E.railList.appendChild(item);
      });
      pendingThumbs.clear();
      scrollThumbIntoView();
    }
    function scrollThumbIntoView() {
      const a = E.railList && E.railList.querySelector('.sl-thumb.active');
      if (a && a.scrollIntoView) a.scrollIntoView({ block: 'nearest' });
    }
    function queueThumb(i) {
      pendingThumbs.add(i);
      clearTimeout(thumbTimer);
      thumbTimer = setTimeout(flushThumbs, 140);
    }
    function flushThumbs() {
      if (!E.railList || destroyed) return;
      pendingThumbs.forEach((i) => {
        const item = E.railList.querySelector(`.sl-thumb[data-index="${i}"]`);
        if (!item || !deck.slides[i]) return;
        const frame = item.querySelector('.sl-thumb-frame');
        if (frame) frame.innerHTML = thumbHtml(i);
        const s = deck.slides[i];
        const hasNotes = !!(s.notes && s.notes.trim());
        const dot = item.querySelector('.sl-thumb-notes');
        if (hasNotes && !dot) item.insertAdjacentHTML('beforeend', '<span class="sl-thumb-notes" title="Has speaker notes"></span>');
        else if (!hasNotes && dot) dot.remove();
        const title = C.slideTitle(s);
        item.title = `Slide ${i + 1}${title ? ' — ' + title : ''}`;
      });
      pendingThumbs.clear();
    }
    function markRailActive() {
      if (!E.railList) return;
      E.railList.querySelectorAll('.sl-thumb').forEach((t) => {
        const on = +t.dataset.index === cur;
        t.classList.toggle('active', on);
        t.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      scrollThumbIntoView();
    }

    function renderStage() {
      if (!E.stage) return;
      if (editingId) {
        // Keep the text being edited (and its caret); refresh everything around it.
        const s = slide();
        const slideEl = E.stage.firstElementChild;
        if (slideEl) {
          slideEl.setAttribute('style', `width:${W()}px;height:${H()}px;${C.backgroundCss(deck, s)}`);
          const keep = slideEl.querySelector(`.ms-el[data-id="${CSS.escape(editingId)}"]`);
          Array.from(slideEl.children).forEach((c) => { if (c !== keep) c.remove(); });
          s.elements.forEach((el) => {
            if (el.id === editingId) { if (keep) { slideEl.appendChild(keep); patchElementBox(el); } return; }
            const tmp = document.createElement('div');
            tmp.innerHTML = C.elementHtml(deck, s, el, { editor: true });
            if (tmp.firstElementChild) slideEl.appendChild(tmp.firstElementChild);
          });
          decorateStage();
          return;
        }
      }
      E.stage.innerHTML = C.slideHtml(deck, slide(), { editor: true, className: 'sl-slide' });
      decorateStage();
    }
    /* Lines are hit-tested on a wide invisible stroke; image placeholders get their prompt. */
    function decorateStage() {
      E.stage.querySelectorAll('.ms-line svg').forEach((svg) => {
        const line = svg.querySelector('line');
        if (!line || svg.querySelector('.sl-hitline')) return;
        const hit = line.cloneNode(false);
        hit.setAttribute('class', 'sl-hitline');
        hit.setAttribute('stroke', 'transparent');
        hit.setAttribute('stroke-width', String(Math.max(12, 14 / k)));
        const d = C.lineEnds(elById(svg.parentElement.dataset.id) || { w: 0, h: 0 });
        hit.setAttribute('x1', d.x1); hit.setAttribute('y1', d.y1);
        hit.setAttribute('x2', d.x2); hit.setAttribute('y2', d.y2);
        svg.appendChild(hit);
      });
      E.stage.querySelectorAll('.ms-image.is-placeholder').forEach((ph) => {
        if (ph.querySelector('.sl-img-ph')) return;
        ph.innerHTML = `<div class="sl-img-ph">${IC.image}<span>Double-click to add a picture</span></div>`;
      });
    }
    function elNode(id) {
      return E.stage && E.stage.querySelector(`.ms-el[data-id="${CSS.escape(id)}"]`);
    }
    /* Box-level restyle of one element without touching its text (used while editing). */
    function patchElementBox(el) {
      const node = elNode(el.id);
      if (!node) return;
      node.setAttribute('style', C.geomStyle(el));
      const tx = node.querySelector('.ms-tx');
      if (tx && el.type === 'text') tx.setAttribute('style', C.textBoxStyle(deck, slide(), el));
    }

    /* ---------- selection overlay ---------- */
    function renderSelection() {
      if (!E.overlay) return;
      E.overlay.innerHTML = '';
      const els = selected();
      const single = els.length === 1 ? els[0] : null;
      els.forEach((el) => {
        const isLine = el.type === 'shape' && (el.shape === 'line' || el.shape === 'arrow');
        if (isLine) {
          const d = C.lineEnds(el);
          const x1 = (el.x + d.x1) * k, y1 = (el.y + d.y1) * k, x2 = (el.x + d.x2) * k, y2 = (el.y + d.y2) * k;
          const len = Math.hypot(x2 - x1, y2 - y1);
          const ang = Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI;
          const bar = h('div', 'sl-line-sel');
          bar.style.left = x1 + 'px';
          bar.style.top = y1 + 'px';
          bar.style.width = len + 'px';
          bar.style.transform = `rotate(${ang}deg)`;
          E.overlay.appendChild(bar);
          if (single) {
            [['p1', x1, y1], ['p2', x2, y2]].forEach(([hn, x, y]) => {
              const hd = h('div', 'sl-handle sl-handle-pt');
              hd.dataset.handle = hn;
              hd.style.left = x + 'px';
              hd.style.top = y + 'px';
              E.overlay.appendChild(hd);
            });
          }
          return;
        }
        const f = h('div', 'sl-frame' + (el.id === editingId ? ' editing' : ''));
        f.style.left = el.x * k + 'px';
        f.style.top = el.y * k + 'px';
        f.style.width = Math.max(1, el.w * k) + 'px';
        f.style.height = Math.max(1, el.h * k) + 'px';
        if (el.rot) f.style.transform = `rotate(${el.rot}deg)`;
        if (single) {
          ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].forEach((hn) => {
            const hd = h('div', 'sl-handle sl-h-' + hn);
            hd.dataset.handle = hn;
            f.appendChild(hd);
          });
          if (el.id !== editingId) {
            const rot = h('div', 'sl-handle sl-h-rot');
            rot.dataset.handle = 'rot';
            rot.title = 'Rotate (Shift snaps to 15°)';
            f.appendChild(rot);
          }
        }
        E.overlay.appendChild(f);
      });
    }
    function showGuides(gx, gy) {
      E.overlay.querySelectorAll('.sl-guide').forEach((g) => g.remove());
      (gx || []).forEach((x) => {
        const g = h('div', 'sl-guide v');
        g.style.left = x * k + 'px';
        E.overlay.appendChild(g);
      });
      (gy || []).forEach((y) => {
        const g = h('div', 'sl-guide hz');
        g.style.top = y * k + 'px';
        E.overlay.appendChild(g);
      });
    }

    function setSel(ids, opts) {
      sel = Array.from(new Set(ids)).filter((id) => elById(id));
      renderSelection();
      if (!(opts && opts.keepInspector)) renderInspector();
      syncToolbar();
      updateStatus();
    }

    /* ---------- slides ---------- */
    function goTo(i, opts) {
      if (editingId) endEdit();
      const n = clamp(i, 0, deck.slides.length - 1);
      if (n === cur && !(opts && opts.force)) return;
      cur = n;
      sel = [];
      renderStage();
      renderSelection();
      renderInspector();
      renderNotes();
      markRailActive();
      syncToolbar();
      updateStatus();
    }
    function addSlide(layoutId, at) {
      if (editingId) endEdit();
      const lay = layoutId || (slide() && slide().layout && !['title', 'section', 'blank'].includes(slide().layout) ? slide().layout : 'title-content');
      const s = C.makeSlide(lay, deck.size);
      const idx = at == null ? cur + 1 : at;
      deck.slides.splice(idx, 0, s);
      cur = idx;
      sel = [];
      commit({ rail: true });
      renderNotes();
      return s;
    }
    function freshIds(el) {
      const c = C.clone(el);
      c.id = C.uid(c.type[0]);
      return c;
    }
    function duplicateSlide(i) {
      if (editingId) endEdit();
      const idx = i == null ? cur : i;
      const s = C.clone(deck.slides[idx]);
      s.id = C.uid('sl');
      s.elements = s.elements.map(freshIds);
      deck.slides.splice(idx + 1, 0, s);
      cur = idx + 1;
      sel = [];
      commit({ rail: true });
      renderNotes();
    }
    function deleteSlide(i) {
      if (editingId) endEdit();
      const idx = i == null ? cur : i;
      if (deck.slides.length <= 1) {
        // A deck always keeps one slide; deleting the last one clears it instead.
        deck.slides[0] = C.makeSlide('blank', deck.size);
        cur = 0;
      } else {
        deck.slides.splice(idx, 1);
        if (cur >= deck.slides.length) cur = deck.slides.length - 1;
        else if (idx < cur) cur -= 1;
      }
      sel = [];
      commit({ rail: true });
      renderNotes();
    }
    function moveSlide(from, to) {
      if (from === to || from < 0 || to < 0 || from >= deck.slides.length || to > deck.slides.length) return;
      const [s] = deck.slides.splice(from, 1);
      const dest = to > from ? to - 1 : to;
      deck.slides.splice(dest, 0, s);
      cur = dest;
      sel = [];
      commit({ rail: true });
      renderNotes();
    }

    /* Re-lay a slide: placeholders take the new layout's boxes (their text
       comes along), everything the author placed stays where it is. */
    function applyLayout(layoutId) {
      if (editingId) endEdit();
      const s = slide();
      const fresh = C.layoutElements(layoutId, deck.size);
      const oldByRole = {};
      s.elements.forEach((e) => {
        if (e.type === 'text' && e.role) (oldByRole[e.role] = oldByRole[e.role] || []).push(e);
        if (e.type === 'image' && e.fit === 'cover' && !e.src) (oldByRole.picture = oldByRole.picture || []).push(e);
      });
      const kept = s.elements.filter((e) => !(e.type === 'text' && e.role) && !(e.type === 'image' && !e.src));
      const used = new Set();
      const next = fresh.map((f) => {
        const role = f.type === 'text' ? f.role : null;
        if (role && oldByRole[role] && oldByRole[role].length) {
          const old = oldByRole[role].shift();
          used.add(old.id);
          return Object.assign(C.clone(old), { x: f.x, y: f.y, w: f.w, h: f.h, valign: f.valign, size: old.size || f.size });
        }
        return f;
      });
      // Leftover placeholders with text become plain text boxes so nothing is lost.
      Object.keys(oldByRole).forEach((role) => (oldByRole[role] || []).forEach((old) => {
        if (used.has(old.id) || old.type !== 'text' || C.isTextEmpty(old)) return;
        kept.push(Object.assign(C.clone(old), { role: role === 'title' ? 'title' : null, prompt: '' }));
      }));
      // Decorative accent from the old layout (title rule) is dropped with it
      const decorFree = kept.filter((e) => !(e.type === 'shape' && e.shape === 'roundRect' && e.h <= 8 && e.fill === 'accent' && s.layout === 'title'));
      s.elements = next.concat(decorFree);
      s.layout = layoutId;
      sel = [];
      commit();
    }

    function setTheme(id) {
      if (editingId) endEdit();
      deck.theme = id;
      commit({ rail: true });
    }

    /* ---------- elements ---------- */
    function insertElements(list, opts) {
      if (editingId) endEdit();
      list.forEach((el) => slide().elements.push(el));
      sel = list.map((e) => e.id);
      commit();
      if (opts && opts.edit && list.length === 1 && list[0].type === 'text') startEdit(list[0].id, { selectAll: true });
    }
    function addTextBox() {
      const w = Math.round(W() * 0.42);
      const el = C.textEl({
        x: Math.round((W() - w) / 2), y: Math.round(H() / 2 - 30), w, h: 60,
        size: 24, paragraphs: [C.para('')]
      });
      insertElements([el], { edit: true });
    }
    function addShape(kind) {
      const s = Math.round(Math.min(W(), H()) * 0.3);
      const base = { x: Math.round(W() / 2 - s * 0.7), y: Math.round(H() / 2 - s / 2), w: Math.round(s * 1.4), h: s };
      let el;
      if (kind === 'line' || kind === 'arrow') {
        el = C.shapeEl(Object.assign(base, { shape: kind, h: 0, y: Math.round(H() / 2), fill: null, stroke: 'text', strokeWidth: 3 }));
      } else {
        el = C.shapeEl(Object.assign(base, { shape: kind, fill: 'accent', stroke: null, strokeWidth: 2, radius: Math.round(s * 0.14) }));
        if (kind === 'ellipse' || kind === 'triangle' || kind === 'diamond') el.w = el.h;
        el.x = Math.round((W() - el.w) / 2);
      }
      insertElements([el]);
    }
    async function addImageFromDataUrl(dataUrl, at) {
      let img;
      try { img = await normalizeImage(dataUrl); } catch (err) { ctx.toast((err && err.message) || 'Could not read that image', 'error'); return; }
      if (editingId) endEdit();
      // An empty picture placeholder that is selected takes the picture.
      const ph = selected().find((e) => e.type === 'image' && !e.src);
      if (ph) {
        Object.assign(ph, { src: img.src, nw: img.nw, nh: img.nh, fit: 'cover', crop: null });
        commit();
        return;
      }
      const maxW = W() * 0.6, maxH = H() * 0.6;
      const sc = Math.min(1, maxW / img.nw, maxH / img.nh);
      const w = Math.max(8, Math.round(img.nw * sc)), hh = Math.max(8, Math.round(img.nh * sc));
      const x = at ? Math.round(at.x - w / 2) : Math.round((W() - w) / 2);
      const y = at ? Math.round(at.y - hh / 2) : Math.round((H() - hh) / 2);
      insertElements([C.imageEl({ src: img.src, nw: img.nw, nh: img.nh, x, y, w, h: hh })]);
    }
    async function insertImagePicker(targetPh) {
      const f = await pickImageFile();
      if (!f) return;
      const url = await readFileAsDataUrl(f);
      if (targetPh) setSel([targetPh.id]);
      await addImageFromDataUrl(url);
    }
    async function replaceImage(el) {
      const f = await pickImageFile();
      if (!f) return;
      let img;
      try { img = await normalizeImage(await readFileAsDataUrl(f)); } catch (err) { ctx.toast('Could not read that image', 'error'); return; }
      el.src = img.src; el.nw = img.nw; el.nh = img.nh; el.crop = null;
      if (el.fit !== 'cover') el.h = Math.round(el.w * img.nh / img.nw);
      commit();
    }
    function deleteSelected() {
      if (!sel.length) return;
      const ids = new Set(sel);
      slide().elements = slide().elements.filter((e) => !ids.has(e.id));
      sel = [];
      commit();
    }
    function duplicateSelected() {
      const els = selected();
      if (!els.length) return;
      const copies = els.map((e) => Object.assign(freshIds(e), { x: e.x + 16, y: e.y + 16 }));
      insertElements(copies);
    }
    function nudge(dx, dy) {
      const els = selected();
      if (!els.length) return;
      els.forEach((e) => { e.x = r2(e.x + dx); e.y = r2(e.y + dy); });
      commit({ coalesce: true });
    }
    function zorder(dir) {
      const list = slide().elements;
      const ids = new Set(sel);
      if (!ids.size) return;
      if (dir === 'front') slide().elements = list.filter((e) => !ids.has(e.id)).concat(list.filter((e) => ids.has(e.id)));
      else if (dir === 'back') slide().elements = list.filter((e) => ids.has(e.id)).concat(list.filter((e) => !ids.has(e.id)));
      else if (dir === 'forward') {
        for (let i = list.length - 2; i >= 0; i--) {
          if (ids.has(list[i].id) && !ids.has(list[i + 1].id)) { const t = list[i]; list[i] = list[i + 1]; list[i + 1] = t; }
        }
      } else if (dir === 'backward') {
        for (let i = 1; i < list.length; i++) {
          if (ids.has(list[i].id) && !ids.has(list[i - 1].id)) { const t = list[i]; list[i] = list[i - 1]; list[i - 1] = t; }
        }
      }
      if (editingId) endEdit();
      commit();
    }
    function alignSelected(how) {
      const els = selected();
      if (!els.length) return;
      const toSlide = els.length === 1;
      const bb = toSlide ? { x: 0, y: 0, w: W(), h: H() } : bounds(els);
      els.forEach((e) => {
        if (how === 'left') e.x = bb.x;
        else if (how === 'center') e.x = r2(bb.x + bb.w / 2 - e.w / 2);
        else if (how === 'right') e.x = r2(bb.x + bb.w - e.w);
        else if (how === 'top') e.y = bb.y;
        else if (how === 'middle') e.y = r2(bb.y + bb.h / 2 - e.h / 2);
        else if (how === 'bottom') e.y = r2(bb.y + bb.h - e.h);
      });
      if (editingId) patchElementBox(elById(editingId));
      commit({ keepStage: !!editingId });
      if (editingId) renderStage();
    }
    function distribute(axis) {
      const els = selected();
      if (els.length < 3) return;
      const key = axis === 'h' ? 'x' : 'y', size = axis === 'h' ? 'w' : 'h';
      const sorted = els.slice().sort((a, b) => a[key] - b[key]);
      const first = sorted[0], last = sorted[sorted.length - 1];
      const total = sorted.reduce((s, e) => s + e[size], 0);
      const gap = (last[key] + last[size] - first[key] - total) / (sorted.length - 1);
      let pos = first[key];
      sorted.forEach((e) => { e[key] = r2(pos); pos += e[size] + gap; });
      commit();
    }
    function bounds(els) {
      let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
      els.forEach((e) => { x1 = Math.min(x1, e.x); y1 = Math.min(y1, e.y); x2 = Math.max(x2, e.x + e.w); y2 = Math.max(y2, e.y + e.h); });
      return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
    }

    /* ---------- clipboard ---------- */
    function copySelected(cut) {
      if (editingId) return false;
      const els = selected();
      if (!els.length) return false;
      clip.elements = C.clone(els);
      clip.text = els.filter((e) => e.type === 'text').map(C.elementText).join('\n') || CLIP_PREFIX + els.length;
      try { navigator.clipboard.writeText(clip.text).catch(() => {}); } catch {}
      if (cut) deleteSelected();
      return true;
    }
    function pasteElements() {
      if (!clip.elements || !clip.elements.length) return false;
      // Pasting where the originals (or anything identical) still sit offsets
      // the whole group, so the copy is visible and keeps its arrangement.
      const clash = clip.elements.some((e) => slide().elements.some((x) => x.id === e.id || (x.x === e.x && x.y === e.y && x.type === e.type)));
      const copies = clip.elements.map((e) => {
        const c = freshIds(e);
        if (clash) { c.x += 16; c.y += 16; }
        return c;
      });
      clip.elements = copies.map((c) => C.clone(c));
      insertElements(copies);
      return true;
    }
    function pasteText(text) {
      const t = String(text || '').replace(/\r\n?/g, '\n').trim();
      if (!t) return false;
      const lines = t.split('\n');
      const w = Math.round(W() * 0.5);
      const el = C.textEl({
        x: Math.round((W() - w) / 2), y: Math.round(H() / 2 - 40), w, h: 80, size: 20,
        paragraphs: lines.map((l) => C.para(l))
      });
      insertElements([el]);
      autoGrow(el);
      return true;
    }
    async function pasteFromClipboardData(dt) {
      const files = dt && dt.files ? Array.from(dt.files) : [];
      const imgFile = files.find((f) => /^image\//.test(f.type));
      const text = dt ? dt.getData('text/plain') : '';
      if (clip.elements && text && text === clip.text) return pasteElements();
      if (imgFile) { await addImageFromDataUrl(await readFileAsDataUrl(imgFile)); return true; }
      if (dt && dt.items) {
        for (const it of Array.from(dt.items)) {
          if (it.kind === 'file' && /^image\//.test(it.type)) {
            const f = it.getAsFile();
            if (f) { await addImageFromDataUrl(await readFileAsDataUrl(f)); return true; }
          }
        }
      }
      if (text) return pasteText(text);
      return pasteElements();
    }
    async function pasteCommand(textArg) {
      if (editingId) {
        const t = textArg != null ? textArg : '';
        if (t) { document.execCommand('insertText', false, t); onTextInput(); }
        return;
      }
      try {
        if (navigator.clipboard && navigator.clipboard.read) {
          const items = await navigator.clipboard.read();
          let text = '';
          for (const it of items) {
            if (it.types.includes('text/plain')) text = await (await it.getType('text/plain')).text();
          }
          if (clip.elements && text && text === clip.text) { pasteElements(); return; }
          for (const it of items) {
            const t = it.types.find((x) => /^image\//.test(x));
            if (t) {
              const blob = await it.getType(t);
              await addImageFromDataUrl(await readFileAsDataUrl(blob));
              return;
            }
          }
          if (text) { pasteText(text); return; }
        }
      } catch {}
      if (textArg && textArg !== clip.text) { pasteText(textArg); return; }
      pasteElements();
    }

    /* ---------- text editing ---------- */
    function editBody() {
      const n = editingId ? elNode(editingId) : null;
      return n ? n.querySelector('.ms-body') : null;
    }
    function startEdit(id, opts) {
      const el = elById(id);
      if (!el || el.type !== 'text') return;
      if (editingId && editingId !== id) endEdit();
      if (editingId === id) return;
      sel = [id];
      editingId = id;
      renderStage();
      const node = elNode(id);
      const body = node && node.querySelector('.ms-body');
      if (!body) { editingId = null; return; }
      node.classList.add('is-editing');
      body.contentEditable = 'true';
      body.spellcheck = true;
      try { document.execCommand('styleWithCSS', false, true); } catch {}
      try { document.execCommand('defaultParagraphSeparator', false, 'div'); } catch {}
      body.focus({ preventScroll: true });
      const s = window.getSelection();
      if (opts && opts.point && document.caretRangeFromPoint) {
        const r = document.caretRangeFromPoint(opts.point.clientX, opts.point.clientY);
        if (r && body.contains(r.startContainer)) { s.removeAllRanges(); s.addRange(r); }
        else placeCaretEnd(body);
      } else if (opts && opts.selectAll) {
        const r = document.createRange();
        r.selectNodeContents(body);
        s.removeAllRanges();
        s.addRange(r);
      } else placeCaretEnd(body);
      renderSelection();
      renderInspector();
      syncToolbar();
    }
    function placeCaretEnd(body) {
      const r = document.createRange();
      const last = body.lastElementChild || body;
      r.selectNodeContents(last);
      r.collapse(false);
      const s = window.getSelection();
      s.removeAllRanges();
      s.addRange(r);
    }
    function syncEditToModel() {
      const body = editBody();
      const el = editingId ? elById(editingId) : null;
      if (!body || !el) return false;
      el.paragraphs = parseBody(body, el);
      return true;
    }
    let textRecordTimer = null;
    function onTextInput() {
      if (!syncEditToModel()) return;
      const el = elById(editingId);
      normalizeEditingDom();
      autoGrow(el);
      ctx.markDirty();
      queueThumb(cur);
      renderSelection();
      clearTimeout(textRecordTimer);
      textRecordTimer = setTimeout(() => record(true), 250);
    }
    /* Chromium sometimes leaves text straight in the editable root (after
       select-all + type); wrap it back into a paragraph so it keeps list and
       alignment attributes. */
    function normalizeEditingDom() {
      const body = editBody();
      if (!body) return;
      const stray = Array.from(body.childNodes).filter((n) => !(n.nodeType === 1 && n.classList && n.classList.contains('ms-p')) && !(n.nodeType === 1 && /^(DIV|P)$/.test(n.tagName)));
      if (!stray.length) return;
      if (stray.every((n) => n.nodeType === 3 && !n.nodeValue)) return;
      const sel0 = window.getSelection();
      const r = sel0.rangeCount ? sel0.getRangeAt(0) : null;
      const off = r ? caretOffset(body, r) : null;
      const div = document.createElement('div');
      div.className = 'ms-p';
      body.insertBefore(div, stray[0]);
      stray.forEach((n) => div.appendChild(n));
      if (off != null) restoreCaret(body, off);
    }
    function caretOffset(body, r) {
      const pre = document.createRange();
      pre.selectNodeContents(body);
      pre.setEnd(r.endContainer, r.endOffset);
      return pre.toString().length;
    }
    function restoreCaret(body, off) {
      const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
      let n, left = off;
      while ((n = walker.nextNode())) {
        if (left <= n.nodeValue.length) {
          const r = document.createRange();
          r.setStart(n, left);
          r.collapse(true);
          const s = window.getSelection();
          s.removeAllRanges();
          s.addRange(r);
          return;
        }
        left -= n.nodeValue.length;
      }
    }
    function endEdit() {
      if (!editingId) return;
      clearTimeout(textRecordTimer);
      const id = editingId;
      const changed = syncEditToModel();
      const el = elById(id);
      editingId = null;
      if (el) autoGrow(el);
      try { window.getSelection().removeAllRanges(); } catch {}
      renderStage();
      renderSelection();
      renderInspector();
      syncToolbar();
      if (changed) {
        queueThumb(cur);
        record(false);
      }
    }
    /* Text boxes grow to fit what is typed into them, as in PowerPoint. */
    function autoGrow(el) {
      if (!el || el.type !== 'text') return;
      const node = elNode(el.id);
      const body = node && node.querySelector('.ms-body');
      if (!body) return;
      const need = body.offsetHeight + C.PAD_Y * 2;
      if (need > el.h + 0.5) {
        const grow = need - el.h;
        el.h = r2(need);
        if (el.valign === 'bottom') el.y = r2(el.y - grow);
        else if (el.valign === 'middle') el.y = r2(el.y - grow / 2);
        node.setAttribute('style', C.geomStyle(el));
      }
    }

    /* DOM -> paragraphs */
    function parseBody(body, el) {
      const d = C.textDefaults(deck, slide(), el);
      const blocks = [];
      const isBlock = (n) => n.nodeType === 1 && /^(DIV|P|LI|H[1-6]|UL|OL|BLOCKQUOTE)$/.test(n.tagName);
      const hasBlockChild = (n) => Array.from(n.childNodes).some(isBlock);
      const collect = (container, inherit) => {
        let stray = null;
        Array.from(container.childNodes).forEach((n) => {
          if (isBlock(n)) {
            stray = null;
            if (hasBlockChild(n)) collect(n, n);
            else blocks.push({ node: n, attrsFrom: n });
          } else {
            if (n.nodeType === 3 && !n.nodeValue && !stray) return;
            if (!stray) { stray = { nodes: [], attrsFrom: inherit }; blocks.push(stray); }
            stray.nodes.push(n);
          }
        });
      };
      collect(body, null);
      const paras = blocks.map((b) => {
        const src = b.attrsFrom;
        const align = src ? (src.style && src.style.textAlign) || src.getAttribute('align') || 'left' : 'left';
        const list = src && (src.dataset.list === 'bullet' || src.dataset.list === 'number') ? src.dataset.list : null;
        const level = src && list ? clamp(parseInt(src.dataset.level || '0', 10) || 0, 0, 4) : 0;
        const nodes = b.node ? [b.node] : b.nodes;
        const runs = [];
        const blockRoot = b.node || body;
        const allTextish = [];
        nodes.forEach((n) => {
          if (n.nodeType === 3 || (n.nodeType === 1 && n.tagName === 'BR')) allTextish.push(n);
          else if (n.nodeType === 1) {
            const w = document.createTreeWalker(n, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
              acceptNode: (x) => (x.nodeType === 3 || x.tagName === 'BR' ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP)
            });
            let x;
            while ((x = w.nextNode())) allTextish.push(x);
          }
        });
        allTextish.forEach((n, idx) => {
          let text;
          if (n.nodeType === 3) text = n.nodeValue.replace(/ /g, ' ').replace(/​/g, '');
          else text = idx === allTextish.length - 1 ? '' : '\n';
          const st = inlineStyle(n, blockRoot, body);
          const run = { text };
          if (st.b != null && st.b !== d.bold) run.b = st.b;
          if (st.i) run.i = true;
          if (st.u) run.u = true;
          if (st.color && st.color !== d.color && st.color !== C.resolveColor(deck, el.color, slide())) run.color = st.color;
          if (st.size && Math.abs(st.size - d.size) > 0.05) run.size = st.size;
          if (st.font && st.font.toLowerCase() !== String(d.font).toLowerCase()) run.font = st.font;
          runs.push(run);
        });
        const merged = [];
        runs.forEach((r) => {
          const p = merged[merged.length - 1];
          if (p && p.b === r.b && p.i === r.i && p.u === r.u && p.color === r.color && p.size === r.size && p.font === r.font) p.text += r.text;
          else merged.push(r);
        });
        let out = merged.filter((r) => r.text);
        if (!out.length) {
          const first = merged[0] || { text: '' };
          out = [Object.assign({}, first, { text: '' })];
        }
        return { align: ['left', 'center', 'right', 'justify'].includes(align) ? align : (align === 'start' ? 'left' : align === 'end' ? 'right' : 'left'), list, level, runs: out };
      });
      return paras.length ? paras : [C.para('')];
    }
    function inlineStyle(n, blockRoot, body) {
      const st = { b: null, i: null, u: null, color: null, size: null, font: null };
      for (let e = n.nodeType === 1 ? n.parentElement : n.parentElement; e && e !== body; e = e.parentElement) {
        const tag = e.tagName;
        const s = e.style || {};
        if (st.b == null) {
          if (tag === 'B' || tag === 'STRONG') st.b = true;
          else if (s.fontWeight) st.b = s.fontWeight === 'bold' || s.fontWeight === 'bolder' || parseInt(s.fontWeight, 10) >= 600;
        }
        if (st.i == null) {
          if (tag === 'I' || tag === 'EM') st.i = true;
          else if (s.fontStyle) st.i = s.fontStyle === 'italic' || s.fontStyle === 'oblique';
        }
        if (st.u == null) {
          const td = (s.textDecorationLine || s.textDecoration || '');
          if (tag === 'U') st.u = true;
          else if (td) st.u = /underline/.test(td);
        }
        if (st.color == null) {
          const c = s.color || (tag === 'FONT' ? e.getAttribute('color') : '');
          if (c) st.color = cssColorToHex(c);
        }
        if (st.size == null && s.fontSize) {
          const m = /^([\d.]+)(pt|px)$/.exec(s.fontSize);
          if (m) st.size = r2(m[2] === 'px' ? parseFloat(m[1]) * 0.75 : parseFloat(m[1]));
        }
        if (st.font == null) {
          const f = s.fontFamily || (tag === 'FONT' ? e.getAttribute('face') : '');
          if (f) st.font = f.split(',')[0].trim().replace(/^["']|["']$/g, '');
        }
        if (e === blockRoot) break;
      }
      if (st.b == null) st.b = null;
      return st;
    }

    function blocksInSelection() {
      const body = editBody();
      if (!body) return [];
      const s = window.getSelection();
      if (!s.rangeCount) return [];
      const r = s.getRangeAt(0);
      const blocks = Array.from(body.querySelectorAll('.ms-p, div, p')).filter((b) => !b.querySelector('div, p'));
      const hit = blocks.filter((b) => r.intersectsNode(b));
      if (hit.length) return hit;
      let n = r.startContainer;
      while (n && n !== body && !(n.nodeType === 1 && /^(DIV|P)$/.test(n.tagName))) n = n.parentNode;
      return n && n !== body ? [n] : [];
    }

    /* ---------- formatting (edit mode applies to the selection, object mode to the whole box) ---------- */
    function textTargets() {
      return selected().filter((e) => e.type === 'text');
    }
    function eachRun(el, fn) { el.paragraphs.forEach((p) => p.runs.forEach((r) => fn(r, p))); }

    function toggleInline(kind) {
      if (editingId) {
        const cmd = { b: 'bold', i: 'italic', u: 'underline' }[kind];
        document.execCommand(cmd);
        onTextInput();
        syncToolbar();
        return;
      }
      const els = textTargets();
      if (!els.length) return;
      const all = els.every((el) => {
        let on = true;
        eachRun(el, (r) => {
          if (!r.text) return;
          const st = C.runStyle(deck, slide(), el, r);
          if (!st[kind]) on = false;
        });
        return on;
      });
      els.forEach((el) => {
        const d = C.textDefaults(deck, slide(), el);
        eachRun(el, (r) => {
          const v = !all;
          if (kind === 'b') { if (v === d.bold) delete r.b; else r.b = v; }
          else if (v) r[kind] = true; else delete r[kind];
        });
      });
      commit({ keepInspector: true });
    }
    function applyFontSize(pt) {
      const size = clamp(r2(+pt), 4, 400);
      if (!size) return;
      if (editingId) {
        const s = window.getSelection();
        if (s.rangeCount && !s.getRangeAt(0).collapsed) {
          wrapSelectionStyle({ fontSize: size + 'pt' });
          onTextInput();
          syncToolbar();
          return;
        }
        // No selection: the whole box
        const el = elById(editingId);
        el.size = size;
        eachRun(el, (r) => { delete r.size; });
        renderStageKeepEdit();
        onTextInput();
        syncToolbar();
        return;
      }
      textTargets().forEach((el) => { el.size = size; eachRun(el, (r) => { delete r.size; }); });
      commit({ keepInspector: true });
      textTargets().forEach(autoGrow);
    }
    function bumpFontSize(dir) {
      const cur0 = currentTextStyle().size || 18;
      const idx = FONT_SIZES.findIndex((s) => s >= cur0 + (dir > 0 ? 0.01 : 0));
      let next;
      if (dir > 0) next = idx < 0 ? cur0 + 8 : (FONT_SIZES[idx] === cur0 ? FONT_SIZES[idx + 1] || cur0 + 8 : FONT_SIZES[idx]);
      else {
        const lower = FONT_SIZES.filter((s) => s < cur0 - 0.01);
        next = lower.length ? lower[lower.length - 1] : Math.max(4, cur0 - 2);
      }
      applyFontSize(next);
    }
    function applyFontFamily(name) {
      if (!name) return;
      if (editingId) {
        const s = window.getSelection();
        if (s.rangeCount && !s.getRangeAt(0).collapsed) {
          document.execCommand('fontName', false, name);
          onTextInput();
          return;
        }
        const el = elById(editingId);
        el.font = name;
        eachRun(el, (r) => { delete r.font; });
        renderStageKeepEdit();
        onTextInput();
        return;
      }
      textTargets().forEach((el) => { el.font = name; eachRun(el, (r) => { delete r.font; }); });
      commit({ keepInspector: true });
    }
    function applyTextColor(hex) {
      if (!hex) return;
      if (editingId) {
        const s = window.getSelection();
        if (s.rangeCount && !s.getRangeAt(0).collapsed) {
          document.execCommand('foreColor', false, hex);
          onTextInput();
          return;
        }
        const el = elById(editingId);
        el.color = hex;
        eachRun(el, (r) => { delete r.color; });
        renderStageKeepEdit();
        onTextInput();
        return;
      }
      textTargets().forEach((el) => { el.color = hex; eachRun(el, (r) => { delete r.color; }); });
      commit({ keepInspector: true });
    }
    /* Re-render the editing text box from the model while keeping the caret. */
    function renderStageKeepEdit() {
      const body = editBody();
      const el = elById(editingId);
      if (!body || !el) return;
      const s = window.getSelection();
      const off = s.rangeCount ? caretOffset(body, s.getRangeAt(0)) : null;
      patchElementBox(el);
      body.innerHTML = C.textBodyHtml(deck, slide(), el);
      if (off != null) restoreCaret(body, off);
    }
    function wrapSelectionStyle(styles) {
      // execCommand has no point-size; mark the range with the largest legacy size and swap it for a real one.
      const body = editBody();
      document.execCommand('styleWithCSS', false, false);
      document.execCommand('fontSize', false, '7');
      document.execCommand('styleWithCSS', false, true);
      body.querySelectorAll('font[size="7"]').forEach((f) => {
        const span = document.createElement('span');
        Object.assign(span.style, styles);
        while (f.firstChild) span.appendChild(f.firstChild);
        span.querySelectorAll('[style]').forEach((c) => { if (styles.fontSize) c.style.fontSize = ''; });
        f.replaceWith(span);
      });
      body.querySelectorAll('span[style=""]').forEach((sp) => sp.replaceWith(...sp.childNodes));
    }
    function applyAlign(al) {
      if (editingId) {
        blocksInSelection().forEach((b) => { b.style.textAlign = al === 'left' ? '' : al; });
        onTextInput();
        syncToolbar();
        return;
      }
      textTargets().forEach((el) => el.paragraphs.forEach((p) => { p.align = al; }));
      commit({ keepInspector: true });
    }
    function applyList(kind) {
      if (editingId) {
        const blocks = blocksInSelection();
        const allOn = blocks.length && blocks.every((b) => b.dataset.list === kind);
        blocks.forEach((b) => {
          if (allOn) { delete b.dataset.list; delete b.dataset.level; b.style.removeProperty('--lvl'); }
          else {
            b.classList.add('ms-p');
            b.dataset.list = kind;
            const lvl = b.dataset.level || '0';
            b.dataset.level = lvl;
            b.style.setProperty('--lvl', lvl);
          }
        });
        onTextInput();
        syncToolbar();
        return;
      }
      const els = textTargets();
      if (!els.length) return;
      const allOn = els.every((el) => el.paragraphs.every((p) => p.list === kind));
      els.forEach((el) => el.paragraphs.forEach((p) => { p.list = allOn ? null : kind; if (!p.list) p.level = 0; }));
      commit({ keepInspector: true });
    }
    function changeLevel(delta) {
      if (editingId) {
        const blocks = blocksInSelection();
        blocks.forEach((b) => {
          if (!b.dataset.list) { if (delta > 0) { b.dataset.list = 'bullet'; b.dataset.level = '0'; b.style.setProperty('--lvl', '0'); } return; }
          const lvl = clamp((parseInt(b.dataset.level || '0', 10) || 0) + delta, 0, 4);
          b.dataset.level = String(lvl);
          b.style.setProperty('--lvl', String(lvl));
        });
        onTextInput();
        return;
      }
      textTargets().forEach((el) => el.paragraphs.forEach((p) => { if (p.list) p.level = clamp(p.level + delta, 0, 4); }));
      commit({ keepInspector: true });
    }
    function setBoxProp(props) {
      const els = selected();
      if (!els.length) return;
      els.forEach((el) => Object.assign(el, props));
      if (editingId) {
        patchElementBox(elById(editingId));
        ctx.markDirty();
        queueThumb(cur);
        record(true);
        renderStage();
        renderSelection();
        renderInspector();
        return;
      }
      commit();
    }

    function currentTextStyle() {
      const out = { b: false, i: false, u: false, size: null, font: null, color: null, align: 'left', list: null };
      if (editingId) {
        const el = elById(editingId);
        const d = C.textDefaults(deck, slide(), el);
        try {
          out.b = document.queryCommandState('bold');
          out.i = document.queryCommandState('italic');
          out.u = document.queryCommandState('underline');
        } catch {}
        const s = window.getSelection();
        let node = s.rangeCount ? s.getRangeAt(0).startContainer : null;
        if (node && node.nodeType === 3) node = node.parentElement;
        const body = editBody();
        if (node && body && body.contains(node)) {
          const cs = getComputedStyle(node);
          out.size = r2(parseFloat(cs.fontSize) * 0.75);
          out.font = (cs.fontFamily || '').split(',')[0].trim().replace(/^["']|["']$/g, '') || d.font;
          out.color = cssColorToHex(cs.color);
          let blk = node;
          while (blk && blk !== body && !(blk.classList && blk.classList.contains('ms-p')) && !/^(DIV|P)$/.test(blk.tagName)) blk = blk.parentElement;
          if (blk && blk !== body) {
            out.align = blk.style.textAlign || 'left';
            out.list = blk.dataset.list || null;
          }
        } else {
          out.size = d.size; out.font = d.font; out.color = d.color;
        }
        return out;
      }
      const el = textTargets()[0];
      if (!el) return out;
      const p = el.paragraphs[0] || C.para('');
      const r = (p.runs.find((x) => x.text) || p.runs[0] || {});
      const st = C.runStyle(deck, slide(), el, r);
      Object.assign(out, { b: st.b, i: st.i, u: st.u, size: st.size, font: st.font, color: st.color, align: p.align, list: p.list });
      return out;
    }

    /* ---------- toolbar ---------- */
    function tbBtn(parent, title, icon, fn, cls) {
      const b = h('button', 'icon-btn' + (cls ? ' ' + cls : ''), icon);
      b.type = 'button';
      b.title = title;
      b.setAttribute('aria-label', title.replace(/\s*\(.*\)$/, ''));
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', (e) => fn(e, b));
      parent.appendChild(b);
      return b;
    }
    function tbSep(parent) { parent.appendChild(h('span', 'tb-sep')); }
    function tbGroup(parent, cls) { const g = h('div', 'sl-tb-group' + (cls ? ' ' + cls : '')); parent.appendChild(g); return g; }

    function buildToolbar() {
      const tb = ctx.toolbar;
      tb.innerHTML = '';
      tb.classList.add('sl-toolbar');
      const g1 = tbGroup(tb);
      const split = h('div', 'sl-split');
      const addBtn = h('button', 'sl-split-main', `${IC.newSlide}<span>New slide</span>`);
      addBtn.type = 'button';
      addBtn.title = 'New slide (Ctrl+M)';
      addBtn.addEventListener('click', () => addSlide());
      const addMenu = h('button', 'sl-split-arrow', IC.chevron);
      addMenu.type = 'button';
      addMenu.title = 'Choose a layout for the new slide';
      addMenu.addEventListener('click', () => openLayoutMenu(addMenu, (id) => addSlide(id)));
      split.append(addBtn, addMenu);
      g1.appendChild(split);
      tbBtn(g1, 'Layout', IC.layout, (e, b) => openLayoutMenu(b, (id) => applyLayout(id), slide().layout));
      tbSep(tb);

      const g2 = tbGroup(tb);
      tbBtn(g2, 'Text box', IC.textBox, () => addTextBox());
      tbBtn(g2, 'Shapes', IC.shapes + '<span class="sl-caret">' + IC.chevron + '</span>', (e, b) => openShapeMenu(b), 'sl-has-caret');
      tbBtn(g2, 'Picture…', IC.image, () => insertImagePicker());
      tbSep(tb);

      const g3 = tbGroup(tb, 'sl-text-group');
      const fontSel = h('select', 'tb-select sl-font');
      fontSel.title = 'Font';
      fontSel.addEventListener('mousedown', () => rememberRange());
      fontSel.addEventListener('change', () => { restoreRange(); applyFontFamily(fontSel.value); });
      g3.appendChild(fontSel);
      const sizeSel = h('select', 'tb-select sl-size');
      sizeSel.title = 'Font size';
      sizeSel.addEventListener('mousedown', () => rememberRange());
      sizeSel.addEventListener('change', () => { restoreRange(); applyFontSize(sizeSel.value); });
      g3.appendChild(sizeSel);
      E.fontSel = fontSel;
      E.sizeSel = sizeSel;
      E.tbSizeUp = tbBtn(g3, 'Increase font size (Ctrl+])', IC.sizeUp, () => bumpFontSize(1));
      E.tbSizeDown = tbBtn(g3, 'Decrease font size (Ctrl+[)', IC.sizeDown, () => bumpFontSize(-1));
      E.tbBold = tbBtn(g3, 'Bold (Ctrl+B)', IC.bold, () => toggleInline('b'));
      E.tbItalic = tbBtn(g3, 'Italic (Ctrl+I)', IC.italic, () => toggleInline('i'));
      E.tbUnder = tbBtn(g3, 'Underline (Ctrl+U)', IC.underline, () => toggleInline('u'));
      E.tbColor = tbBtn(g3, 'Text colour', IC.textColor + '<span class="sl-color-bar"></span>', (e, b) => {
        rememberRange();
        const P = window.MargoColorPicker;
        if (!P) return;
        P.open(b, {
          title: 'Text colour',
          value: currentTextStyle().color,
          onPick: (hex) => { restoreRange(); if (hex) applyTextColor(hex); }
        });
      }, 'sl-color-btn');
      tbSep(g3);
      E.tbAlign = {};
      [['left', 'Align left (Ctrl+L)', IC.alignLeft], ['center', 'Center (Ctrl+E)', IC.alignCenter], ['right', 'Align right (Ctrl+R)', IC.alignRight], ['justify', 'Justify (Ctrl+J)', IC.alignJustify]]
        .forEach(([al, t, ic]) => { E.tbAlign[al] = tbBtn(g3, t, ic, () => applyAlign(al)); });
      E.tbBullets = tbBtn(g3, 'Bullets', IC.bullets, () => applyList('bullet'));
      E.tbNumbers = tbBtn(g3, 'Numbering', IC.numbers, () => applyList('number'));
      E.tbOutdent = tbBtn(g3, 'Decrease list level (Shift+Tab)', IC.outdent, () => changeLevel(-1));
      E.tbIndent = tbBtn(g3, 'Increase list level (Tab)', IC.indent, () => changeLevel(1));
      tbSep(tb);

      const g4 = tbGroup(tb);
      E.tbArrange = tbBtn(g4, 'Arrange', IC.arrange + '<span class="sl-caret">' + IC.chevron + '</span>', (e, b) => openArrangeMenu(b), 'sl-has-caret');
      tb.appendChild(h('span', 'tb-spacer'));

      const g5 = tbGroup(tb);
      tbBtn(g5, 'Theme', IC.theme + '<span class="sl-caret">' + IC.chevron + '</span>', (e, b) => openThemeMenu(b), 'sl-has-caret');
      E.tbNotes = tbBtn(g5, 'Speaker notes', IC.notes, () => toggleNotes());
      E.tbInspector = tbBtn(g5, 'Format panel', IC.inspector, () => toggleInspector());
      const play = h('button', 'btn primary sl-present', `${IC.play}<span>Present</span>`);
      play.type = 'button';
      play.title = 'Present from the beginning (F5) — Shift+F5 from this slide';
      play.addEventListener('click', (e) => startShow(e.shiftKey ? cur : 0));
      g5.appendChild(play);
      fillFontSelect();
      fillSizeSelect(null);
    }
    function fillFontSelect() {
      const t = C.themeOf(deck);
      const fams = (window.MargoFonts && window.MargoFonts.FAMILIES ? window.MargoFonts.FAMILIES.slice() : ['Calibri', 'Arial', 'Segoe UI', 'Georgia', 'Times New Roman']);
      [t.titleFont, t.bodyFont].forEach((f) => { if (f && !fams.includes(f)) fams.unshift(f); });
      E.fontSel.innerHTML = '';
      const og1 = document.createElement('optgroup');
      og1.label = t.titleFont === t.bodyFont ? 'Theme font' : 'Theme fonts (headings, body)';
      Array.from(new Set([t.titleFont, t.bodyFont])).forEach((f) => {
        const o = document.createElement('option');
        o.value = f; o.textContent = f;
        og1.appendChild(o);
      });
      const og2 = document.createElement('optgroup');
      og2.label = 'All fonts';
      fams.forEach((f) => { const o = document.createElement('option'); o.value = f; o.textContent = f; og2.appendChild(o); });
      E.fontSel.append(og1, og2);
    }
    function fillSizeSelect(curSize) {
      const sizes = FONT_SIZES.slice();
      if (curSize && !sizes.includes(curSize)) { sizes.push(curSize); sizes.sort((a, b) => a - b); }
      E.sizeSel.innerHTML = sizes.map((s) => `<option value="${s}">${s}</option>`).join('');
      if (curSize) E.sizeSel.value = String(curSize);
    }
    let savedRange = null;
    function rememberRange() {
      const s = window.getSelection();
      const body = editBody();
      savedRange = s.rangeCount && body && body.contains(s.getRangeAt(0).startContainer) ? s.getRangeAt(0).cloneRange() : null;
    }
    function restoreRange() {
      if (!savedRange || !editingId) return;
      const body = editBody();
      if (!body) return;
      body.focus({ preventScroll: true });
      const s = window.getSelection();
      s.removeAllRanges();
      s.addRange(savedRange);
      savedRange = null;
    }

    function syncToolbar() {
      if (!E.fontSel) return;
      if (E.fontThemeId !== deck.theme) { E.fontThemeId = deck.theme; fillFontSelect(); }
      const texts = textTargets();
      const textOn = !!editingId || texts.length > 0;
      ctx.toolbar.querySelectorAll('.sl-text-group button, .sl-text-group select').forEach((b) => { b.disabled = !textOn; });
      if (E.tbArrange) E.tbArrange.disabled = !sel.length;
      const st = textOn ? currentTextStyle() : null;
      const on = (b, v) => { if (b) b.classList.toggle('active', !!v); };
      on(E.tbBold, st && st.b);
      on(E.tbItalic, st && st.i);
      on(E.tbUnder, st && st.u);
      Object.keys(E.tbAlign || {}).forEach((al) => on(E.tbAlign[al], st && (st.align || 'left') === al));
      on(E.tbBullets, st && st.list === 'bullet');
      on(E.tbNumbers, st && st.list === 'number');
      on(E.tbNotes, notesOpen);
      on(E.tbInspector, inspectorOpen);
      if (st && st.font) {
        if (![...E.fontSel.options].some((o) => o.value === st.font)) {
          const o = document.createElement('option');
          o.value = st.font; o.textContent = st.font;
          E.fontSel.appendChild(o);
        }
        E.fontSel.value = st.font;
      }
      if (st && st.size) fillSizeSelect(Math.round(st.size * 2) / 2);
      const bar = E.tbColor && E.tbColor.querySelector('.sl-color-bar');
      if (bar) bar.style.background = (st && st.color) || 'currentColor';
    }

    function openLayoutMenu(anchor, pick, current) {
      openPop(anchor, (pop) => {
        pop.classList.add('sl-layout-pop');
        const head = h('div', 'sl-pop-head', current ? 'Change layout' : 'New slide');
        pop.appendChild(head);
        const grid = h('div', 'sl-layout-grid');
        C.LAYOUTS.forEach((l) => {
          const b = h('button', 'sl-layout-opt' + (current === l.id ? ' checked' : ''), `${layoutIcon(l.id)}<span>${C.escapeHtml(l.name)}</span>`);
          b.type = 'button';
          b.dataset.layout = l.id;
          b.addEventListener('mousedown', (e) => e.preventDefault());
          b.addEventListener('click', () => { closePop(); pick(l.id); });
          grid.appendChild(b);
        });
        pop.appendChild(grid);
      });
    }
    function openShapeMenu(anchor) {
      openPop(anchor, (pop) => {
        pop.classList.add('sl-shape-pop');
        const grid = h('div', 'sl-shape-grid');
        [['rect', 'Rectangle'], ['roundRect', 'Rounded rectangle'], ['ellipse', 'Ellipse'], ['triangle', 'Triangle'], ['diamond', 'Diamond'], ['line', 'Line'], ['arrow', 'Arrow']]
          .forEach(([id, label]) => {
            const b = h('button', 'icon-btn sl-shape-opt', IC[id]);
            b.type = 'button';
            b.title = label;
            b.dataset.shape = id;
            b.addEventListener('mousedown', (e) => e.preventDefault());
            b.addEventListener('click', () => { closePop(); addShape(id); });
            grid.appendChild(b);
          });
        pop.appendChild(grid);
      });
    }
    function openArrangeMenu(anchor) {
      openPop(anchor, (pop) => {
        const none = !sel.length;
        menuItem(pop, 'Bring to front', IC.front, () => zorder('front'), { accel: 'Ctrl+Shift+↑', disabled: none });
        menuItem(pop, 'Bring forward', IC.forward, () => zorder('forward'), { accel: 'Ctrl+↑', disabled: none });
        menuItem(pop, 'Send backward', IC.backward, () => zorder('backward'), { accel: 'Ctrl+↓', disabled: none });
        menuItem(pop, 'Send to back', IC.back, () => zorder('back'), { accel: 'Ctrl+Shift+↓', disabled: none });
        menuSep(pop);
        const target = sel.length > 1 ? 'selection' : 'slide';
        menuItem(pop, `Align left (${target})`, IC.aLeft, () => alignSelected('left'), { disabled: none });
        menuItem(pop, `Align center (${target})`, IC.aCenterH, () => alignSelected('center'), { disabled: none });
        menuItem(pop, `Align right (${target})`, IC.aRight, () => alignSelected('right'), { disabled: none });
        menuItem(pop, `Align top (${target})`, IC.aTop, () => alignSelected('top'), { disabled: none });
        menuItem(pop, `Align middle (${target})`, IC.aMiddle, () => alignSelected('middle'), { disabled: none });
        menuItem(pop, `Align bottom (${target})`, IC.aBottom, () => alignSelected('bottom'), { disabled: none });
        menuSep(pop);
        menuItem(pop, 'Distribute horizontally', IC.distH, () => distribute('h'), { disabled: sel.length < 3 });
        menuItem(pop, 'Distribute vertically', IC.distV, () => distribute('v'), { disabled: sel.length < 3 });
        menuSep(pop);
        menuItem(pop, 'Duplicate', IC.duplicate, () => duplicateSelected(), { accel: 'Ctrl+D', disabled: none });
        menuItem(pop, 'Delete', IC.trash, () => deleteSelected(), { accel: 'Del', disabled: none });
      });
    }
    function openThemeMenu(anchor) {
      openPop(anchor, (pop) => {
        pop.classList.add('sl-theme-pop');
        pop.appendChild(h('div', 'sl-pop-head', 'Theme'));
        pop.appendChild(themeGrid());
      });
    }
    function themeGrid() {
      const grid = h('div', 'sl-theme-grid');
      const curId = deck.theme;
      C.themeList(deck).forEach((t) => {
        const b = h('button', 'sl-theme-opt' + (t.id === curId ? ' checked' : ''), `${themeSwatch(t)}<span class="sl-theme-name">${C.escapeHtml(t.name)}</span>`);
        b.type = 'button';
        b.dataset.theme = t.id;
        b.title = `${t.name} — ${t.titleFont}${t.bodyFont !== t.titleFont ? ' / ' + t.bodyFont : ''}`;
        b.addEventListener('mousedown', (e) => e.preventDefault());
        b.addEventListener('click', () => { closePop(); setTheme(t.id); });
        grid.appendChild(b);
      });
      return grid;
    }
    function openSlideMenu(at, index) {
      openPop({ getBoundingClientRect: () => ({ left: at.x, right: at.x, top: at.y, bottom: at.y }), contains: () => false }, (pop) => {
        menuItem(pop, 'New slide', IC.newSlide, () => { goTo(index); addSlide(); }, { accel: 'Ctrl+M' });
        menuItem(pop, 'Duplicate slide', IC.duplicate, () => duplicateSlide(index));
        menuItem(pop, 'Delete slide', IC.trash, () => deleteSlide(index), { accel: 'Del' });
        menuSep(pop);
        menuItem(pop, 'Move up', IC.prev, () => moveSlide(index, index - 1), { disabled: index === 0 });
        menuItem(pop, 'Move down', IC.next, () => moveSlide(index, index + 2), { disabled: index >= deck.slides.length - 1 });
        menuSep(pop);
        menuItem(pop, 'Present from this slide', IC.play, () => startShow(index), { accel: 'Shift+F5' });
      }, { at });
    }

    /* ---------- inspector ---------- */
    function secHead(parent, text) { parent.appendChild(h('div', 'sl-ins-head', C.escapeHtml(text))); }
    function row(parent, label, control) {
      const r = h('div', 'sl-ins-row');
      const l = h('span', 'sl-ins-label', C.escapeHtml(label));
      r.append(l, control);
      parent.appendChild(r);
      return r;
    }
    function colorControl(value, opts, onPick) {
      const b = h('button', 'sl-swatch-btn');
      b.type = 'button';
      const resolved = C.resolveColor(deck, value, slide());
      // "Theme" choices show the colour the theme actually gives them.
      const shown = resolved || opts.themeColor || null;
      const label = resolved ? (C.normHex(value) ? resolved.toUpperCase() : 'Theme ' + value) : (opts.noneLabel || 'None');
      b.innerHTML = `<span class="sl-swatch${shown ? '' : ' none'}" style="${shown ? 'background:' + shown : ''}"></span><span class="sl-swatch-label">${C.escapeHtml(label)}</span>`;
      b.title = opts.title;
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', () => {
        const P = window.MargoColorPicker;
        if (!P) return;
        P.open(b, {
          title: opts.title,
          allowNone: !!opts.allowNone,
          noneLabel: opts.noneLabel || 'None',
          value: resolved,
          onPick: (hex) => onPick(hex || null)
        });
      });
      return b;
    }
    function numInput(value, onSet, opts) {
      const i = document.createElement('input');
      i.type = 'number';
      i.className = 'sl-num';
      i.value = String(Math.round(value));
      if (opts && opts.min != null) i.min = String(opts.min);
      if (opts && opts.max != null) i.max = String(opts.max);
      i.step = String((opts && opts.step) || 1);
      const apply = () => {
        const v = parseFloat(i.value);
        if (Number.isFinite(v)) onSet(v);
      };
      i.addEventListener('change', apply);
      i.addEventListener('keydown', (e) => { if (e.key === 'Enter') { apply(); i.blur(); } e.stopPropagation(); });
      return i;
    }
    function segmented(options, value, onPick) {
      const seg = h('div', 'sl-seg');
      options.forEach(([v, title, icon]) => {
        const b = h('button', 'sl-seg-btn' + (v === value ? ' active' : ''), icon || C.escapeHtml(title));
        b.type = 'button';
        b.title = title;
        b.addEventListener('mousedown', (e) => e.preventDefault());
        b.addEventListener('click', () => onPick(v));
        seg.appendChild(b);
      });
      return seg;
    }
    function iconRow(parent, items) {
      const r = h('div', 'sl-ins-icons');
      items.forEach(([title, icon, fn, disabled]) => {
        const b = h('button', 'icon-btn', icon);
        b.type = 'button';
        b.title = title;
        b.disabled = !!disabled;
        b.addEventListener('mousedown', (e) => e.preventDefault());
        b.addEventListener('click', fn);
        r.appendChild(b);
      });
      parent.appendChild(r);
    }

    function renderInspector() {
      if (!E.inspector) return;
      E.inspectorWrap.classList.toggle('hidden', !inspectorOpen);
      if (!inspectorOpen) return;
      const box = E.inspector;
      const scroll = box.scrollTop;
      box.innerHTML = '';
      const els = selected();
      if (!els.length) inspectSlide(box);
      else if (els.length > 1) inspectMulti(box, els);
      else inspectElement(box, els[0]);
      box.scrollTop = scroll;
    }
    function inspectSlide(box) {
      const s = slide();
      const title = h('div', 'sl-ins-title', `<span>Slide ${cur + 1}</span><span class="sl-ins-sub">${C.escapeHtml((C.LAYOUTS.find((l) => l.id === s.layout) || { name: 'Custom' }).name)}</span>`);
      box.appendChild(title);
      const sec1 = h('section', 'sl-ins-sec');
      secHead(sec1, 'Layout');
      const lg = h('div', 'sl-layout-grid compact');
      C.LAYOUTS.forEach((l) => {
        const b = h('button', 'sl-layout-opt' + (s.layout === l.id ? ' checked' : ''), `${layoutIcon(l.id)}`);
        b.type = 'button';
        b.title = l.name;
        b.dataset.layout = l.id;
        b.addEventListener('click', () => applyLayout(l.id));
        lg.appendChild(b);
      });
      sec1.appendChild(lg);
      box.appendChild(sec1);

      const sec2 = h('section', 'sl-ins-sec');
      secHead(sec2, 'Background');
      const bg = C.slideBackground(deck, s);
      row(sec2, 'Colour', colorControl(s.background && s.background.color ? s.background.color : null, { title: 'Background colour', allowNone: true, noneLabel: 'Theme', themeColor: s.background ? null : bg.color }, (hex) => {
        s.background = hex ? { color: hex } : null;
        commit();
      }));
      const imgRow = h('div', 'sl-ins-btnrow');
      const pick = h('button', 'btn ghost sl-btn-sm', bg.image ? 'Replace image…' : 'Image…');
      pick.type = 'button';
      pick.addEventListener('click', async () => {
        const f = await pickImageFile();
        if (!f) return;
        try {
          const img = await normalizeImage(await readFileAsDataUrl(f));
          s.background = { image: img.src };
          commit();
        } catch { ctx.toast('Could not read that image', 'error'); }
      });
      imgRow.appendChild(pick);
      if (s.background) {
        const rm = h('button', 'btn ghost sl-btn-sm', 'Reset');
        rm.type = 'button';
        rm.title = 'Use the theme background';
        rm.addEventListener('click', () => { s.background = null; commit(); });
        imgRow.appendChild(rm);
      }
      const all = h('button', 'btn ghost sl-btn-sm', 'Apply to all');
      all.type = 'button';
      all.title = 'Use this background on every slide';
      all.addEventListener('click', () => {
        deck.slides.forEach((x) => { x.background = s.background ? C.clone(s.background) : null; });
        commit({ rail: true });
      });
      imgRow.appendChild(all);
      sec2.appendChild(imgRow);
      box.appendChild(sec2);

      const sec3 = h('section', 'sl-ins-sec');
      secHead(sec3, 'Theme');
      sec3.appendChild(themeGrid());
      box.appendChild(sec3);

      const sec4 = h('section', 'sl-ins-sec');
      secHead(sec4, 'Slide');
      const btns = h('div', 'sl-ins-btnrow');
      const dup = h('button', 'btn ghost sl-btn-sm', 'Duplicate');
      dup.type = 'button';
      dup.addEventListener('click', () => duplicateSlide());
      const del = h('button', 'btn ghost sl-btn-sm sl-danger', 'Delete');
      del.type = 'button';
      del.addEventListener('click', () => deleteSlide());
      btns.append(dup, del);
      sec4.appendChild(btns);
      box.appendChild(sec4);
    }
    function arrangeSection(box, els) {
      const sec = h('section', 'sl-ins-sec');
      secHead(sec, 'Arrange');
      iconRow(sec, [
        ['Bring to front', IC.front, () => zorder('front')],
        ['Bring forward', IC.forward, () => zorder('forward')],
        ['Send backward', IC.backward, () => zorder('backward')],
        ['Send to back', IC.back, () => zorder('back')]
      ]);
      const t = els.length > 1 ? 'selection' : 'slide';
      iconRow(sec, [
        [`Align left to ${t}`, IC.aLeft, () => alignSelected('left')],
        [`Align center to ${t}`, IC.aCenterH, () => alignSelected('center')],
        [`Align right to ${t}`, IC.aRight, () => alignSelected('right')],
        [`Align top to ${t}`, IC.aTop, () => alignSelected('top')],
        [`Align middle to ${t}`, IC.aMiddle, () => alignSelected('middle')],
        [`Align bottom to ${t}`, IC.aBottom, () => alignSelected('bottom')]
      ]);
      if (els.length > 2) {
        iconRow(sec, [
          ['Distribute horizontally', IC.distH, () => distribute('h')],
          ['Distribute vertically', IC.distV, () => distribute('v')]
        ]);
      }
      box.appendChild(sec);
    }
    function geometrySection(box, el) {
      const sec = h('section', 'sl-ins-sec');
      secHead(sec, 'Position and size');
      const grid = h('div', 'sl-ins-grid');
      const cell = (label, input) => { const c = h('label', 'sl-ins-cell'); c.append(h('span', '', label), input); grid.appendChild(c); };
      cell('X', numInput(el.x, (v) => setBoxProp({ x: v })));
      cell('Y', numInput(el.y, (v) => setBoxProp({ y: v })));
      cell('W', numInput(el.w, (v) => {
        const p = { w: Math.max(1, v) };
        if (el.type === 'image' && el.nw && el.fit !== 'cover' && !el.crop) p.h = Math.round(p.w * el.h / Math.max(1, el.w));
        setBoxProp(p);
      }, { min: 1 }));
      cell('H', numInput(el.h, (v) => {
        const p = { h: Math.max(0, v) };
        if (el.type === 'image' && el.nw && el.fit !== 'cover' && !el.crop) p.w = Math.round(p.h * el.w / Math.max(1, el.h));
        setBoxProp(p);
      }, { min: 0 }));
      cell('Rotate', numInput(el.rot || 0, (v) => setBoxProp({ rot: ((v % 360) + 360) % 360 > 180 ? ((v % 360) + 360) % 360 - 360 : ((v % 360) + 360) % 360 }), { step: 1 }));
      sec.appendChild(grid);
      box.appendChild(sec);
    }
    function inspectElement(box, el) {
      const name = el.type === 'text' ? (el.role === 'title' ? 'Title' : el.role ? 'Text placeholder' : 'Text box')
        : el.type === 'image' ? (el.src ? 'Picture' : 'Picture placeholder')
          : ({ rect: 'Rectangle', roundRect: 'Rounded rectangle', ellipse: 'Ellipse', triangle: 'Triangle', diamond: 'Diamond', line: 'Line', arrow: 'Arrow' }[el.shape] || 'Shape');
      box.appendChild(h('div', 'sl-ins-title', `<span>${C.escapeHtml(name)}</span>`));
      if (el.type === 'text') {
        const sec = h('section', 'sl-ins-sec');
        secHead(sec, 'Text');
        row(sec, 'Vertical', segmented([['top', 'Top', IC.vTop], ['middle', 'Middle', IC.vMid], ['bottom', 'Bottom', IC.vBottom]], el.valign, (v) => setBoxProp({ valign: v })));
        row(sec, 'Colour', colorControl(el.color, { title: 'Text colour', allowNone: true, noneLabel: 'Theme', themeColor: C.textDefaults(deck, slide(), Object.assign({}, el, { color: null })).color }, (hex) => {
          el.color = hex; eachRun(el, (r) => { delete r.color; });
          if (editingId) { renderStageKeepEdit(); onTextInput(); renderInspector(); } else commit();
        }));
        const sp = numInput(el.spacing || 0, (v) => setBoxProp({ spacing: clamp(v, 0, 72) }), { min: 0, max: 72 });
        row(sec, 'Para. spacing', sp);
        box.appendChild(sec);
        const sec2 = h('section', 'sl-ins-sec');
        secHead(sec2, 'Box');
        row(sec2, 'Fill', colorControl(el.fill, { title: 'Box fill', allowNone: true, noneLabel: 'No fill' }, (hex) => setBoxProp({ fill: hex })));
        row(sec2, 'Border', colorControl(el.stroke, { title: 'Border colour', allowNone: true, noneLabel: 'No border' }, (hex) => setBoxProp({ stroke: hex, strokeWidth: hex ? (el.strokeWidth || 2) : 0 })));
        if (el.stroke) row(sec2, 'Border width', numInput(el.strokeWidth || 0, (v) => setBoxProp({ strokeWidth: clamp(v, 0, 40) }), { min: 0, max: 40 }));
        row(sec2, 'Shape', segmented([['rect', 'Rectangle', IC.rect], ['roundRect', 'Rounded', IC.roundRect], ['ellipse', 'Ellipse', IC.ellipse]], el.shape || 'rect', (v) => setBoxProp({ shape: v })));
        box.appendChild(sec2);
      } else if (el.type === 'shape') {
        const sec = h('section', 'sl-ins-sec');
        const isLine = el.shape === 'line' || el.shape === 'arrow';
        secHead(sec, isLine ? 'Line' : 'Shape');
        if (!isLine) {
          row(sec, 'Type', segmented([['rect', 'Rectangle', IC.rect], ['roundRect', 'Rounded', IC.roundRect], ['ellipse', 'Ellipse', IC.ellipse], ['triangle', 'Triangle', IC.triangle], ['diamond', 'Diamond', IC.diamond]], el.shape, (v) => setBoxProp({ shape: v })));
          row(sec, 'Fill', colorControl(el.fill, { title: 'Fill', allowNone: true, noneLabel: 'No fill' }, (hex) => setBoxProp({ fill: hex })));
          row(sec, 'Outline', colorControl(el.stroke, { title: 'Outline colour', allowNone: true, noneLabel: 'No outline' }, (hex) => setBoxProp({ stroke: hex, strokeWidth: hex ? (el.strokeWidth || 2) : el.strokeWidth })));
          if (el.stroke) row(sec, 'Outline width', numInput(el.strokeWidth || 0, (v) => setBoxProp({ strokeWidth: clamp(v, 0, 60) }), { min: 0, max: 60 }));
          if (el.shape === 'roundRect') row(sec, 'Corner radius', numInput(el.radius || 0, (v) => setBoxProp({ radius: clamp(v, 0, 2000) }), { min: 0 }));
        } else {
          row(sec, 'Type', segmented([['line', 'Line', IC.line], ['arrow', 'Arrow', IC.arrow]], el.shape, (v) => setBoxProp({ shape: v })));
          row(sec, 'Colour', colorControl(el.stroke || el.fill, { title: 'Line colour' }, (hex) => setBoxProp({ stroke: hex || 'text' })));
          row(sec, 'Weight', numInput(el.strokeWidth || 2, (v) => setBoxProp({ strokeWidth: clamp(v, 1, 60) }), { min: 1, max: 60 }));
        }
        box.appendChild(sec);
      } else if (el.type === 'image') {
        const sec = h('section', 'sl-ins-sec');
        secHead(sec, 'Picture');
        const r = h('div', 'sl-ins-btnrow');
        const rep = h('button', 'btn ghost sl-btn-sm', el.src ? 'Replace…' : 'Choose picture…');
        rep.type = 'button';
        rep.addEventListener('click', () => (el.src ? replaceImage(el) : insertImagePicker(el)));
        r.appendChild(rep);
        if (el.src && el.nw && el.nh) {
          const reset = h('button', 'btn ghost sl-btn-sm', 'Reset size');
          reset.type = 'button';
          reset.title = 'Restore the picture’s own proportions';
          reset.addEventListener('click', () => {
            const sc = Math.min(W() * 0.9 / el.nw, H() * 0.9 / el.nh, 1);
            setBoxProp({ w: Math.round(el.nw * sc), h: Math.round(el.nh * sc), crop: null, fit: 'stretch' });
          });
          r.appendChild(reset);
        }
        sec.appendChild(r);
        if (el.src) {
          row(sec, 'Fit', segmented([['stretch', 'Stretch to box'], ['cover', 'Crop to fill']], el.crop ? 'crop' : el.fit, (v) => setBoxProp({ fit: v, crop: null })));
        }
        box.appendChild(sec);
      }
      geometrySection(box, el);
      arrangeSection(box, [el]);
    }
    function inspectMulti(box, els) {
      box.appendChild(h('div', 'sl-ins-title', `<span>${els.length} objects</span>`));
      const shapes = els.filter((e) => e.type === 'shape' && e.shape !== 'line' && e.shape !== 'arrow');
      if (shapes.length === els.length) {
        const sec = h('section', 'sl-ins-sec');
        secHead(sec, 'Shapes');
        row(sec, 'Fill', colorControl(shapes[0].fill, { title: 'Fill', allowNone: true, noneLabel: 'No fill' }, (hex) => setBoxProp({ fill: hex })));
        box.appendChild(sec);
      }
      arrangeSection(box, els);
      const sec = h('section', 'sl-ins-sec');
      const r = h('div', 'sl-ins-btnrow');
      const dup = h('button', 'btn ghost sl-btn-sm', 'Duplicate');
      dup.type = 'button';
      dup.addEventListener('click', duplicateSelected);
      const del = h('button', 'btn ghost sl-btn-sm sl-danger', 'Delete');
      del.type = 'button';
      del.addEventListener('click', deleteSelected);
      r.append(dup, del);
      sec.appendChild(r);
      box.appendChild(sec);
    }

    /* ---------- notes ---------- */
    function renderNotes() {
      if (!E.notes) return;
      E.notesWrap.classList.toggle('hidden', !notesOpen);
      const v = slide().notes || '';
      if (E.notes.value !== v) E.notes.value = v;
    }
    function toggleNotes(force) {
      notesOpen = force != null ? !!force : !notesOpen;
      lsSet(NOTES_KEY, notesOpen);
      renderNotes();
      syncToolbar();
      requestAnimationFrame(applyScale);
    }
    function toggleInspector(force) {
      inspectorOpen = force != null ? !!force : !inspectorOpen;
      lsSet(INSPECTOR_KEY, inspectorOpen);
      renderInspector();
      syncToolbar();
      requestAnimationFrame(applyScale);
    }

    /* ---------- pointer interaction on the stage ---------- */
    function onStagePointerDown(e) {
      if (e.button !== 0 && e.button !== 2) return;
      focusArea = 'stage';
      closePop();
      const handle = e.target.closest && e.target.closest('.sl-handle');
      const elNodeHit = e.target.closest && e.target.closest('.sl-stage .ms-el');
      const id = elNodeHit ? elNodeHit.dataset.id : null;
      const p = toSlide(e);

      if (editingId && id === editingId && !handle) return; // text selection inside the box
      if (e.button === 2) {
        if (id && !sel.includes(id)) { if (editingId) endEdit(); setSel([id]); }
        return;
      }
      if (!editingId) E.viewport.focus({ preventScroll: true });

      if (handle) {
        e.preventDefault();
        const el = selected()[0];
        if (!el) return;
        if (editingId) endEdit();
        beginHandleDrag(e, el, handle.dataset.handle);
        return;
      }
      if (editingId) endEdit();
      E.viewport.focus({ preventScroll: true });
      if (id) {
        e.preventDefault();
        const additive = e.shiftKey || e.ctrlKey || e.metaKey;
        const wasOnlySelected = sel.length === 1 && sel[0] === id;
        if (additive) {
          if (sel.includes(id)) { setSel(sel.filter((x) => x !== id)); return; }
          setSel(sel.concat([id]));
        } else if (!sel.includes(id)) setSel([id]);
        beginMove(e, p, { clickToEdit: wasOnlySelected && !additive ? id : null });
        return;
      }
      // empty canvas: marquee
      e.preventDefault();
      const base = e.shiftKey || e.ctrlKey ? sel.slice() : [];
      if (!base.length && sel.length) setSel([]);
      beginMarquee(e, p, base);
    }

    function trackPointer(e, move, up) {
      const pid = e.pointerId;
      const target = E.stageBox;
      try { target.setPointerCapture(pid); } catch {}
      const onMove = (ev) => { if (ev.pointerId === pid) move(ev); };
      const onUp = (ev) => {
        if (ev.pointerId !== pid) return;
        target.removeEventListener('pointermove', onMove);
        target.removeEventListener('pointerup', onUp);
        target.removeEventListener('pointercancel', onUp);
        try { target.releasePointerCapture(pid); } catch {}
        op = null;
        up(ev);
      };
      target.addEventListener('pointermove', onMove);
      target.addEventListener('pointerup', onUp);
      target.addEventListener('pointercancel', onUp);
    }

    function snapTargets(excludeIds) {
      const xs = [0, W() / 2, W()], ys = [0, H() / 2, H()];
      slide().elements.forEach((e) => {
        if (excludeIds.has(e.id) || e.rot) return;
        xs.push(e.x, e.x + e.w / 2, e.x + e.w);
        ys.push(e.y, e.y + e.h / 2, e.y + e.h);
      });
      return { xs, ys };
    }
    function snapAxis(cands, targets) {
      const th = SNAP_PX / k;
      let best = null;
      cands.forEach((c) => targets.forEach((t) => {
        const d = t - c;
        if (Math.abs(d) <= th && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, at: t };
      }));
      return best;
    }

    function beginMove(e, p0, opts) {
      const els = selected();
      const orig = els.map((el) => ({ el, x: el.x, y: el.y }));
      const bb0 = bounds(els);
      const targets = snapTargets(new Set(sel));
      let moved = false;
      op = 'move';
      trackPointer(e, (ev) => {
        const p = toSlide(ev);
        let dx = p.x - p0.x, dy = p.y - p0.y;
        if (!moved && Math.hypot(dx * k, dy * k) < 3) return;
        moved = true;
        if (ev.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
        const gx = [], gy = [];
        if (!ev.altKey) {
          const sx = snapAxis([bb0.x + dx, bb0.x + bb0.w / 2 + dx, bb0.x + bb0.w + dx], targets.xs);
          const sy = snapAxis([bb0.y + dy, bb0.y + bb0.h / 2 + dy, bb0.y + bb0.h + dy], targets.ys);
          if (sx) { dx += sx.d; gx.push(sx.at); }
          if (sy) { dy += sy.d; gy.push(sy.at); }
        }
        orig.forEach((o) => { o.el.x = r2(o.x + dx); o.el.y = r2(o.y + dy); const n = elNode(o.el.id); if (n) n.style.left = o.el.x + 'px', n.style.top = o.el.y + 'px'; });
        renderSelection();
        showGuides(gx, gy);
      }, (ev) => {
        showGuides();
        if (moved) { commit({ keepInspector: false }); return; }
        if (opts && opts.clickToEdit) {
          const el = elById(opts.clickToEdit);
          if (el && el.type === 'text') startEdit(el.id, { point: ev });
        }
      });
    }

    function beginMarquee(e, p0, base) {
      const box = h('div', 'sl-marquee');
      E.overlay.appendChild(box);
      op = 'marquee';
      trackPointer(e, (ev) => {
        const p = toSlide(ev);
        const x = Math.min(p.x, p0.x), y = Math.min(p.y, p0.y), w = Math.abs(p.x - p0.x), hh = Math.abs(p.y - p0.y);
        box.style.left = x * k + 'px'; box.style.top = y * k + 'px';
        box.style.width = w * k + 'px'; box.style.height = hh * k + 'px';
        const hits = slide().elements.filter((el) => {
          const ex2 = el.x + el.w, ey2 = el.y + el.h;
          return el.x < x + w && ex2 > x && el.y < y + hh && ey2 > y && (w > 2 || hh > 2);
        }).map((el) => el.id);
        sel = Array.from(new Set(base.concat(hits)));
        renderSelection();
        E.overlay.appendChild(box);
      }, () => {
        box.remove();
        setSel(sel);
      });
    }

    function beginHandleDrag(e, el, which) {
      const start = C.clone(el);
      const isLine = el.type === 'shape' && (el.shape === 'line' || el.shape === 'arrow');
      const targets = snapTargets(new Set([el.id]));
      const keepAspectDefault = el.type === 'image' && !el.crop && el.fit !== 'cover';
      op = 'resize';
      trackPointer(e, (ev) => {
        const node = elNode(el.id);
        const p = toSlide(ev);
        const gx = [], gy = [];
        if (which === 'rot') {
          const cx = start.x + start.w / 2, cy = start.y + start.h / 2;
          let a = Math.atan2(p.y - cy, p.x - cx) * 180 / Math.PI + 90;
          if (ev.shiftKey) a = Math.round(a / 15) * 15;
          a = ((a % 360) + 540) % 360 - 180;
          if (Math.abs(a) < 2 && !ev.altKey) a = 0;
          el.rot = r2(a);
        } else if (isLine) {
          const d = C.lineEnds(start);
          let a = { x: start.x + d.x1, y: start.y + d.y1 }, b = { x: start.x + d.x2, y: start.y + d.y2 };
          let q = { x: p.x, y: p.y };
          const fixed = which === 'p1' ? b : a;
          if (ev.shiftKey) {
            const ang = Math.round(Math.atan2(q.y - fixed.y, q.x - fixed.x) / (Math.PI / 4)) * (Math.PI / 4);
            const len = Math.hypot(q.x - fixed.x, q.y - fixed.y);
            q = { x: fixed.x + Math.cos(ang) * len, y: fixed.y + Math.sin(ang) * len };
          } else if (!ev.altKey) {
            const sx = snapAxis([q.x], targets.xs.concat([fixed.x]));
            const sy = snapAxis([q.y], targets.ys.concat([fixed.y]));
            if (sx) { q.x += sx.d; gx.push(sx.at); }
            if (sy) { q.y += sy.d; gy.push(sy.at); }
          }
          if (which === 'p1') a = q; else b = q;
          el.x = r2(Math.min(a.x, b.x)); el.y = r2(Math.min(a.y, b.y));
          el.w = r2(Math.abs(b.x - a.x)); el.h = r2(Math.abs(b.y - a.y));
          el.flipH = b.x < a.x; el.flipV = b.y < a.y;
        } else {
          resizeRotated(el, start, which, p, ev.shiftKey !== keepAspectDefault, ev.altKey ? null : targets, gx, gy);
        }
        if (node) {
          if (el.type === 'shape' || el.type === 'image') {
            const tmp = document.createElement('div');
            tmp.innerHTML = C.elementHtml(deck, slide(), el, { editor: true });
            const fresh = tmp.firstElementChild;
            if (fresh) { node.replaceWith(fresh); decorateStage(); }
          } else patchElementBox(el);
        }
        renderSelection();
        showGuides(gx, gy);
      }, () => {
        showGuides();
        if (el.type === 'text') autoGrow(el);
        commit();
      });
    }

    /* Resize in the element's own (rotated) frame, keeping the opposite
       corner or edge fixed on the slide. */
    function resizeRotated(el, s, which, p, keepAspect, targets, gx, gy) {
      const rad = (s.rot || 0) * Math.PI / 180;
      const cos = Math.cos(rad), sin = Math.sin(rad);
      const cx = s.x + s.w / 2, cy = s.y + s.h / 2;
      const toLocal = (x, y) => ({ x: (x - cx) * cos + (y - cy) * sin, y: -(x - cx) * sin + (y - cy) * cos });
      const toWorld = (x, y) => ({ x: cx + x * cos - y * sin, y: cy + x * sin + y * cos });
      const sxSign = which.includes('e') ? 1 : which.includes('w') ? -1 : 0;
      const sySign = which.includes('s') ? 1 : which.includes('n') ? -1 : 0;
      let pw = { x: p.x, y: p.y };
      if (!s.rot && targets) {
        if (sxSign) { const sn = snapAxis([p.x], targets.xs); if (sn) { pw.x += sn.d; gx.push(sn.at); } }
        if (sySign) { const sn = snapAxis([p.y], targets.ys); if (sn) { pw.y += sn.d; gy.push(sn.at); } }
      }
      const q = toLocal(pw.x, pw.y);
      const anchor = { x: -sxSign * s.w / 2, y: -sySign * s.h / 2 };
      let nw = sxSign ? Math.max(4, (q.x - anchor.x) * sxSign) : s.w;
      let nh = sySign ? Math.max(el.type === 'text' ? 12 : 4, (q.y - anchor.y) * sySign) : s.h;
      if (keepAspect && s.w > 0 && s.h > 0) {
        const ratio = s.w / s.h;
        if (sxSign && sySign) {
          if (nw / nh > ratio) nh = nw / ratio; else nw = nh * ratio;
        } else if (sxSign) nh = nw / ratio;
        else if (sySign) nw = nh * ratio;
      }
      // new centre in local coords: anchor plus half the new size toward the dragged side
      const lcx = sxSign ? anchor.x + sxSign * nw / 2 : 0;
      const lcy = sySign ? anchor.y + sySign * nh / 2 : 0;
      const c = toWorld(lcx, lcy);
      el.w = r2(nw); el.h = r2(nh);
      el.x = r2(c.x - nw / 2); el.y = r2(c.y - nh / 2);
    }

    function onStageDblClick(e) {
      const n = e.target.closest && e.target.closest('.sl-stage .ms-el');
      if (!n) {
        return;
      }
      const el = elById(n.dataset.id);
      if (!el) return;
      if (el.type === 'text' && editingId !== el.id) startEdit(el.id, { point: e });
      else if (el.type === 'image') { if (el.src) replaceImage(el); else insertImagePicker(el); }
    }

    function onStageContextMenu(e) {
      e.preventDefault();
      const n = e.target.closest && e.target.closest('.sl-stage .ms-el');
      if (editingId && n && n.dataset.id === editingId) return; // native text menu is not available; keep caret
      const at = { x: e.clientX, y: e.clientY };
      openPop({ getBoundingClientRect: () => ({ left: at.x, right: at.x, top: at.y, bottom: at.y }), contains: () => false }, (pop) => {
        const has = sel.length > 0;
        menuItem(pop, 'Cut', window.MargoIcons && window.MargoIcons.cut, () => copySelected(true), { accel: 'Ctrl+X', disabled: !has });
        menuItem(pop, 'Copy', window.MargoIcons && window.MargoIcons.copy, () => copySelected(false), { accel: 'Ctrl+C', disabled: !has });
        menuItem(pop, 'Paste', window.MargoIcons && window.MargoIcons.paste, () => pasteCommand(), { accel: 'Ctrl+V' });
        menuItem(pop, 'Duplicate', IC.duplicate, duplicateSelected, { accel: 'Ctrl+D', disabled: !has });
        menuItem(pop, 'Delete', IC.trash, deleteSelected, { accel: 'Del', disabled: !has });
        menuSep(pop);
        menuItem(pop, 'Bring to front', IC.front, () => zorder('front'), { disabled: !has });
        menuItem(pop, 'Send to back', IC.back, () => zorder('back'), { disabled: !has });
        if (!has) {
          menuSep(pop);
          menuItem(pop, 'Change layout…', IC.layout, () => openLayoutMenu(E.tbArrange || E.viewport, (id) => applyLayout(id), slide().layout));
        }
      }, { at });
    }

    /* ---------- rail interaction ---------- */
    function onRailPointerDown(e) {
      const t = e.target.closest('.sl-thumb');
      focusArea = 'rail';
      E.rail.focus({ preventScroll: true });
      if (!t) return;
      const i = +t.dataset.index;
      if (e.button === 2) { goTo(i); return; }
      if (e.button !== 0) return;
      e.preventDefault();
      goTo(i);
      const y0 = e.clientY;
      let dragging = false;
      let drop = null;
      const marker = h('div', 'sl-drop-marker');
      const pid = e.pointerId;
      try { E.railList.setPointerCapture(pid); } catch {}
      const move = (ev) => {
        if (!dragging && Math.abs(ev.clientY - y0) < 5) return;
        if (!dragging) { dragging = true; t.classList.add('dragging'); E.railList.appendChild(marker); }
        const items = Array.from(E.railList.querySelectorAll('.sl-thumb'));
        drop = items.length;
        for (let j = 0; j < items.length; j++) {
          const r = items[j].getBoundingClientRect();
          if (ev.clientY < r.top + r.height / 2) { drop = j; break; }
        }
        const lr = E.railList.getBoundingClientRect();
        const ref = items[drop] ? items[drop].getBoundingClientRect().top - 5 : items[items.length - 1].getBoundingClientRect().bottom + 3;
        marker.style.top = (ref - lr.top + E.railList.scrollTop) + 'px';
        // auto-scroll near the edges
        const rr = E.rail.getBoundingClientRect();
        if (ev.clientY < rr.top + 30) E.railList.scrollTop -= 12;
        else if (ev.clientY > rr.bottom - 30) E.railList.scrollTop += 12;
      };
      const up = () => {
        E.railList.removeEventListener('pointermove', move);
        E.railList.removeEventListener('pointerup', up);
        E.railList.removeEventListener('pointercancel', up);
        try { E.railList.releasePointerCapture(pid); } catch {}
        marker.remove();
        t.classList.remove('dragging');
        if (dragging && drop != null && drop !== i && drop !== i + 1) moveSlide(i, drop);
      };
      E.railList.addEventListener('pointermove', move);
      E.railList.addEventListener('pointerup', up);
      E.railList.addEventListener('pointercancel', up);
    }
    function onRailContextMenu(e) {
      e.preventDefault();
      const t = e.target.closest('.sl-thumb');
      const i = t ? +t.dataset.index : cur;
      openSlideMenu({ x: e.clientX, y: e.clientY }, i);
    }

    /* ---------- keyboard ---------- */
    function onKeyDown(e) {
      if (destroyed || !ctx.isActive() || show) return;
      if (!hostEl || !hostEl.isConnected || hostEl.offsetParent === null) return;
      if (document.querySelector('#modal-backdrop:not(.hidden)')) return;
      const t = e.target;
      const inNotes = t === E.notes;
      const inInspector = E.inspector && E.inspector.contains(t);
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key;

      if (key === 'F5' && !mod) { e.preventDefault(); startShow(e.shiftKey ? cur : 0); return; }
      if (inNotes || inInspector) return;
      if (t && t.closest && (t.closest('.sl-pop') || t.closest('.mc-pop') || t.closest('.menubar') || t.closest('.doc-find-bar'))) return;
      if (isTypingTarget(t) && !(editingId && editBody() && editBody().contains(t))) return;

      if (editingId) {
        if (key === 'Escape') { e.preventDefault(); const id = editingId; endEdit(); setSel([id]); return; }
        if (mod && !e.shiftKey && !e.altKey) {
          const k2 = key.toLowerCase();
          if (k2 === 'b' || k2 === 'i' || k2 === 'u') { e.preventDefault(); toggleInline(k2); return; }
          if (k2 === 'l') { e.preventDefault(); applyAlign('left'); return; }
          if (k2 === 'e') { e.preventDefault(); e.stopImmediatePropagation(); applyAlign('center'); return; }
          if (k2 === 'r') { e.preventDefault(); applyAlign('right'); return; }
          if (k2 === 'j') { e.preventDefault(); applyAlign('justify'); return; }
          if (key === ']') { e.preventDefault(); bumpFontSize(1); return; }
          if (key === '[') { e.preventDefault(); bumpFontSize(-1); return; }
        }
        if (key === 'Tab') {
          e.preventDefault();
          const blocks = blocksInSelection();
          if (blocks.some((b) => b.dataset.list)) changeLevel(e.shiftKey ? -1 : 1);
          else if (!e.shiftKey) { document.execCommand('insertText', false, '\t'); onTextInput(); }
          return;
        }
        if (key === 'Enter' && !e.shiftKey) {
          // Enter on an empty list item ends the list (as in PowerPoint)
          const blocks = blocksInSelection();
          if (blocks.length === 1 && blocks[0].dataset.list && !blocks[0].textContent.replace(/​/g, '')) {
            e.preventDefault();
            const b = blocks[0];
            const lvl = parseInt(b.dataset.level || '0', 10) || 0;
            if (lvl > 0) { b.dataset.level = String(lvl - 1); b.style.setProperty('--lvl', String(lvl - 1)); }
            else { delete b.dataset.list; delete b.dataset.level; b.style.removeProperty('--lvl'); }
            onTextInput();
          }
        }
        return;
      }

      if (focusArea === 'rail' && !mod) {
        if (key === 'ArrowUp' || key === 'ArrowLeft') { e.preventDefault(); goTo(cur - 1); return; }
        if (key === 'ArrowDown' || key === 'ArrowRight') { e.preventDefault(); goTo(cur + 1); return; }
        if (key === 'Delete' || key === 'Backspace') { e.preventDefault(); deleteSlide(); return; }
        if (key === 'Enter') { e.preventDefault(); addSlide(); return; }
      }
      if (mod && !e.altKey) {
        const k2 = key.toLowerCase();
        if (k2 === 'm') { e.preventDefault(); addSlide(); return; }
        if (k2 === 'd') { e.preventDefault(); if (focusArea === 'rail' || !sel.length) duplicateSlide(); else duplicateSelected(); return; }
        if (k2 === 'a') { e.preventDefault(); setSel(slide().elements.map((x) => x.id)); focusArea = 'stage'; return; }
        if (k2 === 'c') { if (sel.length && focusArea !== 'rail') { e.preventDefault(); copySelected(false); } return; }
        if (k2 === 'x') { if (sel.length && focusArea !== 'rail') { e.preventDefault(); copySelected(true); } return; }
        if (k2 === 'v') {
          // The paste event carries images and files; the keyboard path only
          // arms it, falling back to the async clipboard if no event arrives.
          pasteArmed = true;
          setTimeout(() => { if (pasteArmed) { pasteArmed = false; pasteCommand(); } }, 60);
          return;
        }
        if (k2 === 'g') return;
        if (sel.length && (k2 === 'b' || k2 === 'i' || k2 === 'u')) { e.preventDefault(); toggleInline(k2); return; }
        if (sel.length && k2 === 'l') { e.preventDefault(); applyAlign('left'); return; }
        if (sel.length && k2 === 'e') { e.preventDefault(); e.stopImmediatePropagation(); applyAlign('center'); return; }
        if (sel.length && k2 === 'r') { e.preventDefault(); applyAlign('right'); return; }
        if (sel.length && k2 === 'j') { e.preventDefault(); applyAlign('justify'); return; }
        if (sel.length && key === ']') { e.preventDefault(); bumpFontSize(1); return; }
        if (sel.length && key === '[') { e.preventDefault(); bumpFontSize(-1); return; }
        if (sel.length && key === 'ArrowUp') { e.preventDefault(); zorder(e.shiftKey ? 'front' : 'forward'); return; }
        if (sel.length && key === 'ArrowDown') { e.preventDefault(); zorder(e.shiftKey ? 'back' : 'backward'); return; }
        return;
      }
      if (key === 'Escape') { if (sel.length) { e.preventDefault(); setSel([]); } return; }
      if (key === 'Delete' || key === 'Backspace') {
        if (sel.length) { e.preventDefault(); deleteSelected(); }
        return;
      }
      if (key.startsWith('Arrow')) {
        if (!sel.length) {
          if (key === 'ArrowDown' || key === 'ArrowRight') { e.preventDefault(); goTo(cur + 1); }
          else { e.preventDefault(); goTo(cur - 1); }
          return;
        }
        e.preventDefault();
        const step = e.shiftKey ? 10 : e.altKey ? 0.5 : 1;
        nudge(key === 'ArrowLeft' ? -step : key === 'ArrowRight' ? step : 0, key === 'ArrowUp' ? -step : key === 'ArrowDown' ? step : 0);
        return;
      }
      if (key === 'PageDown') { e.preventDefault(); goTo(cur + 1); return; }
      if (key === 'PageUp') { e.preventDefault(); goTo(cur - 1); return; }
      if (key === 'Home' && !sel.length) { e.preventDefault(); goTo(0); return; }
      if (key === 'End' && !sel.length) { e.preventDefault(); goTo(deck.slides.length - 1); return; }
      if ((key === 'Enter' || key === 'F2') && sel.length === 1) {
        const el = selected()[0];
        if (el.type === 'text') { e.preventDefault(); startEdit(el.id, { selectAll: key === 'F2' }); }
        else if (el.type === 'image' && !el.src) { e.preventDefault(); insertImagePicker(el); }
        return;
      }
      // Typing with one text box selected starts editing it
      if (sel.length === 1 && key.length === 1 && !e.altKey) {
        const el = selected()[0];
        if (el.type === 'text') {
          // The key was aimed at the canvas; carry it into the box.
          e.preventDefault();
          startEdit(el.id, {});
          document.execCommand('insertText', false, key);
          onTextInput();
        }
      }
    }
    /* Listening in the capture phase on window puts the editor ahead of the
       app-wide shortcuts, so a key it handles (Ctrl+E centres text here
       rather than exporting) goes no further. */
    function onKeyDownCapture(e) {
      if (e.key === 'Escape' && document.querySelector('.mc-pop, .sl-pop, .menu-drop')) return;
      const before = e.defaultPrevented;
      onKeyDown(e);
      if (!before && e.defaultPrevented) e.stopPropagation();
    }
    let pasteArmed = false;
    function onPaste(e) {
      if (destroyed || !ctx.isActive() || show) return;
      if (!hostEl || hostEl.offsetParent === null) return;
      const t = e.target;
      if (editingId && editBody() && editBody().contains(t)) {
        // Plain text only: foreign HTML would bring its own fonts and layout into the box.
        e.preventDefault();
        const txt = (e.clipboardData && e.clipboardData.getData('text/plain')) || '';
        if (txt) document.execCommand('insertText', false, txt.replace(/\r\n?/g, '\n'));
        onTextInput();
        return;
      }
      if (isTypingTarget(t)) return;
      if (document.querySelector('#modal-backdrop:not(.hidden)')) return;
      e.preventDefault();
      pasteArmed = false;
      pasteFromClipboardData(e.clipboardData);
    }
    function onCopyCut(e) {
      if (destroyed || !ctx.isActive() || show || editingId) return;
      if (isTypingTarget(e.target) || !sel.length || focusArea === 'rail') return;
      if (!hostEl || hostEl.offsetParent === null) return;
      e.preventDefault();
      copySelected(e.type === 'cut');
      if (e.clipboardData) e.clipboardData.setData('text/plain', clip.text);
    }
    function onSelectionChange() {
      if (!editingId || destroyed) return;
      const body = editBody();
      const s = window.getSelection();
      if (!body || !s.rangeCount || !body.contains(s.getRangeAt(0).startContainer)) return;
      syncToolbar();
    }

    /* ---------- drag & drop images onto the canvas ---------- */
    function onDragOver(e) {
      if (e.dataTransfer && Array.from(e.dataTransfer.items || []).some((it) => it.kind === 'file' && /^image\//.test(it.type))) {
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'copy';
        E.viewport.classList.add('drop-target');
      }
    }
    async function onDrop(e) {
      E.viewport.classList.remove('drop-target');
      const files = e.dataTransfer && e.dataTransfer.files ? Array.from(e.dataTransfer.files) : [];
      const imgs = files.filter((f) => /^image\//.test(f.type));
      if (!imgs.length) return; // let the app open other files
      e.preventDefault();
      e.stopPropagation();
      let p = toSlide(e);
      for (const f of imgs) {
        await addImageFromDataUrl(await readFileAsDataUrl(f), p);
        p = { x: p.x + 24, y: p.y + 24 };
      }
    }

    /* ---------- find ---------- */
    async function find() {
      if (editingId) endEdit();
      const q = await ctx.inputModal('Find in presentation', 'Text to find…', findState.q || '');
      if (!q) return;
      const needle = q.toLowerCase();
      if (needle !== findState.q.toLowerCase()) findState = { q, slide: cur, el: -1 };
      const n = deck.slides.length;
      for (let step = 0; step <= n; step++) {
        const si = (findState.slide + step) % n;
        const els = deck.slides[si].elements;
        const start = step === 0 ? findState.el + 1 : 0;
        for (let ei = start; ei < els.length; ei++) {
          const e = els[ei];
          const text = (e.type === 'text' ? C.elementText(e) : '').toLowerCase();
          if (text.includes(needle)) {
            findState = { q, slide: si, el: ei };
            goTo(si, { force: true });
            setSel([e.id]);
            return;
          }
        }
        if (deck.slides[si].notes && deck.slides[si].notes.toLowerCase().includes(needle) && step > 0) {
          findState = { q, slide: si, el: els.length };
          goTo(si, { force: true });
          toggleNotes(true);
          return;
        }
      }
      ctx.toast(`No matches for “${q}”`);
    }

    /* ---------- slideshow ---------- */
    function startShow(from) {
      if (editingId) endEdit();
      if (show) return;
      closePop();
      const root = h('div', 'sl-show');
      root.tabIndex = -1;
      root.innerHTML =
        '<div class="sl-show-stage"></div>' +
        '<div class="sl-show-bar">' +
          `<button type="button" class="sl-show-btn" data-act="prev" title="Previous (←)">${IC.prev}</button>` +
          '<span class="sl-show-count"></span>' +
          `<button type="button" class="sl-show-btn" data-act="next" title="Next (→ or Space)">${IC.next}</button>` +
          '<span class="sl-show-sep"></span>' +
          `<button type="button" class="sl-show-btn" data-act="notes" title="Speaker notes (N)">${IC.notes}</button>` +
          `<button type="button" class="sl-show-btn" data-act="exit" title="End show (Esc)">${IC.close}</button>` +
        '</div>' +
        '<div class="sl-show-notes hidden"></div>';
      document.body.appendChild(root);
      show = { root, i: clamp(from || 0, 0, deck.slides.length - 1), end: false, black: false, notes: false, typed: '', hideTimer: null };
      const stage = root.querySelector('.sl-show-stage');
      const paint = (fade) => {
        const W0 = W(), H0 = H();
        const vw = root.clientWidth || window.innerWidth, vh = root.clientHeight || window.innerHeight;
        const sc = Math.min(vw / W0, vh / H0);
        const layer = h('div', 'sl-show-layer');
        if (show.end) {
          layer.innerHTML = '<div class="sl-show-end">End of slide show — click or press Esc to exit.</div>';
        } else if (show.black) {
          layer.innerHTML = `<div class="sl-show-blank ${show.black}"></div>`;
        } else {
          layer.innerHTML = `<div class="sl-show-slide" style="width:${W0}px;height:${H0}px;transform:translate(-50%,-50%) scale(${sc})">${C.slideHtml(deck, deck.slides[show.i], { editor: false })}</div>`;
        }
        const prev = stage.lastElementChild;
        stage.appendChild(layer);
        if (fade && prev) {
          layer.classList.add('entering');
          requestAnimationFrame(() => layer.classList.remove('entering'));
          setTimeout(() => { if (prev.isConnected) prev.remove(); }, 260);
        } else if (prev) prev.remove();
        root.querySelector('.sl-show-count').textContent = show.end ? 'End' : `${show.i + 1} / ${deck.slides.length}`;
        const notesEl = root.querySelector('.sl-show-notes');
        notesEl.classList.toggle('hidden', !show.notes || show.end);
        notesEl.textContent = (deck.slides[show.i] && deck.slides[show.i].notes) || 'No speaker notes for this slide.';
      };
      show.paint = paint;
      const go = (d) => {
        if (show.black) { show.black = false; paint(false); return; }
        if (show.end) { if (d < 0) { show.end = false; paint(true); } else exitShow(); return; }
        const n = show.i + d;
        if (n >= deck.slides.length) { show.end = true; paint(true); return; }
        if (n < 0) return;
        show.i = n;
        paint(true);
      };
      show.go = go;
      const bump = () => {
        root.classList.add('show-ui');
        clearTimeout(show.hideTimer);
        show.hideTimer = setTimeout(() => root.classList.remove('show-ui'), 2200);
      };
      show.onKey = (e) => {
        if (!show) return;
        e.stopPropagation();
        const key = e.key;
        if (key === 'Escape') { e.preventDefault(); exitShow(); return; }
        if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'n', 'N', 'Enter'].includes(key) && !(key === 'Enter' && show.typed)) {
          e.preventDefault();
          if (key === 'n') { go(1); return; }
          if (key === 'N') { show.notes = !show.notes; paint(false); return; }
          go(1);
          return;
        }
        if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace', 'p', 'P'].includes(key)) { e.preventDefault(); go(-1); return; }
        if (key === 'Home') { e.preventDefault(); show.end = false; show.i = 0; paint(true); return; }
        if (key === 'End') { e.preventDefault(); show.end = false; show.i = deck.slides.length - 1; paint(true); return; }
        if (key === 'b' || key === 'B' || key === '.') { e.preventDefault(); show.black = show.black === 'black' ? false : 'black'; paint(false); return; }
        if (key === 'w' || key === 'W' || key === ',') { e.preventDefault(); show.black = show.black === 'white' ? false : 'white'; paint(false); return; }
        if (key === 's' || key === 'S') { e.preventDefault(); show.notes = !show.notes; paint(false); return; }
        if (/^[0-9]$/.test(key)) { show.typed += key; return; }
        if (key === 'Enter' && show.typed) {
          e.preventDefault();
          const n = clamp(parseInt(show.typed, 10) - 1, 0, deck.slides.length - 1);
          show.typed = '';
          show.end = false; show.i = n; paint(true);
          return;
        }
        if (key === 'F5' || (e.ctrlKey || e.metaKey)) e.preventDefault();
      };
      show.onResize = () => paint(false);
      document.addEventListener('keydown', show.onKey, true);
      window.addEventListener('resize', show.onResize);
      root.addEventListener('mousemove', bump);
      root.addEventListener('click', (e) => {
        const b = e.target.closest('.sl-show-btn');
        if (b) {
          const act = b.dataset.act;
          if (act === 'prev') go(-1);
          else if (act === 'next') go(1);
          else if (act === 'notes') { show.notes = !show.notes; paint(false); }
          else if (act === 'exit') exitShow();
          return;
        }
        if (e.target.closest('.sl-show-notes')) return;
        go(1);
      });
      root.addEventListener('contextmenu', (e) => { e.preventDefault(); go(-1); });
      root.addEventListener('wheel', (e) => { if (Math.abs(e.deltaY) > 20) go(e.deltaY > 0 ? 1 : -1); }, { passive: true });
      show.onFs = () => { if (show && !document.fullscreenElement && show.wasFull) exitShow(); };
      document.addEventListener('fullscreenchange', show.onFs);
      paint(false);
      root.focus();
      bump();
      try {
        if (root.requestFullscreen && !(window.margo && window.margo.isSmoke && window.margo.isSmoke())) {
          root.requestFullscreen().then(() => { if (show) { show.wasFull = true; paint(false); } }).catch(() => {});
        }
      } catch {}
    }
    function exitShow() {
      if (!show) return;
      const s = show;
      show = null;
      document.removeEventListener('keydown', s.onKey, true);
      document.removeEventListener('fullscreenchange', s.onFs);
      window.removeEventListener('resize', s.onResize);
      clearTimeout(s.hideTimer);
      if (document.fullscreenElement) { try { document.exitFullscreen().catch(() => {}); } catch {} }
      s.root.remove();
      if (!s.end && s.i !== cur) goTo(s.i);
      if (E.viewport) E.viewport.focus({ preventScroll: true });
    }

    /* ---------- mount ---------- */
    function buildDom(host) {
      host.innerHTML = '';
      host.classList.add('sl-host');
      const wrap = h('div', 'sl-wrap');
      const rail = h('aside', 'sl-rail');
      rail.tabIndex = 0;
      rail.setAttribute('aria-label', 'Slides');
      const railList = h('div', 'sl-rail-list');
      railList.setAttribute('role', 'listbox');
      const railAdd = h('button', 'sl-rail-add', `${IC.plus}<span>New slide</span>`);
      railAdd.type = 'button';
      railAdd.title = 'New slide (Ctrl+M)';
      railAdd.addEventListener('click', () => addSlide());
      rail.append(railList, railAdd);

      const center = h('div', 'sl-center');
      const viewport = h('div', 'sl-viewport');
      viewport.tabIndex = 0;
      viewport.setAttribute('aria-label', 'Slide canvas');
      const stageBox = h('div', 'sl-stage-box');
      const stage = h('div', 'sl-stage');
      const overlay = h('div', 'sl-overlay');
      stageBox.append(stage, overlay);
      viewport.appendChild(stageBox);
      const notesWrap = h('div', 'sl-notes');
      const notesHead = h('div', 'sl-notes-head', `<span>${IC.notes}</span><span>Speaker notes</span>`);
      const notes = document.createElement('textarea');
      notes.className = 'sl-notes-input';
      notes.placeholder = 'Click to add speaker notes';
      notes.spellcheck = true;
      notesWrap.append(notesHead, notes);
      center.append(viewport, notesWrap);

      const inspectorWrap = h('aside', 'sl-inspector-wrap');
      const inspector = h('div', 'sl-inspector');
      inspectorWrap.appendChild(inspector);

      wrap.append(rail, center, inspectorWrap);
      host.appendChild(wrap);
      Object.assign(E, { wrap, rail, railList, railAdd, center, viewport, stageBox, stage, overlay, notesWrap, notes, inspectorWrap, inspector });

      stageBox.addEventListener('pointerdown', onStagePointerDown);
      stageBox.addEventListener('dblclick', onStageDblClick);
      stageBox.addEventListener('contextmenu', onStageContextMenu);
      viewport.addEventListener('pointerdown', (e) => {
        if (e.target === viewport) {
          focusArea = 'stage';
          if (editingId) endEdit();
          if (sel.length) setSel([]);
          viewport.focus({ preventScroll: true });
        }
      });
      viewport.addEventListener('wheel', (e) => {
        if (!(e.ctrlKey || e.metaKey)) return;
        e.preventDefault();
        zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1);
      }, { passive: false });
      viewport.addEventListener('dragover', onDragOver);
      viewport.addEventListener('dragleave', () => viewport.classList.remove('drop-target'));
      viewport.addEventListener('drop', onDrop);
      stage.addEventListener('input', (e) => { if (editingId && e.target.closest('.ms-body')) onTextInput(); });
      railList.addEventListener('pointerdown', onRailPointerDown);
      rail.addEventListener('contextmenu', onRailContextMenu);
      rail.addEventListener('focus', () => { focusArea = 'rail'; });
      notes.addEventListener('input', () => {
        slide().notes = notes.value;
        ctx.markDirty();
        queueThumb(cur);
        clearTimeout(textRecordTimer);
        textRecordTimer = setTimeout(() => record(true), 300);
      });
      notes.addEventListener('focus', () => { if (editingId) endEdit(); });
      resizeObs = new ResizeObserver(() => { if (zoomMode === 'fit') applyScale(); });
      resizeObs.observe(viewport);
    }

    function setupStatus() {
      if (!ctx.status) return;
      ctx.status.setKind('Presentation');
      ctx.status.showZoom(true);
      ctx.status.onZoom((z) => setZoom(z));
      if (ctx.status.setViewModes) {
        ctx.status.setViewModes([
          { id: 'normal', title: 'Normal', html: IC.layout },
          { id: 'show', title: 'Slide show (F5)', html: IC.play }
        ]);
        ctx.status.setViewActive('normal');
        ctx.status.onView((m) => { if (m === 'show') { startShow(cur); ctx.status.setViewActive('normal'); } });
      }
    }

    function mount(host, doc) {
      injectCoreCss();
      hostEl = host;
      deck = doc && doc.deck ? C.normalizeDeck(doc.deck) : C.newDeck('margo');
      cur = 0;
      sel = [];
      buildToolbar();
      buildDom(host);
      window.addEventListener('keydown', onKeyDownCapture, true);
      document.addEventListener('paste', onPaste);
      document.addEventListener('copy', onCopyCut);
      document.addEventListener('cut', onCopyCut);
      document.addEventListener('selectionchange', onSelectionChange);
      setupStatus();
      history.seed(snapshot());
      renderAll();
      requestAnimationFrame(() => { applyScale(); renderSelection(); });
      applyScale();
    }

    function destroy() {
      destroyed = true;
      exitShow();
      closePop();
      clearTimeout(thumbTimer);
      clearTimeout(textRecordTimer);
      window.removeEventListener('keydown', onKeyDownCapture, true);
      document.removeEventListener('paste', onPaste);
      document.removeEventListener('copy', onCopyCut);
      document.removeEventListener('cut', onCopyCut);
      document.removeEventListener('selectionchange', onSelectionChange);
      if (resizeObs) resizeObs.disconnect();
    }

    function getData() {
      if (editingId) syncEditToModel();
      return { deck: C.clone(deck) };
    }

    return {
      kind: 'slides',
      mount,
      destroy,
      getData,
      focus() {
        if (editingId && editBody()) editBody().focus({ preventScroll: true });
        else if (E.viewport) E.viewport.focus({ preventScroll: true });
        requestAnimationFrame(applyScale);
      },
      commands: {
        undo() { if (editingId) endEdit(); history.undo(restoreSnap); },
        redo() { if (editingId) endEdit(); history.redo(restoreSnap); },
        canUndo: () => history.canUndo() || !!editingId,
        canRedo: () => history.canRedo(),
        status: () => statusText(),
        find: () => find(),
        paste: (t) => pasteCommand(t),
        copy() {
          if (editingId) { document.execCommand('copy'); return; }
          copySelected(false);
        },
        cut() {
          if (editingId) { document.execCommand('cut'); onTextInput(); return; }
          copySelected(true);
        },
        selectAll() {
          if (editingId) { document.execCommand('selectAll'); return; }
          setSel(slide().elements.map((x) => x.id));
        },
        delete: () => deleteSelected(),
        zoomIn: () => zoomBy(1.1),
        zoomOut: () => zoomBy(1 / 1.1),
        zoomReset: () => zoomFit(),
        setZoom: (z) => setZoom(z),
        present: (from) => startShow(from == null ? 0 : from),
        presentCurrent: () => startShow(cur),
        exitShow: () => exitShow(),
        isPresenting: () => !!show,
        showNext: () => show && show.go(1),
        showPrev: () => show && show.go(-1),
        showIndex: () => (show ? show.i : -1),
        addSlide: (layout) => addSlide(layout),
        duplicateSlide: () => duplicateSlide(),
        deleteSlide: () => deleteSlide(),
        moveSlide: (from, to) => moveSlide(from, to),
        goTo: (i) => goTo(i),
        currentIndex: () => cur,
        slideCount: () => deck.slides.length,
        addTextBox: () => addTextBox(),
        addShape: (kind) => addShape(kind),
        addImage: (dataUrl) => addImageFromDataUrl(dataUrl),
        insertImage: () => insertImagePicker(),
        setTheme: (id) => setTheme(id),
        applyLayout: (id) => applyLayout(id),
        themes: () => C.themeList(deck).map((t) => ({ id: t.id, name: t.name })),
        select: (ids) => setSel(ids),
        selection: () => sel.slice(),
        startEdit: (id) => startEdit(id, { selectAll: true }),
        endEdit: () => endEdit(),
        editingId: () => editingId,
        nudge: (dx, dy) => nudge(dx, dy),
        duplicate: () => duplicateSelected(),
        bold: () => toggleInline('b'),
        italic: () => toggleInline('i'),
        underline: () => toggleInline('u'),
        align: (a) => applyAlign(a),
        list: (kind) => applyList(kind),
        fontSize: (pt) => applyFontSize(pt),
        textColor: (hex) => applyTextColor(hex),
        zorder: (d) => zorder(d),
        alignObjects: (how) => alignSelected(how),
        toggleNotes: () => toggleNotes(),
        setNotes(text) { slide().notes = String(text || ''); renderNotes(); commit({ keepStage: true }); },
        toggleInspector: () => toggleInspector(),
        deck: () => deck
      }
    };
  }

  /* ---------------- library thumbnails ---------------- */
  /* A portrait card like the other document types, with the first slides
     stacked on it. Rendered through the main process like Word cards. */
  async function thumbDataUrl(deckIn) {
    if (!deckIn || !window.margo || !window.margo.renderHtmlThumb) return null;
    const deck = C.normalizeDeck(deckIn);
    const CW = 440, CH = 568;
    const inner = CW - 28 - 48;
    const sc = inner / deck.size.w;
    const sh = deck.size.h * sc;
    const shown = deck.slides.slice(0, sh * 2 + 70 < CH - 60 ? 2 : 1);
    const tops = shown.length === 2 ? [74, 74 + sh + 22] : [Math.round((CH - sh) / 2)];
    const slidesHtml = shown.map((s, i) =>
      `<div class="sl-card-slide" style="top:${tops[i]}px;width:${inner}px;height:${Math.round(sh)}px">` +
      `<div style="transform:scale(${sc});transform-origin:0 0;width:${deck.size.w}px;height:${deck.size.h}px">${C.slideHtml(deck, s, { editor: false })}</div></div>`
    ).join('');
    const title = C.slideTitle(deck.slides[0]) || '';
    const html = '<!doctype html><meta charset="utf-8"><style>' +
      'html,body{margin:0;padding:0}*{box-sizing:border-box}' +
      `.card{position:relative;width:${CW}px;height:${CH}px;background:#f3f2ef;font-family:'Segoe UI',system-ui,sans-serif;overflow:hidden}` +
      '.frame{position:absolute;left:14px;top:14px;right:14px;bottom:14px;background:#fff;border-radius:10px;border:1px solid #e4e4e0;box-shadow:0 1px 2px rgba(20,20,15,.06),0 10px 28px rgba(20,20,15,.08);overflow:hidden}' +
      '.accent{position:absolute;left:0;top:0;bottom:0;width:6px;background:#d9622b}' +
      '.badge{position:absolute;top:12px;right:12px;font-size:11px;font-weight:700;letter-spacing:.06em;color:#a8481c;background:rgba(217,98,43,.13);border-radius:6px;padding:3px 7px}' +
      '.ttl{position:absolute;left:24px;top:16px;right:70px;font-size:13px;font-weight:600;color:#3a3a40;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
      '.sl-card-slide{position:absolute;left:24px;border-radius:4px;overflow:hidden;box-shadow:0 0 0 1px rgba(0,0,0,.08),0 4px 14px rgba(0,0,0,.08)}' +
      C.SLIDE_CSS +
      '</style><body><div class="card"><div class="frame"><div class="accent"></div>' +
      `<div class="ttl">${C.escapeHtml(title)}</div><div class="badge">PPT</div>${slidesHtml}</div></div></body>`;
    try {
      const res = await window.margo.renderHtmlThumb({ html, width: CW, height: CH });
      return res && res.ok && res.dataUrl ? res.dataUrl : null;
    } catch { return null; }
  }

  window.MargoEditors = window.MargoEditors || {};
  create.blankDoc = () => ({ kind: 'slides', name: 'Untitled.pptx', path: null, deck: C.newDeck('margo') });
  window.MargoEditors.slides = create;
  window.MargoSlides = { thumbDataUrl, newDeck: (theme) => C.newDeck(theme) };
})();
