'use strict';

const SEARCH_ENGINES = {
  ddg: 'https://duckduckgo.com/?q=%s',
  brave: 'https://search.brave.com/search?q=%s',
  startpage: 'https://www.startpage.com/sp/search?query=%s',
  google: 'https://www.google.com/search?q=%s',
  bing: 'https://www.bing.com/search?q=%s',
};

const THEMES = {
  purple: '#8f7bff',
  blue: '#5b9dff',
  teal: '#3fcfc0',
  green: '#5fd17a',
  orange: '#ff9d4d',
  pink: '#ff7ab8',
};

const SHORTCUTS = [
  ['DuckDuckGo', 'https://duckduckgo.com/'],
  ['Wikipedia', 'https://en.wikipedia.org/'],
  ['Reddit', 'https://www.reddit.com/'],
  ['GitHub', 'https://github.com/'],
  ['BBC News', 'https://www.bbc.com/news'],
  ['Maps', 'https://www.openstreetmap.org/'],
];

const $ = (id) => document.getElementById(id);
const home = $('home');
const browser = $('browser');
const frame = $('frame');
const statusEl = $('status');

// ---------- settings (kept in this browser only) ----------
const settings = { search: 'ddg', theme: 'purple', ads: true };
try {
  Object.assign(settings, JSON.parse(localStorage.getItem('cfg') || '{}'));
} catch { /* storage unavailable: use defaults */ }
if (!SEARCH_ENGINES[settings.search]) settings.search = 'ddg';
if (!THEMES[settings.theme]) settings.theme = 'purple';

function saveSettings() {
  try { localStorage.setItem('cfg', JSON.stringify(settings)); } catch { /* ignore */ }
}

function applyTheme() {
  document.documentElement.style.setProperty('--accent', THEMES[settings.theme]);
  for (const b of $('set-theme').children) {
    b.setAttribute('aria-checked', String(b.dataset.theme === settings.theme));
  }
}

function setStatus(text, bad) {
  statusEl.textContent = text;
  statusEl.classList.toggle('bad', !!bad);
}
