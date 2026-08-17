/* Margo — markdown editor (write / split / read with live preview) */
(function () {
  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  function parseMdHeadings(src) {
    const headings = [];
    const lines = String(src || '').split('\n');
    let inFence = false;
    let fenceChar = '';
    let fenceLen = 0;
    let offset = 0;
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      const line = raw.replace(/\r$/, '');
      const fence = /^(```+|~~~+)/.exec(line);
      if (fence) {
        const ch = fence[1][0];
        const len = fence[1].length;
        if (!inFence) {
          inFence = true;
          fenceChar = ch;
          fenceLen = len;
        } else if (ch === fenceChar && len >= fenceLen && !line.slice(len).trim()) {
          inFence = false;
          fenceChar = '';
          fenceLen = 0;
        }
      } else if (!inFence) {
        const m = /^(#{1,3})[ \t]+(.*)$/.exec(line);
        if (m) {
          const title = m[2].replace(/[ \t]+#+\s*$/, '').trim() || 'Untitled section';
          headings.push({
            level: m[1].length,
            tag: 'h' + m[1].length,
            title,
            offset
          });
        }
      }
      offset += raw.length + 1;
    }
    return headings;
  }

  function create(ctx) {
    let textarea, preview, wrap, mode = 'split';
    let renderTimer = null;
    let zoom = 1;
    let outlineRail = null;
    const history = window.MargoHistory.create();
    let skipInputRecord = false;

    function render() {
      const raw = marked.parse(textarea.value);
      preview.innerHTML = DOMPurify.sanitize(raw);
    }
    function scheduleRender() {
      clearTimeout(renderTimer);
      renderTimer = setTimeout(render, 110);
    }
    function updateStatus() {
      const text = textarea.value;
      const words = (text.trim().match(/\S+/g) || []).length;
      const z = zoom !== 1 ? ` · ${Math.round(zoom * 100)}%` : '';
      ctx.setStatus(`${words} word${words === 1 ? '' : 's'} · ${text.length} characters${z}`, 'Markdown');
      if (outlineRail && !outlineRail.classList.contains('hidden')) renderOutline();
    }

    function applyZoom(clientX, clientY) {
      if (!wrap) return;
      const host = wrap.parentElement;
      const prev = parseFloat(wrap.style.zoom) || 1;
      const next = zoom;
      wrap.style.zoom = String(next);
      if (host && prev !== next) {
        const rect = host.getBoundingClientRect();
        const mx = clientX != null ? clientX - rect.left : host.clientWidth / 2;
        const my = clientY != null ? clientY - rect.top : host.clientHeight / 2;
        const ratio = next / prev;
        // Prefer anchoring the pane under the cursor (editor or preview)
        const pane = document.elementFromPoint(clientX || rect.left + mx, clientY || rect.top + my);
        const scrollPane = pane && pane.closest && pane.closest('.md-pane');
        const target = scrollPane || host.querySelector('.md-pane-editor') || host;
        if (target && target.scrollHeight > target.clientHeight) {
          target.scrollTop = (target.scrollTop + my) * ratio - my;
          target.scrollLeft = (target.scrollLeft + mx) * ratio - mx;
        }
      }
      updateStatus();
    }

    function zoomBy(factor, clientX, clientY) {
      const next = Math.min(2, Math.max(0.5, +(zoom * factor).toFixed(4)));
      if (next === zoom) return;
      zoom = next;
      applyZoom(clientX, clientY);
    }

    function onCtrlWheel(e) {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1, e.clientX, e.clientY);
    }

    /* --- text manipulation helpers --- */
    function capture() {
      return {
        text: textarea ? textarea.value : '',
        start: textarea ? textarea.selectionStart : 0,
        end: textarea ? textarea.selectionEnd : 0
      };
    }
    function restore(snap) {
      if (!textarea || !snap) return;
      skipInputRecord = true;
      textarea.value = snap.text || '';
      const start = Math.max(0, Math.min(textarea.value.length, snap.start || 0));
      const end = Math.max(0, Math.min(textarea.value.length, snap.end == null ? start : snap.end));
      textarea.setSelectionRange(start, end);
      skipInputRecord = false;
      afterEdit();
    }
    function recordNow() {
      if (!textarea || history.isApplying()) return;
      history.record(capture());
    }
    function withImmediateHistory(fn) {
      skipInputRecord = true;
      try { fn(); } finally { skipInputRecord = false; }
      recordNow();
    }
    function undo() { history.undo(restore); }
    function redo() { history.redo(restore); }

    function surround(before, after, placeholder) {
      withImmediateHistory(() => {
        const s = textarea.selectionStart, e = textarea.selectionEnd;
        const sel = textarea.value.slice(s, e) || placeholder || '';
        textarea.setRangeText(before + sel + after, s, e, 'end');
        if (!textarea.value.slice(s, e).length) {
          textarea.selectionStart = s + before.length;
          textarea.selectionEnd = s + before.length + sel.length;
        }
      });
      afterEdit();
    }
    function prefixLines(prefix, numbered) {
      withImmediateHistory(() => {
        const s = textarea.selectionStart, e = textarea.selectionEnd;
        const v = textarea.value;
        const ls = v.lastIndexOf('\n', s - 1) + 1;
        let le = v.indexOf('\n', e); if (le === -1) le = v.length;
        const block = v.slice(ls, le);
        const lines = block.split('\n');
        const out = lines.map((line, i) => {
          const p = numbered ? `${i + 1}. ` : prefix;
          return line.startsWith(p) ? line.slice(p.length) : p + line;
        }).join('\n');
        textarea.setRangeText(out, ls, le, 'select');
      });
      afterEdit();
    }
    function insertBlock(text) {
      withImmediateHistory(() => {
        const s = textarea.selectionStart;
        const v = textarea.value;
        const needsNL = s > 0 && v[s - 1] !== '\n' ? '\n\n' : '';
        textarea.setRangeText(needsNL + text, s, textarea.selectionEnd, 'end');
      });
      afterEdit();
    }
    function afterEdit() {
      textarea.focus();
      ctx.markDirty();
      scheduleRender();
      updateStatus();
    }

    function setMode(m) {
      mode = m;
      wrap.classList.remove('mode-write', 'mode-split', 'mode-read');
      wrap.classList.add('mode-' + m);
      ctx.toolbar.querySelectorAll('.segmented button').forEach((b) =>
        b.classList.toggle('active', b.dataset.mode === m));
      if (m !== 'write') render();
    }

    function buildToolbar() {
      const tb = ctx.toolbar;
      tb.innerHTML = '';
      const I = window.MargoIcons;

      const btn = (title, html, fn) => {
        const b = document.createElement('button');
        b.className = 'icon-btn'; b.title = title; b.innerHTML = html;
        b.addEventListener('mousedown', (e) => e.preventDefault());
        b.addEventListener('click', fn);
        tb.appendChild(b);
        return b;
      };
      const sep = () => { const s = document.createElement('span'); s.className = 'tb-sep'; tb.appendChild(s); };

      btn('Heading 1', '<span class="tb-glyph">H1</span>', () => prefixLines('# '));
      btn('Heading 2', '<span class="tb-glyph">H2</span>', () => prefixLines('## '));
      btn('Heading 3', '<span class="tb-glyph">H3</span>', () => prefixLines('### '));
      sep();
      btn('Bold (Ctrl+B)', '<span class="tb-glyph">B</span>', () => surround('**', '**', 'bold'));
      btn('Italic (Ctrl+I)', '<span class="tb-glyph i">I</span>', () => surround('*', '*', 'italic'));
      btn('Strikethrough', '<span class="tb-glyph s">S</span>', () => surround('~~', '~~', 'text'));
      btn('Inline code', I.code, () => surround('`', '`', 'code'));
      sep();
      btn('Bullet list', I.ul, () => prefixLines('- '));
      btn('Numbered list', I.ol, () => prefixLines('', true));
      btn('Quote', I.quote, () => prefixLines('> '));
      sep();
      btn('Link', I.link, async () => {
        const url = await ctx.inputModal('Insert link', 'https://…', 'https://');
        if (url) surround('[', `](${url})`, 'link text');
      });
      btn('Table', I.table, () =>
        insertBlock('| Column 1 | Column 2 |\n| --- | --- |\n| Cell | Cell |\n'));
      btn('Code block', I.codeblock, () => insertBlock('```\ncode\n```\n'));
      btn('Divider', I.hr, () => insertBlock('---\n'));

      const spacer = document.createElement('span'); spacer.className = 'tb-spacer'; tb.appendChild(spacer);

      const seg = document.createElement('div'); seg.className = 'segmented';
      [['write', 'Write'], ['split', 'Split'], ['read', 'Read']].forEach(([m, label]) => {
        const b = document.createElement('button');
        b.textContent = label; b.dataset.mode = m;
        b.addEventListener('click', () => setMode(m));
        seg.appendChild(b);
      });
      tb.appendChild(seg);
      sep();
      btn('Document Outline', I.outline || '📑', () => toggleOutlineRail());
      btn('Document Statistics', I.stats || '📊', () => openStatsModal());
      btn('Find & Replace (Ctrl+F)', I.search, () => openFind());
    }

    /* ---------- Document Statistics Modal ---------- */
    function openStatsModal() {
      const text = (textarea && textarea.value) || '';
      const words = (text.trim().match(/\S+/g) || []).length;
      const chars = text.length;
      const charsNoSpace = text.replace(/\s+/g, '').length;
      const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim().length > 0).length;
      const readMin = Math.max(1, Math.ceil(words / 200));
      const pages = Math.max(1, Math.ceil(words / 500));

      const wrapEl = document.createElement('div');
      wrapEl.innerHTML =
        `<div class="doc-stats-grid">` +
          `<div class="doc-stats-card"><span class="doc-stats-val">${pages}</span><span class="doc-stats-lbl">Pages</span></div>` +
          `<div class="doc-stats-card"><span class="doc-stats-val">${words.toLocaleString()}</span><span class="doc-stats-lbl">Words</span></div>` +
          `<div class="doc-stats-card"><span class="doc-stats-val">${chars.toLocaleString()}</span><span class="doc-stats-lbl">Characters (with spaces)</span></div>` +
          `<div class="doc-stats-card"><span class="doc-stats-val">${charsNoSpace.toLocaleString()}</span><span class="doc-stats-lbl">Characters (no spaces)</span></div>` +
          `<div class="doc-stats-card"><span class="doc-stats-val">${paragraphs}</span><span class="doc-stats-lbl">Paragraphs</span></div>` +
          `<div class="doc-stats-card"><span class="doc-stats-val">~${readMin} min</span><span class="doc-stats-lbl">Reading Time</span></div>` +
        `</div>`;

      ctx.openModal('Document Statistics', wrapEl, [{ label: 'OK', primary: true, value: true }]);
    }

    /* ---------- Outline Navigator Drawer ---------- */
    function jumpToHeading(heading, index) {
      if (!textarea || !heading) return;
      textarea.focus();
      const start = heading.offset;
      const lineEnd = textarea.value.indexOf('\n', start);
      const end = lineEnd === -1 ? textarea.value.length : lineEnd;
      textarea.setSelectionRange(start, end);
      scrollToOffset(start);
      if (mode === 'write' || !preview) return;
      render();
      const el = preview.querySelectorAll('h1, h2, h3')[index];
      if (!el) return;
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.style.outline = '2px solid var(--accent)';
      setTimeout(() => { el.style.outline = ''; }, 1200);
    }

    function renderOutline() {
      if (!outlineRail) return;
      const list = outlineRail.querySelector('.doc-outline-list');
      list.innerHTML = '';
      const headings = parseMdHeadings(textarea ? textarea.value : '');
      if (!headings.length) {
        list.innerHTML = '<div class="doc-outline-empty">No headings found. Use Heading 1, Heading 2, or Heading 3 in your text to build an outline.</div>';
        return;
      }
      headings.forEach((h, i) => {
        const item = document.createElement('div');
        item.className = `doc-outline-item ${h.tag}`;
        item.innerHTML = `<span class="doc-outline-tag">${h.tag.toUpperCase()}</span><span>${escapeHtml(h.title)}</span>`;
        item.addEventListener('click', () => jumpToHeading(h, i));
        list.appendChild(item);
      });
    }

    function toggleOutlineRail(force) {
      if (!outlineRail) return;
      const open = force != null ? force : outlineRail.classList.contains('hidden');
      outlineRail.classList.toggle('hidden', !open);
      if (open) renderOutline();
    }

    /* ---------- find & replace ---------- */
    let hostEl = null;
    let findBar = null, findInput = null, replaceInput = null, findCountEl = null;
    let findHits = [];
    let findIndex = -1;
    let findOpen = false;

    function collectHits(query) {
      const q = (query || '').trim();
      const hits = [];
      if (!q || !textarea) return hits;
      const text = textarea.value;
      const lower = text.toLowerCase();
      const needle = q.toLowerCase();
      let start = 0, idx;
      while ((idx = lower.indexOf(needle, start)) !== -1) {
        hits.push({ start: idx, end: idx + q.length });
        start = idx + q.length;
      }
      return hits;
    }

    function scrollToOffset(offset) {
      const before = textarea.value.slice(0, offset);
      const line = before.split('\n').length - 1;
      const cs = getComputedStyle(textarea);
      const fontSize = parseFloat(cs.fontSize) || 13;
      const lh = parseFloat(cs.lineHeight) || fontSize * 1.7;
      const pad = parseFloat(cs.paddingTop) || 0;
      textarea.scrollTop = Math.max(0, pad + line * lh - textarea.clientHeight / 3);
    }

    function updateFindCount() {
      if (!findCountEl) return;
      if (!findHits.length) findCountEl.textContent = findInput && findInput.value.trim() ? '0 matches' : '';
      else findCountEl.textContent = (findIndex + 1) + ' / ' + findHits.length;
    }

    function selectHit() {
      if (findIndex < 0 || !findHits[findIndex]) {
        updateFindCount();
        return;
      }
      const hit = findHits[findIndex];
      textarea.focus();
      textarea.setSelectionRange(hit.start, hit.end);
      scrollToOffset(hit.start);
      updateFindCount();
    }

    function runFind(query) {
      findHits = collectHits(query);
      findIndex = findHits.length ? 0 : -1;
      selectHit();
    }

    function findNext(dir) {
      if (!findHits.length) return;
      findIndex = (findIndex + dir + findHits.length) % findHits.length;
      selectHit();
    }

    function replaceCurrent() {
      if (findIndex < 0 || !findHits[findIndex]) return;
      const hit = findHits[findIndex];
      const repl = replaceInput ? replaceInput.value : '';
      withImmediateHistory(() => {
        textarea.setRangeText(repl, hit.start, hit.end, 'end');
      });
      afterEdit();
      const keep = findIndex;
      runFind(findInput.value);
      if (findHits.length) {
        findIndex = Math.min(keep, findHits.length - 1);
        selectHit();
      }
    }

    function replaceAll() {
      const q = (findInput && findInput.value || '').trim();
      if (!q) return;
      const repl = replaceInput ? replaceInput.value : '';
      const v = textarea.value;
      const needle = q.toLowerCase();
      const lv = v.toLowerCase();
      let out = '';
      let i = 0;
      let n = 0;
      while (true) {
        const idx = lv.indexOf(needle, i);
        if (idx === -1) { out += v.slice(i); break; }
        out += v.slice(i, idx) + repl;
        i = idx + q.length;
        n++;
      }
      if (!n) return;
      withImmediateHistory(() => { textarea.value = out; });
      afterEdit();
      runFind(q);
    }

    function closeFind() {
      findOpen = false;
      if (findBar) findBar.classList.add('hidden');
      findHits = [];
      findIndex = -1;
      updateFindCount();
    }

    function openFind() {
      if (mode === 'read') setMode('split');
      ensureFindBar();
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

    function onHostKeydown(e) {
      if (e.key === 'Escape' && findOpen) {
        e.preventDefault();
        closeFind();
      }
    }

    return {
      kind: 'md',
      mount(host, doc) {
        hostEl = host;
        buildToolbar();
        host.innerHTML =
          `<aside class="doc-outline-rail hidden" aria-label="Document Outline">` +
            `<div class="doc-outline-head">` +
              `<span>Headings Outline</span>` +
              `<button type="button" class="icon-btn doc-outline-close" title="Close">${window.MargoIcons.close}</button>` +
            `</div>` +
            `<div class="doc-outline-list"></div>` +
          `</aside>` +
          `<div class="md-wrap mode-split">
             <div class="md-pane md-pane-editor"><textarea class="md-input" spellcheck="false" placeholder="# Start writing…"></textarea></div>
             <div class="md-pane md-pane-preview"><article class="md-preview"></article></div>
           </div>`;
        wrap = host.querySelector('.md-wrap');
        textarea = host.querySelector('.md-input');
        preview = host.querySelector('.md-preview');
        outlineRail = host.querySelector('.doc-outline-rail');
        textarea.value = doc.markdown || '';
        findBar = null;
        ensureFindBar();
        host.addEventListener('keydown', onHostKeydown);
        if (outlineRail) {
          outlineRail.querySelector('.doc-outline-close').addEventListener('click', () => toggleOutlineRail(false));
        }

        history.seed(capture());
        textarea.addEventListener('input', () => {
          ctx.markDirty();
          scheduleRender();
          updateStatus();
          if (!skipInputRecord && !history.isApplying()) history.record(capture(), { coalesce: true });
        });
        textarea.addEventListener('keydown', (e) => {
          if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'b') { e.preventDefault(); surround('**', '**', 'bold'); }
          if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'i') { e.preventDefault(); surround('*', '*', 'italic'); }
          if (e.key === 'Tab') {
            e.preventDefault();
            withImmediateHistory(() => {
              textarea.setRangeText('  ', textarea.selectionStart, textarea.selectionEnd, 'end');
            });
            ctx.markDirty();
            scheduleRender();
            updateStatus();
          }
        });
        // proportional scroll sync editor -> preview
        textarea.addEventListener('scroll', () => {
          if (mode !== 'split') return;
          const ratio = textarea.scrollTop / Math.max(1, textarea.scrollHeight - textarea.clientHeight);
          const pv = preview.parentElement;
          pv.scrollTop = ratio * (pv.scrollHeight - pv.clientHeight);
        });
        // external links open in browser
        preview.addEventListener('click', (e) => {
          const a = e.target.closest('a');
          if (a) { e.preventDefault(); window.margo.openExternal(a.href); }
        });

        render();
        updateStatus();
        setMode('split');
        wrap.addEventListener('wheel', onCtrlWheel, { passive: false });
      },
      getData() { return { markdown: textarea.value }; },
      focus() { textarea.focus(); },
      destroy() {
        clearTimeout(renderTimer);
        if (wrap) wrap.removeEventListener('wheel', onCtrlWheel);
        if (hostEl) hostEl.removeEventListener('keydown', onHostKeydown);
        closeFind();
      },
      commands: {
        undo,
        redo,
        canUndo: () => history.canUndo(),
        canRedo: () => history.canRedo(),
        setMdMode: (m) => setMode(m),
        getMdMode: () => mode,
        find: () => openFind(),
        paste: (t) => {
          if (!t) return;
          textarea.focus();
          withImmediateHistory(() => {
            textarea.setRangeText(t, textarea.selectionStart, textarea.selectionEnd, 'end');
          });
          afterEdit();
        },
        zoomIn: () => zoomBy(1.1),
        zoomOut: () => zoomBy(1 / 1.1),
        zoomReset: () => { zoom = 1; applyZoom(); },
        outline: () => toggleOutlineRail(),
        stats: () => openStatsModal()
      }
    };
  }

  window.MargoEditors = window.MargoEditors || {};
  window.MargoEditors.md = create;
})();
