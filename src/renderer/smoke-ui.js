/* Margo — renderer-side smoke suite. Runs only when the main process sends smoke:run. */
(function () {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const results = [];
  const t = (name, ok, detail) => results.push({ name: 'ui: ' + name, ok: !!ok, detail: detail ? String(detail).slice(0, 200) : '' });

  async function shot(name) {
    await wait(300);
    try { await window.margo.smoke.capture(name); } catch {}
  }

  /* ---------------- shell: palette, settings, templates, shortcuts ---------------- */
  async function shellSuite(T, cfg, joinTmp) {
    const key = (k, extra) => document.dispatchEvent(new KeyboardEvent('keydown', Object.assign({ key: k, bubbles: true, cancelable: true }, extra || {})));
    const backdrop = document.getElementById('modal-backdrop');
    const modalOpen = () => !backdrop.classList.contains('hidden');
    const pane = () => document.querySelector('.tab-pane:not([hidden])');
    T.resetSession();
    await T.openFromPath(cfg.welcomePath);
    T.state.dirty = false;
    T.showLanding();
    await wait(80);

    /* command palette */
    key('k', { ctrlKey: true });
    await wait(60);
    t('shell: Ctrl+K opens the command palette', T.palette.isOpen());
    const input = document.getElementById('palette-input');
    t('shell: palette input takes focus', document.activeElement === input);
    t('shell: palette lists recent files and commands',
      T.palette.entries().some((e) => e.type === 'file') && T.palette.entries().some((e) => e.type === 'command'),
      T.palette.entries().slice(0, 4).map((e) => e.type + ':' + e.label).join(' | '));
    const query = async (q) => {
      input.value = q;
      input.dispatchEvent(new Event('input'));
      await wait(20);
      return T.palette.entries();
    };
    let hits = await query('kbd shortcuts');
    t('shell: palette fuzzy-matches a command', hits.length && /Keyboard Shortcuts/.test(hits[0].label),
      hits.slice(0, 3).map((e) => e.label).join(' | '));
    hits = await query('wlcm');
    t('shell: palette fuzzy-matches a recent file', hits.some((e) => e.type === 'file' && /welcome/i.test(e.label)),
      hits.slice(0, 3).map((e) => e.label).join(' | '));
    hits = await query('zzqqxx');
    t('shell: palette shows an empty state', hits.length === 0 && !!document.querySelector('.palette-empty'));
    hits = await query('theme nord');
    t('shell: palette reaches submenu items', hits.length && hits[0].label === 'Theme: Nord',
      hits.slice(0, 3).map((e) => e.label).join(' | '));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await wait(60);
    t('shell: Enter runs the command and closes the palette',
      document.documentElement.dataset.theme === 'nord' && !T.palette.isOpen(),
      `theme=${document.documentElement.dataset.theme} open=${T.palette.isOpen()}`);
    T.applyTheme('light', true);
    key('P', { ctrlKey: true, shiftKey: true });
    await wait(40);
    t('shell: Ctrl+Shift+P opens the palette too', T.palette.isOpen());
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await wait(30);
    t('shell: Escape closes the palette', !T.palette.isOpen());
    const fz = T.palette.fuzzy('svas', 'Save As…');
    t('shell: fuzzy match is a subsequence match', !!fz && fz.idx.length === 4 && !T.palette.fuzzy('xyz', 'Save As…'));

    /* keyboard shortcuts dialog */
    key('/', { ctrlKey: true });
    await wait(60);
    const scTitle = document.getElementById('modal-title').textContent;
    const allRows = document.querySelectorAll('#modal-body .shortcut-row').length;
    t('shell: Ctrl+/ opens keyboard shortcuts', modalOpen() && scTitle === 'Keyboard shortcuts' && allRows > 20,
      `${scTitle} rows=${allRows}`);
    const scSearch = document.querySelector('#modal-body input[type="search"]');
    if (scSearch) {
      scSearch.value = 'palette';
      scSearch.dispatchEvent(new Event('input'));
      await wait(20);
    }
    const fewer = document.querySelectorAll('#modal-body .shortcut-row').length;
    t('shell: shortcut search filters the list', fewer >= 1 && fewer < allRows, `${fewer}/${allRows}`);
    key('Escape');
    await wait(40);
    t('shell: shortcuts dialog closes on Escape', !modalOpen());

    /* settings: every control persists and applies */
    const before = T.settings.get();
    await T.showSettings();
    await wait(80);
    t('shell: settings has its sections',
      ['appearance', 'editing', 'files', 'account', 'about'].every((p) => document.querySelector(`.settings-nav button[data-page="${p}"]`)));
    t('shell: settings theme picker lists every theme',
      document.querySelectorAll('.theme-card').length === window.MargoThemes.list.length && window.MargoThemes.list.length >= 7,
      String(document.querySelectorAll('.theme-card').length));
    document.querySelector('.theme-card[data-theme="rose"]').click();
    await wait(20);
    t('shell: theme card applies the theme', document.documentElement.dataset.theme === 'rose'
      && document.querySelector('.theme-card[data-theme="rose"]').classList.contains('active'));
    const compact = document.querySelector('.settings-page[data-page="appearance"] .segmented button[data-value="compact"]');
    if (compact) compact.click();
    const autosaveSwitch = document.querySelector('.settings-page[data-page="files"] input.switch');
    if (autosaveSwitch) autosaveSwitch.click();
    const kindSel = document.querySelector('.settings-page[data-page="editing"] select');
    if (kindSel) {
      kindSel.value = 'sheet';
      kindSel.dispatchEvent(new Event('change'));
    }
    await wait(20);
    let stored = {};
    try { stored = JSON.parse(localStorage.getItem(T.settings.key) || '{}'); } catch {}
    t('shell: settings persist to storage',
      stored.density === 'compact' && stored.autosave === !before.autosave && stored.defaultKind === 'sheet',
      JSON.stringify(stored));
    t('shell: density applies to the window', document.documentElement.dataset.density === 'compact');
    const reread = T.settings.reload();
    t('shell: settings survive a reload', reread.density === 'compact' && reread.defaultKind === 'sheet');
    key('Escape');
    await wait(40);
    t('shell: settings closes on Escape', !modalOpen());
    const tabsBefore = T.state.tabs.length;
    key('n', { ctrlKey: true });
    await wait(400);
    t('shell: Ctrl+N creates the default file type', T.state.tabs.length === tabsBefore + 1 && T.state.doc && T.state.doc.kind === 'sheet',
      T.state.doc ? T.state.doc.kind : 'no doc');
    try { localStorage.setItem(T.settings.key, JSON.stringify({ density: 'huge', autosaveSec: 7, defaultKind: 'nope', spellcheck: 'yes' })); } catch {}
    const fallback = T.settings.reload();
    t('shell: bad stored settings fall back to defaults',
      fallback.density === 'comfortable' && fallback.autosaveSec === 60 && fallback.defaultKind === 'doc' && fallback.spellcheck === true,
      JSON.stringify(fallback));
    T.settings.update(before);
    T.applyTheme('light', true);

    /* spellcheck switch reaches the editors and comes back */
    await T.newDoc('doc');
    await wait(150);
    T.settings.update({ spellcheck: false });
    const body = pane() && pane().querySelector('[contenteditable="true"]');
    t('shell: spellcheck off reaches the document', !!body && body.spellcheck === false);
    T.settings.update({ spellcheck: true });
    t('shell: spellcheck on restores the editor setting', !!body && body.spellcheck === true);

    /* app shortcuts stay out of the way while a dialog is up */
    const tabsNow = T.state.tabs.length;
    const guard = T.openModal('Guard', document.createElement('div'), [{ label: 'Close', value: null }]);
    await wait(30);
    key('w', { ctrlKey: true });
    await wait(60);
    t('shell: Ctrl+W does not close a tab behind a dialog', T.state.tabs.length === tabsNow && modalOpen());
    T.closeModal(null);
    await guard;

    /* status bar save state */
    const saveEl = () => pane() && pane().querySelector('.status-save');
    t('shell: status bar shows a new document as not saved', !!saveEl() && /not saved/i.test(saveEl().textContent),
      saveEl() ? saveEl().textContent : 'none');
    T.markTabDirty(T.findTab(T.state.activeTabId));
    t('shell: status bar shows unsaved changes', !!saveEl() && saveEl().dataset.state === 'dirty');
    T.state.dirty = false;
    T.findTab(T.state.activeTabId).dirty = false;

    /* templates open real content in the right editor */
    T.resetSession();
    const expect = {
      letter: (d) => /Dear Recipient Name/.test(d.html || ''),
      resume: (d) => /Experience/.test(d.html || '') && /Education/.test(d.html || ''),
      meeting: (d) => /Action items/.test(d.html || '') && /<table/i.test(d.html || ''),
      budget: (d) => {
        const rows = (d.sheets && d.sheets[0] && d.sheets[0].rows) || [];
        return rows.some((r) => r[0] === 'Total' && /^=SUM\(/.test(r[1] || ''));
      },
      todo: (d) => /- \[ \]/.test(d.markdown || '') && /^# To-do list/.test(d.markdown || '')
    };
    for (const tpl of T.templates()) {
      await T.newFromTemplate(tpl.id);
      await wait(250);
      let data = null;
      try { data = await Promise.resolve(T.getEditor().getData()); } catch {}
      const ok = !!data && T.state.doc && T.state.doc.kind === tpl.kind && !T.state.doc.path
        && (!expect[tpl.id] || expect[tpl.id](data));
      t(`shell: template "${tpl.label}" opens in the ${tpl.kind} editor with content`, ok,
        T.state.doc ? `${T.state.doc.kind} ${T.state.doc.name}` : 'no doc');
      if (tpl.id === 'budget') {
        const ed = T.getEditor();
        const total = ed && ed._test && ed._test.getFormatted ? String(ed._test.getFormatted(12, 1)) : '';
        t('shell: budget template formulas calculate', /2,?840/.test(total), total);
      }
    }
    t('shell: templates open as clean, unsaved documents', T.state.tabs.every((x) => !x.dirty && !x.doc.path));
    t('shell: home lists templates', document.querySelectorAll('.home-template').length === T.templates().length);

    /* pinned files */
    T.resetSession();
    if (!T.isPinned(cfg.welcomePath)) T.togglePin(cfg.welcomePath, 'welcome.md');
    await T.loadRecents();
    t('shell: pinned file shows in the library', !!document.querySelector('#home-pinned .home-tile')
      && !document.getElementById('side-pinned-section').classList.contains('hidden'));
    T.togglePin(cfg.welcomePath, 'welcome.md');
    t('shell: unpinning removes it', !document.querySelector('#home-pinned .home-tile'));

    /* Export as PDF asks for page setup for a note (not for a Word file) */
    T.resetSession();
    await T.newDoc('md');
    const exporting = T.exportPdf();
    await wait(60);
    const pageOpts = document.querySelectorAll('#modal-body .pdf-page-options .settings-row').length;
    t('shell: PDF export asks for paper, orientation and margins', modalOpen() && pageOpts === 3, `rows=${pageOpts}`);
    const cancelBtn = [...document.querySelectorAll('#modal-actions .btn')].find((b) => b.textContent === 'Cancel');
    if (cancelBtn) cancelBtn.click();
    t('shell: cancelling page setup cancels the export', (await exporting) === false);
    T.state.dirty = false;

    /* reopen last session */
    T.resetSession();
    await T.openFromPath(cfg.welcomePath);
    await T.openFromPath(cfg.docxPath);
    T.state.dirty = false;
    T.persistSession();
    T.resetSession();
    const reopened = await T.restoreSession();
    t('shell: last session reopens its tabs',
      reopened && T.state.tabs.length === 2 && T.state.doc && T.state.doc.kind === 'doc',
      `reopened=${reopened} tabs=${T.state.tabs.length} front=${T.state.doc && T.state.doc.name}`);
    T.state.tabs.forEach((x) => { x.dirty = false; });
    T.state.dirty = false;

    /* reopen a closed tab */
    await T.closeTab(T.state.activeTabId);
    key('T', { ctrlKey: true, shiftKey: true });
    await wait(400);
    t('shell: Ctrl+Shift+T reopens the closed tab', T.state.tabs.length === 2 && T.state.doc && T.state.doc.kind === 'doc',
      `tabs=${T.state.tabs.length}`);
    T.state.tabs.forEach((x) => { x.dirty = false; });
    T.state.dirty = false;
    T.resetSession();

    /* autosave writes a dirty document that has a file */
    const autoPath = joinTmp('autosave-shell.md');
    await T.newDoc('md');
    const r0 = await T.saveTo(autoPath);
    T.resetSession();
    if (r0 && r0.ok) {
      await T.openFromPath(autoPath);
      await wait(150);
      const ta = pane() && pane().querySelector('.md-input');
      if (ta) {
        ta.value = '# Autosaved\n\nWritten in the background.';
        ta.dispatchEvent(new Event('input', { bubbles: true }));
      }
      await wait(60);
      const was = T.settings.get().autosave;
      T.settings.update({ autosave: true });
      const n = await T.runAutosave();
      T.settings.update({ autosave: was });
      const back = await window.margo.openPath(autoPath);
      t('shell: autosave saves a dirty file in the background',
        n === 1 && !T.state.dirty && back.ok && /Autosaved/.test(back.doc.markdown || ''),
        `saved=${n} dirty=${T.state.dirty}`);
      const saveState = pane() && pane().querySelector('.status-save');
      t('shell: status bar reports the autosave', !!saveState && /autosaved/i.test(saveState.textContent),
        saveState ? saveState.textContent : 'none');
    } else {
      t('shell: autosave saves a dirty file in the background', false, 'could not create the test file');
    }
    T.resetSession();
  }

  /* ---------------- presentations ---------------- */
  async function slidesSuite(T, cfg, joinTmp) {
    const pane = () => document.querySelector('.tab-pane:not([hidden])');
    const q = (sel) => { const p = pane(); return p ? p.querySelector(sel) : null; };
    const key = (k, opts) => document.dispatchEvent(new KeyboardEvent('keydown', Object.assign({ key: k, bubbles: true, cancelable: true }, opts || {})));
    T.resetSession();
    await wait(100);
    t('slides: editor registered', !!(window.MargoEditors && window.MargoEditors.slides && window.MargoSlidesCore));
    await T.newDoc('slides');
    await wait(250);
    const ed = T.getEditor();
    const C = ed && ed.commands;
    t('slides: new deck opens', T.state.doc && T.state.doc.kind === 'slides' && !!q('.sl-stage .ms-slide'),
      T.state.doc && T.state.doc.kind);
    t('slides: status reads Slide 1 of 1', C && C.status() === 'Slide 1 of 1', C && C.status());
    t('slides: rail shows one thumbnail', !!q('.sl-rail') && q('.sl-rail').querySelectorAll('.sl-thumb').length === 1);
    t('slides: toolbar has Present and New slide', !!q('.sl-present') || !!document.querySelector('.tab-pane:not([hidden]) .sl-present'),
      '');

    // type into the title placeholder
    const d0 = C.deck();
    const titleId = d0.slides[0].elements.find((e) => e.role === 'title').id;
    C.startEdit(titleId);
    await wait(40);
    document.execCommand('insertText', false, 'Smoke deck title');
    C.endEdit();
    await wait(40);
    t('slides: typing into the title updates the deck',
      window.MargoSlidesCore.elementText(C.deck().slides[0].elements.find((e) => e.id === titleId)) === 'Smoke deck title');
    t('slides: editing marks the tab dirty', T.state.dirty === true);
    await T.flushDrafts();
    const drafts = await window.margo.drafts.list();
    const draft = drafts.find((d) => d.kind === 'slides');
    t('slides: unsaved deck is kept as a crash-recovery draft',
      !!draft && draft.data && draft.data.deck && draft.data.deck.slides.length === 1
        && JSON.stringify(draft.data.deck).includes('Smoke deck title'), drafts.map((d) => d.kind).join(','));

    // add a slide from the toolbar
    const addBtn = document.querySelector('.tab-pane:not([hidden]) .sl-split-main');
    if (addBtn) addBtn.click();
    await wait(80);
    t('slides: New slide adds a slide', C.slideCount() === 2 && C.status() === 'Slide 2 of 2', C.status());
    t('slides: rail follows', q('.sl-rail').querySelectorAll('.sl-thumb').length === 2);

    // text box
    C.addTextBox();
    await wait(60);
    t('slides: new text box starts in edit mode', !!C.editingId());
    document.execCommand('insertText', false, 'Smoke text box');
    C.endEdit();
    const box = C.deck().slides[1].elements[C.deck().slides[1].elements.length - 1];
    t('slides: text box holds its text', box.type === 'text' && window.MargoSlidesCore.elementText(box) === 'Smoke text box');
    C.select([box.id]);
    C.bold();
    t('slides: bold applies to a selected box', box.paragraphs[0].runs.every((r) => r.b === true));
    C.fontSize(36);
    t('slides: font size applies to a selected box', box.size === 36);

    // shape + keyboard nudge + undo/redo
    C.addShape('ellipse');
    await wait(40);
    const shape = C.deck().slides[1].elements.find((e) => e.type === 'shape' && e.shape === 'ellipse');
    const x0 = shape && shape.x;
    const vp = q('.sl-viewport');
    if (vp) vp.focus();
    key('ArrowRight');
    key('ArrowRight', { shiftKey: true });
    const moved = C.deck().slides[1].elements.find((e) => e.id === shape.id);
    t('slides: arrow keys nudge the selection', moved && moved.x === x0 + 11, `${x0} -> ${moved && moved.x}`);
    // Consecutive nudges are one undo step, as in PowerPoint.
    C.undo();
    const back = C.deck().slides[1].elements.find((e) => e.id === shape.id);
    t('slides: undo restores the position', back && back.x === x0, back ? back.x : 'shape gone');
    C.redo();
    t('slides: redo re-applies it', C.deck().slides[1].elements.find((e) => e.id === shape.id).x === x0 + 11);
    key('d', { ctrlKey: true });
    t('slides: Ctrl+D duplicates the selection', C.deck().slides[1].elements.filter((e) => e.type === 'shape' && e.shape === 'ellipse').length === 2);
    key('Delete');
    t('slides: Delete removes the selection', C.deck().slides[1].elements.filter((e) => e.type === 'shape' && e.shape === 'ellipse').length === 1);

    // image
    const cv = document.createElement('canvas');
    cv.width = 64; cv.height = 32;
    const g = cv.getContext('2d');
    g.fillStyle = '#3a7'; g.fillRect(0, 0, 64, 32);
    await C.addImage(cv.toDataURL('image/png'));
    const img = C.deck().slides[1].elements.find((e) => e.type === 'image');
    t('slides: picture inserts with its proportions', !!img && img.nw === 64 && Math.abs(img.w / img.h - 2) < 0.05, img && `${img.w}x${img.h}`);

    // notes + theme
    const notes = q('.sl-notes-input');
    if (notes) { notes.value = 'Smoke speaker notes'; notes.dispatchEvent(new Event('input', { bubbles: true })); }
    t('slides: speaker notes are kept per slide', C.deck().slides[1].notes === 'Smoke speaker notes');
    C.setTheme('editorial');
    t('slides: theme switches the deck', C.deck().theme === 'editorial' && C.themes().length >= 4);

    // slide management
    C.duplicateSlide();
    t('slides: duplicate slide', C.slideCount() === 3 && C.currentIndex() === 2);
    C.moveSlide(2, 0);
    t('slides: move slide', C.currentIndex() === 0 && C.deck().slides[0].notes === 'Smoke speaker notes');
    C.deleteSlide();
    t('slides: delete slide', C.slideCount() === 2);
    C.goTo(0);

    await shot('slides-light.png');
    T.applyTheme('dark', false);
    await wait(80);
    await shot('slides-dark.png');
    T.applyTheme('light', false);

    // slideshow
    C.present(0);
    await wait(120);
    const showEl = document.querySelector('.sl-show');
    t('slides: slideshow opens full screen', !!showEl && C.isPresenting());
    const count = () => (document.querySelector('.sl-show-count') || {}).textContent;
    t('slides: slideshow counter', count() === '1 / 2', count());
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    await wait(80);
    t('slides: arrow advances the show', count() === '2 / 2', count());
    await shot('slides-show.png');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await wait(80);
    t('slides: Esc ends the show', !document.querySelector('.sl-show') && !C.isPresenting());

    // library thumbnail
    const thumb = await window.MargoSlides.thumbDataUrl(C.deck());
    t('slides: library thumbnail renders', typeof thumb === 'string' && thumb.startsWith('data:image/png'), thumb ? thumb.slice(0, 30) : 'null');

    // save, export, reopen
    const deckPath = joinTmp('ui-deck.pptx');
    const res = await T.saveTo(deckPath);
    t('slides: save as .pptx', res && res.ok, res && res.error);
    t('slides: saving clears dirty', T.state.dirty === false);
    t('slides: export as PDF', await T.exportTo(joinTmp('export-slides.pdf')));
    const slidesBefore = C.slideCount();
    await wait(400);
    T.showLanding();
    let tile = null;
    for (let i = 0; i < 30; i++) {
      tile = [...document.querySelectorAll('.home-tile')].find((el) => /ui-deck\.pptx$/.test(el.dataset.path || ''));
      if (tile && tile.querySelector('img') && !tile.querySelector('.home-tile-cover-type')) break;
      await wait(150);
    }
    t('slides: library tile shows the deck', !!tile, tile ? '' : 'no tile for ui-deck.pptx');
    await shot('slides-home.png');
    await T.openFromPath(deckPath);
    await wait(250);
    const ed2 = T.getEditor();
    const d2 = ed2 && ed2.commands && ed2.commands.deck();
    const all = d2 ? d2.slides.map((sl) => sl.elements.map(window.MargoSlidesCore.elementText).join(' ')).join(' | ') : '';
    t('slides: reopened deck round-trips', T.state.doc && T.state.doc.kind === 'slides' && d2 && d2.slides.length === slidesBefore
      && all.includes('Smoke deck title') && all.includes('Smoke text box') && d2.theme === 'editorial'
      && d2.slides.some((sl) => sl.notes === 'Smoke speaker notes') && d2.slides.some((sl) => sl.elements.some((e) => e.type === 'image' && e.src)),
      all.slice(0, 160));
    T.state.dirty = false;
    await T.closeTab(T.state.activeTabId);
  }

  window.margo.onSmokeRun(async (cfg) => {
    const T = window.__margoTest;
    // The main process says which separator its platform uses; a hard-coded
    // backslash wrote every artifact beside /tmp/margo-smoke on Linux/macOS.
    const joinTmp = (f) => cfg.tmpDir + (cfg.sep || '/') + f;
    if (cfg.only === 'slides') {
      try { await slidesSuite(T, cfg, joinTmp); } catch (err) { t('slides suite crashed', false, err.stack || err.message); }
      window.margo.smoke.report(results);
      return;
    }
    try {
      // 1. landing renders (start from a known state)
      T.showLanding();
      await wait(150);
      t('landing visible', !document.getElementById('view-landing').classList.contains('hidden'));
      t('home hub renders', !!document.querySelector('.home-title'));
      t('home create includes PDF', !!document.querySelector('.home-new[data-new="pdf"]'));
      t('home tiles region exists', !!document.getElementById('home-tiles'));
      const shell = document.getElementById('shell');
      t('sidebar hidden on home', shell.classList.contains('view-home'));

      // 1b. menu bar
      const tops = document.querySelectorAll('.menu-top');
      t('menubar renders 4 menus', tops.length === 4, `${tops.length} menus`);
      tops[0].click();
      await wait(80);
      const drop = document.querySelector('.menu-drop');
      t('File menu opens with export item', !!drop && drop.textContent.includes('Export as PDF'),
        drop ? drop.textContent.slice(0, 120) : 'no dropdown');
      t('File menu includes Print', !!drop && drop.textContent.includes('Print'),
        drop ? drop.textContent.slice(0, 140) : 'no dropdown');
      t('File menu includes Share', !!drop && drop.textContent.includes('Share'),
        drop ? drop.textContent.slice(0, 140) : 'no dropdown');
      t('File menu includes Open from Drive', !!drop && drop.textContent.includes('Open from Drive'),
        drop ? drop.textContent.slice(0, 160) : 'no dropdown');
      const newItem = drop && [...drop.querySelectorAll('.menu-item')].find((el) =>
        el.textContent.replace(/\s+/g, ' ').trim().startsWith('New'));
      if (newItem) newItem.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
      await wait(80);
      const newSub = drop && drop.querySelector('.menu-drop.sub');
      t('File → New includes PDF document', !!newSub && newSub.textContent.includes('PDF document'),
        newSub ? newSub.textContent.slice(0, 140) : 'no New submenu');
      await shot('menubar-file.png');
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      await wait(60);
      t('menu closes on Escape', !document.querySelector('.menu-drop'));

      await T.showSettings();
      await wait(80);
      const settingsBody = document.querySelector('.modal-body');
      t('settings shows installed-app note', !!(settingsBody && /installed app/i.test(settingsBody.textContent)),
        settingsBody ? settingsBody.textContent.slice(0, 120) : 'no modal');
      t('settings shows Google account row', !!(settingsBody && /Google/i.test(settingsBody.textContent)),
        settingsBody ? settingsBody.textContent.slice(0, 160) : 'no modal');
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await wait(60);
      t('settings closes on Escape', document.getElementById('modal-backdrop').classList.contains('hidden'));

      // 2. theme toggle round trip + captures
      T.applyTheme('light', false);
      t('light scheme set', document.documentElement.dataset.scheme === 'light');
      await shot('landing-light.png');
      T.applyTheme('dark', false);
      t('dark theme applies', document.documentElement.dataset.theme === 'dark');
      t('dark scheme set', document.documentElement.dataset.scheme === 'dark');
      await shot('landing-dark.png');
      T.applyTheme('paper', false);
      t('paper theme applies', document.documentElement.dataset.theme === 'paper'
        && document.documentElement.dataset.scheme === 'light');
      await shot('landing-paper.png');
      T.applyTheme('light', false);

      // 3. markdown editor
      await T.openFromPath(cfg.welcomePath);
      t('md editor mounts', T.state.view === 'editor' && T.state.doc.kind === 'md');
      t('sidebar visible in editor', !shell.classList.contains('view-home'));
      const sidebar = document.getElementById('sidebar');
      t('sidebar unpinned by default', !shell.classList.contains('pinned'));
      T.closeSidebar(true);
      t('sidebar hides', !sidebar.classList.contains('open'));
      document.getElementById('side-hotzone').dispatchEvent(new MouseEvent('mouseenter'));
      await wait(60);
      t('sidebar slides in on left-edge hover', sidebar.classList.contains('open'));
      t('sidebar New includes PDF', !!document.querySelector('.side-new[data-new="pdf"]'));
      t('sidebar settings button exists', !!document.getElementById('btn-sidebar-settings'));
      await shot('sidebar-hover.png');
      await wait(300);
      const preview = document.querySelector('.tab-pane:not([hidden]) .md-preview') || document.querySelector('.md-preview');
      t('md preview renders heading', !!(preview && preview.querySelector('h1')));
      {
        const edMd = T.getEditor();
        t('md outline command exists', !!(edMd && edMd.commands && typeof edMd.commands.outline === 'function'));
        t('md stats command exists', !!(edMd && edMd.commands && typeof edMd.commands.stats === 'function'));
      }
      /* markdown editor features: status line, toolbar, typing helpers,
         preview (highlighting, tasks, footnotes, sanitising), scroll sync */
      {
        const edMd = T.getEditor();
        const MT = edMd && edMd._test;
        if (MT) {
          const mta = MT.textarea();
          const original = mta.value;
          t('md status reports words and reading time',
            /^[\d,]+ words? · \d+ min read$/.test(edMd.commands.status()), edMd.commands.status());
          const mdTools = document.querySelectorAll('.tab-pane:not([hidden]) .md-toolbar .md-tb-btn svg');
          t('md toolbar has icon buttons', mdTools.length >= 16, `${mdTools.length} icon buttons`);
          t('md code block highlighted in preview', !!MT.preview().querySelector('pre code .tok-keyword'));
          MT.setText('- item');
          MT.key({ key: 'Enter' });
          t('md Enter continues a list', mta.value === '- item\n- ', JSON.stringify(mta.value));
          MT.key({ key: 'Enter' });
          t('md Enter on an empty item ends the list', mta.value === '- item\n', JSON.stringify(mta.value));
          MT.setText('1. a\n2. b', 4);
          MT.key({ key: 'Enter' });
          t('md numbered list continues and renumbers', mta.value === '1. a\n2. \n3. b', JSON.stringify(mta.value));
          MT.setText('- a\n- b', 7);
          MT.key({ key: 'Tab' });
          t('md Tab indents a list item', mta.value === '- a\n  - b', JSON.stringify(mta.value));
          MT.setText('');
          MT.key({ key: '(' });
          t('md auto-pairs brackets', mta.value === '()' && mta.selectionStart === 1, JSON.stringify(mta.value));
          MT.setText('hello world', 2);
          MT.key({ key: 'b', ctrlKey: true });
          t('md Ctrl+B bolds the word', mta.value === '**hello** world', JSON.stringify(mta.value));
          MT.key({ key: 'b', ctrlKey: true });
          t('md Ctrl+B toggles bold off', mta.value === 'hello world', JSON.stringify(mta.value));
          MT.setText('Title', 1);
          MT.key({ key: '2', code: 'Digit2', ctrlKey: true });
          t('md Ctrl+2 makes a heading', mta.value === '## Title', JSON.stringify(mta.value));
          edMd.commands.undo();
          t('md undo reverts a toolbar edit', mta.value === 'Title', JSON.stringify(mta.value));
          MT.setText('- [ ] one\n- [x] two\n\nSee[^1].\n\n[^1]: A note.\n\n<style>body{display:none}</style>\n\n<img src=x onerror="window.__mdPwned=1">');
          MT.render();
          const boxes = MT.preview().querySelectorAll('input.md-task');
          t('md task list renders checkboxes', boxes.length === 2, `${boxes.length}`);
          if (boxes[0]) boxes[0].click();
          t('md ticking a preview checkbox edits the source', mta.value.startsWith('- [x] one'), mta.value.slice(0, 20));
          t('md footnotes render', MT.preview().querySelectorAll('.md-footnotes li').length === 1);
          t('md preview strips style tags', !MT.preview().querySelector('style'));
          await wait(60);
          t('md preview blocks inline handlers', !window.__mdPwned);
          let big = '';
          for (let i = 0; i < 80; i++) big += `## Part ${i}\n\nSome text for part ${i} that is long enough to wrap once or twice in the editor pane.\n\n`;
          MT.setText(big, 0);
          MT.render();
          t('md scroll sync maps blocks', MT.syncPoints() >= 80, `${MT.syncPoints()} points`);
          edMd.commands.setMdMode('split');
          const pane = MT.previewPane();
          const target = [...MT.preview().querySelectorAll('h2')].find((h) => h.textContent === 'Part 60');
          const y = MT.offsetY(mta.value.indexOf('## Part 60'));
          mta.scrollTop = y;
          MT.scrollEditorTo(y);
          const drift = target ? Math.abs(target.getBoundingClientRect().top - pane.getBoundingClientRect().top) : 999;
          t('md scroll sync lines the preview up with the editor', drift < 40, `${Math.round(drift)}px`);
          MT.setText(original, 0);
          MT.render();
        }
      }
      const ta = document.querySelector('.tab-pane:not([hidden]) .md-input') || document.querySelector('.md-input');
      {
        const ed = T.getEditor();
        if (ed && ed.commands && ed.commands.find) ed.commands.find();
        await wait(80);
        const bar = document.querySelector('.tab-pane:not([hidden]) .doc-find-bar') || document.querySelector('.doc-find-bar');
        t('md find bar opens', !!(bar && !bar.classList.contains('hidden')));
        const findIn = bar && bar.querySelector('.doc-find-input:not(.doc-replace-input)');
        const replaceIn = bar && bar.querySelector('.doc-replace-input');
        if (findIn) {
          findIn.focus();
          findIn.value = 'M';
          findIn.dispatchEvent(new Event('input', { bubbles: true }));
          t('md find keeps focus after first character', document.activeElement === findIn);
          findIn.value = 'Margo';
          findIn.dispatchEvent(new Event('input', { bubbles: true }));
          await wait(40);
          t('md find keeps focus while typing', document.activeElement === findIn);
          t('md find highlights matches', !!document.querySelector('.tab-pane:not([hidden]) .md-find-overlay mark.margo-find-hit'));
          t('md find marks current match', !!document.querySelector('.tab-pane:not([hidden]) .md-find-overlay mark.margo-find-current'));
          t('md preview highlights matches', !!document.querySelector('.tab-pane:not([hidden]) .md-preview mark.margo-find-hit'));
          t('md find still focused after highlight', document.activeElement === findIn);
        }
        t('md find selects a match', !!(ta && ta.selectionEnd > ta.selectionStart),
          ta ? `${ta.selectionStart}-${ta.selectionEnd}` : 'no textarea');
        if (replaceIn) {
          replaceIn.focus();
          replaceIn.value = 'X';
          replaceIn.dispatchEvent(new Event('input', { bubbles: true }));
          t('md replace keeps focus while typing', document.activeElement === replaceIn);
        }
        const mdFindClose = document.querySelector('.tab-pane:not([hidden]) .doc-find-close') || document.querySelector('.doc-find-close');
        mdFindClose && mdFindClose.click();
        t('md find highlights clear on close',
          !document.querySelector('.tab-pane:not([hidden]) .md-find-overlay mark.margo-find-hit')
          && !document.querySelector('.tab-pane:not([hidden]) .md-preview mark.margo-find-hit'));
      }
      ta.value += '\n\nSmoke edit line.';
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      t('md edit marks dirty', T.state.dirty === true);
      await T.flushDrafts();
      let draftList = await window.margo.drafts.list();
      t('draft written after edit', draftList.length >= 1 && (draftList[0].data.markdown || '').includes('Smoke edit line.'),
        `n=${draftList.length}`);
      await T.discardDrafts();
      draftList = await window.margo.drafts.list();
      t('discard clears drafts', draftList.length === 0, `n=${draftList.length}`);
      await T.flushDrafts();
      draftList = await window.margo.drafts.list();
      t('draft rewritten after discard', draftList.length >= 1, `n=${draftList.length}`);
      T.resetSession();
      await wait(80);
      await T.restoreDrafts();
      await wait(120);
      const taRestored = document.querySelector('.tab-pane:not([hidden]) .md-input') || document.querySelector('.md-input');
      t('restore reopens draft dirty', !!(taRestored && taRestored.value.includes('Smoke edit line.') && T.state.dirty === true),
        taRestored ? `dirty=${T.state.dirty} len=${taRestored.value.length}` : 'no textarea');
      await shot('editor-md.png');
      let r = await T.saveTo(joinTmp('ui-out.md'));
      t('md save (real IPC)', r && r.ok, r && r.error);
      r = await T.saveTo(joinTmp('ui-export.docx'));
      t('md -> docx export (real IPC)', r && r.ok, r && r.error);
      t('md -> pdf export (printToPDF)', await T.exportTo(joinTmp('export-md.pdf')));
      T.state.dirty = false;

      await T.openFromPath(cfg.docxPath);
      t('two tabs open', document.querySelectorAll('.tab').length === 2);
      t('doc is active', T.state.doc && T.state.doc.kind === 'doc');
      document.querySelector('.tab').click();
      await wait(80);
      t('switched to md tab', T.state.doc && T.state.doc.kind === 'md');
      const taKeep = document.querySelector('.tab-pane:not([hidden]) .md-input') || document.querySelector('.md-input');
      t('md edit preserved across tab switch', taKeep && taKeep.value.includes('Smoke edit line.'));
      const tabEls = document.querySelectorAll('.tab');
      if (tabEls[1]) tabEls[1].click();
      await wait(80);
      const inactiveTab = document.querySelector('.tab:not(.active)');
      const inactiveClose = inactiveTab && inactiveTab.querySelector('.tab-close');
      if (inactiveClose) inactiveClose.click();
      await wait(80);
      t('one tab remains', document.querySelectorAll('.tab').length === 1);

      // 4. word editor
      await T.openFromPath(cfg.docxPath);
      t('doc editor mounts', T.state.doc && T.state.doc.kind === 'doc');
      await wait(250);
      const page = document.querySelector('.tab-pane:not([hidden]) .doc-page-body')
        || document.querySelector('.tab-pane:not([hidden]) .doc-page')
        || document.querySelector('.doc-page-body')
        || document.querySelector('.doc-page');
      t('doc content renders', !!(page && page.innerText.includes('Welcome to Margo')));
      t('doc font toolbar present', !!document.querySelector('.tb-select.tb-font') && !!document.querySelector('.tb-select.tb-font-variant') && !!document.querySelector('.tb-select.tb-size'));
      // apply a font the same way the toolbar does, verify it survives getData()
      {
        const range = document.createRange();
        range.selectNodeContents(page.querySelector('p') || page);
        const s = window.getSelection();
        s.removeAllRanges(); s.addRange(range);
        document.execCommand('styleWithCSS', false, true);
        document.execCommand('fontName', false, 'Georgia');
        document.execCommand('styleWithCSS', false, false);
        const html = (await Promise.resolve(T.getEditor().getData())).html;
        t('doc font change lands in saved html', html.includes('Georgia'), html.slice(0, 160));
      }
      page.insertAdjacentHTML('beforeend', '<p>Doc smoke edit.</p>');
      page.dispatchEvent(new Event('input', { bubbles: true }));
      t('doc edit marks dirty', T.state.dirty === true);
      // right-click menu + comments
      {
        const edCtx = T.getEditor();
        const api = edCtx && edCtx._test;
        if (api && api.openContextMenu) {
          const target = page.querySelector('p') || page;
          const selectTarget = () => {
            const r = document.createRange();
            r.selectNodeContents(target);
            const s3 = window.getSelection();
            s3.removeAllRanges(); s3.addRange(r);
          };

          // nothing selected: the destructive and selection-bound rows are off
          window.getSelection().removeAllRanges();
          api.openContextMenu(200, 200);
          await wait(20);
          let menu = document.querySelector('.doc-ctx-menu');
          const rowFor = (label) => menu && [...menu.querySelectorAll('.menu-item')]
            .find((r) => r.querySelector('.menu-label').textContent === label);
          t('doc right-click menu opens', !!menu);
          t('doc right-click rows all carry an icon',
            !!menu && [...menu.querySelectorAll('.menu-item')].every((r) => !!r.querySelector('.menu-icon svg')),
            menu ? [...menu.querySelectorAll('.menu-item')]
              .filter((r) => !r.querySelector('.menu-icon svg'))
              .map((r) => r.querySelector('.menu-label').textContent).join(',') || 'all iconed' : 'no menu');
          t('doc right-click menu offers link, image and comment',
            !!rowFor('Insert link…') && !!rowFor('Insert image…') && !!rowFor('Add comment'),
            menu ? menu.textContent.slice(0, 120) : 'no menu');
          t('doc right-click comment needs a selection',
            !!rowFor('Add comment') && rowFor('Add comment').classList.contains('disabled'));
          t('doc right-click paste stays available with no selection',
            !!rowFor('Paste') && !rowFor('Paste').classList.contains('disabled'));
          api.closeContextMenu();
          t('doc right-click menu closes', !document.querySelector('.doc-ctx-menu'));

          // with a selection the comment row comes alive
          selectTarget();
          api.openContextMenu(200, 200);
          await wait(20);
          menu = document.querySelector('.doc-ctx-menu');
          t('doc right-click comment enabled with a selection',
            !!rowFor('Add comment') && !rowFor('Add comment').classList.contains('disabled'));
          t('doc right-click cut enabled with a selection',
            !!rowFor('Cut') && !rowFor('Cut').classList.contains('disabled'));
          api.closeContextMenu();

          // the menu must not run off the bottom-right corner
          api.openContextMenu(window.innerWidth - 4, window.innerHeight - 4);
          await wait(20);
          const box = document.querySelector('.doc-ctx-menu').getBoundingClientRect();
          t('doc right-click menu stays on screen',
            box.right <= window.innerWidth && box.bottom <= window.innerHeight,
            `right=${Math.round(box.right)}/${window.innerWidth} bottom=${Math.round(box.bottom)}/${window.innerHeight}`);
          api.closeContextMenu();
        }

        // the rail and its rename
        const railBtns = [...document.querySelectorAll('.doc-ribbon-panel .icon-btn')];
        t('doc comment button sits in the Insert tab as well',
          railBtns.filter((b) => b.title === 'Add comment').length >= 2,
          String(railBtns.filter((b) => b.title === 'Add comment').length));
        // "Footnote" is its own feature; the check is for the old "note" label.
        t('doc has no Add note label left',
          !railBtns.some((b) => /\bnotes?\b/i.test(b.title || '')),
          railBtns.map((b) => b.title).filter((x) => /\bnotes?\b/i.test(x || '')).join(','));
        /* The browser rewrites SVG markup on parse, so both sides are put
           through it before being compared. */
        const asParsed = (svg) => { const d = document.createElement('div'); d.innerHTML = svg || ''; return d.innerHTML; };
        const commentIcon = asParsed(window.MargoIcons.comment);
        t('doc comment buttons use the comment icon, not the old note or bell',
          railBtns.filter((b) => b.title === 'Add comment').length > 0
          && railBtns.filter((b) => b.title === 'Add comment')
            .every((b) => asParsed(b.innerHTML) === commentIcon
              && asParsed(b.innerHTML) !== asParsed(window.MargoIcons.note)
              && asParsed(b.innerHTML) !== asParsed(window.MargoIcons.bell)));
        t('doc comment and rail toggle do not share an icon',
          window.MargoIcons.comment !== window.MargoIcons.commentsPanel);
        // no two buttons in one ribbon panel may wear the same icon
        {
          const clashes = [];
          document.querySelectorAll('.doc-ribbon-panel').forEach((panel) => {
            const seen = new Map();
            panel.querySelectorAll('.icon-btn').forEach((b) => {
              const key = b.innerHTML;
              if (seen.has(key)) clashes.push(`${seen.get(key)} = ${b.title}`);
              else seen.set(key, b.title);
            });
          });
          t('doc ribbon has no two buttons sharing an icon', clashes.length === 0, clashes.join(' | '));
        }

        // resolving a comment has to stop marking up the page
        {
          const target2 = page.querySelector('p') || page;
          target2.innerHTML = 'Resolve this sentence.';
          const r2 = document.createRange();
          r2.selectNodeContents(target2);
          const s4 = window.getSelection();
          s4.removeAllRanges(); s4.addRange(r2);
          const pending = edCtx._test.addComment();
          await wait(120);
          const modal2 = document.querySelector('.modal');
          const input2 = modal2 && modal2.querySelector('input');
          if (input2) {
            input2.value = 'Resolve me.';
            input2.dispatchEvent(new Event('input', { bubbles: true }));
            [...modal2.querySelectorAll('button')].find((b) => b.textContent.trim() === 'OK').click();
          }
          await Promise.resolve(pending).catch(() => {});
          await wait(200);
          const anchor = page.querySelector('.margo-note-anchor')
            || document.querySelector('.tab-pane:not([hidden]) .margo-note-anchor');
          t('doc comment anchors the selection', !!anchor);
          t('doc open comment stays highlighted',
            !!anchor && !anchor.classList.contains('is-resolved'));

          const doneBox = document.querySelector('.doc-comment-card .doc-comment-done input');
          t('doc comment card offers Done', !!doneBox);
          if (doneBox && anchor) {
            doneBox.checked = true;
            doneBox.dispatchEvent(new Event('change', { bubbles: true }));
            await wait(60);
            t('doc resolved comment drops its highlight',
              anchor.classList.contains('is-resolved'), anchor.className);
            t('doc resolved comment leaves the count at zero',
              document.querySelector('.doc-comments-badge').classList.contains('hidden'));

            doneBox.checked = false;
            doneBox.dispatchEvent(new Event('change', { bubbles: true }));
            await wait(60);
            t('doc reopened comment is highlighted again',
              !anchor.classList.contains('is-resolved'), anchor.className);
          }
        }

        t('doc comments rail exists', !!document.querySelector('.doc-comments-rail'));
        t('doc comments rail is titled Comments',
          !!document.querySelector('.doc-comments-rail-head strong')
          && document.querySelector('.doc-comments-rail-head strong').textContent === 'Comments');
      }

      // colour picker: palette, custom hex, highlight, and clearing
      {
        const PICKER = window.MargoColorPicker;
        const colorBtn = document.querySelector('.tab-pane:not([hidden]) .tb-color')
          || document.querySelector('.tb-color');
        const hlBtn = document.querySelector('.tab-pane:not([hidden]) .tb-hl')
          || document.querySelector('.tb-hl');
        t('doc colour picker module loaded', !!(PICKER && typeof PICKER.open === 'function'));
        t('doc colour palette is the full grid',
          !!PICKER && PICKER.PALETTE.length === 8 && PICKER.PALETTE.every((r) => r.length === 10),
          PICKER ? `${PICKER.PALETTE.length} rows` : 'no picker');

        if (colorBtn) {
          colorBtn.click();
          await wait(30);
          const pop = document.querySelector('.mc-pop');
          t('doc text colour picker opens', !!pop);
          t('doc picker offers 80 swatches',
            !!pop && pop.querySelectorAll('.mc-grid .mc-swatch').length === 80,
            pop ? String(pop.querySelectorAll('.mc-grid .mc-swatch').length) : 'no pop');
          t('doc picker has custom hex + wheel',
            !!pop && !!pop.querySelector('.mc-hex') && !!pop.querySelector('.mc-native'));
          /* The eyedropper is Chromium's, so the button is expected exactly
             where the API is - present under Electron, absent without it. */
          t('doc picker eyedropper matches API support',
            !!pop && (!!pop.querySelector('.mc-eyedrop') === PICKER.eyedropperSupported()),
            `api=${PICKER.eyedropperSupported()} btn=${!!(pop && pop.querySelector('.mc-eyedrop'))}`);
          PICKER.close();
          t('doc picker closes', !document.querySelector('.mc-pop'));
        }

        const target = page.querySelector('p') || page;
        const selectTarget = () => {
          const r = document.createRange();
          r.selectNodeContents(target);
          const s2 = window.getSelection();
          s2.removeAllRanges(); s2.addRange(r);
        };

        // a palette colour off the Google grid, applied through the real button
        if (colorBtn) {
          selectTarget();
          colorBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
          colorBtn.click();
          await wait(30);
          const sw = document.querySelector('.mc-pop .mc-grid .mc-swatch[title="#1155cc"]');
          if (sw) sw.click();
          await wait(30);
          const html = (await Promise.resolve(T.getEditor().getData())).html;
          t('doc palette colour applies to text',
            /(#1155cc|rgb\(17,\s*85,\s*204\))/i.test(html), html.slice(0, 200));
        }

        // custom hex through the picker's own field
        if (colorBtn) {
          selectTarget();
          colorBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
          colorBtn.click();
          await wait(30);
          const plus = document.querySelector('.mc-pop .mc-plus');
          if (plus) plus.click();
          await wait(20);
          const hexField = document.querySelector('.mc-pop .mc-hex');
          const apply = document.querySelector('.mc-pop .mc-apply');
          if (hexField && apply) {
            hexField.value = '#7ab648';
            hexField.dispatchEvent(new Event('input', { bubbles: true }));
            apply.click();
          }
          await wait(30);
          const html = (await Promise.resolve(T.getEditor().getData())).html;
          t('doc custom hex applies to text',
            /(#7ab648|rgb\(122,\s*182,\s*72\))/i.test(html), html.slice(0, 200));
          t('doc custom colour lands in recents',
            PICKER.readRecents().includes('#7ab648'), PICKER.readRecents().join(','));
        }

        // highlight: a Word colour keeps its class, an off-grid one does not
        if (hlBtn) {
          selectTarget();
          hlBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
          hlBtn.click();
          await wait(30);
          const yellow = document.querySelector('.mc-pop .mc-grid .mc-swatch[title="#ffff00"]');
          if (yellow) yellow.click();
          await wait(30);
          const mark = page.querySelector('mark');
          t('doc highlight wraps selection in a mark', !!mark);
          t('doc word highlight keeps its class',
            !!mark && mark.classList.contains('hl-yellow'), mark ? mark.className : 'no mark');

          selectTarget();
          hlBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
          hlBtn.click();
          await wait(30);
          const teal = document.querySelector('.mc-pop .mc-grid .mc-swatch[title="#45818e"]');
          if (teal) teal.click();
          await wait(30);
          const custom = page.querySelector('mark');
          t('doc off-grid highlight is inline only',
            !!custom && !custom.className && /69,\s*129,\s*142|#45818e/i.test(custom.style.backgroundColor),
            custom ? `${custom.className}|${custom.style.backgroundColor}` : 'no mark');
          t('doc highlight does not nest marks',
            page.querySelectorAll('mark mark').length === 0,
            String(page.querySelectorAll('mark mark').length));

          // clearing the highlight must not take the bold with it
          target.innerHTML = '<b>Bold under highlight</b>';
          selectTarget();
          hlBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
          hlBtn.click();
          await wait(30);
          const anyHl = document.querySelector('.mc-pop .mc-grid .mc-swatch[title="#ffff00"]');
          if (anyHl) anyHl.click();
          await wait(30);
          selectTarget();
          hlBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
          hlBtn.click();
          await wait(30);
          const none = document.querySelector('.mc-pop .mc-none');
          t('doc highlight picker offers no-highlight', !!none);
          if (none) none.click();
          await wait(30);
          t('doc no-highlight removes the mark', !target.querySelector('mark'), target.innerHTML.slice(0, 120));
          t('doc no-highlight keeps other formatting',
            !!target.querySelector('b') || /<strong/i.test(target.innerHTML),
            target.innerHTML.slice(0, 120));
        }
        PICKER.close();
      }

      const edDoc = T.getEditor();
      if (edDoc && edDoc.commands && edDoc.commands.addPage) edDoc.commands.addPage();
      await wait(80);
      t('doc add page creates second sheet', document.querySelectorAll('.tab-pane:not([hidden]) .doc-page').length >= 2
        || document.querySelectorAll('.doc-page').length >= 2,
        String((document.querySelectorAll('.tab-pane:not([hidden]) .doc-page').length)
          || document.querySelectorAll('.doc-page').length));
      t('doc add page button present', !!document.querySelector('.tab-pane:not([hidden]) .doc-add-page')
        || !!document.querySelector('.doc-add-page'));
      {
        const pane = document.querySelector('.tab-pane:not([hidden])') || document;
        const bodies = pane.querySelectorAll('.doc-page-body');
        const pixel = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
        if (bodies.length >= 2) {
          bodies[0].insertAdjacentHTML('beforeend',
            `<p>CopyPageOne</p><img src="${pixel}" alt="p1">`);
          bodies[1].insertAdjacentHTML('afterbegin',
            `<p>CopyPageTwo</p><img src="${pixel}" alt="p2">`);
        }
        const edCopy = T.getEditor();
        if (edCopy && edCopy.commands && edCopy.commands.selectAll) edCopy.commands.selectAll();
        const payload = edCopy && edCopy._test && edCopy._test.copyPayload && edCopy._test.copyPayload();
        t('doc copy includes both pages',
          !!(payload && payload.text.includes('CopyPageOne') && payload.text.includes('CopyPageTwo')),
          payload ? payload.text.slice(0, 180) : 'no payload');
        t('doc copy includes images from both pages',
          !!(payload && (payload.html.match(/<img/gi) || []).length >= 2),
          payload ? String((payload.html.match(/<img/gi) || []).length) : 'no payload');
        if (bodies.length >= 2 && edCopy && edCopy._test) {
          const dragApi = edCopy._test;
          if (dragApi.dragSelect) {
            dragApi.dragSelect(bodies[0], bodies[1]);
            const span = dragApi.crossPageSpan && dragApi.crossPageSpan();
            t('doc drag select spans two pages',
              !!(span && span.startIdx !== span.endIdx),
              span ? `${span.startIdx}-${span.endIdx}` : 'no span');
            t('doc drag select uses css highlight',
              dragApi.crossPageHighlightActive && dragApi.crossPageHighlightActive(),
              String(dragApi.crossPageHighlightActive && dragApi.crossPageHighlightActive()));
            t('doc drag select no overlay boxes',
              document.querySelectorAll('.doc-cross-sel-box').length === 0,
              String(document.querySelectorAll('.doc-cross-sel-box').length));
          }
        }
      }
      if (edDoc && edDoc.commands && edDoc.commands.zoomIn) {
        const pixel = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
        const perfPage = document.querySelector('.tab-pane:not([hidden]) .doc-page-body')
          || document.querySelector('.doc-page-body');
        if (perfPage) {
          for (let i = 0; i < 6; i++) {
            perfPage.insertAdjacentHTML('beforeend',
              `<p>PerfChunk${i}</p><img src="${pixel}" alt="perf${i}">`);
          }
        }
        const pagesBefore = document.querySelectorAll('.tab-pane:not([hidden]) .doc-page').length
          || document.querySelectorAll('.doc-page').length;
        edDoc.commands.zoomIn();
        edDoc.commands.zoomIn();
        await wait(40);
        const pagesEl = document.querySelector('.tab-pane:not([hidden]) .doc-pages') || document.querySelector('.doc-pages');
        t('doc zoom in applies', (pagesEl || {}).style?.zoom === '1.1'
          || parseFloat((pagesEl || {}).style?.zoom) > 1);
        const edPerf = T.getEditor();
        const testApi = edPerf && edPerf._test;
        const perfBlock = perfPage && perfPage.querySelector('p');
        const perfSheet = perfPage && perfPage.closest('.doc-page');
        if (testApi && perfBlock && perfSheet) {
          const z = testApi.currentZoom();
          t('doc zoom perf level above 100%', z > 1, String(z));
          const offH = perfBlock.offsetHeight;
          const layH = testApi.layoutHeight(perfBlock);
          t('doc zoom layout height matches offset',
            layH > 0 && Math.abs(layH - offH) / Math.max(offH, 1) < 0.2,
            `layout=${layH} offset=${offH}`);
          const budget = testApi.usableHeight(perfSheet);
          t('doc zoom page budget sane', budget > layH, `budget=${budget} block=${layH}`);
        }
        if (perfPage) {
          perfPage.focus();
          perfPage.dispatchEvent(new Event('input', { bubbles: true }));
          perfPage.insertAdjacentText('beforeend', 'Z');
          perfPage.dispatchEvent(new Event('input', { bubbles: true }));
        }
        await wait(50);
        const pagesMid = document.querySelectorAll('.tab-pane:not([hidden]) .doc-page').length
          || document.querySelectorAll('.doc-page').length;
        t('doc zoom typing does not explode pages', pagesMid <= pagesBefore + 2,
          `before=${pagesBefore} mid=${pagesMid}`);
        t('doc edit marks dirty when zoomed', T.state.dirty === true);
        if (testApi && testApi.flushTypingWork) {
          testApi.flushTypingWork();
          t('doc zoom flush schedules paginate not sync',
            testApi.paginateScheduled() && !testApi.paginating(),
            String(testApi.paginateScheduled()));
          await wait(30);
          const pagesAfterFlush = testApi.pageCount();
          t('doc zoom flush keeps page count stable', pagesAfterFlush <= pagesBefore + 2,
            `before=${pagesBefore} after=${pagesAfterFlush}`);
        }
        edDoc.commands.zoomReset();
        t('doc zoom reset returns to 100%', testApi && testApi.currentZoom() === 1);

        const statusZoom = document.querySelector('.tab-pane:not([hidden]) .status-zoom')
          || document.querySelector('.status-zoom');
        const statusPct = document.querySelector('.tab-pane:not([hidden]) .status-zoom-pct')
          || document.querySelector('.status-zoom-pct');
        t('doc status zoom cluster present', !!(statusZoom && !statusZoom.classList.contains('hidden')));
        edDoc.commands.zoomIn();
        await wait(20);
        t('doc status percent updates on zoom',
          statusPct && parseInt(statusPct.textContent, 10) > 100,
          statusPct ? statusPct.textContent : 'missing');
        if (edDoc.commands.setZoom) {
          edDoc.commands.setZoom(1);
          await wait(10);
          t('doc setZoom returns status to 100%',
            statusPct && statusPct.textContent === '100%',
            statusPct ? statusPct.textContent : 'missing');
        }
        if (edDoc.commands.setViewMode) {
          edDoc.commands.setViewMode('read');
          await wait(20);
          t('doc read view disables editing',
            testApi && testApi.pageBodiesEditable && testApi.pageBodiesEditable() === false);
          const ribbon = document.querySelector('.tab-pane:not([hidden]) .doc-ribbon')
            || document.querySelector('.doc-ribbon');
          t('doc read view hides ribbon',
            ribbon && getComputedStyle(ribbon).display === 'none');
          edDoc.commands.setViewMode('split');
          await wait(30);
          t('doc split view shows preview pane',
            testApi && testApi.splitPreviewVisible && testApi.splitPreviewVisible());
          t('doc split view keeps editor editable',
            testApi && testApi.pageBodiesEditable && testApi.pageBodiesEditable() === true);
          edDoc.commands.setViewMode('print');
          await wait(20);
          t('doc print layout restores editing',
            testApi && testApi.pageBodiesEditable && testApi.pageBodiesEditable() === true);
        }
        edDoc.commands.zoomReset();
      }
      {
        const edFind = T.getEditor();
        if (edFind && edFind.commands && edFind.commands.find) edFind.commands.find();
        await wait(80);
        const bar = document.querySelector('.tab-pane:not([hidden]) .doc-find-bar') || document.querySelector('.doc-find-bar');
        const findIn = bar && bar.querySelector('.doc-find-input:not(.doc-replace-input)');
        const replaceIn = bar && bar.querySelector('.doc-replace-input');
        t('doc find bar opens', !!(bar && !bar.classList.contains('hidden') && findIn));
        if (findIn) {
          findIn.focus();
          findIn.value = 'W';
          findIn.dispatchEvent(new Event('input', { bubbles: true }));
          t('doc find keeps focus after first character', document.activeElement === findIn);
          findIn.value = 'Welcome';
          findIn.dispatchEvent(new Event('input', { bubbles: true }));
          t('doc find keeps focus while typing', document.activeElement === findIn);
          t('doc find highlights matches', document.querySelectorAll('.tab-pane:not([hidden]) mark.margo-find-hit').length > 0);
          t('doc find marks current match', !!document.querySelector('.tab-pane:not([hidden]) mark.margo-find-current'));
          t('doc find still focused after highlight', document.activeElement === findIn);
        }
        if (replaceIn) {
          replaceIn.focus();
          replaceIn.value = 'Hi';
          replaceIn.dispatchEvent(new Event('input', { bubbles: true }));
          t('doc replace keeps focus while typing', document.activeElement === replaceIn);
        }
        const close = bar && bar.querySelector('.doc-find-close');
        if (close) close.click();
        t('doc find highlights clear on close', !document.querySelector('.tab-pane:not([hidden]) mark.margo-find-hit'));
      }

      /* Replace searched the whole document again afterwards, and that resets
         the position to the first match - so Replace walked back to the top
         of the document on every press instead of carrying on to the next
         match. Replacing a word with itself leaves the document byte for byte
         as it was, so only the position and the count are under test. */
      {
        const edRep = T.getEditor();
        /* Four known matches of a string nothing else in the document uses,
           so the count is the same every run. Removed again afterwards, and
           the word is replaced with itself, so the document is left exactly
           as it was for the save and export checks further down. */
        const repBody = document.querySelector('.tab-pane:not([hidden]) .doc-page-body');
        let probe = null;
        if (repBody) {
          probe = document.createElement('p');
          probe.textContent = 'zqx zqx zqx zqx';
          repBody.appendChild(probe);
        }
        if (edRep && edRep.commands && edRep.commands.find) edRep.commands.find();
        await wait(80);
        const bar = document.querySelector('.tab-pane:not([hidden]) .doc-find-bar')
          || document.querySelector('.doc-find-bar');
        const findIn = bar && bar.querySelector('.doc-find-input:not(.doc-replace-input)');
        const replaceIn = bar && bar.querySelector('.doc-replace-input');
        const countEl = bar && bar.querySelector('.doc-find-count');
        const nextBtn = bar && bar.querySelector('.doc-find-next');
        const replaceBtn = bar && bar.querySelector('.doc-replace-btn');
        if (probe && findIn && replaceIn && countEl && nextBtn && replaceBtn) {
          findIn.focus();
          findIn.value = 'zqx';
          findIn.dispatchEvent(new Event('input', { bubbles: true }));
          await wait(80);
          const total = parseInt(countEl.textContent.split('/')[1] || '0', 10);
          t('doc replace has several matches to walk', total === 4, `${total} matches`);
          nextBtn.click();
          await wait(60);
          const beforeReplace = countEl.textContent.trim();
          replaceIn.value = 'zqx';
          replaceBtn.click();
          await wait(80);
          const afterReplace = countEl.textContent.trim();
          t('doc replace carries on from where it was',
            beforeReplace === '2 / 4' && afterReplace === '2 / 3',
            `before=${beforeReplace} after=${afterReplace}`);
        }
        const closeRep = bar && bar.querySelector('.doc-find-close');
        if (closeRep) closeRep.click();
        await wait(40);
        if (probe) probe.remove();
        t('doc replace probe text removed',
          !!repBody && repBody.textContent.indexOf('zqx') < 0);
        T.state.dirty = false;
      }

      /* Insert Symbol reached for ctx.modalBackdrop, which was never handed to
         editors, so every symbol threw before it could be inserted. */
      const symBody = document.querySelector('.tab-pane:not([hidden]) .doc-page-body');
      if (symBody && edDoc && edDoc._test && edDoc._test.openSymbols) {
        symBody.focus();
        const caret = document.createRange();
        caret.selectNodeContents(symBody);
        caret.collapse(false);
        const symSel = window.getSelection();
        symSel.removeAllRanges();
        symSel.addRange(caret);
        const textBefore = symBody.textContent;
        edDoc._test.openSymbols();
        await wait(80);
        const symBtn = document.querySelector('#modal-body .doc-symbol-btn');
        const symChar = symBtn ? symBtn.textContent : '';
        t('symbol picker opens', !!symBtn, symChar);
        if (symBtn) symBtn.click();
        await wait(100);
        const symBackdrop = document.getElementById('modal-backdrop');
        t('symbol pick closes the picker', !!(symBackdrop && symBackdrop.classList.contains('hidden')));
        t('symbol pick reaches the document',
          !!symChar && symBody.textContent !== textBefore && symBody.textContent.indexOf(symChar) >= 0,
          `${symChar} :: ${symBody.textContent.slice(-24)}`);
      }
      /* Word processor features, in a fresh document of their own so the
         sample document's later save and export checks see it unchanged. */
      {
        const prevTabId = T.state.activeTabId;
        await T.newDoc('doc');
        await wait(250);
        const fed = T.getEditor();
        const F = fed && fed._test;
        const fpane = document.querySelector('.tab-pane:not([hidden])');
        let fb = fpane && fpane.querySelector('.doc-page-body');
        const selNode = (node, a, b) => {
          const rr = document.createRange();
          if (b === undefined) rr.selectNodeContents(node); else { rr.setStart(node, a); rr.setEnd(node, b); }
          const ss = window.getSelection(); ss.removeAllRanges(); ss.addRange(rr);
        };
        const caretAt = (node, off) => {
          const rr = document.createRange(); rr.setStart(node, off || 0); rr.collapse(true);
          const ss = window.getSelection(); ss.removeAllRanges(); ss.addRange(rr);
        };
        if (F && fb) {
          const tabs = [...fpane.querySelectorAll('.doc-ribbon-tab')];
          t('doc feature: ribbon has Home, Insert, Layout, References, Review, View',
            ['Home', 'Insert', 'Layout', 'References', 'Review', 'View'].every((n) => tabs.some((b) => b.textContent === n && !b.classList.contains('hidden'))),
            tabs.map((b) => b.textContent).join(','));
          t('doc feature: ribbon buttons are drawn icons, not letters',
            [...fpane.querySelectorAll('.doc-ribbon .icon-btn')].every((b) => !!b.querySelector('svg')));
          t('doc feature: Table tab hidden outside a table',
            !!fpane.querySelector('.doc-ribbon-tab.is-contextual.hidden'));

          // paragraph styles
          fb.innerHTML = '<p>Heading here</p><p>Body one</p><p>Body two</p>';
          selNode(fb.children[0]);
          F.applyStyle('title');
          t('doc feature: Title style', !!fb.querySelector('p.margo-title'), fb.innerHTML.slice(0, 120));
          selNode(fb.children[0]);
          F.applyStyle('h2');
          t('doc feature: Heading 2 style replaces Title', !!fb.querySelector('h2') && !fb.querySelector('.margo-title'), fb.innerHTML.slice(0, 120));
          selNode(fb.children[1]);
          F.applyStyle('quote');
          t('doc feature: Quote style', !!fb.querySelector('blockquote'), fb.innerHTML.slice(0, 160));
          selNode(fb.querySelector('blockquote'));
          F.applyStyle('p');
          t('doc feature: back to Normal', !fb.querySelector('blockquote'), fb.innerHTML.slice(0, 160));

          // spacing, indent
          fb.innerHTML = '<p>one</p><p>two</p><p>three</p>';
          { const rr = document.createRange(); rr.setStart(fb.children[0].firstChild, 1); rr.setEnd(fb.children[2].firstChild, 2); const ss = window.getSelection(); ss.removeAllRanges(); ss.addRange(rr); }
          F.lineSpacing('1.5');
          F.paraSpacing('before', 6);
          t('doc feature: line and paragraph spacing reach every selected paragraph',
            [...fb.children].every((p) => p.style.lineHeight === '1.5' && p.style.marginTop === '6pt'), fb.innerHTML.slice(0, 200));
          selNode(fb.children[1]);
          F.indent(1);
          t('doc feature: indent moves the paragraph, not into a quote',
            fb.children[1].style.marginLeft === '36pt' && !fb.querySelector('blockquote'), fb.innerHTML.slice(0, 200));

          // checklist
          fb.innerHTML = '<p>task</p>';
          selNode(fb.firstChild);
          F.toggleList('check');
          const cli = fb.querySelector('ul.margo-checklist > li');
          t('doc feature: checklist', !!cli, fb.innerHTML);
          if (cli) {
            const rc = cli.getBoundingClientRect();
            cli.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: rc.left - 8, clientY: rc.top + 5, button: 0 }));
            t('doc feature: clicking the box ticks the item', cli.classList.contains('is-checked'), cli.outerHTML);
          }

          // highlight and case keep other formatting
          fb.innerHTML = '<p>hello brave <b>new</b> world</p>';
          selNode(fb.firstChild.firstChild, 6, 11);
          F.highlight('#ffff00');
          t('doc feature: partial highlight', !!fb.querySelector('mark.hl-yellow') && fb.querySelector('mark').textContent === 'brave', fb.innerHTML);
          selNode(fb.firstChild);
          F.changeCase('upper');
          t('doc feature: change case keeps bold and highlight', fb.textContent === 'HELLO BRAVE NEW WORLD' && !!fb.querySelector('b') && !!fb.querySelector('mark'), fb.innerHTML);

          // tables
          fb.innerHTML = '<p>above</p><p>below</p>';
          caretAt(fb.children[0].firstChild, 5);
          F.insertTable(2, 2);
          const tbl = fb.querySelector('table');
          t('doc feature: insert 2x2 table', !!tbl && tbl.querySelectorAll('td').length === 4);
          if (tbl) {
            t('doc feature: Table tab appears in a table', await (async () => { await wait(40); fed.focus(); return !fpane.querySelector('.doc-ribbon-tab.is-contextual').classList.contains('hidden'); })());
            caretAt(tbl.querySelector('td'), 0);
            F.insertRow('below'); F.insertCol('right');
            t('doc feature: add row and column', tbl.querySelectorAll('tr').length === 3 && tbl.querySelector('tr').children.length === 3, tbl.outerHTML.slice(0, 200));
            { const tds = tbl.querySelectorAll('tr')[0].children; tds[0].textContent = 'A'; tds[1].textContent = 'B'; const rr = document.createRange(); rr.setStart(tds[0].firstChild, 0); rr.setEnd(tds[1].firstChild, 1); const ss = window.getSelection(); ss.removeAllRanges(); ss.addRange(rr); }
            F.mergeCells();
            t('doc feature: merge cells', !!tbl.querySelector('td[colspan="2"]'), tbl.outerHTML.slice(0, 200));
            caretAt(tbl.querySelector('td[colspan="2"]'), 0);
            F.splitCell();
            t('doc feature: split merged cell', !tbl.querySelector('tr').querySelector('[colspan]') && tbl.querySelector('tr').children.length === 3);
            caretAt(tbl.querySelector('td'), 0);
            F.headerRow();
            F.borders('outer');
            t('doc feature: header row and outside borders', !!tbl.querySelector('thead th') && tbl.classList.contains('margo-tbl-outer'), tbl.outerHTML.slice(0, 200));
            caretAt(tbl.querySelector('tbody td'), 0);
            F.deleteRow(); F.deleteCol();
            t('doc feature: delete row and column', tbl.querySelectorAll('tr').length === 2 && tbl.querySelector('tr').children.length === 2, tbl.outerHTML.slice(0, 200));
          }

          // page break at the caret, and Backspace takes it out again
          fb.innerHTML = '<p>First page</p><p>Second page</p>';
          const pagesBefore = F.pageCount();
          caretAt(fb.children[1].firstChild, 0);
          F.pageBreak();
          const pg = fpane.querySelectorAll('.doc-page');
          t('doc feature: page break splits at the caret',
            F.pageCount() === pagesBefore + 1 && pg[1] && /Second page/.test(pg[1].textContent) && !/Second page/.test(pg[0].querySelector('.doc-page-body').textContent),
            `${pagesBefore} -> ${F.pageCount()}`);
          const b2 = pg[1] && pg[1].querySelector('.doc-page-body');
          if (b2) {
            b2.focus();
            caretAt(b2.querySelector('p').firstChild, 0);
            b2.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }));
            t('doc feature: Backspace at the top of a page removes the break',
              F.pageCount() === pagesBefore && !/data-margo-page-break/.test(fed.getData().html), fed.getData().html.slice(0, 160));
            F.undo();
            await wait(30);
            t('doc feature: undo brings the break back', /data-margo-page-break/.test(fed.getData().html));
            const sel2 = window.getSelection();
            t('doc feature: undo puts the caret back in the text',
              !!(sel2.rangeCount && sel2.anchorNode && sel2.anchorNode.parentElement && sel2.anchorNode.parentElement.closest('.doc-page-body')));
          }

          // table of contents and footnotes
          fb = fpane.querySelector('.doc-page-body');
          fb.innerHTML = '<h1>Alpha</h1><p>x</p><h2>Beta</h2><p>y z</p>';
          caretAt(fb.firstChild.firstChild, 0);
          F.insertToc();
          const toc = fpane.querySelector('.margo-toc');
          t('doc feature: table of contents lists the headings with pages',
            !!toc && toc.querySelectorAll('.margo-toc-entry').length === 2 && /Alpha/.test(toc.textContent) && !!toc.querySelector('.margo-toc-page'),
            toc ? toc.outerHTML.slice(0, 200) : 'none');
          const lastP = [...fb.querySelectorAll('p')].pop();
          caretAt(lastP.firstChild, 1);
          F.insertFootnote();
          await wait(40);
          t('doc feature: footnote reference and note',
            !!fpane.querySelector('sup.margo-fn-ref') && !!fpane.querySelector('.margo-footnotes li'));

          // find options and replace all
          fb = fpane.querySelector('.doc-page-body');
          fb.innerHTML = '<p>Cat cat catalog <b>ca</b>t</p>';
          F.setFindOption('wholeWord', true);
          F.runFind('cat');
          t('doc feature: find whole word across formatting', F.findHits() === 3, String(F.findHits()));
          F.setFindOption('matchCase', true);
          F.runFind('cat');
          t('doc feature: find match case', F.findHits() === 2, String(F.findHits()));
          F.setFindOption('matchCase', false); F.setFindOption('wholeWord', false); F.setFindOption('regex', true);
          F.runFind('cat\\w+');
          t('doc feature: find regular expression', F.findHits() === 1, String(F.findHits()));
          F.setFindOption('regex', false);
          fed.commands.find();
          await wait(40);
          const fbar = fpane.querySelector('.doc-find-bar');
          fbar.querySelector('.doc-find-input').value = 'cat';
          fbar.querySelector('.doc-find-input').dispatchEvent(new Event('input', { bubbles: true }));
          fbar.querySelector('.doc-replace-input').value = 'dog';
          F.replaceAll();
          t('doc feature: replace all', !/cat/i.test(fb.textContent.replace(/catalog/i, '')) && /dog/.test(fb.textContent), fb.textContent);
          fbar.querySelector('.doc-find-close').click();

          // paste clean-up
          const cleaned = F.cleanPaste('<p class=MsoNormal style="mso-fareast-font-family:Calibri;color:black"><b>Bold</b><o:p></o:p></p><p style="mso-list:l0 level1 lfo1"><span style="mso-list:Ignore">·<span> </span></span>Item</p>');
          t('doc feature: paste from Word is cleaned', !/mso|Mso|o:p/.test(cleaned) && /<ul><li>Item<\/li><\/ul>/.test(cleaned) && /<b>Bold<\/b>/.test(cleaned), cleaned);

          // format painter
          fb.innerHTML = '<p><b><i>src</i></b> target</p>';
          caretAt(fb.querySelector('i').firstChild, 1);
          const fmt = F.captureFormat();
          { const tn = fb.firstChild.lastChild; selNode(tn, 1, 7); }
          F.applyFormat(fmt);
          t('doc feature: format painter copies bold and italic', fb.querySelectorAll('b, strong').length >= 2 && fb.querySelectorAll('i, em').length >= 2, fb.innerHTML);

          // pictures
          fb.innerHTML = '<p>pic </p>';
          caretAt(fb.firstChild.firstChild, 4);
          F.paste('<img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==" alt="dot" style="width:40px;height:30px">');
          const im = fb.querySelector('img');
          t('doc feature: picture pasted', !!im);
          if (im) {
            F.selectImage(im);
            const ov = F.imageOverlay();
            t('doc feature: picture tools appear', !!(ov && ov.querySelector('.doc-img-handle.h-se') && ov.querySelector('.doc-img-bar')));
            ov.querySelector('[data-img-align="center"]').click();
            t('doc feature: picture centred', im.closest('p').style.textAlign === 'center');
            t('doc feature: picture tools never reach the file', !/doc-img|is-selected/.test(fed.getData().html));
          }

          // header, footer, page numbers, status
          F.setLayout({ headerText: 'Report', footerText: 'Confidential', showPageNumbers: true });
          t('doc feature: header and footer drawn in the margins',
            /Report/.test(fpane.querySelector('.doc-page-header').textContent) && /Page 1 of/.test(fpane.querySelector('.doc-page-footer').textContent));
          t('doc feature: status line', /^[\d,]+ words? · [\d,]+ characters? · Page \d+ of \d+$/.test(fed.commands.status()), fed.commands.status());
          F.setSpellcheck(false);
          t('doc feature: spell check can be turned off', [...fpane.querySelectorAll('.doc-page-body')].every((b) => b.spellcheck === false));
          F.setSpellcheck(true);

          // and everything above survives Save as .docx and reopening
          fb.innerHTML = '<p class="margo-title">Saved</p><ul class="margo-checklist"><li class="is-checked">Done</li></ul>' +
            '<table style="width:100%"><thead><tr><th>H</th></tr></thead><tbody><tr><td>c</td></tr></tbody></table>' +
            '<p>ref</p>';
          caretAt(fb.lastChild.firstChild, 3);
          F.insertFootnote();
          await wait(40);
          const rs = await T.saveTo(joinTmp('ui-features.docx'));
          t('doc feature: save as docx', rs && rs.ok, rs && rs.error);
          if (rs && rs.ok) {
            T.state.dirty = false;
            await T.closeTab(T.state.activeTabId);
            await T.openFromPath(joinTmp('ui-features.docx'));
            await wait(300);
            const rp = document.querySelector('.tab-pane:not([hidden])');
            const html2 = rp ? rp.querySelector('.doc-pages').innerHTML : '';
            t('doc feature: docx reopen keeps title, checklist, header row, footnote',
              /margo-title/.test(html2) && /margo-checklist[\s\S]*is-checked/.test(html2) && /<th/.test(html2) && /margo-fn-ref/.test(html2),
              html2.slice(0, 300));
            const lay = T.getEditor()._test.layout();
            t('doc feature: docx reopen keeps header, footer and page numbers',
              lay.headerText === 'Report' && lay.footerText === 'Confidential' && lay.showPageNumbers === true, JSON.stringify(lay));
          }
        }
        T.state.dirty = false;
        if (T.state.activeTabId && T.state.activeTabId !== prevTabId) await T.closeTab(T.state.activeTabId);
        if (prevTabId && T.activateTab) await T.activateTab(prevTabId);
        await wait(60);
      }
      // themed save modal (Don't Save)
      T.state.dirty = true;
      const dirtyPromise = T.resolveDirty();
      await wait(80);
      const backdrop = document.getElementById('modal-backdrop');
      t('save changes modal opens', backdrop && !backdrop.classList.contains('hidden')
        && backdrop.textContent.includes('Save changes'));
      await shot('save-modal.png');
      const discardBtn = [...document.querySelectorAll('#modal-actions .btn')]
        .find((b) => b.textContent === "Don't Save");
      if (discardBtn) discardBtn.click();
      const dirtyOk = await dirtyPromise;
      t('save modal discard proceeds', dirtyOk === true);
      T.state.dirty = false;
      await shot('editor-doc.png');
      T.applyTheme('dark', false);
      await shot('editor-doc-dark.png');
      T.applyTheme('light', false);
      r = await T.saveTo(joinTmp('ui-doc-roundtrip.md'));
      t('doc -> md export (real IPC)', r && r.ok, r && r.error);
      r = await T.saveTo(joinTmp('ui-out.docx'));
      t('doc save as docx (real IPC)', r && r.ok, r && r.error);
      const docThumbUrl = await window.MargoThumbs.generate(T.state.doc, T.getEditor().getData());
      t('doc thumbnail generates', !!docThumbUrl && docThumbUrl.length > 500);
      t('doc -> pdf export (printToPDF)', await T.exportTo(joinTmp('export-doc.pdf')));
      T.state.dirty = false;

      // 5. sheet editor
      await T.openFromPath(cfg.xlsxPath);
      t('sheet editor mounts', T.state.doc && T.state.doc.kind === 'sheet');
      await wait(250);
      const ed = T.getEditor();
      t('sheet cell A1 loaded', ed._test.getCell(0, 0) === 'Item', ed._test.getCell(0, 0));
      t('sheet tabs render', document.querySelectorAll('.tab-pane:not([hidden]) .sheet-tab').length === 2
        || document.querySelectorAll('.sheet-tab').length === 2);
      t('sheet ribbon renders 5 tabs', document.querySelectorAll('.sheet-ribbon-tab').length === 5);
      t('sheet font toolbar present',
        !!(document.querySelector('.tab-pane:not([hidden]) .tb-select.tb-font')
          && document.querySelector('.tab-pane:not([hidden]) .tb-select.tb-font-variant')
          && document.querySelector('.tab-pane:not([hidden]) .tb-select.tb-size')));
      const sheetMenubar = document.getElementById('menubar');
      const sheetMenuTops = document.querySelectorAll('#menubar .menu-top');
      const sheetMenuCs = sheetMenubar && getComputedStyle(sheetMenubar);
      t('menubar visible in sheet', !!(sheetMenubar && sheetMenuTops.length === 4 && sheetMenuCs && sheetMenuCs.display !== 'none' && parseFloat(sheetMenuCs.height) > 0),
        sheetMenuCs ? `display=${sheetMenuCs.display} h=${sheetMenuCs.height} menus=${sheetMenuTops.length}` : 'no menubar');
      t('sheet home button present', !!document.querySelector('.sheet-home-btn'));
      const titleRect = document.getElementById('titlebar') && document.getElementById('titlebar').getBoundingClientRect();
      const menuRect = sheetMenubar && sheetMenubar.getBoundingClientRect();
      const homeRect = document.getElementById('btn-home') && document.getElementById('btn-home').getBoundingClientRect();
      t('sheet chrome on screen', !!(titleRect && titleRect.top >= 0 && titleRect.bottom > 8
        && menuRect && menuRect.top >= 0 && menuRect.bottom > titleRect.bottom - 1
        && homeRect && homeRect.top >= 0 && homeRect.height > 0),
        titleRect && menuRect ? `title.top=${titleRect.top} menu.top=${menuRect.top} home.top=${homeRect && homeRect.top}` : 'missing chrome');

      // Test formula engine calculations
      ed._test.setCell(1, 1, '10');
      ed._test.setCell(2, 1, '20');
      ed._test.setCell(3, 1, '=SUM(B2:B3)');
      t('sheet formula SUM calculates', ed._test.getFormatted(3, 1) === '30', ed._test.getFormatted(3, 1));
      ed._test.setCell(4, 1, '=IF(B4>25, "Big", "Small")');
      t('sheet formula IF calculates', ed._test.getFormatted(4, 1) === 'Big', ed._test.getFormatted(4, 1));
      ed._test.setCell(5, 1, '=AVERAGE(B2:B3)');
      t('sheet formula AVERAGE calculates', ed._test.getFormatted(5, 1) === '15', ed._test.getFormatted(5, 1));
      /* setCell takes a row and column index, so (6, 1) is B7 and (6, 2) is
         C7. These read A6 and B6, which are two rows above the cells the test
         fills and always empty - so the comparisons passed on 0 <= 0 and the
         unary-minus check had been failing since it was written. */
      ed._test.setCell(6, 1, '5');
      ed._test.setCell(6, 2, '10');
      ed._test.setCell(7, 1, '=B7<=C7');
      ed._test.setCell(7, 2, '=B7<>C7');
      ed._test.setCell(7, 3, '=-B7');
      ed._test.setCell(8, 1, '=ROUND(1234,-1)');
      t('sheet formula comparisons', ed._test.getFormatted(7, 1) === 'TRUE' && ed._test.getFormatted(7, 2) === 'TRUE',
        `${ed._test.getFormatted(7, 1)} / ${ed._test.getFormatted(7, 2)}`);
      t('sheet formula unary minus', ed._test.getFormatted(7, 3) === '-5', ed._test.getFormatted(7, 3));
      t('sheet formula ROUND negative digits', ed._test.getFormatted(8, 1) === '1230', ed._test.getFormatted(8, 1));

      /* Grouping, a leading sign and more than one call per formula: each of
         these used to return a plausible number rather than the right one. */
      const formulaCases = [
        ['=SUM(B2:B3)+SUM(B2:B3)', '60'],
        ['=MAX(B2:B3)-MIN(B2:B3)', '10'],
        ['=(1+2)*3', '9'],
        ['=B2*(B3+B2)', '300'],
        ['=-5+3', '-2'],
        ['=2*-3', '-6'],
        ['=SUM(B2:B3)/(B2+B3)', '1']
      ];
      const formulaBad = [];
      formulaCases.forEach(([formula, want], i) => {
        ed._test.setCell(10 + i, 5, formula);
        const got = ed._test.getFormatted(10 + i, 5);
        if (got !== want) formulaBad.push(`${formula} => ${got} (want ${want})`);
      });
      t('sheet formula grouping, sign and multiple calls', formulaBad.length === 0, formulaBad.join(' | '));

      /* Sorting used to permute the rows in place while still reading from
         them, so a sorted column came back with values duplicated and the
         rows they displaced lost. */
      ed._test.setCell(20, 6, '3');
      ed._test.setCell(21, 6, '1');
      ed._test.setCell(22, 6, '2');
      ed._test.sortRangeCells(20, 22, 6, true);
      const sorted = [20, 21, 22].map((r) => ed._test.getCell(r, 6)).join(',');
      t('sheet sort keeps every row', sorted === '1,2,3', sorted);

      /* Every action button closed the modal it belonged to, so Next stepped
         to the second match and shut the dialog on its way out. */
      ed._test.setCell(30, 7, 'findme');
      ed._test.setCell(31, 7, 'findme');
      ed.commands.find();
      await wait(80);
      const sheetFindInput = document.querySelector('#modal-body .sheet-fx-search');
      if (sheetFindInput) {
        sheetFindInput.value = 'findme';
        sheetFindInput.dispatchEvent(new Event('input', { bubbles: true }));
        await wait(60);
      }
      const sheetNameBox = document.querySelector('.tab-pane:not([hidden]) .sheet-namebox')
        || document.querySelector('.sheet-namebox');
      const firstMatchRef = sheetNameBox && sheetNameBox.textContent;
      const nextBtn = [...document.querySelectorAll('#modal-actions .btn')]
        .find((b) => b.textContent.indexOf('Next') >= 0);
      if (nextBtn) nextBtn.click();
      await wait(60);
      const findBackdrop = document.getElementById('modal-backdrop');
      const stillOpen = !!(findBackdrop && !findBackdrop.classList.contains('hidden'));
      const secondMatchRef = sheetNameBox && sheetNameBox.textContent;
      t('sheet find Next steps without closing',
        !!nextBtn && stillOpen && firstMatchRef === 'H31' && secondMatchRef === 'H32',
        `${firstMatchRef} -> ${secondMatchRef} open=${stillOpen}`);
      const findCloseBtn = [...document.querySelectorAll('#modal-actions .btn')]
        .find((b) => b.textContent === 'Close');
      if (findCloseBtn) findCloseBtn.click();
      await wait(40);
      t('sheet find closes on Close',
        !!document.getElementById('modal-backdrop').classList.contains('hidden'));
      ed._test.setCell(30, 7, '');
      ed._test.setCell(31, 7, '');

      /* AutoSum on the top row built =SUM(A1:A0), a reversed range that takes
         in the cell being written, so it came back #CIRCULAR! and showed 0.
         It now adds up the cells to the left, as a spreadsheet does. */
      ed._test.setCell(0, 10, '1');
      ed._test.setCell(0, 11, '2');
      ed._test.setCell(0, 12, '3');
      ed._test.select(0, 13);
      ed._test.autoSum();
      t('autosum on the top row adds the row', ed._test.getFormatted(0, 13) === '6',
        `${ed._test.getCell(0, 13)} => ${ed._test.getFormatted(0, 13)}`);
      ed._test.setCell(1, 10, '10');
      ed._test.select(2, 10);
      ed._test.autoSum();
      t('autosum below the top row adds the column', ed._test.getFormatted(2, 10) === '11',
        `${ed._test.getCell(2, 10)} => ${ed._test.getFormatted(2, 10)}`);
      [[0, 10], [0, 11], [0, 12], [0, 13], [1, 10], [2, 10]].forEach(([r, c]) => ed._test.setCell(r, c, ''));

      t('MOD by zero is an error, not zero', ed._test.evalFormula('=MOD(10,0)') === '#DIV/0!',
        String(ed._test.evalFormula('=MOD(10,0)')));

      /* setCell repainted every cell on screen, so a paste did that once per
         pasted cell - a hundred cells meant a hundred passes over the whole
         grid. The bulk callers now repaint once at the end. */
      const pasteRows = 40;
      const pasteCols = 8;
      const tsv = Array.from({ length: pasteRows }, (_, r) =>
        Array.from({ length: pasteCols }, (_, c) => String(r * pasteCols + c)).join('\t')).join('\n');
      ed._test.select(40, 0);
      const repaintsBefore = ed._test.recalcCount();
      const pasteStart = performance.now();
      ed.commands.paste(tsv);
      const pasteMs = Math.round(performance.now() - pasteStart);
      const repaints = ed._test.recalcCount() - repaintsBefore;
      const pastedOk = ed._test.getCell(40, 0) === '0'
        && ed._test.getCell(40, 7) === '7'
        && ed._test.getCell(79, 7) === String(pasteRows * pasteCols - 1);
      t('paste writes every cell it was given', pastedOk,
        `[0,0]=${ed._test.getCell(40, 0)} [39,7]=${ed._test.getCell(79, 7)}`);
      t('paste repaints once, not once per cell', repaints === 1,
        `${repaints} repaints for ${pasteRows * pasteCols} cells, ${pasteMs}ms`);
      for (let r = 40; r < 40 + pasteRows; r++) {
        for (let c = 0; c < pasteCols; c++) ed._test.setCell(r, c, '');
      }
      ed._test.select(0, 0);

      /* ---- spreadsheet engine, editing and structure (rows 200+ so the
         sample data above stays as the save tests expect) ---- */
      {
        const S = ed._test;
        const fx = (f) => S.evalFormula(f, 300, 20);
        const fnCases = [
          ['=IFERROR(1/0,"none")', 'none'], ['=XLOOKUP(2,{1,2,3},{"a","b","c"})', 'b'],
          ['=TEXTJOIN("-",TRUE,"a","","b")', 'a-b'], ['=SUBSTITUTE("a.b.c",".","/")', 'a/b/c'],
          ['=PROPER("margo sheet")', 'Margo Sheet'], ['=TEXT(1234.5,"#,##0.00")', '1,234.50'],
          ['=ROUNDUP(2.341,2)', 2.35], ['=MEDIAN(3,1,2,10)', 2.5], ['=YEAR(DATE(2026,3,1))', 2026],
          ['=WEEKDAY(DATE(2026,9,27))', 1], ['=IFS(1>2,"x",TRUE,"y")', 'y'], ['=COUNTIF({1,5,9},">4")', 2],
          ['=2^-1+10%', 0.6], ['="a"&1+1', 'a2'], ['=-2^2', 4], ['=NOPE(1)', '#NAME?'], ['=1/0', '#DIV/0!'],
          ['="x"+1', '#VALUE!'], ['=SQRT(-1)', '#NUM!']
        ];
        const fnBad = fnCases.filter(([f, want]) => {
          const got = fx(f);
          return typeof want === 'number' ? Math.abs(got - want) > 1e-9 : got !== want;
        }).map(([f, want]) => `${f} => ${fx(f)} (want ${want})`);
        t('sheet function library and operators', fnBad.length === 0, fnBad.join(' | '));

        S.setCell(200, 0, '10'); S.setCell(201, 0, '20'); S.setCell(202, 0, '=SUM(A201:A202)');
        S.setCell(203, 0, '=A204'); S.setCell(204, 0, '=A204+1');
        t('sheet circular reference is an error', S.getFormatted(203, 0) === '#CIRCULAR!' || S.getFormatted(204, 0) === '#CIRCULAR!', S.getFormatted(204, 0));
        S.setCell(203, 0, ''); S.setCell(204, 0, '');

        // inserting a row inside the summed block moves the formula and widens its range
        S.select(201, 0); S.insertRows('above');
        t('sheet insert row shifts references', S.getCell(203, 0) === '=SUM(A201:A203)' && S.getFormatted(203, 0) === '30', S.getCell(203, 0));
        S.select(201, 0); S.deleteRows();
        t('sheet delete row shrinks references', S.getCell(202, 0) === '=SUM(A201:A202)' && S.getFormatted(202, 0) === '30', S.getCell(202, 0));

        // copy/paste moves relative references; $ stays put
        S.setCell(200, 1, '=A201*$A$201');
        S.selectRange(200, 1, 200, 1); S.copy(false); S.select(201, 1); S.pasteInternal(false);
        t('sheet paste adjusts relative references', S.getCell(201, 1) === '=A202*$A$201' && S.getFormatted(201, 1) === '200', S.getCell(201, 1));

        // fill handle series
        S.setCell(210, 0, '1'); S.setCell(211, 0, '3'); S.setCell(210, 1, 'Mon'); S.setCell(210, 2, 'Q1');
        S.fill('A211:A212', 'A211:A214'); S.fill('B211:C211', 'B211:C213');
        const series = [S.getCell(213, 0), S.getCell(212, 1), S.getCell(212, 2)].join(',');
        t('sheet fill continues series', series === '7,Wed,Q3', series);

        // typing through the real cell editor, with autocomplete
        t('sheet autocomplete lists functions', S.autocomplete('=VLO').includes('VLOOKUP'), S.autocomplete('=VLO').join(','));
        S.typeInto(215, 0, '=a201+a202');
        t('sheet typed formula is tidied', S.getCell(215, 0) === '=A201+A202' && S.getFormatted(215, 0) === '30', S.getCell(215, 0));

        // number formats, merge, status, undo
        S.setCell(216, 0, '1234.5'); S.select(216, 0); S.setNumFmt('"$"#,##0.00');
        t('sheet currency format displays', S.getFormatted(216, 0) === '$1,234.50', S.getFormatted(216, 0));
        S.setNumFmt('0.0%');
        t('sheet percent format displays', S.getFormatted(216, 0) === '123450.0%', S.getFormatted(216, 0));
        S.selectRange(200, 0, 201, 0);
        t('sheet status shows sum/average/count', ed.commands.status() === 'Sum: 30 · Average: 15 · Count: 2', ed.commands.status());
        S.selectRange(220, 0, 221, 1); S.merge();
        t('sheet merge cells', !!S.mergeAt(221, 1) && S.mergeAt(221, 1).r1 === 220);
        S.undo();
        t('sheet undo unmerges', !S.mergeAt(221, 1));

        // conditional formatting and validation
        S.addCondFormat({ range: 'A201:A202', type: 'gt', v1: '15', style: { fill: '#c6efce' } });
        t('sheet conditional format rule applies', !S.cellCss(200, 0) && S.cellCss(201, 0) && S.cellCss(201, 0).fill === '#c6efce');
        S.addValidation({ range: 'D201:D205', type: 'list', values: ['Yes', 'No'], strict: true });
        const rejected = S.typeInto(200, 3, 'Maybe') === false;
        S.select(0, 0);
        t('sheet list validation rejects other values', rejected && S.getCell(200, 3) === '');

        // a big sheet renders only what is on screen
        t('sheet grid is virtualised', S.renderedCells() > 50 && S.renderedCells() < 3000, `${S.renderedCells()} cells in the DOM`);

        for (let r = 200; r <= 222; r++) for (let c = 0; c <= 3; c++) S.setCell(r, c, '');
        S.select(0, 0);
      }

      // Test cell sizing and text size
      ed._test.setColWidth(0, 150);
      t('sheet col width resized', ed._test.getColWidth(0) === 150);
      ed._test.setRowHeight(0, 32);
      t('sheet row height resized', ed._test.getRowHeight(0) === 32);
      ed._test.setFontSize(16);
      t('sheet font size set', true);

      ed._test.setCell(0, 0, 'Changed by smoke');
      t('sheet edit marks dirty', T.state.dirty === true);
      await shot('editor-sheet.png');
      T.applyTheme('dark', false);
      await shot('editor-sheet-dark.png');
      T.applyTheme('light', false);
      r = await T.saveTo(joinTmp('ui-out.xlsx'));
      t('sheet save xlsx (real IPC)', r && r.ok, r && r.error);
      r = await T.saveTo(joinTmp('ui-out.csv'));
      t('sheet -> csv export (real IPC)', r && r.ok, r && r.error);
      const sheetThumbUrl = await window.MargoThumbs.generate(T.state.doc, T.getEditor().getData());
      t('sheet thumbnail generates', !!sheetThumbUrl && sheetThumbUrl.length > 500);
      t('sheet -> pdf export (printToPDF)', await T.exportTo(joinTmp('export-sheet.pdf')));
      T.state.dirty = false;

      // 5b. exported PDF opens in Margo's own viewer
      await T.openFromPath(joinTmp('export-md.pdf'));
      t('exported pdf opens in viewer', T.state.doc.kind === 'pdf' && T.getEditor()._test.numPages() >= 1,
        `pages=${T.getEditor()._test.numPages()}`);
      for (let i = 0; i < 40 && !T.getEditor()._test.firstPageRendered(); i++) await wait(150);
      t('exported pdf page renders', T.getEditor()._test.firstPageRendered(), T.getEditor()._test.firstPageError());
      await shot('export-pdf-view.png');

      // 6. pdf viewer
      await T.openFromPath(cfg.pdfPath);
      t('pdf viewer mounts', T.state.doc && T.state.doc.kind === 'pdf');
      const ped = T.getEditor();
      t('pdf pages loaded', ped._test.numPages() === 2, `pages=${ped._test.numPages()}`);
      for (let i = 0; i < 60 && !ped._test.firstPageRendered(); i++) await wait(150);
      t('pdf first page rendered', ped._test.firstPageRendered(), ped._test.firstPageError());

      /* A failed render used to be retried from a finally that only asked
         whether the page had rendered, so a page that could never render was
         retried without limit for as long as the tab stayed open. */
      if (ped._test.renderFailureProbe) {
        const probe = await ped._test.renderFailureProbe(0);
        t('pdf render failure stops retrying',
          !!probe && probe.calls > 0 && probe.calls <= 3 && !probe.stillRendering,
          probe ? `${probe.calls} attempts, rendering=${probe.stillRendering}` : 'no probe');
        t('pdf render failure explains itself on the page', !!(probe && probe.noted));
        for (let i = 0; i < 60 && !ped._test.firstPageRendered(); i++) await wait(150);
        t('pdf page recovers after a forced failure', ped._test.firstPageRendered(),
          ped._test.firstPageError());
      }

      /* pdf editor features: status, thumbnails, text layer, page
         operations with undo, and annotations burned in the right place on
         a rotated page. Every change is undone so the signature test below
         starts from the untouched sample. */
      if (ped._test.rotate) {
        const PT = ped._test;
        t('pdf status shows page and zoom', /^Page 1 of 2 · \d+%$/.test(ped.commands.status()), ped.commands.status());
        t('pdf thumbnails list every page', PT.thumbsCount() === 2, `${PT.thumbsCount()} thumbs`);
        for (let i = 0; i < 30 && !PT.textLayerSpans(0); i++) await wait(100);
        t('pdf text layer renders for selection', PT.textLayerSpans(0) > 0, `${PT.textLayerSpans(0)} spans`);
        ped.commands.goToPage(2);
        await wait(120);
        t('pdf go to page', PT.currentPage() === 2, `page ${PT.currentPage()}`);
        ped.commands.goToPage(1);
        await PT.rotate(1, 1);
        t('pdf rotate page', JSON.stringify(PT.pageSizes()[1]) === '[792,612,90]', JSON.stringify(PT.pageSizes()[1]));
        t('pdf page edit marks dirty', T.state.dirty === true);
        PT.addAnn({ type: 'text', pageIndex: 1, xr: 0.1, yr: 0.2, wr: 0.5, hr: 0.05, text: 'SMOKE MARK', size: 18 });
        PT.addAnn({ type: 'highlight', pageIndex: 0, rects: [{ xr: 0.1, yr: 0.1, wr: 0.3, hr: 0.04 }], color: '#ffd60a' });
        PT.addAnn({ type: 'note', pageIndex: 0, xr: 0.8, yr: 0.1, text: 'Smoke note' });
        try {
          const outBytes = await PT.output();
          const outDoc = await pdfjsLib.getDocument({ data: outBytes, isEvalSupported: false }).promise;
          const p2 = await outDoc.getPage(2);
          const vp = p2.getViewport({ scale: 1 });
          const item = (await p2.getTextContent()).items.find((it) => it.str === 'SMOKE MARK');
          const tx = item ? pdfjsLib.Util.transform(vp.transform, item.transform) : null;
          t('pdf text box burns upright on a rotated page',
            !!tx && tx[0] > 0 && Math.abs(tx[1]) < 0.01 && Math.abs(tx[4] - (0.1 * vp.width + 4)) < 3,
            tx ? tx.map((v) => v.toFixed(1)).join(',') : 'text not found');
          const notes = (await (await outDoc.getPage(1)).getAnnotations()).filter((a) => a.annotationType === 1);
          t('pdf sticky note becomes a PDF annotation', notes.length === 1);
          outDoc.destroy();
        } catch (err) {
          t('pdf text box burns upright on a rotated page', false, err.message);
        }
        await PT.deletePage(0);
        t('pdf delete page', PT.numPages() === 1 && PT.anns().every((a) => a.pageIndex === 0), `${PT.numPages()} pages`);
        for (let k = 0; k < 8 && ped.commands.canUndo(); k++) await ped.commands.undo();
        t('pdf undo restores pages and annotations',
          PT.numPages() === 2 && PT.placementsCount() === 0 && PT.pageSizes()[1][2] === 0,
          `${PT.numPages()} pages, ${PT.placementsCount()} edits, rot ${PT.pageSizes()[1][2]}`);
        t('pdf page ranges parse', JSON.stringify(PT.parseRanges('1-2', 2)) === '[0,1]' && PT.parseRanges('3', 2) === null);
        for (let i = 0; i < 60 && !PT.firstPageRendered(); i++) await wait(100);
      }

      if (ped.commands && ped.commands.find) await ped.commands.find();
      await wait(80);
      t('pdf find bar opens', !!document.querySelector('.tab-pane:not([hidden]) .pdf-scroll') &&
        !!(document.querySelector('.tab-pane:not([hidden]) .doc-find-bar') && !document.querySelector('.tab-pane:not([hidden]) .doc-find-bar').classList.contains('hidden')));
      {
        const pdfBar = document.querySelector('.tab-pane:not([hidden]) .doc-find-bar');
        const pdfFind = pdfBar && pdfBar.querySelector('.doc-find-input');
        if (pdfFind) {
          pdfFind.focus();
          pdfFind.value = 'e';
          pdfFind.dispatchEvent(new Event('input', { bubbles: true }));
          await wait(40);
          t('pdf find keeps focus while typing', document.activeElement === pdfFind);
          const hits = document.querySelectorAll('.tab-pane:not([hidden]) .pdf-find-hit');
          const countEl = pdfBar.querySelector('.doc-find-count');
          t('pdf find highlights matches', hits.length > 0 || !!(countEl && countEl.textContent.includes('0')));
          if (hits.length) t('pdf find marks current match', !!document.querySelector('.tab-pane:not([hidden]) .pdf-find-hit.current'));
          t('pdf find still focused after highlight', document.activeElement === pdfFind);
        }
      }
      const pdfFindClose = document.querySelector('.tab-pane:not([hidden]) .doc-find-close');
      pdfFindClose && pdfFindClose.click();
      t('pdf find highlights clear on close', !document.querySelector('.tab-pane:not([hidden]) .pdf-find-hit'));
      await shot('editor-pdf.png');

      const extracted = await ped._test.extract();
      const biggest = extracted.reduce((m, im) => Math.max(m, im.w), 0);
      t('pdf image extraction (high-res)', extracted.length >= 1 && biggest >= 256,
        `${extracted.length} images, max width ${biggest}`);

      // signature: draw a tiny scribble PNG, place it, save, confirm burn-in
      const sc = document.createElement('canvas');
      sc.width = 160; sc.height = 50;
      const sx = sc.getContext('2d');
      sx.strokeStyle = '#1c1c30'; sx.lineWidth = 2.5;
      sx.beginPath(); sx.moveTo(8, 38); sx.bezierCurveTo(40, 4, 90, 48, 150, 12); sx.stroke();
      ped._test.addTestSignature(sc.toDataURL('image/png'));
      t('pdf signature placed marks dirty', ped._test.placementsCount() === 1 && T.state.dirty === true);
      await shot('editor-pdf-signed.png');
      r = await T.saveTo(joinTmp('ui-signed.pdf'));
      t('pdf save with signature (real IPC)', r && r.ok, r && r.error);
      t('pdf placements burned after save', ped._test.placementsCount() === 0);
      const pdfThumbUrl = await window.MargoThumbs.generate(T.state.doc, null);
      t('pdf thumbnail generates', !!pdfThumbUrl && pdfThumbUrl.length > 500);
      T.state.dirty = false;

      await T.newDoc('pdf');
      t('new blank pdf mounts', T.state.doc && T.state.doc.kind === 'pdf' && !T.state.doc.path);
      const blankEd = T.getEditor();
      t('new blank pdf has a page', !!(blankEd && blankEd._test.numPages() >= 1),
        `pages=${blankEd && blankEd._test.numPages()}`);
      for (let i = 0; i < 40 && blankEd && !blankEd._test.firstPageRendered(); i++) await wait(150);
      t('new blank pdf page renders', !!(blankEd && blankEd._test.firstPageRendered()),
        blankEd && blankEd._test.firstPageError());
      r = await T.saveTo(joinTmp('ui-new-blank.pdf'));
      t('new blank pdf save (real IPC)', r && r.ok, r && r.error);
      T.state.dirty = false;
      if (T.state.activeTabId) await T.closeTab(T.state.activeTabId);

      /* 6c. A Word document listens for keys on the document, not on its own
         pane, so with more than one open they all used to act on the same
         keystroke. Ctrl+Enter appended a blank page to every open document,
         and only the front one was marked unsaved. */
      T.resetSession();
      await T.newDoc('doc');
      const bgTab = T.state.tabs[T.state.tabs.length - 1];
      await T.newDoc('doc');
      const fgTab = T.state.tabs[T.state.tabs.length - 1];
      t('two doc tabs open', T.state.tabs.length === 2 && fgTab.id === T.state.activeTabId,
        `tabs=${T.state.tabs.length} active=${T.state.activeTabId}`);
      const bgPagesBefore = bgTab.editor._test.pageCount();
      const fgPagesBefore = fgTab.editor._test.pageCount();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }));
      await wait(80);
      const bgPagesAfter = bgTab.editor._test.pageCount();
      const fgPagesAfter = fgTab.editor._test.pageCount();
      t('Ctrl+Enter pages only the front tab',
        fgPagesAfter === fgPagesBefore + 1 && bgPagesAfter === bgPagesBefore,
        `front ${fgPagesBefore}->${fgPagesAfter}, behind ${bgPagesBefore}->${bgPagesAfter}`);
      T.resetSession();

      // 7. md library thumb skipped (Markdown recents use type icons)
      await T.openFromPath(cfg.welcomePath);
      const mdThumbUrl = await window.MargoThumbs.generate(T.state.doc, T.getEditor().getData());
      t('md library thumb skipped', mdThumbUrl == null);
      T.state.dirty = false;

      // 8. back home + home tiles populated with thumbs
      T.showLanding();
      for (let i = 0; i < 40 && document.querySelectorAll('.home-tile-cover:not(.home-tile-cover-type) img').length < 1; i++) {
        await wait(200);
      }
      await wait(200);
      t('landing returns', T.state.view === 'home');
      t('sidebar hidden after home', shell.classList.contains('view-home'));
      const tiles = document.querySelectorAll('.home-tile');
      t('recents populated', tiles.length >= 1, `${tiles.length} tiles`);
      t('md recent uses type icon', !!document.querySelector('.home-tile-cover-type img'));
      t('recents show content thumbnails', document.querySelectorAll('.home-tile-cover:not(.home-tile-cover-type) img').length >= 1,
        `${document.querySelectorAll('.home-tile-cover:not(.home-tile-cover-type) img').length} content thumbs`);
      await shot('landing-recents.png');

      /* A spreadsheet or PDF in the library needs its document opened and
         rasterized, too much to do under the tiles - so those entries wait
         for the library to go off screen. They used to be shifted off the
         queue here and put nowhere, so they never got a thumbnail at all. */
      const backfill = T.thumbBackfill;
      backfill.reset();
      backfill.queue(cfg.xlsxPath);
      for (let i = 0; i < 40 && backfill.state().deferred.indexOf(cfg.xlsxPath) < 0; i++) await wait(100);
      const heldState = backfill.state();
      t('library holds heavy thumbnails instead of dropping them',
        heldState.deferred.indexOf(cfg.xlsxPath) >= 0,
        `queued=${heldState.queued.length} deferred=${heldState.deferred.length}`);

      await T.openFromPath(cfg.welcomePath);
      for (let i = 0; i < 60 && backfill.state().seen.indexOf(cfg.xlsxPath) < 0; i++) await wait(100);
      const resumedState = backfill.state();
      t('library resumes them once it is off screen',
        resumedState.deferred.indexOf(cfg.xlsxPath) < 0
          && resumedState.seen.indexOf(cfg.xlsxPath) >= 0,
        `deferred=${resumedState.deferred.length} queued=${resumedState.queued.length} seen=${resumedState.seen.length}`);
      T.state.dirty = false;

      /* One hidden window paints every document card, so two requests in
         flight together used to abort each other's load, and whichever
         capture ran next returned the wrong card. */
      const cardHtml = (label) =>
        '<!doctype html><meta charset="utf-8"><body style="margin:0;background:#fff">' +
        `<div style="font:700 44px sans-serif;padding:48px">${label}</div>`;
      const overlapping = await Promise.all([1, 2, 3, 4].map((n) =>
        window.margo.renderHtmlThumb({ html: cardHtml('Card ' + n), width: 220, height: 284 })));
      const okCount = overlapping.filter((res) => res && res.ok && res.dataUrl).length;
      const distinct = new Set(overlapping.filter((res) => res && res.dataUrl).map((res) => res.dataUrl)).size;
      t('overlapping thumbnail renders all succeed', okCount === 4,
        `${okCount}/4 :: ${overlapping.map((res) => (res && res.ok ? 'ok' : (res && res.error) || 'fail')).join(' | ')}`);
      t('overlapping thumbnail renders return their own card', distinct === 4,
        `${distinct} distinct of ${okCount}`);

      /* A second modal opening over the first replaced the resolver, so
         whoever was awaiting the first waited on a promise nothing could
         settle - showShareModal and showOpenFromDrive both await theirs. */
      {
        let firstSettled = false;
        const firstBody = document.createElement('div');
        firstBody.textContent = 'first';
        const firstModal = T.openModal('First', firstBody, [{ label: 'Close', value: 'first-closed' }]);
        firstModal.then(() => { firstSettled = true; });
        await wait(40);
        const secondBody = document.createElement('div');
        secondBody.textContent = 'second';
        const secondModal = T.openModal('Second', secondBody, [{ label: 'Close', value: 'second-closed' }]);
        await wait(60);
        t('a modal opening over another settles the first', firstSettled,
          firstSettled ? '' : 'first modal promise never resolved');
        const closeSecond = [...document.querySelectorAll('#modal-actions .btn')]
          .find((b) => b.textContent === 'Close');
        if (closeSecond) closeSecond.click();
        t('the modal on top still answers with its own value',
          (await secondModal) === 'second-closed');
        await wait(40);
      }
    } catch (err) {
      t('suite crashed', false, err.stack || err.message);
    }
    try {
      await shellSuite(T, cfg, joinTmp);
    } catch (err) {
      t('shell suite crashed', false, err.stack || err.message);
    }
    try {
      await slidesSuite(T, cfg, joinTmp);
    } catch (err) {
      t('slides suite crashed', false, err.stack || err.message);
    }
    window.margo.smoke.report(results);
  });
})();
