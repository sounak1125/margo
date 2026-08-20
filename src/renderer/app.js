/* Margo — app shell: sidebar library, routing, save/open, theme, guards */
(function () {
  /* ---------------- icons (16px, stroke = currentColor) ---------------- */
  const S = (d, extra) =>
    `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${d}${extra || ''}</svg>`;
  window.MargoIcons = {
    ul: S('<circle cx="3" cy="4" r="0.5" fill="currentColor"/><circle cx="3" cy="8" r="0.5" fill="currentColor"/><circle cx="3" cy="12" r="0.5" fill="currentColor"/><path d="M6.5 4h7M6.5 8h7M6.5 12h7"/>'),
    ol: S('<path d="M2.5 3.2 3.6 2.5v3.5M2.5 9.5h2l-2 2.8h2M7 4h6.5M7 8h6.5M7 12h6.5"/>'),
    quote: S('<path d="M3 4h10M5.5 8H13M5.5 12H13M3 8v4"/>'),
    code: S('<path d="m5.5 5-3 3 3 3M10.5 5l3 3-3 3"/>'),
    codeblock: S('<rect x="2" y="2.5" width="12" height="11" rx="2"/><path d="m6.5 6.5-2 2 2 2M9.5 6.5l2 2-2 2"/>'),
    link: S('<path d="M6.5 9.5 9.5 6.5M5 7 3.5 8.5a2.47 2.47 0 0 0 3.5 3.5L8.5 10.5M11 9l1.5-1.5A2.47 2.47 0 0 0 9 4L7.5 5.5"/>'),
    table: S('<rect x="2" y="2.5" width="12" height="11" rx="1.5"/><path d="M2 6.5h12M6.5 6.5v7"/>'),
    hr: S('<path d="M2 8h12M5 4h6M5 12h6" opacity="0.4"/><path d="M2 8h12"/>'),
    alignLeft: S('<path d="M2 4h12M2 8h8M2 12h10"/>'),
    alignCenter: S('<path d="M2 4h12M4 8h8M3 12h10"/>'),
    alignRight: S('<path d="M2 4h12M6 8h8M4 12h10"/>'),
    clear: S('<path d="M4 12.5 11.5 5M6 3.5h7v0M9 3.5 5.5 12.5M3 12.5h6"/>'),
    undo: S('<path d="M3 6h7a3.5 3.5 0 0 1 0 7H6"/><path d="M5.5 3.5 3 6l2.5 2.5"/>'),
    redo: S('<path d="M13 6H6a3.5 3.5 0 0 0 0 7h4"/><path d="M10.5 3.5 13 6l-2.5 2.5"/>'),
    plusRow: S('<rect x="2" y="9" width="12" height="4.5" rx="1"/><path d="M8 2v4.5M5.8 4.2h4.4"/>'),
    plusCol: S('<rect x="9" y="2" width="4.5" height="12" rx="1"/><path d="M2 8h4.5M4.2 5.8v4.4"/>'),
    close: S('<path d="m4 4 8 8M12 4l-8 8"/>'),
    open: S('<path d="M8 10.5V2.5M5 5l3-2.7L11 5"/><path d="M2.5 9.5v3a1.5 1.5 0 0 0 1.5 1.5h8a1.5 1.5 0 0 0 1.5-1.5v-3"/>'),
    fileMd: S('<path d="M3.5 2h6L13 5.5V14h-9.5z"/><path d="M5.5 11V8l1.5 1.7L8.5 8v3M10.5 8v3m0 0 1-1m-1 1-1-1"/>'),
    fileDoc: S('<path d="M3.5 2h6L13 5.5V14h-9.5z"/><path d="M5.5 8h5.5M5.5 10.5h5.5M5.5 5.5H8"/>'),
    fileSheet: S('<path d="M3.5 2h6L13 5.5V14h-9.5z"/><path d="M5 8h6.5M5 11h6.5M8 6.5V13"/>'),
    filePdf: S('<path d="M3.5 2h6L13 5.5V14h-9.5z"/><path d="M5.5 8.5c1.5 2.5 3 3.5 5 4-2.5.5-4 .5-5-.5 1-2 1.5-4.5 1.5-6 .5 2 2 4.5 3.5 5.5"/>'),
    pen: S('<path d="m9.5 3.5 3 3L6 13l-3.5.5L3 10z"/><path d="m8.5 4.5 3 3"/>'),
    image: S('<rect x="2" y="3" width="12" height="10" rx="1.8"/><circle cx="5.6" cy="6.4" r="1.1"/><path d="m3 11.5 3.2-3 2.3 2.2 2.5-2.7 2 2"/>'),
    zoomIn: S('<circle cx="7" cy="7" r="4.5"/><path d="m13.5 13.5-3.2-3.2M7 5.2v3.6M5.2 7h3.6"/>'),
    zoomOut: S('<circle cx="7" cy="7" r="4.5"/><path d="m13.5 13.5-3.2-3.2M5.2 7h3.6"/>'),
    fit: S('<path d="M2.5 6V3.5a1 1 0 0 1 1-1H6M10 2.5h2.5a1 1 0 0 1 1 1V6M13.5 10v2.5a1 1 0 0 1-1 1H10M6 13.5H3.5a1 1 0 0 1-1-1V10"/>'),
    sun: S('<circle cx="8" cy="8" r="3.2"/><path d="M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M12.6 3.4l-1.1 1.1M4.5 11.5l-1.1 1.1"/>'),
    moon: S('<path d="M13.5 9.5A5.5 5.5 0 0 1 6.5 2.5a5.5 5.5 0 1 0 7 7z"/>'),
    pin: S('<path d="M6.2 2h3.6M8 2v2.6M5 4.6h6l1.2 4.6H3.8zM8 9.2v4.3"/>'),
    settings: S('<circle cx="8" cy="8" r="2.2"/><path d="M8 1.6v1.4M8 13v1.4M1.6 8h1.4M13 8h1.4M3.7 3.7l1 1M11.3 11.3l1 1M12.3 3.7l-1 1M4.7 11.3l-1 1"/>'),
    note: S('<path d="M3.5 2.5h7.5L13.5 5.5V13.5H3.5z"/><path d="M11 2.5V5.5h2.5M5.5 8h5M5.5 10.5h3.5"/>'),
    bell: S('<path d="M8 2.5a3.2 3.2 0 0 1 3.2 3.2v2.1l1.3 2.2H3.5L4.8 7.8V5.7A3.2 3.2 0 0 1 8 2.5z"/><path d="M6.5 13a1.5 1.5 0 0 0 3 0"/>'),
    search: S('<circle cx="7" cy="7" r="4.5"/><path d="m13.5 13.5-3.2-3.2"/>'),
    alignJustify: S('<path d="M2 3.5h12M2 7.5h12M2 11.5h12M2 14.5h12"/>'),
    subscript: S('<path d="m2.5 4 4 6M6.5 4l-4 6"/><path d="M10 11.5h3.5L10 14.5h3.5"/>'),
    superscript: S('<path d="m2.5 6 4 6M6.5 6l-4 6"/><path d="M10 2.5h3.5L10 5.5h3.5"/>'),
    highlight: S('<path d="m9.5 2.5 4 4-7.5 7.5H2v-4L9.5 2.5zM8 4l4 4M2 14.5h12"/>'),
    lineSpacing: S('<path d="M2 3h12M2 8h12M2 13h12M6 5.5 4.5 3.5 3 5.5M3 10.5l1.5 2 1.5-2"/>'),
    caseChange: S('<path d="M2 12.5 5 3.5l3 9M3.2 9.5h3.6M10 7.5a2 2 0 1 1 4 0v5m0-2h-4"/>'),
    pageBreak: S('<path d="M2 6.5h3.5M10.5 6.5H14M2 2.5h12a1 1 0 0 1 1 1v1M2 13.5h12a1 1 0 0 0 1-1v-1"/><path d="M8 4.5v4M6 6.5l2 2 2-2"/>'),
    symbol: S('<circle cx="8" cy="8" r="5.5"/><path d="M8 4.5v7M5.5 6.5h5"/>'),
    callout: S('<rect x="2" y="3" width="12" height="10" rx="2"/><path d="M5 6.5h6M5 9.5h4"/>'),
    date: S('<rect x="2.5" y="3.5" width="11" height="10" rx="1.5"/><path d="M2.5 7h11M5.5 2v3M10.5 2v3"/>'),
    indentInc: S('<path d="M2 3.5h12M6.5 7.5h7.5M6.5 11.5h7.5M2 3.5h12M2 6.5l2.5 2-2.5 2"/>'),
    indentDec: S('<path d="M2 3.5h12M6.5 7.5h7.5M6.5 11.5h7.5M4.5 6.5 2 8.5l2.5 2"/>'),
    columns: S('<rect x="2" y="2.5" width="5" height="11" rx="1"/><rect x="9" y="2.5" width="5" height="11" rx="1"/>'),
    margins: S('<rect x="2" y="2" width="12" height="12" rx="1.5"/><path d="M5 5h6v6H5z" stroke-dasharray="1.5 1.5"/>'),
    orientation: S('<rect x="4.5" y="2" width="7" height="12" rx="1"/><path d="M12.5 7.5l2 2-2 2"/>'),
    pageSize: S('<path d="M3.5 2h6L13 5.5V14H3.5z"/><path d="M9.5 2v4H13"/>'),
    outline: S('<path d="M2.5 4h2M6.5 4h7M2.5 8h2M6.5 8h7M2.5 12h2M6.5 12h7"/>'),
    stats: S('<path d="M3 13V8.5M7 13V4.5M11 13V6.5M14 13.5H2"/>'),
    focus: S('<path d="M2 5.5V2.5h3M14 5.5V2.5h-3M2 10.5v3h3M14 10.5v3h-3"/>'),
    spellcheck: S('<path d="m2.5 11.5 3-7 3 7M3.7 9.5h3.6M10.5 10l1.5 1.5 2.5-3"/>'),
    shading: S('<path d="m11 2.5-7 7 3 3 7-7-3-3zM2 14.5h12"/>'),
    borderAll: S('<rect x="2.5" y="2.5" width="11" height="11" rx="1"/><path d="M2.5 8h11M8 2.5v11"/>'),
    borderOuter: S('<rect x="2.5" y="2.5" width="11" height="11" rx="1"/>'),
    borderNone: S('<rect x="2.5" y="2.5" width="11" height="11" rx="1" stroke-dasharray="2 2"/>'),
    valignTop: S('<path d="M2 3h12M5 6.5h6M5 9.5h6"/>'),
    valignMiddle: S('<path d="M2 8h12M5 4.5h6M5 11.5h6"/>'),
    valignBottom: S('<path d="M2 13h12M5 6.5h6M5 9.5h6"/>'),
    replace: S('<path d="M3 7V4a1 1 0 0 1 1-1h7M9 1.5l2.5 2L9 5.5M13 9v3a1 1 0 0 1-1 1H5M7 14.5l-2.5-2L7 10.5"/>'),
    headerFooter: S('<rect x="2.5" y="2.5" width="11" height="11" rx="1"/><path d="M2.5 5.5h11M2.5 10.5h11" stroke-dasharray="1.5 1.5"/>'),
    fx: S('<path d="M3 13V8.5a2 2 0 0 1 2-2h1M2 8.5h4M9.5 7.5l4 6M13.5 7.5l-4 6"/>'),
    autosum: S('<path d="M13 3.5H3.5l4.5 4.5-4.5 4.5H13"/>'),
    chartCol: S('<rect x="2" y="7.5" width="3" height="6.5" rx="0.5"/><rect x="6.5" y="4.5" width="3" height="9.5" rx="0.5"/><rect x="11" y="2.5" width="3" height="11.5" rx="0.5"/>'),
    chartBar: S('<rect x="2" y="2" width="6.5" height="3" rx="0.5"/><rect x="2" y="6.5" width="11.5" height="3" rx="0.5"/><rect x="2" y="11" width="8.5" height="3" rx="0.5"/>'),
    chartLine: S('<path d="M2 12.5 6 7l3.5 3 4.5-6.5M2 13.5h12"/><circle cx="6" cy="7" r="1"/><circle cx="9.5" cy="10" r="1"/><circle cx="14" cy="3.5" r="1"/>'),
    chartPie: S('<path d="M8 2.5a5.5 5.5 0 0 0-5.5 5.5A5.5 5.5 0 0 0 8 13.5a5.5 5.5 0 0 0 5.5-5.5H8z"/><path d="M9.5 2.6A5.5 5.5 0 0 1 13.4 6.5H9.5z"/>'),
    filter: S('<polygon points="2.5 3 13.5 3 9 8.5 9 13.5 7 12 7 8.5 2.5 3"/>'),
    sortAZ: S('<path d="M3 13V3.5M1.5 5.5l1.5-2 1.5 2M6.5 4h3.5l-3.5 4.5h3.5M7 10h3M10 10v3.5"/>'),
    sortZA: S('<path d="M3 3.5V13M1.5 11l1.5 2 1.5-2M6.5 4h3.5l-3.5 4.5h3.5M7 10h3M10 10v3.5"/>'),
    freeze: S('<rect x="2.5" y="2.5" width="11" height="11" rx="1.5"/><path d="M2.5 6.5h11M6.5 2.5v11" stroke-dasharray="1.5 1.5"/>'),
    merge: S('<rect x="2.5" y="4.5" width="11" height="7" rx="1"/><path d="M5.5 8h5M7 6.5l-1.5 1.5 1.5 1.5M9 6.5l1.5 1.5-1.5 1.5"/>'),
    wrap: S('<path d="M3 4.5h10M3 8.5h6.5a2 2 0 0 1 0 4H7.5M9 11l-1.5 1.5L9 14"/>'),
    currency: S('<path d="M8 2v12M10.5 4.5H6.8a1.8 1.8 0 0 0 0 3.6h2.4a1.8 1.8 0 0 1 0 3.6H5.5"/>'),
    percent: S('<path d="M12.5 3.5 3.5 12.5"/><circle cx="5" cy="5" r="1.5"/><circle cx="11" cy="11" r="1.5"/>'),
    comma: S('<path d="M8 8a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zm-.2 1.5c.8 0 1.2.6 1 1.4l-.8 2.1H6.5l.8-2c.1-.4-.2-.7-.5-.7z"/>'),
    decimalInc: S('<path d="M3 11h2M3 13.5h.5M7 7.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm5 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM2 4.5l-1 1M1 4.5h3"/>'),
    decimalDec: S('<path d="M3 11h2M3 13.5h.5M7 7.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm5 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM2 5.5l1-1M1 4.5h3"/>'),
    printLayout: S('<path d="M3.5 2h6L13 5.5V14H3.5z"/><path d="M5.5 8h5.5M5.5 10.5h5.5"/>'),
    readView: S('<path d="M2 8s2.5-4 6-4 6 4 6 4-2.5 4-6 4-6-4-6-4z"/><circle cx="8" cy="8" r="1.8"/>')
  };

  /* ---------------- state ---------------- */
  const MAX_TABS = 8;
  let tabSeq = 0;
  const state = {
    view: 'home',
    doc: null,        // alias of the active tab
    editor: null,
    dirty: false,
    theme: 'light',
    tabs: [],         // { id, doc, dirty, editor, pane, toolbar, host, statusLeft, statusRight }
    activeTabId: null
  };

  const $ = (id) => document.getElementById(id);
  const els = {
    home: $('view-landing'), editorView: $('view-editor'),
    host: null, toolbar: null,
    chip: $('doc-chip'), docName: $('doc-name'), docDirty: $('doc-dirty'),
    docBadge: $('doc-badge'), docKindDot: $('doc-kind-dot'),
    btnHome: $('btn-home'),
    statusLeft: null, statusRight: null,
    tabBar: $('tab-bar'), tabPanes: $('tab-panes'),
    recentsList: $('recents-grid'), sideEmpty: $('side-empty'),
    btnClearRecents: $('btn-clear-recents'),
    homeTiles: $('home-tiles'), homeTilesEmpty: $('home-tiles-empty'),
    btnClearHomeRecents: $('btn-clear-home-recents'), btnHomeOpen: $('btn-home-open'),
    btnSidebarSettings: $('btn-sidebar-settings'),
    shell: $('shell'), sidebar: $('sidebar'), hotzone: $('side-hotzone'),
    pinBtn: $('btn-pin-sidebar'), menubar: $('menubar'),
    modalBackdrop: $('modal-backdrop'), modal: document.querySelector('.modal'),
    modalTitle: $('modal-title'), modalBody: $('modal-body'), modalActions: $('modal-actions'),
    toastWrap: $('toast-wrap'),
    btnAccount: $('btn-account'), accountAvatar: $('account-avatar'), accountMenu: $('account-menu')
  };

  const KIND_LABEL = { md: 'Markdown', doc: 'Word document', sheet: 'Spreadsheet', pdf: 'PDF' };
  const KIND_BADGE = { md: 'MD', doc: 'DOCX', sheet: 'XLSX', pdf: 'PDF' };

  /* ---------------- toast & modal ---------------- */
  function toast(msg, kind) {
    const t = document.createElement('div');
    t.className = 'toast' + (kind === 'error' ? ' error' : '');
    t.textContent = msg;
    els.toastWrap.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity 0.25s'; }, 2600);
    setTimeout(() => t.remove(), 2900);
  }

  let modalResolve = null;
  function openModal(title, bodyEl, actions, opts) {
    els.modal.classList.toggle('wide', !!(opts && opts.wide));
    els.modalTitle.textContent = title;
    els.modalBody.innerHTML = '';
    els.modalBody.appendChild(bodyEl);
    els.modalActions.innerHTML = '';
    actions.forEach(({ label, primary, value }) => {
      const b = document.createElement('button');
      b.className = 'btn ' + (primary ? 'primary' : 'ghost');
      b.textContent = label;
      b.addEventListener('click', () => closeModal(typeof value === 'function' ? value() : value));
      els.modalActions.appendChild(b);
    });
    els.modalBackdrop.classList.remove('hidden');
    return new Promise((resolve) => { modalResolve = resolve; });
  }
  function closeModal(result) {
    els.modalBackdrop.classList.add('hidden');
    if (modalResolve) { modalResolve(result); modalResolve = null; }
  }
  els.modalBackdrop.addEventListener('mousedown', (e) => {
    if (e.target === els.modalBackdrop) closeModal(null);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !els.modalBackdrop.classList.contains('hidden')) {
      e.preventDefault();
      closeModal(null);
    }
  }, true);

  function inputModal(title, placeholder, initial) {
    const input = document.createElement('input');
    input.placeholder = placeholder || '';
    input.value = initial || '';
    const p = openModal(title, input, [
      { label: 'Cancel', value: null },
      { label: 'OK', primary: true, value: () => input.value }
    ]);
    setTimeout(() => { input.focus(); input.select(); }, 40);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') closeModal(input.value);
      if (e.key === 'Escape') closeModal(null);
    });
    return p;
  }
  function confirmModal(title, message) {
    const div = document.createElement('div');
    div.textContent = message;
    return openModal(title, div, [
      { label: 'Cancel', value: false },
      { label: 'Delete', primary: true, value: true }
    ]);
  }

  /* ---------------- theme ---------------- */
  function applyTheme(theme, persist) {
    const def = window.MargoThemes.get(theme) || window.MargoThemes.get('light');
    state.theme = def.id;
    document.documentElement.dataset.theme = def.id;
    document.documentElement.dataset.scheme = def.scheme;
    if (persist) window.margo.theme.set(def.id);
  }

  /* ---------------- header / title ---------------- */
  function refreshHeader() {
    const inEditor = state.view === 'editor';
    els.chip.classList.toggle('hidden', state.tabs.length > 0 || !inEditor);
    if (inEditor && state.doc) {
      els.docName.textContent = state.doc.name || 'Untitled';
      els.docBadge.textContent = state.doc.path
        ? state.doc.path.split('.').pop().toUpperCase()
        : KIND_BADGE[state.doc.kind];
      els.docKindDot.dataset.kind = state.doc.kind;
      els.docDirty.classList.toggle('hidden', !state.dirty);
      window.margo.setTitle(`${state.doc.name || 'Untitled'}${state.dirty ? ' •' : ''} — Margo`);
    } else {
      window.margo.setTitle('Margo');
    }
    markActiveRecent();
  }
  function newDraftId() {
    try { return crypto.randomUUID(); } catch {}
    return 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }
  function markDirty() {
    const t = findTab(state.activeTabId);
    if (t && !t.draftId) t.draftId = newDraftId();
    if (!state.dirty) {
      state.dirty = true;
      if (t) t.dirty = true;
      refreshHeader();
      paintTabs();
    }
    if (t) scheduleDraft(t);
  }
  function setStatus(left, kind) {
    const t = findTab(state.activeTabId);
    if (!t || !t.status) return;
    t.status.setLeft(left || '');
    if (kind !== undefined) t.status.setKind(kind || '');
  }

  function createStatusChrome() {
    let zoomMin = 0.5;
    let zoomMax = 2;
    let zoomVal = 1;
    let syncing = false;
    let zoomHandler = null;
    let viewHandler = null;
    const viewBtns = new Map();
    let presetPop = null;

    const statusLeft = document.createElement('span');
    statusLeft.className = 'status-left';

    const statusRight = document.createElement('div');
    statusRight.className = 'status-right';

    const kindEl = document.createElement('span');
    kindEl.className = 'status-kind hidden';

    const viewsEl = document.createElement('div');
    viewsEl.className = 'status-views hidden';

    const zoomEl = document.createElement('div');
    zoomEl.className = 'status-zoom hidden';

    const zoomOutBtn = document.createElement('button');
    zoomOutBtn.type = 'button';
    zoomOutBtn.className = 'status-zoom-btn';
    zoomOutBtn.title = 'Zoom out';
    zoomOutBtn.innerHTML = window.MargoIcons.zoomOut;

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.className = 'status-zoom-slider';
    slider.min = '0';
    slider.max = '100';
    slider.step = '1';
    slider.value = '50';
    slider.setAttribute('aria-label', 'Zoom');

    const zoomInBtn = document.createElement('button');
    zoomInBtn.type = 'button';
    zoomInBtn.className = 'status-zoom-btn';
    zoomInBtn.title = 'Zoom in';
    zoomInBtn.innerHTML = window.MargoIcons.zoomIn;

    const pctBtn = document.createElement('button');
    pctBtn.type = 'button';
    pctBtn.className = 'status-zoom-pct';
    pctBtn.textContent = '100%';
    pctBtn.title = 'Zoom level';

    zoomEl.appendChild(zoomOutBtn);
    zoomEl.appendChild(slider);
    zoomEl.appendChild(zoomInBtn);
    zoomEl.appendChild(pctBtn);

    statusRight.appendChild(kindEl);
    statusRight.appendChild(viewsEl);
    statusRight.appendChild(zoomEl);

    function zoomToSlider(z) {
      const span = zoomMax - zoomMin;
      if (span <= 0) return 50;
      return Math.round(((z - zoomMin) / span) * 100);
    }
    function sliderToZoom(v) {
      const span = zoomMax - zoomMin;
      return +(zoomMin + (Number(v) / 100) * span).toFixed(4);
    }
    function closePresetPop() {
      if (presetPop) {
        presetPop.remove();
        presetPop = null;
      }
    }
    function emitZoom(z) {
      if (syncing || !zoomHandler) return;
      zoomHandler(z);
    }
    function paintZoom() {
      syncing = true;
      slider.value = String(zoomToSlider(zoomVal));
      pctBtn.textContent = Math.round(zoomVal * 100) + '%';
      syncing = false;
    }

    slider.addEventListener('input', () => {
      if (syncing) return;
      zoomVal = sliderToZoom(slider.value);
      pctBtn.textContent = Math.round(zoomVal * 100) + '%';
      emitZoom(zoomVal);
    });
    zoomOutBtn.addEventListener('click', () => {
      zoomVal = Math.max(zoomMin, +(zoomVal - 0.1).toFixed(4));
      paintZoom();
      emitZoom(zoomVal);
    });
    zoomInBtn.addEventListener('click', () => {
      zoomVal = Math.min(zoomMax, +(zoomVal + 0.1).toFixed(4));
      paintZoom();
      emitZoom(zoomVal);
    });
    pctBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      closePresetPop();
      const pop = document.createElement('div');
      pop.className = 'status-zoom-presets';
      [50, 75, 100, 125, 150, 200].forEach((pct) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = pct + '%';
        b.addEventListener('click', () => {
          zoomVal = Math.min(zoomMax, Math.max(zoomMin, pct / 100));
          paintZoom();
          closePresetPop();
          emitZoom(zoomVal);
        });
        pop.appendChild(b);
      });
      const rect = pctBtn.getBoundingClientRect();
      pop.style.position = 'fixed';
      pop.style.right = Math.max(8, window.innerWidth - rect.right) + 'px';
      pop.style.bottom = Math.max(8, window.innerHeight - rect.top + 4) + 'px';
      document.body.appendChild(pop);
      presetPop = pop;
      const onDoc = (ev) => {
        if (pop.contains(ev.target) || ev.target === pctBtn) return;
        closePresetPop();
        document.removeEventListener('mousedown', onDoc, true);
      };
      setTimeout(() => document.addEventListener('mousedown', onDoc, true), 0);
    });

    const api = {
      setLeft(text) { statusLeft.textContent = text || ''; },
      setKind(label) {
        kindEl.textContent = label || '';
        kindEl.classList.toggle('hidden', !label);
      },
      setViewModes(modes) {
        viewsEl.innerHTML = '';
        viewBtns.clear();
        if (!modes || !modes.length) {
          viewsEl.classList.add('hidden');
          return;
        }
        modes.forEach((m) => {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'status-view-btn';
          b.title = m.title || m.id;
          b.dataset.view = m.id;
          if (m.html) b.innerHTML = m.html;
          else b.textContent = m.label || m.id;
          b.addEventListener('click', () => {
            if (viewHandler) viewHandler(m.id);
          });
          viewsEl.appendChild(b);
          viewBtns.set(m.id, b);
        });
        viewsEl.classList.remove('hidden');
      },
      setViewActive(id) {
        viewBtns.forEach((b, vid) => b.classList.toggle('active', vid === id));
      },
      onView(fn) { viewHandler = fn; },
      setZoom(z, min, max) {
        if (min != null) zoomMin = min;
        if (max != null) zoomMax = max;
        zoomVal = Math.min(zoomMax, Math.max(zoomMin, z));
        paintZoom();
      },
      getZoom() { return zoomVal; },
      onZoom(fn) { zoomHandler = fn; },
      showZoom(show) { zoomEl.classList.toggle('hidden', !show); },
      destroy() { closePresetPop(); }
    };

    return { statusLeft, statusRight, api };
  }

  /* ---------------- crash recovery drafts ---------------- */
  const DRAFT_WAIT = 1500;
  const draftTimers = new Map();

  function cancelDraftTimer(tab) {
    if (!tab) return;
    const timer = draftTimers.get(tab.id);
    if (timer) {
      clearTimeout(timer);
      draftTimers.delete(tab.id);
    }
  }
  function scheduleDraft(tab) {
    if (!tab || !tab.draftId) return;
    cancelDraftTimer(tab);
    const timer = setTimeout(() => {
      draftTimers.delete(tab.id);
      flushDraft(tab);
    }, DRAFT_WAIT);
    draftTimers.set(tab.id, timer);
  }
  async function snapshotForDraft(editor) {
    if (!editor) return null;
    if (typeof editor.getDraft === 'function') return await Promise.resolve(editor.getDraft());
    if (typeof editor.getData === 'function') return await Promise.resolve(editor.getData());
    return null;
  }
  async function flushDraft(tab) {
    if (!tab || !tab.dirty || !tab.editor || !tab.draftId || !tab.doc) return;
    try {
      const data = await snapshotForDraft(tab.editor);
      if (!data || typeof data !== 'object') return;
      await window.margo.drafts.put({
        id: tab.draftId,
        kind: tab.doc.kind,
        name: tab.doc.name || 'Untitled',
        path: tab.doc.path || null,
        updatedAt: Date.now(),
        data
      });
    } catch {}
  }
  async function flushAllDrafts() {
    const pending = [];
    for (const t of state.tabs) {
      cancelDraftTimer(t);
      if (t.dirty) pending.push(flushDraft(t));
    }
    await Promise.all(pending);
  }
  async function clearDraft(tab) {
    cancelDraftTimer(tab);
    const id = tab && tab.draftId;
    if (tab) tab.draftId = null;
    if (id) {
      try { await window.margo.drafts.remove(id); } catch {}
    }
  }
  function docFromDraft(draft) {
    const data = draft.data || {};
    const name = draft.name || 'Untitled';
    const p = draft.path || null;
    if (draft.kind === 'md') return { kind: 'md', name, path: p, markdown: data.markdown || '' };
    if (draft.kind === 'doc') {
      return { kind: 'doc', name, path: p, html: data.html || '<p></p>', notes: data.notes || [], layout: data.layout };
    }
    if (draft.kind === 'sheet') {
      return {
        kind: 'sheet', name, path: p,
        sheets: data.sheets && data.sheets.length ? data.sheets : [{ name: 'Sheet1', rows: [] }],
        active: data.active || 0
      };
    }
    if (draft.kind === 'pdf') {
      return { kind: 'pdf', name, path: p, placements: data.placements || [], base64: data.base64 || null };
    }
    return null;
  }
  async function restoreDrafts(list) {
    const drafts = list || await window.margo.drafts.list();
    let restored = 0;
    for (const draft of drafts) {
      if (state.tabs.length >= MAX_TABS) break;
      if (draft.kind === 'pdf' && !draft.path && !(draft.data && draft.data.base64)) {
        toast(`Could not restore ${draft.name || 'PDF'} — the original file is missing.`, 'error');
        try { await window.margo.drafts.remove(draft.id); } catch {}
        continue;
      }
      const doc = docFromDraft(draft);
      if (!doc) continue;
      const before = state.tabs.length;
      try {
        await openInTab(doc, { draftId: draft.id, dirty: true });
        if (state.tabs.length > before) restored += 1;
      } catch {
        toast(`Could not restore ${draft.name || 'Untitled'}`, 'error');
        try { await window.margo.drafts.remove(draft.id); } catch {}
      }
    }
    return restored > 0;
  }
  async function offerRecovery() {
    if (window.margo.isSmoke && window.margo.isSmoke()) return false;
    const drafts = await window.margo.drafts.list();
    if (!drafts.length) return false;
    const body = document.createElement('div');
    const lead = document.createElement('div');
    lead.className = 'modal-lead';
    lead.textContent = 'Margo didn’t close cleanly. These documents still have unsaved changes:';
    body.appendChild(lead);
    const list = document.createElement('div');
    list.className = 'modal-detail recover-list';
    drafts.forEach((d) => {
      const row = document.createElement('div');
      row.textContent = d.name || 'Untitled';
      list.appendChild(row);
    });
    body.appendChild(list);
    const choice = await openModal('Restore unsaved work?', body, [
      { label: 'Discard', value: 'discard' },
      { label: 'Restore', primary: true, value: 'restore' }
    ]);
    if (choice === 'restore') return restoreDrafts(drafts);
    if (choice === 'discard') {
      try { await window.margo.drafts.clear(); } catch {}
    }
    return false;
  }

  /* ---------------- tabs ---------------- */
  function findTab(id) {
    return state.tabs.find((t) => t.id === id) || null;
  }
  function pathKey(p) {
    return p ? String(p).toLowerCase() : null;
  }
  function findTabByPath(p) {
    const key = pathKey(p);
    if (!key) return null;
    return state.tabs.find((t) => t.doc && pathKey(t.doc.path) === key) || null;
  }
  function syncActiveTab() {
    const t = findTab(state.activeTabId);
    if (!t) return;
    t.doc = state.doc;
    t.editor = state.editor;
    t.dirty = state.dirty;
  }
  function applyTabAliases(t) {
    state.activeTabId = t.id;
    state.doc = t.doc;
    state.editor = t.editor;
    state.dirty = t.dirty;
    els.host = t.host;
    els.toolbar = t.toolbar;
    els.statusLeft = t.statusLeft;
    els.statusRight = t.statusRight;
  }
  function clearAliases() {
    state.doc = null;
    state.editor = null;
    state.dirty = false;
    state.activeTabId = null;
    els.host = null;
    els.toolbar = null;
    els.statusLeft = null;
    els.statusRight = null;
  }
  function createPane(tabId) {
    const pane = document.createElement('div');
    pane.className = 'tab-pane';
    pane.dataset.tabId = String(tabId);
    pane.hidden = true;

    const toolbar = document.createElement('div');
    toolbar.className = 'toolbar';

    const host = document.createElement('div');
    host.className = 'editor-host';

    const statusbar = document.createElement('div');
    statusbar.className = 'statusbar';
    const chrome = createStatusChrome();
    statusbar.appendChild(chrome.statusLeft);
    statusbar.appendChild(chrome.statusRight);

    pane.appendChild(toolbar);
    pane.appendChild(host);
    pane.appendChild(statusbar);
    els.tabPanes.appendChild(pane);
    return { pane, toolbar, host, statusLeft: chrome.statusLeft, statusRight: chrome.statusRight, status: chrome.api };
  }
  function paintTabs() {
    const bar = els.tabBar;
    bar.innerHTML = '';
    if (!state.tabs.length) {
      bar.classList.add('hidden');
      return;
    }
    bar.classList.remove('hidden');
    state.tabs.forEach((t) => {
      const el = document.createElement('div');
      el.className = 'tab' + (t.id === state.activeTabId && state.view === 'editor' ? ' active' : '');
      el.dataset.tabId = String(t.id);
      el.setAttribute('role', 'tab');
      el.title = (t.doc && t.doc.name) || 'Untitled';

      const dot = document.createElement('span');
      dot.className = 'doc-kind-dot';
      if (t.doc) dot.dataset.kind = t.doc.kind;

      const name = document.createElement('span');
      name.className = 'tab-name';
      name.textContent = (t.doc && t.doc.name) || 'Untitled';

      const dirty = document.createElement('span');
      dirty.className = 'doc-dirty' + (t.dirty ? '' : ' hidden');
      dirty.title = 'Unsaved changes';

      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'tab-close';
      close.innerHTML = window.MargoIcons.close;
      close.title = 'Close';
      close.addEventListener('click', (e) => {
        e.stopPropagation();
        closeTab(t.id);
      });

      el.appendChild(dot);
      el.appendChild(name);
      el.appendChild(dirty);
      el.appendChild(close);
      el.addEventListener('click', () => activateTab(t.id));
      el.addEventListener('auxclick', (e) => {
        if (e.button === 1) {
          e.preventDefault();
          closeTab(t.id);
        }
      });
      el.addEventListener('mousedown', (e) => {
        if (e.button === 1) e.preventDefault();
      });
      bar.appendChild(el);
    });
  }
  async function activateTab(id) {
    const t = findTab(id);
    if (!t) return;
    if (state.activeTabId === id && state.view === 'editor') return;
    if (state.activeTabId && state.activeTabId !== id) syncActiveTab();
    applyTabAliases(t);
    state.view = 'editor';
    document.body.classList.remove('margo-focus-mode');
    els.home.classList.add('hidden');
    els.editorView.classList.remove('hidden');
    applyViewMode();
    state.tabs.forEach((x) => { x.pane.hidden = x.id !== t.id; });
    paintTabs();
    refreshHeader();
    if (t.editor && typeof t.editor.focus === 'function') t.editor.focus();
  }
  async function openInTab(doc, opts) {
    if (doc.path && !(opts && opts.draftId)) {
      const existing = findTabByPath(doc.path);
      if (existing) {
        await activateTab(existing.id);
        return;
      }
    }
    if (state.tabs.length >= MAX_TABS) {
      toast('Close a tab first (maximum 8).');
      return;
    }
    const id = ++tabSeq;
    const chrome = createPane(id);
    document.body.classList.remove('margo-focus-mode');
    window.scrollTo(0, 0);
    const tab = {
      id,
      doc,
      dirty: !!(opts && opts.dirty),
      draftId: (opts && opts.draftId) || null,
      editor: null,
      pane: chrome.pane,
      toolbar: chrome.toolbar,
      host: chrome.host,
      statusLeft: chrome.statusLeft,
      statusRight: chrome.statusRight,
      status: chrome.status
    };
    state.tabs.push(tab);
    await activateTab(id);
    const ctx = { markDirty, setStatus, status: tab.status, toolbar: tab.toolbar, inputModal, confirmModal, openModal, toast };
    const factory = window.MargoEditors[doc.kind];
    if (!factory) {
      state.tabs = state.tabs.filter((x) => x.id !== id);
      try { tab.pane.remove(); } catch {}
      if (state.activeTabId === id) clearAliases();
      throw new Error('Unknown document type');
    }
    const editor = factory(ctx);
    tab.editor = editor;
    state.editor = editor;
    try {
      await Promise.resolve(editor.mount(tab.host, doc));
    } catch (err) {
      state.tabs = state.tabs.filter((x) => x.id !== id);
      try { tab.pane.remove(); } catch {}
      if (state.activeTabId === id) clearAliases();
      throw err;
    }
    if (tab.dirty) {
      state.dirty = true;
      if (!tab.draftId) tab.draftId = newDraftId();
    }
    refreshHeader();
    paintTabs();
    scheduleThumb();
  }
  const mountDoc = (doc) => openInTab(doc);
  async function closeTab(id) {
    const t = findTab(id);
    if (!t) return;
    if (t.dirty) {
      await activateTab(t.id);
      if (!(await resolveDirty())) return;
      t.dirty = state.dirty;
    }
    await clearDraft(t);
    const idx = state.tabs.findIndex((x) => x.id === id);
    const wasActive = state.activeTabId === id;
    if (t.editor && typeof t.editor.destroy === 'function') {
      try { t.editor.destroy(); } catch {}
    }
    if (t.status && typeof t.status.destroy === 'function') {
      try { t.status.destroy(); } catch {}
    }
    t.pane.remove();
    state.tabs.splice(idx, 1);
    if (wasActive) clearAliases();
    if (!state.tabs.length) {
      showLanding();
      return;
    }
    if (wasActive) {
      const neighbor = state.tabs[Math.max(0, idx - 1)];
      await activateTab(neighbor.id);
    } else {
      paintTabs();
      refreshHeader();
    }
  }
  function closeActiveTab() {
    if (state.view === 'editor' && state.activeTabId) return closeTab(state.activeTabId);
  }
  function cycleTabs(dir) {
    if (!state.tabs.length) return;
    const i = state.tabs.findIndex((t) => t.id === state.activeTabId);
    const start = i < 0 ? 0 : i;
    const next = (start + dir + state.tabs.length) % state.tabs.length;
    activateTab(state.tabs[next].id);
  }
  function resetSession() {
    for (const t of [...state.tabs]) {
      cancelDraftTimer(t);
      if (t.editor && typeof t.editor.destroy === 'function') {
        try { t.editor.destroy(); } catch {}
      }
      if (t.status && typeof t.status.destroy === 'function') {
        try { t.status.destroy(); } catch {}
      }
      t.pane.remove();
    }
    state.tabs = [];
    clearAliases();
    document.body.classList.remove('margo-focus-mode');
    state.view = 'home';
    els.editorView.classList.add('hidden');
    els.home.classList.remove('hidden');
    applyViewMode();
    paintTabs();
    refreshHeader();
    loadRecents();
  }

  function applyViewMode() {
    const onHome = state.view === 'home';
    els.shell.classList.toggle('view-home', onHome);
    if (onHome) closeSidebar(true);
  }

  /* ---------------- views ---------------- */
  function showLanding() {
    if (state.activeTabId) syncActiveTab();
    document.body.classList.remove('margo-focus-mode');
    state.view = 'home';
    clearAliases();
    els.editorView.classList.add('hidden');
    els.home.classList.remove('hidden');
    applyViewMode();
    paintTabs();
    refreshHeader();
    loadRecents();
  }

  async function newDoc(kind) {
    if (kind === 'pdf') {
      try {
        const bytes = await window.MargoEditors.blankPdfBytes();
        return openInTab({ kind: 'pdf', name: 'Untitled.pdf', path: null, bytes, placements: [] });
      } catch (err) {
        toast((err && err.message) || 'Could not create PDF', 'error');
        return;
      }
    }
    const templates = {
      md: { kind: 'md', name: 'Untitled.md', path: null, markdown: '' },
      doc: { kind: 'doc', name: 'Untitled.docx', path: null, html: '<p></p>', notes: [] },
      sheet: { kind: 'sheet', name: 'Untitled.xlsx', path: null, sheets: [{ name: 'Sheet1', rows: [] }], active: 0 }
    };
    return openInTab(templates[kind]);
  }

  /* ---------------- thumbnails ---------------- */
  let thumbTimer = null;
  async function refreshLibraryThumb(data) {
    if (!state.doc?.path || state.doc.kind === 'md') return;
    try {
      const url = await window.MargoThumbs.generate(state.doc, data);
      if (url) loadRecents();
    } catch {}
  }
  function scheduleThumb() {
    clearTimeout(thumbTimer);
    if (!state.doc || !state.doc.path || state.doc.kind === 'md') return;
    thumbTimer = setTimeout(async () => {
      try {
        const data = state.editor && state.editor.kind !== 'pdf'
          ? await Promise.resolve(state.editor.getData())
          : null;
        await refreshLibraryThumb(data);
      } catch {}
    }, 350);
  }

  /* ---------------- open / save ---------------- */
  async function openFromPath(p) {
    const existing = findTabByPath(p);
    if (existing) {
      await activateTab(existing.id);
      closeSidebar(true);
      return;
    }
    const res = await window.margo.openPath(p);
    if (!res.ok) {
      toast(res.error || 'Could not open file', 'error');
      window.margo.recents.remove(p);
      loadRecents();
      return;
    }
    await openInTab(res.doc);
    closeSidebar(true);
  }

  async function newDocGuarded(kind) {
    await newDoc(kind);
    closeSidebar(true);
  }

  /* ---------------- export as PDF ---------------- */
  async function exportPdf(explicitPath) {
    if (!state.doc || !state.editor) return false;
    if (state.doc.kind === 'pdf') { toast('This is already a PDF — use Save As'); return false; }
    const data = await Promise.resolve(state.editor.getData());
    const res = await window.margo.exportPdf({
      kind: state.doc.kind,
      data,
      suggestedName: state.doc.name,
      currentPath: state.doc.path,
      path: explicitPath || undefined
    });
    if (res.canceled) return false;
    if (!res.ok) { toast(res.error || 'Export failed', 'error'); return false; }
    toast(`Exported to ${res.path.split(/[\\/]/).pop()}`);
    loadRecents();
    return true;
  }

  async function printDoc() {
    if (!state.doc || !state.editor) return false;
    const data = await Promise.resolve(state.editor.getData());
    const res = await window.margo.print({
      kind: state.doc.kind,
      data,
      suggestedName: state.doc.name,
      path: state.doc.path || undefined
    });
    if (res.canceled || res.skipped) return false;
    if (!res.ok) { toast(res.error || 'Print failed', 'error'); return false; }
    return true;
  }

  /* ---------------- edit-menu command routing ---------------- */
  async function editCommand(name) {
    const ed = state.editor;
    if (!ed) return;
    const custom = ed.commands && ed.commands[name];
    if (name === 'paste') {
      let text = '';
      try { text = await navigator.clipboard.readText(); } catch {}
      if (custom) return custom(text);
      ed.focus();
      if (text) document.execCommand('insertText', false, text);
      return;
    }
    if (custom) return custom();
    ed.focus();
    document.execCommand(name);
  }

  async function pickAndOpen() {
    const res = await window.margo.pickOpen();
    if (!res.canceled && res.path) await openFromPath(res.path);
  }

  const sameKindExt = (kind, ext) => {
    ext = ext.toLowerCase();
    if (kind === 'md') return ['md', 'markdown', 'txt'].includes(ext);
    if (kind === 'doc') return ext === 'docx';
    if (kind === 'pdf') return ext === 'pdf';
    return ext === 'xlsx' || ext === 'csv';
  };

  async function afterLocalSave(toPath, fileName, fromPath) {
    try {
      const drive = await window.margo.google.push({
        path: toPath,
        name: fileName,
        fromPath: fromPath || toPath
      });
      if (drive && drive.pushed) {
        toast('Saved locally and on Drive');
        return;
      }
      toast('Saved');
      if (drive && drive.ok === false) toast(drive.error || 'Could not update Drive', 'error');
    } catch {
      toast('Saved');
    }
  }

  async function saveDoc(forceDialog) {
    if (!state.doc || !state.editor) return false;
    const data = await Promise.resolve(state.editor.getData());
    const { kind, path, name } = state.doc;
    let thumbDataUrl = null;
    if (kind === 'doc' || kind === 'md') {
      try { thumbDataUrl = await window.MargoThumbs.jpegForDoc(state.doc, data); } catch {}
    }

    if (!forceDialog && path) {
      const res = await window.margo.save({ kind, path, data, thumbDataUrl });
      if (!res.ok) { toast(res.error || 'Save failed', 'error'); return false; }
      state.dirty = false;
      if (state.editor.onSaved) await Promise.resolve(state.editor.onSaved(data));
      syncActiveTab();
      await clearDraft(findTab(state.activeTabId));
      paintTabs();
      refreshHeader();
      await afterLocalSave(path, name, path);
      await refreshLibraryThumb(data);
      return true;
    }

    const res = await window.margo.saveAs({ kind, data, suggestedName: name, currentPath: path, thumbDataUrl });
    if (res.canceled) return false;
    if (!res.ok) { toast(res.error || 'Save failed', 'error'); return false; }

    const ext = res.path.split('.').pop();
    if (sameKindExt(kind, ext)) {
      const fromPath = path;
      state.doc.path = res.path;
      state.doc.name = res.path.split(/[\\/]/).pop();
      state.dirty = false;
      if (state.editor.onSaved) await Promise.resolve(state.editor.onSaved(data));
      syncActiveTab();
      await clearDraft(findTab(state.activeTabId));
      paintTabs();
      refreshHeader();
      await afterLocalSave(res.path, state.doc.name, fromPath);
      await refreshLibraryThumb(data);
    } else {
      // cross-format export: file written, but the open buffer keeps its own format
      toast(`Exported to ${res.path.split(/[\\/]/).pop()} — still editing the ${KIND_LABEL[kind].toLowerCase()}`);
      loadRecents();
    }
    if (kind === 'sheet' && ext === 'csv' && (data.sheets || []).length > 1) {
      toast('CSV contains the active sheet only');
    }
    return true;
  }

  /* returns true when it's OK to discard the current buffer */
  async function resolveDirty() {
    const name = state.doc ? state.doc.name : 'Untitled';
    const body = document.createElement('div');
    body.innerHTML =
      `<div class="modal-lead">Save changes to <strong>${escapeHtml(name)}</strong>?</div>` +
      `<div class="modal-detail">Your changes will be lost if you don’t save them.</div>`;
    const choice = await openModal('Save changes?', body, [
      { label: "Don't Save", value: 'discard' },
      { label: 'Cancel', value: 'cancel' },
      { label: 'Save', primary: true, value: 'save' }
    ]);
    if (choice === 'cancel' || choice == null) return false;
    if (choice === 'save') return await saveDoc(false);
    await clearDraft(findTab(state.activeTabId));
    return true;
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /* ---------------- sidebar recents ---------------- */
  const EXT_STYLE = {
    md: 'MD', markdown: 'MD', txt: 'TXT', docx: 'DOC', xlsx: 'XLS', csv: 'CSV', html: 'HTM', pdf: 'PDF'
  };
  const EXT_ICON = {
    md: 'md', markdown: 'md', txt: 'md',
    docx: 'doc',
    xlsx: 'sheet', csv: 'sheet',
    pdf: 'pdf'
  };
  const THUMB_EXTS = new Set(['docx', 'pdf', 'xlsx', 'csv']);
  function recentWantsContentThumb(r) {
    return THUMB_EXTS.has(r.ext);
  }
  function timeAgo(ts) {
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60) return 'just now';
    const m = Math.floor(s / 60); if (m < 60) return `${m} min ago`;
    const h = Math.floor(m / 60); if (h < 24) return `${h} hr ago`;
    const d = Math.floor(h / 24); if (d < 30) return `${d} day${d > 1 ? 's' : ''} ago`;
    return new Date(ts).toLocaleDateString();
  }
  function kindBadgeClass(ext) {
    const kind = EXT_ICON[ext];
    return kind ? `kind-${kind}` : '';
  }
  function fillRecentThumb(thumb, r) {
    if (recentWantsContentThumb(r) && r.thumb) {
      const img = document.createElement('img');
      img.src = r.thumb;
      img.alt = '';
      thumb.appendChild(img);
      return;
    }
    const kind = EXT_ICON[r.ext];
    if (kind) {
      const img = document.createElement('img');
      img.src = `../../assets/file-icons/${kind}.png`;
      img.alt = EXT_STYLE[r.ext] || '';
      thumb.classList.add('recent-thumb-type');
      thumb.appendChild(img);
      return;
    }
    const g = document.createElement('span');
    g.className = 'thumb-glyph';
    g.textContent = EXT_STYLE[r.ext] || '?';
    thumb.appendChild(g);
  }
  function attachRecentRemove(el, r) {
    const rm = document.createElement('span');
    rm.className = el.classList.contains('home-tile-cover') ? 'home-tile-remove' : 'recent-remove';
    rm.innerHTML = window.MargoIcons.close;
    rm.title = 'Remove from list';
    rm.addEventListener('click', async (e) => {
      e.stopPropagation();
      await window.margo.recents.remove(r.path);
      loadRecents();
    });
    el.appendChild(rm);
  }
  function markActiveRecent() {
    const current = state.doc && state.doc.path ? state.doc.path.toLowerCase() : null;
    document.querySelectorAll('.recent-card, .home-tile').forEach((c) => {
      c.classList.toggle('active', !!current && c.dataset.path === current);
    });
  }
  let lastRecents = [];
  function renderSidebarRecents(list) {
    els.btnClearRecents.classList.toggle('hidden', !list.length);
    els.recentsList.innerHTML = '';
    if (!list.length) {
      const d = document.createElement('div');
      d.className = 'side-empty';
      d.textContent = 'Files you open or save appear here, with a preview of their first page.';
      els.recentsList.appendChild(d);
      return;
    }
    list.forEach((r) => {
      const card = document.createElement('button');
      card.className = 'recent-card';
      card.title = r.path;
      card.dataset.path = r.path.toLowerCase();

      const thumb = document.createElement('span');
      thumb.className = 'recent-thumb';
      fillRecentThumb(thumb, r);

      const info = document.createElement('span');
      info.className = 'recent-info';
      const nm = document.createElement('span'); nm.className = 'recent-name'; nm.textContent = r.name;
      const meta = document.createElement('span'); meta.className = 'recent-meta';
      meta.textContent = `${EXT_STYLE[r.ext] || '?'} · ${timeAgo(r.ts)}`;
      info.appendChild(nm); info.appendChild(meta);

      card.appendChild(thumb); card.appendChild(info);
      attachRecentRemove(card, r);
      card.addEventListener('click', () => openFromPath(r.path));
      els.recentsList.appendChild(card);
    });
  }
  function renderHomeTiles(list) {
    if (!els.homeTiles) return;
    els.btnClearHomeRecents.classList.toggle('hidden', !list.length);
    els.homeTiles.innerHTML = '';
    if (!list.length) {
      const d = document.createElement('p');
      d.className = 'home-tiles-empty';
      d.id = 'home-tiles-empty';
      d.textContent = 'Files you open or save appear here, with a preview of their first page.';
      els.homeTiles.appendChild(d);
      els.homeTilesEmpty = d;
      return;
    }
    list.forEach((r) => {
      const tile = document.createElement('button');
      tile.type = 'button';
      tile.className = 'home-tile';
      tile.title = r.path;
      tile.dataset.path = r.path.toLowerCase();

      const cover = document.createElement('div');
      cover.className = 'home-tile-cover';
      fillRecentThumb(cover, r);
      if (cover.classList.contains('recent-thumb-type')) {
        cover.classList.remove('recent-thumb-type');
        cover.classList.add('home-tile-cover-type');
      }

      const badge = document.createElement('span');
      badge.className = 'home-tile-badge ' + kindBadgeClass(r.ext);
      badge.textContent = EXT_STYLE[r.ext] || '?';
      cover.appendChild(badge);
      attachRecentRemove(cover, r);

      const info = document.createElement('span');
      info.className = 'home-tile-info';
      const name = document.createElement('span');
      name.className = 'home-tile-name';
      name.textContent = r.name;
      const meta = document.createElement('span');
      meta.className = 'home-tile-meta';
      meta.textContent = `${EXT_STYLE[r.ext] || '?'} · ${timeAgo(r.ts)}`;
      info.appendChild(name);
      info.appendChild(meta);

      tile.appendChild(cover);
      tile.appendChild(info);
      tile.addEventListener('click', () => openFromPath(r.path));
      els.homeTiles.appendChild(tile);
    });
  }
  async function loadRecents() {
    const list = await window.margo.recents.list();
    lastRecents = list;
    renderSidebarRecents(list);
    renderHomeTiles(list);
    markActiveRecent();
    queueThumbBackfill(list);
  }

  const thumbBackfillQueue = [];
  const thumbBackfillSeen = new Set();
  let thumbBackfillRunning = false;

  function queueThumbBackfill(list) {
    for (const r of list) {
      if (!recentWantsContentThumb(r) || r.thumb) continue;
      if (thumbBackfillSeen.has(r.path) || thumbBackfillQueue.includes(r.path)) continue;
      thumbBackfillQueue.push(r.path);
    }
    runThumbBackfill();
  }

  async function runThumbBackfill() {
    if (thumbBackfillRunning) return;
    thumbBackfillRunning = true;
    while (thumbBackfillQueue.length) {
      const p = thumbBackfillQueue.shift();
      try {
        const res = await window.margo.peekPath(p);
        if (!res.ok || !res.doc) continue;
        const url = await window.MargoThumbs.generate(res.doc, res.doc);
        if (url) {
          thumbBackfillSeen.add(p);
          const list = await window.margo.recents.list();
          lastRecents = list;
          renderSidebarRecents(list);
          renderHomeTiles(list);
          markActiveRecent();
        }
      } catch {}
    }
    thumbBackfillRunning = false;
    if (thumbBackfillQueue.length) runThumbBackfill();
  }

  /* ---------------- sliding sidebar ---------------- */
  const SIDEBAR_MIN = 200;
  const SIDEBAR_MAX = 480;
  const SIDEBAR_DEFAULT = 252;
  let sidebarPinned = localStorage.getItem('margo.sidebarPinned') === '1';
  let sideTimer = null;
  let sidebarResizing = false;
  let sidebarWidth = parseInt(localStorage.getItem('margo.sidebarWidth'), 10);
  if (!Number.isFinite(sidebarWidth)) sidebarWidth = SIDEBAR_DEFAULT;

  function applySidebarWidth(px) {
    const w = Math.round(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, px)));
    document.documentElement.style.setProperty('--sidebar-w', w + 'px');
    return w;
  }
  applySidebarWidth(sidebarWidth);

  function applySidebarMode() {
    els.shell.classList.toggle('pinned', sidebarPinned);
    if (sidebarPinned) els.sidebar.classList.add('open');
    els.pinBtn.classList.toggle('pinned', sidebarPinned);
    els.pinBtn.innerHTML = window.MargoIcons.pin;
    els.pinBtn.title = sidebarPinned ? 'Unpin sidebar (auto-hide)' : 'Pin sidebar (always visible)';
  }
  function openSidebar() {
    clearTimeout(sideTimer);
    els.sidebar.classList.add('open');
  }
  function closeSidebar(immediate) {
    if (sidebarPinned || sidebarResizing) return;
    clearTimeout(sideTimer);
    if (immediate) { els.sidebar.classList.remove('open'); return; }
    sideTimer = setTimeout(() => els.sidebar.classList.remove('open'), 240);
  }
  function toggleSidebarPin() {
    sidebarPinned = !sidebarPinned;
    localStorage.setItem('margo.sidebarPinned', sidebarPinned ? '1' : '0');
    applySidebarMode();
    if (!sidebarPinned) closeSidebar(true);
  }
  els.hotzone.addEventListener('mouseenter', openSidebar);
  els.sidebar.addEventListener('mouseenter', openSidebar);
  els.sidebar.addEventListener('mouseleave', () => closeSidebar());
  els.pinBtn.addEventListener('click', toggleSidebarPin);

  const resizeEl = $('side-resize');
  if (resizeEl) {
    resizeEl.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      sidebarResizing = true;
      openSidebar();
      document.body.classList.add('sidebar-resizing');
      const startX = e.clientX;
      const startW = els.sidebar.getBoundingClientRect().width;
      const onMove = (ev) => {
        sidebarWidth = applySidebarWidth(startW + (ev.clientX - startX));
      };
      const onUp = () => {
        sidebarResizing = false;
        document.body.classList.remove('sidebar-resizing');
        localStorage.setItem('margo.sidebarWidth', String(sidebarWidth));
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    });
    resizeEl.addEventListener('dblclick', (e) => {
      e.preventDefault();
      sidebarWidth = applySidebarWidth(SIDEBAR_DEFAULT);
      localStorage.setItem('margo.sidebarWidth', String(sidebarWidth));
    });
  }

  /* ---------------- menu bar ---------------- */
  function showShortcuts() {
    const div = document.createElement('div');
    div.className = 'shortcut-list';
    div.innerHTML = [
      ['Ctrl+O', 'Open a file'], ['Ctrl+S', 'Save'], ['Ctrl+Shift+S', 'Save As…'],
      ['Ctrl+E', 'Export as PDF'], ['Ctrl+P', 'Print'],
      ['Ctrl+W', 'Close tab'], ['Ctrl+Tab', 'Cycle tabs'],
      ['Ctrl+B / Ctrl+I', 'Bold / italic while editing'],
      ['Ctrl+F', 'Find in document'],
      ['Ctrl++ / Ctrl+- / Ctrl+0', 'Zoom in / out / reset'],
      ['Enter / Tab', 'Commit cell & move (spreadsheet)'],
      ['F2', 'Edit selected cell'], ['Ctrl+Z / Ctrl+Y', 'Undo / redo']
    ].map(([k, v]) => `<kbd>${k}</kbd><span>${v}</span>`).join('');
    openModal('Keyboard shortcuts', div, [{ label: 'Close', primary: true, value: null }]);
  }
  async function showAbout() {
    const div = document.createElement('div');
    div.style.textAlign = 'center';
    const version = await window.margo.version();
    div.innerHTML =
      `<div style="display:flex;justify-content:center;margin:4px 0 10px"><img src="../../assets/icon.png" width="64" height="64" alt="" style="object-fit:contain"></div>` +
      `<div style="font-size:16px;font-weight:700;color:var(--text)">Margo ${version}</div>` +
      `<div style="margin-top:4px">A friendly home for your documents.</div>` +
      `<div style="margin-top:10px;font-size:11.5px;color:var(--text-faint)">Made by Sounak</div>`;
    openModal('About', div, [{ label: 'Close', primary: true, value: null }]);
  }

  let updateStatus = { state: 'idle', packaged: false, currentVersion: '', version: null, percent: null, message: null };
  let settingsLive = null;
  let promptedForVersion = null;

  function updateStatusLabel(st) {
    switch (st && st.state) {
      case 'checking': return 'Checking…';
      case 'available': return st.version ? `Update ${st.version} available` : 'Update available';
      case 'downloading': return `Downloading ${st.percent != null ? st.percent : 0}%`;
      case 'downloaded': return 'Ready to restart';
      case 'not-available': return 'Up to date';
      case 'error': return st.message || 'Could not check for updates';
      case 'disabled': return 'Idle';
      default: return 'Idle';
    }
  }

  function paintSettings(st) {
    if (!settingsLive) return;
    settingsLive.version.textContent = st.currentVersion || '—';
    settingsLive.status.textContent = updateStatusLabel(st);
    const busy = st.state === 'checking' || st.state === 'downloading';
    settingsLive.check.disabled = busy;
    settingsLive.install.classList.toggle('hidden', st.state !== 'downloaded');
  }

  async function promptRestart(version) {
    if (!els.modalBackdrop.classList.contains('hidden')) return;
    const div = document.createElement('div');
    div.className = 'modal-lead';
    div.textContent = version
      ? `Version ${version} is downloaded. Restart Margo to install it.`
      : 'An update is downloaded. Restart Margo to install it.';
    const go = await openModal('Update ready', div, [
      { label: 'Later', value: false },
      { label: 'Restart and install', primary: true, value: true }
    ]);
    if (go) window.margo.updates.install();
  }

  function applyUpdateStatus(st) {
    updateStatus = st || updateStatus;
    paintSettings(updateStatus);
    const tag = updateStatus.version || 'ready';
    if (updateStatus.state === 'downloaded' && promptedForVersion !== tag) {
      promptedForVersion = tag;
      toast(updateStatus.version
        ? `Update ${updateStatus.version} is ready — restart to install.`
        : 'An update is ready — restart to install.');
      promptRestart(updateStatus.version);
    }
  }

  window.margo.updates.onStatus((st) => applyUpdateStatus(st));

  async function showSettings(andCheck) {
    const st = await window.margo.updates.status();
    updateStatus = st || updateStatus;
    const version = updateStatus.currentVersion || await window.margo.version();

    const panel = document.createElement('div');
    panel.className = 'settings-panel';

    const verRow = document.createElement('div');
    verRow.className = 'settings-row';
    const verLabel = document.createElement('span');
    verLabel.className = 'settings-label';
    verLabel.textContent = 'Version';
    const verValue = document.createElement('span');
    verValue.className = 'settings-value';
    verValue.textContent = version;
    verRow.appendChild(verLabel);
    verRow.appendChild(verValue);

    const gStatus = await refreshGoogle();
    const gRow = document.createElement('div');
    gRow.className = 'settings-row';
    const gLabel = document.createElement('span');
    gLabel.className = 'settings-label';
    gLabel.textContent = 'Google';
    const gValue = document.createElement('span');
    gValue.className = 'settings-value';
    gValue.textContent = gStatus.signedIn ? (gStatus.email || 'Signed in') : 'Not signed in';
    gRow.appendChild(gLabel);
    gRow.appendChild(gValue);
    const gActions = document.createElement('div');
    gActions.className = 'settings-actions';
    const gBtn = document.createElement('button');
    gBtn.type = 'button';
    gBtn.className = 'btn ghost';
    gBtn.textContent = gStatus.signedIn ? 'Sign out' : 'Sign in with Google';
    gBtn.addEventListener('click', async () => {
      if (googleStatus.signedIn) {
        await window.margo.google.signOut();
        await refreshGoogle();
        gValue.textContent = 'Not signed in';
        gBtn.textContent = 'Sign in with Google';
      } else {
        const r = await applyGoogleSignIn();
        if (!r.ok) return;
        gValue.textContent = googleStatus.email || 'Signed in';
        gBtn.textContent = 'Sign out';
      }
    });
    gActions.appendChild(gBtn);

    const stRow = document.createElement('div');
    stRow.className = 'settings-row';
    const stLabel = document.createElement('span');
    stLabel.className = 'settings-label';
    stLabel.textContent = 'Updates';
    const stValue = document.createElement('span');
    stValue.className = 'settings-value';
    stValue.textContent = updateStatusLabel(updateStatus);
    stRow.appendChild(stLabel);
    stRow.appendChild(stValue);

    const note = document.createElement('p');
    note.className = 'settings-note';
    note.textContent = 'Updates apply to the installed app only. Running with npm start will not download new versions.';

    const actions = document.createElement('div');
    actions.className = 'settings-actions';
    const checkBtn = document.createElement('button');
    checkBtn.className = 'btn ghost';
    checkBtn.type = 'button';
    checkBtn.textContent = 'Check for updates';
    checkBtn.addEventListener('click', () => { window.margo.updates.check(); });
    const installBtn = document.createElement('button');
    installBtn.className = 'btn primary hidden';
    installBtn.type = 'button';
    installBtn.textContent = 'Restart and install';
    installBtn.addEventListener('click', () => window.margo.updates.install());
    actions.appendChild(checkBtn);
    actions.appendChild(installBtn);

    panel.appendChild(verRow);
    panel.appendChild(gRow);
    panel.appendChild(gActions);
    panel.appendChild(stRow);
    panel.appendChild(note);
    panel.appendChild(actions);

    settingsLive = { version: verValue, status: stValue, check: checkBtn, install: installBtn };
    paintSettings(updateStatus);
    const closed = openModal('Settings', panel, [{ label: 'Close', primary: true, value: null }]);
    closed.then(() => { settingsLive = null; });
    if (andCheck) window.margo.updates.check();
  }

  let googleStatus = { signedIn: false, configured: false, email: '', name: '', pictureDataUrl: null, initials: 'G' };

  function paintAccount() {
    const av = els.accountAvatar;
    if (!av) return;
    av.innerHTML = '';
    av.textContent = '';
    if (googleStatus.signedIn && googleStatus.pictureDataUrl) {
      const img = document.createElement('img');
      img.alt = '';
      img.src = googleStatus.pictureDataUrl;
      av.appendChild(img);
    } else if (googleStatus.signedIn) {
      av.textContent = googleStatus.initials || 'G';
    } else {
      av.innerHTML = '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="8" cy="6" r="2.2"/><path d="M3.5 13c.6-2.2 2.3-3.2 4.5-3.2s3.9 1 4.5 3.2"/></svg>';
    }
    if (els.btnAccount) {
      els.btnAccount.title = googleStatus.signedIn
        ? (googleStatus.email || 'Google account')
        : 'Sign in with Google';
    }
  }

  async function refreshGoogle() {
    const fallback = { signedIn: false, configured: false, email: '', name: '', pictureDataUrl: null, initials: 'G' };
    try {
      const api = window.margo && window.margo.google;
      if (!api || typeof api.status !== 'function') {
        googleStatus = fallback;
      } else {
        const next = await api.status();
        if (next) googleStatus = next;
      }
    } catch { /* keep last known status */ }
    paintAccount();
    return googleStatus;
  }

  async function applyGoogleSignIn() {
    const r = await window.margo.google.signIn();
    if (!r.ok) {
      toast(r.error || 'Sign-in failed', 'error');
      return r;
    }
    if (r.status) {
      googleStatus = r.status;
      paintAccount();
    } else {
      await refreshGoogle();
    }
    return r;
  }

  function closeAccountMenu() {
    if (els.accountMenu) els.accountMenu.classList.add('hidden');
  }

  function openAccountMenu() {
    const menu = els.accountMenu;
    menu.innerHTML = '';
    const email = document.createElement('div');
    email.className = 'account-menu-email';
    email.textContent = googleStatus.email || googleStatus.name || 'Signed in';
    const shareBtn = document.createElement('button');
    shareBtn.type = 'button';
    shareBtn.textContent = 'Share this file…';
    shareBtn.disabled = !(state.view === 'editor' && state.doc);
    shareBtn.addEventListener('click', () => { closeAccountMenu(); shareDoc(); });
    const openDriveBtn = document.createElement('button');
    openDriveBtn.type = 'button';
    openDriveBtn.textContent = 'Open from Drive…';
    openDriveBtn.addEventListener('click', () => { closeAccountMenu(); showOpenFromDrive(); });
    const outBtn = document.createElement('button');
    outBtn.type = 'button';
    outBtn.textContent = 'Sign out';
    outBtn.addEventListener('click', async () => {
      closeAccountMenu();
      await window.margo.google.signOut();
      await refreshGoogle();
      toast('Signed out of Google');
    });
    menu.appendChild(email);
    menu.appendChild(openDriveBtn);
    menu.appendChild(shareBtn);
    menu.appendChild(outBtn);
    menu.classList.remove('hidden');
  }

  if (els.btnAccount) {
    els.btnAccount.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (googleStatus.signedIn) {
        if (els.accountMenu.classList.contains('hidden')) openAccountMenu();
        else closeAccountMenu();
        return;
      }
      const r = await applyGoogleSignIn();
      if (!r.ok) return;
    });
  }
  document.addEventListener('mousedown', (e) => {
    if (!els.accountMenu || els.accountMenu.classList.contains('hidden')) return;
    if (els.titlebarRight && els.titlebarRight.contains(e.target)) return;
    if (els.btnAccount.contains(e.target) || els.accountMenu.contains(e.target)) return;
    closeAccountMenu();
  });

  function roleSelect(current, onChange) {
    const sel = document.createElement('select');
    [['reader', 'Viewer'], ['commenter', 'Commenter'], ['writer', 'Editor']].forEach(([v, l]) => {
      const o = document.createElement('option');
      o.value = v;
      o.textContent = l;
      if (v === current) o.selected = true;
      sel.appendChild(o);
    });
    sel.addEventListener('change', () => onChange(sel.value));
    return sel;
  }

  function paintPeople(listEl, fileId, people) {
    listEl.innerHTML = '';
    (people || []).forEach((p) => {
      const row = document.createElement('div');
      row.className = 'share-person';
      const who = document.createElement('div');
      who.className = 'share-person-who';
      const nm = document.createElement('div');
      nm.className = 'share-person-name';
      nm.textContent = p.displayName || p.email || 'Person';
      const em = document.createElement('div');
      em.className = 'share-person-email';
      em.textContent = p.email || p.roleLabel;
      who.appendChild(nm);
      who.appendChild(em);
      row.appendChild(who);
      if (p.isOwner) {
        const tag = document.createElement('span');
        tag.className = 'settings-value';
        tag.textContent = 'Owner';
        row.appendChild(tag);
      } else {
        row.appendChild(roleSelect(p.role, async (role) => {
          const res = await window.margo.google.setRole({ fileId, permissionId: p.id, role });
          if (!res.ok) { toast(res.error || 'Could not change access', 'error'); return; }
          paintPeople(listEl, fileId, res.people);
        }));
        const rm = document.createElement('button');
        rm.type = 'button';
        rm.className = 'btn ghost';
        rm.textContent = 'Remove';
        rm.addEventListener('click', async () => {
          const res = await window.margo.google.removePerson({ fileId, permissionId: p.id });
          if (!res.ok) { toast(res.error || 'Could not remove', 'error'); return; }
          paintPeople(listEl, fileId, res.people);
        });
        row.appendChild(rm);
      }
      listEl.appendChild(row);
    });
  }

  function fillSharePanel(panel, payload) {
    panel.innerHTML = '';
    const lead = document.createElement('div');
    lead.className = 'modal-lead';
    lead.textContent = payload.name ? ('On Drive: ' + payload.name) : 'Shared on Google Drive';
    const list = document.createElement('div');
    list.className = 'share-people';
    paintPeople(list, payload.fileId, payload.people);

    const add = document.createElement('div');
    add.className = 'share-add';
    const email = document.createElement('input');
    email.type = 'email';
    email.placeholder = 'Add people (email)';
    const sel = roleSelect('reader', () => {});
    const send = document.createElement('button');
    send.type = 'button';
    send.className = 'btn primary';
    send.textContent = 'Share';
    send.addEventListener('click', async () => {
      const res = await window.margo.google.addPerson({
        fileId: payload.fileId,
        email: email.value,
        role: sel.value
      });
      if (!res.ok) { toast(res.error || 'Could not share', 'error'); return; }
      email.value = '';
      payload.people = res.people;
      paintPeople(list, payload.fileId, res.people);
      toast('Invitation sent');
    });
    add.appendChild(email);
    add.appendChild(sel);
    add.appendChild(send);

    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'btn ghost';
    copy.textContent = 'Copy link';
    copy.addEventListener('click', async () => {
      const res = await window.margo.google.copyLink(payload.webViewLink);
      toast(res.ok ? 'Link copied' : (res.error || 'No link'), res.ok ? null : 'error');
    });

    const note = document.createElement('p');
    note.className = 'settings-note';
    note.textContent = 'Commenter can comment on the file in Drive — not inside Margo. Only people you add can open the link.';

    panel.appendChild(lead);
    panel.appendChild(list);
    panel.appendChild(add);
    panel.appendChild(copy);
    panel.appendChild(note);
  }

  async function ensureGoogleSignedIn(title, configuredMsg) {
    const st = await refreshGoogle();
    if (st.signedIn) return true;
    const div = document.createElement('div');
    const p = document.createElement('p');
    p.className = 'modal-lead';
    p.textContent = st.configured
      ? configuredMsg
      : 'Google sign-in is not configured. Add a Desktop OAuth client ID (see README), then restart Margo.';
    div.appendChild(p);
    if (st.configured) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn primary';
      btn.textContent = 'Sign in with Google';
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        const r = await applyGoogleSignIn();
        if (!r.ok) {
          btn.disabled = false;
          return;
        }
        closeModal('signed-in');
      });
      const actions = document.createElement('div');
      actions.className = 'settings-actions';
      actions.appendChild(btn);
      div.appendChild(actions);
    }
    const result = await openModal(title, div, [{ label: 'Close', primary: !st.configured, value: null }]);
    if (result === 'signed-in') {
      await refreshGoogle();
      return ensureGoogleSignedIn(title, configuredMsg);
    }
    return false;
  }

  async function showShareModal() {
    if (!(await ensureGoogleSignedIn(
      'Share',
      'Sign in with Google to upload this file to Drive and share it.'
    ))) return;

    const panel = document.createElement('div');
    panel.className = 'share-panel';
    const wait = document.createElement('p');
    wait.className = 'settings-note';
    wait.textContent = 'Uploading to Google Drive…';
    panel.appendChild(wait);
    const closed = openModal('Share', panel, [{ label: 'Close', primary: true, value: null }], { wide: true });
    const res = await window.margo.google.share({ path: state.doc.path, name: state.doc.name });
    if (!res.ok) {
      wait.textContent = res.error || 'Upload failed';
      wait.style.color = 'var(--danger)';
    } else {
      fillSharePanel(panel, res);
    }
    await closed;
  }

  async function shareDoc() {
    closeAccountMenu();
    if (!(state.view === 'editor' && state.doc)) {
      toast('Open a document first.');
      return;
    }
    if (state.dirty || !state.doc.path) {
      const ok = await saveDoc(!state.doc.path);
      if (!ok) return;
    }
    if (!state.doc.path) {
      toast('Save the file locally first.');
      return;
    }
    await showShareModal();
  }

  async function openDriveFile(file) {
    const hintPath = file.localPath;
    const existing = hintPath ? findTabByPath(hintPath) : null;
    if (existing && existing.dirty) {
      await activateTab(existing.id);
      if (!(await resolveDirty())) return;
      existing.dirty = false;
      state.dirty = false;
    }
    const res = await window.margo.google.openFromDrive({ fileId: file.id, name: file.name });
    if (!res.ok) {
      toast(res.error || 'Could not download from Drive', 'error');
      return;
    }
    const still = findTabByPath(res.path);
    if (still) {
      still.dirty = false;
      if (state.activeTabId === still.id) state.dirty = false;
      await closeTab(still.id);
    }
    await openFromPath(res.path);
  }

  async function showOpenFromDrive() {
    closeAccountMenu();
    if (!(await ensureGoogleSignedIn(
      'Open from Drive',
      'Sign in with Google to open files from your Margo folder on Drive.'
    ))) return;

    const panel = document.createElement('div');
    panel.className = 'share-panel';
    const wait = document.createElement('p');
    wait.className = 'settings-note';
    wait.textContent = 'Loading your Margo folder…';
    panel.appendChild(wait);
    const closed = openModal('Open from Drive', panel, [{ label: 'Close', primary: true, value: null }], { wide: true });
    const res = await window.margo.google.list();
    if (!res.ok) {
      wait.textContent = res.error || 'Could not list Drive files';
      wait.style.color = 'var(--danger)';
      await closed;
      return;
    }
    const files = res.files || [];
    if (!files.length) {
      wait.textContent = 'Nothing in your Margo folder yet. Share a file first.';
      await closed;
      return;
    }
    panel.innerHTML = '';
    const lead = document.createElement('div');
    lead.className = 'modal-lead';
    lead.textContent = 'Files in your Margo folder on Drive';
    const list = document.createElement('div');
    list.className = 'drive-file-list';
    files.forEach((f) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'drive-file';
      const nm = document.createElement('span');
      nm.className = 'drive-file-name';
      nm.textContent = f.name;
      const meta = document.createElement('span');
      meta.className = 'drive-file-meta';
      meta.textContent = f.modifiedTime ? timeAgo(Date.parse(f.modifiedTime) || 0) : '';
      row.appendChild(nm);
      row.appendChild(meta);
      row.addEventListener('click', () => closeModal(f));
      list.appendChild(row);
    });
    panel.appendChild(lead);
    panel.appendChild(list);
    const picked = await closed;
    if (!picked || !picked.id) return;
    await openDriveFile(picked);
  }

  function checkForUpdates() {
    showSettings(true);
  }

  function menuSpec() {
    const hasDoc = state.view === 'editor' && !!state.doc;
    const kind = hasDoc ? state.doc.kind : null;
    const ed = state.editor;
    return [
      { label: 'File', items: [
        { label: 'New', submenu: [
          { label: 'Markdown note', action: () => newDocGuarded('md') },
          { label: 'Word document', action: () => newDocGuarded('doc') },
          { label: 'Spreadsheet', action: () => newDocGuarded('sheet') },
          { label: 'PDF document', action: () => newDocGuarded('pdf') }
        ] },
        { label: 'Open…', accel: 'Ctrl+O', action: pickAndOpen },
        { label: 'Open from Drive…', action: showOpenFromDrive },
        { label: 'Open Recent', enabled: lastRecents.length > 0, submenu: () =>
          lastRecents.slice(0, 8).map((r) => ({ label: r.name, action: () => openFromPath(r.path) }))
            .concat([{ sep: true }, { label: 'Clear recents', action: async () => { await window.margo.recents.clear(); loadRecents(); } }])
        },
        { sep: true },
        { label: 'Save', accel: 'Ctrl+S', enabled: hasDoc, action: () => saveDoc(false) },
        { label: 'Save As…', accel: 'Ctrl+Shift+S', enabled: hasDoc, action: () => saveDoc(true) },
        { label: 'Export as PDF…', accel: 'Ctrl+E', enabled: hasDoc && kind !== 'pdf', action: () => exportPdf() },
        { label: 'Print…', accel: 'Ctrl+P', enabled: hasDoc, action: () => printDoc() },
        { label: 'Export Images…', enabled: hasDoc && (kind === 'doc' || kind === 'pdf'), action: () => {
          if (kind === 'doc' && ed && ed.commands && ed.commands.extractImages) ed.commands.extractImages();
          else if (kind === 'pdf' && ed && ed.commands && ed.commands.showImages) ed.commands.showImages();
        } },
        { sep: true },
        { label: 'Share…', enabled: hasDoc, action: shareDoc },
        { sep: true },
        { label: 'Close document', accel: 'Ctrl+W', enabled: hasDoc, action: closeActiveTab },
        { label: 'Exit', action: () => window.margo.quit() }
      ] },
      { label: 'Edit', items: [
        { label: 'Undo', accel: 'Ctrl+Z', enabled: hasDoc && !!(ed && ed.commands && ed.commands.canUndo && ed.commands.canUndo()), action: () => editCommand('undo') },
        { label: 'Redo', accel: 'Ctrl+Y', enabled: hasDoc && !!(ed && ed.commands && ed.commands.canRedo && ed.commands.canRedo()), action: () => editCommand('redo') },
        { sep: true },
        { label: 'Cut', accel: 'Ctrl+X', enabled: hasDoc, action: () => editCommand('cut') },
        { label: 'Copy', accel: 'Ctrl+C', enabled: hasDoc, action: () => editCommand('copy') },
        { label: 'Paste', accel: 'Ctrl+V', enabled: hasDoc, action: () => editCommand('paste') },
        { sep: true },
        { label: 'Select All', accel: 'Ctrl+A', enabled: hasDoc && kind !== 'sheet' && kind !== 'pdf', action: () => editCommand('selectAll') },
        { sep: true },
        { label: 'Find & Replace…', accel: 'Ctrl+F', enabled: hasDoc, action: () => editCommand('find') }
      ] },
      { label: 'View', items: [
        { label: 'Appearance', submenu: () =>
          window.MargoThemes.list.map((t) => ({
            label: t.label,
            checked: state.theme === t.id,
            action: () => applyTheme(t.id, true)
          }))
        },
        { sep: true },
        { label: 'Pin sidebar', checked: sidebarPinned, action: toggleSidebarPin },
        { sep: true },
        { label: 'Headings Outline', enabled: hasDoc && (kind === 'doc' || kind === 'md'), action: () => ed && ed.commands && ed.commands.outline && ed.commands.outline() },
        { label: 'Document Statistics', enabled: hasDoc && (kind === 'doc' || kind === 'md'), action: () => ed && ed.commands && ed.commands.stats && ed.commands.stats() },
        { label: 'Images in Document', enabled: hasDoc && (kind === 'doc' || kind === 'pdf'), action: () => {
          if (kind === 'doc' && ed && ed.commands && ed.commands.extractImages) ed.commands.extractImages();
          else if (kind === 'pdf' && ed && ed.commands && ed.commands.showImages) ed.commands.showImages();
        } },
        { label: 'Focus Mode (Distraction-Free)', accel: 'Esc to exit', enabled: hasDoc && kind === 'doc', action: () => ed && ed.commands && ed.commands.focusMode && ed.commands.focusMode() },
        { label: 'Insert Function (fx)…', enabled: hasDoc && kind === 'sheet', action: () => ed && ed.commands && ed.commands.insertFx && ed.commands.insertFx() },
        { label: 'Insert Chart', enabled: hasDoc && kind === 'sheet', submenu: [
          { label: 'Column chart', action: () => ed && ed.commands && ed.commands.insertChart && ed.commands.insertChart('column') },
          { label: 'Bar chart', action: () => ed && ed.commands && ed.commands.insertChart && ed.commands.insertChart('bar') },
          { label: 'Line chart', action: () => ed && ed.commands && ed.commands.insertChart && ed.commands.insertChart('line') },
          { label: 'Pie chart', action: () => ed && ed.commands && ed.commands.insertChart && ed.commands.insertChart('pie') }
        ] },
        { label: 'Toggle AutoFilter', enabled: hasDoc && kind === 'sheet', action: () => ed && ed.commands && ed.commands.toggleFilter && ed.commands.toggleFilter() },
        { label: 'Sort Ascending (A-Z)', enabled: hasDoc && kind === 'sheet', action: () => ed && ed.commands && ed.commands.sortAsc && ed.commands.sortAsc() },
        { label: 'Sort Descending (Z-A)', enabled: hasDoc && kind === 'sheet', action: () => ed && ed.commands && ed.commands.sortDesc && ed.commands.sortDesc() },
        { sep: true },
        { label: 'Markdown layout', enabled: kind === 'md', submenu: () =>
          ['write', 'split', 'read'].map((m) => ({
            label: m[0].toUpperCase() + m.slice(1),
            checked: !!(ed && ed.commands && ed.commands.getMdMode && ed.commands.getMdMode() === m),
            action: () => ed.commands.setMdMode(m)
          }))
        },
        { label: 'Document layout', enabled: kind === 'doc', submenu: () =>
          ['print', 'read', 'split'].map((m) => ({
            label: m === 'print' ? 'Print Layout' : m === 'read' ? 'Read View' : 'Split View',
            checked: !!(ed && ed.commands && ed.commands.getViewMode && ed.commands.getViewMode() === m),
            action: () => ed.commands.setViewMode(m)
          }))
        },
        { label: 'Zoom', enabled: !!(ed && ed.commands && ed.commands.zoomIn), submenu: () => {
          const items = [
            { label: 'Zoom in', action: () => ed.commands.zoomIn() },
            { label: 'Zoom out', action: () => ed.commands.zoomOut() },
            { sep: true },
            { label: kind === 'pdf' ? 'Fit width' : 'Reset zoom', action: () => ed.commands.zoomReset() }
          ];
          return items;
        } }
      ] },
      { label: 'Help', items: [
        { label: 'Keyboard shortcuts', action: showShortcuts },
        { label: 'Settings', action: () => showSettings(false) },
        { label: 'Check for updates…', action: checkForUpdates },
        { sep: true },
        { label: 'About Margo', action: showAbout }
      ] }
    ];
  }

  /* ---------------- sidebar wiring ---------------- */
  function wireNewButtons(selector) {
    document.querySelectorAll(selector).forEach((b) => {
      b.addEventListener('click', () => newDocGuarded(b.dataset.new));
      const icon = b.querySelector('.side-new-icon, .home-new-icon');
      const kind = b.dataset.new;
      if (!icon) return;
      icon.innerHTML = kind === 'md' ? window.MargoIcons.fileMd
        : kind === 'doc' ? window.MargoIcons.fileDoc
        : kind === 'sheet' ? window.MargoIcons.fileSheet
        : window.MargoIcons.filePdf;
    });
  }
  wireNewButtons('.side-new');
  wireNewButtons('.home-new');
  $('btn-open-file').addEventListener('click', pickAndOpen);
  if (els.btnHomeOpen) els.btnHomeOpen.addEventListener('click', pickAndOpen);
  const clearRecents = async () => { await window.margo.recents.clear(); loadRecents(); };
  els.btnClearRecents.addEventListener('click', clearRecents);
  if (els.btnClearHomeRecents) els.btnClearHomeRecents.addEventListener('click', clearRecents);
  if (els.btnSidebarSettings) {
    const settingsIcon = $('side-settings-icon');
    if (settingsIcon) settingsIcon.innerHTML = window.MargoIcons.settings;
    els.btnSidebarSettings.addEventListener('click', () => showSettings(false));
  }
  els.btnHome.addEventListener('click', () => { if (state.view === 'home') return; showLanding(); });

  /* ---------------- drag & drop ---------------- */
  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', async (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    if (!file) return;
    const p = window.margo.pathForFile(file);
    if (p) await openFromPath(p);
  });

  function isDocumentUndoTarget(el) {
    if (!el || !el.closest) return true;
    if (el.closest('#modal-backdrop')) return false;
    if (el.closest('.doc-find-bar')) return false;
    if (el.closest('#account-menu')) return false;
    if (el.closest('.sig-pad') || el.closest('.sig-float') || el.closest('.sig-pad-hint')) return false;
    return true;
  }

  /* ---------------- shortcuts ---------------- */
  document.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && !e.shiftKey && e.key.toLowerCase() === 'z') {
      if (state.view === 'editor' && state.doc && isDocumentUndoTarget(e.target)) {
        e.preventDefault();
        editCommand('undo');
      }
    }
    else if (mod && e.key.toLowerCase() === 'y') {
      if (state.view === 'editor' && state.doc && isDocumentUndoTarget(e.target)) {
        e.preventDefault();
        editCommand('redo');
      }
    }
    else if (mod && e.shiftKey && e.key.toLowerCase() === 'z') {
      if (state.view === 'editor' && state.doc && isDocumentUndoTarget(e.target)) {
        e.preventDefault();
        editCommand('redo');
      }
    }
    else if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 's') { e.preventDefault(); if (state.view === 'editor') saveDoc(false); }
    else if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 's') { e.preventDefault(); if (state.view === 'editor') saveDoc(true); }
    else if (e.ctrlKey && e.key.toLowerCase() === 'o') { e.preventDefault(); pickAndOpen(); }
    else if (e.ctrlKey && e.key.toLowerCase() === 'e') { e.preventDefault(); if (state.view === 'editor') exportPdf(); }
    else if (e.ctrlKey && e.key.toLowerCase() === 'p') { e.preventDefault(); if (state.view === 'editor') printDoc(); }
    else if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'f') {
      if (state.view === 'editor' && state.doc) {
        e.preventDefault();
        editCommand('find');
      }
    }
    else if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'w') {
      e.preventDefault();
      if (state.view === 'editor') closeActiveTab();
    }
    else if (e.ctrlKey && e.key === 'Tab') {
      e.preventDefault();
      cycleTabs(e.shiftKey ? -1 : 1);
    }
    else if (mod && !e.shiftKey && (e.key === '=' || e.key === '+' || e.code === 'NumpadAdd')) {
      if (state.view === 'editor' && state.editor && state.editor.commands && state.editor.commands.zoomIn) {
        e.preventDefault();
        state.editor.commands.zoomIn();
      }
    }
    else if (mod && !e.shiftKey && (e.key === '-' || e.code === 'NumpadSubtract')) {
      if (state.view === 'editor' && state.editor && state.editor.commands && state.editor.commands.zoomOut) {
        e.preventDefault();
        state.editor.commands.zoomOut();
      }
    }
    else if (mod && !e.shiftKey && e.key === '0') {
      if (state.view === 'editor' && state.editor && state.editor.commands && state.editor.commands.zoomReset) {
        e.preventDefault();
        state.editor.commands.zoomReset();
      }
    }
    else if (e.key === 'Escape' && !els.modalBackdrop.classList.contains('hidden')) closeModal(null);
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushAllDrafts();
  });
  window.margo.onCloseRequest(async () => {
    syncActiveTab();
    await flushAllDrafts();
    for (const t of [...state.tabs]) {
      if (!t.dirty) continue;
      await activateTab(t.id);
      if (!(await resolveDirty())) return;
      t.dirty = state.dirty;
    }
    window.margo.closeNow();
  });
  window.margo.onOpenFile((p) => openFromPath(p));

  /* ---------------- boot ---------------- */
  async function boot() {
    if (window.pdfjsLib) {
      pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
    }
    window.MargoMenubar.attach(els.menubar, menuSpec);
    applySidebarMode();
    applyTheme(await window.margo.theme.get(), false);
    refreshHeader();
    await refreshGoogle();
    await loadRecents();
    applyViewMode();
    const recovered = await offerRecovery();
    if (!recovered && await window.margo.firstRun()) {
      const sample = await window.margo.samplePath();
      const res = await window.margo.openPath(sample);
      if (res.ok) await mountDoc(res.doc);
    }
  }

  /* test hooks (used by the smoke suite) */
  window.__margoTest = {
    state,
    openFromPath,
    newDoc,
    showLanding: () => { resetSession(); },
    resetSession,
    activateTab,
    closeTab,
    resolveDirty,
    saveTo: async (path) => {
      const data = await Promise.resolve(state.editor.getData());
      let thumbDataUrl = null;
      if (state.doc.kind === 'doc' || state.doc.kind === 'md') {
        try { thumbDataUrl = await window.MargoThumbs.jpegForDoc(state.doc, data); } catch {}
      }
      const res = await window.margo.save({ kind: state.doc.kind, path, data, thumbDataUrl });
      if (res.ok && state.editor.onSaved) await Promise.resolve(state.editor.onSaved(data));
      if (res.ok) {
        state.dirty = false;
        const t = findTab(state.activeTabId);
        if (t) t.dirty = false;
        await clearDraft(t);
        syncActiveTab();
        try { await window.margo.google.push({ path, name: state.doc.name }); } catch {}
      }
      return res;
    },
    getEditor: () => state.editor,
    exportTo: (path) => exportPdf(path),
    openSidebar,
    closeSidebar,
    loadRecents,
    applyTheme,
    toast,
    showSettings,
    shareDoc,
    flushDrafts: flushAllDrafts,
    restoreDrafts: () => restoreDrafts(),
    discardDrafts: () => window.margo.drafts.clear()
  };

  boot();
})();
