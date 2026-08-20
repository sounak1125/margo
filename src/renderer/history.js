/* Margo — shared document undo/redo (snapshot timeline).
   record() stores the state AFTER a mutation. seed() sets the baseline
   on mount so the first undo returns to the loaded document. */
(function () {
  function clone(value) {
    if (value == null || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(clone);

    /* Word snapshot: html is an immutable string; avoid JSON round-trip of MB payloads. */
    if (typeof value.html === 'string') {
      return {
        html: value.html,
        notes: Array.isArray(value.notes) ? value.notes.map((n) => ({ ...n })) : value.notes,
        layout: value.layout ? { ...value.layout } : value.layout
      };
    }

    /* Markdown snapshot */
    if (typeof value.text === 'string' && 'start' in value && 'end' in value) {
      return { text: value.text, start: value.start, end: value.end };
    }

    /* Sheet snapshot — nested grid still needs a deep clone */
    if (Array.isArray(value.sheets)) {
      return {
        sheets: JSON.parse(JSON.stringify(value.sheets)),
        active: value.active,
        sel: value.sel ? { ...value.sel } : value.sel,
        selEnd: value.selEnd ? { ...value.selEnd } : value.selEnd,
        autoFilterActive: value.autoFilterActive
      };
    }

    return JSON.parse(JSON.stringify(value));
  }

  function create(opts) {
    const limit = (opts && opts.limit) || 80;
    const coalesceMs = (opts && opts.coalesceMs) || 400;
    let stack = [];
    let index = -1;
    let applying = false;
    let lastAt = 0;
    let coalesceOpen = false;

    function seed(snapshot) {
      stack = [clone(snapshot)];
      index = 0;
      applying = false;
      lastAt = 0;
      coalesceOpen = false;
    }

    function record(snapshot, recOpts) {
      if (applying) return;
      const snap = clone(snapshot);
      const coalesce = !!(recOpts && recOpts.coalesce);
      const now = Date.now();
      if (coalesce && coalesceOpen && index >= 0 && (now - lastAt) < coalesceMs) {
        stack[index] = snap;
        lastAt = now;
        return;
      }
      stack = stack.slice(0, index + 1);
      stack.push(snap);
      if (stack.length > limit) stack.shift();
      index = stack.length - 1;
      lastAt = now;
      coalesceOpen = coalesce;
    }

    function undo(apply) {
      if (index <= 0) return false;
      applying = true;
      coalesceOpen = false;
      try {
        index -= 1;
        apply(clone(stack[index]));
      } finally {
        applying = false;
      }
      return true;
    }

    function redo(apply) {
      if (index >= stack.length - 1) return false;
      applying = true;
      coalesceOpen = false;
      try {
        index += 1;
        apply(clone(stack[index]));
      } finally {
        applying = false;
      }
      return true;
    }

    return {
      seed,
      record,
      undo,
      redo,
      canUndo: () => index > 0,
      canRedo: () => index >= 0 && index < stack.length - 1,
      isApplying: () => applying
    };
  }

  window.MargoHistory = { create };
})();
