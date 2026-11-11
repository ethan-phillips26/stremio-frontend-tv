// Text entry shared by Login and Search: a "target" receives characters from the phone remote,
// a physical keyboard, or the on-screen keyboard. The current target is published so the phone shows a text box.
import { h } from './ui.js';
import { post } from './api.js';

let target = null;
export const getTarget = () => target;
export function setTarget(t) {
  target = t;
  post('/api/ui', { text: t ? { label: t.label, secret: !!t.secret, value: t.get() } : null });
}
export function typed(s) { if (target) { target.set(target.get() + s); sync(); } }
export function backspace() { if (target && target.get()) { target.set(target.get().slice(0, -1)); sync(); return true; } return false; }
export function replace(v, submit) { if (!target) return; target.set(v); sync(); if (submit && target.onSubmit) target.onSubmit(); }
export function sync() { post('/api/ui', { text: target ? { label: target.label, secret: !!target.secret, value: target.get() } : null }); }

/** On-screen keyboard rows as Grid items. `compact` = 3 wide rows (search); otherwise 7 columns (login). */
export function keyboardRows(opts = {}) {
  let caps = false;
  const keyEls = [];
  const mk = (label, onSelect, cls = '') => {
    const el = h('div', { class: 'key ' + cls }, label);
    return { el, onSelect, label };
  };
  const letter = (ch) => { const k = mk(ch, () => typed(caps ? ch.toUpperCase() : ch)); keyEls.push([k, ch]); return k; };
  const rows = [];
  const chunk = (str, n) => str.match(new RegExp('.{1,' + n + '}', 'g'));
  if (opts.compact) {
    // tvOS-style single line: a-z, then "123" (swaps the row to digits/symbols), space, delete
    const ALPHA = 'abcdefghijklmnopqrstuvwxyz', ALT = '1234567890-_.,@&!?:;/()#+%=';
    let alt = false;
    const keys = [...ALPHA].map((_, i) => { const k = mk(ALPHA[i], () => typed(alt ? ALT[i] : ALPHA[i])); return k; });
    const swap = mk('123', () => { alt = !alt; keys.forEach((k, i) => (k.el.textContent = alt ? ALT[i] : ALPHA[i])); swap.el.textContent = alt ? 'abc' : '123'; }, 'wide');
    rows.push([swap, mk('SPACE', () => typed(' '), 'wide'), ...keys, mk('⌫', () => backspace(), 'del')]);
  } else {
    const layout = chunk('abcdefg', 7).concat(chunk('hijklmn', 7), chunk('opqrstu', 7), chunk('vwxyz@.', 7), chunk('1234567', 7), chunk('890-_+!', 7), chunk('#$%&*?/', 7));
    layout.forEach((s) => rows.push([...s].map((c) => (/[a-z]/.test(c) ? letter(c) : mk(c, () => typed(c))))));
    rows.push([
      mk('abc ⇄ ABC', () => { caps = !caps; keyEls.forEach(([k, ch]) => (k.el.textContent = caps ? ch.toUpperCase() : ch)); }, 'wide'),
      mk('space', () => typed(' '), 'wide'),
      mk('delete', () => backspace(), 'wide'),
      mk('.com', () => typed('.com'), 'wide'),
    ]);
  }
  const grid = h('div', { class: 'kbd' + (opts.compact ? ' compact' : '') });
  rows.forEach((r) => grid.append(h('div', { class: 'kbd-row' }, r.map((k) => k.el))));
  return { rows, el: grid };
}

export function fieldItem(label, t, extra = {}) {
  const val = h('span', { class: 'field-val' });
  const el = h('div', { class: 'field' }, h('span', { class: 'field-label' }, label), val);
  const render = () => {
    const v = t.get();
    val.textContent = t.secret ? '•'.repeat(v.length) : v;
    el.classList.toggle('empty', !v);
    if (!v) val.textContent = extra.placeholder || '';
  };
  const target = { label, secret: t.secret, get: t.get, set: (v) => { t.set(v); render(); }, onSubmit: t.onSubmit };
  render();
  return { el, render, target, onFocus: () => setTarget(target), onSelect: () => setTarget(target) };
}
