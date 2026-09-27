/* Margo — markdown editor (write / split / read with live preview)

   Pieces, top to bottom:
   - icons         local 16px stroke icons for the toolbar
   - highlighter   a small regex tokenizer for code blocks in the preview
   - pipeline      one Marked instance (GFM + footnotes + task lists), a
                   sanitiser pass, and the source-line map the scroll sync,
                   outline and task checkboxes are built on
   - editor        the tab itself: toolbar, textarea behaviours, preview,
                   find & replace, outline, stats, zoom */
(function () {
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /* ------------------------------------------------------------------ */
  /* icons                                                               */
  /* ------------------------------------------------------------------ */
  const SVG = (d) =>
    `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const ICONS = {
    undo: SVG('<path d="M3.5 6.5h6.3a3.2 3.2 0 0 1 0 6.4H7"/><path d="M6 4 3.5 6.5 6 9"/>'),
    redo: SVG('<path d="M12.5 6.5H6.2a3.2 3.2 0 0 0 0 6.4H9"/><path d="m10 4 2.5 2.5L10 9"/>'),
    heading: SVG('<path d="M3.5 2.8v10.4M11.5 2.8v10.4M3.5 8h8"/>'),
    paragraph: SVG('<path d="M12.5 2.8H7.2a2.9 2.9 0 0 0 0 5.8h1.6M8.8 2.8v10.4M11.5 2.8v10.4"/>'),
    chevronDown: SVG('<path d="m4.5 6.5 3.5 3.5 3.5-3.5"/>'),
    chevronUp: SVG('<path d="m4.5 9.5 3.5-3.5 3.5 3.5"/>'),
    bold: SVG('<path d="M4.5 2.8h4.1a2.55 2.55 0 0 1 0 5.1H4.5zM4.5 7.9h4.9a2.65 2.65 0 0 1 0 5.3H4.5z"/>'),
    italic: SVG('<path d="M9.8 2.8 6.2 13.2M7 2.8h5M4 13.2h5"/>'),
    strike: SVG('<path d="M2.5 8h11"/><path d="M10.9 4.3C10.4 3.3 9.3 2.7 8 2.7c-1.8 0-3.1.9-3.1 2.3 0 .8.4 1.4 1.2 1.8M5 11.2c.4 1.3 1.6 2.1 3.1 2.1 1.9 0 3.2-1 3.2-2.4 0-.5-.1-.9-.4-1.3"/>'),
    code: SVG('<path d="m5.5 4.5-3.5 3.5 3.5 3.5M10.5 4.5l3.5 3.5-3.5 3.5"/>'),
    link: SVG('<path d="M6.6 9.4 9.4 6.6"/><path d="M7.3 4.6 8.5 3.4a2.7 2.7 0 0 1 3.9 3.9l-1.2 1.2M8.7 11.4l-1.2 1.2a2.7 2.7 0 0 1-3.9-3.9l1.2-1.2"/>'),
    image: SVG('<rect x="2" y="2.8" width="12" height="10.4" rx="2"/><circle cx="5.8" cy="6.3" r="1.1"/><path d="m2.4 11.6 3.4-3.1 2.4 2.2 2.3-2.4 3.1 3"/>'),
    ul: SVG('<circle cx="3" cy="4" r=".9" fill="currentColor" stroke="none"/><circle cx="3" cy="8" r=".9" fill="currentColor" stroke="none"/><circle cx="3" cy="12" r=".9" fill="currentColor" stroke="none"/><path d="M6 4h8M6 8h8M6 12h8"/>'),
    ol: SVG('<path d="M2.2 2.9 3.4 2.3v3.6M2.2 9.3c.2-.6.7-.9 1.2-.9.6 0 1.1.4 1.1 1 0 .8-2.3 1.6-2.3 2.6h2.3"/><path d="M7 4h7M7 8h7M7 12h7"/>'),
    task: SVG('<rect x="2" y="2.5" width="4.5" height="4.5" rx="1.2"/><path d="m3.1 4.8 1 1 1.6-2"/><rect x="2" y="9" width="4.5" height="4.5" rx="1.2"/><path d="M9 4.7h5M9 11.2h5"/>'),
    quote: SVG('<path d="M3 3.5v9"/><path d="M6.5 4.5h7M6.5 8h7M6.5 11.5h4.5"/>'),
    codeblock: SVG('<rect x="2" y="2.5" width="12" height="11" rx="2"/><path d="m6.2 6.3-1.8 1.7 1.8 1.7M9.8 6.3l1.8 1.7-1.8 1.7"/>'),
    table: SVG('<rect x="2" y="2.5" width="12" height="11" rx="2"/><path d="M2 6.5h12M2 10h12M6.5 6.5v7"/>'),
    hr: SVG('<path d="M2 8h12"/><path d="M4.5 4.5h7M4.5 11.5h7" opacity=".35"/>'),
    footnote: SVG('<path d="M2.5 12.5h7M2.5 9.5h9"/><path d="M11.5 2.5v4M10 3.5l1.5-1 1.5 1"/>'),
    outline: SVG('<path d="M2.5 3.5h11M4.5 6.5h9M6.5 9.5h7M4.5 12.5h9"/>'),
    stats: SVG('<path d="M3 13.5V9M6.5 13.5V5M10 13.5V7.5M13.5 13.5V3"/>'),
    search: SVG('<circle cx="7" cy="7" r="4.3"/><path d="m13.5 13.5-3.4-3.4"/>'),
    close: SVG('<path d="m4 4 8 8M12 4l-8 8"/>'),
    copy: SVG('<rect x="5.5" y="5.5" width="8" height="8" rx="1.8"/><path d="M10.5 3.6v-.1A1.5 1.5 0 0 0 9 2H4a1.5 1.5 0 0 0-1.5 1.5V9A1.5 1.5 0 0 0 4 10.5h.1"/>'),
    check: SVG('<path d="m3.5 8.5 3 3 6-7"/>'),
    caseSensitive: SVG('<path d="M1.8 12 4.6 4l2.8 8M2.8 9.4h3.6"/><path d="M13.8 12V9.3a1.9 1.9 0 0 0-3.4-1.2M13.8 10.3c-2.2-.3-3.8.2-3.8 1.1 0 .6.5 1 1.2 1 1.3 0 2.6-.8 2.6-2.1"/>'),
    wholeWord: SVG('<path d="M2 11v2h12v-2"/><path d="M3.6 9.5 5.2 4l1.6 5.5M4.1 7.9h2.2M9.5 3.5v6h1.5a1.5 1.5 0 0 0 0-3H9.5"/>'),
    regex: SVG('<path d="M11 2.5v6M8.4 4l5.2 3M8.4 7l5.2-3"/><rect x="2.5" y="10" width="3.5" height="3.5" rx=".6"/>'),
    write: SVG('<path d="m10.2 2.8 3 3-7.4 7.4-3.6.6.6-3.6z"/><path d="m9 4 3 3"/>'),
    split: SVG('<rect x="2" y="2.5" width="12" height="11" rx="2"/><path d="M8 2.5v11"/>'),
    read: SVG('<path d="M1.8 8S4 3.8 8 3.8 14.2 8 14.2 8 12 12.2 8 12.2 1.8 8 1.8 8z"/><circle cx="8" cy="8" r="2"/>'),
    replace: SVG('<path d="M3 7V4.5A1.5 1.5 0 0 1 4.5 3H11M9 1.5l2 1.5-2 1.5M13 9v2.5a1.5 1.5 0 0 1-1.5 1.5H5M7 14.5 5 13l2-1.5"/>')
  };

  /* ------------------------------------------------------------------ */
  /* highlighter                                                         */
  /* ------------------------------------------------------------------ */
  /* One alternation per language; each rule is [class, regex] and the
     first rule that matches at a position wins, so order matters (comments
     and strings before keywords). Rules use only non-capturing groups so
     the group index tells which rule matched. */
  const Highlighter = (function () {
    const langs = Object.create(null);
    const kw = (list) => new RegExp('\\b(?:' + list.trim().split(/\s+/).join('|') + ')\\b');
    const DQ = /"(?:[^"\\\n]|\\.)*"/;
    const SQ = /'(?:[^'\\\n]|\\.)*'/;
    const BT = /`(?:[^`\\]|\\[\s\S])*`/;
    const C_COMMENT = /\/\/[^\n]*|\/\*[\s\S]*?\*\//;
    const HASH_COMMENT = /(?:^|[ \t])#[^\n]*/;
    const NUM = /\b(?:0[xX][\da-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|\d[\d_]*(?:\.[\d_]+)?(?:[eE][+-]?\d+)?)(?:[a-zA-Z]{0,3})\b/;
    const FN = /\b[A-Za-z_$][\w$]*(?=\s*\()/;
    const TYPE = /\b[A-Z][A-Za-z0-9_]*[a-z][A-Za-z0-9_]*\b/;

    function def(names, rules, flags) {
      const re = new RegExp(rules.map(([, r]) => '(' + r.source + ')').join('|'), 'gm' + (flags || ''));
      const classes = rules.map(([c]) => c);
      names.split(/\s+/).forEach((n) => { langs[n] = { re, classes }; });
    }

    const JS_KW = 'break case catch class const continue debugger default delete do else export extends finally for from function get if import in instanceof let new of return set static super switch this throw try typeof var void while with yield async await as interface type enum implements private protected public readonly declare namespace abstract keyof satisfies';
    def('js javascript jsx mjs cjs ts typescript tsx node', [
      ['comment', C_COMMENT], ['string', BT], ['string', DQ], ['string', SQ],
      ['number', NUM], ['keyword', kw(JS_KW)], ['literal', kw('true false null undefined NaN Infinity')],
      ['type', TYPE], ['fn', FN]
    ]);
    def('json jsonc json5', [
      ['comment', C_COMMENT], ['prop', /"(?:[^"\\\n]|\\.)*"(?=\s*:)/], ['string', DQ],
      ['number', /-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/], ['literal', kw('true false null')]
    ]);
    def('py python python3 py3', [
      ['comment', /#[^\n]*/],
      ['string', /\b[rRbBuUfF]{0,2}(?:"""[\s\S]*?"""|'''[\s\S]*?''')/],
      ['string', /\b[rRbBuUfF]{1,2}(?:"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')/], ['string', DQ], ['string', SQ],
      ['meta', /@[\w.]+/], ['number', NUM],
      ['keyword', kw('and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield match case')],
      ['literal', kw('True False None self cls')], ['type', TYPE], ['fn', FN]
    ]);
    def('sh bash shell zsh console shellsession', [
      ['comment', HASH_COMMENT], ['string', DQ], ['string', SQ],
      ['attr', /\$(?:\{[^}\n]*\}|\([^)\n]*\)|[\w@#?*!$-]+)/],
      ['keyword', kw('if then else elif fi for while until do done case esac in function select return local export readonly declare unset shift exit source alias sudo')],
      ['meta', /(?<=\s)--?[A-Za-z][\w-]*/], ['number', /\b\d+\b/]
    ]);
    def('ps1 powershell pwsh', [
      ['comment', /#[^\n]*|<#[\s\S]*?#>/], ['string', DQ], ['string', SQ], ['attr', /\$[\w:]+/],
      ['keyword', kw('function param if else elseif foreach for while do switch return try catch finally throw begin process end in')],
      ['fn', /\b[A-Z][a-z]+-[A-Z]\w+/], ['meta', /(?<=\s)-[A-Za-z]\w*/], ['number', NUM]
    ], 'i');
    def('css scss sass less', [
      ['comment', /\/\*[\s\S]*?\*\/|\/\/[^\n]*/], ['string', DQ], ['string', SQ],
      ['keyword', /@[\w-]+|!important\b/], ['number', /#[\da-fA-F]{3,8}\b/],
      ['prop', /[\w-]+(?=\s*:[^:{};\n]*[;}\n])/], ['fn', /[\w-]+(?=\()/],
      ['number', /-?(?:\d*\.)?\d+(?:px|em|rem|vh|vw|vmin|vmax|ms|s|deg|fr|ch|pt|ex|%)?/],
      ['type', /\.[A-Za-z_-][\w-]*/], ['meta', /::?[\w-]+/]
    ]);
    def('html xml svg xhtml vue svelte htm plist', [
      ['comment', /<!--[\s\S]*?-->/], ['meta', /<![A-Za-z][^>]*>|<\?[\s\S]*?\?>/],
      ['tag', /<\/?[A-Za-z][\w:.-]*/], ['tag', /\/?>/],
      ['attr', /\b[\w:.-]+(?=\s*=)/], ['string', DQ], ['string', SQ], ['literal', /&[#\w]+;/]
    ]);
    const C_KW = 'auto bool break case catch char class const constexpr continue default delete do double else enum explicit export extern final float for friend goto if inline int long mutable namespace new noexcept nullptr operator override private protected public register return short signed sizeof static struct switch template this throw try typedef typename union unsigned using virtual void volatile while ' +
      'abstract boolean byte extends implements import instanceof interface native package super synchronized throws transient var val fun when is in out object internal lateinit data sealed open companion string decimal readonly ref params async await yield get set lock foreach ' +
      'chan defer fallthrough func go map range select type ' +
      'as crate dyn fn impl let loop match mod move mut pub self Self trait unsafe use where ' +
      'guard protocol extension init deinit inout some any';
    def('c cpp c++ cc cxx h hpp hh objc objective-c cs csharp c# java kotlin kt kts swift go golang rust rs scala dart php groovy', [
      ['comment', C_COMMENT], ['meta', /^[ \t]*#[ \t]*[a-z]+\b[^\n]*/], ['string', /`[^`]*`/], ['string', DQ],
      ['string', /'(?:[^'\\\n]|\\.){1,2}'/], ['meta', /@[A-Za-z_][\w.]*/], ['attr', /\$[A-Za-z_]\w*/],
      ['number', NUM], ['keyword', kw(C_KW)], ['literal', kw('true false null nil None NULL undefined')],
      ['type', TYPE], ['fn', FN]
    ]);
    def('sql mysql postgres postgresql sqlite plsql tsql', [
      ['comment', /--[^\n]*|\/\*[\s\S]*?\*\//], ['string', SQ], ['string', DQ], ['number', NUM],
      ['keyword', kw('select from where and or not insert into values update set delete create table alter drop index view join inner left right outer full cross on as group by order having limit offset union all distinct case when then else end is in exists between like ilike primary key foreign references default unique check begin commit rollback transaction returning with asc desc if replace integer int bigint smallint text varchar char boolean bool date time timestamp real float double numeric decimal serial constraint cascade grant revoke procedure function trigger declare')],
      ['literal', kw('null true false')], ['fn', FN]
    ], 'i');
    def('yaml yml', [
      ['comment', HASH_COMMENT], ['meta', /^(?:---|\.\.\.)[ \t]*$/],
      ['prop', /^[ \t]*(?:- )?[\w.$/-]+(?=[ \t]*:(?:[ \t]|$))/], ['string', DQ], ['string', SQ],
      ['attr', /[&*][\w-]+/], ['literal', kw('true false null yes no on off')], ['number', NUM]
    ]);
    def('toml ini cfg conf properties editorconfig gitconfig dotenv env', [
      ['comment', /^[ \t]*[#;][^\n]*/], ['tag', /^[ \t]*\[[^\]\n]*\]/], ['prop', /^[ \t]*[\w.-]+(?=[ \t]*=)/],
      ['string', DQ], ['string', SQ], ['literal', kw('true false')], ['number', NUM]
    ]);
    def('diff patch', [
      ['meta', /^(?:diff|index|---|\+\+\+)[^\n]*/], ['meta', /^@@[^\n]*/],
      ['inserted', /^\+[^\n]*/], ['deleted', /^-[^\n]*/]
    ]);
    def('md markdown mdx', [
      ['keyword', /^#{1,6}[ \t][^\n]*/], ['string', /`[^`\n]+`/], ['type', /\*\*[^*\n]+\*\*|__[^_\n]+__/],
      ['attr', /!?\[[^\]\n]*\]\([^)\n]*\)/], ['meta', /^[ \t]*(?:[-*+]|\d+\.)(?=[ \t])/], ['comment', /^[ \t]*>[^\n]*/]
    ]);
    def('dockerfile docker', [
      ['comment', /#[^\n]*/], ['keyword', /^[ \t]*(?:FROM|RUN|CMD|LABEL|EXPOSE|ENV|ADD|COPY|ENTRYPOINT|VOLUME|USER|WORKDIR|ARG|ONBUILD|STOPSIGNAL|HEALTHCHECK|SHELL|AS)\b/i],
      ['string', DQ], ['string', SQ], ['attr', /\$(?:\{[^}\n]*\}|\w+)/]
    ]);

    function highlight(code, name) {
      const L = langs[String(name || '').toLowerCase()];
      const src = String(code);
      if (!L || src.length > 400000) return escapeHtml(src);
      const re = L.re;
      re.lastIndex = 0;
      let out = '';
      let last = 0;
      let m;
      while ((m = re.exec(src))) {
        if (!m[0]) { re.lastIndex++; continue; }
        let g = 1;
        while (m[g] === undefined) g++;
        out += escapeHtml(src.slice(last, m.index)) +
          `<span class="tok-${L.classes[g - 1]}">` + escapeHtml(m[0]) + '</span>';
        last = re.lastIndex;
      }
      return out + escapeHtml(src.slice(last));
    }
    return { highlight, has: (n) => !!langs[String(n || '').toLowerCase()] };
  })();

  /* ------------------------------------------------------------------ */
  /* markdown pipeline                                                   */
  /* ------------------------------------------------------------------ */
  const ID_PREFIX = 'mdp-';

  function slugify(text) {
    return String(text || '')
      .replace(/<[^>]*>/g, '')
      .replace(/&[#\w]+;/g, '')
      .toLowerCase()
      .trim()
      .replace(/[^\p{L}\p{N}\s_-]/gu, '')
      .replace(/\s+/g, '-') || 'section';
  }

  function inlinePlain(md) {
    return String(md || '')
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]*)\]\[[^\]]*\]/g, '$1')
      .replace(/<[^>]+>/g, '')
      .replace(/(\*\*|__|~~|\*|_|`)(.+?)\1/g, '$2')
      .replace(/\\([\\`*_{}[\]()#+\-.!|~])/g, '$1')
      .trim();
  }

  /* Leading tabs are expanded by marked's lexer, so token.raw is searched
     for in a copy normalised the same way. Line numbers survive that
     normalisation, which is what ties tokens back to the textarea. */
  function lexerNormalise(src) {
    return String(src).replace(/\r\n|\r/g, '\n').replace(/^( *)(\t+)/gm, (_, lead, tabs) => lead + '    '.repeat(tabs.length));
  }
  function lineStartsOf(text) {
    const starts = [0];
    for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) starts.push(i + 1);
    return starts;
  }
  function lineAtOffset(starts, offset) {
    let lo = 0, hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= offset) lo = mid; else hi = mid - 1;
    }
    return lo;
  }

  const Pipeline = (function () {
    const S = { defIds: new Set(), defs: new Map(), order: [], refCounts: new Map(), task: 0, slugs: new Map(), norm: '', defAt: [] };
    function reset() {
      S.defIds = new Set(); S.defs = new Map(); S.order = []; S.refCounts = new Map(); S.task = 0; S.slugs = new Map();
      S.norm = ''; S.defAt = [];
    }
    /* marked asks every paragraph where the next footnote definition
       starts, handing over the rest of the document; a regex over that is
       quadratic on a long note. Definitions are found once per render and
       the question becomes a binary search whenever the text handed over is
       a tail of the whole document. */
    const DEF_LINE = /^\[\^[^\]\s]+\]:/m;
    function nextDefStart(src) {
      if (!S.defAt.length) return undefined;
      const n = S.norm.length;
      const abs = n - src.length;
      if (abs >= 0 && S.norm.charCodeAt(abs) === src.charCodeAt(0) && S.norm.substr(abs, 48) === src.slice(0, 48)) {
        let lo = 0, hi = S.defAt.length;
        while (lo < hi) { const mid = (lo + hi) >> 1; if (S.defAt[mid] < abs) lo = mid + 1; else hi = mid; }
        return lo < S.defAt.length ? S.defAt[lo] - abs : undefined;
      }
      const m = DEF_LINE.exec(src);
      return m ? m.index : undefined;
    }
    function uniqueSlug(text) {
      const base = slugify(text);
      const n = S.slugs.get(base) || 0;
      S.slugs.set(base, n + 1);
      return n ? `${base}-${n}` : base;
    }
    const fnSlug = (id) => slugify(id) || 'note';

    let md = null;
    function instance() {
      if (md) return md;
      if (!window.marked || !window.marked.Marked) return null;
      md = new window.marked.Marked({ gfm: true, breaks: false });
      md.use({
        extensions: [
          {
            name: 'footnoteDef',
            level: 'block',
            start(src) { return nextDefStart(src); },
            tokenizer(src) {
              const m = /^\[\^([^\]\s]+)\]:[ \t]*([^\n]*(?:\n[ \t]{2,}[^\n]*)*)(?:\n|$)/.exec(src);
              if (!m) return undefined;
              const text = m[2].replace(/\n[ \t]{2,}/g, '\n');
              const token = { type: 'footnoteDef', raw: m[0], id: m[1], text, tokens: [] };
              this.lexer.inline(text, token.tokens);
              return token;
            },
            renderer(token) {
              if (!S.defs.has(token.id)) S.defs.set(token.id, this.parser.parseInline(token.tokens));
              return '';
            }
          },
          {
            name: 'footnoteRef',
            level: 'inline',
            start(src) { const i = src.indexOf('[^'); return i < 0 ? undefined : i; },
            tokenizer(src) {
              const m = /^\[\^([^\]\s]+)\](?!:)/.exec(src);
              if (!m) return undefined;
              return { type: 'footnoteRef', raw: m[0], id: m[1] };
            },
            renderer(token) {
              if (!S.defIds.has(token.id)) return escapeHtml(token.raw);
              let n = S.order.indexOf(token.id);
              if (n < 0) { S.order.push(token.id); n = S.order.length - 1; }
              const k = (S.refCounts.get(token.id) || 0) + 1;
              S.refCounts.set(token.id, k);
              const slug = fnSlug(token.id);
              const refId = `fnref-${slug}${k > 1 ? '-' + k : ''}`;
              return `<sup class="md-fnref"><a href="#fn-${slug}" id="${refId}">${n + 1}</a></sup>`;
            }
          }
        ],
        renderer: {
          code(code, infostring) {
            const lang = String(infostring || '').match(/^\S*/)[0];
            const body = Highlighter.highlight(String(code).replace(/\n$/, ''), lang);
            const cls = lang ? ` class="language-${escapeHtml(lang)}"` : '';
            const tag = lang ? ` data-lang="${escapeHtml(lang)}"` : '';
            return `<pre class="md-code"${tag}><code${cls}>${body}\n</code></pre>\n`;
          },
          heading(text, level, raw) {
            return `<h${level} id="${escapeHtml(uniqueSlug(raw))}">${text}</h${level}>\n`;
          },
          checkbox(checked) {
            return `<input type="checkbox" class="md-task" data-task="${S.task++}"${checked ? ' checked' : ''}> `;
          }
        }
      });
      return md;
    }

    /* Renders `src` and reports where each top-level block, heading and task
       box starts in the source, by line. */
    function render(src) {
      const m = instance();
      reset();
      const out = { html: '', blocks: [], headings: [], taskLines: [] };
      if (!m) {
        out.html = '<pre>' + escapeHtml(src) + '</pre>';
        return out;
      }
      const norm = lexerNormalise(src);
      S.norm = norm;
      if (norm.includes('[^')) {
        const re = /^\[\^[^\]\s]+\]:/gm;
        let d;
        while ((d = re.exec(norm))) S.defAt.push(d.index);
      }
      const tokens = m.lexer(src);
      tokens.forEach((t) => { if (t.type === 'footnoteDef') S.defIds.add(t.id); });
      const nStarts = lineStartsOf(norm);
      let cursor = 0;

      const locate = (raw, from) => {
        if (!raw) return -1;
        let idx = norm.indexOf(raw, from);
        if (idx < 0) {
          const first = raw.split('\n').find((l) => l.trim());
          if (first) idx = norm.indexOf(first, from);
        }
        return idx;
      };

      let taskCursor = 0;
      const walk = (list) => {
        for (const t of list || []) {
          if (t.type === 'list') {
            for (const item of t.items || []) {
              const idx = locate(item.raw.split('\n')[0], taskCursor);
              if (idx >= 0) taskCursor = idx + 1;
              if (item.task) out.taskLines.push(idx >= 0 ? lineAtOffset(nStarts, idx) : -1);
              walk(item.tokens);
            }
          } else if (t.type === 'blockquote') {
            walk(t.tokens);
          }
        }
      };

      let html = '';
      for (const tok of tokens) {
        const idx = locate(tok.raw, cursor);
        let line = -1;
        if (idx >= 0) {
          line = lineAtOffset(nStarts, idx);
          cursor = idx + (norm.startsWith(tok.raw, idx) ? tok.raw.length : 1);
          if (taskCursor < idx) taskCursor = idx;
        }
        if (tok.type !== 'space' && tok.type !== 'footnoteDef' && line >= 0) {
          out.blocks.push(line);
          html += `<span class="md-anchor" data-line="${line}"></span>`;
          if (tok.type === 'heading') {
            out.headings.push({ level: tok.depth, title: inlinePlain(tok.text) || 'Untitled section', line });
          }
        }
        walk([tok]);
        html += m.parser([tok]);
      }

      if (S.order.length) {
        html += '<section class="md-footnotes"><ol>';
        S.order.forEach((id) => {
          const slug = fnSlug(id);
          html += `<li id="fn-${slug}">${S.defs.get(id) || ''} <a href="#fnref-${slug}" class="md-fnback" title="Back to text">&#8617;</a></li>`;
        });
        html += '</ol></section>';
      }
      out.html = html;
      return out;
    }
    return { render };
  })();

  /* Top-level headings (ATX and setext), by source offset. Kept as a named
     export because the outline and the smoke tests both lean on it. */
  function parseMdHeadings(src) {
    const text = String(src || '');
    const starts = lineStartsOf(text);
    return Pipeline.render(text).headings.map((h) => ({
      level: h.level,
      tag: 'h' + h.level,
      title: h.title,
      offset: starts[h.line] || 0,
      line: h.line
    }));
  }

  /* Words as a reader counts them: markdown syntax, URLs and HTML tags are
     not words; CJK characters count one each. */
  function plainWordCount(src) {
    let t = String(src || '')
      .replace(/^[ \t]*\[[^\]\n]+\]:[ \t]*\S+.*$/gm, ' ')
      .replace(/^[ \t]*(?:```|~~~).*$/gm, ' ')
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, ' $1 ')
      .replace(/!\[([^\]]*)\]\[[^\]]*\]/g, ' $1 ')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, ' $1 ')
      .replace(/\[([^\]]*)\]\[[^\]]*\]/g, ' $1 ')
      .replace(/<[^>\n]+>/g, ' ')
      .replace(/https?:\/\/\S+/g, ' ')
      .replace(/^[ \t]*\|?[ \t]*:?-{3,}:?[ \t]*(?:\|[ \t]*:?-{3,}:?[ \t]*)*\|?[ \t]*$/gm, ' ')
      .replace(/^[ \t]*(?:[-*_][ \t]*){3,}$/gm, ' ')
      .replace(/\[[ xX]\]/g, ' ')
      .replace(/[|*_~`#>]+/g, ' ');
    const cjk = (t.match(/[぀-ヿ㐀-鿿豈-﫿가-힯]/g) || []).length;
    if (cjk) t = t.replace(/[぀-ヿ㐀-鿿豈-﫿가-힯]/g, ' ');
    let words = 0;
    const parts = t.split(/\s+/);
    for (const p of parts) if (p && /[\p{L}\p{N}]/u.test(p)) words++;
    return words + cjk;
  }

  function statusLine(words) {
    if (!words) return '0 words';
    const minutes = Math.max(1, Math.round(words / 230));
    return `${words.toLocaleString()} word${words === 1 ? '' : 's'} · ${minutes} min read`;
  }

  /* file:// URL of the folder a document lives in, for relative images. */
  function baseUrlFor(filePath) {
    if (!filePath) return null;
    const norm = String(filePath).replace(/\\/g, '/');
    const dir = norm.slice(0, norm.lastIndexOf('/') + 1);
    if (!dir) return null;
    const segs = dir.split('/').map((seg, i) => (i === 0 && /^[A-Za-z]:$/.test(seg) ? seg : encodeURIComponent(seg)));
    const joined = segs.join('/');
    return 'file://' + (joined.startsWith('/') ? '' : '/') + joined;
  }

  function relativePath(fromDir, target) {
    const a = String(fromDir).replace(/\\/g, '/').replace(/\/+$/, '').split('/');
    const b = String(target).replace(/\\/g, '/').split('/');
    if (a[0].toLowerCase() !== b[0].toLowerCase()) return null;
    let i = 0;
    const same = (x, y) => (/^[a-z]:$/i.test(a[0]) ? x.toLowerCase() === y.toLowerCase() : x === y);
    while (i < a.length && i < b.length - 1 && same(a[i], b[i])) i++;
    const up = a.length - i;
    const rest = b.slice(i);
    return (up ? '../'.repeat(up) : '') + rest.join('/');
  }

  function decodeURIComponentSafe(s) {
    try { return decodeURIComponent(s); } catch { return s; }
  }

  const mdUrl = (p) => String(p).replace(/ /g, '%20').replace(/\(/g, '%28').replace(/\)/g, '%29');

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result || ''));
      r.onerror = () => reject(r.error || new Error('Could not read the image'));
      r.readAsDataURL(file);
    });
  }

  /* Pasted screenshots can be enormous; anything wider than this is scaled
     down before it is embedded in the text. */
  const MAX_EMBED_WIDTH = 1600;
  async function embeddableDataUrl(file) {
    const raw = await readFileAsDataUrl(file);
    if (!/^data:image\/(png|jpeg|jpg|webp|gif|bmp)/i.test(raw) || /gif/i.test(file.type)) return raw;
    const img = await new Promise((resolve) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => resolve(null);
      im.src = raw;
    });
    if (!img || img.naturalWidth <= MAX_EMBED_WIDTH) return raw;
    const scale = MAX_EMBED_WIDTH / img.naturalWidth;
    const c = document.createElement('canvas');
    c.width = MAX_EMBED_WIDTH;
    c.height = Math.max(1, Math.round(img.naturalHeight * scale));
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return /jpe?g/i.test(file.type) ? c.toDataURL('image/jpeg', 0.9) : c.toDataURL('image/png');
  }

  /* ------------------------------------------------------------------ */
  /* editor                                                              */
  /* ------------------------------------------------------------------ */
  const LIST_RE = /^([ \t]*(?:>[ \t]?)*[ \t]*)(?:([-*+])|(\d{1,9})([.)]))([ \t]+)(\[[ xX]\][ \t]+)?/;
  const QUOTE_RE = /^([ \t]*(?:>[ \t]?)+)/;
  const TASK_LINE_RE = /^([ \t]*(?:>[ \t]*)*(?:[-*+]|\d{1,9}[.)])[ \t]+)\[([ xX])\]/;
  const PAIRS = { '(': ')', '[': ']', '{': '}', '"': '"', "'": "'", '`': '`' };
  const CLOSERS = new Set([')', ']', '}', '"', "'", '`']);
  const WRAP_ONLY = { '*': '*', '_': '_', '~': '~' };

  function create(ctx) {
    let textarea, preview, previewPane, wrap, measure, mode = 'split';
    let docRef = null;
    let renderTimer = null, statusTimer = null, findTimer = null;
    let lastRenderMs = 0;
    let renderedText = null;
    let lastRender = { blocks: [], headings: [], taskLines: [] };
    let blockEls = [];
    let zoom = 1;
    const ZOOM_MIN = 0.5;
    const ZOOM_MAX = 2;
    let outlineRail = null;
    const history = window.MargoHistory.create();
    let skipInputRecord = false;
    let destroyed = false;
    let undoBtn = null, redoBtn = null;
    let popover = null;
    let words = 0;

    /* ---------------- preview rendering ---------------- */
    function sanitize(html) {
      return DOMPurify.sanitize(html, {
        RETURN_DOM_FRAGMENT: true,
        FORBID_TAGS: ['style', 'form', 'button', 'textarea', 'select', 'option', 'dialog', 'meta', 'link', 'base', 'template'],
        FORBID_ATTR: ['autofocus', 'formaction', 'form', 'tabindex']
      });
    }

    function resolveImage(img, base) {
      const src = img.getAttribute('src') || '';
      if (!src) return;
      if (/^(data:|blob:)/i.test(src)) return;
      if (/^https?:/i.test(src) || /^\/\//.test(src)) {
        /* The window's content policy only lets local pictures in, so a
           remote one says so instead of showing a broken frame. */
        const note = document.createElement('span');
        note.className = 'md-img-blocked';
        note.title = src;
        note.textContent = (img.getAttribute('alt') || 'Image') + ' — online image not loaded';
        img.replaceWith(note);
        return;
      }
      if (/^file:/i.test(src)) return;
      if (/^[A-Za-z]:[\\/]/.test(src)) {
        img.setAttribute('src', 'file:///' + src.replace(/\\/g, '/').split('/').map((seg, i) => (i === 0 ? seg : encodeURIComponent(decodeURIComponentSafe(seg)))).join('/'));
        return;
      }
      if (!base && !src.startsWith('/')) {
        const note = document.createElement('span');
        note.className = 'md-img-blocked';
        note.title = src;
        note.textContent = (img.getAttribute('alt') || 'Image') + ' — save the note to show pictures next to it';
        img.replaceWith(note);
        return;
      }
      try { img.setAttribute('src', new URL(src, base || 'file:///').href); } catch {}
    }

    function decorate(frag) {
      const base = baseUrlFor(docRef && docRef.path);
      /* Map each top-level block to the source line it came from, by its
         position among the fragment's element children. */
      const lines = [];
      let childIndex = 0;
      let pending = null;
      Array.from(frag.childNodes).forEach((node) => {
        if (node.nodeType !== 1) return;
        if (node.classList.contains('md-anchor')) {
          pending = Number(node.dataset.line);
          node.remove();
          return;
        }
        if (pending != null) { lines[childIndex] = pending; pending = null; }
        childIndex++;
      });
      frag.querySelectorAll('.md-anchor').forEach((a) => a.remove());
      frag.querySelectorAll('[id]').forEach((el) => {
        if (!el.id.startsWith(ID_PREFIX)) el.id = ID_PREFIX + el.id;
      });
      frag.querySelectorAll('[name]').forEach((el) => el.removeAttribute('name'));
      frag.querySelectorAll('input').forEach((el) => {
        if (el.classList.contains('md-task') && el.type === 'checkbox') el.removeAttribute('disabled');
        else el.remove();
      });
      frag.querySelectorAll('img').forEach((img) => resolveImage(img, base));
      frag.querySelectorAll('a[href]').forEach((a) => {
        const href = a.getAttribute('href') || '';
        if (/^(https?:|mailto:)/i.test(href)) {
          a.classList.add('md-ext');
          if (!a.title) a.title = href;
        }
      });
      frag.querySelectorAll('input.md-task').forEach((cb) => {
        const li = cb.closest('li');
        if (!li) return;
        li.classList.add('md-task-item');
        if (cb.checked) li.classList.add('done');
        /* the item's own words, so ticking it strikes them and not the
           sub-list under it */
        const holder = cb.parentElement;
        const span = document.createElement('span');
        span.className = 'md-task-text';
        let n = cb.nextSibling;
        while (n && !(n.nodeType === 1 && /^(UL|OL|P|DIV|PRE|BLOCKQUOTE|TABLE)$/.test(n.nodeName))) {
          const next = n.nextSibling;
          span.appendChild(n);
          n = next;
        }
        holder.insertBefore(span, cb.nextSibling);
      });
      frag.querySelectorAll('pre > code').forEach((code) => {
        const pre = code.parentElement;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'md-code-copy';
        btn.title = 'Copy code';
        btn.setAttribute('aria-label', 'Copy code');
        btn.innerHTML = ICONS.copy;
        pre.appendChild(btn);
        if (pre.dataset.lang) {
          const tag = document.createElement('span');
          tag.className = 'md-code-lang';
          tag.textContent = pre.dataset.lang;
          pre.appendChild(tag);
        }
      });
      return lines;
    }

    /* The same rendering for export (PDF, Word, HTML), without the
       preview's controls: pictures get absolute file URLs because the
       export is laid out from a temporary folder, and task boxes become
       characters Word can keep. */
    function exportHtml() {
      const text = textarea ? textarea.value : '';
      const frag = sanitize(Pipeline.render(text).html);
      const base = baseUrlFor(docRef && docRef.path);
      frag.querySelectorAll('.md-anchor').forEach((a) => a.remove());
      frag.querySelectorAll('img').forEach((img) => resolveImage(img, base));
      frag.querySelectorAll('input').forEach((el) => {
        if (el.classList.contains('md-task')) el.replaceWith(document.createTextNode(el.checked ? '\u2611' : '\u2610'));
        else el.remove();
      });
      frag.querySelectorAll('[id]').forEach((el) => { el.id = ID_PREFIX + el.id; });
      frag.querySelectorAll('a[href^="#"]').forEach((a) => a.setAttribute('href', '#' + ID_PREFIX + a.getAttribute('href').slice(1)));
      const holder = document.createElement('div');
      holder.appendChild(frag);
      return holder.innerHTML;
    }

    /* Only the blocks that changed are swapped, so pictures do not reload
       and the reader keeps their place while the author types. */
    function morph(target, fresh) {
      const oldN = Array.from(target.childNodes);
      const newN = Array.from(fresh.childNodes);
      let s = 0;
      while (s < oldN.length && s < newN.length && oldN[s].isEqualNode(newN[s])) s++;
      let eo = oldN.length - 1;
      let en = newN.length - 1;
      while (eo >= s && en >= s && oldN[eo].isEqualNode(newN[en])) { eo--; en--; }
      const ref = oldN[eo + 1] || null;
      for (let i = s; i <= eo; i++) target.removeChild(oldN[i]);
      const frag = document.createDocumentFragment();
      for (let i = s; i <= en; i++) frag.appendChild(newN[i]);
      target.insertBefore(frag, ref);
    }

    function render(force) {
      clearTimeout(renderTimer);
      renderTimer = null;
      if (!textarea || destroyed) return;
      const text = textarea.value;
      if (!force && text === renderedText) return;
      const t0 = performance.now();
      const result = Pipeline.render(text);
      const frag = sanitize(result.html);
      const lines = decorate(frag);
      unwrapPreviewFindMarks();
      morph(preview, frag);
      blockEls = [];
      Array.from(preview.children).forEach((el, i) => {
        if (lines[i] != null) blockEls.push({ el, line: lines[i] });
      });
      lastRender = result;
      renderedText = text;
      syncDirty = true;
      lastRenderMs = performance.now() - t0;
      if (findOpen) paintPreviewFindHits();
      if (outlineRail && !outlineRail.classList.contains('hidden')) renderOutline();
    }

    function scheduleRender() {
      clearTimeout(renderTimer);
      if (mode === 'write') {
        /* Nothing on screen needs it; the outline asks for a render itself. */
        renderTimer = null;
        if (outlineRail && !outlineRail.classList.contains('hidden')) {
          renderTimer = setTimeout(() => render(), 400);
        }
        return;
      }
      /* Big documents take longer to render than a keystroke lasts, so the
         wait grows with the last render's cost instead of queueing work. */
      const delay = Math.min(1500, Math.max(120, lastRenderMs * 2));
      renderTimer = setTimeout(() => render(), delay);
    }

    function statusText() {
      return statusLine(words);
    }
    let countedText = null;
    function countWords() {
      const text = textarea ? textarea.value : '';
      if (text !== countedText) {
        words = plainWordCount(text);
        countedText = text;
      }
      return words;
    }
    function updateStatus() {
      clearTimeout(statusTimer);
      statusTimer = null;
      if (!textarea) return;
      countWords();
      ctx.setStatus(statusText(), 'Markdown');
    }
    function scheduleStatus() {
      clearTimeout(statusTimer);
      const delay = textarea && textarea.value.length > 200000 ? 900 : 250;
      statusTimer = setTimeout(updateStatus, delay);
    }
    function refreshUndoButtons() {
      if (undoBtn) undoBtn.disabled = !history.canUndo();
      if (redoBtn) redoBtn.disabled = !history.canRedo();
    }

    /* ---------------- zoom ---------------- */
    function applyZoom(clientX, clientY) {
      if (!wrap) return;
      const host = wrap.parentElement;
      const prev = parseFloat(wrap.style.zoom) || 1;
      const next = zoom;
      wrap.style.zoom = String(next);
      if (host && prev !== next) {
        const rect = host.getBoundingClientRect();
        const cx = clientX != null ? clientX : rect.left + host.clientWidth / 2;
        const cy = clientY != null ? clientY : rect.top + host.clientHeight / 2;
        const pane = document.elementFromPoint(cx, cy);
        const scrollEl = pane && pane.closest && (pane.closest('.md-pane-preview') || (pane.closest('.md-pane-editor') && textarea));
        const target = scrollEl || textarea;
        if (target && target.scrollHeight > target.clientHeight) {
          const ratio = next / prev;
          const my = cy - rect.top;
          target.scrollTop = (target.scrollTop + my / prev) * ratio - my / next;
        }
      }
      syncDirty = true;
      if (findOpen) syncFindOverlayScroll();
      if (ctx.status) ctx.status.setZoom(zoom, ZOOM_MIN, ZOOM_MAX);
    }
    function zoomBy(factor, clientX, clientY) {
      const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, +(zoom * factor).toFixed(4)));
      if (next === zoom) return;
      zoom = next;
      applyZoom(clientX, clientY);
    }
    function setZoomLevel(z, clientX, clientY) {
      const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, +z));
      if (!isFinite(next) || next === zoom) return;
      zoom = next;
      applyZoom(clientX, clientY);
    }
    function onCtrlWheel(e) {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1, e.clientX, e.clientY);
    }

    function setupStatusChrome() {
      if (!ctx.status) return;
      ctx.status.setKind('Markdown');
      ctx.status.showZoom(true);
      ctx.status.setZoom(zoom, ZOOM_MIN, ZOOM_MAX);
      ctx.status.setViewModes([
        { id: 'write', title: 'Write', html: ICONS.write },
        { id: 'split', title: 'Split', html: ICONS.split },
        { id: 'read', title: 'Read', html: ICONS.read }
      ]);
      ctx.status.setViewActive(mode);
      ctx.status.onView((m) => setMode(m));
      ctx.status.onZoom((z) => setZoomLevel(z));
    }

    /* ---------------- history ---------------- */
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
      revealCaret();
    }
    function recordNow() {
      if (!textarea || history.isApplying()) return;
      history.record(capture());
      refreshUndoButtons();
    }
    function withImmediateHistory(fn) {
      skipInputRecord = true;
      try { fn(); } finally { skipInputRecord = false; }
      recordNow();
    }
    function undo() { history.undo(restore); refreshUndoButtons(); }
    function redo() { history.redo(restore); refreshUndoButtons(); }

    function afterEdit(keepFocus) {
      if (!keepFocus) textarea.focus();
      ctx.markDirty();
      scheduleRender();
      scheduleStatus();
      refreshUndoButtons();
      if (findOpen) scheduleFindRefresh();
    }

    /* One replacement of [from, to) with `text`, then a selection. */
    function edit(from, to, text, selStart, selEnd) {
      withImmediateHistory(() => {
        textarea.setRangeText(text, from, to, 'end');
        if (selStart != null) textarea.setSelectionRange(selStart, selEnd == null ? selStart : selEnd);
      });
      afterEdit();
    }

    function lineBounds(v, s, e) {
      const ls = v.lastIndexOf('\n', s - 1) + 1;
      const endPos = e > s && v[e - 1] === '\n' ? e - 1 : e;
      let le = v.indexOf('\n', endPos);
      if (le === -1) le = v.length;
      return { ls, le };
    }

    /* Keeps a caret or selection in view after a programmatic move, using
       the measuring mirror so wrapped lines are accounted for. */
    function revealCaret() {
      if (!textarea) return;
      const y = offsetY(textarea.selectionStart);
      if (y == null) return;
      const lh = parseFloat(getComputedStyle(textarea).lineHeight) || 22;
      if (y < textarea.scrollTop || y + lh > textarea.scrollTop + textarea.clientHeight) {
        textarea.scrollTop = Math.max(0, y - textarea.clientHeight / 3);
      }
    }

    /* ---------------- formatting commands ---------------- */
    function toggleWrap(before, after, placeholder) {
      if (!textarea) return;
      const v = textarea.value;
      let s = textarea.selectionStart, e = textarea.selectionEnd;
      const bl = before.length, al = after.length;
      if (s === e) {
        /* no selection: act on the word under the caret, if any */
        const left = /[\p{L}\p{N}_]+$/u.exec(v.slice(Math.max(0, s - 80), s));
        const right = /^[\p{L}\p{N}_]+/u.exec(v.slice(s, s + 80));
        if (left) s -= left[0].length;
        if (right) e += right[0].length;
      }
      const sel = v.slice(s, e);
      /* a lone * next to a second * is bold, not italic */
      const boldNotItalic = (str) => before === '*' && str.startsWith('**') && !str.startsWith('***');
      if (sel.length >= bl + al && sel.startsWith(before) && sel.endsWith(after) && !boldNotItalic(sel)) {
        const inner = sel.slice(bl, sel.length - al);
        edit(s, e, inner, s, s + inner.length);
        return;
      }
      const loneStarInBold = before === '*' && v[s - 2] === '*' && v[s - 3] !== '*';
      const hugging = v.slice(s - bl, s) === before && v.slice(e, e + al) === after && !loneStarInBold;
      if (hugging && (s !== e || v.slice(s - bl, e + al) === before + after)) {
        edit(s - bl, e + al, sel, s - bl, e - bl);
        return;
      }
      if (s === e) {
        const ph = placeholder || '';
        edit(s, e, before + ph + after, s + bl, s + bl + ph.length);
        return;
      }
      /* keep surrounding whitespace outside the markers */
      const lead = /^\s*/.exec(sel)[0].length;
      const trail = /\s*$/.exec(sel)[0].length;
      const core = sel.slice(lead, sel.length - trail);
      if (!core) { edit(s, e, sel + before + (placeholder || '') + after); return; }
      const out = sel.slice(0, lead) + before + core + after + sel.slice(sel.length - trail);
      edit(s, e, out, s + lead + bl, s + lead + bl + core.length);
    }

    function setHeading(level) {
      const v = textarea.value;
      const s = textarea.selectionStart, e = textarea.selectionEnd;
      const { ls, le } = lineBounds(v, s, e);
      const lines = v.slice(ls, le).split('\n');
      const current = /^(#{1,6})[ \t]+/.exec(lines[0]);
      const same = current && current[1].length === level;
      const out = lines.map((line) => {
        if (!line.trim() && lines.length > 1) return line;
        const bare = line.replace(/^#{1,6}[ \t]+/, '');
        return level && !same ? '#'.repeat(level) + ' ' + bare : bare;
      }).join('\n');
      const caretEnd = ls + out.length;
      edit(ls, le, out, lines.length > 1 ? ls : caretEnd, caretEnd);
    }

    function currentHeadingLevel() {
      if (!textarea) return 0;
      const v = textarea.value;
      const ls = v.lastIndexOf('\n', textarea.selectionStart - 1) + 1;
      const m = /^(#{1,6})[ \t]/.exec(v.slice(ls, ls + 8));
      return m ? m[1].length : 0;
    }

    /* kind: 'ul' | 'ol' | 'task' | 'quote' */
    function toggleList(kind) {
      const v = textarea.value;
      const s = textarea.selectionStart, e = textarea.selectionEnd;
      const { ls, le } = lineBounds(v, s, e);
      const lines = v.slice(ls, le).split('\n');
      const content = lines.filter((l) => l.trim());
      let out;
      if (kind === 'quote') {
        const all = content.length && content.every((l) => /^[ \t]*>/.test(l));
        out = lines.map((l) => (all ? l.replace(/^([ \t]*)>[ \t]?/, '$1') : (l.trim() || lines.length === 1 ? '> ' + l : l)));
      } else {
        const is = (l) => {
          const m = LIST_RE.exec(l);
          if (!m) return false;
          if (kind === 'task') return !!m[6];
          if (kind === 'ol') return !!m[3] && !m[6];
          return !!m[2] && !m[6];
        };
        const all = content.length > 0 && content.every(is);
        let n = 0;
        out = lines.map((l) => {
          if (!l.trim() && lines.length > 1) return l;
          const m = LIST_RE.exec(l);
          const indent = m ? m[1] : (/^[ \t]*/.exec(l) || [''])[0];
          const body = m ? l.slice(m[0].length) : l.slice(indent.length);
          if (all) return indent + body;
          n++;
          const marker = kind === 'ol' ? `${n}. ` : kind === 'task' ? '- [ ] ' : '- ';
          return indent + marker + body;
        });
      }
      const text = out.join('\n');
      const caret = ls + text.length;
      edit(ls, le, text, lines.length > 1 ? ls : caret, caret);
    }

    function insertBlock(text, selectFrom, selectLen) {
      const v = textarea.value;
      const s = textarea.selectionStart, e = textarea.selectionEnd;
      const before = v.slice(0, s);
      const lead = !before ? '' : before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
      const after = v.slice(e);
      const trail = !after ? '\n' : after.startsWith('\n\n') ? '' : after.startsWith('\n') ? '\n' : '\n\n';
      const full = lead + text + trail;
      const base = s + lead.length;
      if (selectFrom != null) edit(s, e, full, base + selectFrom, base + selectFrom + (selectLen || 0));
      else edit(s, e, full, base + text.length);
    }

    function insertCodeBlock() {
      const sel = textarea.value.slice(textarea.selectionStart, textarea.selectionEnd);
      if (sel) insertBlock('```\n' + sel.replace(/\n$/, '') + '\n```', 3, 0);
      else insertBlock('```\ncode\n```', 4, 4);
    }

    function insertTable(rows, cols) {
      rows = Math.max(1, rows | 0); cols = Math.max(1, cols | 0);
      const head = '| ' + Array.from({ length: cols }, (_, i) => `Column ${i + 1}`).join(' | ') + ' |';
      const rule = '| ' + Array.from({ length: cols }, () => '---').join(' | ') + ' |';
      const body = Array.from({ length: rows }, () => '| ' + Array.from({ length: cols }, () => '   ').join(' | ') + ' |');
      insertBlock([head, rule].concat(body).join('\n'), 2, 8);
    }

    async function insertLink() {
      const v = textarea.value;
      const s = textarea.selectionStart, e = textarea.selectionEnd;
      const sel = v.slice(s, e);
      if (/^(https?:\/\/|mailto:)\S+$/i.test(sel.trim())) {
        edit(s, e, `[](${sel.trim()})`, s + 1);
        return;
      }
      const url = await ctx.inputModal('Insert link', 'https://example.com', 'https://');
      if (destroyed || url == null) { textarea && textarea.focus(); return; }
      const clean = url.trim();
      if (!clean || clean === 'https://') { textarea.focus(); return; }
      const label = sel || 'link text';
      const out = `[${label}](${mdUrl(clean)})`;
      edit(s, e, out, s + 1, s + 1 + label.length);
    }

    function insertFootnote() {
      const v = textarea.value;
      let n = 1;
      while (new RegExp('\\[\\^' + n + '\\]').test(v)) n++;
      const s = textarea.selectionEnd;
      const tail = v.endsWith('\n') ? '' : '\n';
      const defText = `${tail}\n[^${n}]: `;
      withImmediateHistory(() => {
        textarea.setRangeText(`[^${n}]`, s, s, 'end');
        const end = textarea.value.length;
        textarea.setRangeText(defText, end, end, 'end');
        textarea.setSelectionRange(textarea.value.length, textarea.value.length);
      });
      afterEdit();
      revealCaret();
    }

    /* Pictures: a file next to a saved note is linked by relative path;
       anything else (pasted screenshots, unsaved notes) is embedded as a
       data URI in a reference definition at the end, which keeps the prose
       readable. */
    function uniqueRefId() {
      const v = textarea.value;
      let id;
      do { id = 'img-' + Math.random().toString(36).slice(2, 8); } while (v.includes('[' + id + ']'));
      return id;
    }
    function insertImageMarkdown(alt, target) {
      const v = textarea.value;
      const s = textarea.selectionStart, e = textarea.selectionEnd;
      const label = (alt || 'image').replace(/[[\]]/g, '');
      const text = `![${label}](${target})`;
      const pre = s > 0 && v[s - 1] !== '\n' && v[s - 1] !== ' ' ? ' ' : '';
      edit(s, e, pre + text, s + pre.length + 2, s + pre.length + 2 + label.length);
    }
    function insertEmbeddedImage(alt, dataUrl) {
      const id = uniqueRefId();
      const label = (alt || 'image').replace(/[[\]]/g, '');
      const s = textarea.selectionStart, e = textarea.selectionEnd;
      withImmediateHistory(() => {
        textarea.setRangeText(`![${label}][${id}]`, s, e, 'end');
        const caret = textarea.selectionEnd;
        const v = textarea.value;
        const sep = v.endsWith('\n\n') ? '' : v.endsWith('\n') ? '\n' : '\n\n';
        textarea.setRangeText(`${sep}[${id}]: ${dataUrl}\n`, v.length, v.length, 'preserve');
        textarea.setSelectionRange(caret, caret);
      });
      afterEdit();
    }
    async function insertImageFiles(files, altOverride) {
      const images = Array.from(files || []).filter((f) => /^image\//.test(f.type));
      if (!images.length) return false;
      const docPath = docRef && docRef.path;
      for (const file of images) {
        const alt = altOverride || (file.name || 'image').replace(/\.[^.]+$/, '') || 'image';
        let filePath = null;
        try { filePath = window.margo && window.margo.pathForFile ? window.margo.pathForFile(file) : null; } catch {}
        if (docPath && filePath) {
          const norm = String(docPath).replace(/\\/g, '/');
          const rel = relativePath(norm.slice(0, norm.lastIndexOf('/')), filePath);
          if (rel) { insertImageMarkdown(alt, mdUrl(rel)); continue; }
        }
        try {
          insertEmbeddedImage(alt === 'image' && !file.name ? 'pasted image' : alt, await embeddableDataUrl(file));
        } catch (err) {
          ctx.toast((err && err.message) || 'Could not insert the image', 'error');
        }
      }
      return true;
    }
    async function insertImageDialog() {
      const body = document.createElement('div');
      body.className = 'md-dialog';
      body.innerHTML =
        `<label class="md-field"><span>Image address or path</span><input type="text" class="md-img-url" placeholder="https://… or images/picture.png"></label>` +
        `<label class="md-field"><span>Description (alt text)</span><input type="text" class="md-img-alt" placeholder="What the picture shows"></label>` +
        `<div class="md-dialog-row"><button type="button" class="btn ghost md-img-pick">Choose a picture…</button>` +
        `<span class="md-dialog-hint">${docRef && docRef.path ? 'Pictures are linked relative to this note.' : 'Pictures are embedded until the note is saved.'}</span></div>` +
        `<input type="file" accept="image/*" class="md-img-file" hidden>`;
      const urlIn = body.querySelector('.md-img-url');
      const altIn = body.querySelector('.md-img-alt');
      const fileIn = body.querySelector('.md-img-file');
      body.querySelector('.md-img-pick').addEventListener('click', () => fileIn.click());
      fileIn.addEventListener('change', () => {
        if (fileIn.files && fileIn.files.length) ctx.closeModal({ files: Array.from(fileIn.files), alt: altIn.value });
      });
      const submit = () => ({ url: urlIn.value.trim(), alt: altIn.value.trim() });
      [urlIn, altIn].forEach((inp) => inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); ctx.closeModal(submit()); }
      }));
      setTimeout(() => urlIn.focus(), 40);
      const res = await ctx.openModal('Insert image', body, [
        { label: 'Cancel', value: null },
        { label: 'Insert', primary: true, value: submit }
      ]);
      if (destroyed || !res) { textarea && textarea.focus(); return; }
      if (res.files) {
        await insertImageFiles(res.files, res.alt || null);
        return;
      }
      if (!res.url) { textarea.focus(); return; }
      insertImageMarkdown(res.alt || 'image', mdUrl(res.url));
    }

    /* ---------------- textarea behaviours ---------------- */
    function listIndentUnit(m) {
      if (!m) return '  ';
      return m[3] ? ' '.repeat(m[3].length + 1 + m[5].length) : '  ';
    }

    function indentLines(outdent) {
      const v = textarea.value;
      const s = textarea.selectionStart, e = textarea.selectionEnd;
      const { ls, le } = lineBounds(v, s, e);
      const lines = v.slice(ls, le).split('\n');
      let firstDelta = 0, totalDelta = 0;
      const out = lines.map((line, i) => {
        const unit = listIndentUnit(LIST_RE.exec(line));
        let next = line;
        if (outdent) {
          const m = /^(\t| {1,4})/.exec(line);
          const cut = m ? Math.min(m[0].length, m[0] === '\t' ? 1 : unit.length) : 0;
          next = line.slice(cut);
        } else if (line.length || lines.length === 1) {
          next = unit + line;
        }
        const d = next.length - line.length;
        if (i === 0) firstDelta = d;
        totalDelta += d;
        return next;
      }).join('\n');
      if (out === v.slice(ls, le)) return;
      const ns = Math.max(ls, s + firstDelta);
      const ne = s === e ? ns : Math.max(ns, e + totalDelta);
      edit(ls, le, out, ns, ne);
    }

    function isTableRow(line) {
      return /^\s*\|.*\|\s*$/.test(line);
    }
    function tableTab(back) {
      const v = textarea.value;
      const s = textarea.selectionStart;
      const { ls, le } = lineBounds(v, s, s);
      const line = v.slice(ls, le);
      if (!isTableRow(line)) return false;
      const cells = [];
      for (let i = line.indexOf('|'); i !== -1; i = line.indexOf('|', i + 1)) cells.push(ls + i);
      if (!back) {
        const nextBar = cells.find((p) => p >= s && p < le - 1 && p !== cells[cells.length - 1]);
        if (nextBar != null && nextBar + 1 < le) {
          let a = nextBar + 1, b = cells[cells.indexOf(nextBar) + 1] || le;
          while (a < b && v[a] === ' ') a++;
          let z = b; while (z > a && v[z - 1] === ' ') z--;
          textarea.setSelectionRange(a, z);
          return true;
        }
        /* last cell: next row, or a fresh one */
        const isRule = (l) => /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(l);
        let rowEnd = le;
        for (let hop = 0; hop < 2; hop++) {
          const nextStart = rowEnd + 1;
          if (nextStart > v.length) break;
          let nextEnd = v.indexOf('\n', nextStart);
          if (nextEnd === -1) nextEnd = v.length;
          const nextLine = v.slice(nextStart, nextEnd);
          if (!isTableRow(nextLine)) break;
          if (isRule(nextLine)) { rowEnd = nextEnd; continue; }
          const p = v.indexOf('|', nextStart) + 1;
          const q = v[p] === ' ' ? p + 1 : p;
          textarea.setSelectionRange(q, q);
          return true;
        }
        const colsCount = Math.max(1, cells.length - 1);
        const row = '\n|' + '   |'.repeat(colsCount);
        edit(rowEnd, rowEnd, row, rowEnd + 3);
        return true;
      }
      const prevBars = cells.filter((p) => p < s);
      if (prevBars.length >= 2) {
        const b = prevBars[prevBars.length - 2];
        let a = b + 1, end = prevBars[prevBars.length - 1];
        while (a < end && v[a] === ' ') a++;
        let z = end; while (z > a && v[z - 1] === ' ') z--;
        textarea.setSelectionRange(a, z);
      }
      return true;
    }

    function inFence(v, pos) {
      const before = v.slice(0, pos);
      const fences = before.match(/^[ \t]{0,3}(```|~~~)/gm);
      return !!(fences && fences.length % 2 === 1);
    }

    function smartEnter() {
      const v = textarea.value;
      const s = textarea.selectionStart, e = textarea.selectionEnd;
      const ls = v.lastIndexOf('\n', s - 1) + 1;
      let le = v.indexOf('\n', s);
      if (le === -1) le = v.length;
      const line = v.slice(ls, le);
      const beforeCaret = v.slice(ls, s);
      if (inFence(v, ls)) {
        const indent = /^[ \t]*/.exec(line)[0];
        if (!indent) return false;
        edit(s, e, '\n' + indent.slice(0, Math.min(indent.length, beforeCaret.length)));
        return true;
      }
      const m = LIST_RE.exec(line);
      if (m && s - ls >= m[0].length) {
        const rest = line.slice(m[0].length);
        if (!rest.trim() && s === e && s === le) {
          const indent = /^[ \t]*/.exec(m[1])[0];
          if (indent.length) {
            /* an empty nested item steps out one level */
            const cut = Math.min(indent.length, listIndentUnit(m).length);
            edit(ls, ls + cut, '', s - cut);
          } else {
            edit(ls, le, m[1].replace(/[ \t]+$/, m[1].trim() ? ' ' : ''), ls + m[1].replace(/[ \t]+$/, m[1].trim() ? ' ' : '').length);
          }
          return true;
        }
        let marker;
        if (m[3]) marker = `${Number(m[3]) + 1}${m[4]}${m[5]}`;
        else marker = `${m[2]}${m[5]}`;
        if (m[6]) marker += '[ ] ';
        const insert = '\n' + m[1] + marker;
        withImmediateHistory(() => {
          textarea.setRangeText(insert, s, e, 'end');
          if (m[3]) renumberFrom(textarea.selectionStart, m[1], Number(m[3]) + 1, m[4]);
        });
        afterEdit();
        revealCaret();
        return true;
      }
      const q = QUOTE_RE.exec(line);
      if (q && s - ls >= q[0].length) {
        if (!line.slice(q[0].length).trim() && s === le) {
          edit(ls, le, '', ls);
        } else {
          edit(s, e, '\n' + q[1].replace(/[ \t]*$/, ' '));
        }
        return true;
      }
      const indent = /^[ \t]*/.exec(line)[0];
      if (indent && beforeCaret.trim()) {
        edit(s, e, '\n' + indent);
        return true;
      }
      return false;
    }

    /* After an ordered item is inserted the ones below it move down one. */
    function renumberFrom(caret, prefix, startNum, delim) {
      const v = textarea.value;
      let pos = v.indexOf('\n', caret);
      let n = startNum + 1;
      const re = new RegExp('^' + prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(\\d{1,9})\\' + delim + '([ \\t]+)');
      let out = '';
      const from = pos;
      let upto = pos;
      let changed = false;
      while (pos !== -1) {
        const start = pos + 1;
        let end = v.indexOf('\n', start);
        if (end === -1) end = v.length;
        const line = v.slice(start, end);
        const mm = re.exec(line);
        if (mm) {
          const fixed = line.replace(re, prefix + n + delim + mm[2]);
          if (fixed !== line) changed = true;
          out += '\n' + fixed;
          n++;
        } else if (line.startsWith(prefix + ' ') || (/^\s+\S/.test(line) && line.length > prefix.length)) {
          out += '\n' + line;
        } else {
          break;
        }
        upto = end;
        pos = end < v.length ? end : -1;
      }
      if (!changed || from === -1) return;
      const caretNow = textarea.selectionStart;
      textarea.setRangeText(out, from, upto, 'preserve');
      textarea.setSelectionRange(caretNow, caretNow);
    }

    function onTextareaKeydown(e) {
      if (e.isComposing || e.keyCode === 229) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = (e.key || '').toLowerCase();
      if (mod && !e.altKey) {
        let handled = true;
        if (!e.shiftKey && k === 'b') toggleWrap('**', '**', 'bold text');
        else if (!e.shiftKey && k === 'i') toggleWrap('*', '*', 'italic text');
        else if (!e.shiftKey && k === 'k') insertLink();
        else if (e.shiftKey && k === 'x') toggleWrap('~~', '~~', 'text');
        else if (!e.shiftKey && e.code === 'Backquote') toggleWrap('`', '`', 'code');
        else if (e.shiftKey && k === 'k') insertCodeBlock();
        else if (e.shiftKey && e.code === 'Digit7') toggleList('ol');
        else if (e.shiftKey && e.code === 'Digit8') toggleList('ul');
        else if (e.shiftKey && e.code === 'Digit9') toggleList('task');
        else if (e.shiftKey && e.code === 'Period') toggleList('quote');
        else if (e.shiftKey && k === 'i') insertImageDialog();
        else if (!e.shiftKey && /^Digit[1-6]$/.test(e.code)) setHeading(Number(e.code.slice(5)));
        else if (!e.shiftKey && k === 'h') openFind(true);
        else if (!e.shiftKey && e.code === 'BracketRight') indentLines(false);
        else if (!e.shiftKey && e.code === 'BracketLeft') indentLines(true);
        else handled = false;
        if (handled) { e.preventDefault(); e.stopPropagation(); }
        return;
      }
      if (e.altKey && !mod) return;
      const v = textarea.value;
      const s = textarea.selectionStart, en = textarea.selectionEnd;

      if (e.key === 'Tab' && !mod) {
        e.preventDefault();
        if (tableTab(e.shiftKey)) return;
        const multi = v.slice(s, en).includes('\n');
        const onList = LIST_RE.test(v.slice(v.lastIndexOf('\n', s - 1) + 1));
        if (e.shiftKey || multi || onList) indentLines(e.shiftKey);
        else edit(s, en, '  ', s + 2);
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey && !mod) {
        if (smartEnter()) e.preventDefault();
        return;
      }
      if (e.key === 'Backspace' && s === en && s > 0) {
        const open = v[s - 1];
        if (PAIRS[open] && v[s] === PAIRS[open]) {
          e.preventDefault();
          edit(s - 1, s + 1, '', s - 1);
        }
        return;
      }
      if (e.key.length !== 1) return;
      const ch = e.key;
      if (s !== en && (PAIRS[ch] || WRAP_ONLY[ch])) {
        /* typing a bracket, quote or emphasis mark around a selection wraps it */
        e.preventDefault();
        const close = PAIRS[ch] || WRAP_ONLY[ch];
        const sel = v.slice(s, en);
        edit(s, en, ch + sel + close, s + 1, s + 1 + sel.length);
        return;
      }
      if (s !== en) return;
      if (CLOSERS.has(ch) && v[s] === ch) {
        /* step over a closer that auto-pairing put there */
        const opener = Object.keys(PAIRS).find((o) => PAIRS[o] === ch);
        const before = v.slice(0, s);
        const balanced = opener === ch
          ? true
          : before.split(opener).length - 1 >= before.split(ch).length;
        if (balanced) {
          e.preventDefault();
          textarea.setSelectionRange(s + 1, s + 1);
          return;
        }
      }
      if (PAIRS[ch]) {
        const prev = v[s - 1] || '';
        const next = v[s] || '';
        if (next && !/[\s)\]}.,;:!?]/.test(next)) return;
        if ((ch === '"' || ch === "'") && /[\p{L}\p{N}_]/u.test(prev)) return;
        if (ch === '`' && prev === '`') return;
        if (ch === "'" && inFence(v, s)) return;
        e.preventDefault();
        edit(s, s, ch + PAIRS[ch], s + 1);
      }
    }

    function onTextareaPaste(e) {
      const cd = e.clipboardData;
      if (!cd) return;
      const files = Array.from(cd.files || []).filter((f) => /^image\//.test(f.type));
      const text = cd.getData('text/plain');
      if (files.length && !text) {
        e.preventDefault();
        insertImageFiles(files);
        return;
      }
      const s = textarea.selectionStart, en = textarea.selectionEnd;
      if (text && s !== en && /^(https?:\/\/|mailto:)\S+$/i.test(text.trim()) && !textarea.value.slice(s, en).includes('\n')) {
        /* pasting a link over selected words makes them a link */
        e.preventDefault();
        const label = textarea.value.slice(s, en);
        edit(s, en, `[${label}](${text.trim()})`, s + label.length + text.trim().length + 4);
      }
    }

    function onTextareaDrop(e) {
      const dt = e.dataTransfer;
      if (!dt || !dt.files || !dt.files.length) return;
      const images = Array.from(dt.files).filter((f) => /^image\//.test(f.type));
      if (!images.length) return;
      e.preventDefault();
      e.stopPropagation();
      textarea.focus();
      insertImageFiles(images);
    }

    function onTextareaInput() {
      ctx.markDirty();
      scheduleRender();
      scheduleStatus();
      if (!skipInputRecord && !history.isApplying()) history.record(capture(), { coalesce: true });
      refreshUndoButtons();
      if (findOpen) scheduleFindRefresh();
    }

    /* ---------------- scroll sync ---------------- */
    let syncDirty = true;
    let syncPoints = null;
    let lastPreviewSet = -1;
    let lastEditorSet = -1;

    function offsetY(offset) {
      if (!measure || !textarea) return null;
      const text = textarea.value;
      if (text.length > 1500000) {
        const lh = parseFloat(getComputedStyle(textarea).lineHeight) || 22;
        return lineAtOffset(lineStartsOf(text.slice(0, offset + 1)), offset) * lh;
      }
      measure.style.width = textarea.clientWidth + 'px';
      measure.textContent = '';
      measure.appendChild(document.createTextNode(text.slice(0, offset)));
      const mark = document.createElement('span');
      mark.textContent = '​';
      measure.appendChild(mark);
      const y = mark.offsetTop;
      measure.textContent = '';
      return y;
    }

    function buildSyncPoints() {
      syncDirty = false;
      syncPoints = null;
      if (!textarea || !measure || !blockEls.length) return;
      const text = textarea.value;
      const starts = lineStartsOf(text);
      if (text.length > 300000) {
        /* Laying out a mirror of a huge note costs more than it earns; line
           fractions of the textarea's height are close enough there. */
        const pvBase = preview.offsetTop;
        const h = textarea.scrollHeight;
        const lines = Math.max(1, starts.length);
        syncPoints = blockEls.filter((b) => b.el.isConnected).map((b) => [(b.line / lines) * h, b.el.offsetTop + pvBase]);
        return;
      }
      measure.style.width = textarea.clientWidth + 'px';
      measure.textContent = '';
      const frag = document.createDocumentFragment();
      const spans = [];
      let pos = 0;
      blockEls.forEach((b) => {
        const off = starts[b.line];
        if (off == null || off < pos) { spans.push(null); return; }
        if (off > pos) frag.appendChild(document.createTextNode(text.slice(pos, off)));
        const sp = document.createElement('span');
        frag.appendChild(sp);
        spans.push(sp);
        pos = off;
      });
      frag.appendChild(document.createTextNode(text.slice(pos) + '\n'));
      measure.appendChild(frag);
      const pvBase = preview.offsetTop;
      const pts = [];
      blockEls.forEach((b, i) => {
        const sp = spans[i];
        if (!sp || !b.el.isConnected) return;
        pts.push([sp.offsetTop, b.el.offsetTop + pvBase]);
      });
      measure.textContent = '';
      syncPoints = pts;
    }

    function mapScroll(y, from, to, maxFrom, maxTo) {
      if (maxFrom <= 0) return 0;
      if (!syncPoints || !syncPoints.length) return (y / maxFrom) * maxTo;
      const pts = [[0, 0]];
      for (const p of syncPoints) {
        const last = pts[pts.length - 1];
        if (p[from] > last[from] && p[to] >= last[to] && p[from] < maxFrom && p[to] < maxTo) {
          pts.push(p);
        }
      }
      /* points are [editorY, previewY] whichever way the map is read */
      pts.push(from === 0 ? [maxFrom, maxTo] : [maxTo, maxFrom]);
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i];
        if (y <= b[from]) {
          const span = b[from] - a[from];
          const f = span > 0 ? (y - a[from]) / span : 0;
          return a[to] + f * (b[to] - a[to]);
        }
      }
      return maxTo;
    }

    function onEditorScroll() {
      syncFindOverlayScroll();
      if (mode !== 'split' || !previewPane) return;
      if (Math.abs(textarea.scrollTop - lastEditorSet) < 2) { lastEditorSet = -1; return; }
      if (syncDirty) buildSyncPoints();
      const maxE = textarea.scrollHeight - textarea.clientHeight;
      const maxP = previewPane.scrollHeight - previewPane.clientHeight;
      const target = Math.round(mapScroll(textarea.scrollTop, 0, 1, maxE, maxP));
      if (Math.abs(previewPane.scrollTop - target) >= 1) {
        lastPreviewSet = target;
        previewPane.scrollTop = target;
      }
    }
    function onPreviewScroll() {
      if (mode !== 'split' || !textarea) return;
      if (Math.abs(previewPane.scrollTop - lastPreviewSet) < 2) { lastPreviewSet = -1; return; }
      if (syncDirty) buildSyncPoints();
      const maxE = textarea.scrollHeight - textarea.clientHeight;
      const maxP = previewPane.scrollHeight - previewPane.clientHeight;
      const target = Math.round(mapScroll(previewPane.scrollTop, 1, 0, maxP, maxE));
      if (Math.abs(textarea.scrollTop - target) >= 1) {
        lastEditorSet = target;
        textarea.scrollTop = target;
      }
    }

    /* ---------------- preview interaction ---------------- */
    function onPreviewClick(e) {
      const copy = e.target.closest('.md-code-copy');
      if (copy) {
        e.preventDefault();
        const code = copy.parentElement && copy.parentElement.querySelector('code');
        const text = code ? code.textContent.replace(/\n$/, '') : '';
        const done = () => {
          copy.classList.add('copied');
          copy.innerHTML = ICONS.check;
          setTimeout(() => { copy.classList.remove('copied'); copy.innerHTML = ICONS.copy; }, 1200);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, () => ctx.toast('Copy failed', 'error'));
        return;
      }
      const a = e.target.closest('a');
      if (!a) return;
      e.preventDefault();
      const href = a.getAttribute('href') || '';
      if (href.startsWith('#')) {
        let id = href.slice(1);
        try { id = decodeURIComponent(id); } catch {}
        const target = preview.querySelector(`[id="${CSS.escape(ID_PREFIX + id)}"]`) ||
          preview.querySelector(`[id="${CSS.escape(ID_PREFIX + slugify(id))}"]`);
        if (target) {
          target.scrollIntoView({ block: 'start', behavior: 'smooth' });
          flash(target);
        }
        return;
      }
      if (/^(https?:|mailto:)/i.test(href)) {
        window.margo.openExternal(href);
        return;
      }
      ctx.toast('Only web and mail links open from the preview');
    }

    function onPreviewChange(e) {
      const cb = e.target;
      if (!cb || !cb.classList || !cb.classList.contains('md-task')) return;
      const idx = Number(cb.dataset.task);
      const line = lastRender.taskLines[idx];
      if (line == null || line < 0 || renderedText !== textarea.value) {
        render(true);
        return;
      }
      const v = textarea.value;
      const starts = lineStartsOf(v);
      const ls = starts[line];
      if (ls == null) return;
      let le = v.indexOf('\n', ls);
      if (le === -1) le = v.length;
      const text = v.slice(ls, le);
      const m = TASK_LINE_RE.exec(text);
      if (!m) { render(true); return; }
      const at = ls + m[1].length + 1;
      const next = m[2] === ' ' ? 'x' : ' ';
      const s = textarea.selectionStart, en = textarea.selectionEnd;
      withImmediateHistory(() => {
        textarea.setRangeText(next, at, at + 1, 'preserve');
        textarea.setSelectionRange(s, en);
      });
      ctx.markDirty();
      render(true);
      scheduleStatus();
      refreshUndoButtons();
    }

    function flash(el) {
      el.classList.remove('md-flash');
      void el.offsetWidth;
      el.classList.add('md-flash');
      setTimeout(() => el.classList.remove('md-flash'), 1300);
    }

    /* ---------------- modes ---------------- */
    function setMode(m) {
      if (!['write', 'split', 'read'].includes(m) || !wrap) return;
      mode = m;
      wrap.classList.remove('mode-write', 'mode-split', 'mode-read');
      wrap.classList.add('mode-' + m);
      ctx.toolbar.querySelectorAll('.segmented button').forEach((b) =>
        b.classList.toggle('active', b.dataset.mode === m));
      ctx.toolbar.querySelectorAll('.md-fmt').forEach((b) => { b.disabled = m === 'read'; });
      if (ctx.status) ctx.status.setViewActive(m);
      if (m !== 'write') render();
      syncDirty = true;
      if (m === 'split') requestAnimationFrame(onEditorScroll);
    }

    /* ---------------- toolbar ---------------- */
    function closePopover() {
      if (!popover) return;
      const p = popover;
      popover = null;
      document.removeEventListener('mousedown', onPopoverOutside, true);
      document.removeEventListener('keydown', onPopoverKey, true);
      window.removeEventListener('blur', closePopover);
      if (p.anchor) p.anchor.classList.remove('active');
      p.el.remove();
    }
    function onPopoverOutside(e) {
      if (!popover) return;
      if (popover.el.contains(e.target) || (popover.anchor && popover.anchor.contains(e.target))) return;
      closePopover();
    }
    function onPopoverKey(e) {
      if (!popover) return;
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePopover(); textarea && textarea.focus(); return; }
      if (popover.onKey) popover.onKey(e);
    }
    function openPopover(anchor, el, onKey) {
      const wasOpenHere = popover && popover.anchor === anchor;
      closePopover();
      if (wasOpenHere) return null;
      el.classList.add('md-pop');
      document.body.appendChild(el);
      const r = anchor.getBoundingClientRect();
      const w = el.offsetWidth;
      el.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left)) + 'px';
      el.style.top = (r.bottom + 6) + 'px';
      anchor.classList.add('active');
      popover = { el, anchor, onKey };
      document.addEventListener('mousedown', onPopoverOutside, true);
      document.addEventListener('keydown', onPopoverKey, true);
      window.addEventListener('blur', closePopover);
      return el;
    }

    function openHeadingMenu(anchor) {
      const menu = document.createElement('div');
      menu.className = 'md-menu';
      menu.setAttribute('role', 'menu');
      const cur = currentHeadingLevel();
      const items = [[0, 'Normal text', '']].concat([1, 2, 3, 4, 5, 6].map((n) => [n, 'Heading ' + n, 'Ctrl+' + n]));
      items.forEach(([n, label, key]) => {
        const it = document.createElement('button');
        it.type = 'button';
        it.className = 'md-menu-item md-menu-h' + n + (cur === n ? ' current' : '');
        it.setAttribute('role', 'menuitemradio');
        it.setAttribute('aria-checked', String(cur === n));
        it.innerHTML = `<span class="md-menu-check">${cur === n ? ICONS.check : ''}</span><span class="md-menu-label">${label}</span><kbd>${key}</kbd>`;
        it.addEventListener('mousedown', (e) => e.preventDefault());
        it.addEventListener('click', () => {
          closePopover();
          if (n === 0) { if (cur) setHeading(cur); else textarea.focus(); } else setHeading(n);
        });
        menu.appendChild(it);
      });
      const buttons = () => Array.from(menu.querySelectorAll('.md-menu-item'));
      if (openPopover(anchor, menu, (e) => {
        const list = buttons();
        const i = list.indexOf(document.activeElement);
        if (e.key === 'ArrowDown') { e.preventDefault(); list[(i + 1) % list.length].focus(); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); list[(i - 1 + list.length) % list.length].focus(); }
      })) {
        const focusBtn = menu.querySelector('.current') || buttons()[0];
        if (focusBtn && anchor.matches(':focus-visible')) focusBtn.focus();
      }
    }

    function openTablePicker(anchor) {
      const ROWS = 8, COLS = 8;
      const box = document.createElement('div');
      box.className = 'md-table-picker';
      box.innerHTML = `<div class="md-table-grid" role="grid" aria-label="Table size"></div><div class="md-table-size">Insert table</div>`;
      const grid = box.querySelector('.md-table-grid');
      const label = box.querySelector('.md-table-size');
      const cells = [];
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          const cell = document.createElement('div');
          cell.className = 'md-table-cell';
          cell.dataset.r = r; cell.dataset.c = c;
          grid.appendChild(cell);
          cells.push(cell);
        }
      }
      let cur = { r: 2, c: 2 };
      const paint = () => {
        cells.forEach((cell) => cell.classList.toggle('on', +cell.dataset.r <= cur.r && +cell.dataset.c <= cur.c));
        label.textContent = `${cur.c + 1} × ${cur.r + 1} table (${cur.r} body row${cur.r === 1 ? '' : 's'})`;
      };
      grid.addEventListener('mousemove', (e) => {
        const cell = e.target.closest('.md-table-cell');
        if (!cell) return;
        cur = { r: +cell.dataset.r, c: +cell.dataset.c };
        paint();
      });
      grid.addEventListener('mousedown', (e) => e.preventDefault());
      grid.addEventListener('click', () => { closePopover(); insertTable(Math.max(1, cur.r), cur.c + 1); });
      paint();
      openPopover(anchor, box, (e) => {
        const moves = { ArrowRight: [0, 1], ArrowLeft: [0, -1], ArrowDown: [1, 0], ArrowUp: [-1, 0] };
        if (moves[e.key]) {
          e.preventDefault();
          cur = { r: Math.max(1, Math.min(ROWS - 1, cur.r + moves[e.key][0])), c: Math.max(0, Math.min(COLS - 1, cur.c + moves[e.key][1])) };
          paint();
        } else if (e.key === 'Enter') {
          e.preventDefault();
          closePopover();
          insertTable(Math.max(1, cur.r), cur.c + 1);
        }
      });
    }

    function buildToolbar() {
      const tb = ctx.toolbar;
      tb.innerHTML = '';
      tb.classList.add('md-toolbar');
      let group = null;
      const startGroup = (name) => {
        group = document.createElement('div');
        group.className = 'tb-group';
        if (name) group.setAttribute('aria-label', name);
        group.setAttribute('role', 'group');
        tb.appendChild(group);
        return group;
      };
      const sep = () => { const s = document.createElement('span'); s.className = 'tb-sep'; tb.appendChild(s); };
      const btn = (title, icon, fn, opts) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'icon-btn md-tb-btn' + (opts && opts.fmt === false ? '' : ' md-fmt');
        b.title = title;
        b.setAttribute('aria-label', title.replace(/\s*\(.*\)$/, ''));
        b.innerHTML = icon + (opts && opts.caret ? `<span class="md-tb-caret">${ICONS.chevronDown}</span>` : '');
        if (opts && opts.caret) b.classList.add('has-caret');
        b.addEventListener('mousedown', (e) => e.preventDefault());
        b.addEventListener('click', (e) => fn(e, b));
        (group || tb).appendChild(b);
        return b;
      };

      startGroup('History');
      undoBtn = btn('Undo (Ctrl+Z)', ICONS.undo, () => undo(), { fmt: false });
      redoBtn = btn('Redo (Ctrl+Y)', ICONS.redo, () => redo(), { fmt: false });
      sep();
      startGroup('Heading');
      btn('Heading (Ctrl+1 … Ctrl+6)', ICONS.heading, (_e, b) => openHeadingMenu(b), { caret: true });
      sep();
      startGroup('Text');
      btn('Bold (Ctrl+B)', ICONS.bold, () => toggleWrap('**', '**', 'bold text'));
      btn('Italic (Ctrl+I)', ICONS.italic, () => toggleWrap('*', '*', 'italic text'));
      btn('Strikethrough (Ctrl+Shift+X)', ICONS.strike, () => toggleWrap('~~', '~~', 'text'));
      btn('Inline code (Ctrl+`)', ICONS.code, () => toggleWrap('`', '`', 'code'));
      sep();
      startGroup('Insert');
      btn('Link (Ctrl+K)', ICONS.link, () => insertLink());
      btn('Image (Ctrl+Shift+I)', ICONS.image, () => insertImageDialog());
      sep();
      startGroup('Lists');
      btn('Bulleted list (Ctrl+Shift+8)', ICONS.ul, () => toggleList('ul'));
      btn('Numbered list (Ctrl+Shift+7)', ICONS.ol, () => toggleList('ol'));
      btn('Task list (Ctrl+Shift+9)', ICONS.task, () => toggleList('task'));
      btn('Quote (Ctrl+Shift+.)', ICONS.quote, () => toggleList('quote'));
      sep();
      startGroup('Blocks');
      btn('Code block (Ctrl+Shift+K)', ICONS.codeblock, () => insertCodeBlock());
      btn('Table', ICONS.table, (_e, b) => openTablePicker(b), { caret: true });
      btn('Footnote', ICONS.footnote, () => insertFootnote());
      btn('Horizontal rule', ICONS.hr, () => insertBlock('---'));

      const spacer = document.createElement('span');
      spacer.className = 'tb-spacer';
      tb.appendChild(spacer);
      group = null;

      startGroup('Tools');
      btn('Outline', ICONS.outline, () => toggleOutlineRail(), { fmt: false });
      btn('Document statistics', ICONS.stats, () => openStatsModal(), { fmt: false });
      btn('Find & replace (Ctrl+F, Ctrl+H)', ICONS.search, () => openFind(), { fmt: false });
      sep();
      const seg = document.createElement('div');
      seg.className = 'segmented md-modes';
      seg.setAttribute('role', 'group');
      seg.setAttribute('aria-label', 'View');
      [['write', 'Write', ICONS.write], ['split', 'Split', ICONS.split], ['read', 'Read', ICONS.read]].forEach(([m, label, icon]) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.dataset.mode = m;
        b.title = label;
        b.innerHTML = icon + `<span>${label}</span>`;
        b.addEventListener('click', () => setMode(m));
        seg.appendChild(b);
      });
      tb.appendChild(seg);
      refreshUndoButtons();
    }

    /* ---------------- statistics ---------------- */
    function openStatsModal() {
      if (!textarea) return;
      const text = textarea.value;
      const w = plainWordCount(text);
      const chars = text.length;
      const charsNoSpace = text.replace(/\s+/g, '').length;
      const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim().length > 0).length;
      const heads = parseMdHeadings(text).length;
      const lines = text ? text.split('\n').length : 0;
      const readMin = w ? Math.max(1, Math.round(w / 230)) : 0;
      const speakMin = w ? Math.max(1, Math.round(w / 140)) : 0;
      const card = (val, lbl) => `<div class="doc-stats-card"><span class="doc-stats-val">${val}</span><span class="doc-stats-lbl">${lbl}</span></div>`;
      const body = document.createElement('div');
      body.innerHTML =
        `<div class="doc-stats-grid">` +
          card(w.toLocaleString(), 'Words') +
          card(chars.toLocaleString(), 'Characters') +
          card(charsNoSpace.toLocaleString(), 'Characters (no spaces)') +
          card(paragraphs.toLocaleString(), 'Paragraphs') +
          card(heads.toLocaleString(), 'Headings') +
          card(lines.toLocaleString(), 'Lines') +
          card(readMin ? `~${readMin} min` : '—', 'Reading time') +
          card(speakMin ? `~${speakMin} min` : '—', 'Speaking time') +
        `</div>`;
      ctx.openModal('Document statistics', body, [{ label: 'Done', primary: true, value: true }]);
    }

    /* ---------------- outline ---------------- */
    function currentHeadings() {
      if (!textarea) return [];
      if (renderedText !== textarea.value) render(true);
      const starts = lineStartsOf(textarea.value);
      return lastRender.headings.map((h) => ({ ...h, offset: starts[h.line] || 0, tag: 'h' + h.level }));
    }

    function jumpToHeading(h) {
      if (!textarea || !h) return;
      const v = textarea.value;
      const lineEnd = v.indexOf('\n', h.offset);
      if (mode !== 'read') {
        textarea.focus();
        textarea.setSelectionRange(h.offset, lineEnd === -1 ? v.length : lineEnd);
        const y = offsetY(h.offset);
        if (y != null) {
          lastEditorSet = Math.max(0, y - 24);
          textarea.scrollTop = lastEditorSet;
        }
      }
      if (mode === 'write' || !preview) return;
      const hit = blockEls.find((b) => b.line === h.line);
      if (hit) {
        const top = hit.el.offsetTop + preview.offsetTop - 16;
        lastPreviewSet = Math.max(0, Math.round(top));
        previewPane.scrollTop = lastPreviewSet;
        flash(hit.el);
      }
    }

    function renderOutline() {
      if (!outlineRail) return;
      const list = outlineRail.querySelector('.doc-outline-list');
      const headings = currentHeadings();
      list.innerHTML = '';
      if (!headings.length) {
        list.innerHTML = '<div class="doc-outline-empty">No headings yet. Start a line with # for a heading, ## for a subheading.</div>';
        return;
      }
      const caretLine = lineAtOffset(lineStartsOf(textarea.value), textarea.selectionStart);
      let active = -1;
      headings.forEach((h, i) => { if (h.line <= caretLine) active = i; });
      headings.forEach((h, i) => {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = `doc-outline-item ${h.tag}` + (i === active ? ' active' : '');
        item.title = h.title;
        item.innerHTML = `<span class="doc-outline-tag">${h.tag.toUpperCase()}</span><span class="doc-outline-text">${escapeHtml(h.title)}</span>`;
        item.addEventListener('click', () => jumpToHeading(h));
        list.appendChild(item);
      });
    }

    function toggleOutlineRail(force) {
      if (!outlineRail) return;
      const open = force != null ? !!force : outlineRail.classList.contains('hidden');
      outlineRail.classList.toggle('hidden', !open);
      if (open) renderOutline();
      syncDirty = true;
    }

    /* ---------------- find & replace ---------------- */
    let hostEl = null;
    let findBar = null, findInput = null, replaceInput = null, findCountEl = null;
    let findOverlay = null;
    let findHits = [];
    let findIndex = -1;
    let findOpen = false;
    const findOpts = { caseSensitive: false, wholeWord: false, regex: false };
    let findError = '';

    function buildMatcher(query) {
      findError = '';
      const raw = query || '';
      const q = findOpts.regex ? raw : raw.trim();
      if (!q) return null;
      let src = findOpts.regex ? q : q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (findOpts.wholeWord) src = '(?<![\\p{L}\\p{N}_])(?:' + src + ')(?![\\p{L}\\p{N}_])';
      try {
        return new RegExp(src, 'gu' + (findOpts.caseSensitive ? '' : 'i'));
      } catch (err) {
        findError = 'Invalid pattern';
        return null;
      }
    }
    function matchAll(re, text, limit) {
      const hits = [];
      if (!re) return hits;
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(text))) {
        if (!m[0].length) { re.lastIndex++; continue; }
        hits.push({ start: m.index, end: m.index + m[0].length });
        if (limit && hits.length >= limit) break;
      }
      return hits;
    }
    function collectHits(query) {
      if (!textarea) return [];
      return matchAll(buildMatcher(query), textarea.value, 20000);
    }

    function scrollToOffset(offset) {
      const y = offsetY(offset);
      if (y == null) return;
      const target = Math.max(0, y - textarea.clientHeight / 3);
      if (y < textarea.scrollTop || y > textarea.scrollTop + textarea.clientHeight - 30) textarea.scrollTop = target;
    }

    function updateFindCount() {
      if (!findCountEl) return;
      if (findError) findCountEl.textContent = findError;
      else if (!findHits.length) findCountEl.textContent = findInput && findInput.value.trim() ? 'No results' : '';
      else findCountEl.textContent = (findIndex + 1) + ' of ' + findHits.length;
      findCountEl.classList.toggle('none', !!findError || (!findHits.length && !!(findInput && findInput.value.trim())));
    }

    function isFindFieldFocused() {
      const el = document.activeElement;
      return !!findBar && findBar.contains(el);
    }

    function syncFindOverlayScroll() {
      if (!findOverlay || !textarea || !findOpen) return;
      findOverlay.style.width = textarea.clientWidth + 'px';
      findOverlay.style.transform = `translate(${-textarea.scrollLeft}px, ${-textarea.scrollTop}px)`;
    }

    function unwrapPreviewFindMarks() {
      if (!preview) return;
      const parents = new Set();
      preview.querySelectorAll('mark.margo-find-hit').forEach((m) => {
        const parent = m.parentNode;
        if (!parent) return;
        while (m.firstChild) parent.insertBefore(m.firstChild, m);
        m.remove();
        parents.add(parent);
      });
      parents.forEach((p) => p.normalize());
    }

    function paintFindOverlay() {
      if (!findOverlay || !textarea) return;
      const stack = textarea.parentElement;
      if (!findHits.length) {
        findOverlay.innerHTML = '';
        if (stack) stack.classList.remove('find-active');
        return;
      }
      if (stack) stack.classList.add('find-active');
      const text = textarea.value;
      let html = '';
      let i = 0;
      findHits.forEach((hit, n) => {
        html += escapeHtml(text.slice(i, hit.start));
        const cls = n === findIndex ? 'margo-find-hit margo-find-current' : 'margo-find-hit';
        html += `<mark class="${cls}">` + escapeHtml(text.slice(hit.start, hit.end)) + '</mark>';
        i = hit.end;
      });
      html += escapeHtml(text.slice(i)) + '\n';
      findOverlay.innerHTML = html;
      syncFindOverlayScroll();
    }

    function paintPreviewFindHits() {
      unwrapPreviewFindMarks();
      if (!preview || !findHits.length || mode === 'write') return;
      const re = buildMatcher(findInput && findInput.value);
      if (!re) return;
      const walker = document.createTreeWalker(preview, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
          if (node.parentElement && node.parentElement.closest('.md-code-copy, .md-code-lang')) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
      });
      const textNodes = [];
      let n;
      while ((n = walker.nextNode())) textNodes.push(n);
      const marks = [];
      for (const textNode of textNodes) {
        if (marks.length > 5000) break;
        const text = textNode.nodeValue;
        const hits = matchAll(re, text);
        if (!hits.length) continue;
        const frag = document.createDocumentFragment();
        let pos = 0;
        hits.forEach((h) => {
          if (h.start > pos) frag.appendChild(document.createTextNode(text.slice(pos, h.start)));
          const mark = document.createElement('mark');
          mark.className = 'margo-find-hit';
          mark.textContent = text.slice(h.start, h.end);
          frag.appendChild(mark);
          marks.push(mark);
          pos = h.end;
        });
        if (pos < text.length) frag.appendChild(document.createTextNode(text.slice(pos)));
        textNode.parentNode.replaceChild(frag, textNode);
      }
      /* The preview's matches do not line up one-to-one with the source's
         (syntax is not shown), so the current one is picked by proportion. */
      if (marks.length) {
        const idx = findHits.length > 1 ? Math.round(findIndex * (marks.length - 1) / (findHits.length - 1)) : 0;
        const cur = marks[Math.max(0, Math.min(marks.length - 1, idx))];
        cur.classList.add('margo-find-current');
        if (mode === 'read') cur.scrollIntoView({ block: 'nearest' });
      }
    }

    function paintFindHighlights() {
      const el = document.activeElement;
      const keep = isFindFieldFocused();
      paintFindOverlay();
      paintPreviewFindHits();
      if (keep && el && el.isConnected) el.focus();
    }

    function clearFindHighlights() {
      if (findOverlay) findOverlay.innerHTML = '';
      if (textarea && textarea.parentElement) textarea.parentElement.classList.remove('find-active');
      unwrapPreviewFindMarks();
    }

    function selectHit() {
      if (findIndex < 0 || !findHits[findIndex]) {
        updateFindCount();
        paintFindHighlights();
        return;
      }
      const hit = findHits[findIndex];
      if (!isFindFieldFocused()) textarea.focus();
      textarea.setSelectionRange(hit.start, hit.end);
      scrollToOffset(hit.start);
      updateFindCount();
      paintFindHighlights();
    }

    function runFind(query) {
      findHits = collectHits(query);
      const caret = textarea ? textarea.selectionStart : 0;
      const after = findHits.findIndex((h) => h.start >= caret);
      findIndex = findHits.length ? Math.max(0, after) : -1;
      selectHit();
    }

    function findNext(dir) {
      if (!findHits.length) return;
      findIndex = (findIndex + dir + findHits.length) % findHits.length;
      selectHit();
    }

    function scheduleFindRefresh() {
      clearTimeout(findTimer);
      findTimer = setTimeout(() => {
        if (!findOpen || !findInput) return;
        findHits = collectHits(findInput.value);
        if (!findHits.length) findIndex = -1;
        else if (findIndex < 0) findIndex = 0;
        else if (findIndex >= findHits.length) findIndex = findHits.length - 1;
        updateFindCount();
        paintFindHighlights();
      }, textarea && textarea.value.length > 200000 ? 400 : 120);
    }

    function replacementFor(hitText) {
      const repl = replaceInput ? replaceInput.value : '';
      if (!findOpts.regex) return repl;
      const re = buildMatcher(findInput.value);
      if (!re) return repl;
      const single = new RegExp(re.source, re.flags.replace('g', ''));
      return hitText.replace(single, repl);
    }

    function replaceCurrent() {
      if (findIndex < 0 || !findHits[findIndex]) return;
      const hit = findHits[findIndex];
      const out = replacementFor(textarea.value.slice(hit.start, hit.end));
      withImmediateHistory(() => {
        textarea.setRangeText(out, hit.start, hit.end, 'end');
      });
      afterEdit(true);
      clearTimeout(findTimer);
      const resumeAt = hit.start + out.length;
      findHits = collectHits(findInput.value);
      if (!findHits.length) { findIndex = -1; selectHit(); return; }
      const next = findHits.findIndex((h) => h.start >= resumeAt);
      findIndex = next >= 0 ? next : 0;
      selectHit();
    }

    function replaceAll() {
      const re = buildMatcher(findInput && findInput.value);
      if (!re) return;
      const repl = replaceInput ? replaceInput.value : '';
      const v = textarea.value;
      let n = 0;
      const out = v.replace(re, (...args) => {
        n++;
        if (!findOpts.regex) return repl;
        const single = new RegExp(re.source, re.flags.replace('g', ''));
        return args[0].replace(single, repl);
      });
      if (!n) return;
      withImmediateHistory(() => {
        textarea.value = out;
        textarea.setSelectionRange(0, 0);
      });
      afterEdit(true);
      clearTimeout(findTimer);
      runFind(findInput.value);
      ctx.toast(`Replaced ${n} match${n === 1 ? '' : 'es'}`);
    }

    function closeFind() {
      findOpen = false;
      clearTimeout(findTimer);
      if (findBar) findBar.classList.add('hidden');
      findHits = [];
      findIndex = -1;
      clearFindHighlights();
      updateFindCount();
    }

    function openFind(focusReplace) {
      if (mode === 'read') setMode('split');
      ensureFindBar();
      if (!findBar) return;
      findOpen = true;
      findBar.classList.remove('hidden');
      const sel = textarea ? textarea.value.slice(textarea.selectionStart, textarea.selectionEnd) : '';
      if (sel && !sel.includes('\n') && sel.length < 200) findInput.value = sel;
      setTimeout(() => {
        const target = focusReplace ? replaceInput : findInput;
        if (target) { target.focus(); target.select(); }
      }, 30);
      if (findInput && findInput.value) runFind(findInput.value);
    }

    function ensureFindBar() {
      if (!hostEl || findBar) return;
      findBar = document.createElement('div');
      findBar.className = 'doc-find-bar md-find-bar hidden';
      findBar.setAttribute('role', 'search');
      const toggle = (key, title, icon) =>
        `<button type="button" class="icon-btn md-find-toggle" data-opt="${key}" title="${title}" aria-label="${title}" aria-pressed="false">${icon}</button>`;
      findBar.innerHTML =
        `<div class="doc-find-row">` +
          `<input type="search" class="doc-find-input" placeholder="Find" aria-label="Find" spellcheck="false">` +
          toggle('caseSensitive', 'Match case', ICONS.caseSensitive) +
          toggle('wholeWord', 'Whole word', ICONS.wholeWord) +
          toggle('regex', 'Regular expression', ICONS.regex) +
          `<span class="doc-find-count" aria-live="polite"></span>` +
          `<button type="button" class="icon-btn doc-find-prev" title="Previous match (Shift+Enter)" aria-label="Previous match">${ICONS.chevronUp}</button>` +
          `<button type="button" class="icon-btn doc-find-next" title="Next match (Enter)" aria-label="Next match">${ICONS.chevronDown}</button>` +
          `<button type="button" class="icon-btn doc-find-close" title="Close (Esc)" aria-label="Close find">${ICONS.close}</button>` +
        `</div>` +
        `<div class="doc-find-row">` +
          `<input type="text" class="doc-find-input doc-replace-input" placeholder="Replace" aria-label="Replace" spellcheck="false">` +
          `<button type="button" class="btn ghost doc-replace-btn" title="Replace this match (Enter)">Replace</button>` +
          `<button type="button" class="btn ghost doc-replace-all-btn" title="Replace every match (Ctrl+Alt+Enter)">All</button>` +
        `</div>`;
      hostEl.appendChild(findBar);
      findInput = findBar.querySelector('.doc-find-input');
      replaceInput = findBar.querySelector('.doc-replace-input');
      findCountEl = findBar.querySelector('.doc-find-count');
      findBar.querySelector('.doc-find-prev').addEventListener('click', () => findNext(-1));
      findBar.querySelector('.doc-find-next').addEventListener('click', () => findNext(1));
      findBar.querySelector('.doc-find-close').addEventListener('click', () => { closeFind(); textarea && textarea.focus(); });
      findBar.querySelector('.doc-replace-btn').addEventListener('click', replaceCurrent);
      findBar.querySelector('.doc-replace-all-btn').addEventListener('click', replaceAll);
      findBar.querySelectorAll('.md-find-toggle').forEach((b) => {
        b.addEventListener('mousedown', (e) => e.preventDefault());
        b.addEventListener('click', () => {
          const key = b.dataset.opt;
          findOpts[key] = !findOpts[key];
          b.classList.toggle('active', findOpts[key]);
          b.setAttribute('aria-pressed', String(findOpts[key]));
          runFind(findInput.value);
        });
      });
      findInput.addEventListener('input', () => runFind(findInput.value));
      findInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          findNext(e.shiftKey ? -1 : 1);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          closeFind();
          textarea && textarea.focus();
        }
      });
      replaceInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          if ((e.ctrlKey || e.metaKey) && e.altKey) replaceAll();
          else replaceCurrent();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          closeFind();
          textarea && textarea.focus();
        }
      });
    }

    function onHostKeydown(e) {
      if (e.key === 'Escape' && findOpen) {
        e.preventDefault();
        closeFind();
      }
    }

    let resizeObs = null;

    return {
      kind: 'md',
      mount(host, doc) {
        hostEl = host;
        docRef = doc;
        buildToolbar();
        host.innerHTML =
          `<aside class="doc-outline-rail md-outline hidden" aria-label="Outline">` +
            `<div class="doc-outline-head">` +
              `<span>Outline</span>` +
              `<button type="button" class="icon-btn doc-outline-close" title="Close outline" aria-label="Close outline">${ICONS.close}</button>` +
            `</div>` +
            `<div class="doc-outline-list"></div>` +
          `</aside>` +
          `<div class="md-wrap mode-split">
             <div class="md-pane md-pane-editor">
               <div class="md-input-stack">
                 <div class="md-find-overlay-clip"><pre class="md-find-overlay" aria-hidden="true"></pre></div>
                 <div class="md-measure-clip" aria-hidden="true"><pre class="md-find-overlay md-measure"></pre></div>
                 <textarea class="md-input" spellcheck="false" placeholder="# Start writing…" aria-label="Markdown source"></textarea>
               </div>
             </div>
             <div class="md-pane md-pane-preview"><article class="md-preview" aria-label="Preview"></article></div>
           </div>`;
        wrap = host.querySelector('.md-wrap');
        textarea = host.querySelector('.md-input');
        preview = host.querySelector('.md-preview');
        previewPane = host.querySelector('.md-pane-preview');
        findOverlay = host.querySelector('.md-find-overlay-clip .md-find-overlay');
        measure = host.querySelector('.md-measure');
        outlineRail = host.querySelector('.doc-outline-rail');
        textarea.value = doc.markdown || '';
        findBar = null;
        ensureFindBar();
        host.addEventListener('keydown', onHostKeydown);
        outlineRail.querySelector('.doc-outline-close').addEventListener('click', () => toggleOutlineRail(false));

        history.seed(capture());
        textarea.addEventListener('input', onTextareaInput);
        textarea.addEventListener('keydown', onTextareaKeydown);
        textarea.addEventListener('paste', onTextareaPaste);
        textarea.addEventListener('drop', onTextareaDrop);
        textarea.addEventListener('scroll', onEditorScroll);
        textarea.addEventListener('click', () => {
          if (outlineRail && !outlineRail.classList.contains('hidden')) renderOutline();
        });
        previewPane.addEventListener('scroll', onPreviewScroll);
        preview.addEventListener('click', onPreviewClick);
        preview.addEventListener('change', onPreviewChange);
        /* pictures arriving late move everything under them */
        preview.addEventListener('load', () => { syncDirty = true; }, true);
        preview.addEventListener('auxclick', (e) => { if (e.target.closest('a')) e.preventDefault(); });
        if (window.ResizeObserver) {
          resizeObs = new ResizeObserver(() => { syncDirty = true; if (findOpen) syncFindOverlayScroll(); });
          resizeObs.observe(textarea);
          resizeObs.observe(previewPane);
        }

        render(true);
        updateStatus();
        setMode('split');
        setupStatusChrome();
        wrap.addEventListener('wheel', onCtrlWheel, { passive: false });
      },
      getData() {
        let html;
        try { html = exportHtml(); } catch { html = undefined; }
        return { markdown: textarea.value, html };
      },
      /* drafts only need the text */
      getDraft() { return { markdown: textarea.value }; },
      focus() { textarea && textarea.focus(); },
      onSaved() {
        /* Save As may have moved the note, which moves relative pictures. */
        render(true);
      },
      destroy() {
        destroyed = true;
        clearTimeout(renderTimer);
        clearTimeout(statusTimer);
        clearTimeout(findTimer);
        closePopover();
        if (resizeObs) { resizeObs.disconnect(); resizeObs = null; }
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
        replace: () => openFind(true),
        paste: (t) => {
          if (!t || !textarea) return;
          textarea.focus();
          const s = textarea.selectionStart;
          edit(s, textarea.selectionEnd, t, s + t.length);
        },
        zoomIn: () => zoomBy(1.1),
        zoomOut: () => zoomBy(1 / 1.1),
        zoomReset: () => { zoom = 1; applyZoom(); },
        setZoom: (z) => setZoomLevel(z),
        outline: () => toggleOutlineRail(),
        stats: () => openStatsModal(),
        status: () => (textarea ? statusLine(countWords()) : ''),
        bold: () => toggleWrap('**', '**', 'bold text'),
        italic: () => toggleWrap('*', '*', 'italic text'),
        strikethrough: () => toggleWrap('~~', '~~', 'text'),
        heading: (n) => setHeading(n),
        list: (kind) => toggleList(kind),
        insertTable: (r, c) => insertTable(r, c),
        insertLink: () => insertLink(),
        insertImage: () => insertImageDialog()
      },
      _test: {
        textarea: () => textarea,
        preview: () => preview,
        render: () => render(true),
        key: (init) => {
          const ev = new KeyboardEvent('keydown', Object.assign({ bubbles: true, cancelable: true }, init));
          textarea.dispatchEvent(ev);
          return ev.defaultPrevented;
        },
        setText: (text, s, e) => {
          textarea.value = text;
          textarea.setSelectionRange(s == null ? text.length : s, e == null ? (s == null ? text.length : s) : e);
          onTextareaInput();
        },
        headings: () => currentHeadings(),
        syncPoints: () => { buildSyncPoints(); return syncPoints ? syncPoints.length : 0; },
        scrollEditorTo: (y) => { textarea.scrollTop = y; onEditorScroll(); return previewPane.scrollTop; },
        previewPane: () => previewPane,
        offsetY: (o) => offsetY(o),
        highlight: (code, lang) => Highlighter.highlight(code, lang)
      }
    };
  }

  window.MargoEditors = window.MargoEditors || {};
  window.MargoEditors.md = create;
})();
