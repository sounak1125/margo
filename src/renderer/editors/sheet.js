/* Margo — professional spreadsheet suite (Excel / WPS parity: Formula Engine, Formatting Ribbon, Cell Sizing, Resizing, Charts, Freeze Panes) */
(function () {
  const MIN_ROWS = 60, MIN_COLS = 26;
  const MAX_INITIAL_RENDER_ROWS = 250, MAX_INITIAL_RENDER_COLS = 60;
  const DEFAULT_COL_WIDTH = 96;
  const DEFAULT_ROW_HEIGHT = 24;

  const FONTS = window.MargoFonts;
  const FONT_FAMILIES = FONTS.FAMILIES;
  const FONT_SIZES = FONTS.SIZES;
  const FILL_COLORS = [
    '#ffffff', '#f8fafc', '#f1f5f9', '#e2e8f0', '#cbd5e1',
    '#fef2f2', '#fee2e2', '#fef3c7', '#fde68a', '#ecfdf5',
    '#d1fae5', '#eff6ff', '#dbeafe', '#f5f3ff', '#ede9fe'
  ];
  const TEXT_COLORS = [
    '#1d1d1f', '#4b5563', '#6b7280', '#9ca3af',
    '#b42318', '#dc2626', '#ea580c', '#d97706',
    '#16a34a', '#059669', '#0284c7', '#2563eb',
    '#4f46e5', '#7c3aed', '#c026d3', '#db2777'
  ];

  function colName(n) {
    let s = '';
    n += 1;
    while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
    return s;
  }
  function colIndex(str) {
    let c = 0;
    const s = String(str || '').toUpperCase();
    for (let i = 0; i < s.length; i++) c = c * 26 + (s.charCodeAt(i) - 64);
    return c - 1;
  }
  function parseCellRef(ref) {
    const m = /^(?:'?([^'!]+)'?!)?\$?([A-Z]+)\$?([0-9]+)$/i.exec(String(ref).trim());
    if (!m) return null;
    return {
      sheetName: m[1] || null,
      col: colIndex(m[2]),
      row: parseInt(m[3], 10) - 1
    };
  }
  function parseRange(rangeStr) {
    const parts = rangeStr.split(':');
    if (parts.length === 1) {
      const c = parseCellRef(parts[0]);
      return c ? { start: c, end: c, sheetName: c.sheetName } : null;
    }
    const c1 = parseCellRef(parts[0]);
    const c2 = parseCellRef(parts[1]);
    if (!c1 || !c2) return null;
    return {
      sheetName: c1.sheetName || c2.sheetName || null,
      start: { row: Math.min(c1.row, c2.row), col: Math.min(c1.col, c2.col) },
      end: { row: Math.max(c1.row, c2.row), col: Math.max(c1.col, c2.col) }
    };
  }

  const isNumeric = (s) => /^-?[\d,]*\.?\d+%?$/.test(String(s).trim()) && String(s).trim() !== '';

  /* ---------------- Formula Calculation Engine ---------------- */
  const FORMULA_FUNCTIONS = {
    SUM: (args) => flatten(args).reduce((acc, v) => acc + (toNum(v) || 0), 0),
    AVERAGE: (args) => {
      const list = flatten(args).map(toNum).filter((n) => n != null);
      return list.length ? list.reduce((a, b) => a + b, 0) / list.length : 0;
    },
    COUNT: (args) => flatten(args).filter((v) => toNum(v) != null).length,
    COUNTA: (args) => flatten(args).filter((v) => v !== '' && v != null).length,
    COUNTBLANK: (args) => flatten(args).filter((v) => v === '' || v == null).length,
    MIN: (args) => {
      const list = flatten(args).map(toNum).filter((n) => n != null);
      return list.length ? Math.min(...list) : 0;
    },
    MAX: (args) => {
      const list = flatten(args).map(toNum).filter((n) => n != null);
      return list.length ? Math.max(...list) : 0;
    },
    PRODUCT: (args) => flatten(args).reduce((acc, v) => acc * (toNum(v) || 1), 1),
    ROUND: (args) => {
      const n = toNum(args[0]) || 0;
      const d = toNum(args[1]) || 0;
      return Number(Math.round(Number(n + 'e' + d)) + 'e-' + d);
    },
    ROUNDUP: (args) => {
      const n = toNum(args[0]) || 0;
      const d = toNum(args[1]) || 0;
      return Number(Math.ceil(Number(n + 'e' + d)) + 'e-' + d);
    },
    ROUNDDOWN: (args) => {
      const n = toNum(args[0]) || 0;
      const d = toNum(args[1]) || 0;
      return Number(Math.floor(Number(n + 'e' + d)) + 'e-' + d);
    },
    ABS: (args) => Math.abs(toNum(args[0]) || 0),
    SQRT: (args) => Math.sqrt(toNum(args[0]) || 0),
    POWER: (args) => Math.pow(toNum(args[0]) || 0, toNum(args[1]) || 0),
    MOD: (args) => (toNum(args[0]) || 0) % (toNum(args[1]) || 1),
    INT: (args) => Math.floor(toNum(args[0]) || 0),
    MEDIAN: (args) => {
      const list = flatten(args).map(toNum).filter((n) => n != null).sort((a, b) => a - b);
      if (!list.length) return 0;
      const mid = Math.floor(list.length / 2);
      return list.length % 2 !== 0 ? list[mid] : (list[mid - 1] + list[mid]) / 2;
    },
    STDEV: (args) => {
      const list = flatten(args).map(toNum).filter((n) => n != null);
      if (list.length < 2) return 0;
      const mean = list.reduce((a, b) => a + b, 0) / list.length;
      const variance = list.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / (list.length - 1);
      return Math.sqrt(variance);
    },
    PI: () => Math.PI,
    RAND: () => Math.random(),
    RANDBETWEEN: (args) => {
      const min = Math.ceil(toNum(args[0]) || 0);
      const max = Math.floor(toNum(args[1]) || 0);
      return Math.floor(Math.random() * (max - min + 1)) + min;
    },
    IF: (args) => {
      const cond = isTruthy(args[0]);
      return cond ? args[1] : (args[2] !== undefined ? args[2] : false);
    },
    IFS: (args) => {
      for (let i = 0; i < args.length; i += 2) {
        if (isTruthy(args[i])) return args[i + 1];
      }
      return '#N/A';
    },
    AND: (args) => flatten(args).every(isTruthy),
    OR: (args) => flatten(args).some(isTruthy),
    NOT: (args) => !isTruthy(args[0]),
    XOR: (args) => flatten(args).filter(isTruthy).length % 2 === 1,
    SWITCH: (args) => {
      const val = args[0];
      for (let i = 1; i < args.length - 1; i += 2) {
        if (args[i] === val) return args[i + 1];
      }
      return args.length % 2 === 0 ? args[args.length - 1] : '#N/A';
    },
    IFERROR: (args) => (isError(args[0]) ? args[1] : args[0]),
    IFNA: (args) => (args[0] === '#N/A' ? args[1] : args[0]),
    ISBLANK: (args) => args[0] === '' || args[0] == null,
    ISNUMBER: (args) => typeof args[0] === 'number' || (isNumeric(args[0]) && !isNaN(Number(args[0]))),
    ISTEXT: (args) => typeof args[0] === 'string' && !isNumeric(args[0]),
    ISERROR: (args) => isError(args[0]),
    CONCAT: (args) => flatten(args).join(''),
    CONCATENATE: (args) => flatten(args).join(''),
    TEXT: (args) => formatCellValue(args[0], String(args[1] || 'general')),
    LEFT: (args) => String(args[0] || '').slice(0, parseInt(args[1] || 1, 10)),
    RIGHT: (args) => {
      const s = String(args[0] || '');
      const len = parseInt(args[1] || 1, 10);
      return s.slice(Math.max(0, s.length - len));
    },
    MID: (args) => {
      const s = String(args[0] || '');
      const start = Math.max(0, parseInt(args[1] || 1, 10) - 1);
      const len = parseInt(args[2] || 1, 10);
      return s.substr(start, len);
    },
    LEN: (args) => String(args[0] || '').length,
    TRIM: (args) => String(args[0] || '').trim().replace(/\s+/g, ' '),
    UPPER: (args) => String(args[0] || '').toUpperCase(),
    LOWER: (args) => String(args[0] || '').toLowerCase(),
    PROPER: (args) => String(args[0] || '').replace(/\w\S*/g, (t) => t.charAt(0).toUpperCase() + t.substr(1).toLowerCase()),
    EXACT: (args) => String(args[0] || '') === String(args[1] || ''),
    REPT: (args) => String(args[0] || '').repeat(Math.max(0, parseInt(args[1] || 0, 10))),
    VALUE: (args) => toNum(args[0]) || 0,
    TODAY: () => new Date().toISOString().split('T')[0],
    NOW: () => new Date().toLocaleString(),
    DATE: (args) => {
      const y = toNum(args[0]) || 2026, m = (toNum(args[1]) || 1) - 1, d = toNum(args[2]) || 1;
      return new Date(y, m, d).toISOString().split('T')[0];
    },
    YEAR: (args) => new Date(args[0]).getFullYear() || 0,
    MONTH: (args) => (new Date(args[0]).getMonth() + 1) || 0,
    DAY: (args) => new Date(args[0]).getDate() || 0,
    DAYS: (args) => Math.round((new Date(args[0]) - new Date(args[1])) / 86400000),
    VLOOKUP: (args) => {
      const target = args[0];
      const range = args[1];
      const colIdx = parseInt(args[2] || 1, 10) - 1;
      if (!Array.isArray(range) || !range.length) return '#N/A';
      for (let i = 0; i < range.length; i++) {
        const row = range[i];
        if (String(row[0]).toLowerCase() === String(target).toLowerCase()) {
          return row[colIdx] !== undefined ? row[colIdx] : '';
        }
      }
      return '#N/A';
    },
    HLOOKUP: (args) => {
      const target = args[0];
      const matrix = args[1];
      const rowIdx = parseInt(args[2] || 1, 10) - 1;
      if (!Array.isArray(matrix) || !matrix[0]) return '#N/A';
      for (let c = 0; c < matrix[0].length; c++) {
        if (String(matrix[0][c]).toLowerCase() === String(target).toLowerCase()) {
          return matrix[rowIdx] && matrix[rowIdx][c] !== undefined ? matrix[rowIdx][c] : '';
        }
      }
      return '#N/A';
    },
    INDEX: (args) => {
      const matrix = args[0];
      const r = parseInt(args[1] || 1, 10) - 1;
      const c = parseInt(args[2] || 1, 10) - 1;
      if (!Array.isArray(matrix)) return matrix;
      if (Array.isArray(matrix[0])) return matrix[r] && matrix[r][c] !== undefined ? matrix[r][c] : '#REF!';
      return matrix[r] !== undefined ? matrix[r] : '#REF!';
    },
    MATCH: (args) => {
      const target = String(args[0]).toLowerCase();
      const list = flatten([args[1]]);
      for (let i = 0; i < list.length; i++) {
        if (String(list[i]).toLowerCase() === target) return i + 1;
      }
      return '#N/A';
    },
    PMT: (args) => {
      const rate = toNum(args[0]) || 0;
      const nper = toNum(args[1]) || 1;
      const pv = toNum(args[2]) || 0;
      if (rate === 0) return -(pv / nper);
      const pvif = Math.pow(1 + rate, nper);
      return -(rate * (pv * pvif)) / (pvif - 1);
    }
  };

  function flatten(arr) {
    return arr.reduce((acc, item) => acc.concat(Array.isArray(item) ? flatten(item) : item), []);
  }
  function toNum(v) {
    if (typeof v === 'number') return v;
    if (v === '' || v == null) return null;
    const n = Number(String(v).replace(/[\$,]/g, '').trim());
    return Number.isFinite(n) ? n : null;
  }
  function isTruthy(v) {
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v !== 0;
    if (typeof v === 'string') return v.toUpperCase() === 'TRUE' || (toNum(v) !== null && toNum(v) !== 0);
    return !!v;
  }
  function isError(v) {
    return typeof v === 'string' && v.startsWith('#') && (v.endsWith('!') || v.endsWith('?'));
  }

  /* ---------------- Number Formatter ---------------- */
  function formatCellValue(val, fmt = 'general', decimals = 2) {
    if (val === '' || val == null) return '';
    if (isError(val)) return String(val);
    const n = toNum(val);

    switch (fmt.toLowerCase()) {
      case 'currency':
      case 'usd':
        return n != null ? `$${n.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}` : String(val);
      case 'eur':
        return n != null ? `€${n.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}` : String(val);
      case 'gbp':
        return n != null ? `£${n.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}` : String(val);
      case 'inr':
        return n != null ? `₹${n.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}` : String(val);
      case 'percent':
      case 'percentage':
        return n != null ? `${(n * 100).toFixed(decimals)}%` : String(val);
      case 'accounting':
        if (n == null) return String(val);
        return n < 0 ? `($${Math.abs(n).toFixed(decimals)})` : `$${n.toFixed(decimals)}`;
      case 'number':
      case 'comma':
        return n != null ? n.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) : String(val);
      case 'scientific':
        return n != null ? n.toExponential(decimals) : String(val);
      case 'date':
        try {
          const d = new Date(val);
          return isNaN(d.getTime()) ? String(val) : d.toISOString().split('T')[0];
        } catch { return String(val); }
      case 'time':
        try {
          const d = new Date(val);
          return isNaN(d.getTime()) ? String(val) : d.toLocaleTimeString();
        } catch { return String(val); }
      case 'text':
        return String(val);
      case 'general':
      default:
        return String(val);
    }
  }

  /* ---------------- Function Wizard Catalog Data ---------------- */
  const FX_CATALOG = [
    { name: 'SUM', cat: 'Math', syntax: 'SUM(number1, [number2], ...)', desc: 'Adds all the numbers in a range of cells.' },
    { name: 'AVERAGE', cat: 'Math', syntax: 'AVERAGE(number1, [number2], ...)', desc: 'Returns the average (arithmetic mean) of the arguments.' },
    { name: 'COUNT', cat: 'Stats', syntax: 'COUNT(val1, [val2], ...)', desc: 'Counts the number of cells that contain numbers.' },
    { name: 'COUNTA', cat: 'Stats', syntax: 'COUNTA(val1, [val2], ...)', desc: 'Counts the number of cells that are not empty.' },
    { name: 'IF', cat: 'Logical', syntax: 'IF(logical_test, value_if_true, [value_if_false])', desc: 'Checks whether a condition is met, and returns one value if TRUE, and another if FALSE.' },
    { name: 'IFS', cat: 'Logical', syntax: 'IFS(condition1, value1, [condition2, value2], ...)', desc: 'Checks multiple conditions and returns a value corresponding to the first TRUE condition.' },
    { name: 'VLOOKUP', cat: 'Lookup', syntax: 'VLOOKUP(lookup_value, table_array, col_index, [range_lookup])', desc: 'Looks for a value in the leftmost column of a table, and then returns a value in the same row from a specified column.' },
    { name: 'HLOOKUP', cat: 'Lookup', syntax: 'HLOOKUP(lookup_value, table_array, row_index, [range_lookup])', desc: 'Looks for a value in the top row of a table and returns the value in the same column from a specified row.' },
    { name: 'INDEX', cat: 'Lookup', syntax: 'INDEX(array, row_num, [col_num])', desc: 'Returns a value or reference of the cell at the intersection of a particular row and column.' },
    { name: 'MATCH', cat: 'Lookup', syntax: 'MATCH(lookup_value, lookup_array, [match_type])', desc: 'Returns the relative position of an item in an array that matches a specified value.' },
    { name: 'CONCAT', cat: 'Text', syntax: 'CONCAT(text1, [text2], ...)', desc: 'Combines the text from multiple ranges and/or strings.' },
    { name: 'LEFT', cat: 'Text', syntax: 'LEFT(text, [num_chars])', desc: 'Returns the specified number of characters from the start of a text string.' },
    { name: 'RIGHT', cat: 'Text', syntax: 'RIGHT(text, [num_chars])', desc: 'Returns the specified number of characters from the end of a text string.' },
    { name: 'MID', cat: 'Text', syntax: 'MID(text, start_num, num_chars)', desc: 'Returns the characters from the middle of a text string, given a starting position and length.' },
    { name: 'LEN', cat: 'Text', syntax: 'LEN(text)', desc: 'Returns the number of characters in a text string.' },
    { name: 'TRIM', cat: 'Text', syntax: 'TRIM(text)', desc: 'Removes all spaces from text except for single spaces between words.' },
    { name: 'TODAY', cat: 'Date', syntax: 'TODAY()', desc: 'Returns the current date formatted as a date.' },
    { name: 'NOW', cat: 'Date', syntax: 'NOW()', desc: 'Returns the current date and time.' },
    { name: 'DATE', cat: 'Date', syntax: 'DATE(year, month, day)', desc: 'Returns the sequential serial number that represents a particular date.' },
    { name: 'DAYS', cat: 'Date', syntax: 'DAYS(end_date, start_date)', desc: 'Returns the number of days between two dates.' },
    { name: 'MIN', cat: 'Math', syntax: 'MIN(number1, [number2], ...)', desc: 'Returns the smallest number in a set of values.' },
    { name: 'MAX', cat: 'Math', syntax: 'MAX(number1, [number2], ...)', desc: 'Returns the largest number in a set of values.' },
    { name: 'ROUND', cat: 'Math', syntax: 'ROUND(number, num_digits)', desc: 'Rounds a number to a specified number of digits.' },
    { name: 'PMT', cat: 'Financial', syntax: 'PMT(rate, nper, pv, [fv], [type])', desc: 'Calculates the payment for a loan based on constant payments and a constant interest rate.' }
  ];

  function create(ctx) {
    let model;           // { sheets:[{name, rows, styles, colWidths, rowHeights, charts}], active }
    let viewR, viewC;    // rendered grid size for active sheet
    let sel = { r: 0, c: 0 };
    let selEnd = null;   // for range selection
    let editingTd = null;
    let tableEl, colgroupEl, theadEl, tbody, gridScroll, nameBox, formulaInput, tabsEl, fxBtn;
    let fontSelect, variantSelect, sizeSelect;
    let fontFacesByFamily = new Map(
      FONT_FAMILIES.map((f) => [f, FONTS.defaultFaces(f)])
    );
    const history = window.MargoHistory.create();
    let skipHistory = false;
    let zoom = 1;
    let activeRibbonTab = 'home';
    let currentCalcCycle = new Set();
    let autoFilterActive = false;

    const sheet = () => model.sheets[model.active];
    const getCellRaw = (r, c, sheetIdx = model.active) => {
      const sh = model.sheets[sheetIdx];
      if (!sh) return '';
      const row = sh.rows[r];
      return row && row[c] !== undefined && row[c] !== null ? String(row[c]) : '';
    };

    function getColWidth(c) {
      const cw = sheet().colWidths || {};
      return cw[c] !== undefined ? cw[c] : DEFAULT_COL_WIDTH;
    }
    function setColWidth(c, px, skipUndo) {
      sheet().colWidths = sheet().colWidths || {};
      sheet().colWidths[c] = Math.max(32, Math.min(600, px));
      applyColWidth(c);
      ctx.markDirty();
      if (!skipUndo) recordSheet();
    }
    function applyColWidth(c) {
      const w = getColWidth(c);
      if (colgroupEl && colgroupEl.children[c + 1]) {
        colgroupEl.children[c + 1].style.width = `${w}px`;
      }
      const th = theadEl && theadEl.querySelector(`th[data-c="${c}"]`);
      if (th) {
        th.style.width = `${w}px`;
        th.style.minWidth = `${w}px`;
        th.style.maxWidth = `${w}px`;
      }
      if (tbody) {
        Array.from(tbody.rows).forEach((tr) => {
          const td = tr.cells[c + 1];
          if (td) {
            td.style.width = `${w}px`;
            td.style.minWidth = `${w}px`;
            td.style.maxWidth = `${w}px`;
          }
        });
      }
    }

    function getRowHeight(r) {
      const rh = sheet().rowHeights || {};
      return rh[r] !== undefined ? rh[r] : DEFAULT_ROW_HEIGHT;
    }
    function setRowHeight(r, px, skipUndo) {
      sheet().rowHeights = sheet().rowHeights || {};
      sheet().rowHeights[r] = Math.max(18, Math.min(300, px));
      applyRowHeight(r);
      ctx.markDirty();
      if (!skipUndo) recordSheet();
    }
    function applyRowHeight(r) {
      const h = getRowHeight(r);
      const tr = tbody && tbody.rows[r];
      if (tr) {
        tr.style.height = `${h}px`;
      }
    }

    /* ---------- Evaluator Core ---------- */
    function evaluateFormula(expr, currentR, currentC, sheetIdx = model.active) {
      if (!expr || !String(expr).startsWith('=')) return expr;
      const key = `${sheetIdx}!${currentR},${currentC}`;
      if (currentCalcCycle.has(key)) return '#CIRCULAR!';
      currentCalcCycle.add(key);

      try {
        const formulaBody = String(expr).slice(1).trim();
        const res = parseExpression(formulaBody, currentR, currentC, sheetIdx);
        currentCalcCycle.delete(key);
        return res;
      } catch (err) {
        currentCalcCycle.delete(key);
        return '#ERROR!';
      }
    }

    function parseExpression(str, curR, curC, sIdx) {
      str = str.trim();
      if (!str) return '';

      // Match Function Call: NAME(...)
      const fnMatch = /^([A-Z_]+)\s*\((.*)\)$/is.exec(str);
      if (fnMatch) {
        const fnName = fnMatch[1].toUpperCase();
        const argsStr = fnMatch[2];
        const fn = FORMULA_FUNCTIONS[fnName];
        if (fn) {
          const args = splitArguments(argsStr).map((arg) => {
            const range = parseRange(arg);
            if (range) {
              const targetSheetIdx = range.sheetName
                ? model.sheets.findIndex((s) => s.name.toLowerCase() === range.sheetName.toLowerCase())
                : sIdx;
              const actualSheet = targetSheetIdx >= 0 ? targetSheetIdx : sIdx;
              const matrix = [];
              for (let r = range.start.row; r <= range.end.row; r++) {
                const rArr = [];
                for (let c = range.start.col; c <= range.end.col; c++) {
                  rArr.push(getCellValue(r, c, actualSheet));
                }
                matrix.push(rArr);
              }
              return matrix.length === 1 && range.start.row === range.end.row ? matrix[0] : matrix;
            }
            return parseExpression(arg, curR, curC, sIdx);
          });
          return fn(args, { curR, curC, sIdx });
        }
      }

      // Binary operations
      const op = findLowestPrecedenceOp(str);
      if (op) {
        const left = parseExpression(str.slice(0, op.index), curR, curC, sIdx);
        const right = parseExpression(str.slice(op.index + op.len), curR, curC, sIdx);
        switch (op.token) {
          case '+': return (toNum(left) || 0) + (toNum(right) || 0);
          case '-': return (toNum(left) || 0) - (toNum(right) || 0);
          case '*': return (toNum(left) || 0) * (toNum(right) || 0);
          case '/': return (toNum(right) || 0) !== 0 ? (toNum(left) || 0) / (toNum(right) || 0) : '#DIV/0!';
          case '^': return Math.pow(toNum(left) || 0, toNum(right) || 0);
          case '&': return String(left ?? '') + String(right ?? '');
          case '=': return left == right;
          case '<>': return left != right;
          case '<': return (toNum(left) || 0) < (toNum(right) || 0);
          case '>': return (toNum(left) || 0) > (toNum(right) || 0);
          case '<=': return (toNum(left) || 0) <= (toNum(right) || 0);
          case '>=': return (toNum(left) || 0) >= (toNum(right) || 0);
        }
      }

      // Literals
      if (str.startsWith('"') && str.endsWith('"')) return str.slice(1, -1);
      if (isNumeric(str)) return Number(str.replace(/,/g, ''));
      if (str.toUpperCase() === 'TRUE') return true;
      if (str.toUpperCase() === 'FALSE') return false;

      // Cell reference
      const cellRef = parseCellRef(str);
      if (cellRef) {
        const targetSheetIdx = cellRef.sheetName
          ? model.sheets.findIndex((s) => s.name.toLowerCase() === cellRef.sheetName.toLowerCase())
          : sIdx;
        return getCellValue(cellRef.row, cellRef.col, targetSheetIdx >= 0 ? targetSheetIdx : sIdx);
      }

      return str;
    }

    function splitArguments(str) {
      const args = [];
      let depth = 0;
      let inQuotes = false;
      let cur = '';
      for (let i = 0; i < str.length; i++) {
        const ch = str[i];
        if (ch === '"') inQuotes = !inQuotes;
        else if (!inQuotes && (ch === '(' || ch === '[')) depth++;
        else if (!inQuotes && (ch === ')' || ch === ']')) depth--;
        else if (!inQuotes && depth === 0 && ch === ',') {
          args.push(cur.trim());
          cur = '';
          continue;
        }
        cur += ch;
      }
      if (cur.trim()) args.push(cur.trim());
      return args;
    }

    function findLowestPrecedenceOp(str) {
      let depth = 0;
      let inQuotes = false;
      const ops = [
        ['=', '<>', '<=', '>=', '<', '>'],
        ['&'],
        ['+', '-'],
        ['*', '/'],
        ['^']
      ];
      for (const opGroup of ops) {
        for (let i = str.length - 1; i >= 0; i--) {
          const ch = str[i];
          if (ch === '"') inQuotes = !inQuotes;
          else if (!inQuotes && ch === ')') depth++;
          else if (!inQuotes && ch === '(') depth--;
          else if (!inQuotes && depth === 0) {
            for (const op of opGroup) {
              if (str.substr(i, op.length) === op && (i > 0 || (op !== '+' && op !== '-'))) {
                return { token: op, index: i, len: op.length };
              }
            }
          }
        }
      }
      return null;
    }

    function getCellValue(r, c, sheetIdx = model.active) {
      const raw = getCellRaw(r, c, sheetIdx);
      if (String(raw).startsWith('=')) {
        return evaluateFormula(raw, r, c, sheetIdx);
      }
      return raw;
    }

    function getCellFormatted(r, c, sheetIdx = model.active) {
      const val = getCellValue(r, c, sheetIdx);
      const sh = model.sheets[sheetIdx];
      const st = sh && sh.styles ? sh.styles[`${r},${c}`] : null;
      const fmt = st && st.format ? st.format : 'general';
      const dec = st && st.numDecimals !== undefined ? st.numDecimals : 2;
      return formatCellValue(val, fmt, dec);
    }

    function captureSheet() {
      return {
        sheets: model.sheets,
        active: model.active,
        sel: sel ? { r: sel.r, c: sel.c } : { r: 0, c: 0 },
        selEnd: selEnd ? { r: selEnd.r, c: selEnd.c } : null,
        autoFilterActive: !!autoFilterActive
      };
    }
    function restoreSheet(snap) {
      if (!snap) return;
      skipHistory = true;
      model.sheets = snap.sheets;
      model.active = snap.active || 0;
      autoFilterActive = !!snap.autoFilterActive;
      sel = snap.sel ? { r: snap.sel.r, c: snap.sel.c } : { r: 0, c: 0 };
      selEnd = snap.selEnd ? { r: snap.selEnd.r, c: snap.selEnd.c } : null;
      renderTabs();
      renderGrid();
      if (formulaInput) formulaInput.value = getCellRaw(sel.r, sel.c);
      updateStatus();
      skipHistory = false;
      focusGrid();
    }
    function recordSheet(opts) {
      if (skipHistory || history.isApplying() || !model) return;
      history.record(captureSheet(), opts);
    }

    function setCell(r, c, value, skipUndo) {
      const old = getCellRaw(r, c);
      if (old === value) return;
      const rows = sheet().rows;
      while (rows.length <= r) rows.push([]);
      const row = rows[r];
      while (row.length <= c) row.push('');
      row[c] = value;

      recalculateGrid();
      ctx.markDirty();
      updateStatus();
      if (!skipUndo) recordSheet();
    }

    function recalculateGrid() {
      for (let r = 0; r < viewR; r++) {
        for (let c = 0; c < viewC; c++) {
          const td = tdAt(r, c);
          if (td && td !== editingTd) {
            const formatted = getCellFormatted(r, c);
            td.textContent = formatted;
            td.classList.toggle('num', isNumeric(formatted));
          }
        }
      }
      renderCharts();
    }

    const tdAt = (r, c) => tbody && tbody.rows[r] ? tbody.rows[r].cells[c + 1] : null;

    function dims() {
      let maxR = 0, maxC = 0;
      (sheet().rows || []).forEach((row, r) => {
        if (!row) return;
        for (let c = row.length - 1; c >= 0; c--) {
          if (row[c] !== '' && row[c] !== undefined && row[c] !== null) {
            if (r + 1 > maxR) maxR = r + 1;
            if (c + 1 > maxC) maxC = c + 1;
            break;
          }
        }
      });
      return { rows: maxR, cols: maxC };
    }

    function updateStatus() {
      const d = dims();
      const used = d.rows ? `${d.rows} × ${d.cols} used` : 'empty';
      const z = zoom !== 1 ? ` · ${Math.round(zoom * 100)}%` : '';
      const rangeText = selEnd ? `${colName(Math.min(sel.c, selEnd.c))}${Math.min(sel.r, selEnd.r) + 1}:${colName(Math.max(sel.c, selEnd.c))}${Math.max(sel.r, selEnd.r) + 1}` : `${colName(sel.c)}${sel.r + 1}`;
      ctx.setStatus(`${rangeText}`, `Sheet ${model.active + 1} of ${model.sheets.length} · ${used}${z}`);

      // Sync ribbon font controls to active cell style
      const st = (sheet().styles || {})[`${sel.r},${sel.c}`] || {};
      const family = st.font || 'Calibri';
      if (fontSelect) {
        const names = [...fontSelect.options].map((o) => o.value);
        if (names.includes(family)) fontSelect.value = family;
        else if (names.includes('Calibri')) fontSelect.value = 'Calibri';
      }
      if (variantSelect) {
        FONTS.fillVariantSelect(
          variantSelect,
          FONTS.getFacesForFamily(fontSelect ? fontSelect.value : family, fontFacesByFamily),
          FONTS.inferFace(st)
        );
      }
      if (sizeSelect) sizeSelect.value = String(st.size || 11);
    }

    function applyZoom(clientX, clientY) {
      if (!gridScroll) return;
      const prev = parseFloat(gridScroll.style.zoom) || 1;
      const next = zoom;
      const rect = gridScroll.getBoundingClientRect();
      const mx = clientX != null ? clientX - rect.left : gridScroll.clientWidth / 2;
      const my = clientY != null ? clientY - rect.top : gridScroll.clientHeight / 2;
      gridScroll.style.zoom = String(next);
      if (prev !== next) {
        const ratio = next / prev;
        gridScroll.scrollLeft = (gridScroll.scrollLeft + mx) * ratio - mx;
        gridScroll.scrollTop = (gridScroll.scrollTop + my) * ratio - my;
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

    function focusGrid() {
      if (gridScroll) gridScroll.focus({ preventScroll: true });
    }

    function scrollCellIntoView(td) {
      if (!td || !gridScroll) return;
      const cell = td.getBoundingClientRect();
      const port = gridScroll.getBoundingClientRect();
      if (cell.top < port.top) gridScroll.scrollTop -= (port.top - cell.top);
      else if (cell.bottom > port.bottom) gridScroll.scrollTop += (cell.bottom - port.bottom);
      if (cell.left < port.left) gridScroll.scrollLeft -= (port.left - cell.left);
      else if (cell.right > port.right) gridScroll.scrollLeft += (cell.right - port.right);
    }

    /* ---------- Grid Rendering with Interactive Resizing ---------- */
    function renderGrid() {
      const d = dims();
      const targetR = Math.max(MIN_ROWS, d.rows + 8);
      const targetC = Math.max(MIN_COLS, d.cols + 4);
      viewR = Math.min(targetR, MAX_INITIAL_RENDER_ROWS);
      viewC = Math.min(targetC, MAX_INITIAL_RENDER_COLS);

      tableEl = document.createElement('table');
      tableEl.className = 'sheet-grid';

      colgroupEl = document.createElement('colgroup');
      const cornerCol = document.createElement('col');
      cornerCol.style.width = '48px';
      colgroupEl.appendChild(cornerCol);
      for (let c = 0; c < viewC; c++) {
        const col = document.createElement('col');
        col.style.width = `${getColWidth(c)}px`;
        colgroupEl.appendChild(col);
      }
      tableEl.appendChild(colgroupEl);

      theadEl = document.createElement('thead');
      const hr = document.createElement('tr');
      hr.appendChild(Object.assign(document.createElement('th'), { className: 'corner' }));
      for (let c = 0; c < viewC; c++) {
        const th = document.createElement('th');
        const w = getColWidth(c);
        th.style.width = `${w}px`;
        th.style.minWidth = `${w}px`;
        th.style.maxWidth = `${w}px`;
        th.innerHTML = `<span>${colName(c)}</span>${autoFilterActive ? '<span class="sheet-filter-btn">▼</span>' : ''}`;
        th.dataset.c = c;
        wireColResizer(th, c);
        hr.appendChild(th);
      }
      theadEl.appendChild(hr);
      tableEl.appendChild(theadEl);

      tbody = document.createElement('tbody');
      for (let r = 0; r < viewR; r++) {
        const tr = document.createElement('tr');
        const h = getRowHeight(r);
        tr.style.height = `${h}px`;

        const th = document.createElement('th');
        th.textContent = r + 1;
        th.dataset.r = r;
        wireRowResizer(th, r);
        tr.appendChild(th);

        for (let c = 0; c < viewC; c++) {
          const td = document.createElement('td');
          const w = getColWidth(c);
          td.style.width = `${w}px`;
          td.style.minWidth = `${w}px`;
          td.style.maxWidth = `${w}px`;

          const formatted = getCellFormatted(r, c);
          if (formatted) td.textContent = formatted;
          if (formatted && isNumeric(formatted)) td.className = 'num';
          applyCellStyleToTd(td, r, c);
          tr.appendChild(td);
        }
        tbody.appendChild(tr);
      }
      tableEl.appendChild(tbody);
      gridScroll.innerHTML = '';
      gridScroll.appendChild(tableEl);

      renderCharts();
      select(Math.min(sel.r, viewR - 1), Math.min(sel.c, viewC - 1), false);
    }

    function wireColResizer(th, c) {
      const handle = document.createElement('div');
      handle.className = 'sheet-col-resizer';
      let startX = 0, startW = 0;

      handle.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        handle.classList.add('resizing');
        startX = e.clientX;
        startW = getColWidth(c);
        let moved = false;

        const onMove = (ev) => {
          moved = true;
          const newW = Math.max(36, startW + (ev.clientX - startX));
          setColWidth(c, newW, true);
        };
        const onUp = () => {
          handle.classList.remove('resizing');
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
          if (moved) recordSheet();
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      });

      handle.addEventListener('dblclick', (e) => {
        e.preventDefault();
        e.stopPropagation();
        let maxLen = 4;
        (sheet().rows || []).forEach((row) => {
          if (row && row[c] != null) {
            const l = String(row[c]).length;
            if (l > maxLen) maxLen = l;
          }
        });
        const autoW = Math.max(48, Math.min(450, maxLen * 8.5 + 24));
        setColWidth(c, autoW);
      });

      th.appendChild(handle);
    }

    function wireRowResizer(th, r) {
      const handle = document.createElement('div');
      handle.className = 'sheet-row-resizer';
      let startY = 0, startH = 0;

      handle.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        handle.classList.add('resizing');
        startY = e.clientY;
        startH = getRowHeight(r);
        let moved = false;

        const onMove = (ev) => {
          moved = true;
          const newH = Math.max(18, startH + (ev.clientY - startY));
          setRowHeight(r, newH, true);
        };
        const onUp = () => {
          handle.classList.remove('resizing');
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
          if (moved) recordSheet();
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      });

      th.appendChild(handle);
    }

    function applyCellStyleToTd(td, r, c) {
      const sh = sheet();
      if (!sh || !sh.styles) return;
      const st = sh.styles[`${r},${c}`];
      if (!st) return;
      const face = FONTS.inferFace(st);
      const parsed = FONTS.parseFontFaceStyle(face);
      td.classList.toggle('cell-bold', parsed.weight >= 700);
      td.classList.toggle('cell-italic', parsed.fontStyle === 'italic');
      td.classList.toggle('cell-underline', !!st.underline);
      td.classList.toggle('cell-strike', !!st.strike);
      td.classList.toggle('cell-wrap', !!st.wrap);
      if (st.align) td.classList.add(`cell-align-${st.align}`);
      if (st.valign) td.classList.add(`cell-valign-${st.valign}`);
      if (st.border) td.classList.add(`border-${st.border}`);
      if (st.fill) td.style.backgroundColor = st.fill;
      if (st.color) td.style.color = st.color;
      const family = st.font || 'Calibri';
      td.style.fontFamily = FONTS.fontFamilyCss(
        family,
        face,
        FONTS.getFacesForFamily(family, fontFacesByFamily)
      );
      td.style.fontWeight = String(parsed.weight);
      td.style.fontStyle = parsed.fontStyle;
      if (st.size) {
        td.style.fontSize = `${st.size}pt`;
        const minH = Math.max(24, Math.round(st.size * 1.5) + 4);
        if (getRowHeight(r) < minH) setRowHeight(r, minH, true);
      }
    }

    function extendRows(n) {
      const start = viewR;
      viewR += n;
      for (let r = start; r < viewR; r++) {
        const tr = document.createElement('tr');
        const h = getRowHeight(r);
        tr.style.height = `${h}px`;

        const th = document.createElement('th');
        th.textContent = r + 1; th.dataset.r = r;
        wireRowResizer(th, r);
        tr.appendChild(th);

        for (let c = 0; c < viewC; c++) {
          const td = document.createElement('td');
          const w = getColWidth(c);
          td.style.width = `${w}px`;
          td.style.minWidth = `${w}px`;
          td.style.maxWidth = `${w}px`;

          const formatted = getCellFormatted(r, c);
          if (formatted) td.textContent = formatted;
          if (formatted && isNumeric(formatted)) td.className = 'num';
          applyCellStyleToTd(td, r, c);
          tr.appendChild(td);
        }
        tbody.appendChild(tr);
      }
    }

    function extendCols(n) {
      const start = viewC;
      viewC += n;
      const hr = gridScroll.querySelector('thead tr');
      for (let c = start; c < viewC; c++) {
        const col = document.createElement('col');
        col.style.width = `${getColWidth(c)}px`;
        if (colgroupEl) colgroupEl.appendChild(col);

        const th = document.createElement('th');
        const w = getColWidth(c);
        th.style.width = `${w}px`;
        th.style.minWidth = `${w}px`;
        th.style.maxWidth = `${w}px`;
        th.innerHTML = `<span>${colName(c)}</span>${autoFilterActive ? '<span class="sheet-filter-btn">▼</span>' : ''}`;
        th.dataset.c = c;
        wireColResizer(th, c);
        hr.appendChild(th);
      }
      Array.from(tbody.rows).forEach((tr, r) => {
        for (let c = start; c < viewC; c++) {
          const td = document.createElement('td');
          const w = getColWidth(c);
          td.style.width = `${w}px`;
          td.style.minWidth = `${w}px`;
          td.style.maxWidth = `${w}px`;

          const formatted = getCellFormatted(r, c);
          if (formatted) td.textContent = formatted;
          if (formatted && isNumeric(formatted)) td.className = 'num';
          applyCellStyleToTd(td, r, c);
          tr.appendChild(td);
        }
      });
    }

    /* ---------- Selection & Range Highlights ---------- */
    function select(r, c, scroll = true) {
      if (editingTd) commitEdit(true);
      r = Math.max(0, r); c = Math.max(0, c);
      if (r >= viewR) extendRows(r - viewR + 20);
      if (c >= viewC) extendCols(c - viewC + 4);

      clearRangeSelection();
      sel = { r, c };
      selEnd = null;

      const td = tdAt(r, c);
      if (td) {
        td.classList.add('sel');
        if (scroll) scrollCellIntoView(td);
      }
      highlightHeaders(true);
      nameBox.textContent = `${colName(c)}${r + 1}`;
      formulaInput.value = getCellRaw(r, c);
      updateStatus();
    }

    function selectRange(startR, startC, endR, endC) {
      clearRangeSelection();
      sel = { r: startR, c: startC };
      selEnd = { r: endR, c: endC };

      const minR = Math.min(startR, endR), maxR = Math.max(startR, endR);
      const minC = Math.min(startC, endC), maxC = Math.max(startC, endC);

      for (let r = minR; r <= maxR; r++) {
        for (let c = minC; c <= maxC; c++) {
          const td = tdAt(r, c);
          if (td) {
            if (r === startR && c === startC) td.classList.add('sel');
            else td.classList.add('range-sel');
          }
        }
      }
      highlightHeaders(true);
      nameBox.textContent = `${colName(minC)}${minR + 1}:${colName(maxC)}${maxR + 1}`;
      updateStatus();
    }

    function clearRangeSelection() {
      if (!tbody) return;
      tbody.querySelectorAll('td.sel, td.range-sel, td.marching').forEach((td) => {
        td.classList.remove('sel', 'range-sel', 'marching');
      });
      highlightHeaders(false);
    }

    function highlightHeaders(on) {
      if (!gridScroll) return;
      const minR = selEnd ? Math.min(sel.r, selEnd.r) : sel.r;
      const maxR = selEnd ? Math.max(sel.r, selEnd.r) : sel.r;
      const minC = selEnd ? Math.min(sel.c, selEnd.c) : sel.c;
      const maxC = selEnd ? Math.max(sel.c, selEnd.c) : sel.c;

      gridScroll.querySelectorAll('thead th, tbody th').forEach((th) => {
        const c = th.dataset.c !== undefined ? Number(th.dataset.c) : null;
        const r = th.dataset.r !== undefined ? Number(th.dataset.r) : null;
        if (c !== null) th.classList.toggle('hl', on && c >= minC && c <= maxC);
        if (r !== null) th.classList.toggle('hl', on && r >= minR && r <= maxR);
      });
    }

    /* ---------- Editing Cell ---------- */
    function beginEdit(replace = false) {
      const td = tdAt(sel.r, sel.c);
      if (!td || editingTd) return;
      editingTd = td;
      td.classList.add('editing');
      td.contentEditable = 'true';
      const raw = getCellRaw(sel.r, sel.c);
      td.textContent = replace ? '' : raw;
      formulaInput.value = td.textContent;
      td.focus({ preventScroll: true });

      const selObj = window.getSelection();
      selObj.selectAllChildren(td);
      if (replace) selObj.collapseToEnd();
    }

    function commitEdit(silent = false) {
      if (!editingTd) return;
      const td = editingTd;
      editingTd = null;
      td.contentEditable = 'false';
      td.classList.remove('editing');
      const val = td.textContent.trim();
      setCell(sel.r, sel.c, val);
      if (!silent) focusGrid();
    }

    function cancelEdit() {
      if (!editingTd) return;
      const td = editingTd;
      editingTd = null;
      td.contentEditable = 'false';
      td.classList.remove('editing');
      td.textContent = getCellFormatted(sel.r, sel.c);
      formulaInput.value = getCellRaw(sel.r, sel.c);
      focusGrid();
    }

    /* ---------- Formatting & Styling Operations ---------- */
    function applyStyleToSelection(stylePatch) {
      const minR = selEnd ? Math.min(sel.r, selEnd.r) : sel.r;
      const maxR = selEnd ? Math.max(sel.r, selEnd.r) : sel.r;
      const minC = selEnd ? Math.min(sel.c, selEnd.c) : sel.c;
      const maxC = selEnd ? Math.max(sel.c, selEnd.c) : sel.c;

      sheet().styles = sheet().styles || {};
      for (let r = minR; r <= maxR; r++) {
        for (let c = minC; c <= maxC; c++) {
          const key = `${r},${c}`;
          sheet().styles[key] = { ...(sheet().styles[key] || {}), ...stylePatch };
          const td = tdAt(r, c);
          if (td) applyCellStyleToTd(td, r, c);
        }
      }
      ctx.markDirty();
      recalculateGrid();
      updateStatus();
      recordSheet();
    }

    function applyFontFaceToSelection(family, styleLabel) {
      applyStyleToSelection(FONTS.stylePatchFromFace(family, styleLabel || 'Regular'));
    }

    function toggleFaceFlag(kind) {
      const st = (sheet().styles || {})[`${sel.r},${sel.c}`] || {};
      const family = st.font || (fontSelect && fontSelect.value) || 'Calibri';
      const faces = FONTS.getFacesForFamily(family, fontFacesByFamily);
      const parsed = FONTS.parseFontFaceStyle(FONTS.inferFace(st));
      let weight = parsed.weight;
      let italic = parsed.fontStyle === 'italic';
      if (kind === 'bold') weight = weight >= 700 ? 400 : 700;
      if (kind === 'italic') italic = !italic;
      const nextFace = FONTS.matchFaceFromComputed(faces, weight, italic ? 'italic' : 'normal');
      applyFontFaceToSelection(family, nextFace);
    }

    async function loadSystemFonts() {
      const catalog = await FONTS.loadSystemFonts();
      fontFacesByFamily = catalog.facesByFamily;
      FONTS.fillFamilySelect(fontSelect, catalog.families);
      if (variantSelect) {
        FONTS.fillVariantSelect(
          variantSelect,
          FONTS.getFacesForFamily(fontSelect ? fontSelect.value : 'Calibri', fontFacesByFamily)
        );
      }
      if (tbody) {
        for (let r = 0; r < viewR; r++) {
          for (let c = 0; c < viewC; c++) {
            const td = tdAt(r, c);
            if (td) applyCellStyleToTd(td, r, c);
          }
        }
      }
      updateStatus();
    }

    function setNumberFormat(fmt, decimals) {
      applyStyleToSelection({ format: fmt, numDecimals: decimals });
    }

    function stepDecimals(delta) {
      const st = (sheet().styles || {})[`${sel.r},${sel.c}`] || {};
      const cur = st.numDecimals !== undefined ? st.numDecimals : 2;
      const next = Math.max(0, Math.min(10, cur + delta));
      applyStyleToSelection({ numDecimals: next });
    }

    function stepFontSize(delta) {
      const st = (sheet().styles || {})[`${sel.r},${sel.c}`] || {};
      const cur = st.size !== undefined ? st.size : 11;
      let nextIdx = FONT_SIZES.findIndex((s) => s >= cur);
      if (nextIdx === -1) nextIdx = 3;
      nextIdx = Math.max(0, Math.min(FONT_SIZES.length - 1, nextIdx + delta));
      const nextSize = FONT_SIZES[nextIdx];
      applyStyleToSelection({ size: nextSize });
      if (sizeSelect) sizeSelect.value = String(nextSize);
    }

    /* ---------- Native SVG Charts Engine ---------- */
    function renderCharts() {
      if (!gridScroll) return;
      gridScroll.querySelectorAll('.sheet-chart-box').forEach((b) => b.remove());
      const charts = sheet().charts || [];

      charts.forEach((ch, idx) => {
        const box = document.createElement('div');
        box.className = 'sheet-chart-box';
        box.style.left = `${ch.x || 60 + idx * 30}px`;
        box.style.top = `${ch.y || 40 + idx * 30}px`;
        box.style.width = `${ch.width || 380}px`;
        box.style.height = `${ch.height || 260}px`;

        const head = document.createElement('div');
        head.className = 'sheet-chart-header';
        head.innerHTML = `<span>${escapeHtml(ch.title || 'Chart')}</span><button type="button" class="icon-btn" title="Delete chart" style="width:20px;height:20px;font-size:11px">✕</button>`;
        head.querySelector('button').addEventListener('click', (e) => {
          e.stopPropagation();
          sheet().charts.splice(idx, 1);
          ctx.markDirty();
          renderCharts();
          recordSheet();
        });
        box.appendChild(head);

        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('class', 'sheet-chart-svg');
        svg.setAttribute('viewBox', '0 0 380 228');

        const range = parseRange(ch.range || 'A1:B5');
        const labels = [];
        const values = [];
        if (range) {
          for (let r = range.start.row; r <= range.end.row; r++) {
            labels.push(String(getCellValue(r, range.start.col)));
            values.push(toNum(getCellValue(r, range.end.col)) || 0);
          }
        }

        buildSvgChart(svg, ch.type, labels, values, ch.title);
        box.appendChild(svg);

        let drag = null;
        head.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          drag = { startX: e.clientX, startY: e.clientY, initX: box.offsetLeft, initY: box.offsetTop };
          const onMove = (ev) => {
            if (!drag) return;
            box.style.left = `${Math.max(10, drag.initX + (ev.clientX - drag.startX))}px`;
            box.style.top = `${Math.max(10, drag.initY + (ev.clientY - drag.startY))}px`;
          };
          const onUp = () => {
            if (drag) {
              ch.x = box.offsetLeft;
              ch.y = box.offsetTop;
              ctx.markDirty();
              recordSheet();
            }
            drag = null;
            document.removeEventListener('pointermove', onMove);
            document.removeEventListener('pointerup', onUp);
          };
          document.addEventListener('pointermove', onMove);
          document.addEventListener('pointerup', onUp);
        });

        gridScroll.appendChild(box);
      });
    }

    function buildSvgChart(svg, type, labels, values) {
      const maxVal = Math.max(1, ...values);
      const W = 380, H = 228, padL = 45, padR = 20, padT = 20, padB = 40;
      const plotW = W - padL - padR, plotH = H - padT - padB;

      const axis = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      axis.setAttribute('d', `M ${padL} ${padT} V ${H - padB} H ${W - padR}`);
      axis.setAttribute('stroke', '#94a3b8');
      axis.setAttribute('stroke-width', '1');
      axis.setAttribute('fill', 'none');
      svg.appendChild(axis);

      const n = values.length || 1;
      const colors = ['#2563eb', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];

      if (type === 'bar' || type === 'column') {
        const barW = (plotW / n) * 0.65;
        const step = plotW / n;
        values.forEach((v, i) => {
          const barH = (v / maxVal) * plotH;
          const x = padL + i * step + (step - barW) / 2;
          const y = H - padB - barH;
          const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
          rect.setAttribute('x', x);
          rect.setAttribute('y', y);
          rect.setAttribute('width', barW);
          rect.setAttribute('height', Math.max(2, barH));
          rect.setAttribute('fill', colors[i % colors.length]);
          rect.setAttribute('rx', '3');
          svg.appendChild(rect);

          const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
          txt.setAttribute('x', x + barW / 2);
          txt.setAttribute('y', H - padB + 16);
          txt.setAttribute('text-anchor', 'middle');
          txt.setAttribute('font-size', '10');
          txt.setAttribute('fill', '#64748b');
          txt.textContent = labels[i] ? labels[i].slice(0, 8) : '';
          svg.appendChild(txt);
        });
      } else if (type === 'line') {
        let pathD = '';
        const step = plotW / Math.max(1, n - 1);
        values.forEach((v, i) => {
          const x = padL + i * step;
          const y = H - padB - (v / maxVal) * plotH;
          pathD += `${i === 0 ? 'M' : 'L'} ${x} ${y} `;
          const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
          dot.setAttribute('cx', x);
          dot.setAttribute('cy', y);
          dot.setAttribute('r', '4');
          dot.setAttribute('fill', '#2563eb');
          svg.appendChild(dot);
        });
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        line.setAttribute('d', pathD);
        line.setAttribute('stroke', '#2563eb');
        line.setAttribute('stroke-width', '2.5');
        line.setAttribute('fill', 'none');
        svg.appendChild(line);
      } else if (type === 'pie') {
        const total = values.reduce((a, b) => a + b, 0) || 1;
        let startAngle = 0;
        const cx = W / 2, cy = H / 2, r = 70;
        values.forEach((v, i) => {
          const angle = (v / total) * Math.PI * 2;
          const x1 = cx + r * Math.cos(startAngle);
          const y1 = cy + r * Math.sin(startAngle);
          const x2 = cx + r * Math.cos(startAngle + angle);
          const y2 = cy + r * Math.sin(startAngle + angle);
          const largeArc = angle > Math.PI ? 1 : 0;
          const d = `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} Z`;
          const slice = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          slice.setAttribute('d', d);
          slice.setAttribute('fill', colors[i % colors.length]);
          slice.setAttribute('stroke', '#ffffff');
          slice.setAttribute('stroke-width', '1.5');
          svg.appendChild(slice);
          startAngle += angle;
        });
      }
    }

    function insertChart(type = 'column') {
      const selectedRange = selEnd
        ? `${colName(Math.min(sel.c, selEnd.c))}${Math.min(sel.r, selEnd.r) + 1}:${colName(Math.max(sel.c, selEnd.c))}${Math.max(sel.r, selEnd.r) + 1}`
        : 'A1:B5';
      sheet().charts = sheet().charts || [];
      sheet().charts.push({
        id: 'c' + Date.now().toString(36),
        type,
        title: `${type.toUpperCase()} Chart`,
        range: selectedRange,
        x: 80,
        y: 60,
        width: 380,
        height: 260
      });
      ctx.markDirty();
      renderCharts();
      recordSheet();
      ctx.toast(`Inserted ${type} chart`);
    }

    /* ---------- Find & Replace Modal for Spreadsheets ---------- */
    function openFindModal() {
      const wrap = document.createElement('div');
      wrap.style.display = 'flex';
      wrap.style.flexDirection = 'column';
      wrap.style.gap = '10px';

      const input = document.createElement('input');
      input.placeholder = 'Find in spreadsheet…';
      input.className = 'sheet-fx-search';

      const status = document.createElement('div');
      status.style.fontSize = '11.5px';
      status.style.color = 'var(--text-soft)';
      status.textContent = 'Enter text or number to find';

      wrap.appendChild(input);
      wrap.appendChild(status);

      let found = [];
      let foundIdx = 0;

      function clearSheetFindHits() {
        if (!gridScroll) return;
        gridScroll.querySelectorAll('td.sheet-find-hit, td.sheet-find-current').forEach((td) => {
          td.classList.remove('sheet-find-hit', 'sheet-find-current');
        });
      }

      function paintSheetFindHits() {
        clearSheetFindHits();
        found.forEach((cell, i) => {
          const td = tdAt(cell.r, cell.c);
          if (!td) return;
          td.classList.add('sheet-find-hit');
          if (i === foundIdx) td.classList.add('sheet-find-current');
        });
      }

      function doFind() {
        const keep = document.activeElement === input;
        found = [];
        foundIdx = 0;
        const q = input.value.trim().toLowerCase();
        if (!q) {
          status.textContent = 'Enter text or number to find';
          clearSheetFindHits();
          if (keep) input.focus();
          return;
        }

        sheet().rows.forEach((row, r) => {
          (row || []).forEach((val, c) => {
            if (val != null && String(val).toLowerCase().includes(q)) {
              found.push({ r, c, val: String(val) });
            }
          });
        });

        if (found.length) {
          status.textContent = `Found ${found.length} match${found.length > 1 ? 'es' : ''} (Match 1 of ${found.length})`;
          select(found[0].r, found[0].c);
        } else {
          status.textContent = 'No matches found';
        }
        paintSheetFindHits();
        if (keep) input.focus();
      }

      input.addEventListener('input', doFind);
      setTimeout(() => { input.focus(); input.select(); }, 40);

      ctx.openModal('Find in Spreadsheet', wrap, [
        { label: 'Close', value: null },
        {
          label: 'Next ➔',
          primary: true,
          value: () => {
            if (found.length) {
              foundIdx = (foundIdx + 1) % found.length;
              status.textContent = `Match ${foundIdx + 1} of ${found.length}`;
              select(found[foundIdx].r, found[foundIdx].c);
              paintSheetFindHits();
            }
          }
        }
      ]).then(() => {
        found = [];
        foundIdx = 0;
        clearSheetFindHits();
      });
    }

    /* ---------- Function Wizard Modal (fx) ---------- */
    function openFunctionWizard() {
      const wrap = document.createElement('div');
      wrap.className = 'sheet-fx-modal';

      const search = document.createElement('input');
      search.type = 'search';
      search.className = 'sheet-fx-search';
      search.placeholder = 'Search functions (e.g. SUM, VLOOKUP, IF)…';

      const catTabs = document.createElement('div');
      catTabs.className = 'sheet-fx-cats';
      const cats = ['All', 'Math', 'Logical', 'Lookup', 'Text', 'Date', 'Stats', 'Financial'];
      let activeCat = 'All';

      cats.forEach((cat) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `sheet-fx-cat ${cat === activeCat ? 'active' : ''}`;
        btn.textContent = cat;
        btn.addEventListener('click', () => {
          activeCat = cat;
          catTabs.querySelectorAll('.sheet-fx-cat').forEach((b) => b.classList.remove('active'));
          btn.classList.add('active');
          renderList();
        });
        catTabs.appendChild(btn);
      });

      const listEl = document.createElement('div');
      listEl.className = 'sheet-fx-list';

      const descBox = document.createElement('div');
      descBox.className = 'sheet-fx-desc';
      descBox.innerHTML = '<div class="sheet-fx-syntax">Select a function</div><div>Function description and syntax will appear here.</div>';

      let selectedFn = FX_CATALOG[0];

      function renderList() {
        listEl.innerHTML = '';
        const q = search.value.toLowerCase().trim();
        const filtered = FX_CATALOG.filter((f) => {
          const matchCat = activeCat === 'All' || f.cat === activeCat;
          const matchQ = !q || f.name.toLowerCase().includes(q) || f.desc.toLowerCase().includes(q);
          return matchCat && matchQ;
        });

        filtered.forEach((f) => {
          const item = document.createElement('div');
          item.className = `sheet-fx-item ${selectedFn === f ? 'active' : ''}`;
          item.innerHTML = `<span class="sheet-fx-item-name">${f.name}</span><span class="sheet-fx-item-cat">${f.cat}</span>`;
          item.addEventListener('click', () => {
            selectedFn = f;
            listEl.querySelectorAll('.sheet-fx-item').forEach((i) => i.classList.remove('active'));
            item.classList.add('active');
            descBox.innerHTML = `<div class="sheet-fx-syntax">=${escapeHtml(f.syntax)}</div><div>${escapeHtml(f.desc)}</div>`;
          });
          listEl.appendChild(item);
        });
      }

      search.addEventListener('input', renderList);
      renderList();

      wrap.appendChild(search);
      wrap.appendChild(catTabs);
      wrap.appendChild(listEl);
      wrap.appendChild(descBox);

      ctx.openModal('Insert Function', wrap, [
        { label: 'Cancel', value: null },
        {
          label: 'Insert',
          primary: true,
          value: () => {
            if (selectedFn) {
              const insertText = `=${selectedFn.name}()`;
              setCell(sel.r, sel.c, insertText);
              formulaInput.value = insertText;
              setTimeout(() => {
                formulaInput.focus();
                formulaInput.setSelectionRange(insertText.length - 1, insertText.length - 1);
              }, 40);
            }
          }
        }
      ]);
    }

    /* ---------- Multi-Sheet Management ---------- */
    function renderTabs() {
      tabsEl.innerHTML = '';
      model.sheets.forEach((s, idx) => {
        const tab = document.createElement('button');
        tab.type = 'button';
        tab.className = `sheet-tab ${idx === model.active ? 'active' : ''}`;
        tab.innerHTML = `<span>${escapeHtml(s.name)}</span>`;

        if (model.sheets.length > 1) {
          const close = document.createElement('span');
          close.className = 'tab-x';
          close.innerHTML = window.MargoIcons.close || '✕';
          close.addEventListener('click', (e) => {
            e.stopPropagation();
            if (model.sheets.length <= 1) return;
            model.sheets.splice(idx, 1);
            if (model.active >= model.sheets.length) model.active = model.sheets.length - 1;
            ctx.markDirty();
            renderTabs();
            renderGrid();
            recordSheet();
          });
          tab.appendChild(close);
        }

        tab.addEventListener('click', () => {
          if (model.active === idx) return;
          model.active = idx;
          renderTabs();
          renderGrid();
        });

        tab.addEventListener('dblclick', async () => {
          const newName = await ctx.inputModal('Rename Sheet', 'Sheet name', s.name);
          if (newName && newName.trim()) {
            s.name = newName.trim();
            ctx.markDirty();
            renderTabs();
            recordSheet();
          }
        });

        tabsEl.appendChild(tab);
      });

      const addBtn = document.createElement('button');
      addBtn.type = 'button';
      addBtn.className = 'sheet-tab-add';
      addBtn.textContent = '+';
      addBtn.title = 'Add Sheet';
      addBtn.addEventListener('click', () => {
        model.sheets.push({ name: `Sheet${model.sheets.length + 1}`, rows: [], styles: {}, colWidths: {}, rowHeights: {}, charts: [] });
        model.active = model.sheets.length - 1;
        ctx.markDirty();
        renderTabs();
        renderGrid();
        recordSheet();
      });
      tabsEl.appendChild(addBtn);
    }

    /* ---------- Ribbon Toolbar ---------- */
    function buildRibbon() {
      const tb = ctx.toolbar;
      tb.innerHTML = '';
      tb.className = 'toolbar sheet-ribbon';
      const I = window.MargoIcons;

      const tabsBar = document.createElement('div');
      tabsBar.className = 'sheet-ribbon-tabs';

      const panels = {};
      const TABS = [
        { id: 'home', label: 'Home' },
        { id: 'insert', label: 'Insert' },
        { id: 'formulas', label: 'Formulas' },
        { id: 'data', label: 'Data' },
        { id: 'view', label: 'View' }
      ];

      TABS.forEach((t) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `sheet-ribbon-tab ${t.id === activeRibbonTab ? 'active' : ''}`;
        btn.textContent = t.label;
        btn.addEventListener('click', () => {
          activeRibbonTab = t.id;
          tabsBar.querySelectorAll('.sheet-ribbon-tab').forEach((b) => b.classList.remove('active'));
          btn.classList.add('active');
          Object.entries(panels).forEach(([pid, panel]) => {
            panel.classList.toggle('hidden', pid !== t.id);
          });
        });
        tabsBar.appendChild(btn);

        const panel = document.createElement('div');
        panel.className = `sheet-ribbon-panel ${t.id === activeRibbonTab ? '' : 'hidden'}`;
        panels[t.id] = panel;
      });

      tb.appendChild(tabsBar);
      Object.values(panels).forEach((p) => tb.appendChild(p));

      const makeBtn = (targetPanel, title, html, fn) => {
        const b = document.createElement('button');
        b.className = 'icon-btn';
        b.title = title;
        b.innerHTML = html;
        b.addEventListener('mousedown', (e) => e.preventDefault());
        b.addEventListener('click', fn);
        targetPanel.appendChild(b);
        return b;
      };
      const makeSep = (targetPanel) => {
        const s = document.createElement('span');
        s.className = 'tb-sep';
        targetPanel.appendChild(s);
      };

      /* ===== 1. HOME TAB ===== */
      const pHome = panels.home;

      makeBtn(pHome, 'Undo (Ctrl+Z)', I.undo, () => undo());
      makeBtn(pHome, 'Redo (Ctrl+Y)', I.redo, () => redo());
      makeSep(pHome);

      // Font family
      fontSelect = document.createElement('select');
      fontSelect.className = 'tb-select tb-font';
      fontSelect.title = 'Font family';
      FONTS.fillFamilySelect(fontSelect, FONT_FAMILIES.slice());
      fontSelect.addEventListener('change', () => {
        FONTS.fillVariantSelect(
          variantSelect,
          FONTS.getFacesForFamily(fontSelect.value, fontFacesByFamily)
        );
        applyFontFaceToSelection(fontSelect.value, variantSelect ? variantSelect.value : 'Regular');
      });
      pHome.appendChild(fontSelect);

      // Font variant / style
      variantSelect = document.createElement('select');
      variantSelect.className = 'tb-select tb-font-variant';
      variantSelect.title = 'Font weight & style';
      FONTS.fillVariantSelect(
        variantSelect,
        FONTS.getFacesForFamily(fontSelect.value, fontFacesByFamily)
      );
      variantSelect.addEventListener('change', () => {
        applyFontFaceToSelection(fontSelect.value, variantSelect.value);
      });
      pHome.appendChild(variantSelect);

      // Font size
      sizeSelect = document.createElement('select');
      sizeSelect.className = 'tb-select tb-size';
      FONT_SIZES.forEach((s) => {
        const o = document.createElement('option');
        o.value = String(s); o.textContent = s;
        sizeSelect.appendChild(o);
      });
      sizeSelect.value = '11';
      sizeSelect.title = 'Font size (pt)';
      sizeSelect.addEventListener('change', () => applyStyleToSelection({ size: parseInt(sizeSelect.value, 10) }));
      pHome.appendChild(sizeSelect);

      // Increase / Decrease Font size buttons
      makeBtn(pHome, 'Increase font size', '<span class="tb-glyph" style="font-size:13px">A<sup>▲</sup></span>', () => stepFontSize(1));
      makeBtn(pHome, 'Decrease font size', '<span class="tb-glyph" style="font-size:11px">A<sub>▼</sub></span>', () => stepFontSize(-1));

      makeSep(pHome);

      makeBtn(pHome, 'Bold (Ctrl+B)', '<span class="tb-glyph">B</span>', () => toggleFaceFlag('bold'));
      makeBtn(pHome, 'Italic (Ctrl+I)', '<span class="tb-glyph i">I</span>', () => toggleFaceFlag('italic'));
      makeBtn(pHome, 'Underline (Ctrl+U)', '<span class="tb-glyph u">U</span>', () => {
        const st = (sheet().styles || {})[`${sel.r},${sel.c}`] || {};
        applyStyleToSelection({ underline: !st.underline });
      });

      makeSep(pHome);

      // Fill Color
      const fillBtn = document.createElement('button');
      fillBtn.className = 'icon-btn';
      fillBtn.title = 'Cell Fill Color';
      fillBtn.innerHTML = I.shading || '🎨';
      fillBtn.addEventListener('click', () => {
        const pal = document.createElement('div');
        pal.className = 'color-pop';
        FILL_COLORS.forEach((c) => {
          const sw = document.createElement('button');
          sw.className = 'color-swatch';
          sw.style.background = c;
          sw.addEventListener('click', (e) => {
            e.stopPropagation();
            pal.remove();
            applyStyleToSelection({ fill: c });
          });
          pal.appendChild(sw);
        });
        fillBtn.appendChild(pal);
        setTimeout(() => {
          const dismiss = (e) => { if (!pal.contains(e.target)) { pal.remove(); document.removeEventListener('mousedown', dismiss, true); } };
          document.addEventListener('mousedown', dismiss, true);
        }, 0);
      });
      pHome.appendChild(fillBtn);

      // Text Color
      const colorBtn = document.createElement('button');
      colorBtn.className = 'icon-btn';
      colorBtn.title = 'Font Color';
      colorBtn.innerHTML = '<span class="tb-glyph" style="border-bottom:3px solid #1d4ed8;line-height:1">A</span>';
      colorBtn.addEventListener('click', () => {
        const pal = document.createElement('div');
        pal.className = 'color-pop';
        TEXT_COLORS.forEach((c) => {
          const sw = document.createElement('button');
          sw.className = 'color-swatch';
          sw.style.background = c;
          sw.addEventListener('click', (e) => {
            e.stopPropagation();
            pal.remove();
            applyStyleToSelection({ color: c });
          });
          pal.appendChild(sw);
        });
        colorBtn.appendChild(pal);
        setTimeout(() => {
          const dismiss = (e) => { if (!pal.contains(e.target)) { pal.remove(); document.removeEventListener('mousedown', dismiss, true); } };
          document.addEventListener('mousedown', dismiss, true);
        }, 0);
      });
      pHome.appendChild(colorBtn);

      makeSep(pHome);

      // Cell Borders
      const borderSelect = document.createElement('select');
      borderSelect.className = 'tb-select';
      borderSelect.title = 'Cell Borders';
      [
        ['', 'Borders ▾'],
        ['all', 'All Borders'],
        ['outer', 'Outside Borders'],
        ['thick', 'Thick Box Border'],
        ['none', 'No Border']
      ].forEach(([v, l]) => {
        const o = document.createElement('option');
        o.value = v; o.textContent = l;
        borderSelect.appendChild(o);
      });
      borderSelect.addEventListener('change', () => {
        if (borderSelect.value) {
          applyStyleToSelection({ border: borderSelect.value });
          borderSelect.value = '';
        }
      });
      pHome.appendChild(borderSelect);

      // Text Alignment
      makeBtn(pHome, 'Align left', I.alignLeft, () => applyStyleToSelection({ align: 'left' }));
      makeBtn(pHome, 'Align center', I.alignCenter, () => applyStyleToSelection({ align: 'center' }));
      makeBtn(pHome, 'Align right', I.alignRight, () => applyStyleToSelection({ align: 'right' }));
      makeBtn(pHome, 'Wrap text', I.wrap || '↩', () => {
        const st = (sheet().styles || {})[`${sel.r},${sel.c}`] || {};
        applyStyleToSelection({ wrap: !st.wrap });
      });

      makeSep(pHome);

      // Number Formats
      const fmtSelect = document.createElement('select');
      fmtSelect.className = 'tb-select';
      [
        ['general', 'General'],
        ['number', 'Number (1,234.56)'],
        ['currency', 'Currency ($)'],
        ['eur', 'Currency (€)'],
        ['gbp', 'Currency (£)'],
        ['inr', 'Currency (₹)'],
        ['percent', 'Percentage (%)'],
        ['accounting', 'Accounting'],
        ['date', 'Date (YYYY-MM-DD)'],
        ['scientific', 'Scientific'],
        ['text', 'Text']
      ].forEach(([v, l]) => {
        const o = document.createElement('option');
        o.value = v; o.textContent = l;
        fmtSelect.appendChild(o);
      });
      fmtSelect.addEventListener('change', () => setNumberFormat(fmtSelect.value));
      pHome.appendChild(fmtSelect);

      makeBtn(pHome, 'Currency ($)', I.currency || '$', () => setNumberFormat('currency'));
      makeBtn(pHome, 'Percent (%)', I.percent || '%', () => setNumberFormat('percent'));
      makeBtn(pHome, 'Comma separator (,)', I.comma || ',', () => setNumberFormat('number'));
      makeBtn(pHome, 'Increase Decimals (.00)', I.decimalInc || '.00', () => stepDecimals(1));
      makeBtn(pHome, 'Decrease Decimals (.0)', I.decimalDec || '.0', () => stepDecimals(-1));

      makeSep(pHome);

      // AutoSum, Sort & Find
      makeBtn(pHome, 'AutoSum (SUM)', I.autosum || 'Σ', () => {
        setCell(sel.r, sel.c, `=SUM(${colName(sel.c)}1:${colName(sel.c)}${sel.r})`);
      });
      makeBtn(pHome, 'Sort Ascending', I.sortAZ || 'A-Z', () => sortSelectedRange(true));
      makeBtn(pHome, 'Sort Descending', I.sortZA || 'Z-A', () => sortSelectedRange(false));
      makeBtn(pHome, 'Find & Replace (Ctrl+F)', I.search, () => openFindModal());

      /* ===== 2. INSERT TAB ===== */
      const pInsert = panels.insert;

      makeBtn(pInsert, 'Column Chart', I.chartCol || '📊', () => insertChart('column'));
      makeBtn(pInsert, 'Bar Chart', I.chartBar || '📊', () => insertChart('bar'));
      makeBtn(pInsert, 'Line Chart', I.chartLine || '📈', () => insertChart('line'));
      makeBtn(pInsert, 'Pie Chart', I.chartPie || '🥧', () => insertChart('pie'));

      makeSep(pInsert);
      makeBtn(pInsert, 'Insert Link', I.link, async () => {
        const url = await ctx.inputModal('Insert Link', 'https://…', 'https://');
        if (url) setCell(sel.r, sel.c, url);
      });
      makeBtn(pInsert, 'Insert Function (fx)', I.fx || 'fx', () => openFunctionWizard());

      /* ===== 3. FORMULAS TAB ===== */
      const pFormulas = panels.formulas;

      makeBtn(pFormulas, 'Insert Function (fx)', I.fx || 'fx', () => openFunctionWizard());
      makeBtn(pFormulas, 'AutoSum', I.autosum || 'Σ', () => {
        setCell(sel.r, sel.c, `=SUM(${colName(sel.c)}1:${colName(sel.c)}${sel.r})`);
      });

      makeSep(pFormulas);
      ['Math', 'Logical', 'Lookup', 'Text', 'Date', 'Financial'].forEach((cat) => {
        const btn = document.createElement('button');
        btn.className = 'btn ghost';
        btn.style.height = '28px';
        btn.style.padding = '0 8px';
        btn.style.fontSize = '11.5px';
        btn.textContent = cat;
        btn.addEventListener('click', () => openFunctionWizard());
        pFormulas.appendChild(btn);
      });

      makeSep(pFormulas);
      makeBtn(pFormulas, 'Calculate Now', I.redo || '🔄', () => recalculateGrid());

      /* ===== 4. DATA TAB ===== */
      const pData = panels.data;

      makeBtn(pData, 'Sort Ascending', I.sortAZ || 'A-Z', () => sortSelectedRange(true));
      makeBtn(pData, 'Sort Descending', I.sortZA || 'Z-A', () => sortSelectedRange(false));
      makeBtn(pData, 'Filter', I.filter || '🌪️', () => {
        autoFilterActive = !autoFilterActive;
        renderGrid();
        ctx.toast(`AutoFilter ${autoFilterActive ? 'enabled' : 'disabled'}`);
        recordSheet();
      });
      makeBtn(pData, 'Find & Replace', I.search, () => openFindModal());

      /* ===== 5. VIEW TAB ===== */
      const pView = panels.view;

      makeBtn(pView, 'Zoom In', I.zoomIn, () => zoomBy(1.1));
      makeBtn(pView, 'Zoom Out', I.zoomOut, () => zoomBy(1 / 1.1));
      makeBtn(pView, 'Zoom 100%', I.fit, () => { zoom = 1; applyZoom(); });
      makeSep(pView);
      makeBtn(pView, 'Auto-fit Column', '<span class="tb-glyph">↔</span>', () => {
        let maxLen = 4;
        (sheet().rows || []).forEach((row) => {
          if (row && row[sel.c] != null) {
            const l = String(row[sel.c]).length;
            if (l > maxLen) maxLen = l;
          }
        });
        setColWidth(sel.c, Math.max(48, Math.min(450, maxLen * 8.5 + 24)));
      });
      makeBtn(pView, 'Widen Column', '<span class="tb-glyph">Col+</span>', () => setColWidth(sel.c, getColWidth(sel.c) + 20));
      makeBtn(pView, 'Narrow Column', '<span class="tb-glyph">Col-</span>', () => setColWidth(sel.c, getColWidth(sel.c) - 20));
      makeBtn(pView, 'Taller Row', '<span class="tb-glyph">Row+</span>', () => setRowHeight(sel.r, getRowHeight(sel.r) + 8));
      makeBtn(pView, 'Shorter Row', '<span class="tb-glyph">Row-</span>', () => setRowHeight(sel.r, getRowHeight(sel.r) - 8));
    }

    function sortSelectedRange(ascending = true) {
      const minR = selEnd ? Math.min(sel.r, selEnd.r) : 0;
      const maxR = selEnd ? Math.max(sel.r, selEnd.r) : sheet().rows.length - 1;
      const c = sel.c;
      const sub = sheet().rows.slice(minR, maxR + 1);
      sub.sort((a, b) => {
        const va = (a && a[c] != null ? a[c] : '');
        const vb = (b && b[c] != null ? b[c] : '');
        const na = toNum(va), nb = toNum(vb);
        if (na != null && nb != null) return ascending ? na - nb : nb - na;
        return ascending ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va));
      });
      for (let r = minR; r <= maxR; r++) {
        sheet().rows[r] = sub[r - minR];
      }
      ctx.markDirty();
      recalculateGrid();
      recordSheet();
      ctx.toast(`Sorted rows ${minR + 1}–${maxR + 1}`);
    }

    /* ---------- Undo & Redo ---------- */
    function undo() {
      if (editingTd) commitEdit(true);
      history.undo(restoreSheet);
    }
    function redo() {
      if (editingTd) commitEdit(true);
      history.redo(restoreSheet);
    }

    /* ---------- Event Wiring ---------- */
    function wireEvents() {
      gridScroll.tabIndex = 0;
      gridScroll.style.outline = 'none';

      let dragging = false;
      let dragStart = null;

      gridScroll.addEventListener('mousedown', (e) => {
        const td = e.target.closest('td');
        if (!td) return;
        const r = td.parentElement.rowIndex - 1, c = td.cellIndex - 1;
        if (editingTd === td) return;
        if (editingTd) commitEdit(true);

        dragging = true;
        dragStart = { r, c };
        select(r, c);

        if (e.detail === 2) { e.preventDefault(); beginEdit(false); }
      });

      gridScroll.addEventListener('mouseover', (e) => {
        if (!dragging || !dragStart) return;
        const td = e.target.closest('td');
        if (!td) return;
        const r = td.parentElement.rowIndex - 1, c = td.cellIndex - 1;
        if (r !== dragStart.r || c !== dragStart.c) {
          selectRange(dragStart.r, dragStart.c, r, c);
        }
      });

      document.addEventListener('mouseup', () => {
        dragging = false;
        dragStart = null;
      });

      gridScroll.addEventListener('keydown', (e) => {
        if (editingTd) {
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitEdit(); select(sel.r + 1, sel.c); }
          else if (e.key === 'Enter' && e.shiftKey) { e.preventDefault(); commitEdit(); select(Math.max(0, sel.r - 1), sel.c); }
          else if (e.key === 'Tab') { e.preventDefault(); commitEdit(); select(sel.r, e.shiftKey ? Math.max(0, sel.c - 1) : sel.c + 1); }
          else if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
          return;
        }
        if (e.ctrlKey && e.key.toLowerCase() === 'f') {
          e.preventDefault();
          openFindModal();
          return;
        }
        const nav = {
          ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1]
        }[e.key];
        if (nav) {
          e.preventDefault();
          if (e.shiftKey) {
            const endR = (selEnd ? selEnd.r : sel.r) + nav[0];
            const endC = (selEnd ? selEnd.c : sel.c) + nav[1];
            selectRange(sel.r, sel.c, Math.max(0, endR), Math.max(0, endC));
          } else {
            select(sel.r + nav[0], sel.c + nav[1]);
          }
          return;
        }
        if (e.key === 'Enter' || e.key === 'F2') { e.preventDefault(); beginEdit(false); return; }
        if (e.key === 'Tab') { e.preventDefault(); select(sel.r, e.shiftKey ? Math.max(0, sel.c - 1) : sel.c + 1); return; }
        if (e.key === 'Delete' || e.key === 'Backspace') {
          e.preventDefault();
          if (selEnd) {
            const minR = Math.min(sel.r, selEnd.r), maxR = Math.max(sel.r, selEnd.r);
            const minC = Math.min(sel.c, selEnd.c), maxC = Math.max(sel.c, selEnd.c);
            let changed = false;
            for (let r = minR; r <= maxR; r++) {
              for (let c = minC; c <= maxC; c++) {
                if (getCellRaw(r, c) !== '') changed = true;
                setCell(r, c, '', true);
              }
            }
            if (changed) recordSheet();
          } else {
            setCell(sel.r, sel.c, '');
          }
          formulaInput.value = '';
          return;
        }
        if (e.ctrlKey && e.key.toLowerCase() === 'b') {
          e.preventDefault();
          toggleFaceFlag('bold');
          return;
        }
        if (e.ctrlKey && e.key.toLowerCase() === 'i') {
          e.preventDefault();
          toggleFaceFlag('italic');
          return;
        }
        if (e.ctrlKey && e.key.toLowerCase() === 'c') {
          e.preventDefault();
          try { navigator.clipboard.writeText(getCellRaw(sel.r, sel.c)); } catch {}
          return;
        }
        if (e.ctrlKey && e.key.toLowerCase() === 'x') {
          e.preventDefault();
          try { navigator.clipboard.writeText(getCellRaw(sel.r, sel.c)); } catch {}
          setCell(sel.r, sel.c, ''); formulaInput.value = '';
          return;
        }
        if (e.ctrlKey && e.key.toLowerCase() === 'v') {
          e.preventDefault();
          navigator.clipboard.readText().then((t) => {
            if (t !== undefined && t !== null) { setCell(sel.r, sel.c, t.replace(/\r?\n$/, '')); formulaInput.value = getCellRaw(sel.r, sel.c); }
          }).catch(() => {});
          return;
        }
        // Character starts editing
        if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
          beginEdit(true);
        }
      });

      gridScroll.addEventListener('scroll', () => {
        const nearBottom = gridScroll.scrollHeight - gridScroll.scrollTop - gridScroll.clientHeight < 400;
        const nearRight = gridScroll.scrollWidth - gridScroll.scrollLeft - gridScroll.clientWidth < 400;
        const d = dims();
        if (nearBottom && viewR < d.rows + 30) extendRows(50);
        if (nearRight && viewC < d.cols + 15) extendCols(10);
      });

      formulaInput.addEventListener('input', () => {
        if (editingTd) return;
        setCell(sel.r, sel.c, formulaInput.value, true);
        recordSheet({ coalesce: true });
      });
      formulaInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); select(sel.r + 1, sel.c); focusGrid(); }
        if (e.key === 'Escape') { formulaInput.value = getCellRaw(sel.r, sel.c); focusGrid(); }
      });
      fxBtn.addEventListener('click', () => openFunctionWizard());
    }

    return {
      kind: 'sheet',
      mount(host, doc) {
        model = {
          sheets: (doc.sheets && doc.sheets.length ? doc.sheets : [{ name: 'Sheet1', rows: [], styles: {}, colWidths: {}, rowHeights: {}, charts: [] }])
            .map((s) => ({
              name: s.name || 'Sheet1',
              rows: (s.rows || []).map((r) => (r || []).map((v) => v == null ? '' : String(v))),
              styles: s.styles || {},
              colWidths: s.colWidths || {},
              rowHeights: s.rowHeights || {},
              charts: Array.isArray(s.charts) ? s.charts : []
            })),
          active: Math.min(doc.active || 0, (doc.sheets || []).length - 1 < 0 ? 0 : (doc.sheets || []).length - 1)
        };

        buildRibbon();
        loadSystemFonts();
        host.innerHTML =
          `<div class="sheet-wrap">
             <div class="sheet-bar">
               <button type="button" class="sheet-home-btn" title="Back to home">Margo</button>
               <div class="sheet-namebox">A1</div>
               <button type="button" class="sheet-fx-btn" title="Insert Function">fx</button>
               <input class="sheet-formula" spellcheck="false" placeholder="Cell value or formula (=SUM, =IF, =VLOOKUP…)" />
             </div>
             <div class="sheet-grid-scroll"></div>
             <div class="sheet-tabs"></div>
           </div>`;

        nameBox = host.querySelector('.sheet-namebox');
        fxBtn = host.querySelector('.sheet-fx-btn');
        formulaInput = host.querySelector('.sheet-formula');
        gridScroll = host.querySelector('.sheet-grid-scroll');
        tabsEl = host.querySelector('.sheet-tabs');
        const homeBtn = host.querySelector('.sheet-home-btn');
        if (homeBtn) {
          homeBtn.addEventListener('click', () => {
            const el = document.getElementById('btn-home');
            if (el) el.click();
          });
        }

        wireEvents();
        gridScroll.addEventListener('wheel', onCtrlWheel, { passive: false });
        renderTabs();
        renderGrid();
        history.seed(captureSheet());
        window.scrollTo(0, 0);
        setTimeout(() => focusGrid(), 60);
      },
      getData() {
        if (editingTd) commitEdit(true);
        const sheets = model.sheets.map((sh) => {
          const rows = sh.rows.map((row) => {
            const r = [...(row || [])];
            while (r.length && (r[r.length - 1] === '' || r[r.length - 1] == null)) r.pop();
            return r;
          });
          while (rows.length && rows[rows.length - 1].length === 0) rows.pop();
          return {
            name: sh.name,
            rows,
            styles: sh.styles || {},
            colWidths: sh.colWidths || {},
            rowHeights: sh.rowHeights || {},
            charts: sh.charts || []
          };
        });
        return { sheets, active: model.active };
      },
      focus() { focusGrid(); },
      destroy() {
        if (gridScroll) gridScroll.removeEventListener('wheel', onCtrlWheel);
      },
      commands: {
        undo,
        redo,
        canUndo: () => history.canUndo(),
        canRedo: () => history.canRedo(),
        copy: () => { try { navigator.clipboard.writeText(getCellRaw(sel.r, sel.c)); } catch {} },
        cut: () => {
          try { navigator.clipboard.writeText(getCellRaw(sel.r, sel.c)); } catch {}
          setCell(sel.r, sel.c, '');
          formulaInput.value = '';
        },
        paste: (t) => {
          if (t == null) return;
          setCell(sel.r, sel.c, String(t).replace(/\r?\n$/, ''));
          formulaInput.value = getCellRaw(sel.r, sel.c);
        },
        find: openFindModal,
        zoomIn: () => zoomBy(1.1),
        zoomOut: () => zoomBy(1 / 1.1),
        zoomReset: () => { zoom = 1; applyZoom(); },
        insertChart,
        insertFx: openFunctionWizard,
        sortAsc: () => sortSelectedRange(true),
        sortDesc: () => sortSelectedRange(false),
        toggleFilter: () => { autoFilterActive = !autoFilterActive; renderGrid(); recordSheet(); },
        increaseFontSize: () => stepFontSize(1),
        decreaseFontSize: () => stepFontSize(-1),
        setColWidth: (w) => setColWidth(sel.c, w),
        setRowHeight: (h) => setRowHeight(sel.r, h)
      },
      /* test hooks */
      _test: {
        setCell: (r, c, v) => {
          setCell(r, c, v);
          if (sel.r === r && sel.c === c) formulaInput.value = getCellRaw(r, c);
        },
        getCell: (r, c) => getCellRaw(r, c),
        getFormatted: (r, c) => getCellFormatted(r, c),
        setColWidth: (c, w) => setColWidth(c, w),
        getColWidth: (c) => getColWidth(c),
        setRowHeight: (r, h) => setRowHeight(r, h),
        getRowHeight: (r) => getRowHeight(r),
        setFontSize: (size) => applyStyleToSelection({ size }),
        addSheet: () => {
          model.sheets.push({ name: `Sheet${model.sheets.length + 1}`, rows: [], styles: {}, colWidths: {}, rowHeights: {}, charts: [] });
          renderTabs();
        }
      }
    };
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  window.MargoEditors = window.MargoEditors || {};
  window.MargoEditors.sheet = create;
})();
