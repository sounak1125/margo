/* Shared font catalog for docs + sheets: families, installed faces, style mapping. */
(function () {
  const FAMILIES = [
    'Calibri', 'Arial', 'Times New Roman', 'Segoe UI', 'Georgia',
    'Verdana', 'Trebuchet MS', 'Garamond', 'Courier New', 'Consolas', 'Tahoma', 'Palatino Linotype'
  ];
  const SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 22, 24, 28, 32, 36, 48, 72];

  const FACE_TOKENS = new Set([
    'thin', 'hairline', 'light', 'medium', 'bold', 'black', 'heavy',
    'italic', 'oblique',
    'extralight', 'ultralight', 'semibold', 'demibold', 'extrabold', 'ultrabold',
    'semilight', 'ultrablack', 'extrablack'
  ]);
  const FACE_PREFIX = new Set(['extra', 'ultra', 'semi', 'demi']);

  let cache = null;
  let loading = null;

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
    const list = faces && faces.length ? faces : [{ style: 'Regular' }];
    const w = parseCssFontWeight(fontWeight);
    const italic = String(fontStyle || '').includes('italic') || String(fontStyle || '').includes('oblique');
    let best = list[0].style;
    let bestScore = Infinity;
    list.forEach((face) => {
      const p = parseFontFaceStyle(face.style);
      const score = Math.abs(p.weight - w) + (p.fontStyle === (italic ? 'italic' : 'normal') ? 0 : 50);
      if (score < bestScore) {
        bestScore = score;
        best = face.style;
      }
    });
    return best;
  }

  function mergeFaceLabels(fromFamily, apiStyle) {
    const api = String(apiStyle || 'Regular').trim() || 'Regular';
    const apiN = api.toLowerCase().replace(/[_\s]+/g, '');
    if (!fromFamily) return api;
    const famN = fromFamily.toLowerCase().replace(/[_\s]+/g, '');
    if (!apiN || apiN === 'regular' || apiN === 'normal') return fromFamily;
    if (famN === apiN) return fromFamily;
    if (famN.includes(apiN) || apiN.includes(famN)) {
      return fromFamily.length >= api.length ? fromFamily : api;
    }
    if ((apiN.includes('italic') || apiN.includes('oblique')) &&
        !famN.includes('italic') && !famN.includes('oblique')) {
      return `${fromFamily} Italic`;
    }
    return fromFamily;
  }

  function splitFamilyAndStyle(family, style) {
    const rawFamily = String(family || '').trim();
    const rawStyle = String(style || 'Regular').trim() || 'Regular';
    const parts = rawFamily.split(/\s+/).filter(Boolean);
    const peeled = [];
    while (parts.length > 1) {
      const last = parts[parts.length - 1].toLowerCase();
      const prev = parts.length > 1 ? parts[parts.length - 2].toLowerCase() : '';
      if (prev && FACE_PREFIX.has(prev) && FACE_TOKENS.has(prev + last)) {
        peeled.unshift(parts.pop());
        peeled.unshift(parts.pop());
        continue;
      }
      if (FACE_TOKENS.has(last)) {
        peeled.unshift(parts.pop());
        continue;
      }
      break;
    }
    const base = parts.join(' ') || rawFamily;
    const fromFamily = peeled.join(' ');
    return { family: base, style: mergeFaceLabels(fromFamily, rawStyle) };
  }

  function defaultFaces(family) {
    return [{ style: 'Regular', fullName: family || 'Regular' }];
  }

  function getFacesForFamily(family, facesByFamily) {
    const map = facesByFamily || (cache && cache.facesByFamily);
    if (!family || !map) return defaultFaces(family);
    if (map.has(family)) return map.get(family);
    const lower = family.toLowerCase();
    for (const [name, faces] of map) {
      if (name.toLowerCase() === lower) return faces;
    }
    return defaultFaces(family);
  }

  function fontFamilyCss(family, styleLabel, faces) {
    const face = (faces || []).find((f) => f.style === styleLabel);
    if (face && face.fullName && face.fullName !== family) {
      return `"${face.fullName}", "${family}", sans-serif`;
    }
    return `"${family}", sans-serif`;
  }

  function inferFace(st) {
    if (!st) return 'Regular';
    if (st.face) return st.face;
    if (st.bold && st.italic) return 'Bold Italic';
    if (st.bold) return 'Bold';
    if (st.italic) return 'Italic';
    return 'Regular';
  }

  function stylePatchFromFace(family, styleLabel) {
    const { weight, fontStyle } = parseFontFaceStyle(styleLabel);
    return {
      font: family,
      face: styleLabel || 'Regular',
      bold: weight >= 700,
      italic: fontStyle === 'italic'
    };
  }

  function fillFamilySelect(select, families, current) {
    if (!select) return;
    const list = families || [];
    const keep = current || select.value;
    select.innerHTML = '';
    list.forEach((f) => {
      const o = document.createElement('option');
      o.value = f;
      o.textContent = f;
      o.style.fontFamily = `"${f}", sans-serif`;
      select.appendChild(o);
    });
    if (list.includes(keep)) select.value = keep;
    else if (list.includes('Calibri')) select.value = 'Calibri';
    else if (list[0]) select.value = list[0];
  }

  function fillVariantSelect(select, faces, preferredStyle) {
    if (!select) return 'Regular';
    const list = faces && faces.length ? faces : defaultFaces();
    const multi = list.length > 1;
    const current = preferredStyle || select.value;
    select.innerHTML = '';
    list.forEach((face) => {
      const o = document.createElement('option');
      o.value = face.style;
      o.textContent = face.style;
      select.appendChild(o);
    });
    const styles = list.map((f) => f.style);
    let pick = null;
    if (current && styles.includes(current)) pick = current;
    else pick = styles.find((s) => /^regular$/i.test(s) || /^normal$/i.test(s)) || styles[0] || 'Regular';
    select.value = pick;
    select.disabled = !multi;
    select.title = multi ? 'Font style' : 'Font style (only one face installed)';
    return pick;
  }

  function emptyCatalog() {
    const facesByFamily = new Map(FAMILIES.map((f) => [f, defaultFaces(f)]));
    return { families: FAMILIES.slice(), facesByFamily };
  }

  async function loadSystemFonts() {
    if (cache) return cache;
    if (loading) return loading;
    loading = (async () => {
      const faceMap = new Map();
      try {
        if (typeof window.queryLocalFonts === 'function') {
          const fonts = await window.queryLocalFonts();
          fonts.forEach((f) => {
            const rawFamily = (f.family || '').trim();
            if (!rawFamily) return;
            const split = splitFamilyAndStyle(rawFamily, (f.style || 'Regular').trim() || 'Regular');
            const key = split.family.toLowerCase();
            if (!faceMap.has(key)) faceMap.set(key, { name: split.family, styles: new Map() });
            const entry = faceMap.get(key);
            const styleKey = split.style.toLowerCase();
            if (!entry.styles.has(styleKey)) {
              const fullName = (f.fullName || `${split.family} ${split.style}`).trim();
              entry.styles.set(styleKey, { style: split.style, fullName });
            }
          });
        }
      } catch {}

      const facesByFamily = new Map();
      const seen = new Set();
      const merged = [];

      FAMILIES.forEach((f) => {
        if (seen.has(f.toLowerCase())) return;
        seen.add(f.toLowerCase());
        merged.push(f);
        const api = faceMap.get(f.toLowerCase());
        facesByFamily.set(f, api
          ? Array.from(api.styles.values()).sort(compareFontFaces)
          : defaultFaces(f));
      });

      Array.from(faceMap.values())
        .sort((a, b) => a.name.localeCompare(b.name))
        .forEach((entry) => {
          if (seen.has(entry.name.toLowerCase())) return;
          seen.add(entry.name.toLowerCase());
          merged.push(entry.name);
          facesByFamily.set(entry.name, Array.from(entry.styles.values()).sort(compareFontFaces));
        });

      cache = { families: merged, facesByFamily };
      return cache;
    })();
    try {
      return await loading;
    } catch {
      cache = emptyCatalog();
      return cache;
    }
  }

  window.MargoFonts = {
    FAMILIES,
    SIZES,
    parseFontFaceStyle,
    parseCssFontWeight,
    compareFontFaces,
    matchFaceFromComputed,
    splitFamilyAndStyle,
    getFacesForFamily,
    fontFamilyCss,
    inferFace,
    stylePatchFromFace,
    fillFamilySelect,
    fillVariantSelect,
    loadSystemFonts,
    defaultFaces
  };
})();
