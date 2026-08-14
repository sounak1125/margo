/* Margo — first-page typed thumbnails for the sidebar library (SVG → HiDPI PNG). */
(function () {
  const W = 440, H = 568;           // 2× stored pixels (portrait card)
  const PAGE_W = 640;               // virtual page width inside foreignObject
  const INNER = { x: 28, y: 36, w: W - 56, h: H - 72 };

  const KINDS = {
    md: { accent: '#f2b40a', soft: '#fdf1cf', label: 'MD', ink: '#8a6400' },
    doc: { accent: '#4c86e8', soft: 'rgba(76,134,232,0.14)', label: 'DOC', ink: '#2a5bb8' },
    sheet: { accent: '#2f9463', soft: 'rgba(52,160,107,0.14)', label: 'XLS', ink: '#1f6b46' },
    pdf: { accent: '#e0554a', soft: 'rgba(224,85,74,0.12)', label: 'PDF', ink: '#b33830' }
  };

  function thumbCss(kind) {
    const k = KINDS[kind] || KINDS.md;
    const scale = INNER.w / PAGE_W;
    return `
    * { margin: 0; padding: 0; box-sizing: border-box; }
    .card { width: ${W}px; height: ${H}px; background: #f3f2ef; font-family: 'Segoe UI', system-ui, sans-serif; }
    .frame {
      position: absolute; left: 14px; top: 14px; right: 14px; bottom: 14px;
      background: #ffffff; border-radius: 10px; border: 1px solid #e4e4e0;
      box-shadow: 0 1px 2px rgba(20,20,15,0.06), 0 10px 28px rgba(20,20,15,0.08);
      overflow: hidden;
    }
    .accent { position: absolute; left: 0; top: 0; bottom: 0; width: 6px; background: ${k.accent}; }
    .badge {
      position: absolute; top: 12px; right: 12px; z-index: 2;
      font-size: 11px; font-weight: 700; letter-spacing: 0.06em;
      color: ${k.ink}; background: ${k.soft}; border-radius: 6px; padding: 3px 7px;
    }
    .tpage {
      position: absolute; left: ${INNER.x - 14}px; top: ${INNER.y - 14}px;
      width: ${PAGE_W}px; padding: 36px 40px; background: #ffffff; color: #1d1d1f;
      font-size: 15px; line-height: 1.55;
      transform: scale(${scale}); transform-origin: top left;
      height: ${(INNER.h / scale)}px; overflow: hidden;
    }
    h1 { font-size: 26px; margin: 0 0 12px; font-weight: 700; }
    h2 { font-size: 20px; margin: 14px 0 8px; font-weight: 700; }
    h3 { font-size: 16px; margin: 12px 0 6px; font-weight: 600; }
    p, ul, ol, pre, blockquote, table { margin-bottom: 9px; }
    ul, ol { padding-left: 22px; }
    code, pre { font-family: Consolas, monospace; font-size: 13px; background: #f2f2f0; border-radius: 4px; }
    pre { padding: 8px 10px; overflow: hidden; }
    code { padding: 1px 4px; }
    blockquote { border-left: 3px solid ${k.accent}; padding-left: 10px; color: #6e6e73; }
    table { border-collapse: collapse; font-size: 13px; }
    td, th { border: 1px solid #d9d9d6; padding: 3px 8px; }
    img { max-width: 100%; }
    a { color: ${k.ink}; text-decoration: none; }`;
  }

  function framedSvg(kind, innerHtml) {
    const k = KINDS[kind] || KINDS.md;
    return (
      `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">` +
      `<foreignObject width="100%" height="100%">` +
      `<div xmlns="http://www.w3.org/1999/xhtml" class="card" style="position:relative;width:${W}px;height:${H}px;background:#f3f2ef;font-family:'Segoe UI',system-ui,sans-serif">` +
      `<style>${thumbCss(kind)}</style>` +
      `<div class="frame">` +
      `<div class="accent"></div>` +
      `<div class="badge">${k.label}</div>` +
      `<div class="tpage">${innerHtml}</div>` +
      `</div></div></foreignObject></svg>`
    );
  }

  function stripRemoteImages(html) {
    const div = document.createElement('div');
    div.innerHTML = html;
    div.querySelectorAll('img').forEach((img) => {
      if (!/^data:/.test(img.getAttribute('src') || '')) img.remove();
    });
    return div.innerHTML;
  }

  function firstDocPageHtml(html) {
    const wrap = document.createElement('div');
    wrap.innerHTML = DOMPurify.sanitize(html || '<p></p>');
    const parts = [];
    let bucket = [];
    const flush = () => {
      const d = document.createElement('div');
      bucket.forEach((n) => d.appendChild(n));
      parts.push(d.innerHTML);
      bucket = [];
    };
    Array.from(wrap.childNodes).forEach((node) => {
      if (node.nodeType === 1 && node.hasAttribute && node.hasAttribute('data-margo-page-break')) flush();
      else bucket.push(node);
    });
    flush();
    return parts[0] || '<p></p>';
  }

  function svgToPng(svgMarkup) {
    return new Promise((resolve) => {
      const img = new Image();
      const done = (url) => resolve(url);
      img.onload = () => {
        try {
          const c = document.createElement('canvas');
          c.width = W; c.height = H;
          const ctx = c.getContext('2d');
          ctx.fillStyle = '#f3f2ef';
          ctx.fillRect(0, 0, W, H);
          ctx.drawImage(img, 0, 0);
          done(c.toDataURL('image/png'));
        } catch { done(null); }
      };
      img.onerror = () => done(null);
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgMarkup);
      setTimeout(() => done(null), 3500);
    });
  }

  async function htmlThumb(kind, html) {
    const clean = stripRemoteImages(DOMPurify.sanitize(html || '<p></p>'));
    return svgToPng(framedSvg(kind, clean));
  }

  function escapeXml(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function sheetThumb(sheets, active) {
    const sheet = (sheets && sheets[active || 0]) || { rows: [] };
    const k = KINDS.sheet;
    const cols = 5, rowsN = 10;
    const gx = 36, gy = 52, gw = W - 72, gh = H - 100;
    const headH = 22, rowH = (gh - headH) / rowsN, colW = gw / cols;
    let cells = '';
    for (let c = 0; c < cols; c++) {
      const x = gx + c * colW;
      cells += `<text x="${x + colW / 2}" y="${gy + headH / 2 + 1}" text-anchor="middle" dominant-baseline="middle" fill="#6e6e73" font-size="11" font-weight="600" font-family="Segoe UI,system-ui,sans-serif">${String.fromCharCode(65 + c)}</text>`;
    }
    for (let r = 0; r < rowsN; r++) {
      const row = (sheet.rows && sheet.rows[r]) || [];
      for (let c = 0; c < cols; c++) {
        const v = row[c] != null ? String(row[c]) : '';
        if (!v) continue;
        const x = gx + c * colW + 6;
        const y = gy + headH + r * rowH + rowH / 2 + 1;
        cells += `<text x="${x}" y="${y}" dominant-baseline="middle" fill="${r === 0 ? '#1d1d1f' : '#48484c'}" font-size="11" font-weight="${r === 0 ? 600 : 400}" font-family="Segoe UI,system-ui,sans-serif">${escapeXml(v.slice(0, 10))}</text>`;
      }
    }
    let gridLines = '';
    for (let i = 0; i <= cols; i++) {
      const x = gx + i * colW;
      gridLines += `<line x1="${x}" y1="${gy}" x2="${x}" y2="${gy + gh}" stroke="#e4e4e1" stroke-width="1"/>`;
    }
    for (let i = 0; i <= rowsN; i++) {
      const y = gy + headH + i * rowH;
      gridLines += `<line x1="${gx}" y1="${y}" x2="${gx + gw}" y2="${y}" stroke="#e4e4e1" stroke-width="1"/>`;
    }
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">` +
      `<rect width="100%" height="100%" fill="#f3f2ef"/>` +
      `<rect x="14" y="14" width="${W - 28}" height="${H - 28}" rx="10" fill="#ffffff" stroke="#e4e4e0"/>` +
      `<rect x="14" y="14" width="6" height="${H - 28}" rx="3" fill="${k.accent}"/>` +
      `<rect x="${W - 62}" y="26" width="36" height="22" rx="6" fill="${k.soft}"/>` +
      `<text x="${W - 44}" y="41" text-anchor="middle" fill="${k.ink}" font-size="11" font-weight="700" font-family="Segoe UI,system-ui,sans-serif">${k.label}</text>` +
      `<rect x="${gx}" y="${gy}" width="${gw}" height="${headH}" fill="#f4f4f2"/>` +
      gridLines + cells +
      `</svg>`;
    return svgToPng(svg);
  }

  async function pdfThumb(bytes) {
    if (!window.pdfjsLib) return null;
    try {
      const doc = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
      const page = await doc.getPage(1);
      const vp1 = page.getViewport({ scale: 1 });
      const scale = (INNER.w * 1.5) / vp1.width;
      const vp = page.getViewport({ scale });
      const c = document.createElement('canvas');
      c.width = Math.ceil(vp.width);
      c.height = Math.ceil(vp.height);
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, c.width, c.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      const pageUrl = c.toDataURL('image/png');
      doc.destroy();

      const k = KINDS.pdf;
      const drawW = INNER.w;
      const drawH = Math.min(INNER.h, Math.round(c.height * (drawW / c.width)));
      const svg =
        `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">` +
        `<rect width="100%" height="100%" fill="#f3f2ef"/>` +
        `<rect x="14" y="14" width="${W - 28}" height="${H - 28}" rx="10" fill="#ffffff" stroke="#e4e4e0"/>` +
        `<rect x="14" y="14" width="6" height="${H - 28}" rx="3" fill="${k.accent}"/>` +
        `<rect x="${W - 62}" y="26" width="36" height="22" rx="6" fill="${k.soft}"/>` +
        `<text x="${W - 44}" y="41" text-anchor="middle" fill="${k.ink}" font-size="11" font-weight="700" font-family="Segoe UI,system-ui,sans-serif">${k.label}</text>` +
        `<image href="${pageUrl}" x="${INNER.x}" y="${INNER.y}" width="${drawW}" height="${drawH}" preserveAspectRatio="xMidYMin meet"/>` +
        `</svg>`;
      return svgToPng(svg);
    } catch { return null; }
  }

  /* Generate + persist a thumbnail for a saved document. data = editor data (fresh) */
  async function generate(doc, data) {
    if (!doc || !doc.path) return null;
    try {
      let url = null;
      if (doc.kind === 'md') {
        url = await htmlThumb('md', marked.parse((data && data.markdown) ?? doc.markdown ?? ''));
      } else if (doc.kind === 'doc') {
        const full = (data && data.html) ?? doc.html ?? '';
        url = await htmlThumb('doc', firstDocPageHtml(full));
      } else if (doc.kind === 'sheet') {
        const d = data || doc;
        url = await sheetThumb(d.sheets, d.active);
      } else if (doc.kind === 'pdf') {
        const bytes = data && data.bytes ? data.bytes : await window.margo.readBinary(doc.path);
        url = await pdfThumb(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
      }
      if (url) await window.margo.setThumb(doc.path, url);
      return url;
    } catch { return null; }
  }

  /* PNG data URL → JPEG data URL for DOCX package thumbnails */
  function toJpegDataUrl(pngDataUrl, quality) {
    return new Promise((resolve) => {
      if (!pngDataUrl) return resolve(null);
      if (/^data:image\/jpe?g;/i.test(pngDataUrl)) return resolve(pngDataUrl);
      const img = new Image();
      img.onload = () => {
        try {
          const c = document.createElement('canvas');
          c.width = img.width;
          c.height = img.height;
          const ctx = c.getContext('2d');
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, c.width, c.height);
          ctx.drawImage(img, 0, 0);
          resolve(c.toDataURL('image/jpeg', quality == null ? 0.85 : quality));
        } catch { resolve(null); }
      };
      img.onerror = () => resolve(null);
      img.src = pngDataUrl;
    });
  }

  /* Build a JPEG thumb for embedding into a DOCX without requiring a path yet */
  async function jpegForDoc(doc, data) {
    try {
      let png = null;
      if (doc.kind === 'doc') {
        png = await htmlThumb('doc', firstDocPageHtml((data && data.html) ?? doc.html ?? ''));
      } else if (doc.kind === 'md') {
        png = await htmlThumb('md', marked.parse((data && data.markdown) ?? doc.markdown ?? ''));
      }
      return toJpegDataUrl(png);
    } catch { return null; }
  }

  window.MargoThumbs = { generate, toJpegDataUrl, jpegForDoc };
})();
