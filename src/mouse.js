// Mouse support: hover highlights content, click selects, wheel scrolls, right/back button goes back.
// Everything routes through the same Grid/sheet/sidebar paths as the remote, so behavior stays identical.
import * as nav from './nav.js';
import * as sheet from './sheet.js';
import * as sidebar from './sidebar.js';

const root = document.documentElement;
let hideT = 0, lx = -1, ly = -1, acc = 0, accT = 0, lastWheel = 0;

function itemAt(target) {
  const s = nav.top(); const g = s && s.grid; if (!g || !target || !s.el.contains(target)) return null;
  for (let r = 0; r < g.rows.length; r++) { const row = g.rows[r]; for (let c = 0; c < row.length; c++) if (row[c].el.contains(target)) return { g, r, c }; }
  return null;
}

function moved(e) {
  const real = Math.abs(e.clientX - lx) + Math.abs(e.clientY - ly) > 2;   // ignore synthetic moves from layout shifts
  lx = e.clientX; ly = e.clientY;
  if (!real) return false;
  root.classList.add('mouse'); clearTimeout(hideT); hideT = setTimeout(() => root.classList.remove('mouse'), 3000);
  return true;
}

export function init() {
  document.addEventListener('mousemove', (e) => {
    if (!moved(e) || sheet.isOpen() || sidebar.isOpen()) return;   // hover highlights page content only
    const hit = itemAt(e.target);
    if (hit && (hit.g.pos.r !== hit.r || hit.g.pos.c !== hit.c || !hit.g.last)) hit.g.set(hit.r, hit.c);
  });
  document.addEventListener('click', (e) => {
    if (e.button !== 0) return;
    if (sheet.isOpen()) return;                       // sheet buttons have their own handlers
    if (sidebar.isOpen()) { if (!e.target.closest('.sidebar')) sidebar.close(); return; }
    const hit = itemAt(e.target); if (!hit) return;
    hit.g.set(hit.r, hit.c); hit.g.select();
  });
  document.addEventListener('contextmenu', (e) => { e.preventDefault(); nav.key('Escape'); });
  document.addEventListener('mouseup', (e) => { if (e.button === 3) { e.preventDefault(); nav.key('Escape'); } });   // mouse "back" button
  document.addEventListener('wheel', (e) => {
    e.preventDefault();
    const now = performance.now(); if (now - accT > 250) acc = 0; accT = now;
    const horiz = Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.shiftKey;
    acc += horiz ? (e.deltaX || e.deltaY) : e.deltaY;
    if (Math.abs(acc) < 40 || now - lastWheel < 140) return;
    lastWheel = now;
    const k = horiz ? (acc > 0 ? 'ArrowRight' : 'ArrowLeft') : (acc > 0 ? 'ArrowDown' : 'ArrowUp');
    acc = 0; nav.key(k);
  }, { passive: false });
}
