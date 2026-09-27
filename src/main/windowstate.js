/* Remembers the window's size, position and maximized state between launches.

   The saved rectangle is only trusted when it still lands on a display that
   exists now: a laptop undocked from the monitor Margo was last on would
   otherwise open the window somewhere off screen, with no way to drag it back.
   A rectangle that is mostly visible is nudged fully onto its display; one
   that is not is dropped for the default size, centred on the primary
   display. Fullscreen is not restored (it is a mode, not a place), but a
   window that was maximized comes back maximized, on the display it was on. */

const MIN_VISIBLE_W = 160;
const MIN_VISIBLE_H = 100;

function num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null;
}

function overlap(a, b) {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? { w, h } : { w: 0, h: 0 };
}

/* saved: what settings.json holds. displays: [{ workArea: {x,y,width,height} }].
   defaults: { width, height, minWidth, minHeight }.
   Returns { width, height, x?, y?, maximized }. */
function sanitize(saved, displays, defaults) {
  const def = { width: defaults.width, height: defaults.height, maximized: false };
  const areas = (displays || []).map((d) => d && d.workArea).filter(Boolean);
  if (!saved || typeof saved !== 'object' || !areas.length) return def;

  let width = num(saved.width);
  let height = num(saved.height);
  const x = num(saved.x);
  const y = num(saved.y);
  const maximized = saved.maximized === true;
  if (width == null || height == null) return Object.assign(def, { maximized });

  width = Math.max(defaults.minWidth || 0, width);
  height = Math.max(defaults.minHeight || 0, height);

  if (x == null || y == null) {
    return { width: Math.min(width, areas[0].width), height: Math.min(height, areas[0].height), maximized };
  }

  const rect = { x, y, width, height };
  let best = null;
  let bestArea = 0;
  for (const a of areas) {
    const o = overlap(rect, a);
    if (o.w * o.h > bestArea) { bestArea = o.w * o.h; best = { area: a, o }; }
  }
  if (!best || best.o.w < MIN_VISIBLE_W || best.o.h < MIN_VISIBLE_H) {
    return Object.assign(def, { maximized });
  }

  // Fit onto the display it mostly sits on.
  const a = best.area;
  const w = Math.min(width, a.width);
  const h = Math.min(height, a.height);
  const nx = Math.min(Math.max(x, a.x), a.x + a.width - w);
  const ny = Math.min(Math.max(y, a.y), a.y + a.height - h);
  return { x: nx, y: ny, width: w, height: h, maximized };
}

/* Wires a BrowserWindow to save its state (debounced) through `save(state)`. */
function track(win, save) {
  let timer = null;
  const capture = () => {
    if (!win || win.isDestroyed()) return;
    // getNormalBounds is the restored rectangle even while maximized, so
    // un-maximizing next launch goes back to where the author had it.
    const b = typeof win.getNormalBounds === 'function' ? win.getNormalBounds() : win.getBounds();
    save({
      x: b.x,
      y: b.y,
      width: b.width,
      height: b.height,
      maximized: win.isMaximized(),
      fullscreen: win.isFullScreen()
    });
  };
  const soon = () => {
    clearTimeout(timer);
    timer = setTimeout(capture, 400);
  };
  ['resize', 'move', 'maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen'].forEach((ev) => win.on(ev, soon));
  win.on('close', () => { clearTimeout(timer); capture(); });
  win.on('closed', () => clearTimeout(timer));
  return capture;
}

module.exports = { sanitize, track };
