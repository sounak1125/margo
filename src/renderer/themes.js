/* Margo — theme registry.
   Each theme names its colour scheme (light/dark, which editors key off via
   :root[data-scheme]), the native window chrome (bg = window background while
   loading, bar/fg = the OS title-bar overlay that draws the window controls -
   bar must equal the theme's --titlebar token so the overlay blends in), and a
   small swatch set the Settings dialog paints its theme picker from.
   The CSS tokens themselves live in styles.css under :root[data-theme="…"].
   main.js keeps a copy of { bg, fg, bar } per id - a new theme needs both. */
(function () {
  const THEMES = [
    {
      id: 'light',
      label: 'Light',
      scheme: 'light',
      chrome: { bg: '#f7f7f5', fg: '#1d1c1a', bar: '#efeeea' },
      swatch: { bg: '#f7f7f5', surface: '#ffffff', text: '#1d1c1a', accent: '#f5b301' }
    },
    {
      id: 'dark',
      label: 'Dark',
      scheme: 'dark',
      chrome: { bg: '#151517', fg: '#ececef', bar: '#111113' },
      swatch: { bg: '#151517', surface: '#1f1f23', text: '#ececef', accent: '#f7c13b' }
    },
    {
      id: 'paper',
      label: 'Paper',
      scheme: 'light',
      chrome: { bg: '#f3eee4', fg: '#2b251c', bar: '#e8e0d1' },
      swatch: { bg: '#f3eee4', surface: '#fbf8f1', text: '#2b251c', accent: '#e2a50c' }
    },
    {
      id: 'rose',
      label: 'Rosé',
      scheme: 'light',
      chrome: { bg: '#faf5f4', fg: '#2a1f22', bar: '#f1e5e3' },
      swatch: { bg: '#faf5f4', surface: '#ffffff', text: '#2a1f22', accent: '#eba63b' }
    },
    {
      id: 'graphite',
      label: 'Graphite',
      scheme: 'dark',
      chrome: { bg: '#232326', fg: '#e9e9ec', bar: '#1c1c1f' },
      swatch: { bg: '#232326', surface: '#2c2c30', text: '#e9e9ec', accent: '#f5c341' }
    },
    {
      id: 'ink',
      label: 'Ink',
      scheme: 'dark',
      chrome: { bg: '#11151c', fg: '#e6ebf2', bar: '#0d1117' },
      swatch: { bg: '#11151c', surface: '#19202b', text: '#e6ebf2', accent: '#f5c341' }
    },
    {
      id: 'nord',
      label: 'Nord',
      scheme: 'dark',
      chrome: { bg: '#2e3440', fg: '#eceff4', bar: '#272c36' },
      swatch: { bg: '#2e3440', surface: '#353c4a', text: '#eceff4', accent: '#ebcb8b' }
    },
    {
      id: 'contrast',
      label: 'High contrast',
      scheme: 'dark',
      chrome: { bg: '#000000', fg: '#ffffff', bar: '#000000' },
      swatch: { bg: '#000000', surface: '#0a0a0a', text: '#ffffff', accent: '#ffd400' }
    }
  ];

  const byId = Object.create(null);
  THEMES.forEach((t) => { byId[t.id] = t; });

  function get(id) {
    return byId[id] || null;
  }

  window.MargoThemes = {
    list: THEMES,
    byId,
    get
  };
})();
