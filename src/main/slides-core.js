/* Margo — presentation core, shared by the main process (PPTX + PDF export)
   and the renderer (editor, rail thumbnails, slideshow, library thumbnails).

   A deck is plain JSON:
     { version, theme, customTheme?, size: { w, h }, slides: [slide] }
     slide   = { id, layout, background: null | { color } | { image }, notes, elements: [el] }
     el      = { id, type: 'text' | 'shape' | 'image', x, y, w, h, rot }
       text  + { role, prompt, font, size, color, valign, fill, stroke, strokeWidth, shape,
                 spacing, paragraphs: [{ align, list, level, runs: [{ text, b, i, u, color, size, font }] }] }
       shape + { shape, fill, stroke, strokeWidth, radius, flipH, flipV }
       image + { src, nw, nh, fit, crop }
   Geometry is in CSS pixels on a 96 dpi slide (1280 x 720 is 13.333 x 7.5 in,
   PowerPoint's widescreen size). Font sizes are points, as PowerPoint has them.
   Colours are '#rrggbb' or a theme token ('accent', 'title', 'text', ...),
   so a deck re-colours itself when its theme changes. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MargoSlidesCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const DEFAULT_SIZE = { w: 1280, h: 720 };
  const PX_PER_IN = 96;
  const PAD_X = 9.6;   // PowerPoint's default text inset: 0.1 in
  const PAD_Y = 4.8;   // and 0.05 in
  const BULLET_INDENT_PT = 27;
  const BULLET_CHARS = ['\u2022', '\u2013', '\u25E6', '\u2022', '\u2013'];

  const THEMES = [
    {
      id: 'margo', name: 'Margo',
      bg: '#ffffff', title: '#1a1a1e', text: '#3a3a42', muted: '#6b6b74',
      accent: '#e3a008', accent2: '#1f2937',
      sectionBg: '#1a1a1e', sectionTitle: '#ffffff', sectionText: '#c9c9cf',
      titleFont: 'Segoe UI', bodyFont: 'Segoe UI', titleBold: true
    },
    {
      id: 'midnight', name: 'Midnight',
      bg: '#0f172a', title: '#f8fafc', text: '#cbd5e1', muted: '#94a3b8',
      accent: '#38bdf8', accent2: '#818cf8',
      sectionBg: '#1e293b', sectionTitle: '#f8fafc', sectionText: '#94a3b8',
      titleFont: 'Segoe UI', bodyFont: 'Segoe UI', titleBold: true
    },
    {
      id: 'editorial', name: 'Editorial',
      bg: '#f7f3ec', title: '#231f1a', text: '#4a443c', muted: '#857b6f',
      accent: '#b4532a', accent2: '#2f4f4f',
      sectionBg: '#231f1a', sectionTitle: '#f7f3ec', sectionText: '#c8bfb2',
      titleFont: 'Georgia', bodyFont: 'Georgia', titleBold: false
    },
    {
      id: 'evergreen', name: 'Evergreen',
      bg: '#12352d', title: '#f4f1e8', text: '#d3e2d9', muted: '#9db8ab',
      accent: '#e8b04b', accent2: '#7cc6a4',
      sectionBg: '#e8b04b', sectionTitle: '#12352d', sectionText: '#2d4f45',
      titleFont: 'Trebuchet MS', bodyFont: 'Trebuchet MS', titleBold: true
    },
    {
      id: 'sunset', name: 'Sunset',
      bg: '#fff7f2', title: '#3d1a24', text: '#5c3a42', muted: '#9b7a80',
      accent: '#f0643c', accent2: '#7b2d43',
      sectionBg: '#f0643c', sectionTitle: '#ffffff', sectionText: '#ffe3d8',
      titleFont: 'Calibri', bodyFont: 'Calibri', titleBold: true
    },
    {
      id: 'swiss', name: 'Swiss',
      bg: '#ffffff', title: '#000000', text: '#222222', muted: '#6b6b6b',
      accent: '#e11d48', accent2: '#111111',
      sectionBg: '#111111', sectionTitle: '#ffffff', sectionText: '#bdbdbd',
      titleFont: 'Arial', bodyFont: 'Arial', titleBold: true
    }
  ];
  const THEME_TOKENS = ['bg', 'title', 'text', 'muted', 'accent', 'accent2'];

  const LAYOUTS = [
    { id: 'title', name: 'Title' },
    { id: 'title-content', name: 'Title and Content' },
    { id: 'two-content', name: 'Two Content' },
    { id: 'section', name: 'Section Header' },
    { id: 'title-only', name: 'Title Only' },
    { id: 'image-caption', name: 'Picture with Caption' },
    { id: 'blank', name: 'Blank' }
  ];

  const SERIF = /georgia|times|cambria|garamond|palatino|book|serif|baskerville|didot|constantia/i;
  const MONO = /consolas|courier|mono|menlo/i;

  let seq = 0;
  function uid(prefix) {
    seq = (seq + 1) % 1e6;
    return (prefix || 'e') + Date.now().toString(36).slice(-5) + Math.random().toString(36).slice(2, 7) + seq.toString(36);
  }

  function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function num(v, d) {
    if (v == null || v === '') return d;
    const n = Number(v);
    return Number.isFinite(n) ? n : d;
  }
  function round2(n) { return Math.round(n * 100) / 100; }

  function normHex(v) {
    if (!v) return null;
    let s = String(v).trim().toLowerCase();
    if (s[0] !== '#') s = '#' + s;
    if (/^#[0-9a-f]{3}$/.test(s)) s = '#' + s[1] + s[1] + s[2] + s[2] + s[3] + s[3];
    return /^#[0-9a-f]{6}$/.test(s) ? s : null;
  }

  /* ---------------- themes ---------------- */
  function themeOf(deck) {
    if (deck && deck.theme === 'custom' && deck.customTheme) {
      const base = THEMES[0];
      return Object.assign({}, base, deck.customTheme, { id: 'custom', name: deck.customTheme.name || 'Imported' });
    }
    return THEMES.find((t) => t.id === (deck && deck.theme)) || THEMES[0];
  }
  function themeList(deck) {
    const list = THEMES.slice();
    if (deck && deck.customTheme) list.unshift(themeOf(Object.assign({}, deck, { theme: 'custom' })));
    return list;
  }
  function resolveColor(deck, value, slide) {
    if (value == null || value === '' || value === 'none') return null;
    const hex = normHex(value);
    if (hex) return hex;
    const t = themeOf(deck);
    if (slide && slide.layout === 'section') {
      if (value === 'title') return t.sectionTitle;
      if (value === 'text' || value === 'muted') return t.sectionText;
    }
    return normHex(t[value]) || null;
  }
  /* A CSS font-family list. Single quotes and no characters that need
     escaping, so the same string works in a style="" attribute of generated
     HTML and in element.setAttribute('style', ...). */
  function fontCss(name) {
    const n = String(name || 'Segoe UI').replace(/["'\\<>&;{}]/g, '').trim() || 'Segoe UI';
    const fallback = SERIF.test(n) ? "Georgia, 'Times New Roman', serif"
      : MONO.test(n) ? "Consolas, 'Courier New', monospace"
        : "system-ui, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
    return `'${n}', ${fallback}`;
  }

  /* ---------------- effective text styles ---------------- */
  const ROLE_SIZE = { title: 40, subtitle: 24, body: 24, caption: 18 };

  function textDefaults(deck, slide, el) {
    const t = themeOf(deck);
    const role = el.role || null;
    const isTitle = role === 'title';
    const font = el.font || (isTitle ? t.titleFont : t.bodyFont);
    const size = num(el.size, ROLE_SIZE[role] || 20);
    const colorToken = el.color || (isTitle ? 'title' : role === 'subtitle' || role === 'caption' ? 'muted' : 'text');
    const color = resolveColor(deck, colorToken, slide) || t.text;
    const bold = isTitle ? !!t.titleBold : false;
    return { font, size, color, bold };
  }

  function runStyle(deck, slide, el, run) {
    const d = textDefaults(deck, slide, el);
    return {
      font: run.font || d.font,
      size: num(run.size, d.size),
      color: resolveColor(deck, run.color, slide) || d.color,
      b: run.b == null ? d.bold : !!run.b,
      i: !!run.i,
      u: !!run.u
    };
  }

  /* ---------------- factories ---------------- */
  function para(text, extra) {
    return Object.assign({ align: 'left', list: null, level: 0, runs: [{ text: text || '' }] }, extra || {});
  }

  function textEl(props) {
    return Object.assign({
      id: uid('t'), type: 'text', x: 0, y: 0, w: 400, h: 60, rot: 0,
      role: null, prompt: '', font: null, size: null, color: null,
      valign: 'top', fill: null, stroke: null, strokeWidth: 0, shape: 'rect', spacing: 0,
      paragraphs: [para('')]
    }, props);
  }
  function shapeEl(props) {
    return Object.assign({
      id: uid('s'), type: 'shape', shape: 'rect', x: 0, y: 0, w: 200, h: 120, rot: 0,
      fill: 'accent', stroke: null, strokeWidth: 2, radius: 16, flipH: false, flipV: false
    }, props);
  }
  function imageEl(props) {
    return Object.assign({
      id: uid('i'), type: 'image', src: '', x: 0, y: 0, w: 400, h: 300, rot: 0,
      nw: 0, nh: 0, fit: 'stretch', crop: null
    }, props);
  }

  function layoutElements(layoutId, size) {
    const W = size.w, H = size.h;
    const sx = W / 1280, sy = H / 720;
    const R = (x, y, w, h) => ({ x: Math.round(x * sx), y: Math.round(y * sy), w: Math.round(w * sx), h: Math.round(h * sy) });
    const title = (box, extra) => textEl(Object.assign(R(...box), { role: 'title', prompt: 'Click to add title', valign: 'bottom' }, extra));
    const body = (box, extra) => textEl(Object.assign(R(...box), {
      role: 'body', prompt: 'Click to add text', spacing: 10,
      paragraphs: [para('', { list: 'bullet' })]
    }, extra));
    switch (layoutId) {
      case 'title':
        return [
          title([96, 196, 1088, 190], { size: 54 }),
          shapeEl(Object.assign(R(106, 404, 88, 6), { fill: 'accent', stroke: null, radius: 3, shape: 'roundRect' })),
          textEl(Object.assign(R(96, 430, 1088, 110), { role: 'subtitle', prompt: 'Click to add subtitle', size: 24 }))
        ];
      case 'title-content':
        return [title([80, 40, 1120, 110]), body([80, 172, 1120, 490])];
      case 'two-content':
        return [title([80, 40, 1120, 110]), body([80, 172, 540, 490]), body([660, 172, 540, 490])];
      case 'section':
        return [
          title([96, 250, 1088, 150], { size: 48 }),
          textEl(Object.assign(R(96, 414, 1088, 90), { role: 'subtitle', prompt: 'Click to add text', size: 22 }))
        ];
      case 'title-only':
        return [title([80, 40, 1120, 110])];
      case 'image-caption':
        return [
          title([80, 80, 440, 200], { size: 32 }),
          textEl(Object.assign(R(80, 300, 440, 340), { role: 'caption', prompt: 'Click to add text', size: 18 })),
          imageEl(Object.assign(R(580, 80, 620, 560), { src: '', fit: 'cover' }))
        ];
      default:
        return [];
    }
  }

  function makeSlide(layoutId, size) {
    const id = LAYOUTS.some((l) => l.id === layoutId) ? layoutId : 'blank';
    return { id: uid('sl'), layout: id, background: null, notes: '', elements: layoutElements(id, size || DEFAULT_SIZE) };
  }

  function newDeck(themeId) {
    const deck = { version: 1, theme: THEMES.some((t) => t.id === themeId) ? themeId : 'margo', size: clone(DEFAULT_SIZE), slides: [] };
    deck.slides.push(makeSlide('title', deck.size));
    return deck;
  }

  /* ---------------- normalization ---------------- */
  /* Pictures are only ever embedded data. A file:// or http(s) URL arriving
     in a document would make the canvas, a PDF export or a thumbnail reach
     out to the disk or the network on the author's behalf. '@xml' is the
     .pptx reader's placeholder for a picture it restores from the slide XML. */
  function safeImageSrc(v) {
    const s = typeof v === 'string' ? v.trim() : '';
    if (s === '@xml') return s;
    return /^data:image\/(png|jpe?g|gif|bmp|webp|svg\+xml);base64,[a-z0-9+/=\s]+$/i.test(s) ? s : '';
  }

  function normRun(r) {
    const out = { text: String((r && r.text) == null ? '' : r.text) };
    if (r && r.b != null) out.b = !!r.b;
    if (r && r.i) out.i = true;
    if (r && r.u) out.u = true;
    if (r && r.color) out.color = String(r.color);
    if (r && Number.isFinite(Number(r.size)) && Number(r.size) > 0) out.size = round2(Number(r.size));
    if (r && r.font) out.font = String(r.font);
    return out;
  }
  function normPara(p) {
    const runs = Array.isArray(p && p.runs) && p.runs.length ? p.runs.map(normRun) : [{ text: '' }];
    const align = ['left', 'center', 'right', 'justify'].includes(p && p.align) ? p.align : 'left';
    const list = p && (p.list === 'bullet' || p.list === 'number') ? p.list : null;
    return { align, list, level: Math.max(0, Math.min(4, Math.round(num(p && p.level, 0)))), runs };
  }
  function normEl(e) {
    if (!e || typeof e !== 'object') return null;
    const base = {
      id: typeof e.id === 'string' && e.id ? e.id : uid(),
      x: num(e.x, 0), y: num(e.y, 0),
      w: Math.max(0, num(e.w, 100)), h: Math.max(0, num(e.h, 100)),
      rot: num(e.rot, 0)
    };
    if (e.type === 'text') {
      return Object.assign(textEl(base), {
        role: e.role || null, prompt: e.prompt || '',
        font: e.font || null, size: e.size != null && num(e.size, 0) > 0 ? num(e.size, 0) : null,
        color: e.color || null,
        valign: ['top', 'middle', 'bottom'].includes(e.valign) ? e.valign : 'top',
        fill: e.fill || null, stroke: e.stroke || null, strokeWidth: Math.max(0, num(e.strokeWidth, 0)),
        shape: ['rect', 'roundRect', 'ellipse'].includes(e.shape) ? e.shape : 'rect',
        spacing: Math.max(0, num(e.spacing, 0)),
        paragraphs: Array.isArray(e.paragraphs) && e.paragraphs.length ? e.paragraphs.map(normPara) : [para('')]
      });
    }
    if (e.type === 'shape') {
      return Object.assign(shapeEl(base), {
        shape: SHAPES.includes(e.shape) ? e.shape : 'rect',
        fill: e.fill || null, stroke: e.stroke || null,
        strokeWidth: Math.max(0, num(e.strokeWidth, 2)), radius: Math.max(0, num(e.radius, 16)),
        flipH: !!e.flipH, flipV: !!e.flipV
      });
    }
    if (e.type === 'image') {
      const crop = e.crop && typeof e.crop === 'object'
        ? { l: num(e.crop.l, 0), t: num(e.crop.t, 0), r: num(e.crop.r, 0), b: num(e.crop.b, 0) } : null;
      return Object.assign(imageEl(base), {
        src: safeImageSrc(e.src),
        nw: num(e.nw, 0), nh: num(e.nh, 0),
        fit: e.fit === 'cover' ? 'cover' : 'stretch', crop
      });
    }
    return null;
  }
  const SHAPES = ['rect', 'roundRect', 'ellipse', 'triangle', 'diamond', 'line', 'arrow'];

  function normalizeDeck(raw) {
    const d = raw && typeof raw === 'object' ? raw : {};
    const size = d.size && num(d.size.w, 0) > 0 && num(d.size.h, 0) > 0
      ? { w: Math.round(num(d.size.w, 1280)), h: Math.round(num(d.size.h, 720)) } : clone(DEFAULT_SIZE);
    const deck = {
      version: 1,
      theme: typeof d.theme === 'string' ? d.theme : 'margo',
      size,
      slides: []
    };
    if (d.customTheme && typeof d.customTheme === 'object') deck.customTheme = clone(d.customTheme);
    if (deck.theme === 'custom' && !deck.customTheme) deck.theme = 'margo';
    if (deck.theme !== 'custom' && !THEMES.some((t) => t.id === deck.theme)) deck.theme = 'margo';
    (Array.isArray(d.slides) ? d.slides : []).forEach((s) => {
      if (!s || typeof s !== 'object') return;
      let background = null;
      if (s.background && normHex(s.background.color)) background = { color: normHex(s.background.color) };
      else if (s.background && safeImageSrc(s.background.image)) background = { image: safeImageSrc(s.background.image) };
      deck.slides.push({
        id: typeof s.id === 'string' && s.id ? s.id : uid('sl'),
        layout: typeof s.layout === 'string' ? s.layout : 'blank',
        background,
        notes: typeof s.notes === 'string' ? s.notes : '',
        elements: (Array.isArray(s.elements) ? s.elements : []).map(normEl).filter(Boolean)
      });
    });
    if (!deck.slides.length) deck.slides.push(makeSlide('title', deck.size));
    return deck;
  }

  /* ---------------- text helpers ---------------- */
  function paragraphText(p) {
    return (p.runs || []).map((r) => r.text || '').join('');
  }
  function elementText(el) {
    if (!el || el.type !== 'text') return '';
    return (el.paragraphs || []).map(paragraphText).join('\n');
  }
  function isTextEmpty(el) {
    return !elementText(el).trim();
  }
  function slideTitle(slide) {
    const t = (slide.elements || []).find((e) => e.type === 'text' && e.role === 'title' && !isTextEmpty(e))
      || (slide.elements || []).find((e) => e.type === 'text' && !isTextEmpty(e));
    return t ? elementText(t).split('\n')[0].trim() : '';
  }

  /* ---------------- rendering (static HTML) ---------------- */
  function slideBackground(deck, slide) {
    const t = themeOf(deck);
    if (slide && slide.background && slide.background.image) {
      return { color: t.bg, image: slide.background.image };
    }
    if (slide && slide.background && normHex(slide.background.color)) return { color: normHex(slide.background.color), image: null };
    return { color: slide && slide.layout === 'section' ? t.sectionBg : t.bg, image: null };
  }
  function backgroundCss(deck, slide) {
    const bg = slideBackground(deck, slide);
    let css = `background-color:${bg.color};`;
    if (bg.image) css += `background-image:url("${String(bg.image).replace(/"/g, '%22')}");background-size:cover;background-position:center;`;
    return css;
  }

  function runHtml(deck, slide, el, run) {
    const d = textDefaults(deck, slide, el);
    const st = [];
    if (run.b === true && !d.bold) st.push('font-weight:700');
    if (run.b === false && d.bold) st.push('font-weight:400');
    if (run.i) st.push('font-style:italic');
    if (run.u) st.push('text-decoration:underline');
    const c = resolveColor(deck, run.color, slide);
    if (c) st.push(`color:${c}`);
    if (run.size) st.push(`font-size:${run.size}pt`);
    if (run.font) st.push(`font-family:${fontCss(run.font)}`);
    const text = escapeHtml(run.text || '').replace(/\n/g, '<br>');
    if (!st.length) return text;
    return `<span style="${st.join(';')}">${text}</span>`;
  }

  function paragraphHtml(deck, slide, el, p) {
    const attrs = [];
    const style = [];
    if (p.align && p.align !== 'left') style.push(`text-align:${p.align}`);
    if (p.list) {
      attrs.push(`data-list="${p.list}"`);
      attrs.push(`data-level="${p.level || 0}"`);
      style.push(`--lvl:${p.level || 0}`);
    }
    let inner;
    if (!paragraphText(p)) {
      // An empty paragraph needs a <br> to have a line box (and a caret); it
      // keeps the first run's formatting so typing into it picks that up.
      const first = runHtml(deck, slide, el, Object.assign({}, (p.runs || [])[0] || {}, { text: '' }));
      inner = first ? first.replace('></span>', '><br></span>') : '<br>';
    } else {
      inner = (p.runs || []).map((r) => runHtml(deck, slide, el, r)).join('');
      if (/\n$/.test(paragraphText(p))) inner += '<br>';
    }
    return `<div class="ms-p"${attrs.length ? ' ' + attrs.join(' ') : ''}${style.length ? ` style="${style.join(';')}"` : ''}>${inner}</div>`;
  }

  function textBodyHtml(deck, slide, el) {
    return (el.paragraphs || [para('')]).map((p) => paragraphHtml(deck, slide, el, p)).join('');
  }

  function geomStyle(el) {
    let s = `left:${round2(el.x)}px;top:${round2(el.y)}px;width:${round2(el.w)}px;height:${round2(el.h)}px;`;
    if (el.rot) s += `transform:rotate(${round2(el.rot)}deg);`;
    return s;
  }

  function textBoxStyle(deck, slide, el) {
    const d = textDefaults(deck, slide, el);
    const st = [
      `font-family:${fontCss(d.font)}`,
      `font-size:${d.size}pt`,
      `color:${d.color}`,
      `font-weight:${d.bold ? 700 : 400}`,
      `justify-content:${el.valign === 'middle' ? 'center' : el.valign === 'bottom' ? 'flex-end' : 'flex-start'}`
    ];
    if (el.spacing) st.push(`--psp:${el.spacing}pt`);
    const fill = resolveColor(deck, el.fill, slide);
    const stroke = resolveColor(deck, el.stroke, slide);
    if (fill) st.push(`background:${fill}`);
    if (stroke && el.strokeWidth > 0) st.push(`box-shadow:inset 0 0 0 ${round2(el.strokeWidth)}px ${stroke}`);
    if (el.shape === 'roundRect') st.push(`border-radius:${round2(Math.min(el.w, el.h) * 0.12)}px`);
    else if (el.shape === 'ellipse') st.push('border-radius:50%');
    return st.join(';');
  }

  function lineEnds(el) {
    const x1 = el.flipH ? el.w : 0, y1 = el.flipV ? el.h : 0;
    const x2 = el.flipH ? 0 : el.w, y2 = el.flipV ? 0 : el.h;
    return { x1, y1, x2, y2 };
  }

  function shapeSvg(deck, slide, el) {
    const fill = resolveColor(deck, el.fill, slide);
    const stroke = resolveColor(deck, el.stroke, slide);
    const sw = stroke ? Math.max(0, num(el.strokeWidth, 0)) : 0;
    const w = Math.max(0, el.w), h = Math.max(0, el.h);
    const f = fill ? `fill="${fill}"` : 'fill="none"';
    const s = sw > 0 ? ` stroke="${stroke}" stroke-width="${sw}"` : '';
    let body = '';
    if (el.shape === 'line' || el.shape === 'arrow') {
      const { x1, y1, x2, y2 } = lineEnds(el);
      const lw = Math.max(1, sw || 2);
      const col = stroke || fill || '#000000';
      let ex = x2, ey = y2;
      let head = '';
      if (el.shape === 'arrow') {
        const len = Math.hypot(x2 - x1, y2 - y1) || 1;
        const ux = (x2 - x1) / len, uy = (y2 - y1) / len;
        const hl = Math.min(len * 0.6, Math.max(10, lw * 3.6));
        const hw = hl * 0.55;
        const bx = x2 - ux * hl, by = y2 - uy * hl;
        ex = x2 - ux * hl * 0.8; ey = y2 - uy * hl * 0.8;
        const p = [[x2, y2], [bx - uy * hw, by + ux * hw], [bx + uy * hw, by - ux * hw]]
          .map((q) => q.map(round2).join(',')).join(' ');
        head = `<polygon points="${p}" fill="${col}"/>`;
      }
      body = `<line x1="${round2(x1)}" y1="${round2(y1)}" x2="${round2(ex)}" y2="${round2(ey)}" stroke="${col}" stroke-width="${lw}" stroke-linecap="${el.shape === 'arrow' ? 'butt' : 'round'}"/>` + head;
    } else if (el.shape === 'ellipse') {
      body = `<ellipse cx="${round2(w / 2)}" cy="${round2(h / 2)}" rx="${round2(w / 2)}" ry="${round2(h / 2)}" ${f}${s}/>`;
    } else if (el.shape === 'roundRect') {
      const r = Math.min(num(el.radius, 16), w / 2, h / 2);
      body = `<rect x="0" y="0" width="${round2(w)}" height="${round2(h)}" rx="${round2(r)}" ry="${round2(r)}" ${f}${s}/>`;
    } else if (el.shape === 'triangle') {
      body = `<polygon points="${round2(w / 2)},0 ${round2(w)},${round2(h)} 0,${round2(h)}" ${f}${s} stroke-linejoin="round"/>`;
    } else if (el.shape === 'diamond') {
      body = `<polygon points="${round2(w / 2)},0 ${round2(w)},${round2(h / 2)} ${round2(w / 2)},${round2(h)} 0,${round2(h / 2)}" ${f}${s} stroke-linejoin="round"/>`;
    } else {
      body = `<rect x="0" y="0" width="${round2(w)}" height="${round2(h)}" ${f}${s}/>`;
    }
    return `<svg class="ms-svg" xmlns="http://www.w3.org/2000/svg" width="${round2(Math.max(w, 1))}" height="${round2(Math.max(h, 1))}" overflow="visible">${body}</svg>`;
  }

  /* Crop fractions for an image element: explicit crop, or computed so the
     picture covers its box without distortion. */
  function imageCrop(el) {
    if (el.crop && (el.crop.l || el.crop.t || el.crop.r || el.crop.b)) return el.crop;
    if (el.fit === 'cover' && el.nw > 0 && el.nh > 0 && el.w > 0 && el.h > 0) {
      const ir = el.nh / el.nw, br = el.h / el.w;
      if (br > ir) {
        const vis = (el.w / el.h) / (el.nw / el.nh);
        const m = (1 - vis) / 2;
        return { l: m, r: m, t: 0, b: 0 };
      }
      const vis = (el.h / el.w) / (el.nh / el.nw);
      const m = (1 - vis) / 2;
      return { l: 0, r: 0, t: m, b: m };
    }
    return null;
  }

  function imageInnerHtml(el) {
    if (!el.src) return '';
    const c = imageCrop(el);
    let st = 'left:0;top:0;width:100%;height:100%;';
    if (c) {
      const fw = 1 - c.l - c.r, fh = 1 - c.t - c.b;
      if (fw > 0.001 && fh > 0.001) {
        const iw = el.w / fw, ih = el.h / fh;
        st = `left:${round2(-c.l * iw)}px;top:${round2(-c.t * ih)}px;width:${round2(iw)}px;height:${round2(ih)}px;`;
      }
    }
    return `<img alt="" draggable="false" src="${escapeHtml(el.src)}" style="${st}">`;
  }

  function elementHtml(deck, slide, el, opts) {
    const o = opts || {};
    const cls = ['ms-el', 'ms-' + el.type];
    const data = ` data-id="${escapeHtml(el.id)}"`;
    if (el.type === 'text') {
      const empty = isTextEmpty(el);
      if (empty && !o.editor) return '';
      if (empty) cls.push('is-empty');
      const prompt = o.editor && el.prompt ? ` data-prompt="${escapeHtml(el.prompt)}"` : '';
      return `<div class="${cls.join(' ')}"${data} style="${geomStyle(el)}"><div class="ms-tx" style="${textBoxStyle(deck, slide, el)}"><div class="ms-body"${prompt}>${textBodyHtml(deck, slide, el)}</div></div></div>`;
    }
    if (el.type === 'shape') {
      if (el.shape === 'line' || el.shape === 'arrow') cls.push('ms-line');
      return `<div class="${cls.join(' ')}"${data} style="${geomStyle(el)}">${shapeSvg(deck, slide, el)}</div>`;
    }
    if (el.type === 'image') {
      if (!el.src && !o.editor) return '';
      if (!el.src) cls.push('is-placeholder');
      return `<div class="${cls.join(' ')}"${data} style="${geomStyle(el)}">${imageInnerHtml(el)}</div>`;
    }
    return '';
  }

  function slideHtml(deck, slide, opts) {
    const size = (deck && deck.size) || DEFAULT_SIZE;
    const els = (slide.elements || []).map((el) => elementHtml(deck, slide, el, opts)).join('');
    const extra = opts && opts.className ? ' ' + opts.className : '';
    return `<div class="ms-slide${extra}" style="width:${size.w}px;height:${size.h}px;${backgroundCss(deck, slide)}">${els}</div>`;
  }

  const SLIDE_CSS = `
.ms-slide{position:relative;overflow:hidden;box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact;text-rendering:optimizeLegibility;-webkit-font-smoothing:antialiased;contain:layout paint}
.ms-slide *{box-sizing:border-box}
.ms-el{position:absolute}
.ms-svg{position:absolute;left:0;top:0;overflow:visible}
.ms-image{overflow:hidden}
.ms-image img{position:absolute;display:block;max-width:none;max-height:none;user-select:none;-webkit-user-drag:none;pointer-events:none}
.ms-tx{position:absolute;inset:0;display:flex;flex-direction:column;padding:${PAD_Y}px ${PAD_X}px;line-height:1.2;overflow:visible;overflow-wrap:break-word;word-break:normal}
.ms-body{outline:none;min-width:1px;counter-reset:msn0 msn1 msn2 msn3 msn4}
.ms-p{margin:0;padding:0;position:relative;white-space:pre-wrap}
.ms-p+.ms-p{margin-top:var(--psp,0)}
.ms-p[data-list]{padding-left:calc(${BULLET_INDENT_PT}pt * (var(--lvl,0) + 1))}
.ms-p[data-list]::before{position:absolute;left:calc(${BULLET_INDENT_PT}pt * var(--lvl,0));top:0;font-weight:inherit;font-style:normal;text-decoration:none}
.ms-p[data-list="bullet"]::before{content:"${BULLET_CHARS[0]}"}
.ms-p[data-list="bullet"][data-level="1"]::before{content:"${BULLET_CHARS[1]}"}
.ms-p[data-list="bullet"][data-level="2"]::before{content:"${BULLET_CHARS[2]}"}
.ms-p[data-list="bullet"][data-level="3"]::before{content:"${BULLET_CHARS[3]}"}
.ms-p[data-list="bullet"][data-level="4"]::before{content:"${BULLET_CHARS[4]}"}
.ms-p:not([data-list="number"]){counter-reset:msn0 msn1 msn2 msn3 msn4}
.ms-p[data-list="number"][data-level="0"]{counter-increment:msn0;counter-reset:msn1 msn2 msn3 msn4}
.ms-p[data-list="number"][data-level="1"]{counter-increment:msn1;counter-reset:msn2 msn3 msn4}
.ms-p[data-list="number"][data-level="2"]{counter-increment:msn2;counter-reset:msn3 msn4}
.ms-p[data-list="number"][data-level="3"]{counter-increment:msn3;counter-reset:msn4}
.ms-p[data-list="number"][data-level="4"]{counter-increment:msn4}
.ms-p[data-list="number"][data-level="0"]::before{content:counter(msn0) "."}
.ms-p[data-list="number"][data-level="1"]::before{content:counter(msn1) "."}
.ms-p[data-list="number"][data-level="2"]::before{content:counter(msn2) "."}
.ms-p[data-list="number"][data-level="3"]::before{content:counter(msn3) "."}
.ms-p[data-list="number"][data-level="4"]::before{content:counter(msn4) "."}
`;

  /* Complete HTML document with one landscape page per slide (PDF export and printing). */
  function exportHtml(deck, title) {
    const d = normalizeDeck(deck);
    const { w, h } = d.size;
    const pages = d.slides.map((s) => `<section class="page">${slideHtml(d, s, { editor: false })}</section>`).join('');
    return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>${escapeHtml(title || 'Presentation')}</title>
<style>
@page { size: ${w}px ${h}px; margin: 0; }
html, body { margin: 0; padding: 0; background: #ffffff; }
.page { width: ${w}px; height: ${h}px; overflow: hidden; position: relative; break-after: page; page-break-after: always; }
.page:last-child { break-after: auto; page-break-after: auto; }
${SLIDE_CSS}
</style></head><body>${pages}</body></html>`;
  }

  return {
    DEFAULT_SIZE, PX_PER_IN, PAD_X, PAD_Y, BULLET_INDENT_PT, BULLET_CHARS,
    THEMES, THEME_TOKENS, LAYOUTS, SHAPES, ROLE_SIZE, SLIDE_CSS,
    uid, clone, escapeHtml, normHex, safeImageSrc,
    themeOf, themeList, resolveColor, fontCss,
    textDefaults, runStyle,
    para, textEl, shapeEl, imageEl, makeSlide, newDeck, layoutElements,
    normalizeDeck, normEl,
    paragraphText, elementText, isTextEmpty, slideTitle,
    slideBackground, backgroundCss, lineEnds, imageCrop,
    elementHtml, textBodyHtml, textBoxStyle, geomStyle, slideHtml, exportHtml
  };
});
