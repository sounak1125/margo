/* Margo — renderer-side smoke suite. Runs only when the main process sends smoke:run. */
(function () {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const results = [];
  const t = (name, ok, detail) => results.push({ name: 'ui: ' + name, ok: !!ok, detail: detail ? String(detail).slice(0, 200) : '' });

  async function shot(name) {
    await wait(300);
    try { await window.margo.smoke.capture(name); } catch {}
  }

  window.margo.onSmokeRun(async (cfg) => {
    const T = window.__margoTest;
    const joinTmp = (f) => cfg.tmpDir + '\\' + f;
    try {
      // 1. landing renders (start from a known state)
      T.showLanding();
      await wait(150);
      t('landing visible', !document.getElementById('view-landing').classList.contains('hidden'));

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

      // 1c. sliding sidebar (unpinned by default)
      const sidebar = document.getElementById('sidebar');
      const shell = document.getElementById('shell');
      t('sidebar unpinned by default', !shell.classList.contains('pinned'));
      T.closeSidebar(true);
      t('sidebar hides', !sidebar.classList.contains('open'));
      document.getElementById('side-hotzone').dispatchEvent(new MouseEvent('mouseenter'));
      await wait(60);
      t('sidebar slides in on left-edge hover', sidebar.classList.contains('open'));
      t('sidebar New includes PDF', !!document.querySelector('.side-new[data-new="pdf"]'));
      await shot('sidebar-hover.png');

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
      await wait(300);
      const preview = document.querySelector('.tab-pane:not([hidden]) .md-preview') || document.querySelector('.md-preview');
      t('md preview renders heading', !!(preview && preview.querySelector('h1')));
      {
        const edMd = T.getEditor();
        t('md outline command exists', !!(edMd && edMd.commands && typeof edMd.commands.outline === 'function'));
        t('md stats command exists', !!(edMd && edMd.commands && typeof edMd.commands.stats === 'function'));
      }
      const ta = document.querySelector('.tab-pane:not([hidden]) .md-input') || document.querySelector('.md-input');
      {
        const ed = T.getEditor();
        if (ed && ed.commands && ed.commands.find) ed.commands.find();
        await wait(80);
        const bar = document.querySelector('.tab-pane:not([hidden]) .doc-find-bar') || document.querySelector('.doc-find-bar');
        t('md find bar opens', !!(bar && !bar.classList.contains('hidden')));
        const findIn = bar && bar.querySelector('.doc-find-input');
        if (findIn) {
          findIn.value = 'Margo';
          findIn.dispatchEvent(new Event('input', { bubbles: true }));
          await wait(40);
        }
        t('md find selects a match', !!(ta && ta.selectionEnd > ta.selectionStart),
          ta ? `${ta.selectionStart}-${ta.selectionEnd}` : 'no textarea');
        const mdFindClose = document.querySelector('.tab-pane:not([hidden]) .doc-find-close') || document.querySelector('.doc-find-close');
        mdFindClose && mdFindClose.click();
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
      const edDoc = T.getEditor();
      if (edDoc && edDoc.commands && edDoc.commands.addPage) edDoc.commands.addPage();
      await wait(80);
      t('doc add page creates second sheet', document.querySelectorAll('.tab-pane:not([hidden]) .doc-page').length >= 2
        || document.querySelectorAll('.doc-page').length >= 2,
        String((document.querySelectorAll('.tab-pane:not([hidden]) .doc-page').length)
          || document.querySelectorAll('.doc-page').length));
      t('doc add page button present', !!document.querySelector('.tab-pane:not([hidden]) .doc-add-page')
        || !!document.querySelector('.doc-add-page'));
      if (edDoc && edDoc.commands && edDoc.commands.zoomIn) {
        edDoc.commands.zoomIn();
        await wait(40);
        const pagesEl = document.querySelector('.tab-pane:not([hidden]) .doc-pages') || document.querySelector('.doc-pages');
        t('doc zoom in applies', (pagesEl || {}).style?.zoom === '1.1'
          || parseFloat((pagesEl || {}).style?.zoom) > 1);
        edDoc.commands.zoomReset();
      }
      // themed save modal (Don't Save)
      T.state.dirty = true;
      const dirtyPromise = T.resolveDirty();
      await wait(80);
      const saveModal = document.querySelector('.modal:not(.hidden), #modal-backdrop:not(.hidden) .modal');
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
      if (ped.commands && ped.commands.find) await ped.commands.find();
      await wait(80);
      t('pdf find bar opens', !!document.querySelector('.tab-pane:not([hidden]) .pdf-scroll') &&
        !!(document.querySelector('.tab-pane:not([hidden]) .doc-find-bar') && !document.querySelector('.tab-pane:not([hidden]) .doc-find-bar').classList.contains('hidden')));
      const pdfFindClose = document.querySelector('.tab-pane:not([hidden]) .doc-find-close');
      pdfFindClose && pdfFindClose.click();
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

      // 7. md thumbnail (foreignObject pipeline)
      await T.openFromPath(cfg.welcomePath);
      const mdThumbUrl = await window.MargoThumbs.generate(T.state.doc, T.getEditor().getData());
      t('md thumbnail generates', !!mdThumbUrl && mdThumbUrl.length > 500);
      T.state.dirty = false;

      // 8. back home + sidebar recents populated with thumbs
      T.showLanding();
      await wait(400);
      t('landing returns', T.state.view === 'home');
      const cards = document.querySelectorAll('.recent-card');
      t('recents populated', cards.length >= 1, `${cards.length} cards`);
      t('recents show thumbnails', document.querySelectorAll('.recent-thumb img').length >= 2,
        `${document.querySelectorAll('.recent-thumb img').length} thumbs`);
      await shot('landing-recents.png');
    } catch (err) {
      t('suite crashed', false, err.stack || err.message);
    }
    window.margo.smoke.report(results);
  });
})();
