/* Margo — theme registry (ids, labels, scheme, window chrome). */
(function () {
  const THEMES = [
    {
      id: 'light',
      label: 'Light',
      scheme: 'light',
      chrome: { bg: '#fafafa', fg: '#19191b', bar: '#f4f4f3' }
    },
    {
      id: 'dark',
      label: 'Dark',
      scheme: 'dark',
      chrome: { bg: '#161618', fg: '#ededef', bar: '#1b1b1e' }
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
      chrome: { bg: '#222225', fg: '#e8e8ea', bar: '#27272b' }
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
