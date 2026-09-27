/* Margo — application menu bar (File / Edit / View / Help) and shared menu
   renderer.

   attach(el, specFn): specFn() is called every time a menu opens, so
   enabled/checked states are always fresh.
   Spec: [{ label, items: [ item | { sep:true } | { heading:'…' } ] }]
   item: { label, accel, action, enabled, checked, icon (svg string), danger,
           submenu (array or () => array) }

   Menus never take focus away from the document: keys are read from a
   capture-phase listener while a menu is open (arrows, Enter/Space, Escape,
   Home/End, Left/Right between menus and in/out of submenus), so an editor's
   selection survives opening and cancelling a menu.
   Alt+<first letter> and F10 open a menu from the keyboard.

   contextMenu(x, y, items) shows the same menu surface at the pointer and
   returns { close }. */
(function () {
  const ICON_CHECK = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m3.5 8.5 3 3 6-7"/></svg>';
  const ICON_CHEVRON = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="m6 3.5 4.5 4.5L6 12.5"/></svg>';
  const MARGIN = 6;

  function resolveItems(items) {
    return (typeof items === 'function' ? items() : items) || [];
  }

  /* Places a fixed-position menu next to an anchor rect, flipping or sliding
     it so it never leaves the window, and caps its height with a scroll. */
  function placeMenu(drop, rect, mode) {
    drop.style.position = 'fixed';
    drop.style.left = '0px';
    drop.style.top = '0px';
    drop.style.maxHeight = '';
    drop.classList.remove('scrolls');
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w = drop.offsetWidth;
    let h = drop.offsetHeight;
    let left;
    let top;
    if (mode === 'side') {
      left = rect.right - 4;
      if (left + w > vw - MARGIN) left = Math.max(MARGIN, rect.left - w + 4);
      top = rect.top - 6;
    } else if (mode === 'point') {
      left = rect.left;
      top = rect.top;
      if (left + w > vw - MARGIN) left = Math.max(MARGIN, left - w);
      if (top + h > vh - MARGIN) top = Math.max(MARGIN, top - h);
    } else {
      left = rect.left;
      top = rect.bottom + 3;
      if (left + w > vw - MARGIN) left = Math.max(MARGIN, vw - MARGIN - w);
    }
    if (h > vh - MARGIN * 2) {
      drop.style.maxHeight = (vh - MARGIN * 2) + 'px';
      drop.classList.add('scrolls');
      h = vh - MARGIN * 2;
    }
    if (top + h > vh - MARGIN) top = Math.max(MARGIN, vh - MARGIN - h);
    drop.style.left = Math.round(left) + 'px';
    drop.style.top = Math.round(top) + 'px';
  }

  /* A menu level: one dropdown element plus its keyboard highlight. Levels
     form a stack (top menu, submenu, sub-submenu...). */
  function createMenuSession(opts) {
    const levels = [];
    const onClose = opts.onClose || (() => {});
    const onSideways = opts.onSideways || null;
    let closed = false;

    function rowsOf(level) {
      return [...level.el.children].filter((c) => c.classList.contains('menu-item') && !c.classList.contains('disabled'));
    }
    function setActive(level, row) {
      level.el.querySelectorAll(':scope > .menu-item.kb-active').forEach((r) => r.classList.remove('kb-active'));
      level.active = row || null;
      if (row) {
        row.classList.add('kb-active');
        row.scrollIntoView({ block: 'nearest' });
      }
    }
    function closeFrom(depth) {
      while (levels.length > depth) {
        const lv = levels.pop();
        if (lv.parentRow) lv.parentRow.classList.remove('open-sub');
        lv.el.remove();
      }
    }
    function openSub(level, row, item, viaKeyboard) {
      const depth = levels.indexOf(level) + 1;
      closeFrom(depth);
      const items = resolveItems(item.submenu);
      const sub = document.createElement('div');
      sub.className = 'menu-drop sub';
      sub.setAttribute('role', 'menu');
      /* Kept inside its parent dropdown so the DOM mirrors the menu tree
         (and a click inside it counts as inside the menu); positioned fixed
         so the parent's scroll box never clips it. */
      level.el.appendChild(sub);
      const lv = { el: sub, active: null, parentRow: row };
      levels.push(lv);
      render(lv, items);
      row.classList.add('open-sub');
      placeMenu(sub, row.getBoundingClientRect(), 'side');
      if (viaKeyboard) setActive(lv, rowsOf(lv)[0]);
      return lv;
    }
    function activate(level, row, item, viaKeyboard) {
      if (!row || row.classList.contains('disabled')) return;
      if (item.submenu) {
        openSub(level, row, item, viaKeyboard);
        return;
      }
      close();
      if (item.action) {
        try {
          const r = item.action();
          if (r && typeof r.catch === 'function') r.catch((err) => console.error('menu action failed', err));
        } catch (err) {
          console.error('menu action failed', err);
        }
      }
    }
    function render(level, items) {
      const container = level.el;
      items.forEach((item) => {
        if (!item) return;
        if (item.sep) {
          const s = document.createElement('div');
          s.className = 'menu-sep';
          s.setAttribute('role', 'separator');
          container.appendChild(s);
          return;
        }
        if (item.heading) {
          const h = document.createElement('div');
          h.className = 'menu-heading';
          h.textContent = item.heading;
          container.appendChild(h);
          return;
        }
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'menu-item' + (item.danger ? ' danger' : '');
        row.setAttribute('role', item.checked !== undefined ? 'menuitemcheckbox' : 'menuitem');
        if (item.checked !== undefined) row.setAttribute('aria-checked', item.checked ? 'true' : 'false');
        row.tabIndex = -1;
        const enabled = item.enabled !== false;
        if (!enabled) {
          row.classList.add('disabled');
          row.setAttribute('aria-disabled', 'true');
        }

        const check = document.createElement('span');
        check.className = 'menu-check';
        if (item.checked) check.innerHTML = ICON_CHECK;
        row.appendChild(check);
        const icon = document.createElement('span');
        icon.className = 'menu-icon';
        if (item.icon) icon.innerHTML = item.icon;
        row.appendChild(icon);
        const label = document.createElement('span');
        label.className = 'menu-label';
        label.textContent = item.label;
        row.appendChild(label);

        if (item.submenu) {
          const arrow = document.createElement('span');
          arrow.className = 'menu-accel';
          arrow.innerHTML = ICON_CHEVRON;
          row.appendChild(arrow);
          row.classList.add('has-sub');
          row.setAttribute('aria-haspopup', 'menu');
        } else if (item.accel) {
          const accel = document.createElement('span');
          accel.className = 'menu-accel';
          accel.textContent = item.accel;
          row.appendChild(accel);
        }
        row.addEventListener('mousedown', (e) => e.preventDefault());
        row.addEventListener('mouseenter', () => {
          if (closed) return;
          const depth = levels.indexOf(level) + 1;
          if (item.submenu) {
            setActive(level, enabled ? row : null);
            if (enabled) {
              const existing = levels[depth];
              if (!(existing && existing.parentRow === row)) openSub(level, row, item, false);
            } else {
              closeFrom(depth);
            }
          } else {
            closeFrom(depth);
            setActive(level, enabled ? row : null);
          }
        });
        row.addEventListener('click', (e) => {
          e.stopPropagation();
          if (!enabled) return;
          activate(level, row, item, false);
        });
        row._margoItem = item;
        container.appendChild(row);
      });
    }
    function openRoot(el, items) {
      closed = false;
      const lv = { el, active: null, parentRow: null };
      levels.push(lv);
      render(lv, items);
      return lv;
    }
    function onKey(e) {
      if (closed || !levels.length) return;
      const level = levels[levels.length - 1];
      const rows = rowsOf(level);
      const idx = rows.indexOf(level.active);
      const handled = () => { e.preventDefault(); e.stopPropagation(); };
      switch (e.key) {
        case 'ArrowDown':
          handled();
          if (rows.length) setActive(level, rows[(idx + 1 + rows.length) % rows.length] || rows[0]);
          return;
        case 'ArrowUp':
          handled();
          if (rows.length) setActive(level, rows[idx <= 0 ? rows.length - 1 : idx - 1]);
          return;
        case 'Home':
          handled();
          setActive(level, rows[0]);
          return;
        case 'End':
          handled();
          setActive(level, rows[rows.length - 1]);
          return;
        case 'ArrowRight': {
          handled();
          const row = level.active;
          if (row && row._margoItem && row._margoItem.submenu) {
            openSub(level, row, row._margoItem, true);
          } else if (onSideways) {
            onSideways(1);
          }
          return;
        }
        case 'ArrowLeft':
          handled();
          if (levels.length > 1) {
            const parent = levels[levels.length - 2];
            closeFrom(levels.length - 1);
            setActive(parent, parent.active);
          } else if (onSideways) {
            onSideways(-1);
          }
          return;
        case 'Enter':
        case ' ': {
          handled();
          const row = level.active;
          if (row && row._margoItem) activate(level, row, row._margoItem, true);
          return;
        }
        case 'Escape':
          handled();
          if (levels.length > 1) {
            closeFrom(levels.length - 1);
          } else {
            close();
          }
          return;
        case 'Tab':
          handled();
          close();
          return;
        default:
          /* A plain letter jumps to the next row starting with it, the way
             native menus behave; anything with a modifier closes the menu so
             the shortcut still reaches the app. */
          if (e.ctrlKey || e.metaKey || e.altKey) {
            close();
            return;
          }
          if (e.key.length === 1 && /\S/.test(e.key)) {
            handled();
            const k = e.key.toLowerCase();
            const ordered = rows.slice(idx + 1).concat(rows.slice(0, idx + 1));
            const hit = ordered.find((r) => (r.querySelector('.menu-label').textContent || '').trim().toLowerCase().startsWith(k));
            if (hit) setActive(level, hit);
          }
      }
    }
    function close() {
      if (closed) return;
      closed = true;
      closeFrom(0);
      onClose();
    }
    return { openRoot, onKey, close, levels, setActive, rowsOf, closeFrom, isClosed: () => closed };
  }

  let activeContext = null;

  function contextMenu(x, y, items) {
    if (activeContext) activeContext.close();
    const drop = document.createElement('div');
    drop.className = 'menu-drop ctx-menu';
    drop.setAttribute('role', 'menu');
    document.body.appendChild(drop);
    const cleanup = () => {
      document.removeEventListener('mousedown', onDocDown, true);
      document.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('resize', onBlur);
      if (activeContext && activeContext.drop === drop) activeContext = null;
    };
    const session = createMenuSession({ onClose: cleanup });
    session.openRoot(drop, resolveItems(items));
    placeMenu(drop, { left: x, top: y, right: x, bottom: y }, 'point');
    function onDocDown(e) { if (!drop.contains(e.target)) session.close(); }
    function onKeyDown(e) { session.onKey(e); }
    function onBlur() { session.close(); }
    setTimeout(() => {
      if (session.isClosed()) return;
      document.addEventListener('mousedown', onDocDown, true);
      document.addEventListener('keydown', onKeyDown, true);
      window.addEventListener('blur', onBlur);
      window.addEventListener('resize', onBlur);
    }, 0);
    activeContext = { drop, close: () => session.close() };
    return activeContext;
  }

  function attach(el, specFn) {
    el.classList.add('menubar');
    el.setAttribute('role', 'menubar');
    let openIndex = -1;
    let topButtons = [];
    let session = null;
    let menus = [];

    function build() {
      closeAll();
      el.innerHTML = '';
      menus = specFn();
      topButtons = menus.map((menu, i) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'menu-top';
        b.textContent = menu.label;
        b.setAttribute('role', 'menuitem');
        b.setAttribute('aria-haspopup', 'menu');
        b.setAttribute('aria-expanded', 'false');
        b.title = `${menu.label} (Alt+${menu.label[0]})`;
        b.addEventListener('mousedown', (e) => e.preventDefault());
        b.addEventListener('click', () => (openIndex === i ? closeAll() : openMenu(i, false)));
        b.addEventListener('mouseenter', () => { if (openIndex >= 0 && openIndex !== i) openMenu(i, false); });
        el.appendChild(b);
        return b;
      });
    }

    function removeListeners() {
      document.removeEventListener('mousedown', onDocDown, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('blur', onWindowBlur);
      window.removeEventListener('resize', onWindowBlur);
    }

    function closeAll() {
      const s = session;
      session = null;
      if (s) s.close();
      openIndex = -1;
      el.querySelectorAll(':scope > .menu-drop').forEach((d) => d.remove());
      topButtons.forEach((b) => {
        b.classList.remove('open');
        b.setAttribute('aria-expanded', 'false');
      });
      removeListeners();
    }

    function onDocDown(e) {
      if (!el.contains(e.target)) closeAll();
    }
    function onKey(e) {
      if (session) session.onKey(e);
    }
    function onWindowBlur() {
      closeAll();
    }

    function openMenu(i, viaKeyboard) {
      closeAll();
      menus = specFn();
      const spec = menus[i];
      const btn = topButtons[i];
      if (!spec || !btn) return;
      openIndex = i;
      btn.classList.add('open');
      btn.setAttribute('aria-expanded', 'true');
      const drop = document.createElement('div');
      drop.className = 'menu-drop';
      drop.setAttribute('role', 'menu');
      el.appendChild(drop);
      const s = createMenuSession({
        onClose: () => {
          if (session === s) closeAll();
        },
        onSideways: (dir) => {
          const next = (i + dir + topButtons.length) % topButtons.length;
          openMenu(next, true);
        }
      });
      session = s;
      const lv = s.openRoot(drop, resolveItems(spec.items));
      placeMenu(drop, btn.getBoundingClientRect(), 'below');
      if (viaKeyboard) s.setActive(lv, s.rowsOf(lv)[0]);
      document.addEventListener('mousedown', onDocDown, true);
      document.addEventListener('keydown', onKey, true);
      window.addEventListener('blur', onWindowBlur);
      window.addEventListener('resize', onWindowBlur);
    }

    /* Alt+letter / F10 open a menu from anywhere, as a native menu bar would. */
    document.addEventListener('keydown', (e) => {
      if (session || e.defaultPrevented) return;
      if (e.key === 'F10' && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) {
        if (!topButtons.length) return;
        e.preventDefault();
        openMenu(0, true);
        return;
      }
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const letter = (e.code && /^Key[A-Z]$/.test(e.code)) ? e.code.slice(3).toLowerCase() : String(e.key || '').toLowerCase();
      if (letter.length !== 1) return;
      const i = menus.findIndex((m) => m.label && m.label[0].toLowerCase() === letter);
      if (i < 0) return;
      if (document.querySelector('.modal-backdrop:not(.hidden), .palette-backdrop:not(.hidden)')) return;
      e.preventDefault();
      openMenu(i, true);
    });

    build();
    return {
      rebuild: build,
      close: closeAll,
      open: (i) => openMenu(i, true),
      isOpen: () => openIndex >= 0
    };
  }

  window.MargoMenubar = { attach, contextMenu, placeMenu };
})();
