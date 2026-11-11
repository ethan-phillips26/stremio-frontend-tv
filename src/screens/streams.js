import { h, clear, poster, huePair } from '../ui.js';
import { Grid } from '../focus.js';
import * as core from '../core.js';
import { parseStream, rank, describe, heavy, resLabel } from '../quality.js';

export class Streams {
  constructor(a, o) {
    this.name = 'streams'; this.a = a; this.o = o;
    this.view = 'rec'; this.entries = []; this.pending = []; this.done = false; this.dead = false;
    this.title = h('h1', {}, o.title || '');
    this.sub = h('div', { class: 'meta' }, o.subtitle || '');
    this.status = h('div', { class: 'st-status' });
    this.seg = h('div', { class: 'seg' });
    this.list = h('div', { class: 'st-list' });
    this.listWrap = h('div', { class: 'st-listwrap' }, this.list);
    this.bd = h('img', { class: 'd-bd', alt: '' });
    if (o.bg) { this.bd.onload = () => this.bd.classList.add('ready'); this.bd.src = o.bg; }
    this.el = h('div', { class: 'streams' }, this.bd, h('div', { class: 'd-shade' }),
      h('div', { class: 'st-left' }, this.title, this.sub, this.seg, this.status), this.listWrap);
    this.grid = new Grid([], { onFocus: (it, r) => this.focused(it, r), aim: (dir, nr) => (nr === 0 ? (this.view === 'rec' ? 0 : 1) : undefined) });
    this.chips = [['rec', 'Recommended'], ['all', 'All qualities']].map(([k, label]) => ({
      el: h('div', { class: 'chip' }, label), view: k, onSelect: () => { this.view = k; this.renderList(true); } }));
    this.chips.forEach((c) => this.seg.append(c.el));
    this.maxRes = (a.config.playback && a.config.playback.maxResolution) || 1080;
    try { this.maxRes = +localStorage.getItem('maxRes') || this.maxRes; } catch (_) {}
    this.renderList();
  }

  async onShow() {
    if (this.started) return; this.started = true;
    this.a.wall(...huePair(this.o.id));
    const md = await core.metaDetails();
    const sp = md.selected && md.selected.streamPath;
    if (!sp || sp.id !== this.o.videoId) await core.loadMeta(this.o.type, this.o.id, this.o.videoId);
    this.poll();
  }

  async poll() {
    const t0 = Date.now();
    while (!this.dead) {
      let md; try { md = await core.metaDetails(); } catch (_) { break; }
      this.md = md;
      const entries = [], pending = []; let failed = 0, seen = new Set();
      for (const r of md.streams || []) {
        const name = r.addon && r.addon.manifest ? r.addon.manifest.name : 'Addon';
        const c = r.content;
        if (!c) { pending.push(name); continue; }
        if (c.type === 'Loading') pending.push(name);
        else if (c.type === 'Err') failed++;
        else if (c.type === 'Ready') for (const s of c.content) {
          if (!s.url || !/^https?:/i.test(s.url) || seen.has(s.url)) continue;
          seen.add(s.url);
          entries.push({ raw: s, addon: r.addon, addonName: name, q: parseStream(s, name) });
        }
      }
      entries.sort((x, y) => rank(x.q, this.maxRes) - rank(y.q, this.maxRes));
      const changed = entries.length !== this.entries.length || pending.join() !== this.pending.join();
      this.entries = entries; this.pending = pending; this.failed = failed;
      this.done = !pending.length || Date.now() - t0 > 25000;
      if (changed) this.renderList();
      if (this.done && entries.length) break;
      if (Date.now() - t0 > 30000) { this.done = true; this.renderList(); break; }
      await core.sleep(500);
    }
  }

  visible() {
    let list = this.entries;
    if (this.view === 'rec') {
      const ok = list.filter((e) => (!e.q.res || e.q.res <= this.maxRes) && e.q.source !== 'CAM');
      list = (ok.length ? ok : list).slice(0, 14);
    } else list = list.slice(0, 80);
    return list;
  }

  renderList(resetFocus) {
    this.chips.forEach((c) => c.el.classList.toggle('sel', c.view === this.view));
    const vis = this.visible();
    clear(this.list);
    const rows = vis.map((e, i) => {
      const d = describe(e.q);
      const el = h('div', { class: 'srow' + (i === 0 && this.view === 'rec' ? ' best' : '') },
        h('div', { class: 'sres' + (e.q.res >= 2160 ? ' k4' : '') }, resLabel(e.q.res)),
        h('div', { class: 'smain' }, h('div', { class: 's1' }, d.top || e.raw.name || 'Stream'), h('div', { class: 's2' }, d.sub || ((e.raw.description || '').split('\n')[0] || '').slice(0, 80))),
        h('div', { class: 'stags' },
          i === 0 && this.view === 'rec' ? h('span', { class: 'tag best' }, 'Best match') : null,
          e.q.cached ? h('span', { class: 'tag instant' }, 'Instant') : null,
          heavy(e.q) ? h('span', { class: 'tag heavy' }, 'Heavy') : null,
          h('span', { class: 'tag' }, e.addonName)));
      this.list.append(el);
      return { el, entry: e, onSelect: () => this.choose(e) };
    });
    if (!rows.length) this.list.append(h('div', { class: 'st-empty' }, this.done ? (this.failed ? 'No streams found. Your addons may be unreachable.' : 'No streams found for this title.') : 'Searching…'));
    this.status.textContent = this.pending.length ? `Searching ${this.pending.join(', ')}…` : (this.entries.length ? `${this.entries.length} streams found${this.view === 'rec' ? '  ·  showing the best for this device' : ''}` : '');
    const keepR = this.grid.pos.r;
    this.grid.clearFocus(); this.grid.rows = [this.chips, ...rows.map((r) => [r])].filter((r) => r.length);
    // focus: first stream if we have one, else the chips
    const r = resetFocus || !this.focusedOnce ? (rows.length ? 1 : 0) : Math.min(keepR, this.grid.rows.length - 1);
    this.grid.set(r, r === 0 ? (this.view === 'rec' ? 0 : 1) : 0, true);
    if (rows.length && !this.focusedOnce) this.focusedOnce = true;
  }

  focused(it, r) {
    if (r > 0) {
      const H = window.innerHeight;
      const y = it.el.offsetTop - H * 0.34;
      this.list.style.transform = `translate3d(0,${-Math.max(0, y)}px,0)`;
    }
  }
  onEdge(dir) {
    if (dir === 'left' && this.grid.pos.r > 0) this.grid.set(0, this.view === 'rec' ? 0 : 1);
    else if (dir === 'right' && this.grid.pos.r === 0 && this.grid.rows[1]) this.grid.set(1, 0);
  }

  choose(e) {
    this.a.play({ ...this.o, entry: e, md: this.md, returnTo: this.o.detail, streamsScreen: this });
  }
  destroy() { this.dead = true; }
}
