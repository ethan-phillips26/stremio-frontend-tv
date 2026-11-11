import { h, clear, huePair } from '../ui.js';
import { Grid, keepVisible } from '../focus.js';
import { wideTile } from '../tiles.js';
import * as core from '../core.js';
import * as text from '../text.js';

export class Search {
  constructor(a) {
    this.name = 'search'; this.sidebar = true; this.a = a; this.q = ''; this.ticket = 0;
    this.field = text.fieldItem('Search', { get: () => this.q, set: (v) => this.setQuery(v), onSubmit: () => this.run(this.q) }, { placeholder: 'Shows, Movies, and More' });
    this.kb = text.keyboardRows({ compact: true });
    this.filter = 'all'; this.cats = [];
    const SCOPES = [['all', 'All'], ['movie', 'Movies'], ['series', 'TV Shows']];
    this.scopeItems = SCOPES.map(([id, label]) => ({ id, el: h('div', { class: 'scope' + (id === 'all' ? ' on' : '') }, label), onSelect: () => this.setFilter(id) }));
    this.scope = h('div', { class: 's-scope' }, h('span', { class: 's-scope-l' }, 'Search In:'), this.scopeItems.map((x) => x.el));
    this.top = h('div', { class: 's-top' }, this.field.el, this.kb.el, this.scope);
    this.res = h('div', { class: 's-res' });
    this.hint = h('div', { class: 's-hint' }, 'Type on your phone, a keyboard, or the on-screen keys.');
    this.scroller = h('div', { class: 's-scroll' }, this.top, this.hint, this.res);
    this.el = h('div', { class: 'search' }, this.scroller);
    this.resRows = [];
    this.grid = new Grid([], { onFocus: (it, r) => this.focused(it, r), aim: (dir, nr, from) => (dir === 'down' && from && from.el.classList.contains('field') ? 2 : undefined) });
    this.layout();
    this.off = core.on('board', () => { if (this.browsing) this.browse(); });
    this.browse();
  }
  layout() { this.grid.clearFocus(); this.grid.rows = [[this.field], ...this.kb.rows, this.scopeItems, ...this.resRows]; this.grid.set(Math.min(this.grid.pos.r, this.grid.rows.length - 1), this.grid.pos.c, true); }
  onShow() { this.a.wall('#2a2c33', '#111216'); text.setTarget(this.field.target); this.grid.set(this.grid.pos.r, this.grid.pos.c); }
  setQuery(v) {
    this.q = v;
    this.field.render();
    clearTimeout(this.timer); this.timer = setTimeout(() => this.run(this.q.trim()), 500);
  }
  async run(q) {
    const t = ++this.ticket;
    if (q.length < 2) { await this.browse(t); return; }
    this.browsing = false;
    this.hint.hidden = false; this.hint.textContent = 'Searching…';
    await core.search(q);
    let st;
    for (let i = 0; i < 24; i++) {
      st = await core.searchState();
      if (t !== this.ticket) return;
      const cats = st.catalogs || [];
      if (cats.length && cats.every((c) => c.content && c.content.type !== 'Loading')) break;
      await core.sleep(350);
    }
    if (t !== this.ticket) return;
    this.cats = st.catalogs || []; this.q2 = q;
    this.renderResults();
  }
  /** Nothing typed yet: show what's popular in Movies and TV Shows (the board catalogs), like tvOS does. */
  async browse(t) {
    this.browsing = true;
    let b = null; try { b = await core.board(); } catch (_) {}
    if (t !== undefined && t !== this.ticket) return;
    this.cats = (b && b.catalogs) || []; this.q2 = '';
    this.hint.textContent = 'Loading…'; this.hint.hidden = this.cats.length > 0;
    this.renderResults();
    if (!this.resRows.length) { this.hint.hidden = false; this.hint.textContent = 'Type on your phone, a keyboard, or the on-screen keys.'; }
  }
  setFilter(id) {
    this.filter = id;
    this.scopeItems.forEach((x) => x.el.classList.toggle('on', x.id === id));
    if (this.cats.length) this.renderResults();
  }
  renderResults() {
    clear(this.res); this.resRows = [];
    const byType = { movie: [], series: [] }, seen = new Set();
    for (const c of this.cats) {                      // several catalogs per type: merge, drop duplicates
      if (!c.content || c.content.type !== 'Ready' || !byType[c.type]) continue;
      for (const it of c.content.content) if (!seen.has(c.type + it.id)) { seen.add(c.type + it.id); byType[c.type].push(it); }
    }
    for (const type of ['movie', 'series']) {
      if (this.filter !== 'all' && type !== this.filter) continue;
      if (!byType[type].length) continue;
      const rowEl = h('div', { class: 'row row-wide' });
      const items = byType[type].slice(0, 30).map((it) => { const el = wideTile(it); rowEl.append(el); return { el, rowEl, kind: 'poster', item: it, onSelect: () => this.a.openTitle({ type: it.type, id: it.id, preview: it }) }; });
      this.res.append(h('section', { class: 'section' }, h('h2', { class: 'row-title' }, (this.browsing ? 'Popular ' : '') + (type === 'movie' ? 'Movies' : 'TV Shows')), rowEl));
      this.resRows.push(items);
    }
    this.hint.hidden = this.resRows.length > 0;
    if (!this.resRows.length && !this.browsing) this.hint.textContent = `No results for “${this.q2}”.`;
    this.layout();
  }
  focused(it, r) {
    const first = 2 + this.kb.rows.length;
    const inRes = r >= first;
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
    const shift = inRes ? this.top.offsetHeight + this.top.offsetTop - 14 * rem + (r - first) * 0 : 0;
    this.scroller.style.transform = `translate3d(0,${-Math.max(0, shift)}px,0)`;
    if (inRes) keepVisible(it.rowEl, it.el);
    if (inRes && it.item) this.a.wall(...huePair(it.item.id));
  }
  destroy() { text.setTarget(null); this.off && this.off(); }
}
