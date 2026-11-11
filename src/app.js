import * as core from './core.js';
import * as api from './api.js';
import * as nav from './nav.js';
import * as sheet from './sheet.js';
import * as text from './text.js';
import * as sidebar from './sidebar.js';
import * as mouse from './mouse.js';
import { configure as configureQuality } from './quality.js';
import { $, h, toast } from './ui.js';
import { glyphSVG } from './glyphs.js';
import { Home } from './screens/home.js';
import { Detail } from './screens/detail.js';
import { Streams } from './screens/streams.js';
import { Playing } from './screens/playing.js';
import { Search } from './screens/search.js';
import { Library } from './screens/library.js';
import { Login } from './screens/login.js';

const FALLBACK = { apps: [], playback: { maxResolution: 1080 }, lite: false };
const root = document.documentElement;
const store = { get: (k) => { try { return localStorage.getItem(k); } catch (_) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (_) {} } };

/* ---------- wallpaper follows focus ---------- */
function wall(c1, c2) {
  root.style.setProperty('--c1', `color-mix(in srgb, ${c1} 62%, #05060a)`);
  root.style.setProperty('--c2', `color-mix(in srgb, ${c2} 55%, #05060a)`);
}

/* ---------- launch zoom for external apps ---------- */
let zoomEl = null, zoomTimer = 0;
function zoomOpen(app) {
  const tile = document.querySelector('.home .tile.focus .face'); if (!tile) return;
  const r = tile.getBoundingClientRect();
  const z = h('div', { class: 'zoom', style: { '--a1': app.a1, '--a2': app.a2, '--t': r.top + 'px', '--l': r.left + 'px', '--r': innerWidth - r.right + 'px', '--b': innerHeight - r.bottom + 'px' }, html: glyphSVG(app) });
  document.body.append(z); zoomEl = z;
  requestAnimationFrame(() => requestAnimationFrame(() => z.classList.add('full')));
  clearTimeout(zoomTimer); zoomTimer = setTimeout(zoomClose, 9000);   // never leave a stuck splash
}
function zoomClose() { if (!zoomEl) return; const z = zoomEl; zoomEl = null; z.classList.add('out'); setTimeout(() => z.remove(), 500); }

/* ---------- actions handed to the screens ---------- */
const A = {
  apps: [], config: FALLBACK, wall, toast,
  launch(app) { zoomOpen(app); api.post('/api/launch', { id: app.id }).then((r) => { if (r && !r.ok) { zoomClose(); toast(`Could not open ${app.name}: ${r.message || 'unknown error'}`); } }); },
  openTitle: (o) => nav.push(new Detail(A, o)),
  openStreams: (o) => nav.push(new Streams(A, o)),
  play: (o) => nav.push(new Playing(A, o)),
  go(id) {          // sidebar choice: always land on a top-level page, never stack them
    nav.popTo(nav.base());
    if (id === 'search') A.openSearch(); else if (id === 'library') A.openLibrary(); else nav.home();
  },
  openSearch: () => nav.push(new Search(A)),
  openLibrary: () => nav.push(new Library(A)),
  openLogin: () => nav.push(new Login(A, { onDone: () => { nav.pop(); } })),
  async system(id) {
    if (id === 'remote') {
      let i = {}; try { i = await api.get('/api/info'); } catch (_) {}
      return sheet.show({ title: 'Phone Remote', message: 'On your phone, on the same Wi-Fi, open', big: (i.urls && i.urls[0] || `${location.host}/remote`).replace(/^http:\/\//, ''), buttons: [{ label: 'Done' }] });
    }
    if (id === 'account') {
      const p = await core.profile();
      if (p.auth) return sheet.show({ title: 'Stremio Account', message: `Signed in as ${p.auth.user.email}`, buttons: [{ label: 'Sign Out', danger: true, run: async () => { await core.logout(); toast('Signed out'); } }, { label: 'Close' }], focus: 1 });
      return sheet.show({ title: 'Stremio Account', message: 'Sign in to sync your library and addons.', buttons: [{ label: 'Sign In', run: () => A.openLogin() }, { label: 'Close' }] });
    }
    if (id === 'quality') {
      const cur = +store.get('maxRes') || A.config.playback.maxResolution || 1080;
      const opts = [[720, '720p', 'Smoothest on older hardware'], [1080, '1080p', 'Recommended'], [2160, '4K', 'Needs a strong device']];
      return sheet.show({ title: 'Preferred Quality', message: 'Used to pick the best stream for you. You can always choose another.',
        buttons: opts.map(([v, l, d]) => ({ label: `${l}${v === cur ? '  ✓' : ''}   ·   ${d}`, run: () => { store.set('maxRes', v); toast(`Preferred quality: ${l}`); } })).concat([{ label: 'Cancel' }]), focus: opts.findIndex((o) => o[0] === cur) });
    }
    if (id === 'sleep') return api.post('/api/power', { action: 'suspend' });
    const re = id === 'restart';
    return sheet.show({ title: re ? 'Restart now?' : 'Turn off this computer?', message: re ? 'Everything will close and start fresh.' : 'You will need the power button to turn it back on.',
      buttons: [{ label: re ? 'Restart' : 'Power Off', danger: true, run: () => api.post('/api/power', { action: re ? 'reboot' : 'poweroff' }) }, { label: 'Cancel' }], focus: 1 });
  },
};
window.__app = { A, nav, core, api, sheet };   // handy for tests and debugging in the browser console

/* ---------- input ---------- */
function onKeyDown(e) {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const t = text.getTarget(), s = nav.top();
  const onField = s && s.grid && s.grid.item && s.grid.item.el.classList.contains('field');
  if (t && !sheet.isOpen() && !sidebar.isOpen() && e.key.length === 1 && (e.key !== ' ' || onField)) { e.preventDefault(); text.typed(e.key); return; }
  const handled = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', ' ', 'Escape', 'Backspace'];
  if (handled.includes(e.key)) { e.preventDefault(); nav.key(e.key); }
  else if (e.key === 'Home') { e.preventDefault(); nav.home(); }
}

/* ---------- clock / network ---------- */
const fmt = new Intl.DateTimeFormat([], { hour: 'numeric', minute: '2-digit' });
const tick = () => { $('#clock').textContent = fmt.format(new Date()); };
function setupStatus() {
  tick(); setInterval(tick, 5000);
  const net = () => $('#status').classList.toggle('offline', !navigator.onLine);
  addEventListener('online', net); addEventListener('offline', net); net();
}

/* ---------- phone-remote address popup: on boot and after waking from sleep ---------- */
let welcoming = false;
async function welcome() {
  if (welcoming || sheet.isOpen() || document.body.classList.contains('away')) return;
  welcoming = true;
  let i = {}; try { i = await api.get('/api/info'); } catch (_) {}
  const addr = ((i.urls && i.urls[0]) || `${location.host}/remote`).replace(/^http:\/\//, '');
  sheet.show({ title: 'Phone Remote', message: 'On your phone, on the same Wi-Fi, open', big: addr, buttons: [{ label: 'Continue', run: () => { welcoming = false; } }] });
  const t = setInterval(() => { if (!sheet.isOpen()) { welcoming = false; clearInterval(t); } }, 500);
}
function watchSleep() {   // a timer that suddenly jumps far ahead means the machine was suspended
  let last = Date.now();
  setInterval(() => { const n = Date.now(); if (n - last > 15000) welcome(); last = n; }, 2000);
}

/* ---------- boot ---------- */
async function boot() {
  if (location.search.includes('static')) root.classList.add('static');
  nav.setStage($('#stage'));
  sidebar.init(A.go);
  setupStatus();
  let cfg = FALLBACK; try { cfg = await api.get('/api/apps'); } catch (_) {}
  A.apps = cfg.apps; A.config = cfg; configureQuality(cfg);
  if (cfg.lite || location.search.includes('lite')) root.classList.add('lite');

  document.addEventListener('keydown', onKeyDown);
  mouse.init();
  api.onEvent('key', (e) => nav.key(e.key));
  api.onEvent('text', (e) => text.replace(e.value, e.submit));
  api.onEvent('home', () => { zoomClose(); nav.home(); });
  api.onEvent('active', (e) => { document.body.classList.toggle('away', e.active !== 'launcher'); if (e.active === 'launcher') zoomClose(); });
  addEventListener('focus', () => { if (zoomEl) setTimeout(zoomClose, 250); });
  api.connectEvents();

  await core.init();
  nav.push(new Home(A));
  core.loadBoard(10).catch(() => {});
  if (!(await core.isLoggedIn()) && !store.get('skipLogin')) A.openLogin();
  document.body.classList.add('ready');
  if (!navigator.webdriver) { welcome(); watchSleep(); }   // skipped under test automation
}

boot();
