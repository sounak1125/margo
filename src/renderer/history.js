/* Margo — shared document undo/redo (snapshot timeline).
   record() stores the state AFTER a mutation. seed() sets the baseline
   on mount so the first undo returns to the loaded document. */
(function () {
  /* Deep copy for nested data (sheet grids, notes, layout). structuredClone
     keeps what JSON drops (undefined, Dates, NaN); JSON is the fallback for
     anything it refuses. */
  function deepCopy(v) {
    try {
      if (typeof structuredClone === 'function') return structuredClone(v);
    } catch {}
    return JSON.parse(JSON.stringify(v));
  }

  /* Snapshots are plain objects. Top-level strings (a Word page's html can
     run to megabytes) are immutable and shared rather than copied; anything
     nested is copied so a later edit cannot reach back into history.
     This used to whitelist the keys of each editor's snapshot and silently
     drop the rest - so a field an editor added to its snapshot (a filter, a
     comment list, a header) was never restored by undo. */
  function clone(value) {
    if (value == null || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(clone);
    const out = {};
    Object.keys(value).forEach((k) => {
      const v = value[k];
      out[k] = v == null || typeof v !== 'object' ? v : deepCopy(v);
    });
    return out;
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
      const from = index;
      try {
        index -= 1;
        apply(clone(stack[index]));
      } catch (err) {
        /* A snapshot that fails to apply leaves the document where it was,
           so the timeline stays where it was too. */
        index = from;
        throw err;
      } finally {
        applying = false;
      }
      return true;
    }

    function redo(apply) {
      if (index >= stack.length - 1) return false;
      applying = true;
      coalesceOpen = false;
      const from = index;
      try {
        index += 1;
        apply(clone(stack[index]));
      } catch (err) {
        index = from;
        throw err;
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
