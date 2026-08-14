/* Margo — PDF viewer: lazy page rendering, zoom, signatures (burned via pdf-lib),
   and high-quality embedded image extraction. */
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

  /* US Letter — same size as the smoke sample PDF. */
  async function blankPdfBytes() {
    const pdfDoc = await PDFLib.PDFDocument.create();
    const letter = (PDFLib.PageSizes && PDFLib.PageSizes.Letter) || [612, 792];
    pdfDoc.addPage(letter);
    return await pdfDoc.save();
  }

  function create(ctx) {
    let host, scroll, pdf = null, bytes = null;
    let loadedFromPath = false;
    let pageViews = [];        // { el, canvas, overlay, vp1, rendered, rendering }
    let cssScale = 1, fitScale = 1, zoom = 1;
    let placements = [];       // { pageIndex, xr, yr, wr, hr, dataUrl }
    let observer = null, destroyed = false;
    let zoomLabel = null, currentPage = 1;
    let findBar = null, findInput = null, findCountEl = null;
    let findOpen = false, findHits = [], findIndex = -1;
    let textIndex = [];
    let textIndexPromise = null;

    const dpr = () => Math.min(window.devicePixelRatio || 1, 2.5);

    /* ---------------- document loading ---------------- */
    async function loadDocument(data) {
      if (pdf) { try { pdf.destroy(); } catch {} }
      pdf = await pdfjsLib.getDocument({ data: data.slice() }).promise;
      await buildPages();
    }

    async function buildPages() {
      if (observer) observer.disconnect();
      scroll.innerHTML = '';
      pageViews = [];
      const first = await pdf.getPage(1);
      const vpF = first.getViewport({ scale: 1 });
      fitScale = Math.min(Math.max((scroll.clientWidth - 72) / vpF.width, 0.4), 1.7);
      cssScale = fitScale * zoom;

      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const vp1 = page.getViewport({ scale: 1 });
        const el = document.createElement('div');
        el.className = 'pdf-page';
        el.dataset.i = i - 1;
        const canvas = document.createElement('canvas');
        const overlay = document.createElement('div');
        overlay.className = 'pdf-overlay';
        el.appendChild(canvas);
        el.appendChild(overlay);
        scroll.appendChild(el);
        pageViews.push({ el, canvas, overlay, vp1, page, rendered: false, rendering: false });
      }
      textIndexPromise = indexText();
      await textIndexPromise;
      observer = new IntersectionObserver(onIntersect, { root: scroll, rootMargin: '900px 0px' });
      pageViews.forEach((pv) => observer.observe(pv.el));
      applyScale();
      updateStatus();
    }

    async function indexText() {
      textIndex = [];
      if (!pdf) return;
      for (let i = 0; i < pageViews.length; i++) {
        const page = pageViews[i].page;
        const tc = await page.getTextContent();
        let text = '';
        const items = [];
        (tc.items || []).forEach((item) => {
          if (typeof item.str !== 'string' || !item.str) return;
          const start = text.length;
          text += item.str;
          items.push({ start, end: text.length, item });
        });
        textIndex.push({ pageIndex: i, text, items });
      }
    }

    function applyScale() {
      cssScale = fitScale * zoom;
      for (const pv of pageViews) {
        const w = Math.round(pv.vp1.width * cssScale);
        const h = Math.round(pv.vp1.height * cssScale);
        pv.el.style.width = w + 'px';
        pv.el.style.height = h + 'px';
        pv.rendered = false;
      }
      if (zoomLabel) zoomLabel.textContent = Math.round(zoom * 100) + '%';
      renderVisible();
      if (findOpen) paintFindHits();
    }

    function zoomBy(factor, clientX, clientY) {
      if (!scroll) return;
      const prev = zoom;
      const next = Math.min(3, Math.max(0.4, +(zoom * factor).toFixed(4)));
      if (next === prev) return;
      const rect = scroll.getBoundingClientRect();
      const mx = clientX != null ? clientX - rect.left : scroll.clientWidth / 2;
      const my = clientY != null ? clientY - rect.top : scroll.clientHeight / 2;
      const ratio = next / prev;
      zoom = next;
      applyScale();
      scroll.scrollLeft = (scroll.scrollLeft + mx) * ratio - mx;
      scroll.scrollTop = (scroll.scrollTop + my) * ratio - my;
    }

    function onCtrlWheel(e) {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      zoomBy(e.deltaY < 0 ? 1.2 : 1 / 1.2, e.clientX, e.clientY);
    }

    function onIntersect(entries) {
      for (const en of entries) {
        if (en.isIntersecting) renderPage(Number(en.target.dataset.i));
      }
    }
    function renderVisible() {
      const top = scroll.scrollTop - 900, bottom = scroll.scrollTop + scroll.clientHeight + 900;
      pageViews.forEach((pv, i) => {
        if (pv.el.offsetTop + pv.el.offsetHeight > top && pv.el.offsetTop < bottom) renderPage(i);
      });
    }

    async function renderPage(i) {
      const pv = pageViews[i];
      if (!pv || pv.rendered || pv.rendering) return;
      pv.rendering = true;
      try {
        const scale = cssScale * dpr();
        const vp = pv.page.getViewport({ scale });
        pv.canvas.width = Math.floor(vp.width);
        pv.canvas.height = Math.floor(vp.height);
        pv.canvas.style.width = '100%';
        pv.canvas.style.height = '100%';
        await pv.page.render({ canvasContext: pv.canvas.getContext('2d'), viewport: vp }).promise;
        pv.rendered = true;
        pv.error = null;
      } catch (e) {
        pv.error = e && e.message;
      } finally {
        pv.rendering = false;
      }
    }

    function updateStatus() {
      if (!pdf) return;
      // current page = page whose top is closest above viewport middle
      let cur = 1;
      const mid = scroll.scrollTop + scroll.clientHeight * 0.4;
      for (let i = 0; i < pageViews.length; i++) {
        if (pageViews[i].el.offsetTop <= mid) cur = i + 1;
      }
      currentPage = cur;
      const pending = placements.length
        ? ` · ${placements.length} signature${placements.length > 1 ? 's' : ''} pending`
        : '';
      ctx.setStatus(`Page ${cur} of ${pdf.numPages}`, `PDF${pending}`);
    }

    /* ---------------- signature pad ---------------- */
    function signaturePad() {
      const wrap = document.createElement('div');
      wrap.innerHTML = `<div class="sig-pad-hint">Draw your signature</div>`;
      const canvas = document.createElement('canvas');
      canvas.className = 'sig-pad';
      canvas.width = 440; canvas.height = 170;
      wrap.appendChild(canvas);
      const clearBtn = document.createElement('button');
      clearBtn.className = 'btn ghost sig-clear';
      clearBtn.textContent = 'Clear';
      wrap.appendChild(clearBtn);

      const x = canvas.getContext('2d');
      x.lineWidth = 2.4; x.lineCap = 'round'; x.lineJoin = 'round'; x.strokeStyle = '#1c1c30';
      let drawing = false, last = null, inked = false;
      const pos = (e) => {
        const r = canvas.getBoundingClientRect();
        return { x: (e.clientX - r.left) * (canvas.width / r.width), y: (e.clientY - r.top) * (canvas.height / r.height) };
      };
      canvas.addEventListener('pointerdown', (e) => { drawing = true; inked = true; last = pos(e); canvas.setPointerCapture(e.pointerId); });
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
      canvas.addEventListener('pointerup', () => { drawing = false; });

      clearBtn.addEventListener('click', () => { x.clearRect(0, 0, canvas.width, canvas.height); inked = false; });

      return {
        el: wrap,
        result: () => {
          if (!inked) return null;
          // trim to ink bounds
          const d = x.getImageData(0, 0, canvas.width, canvas.height).data;
          let minX = canvas.width, minY = canvas.height, maxX = 0, maxY = 0;
          for (let yy = 0; yy < canvas.height; yy++) {
            for (let xx = 0; xx < canvas.width; xx++) {
              if (d[(yy * canvas.width + xx) * 4 + 3] > 10) {
                if (xx < minX) minX = xx; if (xx > maxX) maxX = xx;
                if (yy < minY) minY = yy; if (yy > maxY) maxY = yy;
              }
            }
          }
          if (maxX <= minX || maxY <= minY) return null;
          const pad = 6, w = maxX - minX + pad * 2, h = maxY - minY + pad * 2;
          const out = document.createElement('canvas');
          out.width = w; out.height = h;
          out.getContext('2d').drawImage(canvas, minX - pad, minY - pad, w, h, 0, 0, w, h);
          return out.toDataURL('image/png');
        }
      };
    }

    async function startSignFlow() {
      const pad = signaturePad();
      const dataUrl = await ctx.openModal('Add signature', pad.el, [
        { label: 'Cancel', value: null },
        { label: 'Add to page', primary: true, value: () => pad.result() }
      ]);
      if (!dataUrl) return;
      ctx.toast('Click on the page where the signature should go');
      placeMode(dataUrl);
    }

    function placeMode(dataUrl) {
      scroll.classList.add('placing');
      const once = (e) => {
        const pageEl = e.target.closest('.pdf-page');
        scroll.classList.remove('placing');
        scroll.removeEventListener('click', once, true);
        if (!pageEl) return;
        e.preventDefault(); e.stopPropagation();
        spawnFloat(Number(pageEl.dataset.i), dataUrl, e);
      };
      scroll.addEventListener('click', once, true);
    }

    function spawnFloat(pageIndex, dataUrl, clickEvent) {
      const pv = pageViews[pageIndex];
      const rect = pv.el.getBoundingClientRect();
      const img = new Image();
      img.onload = () => {
        const pw = pv.el.clientWidth;
        let w = Math.min(pw * 0.32, img.naturalWidth);
        let h = w * (img.naturalHeight / img.naturalWidth);
        let x = (clickEvent.clientX - rect.left) - w / 2;
        let y = (clickEvent.clientY - rect.top) - h / 2;

        const float = document.createElement('div');
        float.className = 'sig-float';
        float.innerHTML =
          `<img src="${dataUrl}" draggable="false">` +
          `<div class="sig-actions"><button class="sig-ok" title="Apply">✓</button><button class="sig-no" title="Remove">✕</button></div>` +
          `<div class="sig-handle" title="Resize"></div>`;
        pv.overlay.appendChild(float);

        const clamp = () => {
          x = Math.max(0, Math.min(x, pv.el.clientWidth - w));
          y = Math.max(0, Math.min(y, pv.el.clientHeight - h));
          float.style.left = x + 'px'; float.style.top = y + 'px';
          float.style.width = w + 'px'; float.style.height = h + 'px';
        };
        clamp();

        let drag = null;
        float.addEventListener('pointerdown', (e) => {
          if (e.target.closest('.sig-actions')) return;
          const resize = !!e.target.closest('.sig-handle');
          drag = { sx: e.clientX, sy: e.clientY, ox: x, oy: y, ow: w, oh: h, resize };
          float.setPointerCapture(e.pointerId);
          e.preventDefault();
        });
        float.addEventListener('pointermove', (e) => {
          if (!drag) return;
          if (drag.resize) {
            const f = Math.max(0.15, (drag.ow + (e.clientX - drag.sx)) / drag.ow);
            w = drag.ow * f; h = drag.oh * f;
          } else {
            x = drag.ox + (e.clientX - drag.sx);
            y = drag.oy + (e.clientY - drag.sy);
          }
          clamp();
        });
        float.addEventListener('pointerup', () => { drag = null; });

        float.querySelector('.sig-no').addEventListener('click', () => float.remove());
        float.querySelector('.sig-ok').addEventListener('click', () => {
          const plW = pv.el.clientWidth, plH = pv.el.clientHeight;
          addPlacement({
            pageIndex,
            xr: x / plW, yr: y / plH, wr: w / plW, hr: h / plH,
            dataUrl
          });
          float.remove();
        });
      };
      img.src = dataUrl;
    }

    function addPlacement(pl) {
      const pv = pageViews[pl.pageIndex];
      if (!pv || !pv.overlay) return;
      placements.push(pl);
      const el = document.createElement('div');
      el.className = 'sig-placed';
      el.innerHTML = `<img src="${pl.dataUrl}" draggable="false"><button class="sig-no" title="Remove signature">✕</button>`;
      el.style.left = (pl.xr * 100) + '%';
      el.style.top = (pl.yr * 100) + '%';
      el.style.width = (pl.wr * 100) + '%';
      el.style.height = (pl.hr * 100) + '%';
      el.querySelector('.sig-no').addEventListener('click', () => {
        placements = placements.filter((p) => p !== pl);
        el.remove();
        ctx.markDirty();
        updateStatus();
      });
      pv.overlay.appendChild(el);
      ctx.markDirty();
      updateStatus();
      ctx.toast('Signature added — Save to make it permanent');
    }

    /* ---------------- image extraction ---------------- */
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
      if (kind === 3) {                      // RGBA_32BPP
        d.set(data.subarray(0, d.length));
      } else if (kind === 2) {               // RGB_24BPP
        for (let i = 0, j = 0; j < d.length; i += 3, j += 4) {
          d[j] = data[i]; d[j + 1] = data[i + 1]; d[j + 2] = data[i + 2]; d[j + 3] = 255;
        }
      } else if (kind === 1) {               // GRAYSCALE_1BPP
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
      const seen = new Set();
      for (let p = 1; p <= pdf.numPages && found.length < 60; p++) {
        if (onProgress) onProgress(p, pdf.numPages);
        let page, ops;
        try {
          page = await pdf.getPage(p);
          ops = await page.getOperatorList();
        } catch { continue; }
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
        summary.textContent = `Found ${images.length} image${images.length === 1 ? '' : 's'} across pages`;

        const exportAllBtn = document.createElement('button');
        exportAllBtn.className = 'btn ghost';
        exportAllBtn.textContent = '📁 Export All to Folder…';
        exportAllBtn.addEventListener('click', async () => {
          const res = await window.margo.exportImagesFolder({
            images: images.map((im, idx) => ({
              dataUrl: im.canvas.toDataURL('image/png'),
              name: `pdf-image-${idx + 1}.png`
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
          meta.textContent = `${im.w} × ${im.h} · p.${im.page}`;
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
    }

    /* ---------- find (no replace) ---------- */
    function clearFindMarks() {
      pageViews.forEach((pv) => {
        pv.overlay.querySelectorAll('.pdf-find-hit').forEach((el) => el.remove());
      });
    }

    function itemCssRect(pv, item) {
      const Util = pdfjsLib.Util;
      const vp = pv.page.getViewport({ scale: cssScale });
      const tx = Util.transform(vp.transform, item.transform);
      const fontH = Math.hypot(tx[2], tx[3]) || 12;
      const w = (item.width || 0) * cssScale;
      return {
        left: tx[4],
        top: tx[5] - fontH,
        width: Math.max(w, 4),
        height: fontH
      };
    }

    function updateFindCount() {
      if (!findCountEl) return;
      if (!findHits.length) findCountEl.textContent = findInput && findInput.value.trim() ? '0 matches' : '';
      else findCountEl.textContent = (findIndex + 1) + ' / ' + findHits.length;
    }

    function paintFindHits() {
      clearFindMarks();
      if (findIndex < 0 || !findHits[findIndex]) {
        updateFindCount();
        return;
      }
      const hit = findHits[findIndex];
      const page = textIndex[hit.pageIndex];
      const pv = pageViews[hit.pageIndex];
      if (!page || !pv) return;
      page.items.forEach((it) => {
        if (it.end <= hit.start || it.start >= hit.end) return;
        try {
          const r = itemCssRect(pv, it.item);
          const mark = document.createElement('div');
          mark.className = 'pdf-find-hit current';
          mark.style.left = r.left + 'px';
          mark.style.top = r.top + 'px';
          mark.style.width = r.width + 'px';
          mark.style.height = r.height + 'px';
          pv.overlay.appendChild(mark);
        } catch { /* overlay math can fail on odd text items */ }
      });
      pv.el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      updateFindCount();
    }

    function runFind(query) {
      findHits = [];
      findIndex = -1;
      const q = (query || '').trim();
      if (!q) {
        clearFindMarks();
        updateFindCount();
        return;
      }
      const needle = q.toLowerCase();
      textIndex.forEach((p) => {
        const t = p.text.toLowerCase();
        let start = 0, idx;
        while ((idx = t.indexOf(needle, start)) !== -1) {
          findHits.push({ pageIndex: p.pageIndex, start: idx, end: idx + q.length });
          start = idx + q.length;
        }
      });
      findIndex = findHits.length ? 0 : -1;
      paintFindHits();
    }

    function findNext(dir) {
      if (!findHits.length) return;
      findIndex = (findIndex + dir + findHits.length) % findHits.length;
      paintFindHits();
    }

    function closeFind() {
      findOpen = false;
      if (findBar) findBar.classList.add('hidden');
      findHits = [];
      findIndex = -1;
      clearFindMarks();
      updateFindCount();
    }

    async function openFind() {
      ensureFindBar();
      findOpen = true;
      findBar.classList.remove('hidden');
      if (textIndexPromise) await textIndexPromise;
      setTimeout(() => { if (findInput) { findInput.focus(); findInput.select(); } }, 30);
      if (findInput && findInput.value) runFind(findInput.value);
    }

    function ensureFindBar() {
      if (!host || findBar) return;
      findBar = document.createElement('div');
      findBar.className = 'doc-find-bar hidden';
      findBar.innerHTML =
        `<div class="doc-find-row">` +
          `<input type="search" class="doc-find-input" placeholder="Find in PDF…" aria-label="Find">` +
          `<span class="doc-find-count"></span>` +
          `<button type="button" class="icon-btn doc-find-prev" title="Previous (Shift+Enter)">▲</button>` +
          `<button type="button" class="icon-btn doc-find-next" title="Next (Enter)">▼</button>` +
          `<button type="button" class="icon-btn doc-find-close" title="Close (Esc)">${window.MargoIcons.close}</button>` +
        `</div>`;
      host.appendChild(findBar);
      findInput = findBar.querySelector('.doc-find-input');
      findCountEl = findBar.querySelector('.doc-find-count');
      findBar.querySelector('.doc-find-prev').addEventListener('click', () => findNext(-1));
      findBar.querySelector('.doc-find-next').addEventListener('click', () => findNext(1));
      findBar.querySelector('.doc-find-close').addEventListener('click', closeFind);
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

    function onHostKeydown(e) {
      if (e.key === 'Escape' && findOpen) {
        e.preventDefault();
        closeFind();
      }
    }

    /* ---------------- toolbar ---------------- */
    function buildToolbar() {
      const tb = ctx.toolbar;
      tb.innerHTML = '';
      const I = window.MargoIcons;
      const btn = (title, html, fn) => {
        const b = document.createElement('button');
        b.className = 'icon-btn'; b.title = title; b.innerHTML = html;
        b.addEventListener('click', fn);
        tb.appendChild(b);
        return b;
      };
      const labeled = (label, icon, fn) => {
        const b = document.createElement('button');
        b.className = 'tb-btn-labeled';
        b.innerHTML = icon + `<span>${label}</span>`;
        b.addEventListener('click', fn);
        tb.appendChild(b);
        return b;
      };
      const sep = () => { const s = document.createElement('span'); s.className = 'tb-sep'; tb.appendChild(s); };

      btn('Zoom out', I.zoomOut, () => zoomBy(1 / 1.2));
      zoomLabel = document.createElement('span');
      zoomLabel.className = 'pdf-zoom-label';
      zoomLabel.textContent = '100%';
      tb.appendChild(zoomLabel);
      btn('Zoom in', I.zoomIn, () => zoomBy(1.2));
      btn('Fit width', I.fit, () => { zoom = 1; applyScale(); });
      sep();
      labeled('Sign', I.pen, startSignFlow);
      labeled('Images', I.image, showImagesPanel);
      sep();
      btn('Find (Ctrl+F)', I.search, () => openFind());

      const spacer = document.createElement('span'); spacer.className = 'tb-spacer'; tb.appendChild(spacer);
      const hint = document.createElement('span');
      hint.className = 'tb-hint';
      hint.textContent = 'Signatures are burned into the file on save';
      tb.appendChild(hint);
    }

    return {
      kind: 'pdf',
      async mount(hostEl, doc) {
        host = hostEl;
        buildToolbar();
        host.innerHTML = `<div class="pdf-scroll"></div>`;
        scroll = host.querySelector('.pdf-scroll');
        scroll.addEventListener('scroll', () => { updateStatus(); });
        scroll.addEventListener('wheel', onCtrlWheel, { passive: false });
        ctx.setStatus('Opening PDF…', 'PDF');
        loadedFromPath = !!(doc.path);
        let raw = null;
        if (doc.bytes && (doc.bytes.byteLength || doc.bytes.length)) {
          raw = doc.bytes;
        } else if (doc.base64) {
          raw = fromB64(doc.base64);
        } else if (doc.path) {
          raw = await window.margo.readBinary(doc.path);
        } else {
          throw new Error('No PDF to open');
        }
        bytes = toBytes(raw);
        host.addEventListener('keydown', onHostKeydown);
        await loadDocument(bytes);
        if (Array.isArray(doc.placements)) {
          for (const pl of doc.placements) {
            if (pl && typeof pl.pageIndex === 'number' && pl.dataUrl) addPlacement(pl);
          }
        }
        findBar = null;
        ensureFindBar();
      },
      getDraft() {
        const out = {
          placements: placements.map((p) => ({
            pageIndex: p.pageIndex,
            xr: p.xr, yr: p.yr, wr: p.wr, hr: p.hr,
            dataUrl: p.dataUrl
          }))
        };
        if (!loadedFromPath && bytes) out.base64 = b64(bytes);
        return out;
      },
      async getData() {
        if (!placements.length) return { base64: b64(bytes), bytes };
        const pdfDoc = await PDFLib.PDFDocument.load(bytes);
        for (const pl of placements) {
          const page = pdfDoc.getPage(pl.pageIndex);
          const png = await pdfDoc.embedPng(pl.dataUrl);
          const pw = page.getWidth(), ph = page.getHeight();
          page.drawImage(png, {
            x: pl.xr * pw,
            y: ph - (pl.yr + pl.hr) * ph,
            width: pl.wr * pw,
            height: pl.hr * ph
          });
        }
        const out = await pdfDoc.save();
        return { base64: b64(out), bytes: out };
      },
      async onSaved(data) {
        loadedFromPath = true;
        if (!data || !data.bytes || !placements.length) { updateStatus(); return; }
        bytes = toBytes(data.bytes);
        placements = [];
        await loadDocument(bytes);
      },
      focus() { scroll && scroll.focus(); },
      commands: {
        zoomIn: () => zoomBy(1.2),
        zoomOut: () => zoomBy(1 / 1.2),
        zoomReset: () => { zoom = 1; applyScale(); },
        showImages: () => showImagesPanel(),
        find: () => openFind()
      },
      destroy() {
        destroyed = true;
        if (host) host.removeEventListener('keydown', onHostKeydown);
        if (scroll) scroll.removeEventListener('wheel', onCtrlWheel);
        if (observer) observer.disconnect();
        closeFind();
        if (pdf) { try { pdf.destroy(); } catch {} }
      },
      _test: {
        numPages: () => (pdf ? pdf.numPages : 0),
        firstPageRendered: () => !!(pageViews[0] && pageViews[0].rendered && pageViews[0].canvas.width > 50),
        firstPageError: () => (pageViews[0] && pageViews[0].error) || '',
        extract: () => extractImages(),
        placementsCount: () => placements.length,
        addTestSignature: (dataUrl) => addPlacement({ pageIndex: 0, xr: 0.55, yr: 0.75, wr: 0.3, hr: 0.1, dataUrl })
      }
    };
  }

  window.MargoEditors = window.MargoEditors || {};
  window.MargoEditors.pdf = create;
  window.MargoEditors.blankPdfBytes = blankPdfBytes;
})();
