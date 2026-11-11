// Original app glyphs (no third-party artwork). An app can also set "icon": "/path.png" in config to use real art.
export const GLYPHS = {
  stremio: () => `<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="38" fill="none" stroke="#fff" stroke-opacity=".38" stroke-width="5"/><path d="M40 30 72 50 40 70Z" fill="#fff" stroke="#fff" stroke-width="9" stroke-linejoin="round"/></svg>`,
  search: () => `<svg viewBox="0 0 100 100" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round"><circle cx="43" cy="43" r="26"/><path d="M63 63L84 84"/></svg>`,
  library: () => `<svg viewBox="0 0 100 100" fill="none" stroke="#fff" stroke-width="6" stroke-linejoin="round" stroke-linecap="round"><rect x="16" y="20" width="20" height="60" rx="4"/><rect x="42" y="20" width="20" height="60" rx="4"/><path d="M69 24l17 4.5-13 49-17-4.5z"/></svg>`,
  phone: () => `<svg viewBox="0 0 100 100" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"><rect x="31" y="12" width="38" height="76" rx="9"/><circle cx="50" cy="52" r="10"/><path d="M45 25h10"/></svg>`,
  user: () => `<svg viewBox="0 0 100 100" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round"><circle cx="50" cy="34" r="16"/><path d="M20 84c3-18 15-27 30-27s27 9 30 27"/></svg>`,
  quality: () => `<svg viewBox="0 0 100 100" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"><rect x="12" y="24" width="76" height="52" rx="9"/><path d="M28 56V44M28 50h12M40 56V44M56 56V44l12 12V44"/></svg>`,
  moon: () => `<svg viewBox="0 0 100 100" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"><path d="M64 16a36 36 0 1 0 22 56A30 30 0 0 1 64 16Z"/></svg>`,
  restart: () => `<svg viewBox="0 0 100 100" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"><path d="M76 34A30 30 0 1 0 80 56"/><path d="M78 14v22H56"/></svg>`,
  power: () => `<svg viewBox="0 0 100 100" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"><path d="M50 14v34"/><path d="M30 28a34 34 0 1 0 40 0"/></svg>`,
  letter: (c, a) => `<svg viewBox="0 0 100 100"><text x="50" y="70" text-anchor="middle" font-size="64" font-weight="700" fill="#fff" font-family="inherit">${((a && a.name) || '?')[0].toUpperCase()}</text></svg>`,
};
export const glyphSVG = (app) => (GLYPHS[app.glyph] || GLYPHS.letter)(app.a2 || '#333', app);
