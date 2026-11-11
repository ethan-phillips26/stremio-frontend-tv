import { h, clear, huePair } from '../ui.js';
import { Grid, keepVisible } from '../focus.js';
import { appTile, posterTile, Shelf } from '../tiles.js';
import { glyphSVG } from '../glyphs.js';
import * as core from '../core.js';

const SYSTEM = [
  { id: 'remote', name: 'Phone Remote', glyph: 'phone' },
  { id: 'account', name: 'Account', glyph: 'user' },
  { id: 'quality', name: 'Quality', glyph: 'quality' },
  { id: 'sleep', name: 'Sleep', glyph: 'moon' },
  { id: 'restart', name: 'Restart', glyph: 'restart' },
  { id: 'poweroff', name: 'Power Off', glyph: 'power' },
];

/** Shelf info for a catalog preview / library item. Artwork URLs for imdb ids are deterministic on metahub. */
export function titleInfo(it) {
  const id = it._id || it.id;
  const imdb = /^tt\d+/.test(id || '') ? String(id).split(':')[0] : null;
  const links = it.links || [];
  const rating = (links.find((l) => l.category === 'imdb') || {}).name;
  const genres = links.filter((l) => l.category === 'Genres').slice(0, 2).map((l) => l.name).join(', ');
  return {
    id, title: it.name, desc: it.description, colors: huePair(id),
    bg: it.background || (imdb && `https://images.metahub.space/background/medium/${imdb}/img`),
    logo: it.logo || (imdb && `https://images.metahub.space/logo/medium/${imdb}/img`),
    meta: [it.releaseInfo || (it.released && String(it.released).slice(0, 4)), it.runtime, rating && '★ ' + rating, genres],
  };
}
const episodeLabel = (videoId) => { const m = /:(\d+):(\d+)$/.exec(videoId || ''); return m ? `Season ${m[1]}  ·  Episode ${m[2]}` : ''; };

export class Home {
  constructor(a) {
    this.name = 'home'; this.sidebar = true; this.a = a;
    this.shelfEl = h('section', { class: 'shelf', 'aria-hidden': 'true' });
    this.inner = h('div', { class: 'rows-inner' });
    this.loading = h('div', { class: 'home-loading' }, 'Loading…');
    this.el = h('div', { class: 'home' }, this.shelfEl, h('main', { class: 'rows' }, this.inner), this.loading);
    this.shelf = new Shelf(this.shelfEl);
    this.grid = new Grid([], { onFocus: (it, r, c) => this.focused(it, r, c) });
    this.sections = [];
    this.pending = 0;
    this.refresh = () => { clearTimeout(this.t); this.t = setTimeout(() => this.render(), 250); };
    this.offs = [core.on('continue_watching_preview', this.refresh), core.on('board', this.refresh), core.on('ctx', this.refresh)];
    this.render();
  }

  async buildSections() {
    const apps = this.a.apps.map((app) => ({ key: 'app:' + app.id, app, onSelect: () => this.a.launch(app) }));
    const out = apps.length ? [{ id: 'apps', kind: 'app', items: apps }] : [];
    let cw = [], board = null;
    try { cw = await core.continueWatching(); board = await core.board(); } catch (_) {}
    if (cw.length) out.push({ id: 'cw', kind: 'poster', title: 'Continue Watching', items: cw.slice(0, 20).map((it) => ({
      key: 'cw:' + it._id, item: it, cw: true, onSelect: () => this.a.openTitle({ type: it.type, id: it._id, videoId: it.state && it.state.videoId, preview: it }) })) });
    if (board) for (const c of board.catalogs) {
      if (!c.content || c.content.type !== 'Ready' || !c.content.content.length) continue;
      if (c.type !== 'movie' && c.type !== 'series') continue;     // channels etc. aren't playable here
      const label = c.type === 'movie' ? 'Movies' : c.type === 'series' ? 'Series' : c.type;
      out.push({ id: `cat:${c.addon.manifest.id}:${c.id}:${c.type}`, kind: 'poster', title: `${c.name}  ·  ${label}`,
        items: c.content.content.slice(0, 20).map((it) => ({ key: `c:${c.id}:${c.type}:${it.id}`, item: it, onSelect: () => this.a.openTitle({ type: it.type, id: it.id, preview: it }) })) });
    }
    out.push({ id: 'sys', kind: 'sys', title: 'System', items: SYSTEM.map((s) => ({ key: 'sys:' + s.id, app: { ...s, a1: '#5a6070', a2: '#2b2f3a' }, onSelect: () => this.a.system(s.id) })) });
    return out;
  }

  async render() {
    const ticket = ++this.pending;
    const sections = await this.buildSections();
    if (ticket !== this.pending) return;                     // a newer render superseded this one
    const keep = this.grid.item && this.grid.item.key;
    const rows = [];
    clear(this.inner);
    this.rowEls = [];
    for (const s of sections) {
      const rowEl = h('div', { class: 'row row-' + s.kind, role: 'list' });
      const items = s.items.map((d) => {
        const el = d.item ? posterTile(d.item, { progress: d.cw ? d.item.progress : 0 }) : appTile(d.app, s.kind === 'sys');
        rowEl.append(el);
        return { ...d, el, kind: s.kind, rowEl, sec: s };
      });
      this.inner.append(h('section', { class: 'section sec-' + s.kind }, s.title ? h('h2', { class: 'row-title' }, s.title) : null, rowEl));
      rows.push(items);
      this.rowEls.push(rowEl);
    }
    this.sections = sections;
    this.grid.rows = rows;
    let r = 0, c = 0;
    if (!this.moved) {                                        // nobody has navigated yet: start on the first content row, not on whatever loaded first (System)
      const first = sections.findIndex((x) => x.kind !== 'sys'); if (first > 0) r = first;
    } else if (keep) rows.forEach((row, ri) => row.forEach((it, ci) => { if (it.key === keep) { r = ri; c = ci; } }));
    this.loading.hidden = sections.some((x) => x.kind !== 'sys');
    this._placedRow = -1; this._rendering = true;
    this.grid.clearFocus();
    this.grid.set(r, c, true);
    this._rendering = false;
    this.inner.style.transition = 'none'; this.place(r, true);
    requestAnimationFrame(() => (this.inner.style.transition = ''));
  }

  place(r, instant) {
    const it = this.grid.rows[r] && this.grid.rows[r][this.grid.pos.c]; if (!it) return;
    if (r !== this._placedRow || instant) {          // vertical work only when the row changes: holding Left/Right must stay cheap
      this._placedRow = r;
      const poster = it.kind === 'poster';
      document.documentElement.style.setProperty('--anchor', poster ? '58vh' : '66vh');
      this.inner.style.transform = `translate3d(0, calc(${-it.rowEl.offsetTop}px - ${poster ? 8 : 0}vh), 0)`;
      this.el.classList.toggle('on-sys', it.kind === 'sys');
      this.grid.rows.forEach((row, ri) => { const sec = row[0] && row[0].rowEl.parentElement; if (sec) sec.classList.toggle('past', ri < r); });
    }
    keepVisible(it.rowEl, it.el);
  }

  focused(it, r) {
    this.place(r);
    const now = performance.now(), fast = now - (this._lastFocus || 0) < 220;
    this._lastFocus = now;
    clearTimeout(this._shelfT);
    if (fast) { this._shelfT = setTimeout(() => this.showShelf(it), 160); return; }     // key repeat: skip the expensive backdrop/wallpaper swap until it settles
    this.showShelf(it);
  }

  showShelf(it) {
    if (it.item) { const i = titleInfo(it.item); if (it.cw) { i.progress = it.item.progress; i.meta = [episodeLabel(it.item.state && it.item.state.videoId), ...i.meta.slice(1)]; i.desc = i.desc || (it.item.progress > 1 ? Math.round(it.item.progress) + '% watched' : ''); } this.shelf.show(i); this.a.wall(...i.colors); }
    else if (it.kind === 'sys') { this.shelf.hide(); this.a.wall('#2c3346', '#12151f'); }
    else { const app = it.app; this.shelf.show({ id: app.id, title: app.name, desc: app.tagline, colors: [app.a1, app.a2], glyphHTML: glyphSVG(app) }); this.a.wall(app.a1, app.a2); }
  }

  onKey(k) { if (k.startsWith('Arrow')) this.moved = true; return false; }     // real navigation: from now on keep the user's place across refreshes
  goHome() { this.grid.set(0, 0); }
  onShow() { this.focused(this.grid.item || { kind: 'app', app: this.a.apps[0] || {} }, this.grid.pos.r); }
  destroy() { this.offs.forEach((f) => f()); }
}
