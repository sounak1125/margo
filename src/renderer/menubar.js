/* Margo — application menu bar (File / Edit / View / Help).
   attach(el, specFn): specFn() is called every time a menu opens, so
   enabled/checked states are always fresh.
   Spec: [{ label, items: [ { label, accel, action, enabled, checked, submenu } | { sep:true } ] }] */
(function () {
  function attach(el, specFn) {
    el.classList.add('menubar');
    let openIndex = -1;
    let topButtons = [];

    function build() {
      el.innerHTML = '';
      topButtons = specFn().map((menu, i) => {
        const b = document.createElement('button');
        b.className = 'menu-top';
        b.textContent = menu.label;
        b.addEventListener('mousedown', (e) => e.preventDefault());
        b.addEventListener('click', () => (openIndex === i ? closeAll() : openMenu(i)));
        b.addEventListener('mouseenter', () => { if (openIndex >= 0 && openIndex !== i) openMenu(i); });
        el.appendChild(b);
        return b;
      });
    }

    function closeAll() {
      openIndex = -1;
      el.querySelectorAll('.menu-drop').forEach((d) => d.remove());
      topButtons.forEach((b) => b.classList.remove('open'));
      document.removeEventListener('mousedown', onDocDown, true);
      document.removeEventListener('keydown', onKey, true);
    }

    function onDocDown(e) {
      if (!el.contains(e.target)) closeAll();
    }
    function onKey(e) {
      if (e.key === 'Escape') { e.stopPropagation(); closeAll(); }
    }

    function renderItems(items, container) {
      items.forEach((item) => {
        if (item.sep) {
          const s = document.createElement('div');
          s.className = 'menu-sep';
          container.appendChild(s);
          return;
        }
        const row = document.createElement('button');
        row.className = 'menu-item';
        const enabled = item.enabled !== false;
        if (!enabled) row.classList.add('disabled');

        const check = document.createElement('span');
        check.className = 'menu-check';
        check.textContent = item.checked ? '✓' : '';
        const label = document.createElement('span');
        label.className = 'menu-label';
        label.textContent = item.label;
        row.appendChild(check);
        row.appendChild(label);

        if (item.submenu) {
          const arrow = document.createElement('span');
          arrow.className = 'menu-accel';
          arrow.textContent = '›';
          row.appendChild(arrow);
          row.classList.add('has-sub');
          let sub = null;
          row.addEventListener('mouseenter', () => {
            container.querySelectorAll('.menu-drop.sub').forEach((d) => d.remove());
            if (!enabled) return;
            sub = document.createElement('div');
            sub.className = 'menu-drop sub';
            renderItems(typeof item.submenu === 'function' ? item.submenu() : item.submenu, sub);
            sub.style.left = container.offsetWidth - 6 + 'px';
            sub.style.top = row.offsetTop - 6 + 'px';
            container.appendChild(sub);
          });
        } else {
          if (item.accel) {
            const accel = document.createElement('span');
            accel.className = 'menu-accel';
            accel.textContent = item.accel;
            row.appendChild(accel);
          }
          row.addEventListener('mouseenter', () => {
            container.querySelectorAll('.menu-drop.sub').forEach((d) => d.remove());
          });
          if (enabled && item.action) {
            row.addEventListener('click', () => { closeAll(); item.action(); });
          }
        }
        container.appendChild(row);
      });
    }

    function openMenu(i) {
      closeAll();
      openIndex = i;
      const spec = specFn()[i];
      const btn = topButtons[i];
      if (!spec || !btn) return;
      btn.classList.add('open');
      const drop = document.createElement('div');
      drop.className = 'menu-drop';
      drop.style.left = btn.offsetLeft + 'px';
      renderItems(spec.items, drop);
      el.appendChild(drop);
      document.addEventListener('mousedown', onDocDown, true);
      document.addEventListener('keydown', onKey, true);
    }

    build();
    return { rebuild: build, close: closeAll };
  }

  window.MargoMenubar = { attach };
})();
