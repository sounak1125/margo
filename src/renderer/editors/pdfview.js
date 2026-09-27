/* Margo — PDF editor.

   Viewing: lazy page rendering (with off-screen pages released), a text
   layer for selection and copy, thumbnails, search, zoom and go-to-page.
   Editing: highlights, text boxes, sticky notes, signatures and image
   stamps live as overlay annotations until save, when pdf-lib burns them
   into the file. Page operations (rotate, delete, reorder, insert, merge,
   extract) rewrite the bytes straight away and reload the view. AcroForm
   fields get real inputs over the page and are written back by name. */
(function () {
  function b64(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(s);
  }

  function fromB64(s) {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function toBytes(raw) {
    if (!raw) return null;
    if (raw instanceof Uint8Array) return new Uint8Array(raw);
    if (raw.buffer) return new Uint8Array(raw.buffer, raw.byteOffset || 0, raw.byteLength || raw.length);
    return new Uint8Array(raw);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /* US Letter — same size as the smoke sample PDF. */
  async function blankPdfBytes() {
    const pdfDoc = await PDFLib.PDFDocument.create();
    const letter = (PDFLib.PageSizes && PDFLib.PageSizes.Letter) || [612, 792];
    pdfDoc.addPage(letter);
    return await pdfDoc.save();
  }

  /* ------------------------------------------------------------------ */
  /* icons                                                               */
  /* ------------------------------------------------------------------ */
  const SVG = (d) =>
    `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const ICONS = {
    sidebar: SVG('<rect x="2" y="2.5" width="12" height="11" rx="2"/><path d="M6 2.5v11M3.6 5.2h.8M3.6 7.4h.8M3.6 9.6h.8"/>'),
    chevronLeft: SVG('<path d="m9.5 4-4 4 4 4"/>'),
    chevronRight: SVG('<path d="m6.5 4 4 4-4 4"/>'),
    chevronUp: SVG('<path d="m4.5 9.5 3.5-3.5 3.5 3.5"/>'),
    chevronDown: SVG('<path d="m4.5 6.5 3.5 3.5 3.5-3.5"/>'),
    zoomIn: SVG('<circle cx="7" cy="7" r="4.5"/><path d="m13.5 13.5-3.2-3.2M7 5.1v3.8M5.1 7h3.8"/>'),
    zoomOut: SVG('<circle cx="7" cy="7" r="4.5"/><path d="m13.5 13.5-3.2-3.2M5.1 7h3.8"/>'),
    cursor: SVG('<path d="M3.5 2.5 12 7.6l-3.8 1-2 3.6z"/><path d="m8.4 8.7 3 3.8"/>'),
    highlighter: SVG('<path d="m9.8 2.6 3.6 3.6-5.6 5.6H4.2V8.2z"/><path d="m7.6 4.8 3.6 3.6M2.5 14h6"/>'),
    textBox: SVG('<rect x="2" y="2.5" width="12" height="11" rx="2"/><path d="M5.5 5.8h5M8 5.8v5"/>'),
    note: SVG('<path d="M3.5 2.5h9a1 1 0 0 1 1 1v6l-4 4h-6a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1z"/><path d="M13.5 9.5h-3a1 1 0 0 0-1 1v3M5.5 6h5M5.5 8.5h2.5"/>'),
    signature: SVG('<path d="M2.5 11.5c1.5 0 2-5.5 3.5-5.5s.3 4.5 1.6 4.5c1 0 1.2-2.2 2.2-2.2.8 0 .6 1.7 1.5 1.7.6 0 1-.6 1.2-1"/><path d="M2.5 14h11"/>'),
    stamp: SVG('<rect x="2" y="2.8" width="12" height="10.4" rx="2"/><circle cx="5.8" cy="6.3" r="1.1"/><path d="m2.4 11.6 3.4-3.1 2.4 2.2 2.3-2.4 3.1 3"/>'),
    rotateCw: SVG('<path d="M12.8 6.2A5 5 0 1 0 13 9.5"/><path d="M13 2.8v3.6H9.4"/>'),
    rotateCcw: SVG('<path d="M3.2 6.2A5 5 0 1 1 3 9.5"/><path d="M3 2.8v3.6h3.6"/>'),
    trash: SVG('<path d="M2.8 4.5h10.4M6.3 4.5V3a.8.8 0 0 1 .8-.8h1.8a.8.8 0 0 1 .8.8v1.5M4.2 4.5l.6 8.6a1 1 0 0 0 1 .9h4.4a1 1 0 0 0 1-.9l.6-8.6M6.8 7v4.4M9.2 7v4.4"/>'),
    pages: SVG('<rect x="4.5" y="2" width="8.5" height="10.5" rx="1.5"/><path d="M3 5v8a1.5 1.5 0 0 0 1.5 1.5H10"/>'),
    merge: SVG('<path d="M3 3h4v4M3 13h4V9M7 7l2.5 1L7 9M9.5 8H14"/>'),
    extract: SVG('<path d="M9 2H4.5A1.5 1.5 0 0 0 3 3.5v9A1.5 1.5 0 0 0 4.5 14h7a1.5 1.5 0 0 0 1.5-1.5V6"/><path d="M9.5 6.5 14 2M10.5 2H14v3.5"/>'),
    insertPage: SVG('<path d="M9 2H4.5A1.5 1.5 0 0 0 3 3.5v9A1.5 1.5 0 0 0 4.5 14h7a1.5 1.5 0 0 0 1.5-1.5V6z"/><path d="M8 7.2v4.6M5.7 9.5h4.6"/>'),
    print: SVG('<path d="M4.5 6V2.5h7V6"/><rect x="2" y="6" width="12" height="5.5" rx="1.5"/><path d="M4.5 9.5h7v4h-7z"/>'),
    search: SVG('<circle cx="7" cy="7" r="4.3"/><path d="m13.5 13.5-3.4-3.4"/>'),
    images: SVG('<rect x="5" y="2.5" width="8.5" height="8.5" rx="1.6"/><circle cx="7.9" cy="5.4" r=".9"/><path d="m5.6 9.8 2.5-2.4 1.8 1.7 1.9-2.1 1.7 1.7"/><path d="M11 13.5H4a1.5 1.5 0 0 1-1.5-1.5V5.2"/>'),
    close: SVG('<path d="m4 4 8 8M12 4l-8 8"/>'),
    check: SVG('<path d="m3.5 8.5 3 3 6-7"/>'),
    copy: SVG('<rect x="5.5" y="5.5" width="8" height="8" rx="1.8"/><path d="M10.5 3.6v-.1A1.5 1.5 0 0 0 9 2H4a1.5 1.5 0 0 0-1.5 1.5V9A1.5 1.5 0 0 0 4 10.5h.1"/>'),
    more: SVG('<circle cx="3.5" cy="8" r=".9" fill="currentColor" stroke="none"/><circle cx="8" cy="8" r=".9" fill="currentColor" stroke="none"/><circle cx="12.5" cy="8" r=".9" fill="currentColor" stroke="none"/>'),
    form: SVG('<rect x="2" y="3" width="12" height="4" rx="1"/><rect x="2" y="9" width="12" height="4" rx="1"/><path d="M4.5 5h3M4.5 11h2"/>')
  };

  const PT_TO_CSS = 96 / 72;
  const HIGHLIGHT_COLORS = [
    ['Yellow', '#ffd60a'], ['Green', '#7ee081'], ['Blue', '#6ec3ff'], ['Pink', '#ff8fc7'], ['Orange', '#ffb347']
  ];
  const INK_COLORS = [
    ['Black', '#1c1c1e'], ['Blue', '#1f5fd1'], ['Red', '#d12f2f'], ['Green', '#1f8a3a'], ['Grey', '#6b6b70']
  ];
  const TEXT_FONT_STACK = 'Helvetica, Arial, "Liberation Sans", "Nimbus Sans", sans-serif';

  function hexToRgb(hex) {
    const h = String(hex || '#000').replace('#', '');
    const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16) || 0;
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }

  /* "1-3, 5, 8-" style ranges → sorted zero-based page indices. */
  function parseRanges(text, count) {
    const out = new Set();
    const parts = String(text || '').split(/[,;\s]+/).filter(Boolean);
    if (!parts.length) return null;
    for (const part of parts) {
      const m = /^(\d*)\s*-\s*(\d*)$/.exec(part);
      if (m) {
        const a = m[1] ? Number(m[1]) : 1;
        const b = m[2] ? Number(m[2]) : count;
        if (!a || !b || a > b || a < 1 || b > count) return null;
        for (let i = a; i <= b; i++) out.add(i - 1);
      } else if (/^\d+$/.test(part)) {
        const n = Number(part);
        if (n < 1 || n > count) return null;
        out.add(n - 1);
      } else {
        return null;
      }
    }
    return Array.from(out).sort((x, y) => x - y);
  }

  function pickFile(accept, multiple) {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = accept;
      input.multiple = !!multiple;
      input.style.display = 'none';
      document.body.appendChild(input);
      let settled = false;
      const done = (v) => {
        if (settled) return;
        settled = true;
        input.remove();
        resolve(v);
      };
      input.addEventListener('change', () => done(input.files && input.files.length ? Array.from(input.files) : null));
      input.addEventListener('cancel', () => done(null));
      input.click();
    });
  }

  function readFile(file, as) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error || new Error('Could not read the file'));
      if (as === 'dataUrl') r.readAsDataURL(file); else r.readAsArrayBuffer(file);
    });
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('That picture could not be read'));
      img.src = src;
    });
  }

  /* pdf-lib embeds PNG and JPEG only; everything else is redrawn as PNG. */
  async function normaliseImage(dataUrl, maxSide) {
    const img = await loadImage(dataUrl);
    const limit = maxSide || 2400;
    const big = Math.max(img.naturalWidth, img.naturalHeight) > limit;
    if (!big && /^data:image\/(png|jpe?g);/i.test(dataUrl)) {
      return { dataUrl, w: img.naturalWidth, h: img.naturalHeight };
    }
    const k = big ? limit / Math.max(img.naturalWidth, img.naturalHeight) : 1;
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.naturalWidth * k));
    c.height = Math.max(1, Math.round(img.naturalHeight * k));
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    const jpeg = /^data:image\/jpe?g/i.test(dataUrl);
    return { dataUrl: jpeg ? c.toDataURL('image/jpeg', 0.92) : c.toDataURL('image/png'), w: c.width, h: c.height };
  }

  function create(ctx) {
    let host, wrap, scroll, thumbsEl, thumbsList, pdf = null, bytes = null;
    let loadedFromPath = false;
    let bytesChanged = false;
    let encrypted = false;
    let pageViews = [];
    let cssScale = 1, zoom = 1, fitMode = 'auto';
    const ZOOM_MIN = 0.25;
    const ZOOM_MAX = 4;
    let observer = null, thumbObserver = null, resizeObs = null, destroyed = false;
    let currentPage = 1;
    let loadSeq = 0;
    let loadingTask = null;
    let docRef = null;

    /* edits */
    let anns = [];
    let annSeq = 0;
    let formValues = new Map();
    let formEls = new Map();
    let selectedId = null;
    let editingId = null;
    let tool = 'select';
    let pendingImage = null;
    let hlColor = HIGHLIGHT_COLORS[0][1];
    let inkColor = INK_COLORS[0][1];
    let textSize = 14;

    /* history: whole snapshots; bytes are shared by reference until a page
       operation replaces them */
    let hist = [];
    let histIndex = -1;
    const HIST_LIMIT = 60;

    /* toolbar refs */
    let tb = {};
    let popover = null;
    let bubble = null;

    /* find */
    let findBar = null, findInput = null, findCountEl = null;
    let findOpen = false, findHits = [], findIndex = -1;
    let textIndex = null;
    let textIndexPromise = null;

    const dpr = () => Math.min(window.devicePixelRatio || 1, 2.5);
    const MAX_CANVAS_PIXELS = 24e6;

    /* ================================================================ */
    /* loading                                                           */
    /* ================================================================ */
    function teardownPages() {
      if (observer) { observer.disconnect(); observer = null; }
      if (thumbObserver) { thumbObserver.disconnect(); thumbObserver = null; }
      for (const pv of pageViews) {
        if (pv.renderTask && pv.renderTask.cancel) { try { pv.renderTask.cancel(); } catch {} }
        if (pv.textTask && pv.textTask.cancel) { try { pv.textTask.cancel(); } catch {} }
        if (pv.canvas) { pv.canvas.width = 0; pv.canvas.height = 0; }
        if (pv.thumbCanvas) { pv.thumbCanvas.width = 0; pv.thumbCanvas.height = 0; }
        if (pv.page && pv.page.cleanup) { try { pv.page.cleanup(); } catch {} }
      }
      pageViews = [];
      textIndex = null;
      textIndexPromise = null;
      if (scroll) scroll.textContent = '';
      if (thumbsList) thumbsList.textContent = '';
    }

    async function loadDocument(data, opts) {
      const seq = ++loadSeq;
      if (loadingTask) { try { loadingTask.destroy(); } catch {} }
      const task = pdfjsLib.getDocument({ data: data.slice(), isEvalSupported: false });
      loadingTask = task;
      let doc;
      try {
        doc = await task.promise;
      } finally {
        if (loadingTask === task) loadingTask = null;
      }
      if (destroyed || seq !== loadSeq) {
        try { doc.destroy(); } catch {}
        return false;
      }
      const keepPage = opts && opts.keepPage;
      const keepOffset = opts && opts.keepOffset;
      teardownPages();
      const old = pdf;
      pdf = doc;
      if (old) { try { old.destroy(); } catch {} }
      await buildPages(seq);
      if (destroyed || seq !== loadSeq) return false;
      if (keepPage) goToPage(Math.min(keepPage, pdf.numPages), keepOffset, true);
      return true;
    }

    let firstBuild = true;
    async function buildPages(seq) {
      const n = pdf.numPages;
      if (firstBuild) {
        firstBuild = false;
        const open = n > 1 && host && host.clientWidth > 900;
        wrap.classList.toggle('thumbs-hidden', !open);
        if (tb.thumbs) { tb.thumbs.classList.toggle('active', open); tb.thumbs.setAttribute('aria-pressed', String(open)); }
      }
      const first = await pdf.getPage(1);
      if (destroyed || seq !== loadSeq) return;
      const views = [];
      for (let i = 1; i <= n; i++) {
        const page = i === 1 ? first : await pdf.getPage(i);
        if (destroyed || seq !== loadSeq) return;
        const vp1 = page.getViewport({ scale: 1 });
        const el = document.createElement('div');
        el.className = 'pdf-page';
        el.dataset.i = i - 1;
        el.setAttribute('role', 'region');
        el.setAttribute('aria-label', `Page ${i}`);
        const textLayer = document.createElement('div');
        textLayer.className = 'textLayer pdf-text-layer';
        const overlay = document.createElement('div');
        overlay.className = 'pdf-overlay';
        el.appendChild(textLayer);
        el.appendChild(overlay);
        views.push({
          el, canvas: null, textLayer, overlay, vp1, page,
          rendered: false, rendering: false, wanted: false, attempts: 0,
          renderTask: null, textTask: null, textDone: false, textContent: null,
          annots: null, annotsPromise: null, formsBuilt: false, hasForms: false,
          thumb: null, thumbCanvas: null, thumbDone: false
        });
      }
      pageViews = views;
      const frag = document.createDocumentFragment();
      views.forEach((pv) => frag.appendChild(pv.el));
      scroll.appendChild(frag);
      computeFit();
      applyScale(true);
      observer = new IntersectionObserver(onIntersect, { root: scroll, rootMargin: '1200px 0px' });
      pageViews.forEach((pv) => observer.observe(pv.el));
      buildThumbs();
      renderAnns();
      updateStatus();
      updatePageControls();
    }

    /* ================================================================ */
    /* scale                                                             */
    /* ================================================================ */
    function fitZooms() {
      if (!pageViews.length || !scroll) return { width: 1, page: 1 };
      let maxW = 0, maxH = 0;
      for (const pv of pageViews) {
        if (pv.vp1.width > maxW) maxW = pv.vp1.width;
        if (pv.vp1.height > maxH) maxH = pv.vp1.height;
      }
      const availW = Math.max(120, scroll.clientWidth - 56);
      const availH = Math.max(120, scroll.clientHeight - 40);
      const width = availW / (maxW * PT_TO_CSS);
      const page = Math.min(width, availH / (maxH * PT_TO_CSS));
      return { width, page };
    }
    function computeFit() {
      if (fitMode === 'manual') return;
      const f = fitZooms();
      let z = fitMode === 'page' ? f.page : f.width;
      if (fitMode === 'auto') z = Math.min(f.width, 1.25);
      zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, +z.toFixed(4)));
    }

    function applyScale(initial) {
      cssScale = zoom * PT_TO_CSS;
      for (const pv of pageViews) {
        const w = Math.round(pv.vp1.width * cssScale);
        const h = Math.round(pv.vp1.height * cssScale);
        pv.el.style.width = w + 'px';
        pv.el.style.height = h + 'px';
        pv.el.style.setProperty('--scale-factor', String(cssScale));
        if (pv.renderTask && pv.renderTask.cancel) { try { pv.renderTask.cancel(); } catch {} }
        pv.rendered = false;
        /* A page that failed at one size may well draw at another, so a zoom
           hands back the attempts a previous size used up. */
        pv.attempts = 0;
      }
      if (scroll) scroll.style.setProperty('--scale-factor', String(cssScale));
      if (tb.zoomLabel) tb.zoomLabel.textContent = Math.round(zoom * 100) + '%';
      if (ctx.status) ctx.status.setZoom(zoom, ZOOM_MIN, ZOOM_MAX);
      if (!initial) renderVisible();
      if (findOpen) paintFindHits(false);
      updateStatus();
    }

    function zoomTo(next, clientX, clientY, mode) {
      if (!scroll) return;
      next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, +(+next).toFixed(4)));
      if (!isFinite(next)) return;
      fitMode = mode || 'manual';
      if (next === zoom) { if (tb.zoomLabel) tb.zoomLabel.textContent = Math.round(zoom * 100) + '%'; return; }
      const rect = scroll.getBoundingClientRect();
      const mx = clientX != null ? clientX - rect.left : scroll.clientWidth / 2;
      const my = clientY != null ? clientY - rect.top : scroll.clientHeight / 2;
      const ratio = next / zoom;
      const left = scroll.scrollLeft, top = scroll.scrollTop;
      zoom = next;
      applyScale();
      scroll.scrollLeft = (left + mx) * ratio - mx;
      scroll.scrollTop = (top + my) * ratio - my;
      renderVisible();
    }
    function zoomBy(factor, clientX, clientY) { zoomTo(zoom * factor, clientX, clientY); }
    function setZoomLevel(z) { zoomTo(z); }
    function fitTo(mode) {
      const pageNow = currentPage;
      fitMode = mode;
      computeFit();
      applyScale();
      goToPage(pageNow, 0, true);
    }

    function onCtrlWheel(e) {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX, e.clientY);
    }

    function setupStatusChrome() {
      if (!ctx.status) return;
      ctx.status.setKind('PDF');
      ctx.status.showZoom(true);
      ctx.status.setZoom(zoom, ZOOM_MIN, ZOOM_MAX);
      ctx.status.onZoom((z) => setZoomLevel(z));
    }

    /* ================================================================ */
    /* rendering                                                         */
    /* ================================================================ */
    function onIntersect(entries) {
      for (const en of entries) {
        const i = Number(en.target.dataset.i);
        const pv = pageViews[i];
        if (!pv || pv.el !== en.target) continue;
        if (en.isIntersecting) {
          pv.wanted = true;
          renderPage(i);
        } else {
          pv.wanted = false;
          evictPage(pv);
        }
      }
    }

    function renderVisible() {
      if (!scroll) return;
      const top = scroll.scrollTop - 1200, bottom = scroll.scrollTop + scroll.clientHeight + 1200;
      pageViews.forEach((pv, i) => {
        const inRange = pv.el.offsetTop + pv.el.offsetHeight > top && pv.el.offsetTop < bottom;
        if (inRange) { pv.wanted = true; renderPage(i); }
      });
    }

    /* Far-away pages give their bitmaps back; a long document at a high
       zoom would otherwise hold every page it has ever shown. */
    function evictPage(pv) {
      if (pv.renderTask && pv.renderTask.cancel) { try { pv.renderTask.cancel(); } catch {} }
      if (pv.textTask && pv.textTask.cancel) { try { pv.textTask.cancel(); } catch {} }
      if (pv.canvas) {
        pv.canvas.width = 0;
        pv.canvas.height = 0;
        pv.canvas.remove();
        pv.canvas = null;
      }
      pv.rendered = false;
      if (pv.textDone) {
        pv.textLayer.textContent = '';
        pv.textDone = false;
      }
    }

    /* A render is worth repeating when the zoom moved under it, because the
       canvas it just filled is the wrong size now. A failing page gets a
       small budget and is then left alone, with the reason on the page
       rather than only in the console. */
    const MAX_RENDER_ATTEMPTS = 3;

    function showPageError(pv, message) {
      if (!pv || !pv.el) return;
      let note = pv.el.querySelector('.pdf-page-error');
      if (!message) {
        if (note) note.remove();
        return;
      }
      if (!note) {
        note = document.createElement('div');
        note.className = 'pdf-page-error';
        pv.el.appendChild(note);
      }
      note.textContent = 'This page could not be displayed. ' + message;
    }

    async function ensureAnnots(pv) {
      if (pv.annots) return pv.annots;
      if (!pv.annotsPromise) {
        pv.annotsPromise = (typeof pv.page.getAnnotations === 'function'
          ? pv.page.getAnnotations({ intent: 'display' })
          : Promise.resolve([])).catch(() => []);
      }
      const list = await pv.annotsPromise;
      pv.annots = list || [];
      pv.hasForms = pv.annots.some(isEditableWidget);
      return pv.annots;
    }

    async function renderPage(i) {
      if (destroyed) return;
      const pv = pageViews[i];
      if (!pv || pv.rendered || pv.rendering) return;
      pv.rendering = true;
      let scale = cssScale * dpr();
      const wantScale = scale;
      let stale = false;
      let canvas = null;
      try {
        await ensureAnnots(pv);
        if (destroyed || pageViews[i] !== pv) return;
        let vp = pv.page.getViewport({ scale });
        if (vp.width * vp.height > MAX_CANVAS_PIXELS) {
          scale *= Math.sqrt(MAX_CANVAS_PIXELS / (vp.width * vp.height));
          vp = pv.page.getViewport({ scale });
        }
        canvas = document.createElement('canvas');
        canvas.className = 'pdf-canvas';
        canvas.width = Math.max(1, Math.floor(vp.width));
        canvas.height = Math.max(1, Math.floor(vp.height));
        const params = { canvasContext: canvas.getContext('2d', { alpha: false }), viewport: vp };
        if (pv.hasForms && pdfjsLib.AnnotationMode) params.annotationMode = pdfjsLib.AnnotationMode.ENABLE_FORMS;
        const task = pv.page.render(params);
        pv.renderTask = task;
        await task.promise;
        if (pv.renderTask === task) pv.renderTask = null;
        if (destroyed || pageViews[i] !== pv) { canvas.width = 0; return; }
        stale = wantScale !== cssScale * dpr();
        if (!stale) {
          if (pv.canvas && pv.canvas.parentNode) pv.canvas.replaceWith(canvas);
          else pv.el.insertBefore(canvas, pv.el.firstChild);
          if (pv.canvas && pv.canvas !== canvas) { pv.canvas.width = 0; pv.canvas.height = 0; }
          pv.canvas = canvas;
          canvas = null;
          pv.rendered = true;
          pv.error = null;
          pv.attempts = 0;
          showPageError(pv, null);
          if (!pv.formsBuilt) buildPageExtras(pv);
          renderTextLayer(pv);
        }
      } catch (e) {
        if (destroyed || pageViews[i] !== pv) return;
        if (e && e.name === 'RenderingCancelledException') {
          stale = true;
        } else {
          pv.error = (e && e.message) || String(e);
          pv.attempts = (pv.attempts || 0) + 1;
        }
      } finally {
        pv.rendering = false;
        if (canvas) { canvas.width = 0; canvas.height = 0; }
      }
      if (destroyed || pageViews[i] !== pv || pv.rendered || !pv.wanted) return;
      if (stale || pv.attempts < MAX_RENDER_ATTEMPTS) {
        renderPage(i);
        return;
      }
      showPageError(pv, pv.error || 'The page could not be drawn.');
    }

    async function pageTextContent(pv) {
      if (pv.textContent) return pv.textContent;
      if (typeof pv.page.getTextContent !== 'function') return null;
      pv.textContent = await pv.page.getTextContent();
      return pv.textContent;
    }

    async function renderTextLayer(pv) {
      if (pv.textDone || pv.textBusy || typeof pdfjsLib.renderTextLayer !== 'function') return;
      pv.textBusy = true;
      try {
        const tc = await pageTextContent(pv);
        if (!tc || destroyed || !pv.wanted || pv.textDone) return;
        pv.textLayer.textContent = '';
        const task = pdfjsLib.renderTextLayer({
          textContentSource: tc,
          container: pv.textLayer,
          viewport: pv.page.getViewport({ scale: cssScale }),
          textDivs: []
        });
        pv.textTask = task;
        await task.promise;
        if (pv.textTask === task) pv.textTask = null;
        const end = document.createElement('div');
        end.className = 'endOfContent';
        pv.textLayer.appendChild(end);
        pv.textDone = true;
      } catch {
        /* cancelled or unreadable text: the page still shows */
      } finally {
        pv.textBusy = false;
      }
    }

    /* ================================================================ */
    /* status & navigation                                               */
    /* ================================================================ */
    let statusRaf = 0;
    function scheduleStatus() {
      if (statusRaf) return;
      statusRaf = requestAnimationFrame(() => { statusRaf = 0; updateStatus(); });
    }
    function computeCurrentPage() {
      if (!scroll || !pageViews.length) return 1;
      const mid = scroll.scrollTop + scroll.clientHeight * 0.4;
      let lo = 0, hi = pageViews.length - 1, cur = 0;
      while (lo <= hi) {
        const m = (lo + hi) >> 1;
        if (pageViews[m].el.offsetTop <= mid) { cur = m; lo = m + 1; } else hi = m - 1;
      }
      return cur + 1;
    }
    function statusText() {
      if (!pdf) return '';
      return `Page ${currentPage} of ${pdf.numPages} · ${Math.round(zoom * 100)}%`;
    }
    function pendingCount() {
      return anns.length + (formValues.size ? 1 : 0);
    }
    function updateStatus() {
      if (!pdf || destroyed) return;
      const cur = computeCurrentPage();
      const changed = cur !== currentPage;
      currentPage = cur;
      const pend = pendingCount();
      ctx.setStatus(statusText(), pend ? `PDF · ${pend} unsaved edit${pend === 1 ? '' : 's'}` : 'PDF');
      if (changed) updatePageControls();
    }
    function updatePageControls() {
      if (tb.pageInput && document.activeElement !== tb.pageInput) tb.pageInput.value = String(currentPage);
      if (tb.pageTotal && pdf) tb.pageTotal.textContent = `of ${pdf.numPages}`;
      if (tb.prev) tb.prev.disabled = currentPage <= 1;
      if (tb.next) tb.next.disabled = !pdf || currentPage >= pdf.numPages;
      if (thumbsList) {
        thumbsList.querySelectorAll('.pdf-thumb.current').forEach((t) => t.classList.remove('current'));
        const pv = pageViews[currentPage - 1];
        if (pv && pv.thumb) {
          pv.thumb.classList.add('current');
          const tr = pv.thumb.getBoundingClientRect(), lr = thumbsList.getBoundingClientRect();
          if (tr.top < lr.top || tr.bottom > lr.bottom) pv.thumb.scrollIntoView({ block: 'nearest' });
        }
      }
    }
    function goToPage(n, offsetRatio, instant) {
      const pv = pageViews[Math.max(0, Math.min(pageViews.length - 1, (n | 0) - 1))];
      if (!pv || !scroll) return;
      scroll.scrollTop = Math.max(0, pv.el.offsetTop - 16 + (offsetRatio || 0) * pv.el.offsetHeight);
      if (!instant) renderVisible();
      updateStatus();
      updatePageControls();
    }

    /* ================================================================ */
    /* annotations                                                       */
    /* ================================================================ */
    const newId = () => 'a' + (++annSeq) + Math.random().toString(36).slice(2, 6);
    const findAnn = (id) => anns.find((a) => a.id === id);

    function cloneAnns(list) {
      return list.map((a) => JSON.parse(JSON.stringify(a)));
    }

    function annStyleBox(el, a) {
      el.style.left = (a.xr * 100) + '%';
      el.style.top = (a.yr * 100) + '%';
      el.style.width = (a.wr * 100) + '%';
      el.style.height = (a.hr * 100) + '%';
    }

    function renderAnns() {
      pageViews.forEach((pv) => pv.overlay.querySelectorAll('.pdf-ann').forEach((el) => el.remove()));
      anns.forEach((a) => addAnnEl(a));
      if (selectedId && !findAnn(selectedId)) selectedId = null;
      paintSelection();
    }

    function annEls(id) {
      return scroll ? Array.from(scroll.querySelectorAll(`.pdf-ann[data-ann="${id}"]`)) : [];
    }

    function addAnnEl(a) {
      const pv = pageViews[a.pageIndex];
      if (!pv) return;
      if (a.type === 'highlight') {
        (a.rects || []).forEach((r, k) => {
          const el = document.createElement('div');
          el.className = 'pdf-ann pdf-ann-hl';
          el.dataset.ann = a.id;
          if (k === 0) el.dataset.primary = '1';
          el.style.setProperty('--hl', a.color || HIGHLIGHT_COLORS[0][1]);
          annStyleBox(el, r);
          wireAnn(el, a);
          pv.overlay.appendChild(el);
        });
        return;
      }
      const el = document.createElement('div');
      el.dataset.ann = a.id;
      el.dataset.primary = '1';
      if (a.type === 'image') {
        el.className = 'pdf-ann pdf-ann-image';
        const img = document.createElement('img');
        img.src = a.dataUrl;
        img.draggable = false;
        img.alt = a.kind === 'signature' ? 'Signature' : 'Image';
        el.appendChild(img);
        annStyleBox(el, a);
        el.appendChild(handleEl());
      } else if (a.type === 'text') {
        el.className = 'pdf-ann pdf-ann-text';
        const body = document.createElement('div');
        body.className = 'pdf-ann-text-body';
        body.textContent = a.text || '';
        body.style.color = a.color || INK_COLORS[0][1];
        body.style.fontSize = `calc(var(--scale-factor) * ${a.size || 14}px)`;
        el.appendChild(body);
        el.style.left = (a.xr * 100) + '%';
        el.style.top = (a.yr * 100) + '%';
        el.style.width = (a.wr * 100) + '%';
        el.style.minHeight = (a.hr * 100) + '%';
        el.appendChild(handleEl());
        el.addEventListener('dblclick', (e) => { e.stopPropagation(); startTextEdit(a.id); });
      } else if (a.type === 'note') {
        el.className = 'pdf-ann pdf-ann-note';
        el.style.left = (a.xr * 100) + '%';
        el.style.top = (a.yr * 100) + '%';
        el.style.setProperty('--note', a.color || '#ffd60a');
        el.innerHTML = ICONS.note;
        el.title = a.text || 'Note';
        el.addEventListener('dblclick', (e) => { e.stopPropagation(); openNoteEditor(a.id); });
      } else {
        return;
      }
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'pdf-ann-del';
      del.title = 'Delete (Del)';
      del.setAttribute('aria-label', 'Delete annotation');
      del.innerHTML = ICONS.close;
      del.addEventListener('pointerdown', (e) => e.stopPropagation());
      del.addEventListener('click', (e) => { e.stopPropagation(); deleteAnn(a.id); });
      el.appendChild(del);
      wireAnn(el, a);
      pv.overlay.appendChild(el);
    }

    function handleEl() {
      const h = document.createElement('div');
      h.className = 'pdf-ann-handle';
      h.title = 'Resize';
      return h;
    }

    function wireAnn(el, a) {
      let drag = null;
      el.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        if (editingId === a.id && e.target.closest('.pdf-ann-text-body')) return;
        e.stopPropagation();
        e.preventDefault();
        if (editingId && editingId !== a.id) stopTextEdit();
        selectAnn(a.id);
        scroll.focus({ preventScroll: true });
        const pv = pageViews[a.pageIndex];
        if (!pv) return;
        const resize = !!e.target.closest('.pdf-ann-handle');
        const box = a.type === 'highlight' ? null : { xr: a.xr, yr: a.yr, wr: a.wr, hr: a.hr };
        drag = {
          sx: e.clientX, sy: e.clientY, resize, box, moved: false,
          rects: a.type === 'highlight' ? a.rects.map((r) => ({ ...r })) : null,
          pw: Math.max(1, pv.el.clientWidth), ph: Math.max(1, pv.el.clientHeight)
        };
        el.setPointerCapture(e.pointerId);
      });
      el.addEventListener('pointermove', (e) => {
        if (!drag) return;
        const dx = (e.clientX - drag.sx) / drag.pw;
        const dy = (e.clientY - drag.sy) / drag.ph;
        if (!drag.moved && Math.abs(e.clientX - drag.sx) + Math.abs(e.clientY - drag.sy) < 3) return;
        drag.moved = true;
        if (a.type === 'highlight') {
          const minX = Math.min(...drag.rects.map((r) => r.xr)), maxX = Math.max(...drag.rects.map((r) => r.xr + r.wr));
          const minY = Math.min(...drag.rects.map((r) => r.yr)), maxY = Math.max(...drag.rects.map((r) => r.yr + r.hr));
          const cdx = Math.max(-minX, Math.min(1 - maxX, dx));
          const cdy = Math.max(-minY, Math.min(1 - maxY, dy));
          a.rects = drag.rects.map((r) => ({ ...r, xr: r.xr + cdx, yr: r.yr + cdy }));
          annEls(a.id).forEach((node, k) => annStyleBox(node, a.rects[k]));
          return;
        }
        if (drag.resize) {
          if (a.type === 'image') {
            const f = Math.max(0.1, (drag.box.wr + dx) / drag.box.wr);
            let wr = drag.box.wr * f, hr = drag.box.hr * f;
            const k = Math.min(1, (1 - a.xr) / wr, (1 - a.yr) / hr);
            a.wr = wr * k; a.hr = hr * k;
          } else if (a.type === 'text') {
            a.wr = Math.max(0.04, Math.min(1 - a.xr, drag.box.wr + dx));
          }
        } else {
          const w = a.type === 'note' ? noteSizeRatio(a).w : a.wr;
          const h = a.type === 'note' ? noteSizeRatio(a).h : a.hr;
          a.xr = Math.max(0, Math.min(1 - w, drag.box.xr + dx));
          a.yr = Math.max(0, Math.min(1 - h, drag.box.yr + dy));
        }
        positionAnnEl(a);
      });
      const end = () => {
        if (!drag) return;
        const moved = drag.moved;
        drag = null;
        if (moved) {
          if (a.type === 'text') fitTextHeight(a);
          commit();
        } else if (a.type === 'note') {
          openNoteEditor(a.id);
        }
      };
      el.addEventListener('pointerup', end);
      el.addEventListener('pointercancel', end);
    }

    function noteSizeRatio(a) {
      const pv = pageViews[a.pageIndex];
      const side = 22;
      if (!pv) return { w: 0.04, h: 0.03 };
      return { w: side / pv.vp1.width, h: side / pv.vp1.height };
    }

    function positionAnnEl(a) {
      const els = annEls(a.id);
      if (!els.length) return;
      const el = els[0];
      if (a.type === 'image') annStyleBox(el, a);
      else if (a.type === 'text') {
        el.style.left = (a.xr * 100) + '%';
        el.style.top = (a.yr * 100) + '%';
        el.style.width = (a.wr * 100) + '%';
        el.style.minHeight = (a.hr * 100) + '%';
      } else if (a.type === 'note') {
        el.style.left = (a.xr * 100) + '%';
        el.style.top = (a.yr * 100) + '%';
      }
    }

    /* A text box grows with its words; the stored height is what the page
       will get when the text is burned in. */
    function fitTextHeight(a) {
      const el = annEls(a.id)[0];
      const pv = pageViews[a.pageIndex];
      if (!el || !pv) return;
      const body = el.querySelector('.pdf-ann-text-body');
      const h = body ? body.offsetHeight : el.offsetHeight;
      const ph = Math.max(1, pv.el.clientHeight);
      a.hr = Math.min(1 - a.yr, Math.max(0.01, h / ph));
    }

    function selectAnn(id) {
      if (selectedId === id) return;
      selectedId = id;
      paintSelection();
    }
    function paintSelection() {
      if (!scroll) return;
      scroll.querySelectorAll('.pdf-ann.selected').forEach((el) => el.classList.remove('selected'));
      if (selectedId) annEls(selectedId).forEach((el) => el.classList.add('selected'));
      updateStyleButton();
    }
    function deselect() {
      if (editingId) stopTextEdit();
      if (!selectedId) return;
      selectedId = null;
      paintSelection();
    }

    function addAnn(a, opts) {
      a.id = a.id || newId();
      anns.push(a);
      addAnnEl(a);
      if (!(opts && opts.silent)) {
        selectAnn(a.id);
        commit();
      }
      return a;
    }

    function deleteAnn(id) {
      const before = anns.length;
      anns = anns.filter((x) => x.id !== id);
      if (anns.length === before) return;
      annEls(id).forEach((el) => el.remove());
      if (selectedId === id) selectedId = null;
      if (editingId === id) editingId = null;
      closeNoteEditor();
      commit();
    }

    function startTextEdit(id) {
      const a = findAnn(id);
      if (!a || a.type !== 'text') return;
      if (editingId && editingId !== id) stopTextEdit();
      editingId = id;
      selectAnn(id);
      const el = annEls(id)[0];
      if (!el) return;
      el.classList.add('editing');
      const body = el.querySelector('.pdf-ann-text-body');
      try { body.contentEditable = 'plaintext-only'; } catch { body.contentEditable = 'true'; }
      if (body.contentEditable !== 'plaintext-only') body.contentEditable = 'true';
      body.focus();
      const range = document.createRange();
      range.selectNodeContents(body);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      body.oninput = () => { a.text = body.innerText.replace(/\n$/, ''); fitTextHeight(a); };
      body.onblur = () => { if (editingId === id) stopTextEdit(); };
      body.onkeydown = (e) => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); stopTextEdit(); scroll.focus({ preventScroll: true }); }
        e.stopPropagation();
      };
    }
    function stopTextEdit() {
      const id = editingId;
      if (!id) return;
      editingId = null;
      const a = findAnn(id);
      const el = annEls(id)[0];
      if (el) {
        el.classList.remove('editing');
        const body = el.querySelector('.pdf-ann-text-body');
        if (body) {
          body.contentEditable = 'false';
          body.oninput = body.onblur = body.onkeydown = null;
          if (a) a.text = body.innerText.replace(/\n$/, '');
        }
      }
      if (!a) return;
      if (!String(a.text || '').trim()) {
        anns = anns.filter((x) => x.id !== id);
        if (el) el.remove();
        if (selectedId === id) selectedId = null;
        const known = hist[histIndex] && hist[histIndex].anns.some((x) => x.id === id);
        if (known) commit();
        return;
      }
      fitTextHeight(a);
      const prev = hist[histIndex] && hist[histIndex].anns.find((x) => x.id === id);
      if (!prev || prev.text !== a.text || prev.hr !== a.hr || prev.wr !== a.wr) commit();
    }

    /* note editor popover */
    let noteEditor = null;
    function closeNoteEditor() {
      if (!noteEditor) return;
      const ne = noteEditor;
      noteEditor = null;
      ne.el.remove();
      const a = findAnn(ne.id);
      if (a && ne.textarea.value !== ne.initial) {
        a.text = ne.textarea.value;
        const el = annEls(a.id)[0];
        if (el) el.title = a.text || 'Note';
        commit();
      }
    }
    function openNoteEditor(id) {
      closeNoteEditor();
      const a = findAnn(id);
      if (!a) return;
      const pv = pageViews[a.pageIndex];
      const noteEl = annEls(id)[0];
      if (!pv || !noteEl) return;
      const el = document.createElement('div');
      el.className = 'pdf-note-editor';
      el.innerHTML = `<div class="pdf-note-head"><span>Note</span><button type="button" class="icon-btn" title="Delete note" aria-label="Delete note">${ICONS.trash}</button></div><textarea rows="4" placeholder="Write a note…" aria-label="Note text"></textarea>`;
      const ta = el.querySelector('textarea');
      ta.value = a.text || '';
      el.querySelector('button').addEventListener('click', () => { const nid = a.id; noteEditor = null; el.remove(); deleteAnn(nid); });
      ta.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) { e.preventDefault(); closeNoteEditor(); scroll.focus({ preventScroll: true }); }
      });
      el.addEventListener('pointerdown', (e) => e.stopPropagation());
      pv.overlay.appendChild(el);
      el.style.left = `min(calc(${a.xr * 100}% + calc(var(--scale-factor) * 26px)), calc(100% - 230px))`;
      el.style.top = (a.yr * 100) + '%';
      noteEditor = { id, el, textarea: ta, initial: ta.value };
      setTimeout(() => ta.focus(), 20);
    }

    /* ---------------- placing ---------------- */
    function pagePointFromEvent(e) {
      const pageEl = e.target.closest && e.target.closest('.pdf-page');
      if (!pageEl) return null;
      const i = Number(pageEl.dataset.i);
      const r = pageEl.getBoundingClientRect();
      return { pageIndex: i, x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height, rect: r };
    }

    function placeAt(pt) {
      const pv = pageViews[pt.pageIndex];
      if (!pv) return;
      const W = pv.vp1.width, H = pv.vp1.height;
      if (tool === 'text') {
        const wr = Math.min(0.5, 220 / W);
        const hr = (textSize * 1.25 + 8) / H;
        const a = addAnn({
          type: 'text', pageIndex: pt.pageIndex,
          xr: Math.max(0, Math.min(1 - wr, pt.x)), yr: Math.max(0, Math.min(1 - hr, pt.y - hr / 2)),
          wr, hr, text: '', size: textSize, color: inkColor
        }, { silent: true });
        selectAnn(a.id);
        setTool('select');
        startTextEdit(a.id);
      } else if (tool === 'note') {
        const n = { w: 22 / W, h: 22 / H };
        const a = addAnn({
          type: 'note', pageIndex: pt.pageIndex,
          xr: Math.max(0, Math.min(1 - n.w, pt.x - n.w / 2)), yr: Math.max(0, Math.min(1 - n.h, pt.y - n.h / 2)),
          text: '', color: hlColor
        });
        setTool('select');
        openNoteEditor(a.id);
      } else if (tool === 'place' && pendingImage) {
        const img = pendingImage;
        const aspect = img.h / Math.max(1, img.w);
        let wPt = Math.min(img.kind === 'signature' ? 180 : 240, W * 0.6, img.w * 0.75);
        let hPt = wPt * aspect;
        if (hPt > H * 0.6) { hPt = H * 0.6; wPt = hPt / aspect; }
        const wr = wPt / W, hr = hPt / H;
        addAnn({
          type: 'image', kind: img.kind, pageIndex: pt.pageIndex,
          xr: Math.max(0, Math.min(1 - wr, pt.x - wr / 2)), yr: Math.max(0, Math.min(1 - hr, pt.y - hr / 2)),
          wr, hr, dataUrl: img.dataUrl
        });
        pendingImage = null;
        setTool('select');
        ctx.toast(img.kind === 'signature' ? 'Signature added — it is written into the file when you save' : 'Image added — it is written into the file when you save');
      }
    }

    /* rectangle highlight for scans and pictures (no text to select) */
    let rectDrag = null;
    function startRectHighlight(e, pt) {
      const pv = pageViews[pt.pageIndex];
      const box = document.createElement('div');
      box.className = 'pdf-ann-hl pdf-rect-preview';
      box.style.setProperty('--hl', hlColor);
      pv.overlay.appendChild(box);
      rectDrag = { pv, pt, box, pointerId: e.pointerId };
      scroll.setPointerCapture(e.pointerId);
      e.preventDefault();
    }
    function moveRectHighlight(e) {
      if (!rectDrag) return;
      const r = rectDrag.pt.rect;
      const x = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
      const y = Math.max(0, Math.min(1, (e.clientY - r.top) / r.height));
      const box = { xr: Math.min(x, rectDrag.pt.x), yr: Math.min(y, rectDrag.pt.y), wr: Math.abs(x - rectDrag.pt.x), hr: Math.abs(y - rectDrag.pt.y) };
      rectDrag.cur = box;
      annStyleBox(rectDrag.box, box);
    }
    function endRectHighlight() {
      if (!rectDrag) return;
      const d = rectDrag;
      rectDrag = null;
      d.box.remove();
      const b = d.cur;
      if (!b || b.wr * d.pt.rect.width < 4 || b.hr * d.pt.rect.height < 4) return;
      addAnn({ type: 'highlight', pageIndex: d.pv.el.dataset.i | 0, rects: [b], color: hlColor });
    }

    /* text selection → highlight rectangles per page */
    function selectionRects() {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount) return [];
      const range = sel.getRangeAt(0);
      if (!scroll.contains(range.commonAncestorContainer)) return [];
      const byPage = new Map();
      const rects = Array.from(range.getClientRects());
      for (const r of rects) {
        if (r.width < 1 || r.height < 1) continue;
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        const pv = pageViews.find((p) => {
          const pr = p.el.getBoundingClientRect();
          return cx >= pr.left && cx <= pr.right && cy >= pr.top && cy <= pr.bottom;
        });
        if (!pv) continue;
        const pr = pv.el.getBoundingClientRect();
        const box = { xr: (r.left - pr.left) / pr.width, yr: (r.top - pr.top) / pr.height, wr: r.width / pr.width, hr: r.height / pr.height };
        const i = Number(pv.el.dataset.i);
        if (!byPage.has(i)) byPage.set(i, []);
        byPage.get(i).push(box);
      }
      /* merge pieces of the same line so one highlight is one band */
      const out = [];
      byPage.forEach((list, pageIndex) => {
        list.sort((a, b) => a.yr - b.yr || a.xr - b.xr);
        const merged = [];
        for (const b of list) {
          const last = merged[merged.length - 1];
          const sameLine = last && Math.abs((last.yr + last.hr / 2) - (b.yr + b.hr / 2)) < Math.min(last.hr, b.hr) * 0.5;
          if (sameLine && b.xr <= last.xr + last.wr + 0.01) {
            const x1 = Math.min(last.xr, b.xr), x2 = Math.max(last.xr + last.wr, b.xr + b.wr);
            const y1 = Math.min(last.yr, b.yr), y2 = Math.max(last.yr + last.hr, b.yr + b.hr);
            Object.assign(last, { xr: x1, yr: y1, wr: x2 - x1, hr: y2 - y1 });
          } else if (!merged.some((m) => b.xr >= m.xr - 0.001 && b.xr + b.wr <= m.xr + m.wr + 0.001 && b.yr >= m.yr - 0.001 && b.yr + b.hr <= m.yr + m.hr + 0.001)) {
            merged.push({ ...b });
          }
        }
        out.push({ pageIndex, rects: merged });
      });
      return out;
    }
    function highlightSelection() {
      const groups = selectionRects();
      if (!groups.length) return false;
      groups.forEach((g, k) => {
        const a = addAnn({ type: 'highlight', pageIndex: g.pageIndex, rects: g.rects, color: hlColor }, { silent: true });
        if (k === groups.length - 1) selectAnn(a.id);
      });
      commit();
      window.getSelection().removeAllRanges();
      hideBubble();
      return true;
    }

    function hideBubble() {
      if (bubble) { bubble.remove(); bubble = null; }
    }
    function showBubble() {
      hideBubble();
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount || !scroll.contains(sel.anchorNode)) return;
      const text = sel.toString();
      if (!text.trim()) return;
      const r = sel.getRangeAt(0).getBoundingClientRect();
      bubble = document.createElement('div');
      bubble.className = 'pdf-sel-bubble';
      bubble.innerHTML =
        `<button type="button" class="pdf-bubble-hl" title="Highlight (H)">${ICONS.highlighter}<span>Highlight</span></button>` +
        `<button type="button" class="pdf-bubble-copy" title="Copy (Ctrl+C)">${ICONS.copy}<span>Copy</span></button>`;
      bubble.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); });
      bubble.querySelector('.pdf-bubble-hl').addEventListener('click', () => highlightSelection());
      bubble.querySelector('.pdf-bubble-copy').addEventListener('click', () => {
        navigator.clipboard.writeText(text).then(() => ctx.toast('Copied'), () => ctx.toast('Copy failed', 'error'));
        hideBubble();
      });
      document.body.appendChild(bubble);
      const bw = bubble.offsetWidth, bh = bubble.offsetHeight;
      let top = r.top - bh - 8;
      if (top < 60) top = r.bottom + 8;
      bubble.style.left = Math.max(8, Math.min(window.innerWidth - bw - 8, r.left + r.width / 2 - bw / 2)) + 'px';
      bubble.style.top = top + 'px';
    }

    function onScrollPointerDown(e) {
      if (e.button !== 0) return;
      hideBubble();
      if (e.target.closest('.pdf-note-editor, .pdf-form-field, .pdf-link')) return;
      if (noteEditor) closeNoteEditor();
      const pt = pagePointFromEvent(e);
      if (tool === 'text' || tool === 'note' || tool === 'place') {
        if (pt) { e.preventDefault(); placeAt(pt); }
        return;
      }
      if (!e.target.closest('.pdf-ann')) deselect();
      if (tool === 'highlight' && pt && !(e.target.tagName === 'SPAN' && e.target.closest('.textLayer'))) {
        startRectHighlight(e, pt);
      }
      const tl = e.target.closest && e.target.closest('.textLayer');
      if (tl) {
        const end = tl.querySelector('.endOfContent');
        if (end) end.classList.add('active');
      }
    }
    function onScrollPointerUp() {
      scroll.querySelectorAll('.endOfContent.active').forEach((el) => el.classList.remove('active'));
      if (rectDrag) { endRectHighlight(); return; }
      setTimeout(() => {
        if (destroyed) return;
        if (tool === 'highlight') { highlightSelection(); return; }
        if (tool === 'select') showBubble();
      }, 0);
    }

    function setTool(t) {
      if (t !== 'place') pendingImage = null;
      tool = t;
      if (scroll) {
        scroll.classList.remove('tool-select', 'tool-highlight', 'tool-text', 'tool-note', 'tool-place');
        scroll.classList.add('tool-' + t);
      }
      Object.entries(tb.tools || {}).forEach(([k, b]) => {
        const on = k === t || (t === 'place' && k === (pendingImage && pendingImage.kind === 'signature' ? 'sign' : 'stamp'));
        b.classList.toggle('active', on);
        b.setAttribute('aria-pressed', String(on));
      });
      updateStyleButton();
      if (t === 'highlight' && selectionRects().length) highlightSelection();
    }

    /* ---------------- signature & image stamps ---------------- */
    function signaturePad() {
      const wrapEl = document.createElement('div');
      wrapEl.innerHTML = `<div class="sig-pad-hint">Draw your signature below</div>`;
      const canvas = document.createElement('canvas');
      canvas.className = 'sig-pad';
      canvas.width = 880; canvas.height = 340;
      wrapEl.appendChild(canvas);
      const row = document.createElement('div');
      row.className = 'sig-pad-row';
      const clearBtn = document.createElement('button');
      clearBtn.type = 'button';
      clearBtn.className = 'btn ghost sig-clear';
      clearBtn.textContent = 'Clear';
      row.appendChild(clearBtn);
      const swatches = document.createElement('div');
      swatches.className = 'sig-colors';
      let ink = '#1c1c30';
      [['Black', '#1c1c30'], ['Blue', '#1f4fc1']].forEach(([name, c], k) => {
        const s = document.createElement('button');
        s.type = 'button';
        s.className = 'pdf-swatch' + (k === 0 ? ' active' : '');
        s.title = name;
        s.setAttribute('aria-label', name + ' ink');
        s.style.setProperty('--sw', c);
        s.addEventListener('click', () => {
          ink = c;
          x.strokeStyle = c;
          swatches.querySelectorAll('.pdf-swatch').forEach((b) => b.classList.toggle('active', b === s));
        });
        swatches.appendChild(s);
      });
      row.appendChild(swatches);
      wrapEl.appendChild(row);

      const x = canvas.getContext('2d');
      x.lineWidth = 4.2; x.lineCap = 'round'; x.lineJoin = 'round'; x.strokeStyle = ink;
      let drawing = false, last = null, inked = false;
      const pos = (e) => {
        const r = canvas.getBoundingClientRect();
        return { x: (e.clientX - r.left) * (canvas.width / r.width), y: (e.clientY - r.top) * (canvas.height / r.height) };
      };
      canvas.addEventListener('pointerdown', (e) => {
        drawing = true; inked = true; last = pos(e);
        canvas.setPointerCapture(e.pointerId);
        x.beginPath(); x.arc(last.x, last.y, x.lineWidth / 2, 0, Math.PI * 2); x.fillStyle = x.strokeStyle; x.fill();
      });
      canvas.addEventListener('pointermove', (e) => {
        if (!drawing) return;
        const p = pos(e);
        x.beginPath();
        x.moveTo(last.x, last.y);
        x.quadraticCurveTo(last.x, last.y, (last.x + p.x) / 2, (last.y + p.y) / 2);
        x.lineTo(p.x, p.y);
        x.stroke();
        last = p;
      });
      const stop = () => { drawing = false; };
      canvas.addEventListener('pointerup', stop);
      canvas.addEventListener('pointercancel', stop);
      clearBtn.addEventListener('click', () => { x.clearRect(0, 0, canvas.width, canvas.height); inked = false; });

      return {
        el: wrapEl,
        result: () => {
          if (!inked) return null;
          const d = x.getImageData(0, 0, canvas.width, canvas.height).data;
          let minX = canvas.width, minY = canvas.height, maxX = 0, maxY = 0;
          for (let yy = 0; yy < canvas.height; yy++) {
            for (let xx = 0; xx < canvas.width; xx++) {
              if (d[(yy * canvas.width + xx) * 4 + 3] > 10) {
                if (xx < minX) minX = xx;
                if (xx > maxX) maxX = xx;
                if (yy < minY) minY = yy;
                if (yy > maxY) maxY = yy;
              }
            }
          }
          if (maxX <= minX || maxY <= minY) return null;
          const pad = 8, w = maxX - minX + pad * 2, h = maxY - minY + pad * 2;
          const out = document.createElement('canvas');
          out.width = w; out.height = h;
          out.getContext('2d').drawImage(canvas, minX - pad, minY - pad, w, h, 0, 0, w, h);
          return { dataUrl: out.toDataURL('image/png'), w, h };
        }
      };
    }

    async function startSignFlow() {
      if (!pdf) return;
      const pad = signaturePad();
      const res = await ctx.openModal('Add signature', pad.el, [
        { label: 'Cancel', value: null },
        { label: 'Place on page', primary: true, value: () => pad.result() }
      ]);
      if (destroyed || !res) return;
      pendingImage = { kind: 'signature', dataUrl: res.dataUrl, w: res.w / 2, h: res.h / 2 };
      setTool('place');
      ctx.toast('Click on the page where the signature should go');
    }

    async function startStampFlow() {
      if (!pdf) return;
      const files = await pickFile('image/png,image/jpeg,image/webp,image/gif,image/bmp,image/svg+xml');
      if (destroyed || !files) return;
      try {
        const raw = await readFile(files[0], 'dataUrl');
        const img = await normaliseImage(String(raw));
        pendingImage = { kind: 'image', dataUrl: img.dataUrl, w: img.w, h: img.h };
        setTool('place');
        ctx.toast('Click on the page where the image should go');
      } catch (err) {
        ctx.toast((err && err.message) || 'That picture could not be used', 'error');
      }
    }

    /* ================================================================ */
    /* forms, links and existing notes                                   */
    /* ================================================================ */
    function isEditableWidget(a) {
      if (!a || a.annotationType !== 20 || a.hidden) return false;
      if (a.fieldType === 'Tx') return true;
      if (a.fieldType === 'Ch') return true;
      if (a.fieldType === 'Btn') return !!(a.checkBox || a.radioButton);
      return false;
    }
    function viewRect(pv, rect) {
      const r = pv.vp1.convertToViewportRectangle(rect);
      const x1 = Math.min(r[0], r[2]), x2 = Math.max(r[0], r[2]);
      const y1 = Math.min(r[1], r[3]), y2 = Math.max(r[1], r[3]);
      return { xr: x1 / pv.vp1.width, yr: y1 / pv.vp1.height, wr: (x2 - x1) / pv.vp1.width, hr: (y2 - y1) / pv.vp1.height, hPt: y2 - y1 };
    }
    function currentFormValue(a) {
      if (formValues.has(a.fieldName)) return formValues.get(a.fieldName);
      return a.fieldValue;
    }
    /* Typing marks the tab unsaved at once but lands in history when the
       field is left, so one undo takes back one field, not one letter. */
    function setFormValue(name, value, sourceEl, typing) {
      formValues.set(name, value);
      (formEls.get(name) || []).forEach((el) => {
        if (el === sourceEl) return;
        if (el.type === 'checkbox') el.checked = value !== 'Off' && value === el.dataset.on;
        else if (el.type === 'radio') el.checked = value === el.dataset.on;
        else el.value = value;
      });
      if (typing) { ctx.markDirty(); updateStatus(); }
      else commit();
    }

    function buildPageExtras(pv) {
      pv.formsBuilt = true;
      const list = pv.annots || [];
      for (const a of list) {
        try {
          if (a.annotationType === 2 && (a.url || a.dest)) addLinkEl(pv, a);
          else if (a.annotationType === 1 && a.contentsObj && a.contentsObj.str) addExistingNoteEl(pv, a);
          else if (isEditableWidget(a)) addFormEl(pv, a);
        } catch { /* odd annotation: skip it, keep the page */ }
      }
    }

    function addLinkEl(pv, a) {
      const r = viewRect(pv, a.rect);
      const el = document.createElement('a');
      el.className = 'pdf-link';
      el.href = '#';
      el.title = a.url || 'Go to destination';
      annStyleBox(el, r);
      el.addEventListener('click', async (e) => {
        e.preventDefault();
        if (tool !== 'select') return;
        if (a.url) {
          if (/^(https?:|mailto:)/i.test(a.url)) window.margo.openExternal(a.url);
          return;
        }
        try {
          const dest = typeof a.dest === 'string' ? await pdf.getDestination(a.dest) : a.dest;
          if (!dest || !dest[0]) return;
          const idx = typeof dest[0] === 'object' ? await pdf.getPageIndex(dest[0]) : Number(dest[0]);
          if (Number.isFinite(idx)) goToPage(idx + 1);
        } catch {}
      });
      pv.overlay.appendChild(el);
    }

    function addExistingNoteEl(pv, a) {
      const r = viewRect(pv, a.rect);
      const el = document.createElement('div');
      el.className = 'pdf-existing-note';
      el.title = a.contentsObj.str;
      el.setAttribute('aria-label', 'Note: ' + a.contentsObj.str);
      annStyleBox(el, r);
      pv.overlay.appendChild(el);
    }

    function addFormEl(pv, a) {
      const r = viewRect(pv, a.rect);
      const name = a.fieldName;
      if (!name) return;
      let el;
      const value = currentFormValue(a);
      if (a.fieldType === 'Tx') {
        el = document.createElement(a.multiLine ? 'textarea' : 'input');
        if (!a.multiLine) el.type = a.password ? 'password' : 'text';
        el.value = value == null ? '' : String(value);
        if (a.maxLen) el.maxLength = a.maxLen;
        el.addEventListener('input', () => setFormValue(name, el.value, el, true));
        el.addEventListener('change', () => commit());
      } else if (a.fieldType === 'Btn' && a.checkBox) {
        el = document.createElement('input');
        el.type = 'checkbox';
        el.dataset.on = a.exportValue || 'Yes';
        el.checked = value != null && value !== 'Off' && value === el.dataset.on;
        el.addEventListener('change', () => setFormValue(name, el.checked ? el.dataset.on : 'Off', el));
      } else if (a.fieldType === 'Btn' && a.radioButton) {
        el = document.createElement('input');
        el.type = 'radio';
        el.name = 'pdf-radio-' + name;
        el.dataset.on = a.buttonValue;
        el.checked = value != null && value === a.buttonValue;
        el.addEventListener('change', () => { if (el.checked) setFormValue(name, a.buttonValue, el); });
      } else if (a.fieldType === 'Ch') {
        el = document.createElement('select');
        (a.options || []).forEach((o) => {
          const opt = document.createElement('option');
          opt.value = o.exportValue != null ? o.exportValue : o.displayValue;
          opt.textContent = o.displayValue != null ? o.displayValue : o.exportValue;
          el.appendChild(opt);
        });
        const v = Array.isArray(value) ? value[0] : value;
        if (v != null) el.value = String(v);
        if (!a.combo) el.size = Math.max(2, Math.min((a.options || []).length, Math.floor(r.hPt / 12)));
        el.addEventListener('change', () => setFormValue(name, el.value, el));
      } else {
        return;
      }
      el.classList.add('pdf-form-field');
      el._orig = a.fieldValue;
      el.dataset.field = name;
      el.title = a.alternativeText || name;
      if (a.readOnly) el.disabled = true;
      annStyleBox(el, r);
      const fs = a.textSize && a.textSize > 0 ? a.textSize : Math.max(7, Math.min(12, r.hPt * 0.62));
      el.style.fontSize = `calc(var(--scale-factor) * ${fs}px)`;
      el.addEventListener('pointerdown', (e) => e.stopPropagation());
      el.addEventListener('keydown', (e) => e.stopPropagation());
      if (!formEls.has(name)) formEls.set(name, []);
      formEls.get(name).push(el);
      pv.overlay.appendChild(el);
    }

    /* ================================================================ */
    /* history                                                           */
    /* ================================================================ */
    function snapshot() {
      return { bytes, bytesChanged, anns: cloneAnns(anns), form: Array.from(formValues.entries()) };
    }
    function seedHistory() {
      hist = [snapshot()];
      histIndex = 0;
    }
    function commit(opts) {
      hist = hist.slice(0, histIndex + 1);
      hist.push(snapshot());
      if (hist.length > HIST_LIMIT) hist.shift();
      histIndex = hist.length - 1;
      if (!(opts && opts.clean)) ctx.markDirty();
      updateStatus();
      updateHistoryButtons();
    }
    async function restoreSnapshot(s) {
      if (editingId) { const id = editingId; editingId = null; const el = annEls(id)[0]; if (el) el.classList.remove('editing'); }
      closeNoteEditor();
      hideBubble();
      const sameBytes = s.bytes === bytes;
      anns = cloneAnns(s.anns);
      formValues = new Map(s.form);
      bytesChanged = s.bytesChanged;
      selectedId = null;
      if (!sameBytes) {
        bytes = s.bytes;
        formEls = new Map();
        await loadDocument(bytes, { keepPage: currentPage });
      } else {
        renderAnns();
        formEls.forEach((els, name) => els.forEach((el) => {
          let v = formValues.has(name) ? formValues.get(name) : el._orig;
          if (Array.isArray(v)) v = v[0];
          if (el.type === 'checkbox') el.checked = v != null && v !== 'Off' && v === el.dataset.on;
          else if (el.type === 'radio') el.checked = v != null && v === el.dataset.on;
          else el.value = v == null ? '' : String(v);
        }));
      }
      ctx.markDirty();
      updateStatus();
      updateHistoryButtons();
    }
    let historyBusy = false;
    async function undo() {
      if (historyBusy || histIndex <= 0) return;
      if (editingId) stopTextEdit();
      historyBusy = true;
      try { histIndex--; await restoreSnapshot(hist[histIndex]); } finally { historyBusy = false; }
    }
    async function redo() {
      if (historyBusy || histIndex >= hist.length - 1) return;
      historyBusy = true;
      try { histIndex++; await restoreSnapshot(hist[histIndex]); } finally { historyBusy = false; }
    }
    function updateHistoryButtons() {
      if (tb.undo) tb.undo.disabled = histIndex <= 0;
      if (tb.redo) tb.redo.disabled = histIndex >= hist.length - 1;
    }

    /* ================================================================ */
    /* page operations                                                   */
    /* ================================================================ */
    let opBusy = false;
    async function loadForEdit() {
      const doc = await PDFLib.PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
      if (doc.isEncrypted) {
        const err = new Error('This PDF is password-protected, so its pages cannot be changed.');
        err.userFacing = true;
        throw err;
      }
      return doc;
    }

    /* Runs a pdf-lib edit on the current bytes, then reloads the view.
       remap(ann) returns the annotation's new state, or null to drop it. */
    async function mutate(fn, remap, opts) {
      if (opBusy || !pdf) return false;
      if (editingId) stopTextEdit();
      closeNoteEditor();
      opBusy = true;
      scroll.classList.add('busy');
      try {
        const doc = await loadForEdit();
        const result = await fn(doc);
        if (result === false) return false;
        const out = await doc.save({ updateFieldAppearances: false });
        if (destroyed) return false;
        if (remap) anns = anns.map(remap).filter(Boolean);
        bytes = out;
        bytesChanged = true;
        selectedId = null;
        formEls = new Map();
        const keep = opts && opts.keepPage != null ? opts.keepPage : currentPage;
        await loadDocument(bytes, { keepPage: keep });
        commit();
        return true;
      } catch (err) {
        ctx.toast((err && err.userFacing && err.message) || ('Could not change the pages: ' + ((err && err.message) || err)), 'error');
        return false;
      } finally {
        opBusy = false;
        if (scroll) scroll.classList.remove('busy');
      }
    }

    /* Clockwise quarter turns move a point (x, y) on a W×H page to
       (H - y, x) on the H×W page; highlights follow the text exactly,
       everything else keeps its size and stays upright. */
    function rotateAnn(a, pageIndex, dir, W, H) {
      if (a.pageIndex !== pageIndex) return a;
      const b = JSON.parse(JSON.stringify(a));
      const rot = (r) => {
        const x = r.xr * W, y = r.yr * H, w = r.wr * W, h = r.hr * H;
        const nx = dir > 0 ? H - (y + h) : y;
        const ny = dir > 0 ? x : W - (x + w);
        return { xr: nx / H, yr: ny / W, wr: h / H, hr: w / W };
      };
      if (b.type === 'highlight') {
        b.rects = b.rects.map(rot);
        return b;
      }
      const w = (b.wr || 22 / W) * W, h = (b.hr || 22 / H) * H;
      const c = rot({ xr: b.xr + (b.wr || 22 / W) / 2, yr: b.yr + (b.hr || 22 / H) / 2, wr: 0, hr: 0 });
      const cx = c.xr * H, cy = c.yr * W;
      b.xr = Math.max(0, Math.min(1 - w / H, (cx - w / 2) / H));
      b.yr = Math.max(0, Math.min(1 - h / W, (cy - h / 2) / W));
      if (b.wr != null) b.wr = Math.min(1, w / H);
      if (b.hr != null) b.hr = Math.min(1, h / W);
      return b;
    }

    async function rotatePages(indices, dir) {
      const dims = indices.map((i) => pageViews[i] && [pageViews[i].vp1.width, pageViews[i].vp1.height]);
      return mutate((doc) => {
        indices.forEach((i) => {
          const p = doc.getPage(i);
          const cur = (p.getRotation().angle || 0) % 360;
          p.setRotation(PDFLib.degrees(((cur + (dir > 0 ? 90 : 270)) % 360 + 360) % 360));
        });
      }, (a) => {
        const k = indices.indexOf(a.pageIndex);
        if (k < 0) return a;
        return rotateAnn(a, a.pageIndex, dir, dims[k][0], dims[k][1]);
      });
    }

    async function deletePages(indices) {
      if (!pdf) return false;
      if (indices.length >= pdf.numPages) {
        ctx.toast('A PDF needs at least one page', 'error');
        return false;
      }
      const set = new Set(indices);
      const sorted = indices.slice().sort((x, y) => y - x);
      const shift = (i) => i - indices.filter((d) => d < i).length;
      return mutate((doc) => { sorted.forEach((i) => doc.removePage(i)); }, (a) => {
        if (set.has(a.pageIndex)) return null;
        return { ...a, pageIndex: shift(a.pageIndex) };
      }, { keepPage: Math.min(currentPage, pdf.numPages - indices.length) });
    }

    async function movePage(from, to) {
      if (!pdf || from === to || to < 0 || to >= pdf.numPages) return false;
      const order = pageViews.map((_, i) => i);
      order.splice(to, 0, order.splice(from, 1)[0]);
      return reorderPages(order, to + 1);
    }

    async function reorderPages(order, keepPage) {
      const newIndex = new Map(order.map((oldI, newI) => [oldI, newI]));
      return mutate((doc) => {
        const pages = doc.getPages();
        for (let i = pages.length - 1; i >= 0; i--) doc.removePage(i);
        order.forEach((oldI, newI) => doc.insertPage(newI, pages[oldI]));
      }, (a) => ({ ...a, pageIndex: newIndex.get(a.pageIndex) }), { keepPage });
    }

    async function insertBlankPage(afterIndex) {
      const ref = pageViews[afterIndex] || pageViews[0];
      const size = ref ? [ref.page.view[2] - ref.page.view[0], ref.page.view[3] - ref.page.view[1]] : [612, 792];
      const rot = ref ? ref.page.rotate || 0 : 0;
      return mutate((doc) => {
        const p = doc.insertPage(afterIndex + 1, size);
        if (rot) p.setRotation(PDFLib.degrees(rot));
      }, (a) => (a.pageIndex > afterIndex ? { ...a, pageIndex: a.pageIndex + 1 } : a), { keepPage: afterIndex + 2 });
    }

    async function mergePdf() {
      if (!pdf) return;
      const files = await pickFile('application/pdf,.pdf', true);
      if (destroyed || !files) return;
      const where = await ctx.openModal('Add pages from another PDF', (() => {
        const d = document.createElement('div');
        d.className = 'pdf-dialog';
        d.innerHTML = `<div class="modal-lead">Add ${files.length === 1 ? '<strong>' + escapeHtml(files[0].name) + '</strong>' : files.length + ' PDFs'} to this document.</div>`;
        return d;
      })(), [
        { label: 'Cancel', value: null },
        { label: `After page ${currentPage}`, value: 'here' },
        { label: 'At the end', primary: true, value: 'end' }
      ]);
      if (destroyed || !where) return;
      const at = where === 'here' ? currentPage : pdf.numPages;
      let added = 0;
      const ok = await mutate(async (doc) => {
        let insertAt = at;
        for (const f of files) {
          const buf = new Uint8Array(await readFile(f, 'buffer'));
          const src = await PDFLib.PDFDocument.load(buf, { ignoreEncryption: true });
          if (src.isEncrypted) throw Object.assign(new Error(`${f.name} is password-protected and cannot be added.`), { userFacing: true });
          const copied = await doc.copyPages(src, src.getPageIndices());
          copied.forEach((p) => { doc.insertPage(insertAt++, p); added++; });
        }
      }, (a) => (a.pageIndex >= at ? { ...a, pageIndex: a.pageIndex + added } : a), { keepPage: at + 1 });
      if (ok) ctx.toast(`Added ${added} page${added === 1 ? '' : 's'}`);
    }

    async function extractPages() {
      if (!pdf) return;
      const n = pdf.numPages;
      const body = document.createElement('div');
      body.className = 'pdf-dialog';
      body.innerHTML =
        `<label class="pdf-field"><span>Pages to extract</span><input type="text" class="pdf-range" value="${currentPage}" placeholder="e.g. 1-3, 5, 8-"></label>` +
        `<div class="pdf-field-hint">Pages 1 to ${n}. Separate ranges with commas.</div>` +
        `<label class="pdf-check"><input type="checkbox" class="pdf-range-remove"> Remove them from this document afterwards</label>` +
        `<div class="pdf-field-error" role="alert"></div>`;
      const input = body.querySelector('.pdf-range');
      const errEl = body.querySelector('.pdf-field-error');
      const removeBox = body.querySelector('.pdf-range-remove');
      const read = () => {
        const list = parseRanges(input.value, n);
        if (!list || !list.length) { errEl.textContent = 'That page range is not valid.'; return null; }
        return { list, remove: removeBox.checked };
      };
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); const v = read(); if (v) ctx.closeModal(v); }
      });
      input.addEventListener('input', () => { errEl.textContent = ''; });
      setTimeout(() => { input.focus(); input.select(); }, 40);
      let choice = null;
      while (!destroyed) {
        choice = await ctx.openModal('Extract pages to a new PDF', body, [
          { label: 'Cancel', value: null },
          { label: 'Extract…', primary: true, value: () => read() || 'invalid' }
        ]);
        if (choice !== 'invalid') break;
        setTimeout(() => input.focus(), 40);
      }
      if (destroyed || !choice) return;
      if (choice.remove && choice.list.length >= n) {
        ctx.toast('A PDF needs at least one page, so nothing was removed', 'error');
        choice.remove = false;
      }
      try {
        const src = await loadForEdit();
        const out = await PDFLib.PDFDocument.create();
        const copied = await out.copyPages(src, choice.list);
        copied.forEach((p) => out.addPage(p));
        const outBytes = await out.save();
        const base = (docRef && docRef.name ? docRef.name : 'Document.pdf').replace(/\.pdf$/i, '');
        const label = choice.list.length === 1 ? `page ${choice.list[0] + 1}` : `pages ${choice.list[0] + 1}-${choice.list[choice.list.length - 1] + 1}`;
        const res = await window.margo.saveAs({ kind: 'pdf', data: { base64: b64(outBytes), bytes: outBytes }, suggestedName: `${base} (${label}).pdf`, currentPath: docRef && docRef.path });
        if (!res || res.canceled) return;
        if (!res.ok) { ctx.toast(res.error || 'Could not save the pages', 'error'); return; }
        ctx.toast(`Saved ${choice.list.length} page${choice.list.length === 1 ? '' : 's'} to ${String(res.path).split(/[\\/]/).pop()}`);
        if (choice.remove) await deletePages(choice.list);
      } catch (err) {
        ctx.toast((err && err.userFacing && err.message) || ('Could not extract pages: ' + ((err && err.message) || err)), 'error');
      }
    }

    async function confirmDeletePage(index) {
      if (!pdf) return;
      if (pdf.numPages <= 1) { ctx.toast('A PDF needs at least one page', 'error'); return; }
      await deletePages([index]);
    }

    /* ================================================================ */
    /* thumbnails                                                        */
    /* ================================================================ */
    const THUMB_W = 116;
    let thumbQueue = [];
    let thumbBusy = false;
    let dragFrom = null;

    function buildThumbs() {
      if (!thumbsList) return;
      thumbsList.textContent = '';
      if (thumbObserver) thumbObserver.disconnect();
      thumbObserver = new IntersectionObserver((entries) => {
        entries.forEach((en) => {
          if (!en.isIntersecting) return;
          const pv = pageViews[Number(en.target.dataset.i)];
          if (pv && !pv.thumbDone && !thumbQueue.includes(pv)) { thumbQueue.push(pv); pumpThumbs(); }
        });
      }, { root: thumbsList, rootMargin: '300px 0px' });
      const frag = document.createDocumentFragment();
      pageViews.forEach((pv, i) => {
        const t = document.createElement('div');
        t.className = 'pdf-thumb';
        t.dataset.i = i;
        t.tabIndex = 0;
        t.draggable = true;
        t.setAttribute('role', 'option');
        t.setAttribute('aria-label', `Page ${i + 1}`);
        const h = Math.round(THUMB_W * pv.vp1.height / pv.vp1.width);
        t.innerHTML =
          `<div class="pdf-thumb-frame" style="width:${THUMB_W}px;height:${h}px"></div>` +
          `<div class="pdf-thumb-foot"><span class="pdf-thumb-num">${i + 1}</span>` +
          `<span class="pdf-thumb-actions">` +
            `<button type="button" class="pdf-thumb-btn" data-act="ccw" title="Rotate left" aria-label="Rotate page ${i + 1} left">${ICONS.rotateCcw}</button>` +
            `<button type="button" class="pdf-thumb-btn" data-act="cw" title="Rotate right" aria-label="Rotate page ${i + 1} right">${ICONS.rotateCw}</button>` +
            `<button type="button" class="pdf-thumb-btn danger" data-act="del" title="Delete page" aria-label="Delete page ${i + 1}">${ICONS.trash}</button>` +
          `</span></div>`;
        pv.thumb = t;
        frag.appendChild(t);
        thumbObserver.observe(t);
      });
      thumbsList.appendChild(frag);
      updatePageControls();
    }

    async function pumpThumbs() {
      if (thumbBusy) return;
      thumbBusy = true;
      try {
        while (thumbQueue.length && !destroyed) {
          const pv = thumbQueue.shift();
          if (pv.thumbDone || pageViews.indexOf(pv) < 0) continue;
          try {
            const vp = pv.page.getViewport({ scale: (THUMB_W * Math.min(2, window.devicePixelRatio || 1)) / pv.vp1.width });
            const c = document.createElement('canvas');
            c.width = Math.max(1, Math.floor(vp.width));
            c.height = Math.max(1, Math.floor(vp.height));
            await pv.page.render({ canvasContext: c.getContext('2d', { alpha: false }), viewport: vp }).promise;
            if (destroyed || pageViews.indexOf(pv) < 0) { c.width = 0; continue; }
            const frame = pv.thumb && pv.thumb.querySelector('.pdf-thumb-frame');
            if (frame) { frame.textContent = ''; frame.appendChild(c); }
            pv.thumbCanvas = c;
            pv.thumbDone = true;
          } catch { pv.thumbDone = true; }
        }
      } finally {
        thumbBusy = false;
      }
    }

    function onThumbsClick(e) {
      const t = e.target.closest('.pdf-thumb');
      if (!t) return;
      const i = Number(t.dataset.i);
      const act = e.target.closest('.pdf-thumb-btn');
      if (act) {
        e.stopPropagation();
        if (act.dataset.act === 'cw') rotatePages([i], 1);
        else if (act.dataset.act === 'ccw') rotatePages([i], -1);
        else if (act.dataset.act === 'del') confirmDeletePage(i);
        return;
      }
      goToPage(i + 1);
    }
    function onThumbsKey(e) {
      const t = e.target.closest('.pdf-thumb');
      if (!t) return;
      const i = Number(t.dataset.i);
      const focusThumb = (k) => { const pv = pageViews[k]; if (pv && pv.thumb) { pv.thumb.focus(); goToPage(k + 1); } };
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
        e.preventDefault();
        if (e.altKey) movePage(i, i + 1).then((ok) => ok && focusThumb(i + 1)); else focusThumb(i + 1);
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
        e.preventDefault();
        if (e.altKey) movePage(i, i - 1).then((ok) => ok && focusThumb(i - 1)); else focusThumb(i - 1);
      } else if (e.key === 'Enter') {
        e.preventDefault(); goToPage(i + 1);
      } else if (e.key === 'Delete') {
        e.preventDefault(); confirmDeletePage(i);
      }
    }
    function clearDropMarks() {
      thumbsList.querySelectorAll('.drop-before, .drop-after, .dragging').forEach((el) => el.classList.remove('drop-before', 'drop-after', 'dragging'));
    }
    function onThumbDragStart(e) {
      const t = e.target.closest('.pdf-thumb');
      if (!t) return;
      dragFrom = Number(t.dataset.i);
      t.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('application/x-margo-page', String(dragFrom)); } catch {}
    }
    function dropTarget(e) {
      const t = e.target.closest('.pdf-thumb');
      if (!t) return null;
      const r = t.getBoundingClientRect();
      const after = e.clientY > r.top + r.height / 2;
      return { t, i: Number(t.dataset.i), after };
    }
    function onThumbDragOver(e) {
      if (dragFrom == null) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';
      const d = dropTarget(e);
      thumbsList.querySelectorAll('.drop-before, .drop-after').forEach((el) => el.classList.remove('drop-before', 'drop-after'));
      if (d) d.t.classList.add(d.after ? 'drop-after' : 'drop-before');
    }
    function onThumbDrop(e) {
      if (dragFrom == null) return;
      e.preventDefault();
      e.stopPropagation();
      const d = dropTarget(e);
      const from = dragFrom;
      dragFrom = null;
      clearDropMarks();
      if (!d) return;
      let to = d.i + (d.after ? 1 : 0);
      if (to > from) to -= 1;
      if (to !== from) movePage(from, to);
    }
    function onThumbDragEnd() { dragFrom = null; clearDropMarks(); }

    function toggleThumbs(force) {
      if (!wrap) return;
      const open = force != null ? !!force : wrap.classList.contains('thumbs-hidden');
      wrap.classList.toggle('thumbs-hidden', !open);
      if (tb.thumbs) { tb.thumbs.classList.toggle('active', open); tb.thumbs.setAttribute('aria-pressed', String(open)); }
      const pageNow = currentPage;
      requestAnimationFrame(() => {
        if (destroyed) return;
        if (fitMode !== 'manual') { computeFit(); applyScale(); goToPage(pageNow, 0, true); }
        renderVisible();
      });
    }

    /* ================================================================ */
    /* find                                                              */
    /* ================================================================ */
    async function ensureTextIndex() {
      if (textIndex) return textIndex;
      if (!textIndexPromise) {
        const views = pageViews;
        textIndexPromise = (async () => {
          const idx = [];
          for (let i = 0; i < views.length; i++) {
            if (destroyed || views !== pageViews) return null;
            let tc = null;
            try { tc = await pageTextContent(views[i]); } catch {}
            let text = '';
            const items = [];
            ((tc && tc.items) || []).forEach((item) => {
              if (typeof item.str !== 'string' || !item.str) return;
              if (text.length && !/\s$/.test(text) && !/^\s/.test(item.str)) text += ' ';
              const start = text.length;
              text += item.str;
              items.push({ start, end: text.length, item });
              if (item.hasEOL) text += ' ';
            });
            idx.push({ pageIndex: i, text, items });
            if (findCountEl && findOpen && i % 20 === 0) findCountEl.textContent = `Indexing ${i + 1}/${views.length}`;
          }
          if (views === pageViews) textIndex = idx;
          return idx;
        })();
      }
      return textIndexPromise;
    }

    function clearFindMarks() {
      pageViews.forEach((pv) => {
        pv.overlay.querySelectorAll('.pdf-find-hit').forEach((el) => el.remove());
      });
    }

    /* The box of characters [from, to) of a text item, in page fractions.
       Built from the item's own direction so rotated pages and rotated
       text land where the glyphs are. */
    function itemBox(pv, it, from, to) {
      const item = it.item;
      const [a, b, c, d, e, f] = item.transform;
      const len = Math.max(1, item.str.length);
      const dirLen = Math.hypot(a, b) || 1;
      const ux = a / dirLen, uy = b / dirLen;
      const hgt = item.height || Math.hypot(c, d) || dirLen;
      const w = item.width || 0;
      const s0 = w * (from / len), s1 = w * (to / len);
      const down = hgt * 0.22, up = hgt * 0.95;
      const pts = [];
      for (const s of [s0, s1]) {
        for (const t of [-down, up]) {
          pts.push(pv.vp1.convertToViewportPoint(e + ux * s - uy * t, f + uy * s + ux * t));
        }
      }
      const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
      const x1 = Math.min(...xs), x2 = Math.max(...xs), y1 = Math.min(...ys), y2 = Math.max(...ys);
      return { xr: x1 / pv.vp1.width, yr: y1 / pv.vp1.height, wr: Math.max(2, x2 - x1) / pv.vp1.width, hr: Math.max(2, y2 - y1) / pv.vp1.height };
    }

    function updateFindCount() {
      if (!findCountEl) return;
      if (!findHits.length) findCountEl.textContent = findInput && findInput.value.trim() ? 'No results' : '';
      else findCountEl.textContent = (findIndex + 1) + ' of ' + findHits.length;
      findCountEl.classList.toggle('none', !findHits.length && !!(findInput && findInput.value.trim()));
    }

    function paintFindHits(scrollToCurrent) {
      const keep = document.activeElement;
      const keepFind = keep === findInput;
      try {
        clearFindMarks();
        if (!findHits.length || !textIndex) {
          updateFindCount();
          return;
        }
        let currentEl = null;
        findHits.forEach((hit, i) => {
          const page = textIndex[hit.pageIndex];
          const pv = pageViews[hit.pageIndex];
          if (!page || !pv) return;
          const isCurrent = i === findIndex;
          page.items.forEach((it) => {
            if (it.end <= hit.start || it.start >= hit.end) return;
            try {
              const box = itemBox(pv, it, Math.max(0, hit.start - it.start), Math.min(it.item.str.length, hit.end - it.start));
              const mark = document.createElement('div');
              mark.className = 'pdf-find-hit' + (isCurrent ? ' current' : '');
              annStyleBox(mark, box);
              pv.overlay.appendChild(mark);
              if (isCurrent && !currentEl) currentEl = mark;
            } catch { /* overlay math can fail on odd text items */ }
          });
        });
        if (scrollToCurrent !== false) {
          const cur = findHits[findIndex];
          const curPv = cur && pageViews[cur.pageIndex];
          if (currentEl) currentEl.scrollIntoView({ block: 'center', inline: 'nearest' });
          else if (curPv) curPv.el.scrollIntoView({ block: 'center' });
        }
        updateFindCount();
      } finally {
        if (keepFind && keep && keep.isConnected) keep.focus();
      }
    }

    let findSeq = 0;
    async function runFind(query) {
      const seq = ++findSeq;
      findHits = [];
      findIndex = -1;
      const q = (query || '').trim();
      if (!q) {
        clearFindMarks();
        updateFindCount();
        return;
      }
      const idx = await ensureTextIndex();
      if (seq !== findSeq || destroyed || !idx) return;
      const needle = q.toLowerCase().replace(/\s+/g, ' ');
      idx.forEach((p) => {
        const t = p.text.toLowerCase();
        let start = 0, i;
        while ((i = t.indexOf(needle, start)) !== -1) {
          findHits.push({ pageIndex: p.pageIndex, start: i, end: i + needle.length });
          start = i + needle.length;
          if (findHits.length > 5000) break;
        }
      });
      const fromPage = currentPage - 1;
      const first = findHits.findIndex((h) => h.pageIndex >= fromPage);
      findIndex = findHits.length ? Math.max(0, first) : -1;
      paintFindHits();
    }

    function findNext(dir) {
      if (!findHits.length) return;
      findIndex = (findIndex + dir + findHits.length) % findHits.length;
      paintFindHits();
    }

    function closeFind() {
      findOpen = false;
      findSeq++;
      if (findBar) findBar.classList.add('hidden');
      findHits = [];
      findIndex = -1;
      clearFindMarks();
      updateFindCount();
    }

    async function openFind() {
      ensureFindBar();
      if (!findBar) return;
      findOpen = true;
      findBar.classList.remove('hidden');
      const sel = window.getSelection();
      const selText = sel && !sel.isCollapsed && scroll.contains(sel.anchorNode) ? sel.toString().trim() : '';
      if (selText && selText.length < 120 && !selText.includes('\n')) findInput.value = selText;
      setTimeout(() => { if (findInput) { findInput.focus(); findInput.select(); } }, 30);
      if (!textIndex) {
        findCountEl.textContent = 'Indexing…';
        await ensureTextIndex();
        updateFindCount();
      }
      if (findInput && findInput.value) await runFind(findInput.value);
    }

    function ensureFindBar() {
      if (!host || findBar) return;
      findBar = document.createElement('div');
      findBar.className = 'doc-find-bar pdf-find-bar hidden';
      findBar.setAttribute('role', 'search');
      findBar.innerHTML =
        `<div class="doc-find-row">` +
          `<input type="search" class="doc-find-input" placeholder="Find in PDF" aria-label="Find in PDF" spellcheck="false">` +
          `<span class="doc-find-count" aria-live="polite"></span>` +
          `<button type="button" class="icon-btn doc-find-prev" title="Previous match (Shift+Enter)" aria-label="Previous match">${ICONS.chevronUp}</button>` +
          `<button type="button" class="icon-btn doc-find-next" title="Next match (Enter)" aria-label="Next match">${ICONS.chevronDown}</button>` +
          `<button type="button" class="icon-btn doc-find-close" title="Close (Esc)" aria-label="Close find">${ICONS.close}</button>` +
        `</div>`;
      host.appendChild(findBar);
      findInput = findBar.querySelector('.doc-find-input');
      findCountEl = findBar.querySelector('.doc-find-count');
      findBar.querySelector('.doc-find-prev').addEventListener('click', () => findNext(-1));
      findBar.querySelector('.doc-find-next').addEventListener('click', () => findNext(1));
      findBar.querySelector('.doc-find-close').addEventListener('click', () => { closeFind(); scroll && scroll.focus({ preventScroll: true }); });
      findInput.addEventListener('input', () => runFind(findInput.value));
      findInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          findNext(e.shiftKey ? -1 : 1);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          closeFind();
          scroll && scroll.focus({ preventScroll: true });
        }
      });
    }

    /* ================================================================ */
    /* image extraction                                                  */
    /* ================================================================ */
    function objGet(page, name) {
      return new Promise((resolve, reject) => {
        let done = false;
        try {
          page.objs.get(name, (obj) => { done = true; resolve(obj); });
        } catch (e) { reject(e); return; }
        setTimeout(() => { if (!done) reject(new Error('timeout')); }, 4000);
      });
    }

    function imgToCanvas(img) {
      if (!img) return null;
      const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
      if (img.bitmap) {
        const c = mk(img.bitmap.width, img.bitmap.height);
        c.getContext('2d').drawImage(img.bitmap, 0, 0);
        return c;
      }
      const { width, height, kind, data } = img;
      if (!data || !width || !height) return null;
      const c = mk(width, height);
      const x = c.getContext('2d');
      const out = x.createImageData(width, height);
      const d = out.data;
      if (kind === 3) {
        d.set(data.subarray(0, d.length));
      } else if (kind === 2) {
        for (let i = 0, j = 0; j < d.length; i += 3, j += 4) {
          d[j] = data[i]; d[j + 1] = data[i + 1]; d[j + 2] = data[i + 2]; d[j + 3] = 255;
        }
      } else if (kind === 1) {
        const rowBytes = (width + 7) >> 3;
        for (let yy = 0; yy < height; yy++) {
          for (let xx = 0; xx < width; xx++) {
            const bit = (data[yy * rowBytes + (xx >> 3)] >> (7 - (xx & 7))) & 1;
            const j = (yy * width + xx) * 4;
            d[j] = d[j + 1] = d[j + 2] = bit ? 255 : 0;
            d[j + 3] = 255;
          }
        }
      } else return null;
      x.putImageData(out, 0, 0);
      return c;
    }

    async function extractImages(onProgress) {
      const found = [];
      if (!pdf) return found;
      const doc = pdf;
      for (let p = 1; p <= doc.numPages && found.length < 60; p++) {
        if (destroyed || doc !== pdf) break;
        if (onProgress) onProgress(p, doc.numPages);
        let page, ops;
        try {
          page = await doc.getPage(p);
          ops = await page.getOperatorList();
        } catch { continue; }
        const seen = new Set();
        for (let i = 0; i < ops.fnArray.length && found.length < 60; i++) {
          if (ops.fnArray[i] !== pdfjsLib.OPS.paintImageXObject) continue;
          const name = ops.argsArray[i][0];
          if (seen.has(name)) continue;
          seen.add(name);
          let img;
          try { img = await objGet(page, name); } catch { continue; }
          const canvas = imgToCanvas(img);
          if (!canvas || canvas.width < 24 || canvas.height < 24) continue;
          found.push({ canvas, w: canvas.width, h: canvas.height, page: p });
        }
      }
      return found;
    }

    async function showImagesPanel() {
      if (!pdf) return;
      const body = document.createElement('div');
      body.className = 'pdf-images';
      body.textContent = 'Scanning pages…';
      const modalPromise = ctx.openModal('Images in this PDF', body, [
        { label: 'Close', primary: true, value: null }
      ], { wide: true });

      const images = await extractImages((p, n) => { body.textContent = `Scanning page ${p} of ${n}…`; });
      body.textContent = '';
      if (!images.length) {
        body.textContent = 'No embedded images found in this PDF.';
      } else {
        const topbar = document.createElement('div');
        topbar.className = 'doc-images-topbar';
        const summary = document.createElement('span');
        summary.className = 'doc-images-summary';
        summary.textContent = `${images.length} image${images.length === 1 ? '' : 's'} found`;
        const exportAllBtn = document.createElement('button');
        exportAllBtn.className = 'btn ghost';
        exportAllBtn.textContent = 'Export all to folder…';
        exportAllBtn.addEventListener('click', async () => {
          const res = await window.margo.exportImagesFolder({
            images: images.map((im, idx) => ({
              dataUrl: im.canvas.toDataURL('image/png'),
              name: `pdf-image-${idx + 1}.png`
            }))
          });
          if (res && res.ok) ctx.toast(`Exported ${res.count} images`);
          else if (res && !res.canceled) ctx.toast(res.error || 'Export failed', 'error');
        });
        topbar.appendChild(summary);
        topbar.appendChild(exportAllBtn);
        body.appendChild(topbar);

        const grid = document.createElement('div');
        grid.className = 'pdf-images-grid';
        images.forEach((im, idx) => {
          const item = document.createElement('div');
          item.className = 'pdf-image-item';
          const preview = document.createElement('div');
          preview.className = 'pdf-image-preview';
          im.canvas.style.maxWidth = '100%';
          im.canvas.style.maxHeight = '100%';
          preview.appendChild(im.canvas);
          const meta = document.createElement('div');
          meta.className = 'pdf-image-meta';
          meta.textContent = `${im.w} × ${im.h} · page ${im.page}`;
          const row = document.createElement('div');
          row.className = 'pdf-image-actions';
          const copyBtn = document.createElement('button');
          copyBtn.className = 'btn ghost'; copyBtn.textContent = 'Copy';
          copyBtn.addEventListener('click', () => {
            im.canvas.toBlob(async (blob) => {
              try {
                await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
                ctx.toast(`Copied ${im.w} × ${im.h} image`);
              } catch { ctx.toast('Copy failed', 'error'); }
            }, 'image/png');
          });
          const saveBtn = document.createElement('button');
          saveBtn.className = 'btn ghost'; saveBtn.textContent = 'Save…';
          saveBtn.addEventListener('click', async () => {
            const res = await window.margo.saveImage({
              dataUrl: im.canvas.toDataURL('image/png'),
              suggestedName: `pdf-image-${idx + 1}.png`
            });
            if (res && res.ok) ctx.toast('Image saved');
          });
          row.appendChild(copyBtn); row.appendChild(saveBtn);
          item.appendChild(preview); item.appendChild(meta); item.appendChild(row);
          grid.appendChild(item);
        });
        body.appendChild(grid);
      }
      await modalPromise;
      images.forEach((im) => { im.canvas.width = 0; im.canvas.height = 0; });
    }

    /* ================================================================ */
    /* burn-in                                                           */
    /* ================================================================ */
    function wrapLines(text, font, size, maxWidth) {
      const out = [];
      String(text || '').split('\n').forEach((para) => {
        const words = para.split(/(\s+)/);
        let line = '';
        for (const w of words) {
          const trial = line + w;
          if (!line || font.widthOfTextAtSize(trial.replace(/\s+$/, ''), size) <= maxWidth) {
            line = trial;
            continue;
          }
          out.push(line.replace(/\s+$/, ''));
          line = w.replace(/^\s+/, '');
          /* a single word longer than the box breaks by character */
          while (line && font.widthOfTextAtSize(line, size) > maxWidth) {
            let k = line.length - 1;
            while (k > 1 && font.widthOfTextAtSize(line.slice(0, k), size) > maxWidth) k--;
            out.push(line.slice(0, k));
            line = line.slice(k);
          }
        }
        out.push(line.replace(/\s+$/, ''));
      });
      return out;
    }

    /* Text Helvetica cannot encode (CJK, emoji…) is drawn to a picture. */
    function rasteriseText(a, wPt, hPt) {
      const k = 4;
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.ceil(wPt * k));
      c.height = Math.max(1, Math.ceil(hPt * k));
      const x = c.getContext('2d');
      const size = (a.size || 14) * k;
      x.font = `${size}px ${TEXT_FONT_STACK}`;
      x.fillStyle = a.color || '#000';
      x.textBaseline = 'alphabetic';
      const maxW = c.width - 8 * k;
      const lines = [];
      String(a.text || '').split('\n').forEach((para) => {
        let line = '';
        for (const ch of Array.from(para)) {
          if (x.measureText(line + ch).width > maxW && line) { lines.push(line); line = ch; } else line += ch;
        }
        lines.push(line);
      });
      lines.forEach((ln, i) => x.fillText(ln, 4 * k, 4 * k + size * (0.93 + i * 1.2)));
      return c.toDataURL('image/png');
    }

    function noteAppearance(doc, w, h, rgb) {
      const [r, g, b] = rgb;
      const ops = [
        `${r} ${g} ${b} rg 0.35 0.3 0.1 RG 0.8 w`,
        `0.5 0.5 ${w - 1} ${h - 1} re B`,
        `0.3 0.27 0.1 RG 1 w`,
        `4 ${h * 0.68} m ${w - 4} ${h * 0.68} l S`,
        `4 ${h * 0.48} m ${w - 4} ${h * 0.48} l S`,
        `4 ${h * 0.28} m ${w * 0.6} ${h * 0.28} l S`
      ].join('\n');
      const stream = doc.context.stream(ops, {
        Type: 'XObject', Subtype: 'Form', BBox: [0, 0, w, h], Resources: {}
      });
      return doc.context.register(stream);
    }

    async function applyForms(doc) {
      if (!formValues.size) return false;
      let form;
      try { form = doc.getForm(); } catch { return false; }
      let changed = false;
      formValues.forEach((value, name) => {
        try {
          const field = form.getField(name);
          if (field instanceof PDFLib.PDFTextField) { field.setText(value == null ? '' : String(value)); changed = true; }
          else if (field instanceof PDFLib.PDFCheckBox) { if (value && value !== 'Off') field.check(); else field.uncheck(); changed = true; }
          else if (field instanceof PDFLib.PDFRadioGroup) {
            if (value && value !== 'Off') {
              /* pdf.js reports a widget's on-state; with an /Opt array
                 those are indices into the export values pdf-lib selects by */
              const opts = field.getOptions();
              let v = String(value);
              if (!opts.includes(v) && /^\d+$/.test(v) && opts[Number(v)] != null) v = opts[Number(v)];
              field.select(v);
            } else field.clear();
            changed = true;
          }
          else if (field instanceof PDFLib.PDFDropdown || field instanceof PDFLib.PDFOptionList) { field.select(String(value)); changed = true; }
        } catch { /* a field pdf-lib cannot address keeps its old value */ }
      });
      return changed ? form : false;
    }

    async function buildOutput() {
      const doc = await PDFLib.PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
      if (doc.isEncrypted) {
        throw new Error('This PDF is password-protected, so edits cannot be saved into it. Use Save As on an unprotected copy.');
      }
      const form = await applyForms(doc);
      const { StandardFonts, rgb, degrees, BlendMode } = PDFLib;
      let font = null;
      const embeds = new Map();
      for (const a of anns) {
        const pv = pageViews[a.pageIndex];
        if (!pv) continue;
        const page = doc.getPage(a.pageIndex);
        const vp = pv.vp1;
        const W = vp.width, H = vp.height;
        const rot = ((vp.rotation || 0) % 360 + 360) % 360;
        const anchor = (vx, vy) => vp.convertToPdfPoint(vx, vy);
        if (a.type === 'image') {
          let img = embeds.get(a.dataUrl);
          if (!img) {
            img = /^data:image\/jpe?g/i.test(a.dataUrl) ? await doc.embedJpg(a.dataUrl) : await doc.embedPng(a.dataUrl);
            embeds.set(a.dataUrl, img);
          }
          const vx = a.xr * W, vy = a.yr * H, vw = a.wr * W, vh = a.hr * H;
          const [x, y] = anchor(vx, vy + vh);
          page.drawImage(img, { x, y, width: vw, height: vh, rotate: degrees(rot) });
        } else if (a.type === 'highlight') {
          const color = rgb(...hexToRgb(a.color));
          for (const r of a.rects || []) {
            const vx = r.xr * W, vy = r.yr * H, vw = r.wr * W, vh = r.hr * H;
            const [x, y] = anchor(vx, vy + vh);
            page.drawRectangle({ x, y, width: vw, height: vh, color, opacity: 0.4, blendMode: BlendMode.Multiply, rotate: degrees(rot) });
          }
        } else if (a.type === 'text') {
          if (!String(a.text || '').trim()) continue;
          if (!font) font = await doc.embedFont(StandardFonts.Helvetica);
          const size = a.size || 14;
          const pad = 4;
          const vx = a.xr * W, vy = a.yr * H, vw = a.wr * W;
          let encodable = true;
          try { font.encodeText(String(a.text)); } catch { encodable = false; }
          if (encodable) {
            const lines = wrapLines(a.text, font, size, Math.max(10, vw - pad * 2));
            const color = rgb(...hexToRgb(a.color));
            const ascent = font.heightAtSize(size, { descender: false });
            lines.forEach((ln, i) => {
              if (!ln) return;
              const [x, y] = anchor(vx + pad, vy + pad + ascent + i * size * 1.2);
              page.drawText(ln, { x, y, size, font, color, rotate: degrees(rot) });
            });
          } else {
            const vh = Math.max(a.hr * H, size * 1.4);
            const png = await doc.embedPng(rasteriseText(a, vw, vh));
            const [x, y] = anchor(vx, vy + vh);
            page.drawImage(png, { x, y, width: vw, height: vh, rotate: degrees(rot) });
          }
        } else if (a.type === 'note') {
          const side = 22;
          const vx = a.xr * W, vy = a.yr * H;
          const p1 = anchor(vx, vy), p2 = anchor(vx + side, vy + side);
          const rect = [Math.min(p1[0], p2[0]), Math.min(p1[1], p2[1]), Math.max(p1[0], p2[0]), Math.max(p1[1], p2[1])];
          const color = hexToRgb(a.color || '#ffd60a');
          const ap = noteAppearance(doc, rect[2] - rect[0], rect[3] - rect[1], color);
          const annot = doc.context.obj({
            Type: 'Annot',
            Subtype: 'Text',
            Rect: rect,
            Contents: PDFLib.PDFHexString.fromText(a.text || ''),
            T: PDFLib.PDFHexString.fromText('Margo'),
            Name: 'Comment',
            C: color,
            F: 4,
            Open: false,
            AP: { N: ap }
          });
          page.node.addAnnot(doc.context.register(annot));
        }
      }
      try {
        return await doc.save({ updateFieldAppearances: !!form });
      } catch (err) {
        if (!form) throw err;
        /* field text the standard font cannot draw: let the reader build
           the appearances instead */
        form.acroForm.dict.set(PDFLib.PDFName.of('NeedAppearances'), PDFLib.PDFBool.True);
        return await doc.save({ updateFieldAppearances: false });
      }
    }

    /* ================================================================ */
    /* print                                                             */
    /* ================================================================ */
    async function printDocument() {
      if (!pdf) return false;
      try {
        const data = await getDataImpl();
        const res = await window.margo.print({
          kind: 'pdf',
          data: { base64: data.base64 },
          suggestedName: (docRef && docRef.name) || 'Document.pdf',
          path: null
        });
        if (!res || res.canceled || res.skipped) return false;
        if (!res.ok) { ctx.toast(res.error || 'Print failed', 'error'); return false; }
        return true;
      } catch (err) {
        ctx.toast((err && err.message) || 'Print failed', 'error');
        return false;
      }
    }

    /* ================================================================ */
    /* toolbar                                                           */
    /* ================================================================ */
    function closePopover() {
      if (!popover) return;
      const p = popover;
      popover = null;
      document.removeEventListener('mousedown', onPopoverOutside, true);
      document.removeEventListener('keydown', onPopoverKey, true);
      window.removeEventListener('blur', closePopover);
      if (p.anchor) p.anchor.classList.remove('open');
      p.el.remove();
    }
    function onPopoverOutside(e) {
      if (!popover) return;
      if (popover.el.contains(e.target) || (popover.anchor && popover.anchor.contains(e.target))) return;
      closePopover();
    }
    function onPopoverKey(e) {
      if (!popover) return;
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePopover(); return; }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const items = Array.from(popover.el.querySelectorAll('button:not(:disabled)'));
        if (!items.length) return;
        e.preventDefault();
        const i = items.indexOf(document.activeElement);
        items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus();
      }
    }
    function openPopover(anchor, el) {
      const wasHere = popover && popover.anchor === anchor;
      closePopover();
      if (wasHere) return null;
      el.classList.add('pdf-pop');
      document.body.appendChild(el);
      const r = anchor.getBoundingClientRect();
      const w = el.offsetWidth;
      el.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left)) + 'px';
      el.style.top = (r.bottom + 6) + 'px';
      anchor.classList.add('open');
      popover = { el, anchor };
      document.addEventListener('mousedown', onPopoverOutside, true);
      document.addEventListener('keydown', onPopoverKey, true);
      window.addEventListener('blur', closePopover);
      if (anchor.matches(':focus-visible')) {
        const first = el.querySelector('button');
        if (first) first.focus();
      }
      return el;
    }
    function menu(anchor, items) {
      const m = document.createElement('div');
      m.className = 'pdf-menu';
      m.setAttribute('role', 'menu');
      items.forEach((it) => {
        if (it === '-') { const s = document.createElement('div'); s.className = 'pdf-menu-sep'; m.appendChild(s); return; }
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'pdf-menu-item' + (it.checked ? ' checked' : '');
        b.setAttribute('role', 'menuitem');
        b.disabled = !!it.disabled;
        b.innerHTML = `<span class="pdf-menu-icon">${it.icon || (it.checked ? ICONS.check : '')}</span><span>${escapeHtml(it.label)}</span>${it.key ? `<kbd>${escapeHtml(it.key)}</kbd>` : ''}`;
        b.addEventListener('click', () => { closePopover(); it.action(); });
        m.appendChild(b);
      });
      openPopover(anchor, m);
    }

    function openZoomMenu(anchor) {
      const pct = Math.round(zoom * 100);
      menu(anchor, [
        { label: 'Fit width', checked: fitMode === 'width', action: () => fitTo('width') },
        { label: 'Fit page', checked: fitMode === 'page', action: () => fitTo('page') },
        '-',
        ...[50, 75, 100, 125, 150, 200, 300].map((p) => ({ label: p + '%', checked: fitMode === 'manual' && pct === p, action: () => zoomTo(p / 100) }))
      ]);
    }

    function openPagesMenu(anchor) {
      const n = pdf ? pdf.numPages : 0;
      const cur = currentPage - 1;
      menu(anchor, [
        { label: 'Rotate page left', icon: ICONS.rotateCcw, action: () => rotatePages([cur], -1) },
        { label: 'Rotate page right', icon: ICONS.rotateCw, action: () => rotatePages([cur], 1) },
        { label: 'Rotate all pages right', icon: ICONS.rotateCw, action: () => rotatePages(pageViews.map((_, i) => i), 1) },
        '-',
        { label: 'Move page up', disabled: cur <= 0, action: () => movePage(cur, cur - 1) },
        { label: 'Move page down', disabled: cur >= n - 1, action: () => movePage(cur, cur + 1) },
        { label: 'Insert blank page after', icon: ICONS.insertPage, action: () => insertBlankPage(cur) },
        { label: 'Delete page', icon: ICONS.trash, disabled: n <= 1, action: () => confirmDeletePage(cur) },
        '-',
        { label: 'Add pages from PDF…', icon: ICONS.merge, action: () => mergePdf() },
        { label: 'Extract pages…', icon: ICONS.extract, action: () => extractPages() }
      ]);
    }

    function styleTarget() {
      const a = selectedId && findAnn(selectedId);
      if (a) return { ann: a, kind: a.type === 'highlight' || a.type === 'note' ? 'hl' : a.type === 'text' ? 'ink' : null };
      if (tool === 'highlight' || tool === 'note') return { kind: 'hl' };
      if (tool === 'text') return { kind: 'ink' };
      return { kind: null };
    }
    function updateStyleButton() {
      if (!tb.style) return;
      const t = styleTarget();
      tb.style.disabled = !t.kind;
      const color = t.ann && t.ann.color ? t.ann.color : t.kind === 'ink' ? inkColor : hlColor;
      tb.style.style.setProperty('--sw', t.kind ? color : 'transparent');
    }
    function openStyleMenu(anchor) {
      const t = styleTarget();
      if (!t.kind) return;
      const box = document.createElement('div');
      box.className = 'pdf-style-pop';
      const colors = t.kind === 'ink' ? INK_COLORS : HIGHLIGHT_COLORS;
      const cur = t.ann && t.ann.color ? t.ann.color : t.kind === 'ink' ? inkColor : hlColor;
      const row = document.createElement('div');
      row.className = 'pdf-swatches';
      colors.forEach(([name, c]) => {
        const s = document.createElement('button');
        s.type = 'button';
        s.className = 'pdf-swatch' + (c === cur ? ' active' : '');
        s.title = name;
        s.setAttribute('aria-label', name);
        s.style.setProperty('--sw', c);
        s.addEventListener('click', () => {
          if (t.kind === 'ink') inkColor = c; else hlColor = c;
          if (t.ann) {
            t.ann.color = c;
            annEls(t.ann.id).forEach((el) => {
              if (t.ann.type === 'highlight') el.style.setProperty('--hl', c);
              else if (t.ann.type === 'note') el.style.setProperty('--note', c);
              else { const body = el.querySelector('.pdf-ann-text-body'); if (body) body.style.color = c; }
            });
            commit();
          }
          box.querySelectorAll('.pdf-swatch').forEach((b) => b.classList.toggle('active', b === s));
          updateStyleButton();
        });
        row.appendChild(s);
      });
      box.appendChild(row);
      if (t.kind === 'ink') {
        const sizeRow = document.createElement('div');
        sizeRow.className = 'pdf-size-row';
        const curSize = t.ann ? t.ann.size || 14 : textSize;
        sizeRow.innerHTML = `<span>Size</span><button type="button" class="icon-btn" data-d="-1" aria-label="Smaller text">−</button><span class="pdf-size-val">${curSize} pt</span><button type="button" class="icon-btn" data-d="1" aria-label="Larger text">+</button>`;
        const val = sizeRow.querySelector('.pdf-size-val');
        sizeRow.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
          const steps = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 40, 48, 64];
          const now = t.ann ? t.ann.size || 14 : textSize;
          let k = steps.findIndex((s) => s >= now);
          if (k < 0) k = steps.length - 1;
          k = Math.max(0, Math.min(steps.length - 1, k + Number(b.dataset.d)));
          const next = steps[k];
          if (t.ann) {
            t.ann.size = next;
            const el = annEls(t.ann.id)[0];
            const body = el && el.querySelector('.pdf-ann-text-body');
            if (body) body.style.fontSize = `calc(var(--scale-factor) * ${next}px)`;
            fitTextHeight(t.ann);
            commit();
          } else {
            textSize = next;
          }
          val.textContent = next + ' pt';
        }));
        box.appendChild(sizeRow);
      }
      openPopover(anchor, box);
    }

    function buildToolbar() {
      const bar = ctx.toolbar;
      bar.innerHTML = '';
      bar.classList.add('pdf-toolbar');
      tb = { tools: {} };
      let group = null;
      const startGroup = (label) => {
        group = document.createElement('div');
        group.className = 'tb-group';
        group.setAttribute('role', 'group');
        if (label) group.setAttribute('aria-label', label);
        bar.appendChild(group);
      };
      const sep = () => { const s = document.createElement('span'); s.className = 'tb-sep'; bar.appendChild(s); };
      const btn = (title, icon, fn, opts) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'icon-btn pdf-tb-btn' + (opts && opts.label ? ' labeled' : '');
        b.title = title;
        b.setAttribute('aria-label', title.replace(/\s*\(.*\)$/, ''));
        b.innerHTML = icon + (opts && opts.label ? `<span>${opts.label}</span>` : '') + (opts && opts.caret ? `<span class="pdf-caret">${ICONS.chevronDown}</span>` : '');
        b.addEventListener('mousedown', (e) => { if (!(opts && opts.focus)) e.preventDefault(); });
        b.addEventListener('click', (e) => fn(e, b));
        (group || bar).appendChild(b);
        return b;
      };

      startGroup('View');
      tb.thumbs = btn('Page thumbnails', ICONS.sidebar, () => toggleThumbs());
      tb.thumbs.setAttribute('aria-pressed', 'false');
      sep();
      startGroup('Pages');
      tb.prev = btn('Previous page', ICONS.chevronUp, () => goToPage(currentPage - 1));
      const nav = document.createElement('label');
      nav.className = 'pdf-page-nav';
      nav.title = 'Go to page (Ctrl+G)';
      nav.innerHTML = `<input type="text" inputmode="numeric" class="pdf-page-input" aria-label="Page number" value="1"><span class="pdf-page-total">of 1</span>`;
      tb.pageInput = nav.querySelector('input');
      tb.pageTotal = nav.querySelector('.pdf-page-total');
      tb.pageInput.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') {
          e.preventDefault();
          const n = parseInt(tb.pageInput.value, 10);
          if (Number.isFinite(n)) goToPage(n);
          tb.pageInput.value = String(currentPage);
          tb.pageInput.select();
        } else if (e.key === 'Escape') {
          tb.pageInput.value = String(currentPage);
          scroll.focus({ preventScroll: true });
        }
      });
      tb.pageInput.addEventListener('focus', () => tb.pageInput.select());
      tb.pageInput.addEventListener('blur', () => { tb.pageInput.value = String(currentPage); });
      group.appendChild(nav);
      tb.next = btn('Next page', ICONS.chevronDown, () => goToPage(currentPage + 1));
      sep();
      startGroup('Zoom');
      btn('Zoom out (Ctrl+-)', ICONS.zoomOut, () => zoomBy(1 / 1.2));
      tb.zoomLabel = document.createElement('button');
      tb.zoomLabel.type = 'button';
      tb.zoomLabel.className = 'pdf-zoom-label';
      tb.zoomLabel.title = 'Zoom options';
      tb.zoomLabel.textContent = '100%';
      tb.zoomLabel.addEventListener('click', () => openZoomMenu(tb.zoomLabel));
      group.appendChild(tb.zoomLabel);
      btn('Zoom in (Ctrl+=)', ICONS.zoomIn, () => zoomBy(1.2));
      sep();
      startGroup('Annotate');
      const toolBtn = (key, title, icon, fn) => {
        const b = btn(title, icon, fn);
        b.classList.add('pdf-tool');
        b.setAttribute('aria-pressed', 'false');
        tb.tools[key] = b;
        return b;
      };
      toolBtn('select', 'Select text (V)', ICONS.cursor, () => setTool('select'));
      toolBtn('highlight', 'Highlight (H)', ICONS.highlighter, () => setTool(tool === 'highlight' ? 'select' : 'highlight'));
      toolBtn('text', 'Text box (T)', ICONS.textBox, () => setTool(tool === 'text' ? 'select' : 'text'));
      toolBtn('note', 'Sticky note (N)', ICONS.note, () => setTool(tool === 'note' ? 'select' : 'note'));
      toolBtn('sign', 'Signature', ICONS.signature, () => startSignFlow());
      toolBtn('stamp', 'Image', ICONS.stamp, () => startStampFlow());
      tb.style = btn('Colour and size', '<span class="pdf-style-dot"></span>', (_e, b) => openStyleMenu(b), { caret: true });
      tb.style.classList.add('pdf-style-btn');
      sep();
      startGroup('Page');
      btn('Rotate page left', ICONS.rotateCcw, () => rotatePages([currentPage - 1], -1));
      btn('Rotate page right', ICONS.rotateCw, () => rotatePages([currentPage - 1], 1));
      btn('Delete page', ICONS.trash, () => confirmDeletePage(currentPage - 1));
      btn('Page tools', ICONS.pages, (_e, b) => openPagesMenu(b), { caret: true });

      const spacer = document.createElement('span');
      spacer.className = 'tb-spacer';
      bar.appendChild(spacer);
      group = null;
      startGroup('Document');
      tb.undo = btn('Undo (Ctrl+Z)', SVG('<path d="M3.5 6.5h6.3a3.2 3.2 0 0 1 0 6.4H7"/><path d="M6 4 3.5 6.5 6 9"/>'), () => undo());
      tb.redo = btn('Redo (Ctrl+Y)', SVG('<path d="M12.5 6.5H6.2a3.2 3.2 0 0 0 0 6.4H9"/><path d="m10 4 2.5 2.5L10 9"/>'), () => redo());
      sep();
      startGroup('Tools');
      btn('Find (Ctrl+F)', ICONS.search, () => openFind());
      btn('Images in this PDF', ICONS.images, () => showImagesPanel());
      btn('Print (includes unsaved edits)', ICONS.print, () => printDocument());
      setTool('select');
      updateHistoryButtons();
    }

    /* ================================================================ */
    /* keyboard                                                          */
    /* ================================================================ */
    function isTyping(el) {
      return !!(el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)));
    }
    function onHostKeydown(e) {
      if (e.key === 'Escape') {
        if (findOpen && findBar && findBar.contains(e.target)) return;
        if (noteEditor) { e.preventDefault(); closeNoteEditor(); return; }
        if (tool !== 'select') { e.preventDefault(); setTool('select'); return; }
        if (selectedId) { e.preventDefault(); deselect(); return; }
        if (findOpen) { e.preventDefault(); closeFind(); }
        hideBubble();
        return;
      }
      if (isTyping(e.target)) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && !e.shiftKey && (e.key === 'g' || e.key === 'G')) {
        e.preventDefault();
        if (tb.pageInput) tb.pageInput.focus();
        return;
      }
      if (mod || e.altKey) return;
      const a = selectedId && findAnn(selectedId);
      if (a && (e.key === 'Delete' || e.key === 'Backspace')) { e.preventDefault(); deleteAnn(a.id); return; }
      if (a && a.type === 'text' && e.key === 'Enter') { e.preventDefault(); startTextEdit(a.id); return; }
      if (a && /^Arrow/.test(e.key) && a.type !== 'highlight') {
        e.preventDefault();
        const pv = pageViews[a.pageIndex];
        const step = (e.shiftKey ? 10 : 1);
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        const w = a.type === 'note' ? noteSizeRatio(a).w : a.wr;
        const h = a.type === 'note' ? noteSizeRatio(a).h : a.hr;
        a.xr = Math.max(0, Math.min(1 - w, a.xr + dx / pv.vp1.width));
        a.yr = Math.max(0, Math.min(1 - h, a.yr + dy / pv.vp1.height));
        positionAnnEl(a);
        clearTimeout(nudgeTimer);
        nudgeTimer = setTimeout(() => commit(), 400);
        return;
      }
      const k = e.key.toLowerCase();
      if (k === 'v') setTool('select');
      else if (k === 'h') setTool('highlight');
      else if (k === 't') setTool('text');
      else if (k === 'n') setTool('note');
      else if (e.key === 'Home') { e.preventDefault(); goToPage(1); }
      else if (e.key === 'End') { e.preventDefault(); goToPage(pdf ? pdf.numPages : 1); }
      else return;
    }
    let nudgeTimer = null;

    /* ================================================================ */
    /* data                                                              */
    /* ================================================================ */
    async function getDataImpl() {
      if (editingId) stopTextEdit();
      closeNoteEditor();
      if (!anns.length && !formValues.size) return { base64: b64(bytes), bytes };
      const out = await buildOutput();
      return { base64: b64(out), bytes: out };
    }

    function draftPlacements() {
      const list = cloneAnns(anns);
      if (formValues.size) list.push({ type: 'form', values: Array.from(formValues.entries()) });
      return list;
    }

    function restoreDraftPlacements(list) {
      for (const pl of list || []) {
        if (!pl || typeof pl !== 'object') continue;
        if (pl.type === 'form') {
          (pl.values || []).forEach(([k, v]) => formValues.set(k, v));
          continue;
        }
        if (typeof pl.pageIndex !== 'number' || !pageViews[pl.pageIndex]) continue;
        if (!pl.type && pl.dataUrl) pl.type = 'image';
        if (pl.type === 'image' && !pl.dataUrl) continue;
        if (pl.type === 'highlight' && !Array.isArray(pl.rects)) continue;
        anns.push({ ...pl, id: pl.id || newId() });
      }
      renderAnns();
    }

    return {
      kind: 'pdf',
      async mount(hostEl, doc) {
        host = hostEl;
        docRef = doc;
        buildToolbar();
        host.innerHTML =
          `<div class="pdf-wrap thumbs-hidden">` +
            `<aside class="pdf-thumbs" aria-label="Pages">` +
              `<div class="pdf-thumbs-list" role="listbox" aria-label="Page thumbnails"></div>` +
            `</aside>` +
            `<div class="pdf-scroll tool-select" tabindex="-1"></div>` +
          `</div>`;
        wrap = host.querySelector('.pdf-wrap');
        scroll = host.querySelector('.pdf-scroll');
        thumbsEl = host.querySelector('.pdf-thumbs');
        thumbsList = host.querySelector('.pdf-thumbs-list');
        scroll.addEventListener('scroll', () => { scheduleStatus(); hideBubble(); });
        scroll.addEventListener('wheel', onCtrlWheel, { passive: false });
        scroll.addEventListener('pointerdown', onScrollPointerDown);
        scroll.addEventListener('pointermove', moveRectHighlight);
        scroll.addEventListener('pointerup', onScrollPointerUp);
        thumbsList.addEventListener('click', onThumbsClick);
        thumbsList.addEventListener('keydown', onThumbsKey);
        thumbsList.addEventListener('dragstart', onThumbDragStart);
        thumbsList.addEventListener('dragover', onThumbDragOver);
        thumbsList.addEventListener('drop', onThumbDrop);
        thumbsList.addEventListener('dragend', onThumbDragEnd);
        host.addEventListener('keydown', onHostKeydown);
        ctx.setStatus('Opening PDF…', 'PDF');
        loadedFromPath = !!(doc.path);
        let raw = null;
        if (doc.bytes && (doc.bytes.byteLength || doc.bytes.length)) {
          raw = doc.bytes;
        } else if (doc.base64) {
          raw = fromB64(doc.base64);
          /* a draft carries its own bytes when they differ from the file */
          if (doc.path) bytesChanged = true;
        } else if (doc.path) {
          raw = await window.margo.readBinary(doc.path);
        } else {
          throw new Error('No PDF to open');
        }
        bytes = toBytes(raw);
        await loadDocument(bytes);
        if (destroyed) return;
        try { encrypted = !!(pdf && (await pdf.getPermissions())); } catch { encrypted = false; }
        if (Array.isArray(doc.placements)) restoreDraftPlacements(doc.placements);
        seedHistory();
        findBar = null;
        ensureFindBar();
        setupStatusChrome();
        if (window.ResizeObserver) {
          let last = scroll.clientWidth;
          resizeObs = new ResizeObserver(() => {
            if (!scroll || Math.abs(scroll.clientWidth - last) < 2) return;
            last = scroll.clientWidth;
            if (fitMode !== 'manual') {
              const pageNow = currentPage;
              computeFit();
              applyScale();
              goToPage(pageNow, 0, true);
            }
            renderVisible();
          });
          resizeObs.observe(scroll);
        }
        if (encrypted) ctx.toast('This PDF is password-protected: you can read it, but edits cannot be saved into it.');
        updateStatus();
      },
      getDraft() {
        const out = { placements: draftPlacements() };
        if ((!loadedFromPath || bytesChanged) && bytes) out.base64 = b64(bytes);
        return out;
      },
      getData() { return getDataImpl(); },
      async onSaved(data) {
        loadedFromPath = true;
        const burned = anns.length || formValues.size;
        bytesChanged = false;
        if (!data || !data.bytes || (!burned && data.bytes === bytes)) {
          seedHistory();
          updateStatus();
          return;
        }
        bytes = toBytes(data.bytes);
        anns = [];
        formValues = new Map();
        formEls = new Map();
        selectedId = null;
        await loadDocument(bytes, { keepPage: currentPage });
        seedHistory();
        updateStatus();
      },
      focus() { scroll && scroll.focus({ preventScroll: true }); },
      commands: {
        undo,
        redo,
        canUndo: () => histIndex > 0,
        canRedo: () => histIndex < hist.length - 1,
        zoomIn: () => zoomBy(1.2),
        zoomOut: () => zoomBy(1 / 1.2),
        zoomReset: () => fitTo('width'),
        setZoom: (z) => setZoomLevel(z),
        showImages: () => showImagesPanel(),
        find: () => openFind(),
        print: () => printDocument(),
        status: () => statusText(),
        goToPage: (n) => goToPage(n),
        rotate: (dir) => rotatePages([currentPage - 1], dir),
        thumbnails: () => toggleThumbs(),
        merge: () => mergePdf(),
        extract: () => extractPages()
      },
      destroy() {
        destroyed = true;
        loadSeq++;
        closePopover();
        hideBubble();
        clearTimeout(nudgeTimer);
        if (statusRaf) cancelAnimationFrame(statusRaf);
        if (loadingTask) { try { loadingTask.destroy(); } catch {} loadingTask = null; }
        if (resizeObs) { resizeObs.disconnect(); resizeObs = null; }
        if (host) host.removeEventListener('keydown', onHostKeydown);
        if (scroll) scroll.removeEventListener('wheel', onCtrlWheel);
        closeFind();
        teardownPages();
        thumbQueue = [];
        anns = [];
        hist = [];
        formEls = new Map();
        if (pdf) { try { pdf.destroy(); } catch {} pdf = null; }
        bytes = null;
      },
      _test: {
        numPages: () => (pdf ? pdf.numPages : 0),
        firstPageRendered: () => !!(pageViews[0] && pageViews[0].rendered && pageViews[0].canvas && pageViews[0].canvas.width > 50),
        firstPageError: () => (pageViews[0] && pageViews[0].error) || '',
        /* Stands a page's render up as one that always fails, the way a
           damaged page behaves, and reports how many times it was attempted
           before the viewer gave up. The rejection is deferred by a timer
           because that is how a real render failure arrives. */
        renderFailureProbe: async (i) => {
          const idx = i || 0;
          const pv = pageViews[idx];
          if (!pv) return null;
          const realPage = pv.page;
          let calls = 0;
          pv.page = {
            getViewport: (opts) => realPage.getViewport(opts),
            render: () => {
              calls++;
              return {
                promise: new Promise((_resolve, reject) => {
                  setTimeout(() => reject(new Error('forced render failure')), 0);
                })
              };
            }
          };
          pv.rendered = false;
          pv.rendering = false;
          pv.wanted = true;
          pv.attempts = 0;
          showPageError(pv, null);
          renderPage(idx);
          await new Promise((resolve) => setTimeout(resolve, 400));
          const result = {
            calls,
            noted: !!pv.el.querySelector('.pdf-page-error'),
            stillRendering: !!pv.rendering
          };
          pv.page = realPage;
          pv.rendered = false;
          pv.rendering = false;
          pv.attempts = 0;
          showPageError(pv, null);
          renderPage(idx);
          return result;
        },
        extract: () => extractImages(),
        placementsCount: () => anns.length,
        addTestSignature: (dataUrl) => addAnn({ type: 'image', kind: 'signature', pageIndex: 0, xr: 0.55, yr: 0.75, wr: 0.3, hr: 0.1, dataUrl }),
        addAnn: (a) => addAnn(a),
        anns: () => cloneAnns(anns),
        bytes: () => bytes,
        pageSizes: () => pageViews.map((pv) => [Math.round(pv.vp1.width), Math.round(pv.vp1.height), pv.vp1.rotation]),
        rotate: (i, dir) => rotatePages([i], dir),
        deletePage: (i) => deletePages([i]),
        movePage: (a, b) => movePage(a, b),
        insertBlank: (i) => insertBlankPage(i),
        mergeBytes: async (other) => {
          const at = pdf.numPages;
          let added = 0;
          const ok = await mutate(async (doc) => {
            const src = await PDFLib.PDFDocument.load(other);
            const copied = await doc.copyPages(src, src.getPageIndices());
            copied.forEach((p) => { doc.insertPage(at + added, p); added++; });
          });
          return ok ? added : 0;
        },
        extractBytes: async (list) => {
          const src = await loadForEdit();
          const out = await PDFLib.PDFDocument.create();
          (await out.copyPages(src, list)).forEach((p) => out.addPage(p));
          return out.save();
        },
        parseRanges: (t, n) => parseRanges(t, n),
        output: () => buildOutput(),
        setTool: (t) => setTool(t),
        tool: () => tool,
        thumbsCount: () => (thumbsList ? thumbsList.querySelectorAll('.pdf-thumb').length : 0),
        textLayerSpans: (i) => (pageViews[i || 0] ? pageViews[i || 0].textLayer.querySelectorAll('span').length : 0),
        formFields: () => Array.from(formEls.keys()),
        setFormValue: (n, v) => setFormValue(n, v),
        highlightSelection: () => highlightSelection(),
        renderedCount: () => pageViews.filter((pv) => pv.rendered).length,
        canvasCount: () => (scroll ? scroll.querySelectorAll('canvas.pdf-canvas').length : 0),
        zoom: () => zoom,
        currentPage: () => currentPage
      }
    };
  }

  window.MargoEditors = window.MargoEditors || {};
  window.MargoEditors.pdf = create;
  window.MargoEditors.blankPdfBytes = blankPdfBytes;
})();
