// tvOS-style alert sheet with its own focus handling. nav.js routes keys here while it is open.
import { h } from './ui.js';
const $ = (id) => document.getElementById(id);
let st = null;
export const isOpen = () => !!st;
export function show({ title, message, big, buttons, focus = 0 }) {
  const sh = $('sheet');
  $('sheetTitle').textContent = title;
  $('sheetMsg').textContent = message || '';
  $('sheetMsg').hidden = !message;
  const bigEl = $('sheetBig'); bigEl.hidden = !big; bigEl.textContent = big || '';
  const box = $('sheetButtons'); box.textContent = '';
  const btns = buttons.map((b, i) => { const el = h('div', { class: 'btn' + (b.danger ? ' danger' : ''), onclick: () => pick(i) }, b.label); box.append(el); return { el, b }; });
  st = { btns, i: focus };
  sh.hidden = false; requestAnimationFrame(() => sh.classList.add('on')); paint();
}
const paint = () => st.btns.forEach((x, i) => x.el.classList.toggle('focus', i === st.i));
function pick(i) { const s = st; close(); if (s.btns[i].b.run) s.btns[i].b.run(); }
export function close() { const sh = $('sheet'); st = null; sh.classList.remove('on'); setTimeout(() => { if (!st) sh.hidden = true; }, 350); }
export function key(k) {
  const n = st.btns.length;
  if (k === 'ArrowDown' || k === 'ArrowRight') st.i = Math.min(n - 1, st.i + 1);
  else if (k === 'ArrowUp' || k === 'ArrowLeft') st.i = Math.max(0, st.i - 1);
  else if (k === 'Enter' || k === ' ') return pick(st.i);
  else if (k === 'Escape' || k === 'Backspace') return close();
  paint();
}
