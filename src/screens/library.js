import { h, clear } from '../ui.js';
import { Grid } from '../focus.js';
import { posterTile } from '../tiles.js';
import * as core from '../core.js';

const COLS = 7;
export class Library {
  constructor(a) {
    this.name = 'library'; this.sidebar = true; this.a = a; this.type = null; this.items = [];
    this.seg = h('div', { class: 'seg lib-seg' });
    this.gridEl = h('div', { class: 'lib-grid' });
    this.empty = h('div', { class: 's-hint' }, '');
    this.scroller = h('div', { class: 's-scroll' }, h('h1', { class: 'lib-h' }, 'Library'), this.seg, this.empty, this.gridEl);
    this.el = h('div', { class: 'library' }, this.scroller);
    this.chips = [[null, 'All'], ['movie', 'Movies'], ['series', 'Series']].map(([t, label]) => ({ el: h('div', { class: 'chip' }, label), type: t,
      onSelect: () => { this.type = t; this.load(); } }));
    this.chips.forEach((c) => this.seg.append(c.el));
    this.grid = new Grid([], { onFocus: (it, r) => this.focused(it, r) });
    this.off = core.on('library', () => { clearTimeout(this.t); this.t = setTimeout(() => this.render(), 150); });
    this.load();
  }
  async load() {
    this.empty.hidden = false; this.empty.textContent = 'Loading…';
    await core.loadLibrary(this.type, 'lastwatched');
    await core.sleep(250);
    await this.render();
  }
  async render() {
    const lib = await core.library();
    this.items = lib.catalog || [];
    const sig = JSON.stringify([this.type, this.items.map((it) => [it._id, it.removed, it.state && Math.floor((it.state.timeOffset || 0) / 30000), it.state && it.state.video_id])]);
    if (sig === this._sig) { this.chips.forEach((c) => c.el.classList.toggle('sel', c.type === this.type)); return; }   // same list: leave the screen alone
    this._sig = sig;
    this.chips.forEach((c) => c.el.classList.toggle('sel', c.type === this.type));
    clear(this.gridEl);
    const rows = [];
    for (let i = 0; i < this.items.length; i += COLS) {
      const rowEl = h('div', { class: 'row row-poster lib-row' });
      rows.push(this.items.slice(i, i + COLS).map((it) => {
        const el = posterTile(it, { progress: it.state && it.state.duration > 0 ? (it.state.timeOffset / it.state.duration) * 100 : 0 });
        rowEl.append(el);
        return { el, item: it, rowEl, onSelect: () => this.a.openTitle({ type: it.type, id: it._id, videoId: it.state && it.state.video_id, preview: it }) };
      }));
      this.gridEl.append(rowEl);
    }
    this.empty.hidden = this.items.length > 0;
    if (!this.items.length) this.empty.textContent = 'Nothing here yet. Add a title to your library from its page, or start watching something.';
    const keep = this.grid.pos;
    this.grid.clearFocus(); this.grid.rows = [this.chips, ...rows];
    this.grid.set(Math.min(keep.r, this.grid.rows.length - 1), keep.c, true);
  }
  focused(it, r) {
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
    const y = r === 0 ? 0 : it.rowEl.offsetTop - 18 * rem;
    this.scroller.style.transform = `translate3d(0,${-Math.max(0, y)}px,0)`;
    if (it.item && r >= this.grid.rows.length - 2 && this.items.length >= 20 && this._nextFor !== this.items.length && (this._nextFor = this.items.length)) core.dispatch({ action: 'LibraryWithFilters', args: { action: 'LoadNextPage' } }, 'library').catch(() => {});
  }
  onShow() { this.a.wall('#0f6f6a', '#0a1f2a'); }
  destroy() { this.off(); }
}
