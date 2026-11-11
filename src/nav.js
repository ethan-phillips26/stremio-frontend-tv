// Screen stack + key routing. Screens: { el, grid?, onKey?(k), onBack?(), onShow?(), onHide?(), destroy?() }
import * as sheet from './sheet.js';
import * as text from './text.js';
import * as sidebar from './sidebar.js';

const stack = [];
let stage;
export const setStage = (el) => { stage = el; };
export const top = () => stack[stack.length - 1];
export const base = () => stack[0];
export const depth = () => stack.length;

export function push(s) {
  const prev = top();
  if (prev) { prev.el.classList.add('under'); prev.onHide && prev.onHide(); }
  s.el.classList.add('screen', 'enter');
  stage.append(s.el);
  stack.push(s);
  requestAnimationFrame(() => requestAnimationFrame(() => s.el.classList.remove('enter')));
  s.onShow && s.onShow();
  document.body.dataset.screen = s.name || '';
  sidebar.setCurrent(s.sidebar ? s.name : null);
  return s;
}
export function pop() {
  if (stack.length <= 1) return false;
  const s = stack.pop();
  s.el.classList.add('leave');
  s.onHide && s.onHide();
  setTimeout(() => { s.destroy && s.destroy(); s.el.remove(); }, 450);
  const t = top(); t.el.classList.remove('under'); t.onShow && t.onShow();
  document.body.dataset.screen = t.name || '';
  sidebar.setCurrent(t.sidebar ? t.name : null);
  text.setTarget(null);
  return true;
}
export function popTo(screen) { while (top() && top() !== screen && stack.length > 1) pop(); }
export function home() { sheet.isOpen() && sheet.close(); sidebar.close(); while (stack.length > 1) pop(); const t = top(); t && t.goHome && t.goHome(); }

const ARROWS = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
let moveT = 0;
export function key(k) {
  // ambient wallpaper drift pauses while the user navigates (it repaints the whole screen, which made row scrolling jitter)
  document.body.classList.add('moving'); clearTimeout(moveT); moveT = setTimeout(() => document.body.classList.remove('moving'), 1500);   // CSS pauses the wallpaper drift while you navigate
  if (sheet.isOpen()) return sheet.key(k);
  if (sidebar.isOpen()) return sidebar.key(k);
  const s = top(); if (!s) return;
  if (s.onKey && s.onKey(k)) return;
  const g = s.grid;
  if (ARROWS[k]) { if (g && !g.move(ARROWS[k])) { if (s.onEdge) s.onEdge(ARROWS[k]); else if (k === 'ArrowLeft' && s.sidebar) sidebar.open(); } }
  else if (k === 'Enter' || k === ' ') { if (g) g.select(); }
  else if (k === 'Escape' || k === 'Backspace') {
    if (k === 'Backspace' && text.getTarget() && text.backspace()) return;   // editing text beats going back
    if (!(s.onBack && s.onBack())) pop();
  }
}
