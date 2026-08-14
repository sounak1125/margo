/* Margo — theme registry (ids, labels, scheme, window chrome). */
(function () {
  const THEMES = [
    {
      id: 'light',
      label: 'Light',
      scheme: 'light',
      chrome: { bg: '#ffffff', fg: '#1d1d1f', bar: '#f7f7f5' }
    },
    {
      id: 'dark',
      label: 'Dark',
      scheme: 'dark',
      chrome: { bg: '#171719', fg: '#ededef', bar: '#1c1c1f' }
    },
    {
      id: 'paper',
      label: 'Paper',
      scheme: 'light',
      chrome: { bg: '#f4efe6', fg: '#2a241c', bar: '#ebe4d8' }
    },
    {
      id: 'graphite',
      label: 'Graphite',
      scheme: 'dark',
      chrome: { bg: '#232326', fg: '#e8e8ea', bar: '#2a2a2e' }
    },
    {
      id: 'ink',
      label: 'Ink',
      scheme: 'dark',
      chrome: { bg: '#141820', fg: '#e8ecf2', bar: '#181c24' }
    }
  ];

  const byId = Object.create(null);
  THEMES.forEach((t) => { byId[t.id] = t; });

  function isTheme(id) {
    return !!byId[id];
  }

  function get(id) {
    return byId[id] || null;
  }

  function nextId(current) {
    const i = THEMES.findIndex((t) => t.id === current);
    const idx = i < 0 ? 0 : (i + 1) % THEMES.length;
    return THEMES[idx].id;
  }

  window.MargoThemes = {
    list: THEMES,
    byId,
    isTheme,
    get,
    nextId
  };
})();
