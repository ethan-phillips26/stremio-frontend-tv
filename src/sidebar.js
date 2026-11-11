// tvOS-style sidebar: slides in from the left on "Left" at a screen's left edge, over a dimmed, shifted page.
// Rows: Search, Home, Library. nav.js routes keys here while it is open.
import { h, SVG } from './ui.js';

const home = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linejoin="round" stroke-linecap="round"><path d="M4 11.2 12 4.5l8 6.7V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z"/></svg>';
const ITEMS = [
  { id: 'search', label: 'Search', icon: SVG.search },
  { id: 'home', label: 'Home', icon: home },
  { id: 'library', label: 'Library', icon: SVG.library },
];

let el, rows, i = 1, current = 'home', onPick, opened = false;
export const isOpen = () => opened;

export function init(pick) {
  onPick = pick;
  rows = ITEMS.map((it, n) => h('div', { class: 'sb-item', role: 'menuitem', onclick: () => { i = n; choose(); } },
    h('span', { class: 'sb-ico', html: it.icon }), h('span', { class: 'sb-label' }, it.label)));
  el = h('nav', { class: 'sidebar', 'aria-hidden': 'true' }, h('div', { class: 'sb-list', role: 'menu' }, rows));
  document.body.append(el);
}
/** Which section the page behind is showing (highlighted when focus is elsewhere). */
export function setCurrent(id) { current = id; paint(); }
function paint() { rows.forEach((r, n) => { r.classList.toggle('focus', opened && n === i); r.classList.toggle('current', ITEMS[n].id === current); }); }

export function open() {
  if (opened) return;
  opened = true; i = Math.max(0, ITEMS.findIndex((x) => x.id === current));
  document.body.classList.add('sb-open'); el.setAttribute('aria-hidden', 'false'); paint();
}
export function close() {
  if (!opened) return;
  opened = false; document.body.classList.remove('sb-open'); el.setAttribute('aria-hidden', 'true'); paint();
}
function choose() { const id = ITEMS[i].id; close(); onPick(id); }

export function key(k) {
  if (k === 'ArrowDown') i = Math.min(ITEMS.length - 1, i + 1);
  else if (k === 'ArrowUp') i = Math.max(0, i - 1);
  else if (k === 'ArrowRight' || k === 'Escape' || k === 'Backspace') return close();
  else if (k === 'Enter' || k === ' ') return choose();
  paint();
}
