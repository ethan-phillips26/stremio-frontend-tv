import { h, poster, huePair } from '../ui.js';
import * as core from '../core.js';
import * as api from '../api.js';
import * as nav from '../nav.js';

const ms = (s) => Math.max(0, Math.round(s * 1000));

/** "Now Playing": starts mpv via the server, mirrors its progress into the core's Player model, returns when mpv exits. */
export class Playing {
  constructor(a, o) {
    this.name = 'playing'; this.a = a; this.o = o;
    this.status = h('div', { class: 'np-status' }, 'Starting…');
    this.bd = h('img', { class: 'd-bd', alt: '' });
    if (o.bg) { this.bd.onload = () => this.bd.classList.add('ready'); this.bd.src = o.bg; }
    this.el = h('div', { class: 'playing' }, this.bd, h('div', { class: 'd-shade' }),
      h('div', { class: 'np' }, h('div', { class: 'np-spin' }), h('h1', {}, o.title || ''), h('div', { class: 'meta' }, o.subtitle || ''), this.status));
    this.lastSent = 0; this.time = 0; this.dur = 0; this.closed = false; this.sawTime = false;
    this.offs = [
      api.onEvent('player', (e) => this.onPlayer(e)),
      api.onEvent('home', () => this.finish(false)),
    ];
  }
  onKey(k) { if (k === 'Escape' || k === 'Backspace') { api.post('/api/player/stop'); return true; } return true; }   // swallow: mpv owns the keys while running

  async onShow() {
    if (this.began) return; this.began = true;
    const o = this.o, e = o.entry, md = o.md;
    try {
      const prof = await core.profile();
      const base = (addon) => { const a = prof.addons.find((x) => x.manifest.id === addon.manifest.id); return a ? a.transportUrl : null; };
      const raw = { ...e.raw }; delete raw.deepLinks; delete raw.progress;
      const metaAddon = md.metaItem && md.metaItem.addon;
      await core.loadPlayer({
        stream: raw,
        streamRequest: e.addon && base(e.addon) ? { base: base(e.addon), path: md.selected.streamPath } : null,
        metaRequest: metaAddon && base(metaAddon) ? { base: base(metaAddon), path: md.selected.metaPath } : null,
        subtitlesPath: { resource: 'subtitles', type: o.type, id: o.videoId, extra: [] },
      });
    } catch (err) { console.warn('player load failed (progress will not sync):', JSON.stringify(err).slice(0, 200)); this.noSync = true; }
    const hdrs = (e.raw.behaviorHints && e.raw.behaviorHints.proxyHeaders && e.raw.behaviorHints.proxyHeaders.request) || {};
    const headers = Object.entries(hdrs).map(([k, v]) => `${k}: ${v}`);
    const res = await api.post('/api/player/start', { url: e.raw.url, title: o.title || '', subtitle: o.subtitle || '', start: (o.resumeMs || 0) / 1000, headers });
    if (!res || !res.ok) { this.a.toast('Could not start the player. Is mpv installed?'); this.finish(false, true); return; }
    this.addSubtitles();                                  // in the background: never delay the picture for subtitles
    this.startTimer = setTimeout(() => { if (!this.sawTime && !this.closed) this.status.textContent = 'Still connecting to the stream…'; }, 12000);
  }

  /** Subtitles come from addons (e.g. OpenSubtitles) via the core; add them to the running player when they arrive. */
  async addSubtitles() {
    if (this.noSync) return;
    try {
      const st = await core.waitFor('player', (s) => (s.subtitles || []).some((r) => r.content && r.content.type === 'Ready' && r.content.content.length), 9000);
      if (this.closed) return;
      const all = [];
      for (const r of st.subtitles || []) if (r.content && r.content.type === 'Ready') for (const s of r.content.content) all.push(s);
      // every language the addons offer (max 2 per language, 40 total) so the on-screen Subtitles menu can switch between them
      const per = {}, subs = [];
      for (const x of all) {
        const l = String(x.lang || 'und').toLowerCase();
        if (!x.url || (per[l] = (per[l] || 0) + 1) > 2 || subs.length >= 40) continue;
        subs.push({ url: x.url, lang: l });
      }
      if (subs.length) api.post('/api/player/subs', { subs });
    } catch (_) {}
  }

  onPlayer(e) {
    if (this.closed) return;
    if (e.event === 'time') {
      this.sawTime = true; this.time = e.time; this.dur = e.duration || this.dur;
      this.status.textContent = e.paused ? 'Paused' : 'Playing';
      document.body.classList.add('away');
      const now = Date.now();
      if (e.seeked) { core.seeked(ms(e.time), ms(this.dur)).catch(() => {}); this.lastSent = now; }
      else if (now - this.lastSent > 5000) { core.timeChanged(ms(e.time), ms(this.dur)).catch(() => {}); this.lastSent = now; }
    } else if (e.event === 'pause') {
      this.status.textContent = e.paused ? 'Paused' : 'Playing';
      core.pausedChanged(e.paused).catch(() => {});
      if (this.dur) core.timeChanged(ms(e.time), ms(this.dur)).catch(() => {});
    } else if (e.event === 'exit') {
      if (!this.sawTime) this.a.toast('That stream would not play. Try another one.');
      this.time = e.time || this.time; this.dur = e.duration || this.dur;
      this.finish(!!e.ended);
    }
  }

  /** Save the final position and release the core's Player model. Safe to call from destroy(). */
  async persist(ended, failed) {
    clearTimeout(this.startTimer); document.body.classList.remove('away');
    try {
      if (!failed && this.dur) await core.timeChanged(ms(ended ? this.dur : this.time), ms(this.dur));
      if (ended) await core.ended();
    } catch (_) {}
    await core.sleep(300);
    try { await core.unloadPlayer(); } catch (_) {}
  }

  async finish(ended, failed) {
    if (this.closed) return; this.closed = true;
    await this.persist(ended, failed);
    const back = this.o.returnTo;
    if (back) nav.popTo(back); else { nav.pop(); nav.pop(); }
    if (back && back.refresh) setTimeout(() => back.refresh(), 400);
  }
  destroy() { this.offs.forEach((f) => f()); if (!this.closed) { this.closed = true; this.persist(false); } }
}
