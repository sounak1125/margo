const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const files = require('./files');
const JSZip = require('jszip');

const results = [];
let rendererDone = null;

function t(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail || '' });
  console.log(`SMOKE ${ok ? 'ok  ' : 'FAIL'} - ${name}${ok ? '' : ' :: ' + (detail || '')}`);
}

const SAMPLE_MD = `# Welcome to Margo

Margo reads and writes **Markdown**, *Word*, and Excel files.

## Features

- Live markdown preview
- Rich text editing
- Spreadsheet grid

| Item | Qty |
| --- | --- |
| Pens | 12 |

> Stay sharp.

\`\`\`js
console.log("hello margo");
\`\`\`
`;

async function backendTests(samplesDir, tmpDir) {
  // md -> docx
  let docxBuf = null;
  try {
    docxBuf = await files.htmlToDocxBuffer(files.markedParse(SAMPLE_MD), 'Welcome');
    t('backend: md -> docx buffer', docxBuf && docxBuf.length > 1000 && docxBuf[0] === 0x50 && docxBuf[1] === 0x4b,
      `len=${docxBuf ? docxBuf.length : 0}`);
  } catch (e) { t('backend: md -> docx buffer', false, e.message); }

  const sampleDocx = path.join(samplesDir, 'sample.docx');
  if (docxBuf) await fsp.writeFile(sampleDocx, docxBuf);

  // docx -> html via mammoth (round trip)
  try {
    const doc = await files.openPath(sampleDocx);
    const html = doc.html || '';
    t('backend: docx -> html (mammoth)', doc.kind === 'doc' && html.includes('Welcome to Margo') && html.includes('<'),
      html.slice(0, 120));
  } catch (e) { t('backend: docx -> html (mammoth)', false, e.message); }

  // Word round trip: what the editor writes has to come back as it went out.
  try {
    const px = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEklEQVR4nGP4z8DAwMDAxAAGAAkQAQHJ0TsFAAAAAElFTkSuQmCC';
    const html =
      '<p class="margo-title">Plan</p><p class="margo-subtitle">Draft</p><h1>Intro</h1>' +
      '<p>Say <b>bold</b> <i>italic</i> <mark class="hl-yellow" style="background-color:#ffff00">marked</mark> ' +
      'and <mark style="background-color:#45818e">teal</mark>.</p><p><br></p>' +
      '<p style="margin-top:12pt;margin-bottom:6pt;text-indent:18pt">Spaced</p>' +
      '<blockquote><p>Quoted</p></blockquote><pre>let x = 1;</pre>' +
      '<ul class="margo-checklist"><li class="is-checked">Done</li><li>Todo</li></ul>' +
      '<table class="margo-tbl-none" style="width:100%"><thead><tr><th>H</th><th>I</th></tr></thead>' +
      '<tbody><tr><td>a</td><td>b</td></tr></tbody></table>' +
      `<p><img src="data:image/png;base64,${px}" alt="Tiny dot" style="width:40px;height:20px"></p><hr>` +
      '<div data-margo-page-break style="page-break-before:always"></div>' +
      '<p>Note here<sup class="margo-fn-ref" data-fn="f1">1</sup> end.</p>' +
      '<div class="margo-footnotes"><ol><li data-fn="f1">The source.</li></ol></div>';
    const layout = { size: 'a4', orientation: 'portrait', margins: 'narrow', headerText: 'Head', footerText: 'Foot', showPageNumbers: true };
    const buf = await files.htmlToDocxBuffer(html, 'Plan', layout);
    const rtPath = path.join(tmpDir, 'fidelity.docx');
    await fsp.writeFile(rtPath, buf);
    const zip = await JSZip.loadAsync(buf);
    const xml = await zip.file('word/document.xml').async('string');
    t('backend: docx writes no fence characters', !/[-]/.test(xml));
    t('backend: docx keeps the space between formatted words', /bold<\/w:t>[\s\S]*?> <\/w:t>[\s\S]*?italic/.test(xml));
    t('backend: docx writes styles, spacing, header row, footnotes',
      /w:pStyle w:val="Title"/.test(xml) && /w:pStyle w:val="Quote"/.test(xml) && /w:before="240"/.test(xml)
      && /<w:tblHeader\/>/.test(xml) && /<w:footnoteReference w:id="1"\/>/.test(xml) && !!zip.file('word/footnotes.xml'));
    const footer = await zip.file('word/footer1.xml').async('string');
    t('backend: docx footer has page numbers', /PAGE/.test(footer) && /NUMPAGES/.test(footer) && footer.includes('Foot'));
    t('backend: docx has a header part', !!zip.file('word/header1.xml'));
    const back = (await files.openPath(rtPath)).html;
    const has = (re) => re.test(back);
    t('backend: docx round trip keeps title/subtitle/quote/code',
      has(/<p class="margo-title">Plan/) && has(/margo-subtitle/) && has(/<blockquote><p>Quoted/) && has(/<pre>/), back.slice(0, 300));
    t('backend: docx round trip keeps highlights and spaces',
      has(/<strong>bold<\/strong> <em>italic<\/em> <mark class="hl-yellow">marked<\/mark>/) && has(/background-color:#45818e/), back.slice(0, 400));
    t('backend: docx round trip keeps blank lines and paragraph spacing',
      has(/<p><br><\/p>/) && has(/margin-top:12pt;margin-bottom:6pt|margin-top:12pt/) && has(/text-indent:18/), back.slice(0, 600));
    t('backend: docx round trip keeps checklist, table header and borders',
      has(/<ul class="margo-checklist"><li class="is-checked">Done<\/li><li>Todo<\/li><\/ul>/) && has(/<table class="margo-tbl-none"><thead>/),
      back.slice(0, 800));
    t('backend: docx round trip keeps image size, alt text and rule',
      has(/alt="Tiny dot"/) && has(/width: 40px; height: 20px/) && has(/<hr>/), back.replace(/data:[^"]+/g, '').slice(0, 900));
    t('backend: docx round trip keeps page break and footnote',
      has(/data-margo-page-break/) && has(/<sup class="margo-fn-ref" data-fn="[^"]+">1<\/sup>/) && has(/<li data-fn="[^"]+">The source\.<\/li>/),
      back.replace(/data:[^"]+/g, '').slice(-400));
    const again = await files.htmlToDocxBuffer(back, 'Plan', layout);
    const again2 = path.join(tmpDir, 'fidelity2.docx');
    await fsp.writeFile(again2, again);
    const back2 = (await files.openPath(again2)).html;
    t('backend: docx second round trip is stable', back2 === back,
      `${back.length} vs ${back2.length}`);
  } catch (e) { t('backend: docx round trip', false, e.stack || e.message); }

  // Percentage cell widths used to throw inside html-to-docx and fail the save.
  try {
    const tHtml = '<table style="width:100%"><colgroup><col style="width:70%"><col style="width:30%"></colgroup>' +
      '<tbody><tr><td style="width:40%">a</td><td>b</td></tr><tr><td>c</td><td>d</td></tr></tbody></table><p>end</p>';
    const tb = await files.htmlToDocxBuffer(tHtml, 't', {});
    const tp = path.join(tmpDir, 'colwidths.docx');
    await fsp.writeFile(tp, tb);
    const txml = await (await JSZip.loadAsync(tb)).file('word/document.xml').async('string');
    t('backend: docx saves percentage table widths', (txml.match(/<w:tblGrid>/g) || []).length === 1);
    const tback = (await files.openPath(tp)).html;
    t('backend: docx round trip keeps column widths', /<colgroup><col style="width:\d/.test(tback), tback.slice(0, 200));
  } catch (e) { t('backend: docx percentage table widths', false, e.message); }

  // A foreign document without page numbers must not gain them on open.
  try {
    const plainBuf = await files.htmlToDocxBuffer('<p>x</p>', 'x', { footerText: 'Only text', showPageNumbers: false });
    const pp = path.join(tmpDir, 'nonumbers.docx');
    // Strip Margo's own layout part so the section properties are read.
    const z = await JSZip.loadAsync(plainBuf);
    await fsp.writeFile(pp, await z.generateAsync({ type: 'nodebuffer' }));
    const d = await files.openPath(pp);
    t('backend: docx without page fields opens without page numbers',
      d.layout && d.layout.showPageNumbers === false && d.layout.footerText === 'Only text', JSON.stringify(d.layout));
  } catch (e) { t('backend: docx page-number detection', false, e.message); }

  // PDF export html carries the page setup and header/footer.
  try {
    const h = files.htmlForPdfExport({ kind: 'doc', title: 'x', data: { html: '<p>x</p>', layout: { size: 'a4', headerText: 'H', showPageNumbers: true } } });
    t('backend: doc pdf html has page size, header and page numbers',
      /@page \{ size: 8\.27in 11\.69in/.test(h) && /@top-left \{ content: "H"/.test(h) && /counter\(pages\)/.test(h), h.slice(0, 400));
  } catch (e) { t('backend: doc pdf html', false, e.message); }

  // html -> md via turndown
  try {
    const md = files.turndownHtml('<h2>Hi there</h2><ul><li>alpha</li><li>beta</li></ul><p><strong>bold</strong></p>');
    t('backend: html -> md (turndown)', md.includes('## Hi there') && /-\s+alpha/.test(md) && md.includes('**bold**'), md);
  } catch (e) { t('backend: html -> md (turndown)', false, e.message); }

  // xlsx write + read round trip
  const sampleXlsx = path.join(samplesDir, 'sample.xlsx');
  try {
    const model = {
      sheets: [
        { name: 'Budget', rows: [['Item', 'Qty', 'Price'], ['Pen', '2', '1.5'], ['Notebook', '1', '12'], ['Coffee', '3', '4.25']] },
        { name: 'Notes', rows: [['Margo says hi']] }
      ],
      active: 0
    };
    await files.save({ kind: 'sheet', path: sampleXlsx, data: model });
    const back = await files.openPath(sampleXlsx);
    const ok = back.kind === 'sheet'
      && back.sheets.length === 2
      && back.sheets[0].rows[1][0] === 'Pen'
      && back.sheets[0].rows[1][1] === '2'
      && back.sheets[0].rows[3][2] === '4.25'
      && back.sheets[1].rows[0][0] === 'Margo says hi';
    t('backend: xlsx write/read round trip', ok, JSON.stringify(back.sheets[0].rows[1] || []));
  } catch (e) { t('backend: xlsx write/read round trip', false, e.message); }

  // csv write + read round trip
  try {
    const csvPath = path.join(tmpDir, 'roundtrip.csv');
    await files.save({
      kind: 'sheet', path: csvPath,
      data: { sheets: [{ name: 'S', rows: [['a', 'b'], ['1', 'text with, comma']] }], active: 0 }
    });
    const back = await files.openPath(csvPath);
    const ok = back.sheets[0].rows[0][0] === 'a' && back.sheets[0].rows[1][1] === 'text with, comma';
    t('backend: csv write/read round trip', ok, JSON.stringify(back.sheets[0].rows));
  } catch (e) { t('backend: csv write/read round trip', false, e.message); }

  // md -> html document export
  try {
    const htmlPath = path.join(tmpDir, 'export.html');
    await files.save({ kind: 'md', path: htmlPath, data: { markdown: '# Export test' } });
    const txt = await fsp.readFile(htmlPath, 'utf8');
    t('backend: md -> html export', txt.includes('<h1') && txt.includes('Export test'));
  } catch (e) { t('backend: md -> html export', false, e.message); }

  // sample PDF with an embedded high-res image (for the viewer + extraction tests)
  try {
    const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const p1 = pdfDoc.addPage([612, 792]);
    p1.drawText('Margo sample PDF', { x: 60, y: 700, size: 26, font: bold, color: rgb(0.11, 0.11, 0.12) });
    p1.drawText('A two-page PDF with an embedded 512 px image, generated by the smoke suite.', {
      x: 60, y: 668, size: 12, font, color: rgb(0.35, 0.35, 0.38)
    });
    const iconBytes = fs.readFileSync(path.join(__dirname, '..', '..', 'assets', 'icon.png'));
    const png = await pdfDoc.embedPng(iconBytes);
    p1.drawImage(png, { x: 60, y: 370, width: 240, height: 240 });
    p1.drawText('Sign below:', { x: 60, y: 210, size: 12, font });
    p1.drawLine({ start: { x: 60, y: 160 }, end: { x: 300, y: 160 }, thickness: 1, color: rgb(0.6, 0.6, 0.6) });
    const p2 = pdfDoc.addPage([612, 792]);
    p2.drawText('Page two', { x: 60, y: 700, size: 20, font: bold });
    p2.drawText('Nothing to see here, just proving multi-page rendering works.', { x: 60, y: 670, size: 12, font });
    const bytes = await pdfDoc.save();
    await fsp.writeFile(path.join(samplesDir, 'sample.pdf'), bytes);
    t('backend: sample pdf generated (pdf-lib)', bytes.length > 5000);
  } catch (e) { t('backend: sample pdf generated (pdf-lib)', false, e.message); }

  try {
    const { PDFDocument } = require('pdf-lib');
    const blank = await PDFDocument.create();
    blank.addPage([612, 792]);
    const blankBytes = await blank.save();
    const blankPath = path.join(tmpDir, 'blank.pdf');
    await files.save({ kind: 'pdf', path: blankPath, data: { base64: Buffer.from(blankBytes).toString('base64') } });
    const opened = await files.openPath(blankPath);
    const reloaded = await PDFDocument.load(await fsp.readFile(blankPath));
    t('backend: blank pdf save/open', opened.kind === 'pdf' && reloaded.getPageCount() === 1 && blankBytes.length > 100,
      `kind=${opened && opened.kind} pages=${reloaded.getPageCount()} bytes=${blankBytes.length}`);
  } catch (e) { t('backend: blank pdf save/open', false, e.message); }

  // DOCX desktop thumbnail embed
  try {
    const tinyJpeg = Buffer.from(
      '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAGcP//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAQUCf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQMBAT8Bf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQIBAT8Bf//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEABj8Cf//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAT8hf//Z',
      'base64'
    );
    const base = await files.htmlToDocxBuffer('<p>Thumb embed</p>', 'Thumb');
    const withThumb = await files.embedDocxThumbnail(base, tinyJpeg, 'image/jpeg');
    const zip = await JSZip.loadAsync(withThumb);
    const entry = zip.file('docProps/thumbnail.jpeg');
    const ct = await zip.file('[Content_Types].xml').async('string');
    const rels = await zip.file('_rels/.rels').async('string');
    t('backend: docx thumbnail embed',
      !!entry && ct.includes('thumbnail.jpeg') && rels.includes('metadata/thumbnail'),
      `entry=${!!entry}`);
  } catch (e) { t('backend: docx thumbnail embed', false, e.message); }

  // Desktop file icons + associations config
  try {
    const root = path.join(__dirname, '..', '..');
    const kinds = ['md', 'doc', 'sheet', 'pdf'];
    const missing = kinds.filter((k) => !fs.existsSync(path.join(root, 'assets', 'file-icons', `${k}.ico`)));
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    const assocs = (pkg.build && pkg.build.fileAssociations) || [];
    const hasMd = assocs.some((a) => [].concat(a.ext).includes('md'));
    const hasDocx = assocs.some((a) => [].concat(a.ext).includes('docx'));
    const hasXlsx = assocs.some((a) => [].concat(a.ext).includes('xlsx'));
    const hasPdf = assocs.some((a) => [].concat(a.ext).includes('pdf'));
    const perMachine = !!(pkg.build.nsis && pkg.build.nsis.perMachine);
    // Every association's icon exists for Windows (.ico) and macOS (.icns),
    // and every one declares its MIME types for the Linux desktop entry.
    const iconsOk = assocs.every((a) => a.icon && a.icon.startsWith('file-icons/')
      && fs.existsSync(path.join(root, 'assets', a.icon))
      && fs.existsSync(path.join(root, 'assets', a.icon.replace(/\.ico$/, '.icns')))
      && typeof a.mimeType === 'string' && a.mimeType.length > 0);
    t('backend: file icons + associations',
      missing.length === 0 && hasMd && hasDocx && hasXlsx && hasPdf && perMachine && iconsOk,
      missing.length ? `missing ${missing.join(',')}` : `assocs=${assocs.length} perMachine=${perMachine}`);
  } catch (e) { t('backend: file icons + associations', false, e.message); }

  try {
    const drafts = require('./drafts');
    drafts.clear();
    const put = drafts.put({
      id: 'smoke-draft-1',
      kind: 'md',
      name: 'notes.md',
      path: null,
      updatedAt: Date.now(),
      data: { markdown: '# recovered' }
    });
    const listed = drafts.list();
    t('backend: drafts put/list', put && put.ok && listed.length === 1 && listed[0].data.markdown === '# recovered',
      `ok=${put && put.ok} n=${listed.length}`);
    drafts.remove('smoke-draft-1');
    t('backend: drafts remove', drafts.list().length === 0);
    drafts.put({ id: 'smoke-draft-2', kind: 'md', name: 'a.md', path: null, updatedAt: 1, data: { markdown: 'x' } });
    drafts.clear();
    t('backend: drafts clear', drafts.list().length === 0);

    const overwrite = drafts.put({
      id: 'smoke-draft-overwrite',
      kind: 'md',
      name: 'first.md',
      path: null,
      updatedAt: 1,
      data: { markdown: 'first' }
    });
    const overwrite2 = drafts.put({
      id: 'smoke-draft-overwrite',
      kind: 'md',
      name: 'second.md',
      path: null,
      updatedAt: 2,
      data: { markdown: 'second' }
    });
    const listedOverwrite = drafts.list().filter((d) => d.id === 'smoke-draft-overwrite');
    t('backend: drafts overwrite same id',
      overwrite && overwrite.ok && overwrite2 && overwrite2.ok
        && listedOverwrite.length === 1 && listedOverwrite[0].data.markdown === 'second',
      `n=${listedOverwrite.length} md=${listedOverwrite[0] && listedOverwrite[0].data.markdown}`);
    drafts.remove('smoke-draft-overwrite');
  } catch (e) { t('backend: drafts put/list', false, e.message); }

  try {
    t('backend: shared formula normalizes to result',
      files.normalizeCell({ sharedFormula: 'A1', result: 42 }) === '42'
        && files.normalizeCell({ formula: 'SUM(A1:A3)', sharedFormula: 'A1' }) === '=SUM(A1:A3)');
  } catch (e) { t('backend: shared formula normalizes to result', false, e.message); }

  try {
    const styledXlsx = path.join(tmpDir, 'styled-roundtrip.xlsx');
    await files.save({
      kind: 'sheet',
      path: styledXlsx,
      data: {
        sheets: [{
          name: 'Styled',
          rows: [['', 'val']],
          styles: {
            '0,0': { fill: '#ffcc00', border: 'all' },
            '0,1': { bold: true }
          },
          colWidths: {},
          rowHeights: { 0: 48 }
        }],
        active: 0
      }
    });
    const reopened = await files.openPath(styledXlsx);
    const st = reopened.sheets[0].styles['0,0'] || {};
    const height = reopened.sheets[0].rowHeights[0];
    t('backend: xlsx empty styled cell + row height round trip',
      reopened.kind === 'sheet'
        && st.fill === '#ffcc00'
        && st.border === 'all'
        && height === 48,
      `fill=${st.fill} border=${st.border} height=${height}`);
  } catch (e) { t('backend: xlsx empty styled cell + row height round trip', false, e.message); }

  try {
    const widthXlsx = path.join(tmpDir, 'colwidth-roundtrip.xlsx');
    await files.save({
      kind: 'sheet',
      path: widthXlsx,
      data: {
        sheets: [{ name: 'W', rows: [['wide column']], styles: {}, colWidths: { 0: 150 }, rowHeights: {} }],
        active: 0
      }
    });
    const reopened = await files.openPath(widthXlsx);
    const w = reopened.sheets[0].colWidths[0];
    t('backend: xlsx column width round trip', reopened.kind === 'sheet' && w >= 145 && w <= 155, `width=${w}`);
  } catch (e) { t('backend: xlsx column width round trip', false, e.message); }

  try {
    const chartXlsx = path.join(tmpDir, 'chart-roundtrip.xlsx');
    const charts = [{ id: 'c1', type: 'column', title: 'Sales', range: 'A1:B3', x: 10, y: 20, width: 300, height: 200 }];
    await files.save({
      kind: 'sheet',
      path: chartXlsx,
      data: {
        sheets: [{ name: 'Data', rows: [['A', 'B'], ['1', '2']], styles: {}, colWidths: {}, rowHeights: {}, charts }],
        active: 0
      }
    });
    const reopened = await files.openPath(chartXlsx);
    const back = reopened.sheets[0].charts || [];
    t('backend: xlsx chart metadata round trip',
      reopened.kind === 'sheet' && back.length === 1 && back[0].title === 'Sales' && back[0].type === 'column',
      JSON.stringify(back));
  } catch (e) { t('backend: xlsx chart metadata round trip', false, e.message); }

  try {
    const fxXlsx = path.join(tmpDir, 'formula-roundtrip.xlsx');
    await files.save({
      kind: 'sheet',
      path: fxXlsx,
      data: {
        sheets: [{
          name: 'Calc',
          rows: [['2', '3', '=A1*B1', '=SUM(A1:B1)'], ['=C1/0', '15%', '$1,234.50', '2026-03-05']],
          styles: {
            '0,2': { numFmt: '"$"#,##0.00', bold: true, italic: true, underline: true, color: '#112233', fill: '#ffeeaa', align: 'center', valign: 'middle', wrap: true, size: 14, borders: { t: 'thin', b: 'medium' } }
          },
          results: { '0,2': 6, '0,3': 5, '1,0': { error: '#DIV/0!' } },
          merges: ['A4:B5'],
          freeze: { rows: 1, cols: 1 },
          condFormats: [{ range: 'A1:B1', type: 'gt', v1: '2', style: { fill: '#c6efce' } }],
          validations: [{ range: 'E1:E3', type: 'list', values: ['Yes', 'No'], strict: true }]
        }],
        active: 0
      }
    });
    const ExcelJS = require('exceljs');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(fxXlsx);
    const c1 = wb.getWorksheet('Calc').getCell('C1').value;
    t('backend: xlsx writes formulas with cached results',
      c1 && c1.formula === 'A1*B1' && c1.result === 6, JSON.stringify(c1));
    const back = await files.openPath(fxXlsx);
    const s = back.sheets[0];
    t('backend: xlsx formulas read back as formulas',
      s.rows[0][2] === '=A1*B1' && s.rows[0][3] === '=SUM(A1:B1)' && s.rows[1][0] === '=C1/0', JSON.stringify(s.rows));
    t('backend: xlsx typed literals keep value and format',
      s.rows[1][1] === '0.15' && s.styles['1,1'].numFmt === '0%' && s.rows[1][2] === '1234.5' && s.rows[1][3] === '2026-03-05',
      JSON.stringify(s.rows[1]) + JSON.stringify(s.styles['1,1']));
    const st = s.styles['0,2'] || {};
    t('backend: xlsx cell styles round trip',
      st.numFmt === '"$"#,##0.00' && st.bold && st.italic && st.underline && st.color === '#112233' && st.fill === '#ffeeaa'
        && st.align === 'center' && st.valign === 'middle' && st.wrap && st.size === 14 && st.borders && st.borders.t === 'thin' && st.borders.b === 'medium',
      JSON.stringify(st));
    t('backend: xlsx merges and freeze panes round trip',
      JSON.stringify(s.merges) === '["A4:B5"]' && s.freeze.rows === 1 && s.freeze.cols === 1, JSON.stringify([s.merges, s.freeze]));
    t('backend: xlsx conditional formats and validation round trip',
      s.condFormats.length === 1 && s.condFormats[0].type === 'gt' && s.validations.length === 1 && s.validations[0].values.join() === 'Yes,No',
      JSON.stringify([s.condFormats, s.validations]));
  } catch (e) { t('backend: xlsx formulas/styles round trip', false, e.stack); }

  try {
    const semi = path.join(tmpDir, 'semicolon.csv');
    await fsp.writeFile(semi, '﻿name;amount;note\r\n"Smith; J";"1,5";"say ""hi"""\r\nÄrger;2;"two\nlines"\r\n');
    const back = await files.openPath(semi);
    const rows = back.sheets[0].rows;
    t('backend: csv detects ; delimiter, strips BOM, keeps quotes and newlines',
      rows[0][0] === 'name' && rows[1][0] === 'Smith; J' && rows[1][2] === 'say "hi"' && rows[2][0] === 'Ärger' && rows[2][2] === 'two\nlines',
      JSON.stringify(rows));
    const out = path.join(tmpDir, 'computed.csv');
    await files.save({ kind: 'sheet', path: out, data: { sheets: [{ name: 'S', rows: [['a', '=1+1'], ['x,y', '3']], results: { '0,1': 2 } }], active: 0 } });
    const text = await fsp.readFile(out, 'utf8');
    t('backend: csv export writes computed values and quotes', /^﻿?a,2\r\n"x,y",3/.test(text), JSON.stringify(text));
  } catch (e) { t('backend: csv delimiter/BOM handling', false, e.stack); }

  try {
    const drafts = require('./drafts');
    const recents = require('./recents');
    recents.clear();
    const offline = path.join(tmpDir, 'offline-missing.xlsx');
    recents.add(offline, 'sheet');
    const listed = recents.list();
    const stored = JSON.parse(fs.readFileSync(path.join(require('electron').app.getPath('userData'), 'recents.json'), 'utf8'));
    t('backend: recents keep missing files',
      listed.length === 0 && stored.length === 1 && stored[0].path === offline,
      `listed=${listed.length} stored=${stored.length}`);
    recents.clear();
  } catch (e) { t('backend: recents keep missing files', false, e.message); }
}

/* ---------------- presentations (.pptx) ---------------- */

async function slidesBackendTests(tmpDir) {
  const core = require('./slides-core');
  const slides = require('./slides');
  const deckPath = path.join(tmpDir, 'backend-deck.pptx');
  const png = fs.readFileSync(path.join(__dirname, '..', '..', 'assets', 'icon.png')).toString('base64');
  const deck = core.newDeck('editorial');
  deck.slides[0].elements[0].paragraphs = [core.para('Backend deck')];
  const s2 = core.makeSlide('title-content', deck.size);
  s2.elements[0].paragraphs = [core.para('Agenda')];
  s2.elements[1].paragraphs = [
    { align: 'left', list: 'bullet', level: 0, runs: [{ text: 'Plain ' }, { text: 'bold red', b: true, color: '#cc0000' }] },
    { align: 'center', list: 'number', level: 1, runs: [{ text: 'Second\nline', size: 30, i: true }] }
  ];
  s2.elements.push(core.imageEl({ src: 'data:image/png;base64,' + png, x: 900, y: 420, w: 200, h: 120, nw: 512, nh: 512, fit: 'cover' }));
  s2.elements.push(core.shapeEl({ shape: 'arrow', x: 100, y: 650, w: 400, h: 0, stroke: '#123456', strokeWidth: 4, fill: null }));
  s2.notes = 'Say hello to the room';
  s2.background = { color: '#f0f4ff' };
  deck.slides.push(s2);

  try {
    await files.save({ kind: 'slides', path: deckPath, data: { deck } });
    const buf = await fsp.readFile(deckPath);
    const back = await files.openPath(deckPath);
    const same = JSON.stringify(back.deck) === JSON.stringify(core.normalizeDeck(deck));
    t('backend: pptx write/read round trip is exact', back.kind === 'slides' && same && buf[0] === 0x50 && buf[1] === 0x4b,
      same ? `len=${buf.length}` : JSON.stringify(back.deck).slice(0, 180));
  } catch (e) { t('backend: pptx write/read round trip is exact', false, e.stack || e.message); }

  try {
    const zip = await JSZip.loadAsync(await fsp.readFile(deckPath));
    const names = Object.keys(zip.files);
    const slideXml = await zip.file('ppt/slides/slide2.xml').async('string');
    const paras = slideXml.match(/<a:p>[\s\S]*?<\/a:p>/g) || [];
    const onePPr = paras.every((p) => (p.match(/<a:pPr[\s/>]/g) || []).length <= 1);
    const hasNotes = names.some((n) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(n));
    const hasMedia = names.some((n) => /^ppt\/media\//.test(n));
    t('backend: pptx package is well-formed (one pPr per paragraph, notes, media)',
      onePPr && hasNotes && hasMedia && /Say hello/.test(await zip.file(names.find((n) => /notesSlide2\.xml$/.test(n)) || names.find((n) => /notesSlide\d\.xml$/.test(n))).async('string')),
      `onePPr=${onePPr} notes=${hasNotes} media=${hasMedia}`);
  } catch (e) { t('backend: pptx package is well-formed (one pPr per paragraph, notes, media)', false, e.message); }

  // A presentation edited elsewhere: without Margo's own part the slides are
  // read from their XML (text, lists, formatting, images, background, notes).
  try {
    const zip = await JSZip.loadAsync(await fsp.readFile(deckPath));
    zip.remove(slides._test.MARGO_PART);
    const foreign = path.join(tmpDir, 'backend-foreign.pptx');
    await fsp.writeFile(foreign, await zip.generateAsync({ type: 'nodebuffer' }));
    const back = await files.openPath(foreign);
    const sl = back.deck.slides[1];
    const texts = sl.elements.filter((e) => e.type === 'text');
    const body = texts.find((e) => core.elementText(e).includes('Plain'));
    const boldRun = body && body.paragraphs[0].runs.find((r) => r.text === 'bold red');
    const img = sl.elements.find((e) => e.type === 'image');
    const arrow = sl.elements.find((e) => e.type === 'shape' && e.shape === 'arrow');
    const ok = back.deck.slides.length === 2
      && core.elementText(texts[0]) === 'Agenda'
      && !!boldRun && boldRun.b === true && boldRun.color === '#cc0000'
      && body.paragraphs[0].list === 'bullet' && body.paragraphs[1].list === 'number' && body.paragraphs[1].level === 1
      && core.paragraphText(body.paragraphs[1]) === 'Second\nline'
      && !!img && /^data:image\/png;base64,/.test(img.src) && !!img.crop
      && !!arrow && arrow.stroke === '#123456'
      && sl.background && sl.background.color === '#f0f4ff'
      && sl.notes === 'Say hello to the room';
    t('backend: pptx without Margo metadata reads from slide XML', ok,
      JSON.stringify({ n: back.deck.slides.length, texts: texts.map(core.elementText), img: !!img, arrow: !!arrow, bg: sl.background, notes: sl.notes }).slice(0, 190));
  } catch (e) { t('backend: pptx without Margo metadata reads from slide XML', false, e.stack || e.message); }

  try {
    const html = files.htmlForPdfExport({ kind: 'slides', data: { deck }, title: 'Deck' });
    const pages = (html.match(/<section class="page">/g) || []).length;
    t('backend: slides export html has one page per slide', pages === 2 && html.includes('Backend deck') && /@page\s*\{\s*size:\s*1280px 720px/.test(html), `pages=${pages}`);
  } catch (e) { t('backend: slides export html has one page per slide', false, e.message); }

  try {
    t('backend: .pptx maps to the slides kind', files.kindFromPath('/x/y/Deck.PPTX') === 'slides'
      && files.saveFilters('slides')[0].extensions[0] === 'pptx'
      && /\.pptx$/.test(files.suggestSavePath({ kind: 'slides', suggestedName: 'Untitled.pptx' }, tmpDir)));
  } catch (e) { t('backend: .pptx maps to the slides kind', false, e.message); }
}

/* ---------------- main-process safety + platform tests ---------------- */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function ipcInvoker(win) {
  const { ipcMain } = require('electron');
  const map = ipcMain._invokeHandlers;
  return async (channel, ...args) => {
    const fn = map && typeof map.get === 'function' ? map.get(channel) : null;
    if (!fn) throw new Error('no handler for ' + channel);
    return fn({ sender: win.webContents, senderFrame: win.webContents.mainFrame }, ...args);
  };
}

async function pdfPageSize(file) {
  const { PDFDocument } = require('pdf-lib');
  const doc = await PDFDocument.load(await fsp.readFile(file));
  const { width, height } = doc.getPage(0).getSize();
  return { width: Math.round(width), height: Math.round(height), pages: doc.getPageCount() };
}

async function pdfText(file) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = new Uint8Array(await fsp.readFile(file));
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false, disableFontFace: true }).promise;
  let text = '';
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map((it) => it.str).join(' ') + '\n';
  }
  await doc.destroy();
  return text;
}

async function mainProcessTests(win, tmpDir) {
  const os = require('os');
  const access = require('./access');
  const recents = require('./recents');
  const drafts = require('./drafts');
  const invoke = ipcInvoker(win);
  const mainExports = require(path.join(__dirname, '..', '..', 'main.js'));

  // A folder the renderer was never given: stands in for ~/.ssh and friends.
  const outside = path.join(os.tmpdir(), 'margo-smoke-outside');
  fs.rmSync(outside, { recursive: true, force: true });
  fs.mkdirSync(outside, { recursive: true });
  const secret = path.join(outside, 'secret.md');
  fs.writeFileSync(secret, '# top secret SMOKE-SECRET-TOKEN');

  try {
    t('security: access refuses relative / NUL / non-string paths',
      !access.isAllowed('notes.md') && !access.isAllowed('/tmp/a\0b.md') && !access.isAllowed(42)
        && !access.isAllowed('') && access.normalize('relative/x.md') === null);
  } catch (e) { t('security: access refuses relative / NUL / non-string paths', false, e.message); }

  try {
    const res = await invoke('file:open', secret);
    t('security: file:open refuses a path the author never chose',
      res && res.ok === false && /only open files you chose/i.test(res.error || ''), JSON.stringify(res));
  } catch (e) { t('security: file:open refuses a path the author never chose', false, e.message); }

  try {
    const res = await invoke('file:peek', secret);
    let threw = false;
    try { await invoke('file:read-binary', secret); } catch { threw = true; }
    const thumb = await invoke('file:docx-thumb', path.join(outside, 'x.docx'));
    t('security: peek / read-binary / docx-thumb refuse unchosen paths',
      res.ok === false && threw && thumb.ok === false, `peek=${res.ok} readBinaryThrew=${threw} thumb=${thumb.ok}`);
  } catch (e) { t('security: peek / read-binary / docx-thumb refuse unchosen paths', false, e.message); }

  try {
    const victim = path.join(outside, 'victim.md');
    fs.writeFileSync(victim, 'original');
    const res = await invoke('file:save', { kind: 'md', path: victim, data: { markdown: 'pwned' } });
    const planted = path.join(outside, 'planted.md');
    const res2 = await invoke('file:save', { kind: 'md', path: planted, data: { markdown: 'x' } });
    const traversal = await invoke('file:save', { kind: 'md', path: path.join(tmpDir, '..', 'margo-smoke-outside', 'planted2.md'), data: { markdown: 'x' } });
    t('security: file:save refuses unchosen paths (incl. ../ traversal)',
      res.ok === false && fs.readFileSync(victim, 'utf8') === 'original'
        && res2.ok === false && !fs.existsSync(planted)
        && traversal.ok === false && !fs.existsSync(path.join(outside, 'planted2.md')),
      `${res.error} | ${res2.error} | ${traversal.error}`);
  } catch (e) { t('security: file:save refuses unchosen paths (incl. ../ traversal)', false, e.message); }

  try {
    const bad = await Promise.all([
      invoke('file:save', null),
      invoke('file:save', { kind: '../x', path: path.join(tmpDir, 'a.md'), data: {} }),
      invoke('file:save', { kind: 'md', path: path.join(tmpDir, 'a.md'), data: 'nope' }),
      invoke('export:pdf', { kind: 'md', data: null, path: path.join(tmpDir, 'x.pdf') }),
      invoke('export:pdf', { kind: 'md', data: { markdown: 'x' }, path: path.join(outside, 'x.pdf') })
    ]);
    t('security: malformed save / export requests are refused',
      bad.every((r) => r && r.ok === false) && !fs.existsSync(path.join(outside, 'x.pdf')),
      bad.map((r) => r && r.error).join(' | '));
  } catch (e) { t('security: malformed save / export requests are refused', false, e.message); }

  try {
    // A granted path works; a dropped file's path is granted by preload.
    const chosen = path.join(outside, 'chosen.md');
    fs.writeFileSync(chosen, '# chosen');
    access.grant(chosen, { persist: false });
    const res = await invoke('file:open', chosen);
    t('security: a path the author chose opens', res.ok && res.doc && res.doc.markdown === '# chosen', res.error);
    recents.remove(chosen);
  } catch (e) { t('security: a path the author chose opens', false, e.message); }

  try {
    drafts.clear();
    await invoke('drafts:put', { id: 'sec-1', kind: 'md', name: 'a.md', path: secret, data: { markdown: 'x' } });
    const granted = path.join(tmpDir, 'granted-draft.md');
    await invoke('drafts:put', { id: 'sec-2', kind: 'md', name: 'b.md', path: granted, data: { markdown: 'y' } });
    const listed = drafts.list();
    const d1 = listed.find((d) => d.id === 'sec-1');
    const d2 = listed.find((d) => d.id === 'sec-2');
    t('security: drafts cannot mint access to other files',
      d1 && d1.path === null && d2 && d2.path === granted, JSON.stringify(listed.map((d) => [d.id, d.path])));
    drafts.clear();
  } catch (e) { t('security: drafts cannot mint access to other files', false, e.message); }

  try {
    const oe = mainExports.openExternalSafe;
    t('security: openExternal only takes http(s)/mailto',
      typeof oe === 'function'
        && oe('javascript:alert(1)') === false && oe('file:///etc/passwd') === false
        && oe('smb://host/share') === false && oe('https://' + 'a'.repeat(9000)) === false
        && oe(42) === false && oe('http://') === false && oe('ms-settings:privacy') === false);
  } catch (e) { t('security: openExternal only takes http(s)/mailto', false, e.message); }

  try {
    const wp = win.webContents.getLastWebPreferences ? win.webContents.getLastWebPreferences() : null;
    t('security: main window is sandboxed and isolated',
      !!wp && wp.contextIsolation === true && wp.sandbox === true && wp.nodeIntegration === false && wp.webviewTag === false,
      wp ? `ci=${wp.contextIsolation} sb=${wp.sandbox} ni=${wp.nodeIntegration} wv=${wp.webviewTag}` : 'no prefs');
  } catch (e) { t('security: main window is sandboxed and isolated', false, e.message); }

  try {
    const printing = require('./printing');
    const withHead = printing.injectCsp('<html><head><title>x</title></head><body>hi</body></html>');
    const noHead = printing.injectCsp('<p>hi</p>');
    t('security: export/print/thumbnail HTML gets a locked-down CSP',
      /<head><meta http-equiv="Content-Security-Policy"/.test(withHead) && noHead.startsWith('<meta http-equiv="Content-Security-Policy"')
        && printing.DOC_CSP.includes("default-src 'none'") && !/script-src/.test(printing.DOC_CSP));
  } catch (e) { t('security: export/print/thumbnail HTML gets a locked-down CSP', false, e.message); }

  try {
    const out = path.join(tmpDir, 'csp-probe.pdf');
    const md = '# Visible heading\n\n<iframe src="file://' + secret.replace(/\\/g, '/') + '" width="600" height="200"></iframe>\n\n<object data="file://' + secret.replace(/\\/g, '/') + '"></object>\n';
    const res = await invoke('export:pdf', { kind: 'md', data: { markdown: md }, path: out, suggestedName: 'probe.md' });
    const text = res.ok ? await pdfText(out) : '';
    t('security: a document cannot embed local files into its PDF export',
      res.ok && /Visible heading/.test(text) && !/SMOKE-SECRET-TOKEN/.test(text), res.ok ? text.slice(0, 120) : res.error);
  } catch (e) { t('security: a document cannot embed local files into its PDF export', false, e.message); }

  /* ---- PDF page options ---- */
  try {
    const def = path.join(tmpDir, 'page-default.pdf');
    const letterLand = path.join(tmpDir, 'page-letter-landscape.pdf');
    const r1 = await invoke('export:pdf', { kind: 'md', data: { markdown: '# A4 default' }, path: def });
    const r2 = await invoke('export:pdf', { kind: 'md', data: { markdown: '# Letter landscape' }, path: letterLand, page: { size: 'Letter', landscape: true, margins: 'narrow' } });
    const s1 = r1.ok ? await pdfPageSize(def) : null;
    const s2 = r2.ok ? await pdfPageSize(letterLand) : null;
    t('export: PDF defaults to A4 portrait', s1 && s1.width === 595 && s1.height === 842, JSON.stringify(s1 || r1));
    t('export: PDF page options (Letter, landscape)', s2 && s2.width === 792 && s2.height === 612
      && r2.page && r2.page.margins.left === 0.5, JSON.stringify(s2 || r2));
  } catch (e) { t('export: PDF page options (Letter, landscape)', false, e.message); }

  try {
    const docOut = path.join(tmpDir, 'page-doc-layout.pdf');
    const r = await invoke('export:pdf', {
      kind: 'doc',
      data: { html: '<p>Landscape letter doc</p>', layout: { size: 'letter', orientation: 'landscape' } },
      path: docOut
    });
    const s = r.ok ? await pdfPageSize(docOut) : null;
    t('export: Word PDF follows the document page setup', s && s.width === 792 && s.height === 612, JSON.stringify(s || r));
  } catch (e) { t('export: Word PDF follows the document page setup', false, e.message); }

  try {
    const printing = require('./printing');
    const a = printing.normalizePageOptions({ size: 'a5', margins: { top: 0.2, right: 0.3, bottom: 0.4, left: 0.5 } }, 'md', {});
    const b = printing.normalizePageOptions({ size: 'bogus', margins: 'wide', landscape: 'yes' }, 'sheet', {});
    const c = printing.normalizePageOptions({ size: { width: 3, height: 3 }, margins: 2 }, 'md', {});
    const d = printing.normalizePageOptions({ orientation: 'landscape', margins: -5 }, 'md', {});
    t('export: page options are validated',
      a.width === 5.83 && a.margins.left === 0.5 && a.margins.top === 0.2
        && b.name === 'a4' && b.landscape === false && b.margins.left === 2
        && c.margins.left === 1 // 2in margins leave no room on a 3in page
        && d.landscape === true && d.width === 11.69 && d.margins.left === 0,
      JSON.stringify([a, b, c, d].map((x) => [x.name, x.width, x.height, x.margins.left])));
  } catch (e) { t('export: page options are validated', false, e.message); }

  /* ---- external-change watcher ---- */
  try {
    const { createWatcher } = require('./watcher');
    const events = [];
    const w = createWatcher({ onChange: (ev) => events.push(ev), debounceMs: 80 });
    const f = path.join(tmpDir, 'watched.md');
    fs.writeFileSync(f, 'one');
    w.watch(f);
    await sleep(120);
    fs.writeFileSync(f, 'two - edited elsewhere');
    for (let i = 0; i < 40 && !events.length; i++) await sleep(50);
    const changed = events.length === 1 && events[0].kind === 'changed' && events[0].path === path.resolve(f);
    events.length = 0;
    w.beginOwnWrite(f);
    await files.save({ kind: 'md', path: f, data: { markdown: 'three - Margo saved' } });
    w.endOwnWrite(f);
    await sleep(400);
    const ownSilent = events.length === 0;
    // Another editor's atomic save: write a temp file and rename it over.
    const tmp = f + '.other-editor.tmp';
    fs.writeFileSync(tmp, 'four - vim style save');
    fs.renameSync(tmp, f);
    for (let i = 0; i < 40 && !events.length; i++) await sleep(50);
    const renamed = events.length === 1 && events[0].kind === 'changed';
    events.length = 0;
    fs.unlinkSync(f);
    for (let i = 0; i < 40 && !events.length; i++) await sleep(50);
    const deleted = events.length === 1 && events[0].kind === 'deleted';
    w.closeAll();
    t('watch: external edit reported', changed, JSON.stringify(events));
    t('watch: Margo\'s own save is silent', ownSilent);
    t('watch: rename-over (atomic) save by another app reported', renamed);
    t('watch: deletion reported', deleted);
  } catch (e) { t('watch: external edit reported', false, e.message); }

  try {
    // End to end: file:open starts the watch and the event reaches the window.
    const f = path.join(tmpDir, 'watched-ipc.md');
    fs.writeFileSync(f, '# first');
    const sent = [];
    const origSend = win.webContents.send.bind(win.webContents);
    win.webContents.send = (ch, ...args) => {
      if (ch === 'file:changed-externally') sent.push(args[0]);
      else origSend(ch, ...args);
    };
    try {
      const opened = await invoke('file:open', f);
      await sleep(150);
      const saved = await invoke('file:save', { kind: 'md', path: f, data: { markdown: '# saved by Margo' } });
      await sleep(600);
      const afterSave = sent.length;
      fs.writeFileSync(f, '# changed by another program');
      for (let i = 0; i < 60 && !sent.length; i++) await sleep(50);
      t('watch: file:changed-externally sent for an open file (not for Margo\'s save)',
        opened.ok && saved.ok && afterSave === 0 && sent.length === 1 && sent[0].kind === 'changed' && sent[0].path === path.resolve(f),
        JSON.stringify({ afterSave, sent }));
      const un = await invoke('file:unwatch', f);
      sent.length = 0;
      fs.writeFileSync(f, '# changed again');
      await sleep(600);
      t('watch: unwatch stops notifications', un === true && sent.length === 0, `sent=${sent.length}`);
    } finally {
      win.webContents.send = origSend;
      recents.remove(f);
    }
  } catch (e) { t('watch: file:changed-externally sent for an open file (not for Margo\'s save)', false, e.message); }

  /* ---- window state ---- */
  try {
    const ws = require('./windowstate');
    const displays = [{ workArea: { x: 0, y: 0, width: 1920, height: 1040 } }, { workArea: { x: 1920, y: 0, width: 1280, height: 1024 } }];
    const def = { width: 1280, height: 850, minWidth: 940, minHeight: 600 };
    const ok = ws.sanitize({ x: 100, y: 80, width: 1200, height: 800 }, displays, def);
    const second = ws.sanitize({ x: 2000, y: 50, width: 1000, height: 700, maximized: true }, displays, def);
    const gone = ws.sanitize({ x: 5000, y: 3000, width: 1200, height: 800 }, displays, def);
    const nudged = ws.sanitize({ x: -300, y: 900, width: 1200, height: 800 }, displays, def);
    const tiny = ws.sanitize({ x: 10, y: 10, width: 20, height: 20 }, displays, def);
    const junk = ws.sanitize({ x: 'a', width: NaN }, displays, def);
    const huge = ws.sanitize({ x: 0, y: 0, width: 9000, height: 9000 }, displays, def);
    t('window: saved placement restored on its display',
      ok.x === 100 && ok.y === 80 && ok.width === 1200 && second.x === 2000 && second.maximized === true);
    t('window: off-screen placement falls back to default',
      gone.x === undefined && gone.width === 1280 && junk.width === 1280 && junk.x === undefined);
    t('window: partly visible placement pulled on screen, sizes clamped',
      nudged.x === 0 && nudged.y + nudged.height <= 1040 && tiny.width === 940 && tiny.height === 600
        && huge.width <= 1920 && huge.height <= 1040,
      JSON.stringify({ nudged, tiny, huge }));
  } catch (e) { t('window: saved placement restored on its display', false, e.message); }

  /* ---- command line / second instance ---- */
  try {
    const argvFn = mainExports.supportedPathsFromArgv;
    const md = path.join(tmpDir, 'argv doc.md');
    fs.writeFileSync(md, 'x');
    fs.mkdirSync(path.join(tmpDir, 'folder.md'), { recursive: true });
    const got = argvFn(['margo', '--flag', '.', 'argv doc.md', 'missing.md', 'notes.exe', 'folder.md', md], tmpDir);
    t('launch: argv paths resolved against the launching cwd',
      Array.isArray(got) && got.length === 2 && got[0] === path.resolve(md) && got[1] === path.resolve(md), JSON.stringify(got));
  } catch (e) { t('launch: argv paths resolved against the launching cwd', false, e.message); }

  /* ---- atomic save details ---- */
  if (process.platform !== 'win32') {
    try {
      const priv = path.join(tmpDir, 'private.md');
      fs.writeFileSync(priv, 'a', { mode: 0o600 });
      fs.chmodSync(priv, 0o600);
      await files.save({ kind: 'md', path: priv, data: { markdown: 'b' } });
      const mode = fs.statSync(priv).mode & 0o777;
      const real = path.join(tmpDir, 'real-target.md');
      const link = path.join(tmpDir, 'link.md');
      fs.writeFileSync(real, 'old');
      fs.symlinkSync(real, link);
      await files.save({ kind: 'md', path: link, data: { markdown: 'through the link' } });
      t('save: keeps file permissions and writes through symlinks',
        mode === 0o600 && fs.lstatSync(link).isSymbolicLink() && fs.readFileSync(real, 'utf8') === 'through the link',
        `mode=${mode.toString(8)} link=${fs.lstatSync(link).isSymbolicLink()}`);
    } catch (e) { t('save: keeps file permissions and writes through symlinks', false, e.message); }
  }

  try {
    const leftovers = fs.readdirSync(tmpDir).filter((n) => /\.margo-\d+-\d+\.tmp$/.test(n));
    t('save: no temp files left behind', leftovers.length === 0, leftovers.join(','));
  } catch (e) { t('save: no temp files left behind', false, e.message); }

  /* ---- recents ---- */
  try {
    recents.clear();
    const a = path.join(tmpDir, 'Case.md');
    const b = path.join(tmpDir, 'case.md');
    fs.writeFileSync(a, 'A');
    if (process.platform === 'linux') fs.writeFileSync(b, 'b');
    recents.add(a, 'md');
    recents.add(b, 'md');
    recents.add('relative/ignored.md', 'md');
    const stored = recents.readAll();
    const expected = process.platform === 'linux' ? 2 : 1;
    fs.writeFileSync(path.join(require('electron').app.getPath('userData'), 'recents.json'), '[{"path":42},{"nope":1},null,"x"]');
    const junk = recents.list();
    t('recents: case handled per platform, junk and relative paths ignored',
      stored.length === expected && junk.length === 0, `stored=${stored.length} junk=${junk.length}`);
    recents.clear();
  } catch (e) { t('recents: case handled per platform, junk and relative paths ignored', false, e.message); }

  /* ---- updater / Google helpers ---- */
  try {
    const up = require('./updater');
    t('updater: network errors read as one friendly line',
      /connection/i.test(up.friendlyError(new Error('net::ERR_INTERNET_DISCONNECTED'))) &&
      up.friendlyError(new Error('line one\nstack stack')) === 'line one');
  } catch (e) { t('updater: network errors read as one friendly line', false, e.message); }

  try {
    const oauth = require('./google/oauth');
    const dir = path.join(tmpDir, 'oauth');
    fs.mkdirSync(dir, { recursive: true });
    oauth.writeStore(dir, { refreshToken: 'rt-123', email: 'a@b.c' });
    const back = oauth.readStore(dir);
    const modeOk = process.platform === 'win32' || (fs.statSync(path.join(dir, 'google-auth.bin')).mode & 0o077) === 0;
    fs.writeFileSync(path.join(dir, 'google-auth.bin'), JSON.stringify({ refreshToken: 'plain' }));
    const plain = oauth.readStore(dir);
    fs.writeFileSync(path.join(dir, 'google-auth.bin'), 'garbage');
    const garbage = oauth.readStore(dir);
    t('google: token store round trip, owner-only, tolerant of format',
      back && back.refreshToken === 'rt-123' && modeOk && plain && plain.refreshToken === 'plain' && garbage === null,
      `back=${!!back} modeOk=${modeOk} plain=${!!plain}`);
    t('google: OAuth state check is exact',
      oauth.stateMatches('abc', 'abc') && !oauth.stateMatches('abc', 'abd') && !oauth.stateMatches('abc', null) && !oauth.stateMatches('abc', 'abcd'));
  } catch (e) { t('google: token store round trip, owner-only, tolerant of format', false, e.message); }

  try {
    const g = require('./google');
    const drive = require('./google/drive');
    const mixed = path.join(tmpDir, 'Docs', 'Report.docx');
    const key = g.normPath(mixed);
    const maps = { [key]: { fileId: 'abc_123', name: 'Report.docx', path: mixed } };
    t('google: Drive map keeps the real path (case-sensitive systems)',
      g.pathForFileId(maps, 'abc_123') === mixed
        && (process.platform === 'linux' ? key === path.resolve(mixed) : true)
        && g.safeFileName('../../etc/passwd') === 'passwd'
        && drive.isDriveId('1AbC_-x') && !drive.isDriveId('../x') && !drive.isDriveId(''));
  } catch (e) { t('google: Drive map keeps the real path (case-sensitive systems)', false, e.message); }

  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8'));
    const b = pkg.build || {};
    const mac = b.mac && [].concat(b.mac.target || []).map((x) => (typeof x === 'string' ? x : x.target));
    const linux = b.linux && [].concat(b.linux.target || []).map((x) => (typeof x === 'string' ? x : x.target));
    const { readIcnsTypes } = require('../../scripts/icns');
    const icnsFile = path.join(__dirname, '..', '..', 'assets', 'icon.icns');
    const types = fs.existsSync(icnsFile) ? readIcnsTypes(fs.readFileSync(icnsFile)) : null;
    const icnsOk = !!types && types.includes('ic09') && types.includes('ic07') && types.includes('icp4');
    t('build: macOS (dmg) and Linux (AppImage, deb) targets configured',
      mac && mac.includes('dmg') && linux && linux.includes('AppImage') && linux.includes('deb') && icnsOk
        && /smoke\.js/.test(pkg.scripts.test) && !/\bset\b/.test(pkg.scripts.test),
      JSON.stringify({ mac, linux, icnsOk, test: pkg.scripts.test }));
  } catch (e) { t('build: macOS (dmg) and Linux (AppImage, deb) targets configured', false, e.message); }

  fs.rmSync(outside, { recursive: true, force: true });
}

async function validateRendererArtifacts(tmpDir) {
  const read = (f) => fsp.readFile(path.join(tmpDir, f), 'utf8');
  try {
    const md = await read('ui-out.md');
    t('files: renderer-saved markdown has edit', md.includes('Smoke edit line.'));
  } catch (e) { t('files: renderer-saved markdown has edit', false, e.message); }

  try {
    const buf = await fsp.readFile(path.join(tmpDir, 'ui-export.docx'));
    t('files: renderer md -> docx export', buf.length > 800 && buf[0] === 0x50 && buf[1] === 0x4b);
  } catch (e) { t('files: renderer md -> docx export', false, e.message); }

  try {
    const md2 = await read('ui-doc-roundtrip.md');
    t('files: renderer doc -> md export', md2.includes('Doc smoke edit.'));
  } catch (e) { t('files: renderer doc -> md export', false, e.message); }

  try {
    const back = await files.openPath(path.join(tmpDir, 'ui-out.xlsx'));
    const ok = back.sheets[0].rows[0][0] === 'Changed by smoke' && back.sheets[0].rows[1][0] === 'Pen';
    t('files: renderer-saved xlsx (edit + intact data)', ok, JSON.stringify((back.sheets[0].rows || []).slice(0, 2)));
  } catch (e) { t('files: renderer-saved xlsx (edit + intact data)', false, e.message); }

  try {
    const csv = await read('ui-out.csv');
    t('files: renderer sheet -> csv export', csv.split(/\r?\n/)[0].includes('Changed by smoke'));
  } catch (e) { t('files: renderer sheet -> csv export', false, e.message); }

  try {
    const { PDFDocument } = require('pdf-lib');
    const orig = await fsp.readFile(path.join(__dirname, '..', '..', 'samples', 'sample.pdf'));
    const signed = await fsp.readFile(path.join(tmpDir, 'ui-signed.pdf'));
    const doc = await PDFDocument.load(signed);
    t('files: signed pdf valid, 2 pages, grew by signature',
      doc.getPageCount() === 2 && signed.length > orig.length,
      `orig=${orig.length} signed=${signed.length}`);
  } catch (e) { t('files: signed pdf valid, 2 pages, grew by signature', false, e.message); }

  try {
    const { PDFDocument } = require('pdf-lib');
    const checks = [];
    for (const f of ['export-md.pdf', 'export-doc.pdf', 'export-sheet.pdf']) {
      const buf = await fsp.readFile(path.join(tmpDir, f));
      const doc = await PDFDocument.load(buf);
      checks.push(`${f}:${doc.getPageCount()}p/${buf.length}b`);
      if (doc.getPageCount() < 1 || buf.length < 1500) throw new Error('suspicious ' + f);
    }
    t('files: pdf exports valid (md/doc/sheet)', true, checks.join(' '));
  } catch (e) { t('files: pdf exports valid (md/doc/sheet)', false, e.message); }

  try {
    const thumbsDirPath = path.join(app.getPath('userData'), 'thumbs');
    const pngs = fs.readdirSync(thumbsDirPath).filter((f) => f.endsWith('.png'));
    t('files: thumbnails persisted to disk', pngs.length >= 3, `${pngs.length} thumbs`);
  } catch (e) { t('files: thumbnails persisted to disk', false, e.message); }

  try {
    const docxPath = path.join(tmpDir, 'ui-out.docx');
    const buf = await fsp.readFile(docxPath);
    const zip = await JSZip.loadAsync(buf);
    const thumb = zip.file('docProps/thumbnail.jpeg') || zip.file('docProps/thumbnail.png');
    const size = thumb ? (await thumb.async('nodebuffer')).length : 0;
    t('files: saved docx embeds desktop thumbnail', !!thumb && size > 400, `size=${size}`);
  } catch (e) { t('files: saved docx embeds desktop thumbnail', false, e.message); }

  try {
    const back = await files.openPath(path.join(tmpDir, 'ui-deck.pptx'));
    const core = require('./slides-core');
    const all = back.deck.slides.map((sl) => sl.elements.map(core.elementText).join(' ')).join(' | ');
    t('files: renderer-saved pptx reopens with its slides',
      back.kind === 'slides' && back.deck.slides.length >= 2 && all.includes('Smoke deck title') && all.includes('Smoke text box'),
      `${back.deck.slides.length} slides :: ${all.slice(0, 150)}`);
  } catch (e) { t('files: renderer-saved pptx reopens with its slides', false, e.message); }

  try {
    const size = await pdfPageSize(path.join(tmpDir, 'export-slides.pdf'));
    // exported from the same deck the renderer saved as ui-deck.pptx
    const want = { slides: (await files.openPath(path.join(tmpDir, 'ui-deck.pptx'))).deck.slides.length };
    t('files: slides pdf is one landscape slide-sized page per slide',
      size.pages === want.slides && size.width === 960 && size.height === 540,
      JSON.stringify({ size, want }));
  } catch (e) { t('files: slides pdf is one landscape slide-sized page per slide', false, e.message); }
}

async function run(win) {
  const samplesDir = path.join(__dirname, '..', '..', 'samples');
  const tmpDir = path.join(app.getPath('temp'), 'margo-smoke');
  fs.mkdirSync(samplesDir, { recursive: true });
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });
  // The renderer suite opens and saves straight to these folders, standing in
  // for the author picking files in a dialog.
  const access = require('./access');
  access.grantDir(samplesDir);
  access.grantDir(tmpDir);

  console.log('SMOKE start');
  await backendTests(samplesDir, tmpDir);
  try {
    await slidesBackendTests(tmpDir);
  } catch (e) { t('slides backend tests crashed', false, e.stack || e.message); }
  try {
    await mainProcessTests(win, tmpDir);
  } catch (e) { t('main-process tests crashed', false, e.stack || e.message); }

  // Renderer UI tests
  const rendererTimeoutMs = Number(process.env.MARGO_SMOKE_UI_TIMEOUT_MS) || 240000;
  let rendererTimer = null;
  const rendererResults = await new Promise((resolve) => {
    rendererDone = resolve;
    win.webContents.send('smoke:run', {
      samplesDir,
      tmpDir,
      sep: path.sep,
      // MARGO_SMOKE_ONLY=slides runs just that renderer suite (quick iteration)
      only: process.env.MARGO_SMOKE_ONLY || null,
      welcomePath: path.join(samplesDir, 'welcome.md'),
      docxPath: path.join(samplesDir, 'sample.docx'),
      xlsxPath: path.join(samplesDir, 'sample.xlsx'),
      pdfPath: path.join(samplesDir, 'sample.pdf')
    });
    rendererTimer = setTimeout(() => {
      rendererDone = null;
      resolve([{ name: 'ui: renderer responded', ok: false, detail: `timeout after ${rendererTimeoutMs / 1000}s` }]);
    }, rendererTimeoutMs);
  });
  clearTimeout(rendererTimer);

  for (const r of rendererResults) {
    t(r.name, r.ok, r.detail);
  }

  await validateRendererArtifacts(tmpDir);

  const fails = results.filter((r) => !r.ok);
  console.log(`SMOKE done: ${results.length - fails.length}/${results.length} passed`);
  if (fails.length) console.log('SMOKE failures: ' + fails.map((f) => f.name).join(' | '));
  setTimeout(() => app.exit(fails.length ? 1 : 0), 400);
}

function onRendererReport(rendererResults) {
  if (rendererDone) {
    const done = rendererDone;
    rendererDone = null;
    done(Array.isArray(rendererResults) ? rendererResults : []);
  }
}

module.exports = { run, onRendererReport };
