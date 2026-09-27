/* Margo — app shell: sidebar library, routing, save/open, theme, guards */
(function () {
  /* ---------------- icons (16px, stroke = currentColor) ----------------
     window.MargoIcons is the one icon set for the whole app: every value is an
     inline <svg> string on a 16×16 grid, stroked in currentColor at 1.6, so it
     takes the colour and size (CSS width/height) of wherever it is dropped.
     Editors reuse it for their toolbars: `el.innerHTML = MargoIcons.bold`.

     Keys, by group:
       text/format   ul ol quote code codeblock link table hr alignLeft
                     alignCenter alignRight alignJustify clear subscript
                     superscript highlight lineSpacing caseChange indentInc
                     indentDec bold italic underline strike textColor heading
       edit          undo redo cut copy paste search replace
       insert        image imageStack pageBreak symbol callout date comment
                     commentsPanel pen signature shapes textbox
       page/layout   columns margins orientation pageSize headerFooter header
                     footer printLayout readView outline stats focus
                     spellcheck
       sheet         fx autosum chartCol chartBar chartLine chartPie filter
                     sortAZ sortZA freeze merge wrap currency percent comma
                     decimalInc decimalDec shading borderAll borderOuter
                     borderNone valignTop valignMiddle valignBottom plusRow
                     plusCol
       files/kinds   fileMd fileDoc fileSheet filePdf fileSlides file note
                     folderOpen open save saveAs download upload exportPdf
                     print share
       templates     letter resume meeting budget todo
       shell/nav     home plus close check chevronRight chevronDown more
                     command keyboard palette sidebar pin star starFilled
                     clock grid list trash refresh externalLink copyPath
                     info warning success error user logout cloud sparkle
                     sun moon settings bell zoomIn zoomOut fit window
                     density tabs present */
  const S = (d, extra) =>
    `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}${extra || ''}</svg>`;
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
    /* Listing the pictures already in the document is a different job from
       placing one, so it gets a stack rather than a second single frame. */
    imageStack: S('<rect x="5" y="2.5" width="8.5" height="8.5" rx="1.6"/><circle cx="7.9" cy="5.4" r="0.9"/><path d="m5.6 9.8 2.5-2.4 1.8 1.7 1.9-2.1 1.7 1.7"/><path d="M11 13.5H4a1.5 1.5 0 0 1-1.5-1.5V5.2"/>'),
    zoomIn: S('<circle cx="7" cy="7" r="4.5"/><path d="m13.5 13.5-3.2-3.2M7 5.2v3.6M5.2 7h3.6"/>'),
    zoomOut: S('<circle cx="7" cy="7" r="4.5"/><path d="m13.5 13.5-3.2-3.2M5.2 7h3.6"/>'),
    fit: S('<path d="M2.5 6V3.5a1 1 0 0 1 1-1H6M10 2.5h2.5a1 1 0 0 1 1 1V6M13.5 10v2.5a1 1 0 0 1-1 1H10M6 13.5H3.5a1 1 0 0 1-1-1V10"/>'),
    sun: S('<circle cx="8" cy="8" r="3.2"/><path d="M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M12.6 3.4l-1.1 1.1M4.5 11.5l-1.1 1.1"/>'),
    moon: S('<path d="M13.5 9.5A5.5 5.5 0 0 1 6.5 2.5a5.5 5.5 0 1 0 7 7z"/>'),
    pin: S('<path d="M6.2 2h3.6M8 2v2.6M5 4.6h6l1.2 4.6H3.8zM8 9.2v4.3"/>'),
    settings: S('<circle cx="8" cy="8" r="2.2"/><path d="M8 1.6v1.4M8 13v1.4M1.6 8h1.4M13 8h1.4M3.7 3.7l1 1M11.3 11.3l1 1M12.3 3.7l-1 1M4.7 11.3l-1 1"/>'),
    note: S('<path d="M3.5 2.5h7.5L13.5 5.5V13.5H3.5z"/><path d="M11 2.5V5.5h2.5M5.5 8h5M5.5 10.5h3.5"/>'),
    bell: S('<path d="M8 2.5a3.2 3.2 0 0 1 3.2 3.2v2.1l1.3 2.2H3.5L4.8 7.8V5.7A3.2 3.2 0 0 1 8 2.5z"/><path d="M6.5 13a1.5 1.5 0 0 0 3 0"/>'),
    /* A speech bubble reads as a remark on the text; the page-with-lines and
       the bell that stood in for it read as a document and an alarm. */
    comment: S('<path d="M13.5 9.5a1.8 1.8 0 0 1-1.8 1.8H6.2L3 13.5v-2.2H4.3a1.8 1.8 0 0 1-1.8-1.8v-5A1.8 1.8 0 0 1 4.3 2.7h7.4a1.8 1.8 0 0 1 1.8 1.8z"/><path d="M5.8 5.8h4.4M5.8 8h3"/>'),
    /* The rail toggle sits next to Add comment, so it shows the panel it opens
       rather than a second copy of the same bubble. */
    commentsPanel: S('<rect x="2" y="3" width="12" height="10" rx="1.6"/><path d="M9.5 3v10"/><path d="M11 6.2h1.4M11 8.4h1"/>'),
    cut: S('<circle cx="4.2" cy="11.8" r="1.7"/><circle cx="11.8" cy="11.8" r="1.7"/><path d="M5.4 10.6 11.5 2.5M10.6 10.6 4.5 2.5"/>'),
    copy: S('<rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M10.5 5.5v-2a1.5 1.5 0 0 0-1.5-1.5H4a1.5 1.5 0 0 0-1.5 1.5V9A1.5 1.5 0 0 0 4 10.5h1.5"/>'),
    paste: S('<path d="M5.5 3.5H4A1.5 1.5 0 0 0 2.5 5v8A1.5 1.5 0 0 0 4 14.5h8A1.5 1.5 0 0 0 13.5 13V5A1.5 1.5 0 0 0 12 3.5h-1.5"/><rect x="5.5" y="1.5" width="5" height="3" rx="1"/><path d="M5.8 8.5h4.4M5.8 11h3"/>'),
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
    /* Header and footer sit next to each other, so each one fills in the band
       it actually writes to rather than both showing the same page. */
    header: S('<rect x="2.5" y="2.5" width="11" height="11" rx="1"/><path d="M2.5 5.8h11" stroke-dasharray="1.5 1.5"/><path d="M4.4 4.2h7.2" stroke-width="2"/>'),
    footer: S('<rect x="2.5" y="2.5" width="11" height="11" rx="1"/><path d="M2.5 10.2h11" stroke-dasharray="1.5 1.5"/><path d="M4.4 11.8h7.2" stroke-width="2"/>'),
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
    readView: S('<path d="M2 8s2.5-4 6-4 6 4 6 4-2.5 4-6 4-6-4-6-4z"/><circle cx="8" cy="8" r="1.8"/>'),
    /* text formatting */
    bold: S('<path d="M4.5 2.5h4.2a2.8 2.8 0 0 1 0 5.6H4.5zM4.5 8.1h5a2.7 2.7 0 0 1 0 5.4h-5z"/>'),
    italic: S('<path d="M6.5 2.5h6M3.5 13.5h6M9.8 2.5l-3.6 11"/>'),
    underline: S('<path d="M4.5 2.5v5a3.5 3.5 0 0 0 7 0v-5M3.5 14h9"/>'),
    strike: S('<path d="M2.5 8h11M11 4.5c-.5-1.3-1.6-2-3.2-2-2 0-3.3 1-3.3 2.4 0 1.2.8 1.9 2.2 2.3M5 11.4c.5 1.4 1.7 2.1 3.2 2.1 2 0 3.4-1 3.4-2.5 0-.6-.2-1.1-.6-1.5"/>'),
    textColor: S('<path d="m4 11.5 4-9 4 9M5.4 8.5h5.2"/><path d="M2.5 14h11" stroke-width="2.2"/>'),
    heading: S('<path d="M3.5 2.5v11M10.5 2.5v11M3.5 8h7M12.5 13.5h1.5"/>'),
    /* insert */
    signature: S('<path d="M2 12.5c1.6 0 2.4-6 4-6 1.4 0 .3 4.5 1.6 4.5 1 0 1.6-2.4 2.6-2.4.9 0 .9 1.9 1.8 1.9.6 0 1.3-.5 2-1.2M2 14.5h12"/>'),
    shapes: S('<circle cx="5.2" cy="5.2" r="3"/><rect x="7.8" y="7.8" width="6" height="6" rx="1"/>'),
    textbox: S('<rect x="2" y="3" width="12" height="10" rx="1.5"/><path d="M5 6h6M8 6v4.5"/>'),
    /* files & kinds */
    file: S('<path d="M3.5 2h6L13 5.5V14h-9.5z"/><path d="M9.5 2v3.5H13"/>'),
    fileSlides: S('<rect x="2" y="3" width="12" height="8.5" rx="1.3"/><path d="M8 11.5V14M5.5 14h5M5 6h4M5 8.5h6"/>'),
    folderOpen: S('<path d="M2 12.5V4a1.5 1.5 0 0 1 1.5-1.5h2.6l1.5 1.6h4.4A1.5 1.5 0 0 1 13.5 5.6V7"/><path d="M2 12.5 3.8 7.8A1.2 1.2 0 0 1 4.9 7h8.9a.8.8 0 0 1 .75 1.1L13 12.5a1.5 1.5 0 0 1-1.4 1H3.4A1.4 1.4 0 0 1 2 12.5z"/>'),
    save: S('<path d="M3 2.5h8l2.5 2.5v8a1 1 0 0 1-1 1h-9.5a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1z"/><path d="M5 2.5v3h5.5v-3M5 14v-4.5h6V14"/>'),
    saveAs: S('<path d="M8.5 14H3.5a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1h7.5l2.5 2.5v2.5"/><path d="M5 2.5v3h5v-3"/><path d="m10.5 13.8.4-1.8 3.2-3.2 1.4 1.4-3.2 3.2z"/>'),
    download: S('<path d="M8 2.5v8M4.8 7.5 8 10.7l3.2-3.2M2.5 12v1a1.5 1.5 0 0 0 1.5 1.5h8a1.5 1.5 0 0 0 1.5-1.5v-1"/>'),
    upload: S('<path d="M8 10.5v-8M4.8 5.5 8 2.3l3.2 3.2M2.5 12v1a1.5 1.5 0 0 0 1.5 1.5h8a1.5 1.5 0 0 0 1.5-1.5v-1"/>'),
    exportPdf: S('<path d="M9 2H3.5v12H13V6z"/><path d="M9 2v4h4"/><path d="M5.5 11.5h5M8 7.5v4M6.3 9.8 8 11.5l1.7-1.7"/>'),
    print: S('<path d="M4.5 5.5V2.5h7v3"/><rect x="2" y="5.5" width="12" height="6" rx="1.3"/><path d="M4.5 9.5h7v4h-7z"/><path d="M11.5 7.6h.01"/>'),
    share: S('<circle cx="11.8" cy="3.8" r="1.8"/><circle cx="4.2" cy="8" r="1.8"/><circle cx="11.8" cy="12.2" r="1.8"/><path d="m5.8 7.1 4.4-2.4M5.8 8.9l4.4 2.4"/>'),
    /* templates */
    letter: S('<rect x="2" y="3.5" width="12" height="9" rx="1.5"/><path d="m2.5 4.5 5.5 4.3 5.5-4.3"/>'),
    resume: S('<rect x="2.5" y="2" width="11" height="12" rx="1.5"/><circle cx="6" cy="6" r="1.5"/><path d="M4 9.2c.4-1 1.1-1.5 2-1.5s1.6.5 2 1.5M9.5 5h2M9.5 7h2M4.5 11.5h7"/>'),
    meeting: S('<circle cx="5.5" cy="5.5" r="2"/><circle cx="11" cy="6" r="1.6"/><path d="M1.8 12.8c.5-2 1.9-3.1 3.7-3.1s3.2 1.1 3.7 3.1M9.4 9.4c.5-.3 1-.4 1.6-.4 1.5 0 2.6.9 3 2.7"/>'),
    budget: S('<rect x="2" y="2.5" width="12" height="11" rx="1.5"/><path d="M2 6h12M6.5 6v7.5M9 8.5h3M9 11h3"/>'),
    todo: S('<path d="m2.5 4 1.2 1.2L6 3M2.5 8.5l1.2 1.2L6 7.5"/><path d="M8.5 4.3h5M8.5 8.8h5M8.5 13h5"/><rect x="2.5" y="11.5" width="3" height="3" rx="0.6"/>'),
    /* shell & navigation */
    home: S('<path d="M2.5 7.2 8 2.5l5.5 4.7V13a1 1 0 0 1-1 1H10V10H6v4H3.5a1 1 0 0 1-1-1z"/>'),
    plus: S('<path d="M8 3v10M3 8h10"/>'),
    check: S('<path d="m3.5 8.5 3 3 6-7"/>'),
    chevronRight: S('<path d="m6 3.5 4.5 4.5L6 12.5"/>'),
    chevronDown: S('<path d="m3.5 6 4.5 4.5L12.5 6"/>'),
    more: S('<circle cx="3.5" cy="8" r="0.9" fill="currentColor" stroke="none"/><circle cx="8" cy="8" r="0.9" fill="currentColor" stroke="none"/><circle cx="12.5" cy="8" r="0.9" fill="currentColor" stroke="none"/>'),
    command: S('<path d="M5.5 5.5v5M10.5 5.5v5M5.5 5.5h5M5.5 10.5h5"/><path d="M5.5 5.5H4a1.5 1.5 0 1 1 1.5-1.5zM10.5 5.5V4A1.5 1.5 0 1 1 12 5.5zM5.5 10.5V12A1.5 1.5 0 1 1 4 10.5zM10.5 10.5H12a1.5 1.5 0 1 1-1.5 1.5z"/>'),
    keyboard: S('<rect x="1.5" y="3.5" width="13" height="9" rx="1.5"/><path d="M4 6.2h.01M6.4 6.2h.01M8.8 6.2h.01M11.2 6.2h.01M4 8.4h.01M11.2 8.4h.01M6.4 8.4h2.4M5 10.4h6"/>'),
    palette: S('<path d="M8 2a6 6 0 0 0 0 12c.9 0 1.3-.6 1.3-1.2 0-.9-.8-1.1-.8-1.9 0-.7.6-1.2 1.3-1.2h1.5A2.7 2.7 0 0 0 14 7 5.4 5.4 0 0 0 8 2z"/><circle cx="5" cy="7" r="0.8" fill="currentColor" stroke="none"/><circle cx="7.2" cy="4.8" r="0.8" fill="currentColor" stroke="none"/><circle cx="10.4" cy="5.2" r="0.8" fill="currentColor" stroke="none"/>'),
    sidebar: S('<rect x="2" y="2.5" width="12" height="11" rx="1.6"/><path d="M6 2.5v11M3.6 5h1M3.6 7h1"/>'),
    star: S('<path d="m8 2 1.8 3.8 4.2.5-3.1 2.9.8 4.1L8 11.3l-3.7 2 .8-4.1L2 6.3l4.2-.5z"/>'),
    starFilled: S('<path d="m8 2 1.8 3.8 4.2.5-3.1 2.9.8 4.1L8 11.3l-3.7 2 .8-4.1L2 6.3l4.2-.5z" fill="currentColor"/>'),
    clock: S('<circle cx="8" cy="8" r="6"/><path d="M8 4.8V8l2.2 1.4"/>'),
    grid: S('<rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1"/><rect x="9" y="2.5" width="4.5" height="4.5" rx="1"/><rect x="2.5" y="9" width="4.5" height="4.5" rx="1"/><rect x="9" y="9" width="4.5" height="4.5" rx="1"/>'),
    list: S('<path d="M5.5 4h8M5.5 8h8M5.5 12h8M2.5 4h.01M2.5 8h.01M2.5 12h.01"/>'),
    trash: S('<path d="M2.5 4.5h11M6.5 4.5V3a.8.8 0 0 1 .8-.8h1.4a.8.8 0 0 1 .8.8v1.5M4 4.5l.6 8.4a1.2 1.2 0 0 0 1.2 1.1h4.4a1.2 1.2 0 0 0 1.2-1.1L12 4.5"/>'),
    refresh: S('<path d="M13.5 8A5.5 5.5 0 1 1 11.8 4"/><path d="M13.5 2.5V5.5h-3"/>'),
    externalLink: S('<path d="M9.5 2.5h4v4M13.5 2.5 7.5 8.5M11.5 9.5v3a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h3"/>'),
    copyPath: S('<path d="M6.5 9.5 9.5 6.5M5 7 3.5 8.5a2.47 2.47 0 0 0 3.5 3.5L8.5 10.5M11 9l1.5-1.5A2.47 2.47 0 0 0 9 4L7.5 5.5"/>'),
    info: S('<circle cx="8" cy="8" r="6"/><path d="M8 7.2v3.8M8 5h.01"/>'),
    warning: S('<path d="M8 2.5 14 13H2z"/><path d="M8 6.5v3M8 11.3h.01"/>'),
    success: S('<circle cx="8" cy="8" r="6"/><path d="m5.3 8.2 1.8 1.8 3.6-4"/>'),
    error: S('<circle cx="8" cy="8" r="6"/><path d="M8 4.8v3.6M8 10.8h.01"/>'),
    user: S('<circle cx="8" cy="5.8" r="2.6"/><path d="M3 13.5c.6-2.4 2.6-3.7 5-3.7s4.4 1.3 5 3.7"/>'),
    logout: S('<path d="M6 13.5H3.5a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1H6M10.5 11l3-3-3-3M13.5 8H6"/>'),
    cloud: S('<path d="M4.5 12.5a3 3 0 0 1-.4-6 4 4 0 0 1 7.7-.8 3.4 3.4 0 0 1 .2 6.8z"/>'),
    sparkle: S('<path d="M8 2v3M8 11v3M2 8h3M11 8h3M4 4l1.8 1.8M10.2 10.2 12 12M12 4l-1.8 1.8M5.8 10.2 4 12"/>'),
    window: S('<rect x="2" y="2.5" width="12" height="11" rx="1.6"/><path d="M2 5.5h12"/>'),
    density: S('<path d="M2.5 3.5h11M2.5 6.5h11M2.5 9.5h11M2.5 12.5h11"/>'),
    tabs: S('<path d="M2 13.5V5a1 1 0 0 1 1-1h3.5l1 1.5H13a1 1 0 0 1 1 1v7"/><path d="M1.5 13.5h13"/>'),
    present: S('<rect x="2" y="2.5" width="12" height="8.5" rx="1.2"/><path d="m6.8 5 3 1.8-3 1.8zM8 11v2.5M5.5 13.5h5"/>')
  };
  const ICONS = window.MargoIcons;

  /* ---------------- state ---------------- */
  const MAX_TABS = 8;
  let tabSeq = 0;
  const state = {
    view: 'home',
    doc: null,        // alias of the active tab
    editor: null,
    dirty: false,
    theme: 'light',
    tabs: [],         // { id, doc, dirty, editor, pane, toolbar, host, statusLeft, statusRight, status, saving }
    activeTabId: null,
    lastActiveTabId: null, // the tab to return to from home (Ctrl+Tab, "Back to document")
    closedPaths: []   // most recent last - Ctrl+Shift+T reopens them
  };

  const $ = (id) => document.getElementById(id);
  const els = {
    home: $('view-landing'), editorView: $('view-editor'),
    host: null, toolbar: null,
    chip: $('doc-chip'), docName: $('doc-name'), docDirty: $('doc-dirty'),
    docBadge: $('doc-badge'), docKindDot: $('doc-kind-dot'),
    btnHome: $('btn-home'),
    statusLeft: null, statusRight: null,
    tabBar: $('tab-bar'), tabPanes: $('tab-panes'), tabNew: $('btn-tab-new'),
    recentsList: $('recents-grid'), sideEmpty: $('side-empty'),
    sidePinnedSection: $('side-pinned-section'), sidePinned: $('side-pinned'),
    sideSearch: $('side-search'), sideGroupBtn: $('btn-side-group'),
    sideNewRow: $('side-new-row'),
    btnClearRecents: $('btn-clear-recents'),
    homeTiles: $('home-tiles'), homeTilesEmpty: $('home-tiles-empty'),
    homePinnedWrap: $('home-pinned-wrap'), homePinned: $('home-pinned'),
    homeSearch: $('home-search'), homeFilter: $('home-filter'),
    homeNewRow: $('home-new-row'), homeTemplates: $('home-templates'),
    homeGreeting: $('home-greeting'), homeDate: $('home-date'),
    btnClearHomeRecents: $('btn-clear-home-recents'), btnHomeOpen: $('btn-home-open'),
    btnHomePalette: $('btn-home-palette'),
    btnSidebarSettings: $('btn-sidebar-settings'),
    btnSideShortcuts: $('btn-side-shortcuts'), btnSideTheme: $('btn-side-theme'),
    shell: $('shell'), sidebar: $('sidebar'), hotzone: $('side-hotzone'),
    pinBtn: $('btn-pin-sidebar'), menubar: $('menubar'),
    modalBackdrop: $('modal-backdrop'), modal: document.querySelector('#modal-backdrop .modal'),
    modalTitle: $('modal-title'), modalBody: $('modal-body'), modalActions: $('modal-actions'),
    paletteBackdrop: $('palette-backdrop'), paletteInput: $('palette-input'), paletteList: $('palette-list'),
    btnCommand: $('btn-command'),
    dropOverlay: $('drop-overlay'),
    toastWrap: $('toast-wrap'),
    btnAccount: $('btn-account'), accountAvatar: $('account-avatar'), accountMenu: $('account-menu')
  };

  const KIND_LABEL = { md: 'Markdown', doc: 'Word document', sheet: 'Spreadsheet', pdf: 'PDF', slides: 'Presentation' };
  const KIND_BADGE = { md: 'MD', doc: 'DOCX', sheet: 'XLSX', pdf: 'PDF', slides: 'PPTX' };
  const KIND_ICON = { md: 'fileMd', doc: 'fileDoc', sheet: 'fileSheet', pdf: 'filePdf', slides: 'fileSlides' };
  /* Every kind of blank document Margo can start. 'slides' only shows up when
     its editor has registered itself (window.MargoEditors.slides). */
  const NEW_KINDS = [
    { kind: 'doc', label: 'Document', long: 'Word document', meta: 'Word · .docx' },
    { kind: 'sheet', label: 'Spreadsheet', long: 'Spreadsheet', meta: 'Excel · .xlsx' },
    { kind: 'slides', label: 'Presentation', long: 'Presentation', meta: 'Slides · .pptx', optional: true },
    { kind: 'md', label: 'Markdown', long: 'Markdown note', meta: 'Note · .md' },
    { kind: 'pdf', label: 'PDF', long: 'PDF document', meta: 'Blank page · .pdf' }
  ];
  function kindAvailable(kind) {
    const def = NEW_KINDS.find((k) => k.kind === kind);
    if (!def) return false;
    return !def.optional || !!(window.MargoEditors && window.MargoEditors[kind]);
  }
  function availableKinds() {
    return NEW_KINDS.filter((k) => kindAvailable(k.kind));
  }

  /* ---------------- toast & modal ---------------- */
  /* toast(message, kind?, opts?) - kind: 'error' | 'success' | 'info' | null.
     opts.actions: [{ label, primary?, onClick }] turns it into a small prompt
     that stays up longer; opts.duration (ms, 0 = until dismissed).
     Returns { dismiss }. */
  const TOAST_MAX = 4;
  function toast(msg, kind, opts) {
    const o = opts || {};
    const t = document.createElement('div');
    t.className = 'toast' + (kind ? ' ' + kind : '');
    t.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    const iconKey = kind === 'error' ? 'error' : kind === 'success' ? 'success' : kind === 'info' ? 'info' : null;
    if (iconKey) {
      const ic = document.createElement('span');
      ic.className = 'toast-icon';
      ic.innerHTML = ICONS[iconKey];
      t.appendChild(ic);
    }
    const text = document.createElement('span');
    text.className = 'toast-msg';
    text.textContent = msg;
    t.appendChild(text);
    let timer = null;
    let gone = false;
    const dismiss = () => {
      if (gone) return;
      gone = true;
      clearTimeout(timer);
      t.classList.add('leaving');
      setTimeout(() => t.remove(), 230);
    };
    (o.actions || []).forEach((a) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'toast-action' + (a.primary ? ' primary' : '');
      b.textContent = a.label;
      b.addEventListener('click', () => {
        dismiss();
        try { a.onClick && a.onClick(); } catch (err) { console.error(err); }
      });
      t.appendChild(b);
    });
    els.toastWrap.appendChild(t);
    const live = [...els.toastWrap.querySelectorAll('.toast:not(.leaving)')];
    if (live.length > TOAST_MAX) live.slice(0, live.length - TOAST_MAX).forEach((x) => x.remove());
    const duration = o.duration != null ? o.duration
      : (o.actions && o.actions.length) ? 12000
        : kind === 'error' ? 4500 : 2800;
    if (duration > 0) {
      timer = setTimeout(dismiss, duration);
      /* Hovering holds it, so a message with a button is not whisked away
         while the pointer is on its way there. */
      t.addEventListener('mouseenter', () => clearTimeout(timer));
      t.addEventListener('mouseleave', () => { if (!gone) timer = setTimeout(dismiss, 1600); });
    }
    return { dismiss, el: t };
  }

  let modalResolve = null;
  let modalReturnFocus = null;
  const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';
  function isModalOpen() {
    return !els.modalBackdrop.classList.contains('hidden');
  }
  /* opts: { wide, className, initialFocus (element) } */
  function openModal(title, bodyEl, actions, opts) {
    /* A second modal opening over the first replaced the resolver, and
       whoever was awaiting the first one then waited for a promise nothing
       could ever settle. Answer it as though it had been dismissed, before
       taking the screen off it. */
    if (modalResolve) {
      const orphaned = modalResolve;
      modalResolve = null;
      orphaned(null);
    } else if (!isModalOpen()) {
      modalReturnFocus = document.activeElement;
    }
    closePalette();
    closeMenus();
    closeAccountMenu();
    els.modal.className = 'modal' + (opts && opts.wide ? ' wide' : '') + (opts && opts.className ? ' ' + opts.className : '');
    els.modalTitle.textContent = title;
    els.modalBody.innerHTML = '';
    els.modalBody.appendChild(bodyEl);
    els.modalActions.innerHTML = '';
    let primaryBtn = null;
    actions.forEach(({ label, primary, danger, value, keepOpen }) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn ' + (danger ? 'danger' : primary ? 'primary' : 'ghost');
      b.textContent = label;
      if (primary) primaryBtn = b;
      b.addEventListener('click', () => {
        const result = typeof value === 'function' ? value() : value;
        /* A button that answers the prompt closes it, which is every button
           here bar one: "Next" in the spreadsheet's find dialog acts on the
           grid behind the modal and has to leave it standing for the next
           press, or the dialog shuts itself on the first match. */
        if (!keepOpen) closeModal(result);
      });
      els.modalActions.appendChild(b);
    });
    els.modalBackdrop.classList.remove('hidden');
    /* Keys typed while a dialog is up used to land in the document behind
       it, because focus never left the editor. The dialog takes focus (its
       first field, else its default button) and Tab cycles inside it. */
    /* A text field would take the document's selection with it, and an
       editor asking a question usually still needs that selection for its
       answer - so from inside a document only a button takes focus. */
    const ae = document.activeElement;
    const fromEditor = !!(ae && (ae.isContentEditable || (ae.closest && ae.closest('.editor-host'))));
    const target = (opts && opts.initialFocus)
      || els.modalBody.querySelector('[autofocus]')
      || (!fromEditor && els.modalBody.querySelector('input:not([type]), input[type="text"], input[type="search"], input[type="email"], input[type="number"], textarea'))
      || primaryBtn
      || els.modalActions.querySelector('button');
    if (target) {
      try { target.focus({ preventScroll: true }); } catch {}
    }
    return new Promise((resolve) => { modalResolve = resolve; });
  }
  function closeModal(result) {
    const wasOpen = isModalOpen();
    els.modalBackdrop.classList.add('hidden');
    const back = modalReturnFocus;
    modalReturnFocus = null;
    /* Focus goes back to the control that opened the dialog - but never into
       a document body: an editor that saved its selection before asking
       restores it itself, and focusing the page first would plant the caret
       at the top and overwrite what it saved. */
    if (wasOpen && back && back.isConnected && typeof back.focus === 'function'
      && !back.isContentEditable && !(back.closest && back.closest('.editor-host'))) {
      try { back.focus({ preventScroll: true }); } catch {}
    }
    if (modalResolve) { modalResolve(result); modalResolve = null; }
  }
  els.modalBackdrop.addEventListener('mousedown', (e) => {
    if (e.target === els.modalBackdrop) closeModal(null);
  });
  function popoverOpen() {
    return !!document.querySelector('.mc-pop, .ctx-menu, .doc-ctx-menu, #menubar > .menu-drop');
  }
  document.addEventListener('keydown', (e) => {
    if (!isModalOpen()) return;
    if (e.key === 'Escape') {
      /* A colour picker or menu opened from inside the dialog closes first. */
      if (popoverOpen()) return;
      e.preventDefault();
      e.stopPropagation();
      closeModal(null);
      return;
    }
    if (e.key === 'Tab') {
      const items = [...els.modal.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement);
      if (!items.length) { e.preventDefault(); return; }
      const first = items[0];
      const last = items[items.length - 1];
      const inside = els.modal.contains(document.activeElement);
      if (!inside) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }, true);

  function inputModal(title, placeholder, initial) {
    const input = document.createElement('input');
    input.placeholder = placeholder || '';
    input.value = initial || '';
    const p = openModal(title, input, [
      { label: 'Cancel', value: null },
      { label: 'OK', primary: true, value: () => input.value }
    ], { initialFocus: input });
    setTimeout(() => { input.focus(); input.select(); }, 40);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); closeModal(input.value); }
      if (e.key === 'Escape') closeModal(null);
    });
    return p;
  }
  function confirmModal(title, message, opts) {
    const div = document.createElement('div');
    div.className = 'modal-lead';
    div.textContent = message;
    return openModal(title, div, [
      { label: 'Cancel', value: false },
      { label: (opts && opts.confirmLabel) || 'Delete', primary: true, value: true }
    ]);
  }

  /* ---------------- settings (persisted per install in localStorage) ---------------- */
  const SETTINGS_KEY = 'margo.settings';
  const SETTINGS_DEFAULTS = {
    defaultKind: 'doc',        // what Ctrl+N and the + tab button create
    autosave: false,           // save documents that already have a file, in the background
    autosaveSec: 60,
    spellcheck: true,
    density: 'comfortable',    // 'comfortable' | 'compact'
    reopenSession: false,      // reopen the tabs that were open when Margo closed
    sideGroup: false           // library grouped by file type
  };
  const AUTOSAVE_CHOICES = [15, 30, 60, 120, 300];
  function readSettings() {
    let raw = {};
    try { raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') || {}; } catch { raw = {}; }
    const s = { ...SETTINGS_DEFAULTS };
    if (NEW_KINDS.some((k) => k.kind === raw.defaultKind)) s.defaultKind = raw.defaultKind;
    if (typeof raw.autosave === 'boolean') s.autosave = raw.autosave;
    if (AUTOSAVE_CHOICES.includes(Number(raw.autosaveSec))) s.autosaveSec = Number(raw.autosaveSec);
    if (typeof raw.spellcheck === 'boolean') s.spellcheck = raw.spellcheck;
    if (raw.density === 'compact' || raw.density === 'comfortable') s.density = raw.density;
    if (typeof raw.reopenSession === 'boolean') s.reopenSession = raw.reopenSession;
    if (typeof raw.sideGroup === 'boolean') s.sideGroup = raw.sideGroup;
    return s;
  }
  let settings = readSettings();
  function updateSettings(patch) {
    settings = { ...settings, ...patch };
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch {}
    applySettings();
    try { document.dispatchEvent(new CustomEvent('margo:settings', { detail: { ...settings } })); } catch {}
    return settings;
  }
  function applySettings() {
    document.documentElement.dataset.density = settings.density;
    applySpellcheck(document);
    restartAutosave();
    if (els.sideGroupBtn) els.sideGroupBtn.setAttribute('aria-pressed', settings.sideGroup ? 'true' : 'false');
  }
  /* The global switch only ever turns checking off: when it is on, every
     field goes back to whatever its editor chose (the Markdown source, for
     one, keeps it off by design). */
  function applySpellcheckTo(el) {
    if (!el || el.closest('#modal-backdrop, #palette-backdrop')) return;
    if (!settings.spellcheck) {
      if (el.dataset.margoSpell === undefined) el.dataset.margoSpell = el.getAttribute('spellcheck') ?? '';
      el.spellcheck = false;
    } else if (el.dataset.margoSpell !== undefined) {
      const orig = el.dataset.margoSpell;
      delete el.dataset.margoSpell;
      if (orig === '') el.removeAttribute('spellcheck');
      else el.setAttribute('spellcheck', orig);
    }
  }
  function applySpellcheck(root) {
    (root || document).querySelectorAll('[contenteditable="true"], textarea, [data-margo-spell]').forEach(applySpellcheckTo);
  }
  /* Pages and cells an editor creates later pick the setting up the moment
     they are first focused. */
  document.addEventListener('focusin', (e) => {
    const el = e.target;
    if (!el || !(el.isContentEditable || el.tagName === 'TEXTAREA')) return;
    applySpellcheckTo(el.isContentEditable ? (el.closest('[contenteditable="true"]') || el) : el);
  });

  /* ---------------- theme ---------------- */
  function applyTheme(theme, persist) {
    const def = window.MargoThemes.get(theme) || window.MargoThemes.get('light');
    state.theme = def.id;
    document.documentElement.dataset.theme = def.id;
    document.documentElement.dataset.scheme = def.scheme;
    if (persist) window.margo.theme.set(def.id);
    if (els.btnSideTheme) {
      els.btnSideTheme.innerHTML = def.scheme === 'dark' ? ICONS.sun : ICONS.moon;
      els.btnSideTheme.title = def.scheme === 'dark' ? 'Switch to a light theme' : 'Switch to a dark theme';
    }
  }
  /* Quick toggle between the light and dark families: remembers the last
     theme used on each side so Paper comes back as Paper, not Light. */
  function toggleScheme() {
    const cur = window.MargoThemes.get(state.theme);
    const goingDark = !cur || cur.scheme !== 'dark';
    let target = null;
    try { target = localStorage.getItem(goingDark ? 'margo.lastDarkTheme' : 'margo.lastLightTheme'); } catch {}
    const def = window.MargoThemes.get(target);
    if (!def || (def.scheme === 'dark') !== goingDark) target = goingDark ? 'dark' : 'light';
    try { localStorage.setItem(goingDark ? 'margo.lastLightTheme' : 'margo.lastDarkTheme', state.theme); } catch {}
    applyTheme(target, true);
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
  /* Each editor gets its own markDirty/setStatus bound to its tab. They used
     to act on whichever tab was in front, so a background tab finishing its
     pagination or a PDF finishing its load stamped its status line - or its
     unsaved-changes dot - onto the document the author was looking at. */
  function markTabDirty(t) {
    if (!t) return;
    if (!t.draftId) t.draftId = newDraftId();
    const was = t.dirty;
    t.dirty = true;
    t.editedAt = Date.now();
    t.editGen = (t.editGen || 0) + 1;
    if (state.activeTabId === t.id) state.dirty = true;
    if (!was) {
      refreshHeader();
      paintTabs();
    }
    refreshSaveState(t);
    scheduleDraft(t);
  }
  function markDirty() {
    markTabDirty(findTab(state.activeTabId));
  }
  function setTabStatus(t, left, kind) {
    if (!t || !t.status) return;
    t.status.setLeft(left || '');
    if (kind !== undefined) t.status.setKind(kind || '');
  }
  function setStatus(left, kind) {
    setTabStatus(findTab(state.activeTabId), left, kind);
  }
  function timeShort(ts) {
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 45) return 'just now';
    const m = Math.round(s / 60);
    if (m < 60) return `${m} min ago`;
    return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
  /* The save indicator in the status bar: new / edited / saving / saved. */
  function refreshSaveState(t) {
    if (!t || !t.status || !t.status.setSave) return;
    if (t.saving) { t.status.setSave('saving', 'Saving…'); return; }
    if (t.saveError) { t.status.setSave('error', 'Save failed'); return; }
    if (t.dirty) {
      const auto = settings.autosave && t.doc && t.doc.path && autosaveEligible(t);
      t.status.setSave('dirty', auto ? 'Edited · autosave on' : 'Unsaved changes');
      return;
    }
    if (!t.doc || !t.doc.path) { t.status.setSave('new', 'Not saved yet'); return; }
    if (t.savedAt) {
      t.status.setSave('saved', (t.autoSaved ? 'Autosaved ' : 'Saved ') + timeShort(t.savedAt));
      return;
    }
    t.status.setSave('saved', 'Saved');
  }
  /* Word count, cell, page... whatever the editor reports through
     commands.status(); editors without one simply leave it blank. */
  function refreshStatusInfo(t) {
    if (!t || !t.status || !t.status.setInfo) return;
    const fn = t.editor && t.editor.commands && t.editor.commands.status;
    let text = '';
    if (typeof fn === 'function') {
      try {
        const r = fn();
        text = typeof r === 'string' ? r : '';
      } catch { text = ''; }
    }
    /* An editor that already puts the same line in the left slot through
       setStatus should not have it shown twice. */
    if (text && t.statusLeft && t.statusLeft.textContent.trim() === text.trim()) text = '';
    t.status.setInfo(text);
  }
  let statusInfoTimer = null;
  function scheduleStatusInfo() {
    if (statusInfoTimer) return;
    statusInfoTimer = setTimeout(() => {
      statusInfoTimer = null;
      if (state.view === 'editor') refreshStatusInfo(findTab(state.activeTabId));
    }, 120);
  }
  document.addEventListener('input', scheduleStatusInfo, true);
  document.addEventListener('selectionchange', scheduleStatusInfo);
  document.addEventListener('keyup', scheduleStatusInfo, true);
  document.addEventListener('mouseup', scheduleStatusInfo, true);
  setInterval(() => {
    if (document.visibilityState !== 'visible' || state.view !== 'editor') return;
    const t = findTab(state.activeTabId);
    refreshStatusInfo(t);
    refreshSaveState(t);
  }, 2000);

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

    const infoEl = document.createElement('span');
    infoEl.className = 'status-info hidden';

    const saveEl = document.createElement('span');
    saveEl.className = 'status-save hidden';
    saveEl.dataset.state = 'new';

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

    statusRight.appendChild(infoEl);
    statusRight.appendChild(saveEl);
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
    /* The dismiss listener used to take itself off only when it was the thing
       that closed the popup, so closing it any other way - picking a preset,
       or the tab being torn down - left it on the document holding the popup
       alive for the life of the window. */
    function closePresetPop() {
      if (!presetPop) return;
      if (presetPop.margoDismiss) {
        document.removeEventListener('mousedown', presetPop.margoDismiss, true);
      }
      presetPop.remove();
      presetPop = null;
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
      };
      pop.margoDismiss = onDoc;
      setTimeout(() => {
        if (presetPop !== pop) return;
        document.addEventListener('mousedown', onDoc, true);
      }, 0);
    });

    const api = {
      setLeft(text) { statusLeft.textContent = text || ''; },
      setKind(label) {
        kindEl.textContent = label || '';
        kindEl.classList.toggle('hidden', !label);
      },
      setInfo(text) {
        if (infoEl.textContent !== (text || '')) infoEl.textContent = text || '';
        infoEl.title = text || '';
        infoEl.classList.toggle('hidden', !text);
      },
      setSave(st, text) {
        saveEl.dataset.state = st;
        if (saveEl.textContent !== text) saveEl.textContent = text;
        saveEl.classList.remove('hidden');
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
    if (draft.kind === 'slides') return { kind: 'slides', name, path: p, deck: data.deck || null };
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
  function createPane(tabId, before) {
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
    if (before && before.parentNode === els.tabPanes) els.tabPanes.insertBefore(pane, before);
    else els.tabPanes.appendChild(pane);
    return { pane, toolbar, host, statusLeft: chrome.statusLeft, statusRight: chrome.statusRight, status: chrome.api };
  }

  /* ---- tab strip (lives in the titlebar) ---- */
  let dragTabId = null;
  function tabTitle(t) {
    const name = (t.doc && t.doc.name) || 'Untitled';
    const where = t.doc && t.doc.path ? t.doc.path : 'Not saved yet';
    return `${name}${t.dirty ? ' • unsaved changes' : ''}\n${where}`;
  }
  function paintTabs() {
    const bar = els.tabBar;
    bar.innerHTML = '';
    const has = state.tabs.length > 0;
    bar.classList.toggle('hidden', !has);
    if (els.tabNew) els.tabNew.classList.toggle('hidden', !has);
    const titlebar = document.getElementById('titlebar');
    if (titlebar) titlebar.classList.toggle('many-tabs', state.tabs.length > 3);
    state.tabs.forEach((t) => {
      const active = t.id === state.activeTabId && state.view === 'editor';
      const el = document.createElement('div');
      el.className = 'tab' + (active ? ' active' : '') + (t.dirty ? ' is-dirty' : '');
      el.dataset.tabId = String(t.id);
      el.setAttribute('role', 'tab');
      el.setAttribute('aria-selected', active ? 'true' : 'false');
      el.tabIndex = active || (!state.activeTabId && t === state.tabs[0]) ? 0 : -1;
      el.title = tabTitle(t);
      el.draggable = true;

      const kind = document.createElement('span');
      kind.className = 'tab-kind';
      if (t.doc) {
        kind.dataset.kind = t.doc.kind;
        kind.innerHTML = ICONS[KIND_ICON[t.doc.kind]] || ICONS.file;
      }

      const name = document.createElement('span');
      name.className = 'tab-name';
      name.textContent = (t.doc && t.doc.name) || 'Untitled';

      const end = document.createElement('span');
      end.className = 'tab-end';
      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'tab-close';
      close.innerHTML = ICONS.close;
      close.title = 'Close (Ctrl+W)';
      close.setAttribute('aria-label', 'Close ' + ((t.doc && t.doc.name) || 'Untitled'));
      close.tabIndex = -1;
      close.addEventListener('mousedown', (e) => e.stopPropagation());
      close.addEventListener('click', (e) => {
        e.stopPropagation();
        closeTab(t.id);
      });
      const dirty = document.createElement('span');
      dirty.className = 'doc-dirty' + (t.dirty ? '' : ' hidden');
      dirty.title = 'Unsaved changes';
      end.appendChild(close);
      end.appendChild(dirty);

      el.appendChild(kind);
      el.appendChild(name);
      el.appendChild(end);
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
      el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        tabContextMenu(t, e.clientX, e.clientY);
      });
      el.addEventListener('keydown', (e) => {
        const i = state.tabs.indexOf(t);
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
          e.preventDefault();
          const next = state.tabs[(i + (e.key === 'ArrowRight' ? 1 : -1) + state.tabs.length) % state.tabs.length];
          const nextEl = bar.querySelector(`.tab[data-tab-id="${next.id}"]`);
          if (nextEl) nextEl.focus();
        } else if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          activateTab(t.id);
        } else if (e.key === 'Delete') {
          e.preventDefault();
          closeTab(t.id);
        } else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
          e.preventDefault();
          const r = el.getBoundingClientRect();
          tabContextMenu(t, r.left + 8, r.bottom);
        }
      });
      /* drag to reorder */
      el.addEventListener('dragstart', (e) => {
        dragTabId = t.id;
        el.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        try { e.dataTransfer.setData('application/x-margo-tab', String(t.id)); } catch {}
      });
      el.addEventListener('dragend', () => {
        dragTabId = null;
        bar.querySelectorAll('.tab').forEach((x) => x.classList.remove('dragging', 'drop-before', 'drop-after'));
      });
      el.addEventListener('dragover', (e) => {
        if (dragTabId == null || dragTabId === t.id) return;
        e.preventDefault();
        e.stopPropagation();
        const r = el.getBoundingClientRect();
        const after = e.clientX > r.left + r.width / 2;
        el.classList.toggle('drop-after', after);
        el.classList.toggle('drop-before', !after);
      });
      el.addEventListener('dragleave', () => el.classList.remove('drop-before', 'drop-after'));
      el.addEventListener('drop', (e) => {
        if (dragTabId == null) return;
        e.preventDefault();
        e.stopPropagation();
        const moving = findTab(dragTabId);
        dragTabId = null;
        if (!moving || moving === t) return;
        const r = el.getBoundingClientRect();
        const after = e.clientX > r.left + r.width / 2;
        state.tabs.splice(state.tabs.indexOf(moving), 1);
        const at = state.tabs.indexOf(t) + (after ? 1 : 0);
        state.tabs.splice(at, 0, moving);
        paintTabs();
        persistSession();
      });
      bar.appendChild(el);
    });
    const activeEl = bar.querySelector('.tab.active');
    if (activeEl) activeEl.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  function tabContextMenu(t, x, y) {
    const i = state.tabs.indexOf(t);
    const hasPath = !!(t.doc && t.doc.path);
    const pinned = hasPath && isPinned(t.doc.path);
    window.MargoMenubar.contextMenu(x, y, [
      { label: 'Close', accel: 'Ctrl+W', icon: ICONS.close, action: () => closeTab(t.id) },
      { label: 'Close others', enabled: state.tabs.length > 1, action: () => closeOtherTabs(t.id) },
      { label: 'Close tabs to the right', enabled: i < state.tabs.length - 1, action: () => closeTabsToRight(t.id) },
      { sep: true },
      { label: 'Save', accel: 'Ctrl+S', icon: ICONS.save, action: async () => { await activateTab(t.id); await saveDoc(false); } },
      { label: 'Reload from disk', icon: ICONS.refresh, enabled: hasPath, action: () => reloadTabFromDisk(t, true) },
      { sep: true },
      { label: pinned ? 'Unpin from library' : 'Pin to library', icon: pinned ? ICONS.starFilled : ICONS.star, enabled: hasPath,
        action: () => togglePin(t.doc.path, t.doc.name) },
      { label: 'Copy file path', icon: ICONS.copyPath, enabled: hasPath, action: () => copyText(t.doc.path, 'Path copied') }
    ]);
  }

  async function copyText(text, done) {
    try {
      await navigator.clipboard.writeText(text);
      toast(done || 'Copied', 'success');
    } catch {
      toast('Could not copy to the clipboard', 'error');
    }
  }

  async function activateTab(id) {
    const t = findTab(id);
    if (!t) return;
    if (state.activeTabId === id && state.view === 'editor') return;
    if (state.activeTabId && state.activeTabId !== id) syncActiveTab();
    applyTabAliases(t);
    state.lastActiveTabId = id;
    state.view = 'editor';
    document.body.classList.remove('margo-focus-mode');
    els.home.classList.add('hidden');
    els.editorView.classList.remove('hidden');
    applyViewMode();
    state.tabs.forEach((x) => { x.pane.hidden = x.id !== t.id; });
    paintTabs();
    refreshHeader();
    refreshSaveState(t);
    refreshStatusInfo(t);
    persistSession();
    if (t.editor && typeof t.editor.focus === 'function') {
      try { t.editor.focus(); } catch {}
    }
  }

  /* The context an editor is built with. Everything in it is bound to the
     editor's own tab, whether or not that tab is in front. */
  function buildCtx(tab) {
    const id = tab.id;
    return {
      markDirty: () => markTabDirty(tab),
      setStatus: (left, kind) => setTabStatus(tab, left, kind),
      status: tab.status,
      toolbar: tab.toolbar,
      inputModal,
      confirmModal,
      openModal,
      closeModal,
      toast,
      icons: ICONS,
      contextMenu: (x, y, items) => window.MargoMenubar.contextMenu(x, y, items),
      settings: () => ({ ...settings }),
      /* An editor that listens on the document rather than on its own pane
         hears every key in the window, including keys meant for whichever
         tab is in front. isActive lets it tell the difference; nothing else
         can, because a background tab's pane is hidden but its editor is
         still very much alive. */
      isActive: () => state.activeTabId === id && state.view === 'editor'
    };
  }
  async function mountEditor(tab, doc) {
    const factory = window.MargoEditors[doc.kind];
    if (!factory) throw new Error('Unknown document type');
    const editor = factory(buildCtx(tab));
    tab.editor = editor;
    if (state.activeTabId === tab.id) state.editor = editor;
    await Promise.resolve(editor.mount(tab.host, doc));
  }
  function discardTabChrome(tab) {
    if (tab.editor && typeof tab.editor.destroy === 'function') {
      try { tab.editor.destroy(); } catch {}
    }
    if (tab.status && typeof tab.status.destroy === 'function') {
      try { tab.status.destroy(); } catch {}
    }
    try { tab.pane.remove(); } catch {}
  }

  async function openInTab(doc, opts) {
    if (doc.path && !(opts && opts.draftId)) {
      const existing = findTabByPath(doc.path);
      if (existing) {
        await activateTab(existing.id);
        return existing;
      }
    }
    if (state.tabs.length >= MAX_TABS) {
      toast(`Close a tab first — Margo keeps up to ${MAX_TABS} documents open.`);
      return null;
    }
    if (!window.MargoEditors[doc.kind]) throw new Error('Unknown document type');
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
      status: chrome.status,
      savedAt: doc.path && !(opts && opts.dirty) ? Date.now() : null
    };
    const previous = state.activeTabId;
    state.tabs.push(tab);
    await activateTab(id);
    try {
      await mountEditor(tab, doc);
    } catch (err) {
      /* A document that fails to mount used to leave the editor view up with
         nothing in it - no tab, no pane, no way back but the Home button. */
      state.tabs = state.tabs.filter((x) => x.id !== id);
      discardTabChrome(tab);
      if (state.activeTabId === id) {
        clearAliases();
        const back = findTab(previous) || state.tabs[state.tabs.length - 1];
        if (back) await activateTab(back.id);
        else showLanding();
      }
      paintTabs();
      throw err;
    }
    if (tab.dirty) {
      if (state.activeTabId === id) state.dirty = true;
      if (!tab.draftId) tab.draftId = newDraftId();
    }
    if (doc.path && opts && opts.draftId && window.margo.watchFile) {
      try { window.margo.watchFile(doc.path); } catch {}
    }
    applySpellcheck(tab.pane);
    refreshHeader();
    paintTabs();
    refreshSaveState(tab);
    refreshStatusInfo(tab);
    persistSession();
    scheduleThumb();
    return tab;
  }
  const mountDoc = (doc) => openInTab(doc);

  function rememberClosed(t) {
    const p = t && t.doc && t.doc.path;
    if (!p) return;
    const key = pathKey(p);
    state.closedPaths = state.closedPaths.filter((x) => pathKey(x) !== key);
    state.closedPaths.push(p);
    if (state.closedPaths.length > 12) state.closedPaths.shift();
  }
  async function reopenClosedTab() {
    while (state.closedPaths.length) {
      const p = state.closedPaths.pop();
      if (findTabByPath(p)) continue;
      await openFromPath(p);
      return;
    }
    toast('No recently closed documents');
  }

  async function closeTab(id, opts) {
    syncActiveTab();
    const t = findTab(id);
    if (!t || t.closing) return false;
    t.closing = true;
    try {
      if (t.dirty && !(opts && opts.discard)) {
        await activateTab(t.id);
        if (!(await resolveDirty())) return false;
      }
      await clearDraft(t);
      if (!state.tabs.includes(t)) return true;
      const idx = state.tabs.indexOf(t);
      const wasActive = state.activeTabId === id;
      discardTabChrome(t);
      rememberClosed(t);
      if (t.doc && t.doc.path && window.margo.unwatchFile && !findOtherTabByPath(t)) {
        try { window.margo.unwatchFile(t.doc.path); } catch {}
      }
      state.tabs.splice(idx, 1);
      if (state.lastActiveTabId === id) state.lastActiveTabId = null;
      if (wasActive) clearAliases();
      persistSession();
      if (!state.tabs.length) {
        showLanding();
        return true;
      }
      if (wasActive) {
        const neighbor = state.tabs[Math.max(0, idx - 1)];
        await activateTab(neighbor.id);
      } else {
        paintTabs();
        refreshHeader();
      }
      return true;
    } finally {
      t.closing = false;
    }
  }
  function findOtherTabByPath(t) {
    const key = pathKey(t.doc && t.doc.path);
    return state.tabs.find((x) => x !== t && x.doc && pathKey(x.doc.path) === key) || null;
  }
  function closeActiveTab() {
    if (state.view === 'editor' && state.activeTabId) return closeTab(state.activeTabId);
  }
  async function closeOtherTabs(keepId) {
    for (const t of [...state.tabs]) {
      if (t.id === keepId) continue;
      if (!(await closeTab(t.id))) return;
    }
    const keep = findTab(keepId);
    if (keep) activateTab(keep.id);
  }
  async function closeTabsToRight(id) {
    const i = state.tabs.findIndex((t) => t.id === id);
    if (i < 0) return;
    for (const t of state.tabs.slice(i + 1)) {
      if (!(await closeTab(t.id))) return;
    }
  }
  async function closeAllTabs() {
    for (const t of [...state.tabs]) {
      if (!(await closeTab(t.id))) return false;
    }
    return true;
  }
  function cycleTabs(dir) {
    if (!state.tabs.length) return;
    /* From the home screen, Ctrl+Tab goes back to the document that was in
       front - it used to count from the first tab and skip it. */
    if (state.view !== 'editor' || !state.activeTabId) {
      const back = findTab(state.lastActiveTabId) || state.tabs[0];
      activateTab(back.id);
      return;
    }
    const i = state.tabs.findIndex((t) => t.id === state.activeTabId);
    const start = i < 0 ? 0 : i;
    const next = (start + dir + state.tabs.length) % state.tabs.length;
    activateTab(state.tabs[next].id);
  }
  function activateTabAt(n) {
    const t = n === 9 ? state.tabs[state.tabs.length - 1] : state.tabs[n - 1];
    if (t) activateTab(t.id);
  }
  function resetSession() {
    for (const t of [...state.tabs]) {
      cancelDraftTimer(t);
      discardTabChrome(t);
    }
    state.tabs = [];
    state.lastActiveTabId = null;
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

  /* Swaps a tab's document for a fresh copy read from disk, in place: same
     tab, same position, new editor. */
  async function reloadTabFromDisk(t, ask) {
    if (!t || !t.doc || !t.doc.path) return false;
    if (ask && t.dirty) {
      const ok = await confirmModal('Reload from disk?',
        `Discard your unsaved changes to ${t.doc.name} and load the version on disk?`, { confirmLabel: 'Reload' });
      if (!ok) return false;
    }
    const res = await window.margo.openPath(t.doc.path);
    if (!res || !res.ok) {
      toast((res && res.error) || 'Could not reload the file', 'error');
      return false;
    }
    const wasActive = state.activeTabId === t.id;
    cancelDraftTimer(t);
    await clearDraft(t);
    const nextSibling = t.pane.nextSibling;
    discardTabChrome(t);
    const chrome = createPane(t.id, nextSibling);
    Object.assign(t, {
      doc: res.doc,
      dirty: false,
      editor: null,
      pane: chrome.pane,
      toolbar: chrome.toolbar,
      host: chrome.host,
      statusLeft: chrome.statusLeft,
      statusRight: chrome.statusRight,
      status: chrome.status,
      savedAt: Date.now(),
      autoSaved: false,
      saveError: false
    });
    if (wasActive) {
      applyTabAliases(t);
      chrome.pane.hidden = state.view !== 'editor';
    }
    try {
      await mountEditor(t, res.doc);
    } catch (err) {
      toast((err && err.message) || 'Could not reload the file', 'error');
    }
    if (wasActive) state.dirty = false;
    applySpellcheck(t.pane);
    paintTabs();
    refreshHeader();
    refreshSaveState(t);
    refreshStatusInfo(t);
    return true;
  }

  function applyViewMode() {
    const onHome = state.view === 'home';
    els.shell.classList.toggle('view-home', onHome);
    if (onHome) closeSidebar(true);
    // Every view change goes through here, so this is where the thumbnail
    // work that was too heavy for the library view gets picked back up.
    else resumeThumbBackfill();
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
    paintGreeting();
    loadRecents();
  }

  function blankDoc(kind) {
    if (kind === 'md') return { kind: 'md', name: 'Untitled.md', path: null, markdown: '' };
    if (kind === 'doc') return { kind: 'doc', name: 'Untitled.docx', path: null, html: '<p></p>', notes: [] };
    if (kind === 'sheet') return { kind: 'sheet', name: 'Untitled.xlsx', path: null, sheets: [{ name: 'Sheet1', rows: [] }], active: 0 };
    const factory = window.MargoEditors && window.MargoEditors[kind];
    if (factory && typeof factory.blankDoc === 'function') return factory.blankDoc();
    if (kind === 'slides' && factory) return { kind: 'slides', name: 'Untitled.pptx', path: null, deck: null };
    return null;
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
    const doc = blankDoc(kind);
    if (!doc) {
      toast('Margo cannot create that kind of document here.', 'error');
      return;
    }
    return openInTab(doc);
  }

  /* ---------------- templates ----------------
     Real starting documents, each built for the editor it opens in. */
  function longDate() {
    return new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
  }
  const P = (w, cls) => `<span class="tpl-l${cls ? ' ' + cls : ''}" style="width:${w}%"></span>`;
  const H = (w, cls) => `<span class="tpl-h${cls ? ' ' + cls : ''}" style="width:${w}%"></span>`;
  const GAP = '<span class="tpl-gap"></span>';
  const TEMPLATES = [
    {
      id: 'letter',
      label: 'Letter',
      kind: 'doc',
      meta: 'Word document',
      icon: 'letter',
      preview: () =>
        `<div class="tpl-page">${P(34, 'soft')}${P(28, 'soft')}${P(30, 'soft')}${GAP}${P(26)}${GAP}${P(40)}${GAP}${P(92)}${P(88)}${P(95)}${P(60)}${GAP}${P(90)}${P(84)}</div>`,
      build: () => ({
        kind: 'doc',
        name: 'Letter.docx',
        path: null,
        notes: [],
        html: [
          '<p style="text-align: right;"><strong>Your Name</strong><br>123 Main Street<br>City, State 00000<br>you@example.com · (555) 010-0000</p>',
          `<p>${escapeHtml(longDate())}</p>`,
          '<p>Recipient Name<br>Title<br>Company<br>Street address<br>City, State 00000</p>',
          '<p>Dear Recipient Name,</p>',
          '<p>I am writing to let you know about… Start with a sentence that says why you are writing, so the reader knows what the letter is about from the first line.</p>',
          '<p>Use the middle paragraphs for the details: what happened, what you are asking for, and any dates or numbers the reader will need. Keep each paragraph to one idea.</p>',
          '<p>Close by saying what you would like to happen next and how the reader can reach you. Thank you for your time and consideration.</p>',
          '<p>Sincerely,</p>',
          '<p><br></p>',
          '<p>Your Name</p>'
        ].join('')
      })
    },
    {
      id: 'resume',
      label: 'Resume',
      kind: 'doc',
      meta: 'Word document',
      icon: 'resume',
      preview: () =>
        `<div class="tpl-page"><div class="tpl-row"><span class="tpl-avatar"></span><span style="flex:1;display:flex;flex-direction:column;gap:4px">${H(70)}${P(50, 'soft')}</span></div>${GAP}${H(34, 'sm tpl-accent')}${P(94)}${P(80)}${GAP}${H(40, 'sm tpl-accent')}${P(60)}${P(90)}${P(86)}${GAP}${H(30, 'sm tpl-accent')}${P(70)}</div>`,
      build: () => ({
        kind: 'doc',
        name: 'Resume.docx',
        path: null,
        notes: [],
        html: [
          '<h1>Your Name</h1>',
          '<p>City, State · you@example.com · (555) 010-0000 · linkedin.com/in/yourname</p>',
          '<h2>Summary</h2>',
          '<p>Two or three sentences on who you are, what you are good at and the kind of work you are looking for.</p>',
          '<h2>Experience</h2>',
          '<h3>Job Title — Company Name</h3>',
          '<p><em>Month 20XX – Present · City, State</em></p>',
          '<ul><li>Led a project that achieved a measurable result (numbers help).</li><li>Improved a process, saving time or money for the team.</li><li>Worked with people across teams to ship something that mattered.</li></ul>',
          '<h3>Previous Job Title — Company Name</h3>',
          '<p><em>Month 20XX – Month 20XX · City, State</em></p>',
          '<ul><li>An accomplishment written as an action and its result.</li><li>Another accomplishment, most relevant ones first.</li></ul>',
          '<h2>Education</h2>',
          '<p><strong>Degree, Field of Study</strong> — University Name, 20XX</p>',
          '<h2>Skills</h2>',
          '<ul><li>Skill one · Skill two · Skill three</li><li>Tools and languages you know well</li></ul>'
        ].join('')
      })
    },
    {
      id: 'meeting',
      label: 'Meeting notes',
      kind: 'doc',
      meta: 'Word document',
      icon: 'meeting',
      preview: () =>
        `<div class="tpl-page">${H(64)}${P(40, 'soft')}${GAP}${H(26, 'sm')}<div class="tpl-row"><span class="tpl-dot"></span>${P(70)}</div><div class="tpl-row"><span class="tpl-dot"></span>${P(60)}</div>${GAP}${H(30, 'sm')}<div class="tpl-row"><span class="tpl-box"></span>${P(60)}</div><div class="tpl-row"><span class="tpl-box"></span>${P(72)}</div></div>`,
      build: () => ({
        kind: 'doc',
        name: 'Meeting notes.docx',
        path: null,
        notes: [],
        html: [
          '<h1>Meeting notes</h1>',
          `<p><strong>Date:</strong> ${escapeHtml(longDate())}<br><strong>Time:</strong> 10:00 – 10:30<br><strong>Location:</strong> Room / video link<br><strong>Attendees:</strong> Name, Name, Name</p>`,
          '<h2>Agenda</h2>',
          '<ol><li>Updates since last meeting</li><li>Main topic for discussion</li><li>Next steps</li></ol>',
          '<h2>Notes</h2>',
          '<ul><li>Key point that was raised.</li><li>Questions and answers worth remembering.</li></ul>',
          '<h2>Decisions</h2>',
          '<ul><li>What was agreed, and why.</li></ul>',
          '<h2>Action items</h2>',
          '<table style="width: 100%; border-collapse: collapse;"><tbody>',
          '<tr><th style="border: 1px solid #c8c8c8; padding: 6px; text-align: left;">Task</th><th style="border: 1px solid #c8c8c8; padding: 6px; text-align: left;">Owner</th><th style="border: 1px solid #c8c8c8; padding: 6px; text-align: left;">Due</th></tr>',
          '<tr><td style="border: 1px solid #c8c8c8; padding: 6px;">Send the summary to everyone</td><td style="border: 1px solid #c8c8c8; padding: 6px;">Name</td><td style="border: 1px solid #c8c8c8; padding: 6px;">Friday</td></tr>',
          '<tr><td style="border: 1px solid #c8c8c8; padding: 6px;">Follow up on open questions</td><td style="border: 1px solid #c8c8c8; padding: 6px;">Name</td><td style="border: 1px solid #c8c8c8; padding: 6px;">Next meeting</td></tr>',
          '</tbody></table>',
          '<p><br></p>'
        ].join('')
      })
    },
    {
      id: 'budget',
      label: 'Budget',
      kind: 'sheet',
      meta: 'Spreadsheet',
      icon: 'budget',
      preview: () => {
        const cells = [];
        cells.push('<span class="head"></span><span class="head"></span><span class="head"></span>');
        for (let i = 0; i < 7; i++) cells.push('<span></span><span></span><span></span>');
        cells.push('<span class="total"></span><span class="total"></span><span class="total"></span>');
        return `<div class="tpl-page">${H(52)}${GAP}<div class="tpl-grid">${cells.join('')}</div></div>`;
      },
      build: () => {
        const cats = [
          ['Rent / mortgage', 1200, 1200], ['Utilities', 180, 164], ['Groceries', 450, 482],
          ['Transport', 160, 140], ['Insurance', 120, 120], ['Eating out', 150, 188],
          ['Entertainment', 80, 65], ['Savings', 400, 400], ['Other', 100, 72]
        ];
        const rows = [
          ['Monthly budget', '', '', ''],
          ['', '', '', ''],
          ['Category', 'Planned', 'Actual', 'Difference']
        ];
        const first = rows.length + 1; // 1-based row of the first category
        cats.forEach(([name, plan, actual], i) => {
          const r = first + i;
          rows.push([name, String(plan), String(actual), `=B${r}-C${r}`]);
        });
        const last = first + cats.length - 1;
        const totalRow = last + 1;
        rows.push(['Total', `=SUM(B${first}:B${last})`, `=SUM(C${first}:C${last})`, `=SUM(D${first}:D${last})`]);
        rows.push(['', '', '', '']);
        const incomeRow = totalRow + 2;
        rows.push(['Income', '3200', '', '']);
        rows.push(['Left over', `=B${incomeRow}-C${totalRow}`, '', '']);
        const styles = {};
        styles['0,0'] = { bold: true, size: 16 };
        for (let c = 0; c < 4; c++) {
          styles[`2,${c}`] = { bold: true, fill: '#d9ead3', align: c ? 'right' : 'left' };
          styles[`${totalRow - 1},${c}`] = { bold: true, fill: '#f3f3f3', format: c ? 'currency' : undefined };
        }
        for (let r = first - 1; r < last; r++) {
          for (let c = 1; c < 4; c++) styles[`${r},${c}`] = { format: 'currency' };
        }
        styles[`${incomeRow - 1},0`] = { bold: true };
        styles[`${incomeRow - 1},1`] = { format: 'currency' };
        styles[`${incomeRow},0`] = { bold: true };
        styles[`${incomeRow},1`] = { bold: true, format: 'currency', fill: '#fff2cc' };
        Object.keys(styles).forEach((k) => {
          Object.keys(styles[k]).forEach((p) => { if (styles[k][p] === undefined) delete styles[k][p]; });
        });
        return {
          kind: 'sheet',
          name: 'Budget.xlsx',
          path: null,
          active: 0,
          sheets: [{ name: 'Budget', rows, styles, colWidths: { 0: 180, 1: 110, 2: 110, 3: 110 }, rowHeights: {}, charts: [] }]
        };
      }
    },
    {
      id: 'todo',
      label: 'To-do list',
      kind: 'md',
      meta: 'Markdown note',
      icon: 'todo',
      preview: () =>
        `<div class="tpl-page">${H(46)}${GAP}<div class="tpl-row"><span class="tpl-box done"></span>${P(58)}</div><div class="tpl-row"><span class="tpl-box"></span>${P(76)}</div><div class="tpl-row"><span class="tpl-box"></span>${P(64)}</div>${GAP}${H(30, 'sm')}<div class="tpl-row"><span class="tpl-box"></span>${P(70)}</div><div class="tpl-row"><span class="tpl-box"></span>${P(52)}</div></div>`,
      build: () => ({
        kind: 'md',
        name: 'To-do list.md',
        path: null,
        markdown: [
          '# To-do list',
          '',
          `_${longDate()}_`,
          '',
          '## Today',
          '',
          '- [x] Write the list',
          '- [ ] Reply to the messages that need an answer',
          '- [ ] Finish the most important task first',
          '',
          '## This week',
          '',
          '- [ ] Plan next week',
          '- [ ] Book the appointment',
          '',
          '## Someday',
          '',
          '- [ ] Something worth doing when there is time',
          ''
        ].join('\n')
      })
    }
  ];
  async function newFromTemplate(id) {
    const tpl = TEMPLATES.find((t) => t.id === id);
    if (!tpl) return null;
    if (!kindAvailable(tpl.kind)) {
      toast('That template needs an editor this build does not include.', 'error');
      return null;
    }
    const tab = await openInTab(tpl.build());
    closeSidebar(true);
    return tab;
  }

  /* ---------------- thumbnails ---------------- */
  let thumbTimer = null;
  async function refreshLibraryThumbFor(doc, data) {
    if (!doc || !doc.path || doc.kind === 'md') return;
    try {
      const url = await window.MargoThumbs.generate(doc, data);
      if (url) applyThumbToLibrary(doc.path, url);
    } catch {}
  }
  async function refreshLibraryThumb(data) {
    return refreshLibraryThumbFor(state.doc, data);
  }
  /* Bound to the tab that asked: the timer used to read whichever document
     was in front when it fired, which after a quick tab switch was another
     file's contents under this file's thumbnail. */
  function scheduleThumb() {
    clearTimeout(thumbTimer);
    const t = findTab(state.activeTabId);
    if (!t || !t.doc || !t.doc.path || t.doc.kind === 'md') return;
    thumbTimer = setTimeout(async () => {
      if (!state.tabs.includes(t) || !t.editor) return;
      try {
        const data = t.doc.kind !== 'pdf' ? await Promise.resolve(t.editor.getData()) : null;
        await refreshLibraryThumbFor(t.doc, data);
      } catch {}
    }, 350);
  }

  /* ---------------- open / save ---------------- */
  const OPENABLE_EXTS = ['md', 'markdown', 'txt', 'docx', 'xlsx', 'csv', 'pdf'];
  function extOf(p) {
    const m = /\.([^.\\/]+)$/.exec(String(p || ''));
    return m ? m[1].toLowerCase() : '';
  }
  async function openFromPath(p) {
    const existing = findTabByPath(p);
    if (existing) {
      await activateTab(existing.id);
      closeSidebar(true);
      return existing;
    }
    const res = await window.margo.openPath(p);
    if (!res || !res.ok) {
      toast((res && res.error) || 'Could not open file', 'error');
      window.margo.recents.remove(p);
      loadRecents();
      return null;
    }
    let tab = null;
    try {
      tab = await openInTab(res.doc);
    } catch (err) {
      toast((err && err.message) || 'Could not open file', 'error');
      return null;
    }
    closeSidebar(true);
    return tab;
  }

  async function newDocGuarded(kind) {
    await newDoc(kind);
    closeSidebar(true);
  }

  /* ---------------- export as PDF ---------------- */
  /* Page setup for exports of documents that have none of their own (a
     Markdown note, a spreadsheet). Word documents and presentations bring
     their page size with them, so they skip this step. Remembers the last
     choice. */
  const PDF_PAGE_KEY = 'margo.pdfPage';
  async function askPdfPageOptions() {
    let last = {};
    try { last = JSON.parse(localStorage.getItem(PDF_PAGE_KEY) || '{}') || {}; } catch {}
    const lang = (navigator.language || '').toLowerCase();
    const localSize = /^(en-us|en-ca|es-mx|fil|en-ph)/.test(lang) ? 'Letter' : 'A4';
    const choice = {
      size: ['A4', 'Letter', 'Legal', 'A3', 'A5', 'Tabloid'].includes(last.size) ? last.size : localSize,
      landscape: !!last.landscape,
      margins: ['normal', 'narrow', 'moderate', 'wide', 'none'].includes(last.margins) ? last.margins : 'normal'
    };
    const body = document.createElement('div');
    body.className = 'settings-page pdf-page-options';
    body.appendChild(settingsRow('Paper size', null,
      selectControl([['A4', 'A4 (210 × 297 mm)'], ['Letter', 'Letter (8.5 × 11 in)'], ['Legal', 'Legal (8.5 × 14 in)'], ['A3', 'A3'], ['A5', 'A5'], ['Tabloid', 'Tabloid']],
        choice.size, 'Paper size', (v) => { choice.size = v; })));
    body.appendChild(settingsRow('Orientation', null,
      segmentedControl([['portrait', 'Portrait'], ['landscape', 'Landscape']], choice.landscape ? 'landscape' : 'portrait', 'Orientation',
        (v) => { choice.landscape = v === 'landscape'; })));
    body.appendChild(settingsRow('Margins', null,
      selectControl([['normal', 'Normal'], ['narrow', 'Narrow'], ['moderate', 'Moderate'], ['wide', 'Wide'], ['none', 'None']],
        choice.margins, 'Margins', (v) => { choice.margins = v; })));
    const go = await openModal('Export as PDF', body, [
      { label: 'Cancel', value: null },
      { label: 'Export…', primary: true, value: 'go' }
    ]);
    if (go !== 'go') return null;
    try { localStorage.setItem(PDF_PAGE_KEY, JSON.stringify(choice)); } catch {}
    return choice;
  }

  async function exportPdf(explicitPath) {
    if (!state.doc || !state.editor) return false;
    if (state.doc.kind === 'pdf') { toast('This is already a PDF — use Save As'); return false; }
    const doc = state.doc;
    const editor = state.editor;
    let page;
    if (!explicitPath && (doc.kind === 'md' || doc.kind === 'sheet')) {
      page = await askPdfPageOptions();
      if (!page) return false;
    }
    const data = await Promise.resolve(editor.getData());
    const res = await window.margo.exportPdf({
      kind: doc.kind,
      data,
      suggestedName: doc.name,
      currentPath: doc.path,
      path: explicitPath || undefined,
      page
    });
    if (res.canceled) return false;
    if (!res.ok) { toast(res.error || 'Export failed', 'error'); return false; }
    toast(`Exported to ${res.path.split(/[\\/]/).pop()}`, 'success');
    loadRecents();
    return true;
  }

  async function printDoc() {
    if (!state.doc || !state.editor) return false;
    /* An editor that prints for itself (the PDF editor sends its current
       bytes, unsaved edits included, rather than the file on disk). */
    if (state.editor.commands && typeof state.editor.commands.print === 'function') {
      return !!(await state.editor.commands.print());
    }
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
    if (kind === 'slides') return ext === 'pptx';
    return ext === 'xlsx' || ext === 'csv';
  };

  async function afterLocalSave(toPath, fileName, fromPath, quiet) {
    try {
      const drive = await window.margo.google.push({
        path: toPath,
        name: fileName,
        fromPath: fromPath || toPath
      });
      noteGoogleSignedOut(drive);
      if (quiet) return;
      if (drive && drive.pushed) {
        toast('Saved locally and on Drive', 'success');
        return;
      }
      toast('Saved', 'success');
      if (drive && drive.ok === false) toast(drive.error || 'Could not update Drive', 'error');
    } catch {
      if (!quiet) toast('Saved', 'success');
    }
  }

  /* Marks a tab clean after a save - unless it was edited while the save was
     in flight. The snapshot written to disk predates those edits, and
     clearing the flag anyway (which is what happened) let the next close
     throw them away without asking. */
  async function finishSaved(t, data, gen, auto) {
    const clean = (t.editGen || 0) === gen;
    if (clean) {
      t.dirty = false;
      if (state.activeTabId === t.id) state.dirty = false;
    }
    if (t.editor && t.editor.onSaved) {
      try { await Promise.resolve(t.editor.onSaved(data)); } catch {}
    }
    t.savedAt = Date.now();
    t.autoSaved = !!auto;
    t.saveError = false;
    if (clean) await clearDraft(t);
    paintTabs();
    refreshHeader();
    refreshSaveState(t);
    return clean;
  }

  /* Saves one tab, in front or not. opts: { forceDialog, auto }.
     A second save of the same tab while one is running joins it instead of
     racing it to the disk (Ctrl+S twice used to open two Save As dialogs). */
  async function saveTab(t, opts) {
    const o = opts || {};
    if (!t || !t.doc || !t.editor) return false;
    if (state.activeTabId === t.id) syncActiveTab();
    if (t.saving) return t.saving;
    const run = (async () => {
      const doc = t.doc;
      const gen = t.editGen || 0;
      const data = await Promise.resolve(t.editor.getData());
      const { kind, path, name } = doc;
      let thumbDataUrl = null;
      if (kind === 'doc' || kind === 'md') {
        try { thumbDataUrl = await window.MargoThumbs.jpegForDoc(doc, data); } catch {}
      }

      if (!o.forceDialog && path) {
        const res = await window.margo.save({ kind, path, data, thumbDataUrl });
        if (!res || !res.ok) {
          t.saveError = true;
          toast(((res && res.error) || 'Save failed') + (o.auto ? ' (autosave)' : ''), 'error');
          return false;
        }
        t.orphaned = false;
        await finishSaved(t, data, gen, !!o.auto);
        await afterLocalSave(path, name, path, !!o.auto);
        await refreshLibraryThumbFor(doc, data);
        return true;
      }
      if (o.auto) return false;

      const res = await window.margo.saveAs({ kind, data, suggestedName: name, currentPath: path, thumbDataUrl });
      if (res.canceled) return false;
      if (!res.ok) { toast(res.error || 'Save failed', 'error'); return false; }

      const ext = res.path.split('.').pop();
      if (sameKindExt(kind, ext)) {
        const fromPath = path;
        doc.path = res.path;
        doc.name = res.path.split(/[\\/]/).pop();
        await finishSaved(t, data, gen, false);
        persistSession();
        await afterLocalSave(res.path, doc.name, fromPath);
        await refreshLibraryThumbFor(doc, data);
      } else {
        // cross-format export: file written, but the open buffer keeps its own format
        toast(`Exported to ${res.path.split(/[\\/]/).pop()} — still editing the ${(KIND_LABEL[kind] || 'document').toLowerCase()}`);
        loadRecents();
      }
      if (kind === 'sheet' && ext === 'csv' && (data.sheets || []).length > 1) {
        toast('CSV contains the active sheet only');
      }
      return true;
    })();
    t.saving = run;
    refreshSaveState(t);
    try {
      return await run;
    } catch (err) {
      toast((err && err.message) || 'Save failed', 'error');
      return false;
    } finally {
      t.saving = null;
      refreshSaveState(t);
    }
  }
  async function saveDoc(forceDialog) {
    return saveTab(findTab(state.activeTabId), { forceDialog: !!forceDialog });
  }
  async function saveAllTabs() {
    syncActiveTab();
    let n = 0;
    for (const t of [...state.tabs]) {
      if (!t.dirty) continue;
      if (!t.doc.path) await activateTab(t.id);
      if (await saveTab(t)) n += 1;
      else if (!t.doc.path) break;
    }
    if (!n) toast('Nothing to save');
  }

  /* ---------------- autosave ----------------
     Only documents that already live in a file, and never PDFs (saving one
     flattens its signatures and stamps into the page) or CSVs (a CSV holds
     one sheet, so a background save could drop the others). */
  let autosaveTimer = null;
  function autosaveEligible(t) {
    if (!t || !t.doc || !t.doc.path) return false;
    /* A file deleted on disk is not quietly recreated in the background. */
    if (t.orphaned) return false;
    if (t.doc.kind === 'pdf') return false;
    const ext = extOf(t.doc.path);
    if (ext === 'csv') return false;
    return sameKindExt(t.doc.kind, ext);
  }
  function restartAutosave() {
    clearInterval(autosaveTimer);
    autosaveTimer = null;
    if (!settings.autosave) return;
    autosaveTimer = setInterval(runAutosave, settings.autosaveSec * 1000);
  }
  async function runAutosave() {
    if (!settings.autosave) return 0;
    syncActiveTab();
    let saved = 0;
    for (const t of [...state.tabs]) {
      if (!t.dirty || t.saving || t.closing || !autosaveEligible(t)) continue;
      if (await saveTab(t, { auto: true })) saved += 1;
    }
    return saved;
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
    md: 'MD', markdown: 'MD', txt: 'TXT', docx: 'DOCX', xlsx: 'XLSX', csv: 'CSV', html: 'HTM', pdf: 'PDF', pptx: 'PPTX'
  };
  const EXT_ICON = {
    md: 'md', markdown: 'md', txt: 'md',
    docx: 'doc',
    xlsx: 'sheet', csv: 'sheet',
    pdf: 'pdf',
    pptx: 'slides'
  };
  const THUMB_EXTS = new Set(['docx', 'pdf', 'xlsx', 'csv', 'pptx']);
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

  const thumbBlobUrls = new Map();
  function bytesToThumbBlob(payload) {
    if (!payload) return null;
    if (typeof payload === 'string') {
      if (payload.startsWith('blob:')) return null;
      const m = /^data:([^;]+);base64,(.+)$/i.exec(payload);
      if (!m) return null;
      const bin = atob(m[2]);
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      return new Blob([arr], { type: m[1] || 'image/png' });
    }
    if (payload instanceof Blob) return payload;
    if (payload instanceof ArrayBuffer) return new Blob([payload], { type: 'image/png' });
    if (ArrayBuffer.isView(payload)) return new Blob([payload], { type: 'image/png' });
    if (payload.type === 'Buffer' && Array.isArray(payload.data)) {
      return new Blob([new Uint8Array(payload.data)], { type: 'image/png' });
    }
    return null;
  }
  function cacheThumbUrl(filePath, payload) {
    const key = String(filePath).toLowerCase();
    const blob = bytesToThumbBlob(payload);
    if (!blob) return thumbBlobUrls.get(key) || null;
    const prev = thumbBlobUrls.get(key);
    if (prev) URL.revokeObjectURL(prev);
    const url = URL.createObjectURL(blob);
    thumbBlobUrls.set(key, url);
    return url;
  }
  function paintCoverImage(cover, src, isTypeIcon) {
    cover.classList.toggle('recent-thumb-type', !!isTypeIcon);
    cover.classList.toggle('home-tile-cover-type', !!(isTypeIcon && cover.classList.contains('home-tile-cover')));
    let img = cover.querySelector('img');
    const glyph = cover.querySelector('.thumb-glyph');
    if (glyph) glyph.remove();
    if (!img) {
      img = document.createElement('img');
      img.alt = '';
      img.decoding = 'async';
      cover.insertBefore(img, cover.firstChild);
    }
    if (img.src !== src) img.src = src;
  }
  function applyThumbToLibrary(filePath, payload) {
    const src = cacheThumbUrl(filePath, payload);
    if (!src) return;
    const key = String(filePath).toLowerCase();
    document.querySelectorAll('.home-tile, .recent-card').forEach((el) => {
      if (el.dataset.path !== key) return;
      const cover = el.querySelector('.home-tile-cover, .recent-thumb');
      if (cover) paintCoverImage(cover, src, false);
    });
  }
  function fillRecentThumb(thumb, r) {
    const cached = recentWantsContentThumb(r)
      ? (thumbBlobUrls.get(r.path.toLowerCase()) || (r.thumb ? cacheThumbUrl(r.path, r.thumb) : null))
      : null;
    if (cached) {
      paintCoverImage(thumb, cached, false);
      return;
    }
    const kind = EXT_ICON[r.ext];
    if (kind) {
      paintCoverImage(thumb, `../../assets/file-icons/${kind}.png`, true);
      return;
    }
    const g = document.createElement('span');
    g.className = 'thumb-glyph';
    g.textContent = EXT_STYLE[r.ext] || '?';
    thumb.appendChild(g);
  }
  /* ---- pinned files (favourites), kept per install ---- */
  const PINNED_KEY = 'margo.pinned';
  function readPinned() {
    try {
      const raw = JSON.parse(localStorage.getItem(PINNED_KEY) || '[]');
      return Array.isArray(raw) ? raw.filter((p) => p && typeof p.path === 'string') : [];
    } catch { return []; }
  }
  let pinned = readPinned();
  function isPinned(p) {
    const key = pathKey(p);
    return pinned.some((x) => pathKey(x.path) === key);
  }
  function togglePin(p, name) {
    if (!p) return;
    const key = pathKey(p);
    if (isPinned(p)) {
      pinned = pinned.filter((x) => pathKey(x.path) !== key);
      toast(`Unpinned ${name || baseName(p)}`);
    } else {
      pinned.unshift({ path: p, name: name || baseName(p), ext: extOf(p), ts: Date.now() });
      toast(`Pinned ${name || baseName(p)} to the library`, 'success');
    }
    try { localStorage.setItem(PINNED_KEY, JSON.stringify(pinned)); } catch {}
    renderLibrary();
  }
  function baseName(p) {
    return String(p || '').split(/[\\/]/).pop();
  }
  /* A pinned file borrows the recents entry (and so its thumbnail) when it
     has one. */
  function pinnedEntries() {
    const byKey = new Map(lastRecents.map((r) => [pathKey(r.path), r]));
    return pinned.map((p) => byKey.get(pathKey(p.path)) || { path: p.path, name: p.name || baseName(p.path), ext: p.ext || extOf(p.path), ts: p.ts || 0 });
  }

  function recentKind(r) {
    return EXT_ICON[r.ext] || null;
  }
  function matchesQuery(r, q) {
    if (!q) return true;
    const hay = (r.name + ' ' + r.path).toLowerCase();
    return q.split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
  }

  function markActiveRecent() {
    const current = state.doc && state.doc.path ? state.doc.path.toLowerCase() : null;
    document.querySelectorAll('.recent-card, .home-tile').forEach((c) => {
      c.classList.toggle('active', !!current && c.dataset.path === current);
    });
  }

  function recentContextMenu(r, x, y) {
    const pinnedNow = isPinned(r.path);
    window.MargoMenubar.contextMenu(x, y, [
      { label: 'Open', icon: ICONS.open, action: () => openFromPath(r.path) },
      { label: pinnedNow ? 'Unpin' : 'Pin to library', icon: pinnedNow ? ICONS.starFilled : ICONS.star, action: () => togglePin(r.path, r.name) },
      { label: 'Copy file path', icon: ICONS.copyPath, action: () => copyText(r.path, 'Path copied') },
      { sep: true },
      { label: 'Remove from recents', icon: ICONS.close, action: async () => {
        await window.margo.recents.remove(r.path);
        loadRecents();
      } }
    ]);
  }

  /* Star + remove, as spans with button roles: the card itself is a button,
     and a button inside a button is markup no browser agrees on. */
  function recentActionButton(cls, icon, title, onClick) {
    const b = document.createElement('span');
    b.className = cls;
    b.setAttribute('role', 'button');
    b.title = title;
    b.setAttribute('aria-label', title);
    b.innerHTML = icon;
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      onClick();
    });
    return b;
  }
  function attachRecentActions(host, r, tile) {
    const wrap = document.createElement('span');
    wrap.className = tile ? 'home-tile-actions' : 'recent-actions';
    const on = isPinned(r.path);
    const star = recentActionButton((tile ? 'home-tile-star' : 'recent-star') + (on ? ' on' : ''),
      on ? ICONS.starFilled : ICONS.star, on ? 'Unpin' : 'Pin to library', () => togglePin(r.path, r.name));
    if (on && tile) wrap.classList.add('has-on');
    const rm = recentActionButton(tile ? 'home-tile-remove' : 'recent-remove', ICONS.close, 'Remove from list', async () => {
      await window.margo.recents.remove(r.path);
      if (isPinned(r.path) && !tile) togglePin(r.path, r.name);
      loadRecents();
    });
    wrap.appendChild(star);
    wrap.appendChild(rm);
    host.appendChild(wrap);
  }
  /* kept for callers that only want the remove control */
  function attachRecentRemove(el, r) {
    attachRecentActions(el, r, el.classList.contains('home-tile-cover'));
  }

  let lastRecents = [];
  function sideCard(r) {
    const card = document.createElement('button');
    card.type = 'button';
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
    meta.textContent = r.ts ? `${EXT_STYLE[r.ext] || '?'} · ${timeAgo(r.ts)}` : (EXT_STYLE[r.ext] || '?');
    info.appendChild(nm); info.appendChild(meta);

    card.appendChild(thumb); card.appendChild(info);
    attachRecentActions(card, r, false);
    card.addEventListener('click', () => openFromPath(r.path));
    card.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      recentContextMenu(r, e.clientX, e.clientY);
    });
    return card;
  }
  const GROUP_ORDER = [
    ['doc', 'Documents'], ['sheet', 'Spreadsheets'], ['slides', 'Presentations'], ['md', 'Notes'], ['pdf', 'PDFs'], [null, 'Other']
  ];
  function renderSidebarRecents(list) {
    const q = (els.sideSearch && els.sideSearch.value || '').trim().toLowerCase();
    els.btnClearRecents.classList.toggle('hidden', !list.length);

    const pins = pinnedEntries().filter((r) => matchesQuery(r, q));
    els.sidePinned.innerHTML = '';
    pins.forEach((r) => els.sidePinned.appendChild(sideCard(r)));
    els.sidePinnedSection.classList.toggle('hidden', !pins.length);

    els.recentsList.innerHTML = '';
    const rest = list.filter((r) => !isPinned(r.path) && matchesQuery(r, q));
    if (!rest.length) {
      const d = document.createElement('div');
      d.className = 'side-empty';
      d.textContent = q
        ? `No files match “${q}”.`
        : list.length ? 'Everything recent is pinned above.' : 'Files you open or save appear here.';
      els.recentsList.appendChild(d);
      return;
    }
    if (!settings.sideGroup) {
      rest.forEach((r) => els.recentsList.appendChild(sideCard(r)));
      return;
    }
    GROUP_ORDER.forEach(([kind, label]) => {
      const items = rest.filter((r) => recentKind(r) === kind);
      if (!items.length) return;
      const head = document.createElement('div');
      head.className = 'side-group-head';
      head.innerHTML = kind ? ICONS[KIND_ICON[kind]] : ICONS.file;
      const t = document.createElement('span');
      t.textContent = label;
      const n = document.createElement('span');
      n.className = 'side-group-count';
      n.textContent = String(items.length);
      head.appendChild(t);
      head.appendChild(n);
      els.recentsList.appendChild(head);
      items.forEach((r) => els.recentsList.appendChild(sideCard(r)));
    });
  }

  /* ---- home library ---- */
  let homeFilter = 'all';
  const HOME_FILTERS = [
    ['all', 'All'], ['doc', 'Documents'], ['sheet', 'Sheets'], ['slides', 'Slides'], ['md', 'Notes'], ['pdf', 'PDFs']
  ];
  function paintHomeFilter(list) {
    if (!els.homeFilter) return;
    const present = new Set(list.map(recentKind));
    els.homeFilter.innerHTML = '';
    HOME_FILTERS.forEach(([id, label]) => {
      if (id !== 'all' && !present.has(id) && homeFilter !== id) return;
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.dataset.filter = id;
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', homeFilter === id ? 'true' : 'false');
      b.classList.toggle('active', homeFilter === id);
      b.addEventListener('click', () => {
        homeFilter = id;
        renderHomeTiles(lastRecents);
      });
      els.homeFilter.appendChild(b);
    });
    els.homeFilter.classList.toggle('hidden', present.size < 2 && homeFilter === 'all');
  }
  function homeTile(r) {
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'home-tile';
    tile.title = r.path;
    tile.dataset.path = r.path.toLowerCase();

    const cover = document.createElement('div');
    cover.className = 'home-tile-cover';
    fillRecentThumb(cover, r);

    const badge = document.createElement('span');
    badge.className = 'home-tile-badge ' + kindBadgeClass(r.ext);
    badge.textContent = EXT_STYLE[r.ext] || '?';
    cover.appendChild(badge);
    attachRecentActions(cover, r, true);

    const info = document.createElement('span');
    info.className = 'home-tile-info';
    const name = document.createElement('span');
    name.className = 'home-tile-name';
    name.textContent = r.name;
    const meta = document.createElement('span');
    meta.className = 'home-tile-meta';
    meta.textContent = r.ts ? `Opened ${timeAgo(r.ts)}` : (EXT_STYLE[r.ext] || '');
    info.appendChild(name);
    info.appendChild(meta);

    tile.appendChild(cover);
    tile.appendChild(info);
    tile.addEventListener('click', () => openFromPath(r.path));
    tile.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      recentContextMenu(r, e.clientX, e.clientY);
    });
    return tile;
  }
  function renderHomeTiles(list) {
    if (!els.homeTiles) return;
    els.btnClearHomeRecents.classList.toggle('hidden', !list.length);
    paintHomeFilter(list);
    const q = (els.homeSearch && els.homeSearch.value || '').trim().toLowerCase();
    const pass = (r) => matchesQuery(r, q) && (homeFilter === 'all' || recentKind(r) === homeFilter);

    const pins = pinnedEntries().filter(pass);
    els.homePinned.innerHTML = '';
    pins.forEach((r) => els.homePinned.appendChild(homeTile(r)));
    els.homePinnedWrap.classList.toggle('hidden', !pins.length);

    els.homeTiles.innerHTML = '';
    const rest = list.filter((r) => !isPinned(r.path) && pass(r));
    if (!rest.length) {
      const d = document.createElement('p');
      d.className = 'home-tiles-empty';
      d.id = 'home-tiles-empty';
      const filtered = q || homeFilter !== 'all';
      d.innerHTML = filtered ? ICONS.search : ICONS.clock;
      const s = document.createElement('span');
      s.textContent = filtered
        ? 'No recent files match this search.'
        : pins.length ? 'Your other recent files will show up here.'
          : 'Files you open or save appear here, with a preview of their first page.';
      d.appendChild(s);
      els.homeTiles.appendChild(d);
      els.homeTilesEmpty = d;
      return;
    }
    rest.forEach((r) => els.homeTiles.appendChild(homeTile(r)));
  }
  function renderLibrary() {
    renderSidebarRecents(lastRecents);
    renderHomeTiles(lastRecents);
    markActiveRecent();
  }
  /* Each cached thumbnail holds a blob alive until its URL is revoked, and
     nothing revoked the ones for files that had left the list - so clearing
     recents, or opening enough files to push the old ones off the end, leaked
     a card-sized image apiece for the life of the window. Pruned before the
     render, which only ever draws paths that are still in the list. */
  function pruneThumbUrls(list) {
    const live = new Set(list.map((r) => String(r.path).toLowerCase()));
    for (const [key, url] of thumbBlobUrls) {
      if (live.has(key)) continue;
      URL.revokeObjectURL(url);
      thumbBlobUrls.delete(key);
    }
  }

  async function loadRecents() {
    let list = [];
    try { list = await window.margo.recents.list(); } catch {}
    lastRecents = Array.isArray(list) ? list : [];
    pruneThumbUrls(lastRecents);
    renderLibrary();
    queueThumbBackfill(list);
  }

  const thumbBackfillQueue = [];
  /* Set aside rather than dropped. Everything but a Word file needs the
     document opened and rasterized to get a thumbnail, which is too much work
     to do under the tiles the reader is looking at - so those entries wait
     here until the library is off screen, and go back on the queue then. They
     used to be shifted off the queue on the home view and simply not put
     anywhere, which is why a spreadsheet or a PDF in the library never got
     past its type icon: the queue is only ever filled from loadRecents, and
     that runs on the home view too, so they were dropped again every time. */
  const thumbBackfillDeferred = [];
  const thumbBackfillSeen = new Set();
  let thumbBackfillRunning = false;
  let homeScrolling = false;
  let homeScrollIdleTimer = null;

  function waitMs(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
  function waitForIdle() {
    return new Promise((resolve) => {
      if (typeof requestIdleCallback === 'function') {
        requestIdleCallback(() => resolve(), { timeout: 500 });
      } else {
        setTimeout(resolve, 48);
      }
    });
  }
  async function waitWhileHomeScrolling() {
    while (homeScrolling) await waitMs(80);
  }

  function deferThumbBackfill(p) {
    if (!thumbBackfillDeferred.includes(p)) thumbBackfillDeferred.push(p);
  }

  /* Called when the view leaves home, which is the moment the deferred work
     became safe to do. */
  function resumeThumbBackfill() {
    if (!thumbBackfillDeferred.length) return;
    for (const p of thumbBackfillDeferred.splice(0)) {
      if (!thumbBackfillQueue.includes(p)) thumbBackfillQueue.push(p);
    }
    runThumbBackfill();
  }

  function queueThumbBackfill(list) {
    for (const r of list) {
      if (!recentWantsContentThumb(r) || r.thumb || thumbBlobUrls.has(r.path.toLowerCase())) continue;
      if (thumbBackfillSeen.has(r.path) || thumbBackfillQueue.includes(r.path)) continue;
      if (thumbBackfillDeferred.includes(r.path)) continue;
      thumbBackfillQueue.push(r.path);
    }
    runThumbBackfill();
  }

  async function runThumbBackfill() {
    if (thumbBackfillRunning) return;
    thumbBackfillRunning = true;
    await waitMs(280);
    while (thumbBackfillQueue.length) {
      await waitWhileHomeScrolling();
      await waitForIdle();
      const p = thumbBackfillQueue.shift();
      try {
        if (state.view === 'home') {
          // A Word file often carries its own preview, which is a cheap read
          // and safe to do here. Everything else waits.
          const ext = String(p).split('.').pop().toLowerCase();
          if (ext === 'docx' && window.margo.readDocxThumb) {
            const emb = await window.margo.readDocxThumb(p);
            if (emb && emb.ok && emb.dataUrl) {
              thumbBackfillSeen.add(p);
              applyThumbToLibrary(p, emb.dataUrl);
              continue;
            }
          }
          deferThumbBackfill(p);
          continue;
        }
        const res = await window.margo.peekPath(p);
        if (!res.ok || !res.doc) continue;
        await waitWhileHomeScrolling();
        if (state.view === 'home') {
          deferThumbBackfill(p);
          continue;
        }
        const url = await window.MargoThumbs.generate(res.doc, res.doc);
        if (url) {
          thumbBackfillSeen.add(p);
          applyThumbToLibrary(p, url);
        }
      } catch {}
    }
    thumbBackfillRunning = false;
    if (thumbBackfillQueue.length) runThumbBackfill();
  }

  if (els.home) {
    els.home.addEventListener('scroll', () => {
      homeScrolling = true;
      clearTimeout(homeScrollIdleTimer);
      homeScrollIdleTimer = setTimeout(() => { homeScrolling = false; }, 180);
    }, { passive: true });
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
    /* It used to slide away while the author was still typing in its
       filter box, or while a right-click menu opened from it was up. */
    sideTimer = setTimeout(() => {
      const a = document.activeElement;
      if (a && els.sidebar.contains(a) && a.matches('input')) return;
      if (document.querySelector('.ctx-menu')) return;
      els.sidebar.classList.remove('open');
    }, 240);
  }
  /* Keyboard route into the library: slides it out (in the editor) and puts
     the caret in its filter; on the home screen the filter is the home one. */
  function focusLibrarySearch() {
    if (state.view === 'home') {
      if (els.homeSearch) { els.homeSearch.focus(); els.homeSearch.select(); }
      return;
    }
    openSidebar();
    setTimeout(() => { els.sideSearch.focus(); els.sideSearch.select(); }, 30);
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
  els.sidebar.addEventListener('focusout', (e) => {
    if (els.sidebar.contains(e.relatedTarget) || els.sidebar.matches(':hover')) return;
    closeSidebar();
  });
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

  /* ---------------- keyboard shortcuts dialog ---------------- */
  function shortcutGroups() {
    const def = NEW_KINDS.find((k) => k.kind === settings.defaultKind) || NEW_KINDS[0];
    return [
      { title: 'General', rows: [
        ['Command palette', ['Ctrl', 'K'], ['Ctrl', 'Shift', 'P']],
        ['New ' + def.label.toLowerCase(), ['Ctrl', 'N']],
        ['Open a file', ['Ctrl', 'O']],
        ['Save', ['Ctrl', 'S']],
        ['Save as…', ['Ctrl', 'Shift', 'S']],
        ['Save all', ['Ctrl', 'Alt', 'S']],
        ['Export as PDF', ['Ctrl', 'E']],
        ['Print', ['Ctrl', 'P']],
        ['Settings', ['Ctrl', ',']],
        ['Keyboard shortcuts', ['Ctrl', '/']],
        ['Open a menu', ['Alt', 'F']],
        ['Menu bar', ['F10']]
      ] },
      { title: 'Tabs', rows: [
        ['Next tab', ['Ctrl', 'Tab'], ['Ctrl', 'PgDn']],
        ['Previous tab', ['Ctrl', 'Shift', 'Tab'], ['Ctrl', 'PgUp']],
        ['Go to tab 1–8', ['Ctrl', '1…8']],
        ['Go to last tab', ['Ctrl', '9']],
        ['Close tab', ['Ctrl', 'W']],
        ['Reopen closed tab', ['Ctrl', 'Shift', 'T']]
      ] },
      { title: 'Editing', rows: [
        ['Undo', ['Ctrl', 'Z']],
        ['Redo', ['Ctrl', 'Y'], ['Ctrl', 'Shift', 'Z']],
        ['Cut / copy / paste', ['Ctrl', 'X / C / V']],
        ['Select all', ['Ctrl', 'A']],
        ['Find & replace', ['Ctrl', 'F']],
        ['Bold / italic / underline', ['Ctrl', 'B / I / U']],
        ['Page break (document)', ['Ctrl', 'Enter']]
      ] },
      { title: 'View', rows: [
        ['Zoom in', ['Ctrl', '+']],
        ['Zoom out', ['Ctrl', '-']],
        ['Reset zoom', ['Ctrl', '0']],
        ['Pin or unpin the library', ['Ctrl', '\\']],
        ['Leave focus mode', ['Esc']]
      ] },
      { title: 'Spreadsheet', rows: [
        ['Commit and move down / right', ['Enter'], ['Tab']],
        ['Edit the selected cell', ['F2']],
        ['Move the selection', ['Arrows']],
        ['Extend the selection', ['Shift', 'Arrows']]
      ] },
      { title: 'Presentation', rows: [
        ['Start the slide show', ['F5']],
        ['Slide show from the current slide', ['Shift', 'F5']],
        ['New slide', ['Ctrl', 'M']],
        ['Duplicate selection or slide', ['Ctrl', 'D']],
        ['Edit the selected text box', ['Enter'], ['F2']],
        ['Nudge the selection (10 px with Shift)', ['Arrows']],
        ['Bring forward / send backward', ['Ctrl', '↑'], ['Ctrl', '↓']],
        ['Next / previous slide in the show', ['→'], ['←']],
        ['End the slide show', ['Esc']]
      ] }
    ];
  }
  function keysHtml(combo) {
    return combo.map((k) => `<kbd>${escapeHtml(k)}</kbd>`).join('');
  }
  function showShortcuts() {
    const panel = document.createElement('div');
    panel.className = 'shortcuts-panel';
    const search = document.createElement('label');
    search.className = 'search-field';
    search.innerHTML = `<span class="search-field-icon">${ICONS.search}</span>`;
    const input = document.createElement('input');
    input.type = 'search';
    input.placeholder = 'Search shortcuts';
    input.setAttribute('aria-label', 'Search shortcuts');
    search.appendChild(input);
    const scroll = document.createElement('div');
    scroll.className = 'shortcuts-scroll';
    const paint = () => {
      const q = input.value.trim().toLowerCase();
      scroll.innerHTML = '';
      let shown = 0;
      shortcutGroups().forEach((g) => {
        const rows = g.rows.filter(([label, ...combos]) => !q
          || label.toLowerCase().includes(q)
          || combos.some((c) => c.join('+').toLowerCase().includes(q)));
        if (!rows.length) return;
        const group = document.createElement('div');
        group.className = 'shortcut-group';
        const h = document.createElement('h4');
        h.textContent = g.title;
        group.appendChild(h);
        rows.forEach(([label, ...combos]) => {
          const row = document.createElement('div');
          row.className = 'shortcut-row';
          const l = document.createElement('span');
          l.textContent = label;
          const keys = document.createElement('span');
          keys.className = 'shortcut-keys';
          keys.innerHTML = combos.map(keysHtml).join('<span>or</span>');
          row.appendChild(l);
          row.appendChild(keys);
          group.appendChild(row);
          shown += 1;
        });
        scroll.appendChild(group);
      });
      if (!shown) {
        const empty = document.createElement('div');
        empty.className = 'shortcuts-empty';
        empty.textContent = 'No shortcut matches that search.';
        scroll.appendChild(empty);
      }
    };
    input.addEventListener('input', paint);
    paint();
    panel.appendChild(search);
    panel.appendChild(scroll);
    openModal('Keyboard shortcuts', panel, [{ label: 'Close', primary: true, value: null }],
      { wide: true, className: 'shortcuts-modal', initialFocus: input });
  }
  async function showAbout() {
    const div = document.createElement('div');
    div.className = 'about-panel';
    let version = '';
    try { version = await window.margo.version(); } catch {}
    div.innerHTML =
      '<img src="../../assets/icon.png" width="64" height="64" alt="">' +
      `<div class="about-name">Margo ${escapeHtml(version)}</div>` +
      '<div class="about-tag">A friendly home for your documents.</div>' +
      '<div class="about-by">Made by Sounak</div>';
    openModal('About Margo', div, [{ label: 'Close', primary: true, value: null }]);
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
    settingsLive.version.textContent = st.currentVersion || settingsLive.version.textContent || '—';
    settingsLive.status.textContent = updateStatusLabel(st);
    const busy = st.state === 'checking' || st.state === 'downloading';
    settingsLive.check.disabled = busy;
    settingsLive.install.classList.toggle('hidden', st.state !== 'downloaded');
  }

  async function promptRestart(version) {
    if (isModalOpen()) return;
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
        : 'An update is ready — restart to install.', 'info');
      promptRestart(updateStatus.version);
    }
  }

  window.margo.updates.onStatus((st) => applyUpdateStatus(st));

  /* ---------------- settings dialog ---------------- */
  function settingsRow(label, desc, control) {
    const row = document.createElement('div');
    row.className = 'settings-row';
    const text = document.createElement('div');
    text.className = 'settings-row-text';
    const l = document.createElement('span');
    l.className = 'settings-label';
    l.textContent = label;
    text.appendChild(l);
    if (desc) {
      const d = document.createElement('span');
      d.className = 'settings-desc';
      d.textContent = desc;
      text.appendChild(d);
    }
    row.appendChild(text);
    if (control) {
      const c = document.createElement('div');
      c.className = 'settings-control';
      c.appendChild(control);
      row.appendChild(c);
    }
    return row;
  }
  function switchControl(checked, label, onChange) {
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.className = 'switch';
    input.checked = !!checked;
    input.setAttribute('role', 'switch');
    input.setAttribute('aria-label', label);
    input.addEventListener('change', () => onChange(input.checked));
    return input;
  }
  function selectControl(options, value, label, onChange) {
    const sel = document.createElement('select');
    sel.className = 'select';
    sel.setAttribute('aria-label', label);
    options.forEach(([v, text]) => {
      const o = document.createElement('option');
      o.value = String(v);
      o.textContent = text;
      if (String(v) === String(value)) o.selected = true;
      sel.appendChild(o);
    });
    sel.addEventListener('change', () => onChange(sel.value));
    return sel;
  }
  function segmentedControl(options, value, label, onChange) {
    const seg = document.createElement('div');
    seg.className = 'segmented';
    seg.setAttribute('role', 'radiogroup');
    seg.setAttribute('aria-label', label);
    options.forEach(([v, text]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = text;
      b.dataset.value = v;
      b.setAttribute('role', 'radio');
      const paint = (cur) => {
        b.classList.toggle('active', cur === v);
        b.setAttribute('aria-checked', cur === v ? 'true' : 'false');
      };
      paint(value);
      b.addEventListener('click', () => {
        seg.querySelectorAll('button').forEach((x) => {
          x.classList.toggle('active', x === b);
          x.setAttribute('aria-checked', x === b ? 'true' : 'false');
        });
        onChange(v);
      });
      seg.appendChild(b);
    });
    return seg;
  }
  function themeCard(t) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'theme-card' + (state.theme === t.id ? ' active' : '');
    card.dataset.theme = t.id;
    card.title = t.label;
    const sw = t.swatch || { bg: t.chrome.bg, surface: t.chrome.bar, text: t.chrome.fg, accent: '#f5b301' };
    const prev = document.createElement('span');
    prev.className = 'theme-preview';
    prev.style.background = sw.bg;
    prev.innerHTML =
      `<i style="left:0;top:0;bottom:0;width:26%;background:${sw.surface};opacity:.9;border-radius:0"></i>` +
      `<i style="left:34%;top:18%;width:40%;height:5px;background:${sw.text};opacity:.85"></i>` +
      `<i style="left:34%;top:38%;width:54%;height:4px;background:${sw.text};opacity:.35"></i>` +
      `<i style="left:34%;top:54%;width:46%;height:4px;background:${sw.text};opacity:.35"></i>` +
      `<i style="left:34%;bottom:14%;width:22%;height:9px;background:${sw.accent};border-radius:3px"></i>` +
      `<i style="left:7%;top:18%;width:12%;height:4px;background:${sw.text};opacity:.4"></i>` +
      `<i style="left:7%;top:34%;width:12%;height:4px;background:${sw.text};opacity:.25"></i>`;
    const name = document.createElement('span');
    name.className = 'theme-name';
    const label = document.createElement('span');
    label.textContent = t.label;
    name.appendChild(label);
    const tick = document.createElement('span');
    tick.className = 'theme-tick';
    if (state.theme === t.id) tick.innerHTML = ICONS.check;
    name.appendChild(tick);
    card.appendChild(prev);
    card.appendChild(name);
    card.addEventListener('click', () => {
      applyTheme(t.id, true);
      card.parentElement.querySelectorAll('.theme-card').forEach((c) => {
        const on = c.dataset.theme === t.id;
        c.classList.toggle('active', on);
        const tk = c.querySelector('.theme-tick');
        if (tk) tk.innerHTML = on ? ICONS.check : '';
      });
    });
    return card;
  }

  async function showSettings(andCheck, startPage) {
    let st = null;
    try { st = await window.margo.updates.status(); } catch {}
    updateStatus = st || updateStatus;
    let version = updateStatus.currentVersion || '';
    if (!version) { try { version = await window.margo.version(); } catch {} }
    const gStatus = await refreshGoogle();

    const layout = document.createElement('div');
    layout.className = 'settings-layout';
    const nav = document.createElement('nav');
    nav.className = 'settings-nav';
    nav.setAttribute('aria-label', 'Settings sections');
    const pagesEl = document.createElement('div');
    pagesEl.className = 'settings-pages';
    layout.appendChild(nav);
    layout.appendChild(pagesEl);

    /* Appearance */
    const pAppearance = document.createElement('div');
    const h1 = document.createElement('h4');
    h1.textContent = 'Theme';
    const grid = document.createElement('div');
    grid.className = 'theme-grid';
    window.MargoThemes.list.forEach((t) => grid.appendChild(themeCard(t)));
    pAppearance.appendChild(h1);
    pAppearance.appendChild(grid);
    const h1b = document.createElement('h4');
    h1b.textContent = 'Layout';
    pAppearance.appendChild(h1b);
    pAppearance.appendChild(settingsRow('Density', 'Compact fits more on screen; comfortable gives controls more room.',
      segmentedControl([['comfortable', 'Comfortable'], ['compact', 'Compact']], settings.density, 'Density',
        (v) => updateSettings({ density: v }))));
    pAppearance.appendChild(settingsRow('Keep the library open', 'Pin the file library to the side of the editor instead of sliding it in from the edge.',
      switchControl(sidebarPinned, 'Keep the library open', (on) => { if (on !== sidebarPinned) toggleSidebarPin(); })));

    /* Editing */
    const pEditing = document.createElement('div');
    const h2 = document.createElement('h4');
    h2.textContent = 'Editing';
    pEditing.appendChild(h2);
    pEditing.appendChild(settingsRow('Check spelling', 'Underline misspelled words while you type.',
      switchControl(settings.spellcheck, 'Check spelling', (on) => updateSettings({ spellcheck: on }))));
    pEditing.appendChild(settingsRow('New file type', 'What Ctrl+N and the + button next to the tabs create.',
      selectControl(availableKinds().map((k) => [k.kind, k.long]), settings.defaultKind, 'New file type',
        (v) => updateSettings({ defaultKind: v }))));

    /* Files & saving */
    const pFiles = document.createElement('div');
    const h3 = document.createElement('h4');
    h3.textContent = 'Saving';
    pFiles.appendChild(h3);
    const intervalSel = selectControl(AUTOSAVE_CHOICES.map((s) => [s, s < 60 ? `Every ${s} seconds` : s === 60 ? 'Every minute' : `Every ${s / 60} minutes`]),
      settings.autosaveSec, 'Autosave interval', (v) => updateSettings({ autosaveSec: Number(v) }));
    intervalSel.disabled = !settings.autosave;
    pFiles.appendChild(settingsRow('Autosave', 'Save documents that already have a file in the background. New documents, PDFs and CSV files are never saved without you.',
      switchControl(settings.autosave, 'Autosave', (on) => {
        updateSettings({ autosave: on });
        intervalSel.disabled = !on;
        state.tabs.forEach(refreshSaveState);
      })));
    pFiles.appendChild(settingsRow('Autosave interval', null, intervalSel));
    const h3b = document.createElement('h4');
    h3b.textContent = 'Startup';
    pFiles.appendChild(h3b);
    pFiles.appendChild(settingsRow('Reopen documents from last time', 'When Margo starts, open the tabs that were open when it closed.',
      switchControl(settings.reopenSession, 'Reopen documents from last time', (on) => updateSettings({ reopenSession: on }))));
    const h3c = document.createElement('h4');
    h3c.textContent = 'Library';
    pFiles.appendChild(h3c);
    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'btn ghost';
    clearBtn.textContent = 'Clear list';
    clearBtn.addEventListener('click', async () => {
      await window.margo.recents.clear();
      loadRecents();
      toast('Recent files cleared');
    });
    pFiles.appendChild(settingsRow('Recent files', 'Remove every file from the recent list. The files themselves are not touched.', clearBtn));

    /* Account */
    const pAccount = document.createElement('div');
    const h4 = document.createElement('h4');
    h4.textContent = 'Google';
    pAccount.appendChild(h4);
    const gValue = document.createElement('span');
    gValue.className = 'settings-value';
    gValue.textContent = gStatus.signedIn ? (gStatus.email || 'Signed in') : 'Not signed in';
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
    const gRow = settingsRow('Google account', 'Share files through Google Drive and open them again from any computer.', gBtn);
    gRow.querySelector('.settings-row-text').appendChild(gValue);
    gValue.style.textAlign = 'left';
    pAccount.appendChild(gRow);

    /* About & updates */
    const pAbout = document.createElement('div');
    const h5 = document.createElement('h4');
    h5.textContent = 'Margo';
    pAbout.appendChild(h5);
    const verValue = document.createElement('span');
    verValue.className = 'settings-value';
    verValue.textContent = version || '—';
    pAbout.appendChild(settingsRow('Version', null, verValue));
    const stValue = document.createElement('span');
    stValue.className = 'settings-value';
    stValue.textContent = updateStatusLabel(updateStatus);
    pAbout.appendChild(settingsRow('Updates', null, stValue));
    const note = document.createElement('p');
    note.className = 'settings-note';
    note.textContent = 'Updates apply to the installed app only. Running with npm start will not download new versions.';
    const actions = document.createElement('div');
    actions.className = 'settings-actions';
    actions.style.marginTop = '12px';
    const checkBtn = document.createElement('button');
    checkBtn.className = 'btn ghost';
    checkBtn.type = 'button';
    checkBtn.innerHTML = `<span class="btn-icon">${ICONS.refresh}</span><span>Check for updates</span>`;
    checkBtn.addEventListener('click', () => { window.margo.updates.check(); });
    const installBtn = document.createElement('button');
    installBtn.className = 'btn primary hidden';
    installBtn.type = 'button';
    installBtn.textContent = 'Restart and install';
    installBtn.addEventListener('click', () => window.margo.updates.install());
    actions.appendChild(checkBtn);
    actions.appendChild(installBtn);
    pAbout.appendChild(note);
    pAbout.appendChild(actions);

    const pages = [
      ['appearance', 'Appearance', 'palette', pAppearance],
      ['editing', 'Editing', 'pen', pEditing],
      ['files', 'Files & saving', 'save', pFiles],
      ['account', 'Account', 'user', pAccount],
      ['about', 'About & updates', 'info', pAbout]
    ];
    const show = (id) => {
      pages.forEach(([pid, , , el]) => { el.hidden = pid !== id; });
      nav.querySelectorAll('button').forEach((b) => {
        b.classList.toggle('active', b.dataset.page === id);
        b.setAttribute('aria-current', b.dataset.page === id ? 'page' : 'false');
      });
      pagesEl.scrollTop = 0;
    };
    pages.forEach(([id, label, icon, el]) => {
      el.className = 'settings-page';
      el.dataset.page = id;
      pagesEl.appendChild(el);
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.page = id;
      b.innerHTML = ICONS[icon] || '';
      const s = document.createElement('span');
      s.textContent = label;
      b.appendChild(s);
      b.addEventListener('click', () => show(id));
      nav.appendChild(b);
    });
    show(startPage || (andCheck ? 'about' : 'appearance'));

    settingsLive = { version: verValue, status: stValue, check: checkBtn, install: installBtn };
    paintSettings(updateStatus);
    const closed = openModal('Settings', layout, [{ label: 'Done', primary: true, value: null }],
      { className: 'xwide settings-modal' });
    closed.then(() => { settingsLive = null; });
    if (andCheck) window.margo.updates.check();
    /* Resolves once the dialog is up, not when it closes - callers (and the
       smoke suite) await it to know the dialog is on screen. */
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
      av.innerHTML = ICONS.user;
    }
    if (els.btnAccount) {
      els.btnAccount.title = googleStatus.signedIn
        ? (googleStatus.email || 'Google account')
        : 'Sign in with Google';
    }
  }

  /* Main reports signedOut:true when Google revoked the session mid-call;
     the avatar and menus follow it straight away. */
  function noteGoogleSignedOut(res) {
    if (res && res.signedOut) refreshGoogle();
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
    shareBtn.innerHTML = ICONS.share + '<span></span>';
    shareBtn.lastChild.textContent = 'Share this file…';
    shareBtn.disabled = !(state.view === 'editor' && state.doc);
    shareBtn.addEventListener('click', () => { closeAccountMenu(); shareDoc(); });
    const openDriveBtn = document.createElement('button');
    openDriveBtn.type = 'button';
    openDriveBtn.innerHTML = ICONS.cloud + '<span></span>';
    openDriveBtn.lastChild.textContent = 'Open from Drive…';
    openDriveBtn.addEventListener('click', () => { closeAccountMenu(); showOpenFromDrive(); });
    const outBtn = document.createElement('button');
    outBtn.type = 'button';
    outBtn.innerHTML = ICONS.logout + '<span></span>';
    outBtn.lastChild.textContent = 'Sign out';
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
    noteGoogleSignedOut(res);
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
    noteGoogleSignedOut(res);
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

  /* ---------------- application menu ----------------
     Also the source of the command palette: every enabled item (submenus
     included) becomes a palette command, so the two never drift apart. */
  /* A run of menu rows for one set of document kinds, led by a separator;
     empty when another kind (or nothing) is in front. */
  function onlyFor(kind, kinds, items) {
    return kind && kinds.includes(kind) ? [{ sep: true }].concat(items) : [];
  }
  const EC = (ed, name, ...args) => ed && ed.commands && typeof ed.commands[name] === 'function' && ed.commands[name](...args);
  function menuSpec() {
    const hasDoc = state.view === 'editor' && !!state.doc;
    const kind = hasDoc ? state.doc.kind : null;
    const ed = state.editor;
    return [
      { label: 'File', items: [
        { label: 'New', icon: ICONS.plus, submenu: () => availableKinds().map((k) => ({
          label: k.long,
          icon: ICONS[KIND_ICON[k.kind]],
          accel: k.kind === settings.defaultKind ? 'Ctrl+N' : undefined,
          action: () => newDocGuarded(k.kind)
        })).concat([{ sep: true }, { heading: 'From a template' }]).concat(TEMPLATES.filter((t) => kindAvailable(t.kind)).map((t) => ({
          label: t.label,
          icon: ICONS[t.icon],
          action: () => newFromTemplate(t.id)
        }))) },
        { label: 'Open…', accel: 'Ctrl+O', icon: ICONS.folderOpen, action: pickAndOpen },
        { label: 'Open from Drive…', icon: ICONS.cloud, action: showOpenFromDrive },
        { label: 'Open Recent', icon: ICONS.clock, paletteSkip: true, enabled: lastRecents.length > 0, submenu: () =>
          lastRecents.slice(0, 10).map((r) => ({ label: r.name, icon: ICONS[KIND_ICON[recentKind(r)]] || ICONS.file, action: () => openFromPath(r.path) }))
            .concat([{ sep: true }, { label: 'Clear recents', icon: ICONS.trash, action: async () => { await window.margo.recents.clear(); loadRecents(); } }])
        },
        { label: 'Reopen Closed Tab', accel: 'Ctrl+Shift+T', icon: ICONS.refresh, enabled: state.closedPaths.length > 0, action: reopenClosedTab },
        { sep: true },
        { label: 'Save', accel: 'Ctrl+S', icon: ICONS.save, enabled: hasDoc, action: () => saveDoc(false) },
        { label: 'Save As…', accel: 'Ctrl+Shift+S', icon: ICONS.saveAs, enabled: hasDoc, action: () => saveDoc(true) },
        { label: 'Save All', accel: 'Ctrl+Alt+S', enabled: state.tabs.some((t) => t.dirty || (t.id === state.activeTabId && state.dirty)), action: saveAllTabs },
        { sep: true },
        { label: 'Export as PDF…', accel: 'Ctrl+E', icon: ICONS.exportPdf, enabled: hasDoc && kind !== 'pdf', action: () => exportPdf() },
        { label: 'Print…', accel: 'Ctrl+P', icon: ICONS.print, enabled: hasDoc, action: () => printDoc() },
        { label: 'Export Images…', icon: ICONS.imageStack, enabled: hasDoc && (kind === 'doc' || kind === 'pdf'), action: () => {
          if (kind === 'doc') EC(ed, 'extractImages');
          else if (kind === 'pdf') EC(ed, 'showImages');
        } },
        { sep: true },
        { label: 'Share…', icon: ICONS.share, enabled: hasDoc, action: shareDoc },
        { sep: true },
        { label: 'Close document', accel: 'Ctrl+W', icon: ICONS.close, enabled: hasDoc, action: closeActiveTab },
        { label: 'Close All', enabled: state.tabs.length > 0, action: closeAllTabs },
        { label: 'Exit', icon: ICONS.logout, action: () => window.margo.quit() }
      ] },
      { label: 'Edit', items: [
        { label: 'Undo', accel: 'Ctrl+Z', icon: ICONS.undo, enabled: hasDoc && !!(ed && ed.commands && ed.commands.canUndo && ed.commands.canUndo()), action: () => editCommand('undo') },
        { label: 'Redo', accel: 'Ctrl+Y', icon: ICONS.redo, enabled: hasDoc && !!(ed && ed.commands && ed.commands.canRedo && ed.commands.canRedo()), action: () => editCommand('redo') },
        { sep: true },
        { label: 'Cut', accel: 'Ctrl+X', icon: ICONS.cut, enabled: hasDoc, action: () => editCommand('cut') },
        { label: 'Copy', accel: 'Ctrl+C', icon: ICONS.copy, enabled: hasDoc, action: () => editCommand('copy') },
        { label: 'Paste', accel: 'Ctrl+V', icon: ICONS.paste, enabled: hasDoc, action: () => editCommand('paste') },
        { sep: true },
        { label: 'Select All', accel: 'Ctrl+A', enabled: hasDoc && kind !== 'sheet' && kind !== 'pdf', action: () => editCommand('selectAll') },
        { sep: true },
        { label: 'Find & Replace…', accel: 'Ctrl+F', icon: ICONS.search, enabled: hasDoc, action: () => editCommand('find') }
      ] },
      { label: 'View', items: [
        { label: 'Command Palette…', accel: 'Ctrl+K', icon: ICONS.command, paletteSkip: true, action: () => openPalette() },
        { label: 'Home', icon: ICONS.home, enabled: state.view !== 'home', action: showLanding },
        { sep: true },
        { label: 'Theme', icon: ICONS.palette, submenu: () =>
          window.MargoThemes.list.map((t) => ({
            label: t.label,
            checked: state.theme === t.id,
            action: () => applyTheme(t.id, true)
          }))
        },
        { label: 'Density', icon: ICONS.density, submenu: () => [
          { label: 'Comfortable', checked: settings.density === 'comfortable', action: () => updateSettings({ density: 'comfortable' }) },
          { label: 'Compact', checked: settings.density === 'compact', action: () => updateSettings({ density: 'compact' }) }
        ] },
        { label: 'Keep Library Open', accel: 'Ctrl+\\', icon: ICONS.sidebar, checked: sidebarPinned, action: toggleSidebarPin },
        { label: 'Search Library…', icon: ICONS.search, action: focusLibrarySearch },
        { sep: true },
        /* What follows belongs to one kind of document each: it is only
           listed while that kind is in front, instead of a wall of greyed
           rows for editors that are not open. */
        ...onlyFor(kind, ['slides'], [
          { label: 'Slide Show from Beginning', accel: 'F5', icon: ICONS.present, action: () => EC(ed, 'present', 0) },
          { label: 'Slide Show from Current Slide', accel: 'Shift+F5', action: () => EC(ed, 'presentCurrent') },
          { label: 'Speaker Notes', action: () => EC(ed, 'toggleNotes') }
        ]),
        ...onlyFor(kind, ['doc', 'md'], [
          { label: 'Headings Outline', icon: ICONS.outline, action: () => EC(ed, 'outline') },
          { label: 'Document Statistics', icon: ICONS.stats, action: () => EC(ed, 'stats') }
        ]),
        ...onlyFor(kind, ['doc', 'pdf'], [
          { label: 'Images in Document', icon: ICONS.image, action: () => {
            if (kind === 'doc') EC(ed, 'extractImages');
            else if (kind === 'pdf') EC(ed, 'showImages');
          } }
        ]),
        ...onlyFor(kind, ['doc'], [
          { label: 'Focus Mode (Distraction-Free)', accel: 'Esc to exit', icon: ICONS.focus, action: () => EC(ed, 'focusMode') },
          { label: 'Document layout', submenu: () =>
            ['print', 'read', 'split'].map((m) => ({
              label: m === 'print' ? 'Print Layout' : m === 'read' ? 'Read View' : 'Split View',
              checked: !!(ed && ed.commands && ed.commands.getViewMode && ed.commands.getViewMode() === m),
              action: () => ed.commands.setViewMode(m)
            }))
          }
        ]),
        ...onlyFor(kind, ['md'], [
          { label: 'Markdown layout', submenu: () =>
            ['write', 'split', 'read'].map((m) => ({
              label: m[0].toUpperCase() + m.slice(1),
              checked: !!(ed && ed.commands && ed.commands.getMdMode && ed.commands.getMdMode() === m),
              action: () => ed.commands.setMdMode(m)
            }))
          }
        ]),
        ...onlyFor(kind, ['sheet'], [
          { label: 'Insert Function (fx)…', icon: ICONS.fx, action: () => EC(ed, 'insertFx') },
          { label: 'Insert Chart', icon: ICONS.chartCol, submenu: [
            { label: 'Column chart', icon: ICONS.chartCol, action: () => EC(ed, 'insertChart', 'column') },
            { label: 'Bar chart', icon: ICONS.chartBar, action: () => EC(ed, 'insertChart', 'bar') },
            { label: 'Line chart', icon: ICONS.chartLine, action: () => EC(ed, 'insertChart', 'line') },
            { label: 'Pie chart', icon: ICONS.chartPie, action: () => EC(ed, 'insertChart', 'pie') }
          ] },
          { label: 'Toggle AutoFilter', icon: ICONS.filter, action: () => EC(ed, 'toggleFilter') },
          { label: 'Sort Ascending (A-Z)', icon: ICONS.sortAZ, action: () => EC(ed, 'sortAsc') },
          { label: 'Sort Descending (Z-A)', icon: ICONS.sortZA, action: () => EC(ed, 'sortDesc') }
        ]),
        { sep: true },
        { label: 'Zoom', icon: ICONS.zoomIn, enabled: !!(ed && ed.commands && ed.commands.zoomIn), submenu: () => [
          { label: 'Zoom in', accel: 'Ctrl++', icon: ICONS.zoomIn, action: () => ed.commands.zoomIn() },
          { label: 'Zoom out', accel: 'Ctrl+-', icon: ICONS.zoomOut, action: () => ed.commands.zoomOut() },
          { sep: true },
          { label: kind === 'pdf' ? 'Fit width' : 'Reset zoom', accel: 'Ctrl+0', icon: ICONS.fit, action: () => ed.commands.zoomReset() }
        ] }
      ] },
      { label: 'Help', items: [
        { label: 'Keyboard Shortcuts', accel: 'Ctrl+/', icon: ICONS.keyboard, action: showShortcuts },
        { label: 'Settings', accel: 'Ctrl+,', icon: ICONS.settings, action: () => showSettings(false) },
        { label: 'Check for Updates…', icon: ICONS.refresh, action: checkForUpdates },
        { sep: true },
        { label: 'About Margo', icon: ICONS.info, action: showAbout }
      ] }
    ];
  }

  let menubarApi = null;
  function closeMenus() {
    if (menubarApi) menubarApi.close();
    if (window.MargoMenubar.closeContextMenu) window.MargoMenubar.closeContextMenu();
  }

  /* ---------------- command palette ---------------- */
  let paletteEntries = [];
  let paletteShown = [];
  let paletteActive = 0;
  let paletteSaved = null;   // focus + selection to put back on close
  function paletteIsOpen() {
    return !els.paletteBackdrop.classList.contains('hidden');
  }
  function resolveMenuItems(items) {
    return (typeof items === 'function' ? items() : items) || [];
  }
  function collectCommands() {
    const out = [];
    const walk = (items, trail) => {
      resolveMenuItems(items).forEach((it) => {
        if (!it || it.sep || it.heading || it.paletteSkip) return;
        if (it.enabled === false) return;
        if (it.submenu) {
          walk(it.submenu, trail.concat(it.label));
          return;
        }
        if (typeof it.action !== 'function') return;
        const label = trail.length > 1 ? `${trail[trail.length - 1]}: ${it.label}` : it.label;
        out.push({
          type: 'command',
          label,
          detail: trail.join(' › '),
          accel: it.accel && !/to exit/.test(it.accel) ? it.accel : '',
          icon: it.icon || (it.checked ? ICONS.check : ICONS.command),
          run: it.action
        });
      });
    };
    menuSpec().forEach((m) => walk(m.items, [m.label]));
    return out;
  }
  function collectPaletteEntries() {
    const entries = [];
    state.tabs.forEach((t) => {
      if (t.id === state.activeTabId && state.view === 'editor') return;
      entries.push({
        type: 'tab',
        label: (t.doc && t.doc.name) || 'Untitled',
        detail: t.dirty ? 'Open tab · unsaved' : 'Open tab',
        icon: ICONS[KIND_ICON[t.doc && t.doc.kind]] || ICONS.file,
        run: () => activateTab(t.id)
      });
    });
    const seen = new Set(state.tabs.map((t) => pathKey(t.doc && t.doc.path)));
    const files = pinnedEntries().concat(lastRecents.filter((r) => !isPinned(r.path)));
    files.forEach((r) => {
      if (seen.has(pathKey(r.path))) return;
      seen.add(pathKey(r.path));
      const dir = String(r.path).replace(/[\\/][^\\/]*$/, '');
      entries.push({
        type: 'file',
        label: r.name,
        detail: (isPinned(r.path) ? 'Pinned · ' : '') + dir,
        icon: ICONS[KIND_ICON[recentKind(r)]] || ICONS.file,
        run: () => openFromPath(r.path)
      });
    });
    return entries.concat(collectCommands());
  }
  /* Subsequence match with bonuses for runs and word starts; returns the
     matched character positions for highlighting. */
  function fuzzyMatch(query, text) {
    const q = query.toLowerCase().replace(/\s+/g, '');
    if (!q) return { score: 0, idx: [] };
    const t = text.toLowerCase();
    let ti = 0;
    let prev = -2;
    let score = 0;
    const idx = [];
    for (const ch of q) {
      const found = t.indexOf(ch, ti);
      if (found < 0) return null;
      let s = 1;
      if (found === prev + 1) s += 4;
      if (found === 0 || /[\s\-_.:/\\›(]/.test(t[found - 1])) s += 6;
      s -= Math.min(found - ti, 12) * 0.15;
      score += s;
      idx.push(found);
      prev = found;
      ti = found + 1;
    }
    const plain = query.toLowerCase().trim();
    if (t.startsWith(plain)) score += 12;
    else if (t.includes(plain)) score += 6;
    score -= t.length * 0.01;
    return { score, idx };
  }
  function rankPalette(query) {
    const q = query.trim();
    if (!q) return paletteEntries.slice();
    const scored = [];
    paletteEntries.forEach((e) => {
      const m = fuzzyMatch(q, e.label);
      if (m) {
        scored.push({ e, score: m.score + (e.type === 'tab' ? 3 : e.type === 'file' ? 1 : 0), idx: m.idx });
        return;
      }
      const words = q.toLowerCase().split(/\s+/).filter(Boolean);
      const hay = (e.detail + ' ' + e.label).toLowerCase();
      if (words.length && words.every((w) => hay.includes(w))) scored.push({ e, score: -5, idx: [] });
    });
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, 60).map((s) => ({ ...s.e, idx: s.idx }));
  }
  function highlightLabel(label, idx) {
    if (!idx || !idx.length) return escapeHtml(label);
    const set = new Set(idx);
    let html = '';
    for (let i = 0; i < label.length; i++) {
      const ch = escapeHtml(label[i]);
      html += set.has(i) ? `<mark>${ch}</mark>` : ch;
    }
    return html;
  }
  function renderPalette() {
    const q = els.paletteInput.value;
    paletteShown = rankPalette(q);
    if (paletteActive >= paletteShown.length) paletteActive = Math.max(0, paletteShown.length - 1);
    const list = els.paletteList;
    list.innerHTML = '';
    if (!paletteShown.length) {
      const empty = document.createElement('div');
      empty.className = 'palette-empty';
      empty.textContent = `Nothing matches “${q.trim()}”.`;
      list.appendChild(empty);
      els.paletteInput.removeAttribute('aria-activedescendant');
      return;
    }
    const grouped = !q.trim();
    const GROUP_TITLES = { tab: 'Open tabs', file: 'Recent files', command: 'Commands' };
    let lastGroup = null;
    paletteShown.forEach((e, i) => {
      if (grouped && e.type !== lastGroup) {
        lastGroup = e.type;
        const g = document.createElement('div');
        g.className = 'palette-group';
        g.textContent = GROUP_TITLES[e.type] || '';
        list.appendChild(g);
      }
      const row = document.createElement('div');
      row.className = 'palette-item' + (i === paletteActive ? ' active' : '');
      row.id = 'palette-opt-' + i;
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', i === paletteActive ? 'true' : 'false');
      row.dataset.index = String(i);
      const ic = document.createElement('span');
      ic.className = 'palette-item-icon';
      ic.innerHTML = e.icon || '';
      const label = document.createElement('span');
      label.className = 'palette-item-label';
      label.innerHTML = highlightLabel(e.label, e.idx);
      const detail = document.createElement('span');
      detail.className = 'palette-item-detail';
      detail.textContent = e.detail || '';
      row.appendChild(ic);
      row.appendChild(label);
      row.appendChild(detail);
      if (e.accel) {
        const acc = document.createElement('span');
        acc.className = 'palette-item-accel';
        acc.innerHTML = e.accel.split('+').filter(Boolean).map((k) => `<kbd>${escapeHtml(k)}</kbd>`).join('');
        row.appendChild(acc);
      }
      row.addEventListener('mousemove', () => {
        if (paletteActive === i) return;
        paletteActive = i;
        paintPaletteActive(false);
      });
      row.addEventListener('mousedown', (ev) => ev.preventDefault());
      row.addEventListener('click', () => runPaletteEntry(i));
      list.appendChild(row);
    });
    paintPaletteActive(true);
  }
  function paintPaletteActive(scroll) {
    els.paletteList.querySelectorAll('.palette-item').forEach((row) => {
      const on = Number(row.dataset.index) === paletteActive;
      row.classList.toggle('active', on);
      row.setAttribute('aria-selected', on ? 'true' : 'false');
      if (on && scroll) row.scrollIntoView({ block: 'nearest' });
    });
    els.paletteInput.setAttribute('aria-activedescendant', 'palette-opt-' + paletteActive);
  }
  function openPalette(initial) {
    if (isModalOpen()) return;
    if (paletteIsOpen()) {
      els.paletteInput.select();
      return;
    }
    closeAccountMenu();
    closeMenus();
    const sel = window.getSelection();
    paletteSaved = {
      el: document.activeElement,
      ranges: sel && sel.rangeCount ? [...Array(sel.rangeCount)].map((_, i) => sel.getRangeAt(i).cloneRange()) : []
    };
    paletteEntries = collectPaletteEntries();
    paletteActive = 0;
    els.paletteInput.value = initial || '';
    els.paletteBackdrop.classList.remove('hidden');
    renderPalette();
    els.paletteInput.focus();
  }
  function closePalette(restore) {
    if (!paletteIsOpen()) return;
    els.paletteBackdrop.classList.add('hidden');
    els.paletteList.innerHTML = '';
    const saved = paletteSaved;
    paletteSaved = null;
    if (restore === false || !saved) return;
    /* Put focus - and the selection an editor command will act on - back
       where they were, as if a menu had been used instead. */
    const el = saved.el;
    if (el && el.isConnected && typeof el.focus === 'function' && el !== document.body) {
      try { el.focus({ preventScroll: true }); } catch {}
      if (saved.ranges.length && (el.isContentEditable || (el.contains && saved.ranges.every((r) => el.contains(r.startContainer))))) {
        try {
          const sel = window.getSelection();
          sel.removeAllRanges();
          saved.ranges.forEach((r) => sel.addRange(r));
        } catch {}
      }
    }
  }
  function runPaletteEntry(i) {
    const e = paletteShown[i];
    if (!e) return;
    closePalette();
    try {
      const r = e.run();
      if (r && typeof r.catch === 'function') r.catch((err) => toast((err && err.message) || 'Command failed', 'error'));
    } catch (err) {
      toast((err && err.message) || 'Command failed', 'error');
    }
  }
  els.paletteInput.addEventListener('input', () => {
    paletteActive = 0;
    renderPalette();
  });
  els.paletteInput.addEventListener('keydown', (e) => {
    const n = paletteShown.length;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (n) { paletteActive = (paletteActive + 1) % n; paintPaletteActive(true); }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (n) { paletteActive = (paletteActive - 1 + n) % n; paintPaletteActive(true); }
    } else if (e.key === 'PageDown' || e.key === 'PageUp') {
      e.preventDefault();
      if (n) {
        paletteActive = Math.max(0, Math.min(n - 1, paletteActive + (e.key === 'PageDown' ? 8 : -8)));
        paintPaletteActive(true);
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      runPaletteEntry(paletteActive);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closePalette();
    } else if (e.key === 'Tab') {
      e.preventDefault();
    }
  });
  els.paletteBackdrop.addEventListener('mousedown', (e) => {
    if (e.target === els.paletteBackdrop) closePalette();
  });

  /* ---------------- session (reopen tabs on launch) ---------------- */
  const SESSION_KEY = 'margo.session';
  let sessionRestoring = false;
  /* Nothing is written until boot has read the last session: the first
     tab-related repaint during startup used to overwrite it with an empty
     one before it could be restored. */
  let sessionLoaded = false;
  function persistSession() {
    if (sessionRestoring || !sessionLoaded) return;
    try {
      const paths = state.tabs.filter((t) => t.doc && t.doc.path).map((t) => t.doc.path);
      const front = findTab(state.activeTabId) || findTab(state.lastActiveTabId);
      localStorage.setItem(SESSION_KEY, JSON.stringify({
        paths,
        active: front && front.doc ? front.doc.path || null : null,
        home: state.view === 'home'
      }));
    } catch {}
  }
  async function restoreSession() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch {}
    if (!saved || !Array.isArray(saved.paths) || !saved.paths.length) return false;
    sessionRestoring = true;
    let opened = 0;
    try {
      for (const p of saved.paths.slice(0, MAX_TABS)) {
        const res = await window.margo.openPath(p);
        if (!res || !res.ok) continue;
        try {
          if (await openInTab(res.doc)) opened += 1;
        } catch {}
      }
    } finally {
      sessionRestoring = false;
    }
    if (!opened) return false;
    sessionLoaded = true;
    const front = saved.active ? findTabByPath(saved.active) : null;
    if (front) await activateTab(front.id);
    if (saved.home) showLanding();
    persistSession();
    return true;
  }

  /* ---------------- files changed outside Margo ---------------- */
  const externalPrompts = new Map();
  function handleExternalChange(ev) {
    const p = ev && ev.path;
    const t = p ? findTabByPath(p) : null;
    if (!t) return;
    syncActiveTab();
    const key = pathKey(p);
    const prev = externalPrompts.get(key);
    if (prev) prev.dismiss();
    const name = (t.doc && t.doc.name) || baseName(p);
    let handle;
    if (ev.kind === 'deleted') {
      /* The open copy is now the only one: it counts as unsaved, so closing
         it asks first and autosave cannot quietly recreate the file. */
      t.orphaned = true;
      markTabDirty(t);
      handle = toast(`${name} was deleted or moved outside Margo. Your copy is still open.`, 'info', {
        duration: 15000,
        actions: [{ label: 'Save as…', primary: true, onClick: async () => { await activateTab(t.id); await saveDoc(true); } }]
      });
    } else {
      t.orphaned = false;
      handle = toast(t.dirty
        ? `${name} changed on disk while you have unsaved changes.`
        : `${name} was changed by another program.`, 'info', {
        duration: 0,
        actions: [
          { label: 'Keep mine', onClick: () => { if (state.tabs.includes(t)) markTabDirty(t); } },
          { label: 'Reload', primary: true, onClick: () => { if (state.tabs.includes(t)) reloadTabFromDisk(t, false); } }
        ]
      });
    }
    externalPrompts.set(key, handle);
  }
  if (typeof window.margo.onFileChangedExternally === 'function') {
    window.margo.onFileChangedExternally(handleExternalChange);
  }

  /* ---------------- home & library wiring ---------------- */
  function paintGreeting() {
    const h = new Date().getHours();
    const part = h < 5 ? 'Good evening' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
    if (els.homeGreeting) els.homeGreeting.textContent = part;
    if (els.homeDate) els.homeDate.textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  }
  function buildNewButtons() {
    if (els.homeNewRow) {
      els.homeNewRow.innerHTML = '';
      availableKinds().forEach((k) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'home-new';
        b.dataset.new = k.kind;
        b.title = `New ${k.long.toLowerCase()}` + (k.kind === settings.defaultKind ? ' (Ctrl+N)' : '');
        b.innerHTML =
          `<span class="home-new-icon icon-${k.kind}">${ICONS[KIND_ICON[k.kind]]}</span>` +
          `<span class="home-new-text"><span class="home-new-label">${escapeHtml(k.label)}</span>` +
          `<span class="home-new-meta">${escapeHtml(k.meta)}</span></span>`;
        b.addEventListener('click', () => newDocGuarded(k.kind));
        els.homeNewRow.appendChild(b);
      });
    }
    if (els.sideNewRow) {
      els.sideNewRow.innerHTML = '';
      availableKinds().forEach((k) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'side-new';
        b.dataset.new = k.kind;
        b.title = `New ${k.long.toLowerCase()}`;
        b.innerHTML = `<span class="side-new-icon icon-${k.kind}">${ICONS[KIND_ICON[k.kind]]}</span><span class="side-new-label"></span>`;
        b.querySelector('.side-new-label').textContent = { doc: 'Doc', sheet: 'Sheet', slides: 'Slides', md: 'Note', pdf: 'PDF' }[k.kind] || k.label;
        b.addEventListener('click', () => newDocGuarded(k.kind));
        els.sideNewRow.appendChild(b);
      });
    }
  }
  function buildTemplates() {
    if (!els.homeTemplates) return;
    els.homeTemplates.innerHTML = '';
    TEMPLATES.filter((t) => kindAvailable(t.kind)).forEach((t) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'home-template';
      b.dataset.template = t.id;
      b.title = `New ${t.label.toLowerCase()} (${t.meta})`;
      const cover = document.createElement('span');
      cover.className = 'tpl-cover';
      cover.style.setProperty('--tpl-tint', `var(--kind-${t.kind})`);
      cover.innerHTML = t.preview() + `<span class="tpl-kind icon-${t.kind}">${ICONS[t.icon]}</span>`;
      const info = document.createElement('span');
      info.className = 'tpl-info';
      info.innerHTML = `<span class="tpl-name">${escapeHtml(t.label)}</span><span class="tpl-meta">${escapeHtml(t.meta)}</span>`;
      b.appendChild(cover);
      b.appendChild(info);
      b.addEventListener('click', () => newFromTemplate(t.id));
      els.homeTemplates.appendChild(b);
    });
  }
  buildNewButtons();
  buildTemplates();
  paintGreeting();
  if (kindAvailable('slides')) {
    const dropHint = els.dropOverlay && els.dropOverlay.querySelector('.drop-overlay-card > span:last-child');
    if (dropHint) dropHint.textContent = 'Word, Excel, PowerPoint, Markdown, CSV and PDF files';
  }
  document.querySelectorAll('[data-icon]').forEach((el) => {
    const icon = ICONS[el.dataset.icon];
    if (icon && !el.innerHTML.trim()) el.innerHTML = icon;
  });
  const cmdIcon = $('cmd-trigger-icon');
  if (cmdIcon) cmdIcon.innerHTML = ICONS.search;
  if (els.btnCommand) els.btnCommand.addEventListener('click', () => openPalette());
  if (els.btnHomePalette) els.btnHomePalette.addEventListener('click', () => openPalette());
  if (els.tabNew) {
    els.tabNew.innerHTML = ICONS.plus;
    els.tabNew.addEventListener('click', () => newDocGuarded(settings.defaultKind));
  }
  $('btn-open-file').addEventListener('click', pickAndOpen);
  if (els.btnHomeOpen) els.btnHomeOpen.addEventListener('click', pickAndOpen);
  const clearRecents = async () => {
    const ok = await confirmModal('Clear recent files?', 'This removes every file from the recent list. The files themselves are not touched.', { confirmLabel: 'Clear' });
    if (!ok) return;
    await window.margo.recents.clear();
    loadRecents();
  };
  els.btnClearRecents.addEventListener('click', clearRecents);
  if (els.btnClearHomeRecents) els.btnClearHomeRecents.addEventListener('click', clearRecents);
  if (els.btnSidebarSettings) {
    const settingsIcon = $('side-settings-icon');
    if (settingsIcon) settingsIcon.innerHTML = ICONS.settings;
    els.btnSidebarSettings.addEventListener('click', () => showSettings(false));
  }
  if (els.btnSideShortcuts) {
    els.btnSideShortcuts.innerHTML = ICONS.keyboard;
    els.btnSideShortcuts.addEventListener('click', showShortcuts);
  }
  if (els.btnSideTheme) els.btnSideTheme.addEventListener('click', toggleScheme);
  if (els.sideGroupBtn) {
    els.sideGroupBtn.innerHTML = ICONS.grid;
    els.sideGroupBtn.addEventListener('click', () => updateSettings({ sideGroup: !settings.sideGroup }) && renderSidebarRecents(lastRecents));
  }
  if (els.sideSearch) {
    els.sideSearch.addEventListener('input', () => renderSidebarRecents(lastRecents));
    els.sideSearch.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && els.sideSearch.value) {
        e.stopPropagation();
        els.sideSearch.value = '';
        renderSidebarRecents(lastRecents);
      } else if (e.key === 'Enter') {
        const first = els.sidebar.querySelector('.recent-card');
        if (first) first.click();
      }
    });
  }
  if (els.homeSearch) {
    els.homeSearch.addEventListener('input', () => renderHomeTiles(lastRecents));
    els.homeSearch.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && els.homeSearch.value) {
        e.stopPropagation();
        els.homeSearch.value = '';
        renderHomeTiles(lastRecents);
      } else if (e.key === 'Enter') {
        const first = els.home.querySelector('.home-tile');
        if (first) first.click();
      }
    });
  }
  els.btnHome.addEventListener('click', () => { if (state.view === 'home') return; showLanding(); });
  /* The greeting and the "2 min ago" labels go stale on a window left open. */
  setInterval(() => {
    if (state.view !== 'home' || document.visibilityState !== 'visible') return;
    paintGreeting();
  }, 60000);

  /* ---------------- drag & drop ---------------- */
  function openableExt(ext) {
    return OPENABLE_EXTS.includes(ext) || (ext === 'pptx' && kindAvailable('slides'));
  }
  let fileDragDepth = 0;
  function dragHasFiles(e) {
    const types = e.dataTransfer && e.dataTransfer.types;
    return !!types && [...types].includes('Files');
  }
  /* Pictures dragged in are for an editor (a page, a slide), not for opening. */
  function dragIsOnlyImages(e) {
    const items = e.dataTransfer && e.dataTransfer.items ? [...e.dataTransfer.items] : [];
    return items.length > 0 && items.every((it) => it.kind === 'file' && /^image\//.test(it.type || ''));
  }
  function hideDropOverlay() {
    fileDragDepth = 0;
    els.dropOverlay.classList.add('hidden');
  }
  document.addEventListener('dragenter', (e) => {
    if (!dragHasFiles(e) || dragIsOnlyImages(e)) return;
    fileDragDepth += 1;
    els.dropOverlay.classList.remove('hidden');
  });
  document.addEventListener('dragleave', (e) => {
    if (!dragHasFiles(e)) return;
    fileDragDepth = Math.max(0, fileDragDepth - 1);
    if (!fileDragDepth) els.dropOverlay.classList.add('hidden');
  });
  document.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('blur', hideDropOverlay);
  document.addEventListener('drop', async (e) => {
    const handledByEditor = e.defaultPrevented;
    e.preventDefault();
    hideDropOverlay();
    if (handledByEditor || !dragHasFiles(e)) return;
    const files = e.dataTransfer.files ? [...e.dataTransfer.files] : [];
    const skipped = [];
    for (const file of files) {
      const p = window.margo.pathForFile(file);
      if (!p) continue;
      if (!openableExt(extOf(p))) {
        skipped.push(file.name);
        continue;
      }
      if (state.tabs.length >= MAX_TABS && !findTabByPath(p)) {
        toast(`Close a tab first — Margo keeps up to ${MAX_TABS} documents open.`);
        break;
      }
      await openFromPath(p);
    }
    if (skipped.length) {
      toast(`Margo can’t open ${skipped.length === 1 ? skipped[0] : skipped.length + ' of those files'}.`, 'error');
    }
  });

  function isDocumentUndoTarget(el) {
    if (!el || !el.closest) return true;
    if (el.closest('#modal-backdrop')) return false;
    if (el.closest('#palette-backdrop')) return false;
    if (el.closest('.doc-find-bar')) return false;
    if (el.closest('#account-menu')) return false;
    if (el.closest('.side-search') || el.closest('.home-library-tools')) return false;
    if (el.closest('.sig-pad') || el.closest('.sig-float') || el.closest('.sig-pad-hint')) return false;
    return true;
  }

  /* ---------------- shortcuts ---------------- */
  document.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    const key = (e.key || '').toLowerCase();
    /* A dialog or the palette owns the keyboard while it is up: Ctrl+W used
       to close the tab behind "Save changes?", and Ctrl+S to start a second
       save underneath it. */
    if (isModalOpen() || paletteIsOpen()) return;
    if (!mod) {
      if (e.key === 'Escape') closeAccountMenu();
      return;
    }
    const inEditor = state.view === 'editor' && !!state.doc;
    const isEditorKey = inEditor && isDocumentUndoTarget(e.target);

    if (!e.shiftKey && !e.altKey && key === 'z') {
      if (isEditorKey) { e.preventDefault(); editCommand('undo'); }
    } else if (!e.altKey && key === 'y') {
      if (isEditorKey) { e.preventDefault(); editCommand('redo'); }
    } else if (e.shiftKey && !e.altKey && key === 'z') {
      if (isEditorKey) { e.preventDefault(); editCommand('redo'); }
    } else if (e.ctrlKey && e.altKey && !e.shiftKey && key === 's') {
      e.preventDefault();
      saveAllTabs();
    } else if (e.ctrlKey && !e.shiftKey && !e.altKey && key === 's') {
      e.preventDefault();
      if (state.view === 'editor') saveDoc(false);
    } else if (e.ctrlKey && e.shiftKey && !e.altKey && key === 's') {
      e.preventDefault();
      if (state.view === 'editor') saveDoc(true);
    } else if (e.ctrlKey && !e.shiftKey && !e.altKey && key === 'o') {
      e.preventDefault();
      pickAndOpen();
    } else if (e.ctrlKey && !e.shiftKey && !e.altKey && key === 'n') {
      e.preventDefault();
      newDocGuarded(settings.defaultKind);
    } else if (e.ctrlKey && !e.shiftKey && !e.altKey && key === 'e') {
      e.preventDefault();
      if (state.view === 'editor') exportPdf();
    } else if (e.ctrlKey && !e.shiftKey && !e.altKey && key === 'p') {
      e.preventDefault();
      if (state.view === 'editor') printDoc();
    } else if (e.ctrlKey && !e.shiftKey && !e.altKey && key === 'f') {
      if (inEditor) {
        e.preventDefault();
        editCommand('find');
      }
    } else if (e.ctrlKey && !e.shiftKey && !e.altKey && key === 'w') {
      e.preventDefault();
      if (state.view === 'editor') closeActiveTab();
    } else if (e.ctrlKey && e.shiftKey && !e.altKey && key === 't') {
      e.preventDefault();
      reopenClosedTab();
    } else if (e.ctrlKey && e.key === 'Tab') {
      e.preventDefault();
      cycleTabs(e.shiftKey ? -1 : 1);
    } else if (e.ctrlKey && !e.shiftKey && !e.altKey && (e.key === 'PageDown' || e.key === 'PageUp')) {
      if (e.defaultPrevented) return;
      e.preventDefault();
      cycleTabs(e.key === 'PageDown' ? 1 : -1);
    } else if (e.ctrlKey && !e.shiftKey && !e.altKey && /^[1-9]$/.test(e.key)) {
      if (e.defaultPrevented || !state.tabs.length) return;
      e.preventDefault();
      activateTabAt(Number(e.key));
    } else if (!e.shiftKey && !e.altKey && key === 'k') {
      if (e.defaultPrevented) return;
      e.preventDefault();
      openPalette();
    } else if (e.shiftKey && !e.altKey && key === 'p') {
      e.preventDefault();
      openPalette();
    } else if (!e.altKey && (e.key === '/' || e.code === 'Slash')) {
      if (e.defaultPrevented) return;
      e.preventDefault();
      showShortcuts();
    } else if (!e.shiftKey && !e.altKey && e.key === ',') {
      e.preventDefault();
      showSettings(false);
    } else if (!e.shiftKey && !e.altKey && e.key === '\\') {
      if (e.defaultPrevented) return;
      e.preventDefault();
      toggleSidebarPin();
      if (sidebarPinned) openSidebar();
    } else if (!e.shiftKey && (e.key === '=' || e.key === '+' || e.code === 'NumpadAdd')) {
      if (state.view === 'editor' && state.editor && state.editor.commands && state.editor.commands.zoomIn) {
        e.preventDefault();
        state.editor.commands.zoomIn();
      }
    } else if (!e.shiftKey && (e.key === '-' || e.code === 'NumpadSubtract')) {
      if (state.view === 'editor' && state.editor && state.editor.commands && state.editor.commands.zoomOut) {
        e.preventDefault();
        state.editor.commands.zoomOut();
      }
    } else if (!e.shiftKey && e.key === '0') {
      if (state.view === 'editor' && state.editor && state.editor.commands && state.editor.commands.zoomReset) {
        e.preventDefault();
        state.editor.commands.zoomReset();
      }
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      flushAllDrafts();
      persistSession();
    }
  });
  /* The main process vetoes every close and waits on this handler, so anything
     that throws in here used to strand the window open for good: the title bar
     X would silently do nothing and the app could only be killed from Task
     Manager. Each step is isolated so one failure cannot swallow the close,
     and a tab whose dirty state cannot be resolved asks the author what to do
     rather than guessing - closing anyway would throw away their work, and
     staying open forever is the bug being fixed. */
  async function confirmCloseAfterError(tab) {
    const name = (tab && tab.doc && tab.doc.name) || (state.doc && state.doc.name) || 'this document';
    const body = document.createElement('div');
    body.innerHTML =
      `<div class="modal-lead">Margo could not check <strong>${escapeHtml(name)}</strong> for unsaved changes.</div>` +
      `<div class="modal-detail">Closing now may lose changes that were never written to disk.</div>`;
    const choice = await openModal('Close anyway?', body, [
      { label: 'Keep Margo open', value: 'cancel' },
      { label: 'Close anyway', primary: true, value: 'close' }
    ]);
    return choice === 'close';
  }

  window.margo.onCloseRequest(async () => {
    try {
      try { window.margo.closeAck(true); } catch (err) { console.error('close: ack failed', err); }
      try { closePalette(false); } catch {}
      try { syncActiveTab(); } catch (err) { console.error('close: syncActiveTab failed', err); }
      try { persistSession(); } catch {}
      try { await flushAllDrafts(); } catch (err) { console.error('close: flushAllDrafts failed', err); }

      for (const t of [...state.tabs]) {
        if (!t.dirty) continue;
        try {
          await activateTab(t.id);
          if (!(await resolveDirty())) return;
          t.dirty = state.dirty;
        } catch (err) {
          console.error('close: could not resolve unsaved changes', err);
          if (!(await confirmCloseAfterError(t))) return;
        }
      }
    } catch (err) {
      /* The prompt itself is broken, so there is no way left to ask here. Hand
         the decision back to main, which can still offer a native dialog this
         renderer cannot block, and leave the work intact until the author
         answers it. */
      console.error('close: handler failed', err);
      try { window.margo.closeAck(false); } catch {}
      return;
    }
    window.margo.closeNow();
  });
  window.margo.onOpenFile((p) => openFromPath(p));

  /* ---------------- boot ---------------- */
  async function boot() {
    if (window.pdfjsLib) {
      pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
    }
    menubarApi = window.MargoMenubar.attach(els.menubar, menuSpec);
    applySidebarMode();
    applySettings();
    applyTheme(await window.margo.theme.get(), false);
    refreshHeader();
    await refreshGoogle();
    await loadRecents();
    applyViewMode();
    const smoke = !!(window.margo.isSmoke && window.margo.isSmoke());
    const recovered = await offerRecovery();
    let reopened = false;
    if (!recovered && !smoke && settings.reopenSession) {
      try { reopened = await restoreSession(); } catch { reopened = false; }
    }
    sessionLoaded = true;
    persistSession();
    if (!recovered && !reopened && await window.margo.firstRun()) {
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
        if (t) {
          t.dirty = false;
          t.savedAt = Date.now();
        }
        await clearDraft(t);
        syncActiveTab();
        refreshSaveState(t);
        try { await window.margo.google.push({ path, name: state.doc.name }); } catch {}
      }
      return res;
    },
    getEditor: () => state.editor,
    exportTo: (path) => exportPdf(path),
    exportPdf,
    openSidebar,
    closeSidebar,
    loadRecents,
    applyTheme,
    toast,
    openModal,
    closeModal,
    showSettings,
    showShortcuts,
    shareDoc,
    flushDrafts: flushAllDrafts,
    restoreDrafts: () => restoreDrafts(),
    discardDrafts: () => window.margo.drafts.clear(),
    palette: {
      open: openPalette,
      close: closePalette,
      isOpen: paletteIsOpen,
      entries: () => paletteShown.map((e) => ({ type: e.type, label: e.label, detail: e.detail })),
      fuzzy: fuzzyMatch
    },
    settings: {
      get: () => ({ ...settings }),
      update: updateSettings,
      reload: () => { settings = readSettings(); applySettings(); return { ...settings }; },
      key: SETTINGS_KEY
    },
    templates: () => TEMPLATES.map((t) => ({ id: t.id, kind: t.kind, label: t.label })),
    newFromTemplate,
    runAutosave,
    saveTab,
    findTab,
    markTabDirty,
    reloadTabFromDisk,
    handleExternalChange,
    persistSession,
    restoreSession,
    togglePin,
    isPinned,
    thumbBackfill: {
      state: () => ({
        queued: thumbBackfillQueue.slice(),
        deferred: thumbBackfillDeferred.slice(),
        seen: [...thumbBackfillSeen],
        running: thumbBackfillRunning
      }),
      reset: () => {
        thumbBackfillQueue.length = 0;
        thumbBackfillDeferred.length = 0;
        thumbBackfillSeen.clear();
      },
      queue: (p) => {
        if (!thumbBackfillQueue.includes(p)) thumbBackfillQueue.push(p);
        runThumbBackfill();
      }
    }
  };

  boot();
})();
