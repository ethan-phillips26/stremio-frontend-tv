import { h, clear, poster, huePair, SVG } from '../ui.js';
import { Grid, keepVisible } from '../focus.js';
import * as core from '../core.js';
import { titleInfo } from './home.js';

const mmss = (ms) => { const s = Math.floor(ms / 1000), m = Math.floor(s / 60); return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`; };
const sNum = (v) => v.season || (/:(\d+):\d+$/.exec(v.id) || [])[1] * 1 || 0;
const eNum = (v) => v.episode || (/:\d+:(\d+)$/.exec(v.id) || [])[1] * 1 || 0;

export class Detail {
  constructor(a, { type, id, videoId, preview }) {
    this.name = 'detail'; this.a = a; this.type = type; this.id = id; this.wantVideo = videoId; this.preview = preview || {};
    this.md = null; this.season = null; this.failed = false;
    this.bd = h('img', { class: 'd-bd', alt: '' });
    this.info = h('div', { class: 'd-info' });
    this.actions = h('div', { class: 'd-actions' });
    this.seasonsEl = h('div', { class: 'd-seasons row' });
    this.epsEl = h('div', { class: 'd-eps row' });
    this.scroller = h('div', { class: 'd-scroll' }, this.info, this.actions, this.seasonsEl, this.epsEl);
    this.el = h('div', { class: 'detail' }, this.bd, h('div', { class: 'd-shade' }), this.scroller);
    this.grid = new Grid([], { onFocus: (it, r) => this.focused(it, r) });
    this.draw();
    this.off = core.on('meta_details', () => { clearTimeout(this.t); this.t = setTimeout(() => this.refresh(), 150); });
    this.load();
  }

  async load() {
    try {
      await core.loadMeta(this.type, this.id, this.wantVideo);
      const md = await core.waitFor('meta_details', (s) => s.metaItem && s.metaItem.content && s.metaItem.content.type !== 'Loading', 20000);
      this.md = md;
      this.failed = !(md.metaItem && md.metaItem.content && md.metaItem.content.type === 'Ready');
    } catch (e) { this.failed = true; }
    this.draw();
  }
  async refresh() { try { this.md = await core.metaDetails(); this.draw(); } catch (_) {} }

  get meta() { const c = this.md && this.md.metaItem && this.md.metaItem.content; return c && c.type === 'Ready' ? c.content : null; }
  get lib() { return this.md && this.md.libraryItem; }

  videos() { const m = this.meta; return m && m.videos ? m.videos : []; }
  seasons() { const set = new Set(this.videos().map(sNum)); const a = [...set].sort((x, y) => (x || 99) - (y || 99)); return a; }

  /** The video that "Play" should start: the one in progress / next up, else the first real episode. */
  target() {
    if (this.type === 'movie') return this.id;
    const vids = this.videos(), lib = this.lib;
    const cur = (lib && lib.state && lib.state.video_id) || this.wantVideo;
    if (cur && vids.find((v) => v.id === cur)) return cur;
    const first = vids.filter((v) => sNum(v) > 0).sort((x, y) => sNum(x) - sNum(y) || eNum(x) - eNum(y))[0] || vids[0];
    return first && first.id;
  }
  resumeMs(videoId) {
    const s = this.lib && this.lib.state;
    if (!s || s.video_id !== videoId || !(s.timeOffset > 30000)) return 0;
    if (s.duration > 0 && s.timeOffset > s.duration * 0.95) return 0;
    return s.timeOffset;
  }

  /** Everything that affects what is drawn. The core emits many meta_details events (streams loading etc.); rebuilding the page for each one made it jump. */
  signature(info, vid, resume) {
    const m = this.meta, st = this.lib && this.lib.state;
    return JSON.stringify([!!m, this.failed, info.title, info.desc, info.logo, info.bg, (info.meta || []).join('|'), m && m.inLibrary, m && m.watched, vid, resume, this.season,
      this.videos().map((v) => v.id + (v.watched ? 1 : 0) + (v.thumbnail ? 't' : '')).join(','), st && [st.video_id, Math.floor((st.timeOffset || 0) / 30000), st.duration]]);
  }

  draw(force) {
    const m = this.meta, p = this.preview, base = m || p;
    const info = titleInfo({ ...p, ...(m || {}), _id: this.id });
    { const v0 = this.target(); const sig = this.signature(info, v0, v0 ? this.resumeMs(v0) : 0); if (!force && sig === this._sig) return; this._sig = sig; }
    this.a.wall(...huePair(this.id));
    if (info.bg && this.bd.dataset.src !== info.bg) { this.bd.dataset.src = info.bg; this.bd.classList.remove('ready'); this.bd.onload = () => this.bd.classList.add('ready'); this.bd.src = info.bg; }

    clear(this.info);
    const title = h('h1', {}, info.title || p.name || '');
    const logo = info.logo ? h('img', { class: 'd-logo', src: info.logo, alt: '', onload(e) { e.target.classList.add('ready'); title.hidden = true; }, onerror(e) { e.target.remove(); } }) : null;
    this.info.append(h('div', { class: 'd-head' }, logo, title),
      h('div', { class: 'meta' }, (info.meta || []).filter(Boolean).join('   ·   ')),
      h('p', { class: 'd-desc' }, info.desc || (this.failed ? 'Details could not be loaded. Check your connection and try again.' : (m ? '' : 'Loading…'))));

    // action buttons
    const rows = [], btns = [];
    const vid = this.target(), resume = vid ? this.resumeMs(vid) : 0;
    let label = 'Play';
    if (this.type === 'series' && vid) { const v = this.videos().find((x) => x.id === vid); label = `${resume ? 'Resume' : 'Play'} S${sNum(v || { id: vid })} E${eNum(v || { id: vid })}`; }
    else if (resume) label = `Resume  ·  ${mmss(resume)}`;
    const mk = (cls, icon, text, onSelect, disabled) => ({ el: h('div', { class: 'dbtn ' + cls + (disabled ? ' disabled' : '') }, h('i', { html: icon }), h('span', {}, text)), onSelect: disabled ? () => {} : onSelect });
    btns.push(mk('primary', SVG.play, label, () => this.play(vid, resume), !m || !vid));
    const inLib = m && m.inLibrary;
    btns.push(mk('', inLib ? SVG.check : SVG.plus, inLib ? 'In Library' : 'Add to Library', () => this.toggleLibrary(), !m));
    if (this.type === 'movie') btns.push(mk('', SVG.eye, m && m.watched ? 'Mark Unwatched' : 'Mark Watched', () => core.markWatched(!(m && m.watched)), !m));
    clear(this.actions); btns.forEach((b) => this.actions.append(b.el)); rows.push(btns);

    // series: seasons + episodes
    clear(this.seasonsEl); clear(this.epsEl);
    this.seasonsEl.hidden = this.epsEl.hidden = this.type !== 'series' || !m;
    if (this.type === 'series' && m) {
      const seasons = this.seasons();
      if (this.season == null) { const cv = this.videos().find((v) => v.id === vid); this.season = cv ? sNum(cv) : (seasons.find((s) => s > 0) ?? seasons[0]); }
      const chips = seasons.map((s) => ({ el: h('div', { class: 'chip' + (s === this.season ? ' sel' : '') }, s === 0 ? 'Specials' : `Season ${s}`), onSelect: () => { this.season = s; this.draw(true); this.grid.set(1, seasons.indexOf(s)); } }));
      chips.forEach((c) => this.seasonsEl.append(c.el)); rows.push(chips);
      const lib = this.lib, st = lib && lib.state;
      const eps = this.videos().filter((v) => sNum(v) === this.season).sort((x, y) => eNum(x) - eNum(y)).map((v) => {
        const cur = st && st.video_id === v.id;
        const pct = cur && st.duration > 0 ? Math.min(100, (st.timeOffset / st.duration) * 100) : 0;
        const upcoming = v.released && new Date(v.released) > new Date();
        const el = h('div', { class: 'tile ep' + (v.watched ? ' watched' : '') + (upcoming ? ' upcoming' : ''), role: 'listitem' },
          h('div', { class: 'tilt' }, h('div', { class: 'face' },
            v.thumbnail ? h('img', { class: 'art', src: v.thumbnail, loading: 'lazy', alt: '', onerror(e) { e.target.remove(); } }) : null,
            h('div', { class: 'ep-no' }, 'E' + eNum(v)),
            v.watched ? h('div', { class: 'ep-check', html: SVG.check }) : null,
            pct > 1 ? h('div', { class: 'prog' }, h('i', { style: { width: pct + '%' } })) : null,
            h('div', { class: 'sheen' }))),
          h('div', { class: 'ep-meta' }, h('div', { class: 'ep-title' }, v.title || `Episode ${eNum(v)}`), h('div', { class: 'ep-sub' }, upcoming ? 'Upcoming  ·  ' + String(v.released).slice(0, 10) : (v.released ? String(v.released).slice(0, 10) : ''))));
        this.epsEl.append(el);
        return { el, video: v, onSelect: () => (upcoming ? this.a.toast('Not released yet') : this.play(v.id, this.resumeMs(v.id))) };
      });
      rows.push(eps);
    }
    const keep = this.grid.pos;
    this.scroller.style.transition = 'none';                   // a redraw is not a user move: snap, don't animate
    this.grid.clearFocus(); this.grid.rows = rows.filter((r) => r.length);
    this.grid.set(Math.min(keep.r, this.grid.rows.length - 1), keep.c, true);
    requestAnimationFrame(() => requestAnimationFrame(() => { this.scroller.style.transition = ''; }));
  }

  focused(it, r) {
    const H = window.innerHeight;
    const el = r === 0 ? null : (this.grid.rows[r][0].el.parentElement);
    let shift = 0;
    if (el) shift = Math.max(0, el.offsetTop - (this.grid.rows[r][0].video ? 0.46 : 0.6) * H);
    this.scroller.style.transform = `translate3d(0,${-shift}px,0)`;
    this.el.classList.toggle('scrolled', shift > 0);
    if (el) keepVisible(el, it.el);
  }

  play(videoId, resumeMs) {
    const m = this.meta; if (!m || !videoId) return;
    const v = this.videos().find((x) => x.id === videoId);
    this.a.openStreams({ type: this.type, id: this.id, videoId, title: m.name, subtitle: v ? `S${sNum(v)} · E${eNum(v)}  ${v.title || ''}` : [m.releaseInfo, m.runtime].filter(Boolean).join('  ·  '),
      bg: m.background, resumeMs, detail: this });
  }
  async toggleLibrary() {
    const m = this.meta; if (!m) return;
    if (m.inLibrary) await core.removeFromLibrary(this.id);
    else await core.addToLibrary(m);
    setTimeout(() => this.refresh(), 300);
  }
  onShow() { this.refresh(); }
  destroy() { this.off(); }
}
