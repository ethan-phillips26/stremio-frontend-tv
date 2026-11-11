// Directional focus over rows of items. Screens own one Grid; the app routes arrow keys to the top screen.
export class Grid {
  /** rows: Item[][]; Item = { el, onSelect?, onFocus?, data? } */
  constructor(rows = [], { onFocus, aim } = {}) { this.rows = rows; this.pos = { r: 0, c: 0 }; this.onFocus = onFocus; this.aim = aim; this.last = null; }
  get item() { const row = this.rows[this.pos.r]; return row && row[this.pos.c]; }
  setRows(rows, keep = false) {
    const old = this.pos;
    this.clearFocus();
    this.rows = rows.filter((r) => r.length);
    this.pos = keep ? { r: Math.min(old.r, Math.max(0, this.rows.length - 1)), c: old.c } : { r: 0, c: 0 };
    const row = this.rows[this.pos.r]; if (row) this.pos.c = Math.min(this.pos.c, row.length - 1);
    this.set(this.pos.r, this.pos.c, true);
  }
  set(r, c, silent) {
    if (this.last) this.last.el.classList.remove('focus');
    if (!this.rows[r] || !this.rows[r][c]) { this.last = null; return; }
    this.pos = { r, c };
    const it = this.rows[r][c];
    it.el.classList.add('focus'); this.last = it;
    if (!silent || true) { if (this.onFocus) this.onFocus(it, r, c); if (it.onFocus) it.onFocus(it, r, c); }
  }
  move(dir) {
    let { r, c } = this.pos; const rows = this.rows;
    if (!rows.length) return false;
    if (dir === 'left') { if (c === 0) return false; c--; }
    else if (dir === 'right') { if (c >= rows[r].length - 1) return false; c++; }
    else {
      const nr = dir === 'down' ? r + 1 : r - 1;
      if (nr < 0 || nr >= rows.length) return false;
      // keep roughly the same horizontal position
      const cur = this.item && this.item.el.getBoundingClientRect();
      const cx = cur ? cur.left + cur.width / 2 : 0;
      let best = 0, bd = Infinity;
      const aimed = this.aim && this.aim(dir, nr, this.item);       // optional: screen decides the landing column
      if (aimed != null) { this.set(nr, Math.max(0, Math.min(aimed, rows[nr].length - 1))); return true; }
      rows[nr].forEach((it, i) => { const b = it.el.getBoundingClientRect(); const d = Math.abs(b.left + b.width / 2 - cx); if (d < bd) { bd = d; best = i; } });
      r = nr; c = best;
    }
    this.set(r, c);
    return true;
  }
  /** Call before swapping `rows`: removes the focus ring from the previously focused item. */
  clearFocus() { if (this.last) this.last.el.classList.remove('focus'); this.last = null; }
  select() { const it = this.item; if (it && it.onSelect) { it.onSelect(it); return true; } return false; }
}

/**
 * Keep the focused item on screen in a horizontally scrolling row, moving the row only when needed (like tvOS):
 * scroll right so the item rests at the right margin, scroll left so it rests at the left margin, otherwise stay put.
 * Positions come from layout (offsetLeft) and the row's CURRENT transform, never from the item's animating rect, so
 * fast key repeat (hold Right) can't feed a half-animated measurement back into the next target.
 */
export function keepVisible(rowEl, itemEl, pad) {
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
  const margin = pad ?? rem * 9.6;
  const t = getComputedStyle(rowEl).transform;
  const cur = t && t !== 'none' ? new DOMMatrixReadOnly(t).m41 : 0;           // where the row is right now, mid-animation or not
  const x0 = rowEl.getBoundingClientRect().left - cur;                         // the row's untransformed left edge
  const left = x0 + itemEl.offsetLeft, right = left + itemEl.offsetWidth;
  let tx = rowEl.__tx || 0;
  if (right + tx > window.innerWidth - margin) tx = window.innerWidth - margin - right;
  else if (left + tx < margin) tx = margin - left;
  tx = Math.min(0, tx);
  if (tx === rowEl.__tx) return;
  rowEl.__tx = tx;
  rowEl.style.transform = `translate3d(${tx}px,0,0)`;
}
